/**
 * BEAN Intelligence — external OpenAI-compatible provider adapter.
 *
 * A REAL, fully implemented integration path for any provider exposing the
 * standard OpenAI wire protocol (OpenAI, Azure OpenAI, Groq, Together, vLLM,
 * OpenRouter, …). It becomes usable ONLY when an administrator has stored an
 * encrypted credential for it (provider-credentials.ts) — until then the
 * model registry honestly reports 'awaiting-credentials' and this adapter is
 * never invoked.
 *
 * Credentials never leave the server: the key is decrypted per request from
 * the AES-256-GCM envelope and placed ONLY in the upstream Authorization
 * header. It never enters a log, an error message, or a client response.
 *
 * Streaming uses the same battle-tested SSE delta parser as the hosted
 * gateway (hosted-llm sseDeltas): the OpenAI wire format IS the format that
 * parser implements (data: {choices:[{delta:{content}}]}, [DONE] sentinel,
 * finish_reason "length" truncation class).
 *
 * Honesty: failures are classified with the SHARED upstream classifier —
 * 429/auth/billing/timeout/network are distinct, typed, and never masked as
 * success. Usage is recorded from the provider's reported counts when the
 * response includes them (exact), else estimated (clearly labeled).
 */
import { classifyUpstreamError, noteUpstream429, noteUpstreamSkip, noteUpstreamSuccess, upstreamCoolingDown, UpstreamAuthError, UpstreamBillingError, UpstreamRateLimitError } from '@/lib/upstream/gateway'
import { sseDeltas, UpstreamTruncatedError } from '@/lib/adapters/hosted-llm'
import { decryptProviderCredential } from '@/lib/security/provider-credentials'
import { BeanApiError } from '@/lib/api/errors'
import type { GatewayChatMessage, GatewayChatResult, GatewayCallContext } from '../types'

const MAX_PROMPT_CHARS = 32_000
/** External non-streaming call budget (default 120 s; operator/test override
 *  BEAN_EXTERNAL_TIMEOUT_MS, clamped to [1s, 600s]). */
function externalTimeoutMs(): number {
  const ms = Number(process.env.BEAN_EXTERNAL_TIMEOUT_MS || DEFAULT_EXTERNAL_TIMEOUT_MS)
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 1_000), 600_000) : DEFAULT_EXTERNAL_TIMEOUT_MS
}
const DEFAULT_EXTERNAL_TIMEOUT_MS = 120_000
/** M26 G-3: bounded time-to-first-byte for opening an external SSE stream
 *  (default 30 s; BEAN_EXTERNAL_STREAM_OPEN_TIMEOUT_MS override for
 *  operator/test tuning — the bound itself can be disabled ONLY by an
 *  explicit env choice, never by code). */
function externalStreamOpenTimeoutMs(): number {
  const ms = Number(process.env.BEAN_EXTERNAL_STREAM_OPEN_TIMEOUT_MS || 30_000)
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 600_000) : 30_000
}

export interface ExternalCallOptions {
  credentialId: string
  providerModel: string
  messages: GatewayChatMessage[]
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal | null
}

// M26 (audit G-1): the external lane has its OWN breaker class — repeated
// 429s open 'chat-external' and can never fail-fast (or be failed-fast by)
// the hosted gateway's 'chat' breaker. The mislabeled 'chat' class also fed
// the hosted window to clients as the Retry-After hint for EXTERNAL 429s.
const EXTERNAL_BREAKER_CLASS = 'chat-external'

function authHeaderFetchError(e: unknown): never {
  const failure = classifyUpstreamError(e)
  const raw = e instanceof Error ? e.message : String(e)
  const safe = raw.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')
  if (failure.kind === 'rate_limited') {
    noteUpstream429(EXTERNAL_BREAKER_CLASS)
    throw new UpstreamRateLimitError(EXTERNAL_BREAKER_CLASS, `external provider rate-limited the request (HTTP 429): ${safe.slice(0, 200)}`)
  }
  if (failure.kind === 'auth') {
    throw new UpstreamAuthError(`external provider rejected the configured credential (HTTP ${failure.status}): ${safe.slice(0, 200)}`, failure.status ?? 401)
  }
  if (failure.kind === 'billing') {
    throw new UpstreamBillingError(`external provider refused the request for account reasons (HTTP ${failure.status}): ${safe.slice(0, 200)}`, failure.status ?? 402)
  }
  throw new BeanApiError('BACKEND_FAILURE', `The external provider call failed: ${safe.slice(0, 200)}`)
}

