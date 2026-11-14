/**
 * LAXII-JAZMII RESTORATION (2026-11-14, defects D1+D2+D4) — JAZMII evidence
 * wiring and durable cancellation.
 *
 * Pins the three wiring contracts the restoration added on top of the
 * measured evidence chain:
 *  D1 — both video capability rows feed `recentPersistedUpstreamFailure`
 *       (freshness + supersession) into their freshUpstreamFailure slot, the
 *       same guarded contract the T2I row has used since its hotfix — never
 *       the unguarded `persistedUpstreamFailure`;
 *  D2 — the image-to-video row passes `hasCompletedRun` from the persisted
 *       completed-job table, so a failed newest attempt after real completed
 *       runs renders display-only Degraded instead of the factually false
 *       "attempted live but never completed a real run" Blocked state;
 *  D4 — `requestVideoCancel` persists the durable `cancelRequested` flag on
 *       the row and the poll loop re-reads it (cross-process stop-tracking).
 *
 * The evidence semantics are exercised against a controlled fake
 * GenerationJob table (mirrors the real query shapes in
 * persisted-attempts.ts); the route/worker wiring is pinned by
 * source-contract assertions (same pattern as frontend-intel-catalog /
 * giftz-sidebar tests).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { readFileSync } from 'node:fs'

// ---- controlled GenerationJob table ----------------------------------------
type FakeRow = {
  id: string
  product: string
  task: string
  status: string
  backendId?: string | null
  finishedAt: Date | null
  queuedAt: Date
  paramsJson: string
  errorClass?: string | null
  errorCode?: string | null
}

let rows: FakeRow[] = []

const fakeDb = {
  generationJob: {
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter(
        (r) =>
          r.product === where.product &&
          r.task === where.task &&
          r.status === where.status &&
          r.finishedAt !== null,
      ),
    findFirst: async ({
      where,
    }: {
      where: {
        product: string
        task: string
        status?: string
        backendId?: string
        paramsJson?: { contains?: string; not?: { contains?: string } }
      }
    }) => {
      const matches = rows.filter((r) => {
        if (r.product !== where.product || r.task !== where.task) return false
        if (where.status && r.status !== where.status) return false
        if (where.backendId && r.backendId !== where.backendId) return false
        const pj = where.paramsJson as { contains?: string; not?: { contains?: string } } | undefined
        if (pj) {
          if (pj.contains && !r.paramsJson.includes(pj.contains)) return false
          if (pj.not?.contains && r.paramsJson.includes(pj.not.contains)) return false
        }
        return true
      })
      if (matches.length === 0) return null
      // orderBy finishedAt desc (finishedAt always set for failed rows here)
      matches.sort((a, b) => (b.finishedAt?.getTime() ?? 0) - (a.finishedAt?.getTime() ?? 0))
      const top = matches[0]
      return { finishedAt: top.finishedAt, errorClass: top.errorClass ?? null, errorCode: top.errorCode ?? null }
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.find((r) => r.id === where.id)
      if (row) Object.assign(row, data)
      return row ?? null
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      rows.find((r) => r.id === where.id) ?? null,
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

const {
  persistedAttempt,
  persistedUpstreamFailure,
  recentPersistedUpstreamFailure,
  persistedLastAttempt,
} = await import('../../src/lib/adapters/persisted-attempts')

const ATTEMPT_FRESHNESS_MS = 15 * 60 * 1000

function iso(msAgo: number): Date {
  return new Date(Date.now() - msAgo)
}

beforeEach(() => {
  rows = []
})

describe('persisted i2v/t2v completion evidence (defect D2 input)', () => {
  test('a completed job whose params carry imageUrl classifies as i2v evidence', async () => {
    rows.push({
      id: 'j1',
      product: 'jazmii',
      task: 'video-generation',
      status: 'completed',
      finishedAt: iso(60_000),
      queuedAt: iso(120_000),
      paramsJson: JSON.stringify({ prompt: 'p', imageUrl: 'https://example.com/ref.png' }),
    })
    const i2v = await persistedAttempt('video-generation-i2v')
    expect(i2v).not.toBeNull()
    expect(i2v?.ok).toBe(true)
    // and NOT as t2v evidence
    expect(await persistedAttempt('video-generation-t2v')).toBeNull()
  })

  test('a completed text-only video job classifies as t2v evidence, never i2v', async () => {
    rows.push({
      id: 'j2',
      product: 'jazmii',
      task: 'video-generation',
      status: 'completed',
      finishedAt: iso(60_000),
      queuedAt: iso(120_000),
      paramsJson: JSON.stringify({ prompt: 'p' }),
    })
    expect(await persistedAttempt('video-generation-t2v')).not.toBeNull()
    expect(await persistedAttempt('video-generation-i2v')).toBeNull()
  })

  test('mixed history: each capability reads its own newest completion', async () => {
    rows.push(
      {
        id: 'i2v-old',
        product: 'jazmii',
        task: 'video-generation',
        status: 'completed',
        finishedAt: iso(40 * 60_000),
        queuedAt: iso(41 * 60_000),
        paramsJson: JSON.stringify({ imageUrl: 'data:image/png;base64,AAA' }),
      },
      {
        id: 't2v-new',
        product: 'jazmii',
        task: 'video-generation',
        status: 'completed',
        finishedAt: iso(5 * 60_000),
        queuedAt: iso(6 * 60_000),
        paramsJson: JSON.stringify({ prompt: 'p' }),
      },
    )
    expect((await persistedAttempt('video-generation-i2v'))?.at).toBe(iso(40 * 60_000).toISOString())
    expect((await persistedAttempt('video-generation-t2v'))?.at).toBe(iso(5 * 60_000).toISOString())
  })
})

describe('guarded video failure evidence (defect D1 input)', () => {
  test('a fresh upstream-class failed row is evidence for BOTH video capabilities', async () => {
    rows.push({
      id: 'fail-1',
      product: 'jazmii',
      task: 'video-generation',
      status: 'failed',
      finishedAt: iso(2 * 60_000),
      queuedAt: iso(3 * 60_000),
      paramsJson: JSON.stringify({ prompt: 'p' }),
      errorClass: 'rate_limited',
      errorCode: 'RATE_LIMITED',
    })
    const f = await persistedUpstreamFailure('video-generation-i2v')
    expect(f?.failureCategory).toBe('rate-limited')
    expect((await persistedUpstreamFailure('video-generation-t2v'))?.failureCategory).toBe('rate-limited')
  })

  test('a request-specific failure (CANCELLED) is NOT health evidence', async () => {
    rows.push({
      id: 'fail-cancel',
      product: 'jazmii',
      task: 'video-generation',
      status: 'failed',
      finishedAt: iso(2 * 60_000),
      queuedAt: iso(3 * 60_000),
      paramsJson: JSON.stringify({ prompt: 'p' }),
      errorClass: null,
      errorCode: 'CANCELLED',
    })
    expect(await persistedUpstreamFailure('video-generation-i2v')).toBeNull()
  })

  test('freshness window: a 20-minute-old failure is NOT fresh evidence', async () => {
    rows.push({
      id: 'fail-old',
      product: 'jazmii',
      task: 'video-generation',
      status: 'failed',
      finishedAt: iso(20 * 60_000),
      queuedAt: iso(21 * 60_000),
      paramsJson: JSON.stringify({ prompt: 'p' }),
      errorClass: 'rate_limited',
    })
    expect(await recentPersistedUpstreamFailure('video-generation-i2v')).toBeNull()
    // but it still exists as the unguarded last-attempt fallback
    expect(await persistedUpstreamFailure('video-generation-i2v')).not.toBeNull()
  })

  test('supersession: a newer completed i2v run invalidates the older failure as "what happened last"', async () => {
    const failedAt = iso(10 * 60_000)
    const completedAt = iso(2 * 60_000)
    rows.push(
      {
        id: 'fail-mid',
        product: 'jazmii',
        task: 'video-generation',
        status: 'failed',
        finishedAt: failedAt,
        queuedAt: iso(11 * 60_000),
        paramsJson: JSON.stringify({ prompt: 'p' }),
        errorClass: 'rate_limited',
      },
      {
        id: 'ok-new',
        product: 'jazmii',
        task: 'video-generation',
        status: 'completed',
        finishedAt: completedAt,
        queuedAt: iso(3 * 60_000),
        paramsJson: JSON.stringify({ imageUrl: 'data:image/png;base64,AAA' }),
      },
    )
    const lastAttempt = await persistedLastAttempt('video-generation-i2v')
    expect(lastAttempt?.ok).toBe(true) // newest record wins
    // The guarded feed must NOT report the older failure as fresh.
    expect(await recentPersistedUpstreamFailure('video-generation-i2v', { supersededBy: lastAttempt })).toBeNull()
    // while the unguarded one still would — the exact defect D1 closes.
    expect(await persistedUpstreamFailure('video-generation-i2v')).not.toBeNull()
  })

  test('a genuinely fresh failure NEWER than the last attempt still holds its state', async () => {
    const completedAt = iso(10 * 60_000)
    const failedAt = iso(60_000)
    rows.push(
      {
        id: 'ok-old',
        product: 'jazmii',
        task: 'video-generation',
        status: 'completed',
        finishedAt: completedAt,
        queuedAt: iso(11 * 60_000),
        paramsJson: JSON.stringify({ prompt: 'p' }),
      },
      {
        id: 'fail-new',
        product: 'jazmii',
        task: 'video-generation',
        status: 'failed',
        finishedAt: failedAt,
        queuedAt: iso(2 * 60_000),
        paramsJson: JSON.stringify({ prompt: 'p' }),
        errorClass: 'rate_limited',
      },
    )
    const lastAttempt = await persistedLastAttempt('video-generation-i2v')
    expect(lastAttempt?.ok).toBe(false)
    const fresh = await recentPersistedUpstreamFailure('video-generation-i2v', { supersededBy: lastAttempt })
    expect(fresh?.failureCategory).toBe('rate-limited')
    expect(fresh!.at).toBe(failedAt.toISOString())
  })
})

// ---- wiring contracts (source-contract assertions) --------------------------

const repoRoot = new URL('../../', import.meta.url).pathname
const read = (rel: string): string => readFileSync(`${repoRoot}${rel}`, 'utf8')

describe('route/worker wiring contracts (defects D1+D2+D4)', () => {
  const health = read('src/app/api/health/route.ts')
  const worker = read('src/lib/jobs/video-worker.ts')

  test('health route: BOTH video rows use the guarded persisted-failure feed (D1)', () => {
    expect(health).toContain("recentPersistedUpstreamFailure('video-generation-t2v'")
    expect(health).toContain("recentPersistedUpstreamFailure('video-generation-i2v'")
    // The unguarded feed must be gone from the video capability rows.
    expect(health).not.toContain("persistedUpstreamFailure('video-generation-t2v')")
    expect(health).not.toContain("persistedUpstreamFailure('video-generation-i2v')")
  })

  test('health route: the i2v row wires hasCompletedRun from persisted completions (D2)', () => {
    expect(health).toContain("hasCompletedRun: (await persistedAttempt('video-generation-i2v')) !== null")
  })

  test('video worker: requestVideoCancel persists the durable flag (D4)', () => {
    const requestVideoCancel = worker.slice(worker.indexOf('export async function requestVideoCancel'))
    expect(requestVideoCancel).toContain("data: { cancelRequested: true }")
  })

  test('video worker: the poll loop re-reads the durable flag (D4)', () => {
    // durableCancelRequested must exist and be checked alongside the
    // in-process Set in processVideoJob.
    expect(worker).toContain('async function durableCancelRequested')
    const processJob = worker.slice(worker.indexOf('export async function processVideoJob'), worker.indexOf('function upstreamRecord'))
    const durableChecks = processJob.split('durableCancelRequested(job.id)').length - 1
    expect(durableChecks).toBe(4) // entry, post-waitForDue, and both poll-loop boundaries
  })
})
