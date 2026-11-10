/**
 * Persisted chat-attempt evidence (CHAT-RECOVERY 2026-11-10).
 *
 * The quota-free chat health probe falls back to PERSISTED evidence
 * (UsageRecord rows) when this process has no in-memory attempt record —
 * e.g. right after a restart. These tests control the DB boundary so the
 * ladder is pinned hermetically:
 *  - most recent SUCCESS row → ok:true evidence at that timestamp;
 *  - most recent FAILED row → honest category mapping (rate-limited / auth
 *    / billing / timeout / network / backend-error);
 *  - no rows → null (honest absence, never a fabricated success).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

/** Controlled DB rows (most-recent-first as Prisma would return). */
let latestRow: { createdAt: Date; success: boolean; errorCode: string | null } | null = null
let queryCount = 0

mock.module('@/lib/db', () => ({
  db: {
    usageRecord: {
      findFirst: async () => {
        queryCount++
        return latestRow
      },
    },
  },
}))

const { persistedAttempt } = await import('../../src/lib/adapters/persisted-attempts')

beforeEach(() => {
  latestRow = null
  queryCount = 0
})

describe('persistedAttempt("chat-completion")', () => {
  test('a recent SUCCESS row backs healthy evidence with its own timestamp', async () => {
    const at = new Date('2026-11-10T02:57:20.103Z')
    latestRow = { createdAt: at, success: true, errorCode: null }
    const rec = await persistedAttempt('chat-completion')
    expect(rec?.ok).toBe(true)
    expect(rec?.failureCategory).toBeNull()
    expect(rec?.at).toBe(at.toISOString())
    expect(rec?.httpStatus).toBeNull()
    expect(queryCount).toBe(1)
  })

  test('a FAILED row maps UPSTREAM_RATE_LIMITED to the rate-limited category', async () => {
    latestRow = { createdAt: new Date(), success: false, errorCode: 'UPSTREAM_RATE_LIMITED' }
    const rec = await persistedAttempt('chat-completion')
    expect(rec?.ok).toBe(false)
    expect(rec?.failureCategory).toBe('rate-limited')
  })

  test('auth/billing/timeout/network error codes map to their honest categories', async () => {
    for (const [code, category] of [
      ['UPSTREAM_AUTH', 'auth'],
      ['UPSTREAM_BILLING', 'billing'],
      ['UPSTREAM_TIMEOUT', 'timeout'],
      ['UPSTREAM_NETWORK', 'network'],
    ] as const) {
      latestRow = { createdAt: new Date(), success: false, errorCode: code }
      const rec = await persistedAttempt('chat-completion')
      expect(rec?.failureCategory).toBe(category)
    }
  })

  test('unknown error codes stay honestly non-upstream (backend-error)', async () => {
    latestRow = { createdAt: new Date(), success: false, errorCode: 'BACKEND_FAILURE' }
    const rec = await persistedAttempt('chat-completion')
    expect(rec?.ok).toBe(false)
    expect(rec?.failureCategory).toBe('backend-error')
  })

  test('no chat rows at all → null (honest absence, never fabricated)', async () => {
    latestRow = null
    const rec = await persistedAttempt('chat-completion')
    expect(rec).toBeNull()
  })

  test('the media branches are untouched (image-generation still reads GenerationJob)', async () => {
    // Sanity: the chat branch did not change the media contract — the mock
    // db above has no generationJob, so the call must return null (not throw).
    const rec = await persistedAttempt('image-generation')
    expect(rec).toBeNull()
  })
})
