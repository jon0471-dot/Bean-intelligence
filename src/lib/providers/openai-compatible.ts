/**
 * BEAN Intelligence — product-runtime OpenAI-compatible chat/coding adapter
 * (SERVER ONLY — the prepared provider fallback for RIISHE + CODE GIFTZ).
 *
 * PHASE 1/2 requirement ("prepare the integration and identify the exact API
 * credential needed"): RIISHE chat and CODE GIFTZ coding ride the authorized
 * z-ai gateway, which is periodically account-throttled. This adapter
 * implements the STANDARD OpenAI chat-completions contract (POST
 * {baseUrl}/chat/completions, Bearer auth, SSE streaming) so ANY
 * OpenAI-compatible provider the operator authorizes (OpenAI, Azure OpenAI,
 * Groq, Together, OpenRouter, DeepSeek, a self-hosted vLLM endpoint, …) can
 * serve as a fallback WITHOUT further code changes.
 *
 * Credential sources (checked in order, values never logged/stored/returned):
 *  1. ADMIN VAULT — an active encrypted 'openai-compatible' credential
 *     (AES-256-GCM, SSRF-validated base URL) managed by administrators in
 *     the gateway console. Decrypted per request via the store's single
 *     decryption path.
 *  2. RUNTIME ENV — BEAN_PROVIDER_OPENAI_API_KEY (+ optional
 *     BEAN_PROVIDER_OPENAI_BASE_URL / BEAN_PROVIDER_OPENAI_MODEL), also
 *     SSRF-validated before use.
 * With neither source the adapter is DORMANT: no request is ever made and
 * the routing layer reports the slot as 'not-configured'.
 *
 * Hard honesty rules:
 *  - CAPABILITY IS VERIFIED, NEVER ASSUMED: health() runs a real tiny
 *    completion through the configured endpoint.
 *  - One attempt per call; 429 opens the DEDICATED 'chat-fallback' breaker
 *    class (a throttled fallback never shares breaker state with — and is
 *    never fail-fasted by — the primary gateway's breaker).
 *  - Streaming reuses the platform's audited SSE decoder (idle + total
 *    duration guards, multibyte-safe final flush) via sseDeltas().
 *  - Bearer tokens are redacted from any error text that could reach a log.
 */

import {
  classifyUpstreamError,
  noteUpstream429,
  noteUpstreamSkip,
  noteUpstreamSuccess,
  parseRetryAfterHeaders,
  upstreamCoolingDown,
  UpstreamRateLimitError,
} from '@/lib/upstream/gateway'
import { sseDeltas } from '@/lib/adapters/hosted-llm'
import { estimateTokens } from '@/lib/api/validate'
import { decryptProviderCredential } from '@/lib/security/provider-credentials'
import { validateProviderBaseUrl } from '@/lib/security/url-guard'
import type {
  ChatRequest,
  ChatResult,
  CodeTaskRequest,
  CodeTaskResult,
  HealthReport,
  TaskAdapter,
} from '@/lib/adapters/types'
import { resolveOpenAiCompatibleRuntimeCredential } from './credentials'

export const OPENAI_COMPATIBLE_BACKEND_ID = 'bean-llm-openai-compatible'

interface RuntimeCred {
  apiKey: string
  baseUrl: string
  model: string
}

/** Resolve the active credential material (vault → env), or null when dormant. */
async function resolveRuntimeCred(): Promise<RuntimeCred | null> {
  const resolved = await resolveOpenAiCompatibleRuntimeCredential()
  if (!resolved) return null
  if (resolved.origin === 'admin-vault' && resolved.credentialId) {
    // The store's single decryption path (re-validates the SSRF policy and
    // rejects revoked rows; marks lastUsedAt for usage tracking).
    const { payload, baseUrl } = await decryptProviderCredential(resolved.credentialId)
    if (!baseUrl) return null // credential without an endpoint cannot serve
    return { apiKey: payload.apiKey, baseUrl: baseUrl.replace(/\/+$/, ''), model: resolved.model }
  }
  // Env path: apply the same SSRF policy the vault enforces at write time.
  const guard = validateProviderBaseUrl(resolved.baseUrl)
  if (!guard.ok) return null
  return { apiKey: resolved.apiKey, baseUrl: resolved.baseUrl.replace(/\/+$/, ''), model: resolved.model }
}

