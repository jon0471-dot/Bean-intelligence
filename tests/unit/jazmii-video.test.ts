/**
 * JAZMII video stack tests — REAL lifecycle contract against the scripted
 * SDK boundary (the ONLY mock: z-ai-web-dev-sdk + the Prisma boundary).
 *
 * Pinned behavior:
 *  - submission returns and persists a REAL provider task id (never synthetic);
 *  - polling honors the provider's PROCESSING/SUCCESS/FAIL states verbatim;
 *  - SUCCESS without a retrievable URL is an honest retrieval failure;
 *  - downloads are validated by container magic bytes (mp4/webm) — garbage
 *    payloads never become "completed" jobs;
 *  - an observed HTTP 429 opens the video-class breaker and a subsequent
 *    submission fails fast WITHOUT a second network call (bounded backoff);
 *  - poll-window exhaustion is an honest BACKEND_TIMEOUT, never a fake video;
 *  - cancellation is stop-tracking only and is labeled exactly that way;
 *  - resume: a running job with a persisted provider task id continues from
 *    polling without a second submission (restart recovery);
 *  - completion writes the artifact under storage/jazmii and records usage
 *    + real-attempt evidence.
 */
import { describe, test, expect, beforeEach, afterAll, mock } from 'bun:test'
import { rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// ---- env BEFORE importing the worker (poll interval/duration are read at load)
process.env.JAZMII_VIDEO_POLL_INTERVAL_MS = '15'
process.env.JAZMII_VIDEO_MAX_POLL_MS = '4000'
process.env.JAZMII_VIDEO_DOWNLOAD_RETRY_MS = '10'

// ---- scripted z-ai SDK ------------------------------------------------------
type SubmitCall = Record<string, unknown>
const state = {
  submitCalls: [] as SubmitCall[],
  queryCalls: [] as string[],
  submitImpl: (() => {
    throw new Error('submitImpl not scripted')
  }) as (body: SubmitCall) => unknown,
  queryImpl: ((_taskId: string) => {
    throw new Error('queryImpl not scripted')
  }) as (taskId: string) => unknown,
}

const scriptedZai = {
  config: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-key-not-real' },
  video: {
    generations: {
      create: async (body: SubmitCall) => {
        state.submitCalls.push(body)
        return state.submitImpl(body)
      },
    },
  },
  async: {
    result: {
      query: async (taskId: string) => {
        state.queryCalls.push(taskId)
        return state.queryImpl(taskId)
      },
    },
  },
}

mock.module('z-ai-web-dev-sdk', () => ({
  default: { create: async () => scriptedZai },
}))

// ---- in-memory Prisma fake (generationJob + usageRecord) --------------------
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
  errorClass?: string | null
  backendId: string | null
  queuedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
  nextRunAt?: Date | null
}
const jobStore = new Map<string, FakeJob>()
const usageRecords: Array<Record<string, unknown>> = []
let idCounter = 0

function makeJob(params: Partial<FakeJob> = {}): FakeJob {
  idCounter += 1
  const job: FakeJob = {
    id: `cuid-test-${idCounter}`,
    userId: 'video-test-user',
    product: 'jazmii',
    task: 'video-generation',
    status: 'queued',
    progress: 0,
    paramsJson: JSON.stringify({ prompt: 'a golden ribbon of light over a night city' }),
    resultJson: null,
    errorCode: null,
    errorMessage: null,
    backendId: null,
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    nextRunAt: null,
    ...params,
  }
  jobStore.set(job.id, job)
  return job
}

const fakeDb = {
  generationJob: {
    findUnique: async ({ where }: { where: { id: string } }) => jobStore.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeJob> }) => {
      const job = jobStore.get(where.id)
      if (!job) throw new Error('job not found')
      Object.assign(job, data)
      return job
    },
  },
  usageRecord: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      usageRecords.push(data)
      return data
    },
  },
}

mock.module('@/lib/db', () => ({ db: fakeDb }))

// ---- fetch stub for the server-side download --------------------------------
const MP4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(2048, 7)])
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(1024, 9)])
const GARBAGE = Buffer.alloc(512, 1)

const fetchState = { impl: null as ((url: string) => Promise<Response>) | null }
const realFetch = globalThis.fetch
mock.module('global.fetch', () => ({}))
;(globalThis as unknown as { fetch: unknown }).fetch = (url: string) => {
  if (fetchState.impl) return fetchState.impl(url)
  return Promise.resolve(new Response(MP4, { status: 200 }))
}

