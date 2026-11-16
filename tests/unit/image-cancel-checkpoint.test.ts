/**
 * BEAN Intelligence — M26 F-1 regression: cancellation contract for the
 * LAXII text-to-image processor.
 *
 * The cancel route documents "the worker will stop at its next checkpoint";
 * the audit found the T2I processor had NO checkpoints and completed an
 * unconditional write — a cancelled RUNNING job generated, stored the
 * artifact and flipped the row to completed/100.
 *
 * Pinned now:
 *  - cancel BEFORE generation → settled 'cancelled', ZERO provider calls,
 *    zero usage rows;
 *  - cancel DURING generation (raced) → provider call completes but the
 *    completion write REFUSES (guarded CAS), the row settles 'cancelled',
 *    no artifact is delivered, and the provider spend is metered honestly
 *    as a cancelled failure (never under-counted);
 *  - NO cancel → the happy path still completes (the new guard never
 *    breaks legitimate completions).
 *
 * Mocks: Prisma boundary (incl. findUnique/updateMany), image adapter,
 * intel layers, asset store, job events, quota gate. NO real network.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import sharp from 'sharp'
import { _resetUpstreamCooldownForTests } from '../../src/lib/upstream/gateway'

// ---- in-memory Prisma fake (findUnique + updateMany + update + create) -----
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
}
mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/ai-engine/events', () => ({
  appendJobEventSafe: async (jobId: string, type: string, data: Record<string, unknown>) => {
    jobEvents.push({ jobId, type, data })
  },
  appendJobEvent: async () => undefined,
}))
mock.module('@/lib/adapters/hosted-image', () => ({
  ImageProviderResponseError: class ImageProviderResponseError extends Error {},
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

const PNG_1024 = await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: 'white' },
})
  .png()
  .toBuffer()

function makeJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = {
    id: 'job-f1-cancel',
    userId: 'user-f1',
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
  _resetUpstreamCooldownForTests()
})

describe('M26 F-1 — cancelled image jobs never complete', () => {
  test('cancel BEFORE generation: settled cancelled, ZERO provider calls, zero usage', async () => {
    makeJob({ cancelRequested: true })
    await processImageJob(makeJob({ cancelRequested: true }) as never)
    const row = jobRows.get('job-f1-cancel')!
    expect(row.status).toBe('cancelled')
    expect(row.errorCode).toBe('CANCELLED')
    expect(generateCalls).toBe(0)
    expect(usageRows.length).toBe(0)
  })

  test('cancel DURING generation (raced): completion write refused, spend metered, no artifact', async () => {
    const row = makeJob()
    generateScript.push(async () => {
      // the user cancels while the provider call is in flight
      row.cancelRequested = true
      return { bytes: PNG_1024, format: 'png', durationMs: 15 }
    })
    await processImageJob(row as never)
    expect(row.status).toBe('cancelled')
    expect(row.errorCode).toBe('CANCELLED')
    expect(row.progress).not.toBe(100)
    expect((row.resultJson as string | null) ?? '').not.toContain('imageUrl')
    // provider spend metered honestly as a cancelled failure (never under-count)
    const cancelledUsage = usageRows.filter((u) => u.errorCode === 'CANCELLED')
    expect(cancelledUsage.length).toBe(1)
    expect(usageRows.filter((u) => u.success === true).length).toBe(0)
  })

  test('NO cancel: the happy path still completes (guard never breaks legit completions)', async () => {
    const row = makeJob()
    generateScript.push(async () => ({ bytes: PNG_1024, format: 'png', durationMs: 15 }))
    await processImageJob(row as never)
    expect(row.status).toBe('completed')
    expect(row.progress).toBe(100)
    expect((row.resultJson as string)).toContain('imageUrl')
    expect(usageRows.filter((u) => u.success === true).length).toBe(1)
  })
})