function redact(s: string): string {
  return s.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')
}

async function postChatCompletion(
  cred: RuntimeCred,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  // Hard client-side deadline — the fallback's request-timeout policy is
  // enforced with a real AbortSignal, not just raced.
  return await fetch(`${cred.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The credential exists ONLY in this header.
      Authorization: `Bearer ${cred.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
  })
}

function buildBody(
  req: ChatRequest | CodeTaskRequest,
  stream: boolean,
  model: string,
): Record<string, unknown> {
  return {
    model,
    messages: req.messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content.slice(0, req.maxPromptChars),
    })),
    stream,
    max_tokens: 4096,
  }
}

async function execute(
  req: ChatRequest | CodeTaskRequest,
  stream: boolean,
): Promise<Response> {
  const cred = await resolveRuntimeCred()
  if (!cred) {
    // Typed honest refusal — never a fabricated attempt.
    throw new UpstreamRateLimitError(
      'chat-fallback',
      'OpenAI-compatible fallback is not configured (an administrator credential or BEAN_PROVIDER_OPENAI_API_KEY is required); no request was made',
      false,
    )
  }
  if (upstreamCoolingDown('chat-fallback')) {
    noteUpstreamSkip('chat-fallback')
    throw new UpstreamRateLimitError(
      'chat-fallback',
      'fallback chat completion not attempted: the fallback endpoint class is rate-limited (HTTP 429 observed moments ago)',
      false,
    )
  }
  const body = buildBody(req, stream, cred.model)
  let res: Response
  try {
    res = await postChatCompletion(cred, body, req.timeoutMs)
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new Error(`fallback provider timed out after ${req.timeoutMs}ms`)
    }
    throw e
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    const message = redact(`status ${res.status}: ${errBody.slice(0, 200)}`)
    if (res.status === 429) {
      // ZERO-DOWNTIME RECOVERY (2026-11-11): this lane does a DIRECT fetch, so
      // the response headers are actually readable — honor the provider's own
      // retry hint (Retry-After / x-ratelimit-reset) when one is present,
      // instead of BEAN's conservative guess. The typed error carries the
      // value so downstream parking (queue retries, video backoff) uses it too.
      const hint = parseRetryAfterHeaders(res.headers)
      noteUpstream429('chat-fallback', Date.now(), hint)
      throw new UpstreamRateLimitError(
        'chat-fallback',
        `fallback chat completion is rate-limited upstream (HTTP 429): ${message}`,
        true,
        hint,
      )
    }
    const failure = classifyUpstreamError(new Error(message))
    if (failure.kind === 'auth') throw new Error(`fallback provider rejected credentials (HTTP ${res.status}). Check the configured credential — retrying will not change this.`)
    if (failure.kind === 'billing') throw new Error(`fallback provider refused for account/billing reasons (HTTP ${res.status}).`)
    throw new Error(`fallback chat completion failed (HTTP ${res.status}): ${message}`)
  }
  noteUpstreamSuccess('chat-fallback')
  return res
}

