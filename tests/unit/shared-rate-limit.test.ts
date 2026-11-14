/**
 * SHARED-RATE-LIMIT REPAIR tests (2026-11-14).
 *
 * Measured incident being pinned (docs/SHARED-RATE-LIMIT-INVESTIGATION.md):
 * the JAZMII I2V pipeline re-fired its intelligence layer before EVERY
 * throttle-parked submission retry — each retry burned one metered
 * chat-class vision call + one functions-class web_search into a provider
 * that was already throttling the account. Nine such vision 429s kept the
 * chat-class breaker escalated, and RIISHE chat + CODE GIFTZ chat then
 * failed fast with HTTP 429 although the provider never refused a real chat
 * turn in the window (zero riishe/code-giftz usage rows).
 *
 * Contracts pinned here (the ONLY mocked boundaries: the z-ai SDK, the
 * Prisma boundary, the intel layer's network calls, fetch and ffprobe):
 *  D1. intel compute-once: a throttle-parked job's retry reuses the
 *      persisted conditioned prompt VERBATIM and never re-fires the intel
 *      layer; a first attempt computes once and persists it BEFORE the
 *      submission outcome is known; a video-breaker-open job skips the
 *      intel layer entirely (deferred to the next attempt).
 *  D2. the vision lane records chat-class real-attempt evidence (success
 *      and upstream failure) so the chat capability rows can never render
 *      "operational" while the class just took real 429s; a breaker-open
 *      skip makes NO network call and records nothing new.
 *  D3. the dashboard retry hint is derived ONLY from measured breaker
 *      state and is null when no class is cooling (never invented).
 */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'

// ---- scripted z-ai SDK (video + vision lanes) -------------------------------
const sdkState = {
  submitCalls: [] as Array<Record<string, unknown>>,
  visionCalls: 0,
  submitImpl: (() => {
    throw new Error('submitImpl not scripted')
  }) as (body: Record<string, unknown>) => unknown,
  visionImpl: (() => {
    throw new Error('visionImpl not scripted')
  }) as (body: Record<string, unknown>) => unknown,
}

const scriptedZai = {
  config: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-key-not-real' },
  video: {
    generations: {
      create: async (body: Record<string, unknown>) => {
        sdkState.submitCalls.push(body)
        return sdkState.submitImpl(body)
      },
    },
  },
  async: {
    result: {
      query: async (taskId: string) => sdkState.queryImpl(taskId),
    },
  },
  chat: {
    completions: {
      createVision: async (body: Record<string, unknown>) => {
        sdkState.visionCalls += 1
        return sdkState.visionImpl(body)
      },
    },
  },
}

mock.module('z-ai-web-dev-sdk', () => ({
  default: { create: async () => scriptedZai },
}))

// ---- intel layer counters (the cross-class consumption under test) ---------
// NOTE: the REAL vision module is intentionally NOT mocked — the D2 suite
// tests its chat-class evidence recording against the scripted SDK, and the
// D1 I2V test exercises the real imageReferenceToDataUrl through the
// controlled fetch stub below.
const intelState = { groundingCalls: 0, sceneCalls: 0, refFetches: 0 }

mock.module('@/lib/intel/grounding', () => ({
  prepareVideoIntelligence: async (prompt: string) => {
    intelState.groundingCalls += 1
    return {
      conditionedPrompt: `COND:${prompt}`,
      mode: 'test-double' as const,
      promptLanguage: 'en',
      knowledgeKeys: ['k1'],
      evidence: [],
      degraded: [] as string[],
      conditioning: 'cond-block',
      timing: { totalMs: 1 },
    }
  },
}))

mock.module('@/lib/intel/continuity', () => ({
  extractSceneState: async () => {
    intelState.sceneCalls += 1
    return {
      method: 'vision-analysis' as const,
      subject: 's',
      clothing: 'c',
      pose: 'p',
      environment: 'e',
      lightingDirection: 'l',
      cameraFraming: 'f',
      colorPalette: 'pal',
      continuityDirectives: 'directive',
      reason: null,
    }
  },
  verifyVideoContinuity: async () => ({
    checked: false,
    method: 'unavailable',
    defects: [],
    observation: null,
    checkedAt: new Date().toISOString(),
    durationMs: 1,
    reason: 'test double',
  }),
  writeTempFrame: async () => null,
  extractFrame: async () => {
    throw new Error('not used here')
  },
  imageBufferToDataUrl: () => 'data:image/jpeg;base64,x',
}))

