/**
 * BEAN Intelligence — upstream gateway boundary (shared).
 *
 * The authorized upstream (z-ai-web-dev-sdk -> https://internal-api.z.ai/v1,
 * credentials from /etc/.z-ai-config) serves two endpoint classes that the
 * gateway rate-limits SEPARATELY (measured 2026-10-29: function invocations
 * 429'd while chat completions still succeeded, then both):
 *   - 'functions' : web_search / page_reader  (POST /v1/functions/invoke)
 *   - 'chat'      : chat completions          (POST /v1/chat/completions)
 *
 * Measured upstream 429 behavior (server logs + spaced single probes):
 *   - body: {"error":"Too many requests, please try again later"} — generic
 *     throttle wording; NO quota/billing specifics and NO Retry-After header
 *     (the SDK discards response headers and throws `status NNN: <body>`).
 *   - the throttle window is LONG: single spaced requests still got 429 more
 *     than six minutes after the last burst, so treating a 429 as a
 *     transient blip and retrying into it only deepens the throttle.
 *
 * What this module provides:
 *   1. classifyUpstreamError — parse the status the SDK embeds in its error
 *      message into an honest failure class (rate_limited / auth / billing /
 *      timeout / other).
 *   2. A per-endpoint-class 429 cooldown (circuit breaker): the FIRST 429
 *      opens a short cooldown; while it is open, further upstream calls of
 *      that class fail fast WITHOUT touching the network, so a throttling
 *      gateway sees at most ~one probe per cooldown window instead of a
 *      per-turn fan-out. Every observed 429 extends the window (sliding).
 *      This is NOT error suppression: the typed error propagates, degrades
 *      honestly, and the user sees the real reason.
 *
 * Honesty contract: no fabricated reset times. The provider does not tell us
 * its window; the cooldown is BEAN's own conservative backoff, and expiry is
 * verified by a real probe call, never assumed.
 */

import type { HealthFailureCategory } from '../adapters/types'

/**
 * Endpoint classes the gateway rate-limits separately (measured 2026-10-29:
 * functions 429'd while chat still succeeded, then both). PHASE 1 (2026-11-04
 * AI-GATEWAY-RECOVERY): the SDK's capability surface also serves images,
 * video (async jobs) and audio on the same account — each gets its own class
 * so one class's throttle can never fail-fast another class's traffic.
 *
 * PROVIDER RESILIENCE (2026-11-07): 'chat-fallback' is the SAME capability
 * class on a DIFFERENT authorized provider (the prepared OpenAI-compatible
 * fallback). It must never share breaker state with 'chat' — a throttle on
 * the primary gateway would otherwise fail-fast the fallback before it ever
 * got a chance to serve, defeating provider independence.
 */
export type UpstreamEndpointClass =
  | 'functions'
  | 'chat'
  | 'chat-fallback'
  | 'chat-llamacpp'
  | 'images'
  | 'video'
  | 'audio'

/**
 * MEASURED CHANGE (2026-11-04 connectivity audit): map an upstream failure
 * kind to the honest coarse category the health payload/dashboard renders.
 * One canonical mapping shared by the LLM, research and sandbox probes so
 * the same upstream failure always reports the same category.
 */
export function healthFailureCategory(kind: UpstreamFailureKind): HealthFailureCategory {
  switch (kind) {
    case 'rate_limited':
      return 'rate-limited'
    case 'auth':
      return 'auth'
    case 'billing':
      return 'billing'
    case 'timeout':
      return 'timeout'
    case 'network':
      return 'network'
    default:
      return 'backend-error'
  }
}

export type UpstreamFailureKind =
  | 'rate_limited'
  | 'auth'
  | 'billing'
  | 'timeout'
  | 'truncated'
  | 'network'
  | 'no_results'
  | 'other'

export interface UpstreamFailure {
  kind: UpstreamFailureKind
  /** HTTP status parsed from the SDK error message (null when absent). */
  status: number | null
}

