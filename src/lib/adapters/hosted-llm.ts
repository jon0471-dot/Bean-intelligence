/**
 * BEAN Intelligence — authorized hosted LLM adapter (RIISHE + CODE GIFTZ).
 *
 * Wraps the authorized inference gateway (z-ai-web-dev-sdk). Confirmed by
 * real probe (scripts/stage0-report.json): non-streaming chat PASS,
 * SSE streaming PASS (raw `data:` lines decoded server-side).
 */
import ZAI from 'z-ai-web-dev-sdk'
import type {
  ChatRequest,
  ChatResult,
  CodeTaskRequest,
  CodeTaskResult,
  HealthReport,
  TaskAdapter,
} from './types'
import { estimateTokens } from '@/lib/api/validate'
import {
  classifyUpstreamError,
  noteUpstream429,
  noteUpstreamSkip,
  upstreamCoolingDown,
  UpstreamAuthError,
  UpstreamBillingError,
  UpstreamRateLimitError,
} from '@/lib/upstream/gateway'

const BACKEND_ID = 'bean-llm-hosted-primary'

/** Parse raw SSE byte chunks from the gateway into text deltas. */
async function* sseDeltas(
  stream: AsyncIterable<unknown>,
): AsyncGenerator<string, void, unknown> {
  let buffer = ''
  for await (const part of stream) {
    buffer += Buffer.from(Object.values(part as Record<string, number>)).toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const m = line.match(/^data: (.*)$/)
      if (!m) continue
      if (m[1].trim() === '[DONE]') return
      try {
        const json = JSON.parse(m[1])
        const delta: string | undefined = json.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta.length > 0) yield delta
      } catch {
        // partial JSON across chunk boundary — carried in buffer
      }
    }
  }
}

function buildMessages(req: ChatRequest | CodeTaskRequest) {
  // CodeTaskRequest carries no history cap: its messages are already curated
  // by the CODE GIFTZ route (system prompt + single user turn).
  const maxHistoryMessages =
    'maxHistoryMessages' in req ? req.maxHistoryMessages : req.messages.length
  const history = req.messages.slice(-maxHistoryMessages)
  return history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content.slice(0, req.maxPromptChars),
  }))
}

/**
 * Upstream-boundary guard for chat completions.
 *
 * MEASURED CHANGE (2026-10-29 root-cause work): the previous wrapper retried
 * a 429 once after 2.5s. Server logs show both attempts failing back-to-back
 * ("API request failed with status 429" twice for one solve call) and spaced
 * single probes proving the throttle window lasts MINUTES — a 2.5s retry
 * never succeeds and only deepens the throttle (two chat 429s became four
 * calls per turn with the tool loop). So:
 *  - while the chat breaker is open -> fail fast, NO network call;
 *  - an observed 429 -> opens the breaker and propagates a typed
 *    UpstreamRateLimitError immediately (no retry into a throttle);
 *  - 401/403/402 -> typed auth/billing errors (distinct from throttling);
 *  - anything else propagates unchanged (timeouts/5xx are the router's
 *    BACKEND_TIMEOUT/BACKEND_FAILURE path — a blind retry there could
 *    double-charge non-idempotent work).
 * Recovery is verified by the next REAL call after the breaker opens —
 * never assumed.
 */
async function createWithGatewayGuard(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  body: unknown,
): Promise<unknown> {
  if (upstreamCoolingDown('chat')) {
    noteUpstreamSkip('chat')
    throw new UpstreamRateLimitError(
      'chat',
      'chat completion not attempted: upstream gateway is rate-limited (HTTP 429 observed moments ago); ' +
        'call skipped to avoid worsening the throttle',
      false,
    )
  }
  try {
    return await zai.chat.completions.create(body as never)
  } catch (e) {
    const failure = classifyUpstreamError(e)
    const raw = e instanceof Error ? e.message : String(e)
    if (failure.kind === 'rate_limited') {
      noteUpstream429('chat')
      throw new UpstreamRateLimitError('chat', `chat completion is rate-limited upstream (HTTP 429): ${raw.slice(0, 200)}`)
    }
    if (failure.kind === 'auth') {
      throw new UpstreamAuthError(`chat completion failed: gateway rejected credentials (HTTP ${failure.status}): ${raw.slice(0, 200)}`, failure.status ?? 401)
    }
    if (failure.kind === 'billing') {
      throw new UpstreamBillingError(`chat completion failed: gateway refused for account reasons (HTTP ${failure.status}): ${raw.slice(0, 200)}`, failure.status ?? 402)
    }
    throw e
  }
}