// ---- in-memory Prisma boundary ----------------------------------------------
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
  cancelRequested?: boolean
}
const jobStore = new Map<string, FakeJob>()
let idCounter = 0

function makeJob(params: Partial<FakeJob> = {}): FakeJob {
  idCounter += 1
  const job: FakeJob = {
    id: `cuid-srl-${idCounter}`,
    userId: 'srl-test-user',
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
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<FakeJob> }) => {
      const job = jobStore.get(where.id as string)
      if (!job) return { count: 0 }
      Object.assign(job, data)
      return { count: 1 }
    },
  },
  usageRecord: {
    create: async ({ data }: { data: Record<string, unknown> }) => data,
    count: async () => 0,
  },
  jobEvent: {
    create: async ({ data }: { data: Record<string, unknown> }) => data,
  },
}
mock.module('@/lib/db', () => ({ db: fakeDb }))

// ---- fetch stub (downloads + I2V reference images) --------------------------
const MP4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(2048, 7)])
const PNG_REF = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(256, 3)])
const fetchState = { impl: null as ((url: string) => Promise<Response>) | null }
const realFetch = globalThis.fetch
;(globalThis as unknown as { fetch: unknown }).fetch = (url: string) => {
  if (typeof url === 'string' && url.includes('cdn.test/ref.png')) {
    intelState.refFetches += 1
    return Promise.resolve(new Response(PNG_REF, { status: 200, headers: { 'content-type': 'image/png' } }))
  }
  if (fetchState.impl) return fetchState.impl(url)
  return Promise.resolve(new Response(MP4, { status: 200 }))
}

const FAKE_STREAM_PROBE = {
  ok: true as const,
  video: { codec: 'h264', width: 640, height: 360, durationSec: 5.2, frames: 156, fps: 30 },
  audio: null,
}
mock.module('@/lib/media/ffprobe', () => ({
  probeVideoBytes: async () => FAKE_STREAM_PROBE,
  probeVideoFile: async () => FAKE_STREAM_PROBE,
  validateVideoArtifact: async () => FAKE_STREAM_PROBE,
  MIN_DURATION_SEC: 0.5,
  MIN_FRAMES: 8,
}))

// video worker reads poll env at module load — set BEFORE importing it
process.env.JAZMII_VIDEO_POLL_INTERVAL_MS = '15'
process.env.JAZMII_VIDEO_MAX_POLL_MS = '4000'
process.env.JAZMII_VIDEO_DOWNLOAD_RETRY_MS = '10'

import { _resetUpstreamCooldownForTests, noteUpstream429, upstreamBreakerState } from '../../src/lib/upstream/gateway'
import { _resetRealAttemptsForTests, lastRealAttempt } from '../../src/lib/adapters/last-attempts'
import { rateLimitRetryHint } from '../../src/lib/registry/retry-hint'

const { processVideoJob } = await import('../../src/lib/jobs/video-worker')
const { analyzeImageOnce } = await import('../../src/lib/intel/vision')

const resultOf = (job: FakeJob): Record<string, unknown> => {
  if (!job.resultJson) return {}
  try {
    return JSON.parse(job.resultJson) as Record<string, unknown>
  } catch {
    return {}
  }
}

beforeEach(() => {
  _resetUpstreamCooldownForTests()
  _resetRealAttemptsForTests()
  sdkState.submitCalls = []
  sdkState.visionCalls = 0
  sdkState.submitImpl = () => {
    throw new Error('submitImpl not scripted')
  }
  sdkState.visionImpl = () => {
    throw new Error('visionImpl not scripted')
  }
  intelState.groundingCalls = 0
  intelState.sceneCalls = 0
  intelState.refFetches = 0
  fetchState.impl = null
  jobStore.clear()
})

const THROTTLE_ERR = () =>
  new Error('API request failed with status 429: {"error":"Too many requests, please try again later"}')