/**
 * Classify an upstream failure. Typed BEAN errors are recognized by
 * instanceof first (their messages are human-facing, not parse targets);
 * raw SDK errors are parsed from the status they embed, which the SDK words
 * either as `status NNN: ...` or `HTTP NNN` in BEAN's own wrappers.
 *
 * INNER-STATUS FIX (2026-11-12, RIISHE live-research reliability — approved
 * minimal fix, measured live): the gateway wraps its OWN upstream failure in
 * an OUTER HTTP 500 whose body carries the real upstream signal, e.g.
 *   `Function invoke failed with status 500: {"error":"Search failed:
 *    request failed with status 429: {\"code\":429,...\"status\":42900}"}`.
 * The previous parser matched the FIRST `status NNN` — the outer 500 — so
 * wrapped 429s classified as generic 'other', the documented 429 fail-fast
 * + breaker path never engaged, and every query was retried once into the
 * same struggling upstream. The parser now ALSO extracts the INNER signal
 * (innermost `request failed with status NNN` + JSON `"status"`/`"code"`
 * fields) and prefers it. Mappings preserved unchanged for unwrapped
 * messages: 429 → rate_limited, 401/403 → auth, 402 → billing, truncation,
 * timeout wording and transport-network patterns all behave exactly as
 * before when no inner signal exists.
 */
export function classifyUpstreamError(e: unknown): UpstreamFailure {
  if (e instanceof UpstreamRateLimitError) return { kind: 'rate_limited', status: 429 }
  if (e instanceof UpstreamAuthError) return { kind: 'auth', status: e.status }
  if (e instanceof UpstreamBillingError) return { kind: 'billing', status: e.status }
  const message = e instanceof Error ? e.message : String(e)

  // ---- inner (wrapped) upstream signals ----------------------------------
  const innerStatuses: number[] = []
  for (const m of message.matchAll(/request failed with status (\d{3,5})/g)) {
    innerStatuses.push(Number(m[1]))
  }
  for (const m of message.matchAll(/"status"\s*:\s*"?(\d{3,5})"?/g)) {
    innerStatuses.push(Number(m[1]))
  }
  for (const m of message.matchAll(/"code"\s*:\s*"?(\d{3,5})"?/g)) {
    innerStatuses.push(Number(m[1]))
  }
  if (innerStatuses.length > 0) {
    const family = (n: number): number | null => {
      // The gateway's upstream codes are status*100 + subcode (42900, 42206):
      // a 429xx/422xx family means the inner HTTP status 429/422.
      if (n >= 100 && n <= 599) return n
      if (n >= 40000 && n <= 59999) return Math.floor(n / 100)
      return null
    }
    const families = innerStatuses.map(family).filter((v): v is number => v !== null)
    if (families.includes(429)) return { kind: 'rate_limited', status: 429 }
    // Authoritative zero-results: the gateway ANSWERED that the index has
    // nothing for the query (measured 2026-11-12: "No search results
    // available for query …" with inner 422/42206). This is NOT an outage —
    // a dedicated honest class so callers neither retry it nor record it as
    // provider unavailability.
    if (families.includes(422) && /no search results|zero results|no results available/i.test(message)) {
      return { kind: 'no_results', status: 422 }
    }
    if (families.includes(401) || families.includes(403)) return { kind: 'auth', status: families.includes(401) ? 401 : 403 }
    if (families.includes(402)) return { kind: 'billing', status: 402 }
    // A wrapped upstream TIMEOUT (the gateway's upstream stalled mid-read)
    // is its own honest class — distinct from a generic wrapped 5xx.
    const wrapped5xx = families.find((v) => v >= 500)
    if (wrapped5xx !== undefined && /read\s?timed?\s?out|readtimeout|timed?\s?out/i.test(message)) {
      return { kind: 'timeout', status: wrapped5xx }
    }
  }

  // ---- legacy outer-status parsing (behavior preserved verbatim) ----------
  const m = /(?:\bstatus\s+(\d{3})|\bHTTP\s+(\d{3}))/.exec(message)
  const status = m ? Number(m[1] ?? m[2]) : null
  if (status === 429) return { kind: 'rate_limited', status }
  if (status === 401 || status === 403) return { kind: 'auth', status }
  if (status === 402) return { kind: 'billing', status }
  // Typed provider truncation (finish_reason "length"): classified BEFORE the
  // generic timeout pattern so it can carry its own honest payload.
  if (/\blength limit\b|finish_reason:\s*length|\btruncated\b/i.test(message)) {
    return { kind: 'truncated', status: null }
  }
  if (status === null && /\btimed out\b/i.test(message)) return { kind: 'timeout', status: null }
  // Transport-level upstream death (2026-11-03): the SDK surfaces a dropped
  // connection as "fetch failed" / ECONNRESET / socket hang up. This is a
  // DIFFERENT honest class from a provider-reported error or a stall timeout:
  // the request reached the network and the network broke mid-flight.
  if (
    status === null &&
    /\bfetch failed\b|ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|network error|ERR_NETWORK/i.test(message)
  ) {
    return { kind: 'network', status: null }
  }
  return { kind: 'other', status }
}

