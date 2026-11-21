/**
 * BEAN Intelligence — honest retry-hint derivation for rate-limited badges
 * (SHARED-RATE-LIMIT REPAIR, 2026-11-14, defect D3).
 *
 * Measured gap: /api/health already exposes per-endpoint-class breaker state
 * (remainingMs / consecutive429s), and the admin page renders it, but the
 * main dashboard's "Rate limited" badge showed no retry timing — a transient
 * throttle looked open-ended to users. This module derives the badge hint
 * from the payload's MEASURED breaker state and nothing else:
 *  - the LONGEST remaining cooldown among currently-cooling classes is the
 *    truthful "retry within" bound (the throttle clears class by class; the
 *    longest open breaker is the binding one);
 *  - NO cooling class -> null — the caller omits the hint entirely
 *    (never invented, never fabricated from the 429 count alone).
 *
 * Pure and dependency-free so both the client dashboard and tests consume it
 * without importing React. Values are display hints, not guarantees: the
 * breaker cooldown is BEAN's own conservative backoff (documented in
 * upstream/gateway.ts), and real recovery is verified call-by-call.
 */

/** Minimal structural subset of the health payload's gateway.breaker block. */
export interface BreakerClassState {
  class: string
  coolingDown: boolean
  remainingMs: number
  consecutive429s: number
  last429At: string | null
}

export interface RetryHintPayload {
  gateway?: {
    breaker?: {
      classes?: BreakerClassState[]
    }
  }
}

export function rateLimitRetryHint(health: RetryHintPayload | null | undefined): string | null {
  const classes =
    health?.gateway?.breaker?.classes?.filter((c) => c.coolingDown && c.remainingMs > 0) ?? []
  if (classes.length === 0) return null
  const maxSec = Math.ceil(Math.max(...classes.map((c) => c.remainingMs)) / 1000)
  const timing = maxSec >= 90 ? `retry within ~${Math.round(maxSec / 60)} min` : `retry within ~${maxSec}s`
  // SHARED-RATE-LIMIT REPAIR (2026-11-14, prolonged-refusal visibility): the
  // provider's 429 body carries no quota/reset specifics and no readable
  // headers, so BEAN cannot honestly distinguish a long throttle window from
  // a daily-quota exhaustion. What IS measured is the consecutive-refusal
  // streak — shown so an unusually persistent refusal (the 2026-11-14 window
  // ran 95+ minutes across 8+ spaced probes) is visible without ever
  // fabricating a quota state the provider never confirmed.
  const streak = Math.max(...classes.map((c) => c.consecutive429s))
  return streak > 1 ? `${timing} · ${streak} consecutive refusals` : timing
}
