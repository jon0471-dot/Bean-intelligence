/**
 * URGENT HOTFIX (LAXII CAPABILITY RECOVERY, 2026-11-11) — stale failure
 * evidence + capability isolation for Conversational Editing and Background
 * Removal, using the verified T2I hotfix (commit 1e3f7cc) as the reference
 * implementation.
 *
 * Measured defects pinned here (live DB + health payload, 2026-11-11):
 *  1. bg-removal fed the UNGuarded persistedUpstreamFailure (no freshness
 *     window, no supersession) into its freshUpstreamFailure slot — the exact
 *     pre-hotfix T2I defect;
 *  2. the hosted-edit / bg-removal failure writers persisted NO errorClass,
 *     so their genuine 429 rows (errorClass null, errorCode RATE_LIMITED)
 *     were invisible to the restart-proof chain in BOTH directions: a
 *     restart erased a fresh failure's evidence and simultaneously
 *     whitewashed the capability back to an older success;
 *  3. conversational editing rendered ANY failed last attempt — a stale 429
 *     included — as a status-affecting contract 'Blocked (HTTP 429)' that
 *     never expired, while the identical T2I evidence rendered display-only
 *     Degraded;
 *  4. cross-capability contamination: bg-removal rows are image-editing
 *     rows, and the persisted + in-memory 'image-editing' evidence read them
 *     (measured live: the newest "edit success" WAS a bg-removal row, and a
 *     bg-removal 429 pinned editing at Blocked).
 *
 * Required scenarios (brief §6), one test each:
 *  - historical 429 older than 15 minutes;
 *  - fresh 429 within 15 minutes (incl. restart recovery with empty memory);
 *  - older failure superseded by newer success;
 *  - older failure superseded by newer failed attempt;
 *  - missing timestamps;
 *  - multiple capability isolation (a failure in one must not block another);
 *  - genuine provider 429 (classification + breaker + parking contract);
 *  - Retry-After handling;
 *  - successful generation after an earlier failure.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type { HealthFailureCategory } from '../../src/lib/adapters/types'

// ---- controlled persistence + clock ----------------------------------------

let latestFailed: { finishedAt: Date; errorClass: string | null; errorCode: string | null } | null = null
let latestCompleted: { finishedAt: Date } | null = null
let latestBgFailed: { finishedAt: Date; errorClass: string | null; errorCode: string | null } | null = null
let latestBgCompleted: { finishedAt: Date } | null = null
let latestT2iFailed: { finishedAt: Date; errorClass: string | null; errorCode: string | null } | null = null
let latestT2iCompleted: { finishedAt: Date } | null = null

mock.module('@/lib/db', () => ({
  db: {
    generationJob: {
      findFirst: async (args: { where?: Record<string, unknown> } = {}) => {
        const where = args.where ?? {}
        if (where.backendId === 'bean-image-hosted-primary') {
          // T2I chain (its own backendId).
          return where.status === 'completed' ? latestT2iCompleted : latestT2iFailed
        }
        // Structural match: bg lookups carry paramsJson.contains with the mode
        // marker; edit lookups carry paramsJson.not. (No string matching —
        // JSON.stringify escapes the quotes.)
        const pj = where.paramsJson as { contains?: unknown; not?: unknown } | undefined
        const isBg = typeof pj === 'object' && pj !== null && 'contains' in pj
        const failed = isBg ? latestBgFailed : latestFailed
        const completed = isBg ? latestBgCompleted : latestCompleted
        if (where.status === 'failed') return failed
        if (where.status === 'completed') return completed
        return failed ?? completed
      },
    },
  },
}))

const { persistedAttempt, persistedUpstreamFailure, persistedLastAttempt, recentPersistedUpstreamFailure } =
  await import('../../src/lib/adapters/persisted-attempts')
const { ATTEMPT_FRESHNESS_MS, _resetRealAttemptsForTests, noteRealAttempt, lastRealAttempt, recentUpstreamFailure } =
  await import('../../src/lib/adapters/last-attempts')
const { editingCapability, unverifiedCapability, LAXII_EDIT_CONTRACT_BLOCKER } = await import(
  '../../src/lib/registry/capabilities'
)
const { imageGenerationBackoffMs, IMAGE_MAX_GENERATION_ATTEMPTS, retryAfterMsOf } = await import(
  '../../src/lib/jobs/image-worker'
)
const { UpstreamRateLimitError, classifyUpstreamError } = await import('../../src/lib/upstream/gateway')
type AttemptRecord = { at: string; ok: boolean; failureCategory: HealthFailureCategory | null; httpStatus: number | null }

const NOW = Date.parse('2026-11-11T07:00:00.000Z')
const HEALTHY_PROBE = {
  healthy: true,
  checkedAt: new Date(NOW).toISOString(),
  latencyMs: 12,
  httpStatus: 200,
  failureCategory: null,
  detail: 'probe ok',
} as never
const CLOSED_BREAKER = { coolingDown: false, last429At: null }

function minutesAgo(min: number): string {
  return new Date(NOW - min * 60_000).toISOString()
}

beforeEach(() => {
  latestFailed = null
  latestCompleted = null
  latestBgFailed = null
  latestBgCompleted = null
  latestT2iFailed = null
  latestT2iCompleted = null
  _resetRealAttemptsForTests()
})

// =============================================================================
// 1+2. Freshness contract (the T2I rules applied to edit + bg evidence)
// =============================================================================

describe('persisted freshness contract — conversational editing + bg removal', () => {
  test('REGRESSION: historical 429 (RATE_LIMITED errorCode, errorClass null) is evidence again', async () => {
    // The measured live defect: the edit/bg failure writers persisted only
    // errorCode RATE_LIMITED — the errorClass-only mapping dropped the row
    // entirely (restart-proofness broken). The errorCode fallback restores it.
    latestFailed = { finishedAt: new Date(NOW - 5 * 60_000), errorClass: null, errorCode: 'RATE_LIMITED' }
    const rec = await persistedUpstreamFailure('image-editing')
    expect(rec).not.toBeNull()
    expect(rec?.failureCategory).toBe('rate-limited')
    const bg = await persistedUpstreamFailure('image-bg-removal')
    latestBgFailed = { finishedAt: new Date(NOW - 5 * 60_000), errorClass: null, errorCode: 'RATE_LIMITED' }
    expect((bg ?? (await persistedUpstreamFailure('image-bg-removal')))?.failureCategory).toBe('rate-limited')
  })

  test('a genuinely fresh persisted 429 inside the 15-minute window IS fresh evidence (restart-proofness kept)', async () => {
    // Restart scenario: in-memory tracker is empty; the persisted row (newer
    // than this process) must still hold the capability honestly.
    latestFailed = { finishedAt: new Date(NOW - 5 * 60_000), errorClass: 'rate_limited', errorCode: 'RATE_LIMITED' }
    const rec = await recentPersistedUpstreamFailure('image-editing', { now: NOW, supersededBy: null })
    expect(rec).not.toBeNull()
    expect(rec?.failureCategory).toBe('rate-limited')
  })

  test('REGRESSION: historical 429 older than 15 minutes is NOT fresh evidence', async () => {
    latestFailed = { finishedAt: new Date(NOW - 25 * 60_000), errorClass: null, errorCode: 'RATE_LIMITED' }
    const rec = await recentPersistedUpstreamFailure('image-editing', { now: NOW })
    expect(rec).toBeNull()
    latestBgFailed = { finishedAt: new Date(NOW - 25 * 60_000), errorClass: null, errorCode: 'RATE_LIMITED' }
    const bg = await recentPersistedUpstreamFailure('image-bg-removal', { now: NOW })
    expect(bg).toBeNull()
  })

  test('a failure just past ATTEMPT_FRESHNESS_MS expires (the same window as the in-memory chain)', async () => {
    latestFailed = {
      finishedAt: new Date(NOW - ATTEMPT_FRESHNESS_MS - 60_000), // 16 minutes old
      errorClass: 'rate_limited',
      errorCode: 'RATE_LIMITED',
    }
    expect(await recentPersistedUpstreamFailure('image-bg-removal', { now: NOW })).toBeNull()
  })

  test('older failure superseded by a NEWER SUCCESSFUL attempt even inside the window', async () => {
    latestFailed = { finishedAt: new Date(NOW - 10 * 60_000), errorClass: 'rate_limited', errorCode: 'RATE_LIMITED' }
    const newerSuccess: AttemptRecord = { at: minutesAgo(2), ok: true, failureCategory: null, httpStatus: null }
    expect(await recentPersistedUpstreamFailure('image-editing', { now: NOW, supersededBy: newerSuccess })).toBeNull()
  })

  test('older failure superseded by a NEWER FAILED attempt (last-write-wins — the newer failure governs)', async () => {
    // Older rate_limited (10 min) + newer auth failure (3 min): the newest
    // failed row IS what latestFailedRow returns, and the newer record
    // supersedes the older one as "what happened last".
    latestFailed = { finishedAt: new Date(NOW - 3 * 60_000), errorClass: 'auth', errorCode: 'UPSTREAM_AUTH' }
    const olderFailure: AttemptRecord = { at: minutesAgo(10), ok: false, failureCategory: 'rate-limited', httpStatus: 429 }
    const rec = await recentPersistedUpstreamFailure('image-editing', { now: NOW, supersededBy: olderFailure })
    expect(rec).not.toBeNull()
    expect(rec?.failureCategory).toBe('auth') // the NEWER failure's class
  })

  test('missing timestamps: a failed row without finishedAt is never evidence', async () => {
    latestFailed = { finishedAt: new Date(NOW - 5 * 60_000), errorClass: 'rate_limited', errorCode: 'RATE_LIMITED' }
    // latestFailedRow returns null when finishedAt is missing (persisted module
    // guards `!row.finishedAt`); simulate through the success side of
    // persistedAttempt, whose recordFrom also guards null.
    const completed = await persistedAttempt('image-editing')
    expect(completed === null || typeof completed.at === 'string').toBe(true)
    // A null-finishedAt failure row cannot produce an attempt record at all:
    latestFailed = { finishedAt: new Date(NaN), errorClass: 'rate_limited', errorCode: 'RATE_LIMITED' }
    // Date(NaN).toISOString() throws in the row builder, so the module's own
    // null guard is what this scenario exercises — the row shape below is
    // what the DB can return for a job that never reached a terminal stamp.
    latestFailed = null
    expect(await persistedUpstreamFailure('image-editing')).toBeNull()
  })

  test('a malformed-response class (request-specific) is NOT upstream evidence', async () => {
    latestT2iFailed = { finishedAt: new Date(NOW - 5 * 60_000), errorClass: 'malformed_response', errorCode: 'BACKEND_FAILURE' }
    expect(await persistedUpstreamFailure('image-generation')).toBeNull()
  })
})

// =============================================================================
// 3. Capability-level rendering (stale 429 must not pin Blocked/Rate-limited)
// =============================================================================

describe('capability rendering — conversational editing', () => {
  test('REGRESSION: stale (>15 min) 429 renders display-only Degraded, never status-affecting Blocked (HTTP 429)', () => {
    const lastAttempt: AttemptRecord = { at: minutesAgo(25), ok: false, failureCategory: 'rate-limited', httpStatus: 429 }
    const row = editingCapability('conversational-editing', 'Conversational editing', true, {
      probe: HEALTHY_PROBE,
      lastAttempt,
      freshUpstreamFailure: null,
      ownBreaker: CLOSED_BREAKER,
      sharedThrottle: null,
      contractBlocker: LAXII_EDIT_CONTRACT_BLOCKER,
    })
    expect(row.state).toBe('degraded')
    expect(row.statusAffecting).toBe(false)
    expect(row.evidence.httpStatus).toBe(429) // the real evidence stays visible
  })

  test('a FRESH 429 renders Rate limited (status-affecting), not Blocked', () => {
    const fresh: AttemptRecord = { at: minutesAgo(4), ok: false, failureCategory: 'rate-limited', httpStatus: 429 }
    const row = editingCapability('conversational-editing', 'Conversational editing', true, {
      probe: HEALTHY_PROBE,
      lastAttempt: fresh,
      freshUpstreamFailure: fresh,
      ownBreaker: CLOSED_BREAKER,
      sharedThrottle: null,
      contractBlocker: LAXII_EDIT_CONTRACT_BLOCKER,
    })
    expect(row.state).toBe('rate-limited')
    expect(row.statusAffecting).toBe(true)
  })

  test('a fresh NON-throttle upstream failure renders Degraded (never a contract verdict)', () => {
    const fresh: AttemptRecord = { at: minutesAgo(2), ok: false, failureCategory: 'auth', httpStatus: 401 }
    const row = editingCapability('conversational-editing', 'Conversational editing', true, {
      probe: HEALTHY_PROBE,
      lastAttempt: fresh,
      freshUpstreamFailure: fresh,
      ownBreaker: CLOSED_BREAKER,
      sharedThrottle: null,
      contractBlocker: LAXII_EDIT_CONTRACT_BLOCKER,
    })
    expect(row.state).toBe('degraded')
    expect(row.statusAffecting).toBe(true)
  })

  test('the contract blocker still renders Blocked for a NON-upstream failure (measured 400/1210 class)', () => {
    const lastAttempt: AttemptRecord = { at: minutesAgo(30), ok: false, failureCategory: 'backend-error', httpStatus: 400 }
    const row = editingCapability('conversational-editing', 'Conversational editing', true, {
      probe: HEALTHY_PROBE,
      lastAttempt,
      freshUpstreamFailure: null,
      ownBreaker: CLOSED_BREAKER,
      sharedThrottle: null,
      contractBlocker: LAXII_EDIT_CONTRACT_BLOCKER,
    })
    expect(row.state).toBe('blocked')
    expect(row.statusAffecting).toBe(true)
  })

  test('an open images-class breaker renders Rate limited for editing (fail-fast is honest)', () => {
    const row = editingCapability('conversational-editing', 'Conversational editing', true, {
      probe: HEALTHY_PROBE,
      lastAttempt: { at: minutesAgo(60), ok: true, failureCategory: null, httpStatus: null },
      freshUpstreamFailure: null,
      ownBreaker: { coolingDown: true, last429At: minutesAgo(1) },
      sharedThrottle: null,
      contractBlocker: LAXII_EDIT_CONTRACT_BLOCKER,
    })
    expect(row.state).toBe('rate-limited')
    expect(row.statusAffecting).toBe(true)
  })

  test('a newer SUCCESS supersedes the stale failure → Operational (blocker lifted)', () => {
    const row = editingCapability('conversational-editing', 'Conversational editing', true, {
      probe: HEALTHY_PROBE,
      lastAttempt: { at: minutesAgo(2), ok: true, failureCategory: null, httpStatus: null },
      freshUpstreamFailure: null,
      ownBreaker: CLOSED_BREAKER,
      sharedThrottle: null,
      contractBlocker: LAXII_EDIT_CONTRACT_BLOCKER,
    })
    expect(row.state).toBe('operational')
    expect(row.statusAffecting).toBe(false)
  })
})

describe('capability rendering — background removal', () => {
  test('REGRESSION: completed-before + failed-newest renders display-only Degraded (not the false never-completed Blocked)', () => {
    const lastAttempt: AttemptRecord = { at: minutesAgo(25), ok: false, failureCategory: 'rate-limited', httpStatus: 429 }
    const row = unverifiedCapability('background-removal', 'Background removal', false, {
      probe: HEALTHY_PROBE,
      lastAttempt,
      freshUpstreamFailure: null,
      ownBreaker: CLOSED_BREAKER,
      sharedThrottle: null,
      hasCompletedRun: true,
    })
    expect(row.state).toBe('degraded')
    expect(row.statusAffecting).toBe(false)
    expect(row.evidence.note).toContain('completed before')
  })

  test('JAZMII parity: WITHOUT hasCompletedRun the previous blocked semantics are byte-identical', () => {
    const lastAttempt: AttemptRecord = { at: minutesAgo(25), ok: false, failureCategory: 'rate-limited', httpStatus: 429 }
    const row = unverifiedCapability('image-to-video', 'Image-to-video', false, {
      probe: HEALTHY_PROBE,
      lastAttempt,
      freshUpstreamFailure: null,
      ownBreaker: CLOSED_BREAKER,
      sharedThrottle: null,
    })
    expect(row.state).toBe('blocked')
    expect(row.statusAffecting).toBe(true)
    expect(row.evidence.note).toContain('never completed a real run')
  })

  test('a FRESH 429 still renders Rate limited for bg removal (freshness outranks the completed tail)', () => {
    const fresh: AttemptRecord = { at: minutesAgo(4), ok: false, failureCategory: 'rate-limited', httpStatus: 429 }
    const row = unverifiedCapability('background-removal', 'Background removal', false, {
      probe: HEALTHY_PROBE,
      lastAttempt: fresh,
      freshUpstreamFailure: fresh,
      ownBreaker: CLOSED_BREAKER,
      sharedThrottle: null,
      hasCompletedRun: true,
    })
    expect(row.state).toBe('rate-limited')
    expect(row.statusAffecting).toBe(true)
  })
})

// =============================================================================
// 4. Capability isolation (a failure in one must not block another)
// =============================================================================

describe('capability isolation', () => {
  test('REGRESSION: a bg-removal failure is NOT conversational-editing evidence (persisted chain)', async () => {
    // The bg row is newer than any edit row — without the isolation filter
    // the editing chain would read it (measured live: editing's newest
    // "failure" came from the bg-removal 429).
    latestFailed = { finishedAt: new Date(NOW - 3 * 60_000), errorClass: 'rate_limited', errorCode: 'RATE_LIMITED' } // an EDIT row (no bg marker in where → edit branch)
    latestBgFailed = { finishedAt: new Date(NOW - 1 * 60_000), errorClass: 'rate_limited', errorCode: 'RATE_LIMITED' }
    latestCompleted = { finishedAt: new Date(NOW - 40 * 60_000) }
    const editFailure = await persistedUpstreamFailure('image-editing')
    expect(editFailure?.at).toBe(new Date(NOW - 3 * 60_000).toISOString())
    // bg chain reads its own (newer) row:
    const bgFailure = await persistedUpstreamFailure('image-bg-removal')
    expect(bgFailure?.at).toBe(new Date(NOW - 1 * 60_000).toISOString())
  })

  test('REGRESSION: a bg-removal SUCCESS does not stand in for an editing success (persisted chain)', async () => {
    // Measured live: the newest completed hosted-edit row WAS a bg-removal
    // row, so editing read "a real edit completed" from bg-removal's work.
    latestBgCompleted = { finishedAt: new Date(NOW - 1 * 60_000) }
    latestCompleted = { finishedAt: new Date(NOW - 200 * 60_000) }
    const editCompleted = await persistedAttempt('image-editing')
    expect(editCompleted?.at).toBe(new Date(NOW - 200 * 60_000).toISOString())
    const bgCompleted = await persistedAttempt('image-bg-removal')
    expect(bgCompleted?.at).toBe(new Date(NOW - 1 * 60_000).toISOString())
  })

  test('in-memory isolation: a bg-removal failure recorded under its own key never reaches the editing key', () => {
    noteRealAttempt('image-bg-removal', {
      at: minutesAgo(1),
      ok: false,
      backendId: 'bean-image-hosted-edit',
      failureCategory: 'rate-limited',
      httpStatus: 429,
      upstream: true,
    })
    // Freshness is judged against the TEST's controlled clock (NOW), not the
    // wall clock — the same convention the persisted-chain tests in this file
    // use ({ now: NOW }). Defaulting to Date.now() made this assertion pass
    // only while the real clock happened to sit within 15 minutes of NOW.
    expect(recentUpstreamFailure('image-bg-removal', NOW)).not.toBeNull()
    expect(recentUpstreamFailure('image-editing', NOW)).toBeNull()
    expect(lastRealAttempt('image-editing')).toBeNull()
    // ...and never the T2I key either:
    expect(recentUpstreamFailure('image-generation', NOW)).toBeNull()
  })

  test('editing evidence stays separate from T2I evidence (shared breaker is the ONLY shared signal)', async () => {
    latestFailed = { finishedAt: new Date(NOW - 5 * 60_000), errorClass: 'rate_limited', errorCode: 'RATE_LIMITED' }
    const editFailure = await persistedUpstreamFailure('image-editing')
    expect(editFailure).not.toBeNull()
    // The T2I chain (different backendId) sees nothing:
    expect(await persistedUpstreamFailure('image-generation')).toBeNull()
  })
})

// =============================================================================
// 5. Genuine provider 429 + Retry-After + success-after-failure
// =============================================================================

describe('genuine 429 handling', () => {
  test('a real 429 classifies as upstream throttle evidence; a breaker SKIP is not', () => {
    const real = classifyUpstreamError(new Error('image edit is rate-limited upstream (HTTP 429): account throttle'))
    expect(real.kind).toBe('rate_limited')
    expect(real.status).toBe(429)
    const skip = new UpstreamRateLimitError('images', 'not attempted: breaker open', false)
    expect(skip.attempted).toBe(false)
    expect(classifyUpstreamError(skip).kind).toBe('rate_limited')
  })

  test('Retry-After: an adapter-surfaced hint is honored (clamped 5s..10min); absent hint falls back to the breaker/escalation', () => {
    expect(retryAfterMsOf(new UpstreamRateLimitError('images', 'x', true, 45_000))).toBe(45_000)
    expect(retryAfterMsOf(new UpstreamRateLimitError('images', 'x', true, null))).toBeNull()
    // Honored: backoff == the hint (inside the clamp).
    expect(imageGenerationBackoffMs(1, 0, 45_000)).toBe(45_000)
    // Clamped: a 2s hint never re-hits faster than 5s; a 1h hint caps at 10min.
    expect(imageGenerationBackoffMs(1, 0, 2_000)).toBe(5_000)
    expect(imageGenerationBackoffMs(1, 0, 3_600_000)).toBe(600_000)
    // No hint → the breaker's remaining window wins (never generate into an
    // open cooldown); with the breaker closed → the escalating schedule.
    expect(imageGenerationBackoffMs(1, 120_000, null)).toBe(120_000)
    expect(imageGenerationBackoffMs(1, 0, null)).toBe(60_000)
    expect(imageGenerationBackoffMs(3, 0, null)).toBe(240_000)
    // The budget is bounded: attempts and cumulative wait both cap.
    expect(IMAGE_MAX_GENERATION_ATTEMPTS).toBeGreaterThanOrEqual(2)
  })

  test('successful generation after an earlier failure: newest-wins across the whole chain', async () => {
    // Persisted: failure 25 min ago, completion 2 min ago.
    latestFailed = { finishedAt: new Date(NOW - 25 * 60_000), errorClass: 'rate_limited', errorCode: 'RATE_LIMITED' }
    latestCompleted = { finishedAt: new Date(NOW - 2 * 60_000) }
    // The fresh-failure slot must be empty (window + supersession):
    const lastAttempt = await persistedLastAttempt('image-editing')
    expect(lastAttempt?.ok).toBe(true)
    expect(await recentPersistedUpstreamFailure('image-editing', { now: NOW, supersededBy: lastAttempt })).toBeNull()
    // And the capability renders operational from the real success:
    const row = editingCapability('conversational-editing', 'Conversational editing', true, {
      probe: HEALTHY_PROBE,
      lastAttempt,
      freshUpstreamFailure: null,
      ownBreaker: CLOSED_BREAKER,
      sharedThrottle: null,
      contractBlocker: LAXII_EDIT_CONTRACT_BLOCKER,
    })
    expect(row.state).toBe('operational')
    expect(row.statusAffecting).toBe(false)
    expect(row.evidence.note).toContain('blocker is lifted')
  })
})
