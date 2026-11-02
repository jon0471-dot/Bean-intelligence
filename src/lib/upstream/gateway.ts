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

export type UpstreamEndpointClass = 'functions' | 'chat'

export type UpstreamFailureKind = 'rate_limited' | 'auth' | 'billing' | 'timeout' | 'truncated' | 'other'

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
 */
export function classifyUpstreamError(e: unknown): UpstreamFailure {
  if (e instanceof UpstreamRateLimitError) return { kind: 'rate_limited', status: 429 }
  if (e instanceof UpstreamAuthError) return { kind: 'auth', status: e.status }
  if (e instanceof UpstreamBillingError) return { kind: 'billing', status: e.status }
  const message = e instanceof Error ? e.message : String(e)
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
  return { kind: 'other', status }
}

/** Typed upstream failures the rest of the code can branch on. */
export class UpstreamRateLimitError extends Error {
  readonly endpointClass: UpstreamEndpointClass
  readonly attempted: boolean
  constructor(endpointClass: UpstreamEndpointClass, message: string, attempted = true) {
    super(message)
    this.name = 'UpstreamRateLimitError'
    this.endpointClass = endpointClass
    this.attempted = attempted
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

interface CooldownState {
  until: number
  /** How many calls were skipped (failed fast) while the breaker was open. */
  skipped: number
  /** Last observed 429 (for honest logging). */
  last429At: number | null
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
    s = { until: 0, skipped: 0, last429At: null }
    store.set(cls, s)
  }
  return s
}

/** Register an observed upstream 429: (re)open the cooldown window. */
export function noteUpstream429(cls: UpstreamEndpointClass, now = Date.now()): void {
  const s = stateFor(cls)
  s.until = now + UPSTREAM_429_COOLDOWN_MS
  s.last429At = now
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
          'The text received so far is preserved as incomplete — asking RIISHE to continue usually completes it.',
        code: 'UPSTREAM_TRUNCATED',
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
