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
  healthFailureCategory,
  noteUpstream429,
  noteUpstreamSkip,
  noteUpstreamSuccess,
  upstreamBreakerState,
  upstreamCoolingDown,
  UpstreamAuthError,
  UpstreamBillingError,
  UpstreamRateLimitError,
} from '@/lib/upstream/gateway'
import { lastRealAttempt, noteRealAttempt, recentUpstreamFailure, UPSTREAM_FAILURE_CATEGORIES } from './last-attempts'
import { persistedAttempt } from './persisted-attempts'
import { gatewayConfig, probeGatewayReachability } from './gateway-reachability'
import { streamConfig } from '@/lib/riishe/stream-config'

/**
 * Typed truncation: the provider finished the stream with
 * `finish_reason: "length"` — the answer was cut at the provider's output
 * limit. This is NOT a normal completion (treating it as one shipped
 * mid-JSON answers labeled complete) and NOT a stall; it is its own honest
 * class so the stream surfaces as an incomplete generation.
 */
export class UpstreamTruncatedError extends Error {
  /** The text the provider produced before the cap cut it off (null when the
   *  caller already consumed the partial deltas itself). Continuation logic
   *  uses it so a length-capped answer is continued, not discarded. */
  readonly partialText: string | null
  constructor(message = 'upstream truncated the response at its output length limit (finish_reason: length)', partialText: string | null = null) {
    super(message)
    this.name = 'UpstreamTruncatedError'
    this.partialText = partialText
  }
}

const BACKEND_ID = 'bean-llm-hosted-primary'

/**
 * Parse raw SSE byte chunks from the gateway into text deltas.
 *
 * STALL GUARD (2026-11-01 streaming-reliability fix): the authorized SDK's
 * stream exposes no AbortSignal, so a gateway that stops sending tokens
 * mid-generation would previously hang the turn (and its SSE connection)
 * FOREVER — the client watchdog/server heartbeat cannot distinguish a slow
 * model from a dead one. The generator now bounds the SILENCE between
 * tokens: if no chunk arrives within `idleTimeoutMs`, the iterator is
 * released (best-effort — SDK limitation, same class as withTimeout) and a
 * labeled error propagates ("... timed out ..." so classifyUpstreamError
 * maps it to the honest timeout class). While tokens ARE flowing, no idle
 * limit applies — a long legitimate answer is never cut short by this guard.
 *
 * TOTAL DURATION GUARD (2026-11-03 reliability work order): an independent
 * wall-clock cap bounds the WHOLE stream so a pathological slow-drip upstream
 * cannot hold a turn (and its connection slot) forever while technically
 * never going idle. Default 10 minutes — far beyond any legitimate turn on
 * this platform — configurable via RIISHE_STREAM_MAX_DURATION_MS (0 = off).
 * Firing it is a LABELED timeout error, never a fake completion.
 *
 * FINAL FLUSH (2026-11-03): when the upstream closes, any residual buffered
 * line (a final `data:` frame without a trailing blank line) and any pending
 * streaming-decoder bytes were previously DISCARDED. Both are now processed
 * before the generator returns, so the last token of a response is never
 * dropped.
 *
 * Both timeouts are configurable (RIISHE_STREAM_IDLE_TIMEOUT_MS /
 * RIISHE_STREAM_MAX_DURATION_MS) via stream-config; defaults reproduce the
 * previously verified behavior. Explicit opts still win (callers/tests).
 */
export const UPSTREAM_STREAM_IDLE_TIMEOUT_MS = 120_000

export interface SseDeltaOptions {
  idleTimeoutMs?: number
  /** Total wall-clock cap for the whole stream; 0 disables. */
  maxDurationMs?: number
}

/**
 * Decode one upstream chunk to text without corrupting multibyte characters.
 * The SDK resolves each iterator step with a Web ReadableStream chunk —
 * normally a Uint8Array of raw SSE bytes, but the guard accepts the other
 * shapes too (Buffer is a Uint8Array subclass; a plain string chunk is used
 * as-is; anything else is treated as a byte-like record, the shape the
 * previous implementation assumed).
 *
 * DECODER FIX (measured defect class): the previous implementation called
 * `Buffer.from(bytes).toString('utf8')` PER CHUNK — a UTF-8 character split
 * across two network chunks (routine for Tamil/CJK output on a fast stream)
 * decoded as U+FFFD replacement garbage in the persisted answer. The decode
 * is now STREAMING (`decode(value, {stream:true})` + final flush), so split
 * characters reassemble exactly.
 */
