/**
 * JAZMII AUTO DIRECTOR — production orchestrator END-TO-END (real media).
 *
 * The orchestration state machine runs for real over an in-memory database:
 * scene jobs are created as REAL GenerationJob rows, and the "provider" is
 * simulated at its ONLY boundary (the job row settles + a REAL H.264 clip
 * lands in BEAN storage — the same convention the video worker uses).
 * Normalization, composition (FFmpeg engine), ffprobe validation and the
 * deliverable files are all REAL — no mock on the media path.
 *
 * Pinned behavior (spec §13, §16):
 *  - success → completed_with_limitations (honest: no audio, continuity not
 *    guaranteed) with an ffprobe-validated deliverable set;
 *  - one failed scene → partially_completed: a REAL partial cut from the
 *    surviving scenes, failed scenes stay visible with their errors;
 *  - checkpoint resume: re-running the orchestration NEVER re-generates
 *    delivered scenes (no duplicate provider submissions);
 *  - cancel → cancelled with completed scenes preserved;
 *  - the Trust receipt finalizes with REAL verification facts, never bare
 *    completion.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, mock } from 'bun:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { probeVideoFile } from '../../src/lib/media/ffprobe'

// Fast polls for tests (read at module init — set BEFORE the import).
process.env.JAZMII_DIRECTOR_SCENE_POLL_MS = '20'

const execFileP = promisify(execFile)

const fake = (await import('../helpers/director-fake-db')).createDirectorFakeDb()
mock.module('@/lib/db', () => ({ db: fake.fakeDb }))

const enqueued: string[] = []
mock.module('@/lib/jobs/queue', () => ({
  enqueueJob: (jobId: string) => {
    enqueued.push(jobId)
  },
}))

const usageCalls: Array<Record<string, unknown>> = []
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async (input: Record<string, unknown>) => {
    usageCalls.push(input)
  },
  recordAudit: async () => undefined,
}))

mock.module('@/lib/ai-engine/events', () => ({
  appendJobEventSafe: async () => undefined,
}))

const videoCancelRequests: string[] = []
mock.module('@/lib/jobs/video-worker', () => ({
  requestVideoCancel: async (jobId: string) => {
    videoCancelRequests.push(jobId)
    return true
  },
}))

const { processProductionJob } = await import('../../src/lib/jobs/director-worker')

const OWNER = 'director-test-user'
const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'jazmii')
const WORKSPACE = path.join(STORAGE_ROOT, OWNER)

beforeAll(async () => {
  fs.rmSync(WORKSPACE, { recursive: true, force: true })
})

beforeEach(() => {
  fake.reset()
  enqueued.length = 0
  usageCalls.length = 0
})

afterAll(async () => {
  fs.rmSync(WORKSPACE, { recursive: true, force: true })
})

function approvedPlanJson() {
  return {
    storyboard: {
      title: 'Aurora Launch Film',
      objective: 'Make sunrise alarm clocks feel inevitable.',
      tone: 'product-launch',
      format: '9:16',
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 9,
      visualDirection: 'Warm dawn light, deep blacks.',
      voiceover: false,
      scenes: [
        { id: 'scene-01', durationSeconds: 3, purpose: 'opening-hook', visualDescription: 'dark room, glowing dial', generationPrompt: 'Slow push-in on a glowing clock.', caption: 'Wake with the sun.', transitionOut: 'cut' },
        { id: 'scene-02', durationSeconds: 6, purpose: 'product-moment', visualDescription: 'hands adjust the dial', generationPrompt: 'Close-up of hands turning a brass dial.', transitionOut: 'cut' },
      ],
    },
    approvedAt: new Date().toISOString(),
    approvedRev: 1,
    enginePreference: 'ffmpeg',
    audioTracks: [],
    sceneLimitAck: true,
  }
}

async function seedProduction(overrides: Record<string, unknown> = {}) {
  const now = new Date()
  const production = await fake.jazmiiProduction.create({
    data: {
      userId: OWNER,
      title: 'Aurora Launch Film',
      status: 'generating',
      storyboardJson: JSON.stringify(approvedPlanJson()),
      storyboardRev: 1,
      style: 'product-launch',
      aspect: '9:16',
      width: 1080,
      height: 1920,
      fps: 30,
      requestedDurationSec: 9,
      approvedAt: now,
      ...overrides,
    },
  })
  return production as unknown as { id: string }
}

async function seedOrchestration(productionId: string) {
  const job = await fake.generationJob.create({
    data: {
      userId: OWNER,
      product: 'jazmii',
      task: 'video-production',
      status: 'starting',
      paramsJson: JSON.stringify({ productionId }),
      resultJson: null,
    },
  })
  await fake.jazmiiProduction.update({ where: { id: productionId }, data: { jobId: job.id } })
  return job as unknown as { id: string }
}

/** Simulate the video worker at its ONLY boundary: settle the job row with a
 *  REAL clip stored at storage/jazmii/<user>/<jobId>.mp4. */
