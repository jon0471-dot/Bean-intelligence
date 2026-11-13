/**
 * BEAN Intelligence — POST /api/v1/chat/completions
 *
 * The unified chat completion endpoint (JSON + SSE). Auth: session cookie OR
 * application API key with the `chat:completions` scope.
 *
 * Request (OpenAI-style names accepted for interoperability):
 *   { model, messages: [{role, content}], system?, stream?, temperature?,
 *     max_tokens? | maxTokens?, providerModel? }
 *
 * JSON response (stream=false/absent): the BEAN envelope with content,
 * provider/model identity, usage (exact flag when provider-reported), and
 * finishReason. SSE (stream=true): `data: {"delta":"…"}` frames, exactly one
 * terminal `data: {"done":true,…}` or typed error frame, `: keepalive`
 * comments during silent stretches — the same lifecycle discipline as the
 * product streams (heartbeats, single terminal frame, release-once).
 *
 * Honesty: every failure maps through the shared upstream classifier — a 429
 * stays a 429, auth/billing say retrying will not help, and usage is labeled
 * exact vs estimated. Provider credentials never appear anywhere in the
 * response surface.
 */
import { z } from 'zod'
import { handle, BeanApiError, rateLimitHeaders } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireGatewayPrincipal } from '@/lib/security/gateway-auth'
import { checkGatewayRateLimit, checkGatewayQuota, planGatewayChat, executeGatewayChat, executeGatewayChatStream, gatewayErrorFor, isGatewayCancelled, recordGatewayCall } from '@/lib/ai-gateway/gateway'
import { GATEWAY_RATE_LIMIT_PER_MIN, GATEWAY_DAILY_QUOTA } from '@/lib/ai-gateway/types'
import { upstreamCooldownRemainingMs, UpstreamRateLimitError } from '@/lib/upstream/gateway'
import { logger } from '@/lib/observability/logger'

const schema = z.object({
  model: z.string().min(1, 'A model id is required.'),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(64_000),
      }),
    )
    .min(1)
    .max(48),
  system: z.string().max(24_000).optional(),
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(32_000).optional(),
  maxTokens: z.number().int().min(1).max(32_000).optional(),
  providerModel: z.string().max(200).optional(),
})

const HEARTBEAT_MS = 15_000