export const openAiCompatibleAdapter: TaskAdapter = {
  backendId: OPENAI_COMPATIBLE_BACKEND_ID,

  async health(): Promise<HealthReport> {
    const t0 = Date.now()
    const cred = await resolveRuntimeCred()
    if (!cred) {
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: null,
        failureCategory: 'not-configured',
        detail:
          'Not configured: the prepared OpenAI-compatible fallback has no active credential (neither an admin-vault credential nor BEAN_PROVIDER_OPENAI_API_KEY). It consumes nothing and is never routed to until an operator adds one.',
      }
    }
    try {
      const res = await postChatCompletion(
        cred,
        { model: cred.model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 8 },
        15_000,
      )
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        const message = redact(`status ${res.status}: ${errBody.slice(0, 160)}`)
        if (res.status === 429) {
          const hint = parseRetryAfterHeaders(res.headers)
          noteUpstream429('chat-fallback', Date.now(), hint)
          return {
            healthy: false,
            checkedAt: new Date().toISOString(),
            latencyMs: Date.now() - t0,
            httpStatus: 429,
            failureCategory: 'rate-limited',
            detail: `Fallback provider reachable but rate-limited (HTTP 429): ${message}`,
          }
        }
        const failure = classifyUpstreamError(new Error(message))
        return {
          healthy: false,
          checkedAt: new Date().toISOString(),
          latencyMs: Date.now() - t0,
          httpStatus: res.status,
          failureCategory: failure.kind === 'auth' ? 'auth' : failure.kind === 'billing' ? 'billing' : 'backend-error',
          detail: `Fallback provider probe failed (HTTP ${res.status}): ${message}`,
        }
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const content = json.choices?.[0]?.message?.content ?? ''
      const healthy = content.trim().length > 0
      // A real completion through the configured model IS the capability
      // verification — a reachable endpoint without a working model is
      // reported unhealthy, never assumed.
      return {
        healthy,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        httpStatus: null,
        failureCategory: healthy ? null : 'backend-error',
        detail: healthy
          ? 'Fallback provider answered a real completion probe (chat capability verified, not assumed).'
          : 'Fallback provider returned an empty completion probe response.',
      }
    } catch (e) {
      const failure = classifyUpstreamError(e)
      return {
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - t0,
        httpStatus: failure.status,
        failureCategory: failure.kind === 'timeout' ? 'timeout' : failure.kind === 'network' ? 'unreachable' : 'backend-error',
        detail: `Fallback provider probe failed: ${redact(e instanceof Error ? e.message : String(e))}`,
      }
    }
  },

  async chat(req: ChatRequest): Promise<ChatResult> {
    const t0 = Date.now()
    const res = await execute(req, false)
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = json.choices?.[0]?.message?.content ?? ''
    if (!content) throw new Error('Fallback provider returned an empty completion')
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
    return {
      content,
      tokensInEst: json.usage?.prompt_tokens ?? (lastUser ? estimateTokens(lastUser.content) : null),
      tokensOutEst: json.usage?.completion_tokens ?? estimateTokens(content),
      durationMs: Date.now() - t0,
    }
  },

  async *chatStream(req: ChatRequest): AsyncGenerator<string, void, unknown> {
    const res = await execute(req, true)
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream') && !contentType.includes('text/plain')) {
      // Some OpenAI-compatible providers ignore stream:true — parse the JSON
      // body and emit it as a single delta rather than failing the turn.
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const content = json.choices?.[0]?.message?.content ?? ''
      if (content) yield content
      return
    }
    if (!res.body) throw new Error('Fallback provider stream closed with no body')
    // Reuse the platform's audited SSE decoder (idle/total guards, multibyte
    // flush). Node fetch returns a web stream — sseDeltas consumes iterables.
    yield* sseDeltas(res.body as unknown as AsyncIterable<unknown>)
  },

  async codeTask(req: CodeTaskRequest): Promise<CodeTaskResult> {
    const t0 = Date.now()
    const res = await execute(req, false)
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = json.choices?.[0]?.message?.content ?? ''
    if (!content) throw new Error('Fallback provider returned an empty completion')
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')
    return {
      content,
      tokensInEst: lastUser ? estimateTokens(lastUser.content) : null,
      tokensOutEst: estimateTokens(content),
      durationMs: Date.now() - t0,
    }
  },
}
