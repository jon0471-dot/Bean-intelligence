/**
 * ZERO-DOWNTIME RECOVERY — LAXII image generation survives throttle windows.
 *
 * Pinned behavior (brief §3: "Queue requests when temporary throttling makes
 * immediate execution impossible", "Resume eligible jobs after recovery",
 * "Prevent duplicate submissions and retry storms"):
 *  - a REAL generation 429 PARKS the job (retry_wait) with a breaker-aligned
 *    backoff — never a terminal failure on the first throttle;
 *  - a breaker SKIP (zero network I/O) counts NO attempt and only extends
 *    the wait;
 *  - a provider Retry-After hint, when present on the error, is honored;
 *  - budgets are persisted in resultJson (survive restarts) and bounded both
 *    ways — exhaustion ends in an honest terminal RATE_LIMITED failure;
 *  - no usage row is charged for a parked (non-terminal) attempt.
 *
 * Mocks: Prisma boundary, the image adapter, intel layers, asset store,
 * job events. NO real network, NO fs writes (throttled jobs never reach
 * the artifact-persisting path).
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { _resetUpstreamCooldownForTests, noteUpstream429, UpstreamRateLimitError } from '../../src/lib/upstream/gateway'

// ---- in-memory Prisma fake --------------------------------------------------
const jobRows = new Map<string, Record<string, unknown>>()
const usageRows: Array<Record<string, unknown>> = []
const jobEvents: Array<Record<string, unknown>> = []

const fakeDb = {
  generationJob: {
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = jobRows.get(where.id)
      if (!row) throw new Error('job not found')
      Object.assign(row, data)
      return row
    },
  },
  usageRecord: {
    count: async () => usageRows.length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      usageRows.push(data)
      return data
    },
  },
  auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => (auditRowsPush(data), data) },
}
const auditRows: Array<Record<string, unknown>> = []
function auditRowsPush(d: Record<string, unknown>) {
  auditRows.push(d)
}
mock.module('@/lib/db', () => ({ db: fakeDb }))
mock.module('@/lib/ai-engine/events', () => ({
  appendJobEventSafe: async (jobId: string, type: string, data: Record<string, unknown>) => {
    jobEvents.push({ jobId, type, data })
  },
  appendJobEvent: async () => undefined,
}))

// Scripted image adapter: each generateImage call consumes the next behavior.
const generateScript: Array<() => Promise<unknown>> = []
let generateCalls = 0
mock.module('@/lib/adapters/hosted-image', () => ({
  hostedImageAdapter: {
    backendId: 'bean-image-hosted-primary',
    health: async () => ({ healthy: true, checkedAt: '', latencyMs: 1, detail: 'ok' }),
    generateImage: async (req: unknown) => {
      generateCalls += 1
      const step = generateScript[Math.min(generateCalls - 1, generateScript.length - 1)]
      return step(req)
    },
    editImage: async () => {
      throw new Error('editImage must not be reached in throttle tests')
    },
  },
}))
mock.module('@/lib/adapters/hosted-llm', () => ({
  withTimeout: async <T>(p: Promise<T>): Promise<T> => p,
  // The llamacpp adapter (loaded transitively via the registry backends)
  // imports sseDeltas from this module — provide an inert stub; throttle
  // tests never stream.
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
    reason: 'mocked off in throttle tests',
  }),
  imageBufferToDataUrl: async () => 'data:image/jpeg;base64,moq',
}))
mock.module('@/lib/laxii/assets', () => ({
  storeResultAsset: async () => ({ url: '/mock', id: 'mock' }),
}))

const { processImageJob, imageGenerationBackoffMs, IMAGE_MAX_GENERATION_ATTEMPTS, IMAGE_MAX_CUMULATIVE_THROTTLE_MS } = await import(
  '../../src/lib/jobs/image-worker'
)

function makeJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = {
    id: 'job-throttle-1',
    userId: 'user-1',
    product: 'laxii',
    task: 'image-generation',
    status: 'starting',
    paramsJson: JSON.stringify({ prompt: 'a bridge over a river', size: '1024x1024' }),
    resultJson: null,
    ...overrides,
  }
  jobRows.set(row.id as string, row)
  return row
}

beforeEach(() => {
  _resetUpstreamCooldownForTests()
  jobRows.clear()
  usageRows.length = 0
  jobEvents.length = 0
  auditRows.length = 0
  generateScript.length = 0
  generateCalls = 0
})

const JOB = () => jobRows.get('job-throttle-1')!

describe('image generation throttle parking', () => {
  test('a REAL 429 parks the job (retry_wait) with breaker-aligned backoff — no terminal failure, no usage row', async () => {
    makeJob()
    generateScript.push(async () => {
      noteUpstream429('images') // the real adapter does this before throwing
      throw new UpstreamRateLimitError('images', 'image generation is rate-limited upstream (HTTP 429)', true)
    })
    await processImageJob(JOB() as never)
    const row = JOB()
    expect(row.status).toBe('retry_wait')
    expect(row.errorCode).toBe('RATE_LIMITED')
    expect(String(row.errorMessage)).toContain('stays queued')
    expect(String(row.errorMessage)).toContain('attempt 2 of 3')
    // Backoff is at least the breaker window the real 429 just opened (60s).
    const persisted = JSON.parse(row.resultJson as string)
    expect(persisted.submissionAttempts).toBe(1)
    expect(persisted.throttleWaitMs).toBe(persisted.throttle.backoffMs)
    expect(persisted.throttle.attempted).toBe(true)
    const wait = (row.nextRunAt as Date).getTime() - Date.now()
    expect(wait).toBeGreaterThan(50_000) // breaker-aligned, not an instant retry
    expect(wait).toBeLessThanOrEqual(600_000)
    expect(usageRows).toHaveLength(0) // parked ≠ failed: nothing charged yet
    expect(jobEvents.some((e) => (e.data as Record<string, unknown>).generation_throttled === true)).toBe(true)
  })

  test('a breaker SKIP counts NO attempt and only extends the wait', async () => {
    makeJob()
    noteUpstream429('images') // breaker already open
    generateScript.push(async () => {
      throw new UpstreamRateLimitError('images', 'image generation not attempted: rate-limited moments ago', false)
    })
    await processImageJob(JOB() as never)
    const row = JOB()
    expect(row.status).toBe('retry_wait')
    const persisted = JSON.parse(row.resultJson as string)
    expect(persisted.submissionAttempts).toBe(0) // no attempt consumed
    expect(persisted.throttle.attempted).toBe(false)
    expect(String(row.errorMessage)).toContain('no generation was attempted')
  })

  test('a provider Retry-After hint on the error is honored (clamped to bounds)', async () => {
    makeJob()
    generateScript.push(async () => {
      throw new UpstreamRateLimitError('images', 'HTTP 429', true, 90_000)
    })
    await processImageJob(JOB() as never)
    const persisted = JSON.parse(JOB().resultJson as string)
    expect(persisted.throttle.backoffMs).toBe(90_000)
  })

  test('exhaustion (attempts budget) ends in an honest terminal failure with history', async () => {
    makeJob({ resultJson: JSON.stringify({ submissionAttempts: 2, throttleWaitMs: 120_000 }) })
    generateScript.push(async () => {
      noteUpstream429('images')
      throw new UpstreamRateLimitError('images', 'HTTP 429 again', true)
    })
    await processImageJob(JOB() as never)
    const row = JOB()
    expect(row.status).toBe('failed')
    expect(row.errorCode).toBe('RATE_LIMITED')
    expect(String(row.errorMessage)).toContain('kept throttling')
    expect(String(row.errorMessage)).toContain('no image was produced')
    const persisted = JSON.parse(row.resultJson as string)
    expect(persisted.submissionAttempts).toBe(3)
    expect(usageRows).toHaveLength(1) // terminal failure IS charged
    expect((usageRows[0] as Record<string, unknown>).errorCode).toBe('RATE_LIMITED')
  })

  test('exhaustion (cumulative wait budget) also ends terminally', async () => {
    makeJob({ resultJson: JSON.stringify({ submissionAttempts: 1, throttleWaitMs: IMAGE_MAX_CUMULATIVE_THROTTLE_MS }) })
    generateScript.push(async () => {
      noteUpstream429('images')
      throw new UpstreamRateLimitError('images', 'HTTP 429', true)
    })
    await processImageJob(JOB() as never)
    expect(JOB().status).toBe('failed')
  })

  test('non-throttle failures still fail terminally (unchanged behavior)', async () => {
    makeJob()
    generateScript.push(async () => new Error('Function invoke failed with status 400: bad request'))
    await processImageJob(JOB() as never)
    const row = JOB()
    expect(row.status).toBe('failed')
    expect(row.errorCode).toBe('BACKEND_FAILURE')
  })
})

describe('imageGenerationBackoffMs (pure)', () => {
  test('Retry-After wins and is clamped to [5s, 10min]', () => {
    expect(imageGenerationBackoffMs(1, 500_000, 90_000)).toBe(90_000)
    expect(imageGenerationBackoffMs(1, 500_000, 10)).toBe(5_000)
    expect(imageGenerationBackoffMs(1, 500_000, 99 * 60_000)).toBe(600_000)
  })

  test('breaker window beats the escalated schedule when longer', () => {
    expect(imageGenerationBackoffMs(1, 480_000, null)).toBe(480_000)
  })

  test('escalates 60s → 120s → 240s with attempts, capped at 10min', () => {
    expect(imageGenerationBackoffMs(1, 0, null)).toBe(60_000)
    expect(imageGenerationBackoffMs(2, 0, null)).toBe(120_000)
    expect(imageGenerationBackoffMs(3, 0, null)).toBe(240_000)
    expect(imageGenerationBackoffMs(9, 0, null)).toBe(600_000)
  })

  test('budgets are bounded and match the documented shape', () => {
    expect(IMAGE_MAX_GENERATION_ATTEMPTS).toBeGreaterThanOrEqual(2)
    expect(IMAGE_MAX_CUMULATIVE_THROTTLE_MS).toBe(30 * 60_000)
  })
})