/** Typed upstream failures the rest of the code can branch on. */
export class UpstreamRateLimitError extends Error {
  readonly endpointClass: UpstreamEndpointClass
  readonly attempted: boolean
  /** Retry-After in milliseconds when the provider actually surfaced one.
   *  MEASURED (2026-11-08, issues 1-2 repair): the z-ai gateway sends no
   *  Retry-After header and the SDK discards response headers entirely, so
   *  every current adapter constructs this error with null — the field
   *  exists so any future adapter that CAN read the header honors it
   *  instead of guessing a backoff. */
  readonly retryAfterMs: number | null
  constructor(endpointClass: UpstreamEndpointClass, message: string, attempted = true, retryAfterMs: number | null = null) {
    super(message)
    this.name = 'UpstreamRateLimitError'
    this.endpointClass = endpointClass
    this.attempted = attempted
    this.retryAfterMs = retryAfterMs
  }
}

export class UpstreamAuthError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'UpstreamAuthError'
    this.status = status
  }
}

export class UpstreamBillingError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'UpstreamBillingError'
    this.status = status
  }
}

// ---- 429 cooldown (circuit breaker), per endpoint class --------------------
// globalThis-keyed like the research cache, so Next.js route-bundle module
// duplication cannot fragment the breaker state.

const STORE_KEY = '__bean_upstream_cooldown__'

/** BEAN's own conservative backoff after an observed 429 (not a provider claim). */
export const UPSTREAM_429_COOLDOWN_MS = 60_000

/**
 * PHASE 1 bounded escalation (2026-11-04 AI-GATEWAY-RECOVERY): a throttle
 * window measured to last MINUTES must not be probed every 60s forever.
 * CONSECUTIVE 429s (no intervening success) double the cooldown up to a hard
 * 10-minute cap: 60s → 120s → 240s → 480s → 600s → 600s … Any REAL success
 * resets the streak to the base window. Bounded in both directions: never a
 * tighter-than-60s probe into a throttle, never an unbounded retry loop.
 */
export const UPSTREAM_429_COOLDOWN_MAX_MS = 600_000

/** Escalated cooldown for a streak of consecutive 429s (streak >= 1). */
export function escalated429CooldownMs(streak: number): number {
  const n = Math.max(1, Math.floor(streak))
  return Math.min(UPSTREAM_429_COOLDOWN_MS * 2 ** (n - 1), UPSTREAM_429_COOLDOWN_MAX_MS)
}

/**
 * Bounds for a PROVIDER-SUPPLIED retry hint (Retry-After / x-ratelimit-reset).
 * ZERO-DOWNTIME RECOVERY (2026-11-11): when an adapter CAN read response
 * headers (the direct-fetch fallback lane) and the provider actually sends a
 * hint, BEAN respects it instead of guessing — clamped to these bounds so an
 * absurd or malicious value can neither spam the provider (too short) nor
 * wedge a product for hours (too long). The z-ai gateway sends no Retry-After
 * and the managed SDK discards headers entirely (measured), so today only the
 * OpenAI-compatible fallback lane can supply this.
 */
export const PROVIDER_RETRY_AFTER_MIN_MS = 5_000
export const PROVIDER_RETRY_AFTER_MAX_MS = UPSTREAM_429_COOLDOWN_MAX_MS