export async function POST(request: Request) {
  return handle(async () => {
    const t0 = Date.now()
    const principal = await requireGatewayPrincipal(request, 'chat:completions')

    // Caller throttling (per-principal, distinct from product limits).
    const rl = checkGatewayRateLimit(principal.userId)
    if (!rl.allowed) {
      // Headers carry the SAME limiter state that rejected the call.
      throw new BeanApiError(
        'RATE_LIMITED',
        `Gateway rate limit reached (${GATEWAY_RATE_LIMIT_PER_MIN}/min). Retry in ${rl.retryAfterSec}s.`,
        undefined,
        {
          headers: rateLimitHeaders({
            limit: GATEWAY_RATE_LIMIT_PER_MIN,
            remaining: rl.remaining,
            resetAtMs: rl.resetAtMs,
            retryAfterSec: rl.retryAfterSec,
          }),
        },
      )
    }
    const quota = await checkGatewayQuota(principal.userId)
    if (!quota.allowed) {
      // Daily quota: the reset boundary is the real next-local-midnight the
      // count query uses; Retry-After is derived from it, never invented.
      throw new BeanApiError(
        'QUOTA_EXCEEDED',
        `Gateway daily quota reached (${quota.used}/${quota.limit}). Resets at midnight.`,
        undefined,
        {
          headers: rateLimitHeaders({
            limit: quota.limit,
            remaining: Math.max(0, quota.limit - quota.used),
            resetAtMs: quota.resetsAtMs,
            retryAfterSec: Math.max(0, Math.ceil((quota.resetsAtMs - Date.now()) / 1000)),
          }),
        },
      )
    }

    const body = await parseBody(request, schema)
    const plan = await planGatewayChat({
      model: body.model,
      messages: body.messages,
      system: body.system,
      temperature: body.temperature,
      maxTokens: body.maxTokens ?? body.max_tokens,
      stream: body.stream,
      providerModel: body.providerModel,
    })

    const ctx = {
      userId: principal.userId,
      apiKeyId: principal.kind === 'api-key' ? principal.keyId : null,
      authKind: principal.kind === 'api-key' ? ('api-key' as const) : ('session' as const),
      endpoint: '/api/v1/chat/completions',
      signal: request.signal,
    }

    // ---- SSE streaming path ----------------------------------------------
    if (body.stream === true) {
      const encoder = new TextEncoder()
      let streamed = false
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false
          let terminalSent = false
          const safeEnqueue = (chunk: Uint8Array): boolean => {
            if (closed) return false
            try {
              controller.enqueue(chunk)
              return true
            } catch {
              closed = true
              return false
            }
          }
          const sendJson = (obj: Record<string, unknown>) => safeEnqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
          const heartbeat = setInterval(() => {
            if (!closed && !terminalSent) safeEnqueue(encoder.encode(': keepalive\n\n'))
          }, HEARTBEAT_MS)

          void (async () => {
            let chars = 0
            let deltas = 0
            try {
              for await (const delta of executeGatewayChatStream(plan, ctx)) {
                chars += delta.length
                deltas += 1
                streamed = true
                sendJson({ delta })
              }
              terminalSent = true
              sendJson({
                done: true,
                model: plan.model.id,
                provider: plan.model.provider,
                durationMs: Date.now() - t0,
              })
              await recordGatewayCall({
                ctx, plan, status: 200, streamed: true, modelId: plan.model.id,
                durationMs: Date.now() - t0,
                tokensIn: plan.messages.reduce((n, m) => n + m.content.length, 0),
                tokensOut: Math.ceil(chars),
              })
            } catch (e) {
              if (isGatewayCancelled(e)) {
                logger.info('gateway.stream_cancelled', { endpoint: ctx.endpoint })
                return // cancelled callers receive nothing further
              }
              const beanError = gatewayErrorFor(e)
              logger.warn('gateway.stream_failed', { endpoint: ctx.endpoint, code: beanError.code, message: beanError.message.slice(0, 200) })
              terminalSent = true
              sendJson({ error: beanError.message, code: beanError.code, partial: chars > 0 })
              await recordGatewayCall({
                ctx, plan, status: beanErrorToStatus(beanError.code), errorCode: beanError.code,
                streamed: true, modelId: plan.model.id,
                durationMs: Date.now() - t0,
                tokensIn: plan.messages.reduce((n, m) => n + m.content.length, 0),
                tokensOut: Math.ceil(chars),
              })
            } finally {
              clearInterval(heartbeat)
              try {
                controller.close()
              } catch {
                /* already closed/errored */
              }
            }
          })()
        },
        cancel() {
          // The runtime cancelled the stream — signal the generator to unwind.
          streamed = true
        },
      })
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        },
      })
    }

    // ---- JSON path ----------------------------------------------------------
    try {
      const result = await executeGatewayChat(plan, ctx)
      await recordGatewayCall({
        ctx, plan, result, status: 200, streamed: false, modelId: plan.model.id,
        tokensIn: result.usage.tokensIn, tokensOut: result.usage.tokensOut,
        durationMs: result.durationMs,
      })
      return Response.json({
        ok: true as const,
        content: result.content,
        model: result.model,
        provider: result.provider,
        finishReason: result.finishReason,
        usage: { tokensIn: result.usage.tokensIn, tokensOut: result.usage.tokensOut, exact: result.usage.exact },
        durationMs: result.durationMs,
      })
    } catch (e) {
      const beanError = gatewayErrorFor(e)
      // Truthful upstream retry timing when the evidence exists: prefer the
      // provider's own Retry-After hint (when an adapter captured one), else
      // the REAL remaining breaker window for the chat class. Omitted when
      // neither is known — never fabricated.
      if (beanError.code === 'RATE_LIMITED') {
        const providerHintMs = e instanceof UpstreamRateLimitError ? e.retryAfterMs : null
        const breakerRemainingMs = upstreamCooldownRemainingMs('chat')
        const knownMs = providerHintMs ?? (breakerRemainingMs > 0 ? breakerRemainingMs : null)
        if (knownMs !== null && knownMs > 0) {
          beanError.headers = rateLimitHeaders({ retryAfterSec: Math.ceil(knownMs / 1000) })
        }
      }
      await recordGatewayCall({
        ctx, plan, status: beanErrorToStatus(beanError.code), errorCode: beanError.code,
        streamed: false, modelId: plan.model.id, durationMs: Date.now() - t0,
        tokensIn: plan.messages.reduce((n, m) => n + m.content.length, 0),
      })
      throw beanError
    }
  })
}

function beanErrorToStatus(code: string): number {
  switch (code) {
    case 'RATE_LIMITED':
    case 'QUOTA_EXCEEDED':
      return 429
    case 'BACKEND_TIMEOUT':
      return 504
    case 'PRODUCT_UNAVAILABLE':
    case 'NO_BACKEND':
      return 503
    case 'VALIDATION_ERROR':
    case 'CAPABILITY_UNSUPPORTED':
      return 422
    case 'FORBIDDEN':
      return 403
    case 'UNAUTHENTICATED':
      return 401
    default:
      return 502
  }
}
