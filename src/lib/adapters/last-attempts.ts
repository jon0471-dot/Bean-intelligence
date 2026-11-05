/**
 * BEAN Intelligence — real-attempt evidence tracker (server-side).
 *
 * MEASURED CHANGE (2026-11-04 connectivity audit): the LAXII health probe is
 * deliberately cheap (reachability + configuration — a real generation costs
 * ~60s and quota), so a gateway that ANSWERS but THROTTLES generations (live
 * evidence 2026-11-04: hosted image generation failed with upstream HTTP 429
 * while the reachability probe passed) was invisible to the health payload —
 * the dashboard showed "Operational" for a product whose core capability was
 * failing upstream. That is exactly the "successful HTTP response ≠
 * operational" trap this audit was asked to close.
 *
 * Fix: record the outcome of every REAL generation attempt (the queue worker
 * is the observation point — no synthetic generation probes are invented),
 * and let the health route derive a DEGRADED status from a recent upstream-
 * class failure. Honesty rules:
 *  - only REAL attempts are recorded (successes and failures alike);
 *  - only UPSTREAM-class failures (rate-limited / auth / billing / timeout /
 *    network / unreachable) can affect product status — a content-policy or
 *    user-error rejection is not evidence that the product is unhealthy;
 *  - a successful attempt overrides the previous failure;
 *  - failure evidence expires after a freshness window (conservative, the
 *    measured upstream 429 windows last minutes) — after expiry the status
 *    falls back to the always-on reachability probe, and the attempt stays
 *    visible as history in the payload;
 *  - the tracker is globalThis-keyed (same pattern as the probe cache and
 *    the 429 breaker) so route-bundle module duplication cannot fragment it.
 */
import type { HealthFailureCategory } from './types'

export type AttemptTask =
  | 'image-generation'
  | 'image-enhancement'
  | 'image-editing'
  | 'video-generation'
  // GO-LIVE (2026-11-05): per-capability video keys — the umbrella
  // 'video-generation' stays the product-level record; t2v/i2v attempts
  // additionally record under their own key so one capability's evidence
  // can never be overwritten by the other's.
  | 'video-generation-t2v'
  | 'video-generation-i2v'
  | 'audio-generation'

/** Failure categories that indicate the BACKEND/UPSTREAM is failing —
 *  as opposed to a request-specific rejection (content policy, user error). */
export const UPSTREAM_FAILURE_CATEGORIES: ReadonlySet<string> = new Set([
  'rate-limited',
  'auth',
  'billing',
  'timeout',
  'network',
  'unreachable',
])

/** How long a failed real attempt stays status-relevant. Conservative: the
 *  upstream 429 window was measured to last multiple minutes (2026-10-29). */
export const ATTEMPT_FRESHNESS_MS = 15 * 60_000

export interface RealAttemptRecord {
  at: string
  ok: boolean
  backendId: string
  /** Coarse failure class; null on success. */
  failureCategory: HealthFailureCategory | null
  httpStatus: number | null
  /** True when the failure is upstream-class (can affect product status). */
  upstream: boolean
}

const STORE_KEY = '__bean_real_attempt_store__'

interface AttemptStore {
  last: Map<AttemptTask, RealAttemptRecord>
}

function store(): AttemptStore {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g[STORE_KEY]) g[STORE_KEY] = { last: new Map() }
  const s = g[STORE_KEY] as AttemptStore
  if (!s.last) s.last = new Map()
  return s
}

/** Record the outcome of a REAL attempt (from the worker — never synthetic). */
export function noteRealAttempt(task: AttemptTask, record: RealAttemptRecord): void {
  store().last.set(task, record)
}

/** The most recent real attempt for a task (any outcome), or null. */
export function lastRealAttempt(task: AttemptTask): RealAttemptRecord | null {
  return store().last.get(task) ?? null
}

/**
 * The most recent real attempt for a task IF it is (a) a failure, (b) of an
 * upstream class, and (c) still fresh. This is the status-affecting evidence.
 */
export function recentUpstreamFailure(task: AttemptTask, now = Date.now()): RealAttemptRecord | null {
  const rec = store().last.get(task)
  if (!rec || rec.ok || !rec.upstream) return null
  const t = Date.parse(rec.at)
  if (Number.isNaN(t)) return null
  if (now - t > ATTEMPT_FRESHNESS_MS) return null
  return rec
}

/** Test hook: clear all attempt state (process-global). */
export function _resetRealAttemptsForTests(): void {
  store().last.clear()
}