async function completeSceneJob(jobId: string, opts: { fail?: boolean; message?: string } = {}) {
  if (opts.fail) {
    await fake.generationJob.update({
      where: { id: jobId },
      data: { status: 'failed', errorClass: 'permanent', errorCode: 'GENERATION_FAILED', errorMessage: opts.message ?? 'The provider reported the video task as failed.' },
    })
    return
  }
  const userDir = path.join(STORAGE_ROOT, OWNER)
  fs.mkdirSync(userDir, { recursive: true })
  const clipPath = path.join(userDir, `${jobId}.mp4`)
  await execFileP('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=544x960:rate=30:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-shortest',
    clipPath,
  ])
  await fake.generationJob.update({
    where: { id: jobId },
    data: {
      status: 'completed',
      progress: 100,
      resultJson: JSON.stringify({
        videoUrl: `/api/jazmii/jobs/${jobId}/media`,
        format: 'mp4',
        stream: { codec: 'h264', width: 544, height: 960, durationSec: 3, frames: 90, fps: 30, validatedBy: 'ffprobe' },
      }),
    },
  })
}

/** Wait until every scene job has a settled row, completing them as they
 *  appear (mimics the provider arriving over time). */
async function driveScenes(productionId: string, policy: (idx: number) => { fail?: boolean; message?: string } | undefined) {
  for (let i = 0; i < 600; i += 1) {
    const scenes = fake.jazmiiScene.rows.filter((r) => r.productionId === productionId)
    const unsettled = scenes.filter((s) => s.status !== 'ready' && s.status !== 'failed')
    if (unsettled.length === 0) return
    for (const s of unsettled) {
      const jobRow = s.jobId ? fake.generationJob.rows.find((j) => j.id === s.jobId) : null
      if (!jobRow) continue
      if (['completed', 'failed', 'cancelled'].includes(jobRow.status as string)) continue
      const decision = policy(s.idx as number)
      await completeSceneJob(jobRow.id as string, decision ?? {})
    }
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('test: scene jobs never settled')
}

describe('director orchestrator — full pipeline (real media)', () => {
  test('success: scenes → prep → composition → validation → deliverables + receipt', async () => {
    const productionId = (await seedProduction()).id
    const orch = await seedOrchestration(productionId)

    const running = processProductionJob({
      id: orch.id,
      userId: OWNER,
      product: 'jazmii',
      task: 'video-production',
      status: 'starting',
      paramsJson: JSON.stringify({ productionId }),
      resultJson: null,
    })

    // Let ensureSceneJob create the scene jobs, then drive the provider side.
    await new Promise((r) => setTimeout(r, 120))
    console.error('DBG1 scene rows:', JSON.stringify(fake.jazmiiScene.rows.map((r) => ({ idx: r.idx, status: r.status, jobId: r.jobId }))))
    console.error('DBG1 gen jobs:', JSON.stringify(fake.generationJob.rows.map((r) => ({ id: r.id, task: r.task, status: r.status }))))
    await driveScenes(productionId, () => ({}))
    await running
    console.error('DBG2 after running:', JSON.stringify(fake.jazmiiScene.rows.map((r) => ({ idx: r.idx, status: r.status, jobId: r.jobId, asset: r.assetPath }))))
    console.error('DBG2 prod:', JSON.stringify({ status: fake.jazmiiProduction.rows.find((r) => r.id === productionId)?.status }))

    const production = fake.jazmiiProduction.rows.find((r) => r.id === productionId)!
    // Honest status: clean run but with real limitations (no audio, no
    // continuity guarantee) → completed_with_limitations, never bare lies.
    expect(production.status).toBe('completed_with_limitations')
    expect(production.engine).toBe('ffmpeg')

    // Exactly 2 scene generation jobs — no duplicates.
    const sceneJobs = fake.generationJob.rows.filter((j) => j.task === 'video-generation')
    expect(sceneJobs.length).toBe(2)

    // Scenes settled ready with normalized assets.
    const scenes = fake.jazmiiScene.rows.filter((r) => r.productionId === productionId)
    expect(scenes.map((s) => s.status)).toEqual(['ready', 'ready'])
    expect(scenes.every((s) => typeof s.assetPath === 'string')).toBe(true)
    expect(fs.existsSync(path.join(STORAGE_ROOT, scenes[0].assetPath as string))).toBe(true)
    // Raw provider output preserved verbatim next to the normalized clip.
    expect(scenes.every((s) => typeof s.rawAssetPath === 'string')).toBe(true)

    // The final file is REAL and passes ffprobe: 3+6+3 (end card) = 12s @ 30fps.
    const deliverables = JSON.parse(production.deliverableJson as string) as Record<string, string>
    expect(deliverables.video).toContain('final.mp4')
    const finalAbs = path.join(STORAGE_ROOT, deliverables.video)
    expect(fs.existsSync(finalAbs)).toBe(true)
    const probe = await probeVideoFile(finalAbs, 30_000)
    expect(probe.ok).toBe(true)
    expect(probe.video!.width).toBe(1080)
    expect(probe.video!.height).toBe(1920)
    expect(probe.video!.frames).toBe(360) // 12s * 30fps exactly
    expect(probe.video!.durationSec).toBeCloseTo(12, 1)

    // Deliverable set (BRAG-inspired): plan, share copy, storyboard, metadata.
    for (const key of ['poster', 'plan', 'shareCopy', 'storyboard', 'renderMetadata']) {
      expect(typeof deliverables[key]).toBe('string')
      expect(fs.existsSync(path.join(STORAGE_ROOT, deliverables[key]))).toBe(true)
    }
    const shareCopy = fs.readFileSync(path.join(STORAGE_ROOT, deliverables.shareCopy), 'utf8')
    expect(shareCopy.toLowerCase()).toContain('aurora')

    // The orchestration job settled honestly with a real result summary.
    const orchRow = fake.generationJob.rows.find((j) => j.id === orch.id)!
    expect(orchRow.status).toBe('completed')
    const jobResult = JSON.parse(orchRow.resultJson as string)
    expect(jobResult.status).toBe('completed_with_limitations')
    expect(jobResult.engine).toBe('ffmpeg')

    // Trust receipt: finalized WITH verification facts (never bare completion).
    const trust = fake.trustTask.rows.find((t) => t.jobId === orch.id)!
    expect(trust.status).toBe('completed_with_limitations')
    expect(trust.verificationSummary).toContain('ffprobe-validated')
    expect(trust.verificationSummary).toContain('1080x1920')
    expect((JSON.parse(trust.limitationsJson as string) as string[]).some((l) => l.includes('continuity'))).toBe(true)
    const evidence = fake.trustEvidence.rows.filter((e) => e.taskId === trust.id)
    expect(evidence.some((e) => e.kind === 'measurement')).toBe(true)

    // Usage recorded for the LOCAL composition backend.
    expect(usageCalls.some((u) => u.kind === 'video-production' && u.success === true)).toBe(true)
  }, 120_000)

  test('partial: a failed scene stays visible and a REAL partial cut is delivered', async () => {
    const productionId = (await seedProduction()).id
    const orch = await seedOrchestration(productionId)

    const running = processProductionJob({
      id: orch.id,
      userId: OWNER,
      product: 'jazmii',
      task: 'video-production',
      status: 'starting',
      paramsJson: JSON.stringify({ productionId }),
      resultJson: null,
    })
    await new Promise((r) => setTimeout(r, 120))
    await driveScenes(productionId, (idx) => (idx === 2 ? { fail: true, message: 'The provider rejected scene 2 (content policy).' } : {}))
    await running

    const production = fake.jazmiiProduction.rows.find((r) => r.id === productionId)!
    expect(production.status).toBe('partially_completed')

    const scenes = fake.jazmiiScene.rows.filter((r) => r.productionId === productionId)
    expect(scenes.map((s) => s.status).sort()).toEqual(['failed', 'ready'])
    const failed = scenes.find((s) => s.status === 'failed')!
    expect(failed.errorMessage).toContain('content policy')

    // The partial cut is real: 3s scene + 3s end card = 6s.
    const deliverables = JSON.parse(production.deliverableJson as string) as Record<string, string>
    const probe = await probeVideoFile(path.join(STORAGE_ROOT, deliverables.video), 30_000)
    expect(probe.ok).toBe(true)
    expect(probe.video!.durationSec).toBeCloseTo(6, 1)

    const trust = fake.trustTask.rows.find((t) => t.jobId === orch.id)!
    expect(trust.status).toBe('partially_completed')
    expect((JSON.parse(trust.limitationsJson as string) as string[]).join(' ')).toContain('Partial cut')
  }, 120_000)

  test('checkpoint resume: re-running NEVER re-generates delivered scenes', async () => {
    const productionId = (await seedProduction()).id
    const orch = await seedOrchestration(productionId)
    const running = processProductionJob({
      id: orch.id,
      userId: OWNER,
      product: 'jazmii',
      task: 'video-production',
      status: 'starting',
      paramsJson: JSON.stringify({ productionId }),
      resultJson: null,
    })
    await new Promise((r) => setTimeout(r, 120))
    await driveScenes(productionId, () => ({}))
    await running
    const sceneJobsBefore = fake.generationJob.rows.filter((j) => j.task === 'video-generation').length

    // A fresh orchestration claims the SAME production (worker restart /
    // recovery re-claim shape).
    const orch2 = await seedOrchestration(productionId)
    await processProductionJob({
      id: orch2.id,
      userId: OWNER,
      product: 'jazmii',
      task: 'video-production',
      status: 'starting',
      paramsJson: JSON.stringify({ productionId }),
      resultJson: null,
    })

    const sceneJobsAfter = fake.generationJob.rows.filter((j) => j.task === 'video-generation').length
    expect(sceneJobsAfter).toBe(sceneJobsBefore) // zero duplicate provider submissions
    const production = fake.jazmiiProduction.rows.find((r) => r.id === productionId)!
    expect(['completed_with_limitations', 'completed']).toContain(production.status)
    const orch2Row = fake.generationJob.rows.find((j) => j.id === orch2.id)!
    expect(orch2Row.status).toBe('completed')
  }, 120_000)

  test('cancel: the durable flag settles the production honestly, scenes preserved', async () => {
    const productionId = await seedProduction({ cancelRequested: true }).then((p) => p.id)
    const orch = await seedOrchestration(productionId)
    await processProductionJob({
      id: orch.id,
      userId: OWNER,
      product: 'jazmii',
      task: 'video-production',
      status: 'starting',
      paramsJson: JSON.stringify({ productionId }),
      resultJson: null,
    })

    const production = fake.jazmiiProduction.rows.find((r) => r.id === productionId)!
    expect(production.status).toBe('cancelled')
    const orchRow = fake.generationJob.rows.find((j) => j.id === orch.id)!
    expect(orchRow.status).toBe('failed')
    expect(orchRow.errorCode).toBe('CANCELLED')
    const trust = fake.trustTask.rows.find((t) => t.jobId === orch.id)
    expect(trust?.status).toBe('cancelled')
    // No scene generation was ever requested.
    expect(fake.generationJob.rows.filter((j) => j.task === 'video-generation').length).toBe(0)
  })

  test('no approved plan → honest refusal, nothing generated', async () => {
    const productionId = await seedProduction({ storyboardJson: null, approvedAt: null }).then((p) => p.id)
    const orch = await seedOrchestration(productionId)
    await processProductionJob({
      id: orch.id,
      userId: OWNER,
      product: 'jazmii',
      task: 'video-production',
      status: 'starting',
      paramsJson: JSON.stringify({ productionId }),
      resultJson: null,
    })
    const production = fake.jazmiiProduction.rows.find((r) => r.id === productionId)!
    expect(production.status).toBe('failed')
    expect(production.errorCode).toBe('PLAN_MISSING')
    expect(fake.generationJob.rows.filter((j) => j.task === 'video-generation').length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// TRUST SPECIALIST COVERAGE milestone — pre-plan failures must never be
// receipt-silent: PLAN_MISSING / PLAN_INVALID (standing receipt not created
// yet) and PARAMS_INVALID / PRODUCTION_NOT_FOUND (no production context at
// all) each leave an honest failed receipt in the SHARED Trust Engine.
// ---------------------------------------------------------------------------
describe('director — failure receipts for pre-plan and orphan paths', () => {
  test('PLAN_MISSING: a minimal receipt is created and settled failed', async () => {
    const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')
    const productionId = await seedProduction({ storyboardJson: null, approvedAt: null }).then((p) => p.id)
    const orch = await seedOrchestration(productionId)
    await processProductionJob({
      id: orch.id,
      userId: OWNER,
      product: 'jazmii',
      task: 'video-production',
      status: 'starting',
      paramsJson: JSON.stringify({ productionId }),
      resultJson: null,
    })
    const task = fake.trustTask.rows.find((t) => t.jobId === orch.id)
    expect(task).toBeTruthy()
    expect(task!.status).toBe('failed')
    const receipt = await composeTrustReceipt(task!.id as string, OWNER)
    expect(receipt!.task.status).toBe('failed')
    expect(receipt!.task.failureNote).toContain('PLAN_MISSING')
    // the planned-but-unreached steps remain visible on the failed receipt
    const planned = receipt!.steps.filter((s) => s.status === 'planned')
    expect(planned.length).toBeGreaterThan(0)
  })

  test('PLAN_INVALID (malformed storyboard): honest failed receipt', async () => {
    const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')
    const productionId = await seedProduction({
      storyboardJson: JSON.stringify({ storyboard: { totally: 'malformed' }, approvedAt: new Date().toISOString() }),
    }).then((p) => p.id)
    const orch = await seedOrchestration(productionId)
    await processProductionJob({
      id: orch.id,
      userId: OWNER,
      product: 'jazmii',
      task: 'video-production',
      status: 'starting',
      paramsJson: JSON.stringify({ productionId }),
      resultJson: null,
    })
    const production = fake.jazmiiProduction.rows.find((r) => r.id === productionId)!
    expect(production.status).toBe('failed')
    expect(production.errorCode).toBe('PLAN_INVALID')
    const task = fake.trustTask.rows.find((t) => t.jobId === orch.id)
    expect(task?.status).toBe('failed')
    const receipt = await composeTrustReceipt(task!.id as string, OWNER)
    expect(receipt!.task.failureNote).toContain('PLAN_INVALID')
  })

  test('PARAMS_INVALID: an orphan receipt bound to the job records the attempt honestly', async () => {
    const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')
    await fake.generationJob.create({
      data: {
        id: 'orch-orphan-1',
        userId: OWNER,
        product: 'jazmii',
        task: 'video-production',
        status: 'starting',
        paramsJson: 'not-json-at-all',
        resultJson: null,
      },
    })
    await processProductionJob({
      id: 'orch-orphan-1',
      userId: OWNER,
      product: 'jazmii',
      task: 'video-production',
      status: 'starting',
      paramsJson: 'not-json-at-all',
      resultJson: null,
    })
    const task = fake.trustTask.rows.find((t) => t.jobId === 'orch-orphan-1')
    expect(task).toBeTruthy()
    expect(task!.status).toBe('failed')
    const receipt = await composeTrustReceipt(task!.id as string, OWNER)
    expect(receipt!.task.failureNote).toContain('PARAMS_INVALID')
    expect(receipt!.task.limitations.some((l) => l.includes('No scene was generated'))).toBe(true)
  })

  test('PRODUCTION_NOT_FOUND: an orphan receipt records that nothing was generated', async () => {
    const { composeTrustReceipt } = await import('../../src/lib/trust/receipt')
    await fake.generationJob.create({
      data: {
        id: 'orch-orphan-2',
        userId: OWNER,
        product: 'jazmii',
        task: 'video-production',
        status: 'starting',
        paramsJson: JSON.stringify({ productionId: 'prod-gone' }),
        resultJson: null,
      },
    })
    await processProductionJob({
      id: 'orch-orphan-2',
      userId: OWNER,
      product: 'jazmii',
      task: 'video-production',
      status: 'starting',
      paramsJson: JSON.stringify({ productionId: 'prod-gone' }),
      resultJson: null,
    })
    const task = fake.trustTask.rows.find((t) => t.jobId === 'orch-orphan-2')
    expect(task).toBeTruthy()
    expect(task!.status).toBe('failed')
    const receipt = await composeTrustReceipt(task!.id as string, OWNER)
    expect(receipt!.task.failureNote).toContain('PRODUCTION_NOT_FOUND')
    expect(receipt!.task.failureNote).toContain('nothing was generated')
  })
})
