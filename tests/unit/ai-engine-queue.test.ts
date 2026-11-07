/**
 * BACKGROUND AI ENGINE — durable queue unit tests.
 *
 * The ONLY mock is the Prisma boundary (in-memory fakes). The queue logic
 * under test is the real engine code: CAS claims, lease semantics, honest
 * failure classification, the bounded RETRY_WAIT policy (rate-limit is
 * NEVER retried), cancel settlement, recovery takeover and the append-only
 * event log.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'

// ---- in-memory Prisma fake --------------------------------------------------
interface FakeJob {
  id: string
  userId: string
  product: string
  task: string
  status: string
  progress: number
  paramsJson: string
  resultJson: string | null
  errorCode: string | null
  errorMessage: string | null
  backendId: string | null
  capability: string | null
  workerId: string | null
  workerKind: string | null
  leaseUntil: Date | null
  heartbeatAt: Date | null
  attempts: number
  maxAttempts: number
  nextRunAt: Date | null
  errorClass: string | null
  dedupeKey: string | null
  cancelRequested: boolean
  queuedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

const jobStore = new Map<string, FakeJob>()
const eventStore = new Map<string, { id: string; jobId: string; seq: number; type: string; dataJson: string; createdAt: Date }>()

function makeJob(partial: Partial<FakeJob>): FakeJob {
  return {
    id: partial.id ?? `job_${Math.random().toString(36).slice(2, 10)}`,
    userId: 'user-1',
    product: 'riishe',
    task: 'chat',
    status: 'queued',
    progress: 0,
    paramsJson: '{}',
    resultJson: null,
    errorCode: null,
    errorMessage: null,
    backendId: null,
    capability: 'chat',
    workerId: null,
    workerKind: null,
    leaseUntil: null,
    heartbeatAt: null,
    attempts: 0,
    maxAttempts: 2,
    nextRunAt: null,
    errorClass: null,
    dedupeKey: null,
    cancelRequested: false,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    ...partial,
  }
}

function matchesWhere(row: unknown, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR' && Array.isArray(v)) {
      if (!v.some((sub) => matchesWhere(row, sub as Record<string, unknown>))) return false
      continue
    }
    if (k === 'AND' && Array.isArray(v)) {
      if (!v.every((sub) => matchesWhere(row, sub as Record<string, unknown>))) return false
      continue
    }
    if (v === null) {
      if ((row as Record<string, unknown>)[k] !== null) return false
      continue
    }
    if (v === undefined) continue
    const rv = (row as Record<string, unknown>)[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('in' in (v as Record<string, unknown>)) {
        const list = (v as { in: unknown[] }).in
        if (!list.includes(rv)) return false
        continue
      }
      if ('lt' in (v as Record<string, unknown>)) {
        const lim = (v as { lt: Date }).lt
        if (!(rv instanceof Date && rv < lim)) return false
        continue
      }
      if ('lte' in (v as Record<string, unknown>)) {
        const lim = (v as { lte: Date }).lte
        if (!(rv instanceof Date && rv <= lim)) return false
        continue
      }
      if ('gt' in (v as Record<string, unknown>)) {
        const lim = (v as { gt: number }).gt
        if (!(typeof rv === 'number' && rv > lim)) return false
        continue
      }
      if ('not' in (v as Record<string, unknown>)) {
        if (rv === (v as { not: unknown }).not) return false
        continue
      }
      if (!matchesWhere(rv, v as Record<string, unknown>)) return false
      continue
    }
    if (v instanceof Date) {
      if (!(rv instanceof Date) || rv.getTime() !== v.getTime()) return false
      continue
    }
    if (rv !== v) return false
  }
  return true
}

function applyData(row: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(data)) {
    if (k === 'attempts' && typeof v === 'number') {
      row[k] = v // engine writes computed values, no increments used
      continue
    }
    row[k] = v
  }
}

const fakeDb = {
  $transaction: async <T>(fn: (tx: typeof fakeDb) => Promise<T>): Promise<T> => fn(fakeDb),
  generationJob: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      for (const job of jobStore.values()) {
        if (matchesWhere(job, where)) return job
      }
      return null
    },
    findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) => {
      const rows: FakeJob[] = []
      for (const job of jobStore.values()) {
        if (matchesWhere(job, where)) rows.push(job)
        if (take && rows.length >= take) break
      }
      return rows
    },
    findUnique: async ({ where }: { where: { id: string } }) => jobStore.get(where.id) ?? null,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0
      for (const job of jobStore.values()) {
        if (matchesWhere(job, where)) {
          applyData(job as unknown as Record<string, unknown>, data)
          count += 1
        }
      }
      return { count }
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const job = jobStore.get(where.id)
      if (!job) throw new Error('job not found')
      applyData(job as unknown as Record<string, unknown>, data)
      return job
    },
    count: async ({ where }: { where: Record<string, unknown> }) => {
      let n = 0
      for (const job of jobStore.values()) if (matchesWhere(job, where)) n += 1
      return n
    },
    groupBy: async () => [],
  },
  jobEvent: {
    findFirst: async ({ where, orderBy }: { where: { jobId: string }; orderBy?: { seq: string } }) => {
      const rows = [...eventStore.values()].filter((e) => e.jobId === where.jobId)
      rows.sort((a, b) => (orderBy?.seq === 'desc' ? b.seq - a.seq : a.seq - b.seq))
      return rows[0] ?? null
    },
    create: async ({ data }: { data: { jobId: string; seq: number; type: string; dataJson: string } }) => {
      const row = { id: `ev_${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date(), ...data }
      eventStore.set(row.id, row)
      return row
    },
    findMany: async ({ where, orderBy }: { where: { jobId: string; seq?: { gt: number } }; orderBy?: { seq: string } }) => {
      const rows = [...eventStore.values()].filter(
        (e) => e.jobId === where.jobId && (where.seq ? e.seq > where.seq.gt : true),
      )
      rows.sort((a, b) => (orderBy?.seq === 'desc' ? b.seq - a.seq : a.seq - b.seq))
      return rows
    },
    deleteMany: async () => ({ count: 0 }),
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

// config: deterministic small lease for tests
process.env.BEAN_ENGINE_LEASE_MS = '15000'
process.env.BEAN_ENGINE_HEARTBEAT_MS = '5000'

const { claimNextJob, finishFailed, finishCompleted, requestCancel, recoverStaleJobs, dedupeKeyFor, hasActiveDuplicate, transitionJob } = await import('../../src/lib/ai-engine/queue')
const { appendJobEvent, getEventsSince, latestEventSeq } = await import('../../src/lib/ai-engine/events')
const { normalizeStatusForProduct } = await import('../../src/lib/ai-engine/types')

beforeEach(() => {
  jobStore.clear()
  eventStore.clear()
})

describe('engine queue — claims', () => {
  test('claims a queued job exactly once (CAS)', async () => {
    jobStore.set('j1', makeJob({ id: 'j1' }))
    const c1 = await claimNextJob({ workerId: 'w1', workerKind: 'standalone' })
    expect(c1?.id).toBe('j1')
    expect(c1?.status).toBe('starting')
    expect(c1?.attempts).toBe(1)
    const row = jobStore.get('j1')!
    expect(row.status).toBe('starting')
    expect(row.workerId).toBe('w1')
    expect(row.leaseUntil).toBeInstanceOf(Date)
    expect(row.attempts).toBe(1)
    // A second claimer cannot win (status no longer queued).
    const c2 = await claimNextJob({ workerId: 'w2', workerKind: 'standalone' })
    expect(c2).toBeNull()
  })

  test('claims oldest first and respects retry_wait scheduling', async () => {
    const old = new Date(Date.now() - 60_000)
    jobStore.set('j-old', makeJob({ id: 'j-old', queuedAt: old }))
    jobStore.set('j-new', makeJob({ id: 'j-new', queuedAt: new Date() }))
    jobStore.set('j-future', makeJob({ id: 'j-future', status: 'retry_wait', nextRunAt: new Date(Date.now() + 60_000) }))
    const first = await claimNextJob({ workerId: 'w1', workerKind: 'embedded' })
    expect(first?.id).toBe('j-old')
    const second = await claimNextJob({ workerId: 'w1', workerKind: 'embedded' })
    expect(second?.id).toBe('j-new')
    const third = await claimNextJob({ workerId: 'w1', workerKind: 'embedded' })
    expect(third).toBeNull() // j-future is not due yet
  })

  test('claim restricted to one product', async () => {
    jobStore.set('j-laxii', makeJob({ id: 'j-laxii', product: 'laxii', task: 'image-generation' }))
    const c = await claimNextJob({ workerId: 'w1', workerKind: 'embedded', product: 'riishe' })
    expect(c).toBeNull()
    const c2 = await claimNextJob({ workerId: 'w1', workerKind: 'embedded', product: 'laxii' })
    expect(c2?.id).toBe('j-laxii')
  })

  test('a queued job with cancelRequested settles as cancelled instead of running', async () => {
    jobStore.set('j-c', makeJob({ id: 'j-c', cancelRequested: true }))
    const c = await claimNextJob({ workerId: 'w1', workerKind: 'embedded' })
    expect(c).toBeNull()
    expect(jobStore.get('j-c')!.status).toBe('cancelled')
    expect(jobStore.get('j-c')!.errorCode).toBe('CANCELLED')
  })
})

describe('engine queue — honest failure policy', () => {
  test('rate_limited fails terminally — a throttled account is NEVER retried', async () => {
    jobStore.set('j-r', makeJob({ id: 'j-r', status: 'running', workerId: 'w1', attempts: 1 }))
    const out = await finishFailed('j-r', 'w1', {
      errorClass: 'rate_limited',
      errorCode: 'UPSTREAM_RATE_LIMITED',
      errorMessage: 'The AI provider is rate limiting this account. The request was not repeated.',
    })
    expect(out.terminal).toBe(true)
    expect(out.retryWait).toBe(false)
    const row = jobStore.get('j-r')!
    expect(row.status).toBe('failed')
    expect(row.errorClass).toBe('rate_limited')
    expect(row.finishedAt).toBeInstanceOf(Date)
  })

  test('timeout with remaining budget goes RETRY_WAIT with scheduled next run', async () => {
    jobStore.set('j-t', makeJob({ id: 'j-t', status: 'running', workerId: 'w1', attempts: 1, maxAttempts: 2 }))
    const out = await finishFailed('j-t', 'w1', {
      errorClass: 'timeout',
      errorCode: 'BACKEND_TIMEOUT',
      errorMessage: 'The provider did not respond in time.',
    })
    expect(out.retryWait).toBe(true)
    const row = jobStore.get('j-t')!
    expect(row.status).toBe('retry_wait')
    expect(row.nextRunAt).toBeInstanceOf(Date)
    expect(row.workerId).toBeNull()
    expect(row.attempts).toBe(1) // attempts increments at claim, not at failure
  })

  test('timeout with exhausted budget fails terminally', async () => {
    jobStore.set('j-t2', makeJob({ id: 'j-t2', status: 'running', workerId: 'w1', attempts: 2, maxAttempts: 2 }))
    const out = await finishFailed('j-t2', 'w1', {
      errorClass: 'timeout',
      errorCode: 'BACKEND_TIMEOUT',
      errorMessage: 'The provider did not respond in time.',
    })
    expect(out.terminal).toBe(true)
    expect(jobStore.get('j-t2')!.status).toBe('failed')
  })

  test('wrong worker cannot settle a job it does not own', async () => {
    jobStore.set('j-o', makeJob({ id: 'j-o', status: 'running', workerId: 'owner', attempts: 1 }))
    const done = await finishCompleted('j-o', 'intruder', { fake: true })
    expect(done).toBe(false)
    expect(jobStore.get('j-o')!.status).toBe('running')
  })
})

describe('engine queue — cancel + recovery', () => {
  test('cancel settles queued jobs and signals running ones', async () => {
    jobStore.set('j-q', makeJob({ id: 'j-q', status: 'queued' }))
    expect(await requestCancel('j-q', 'user-1')).toBe('cancelled')
    expect(jobStore.get('j-q')!.status).toBe('cancelled')

    jobStore.set('j-run', makeJob({ id: 'j-run', status: 'running', workerId: 'w1' }))
    expect(await requestCancel('j-run', 'user-1')).toBe('signalled')
    expect(jobStore.get('j-run')!.status).toBe('running')
    expect(jobStore.get('j-run')!.cancelRequested).toBe(true)
  })

  test('cancel is ownership-checked', async () => {
    jobStore.set('j-x', makeJob({ id: 'j-x', status: 'queued' }))
    expect(await requestCancel('j-x', 'someone-else')).toBe('not_found')
    expect(jobStore.get('j-x')!.status).toBe('queued')
  })

  test('recovery requeues lease-expired jobs (WORKER_LOST) up to budget', async () => {
    jobStore.set('j-lost', makeJob({ id: 'j-lost', status: 'running', workerId: 'dead-worker', attempts: 1, maxAttempts: 2, leaseUntil: new Date(Date.now() - 1000) }))
    const out = await recoverStaleJobs()
    expect(out.requeued).toBe(1)
    const row = jobStore.get('j-lost')!
    expect(row.status).toBe('retry_wait')
    expect(row.errorClass).toBe('worker_lost')
    expect(row.workerId).toBeNull()
  })

  test('recovery fails lease-expired jobs with exhausted budget', async () => {
    jobStore.set('j-dead', makeJob({ id: 'j-dead', status: 'running', workerId: 'dead-worker', attempts: 2, maxAttempts: 2, leaseUntil: new Date(Date.now() - 1000) }))
    const out = await recoverStaleJobs()
    expect(out.failed).toBe(1)
    expect(jobStore.get('j-dead')!.status).toBe('failed')
    expect(jobStore.get('j-dead')!.errorCode).toBe('WORKER_LOST')
  })

  test('recovery leaves healthy leases alone', async () => {
    jobStore.set('j-live', makeJob({ id: 'j-live', status: 'running', workerId: 'w1', attempts: 1, leaseUntil: new Date(Date.now() + 60_000) }))
    const out = await recoverStaleJobs()
    expect(out.requeued + out.failed).toBe(0)
    expect(jobStore.get('j-live')!.status).toBe('running')
  })
})

describe('engine events + transitions + dedupe', () => {
  test('event log is append-only with monotonic per-job seq', async () => {
    const s1 = await appendJobEvent('j-e', 'delta', { delta: 'a' })
    const s2 = await appendJobEvent('j-e', 'delta', { delta: 'b' })
    const s3 = await appendJobEvent('j-other', 'stage', { stage: 'solving' })
    expect([s1, s2, s3]).toEqual([0, 1, 0])
    expect(await latestEventSeq('j-e')).toBe(1)
    const afterFirst = await getEventsSince('j-e', 0)
    expect(afterFirst).toHaveLength(1)
    expect((afterFirst[0].data as { delta: string }).delta).toBe('b')
  })

  test('transitionJob moves active states and respects ownership', async () => {
    jobStore.set('j-tr', makeJob({ id: 'j-tr', status: 'starting', workerId: 'w1' }))
    expect(await transitionJob('j-tr', 'w1', 'running', { progress: 25 })).toBe(true)
    expect(jobStore.get('j-tr')!.status).toBe('running')
    expect(jobStore.get('j-tr')!.progress).toBe(25)
    expect(await transitionJob('j-tr', 'w2', 'finalizing')).toBe(false)
  })

  test('dedupeKey is stable per payload and duplicate detection works', async () => {
    const k1 = dedupeKeyFor('u1', 'riishe', 'chat', { message: 'hi', conversationId: 'c1' })
    const k2 = dedupeKeyFor('u1', 'riishe', 'chat', { message: 'hi', conversationId: 'c1' })
    const k3 = dedupeKeyFor('u1', 'riishe', 'chat', { message: 'hello', conversationId: 'c1' })
    expect(k1).toBe(k2)
    expect(k1).not.toBe(k3)

    jobStore.set('j-dup', makeJob({ id: 'j-dup', dedupeKey: k1, status: 'running', workerId: 'w1' }))
    expect(await hasActiveDuplicate(k1)).toBe(true)
    jobStore.get('j-dup')!.status = 'completed'
    expect(await hasActiveDuplicate(k1)).toBe(false)
  })

  test('legacy status normalization preserves product interfaces', () => {
    expect(normalizeStatusForProduct('queued')).toBe('queued')
    expect(normalizeStatusForProduct('starting')).toBe('running')
    expect(normalizeStatusForProduct('streaming')).toBe('running')
    expect(normalizeStatusForProduct('finalizing')).toBe('running')
    expect(normalizeStatusForProduct('retry_wait')).toBe('queued')
    expect(normalizeStatusForProduct('completed')).toBe('completed')
    expect(normalizeStatusForProduct('failed')).toBe('failed')
    expect(normalizeStatusForProduct('cancelled')).toBe('cancelled')
  })
})