interface OpenAIChoice {
  message?: { content?: string | null }
  delta?: { content?: string | null }
  finish_reason?: string | null
}
interface OpenAIResponse {
  choices?: OpenAIChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

async function callUpstream(
  opts: ExternalCallOptions,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ res: Response; baseUrl: string }> {
  const { payload, baseUrl } = await decryptProviderCredential(opts.credentialId)
  if (!baseUrl) {
    throw new BeanApiError(
      'VALIDATION_ERROR',
      'The configured OpenAI-compatible credential has no base URL. An administrator must set the provider endpoint.',
    )
  }
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  // M26 (audit G-1): fail fast on the lane's OWN breaker (a repeated-429
  // external provider is never re-hit during its cooldown window — the same
  // first-429-opens policy as every other adapter; zero network I/O on a
  // skip, and the skip never counts as an attempt).
  if (upstreamCoolingDown(EXTERNAL_BREAKER_CLASS)) {
    noteUpstreamSkip(EXTERNAL_BREAKER_CLASS)
    throw new UpstreamRateLimitError(
      EXTERNAL_BREAKER_CLASS,
      'external provider endpoint not attempted: its breaker class is cooling down (repeated 429s observed)',
      false,
    )
  }
  let res: Response
  // M26 (audit G-2/L6): an ALREADY-aborted caller never reaches the wire.
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The credential exists ONLY in this header — never logged, never returned.
        authorization: `Bearer ${payload.apiKey}`,
      },
      body: JSON.stringify(body),
      // M26 (audit G-2): the caller's cancellation now propagates — the
      // previous fixed AbortSignal.timeout IGNORED opts.signal entirely, so
      // a cancelled caller's fetch ran to completion and was billed.
      signal:
        opts.signal && timeoutMs > 0
          ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
          : timeoutMs > 0
            ? AbortSignal.timeout(timeoutMs)
            : (opts.signal ?? undefined),
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new Error(`external provider timed out after ${timeoutMs}ms`)
    }
    authHeaderFetchError(e)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    // Reuse the shared status classifier on the transport-level status.
    authHeaderFetchError(new Error(`status ${res.status}: ${text.slice(0, 200)}`))
  }
  return { res, baseUrl }
}

/** One non-streaming completion through the configured external provider. */
export async function openAICompatibleChat(
  opts: ExternalCallOptions,
  ctx: GatewayCallContext,
): Promise<GatewayChatResult> {
  const t0 = Date.now()
  const timeoutMs = externalTimeoutMs()
  const body: Record<string, unknown> = {
    model: opts.providerModel,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content.slice(0, MAX_PROMPT_CHARS) })),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
  }
  const { res } = await callUpstream(opts, body, timeoutMs)
  let json: OpenAIResponse
  try {
    json = (await res.json()) as OpenAIResponse
  } catch {
    throw new BeanApiError('BACKEND_FAILURE', 'The external provider returned a non-JSON response.')
  }
  const choice = json.choices?.[0]
  const content = choice?.message?.content ?? ''
  if (!content) throw new BeanApiError('BACKEND_FAILURE', 'The external provider returned an empty completion.')
  if (choice?.finish_reason === 'length') throw new UpstreamTruncatedError(undefined, content)
  noteUpstreamSuccess(EXTERNAL_BREAKER_CLASS)
  const promptChars = opts.messages.reduce((n, m) => n + m.content.length, 0)
  return {
    content,
    provider: 'external:openai-compatible',
    model: opts.providerModel,
    backendId: 'bean-external-openai-compatible',
    durationMs: Date.now() - t0,
    finishReason: choice?.finish_reason === 'length' ? 'length' : 'stop',
    usage: {
      tokensIn: json.usage?.prompt_tokens ?? Math.ceil(promptChars / 4),
      tokensOut: json.usage?.completion_tokens ?? Math.ceil(content.length / 4),
      exact: json.usage?.prompt_tokens !== undefined,
    },
  }
}

/** Streaming completion — yields text deltas (same shapes as the hosted path). */
export async function* openAICompatibleStream(
  opts: ExternalCallOptions,
  ctx: GatewayCallContext,
): AsyncGenerator<string, void, unknown> {
  const body: Record<string, unknown> = {
    model: opts.providerModel,
    messages: opts.messages.map((m) => ({ role: m.role, content: m.content.slice(0, MAX_PROMPT_CHARS) })),
    stream: true,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
  }
  // M26 (audit G-3): the stream OPEN is deadline-bounded (30 s to the first
  // byte) — the previous `0` (no fetch-level timeout at all) let a hung
  // stream-open hold the SSE turn indefinitely under heartbeats. After the
  // body is open, the between-delta guards apply (idle 120 s at the sseDeltas
  // layer / cancellation between deltas).
  const { res } = await callUpstream(opts, body, externalStreamOpenTimeoutMs())
  if (!res.body) throw new BeanApiError('BACKEND_FAILURE', 'The external provider returned no stream body.')
  // Cooperative cancellation unwinds at the next delta (same contract as the
  // hosted path; the signal cannot kill in-flight transport bytes).
  const guarded = (async function* () {
    for await (const delta of sseDeltas(res.body as unknown as AsyncIterable<unknown>)) {
      if (ctx.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      yield delta
    }
  })()
  yield* guarded
}

/**
 * REAL health probe for the configured external provider: GET /models with
 * the stored credential. A genuine network call — never a fabricated ok.
 */
export async function probeOpenAICompatible(credentialId: string): Promise<{
  healthy: boolean
  checkedAt: string
  latencyMs: number | null
  detail: string
}> {
  const t0 = Date.now()
  try {
    const { payload, baseUrl } = await decryptProviderCredential(credentialId)
    if (!baseUrl) {
      return { healthy: false, checkedAt: new Date().toISOString(), latencyMs: null, detail: 'Credential has no base URL configured.' }
    }
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { authorization: `Bearer ${payload.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    const healthy = res.ok
    const detail = healthy
      ? 'External provider answered a live /models probe.'
      : `External provider probe failed: HTTP ${res.status}.`
    return { healthy, checkedAt: new Date().toISOString(), latencyMs: Date.now() - t0, detail }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { healthy: false, checkedAt: new Date().toISOString(), latencyMs: Date.now() - t0, detail: `Probe failed: ${message.slice(0, 200)}` }
  }
}