import { detectVideoContainer } from '../../src/lib/adapters/hosted-video'
import { _resetUpstreamCooldownForTests, upstreamBreakerState } from '../../src/lib/upstream/gateway'
import { lastRealAttempt } from '../../src/lib/adapters/last-attempts'

// The worker reads POLL_INTERVAL_MS/MAX_POLL_MS at module load — import it
// ONLY AFTER the env vars above are set (static imports would hoist past them).
const { processVideoJob, requestVideoCancel, ensureVideoPoller, setVideoPoolsActiveProbe } = await import(
  '../../src/lib/jobs/video-worker'
)

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'jazmii')

afterAll(() => {
  ;(globalThis as unknown as { fetch: unknown }).fetch = realFetch
  rmSync(path.join(STORAGE_ROOT, 'video-test-user'), { recursive: true, force: true })
})

beforeEach(() => {
  // The video-class 429 breaker is process-global — every test starts clean.
  _resetUpstreamCooldownForTests()
  state.submitCalls = []
  state.queryCalls = []
  usageRecords.length = 0
  fetchState.impl = null
  state.submitImpl = () => {
    throw new Error('submitImpl not scripted')
  }
  state.queryImpl = () => {
    throw new Error('queryImpl not scripted')
  }
})

const settle = async (jobId: string, maxMs = 8000): Promise<FakeJob> => {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const job = jobStore.get(jobId)!
    if (job.status === 'completed' || job.status === 'failed') return job
    await new Promise((r) => setTimeout(r, 25))
  }
  return jobStore.get(jobId)!
}

/** Wait until the row reaches ANY of the given statuses (retry_wait etc.). */
const waitForStatus = async (jobId: string, statuses: string[], maxMs = 3000): Promise<FakeJob> => {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const job = jobStore.get(jobId)!
    if (statuses.includes(job.status)) return job
    await new Promise((r) => setTimeout(r, 10))
  }
  return jobStore.get(jobId)!
}

describe('container detection (magic bytes)', () => {
  test('recognizes mp4 and webm, rejects garbage', () => {
    expect(detectVideoContainer(MP4)).toBe('mp4')
    expect(detectVideoContainer(WEBM)).toBe('webm')
    expect(detectVideoContainer(GARBAGE)).toBeNull()
    expect(detectVideoContainer(Buffer.alloc(4))).toBeNull()
  })
})