export function clampProviderRetryAfterMs(ms: number | null): number | null {
  if (ms === null || !Number.isFinite(ms)) return null
  if (ms <= 0) return null
  return Math.min(Math.max(Math.round(ms), PROVIDER_RETRY_AFTER_MIN_MS), PROVIDER_RETRY_AFTER_MAX_MS)
}

/**
 * Parse a provider's retry hint from response headers (pure — header object
 * only, no network). Honors, in precedence order:
 *  1. `retry-after`  — delta-seconds OR an HTTP-date;
 *  2. `x-ratelimit-reset` — epoch SECONDS or MILLISECONDS (whichever parses
 *     into a sane timestamp).
 * Returns the hint in milliseconds from `now`, or null when absent or
 * unparseable. NEVER invented: absent headers return null and the caller
 * keeps BEAN's own conservative backoff.
 */
export function parseRetryAfterHeaders(
  headers: { get(name: string): string | null },
  now = Date.now(),
): number | null {
  const ra = headers.get('retry-after')
  if (ra) {
    const trimmed = ra.trim()
    if (/^\d+$/.test(trimmed)) {
      const seconds = Number(trimmed)
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
    } else {
      const at = Date.parse(trimmed)
      if (Number.isFinite(at)) return Math.max(0, at - now)
    }
  }
  const reset = headers.get('x-ratelimit-reset')
  if (reset) {
    const trimmed = reset.trim()
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed)
      // Epoch seconds stay < 1e12 until the year ~33k; epoch ms is >= 1e12.
      const epochMs = n >= 1e12 ? n : n * 1_000
      if (Number.isFinite(epochMs)) return Math.max(0, epochMs - now)
    }
  }
  return null
}

interface CooldownState {
  until: number
  /** How many calls were skipped (failed fast) while the breaker was open. */
  skipped: number
  /** Last observed 429 (for honest logging). */
  last429At: number | null
  /** Consecutive observed 429s without an intervening real success. */
  streak: number
  /** Cooldown that the most recent 429 opened (for honest reporting). */
  lastCooldownMs: number
}

function cooldownStore(): Map<UpstreamEndpointClass, CooldownState> {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[STORE_KEY]) g[STORE_KEY] = new Map()
  return g[STORE_KEY] as Map<UpstreamEndpointClass, CooldownState>
}

function stateFor(cls: UpstreamEndpointClass): CooldownState {
  const store = cooldownStore()
  let s = store.get(cls)
  if (!s) {
    s = { until: 0, skipped: 0, last429At: null, streak: 0, lastCooldownMs: UPSTREAM_429_COOLDOWN_MS }
    store.set(cls, s)
  }
  return s
}

/** Register an observed upstream 429: (re)open the cooldown window with the
 *  escalated duration for the current consecutive-429 streak. ZERO-DOWNTIME
 *  RECOVERY (2026-11-11): when the provider actually surfaced a retry hint
 *  (parsed from headers by parseRetryAfterHeaders — only the direct-fetch
 *  fallback lane can see headers today; the managed SDK discards them), the
 *  clamped hint RESPECTS the provider's own window instead of BEAN's guess. */
export function noteUpstream429(
  cls: UpstreamEndpointClass,
  now = Date.now(),
  providerRetryAfterMs: number | null = null,
): void {
  const s = stateFor(cls)
  s.streak += 1
  s.lastCooldownMs = escalated429CooldownMs(s.streak)
  const hinted = clampProviderRetryAfterMs(providerRetryAfterMs)
  if (hinted !== null) s.lastCooldownMs = hinted
  s.until = now + s.lastCooldownMs
  s.last429At = now
}

/**
 * Register a REAL success through this endpoint class: the streak resets so
 * the next 429 starts again from the base window. Recovery is still verified
 * call-by-call — a success never pre-clears an open cooldown; it only proves
 * the throttle let one request through (which is exactly what a success is).
 */
export function noteUpstreamSuccess(cls: UpstreamEndpointClass): void {
  stateFor(cls).streak = 0
}

