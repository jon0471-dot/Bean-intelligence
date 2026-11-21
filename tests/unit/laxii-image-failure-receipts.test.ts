/**
 * TRUST SPECIALIST COVERAGE — LAXII image-generation failure-path receipts.
 *
 * The completion and cancellation receipts existed; the milestone wires every
 * TERMINAL failure of the T2I processor into the shared Trust Engine. Pinned:
 *  - a provider failure that exhausts its bounded retries settles the trust
 *    receipt FAILED with the real error class — the attempt happened and
 *    produced nothing (never silently unreceipted);
 *  - invalid dimensions (no provider call at all) still leaves an honest
 *    receipt;
 *  - throttle exhaustion (bounded retry budget spent) leaves an honest
 *    receipt;
 *  - a parked retry_wait is NOT terminal — no receipt is settled for it;
 *  - double settlement is idempotent: one job never produces two receipts.
 *
 * Mocks: Prisma boundary (incl. trust tables via the trust fake-db idiom),
 * image adapter, intel layers, asset store, job events, quota gate. NO real
 * network.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import sharp from 'sharp'
import { _resetUpstreamCooldownForTests } from '../../src/lib/upstream/gateway'
import { createTrustFakeDb } from '../helpers/trust-fake-db'

// ---- in-memory Prisma fake -------------------------------------------------
const jobRows = new Map<string, Record<string, unknown>>()
const usageRows: Array<Record<string, unknown>> = []
const auditRows: Array<Record<string, unknown>> = []
const jobEvents: Array<Record<string, unknown>> = []

function jobWhere(id: string, extra: Record<string, unknown>): Record<string, unknown> | null {
  const row = jobRows.get(id)
  if (!row) return null
  for (const [k, v] of Object.entries(extra)) {
    if (row[k] !== v) return null
  }
  return row
}

const trust = createTrustFakeDb()

const fakeDb = {
  generationJob: {
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = jobRows.get(where.id)
      if (!row) throw new Error('job not found')
      Object.assign(row, data)
      return row
    },
    findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
      const row = jobRows.get(where.id)
      if (!row) return null
      return select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) : row
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = jobWhere(where.id as string, where)
      if (!row) return { count: 0 }
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
  auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => (auditRows.push(data), data) },
  ...trust.fakeDb,
}
mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/ai-engine/events', () => ({
  appendJobEventSafe: async (jobId: string, type: string, data: Record<string, unknown>) => {
    jobEvents.push({ jobId, type, data })
  },
  appendJobEvent: async () => undefined,
}))
mock.module('@/lib/adapters/hosted-image', () => ({
  ImageProviderResponseError: class ImageProviderResponseError extends Error {
    providerDetail?: string
    bodyKeys?: string[]
    httpStatus?: number
  },
  hostedImageAdapter: {
    backendId: 'bean-image-hosted-primary',
    health: async () => ({ healthy: true, checkedAt: '', latencyMs: 1, detail: 'ok' }),
    generateImage: async () => {
      generateCalls += 1
      const step = generateScript[Math.min(generateCalls - 1, generateScript.length - 1)]
      return step()
    },
    editImage: async () => {
      throw new Error('editImage must not be reached')
    },
  },
}))
mock.module('@/lib/adapters/hosted-llm', () => ({
  withTimeout: async <T>(p: Promise<T>): Promise<T> => p,
  sseDeltas: async function* () {},
}))
mock.module('@/lib/intel/grounding', () => ({
  prepareImageIntelligence: async (prompt: string) => ({
    conditionedPrompt: prompt,
    mode: 'unconditional',
    promptLanguage: 'en',
    knowledgeKeys: [],
    sceneSpec: null,
    evidence: [],
    degraded: ['mocked'],
    conditioning: '',
    timing: {},
  }),
}))
mock.module('@/lib/intel/continuity', () => ({
  verifyGeneratedImage: async () => ({
    checked: false,
    method: 'unavailable',
    defects: [],
    observation: null,
    checkedAt: new Date().toISOString(),
    durationMs: 0,
    reason: 'mocked off',
  }),
  imageBufferToDataUrl: async () => 'data:image/jpeg;base64,moq',
}))
mock.module('@/lib/laxii/assets', () => ({
  storeResultAsset: async () => ({ url: '/mock', id: 'mock' }),
}))
mock.module('@/lib/providers/account-quota', () => ({
  automatedQuotaState: async () => ({ automatedAllowed: true }),
  automatedSkipReason: () => null,
}))

let generateCalls = 0
const generateScript: Array<() => Promise<unknown>> = []

const { processImageJob } = await import('../../src/lib/jobs/image-worker')
const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')

const PNG_1024 = await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: 'white' },
})
  .png()
  .toBuffer()

function makeJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = {
    id: 'job-trust-fail',
    userId: 'user-trust',
    product: 'laxii',
    task: 'image-generation',
    status: 'running',
    workerId: 'worker-claim-1',
    cancelRequested: false,
    paramsJson: JSON.stringify({ prompt: 'a quiet harbor at dawn', size: '1024x1024' }),
    resultJson: null,
    ...overrides,
  }
  jobRows.set(row.id as string, row)
  return row
}

beforeEach(() => {
  jobRows.clear()
  usageRows.length = 0
  auditRows.length = 0
  jobEvents.length = 0
  generateCalls = 0
  generateScript.length = 0
  trust.reset()
  _resetUpstreamCooldownForTests()
})

describe('LAXII failure paths settle honest Trust receipts', () => {
  test('generic backend failure → receipt failed with the real class and reason', async () => {
    const row = makeJob()
    generateScript.push(async () => {
      throw new Error('the image backend socket died mid-request')
    })
    await processImageJob(row as never)
    expect(row.status).toBe('failed')
    expect(trust.trustTask.rows.length).toBe(1)
    const receipt = await composeTrustReceipt(trust.trustTask.rows[0].id as string, 'user-trust')
    expect(receipt!.task.status).toBe('failed')
    expect(receipt!.task.failureNote).toContain('BACKEND_FAILURE')
    expect(receipt!.task.failureNote).toContain('socket died')
    expect(receipt!.task.limitations.some((l) => l.includes('No artifact was delivered'))).toBe(true)
    const gen = receipt!.steps.find((s) => s.kind === 'generation')!
    expect(gen.status).toBe('failed')
    // the bounded request preview is the owner's own data, present and bounded
    expect(receipt!.task.requestPreview).toContain('quiet harbor')
  })

  test('invalid dimensions → receipt failed BEFORE any provider call (no provider spend)', async () => {
    const row = makeJob({
      id: 'job-bad-dims',
      paramsJson: JSON.stringify({ prompt: 'x', width: 3, height: 999999 }),
    })
    await processImageJob(row as never)
    expect(row.status).toBe('failed')
    expect(generateCalls).toBe(0)
    expect(trust.trustTask.rows.length).toBe(1)
    const receipt = await composeTrustReceipt(trust.trustTask.rows[0].id as string, 'user-trust')
    expect(receipt!.task.status).toBe('failed')
    expect(receipt!.task.failureNote).toContain('INVALID_DIMENSIONS')
  })

  test('malformed provider response after the bounded retries → receipt failed', async () => {
    const { ImageProviderResponseError } = (await import('../../src/lib/adapters/hosted-image')) as {
      ImageProviderResponseError: new (message: string) => Error
    }
    const row = makeJob({ id: 'job-malformed' })
    generateScript.push(async () => {
      throw new ImageProviderResponseError('provider returned an incomplete response')
    })
    // Each park re-claims the SAME row with its persisted retry budget (the
    // engine's re-execution contract) — drive until the terminal failure.
    for (let i = 0; i < 6; i++) {
      await processImageJob(row as never)
      if (row.status === 'failed') break
    }
    expect(row.status).toBe('failed')
    expect(row.errorCode).toBe('UPSTREAM_RESPONSE_INVALID')
    expect(trust.trustTask.rows.length).toBe(1)
    const receipt = await composeTrustReceipt(trust.trustTask.rows[0].id as string, 'user-trust')
    expect(receipt!.task.status).toBe('failed')
    expect(receipt!.task.failureNote).toContain('UPSTREAM_RESPONSE_INVALID')
  })

  test('a parked retry_wait is NOT terminal — no receipt is settled yet', async () => {
    const row = makeJob({ id: 'job-parked' })
    // One transient failure with retries still available parks the job.
    const { ImageProviderResponseError } = (await import('../../src/lib/adapters/hosted-image')) as {
      ImageProviderResponseError: new (message: string) => Error
    }
    generateScript.push(async () => {
      throw new ImageProviderResponseError('incomplete response (transient)')
    })
    await processImageJob(row as never)
    expect(row.status).toBe('retry_wait')
    expect(trust.trustTask.rows.length).toBe(0)
  })

  test('throttle exhaustion → receipt failed with the exhausted budget story', async () => {
    const { UpstreamRateLimitError } = await import('../../src/lib/upstream/gateway')
    const row = makeJob({ id: 'job-throttled' })
    // IMAGE_MAX_GENERATION_ATTEMPTS real 429 attempts, each re-claimed with
    // prior attempt state in resultJson (the engine's parked re-execution).
    const { IMAGE_MAX_GENERATION_ATTEMPTS } = await import('../../src/lib/jobs/image-worker')
    for (let i = 0; i < Number(IMAGE_MAX_GENERATION_ATTEMPTS); i++) {
      const prior = i > 0 ? JSON.stringify({ submissionAttempts: i, throttleWaitMs: 0 }) : null
      const currentRow = jobRows.get('job-throttled')!
      currentRow.resultJson = prior
      generateScript.push(async () => {
        throw new UpstreamRateLimitError('account-wide throttle window', 429, { attempted: true })
      })
      await processImageJob(currentRow as never)
      if ((currentRow.status as string) === 'failed') break
    }
    expect(jobRows.get('job-throttled')!.status).toBe('failed')
    const receipt = await composeTrustReceipt(trust.trustTask.rows[0].id as string, 'user-trust')
    expect(receipt!.task.status).toBe('failed')
    expect(receipt!.task.failureNote).toContain('RATE_LIMITED')
  })

  test('settlement is idempotent — a replayed terminal event never creates a second receipt', async () => {
    const row = makeJob({ id: 'job-idem' })
    generateScript.push(async () => {
      throw new Error('backend exploded')
    })
    await processImageJob(row as never)
    const receiptsAfterFirst = trust.trustTask.rows.length
    // A late duplicate of the same terminal failure (e.g. a replayed settle)
    // must not produce a second receipt for the same job.
    const { recordMediaJobFailure } = await import('../../src/lib/trust/adapters/media')
    await recordMediaJobFailure(
      { userId: 'user-trust', product: 'laxii', kind: 'image-generation', jobId: 'job-idem', requestPreview: 'x' },
      { errorCode: 'BACKEND_FAILURE', errorMessage: 'backend exploded' },
    )
    expect(trust.trustTask.rows.length).toBe(receiptsAfterFirst)
    expect(receiptsAfterFirst).toBe(1)
  })
})
