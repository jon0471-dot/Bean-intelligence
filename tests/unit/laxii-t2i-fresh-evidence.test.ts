/**
 * HOTFIX (LAXII TEXT-TO-IMAGE RATE LIMITING, 2026-11-11) — freshness
 * contract of the persisted upstream-failure evidence.
 *
 * Defect pinned here (measured live 2026-11-11T03:39Z): the LAXII
 * Text-to-Image capability fed `persistedUpstreamFailure('image-generation')`
 * into `generationCapability`'s `freshUpstreamFailure` slot UNCONDITIONALLY.
 * The persisted lookup has no freshness window and no ordering against newer
 * attempts, so a 24-hour-old rate_limited row (2026-11-10T03:24:28Z)
 * permanently outranked a newer SUCCESSFUL real generation
 * (2026-11-11T03:09:16Z) and pinned the capability — and the product badge —
 * at 'rate-limited' with a factually false note, while the images-class
 * breaker was closed, the queue empty and the provider demonstrably serving.
 *
 * `recentPersistedUpstreamFailure` restores the SAME contract the in-memory
 * tracker (last-attempts.ts) has always enforced for its own records:
 *  - a failure is status evidence only inside ATTEMPT_FRESHNESS_MS;
 *  - any newer attempt record (success included) supersedes it — the slot
 *    means "the most recent real attempt failed", so a later attempt of any
 *    outcome invalidates the claim.
 * Boundary: `persistedUpstreamFailure` / `persistedLastAttempt` keep their
 * exact previous semantics (restart-proof display evidence) — additive fix.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

/** Controlled latest-FAILED-row result (what latestFailedRow selects). */
let latestFailed: { finishedAt: Date; errorClass: string | null } | null = null

mock.module('@/lib/db', () => ({
  db: {
    generationJob: {
      findFirst: async () => latestFailed,
    },
  },
}))

const { recentPersistedUpstreamFailure } = await import(
  '../../src/lib/adapters/persisted-attempts'
)
const { ATTEMPT_FRESHNESS_MS } = await import('../../src/lib/adapters/last-attempts')

const NOW = Date.parse('2026-11-11T03:39:00.000Z')

function failedRow(minutesAgo: number, errorClass = 'rate_limited') {
  return { finishedAt: new Date(NOW - minutesAgo * 60_000), errorClass }
}

beforeEach(() => {
  latestFailed = null
})

describe('recentPersistedUpstreamFailure("image-generation")', () => {
  test('a genuinely fresh persisted failure (no newer attempt) IS fresh evidence', async () => {
    latestFailed = failedRow(5) // 5 minutes old, inside the window
    const rec = await recentPersistedUpstreamFailure('image-generation', { now: NOW })
    expect(rec).not.toBeNull()
    expect(rec?.ok).toBe(false)
    expect(rec?.failureCategory).toBe('rate-limited')
  })

  test('REGRESSION: a 24-hour-old 429 row is NOT fresh evidence (the measured defect)', async () => {
    // Live measured state: failure 2026-11-10T03:24:28Z, success
    // 2026-11-11T03:09:16Z — 24h between them, capability pinned at
    // rate-limited anyway. The guard must expire the stale failure.
    latestFailed = failedRow(24 * 60)
    const rec = await recentPersistedUpstreamFailure('image-generation', { now: NOW })
    expect(rec).toBeNull()
  })

  test('a failure just past the freshness window is not fresh either', async () => {
    latestFailed = failedRow((ATTEMPT_FRESHNESS_MS + 60_000) / 60_000)
    const rec = await recentPersistedUpstreamFailure('image-generation', { now: NOW })
    expect(rec).toBeNull()
  })

  test('REGRESSION: a newer SUCCESSFUL attempt supersedes the failure even inside the window', async () => {
    // Failure 10 minutes ago, real success 2 minutes ago — the capability
    // model's own rule says a real success lifts the state; the stale
    // failure must not outrank it.
    latestFailed = failedRow(10)
    const newerSuccess = { at: new Date(NOW - 2 * 60_000).toISOString(), ok: true, failureCategory: null, httpStatus: null }
    const rec = await recentPersistedUpstreamFailure('image-generation', {
      now: NOW,
      supersededBy: newerSuccess,
    })
    expect(rec).toBeNull()
  })

  test('a newer FAILED attempt record also supersedes the older persisted failure', async () => {
    latestFailed = failedRow(10)
    const newerFailure = { at: new Date(NOW - 3 * 60_000).toISOString(), ok: false, failureCategory: 'auth' as const, httpStatus: 401 }
    const rec = await recentPersistedUpstreamFailure('image-generation', {
      now: NOW,
      supersededBy: newerFailure,
    })
    expect(rec).toBeNull()
  })

  test('an OLDER attempt record does not supersede the failure (failure stays the newest truth)', async () => {
    latestFailed = failedRow(5)
    const olderSuccess = { at: new Date(NOW - 20 * 60_000).toISOString(), ok: true, failureCategory: null, httpStatus: null }
    const rec = await recentPersistedUpstreamFailure('image-generation', {
      now: NOW,
      supersededBy: olderSuccess,
    })
    expect(rec).not.toBeNull()
    expect(rec?.failureCategory).toBe('rate-limited')
  })

  test('no failed rows → null (honest absence)', async () => {
    latestFailed = null
    const rec = await recentPersistedUpstreamFailure('image-generation', { now: NOW })
    expect(rec).toBeNull()
  })

  test('non-upstream error classes were never evidence (persistedUpstreamFailure maps them to null)', async () => {
    latestFailed = failedRow(5, 'other')
    const rec = await recentPersistedUpstreamFailure('image-generation', { now: NOW })
    expect(rec).toBeNull()
  })
})