/** Structured breaker state for health payloads and operator reports. */
export function upstreamBreakerState(cls: UpstreamEndpointClass, now = Date.now()): {
  coolingDown: boolean
  remainingMs: number
  consecutive429s: number
  currentCooldownMs: number
  last429At: string | null
  skippedCalls: number
} {
  const s = stateFor(cls)
  return {
    coolingDown: s.until > now,
    remainingMs: Math.max(0, s.until - now),
    consecutive429s: s.streak,
    currentCooldownMs: s.lastCooldownMs,
    last429At: s.last429At !== null ? new Date(s.last429At).toISOString() : null,
    skippedCalls: s.skipped,
  }
}

/** True while the breaker is open for this endpoint class. */
export function upstreamCoolingDown(cls: UpstreamEndpointClass, now = Date.now()): boolean {
  return stateFor(cls).until > now
}

export function upstreamCooldownRemainingMs(cls: UpstreamEndpointClass, now = Date.now()): number {
  return Math.max(0, stateFor(cls).until - now)
}

/** Count a call skipped by the open breaker (for honest degraded notes). */
export function noteUpstreamSkip(cls: UpstreamEndpointClass): void {
  stateFor(cls).skipped += 1
}

export function upstreamSkippedCalls(cls: UpstreamEndpointClass): number {
  return stateFor(cls).skipped
}

/** Test hook: clear all breaker state (cooldown is process-global). */
export function _resetUpstreamCooldownForTests(): void {
  cooldownStore().clear()
}

/**
 * Build the customer-facing SSE error payload for a failed stream, with the
 * failure class the EVIDENCE supports. Never claims a reset time (the
 * provider does not send one); auth/billing say plainly that retrying will
 * not help, because that distinction is visible in the upstream status.
 */
export function upstreamStreamErrorPayload(e: unknown): {
  error: string
  code: string
  partial: true
} {
  const kind = classifyUpstreamError(e)
  switch (kind.kind) {
    case 'rate_limited':
      return {
        error:
          'The upstream AI gateway is rate-limited right now (HTTP 429). This usually clears within a few minutes — ' +
          'your question is kept below, so you can retry without retyping it.',
        code: 'UPSTREAM_RATE_LIMITED',
        partial: true,
      }
    case 'auth':
      return {
        error: `The upstream gateway rejected the configured credentials (HTTP ${kind.status}). This needs an operator to fix the gateway configuration — retrying will not change it.`,
        code: 'UPSTREAM_AUTH',
        partial: true,
      }
    case 'billing':
      return {
        error: `The upstream gateway refused the request for account reasons (HTTP ${kind.status}). This needs an account/billing action — retrying will not change it.`,
        code: 'UPSTREAM_BILLING',
        partial: true,
      }
    case 'timeout':
      // Provider accepted the request but stopped producing tokens (stream
      // stall / deadline). Honest category: distinct from a generic failure.
      return {
        error:
          'The AI provider stopped sending data before the response finished (stream timed out). ' +
          'The text received so far is preserved as incomplete — try again in a moment.',
        code: 'UPSTREAM_TIMEOUT',
        partial: true,
      }
    case 'truncated':
      // Provider hit its output length limit mid-answer. Honest category:
      // the text IS the provider's output, just not the whole answer.
      return {
        error:
          'The AI provider reached its output length limit before the answer finished. ' +
          'The text received so far is preserved as incomplete — asking to continue usually completes it.',
        code: 'UPSTREAM_TRUNCATED',
        partial: true,
      }
    case 'network':
      // The upstream connection itself died mid-request (transport reset),
      // NOT a model error and NOT a timeout stall. Honest category so the UI
      // never shows a provider answer problem for a broken pipe.
      return {
        error:
          'The connection to the AI provider was lost before the answer finished. ' +
          'The text received so far is preserved as incomplete — retrying usually completes it.',
        code: 'UPSTREAM_NETWORK',
        partial: true,
      }
    default:
      return {
        error: 'The response stream failed before completion. Partial text is labeled as incomplete.',
        code: 'BACKEND_FAILURE',
        partial: true,
      }
  }
}

/** BeanApiError-compatible code for a typed upstream failure (JSON path). */
export function upstreamErrorCode(e: unknown): 'RATE_LIMITED' | 'BACKEND_FAILURE' {
  return classifyUpstreamError(e).kind === 'rate_limited' ? 'RATE_LIMITED' : 'BACKEND_FAILURE'
}