function makeChunkDecoder(): (chunk: unknown) => string {
  const decoder = new TextDecoder('utf-8')
  return (chunk: unknown): string => {
    if (typeof chunk === 'string') return chunk
    if (chunk instanceof Uint8Array) return decoder.decode(chunk, { stream: true })
    try {
      return decoder.decode(Buffer.from(Object.values(chunk as Record<string, number>)), { stream: true })
    } catch {
      return ''
    }
  }
}

export async function* sseDeltas(
  stream: AsyncIterable<unknown>,
  opts: SseDeltaOptions = {},
): AsyncGenerator<string, void, unknown> {
  const cfg = streamConfig()
  const idleTimeoutMs = opts.idleTimeoutMs ?? cfg.streamIdleTimeoutMs
  const maxDurationMs = opts.maxDurationMs ?? cfg.streamMaxDurationMs
  const startedAt = Date.now()
  const iterator = stream[Symbol.asyncIterator]()
  const decodeChunk = makeChunkDecoder()
  let buffer = ''
  // Set when the provider reports finish_reason "length" (output cap hit):
  // the stream still ends normally, so the flag is raised into a typed
  // truncation error AFTER the loop — the caller must never see this as a
  // complete answer.
  let truncated = false
  let doneSentinel = false
  /** Process one complete SSE line (shared by the loop and the final flush).
   *  Returns the line's content delta (if any) and whether the [DONE]
   *  sentinel was seen. NOT a generator — the callers yield on its behalf. */
  const processLine = (rawLine: string): { delta: string | null; done: boolean } => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    // Spec: the space after "data:" is optional ("data:{...}" is legal).
    const payload = line.startsWith('data:')
      ? (line.startsWith('data: ') ? line.slice(6) : line.slice(5))
      : null
    if (payload === null) return { delta: null, done: false }
    if (payload.trim() === '[DONE]') return { delta: null, done: true }
    let delta: string | null = null
    try {
      const json = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
      }
      const choice = json.choices?.[0]
      const content: string | undefined = choice?.delta?.content
      if (choice?.finish_reason === 'length') truncated = true
      if (typeof content === 'string' && content.length > 0) delta = content
    } catch {
      // partial JSON across chunk boundary — carried in buffer
    }
    return { delta, done: false }
  }
  try {
    while (true) {
      let stallTimer: ReturnType<typeof setTimeout> | undefined
      let totalTimer: ReturnType<typeof setTimeout> | undefined
      const next = await Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          stallTimer = setTimeout(
            () => reject(new Error(`upstream stream timed out: no tokens received for ${idleTimeoutMs}ms`)),
            idleTimeoutMs,
          )
        }),
        // Total wall-clock backstop — only when enabled (maxDurationMs > 0).
        ...(maxDurationMs > 0
          ? [
              new Promise<never>((_, reject) => {
                totalTimer = setTimeout(
                  () =>
                    reject(
                      new Error(
                        `upstream stream timed out: total stream duration exceeded ${maxDurationMs}ms`,
                      ),
                    ),
                  Math.max(0, maxDurationMs - (Date.now() - startedAt)),
                )
              }),
            ]
          : []),
      ]).finally(() => {
        clearTimeout(stallTimer)
        clearTimeout(totalTimer)
      })
      if (next.done) break
      buffer += decodeChunk(next.value)
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const parsed = processLine(rawLine)
        if (parsed.delta !== null) yield parsed.delta
        if (parsed.done) {
          doneSentinel = true
          break
        }
      }
      if (doneSentinel) break
    }
    // FINAL FLUSH: the generator is ending — process whatever the writer
    // sent without a trailing blank line, plus the decoder's pending bytes
    // (a UTF-8 character split exactly at stream end), in that order.
    if (!doneSentinel) {
      buffer += decodeChunk('')
      if (buffer.length > 0) {
        const parsed = processLine(buffer)
        if (parsed.delta !== null) yield parsed.delta
        if (parsed.done) doneSentinel = true
      }
      buffer = ''
    }
    if (truncated) throw new UpstreamTruncatedError()
  } finally {
    // Best-effort upstream cleanup (SDK exposes no AbortSignal — the
    // abandoned request may run until the provider's own deadline; recorded
    // platform limitation, unchanged from withTimeout's contract).
    try {
      await iterator.return?.()
    } catch {
      /* cleanup is best-effort */
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
 * Output-token ceiling for RIISHE chat calls. ONLY applied when the operator
 * sets RIISHE_MAX_OUTPUT_TOKENS; unset means the provider's own default
 * applies and BEAN sends no cap at all (never a silent server-side limit).
 * The provider reports hitting the ceiling via finish_reason "length", which
 * both the streaming and non-streaming paths surface as the typed
 * UpstreamTruncatedError — an explicitly identified truncation, never a
 * silent cut and never a fake timeout.
 */
function outputTokenFields(): { max_tokens?: number } {
  const configured = streamConfig().maxOutputTokens
  return configured !== null ? { max_tokens: configured } : {}
}

/**
 * CHAT-RECOVERY (2026-11-10): record every REAL chat-class attempt (success
 * and upstream failure alike — never breaker skips, which make no network
 * call) as health evidence. The quota-free health probe reads this instead
 * of firing its own completion; the record's freshness rules (15 min for
 * failures) live in last-attempts.ts. Truncation (finish_reason "length")
 * records as ok:true from this boundary's vantage: the gateway answered and
 * tokens flowed; the output cap is application-level continuation work.
 */
function recordChatAttempt(ok: boolean, failure: ReturnType<typeof classifyUpstreamError> | null): void {
  const category = ok || !failure ? null : healthFailureCategory(failure.kind)
  noteRealAttempt('chat-completion', {
    at: new Date().toISOString(),
    ok,
    backendId: BACKEND_ID,
    failureCategory: category,
    httpStatus: ok || !failure ? null : failure.status,
    upstream: ok || !failure ? false : category !== null && UPSTREAM_FAILURE_CATEGORIES.has(category),
  })
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
    const result = await zai.chat.completions.create(body as never)
    // PHASE 1 bounded backoff: a real success resets the consecutive-429
    // streak so the next throttle starts from the base window again.
    noteUpstreamSuccess('chat')
    recordChatAttempt(true, null)
    return result
  } catch (e) {
    const failure = classifyUpstreamError(e)
    const raw = e instanceof Error ? e.message : String(e)
    if (failure.kind === 'rate_limited') {
      noteUpstream429('chat')
      recordChatAttempt(false, failure)
      throw new UpstreamRateLimitError('chat', `chat completion is rate-limited upstream (HTTP 429): ${raw.slice(0, 200)}`)
    }
    if (failure.kind === 'auth') {
      recordChatAttempt(false, failure)
      throw new UpstreamAuthError(`chat completion failed: gateway rejected credentials (HTTP ${failure.status}): ${raw.slice(0, 200)}`, failure.status ?? 401)
    }
    if (failure.kind === 'billing') {
      recordChatAttempt(false, failure)
      throw new UpstreamBillingError(`chat completion failed: gateway refused for account reasons (HTTP ${failure.status}): ${raw.slice(0, 200)}`, failure.status ?? 402)
    }
    recordChatAttempt(false, failure)
    throw e
  }
}

/**
 * CHAT-RECOVERY (2026-11-10): the ONE guarded entry point for chat-class
 * completions outside this adapter. RIISHE's research/verify pipeline had
 * FOUR raw zai.chat.completions.create call sites (search-query generation,
 * semantic freshness routing, claims verification, cross-lingual query
 * expansion) that bypassed the chat-class 429 breaker entirely — each one
 * kept firing real completions into an actively throttling gateway, deepening
 * the throttle and burning uncounted quota. This wrapper gives those callers
 * the SAME contract as every other chat-class call: fail fast (typed, no
 * network) while the breaker is open, record observed 429s into the breaker,
 * and record real-attempt evidence for the health payload. Every caller
 * already owns an honest fallback for a thrown error (raw-question search,
 * deterministic routing, degraded claims audit, dropped variant), so a
 * breaker skip degrades the specific sub-step — it never fakes success.
 */
export async function guardedChatCompletion(body: unknown): Promise<unknown> {
  const zai = await ZAI.create()
  return createWithGatewayGuard(zai, body)
}

export const hostedLlmAdapter: TaskAdapter = {
  backendId: BACKEND_ID,

  /**
   * QUOTA-FREE health probe (CHAT-RECOVERY, 2026-11-10).
   *
   * The previous probe fired a REAL chat completion ("Reply with exactly:
   * OK") per fresh poll. Measured consequences (docs/reports/
   * RIISHE-CHAT-RECOVERY.md): the dashboard's 45s health refresh fired
   * 2 completions + 1 web_search concurrently against the provider's
   * authoritative 2-QPS limit, tripped it, and the resulting 429 re-opened
   * the chat breaker every refresh — chat rendered "rate-limited" for hours
   * while the account itself was serving (single spaced requests: HTTP 200,
   * 134/300 daily remaining measured 02:19Z). Health monitoring was BOTH
   * burning customer inference quota AND sustaining the outage it reported.
   *
   * The probe now fires ZERO metered requests. Its evidence, in order:
   *  1. CONFIG — the gateway client resolves with baseUrl/apiKey present;
   *  2. REACHABILITY — a free GET on the gateway's /models metadata path
   *     (measured: HTTP 404 from the gateway's router, NO rate-limit
   *     headers = not metered) proves the configured host answers;
   *  3. BREAKER — an open chat-class breaker (a real 429 was observed) is
   *     reported as rate-limited; recovery stays verified call-by-call by
   *     REAL traffic, never assumed;
   *  4. REAL-ATTEMPT EVIDENCE — the most recent actual chat completion
   *     (recorded by createWithGatewayGuard, in-memory + persisted
   *     UsageRecord so the evidence survives a restart). A fresh upstream
   *     failure keeps the status honest; a real success backs "healthy";
   *     with no evidence yet, the report says exactly what its status is
   *     based on. Nothing is ever presented as a completion probe.
   */
  async health(): Promise<HealthReport> {
    const checkedAt = new Date().toISOString()
    // 1. CONFIG (no network) — the gateway client must resolve with real
    // coordinates, mirroring the image/video adapters' config gate.
    let zai: unknown
    try {
      zai = await ZAI.create()
    } catch (e) {
      return {
        healthy: false,
        checkedAt,
        latencyMs: null,
        httpStatus: null,
        failureCategory: 'misconfigured',
        detail: `Misconfigured: the gateway client failed to initialize (${e instanceof Error ? e.message : String(e)}). No probe request was made.`,
      }
    }
    const cfg = gatewayConfig(zai)
    if (!cfg.baseUrl || !cfg.apiKey) {
      return {
        healthy: false,
        checkedAt,
        latencyMs: null,
        httpStatus: null,
        failureCategory: 'misconfigured',
        detail:
          'Misconfigured: gateway client initialized but its config is missing baseUrl/apiKey, so the chat endpoint cannot be reached. No probe request was made.',
      }
    }
    // 2. REACHABILITY — free, unmetered (router-layer 404, no rate-limit
    // headers). The measured latency IS a real network measurement.
    const reach = await probeGatewayReachability(cfg.baseUrl, cfg.apiKey)
    if (!reach.reachable) {
      return {
        healthy: false,
        checkedAt,
        latencyMs: reach.latencyMs,
        httpStatus: null,
        failureCategory: reach.error?.startsWith('no response within') ? 'timeout' : 'unreachable',
        detail: `Chat backend UNREACHABLE: the configured gateway host answered no request (${reach.error}). Client config is present, so this is a network/upstream problem, not a configuration gap. No completion was fired (health never consumes inference quota).`,
      }
    }
    if (reach.redirected) {
      return {
        healthy: false,
        checkedAt,
        latencyMs: reach.latencyMs,
        httpStatus: reach.status,
        failureCategory: 'network',
        detail: `Gateway host redirected the health request (HTTP ${reach.status}); the answer did not come from the configured gateway's own surface. No completion was fired.`,
      }
    }
    // 3. BREAKER — a real 429 was observed recently; every chat-class call
    // (including any health-driven work) would fail fast right now.
    const breaker = upstreamBreakerState('chat')
    if (breaker.coolingDown && breaker.last429At) {
      return {
        healthy: false,
        checkedAt,
        latencyMs: reach.latencyMs,
        httpStatus: 429,
        failureCategory: 'rate-limited',
        detail: `Upstream gateway rate-limited (HTTP 429 observed ${breaker.last429At}; chat-class breaker open for ${Math.round(breaker.remainingMs / 1000)}s, ${breaker.skippedCalls} call(s) skipped so far). No completion was fired — recovery is verified by the next REAL chat call, never by a probe request.`,
      }
    }
    // 4. REAL-ATTEMPT EVIDENCE from actual traffic (this process first — a
    // fresh failure here is the newest truth — then the persisted chat rows).
    const freshFailure = recentUpstreamFailure('chat-completion')
    if (freshFailure) {
      return {
        healthy: false,
        checkedAt,
        latencyMs: reach.latencyMs,
        httpStatus: freshFailure.httpStatus,
        failureCategory: freshFailure.failureCategory,
        detail: `The most recent REAL chat completion failed upstream (${freshFailure.failureCategory}, at ${freshFailure.at}). Gateway host reachable. No completion was fired by this probe.`,
      }
    }
    const inMem = lastRealAttempt('chat-completion')
    if (inMem?.ok) {
      return {
        healthy: true,
        checkedAt,
        latencyMs: reach.latencyMs,
        httpStatus: null,
        failureCategory: null,
        detail: `Gateway host reachable (free liveness check, HTTP ${reach.status}); the most recent REAL chat completion succeeded at ${inMem.at}. No completion was fired by this probe (health never consumes inference quota).`,
      }
    }
    const persisted = await persistedAttempt('chat-completion')
    if (persisted) {
      if (persisted.ok) {
        return {
          healthy: true,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: null,
          failureCategory: null,
          detail: `Gateway host reachable (free liveness check, HTTP ${reach.status}); persisted chat evidence: a REAL completion succeeded at ${persisted.at}. No completion was fired by this probe (health never consumes inference quota).`,
        }
      }
      // Persisted FAILURE (upstream-class only — the mapping in
      // persisted-attempts.ts) still fresh enough to matter.
      if (
        persisted.failureCategory &&
        UPSTREAM_FAILURE_CATEGORIES.has(persisted.failureCategory) &&
        Date.now() - Date.parse(persisted.at) <= 15 * 60_000
      ) {
        return {
          healthy: false,
          checkedAt,
          latencyMs: reach.latencyMs,
          httpStatus: persisted.httpStatus,
          failureCategory: persisted.failureCategory,
          detail: `Persisted chat evidence: the most recent REAL completion failed upstream (${persisted.failureCategory}, at ${persisted.at}). Gateway host reachable. No completion was fired by this probe.`,
        }
      }
    }
    // 5. No attempt evidence yet (fresh process, quiet traffic). The status
    // says exactly what backs it: reachability + config. Honest, no probe
    // completion is invented to fill the gap.
    return {
      healthy: true,
      checkedAt,
      latencyMs: reach.latencyMs,
      httpStatus: null,
      failureCategory: null,
      detail: `Gateway host reachable (free liveness check, HTTP ${reach.status}) and configuration valid; no real chat attempt evidence yet in this process. Status is from reachability + config ONLY — no completion was fired (health never consumes inference quota).`,
    }
  },

  async chat(req: ChatRequest): Promise<ChatResult> {
    const t0 = Date.now()
    const zai = await ZAI.create()
    const completion = (await createWithGatewayGuard(zai, {
      messages: buildMessages(req),
      thinking: { type: req.thinkingEnabled ? 'enabled' : 'disabled' },
      ...outputTokenFields(),
    })) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>
    }
    const choice = completion.choices?.[0]
    const content = choice?.message?.content ?? ''
    // Non-streaming truncation is detected EXACTLY like the streaming one:
    // finish_reason "length" is its own honest class (never a silent short
    // answer, never a generic failure). The truncated text rides on the
    // error so continuation logic can resume instead of discarding it.
    if (choice?.finish_reason === 'length') {
      throw new UpstreamTruncatedError(
        'upstream truncated the response at its output length limit (finish_reason: length)',
        content,
      )
    }
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
      ...outputTokenFields(),
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
