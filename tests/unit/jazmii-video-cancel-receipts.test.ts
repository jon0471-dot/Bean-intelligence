/**
 * TRUST SPECIALIST COVERAGE — JAZMII video-generation cancellation receipt.
 *
 * The video worker's cancellation is STOP-TRACKING (the provider exposes no
 * cancel API). Pinned here:
 *  - a direct video-generation job cancelled with no live poller settles an
 *    honest Trust receipt with the exact stop-tracking semantics;
 *  - a DIRECTOR SCENE job records NO standalone receipt (the production's
 *    orchestration receipt already carries every scene cancellation — no
 *    duplicate receipts);
 *  - a terminal row is never re-settled by a late cancel (CAS contract).
 *
 * Mocks: Prisma boundary + metering + events. The hosted-video adapter and
 * ffprobe are imported but never invoked by this path.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { createTrustFakeDb } from '../helpers/trust-fake-db'

const jobRows = new Map<string, Record<string, unknown>>()
const usageRows: Array<Record<string, unknown>> = []

const trust = createTrustFakeDb()

const fakeDb = {
  generationJob: {
    findUnique: async ({ where }: { where: { id: string } }) => jobRows.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = jobRows.get(where.id)
      if (!row) throw new Error('job not found')
      Object.assign(row, data)
      return row
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = jobRows.get(where.id as string)
      if (!row) return { count: 0 }
      for (const [k, v] of Object.entries(where)) {
        if (k === 'id') continue
        const cond = v as { in?: string[] } | string
        if (cond && typeof cond === 'object' && Array.isArray(cond.in)) {
          if (!(cond.in as string[]).includes(row.status as string)) return { count: 0 }
          continue
        }
        if (row[k] !== cond) return { count: 0 }
      }
      Object.assign(row, data)
      return { count: 1 }
    },
  },
  usageRecord: {
    count: async () => usageRows.length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      usageRows.push(data)
      return data
    },
  },
  ...trust.fakeDb,
}
mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async (input: Record<string, unknown>) => {
    usageRows.push(input)
    return undefined
  },
  recordAudit: async () => undefined,
}))
mock.module('@/lib/ai-engine/events', () => ({
  appendJobEventSafe: async () => undefined,
  appendJobEvent: async () => undefined,
}))

const { requestVideoCancel } = await import('../../src/lib/jobs/video-worker')
const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')

function makeJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = {
    id: 'job-video-cancel',
    userId: 'user-video',
    product: 'jazmii',
    task: 'video-generation',
    status: 'running',
    workerId: 'worker-claim-9',
    cancelRequested: false,
    paramsJson: JSON.stringify({ prompt: 'a lighthouse in fog', durationSec: 5 }),
    resultJson: null,
    ...overrides,
  }
  jobRows.set(row.id as string, row)
  return row
}

beforeEach(() => {
  jobRows.clear()
  usageRows.length = 0
  trust.reset()
})

describe('JAZMII cancellation receipts', () => {
  test('direct job: stop-tracking cancel settles an honest cancelled receipt', async () => {
    makeJob()
    const accepted = await requestVideoCancel('job-video-cancel')
    expect(accepted).toBe(true)
    const row = jobRows.get('job-video-cancel')!
    expect(row.status).toBe('failed') // stop-tracking semantics on the job row
    expect(row.errorCode).toBe('CANCELLED')
    expect(row.cancelRequested).toBe(true)
    expect(trust.trustTask.rows.length).toBe(1)
    const receipt = await composeTrustReceipt(trust.trustTask.rows[0].id as string, 'user-video')
    expect(receipt!.task.status).toBe('cancelled')
    expect(receipt!.task.failureNote).toContain('stop-tracking')
    expect(receipt!.task.failureNote).toContain('no output will be stored')
    expect(receipt!.task.requestPreview).toContain('lighthouse')
  })

  test('director scene job: NO standalone receipt — the production receipt owns the story', async () => {
    makeJob({
      id: 'job-scene-3',
      paramsJson: JSON.stringify({
        prompt: 'close-up of hands turning a dial',
        director: { productionId: 'prod-1', sceneIdx: 3 },
      }),
    })
    const accepted = await requestVideoCancel('job-scene-3')
    expect(accepted).toBe(true)
    expect(jobRows.get('job-scene-3')!.errorCode).toBe('CANCELLED')
    expect(trust.trustTask.rows.length).toBe(0)
  })

  test('a terminal row is never re-cancelled and never re-receipted (CAS)', async () => {
    makeJob({ id: 'job-done', status: 'completed', resultJson: JSON.stringify({ videoUrl: 'x', format: 'mp4' }) })
    const accepted = await requestVideoCancel('job-done')
    expect(accepted).toBe(false)
    expect(jobRows.get('job-done')!.status).toBe('completed')
    expect(trust.trustTask.rows.length).toBe(0)
  })
})