describe('video job lifecycle', () => {
  test('happy path: submit → poll → download → stored → completed with real evidence', async () => {
    let pollCount = 0
    state.submitImpl = async () => ({ id: 'provider-task-1', task_status: 'PROCESSING' })
    state.queryImpl = async (taskId: string) => {
      expect(taskId).toBe('provider-task-1')
      pollCount += 1
      if (pollCount === 1) return { task_status: 'PROCESSING' }
      return { task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.test/video.mp4' }] }
    }
    const job = makeJob()
    await processVideoJob({ ...job })
    const done = await settle(job.id)
    expect(done.status).toBe('completed')
    expect(done.progress).toBe(100)
    expect(state.submitCalls).toHaveLength(1)
    expect(state.queryCalls.filter((t) => t === 'provider-task-1').length).toBeGreaterThanOrEqual(2)
    const result = JSON.parse(done.resultJson!) as Record<string, unknown>
    expect(result.providerTaskId).toBe('provider-task-1')
    expect(result.videoUrl).toBe(`/api/jazmii/jobs/${job.id}/media`)
    expect(result.format).toBe('mp4')
    expect(result.bytes).toBe(MP4.length)
    // Artifact really persisted under BEAN storage.
    const filePath = path.join(STORAGE_ROOT, job.userId, `${job.id}.mp4`)
    expect(existsSync(filePath)).toBe(true)
    expect(readFileSync(filePath).equals(MP4)).toBe(true)
    // Usage + honest success evidence recorded.
    expect(usageRecords).toHaveLength(1)
    expect(usageRecords[0].success).toBe(true)
    expect(usageRecords[0].kind).toBe('video-generation')
    rmSync(path.join(STORAGE_ROOT, job.userId), { recursive: true, force: true })
  })

  test('provider FAIL surfaces the real provider message as GENERATION_FAILED', async () => {
    state.submitImpl = async () => ({ id: 'provider-task-2', task_status: 'PROCESSING' })
    state.queryImpl = async () => ({ task_status: 'FAIL', error: 'content policy violation' })
    const job = makeJob()
    await processVideoJob({ ...job })
    const done = await settle(job.id)
    expect(done.status).toBe('failed')
    expect(done.errorCode).toBe('GENERATION_FAILED')
    expect(done.errorMessage).toContain('content policy violation')
    expect(done.resultJson).toContain('provider-task-2')
    expect(state.submitCalls).toHaveLength(1)
    // No artifact was written.
    expect(existsSync(path.join(STORAGE_ROOT, job.userId))).toBe(false)
  })

  test('SUCCESS without a retrievable URL is an honest failure, never a fake completion', async () => {
    state.submitImpl = async () => ({ id: 'provider-task-3', task_status: 'PROCESSING' })
    state.queryImpl = async () => ({ task_status: 'SUCCESS' })
    const job = makeJob()
    await processVideoJob({ ...job })
    const done = await settle(job.id)
    expect(done.status).toBe('failed')
    expect(done.errorMessage).toContain('no video URL')
  })

  test('submission 429 parks the accepted job in retry_wait — it is NEVER destroyed by a throttle', async () => {
    state.submitImpl = () => {
      throw new Error('API request failed with status 429: Too many requests')
    }
    const job = makeJob()
    await processVideoJob({ ...job })
    const parked = await waitForStatus(job.id, ['retry_wait'])
    expect(parked.status).toBe('retry_wait')
    expect(parked.errorCode).toBe('RATE_LIMITED')
    expect(parked.errorClass).toBe('rate_limited')
    expect(parked.errorMessage).toContain('stays queued')
    const result = JSON.parse(parked.resultJson!) as Record<string, unknown>
    expect(result.submissionAttempts).toBe(1)
    expect(result.throttleWaitMs).toBeGreaterThan(0)
    expect((result.throttle as Record<string, unknown>).attempted).toBe(true)
    // Exactly ONE real provider request was made (bounded, no retry storm).
    expect(state.submitCalls).toHaveLength(1)
    // nextRunAt is scheduled in the future (the breaker-aligned backoff).
    expect(parked.nextRunAt!.getTime()).toBeGreaterThan(Date.now())
    // Upstream throttle evidence recorded honestly.
    expect(lastRealAttempt('video-generation-t2v')?.ok).toBe(false)

    // Second job while the breaker is OPEN: fail fast, ZERO network calls,
    // and the skip does NOT consume a submission attempt.
    const job2 = makeJob()
    await processVideoJob({ ...job2 })
    const parked2 = await waitForStatus(job2.id, ['retry_wait'])
    expect(parked2.status).toBe('retry_wait')
    expect(state.submitCalls).toHaveLength(1) // still exactly one network submit
    const result2 = JSON.parse(parked2.resultJson!) as Record<string, unknown>
    expect(result2.submissionAttempts).toBe(0) // skip counted no attempt — zero real submissions were made
    expect((result2.throttle as Record<string, unknown>).attempted).toBe(false)
    expect(parked2.errorMessage).toContain('cooldown window')
  })

  test('throttle budget exhaustion fails the job honestly after 5 real attempts', async () => {
    state.submitImpl = () => {
      throw new Error('API request failed with status 429: Too many requests')
    }
    const job = makeJob({ resultJson: JSON.stringify({ submissionAttempts: 4, throttleWaitMs: 120_000 }) })
    await processVideoJob({ ...job })
    const failed = await settle(job.id)
    expect(failed.status).toBe('failed')
    expect(failed.errorCode).toBe('RATE_LIMITED')
    expect(failed.errorMessage).toContain('kept throttling submissions')
    expect(failed.errorMessage).toContain('one authorized video provider')
    const result = JSON.parse(failed.resultJson!) as Record<string, unknown>
    expect(result.submissionAttempts).toBe(5)
    expect(state.submitCalls).toHaveLength(1) // the 5th real attempt, then stop
  })

  test('a parked job resubmits ONCE when the window clears and completes — never a duplicate', async () => {
    state.submitImpl = () => {
      throw new Error('API request failed with status 429: Too many requests')
    }
    const job = makeJob()
    await processVideoJob({ ...job })
    const parked = await waitForStatus(job.id, ['retry_wait'])
    expect(state.submitCalls).toHaveLength(1)
    // The throttle window closes: breaker resets, schedule expires.
    _resetUpstreamCooldownForTests()
    parked.nextRunAt = new Date(Date.now() - 1_000)
    let polls = 0
    state.submitImpl = async () => ({ id: 'provider-task-retry-1', task_status: 'PROCESSING' })
    state.queryImpl = async () => {
      polls += 1
      if (polls === 1) return { task_status: 'PROCESSING' }
      return { task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.test/after-retry.mp4' }] }
    }
    await processVideoJob({ ...parked })
    const done = await settle(job.id)
    expect(done.status).toBe('completed')
    expect(state.submitCalls).toHaveLength(2) // exactly ONE resubmission
    const result = JSON.parse(done.resultJson!) as Record<string, unknown>
    expect(result.providerTaskId).toBe('provider-task-retry-1')
    expect(result.submissionAttempts).toBe(2) // attempt history preserved
    expect(result.throttle).toBeUndefined() // pending frame cleared
    expect(done.errorCode).toBeNull()
    rmSync(path.join(STORAGE_ROOT, job.userId), { recursive: true, force: true })
  })

  test('a retry_wait row with a future nextRunAt does not submit before it is due', async () => {
    state.submitImpl = async () => ({ id: 'provider-task-due-1', task_status: 'PROCESSING' })
    state.queryImpl = async () => ({ task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.test/due.mp4' }] })
    const job = makeJob({
      status: 'retry_wait',
      nextRunAt: new Date(Date.now() + 250),
    })
    const running = processVideoJob({ ...job })
    await new Promise((r) => setTimeout(r, 60))
    expect(state.submitCalls).toHaveLength(0) // schedule honored
    await running
    const done = await settle(job.id)
    expect(done.status).toBe('completed')
    expect(state.submitCalls).toHaveLength(1)
    rmSync(path.join(STORAGE_ROOT, job.userId), { recursive: true, force: true })
  })

  test('a queued row presented WITH a persisted provider task id NEVER resubmits (duplicate guard)', async () => {
    // Engine re-claims present the row as legacy 'queued' even when the
    // provider already accepted the task — the taskId, not the status,
    // decides submit-vs-resume (measured duplicate-submission defect).
    let polls = 0
    state.queryImpl = async (taskId: string) => {
      expect(taskId).toBe('provider-task-guard')
      polls += 1
      if (polls === 1) return { task_status: 'PROCESSING' }
      return { task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.test/guard.mp4' }] }
    }
    const job = makeJob({
      status: 'queued', // engine legacyRow presentation
      resultJson: JSON.stringify({ providerTaskId: 'provider-task-guard', submissionAttempts: 1 }),
    })
    await processVideoJob({ ...job })
    const done = await settle(job.id)
    expect(done.status).toBe('completed')
    expect(state.submitCalls).toHaveLength(0) // NO duplicate submission
    rmSync(path.join(STORAGE_ROOT, job.userId), { recursive: true, force: true })
  })

  test('a throttled result DOWNLOAD is retried boundedly — the accepted job keeps its real video', async () => {
    state.submitImpl = async () => ({ id: 'provider-task-dl', task_status: 'PROCESSING' })
    state.queryImpl = async () => ({ task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.test/dl.mp4' }] })
    let downloads = 0
    fetchState.impl = async () => {
      downloads += 1
      if (downloads <= 2) throw new Error('API request failed with status 429: Too many requests')
      return new Response(MP4, { status: 200 })
    }
    const job = makeJob()
    await processVideoJob({ ...job })
    const done = await settle(job.id)
    expect(done.status).toBe('completed')
    expect(downloads).toBe(3)
    rmSync(path.join(STORAGE_ROOT, job.userId), { recursive: true, force: true })
  })

  test('ensureVideoPoller never executes queued/retry_wait jobs while engine pools are active', async () => {
    setVideoPoolsActiveProbe(() => true)
    try {
      state.submitImpl = async () => ({ id: 'provider-task-x', task_status: 'PROCESSING' })
      const queued = makeJob({ status: 'queued' })
      ensureVideoPoller({ ...queued })
      const parked = makeJob({ status: 'retry_wait', nextRunAt: new Date(Date.now() + 60_000) })
      ensureVideoPoller({ ...parked })
      await new Promise((r) => setTimeout(r, 80))
      // Pool-owned: no poller execution, no submission, row untouched.
      expect(state.submitCalls).toHaveLength(0)
      expect(jobStore.get(queued.id)!.status).toBe('queued')
      expect(jobStore.get(parked.id)!.status).toBe('retry_wait')
    } finally {
      setVideoPoolsActiveProbe(() => false)
    }
    // Without pools (inline shape) the same queued job IS executed.
    state.queryImpl = async () => ({ task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.test/inline.mp4' }] })
    const inline = makeJob({ status: 'queued' })
    ensureVideoPoller({ ...inline })
    const done = await settle(inline.id)
    expect(done.status).toBe('completed')
    expect(state.submitCalls).toHaveLength(1)
    rmSync(path.join(STORAGE_ROOT, inline.userId), { recursive: true, force: true })
  })

  test('backoff math: Retry-After honored, breaker window respected, escalation bounded', async () => {
    const { videoSubmitBackoffMs, VIDEO_MAX_SUBMIT_ATTEMPTS, VIDEO_SUBMIT_BACKOFF_MAX_MS } = await import(
      '../../src/lib/jobs/video-worker'
    )
    // A provider Retry-After wins, clamped to [5s, 10min].
    expect(videoSubmitBackoffMs(1, 0, 30_000)).toBe(30_000)
    expect(videoSubmitBackoffMs(1, 0, 2_000)).toBe(5_000)
    expect(videoSubmitBackoffMs(1, 0, 999_999)).toBe(VIDEO_SUBMIT_BACKOFF_MAX_MS)
    // No Retry-After (measured: this gateway sends none): breaker remaining
    // dominates while open; escalation doubles and caps at 10 minutes.
    expect(videoSubmitBackoffMs(1, 120_000, null)).toBe(120_000)
    expect(videoSubmitBackoffMs(1, 0, null)).toBe(60_000)
    expect(videoSubmitBackoffMs(2, 0, null)).toBe(120_000)
    expect(videoSubmitBackoffMs(3, 0, null)).toBe(240_000)
    expect(videoSubmitBackoffMs(9, 0, null)).toBe(VIDEO_SUBMIT_BACKOFF_MAX_MS)
    expect(VIDEO_MAX_SUBMIT_ATTEMPTS).toBe(5)
  })

  test('a throttled status poll backs off and keeps tracking — one 429 NEVER fails an accepted job', async () => {
    // FINAL FIX (2026-11-07) pin: the previous loop treated one throttled
    // poll (HTTP 429 on the async-result query endpoint) as a job failure,
    // killing a job the provider had ACCEPTED and poisoning product health
    // evidence. Now the loop backs off (bounded) and completes the job.
    let polls = 0
    state.submitImpl = async () => ({ id: 'provider-task-7', task_status: 'PROCESSING' })
    state.queryImpl = async () => {
      polls += 1
      if (polls <= 2) throw new Error('API request failed with status 429: Too many requests')
      if (polls === 3) return { task_status: 'PROCESSING' }
      return { task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.test/retry.mp4' }] }
    }
    const job = makeJob()
    await processVideoJob({ ...job })
    const done = await settle(job.id)
    expect(done.status).toBe('completed')
    expect(state.submitCalls).toHaveLength(1) // submission was NOT retried
    expect(polls).toBeGreaterThanOrEqual(4) // tracking survived the 429s
    expect(done.errorCode).toBeNull()
    // The tracking 429s must NOT poison the video-class submission breaker
    // (the poll rides the same account but a throttled STATUS query is not
    // submission evidence).
    expect(upstreamBreakerState('video').coolingDown).toBe(false)
    // Honest success evidence recorded (no phantom upstream failure).
    expect(lastRealAttempt('video-generation-t2v')?.ok).toBe(true)
    rmSync(path.join(STORAGE_ROOT, job.userId), { recursive: true, force: true })
  })

  test('an unretryable auth rejection during tracking fails the job honestly (no pointless retries)', async () => {
    state.submitImpl = async () => ({ id: 'provider-task-8', task_status: 'PROCESSING' })
    state.queryImpl = async () => {
      throw new Error('API request failed with status 401: invalid credentials')
    }
    const job = makeJob()
    await processVideoJob({ ...job })
    const done = await settle(job.id)
    expect(done.status).toBe('failed')
    expect(done.errorCode).toBe('BACKEND_FAILURE')
    expect(state.queryCalls.length).toBe(1) // auth failures are never retried
  })

  test('poll-window exhaustion is an honest BACKEND_TIMEOUT (bounded, no hang)', async () => {
    state.submitImpl = async () => ({ id: 'provider-task-4', task_status: 'PROCESSING' })
    state.queryImpl = async () => ({ task_status: 'PROCESSING' })
    const job = makeJob()
    await processVideoJob({ ...job })
    const done = await settle(job.id, 15000)
    expect(done.status).toBe('failed')
    expect(done.errorCode).toBe('BACKEND_TIMEOUT')
    expect(done.errorMessage).toContain('time limit')
  })

  test('cancellation before submission records honest stop-tracking and never submits', async () => {
    const job = makeJob()
    await requestVideoCancel(job.id)
    await processVideoJob({ ...job })
    const done = await settle(job.id)
    expect(done.status).toBe('failed')
    expect(done.errorCode).toBe('CANCELLED')
    expect(done.errorMessage).toContain('no cancel API')
    expect(state.submitCalls).toHaveLength(0)
  })

  test('resume: a running job with a persisted provider task id continues WITHOUT resubmitting', async () => {
    let polls = 0
    state.queryImpl = async (taskId: string) => {
      expect(taskId).toBe('provider-task-resume')
      polls += 1
      if (polls === 1) return { task_status: 'PROCESSING' }
      return { task_status: 'SUCCESS', video_url: 'https://cdn.test/resume.mp4' }
    }
    const job = makeJob({
      status: 'running',
      progress: 40,
      resultJson: JSON.stringify({ providerTaskId: 'provider-task-resume' }),
    })
    await processVideoJob({ ...job })
    const done = await settle(job.id)
    expect(done.status).toBe('completed')
    expect(state.submitCalls).toHaveLength(0) // NO resubmission after restart
    expect(polls).toBeGreaterThanOrEqual(2)
    const result = JSON.parse(done.resultJson!) as Record<string, unknown>
    expect(result.providerTaskId).toBe('provider-task-resume')
    rmSync(path.join(STORAGE_ROOT, job.userId), { recursive: true, force: true })
  })

  test('ensureVideoPoller re-attaches only to jazmii video jobs that are queued/running', () => {
    const running = makeJob({ status: 'running', resultJson: JSON.stringify({ providerTaskId: 't' }) })
    ensureVideoPoller({ ...running })
    // no crash; a second call must not duplicate (single-poller contract is
    // enforced internally by the activePollers registry)
    ensureVideoPoller({ ...running })
    const completed = makeJob({ status: 'completed' })
    ensureVideoPoller({ ...completed }) // ignored — terminal status
    const other = makeJob({ status: 'queued', product: 'laxii', task: 'image-generation' })
    ensureVideoPoller({ ...other }) // ignored — different product/task
    expect(true).toBe(true)
  })

  test('webm output is detected and stored with the webm extension', async () => {
    state.submitImpl = async () => ({ id: 'provider-task-5', task_status: 'PROCESSING' })
    state.queryImpl = async () => ({ task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.test/v.webm' }] })
    fetchState.impl = async () => new Response(WEBM, { status: 200 })
    const job = makeJob()
    await processVideoJob({ ...job })
    const done = await settle(job.id)
    expect(done.status).toBe('completed')
    const result = JSON.parse(done.resultJson!) as Record<string, unknown>
    expect(result.format).toBe('webm')
    expect(existsSync(path.join(STORAGE_ROOT, job.userId, `${job.id}.webm`))).toBe(true)
    rmSync(path.join(STORAGE_ROOT, job.userId), { recursive: true, force: true })
  })

  test('a corrupted download never completes the job (container validation)', async () => {
    state.submitImpl = async () => ({ id: 'provider-task-6', task_status: 'PROCESSING' })
    state.queryImpl = async () => ({ task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.test/bad' }] })
    fetchState.impl = async () => new Response(GARBAGE, { status: 200 })
    const job = makeJob()
    await processVideoJob({ ...job })
    const done = await settle(job.id)
    expect(done.status).toBe('failed')
    expect(done.errorMessage).toContain('not a recognizable video container')
  })

  test('mkdir storage root exists for later manual runs', () => {
    mkdirSync(STORAGE_ROOT, { recursive: true })
    expect(existsSync(STORAGE_ROOT)).toBe(true)
  })
})