export const hostedLlmAdapter: TaskAdapter = {
  backendId: BACKEND_ID,

  async health(): Promise<HealthReport> {
    const t0 = Date.now()
    try {
      const zai = await ZAI.create()
      const completion = (await createWithGatewayGuard(zai, {
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        thinking: { type: 'disabled' },
      })) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = completion.choices?.[0]?.message?.content ?? ''
      const healthy = content.trim().length > 0
      return {
        healthy,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        detail: healthy ? 'Gateway responded to a live completion probe.' : 'Empty probe response.',
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // Honest failure classification: rate-limited / auth / billing are
      // DIFFERENT states from an application error or timeout — named as
      // such so operators and the UI never conflate them.
      const failure = classifyUpstreamError(e)
      const deferred = e instanceof UpstreamRateLimitError && !e.attempted
      const detail =
        failure.kind === 'rate_limited'
          ? `Upstream gateway rate-limited (HTTP 429) — probe ${deferred ? 'deferred while the cooldown breaker is open (no network call was made)' : 'rejected'}. ${message}`
          : failure.kind === 'auth'
            ? `Upstream gateway rejected credentials (HTTP ${failure.status}). ${message}`
            : failure.kind === 'billing'
              ? `Upstream gateway reports an account/billing restriction (HTTP ${failure.status}). ${message}`
              : `Probe failed: ${message}`
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        // A deferred probe NEVER ran — a fail-fast wall-clock delta (~2ms)
        // is not a probe latency and would misrepresent a skipped check as
        // a measured one. null means "no latency was measured".
        latencyMs: deferred ? null : Date.now() - t0,
        detail,
      }
    }
  },

  async chat(req: ChatRequest): Promise<ChatResult> {
    const t0 = Date.now()
    const zai = await ZAI.create()
    const completion = (await createWithGatewayGuard(zai, {
      messages: buildMessages(req),
      thinking: { type: req.thinkingEnabled ? 'enabled' : 'disabled' },
    })) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = completion.choices?.[0]?.message?.content ?? ''
    if (!content) {
      throw new Error('Upstream returned an empty completion')
    }
    const durationMs = Date.now() - t0
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
    return {
      content,
      tokensInEst: lastUser ? estimateTokens(lastUser.content) : null,
      tokensOutEst: estimateTokens(content),
      durationMs,
    }
  },

  async *chatStream(req: ChatRequest): AsyncGenerator<string, void, unknown> {
    const zai = await ZAI.create()
    const stream = (await createWithGatewayGuard(zai, {
      messages: buildMessages(req),
      stream: true,
      thinking: { type: req.thinkingEnabled ? 'enabled' : 'disabled' },
    })) as AsyncIterable<unknown>
    yield* sseDeltas(stream)
  },

  async codeTask(req: CodeTaskRequest): Promise<CodeTaskResult> {
    const t0 = Date.now()
    const zai = await ZAI.create()
    // MEASURED FIX (2026-10-29 product-availability audit): codeTask used to
    // call the gateway DIRECTLY, bypassing the chat-class 429 breaker the
    // chat/health paths honor — so CODE GIFTZ turns kept firing real requests
    // into an actively throttling gateway while the dashboard correctly
    // reported the product unavailable. Same endpoint class, same guard:
    // fail fast while the breaker is open, typed auth/billing/429 otherwise,
    // exactly one upstream attempt (no retry into a throttle).
    const completion = (await createWithGatewayGuard(zai, {
      messages: buildMessages(req),
      thinking: { type: 'disabled' },
    })) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = completion.choices?.[0]?.message?.content ?? ''
    if (!content) throw new Error('Upstream returned an empty completion')
    const durationMs = Date.now() - t0
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
    return {
      content,
      tokensInEst: lastUser ? estimateTokens(lastUser.content) : null,
      tokensOutEst: estimateTokens(content),
      durationMs,
    }
  },
}

/**
 * Timeout guard used by the router around adapter calls.
 *
 * Guarantees: the caller's awaited promise settles within `ms` — resolving
 * with the wrapped result, or rejecting with a labeled timeout error that
 * routes surface as BACKEND_FAILURE. The internal timer is always cleared
 * once the race settles, so it never keeps the event loop alive after
 * completion.
 *
 * Known limitation (recorded, not hidden): the authorized gateway SDK
 * (z-ai-web-dev-sdk) exposes no AbortSignal/options parameter on its create
 * calls (verified against dist/index.d.ts), so a timed-out underlying
 * request CANNOT be cancelled from here. Promise.race only abandons the
 * wait — the upstream request may continue until the provider itself times
 * out. It produces no customer-visible effect (the slot is released, the
 * response is discarded), but operators must assume the upstream work
 * consumed until the provider's own deadline. This is a platform-level
 * limitation to revisit if the SDK gains signal support.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
