/**
 * BEAN Intelligence — M26 F-G1 regression: unwired task types are settled
 * honestly (NO_BACKEND) instead of being parked `queued` forever.
 *
 * The audit found GANGZII's speech-synthesis / audio-transcription /
 * audio-conversion jobs are enqueued into a queue NO pool can claim (no
 * gangzii pool, no handler) — with embedded pools running the rows stayed
 * `queued` forever (worse than the documented honest NO_BACKEND).
 *
 * Pinned: with pools running, a task with no wired handler settles failed
 * NO_BACKEND; wired tasks still wake their pools untouched.
 *
 * Mocks: Prisma boundary, the runner (pools running, kick recorded), job
 * events. finishFailed itself runs REAL (the settle semantics are the
 * behavior under test).
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'

const jobRows = new Map<string, Record<string, unknown>>()
const jobEvents: Array<Record<string, unknown>> = []
const kickLog: string[] = []

const fakeDb = {
  generationJob: {
    findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
      const row = jobRows.get(where.id)
      if (!row) return null
      return select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = jobRows.get(where.id)
      if (!row) throw new Error('job not found')
      Object.assign(row, data)
      return row
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let n = 0
      const statusFilter = where.status as string[] | { in: string[] } | undefined
      const allowed =
        statusFilter === undefined
          ? null
          : Array.isArray(statusFilter)
            ? statusFilter
            : statusFilter.in
      for (const row of jobRows.values()) {
        if (where.id && row.id !== where.id) continue
        if (allowed && !allowed.includes(row.status as string)) continue
        Object.assign(row, data)
        n++
      }
      return { count: n }
    },
  },
}
mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/ai-engine/runner', () => ({
  poolsRunning: () => true,
  kickProduct: (p: string) => kickLog.push(p),
}))
mock.module('@/lib/ai-engine/events', () => ({
  appendJobEventSafe: async (jobId: string, type: string, data: Record<string, unknown>) => {
    jobEvents.push({ jobId, type, data })
  },
  appendJobEvent: async () => undefined,
}))

const { enqueueJob } = await import('../../src/lib/jobs/queue')

function makeJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = {
    id: 'job-fg1',
    userId: 'user-1',
    product: 'gangzii',
    task: 'speech-synthesis',
    status: 'queued',
    attempts: 1,
    maxAttempts: 2,
    paramsJson: '{}',
    resultJson: null,
    ...overrides,
  }
  jobRows.set(row.id as string, row)
  return row
}

beforeEach(() => {
  jobRows.clear()
  jobEvents.length = 0
  kickLog.length = 0
})

describe('M26 F-G1 — unwired tasks settle honestly', () => {
  // GANGZII AUDIO WIRING (2026-11-18): speech-synthesis / transcription /
  // conversion now have REAL handlers and are claimed by the gangzii pool
  // like every other wired task (pinned by the wake expectations below).
  // The NO_BACKEND settle contract itself is preserved — pinned here with
  // music-generation, which still has no configured backend (the route
  // refuses honestly; nothing may park forever).
  test('a task with no wired handler settles failed NO_BACKEND (never parked forever)', async () => {
    const row = makeJob({ task: 'music-generation' })
    enqueueJob(row.id as string)
    // the settle runs inside the fire-and-forget envelope
    await new Promise((r) => setTimeout(r, 20))
    expect(row.status).toBe('failed')
    expect(row.errorCode).toBe('NO_BACKEND')
    expect(row.errorClass).toBe('permanent')
    expect(row.finishedAt).toBeTruthy()
    // an honest terminal error event was recorded
    expect(jobEvents.some((e) => e.type === 'error' && (e.data as Record<string, unknown>).code === 'NO_BACKEND')).toBe(true)
    // no pool was woken for a task nothing can claim
    expect(kickLog.length).toBe(0)
  })

  test('the wired GANGZII audio tasks wake their pool like every wired task', async () => {
    const t1 = makeJob({ id: 'job-fg1-tts2', task: 'speech-synthesis' })
    const t2 = makeJob({ id: 'job-fg1-conv', task: 'audio-transcription' })
    const t3 = makeJob({ id: 'job-fg1-conv2', task: 'audio-conversion' })
    enqueueJob(t1.id as string)
    enqueueJob(t2.id as string)
    enqueueJob(t3.id as string)
    await new Promise((r) => setTimeout(r, 20))
    expect(t1.status).toBe('queued') // untouched — the pool will claim it
    expect(t2.status).toBe('queued')
    expect(t3.status).toBe('queued')
    expect(t1.errorCode).toBeUndefined()
    expect(t2.errorCode).toBeUndefined()
    expect(t3.errorCode).toBeUndefined()
  })

  test('a wired task (video-generation) still wakes its pools untouched', async () => {
    const row = makeJob({ id: 'job-fg1-video', product: 'jazmii', task: 'video-generation' })
    enqueueJob(row.id as string)
    await new Promise((r) => setTimeout(r, 20))
    expect(row.status).toBe('queued') // untouched — the pool will claim it
    expect(row.errorCode).toBeUndefined()
    expect(kickLog).toEqual(['riishe', 'laxii', 'jazmii', 'code-giftz', 'gangzii'])
  })
})
