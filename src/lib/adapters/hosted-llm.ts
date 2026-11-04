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
  upstreamCoolingDown,
  UpstreamAuthError,
  UpstreamBillingError,
  UpstreamRateLimitError,
} from '@/lib/upstream/gateway'
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
    return result
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
        // The managed SDK does not expose the HTTP status of a successful
        // completion; recording a guessed status would violate the honesty
        // contract, so it stays null on success.
        httpStatus: null,
        failureCategory: healthy ? null : 'backend-error',
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
        // Structured failure class + observed HTTP status (when the error
        // carried one): the dashboard renders WHY the product is down from
        // these fields instead of parsing the free-text detail.
        httpStatus: failure.status,
        failureCategory: healthFailureCategory(failure.kind),
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