describe('D1 — video intel layer computes once per job (shared-class starvation fix)', () => {
  test('first attempt computes once, conditions the submission, and persists intelPrompt before the outcome', async () => {
    sdkState.submitImpl = () => ({ id: 'task-abc', task_status: 'PROCESSING' })
    // Script the tracking loop to complete immediately (SUCCESS + URL).
    sdkState.queryImpl = () => ({ task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.test/out.mp4' }] })
    fetchState.impl = () => Promise.resolve(new Response(MP4, { status: 200 }))
    const job = makeJob()
    await processVideoJob(job)

    // Intel layer fired EXACTLY once, and the submission used its output.
    expect(intelState.groundingCalls).toBe(1)
    expect(sdkState.submitCalls.length).toBe(1)
    expect(sdkState.submitCalls[0].prompt).toBe('COND:a golden ribbon of light over a night city')
    // Persisted for every future retry — the compute-once record.
    const result = resultOf(job)
    expect(result.intelPrompt).toBe('COND:a golden ribbon of light over a night city')
    expect((result.intel as Record<string, unknown> | undefined)?.layer).toBe('bean-intel/1')
    expect(job.status).toBe('completed')
  })

  test('a throttle-parked retry reuses the persisted prompt VERBATIM and never re-fires the intel layer', async () => {
    // Attempt 1: real provider 429 -> job parked with the intel compute saved.
    sdkState.submitImpl = () => {
      throw THROTTLE_ERR()
    }
    const job = makeJob()
    await processVideoJob(job)
    expect(intelState.groundingCalls).toBe(1)
    expect(sdkState.submitCalls.length).toBe(1)
    expect(job.status).toBe('retry_wait')
    expect(resultOf(job).intelPrompt).toBe('COND:a golden ribbon of light over a night city')
    expect(resultOf(job).submissionAttempts).toBe(1)

    // Attempt 2 (engine re-claim after the backoff): simulate the cooldown
    // window having expired (the unit clock cannot fast-forward), then the
    // submission fires again — with the SAME conditioned prompt and ZERO
    // new intel-layer consumption — and completes the full lifecycle.
    _resetUpstreamCooldownForTests()
    sdkState.submitImpl = () => ({ id: 'task-xyz', task_status: 'PROCESSING' })
    sdkState.queryImpl = () => ({ task_status: 'SUCCESS', video_result: [{ url: 'https://cdn.test/out.mp4' }] })
    fetchState.impl = () => Promise.resolve(new Response(MP4, { status: 200 }))
    job.nextRunAt = new Date(Date.now() - 1000) // wait window already over
    await processVideoJob(job)
    expect(intelState.groundingCalls).toBe(1) // unchanged — no second compute
    expect(sdkState.submitCalls.length).toBe(2)
    expect(sdkState.submitCalls[1].prompt).toBe('COND:a golden ribbon of light over a night city')
    expect(job.status).toBe('completed')
  })

  test('a video-breaker-open job skips the intel layer entirely (deferred compute)', async () => {
    noteUpstream429('video') // real 429 previously observed — breaker open
    expect(upstreamBreakerState('video').coolingDown).toBe(true)
    sdkState.submitImpl = () => {
      throw new Error('submission must fail fast at the breaker, never reach the SDK')
    }
    const job = makeJob()
    await processVideoJob(job)

    // No intel consumption, no submission, honest park with NO counted
    // attempt (a breaker skip never made a network request).
    expect(intelState.groundingCalls).toBe(0)
    expect(intelState.sceneCalls).toBe(0)
    expect(sdkState.submitCalls.length).toBe(0)
    expect(job.status).toBe('retry_wait')
    expect(resultOf(job).submissionAttempts ?? 0).toBe(0)
    // The deferred compute is honest: no intelPrompt was persisted yet.
    expect(resultOf(job).intelPrompt).toBeUndefined()
  })

  test('I2V retry reuses the persisted reference scene state (no repeated reference fetch or scene analysis)', async () => {
    sdkState.submitImpl = () => {
      throw THROTTLE_ERR()
    }
    const job = makeJob({ paramsJson: JSON.stringify({ prompt: 'push in slowly', imageUrl: 'https://cdn.test/ref.png' }) })
    await processVideoJob(job)
    // I2V first attempt: reference fetch + scene analysis happened once.
    expect(intelState.refFetches).toBe(1)
    expect(intelState.sceneCalls).toBe(1)
    expect(resultOf(job).referenceSceneState).toBeTruthy()

    job.nextRunAt = new Date(Date.now() - 1000)
    await processVideoJob(job)
    // Retry: NO new reference fetch or scene analysis — everything reused.
    expect(intelState.refFetches).toBe(1)
    expect(intelState.sceneCalls).toBe(1)
  })
})

describe('D2 — vision lane records chat-class real-attempt evidence', () => {
  test('a vision 429 opens the chat breaker AND is visible as fresh chat-completion failure evidence', async () => {
    sdkState.visionImpl = () => {
      throw THROTTLE_ERR()
    }
    const outcome = await analyzeImageOnce('data:image/png;base64,AAAA', 'describe')
    expect(outcome.text).toBeNull()
    expect(outcome.skipped).toBe(false)
    expect(upstreamBreakerState('chat').consecutive429s).toBe(1)
    const attempt = lastRealAttempt('chat-completion')
    expect(attempt).not.toBeNull()
    expect(attempt!.ok).toBe(false)
    expect(attempt!.failureCategory).toBe('rate-limited')
    expect(attempt!.httpStatus).toBe(429)
    expect(attempt!.upstream).toBe(true)
  })

  test('a real vision success records chat-class success evidence and resets the 429 streak', async () => {
    sdkState.visionImpl = () => ({ choices: [{ message: { content: 'a red apple on slate' } }] })
    const outcome = await analyzeImageOnce('data:image/png;base64,AAAA', 'describe')
    expect(outcome.text).toBe('a red apple on slate')
    expect(upstreamBreakerState('chat').consecutive429s).toBe(0)
    const attempt = lastRealAttempt('chat-completion')
    expect(attempt).not.toBeNull()
    expect(attempt!.ok).toBe(true)
    expect(attempt!.failureCategory).toBeNull()
  })

  test('a breaker-open skip makes NO network call and records no new evidence', async () => {
    noteUpstream429('chat')
    const before = lastRealAttempt('chat-completion')
    const outcome = await analyzeImageOnce('data:image/png;base64,AAAA', 'describe')
    expect(outcome.skipped).toBe(true)
    expect(outcome.durationMs).toBe(0)
    expect(sdkState.visionCalls).toBe(0)
    expect(lastRealAttempt('chat-completion')).toBe(before)
  })
})

describe('D3 — dashboard retry hint derives only from measured breaker state', () => {
  test('longest cooling class wins; seconds vs minutes formatting', () => {
    const health = (classes: Array<Record<string, unknown>>) =>
      ({ gateway: { breaker: { classes } } }) as unknown as Parameters<typeof rateLimitRetryHint>[0]
    expect(rateLimitRetryHint(health([{ class: 'chat', coolingDown: true, remainingMs: 45_000, consecutive429s: 2, last429At: null }]))).toBe(
      'retry within ~45s · 2 consecutive refusals',
    )
    expect(rateLimitRetryHint(health([{ class: 'chat', coolingDown: true, remainingMs: 120_000, consecutive429s: 3, last429At: null }]))).toBe(
      'retry within ~2 min · 3 consecutive refusals',
    )
    // Single refusal: timing only (the streak suffix appears from 2 up).
    expect(rateLimitRetryHint(health([{ class: 'chat', coolingDown: true, remainingMs: 45_000, consecutive429s: 1, last429At: null }]))).toBe(
      'retry within ~45s',
    )
    expect(
      rateLimitRetryHint(
        health([
          { class: 'chat', coolingDown: true, remainingMs: 60_000, consecutive429s: 1, last429At: null },
          { class: 'video', coolingDown: true, remainingMs: 600_000, consecutive429s: 4, last429At: null },
        ]),
      ),
    ).toBe('retry within ~10 min · 4 consecutive refusals')
  })

  test('no cooling class -> null (the hint is never invented)', () => {
    expect(rateLimitRetryHint(null)).toBeNull()
    expect(rateLimitRetryHint({})).toBeNull()
    expect(
      rateLimitRetryHint({
        gateway: {
          breaker: {
            classes: [
              { class: 'chat', coolingDown: false, remainingMs: 0, consecutive429s: 9, last429At: '2026-11-14T05:54:17.073Z' },
            ],
          },
        },
      }),
    ).toBeNull()
  })
})
