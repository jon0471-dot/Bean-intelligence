/**
 * BEAN Intelligence — JAZMII Auto Director: production orchestrator worker.
 *
 * Executes ONE approved production to a terminal outcome on the EXISTING
 * durable queue (task 'video-production', product jazmii — the same lease/
 * heartbeat/recovery/cancel protocol as every other job):
 *
 *   approved → scene generation (REAL GenerationJob rows, task
 *              'video-generation' — the existing video worker submits,
 *              polls, downloads, ffprobe-validates and stores every clip)
 *            → media preparation (contain+fill normalization, raw assets
 *              preserved verbatim)
 *            → composition (HyperFrames when probed + check-gated, FFmpeg
 *              always-available)
 *            → final ffprobe validation
 *            → deliverables (storyboard.json, production-plan.md, poster,
 *              captions.srt, share-copy.txt, render-metadata.json)
 *            → Trust Engine receipt + usage metering
 *
 * Honesty rules (non-negotiable):
 *  - a scene that failed stays FAILED and visible; successful scenes are
 *    preserved — the production settles as partially_completed with a real
 *    partial cut rather than pretending;
 *  - the production is never completed merely because an MP4 exists — the
 *    file must pass the ffprobe stream gate;
 *  - checkpoint resume is keyed on DISK-VALIDATED scene assets + scene rows:
 *    a re-claimed orchestration (worker crash, restart) never re-submits a
 *    scene whose provider task already produced a stored, validated clip;
 *  - cancellation is cooperative: checked between every stage, scene jobs
 *    get the existing stop-tracking cancel, and the outcome is settled
 *    honestly.
 *
 * SERVER-ONLY.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { recordUsage } from '@/lib/observability/metering'
import { appendJobEventSafe } from '@/lib/ai-engine/events'
import { requestVideoCancel } from '@/lib/jobs/video-worker'
import { probeVideoFile } from '@/lib/media/ffprobe'
import {
  createTrustTask,
  startTrustTask,
  planTrustSteps,
  updateTrustStepStatus,
  addTrustEvidence,
  finalizeTrustTask,
  failTrustTask,
  cancelTrustTask,
} from '@/lib/trust/tasks'
import { writeTrustCheckpoint, latestValidTrustCheckpoint } from '@/lib/trust/checkpoints'
import { registerResumableKind } from '@/lib/trust/resume'
import { canonicalJson, sha256Hex } from '@/lib/trust/digest'
import {
  approvedPlanSchema,
  sceneGenerationLength,
  type ApprovedPlan,
  type Storyboard,
} from '@/lib/jazmii/director/schema'
import {
  productionDir,
  absoluteFromStorage,
  storageRelative,
  normalizeSceneClip,
  probeClip,
  writeDeliverables,
  renderProductionPlan,
  renderShareCopy,
  dirUsage,
  dirSizeOk,
} from '@/lib/jazmii/director/media'
import { resolveCompositionEngine, type CompositionPlan } from '@/lib/jazmii/director/composition'
import type { CompositionEngineId } from '@/lib/jazmii/director/composition/types'

const ORCHESTRATION_MAX_MS = Number(process.env.JAZMII_DIRECTOR_MAX_MS ?? 60 * 60_000)
const SCENE_POLL_INTERVAL_MS = Number(process.env.JAZMII_DIRECTOR_SCENE_POLL_MS ?? 4_000)
const COMPOSITION_BACKEND_ID = 'bean-video-composition-local'

/** Trust resume contract: this executor persists checkpoints and resumes
 *  scene generation without duplicating provider submissions. */
registerResumableKind('video-production', { retryRunningStep: true })

export interface DirectorJobParams {
  productionId: string
}

export interface DirectorJobResult {
  productionId: string
  status: string
  engine: CompositionEngineId | null
  scenes: Array<{ idx: number; status: string; error: string | null }>
  deliverables: Record<string, string> | null
  notes: string[]
}

type JobRow = {
  id: string
  userId: string
  product: string
  task: string
  status: string
  paramsJson: string
  resultJson: string | null
  cancelRequested?: boolean
}

const ACTIVE_STATUSES = ['starting', 'running', 'streaming', 'finalizing'] as const

async function settleActiveGuarded(id: string, data: Record<string, unknown>): Promise<boolean> {
  const res = await db.generationJob.updateMany({
    where: { id, status: { in: [...ACTIVE_STATUSES, 'queued', 'retry_wait'] } },
    data,
  })
  return res.count === 1
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function fileDigest(absPath: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex')
  } catch {
    return null
  }
}

export class DirectorFailureError extends Error {
  readonly code: string
  readonly errorClass: string
  constructor(code: string, message: string, errorClass = 'permanent') {
    super(message)
    this.name = 'DirectorFailureError'
    this.code = code
    this.errorClass = errorClass
  }
}

/**
 * Execute (or resume) one production orchestration. Mirrors the video
 * worker's contract: the row is settled by THIS function; the runner's
 * outcome envelope only handles unexpected throws.
 *
 * Trust contract (specialist-coverage milestone): an UNEXPECTED throw after
 * the receipt exists must never leave a stuck `running` receipt — the catch
 * settles the Trust task failed with the real reason, then rethrows so the
 * runner still settles the job row.
 */
export async function processProductionJob(job: JobRow): Promise<void> {
  try {
    await runProductionOrchestration(job)
  } catch (e) {
    // Unexpected orchestration error: settle the receipt honestly (when one
    // exists), then let the runner envelope settle the job row.
    try {
      const params = JSON.parse(job.paramsJson) as DirectorJobParams
      const production = await db.jazmiiProduction.findUnique({ where: { id: params.productionId } })
      const taskId = production?.trustTaskId ?? null
      const message = e instanceof Error ? e.message : String(e)
      if (taskId) {
        await failTrustTask(taskId, {
          failureNote: `The orchestration failed unexpectedly before it could settle: ${message.slice(0, 400)}`.slice(0, 590),
          limitations: ['No final video was delivered by this run; the production row records the job-level failure.'],
        })
      }
    } catch (trustError) {
      logger.warn('jazmii.director_trust_catch_settle_failed', {
        message: trustError instanceof Error ? trustError.message.slice(0, 160) : String(trustError).slice(0, 160),
      })
    }
    throw e
  }
}

async function runProductionOrchestration(job: JobRow): Promise<void> {
  let params: DirectorJobParams
  try {
    params = JSON.parse(job.paramsJson) as DirectorJobParams
  } catch {
    const settledRow = await settleActiveGuarded(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      errorCode: 'PARAMS_INVALID',
      errorMessage: 'The production job parameters could not be parsed.',
      errorClass: 'permanent',
    })
    if (settledRow) {
      // Trust Engine: an honest receipt for the unparseable orchestration job.
      await recordOrphanJobTrustFailure(job, 'PARAMS_INVALID', 'The production job parameters could not be parsed; no production work was attempted.')
    }
    return
  }

  const production = await db.jazmiiProduction.findUnique({
    where: { id: params.productionId },
    include: { scenes: { orderBy: { idx: 'asc' } } },
  })
  if (!production || production.userId !== job.userId) {
    const settledRow = await settleActiveGuarded(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      errorCode: 'PRODUCTION_NOT_FOUND',
      errorMessage: 'The production referenced by this job no longer exists.',
      errorClass: 'permanent',
    })
    if (settledRow) {
      // Trust Engine: even this earliest failure leaves an honest receipt —
      // the job was claimed, attempted, and produced nothing.
      await recordOrphanJobTrustFailure(job, 'PRODUCTION_NOT_FOUND', 'The production referenced by this job no longer exists; nothing was generated or modified.')
    }
    return
  }

  const startedAt = new Date()
  const workspace = productionDir(production.userId, production.id)

  // ---- the approved plan is the ONLY entry point ----------------------------
  if (!production.storyboardJson || !production.approvedAt) {
    await settleProductionFailed(production.id, job.id, production.trustTaskId, 'PLAN_MISSING', 'The production has no approved storyboard; nothing was generated.')
    return
  }
  const planParsed = approvedPlanSchema.safeParse(JSON.parse(production.storyboardJson))
  if (!planParsed.success) {
    await settleProductionFailed(production.id, job.id, production.trustTaskId, 'PLAN_INVALID', 'The approved storyboard is malformed; nothing was generated.')
    return
  }
  const plan: ApprovedPlan = planParsed.data
  const sb: Storyboard = plan.storyboard

  // ---- Trust ledger (created BEFORE the cancel check — every orchestration
  //      run leaves an inspectable receipt, including a cancelled one) -------
  const trustTaskId = await ensureTrustTask(production.id, production.userId, job.id, production.trustTaskId, sb)

  // ---- cancellation (owner request wins over everything) --------------------
  const cancelled = await db.jazmiiProduction.findUnique({
    where: { id: production.id },
    select: { cancelRequested: true },
  })
  if (cancelled?.cancelRequested) {
    await cancelProduction(production.id, job.id, trustTaskId, 'Cancelled at your request before starting.')
    return
  }

  await db.jazmiiProduction.update({
    where: { id: production.id },
    data: { status: 'generating', startedAt: production.startedAt ?? new Date(), progress: 5 },
  })

  // ---- ensure scene rows (idempotent for resume) ------------------------------
  await ensureSceneRows(production.id, sb)

  // ---- checkpoint resume: skip scenes whose validated asset is on disk -------
  await reconcileScenesFromDisk(production.id, workspace)

  // ---- enqueue any scene without a live job ----------------------------------
  const scenes = await db.jazmiiScene.findMany({ where: { productionId: production.id }, orderBy: { idx: 'asc' } })
  for (const scene of scenes) {
    if (scene.status === 'ready' || scene.status === 'failed') continue
    await ensureSceneJob(production, scene, sb, plan)
  }

  // ---- wait for scene jobs (bounded, cancel-aware) ----------------------------
  const deadline = Date.now() + ORCHESTRATION_MAX_MS
  let progressBase = 8
  let checkpointedReadyCount = -1
  while (Date.now() < deadline) {
    await sleep(SCENE_POLL_INTERVAL_MS)
    const prod = await db.jazmiiProduction.findUnique({ where: { id: production.id }, select: { cancelRequested: true, status: true } })
    if (!prod) return
    if (prod.cancelRequested) {
      await cancelActiveSceneJobs(production.id)
      await cancelProduction(production.id, job.id, trustTaskId, 'Cancelled at your request — completed scenes are preserved.')
      return
    }
    const current = await db.jazmiiScene.findMany({ where: { productionId: production.id }, orderBy: { idx: 'asc' } })
    // Refresh scene rows from their generation jobs (idempotent).
    for (const scene of current) {
      if (scene.status !== 'pending' && scene.status !== 'generating') continue
      await syncSceneFromJob(scene, workspace)
    }
    const pending = current.filter((s) => s.status !== 'ready' && s.status !== 'failed')
    const done = current.length - pending.length
    progressBase = 8 + Math.round((done / current.length) * 52)
    await db.jazmiiProduction.updateMany({
      where: { id: production.id, status: 'generating' },
      data: { progress: Math.min(60, progressBase) },
    })
    // Trust checkpoint at every scene-settlement boundary (spec §13): the
    // payload holds only SAFE resumable state — scene indices, job ids and
    // storage-relative asset paths. A re-claimed orchestration reads the
    // JazmiiScene rows (the operative checkpoint) and the receipt shows this
    // checkpoint trail.
    const readyCount = current.filter((s) => s.status === 'ready').length
    if (trustTaskId && readyCount !== checkpointedReadyCount) {
      checkpointedReadyCount = readyCount
      await writeTrustCheckpoint(trustTaskId, {
        label: `scenes-ready-${readyCount}`,
        payload: {
          contract: 'jazmii-director-scene-checkpoint-v1',
          productionId: production.id,
          ready: current
            .filter((s) => s.status === 'ready')
            .map((s) => ({ idx: s.idx, jobId: s.jobId, rawAsset: s.rawAssetPath })),
          failed: current.filter((s) => s.status === 'failed').map((s) => ({ idx: s.idx, errorClass: s.errorClass })),
        },
      }).catch(() => undefined)
    }
    if (current.every((s) => s.status === 'ready' || s.status === 'failed')) break
  }

  // Deadline honesty: anything not settled now is a failure, never a hang.
  const afterLoop = await db.jazmiiScene.findMany({ where: { productionId: production.id }, orderBy: { idx: 'asc' } })
  for (const scene of afterLoop) {
    if (scene.status !== 'ready' && scene.status !== 'failed') {
      await db.jazmiiScene.update({
        where: { id: scene.id },
        data: { status: 'failed', errorClass: 'timeout', errorMessage: 'Scene tracking exceeded the production time limit.' },
      })
    }
  }
  // Production-level cancel request may have arrived during the loop.
  const prodFinal = await db.jazmiiProduction.findUnique({ where: { id: production.id }, select: { cancelRequested: true } })
  if (prodFinal?.cancelRequested) {
    await cancelProduction(production.id, job.id, trustTaskId, 'Cancelled at your request — completed scenes are preserved.')
    return
  }

  const ready = afterLoop.filter((s) => s.status === 'ready')
  const failedScenes = afterLoop.filter((s) => s.status === 'failed')

  if (ready.length === 0) {
    await settleProductionFailed(
      production.id, job.id, trustTaskId, 'NO_SCENES',
      failedScenes.length > 0
        ? `No scene clip could be generated (${failedScenes.length} failed). First failure: ${failedScenes[0].errorMessage ?? 'unknown'}.`
        : 'No scene clip could be generated.',
      failedScenes,
    )
    return
  }

  // ---- media preparation -------------------------------------------------------
  await db.jazmiiProduction.update({ where: { id: production.id }, data: { status: 'composing', progress: 62 } })
  if (trustTaskId) {
    await updateTrustStepStatus(trustTaskId, STEP_MEDIA_PREP, 'running').catch(() => undefined)
  }
  const prepNotes: string[] = []
  for (const scene of ready) {
    const raw = absoluteFromStorage(scene.rawAssetPath!)
    const outAbs = path.join(workspace, 'clips', `scene-${String(scene.idx).padStart(2, '0')}.mp4`)
    const norm = await normalizeSceneClip(raw, outAbs, { width: sb.width, height: sb.height, fps: sb.fps }, sceneDuration(sb, scene.idx), '0x' + backgroundHex(sb))
    if (!norm.ok) {
      // A clip that cannot be normalized is an honest scene failure.
      await db.jazmiiScene.update({
        where: { id: scene.id },
        data: { status: 'failed', errorClass: 'permanent', errorMessage: norm.error ?? 'normalization failed' },
      })
      prepNotes.push(`scene ${scene.idx}: ${norm.error ?? 'normalization failed'}`)
      continue
    }
    for (const note of norm.notes) prepNotes.push(`scene ${scene.idx}: ${note}`)
    await db.jazmiiScene.update({
      where: { id: scene.id },
      data: { assetPath: storageRelative(outAbs), probeJson: norm.probeJson },
    })
  }
  if (trustTaskId) {
    await updateTrustStepStatus(trustTaskId, STEP_MEDIA_PREP, prepNotes.length ? 'done' : 'done', {
      detailJson: JSON.stringify({ notes: prepNotes.slice(0, 8) }),
    }).catch(() => undefined)
  }

  const composeReady = (await db.jazmiiScene.findMany({ where: { productionId: production.id }, orderBy: { idx: 'asc' } }))
    .filter((s) => s.status === 'ready' && s.assetPath)
  if (composeReady.length === 0) {
    await settleProductionFailed(production.id, job.id, trustTaskId, 'PREP_FAILED', 'No scene clip survived media preparation.', failedScenes)
    return
  }

  // ---- composition ---------------------------------------------------------------
  const usage = dirUsage(workspace)
  if (!dirSizeOk(usage)) {
    await settleProductionFailed(production.id, job.id, trustTaskId, 'DISK_BUDGET', 'The production workspace exceeded the local disk budget; composition was refused.')
    return
  }
  const { engine, fallbackNote } = await resolveCompositionEngine(plan.enginePreference)
  if (fallbackNote) prepNotes.push(fallbackNote)
  await db.jazmiiProduction.update({ where: { id: production.id }, data: { status: 'rendering', progress: 72 } })
  if (trustTaskId) await updateTrustStepStatus(trustTaskId, STEP_COMPOSITION, 'running').catch(() => undefined)

  const finalDir = path.join(workspace, 'final')
  fs.mkdirSync(finalDir, { recursive: true })
  const outputPath = path.join(finalDir, 'final.mp4')

  const compositionPlan: CompositionPlan = {
    productionId: production.id,
    title: sb.title,
    canvas: { width: sb.width, height: sb.height, fps: sb.fps },
    background: backgroundHex(sb),
    scenes: composeReady.map((s) => ({
      idx: s.idx,
      clipPath: absoluteFromStorage(s.assetPath!),
      durationSec: sceneDuration(sb, s.idx),
      caption: sceneCaption(sb, s.idx),
      transitionOut: sceneTransition(sb, s.idx),
    })),
    endCard: {
      title: sb.title,
      subtitle: sb.objective.length <= 90 ? sb.objective : null,
      durationSec: 3,
    },
    audio: {
      musicPath: audioTrackAbs(plan, workspace, 'music'),
      musicVolume: audioTrackVolume(plan, 'music'),
      musicAttribution: audioTrackAttribution(plan, 'music'),
      voiceoverPath: audioTrackAbs(plan, workspace, 'voiceover'),
      voiceoverVolume: 1.0,
      sfx: audioSfxInputs(plan, workspace),
      // M28 Priority C: narration-active regions from the MEASURED segment
      // timing written at attach time (narration-timing.json). Only measured
      // durations become ducking regions — unknown timings are never guessed;
      // without regions the honest static duck applies.
      voiceoverActiveRegions: narrationDuckRegions(production.id, production.userId) ?? undefined,
      duck: storyboardDuckParams(plan),
    },
    workDir: workspace,
    outputPath,
  }

  let result
  try {
    result = await engine.compose(compositionPlan)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await settleProductionFailed(
      production.id, job.id, trustTaskId, 'COMPOSITION_FAILED',
      `Composition failed on the ${engine.id} engine: ${message.slice(0, 260)} Scene assets are preserved — retrying re-composes without re-generating scenes.`,
      [...failedScenes],
    )
    return
  }
  await db.jazmiiProduction.update({ where: { id: production.id }, data: { engine: result.engine, status: 'validating', progress: 88 } })

  // ---- final validation (the REAL gate) -------------------------------------------
  const finalProbe = await probeVideoFile(result.videoPath, 30_000)
  const finalOk = finalProbe.ok && finalProbe.video !== null
  if (!finalOk) {
    await settleProductionFailed(
      production.id, job.id, trustTaskId, 'VALIDATION_FAILED',
      `The composed file failed ffprobe validation: ${finalProbe.error ?? 'unknown'}. Nothing is delivered as complete.`,
      failedScenes,
    )
    return
  }
  if (trustTaskId) {
    await updateTrustStepStatus(trustTaskId, STEP_COMPOSITION, 'done', {
      detailJson: JSON.stringify({ engine: result.engine, notes: result.notes.slice(0, 6) }),
    }).catch(() => undefined)
    await updateTrustStepStatus(trustTaskId, STEP_VALIDATION, 'done', {
      detailJson: JSON.stringify({ stream: finalProbe.video, audio: finalProbe.audio ?? null }),
    }).catch(() => undefined)
    const digest = fileDigest(result.videoPath)
    if (digest && finalProbe.video) {
      await addTrustEvidence(trustTaskId, {
        kind: 'measurement',
        ref: storageRelative(result.videoPath),
        title: 'Final video — ffprobe stream validation',
        digest,
        note: `engine=${result.engine}; ${finalProbe.video.width}x${finalProbe.video.height}@${finalProbe.video.fps ?? '?'}fps, ${finalProbe.video.durationSec.toFixed(2)}s`,
      }).catch(() => undefined)
    }
  }

  // ---- deliverables ------------------------------------------------------------------
  const engineIdUsed = result.engine
  const partial = failedScenes.length > 0
  const planMd = renderProductionPlan(sb, { productionId: production.id, engine: engineIdUsed, approvedAt: plan.approvedAt })
  const shareCopy = renderShareCopy(sb)
  const metadata = {
    productionId: production.id,
    engine: engineIdUsed,
    engineNotes: [...result.notes, ...prepNotes].slice(0, 12),
    plannedDurationSec: result.plannedDurationSec,
    measured: {
      width: finalProbe.video!.width,
      height: finalProbe.video!.height,
      durationSec: finalProbe.video!.durationSec,
      frames: finalProbe.video!.frames,
      fps: finalProbe.video!.fps,
      codec: finalProbe.video!.codec,
      bytes: result.bytes,
    },
    audio: {
      music: compositionPlan.audio.musicPath !== null,
      voiceover: compositionPlan.audio.voiceoverPath !== null,
      attribution: compositionPlan.audio.musicAttribution,
    },
    scenes: afterLoop.map((s) => ({ idx: s.idx, status: s.status, assetProbe: s.probeJson ? JSON.parse(s.probeJson) : null })),
    generatedAt: new Date().toISOString(),
  }
  await writeDeliverables(finalDir, { storyboard: sb, plan: planMd, shareCopy, renderMetadata: metadata })

  const deliverables: Record<string, string> = {
    video: storageRelative(result.videoPath),
    ...(result.posterPath ? { poster: storageRelative(result.posterPath) } : {}),
    ...(result.captionsPath ? { captions: storageRelative(result.captionsPath) } : {}),
    storyboard: storageRelative(path.join(finalDir, 'storyboard.json')),
    plan: storageRelative(path.join(finalDir, 'production-plan.md')),
    shareCopy: storageRelative(path.join(finalDir, 'share-copy.txt')),
    renderMetadata: storageRelative(path.join(finalDir, 'render-metadata.json')),
  }

  // ---- honest settlement ------------------------------------------------------------
  const limitations: string[] = []
  if (partial) {
    limitations.push(
      `Partial cut: ${failedScenes.length} of ${afterLoop.length} scenes failed and are missing from the video (${failedScenes.map((s) => `#${s.idx}`).join(', ')}). Failed scenes stay visible in the production.`,
    )
  }
  for (const n of result.notes) limitations.push(n)
  for (const n of prepNotes) limitations.push(n)
  limitations.push('Scene clips are AI-generated shots; cross-scene character/scene continuity is not guaranteed.')
  limitations.push('ffprobe validation proves media structure, not creative quality.')

  // Baseline honesty notes are always present; a bare 'completed' requires a
  // clean run (no engine notes, no prep deviations, no missing audio).
  const baselineNotes = 2
  const extraLimitations = limitations.length - baselineNotes
  const status = partial
    ? 'partially_completed'
    : extraLimitations > 0
      ? 'completed_with_limitations'
      : 'completed'
  const verification = [
    `ffprobe-validated final video: ${finalProbe.video!.codec} ${finalProbe.video!.width}x${finalProbe.video!.height}, ` +
      `${finalProbe.video!.durationSec.toFixed(2)}s, ${finalProbe.video!.frames ?? '?'} frames @ ${finalProbe.video!.fps ?? '?'}fps` +
      `${finalProbe.audio ? `, audio: ${finalProbe.audio.codec}` : ', no audio track'}.`,
    `Composition engine: ${engineIdUsed}. ${result.notes[0] ?? ''}`,
    `Scenes: ${afterLoop.length - failedScenes.length}/${afterLoop.length} delivered.`,
  ].join(' ')

  await db.jazmiiProduction.update({
    where: { id: production.id },
    data: {
      status,
      progress: 100,
      finishedAt: new Date(),
      deliverableJson: JSON.stringify(deliverables),
      engine: engineIdUsed,
      errorMessage: null,
      errorCode: null,
      errorClass: null,
    },
  })

  if (trustTaskId) {
    await updateTrustStepStatus(trustTaskId, STEP_DELIVERY, 'done', {
      detailJson: JSON.stringify({ deliverables: Object.keys(deliverables) }),
    }).catch(() => undefined)
    await finalizeTrustTask(trustTaskId, {
      outcome: status as 'completed' | 'completed_with_limitations' | 'partially_completed',
      outcomeSummary: `${sb.title}: ${afterLoop.length - failedScenes.length}/${afterLoop.length} scenes composed by the ${engineIdUsed} engine into an ffprobe-validated MP4.`,
      verificationSummary: verification.slice(0, 590),
      limitations: limitations.slice(0, 18).map((l) => l.slice(0, 290)),
    }).catch(() => undefined)
  }

  await recordUsage({
    userId: production.userId,
    product: 'jazmii',
    backendId: COMPOSITION_BACKEND_ID,
    kind: 'video-production',
    durationMs: Date.now() - startedAt.getTime(),
    success: true,
  }).catch(() => undefined)

  const jobResult: DirectorJobResult = {
    productionId: production.id,
    status,
    engine: engineIdUsed,
    scenes: afterLoop.map((s) => ({ idx: s.idx, status: s.status, error: s.errorMessage })),
    deliverables,
    notes: [...result.notes, ...prepNotes].slice(0, 12),
  }
  const settled = await settleActiveGuarded(job.id, {
    status: 'completed',
    progress: 100,
    finishedAt: new Date(),
    backendId: COMPOSITION_BACKEND_ID,
    resultJson: JSON.stringify(jobResult),
  })
  if (settled) {
    await appendJobEventSafe(job.id, 'artifact', { production: { id: production.id, status, engine: engineIdUsed } })
  }
  logger.info('jazmii.director_completed', { productionId: production.id, status, engine: engineIdUsed })
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const STEP_PLAN = 1
const STEP_APPROVAL = 2
const STEP_GENERATION = 3
const STEP_MEDIA_PREP = 4
const STEP_COMPOSITION = 5
const STEP_VALIDATION = 6
const STEP_DELIVERY = 7

/** Production statuses an orchestration may still transition (terminal
 *  rows are immutable — the settle writes target ONLY these). */
const PRODUCTION_ACTIVE = ['draft', 'awaiting_approval', 'generating', 'composing', 'rendering', 'validating'] as const

async function ensureTrustTask(
  productionId: string,
  userId: string,
  jobId: string,
  existingId: string | null,
  sb: Storyboard,
): Promise<string | null> {
  try {
    if (existingId) {
      const existing = await db.trustTask.findUnique({ where: { id: existingId } })
      if (existing && !['failed', 'cancelled', 'completed', 'completed_with_limitations', 'partially_completed'].includes(existing.status)) {
        await startTrustTask(existingId).catch(() => undefined)
        return existingId
      }
    }
    const task = await createTrustTask({
      userId,
      product: 'jazmii',
      kind: 'video-production',
      title: `Auto Director — ${sb.title}`.slice(0, 120),
      requestPreview: sb.objective.slice(0, 2000),
      requestChars: sb.objective.length,
      jobId,
    })
    await startTrustTask(task.id)
    await planTrustSteps(task.id, [
      { kind: 'plan', title: 'Storyboard plan (schema-validated)', detailJson: JSON.stringify({ scenes: sb.scenes.length, durationSec: sb.durationSeconds }) },
      { kind: 'approval', title: 'Owner approved the storyboard' },
      { kind: 'generation', title: `Scene generation — ${sb.scenes.length} scene job(s) on the JAZMII video backend` },
      { kind: 'tool', title: 'Media preparation (contain+fill normalization, raw assets preserved)' },
      { kind: 'generation', title: 'Composition and final render (local engine)' },
      { kind: 'verification', title: 'ffprobe stream validation of the final MP4' },
      { kind: 'delivery', title: 'Deliverables (video, poster, captions, plan, share copy)' },
    ])
    await updateTrustStepStatus(task.id, STEP_PLAN, 'done', {
      detailJson: JSON.stringify({ storyboardDigest: sha256Hex(canonicalJson(sb)) }),
    })
    await addTrustEvidence(task.id, {
      kind: 'artifact',
      ref: `jazmii-production:${productionId}:storyboard`,
      title: 'Approved storyboard (schema-validated)',
      digest: sha256Hex(canonicalJson(sb)),
      origin: 'extracted',
      note: 'planner output passed the storyboard schema before approval',
    })
    await updateTrustStepStatus(task.id, STEP_APPROVAL, 'done')
    await db.jazmiiProduction.update({ where: { id: productionId }, data: { trustTaskId: task.id } })
    return task.id
  } catch (e) {
    logger.warn('jazmii.director_trust_task_failed', {
      productionId,
      message: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
    })
    return existingId
  }
}

async function ensureSceneRows(productionId: string, sb: Storyboard): Promise<void> {
  const existing = await db.jazmiiScene.findMany({ where: { productionId }, select: { idx: true } })
  const have = new Set(existing.map((e) => e.idx))
  for (let i = 0; i < sb.scenes.length; i += 1) {
    const idx = i + 1
    if (have.has(idx)) continue
    await db.jazmiiScene.create({
      data: { productionId, idx, sceneJson: JSON.stringify(sb.scenes[i]), status: 'pending' },
    })
  }
}

/**
 * Checkpoint resume: a scene row whose asset exists on disk AND passes a real
 * ffprobe probe is READY without any provider call — a re-claimed
 * orchestration (crash/restart) never re-generates delivered scenes.
 */
async function reconcileScenesFromDisk(productionId: string, workspace: string): Promise<void> {
  const scenes = await db.jazmiiScene.findMany({ where: { productionId }, orderBy: { idx: 'asc' } })
  for (const scene of scenes) {
    if (scene.status === 'ready' && scene.assetPath) {
      const abs = absoluteFromStorage(scene.assetPath)
      if (fs.existsSync(abs)) {
        const probe = await probeClip(abs)
        if (probe) continue // validated on disk — keep, skip generation
      }
      await db.jazmiiScene.update({
        where: { id: scene.id },
        data: { status: 'pending', assetPath: null, probeJson: null },
      })
      logger.info('jazmii.director_scene_asset_lost', { productionId, idx: scene.idx })
    }
  }
  void workspace
}

/**
 * Give a scene its generation job: create the GenerationJob row FIRST,
 * persist the link on the scene row, THEN wake the queue — a crash between
 * the steps leaves a queued job that the next resume re-uses (never a
 * duplicate provider submission).
 */
async function ensureSceneJob(
  production: { id: string; userId: string; width: number; height: number; fps: number; briefJson: string | null },
  scene: { id: string; idx: number; sceneJson: string; jobId: string | null; attempts: number; status: string },
  sb: Storyboard,
  plan: ApprovedPlan,
): Promise<void> {
  const spec = JSON.parse(scene.sceneJson) as Storyboard['scenes'][number]
  if (scene.jobId) {
    // Re-attach to the EXISTING job (resume path): re-wake the queue.
    const row = await db.generationJob.findUnique({ where: { id: scene.jobId }, select: { status: true } })
    if (row && ['queued', 'retry_wait', 'starting', 'running', 'streaming', 'finalizing'].includes(row.status)) {
      const { enqueueJob } = await import('@/lib/jobs/queue')
      enqueueJob(scene.jobId)
      await db.jazmiiScene.update({ where: { id: scene.id }, data: { status: 'generating' } })
      return
    }
    // Terminal job — syncSceneFromJob classifies it (ready/failed) on the
    // next poll pass; nothing to enqueue.
    return
  }
  const reference = productionReferenceUrl(production, sb)
  // The provider generates ONLY 5s/10s shots (measured 2026-11-20: any other
  // duration is rejected upstream, error 1214). The planned timeline duration
  // is preserved by trimming at media preparation — the storyboard's duration
  // accounting stays exact and no unsupported parameter is ever sent.
  const generationSec = sceneGenerationLength(spec.durationSeconds)
  const params = {
    prompt: spec.generationPrompt,
    ...(reference ? { imageUrl: reference } : {}),
    size: `${production.width}x${production.height}`,
    durationSec: generationSec,
    fps: production.fps,
    withAudio: false,
    quality: 'quality' as const,
    director: { productionId: production.id, sceneIdx: scene.idx },
  }
  const { dedupeKeyFor } = await import('@/lib/ai-engine/queue')
  const dedupeKey = dedupeKeyFor(production.userId, 'jazmii', 'video-generation', {
    director: params.director,
    prompt: params.prompt,
    attempt: scene.attempts,
  })
  const job = await db.generationJob.create({
    data: {
      userId: production.userId,
      product: 'jazmii',
      task: 'video-generation',
      status: 'queued',
      progress: 0,
      dedupeKey,
      paramsJson: JSON.stringify(params),
    },
  })
  // Link BEFORE enqueue (crash-safe ordering — see docstring).
  await db.jazmiiScene.update({
    where: { id: scene.id },
    data: { jobId: job.id, status: 'generating', attempts: scene.attempts + 1 },
  })
  const { enqueueJob } = await import('@/lib/jobs/queue')
  enqueueJob(job.id)
  await appendJobEventSafe(job.id, 'notice', { director_scene: scene.idx, productionId: production.id })
}

/**
 * The scene reference image: the production's uploaded driver image, served
 * from the production workspace as a data URL (the video worker validates it
 * with the same reference-image gate as any I2V job).
 */
function productionReferenceUrl(
  production: { id: string; userId: string; briefJson: string | null },
  sb: Storyboard,
): string | null {
  void sb
  try {
    if (!production.briefJson) return null
    const brief = JSON.parse(production.briefJson) as { referenceImageUrl?: string }
    if (typeof brief.referenceImageUrl === 'string' && brief.referenceImageUrl.length > 0) {
      return brief.referenceImageUrl
    }
    return null
  } catch {
    return null
  }
}

/**
 * Classify one scene row against its job row: completed job → raw asset
 * (verbatim provider output) + READY; failed/cancelled job → FAILED with the
 * real message; still-active job → GENERATING. Idempotent.
 */
async function syncSceneFromJob(
  scene: { id: string; idx: number; jobId: string | null; status: string; rawAssetPath: string | null },
  _workspace: string,
): Promise<void> {
  if (!scene.jobId) return
  if (scene.status === 'ready' || scene.status === 'failed') return
  const job = await db.generationJob.findUnique({ where: { id: scene.jobId } })
  if (!job) {
    await db.jazmiiScene.update({
      where: { id: scene.id },
      data: { status: 'failed', errorClass: 'permanent', errorMessage: 'The scene generation job no longer exists.' },
    })
    return
  }
  if (job.status === 'completed') {
    let result: { videoUrl?: string; format?: string; stream?: { width?: number; height?: number } } = {}
    try {
      result = JSON.parse(job.resultJson ?? '{}')
    } catch {
      /* honest failure below */
    }
    if (result.videoUrl && result.format) {
      // The video worker stores clips at storage/jazmii/<userId>/<jobId>.<ext>.
      const rawRel = `${job.userId}/${job.id}.${result.format}`
      const rawAbs = absoluteFromStorage(rawRel)
      if (fs.existsSync(rawAbs)) {
        await db.jazmiiScene.update({
          where: { id: scene.id },
          data: { status: 'ready', rawAssetPath: rawRel, assetPath: null, probeJson: null, errorMessage: null, errorClass: null },
        })
        return
      }
      await db.jazmiiScene.update({
        where: { id: scene.id },
        data: { status: 'failed', errorClass: 'permanent', errorMessage: 'The scene job completed but its clip is missing from storage.' },
      })
      return
    }
    await db.jazmiiScene.update({
      where: { id: scene.id },
      data: { status: 'failed', errorClass: 'permanent', errorMessage: 'The scene job completed without a video artifact.' },
    })
    return
  }
  if (job.status === 'failed' || job.status === 'cancelled') {
    await db.jazmiiScene.update({
      where: { id: scene.id },
      data: {
        status: 'failed',
        errorClass: job.errorClass ?? (job.status === 'cancelled' ? 'cancelled' : 'permanent'),
        errorMessage: job.errorMessage ?? 'The scene generation job failed.',
      },
    })
    return
  }
  // still active
  if (scene.status !== 'generating') {
    await db.jazmiiScene.update({ where: { id: scene.id }, data: { status: 'generating' } })
  }
}

/**
 * Trust receipt for an orchestration job that failed BEFORE any production
 * context could exist (unparseable params / missing production row): a
 * minimal, honest receipt bound to the job — the attempt happened and
 * produced nothing (best-effort; never breaks the worker).
 */
async function recordOrphanJobTrustFailure(job: JobRow, code: string, message: string): Promise<void> {
  try {
    const task = await createTrustTask({
      userId: job.userId,
      product: 'jazmii',
      kind: 'video-production',
      title: 'Auto Director — orchestration failed',
      jobId: job.id,
    })
    await planTrustSteps(task.id, [
      { kind: 'plan', title: 'Storyboard planning' },
      { kind: 'generation', title: 'Scene generation and composition' },
    ])
    await startTrustTask(task.id)
    await updateTrustStepStatus(task.id, 1, 'skipped', { errorNote: 'no storyboard could be resolved for this job' })
    await updateTrustStepStatus(task.id, 2, 'skipped', { errorNote: 'never started — the job failed before any scene work' })
    await failTrustTask(task.id, {
      failureNote: `${code}: ${message}`.slice(0, 590),
      limitations: ['No scene was generated, no composition ran, and no video was delivered.'],
    })
  } catch (e) {
    logger.warn('jazmii.director_orphan_trust_failed', {
      jobId: job.id,
      message: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
    })
  }
}

async function cancelActiveSceneJobs(productionId: string): Promise<void> {
  const scenes = await db.jazmiiScene.findMany({ where: { productionId }, select: { jobId: true, status: true } })
  for (const s of scenes) {
    if (!s.jobId) continue
    if (s.status === 'ready' || s.status === 'failed') continue
    await requestVideoCancel(s.jobId).catch(() => undefined)
  }
}

async function cancelProduction(productionId: string, jobId: string, trustTaskId: string | null, note: string): Promise<void> {
  await cancelActiveSceneJobs(productionId)
  await db.jazmiiProduction.updateMany({
    where: { id: productionId, status: { in: [...PRODUCTION_ACTIVE] } },
    data: { status: 'cancelled', finishedAt: new Date(), errorMessage: note, errorCode: 'CANCELLED', errorClass: 'cancelled' },
  })
  const settled = await settleActiveGuarded(jobId, {
    status: 'failed',
    finishedAt: new Date(),
    errorCode: 'CANCELLED',
    errorMessage: note,
    errorClass: 'cancelled',
  })
  if (settled) await appendJobEventSafe(jobId, 'notice', { production_cancelled: productionId })
  // Trust Engine: the cancellation is recorded even when the orchestration's
  // standing receipt does not exist yet — cancellation must never be silent.
  let receiptId = trustTaskId
  if (!receiptId) {
    receiptId = await createMinimalProductionTrustTask(productionId, jobId)
  }
  if (receiptId) {
    await cancelTrustTask(receiptId, note).catch(() => undefined)
  }
  logger.info('jazmii.director_cancelled', { productionId })
}

/**
 * Minimal receipt for a production whose standing Trust task was never
 * created (pre-plan failures, cancel-before-plan). Bound to the production
 * row (userId/title/objective) and the orchestration job; the caller settles
 * it immediately from the REAL outcome.
 */
async function createMinimalProductionTrustTask(productionId: string, jobId: string): Promise<string | null> {
  try {
    const production = await db.jazmiiProduction.findUnique({ where: { id: productionId } })
    if (!production) return null
    let objective = ''
    try {
      const brief = production.briefJson ? (JSON.parse(production.briefJson) as { objective?: string }) : null
      if (typeof brief?.objective === 'string') objective = brief.objective
    } catch {
      /* bounded fallback below */
    }
    const task = await createTrustTask({
      userId: production.userId,
      product: 'jazmii',
      kind: 'video-production',
      title: `Auto Director — ${production.title}`.slice(0, 120),
      ...(objective ? { requestPreview: objective.slice(0, 2000) } : {}),
      jobId,
    })
    await planTrustSteps(task.id, [
      { kind: 'plan', title: 'Storyboard planning' },
      { kind: 'approval', title: 'Owner approval' },
      { kind: 'generation', title: 'Scene generation and composition' },
      { kind: 'verification', title: 'ffprobe stream validation of the final MP4' },
    ])
    await startTrustTask(task.id)
    return task.id
  } catch (e) {
    logger.warn('jazmii.director_minimal_trust_failed', {
      productionId,
      message: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
    })
    return null
  }
}

async function settleProductionFailed(
  productionId: string,
  jobId: string,
  trustTaskId: string | null,
  code: string,
  message: string,
  failedScenes: Array<{ id: string; idx: number; errorMessage: string | null }> = [],
): Promise<void> {
  await db.jazmiiProduction.updateMany({
    where: { id: productionId, status: { in: [...PRODUCTION_ACTIVE] } },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      errorCode: code,
      errorMessage: message.slice(0, 500),
      errorClass: 'permanent',
      progress: 100,
    },
  })
  const settled = await settleActiveGuarded(jobId, {
    status: 'failed',
    finishedAt: new Date(),
    errorCode: code,
    errorMessage: message.slice(0, 500),
    errorClass: 'permanent',
    backendId: COMPOSITION_BACKEND_ID,
  })
  if (settled) {
    await appendJobEventSafe(jobId, 'error', { code, message: message.slice(0, 300), errorClass: 'permanent' })
  }
  // Trust Engine: a failure must never be silent even when the orchestration
  // never created its standing receipt (pre-plan failures such as
  // PLAN_MISSING / PLAN_INVALID) — a minimal receipt is created and settled
  // from the REAL outcome (best-effort; never breaks the worker).
  let receiptId = trustTaskId
  if (!receiptId) {
    receiptId = await createMinimalProductionTrustTask(productionId, jobId)
  }
  if (receiptId) {
    await failTrustTask(receiptId, {
      failureNote: `${code}: ${message.slice(0, 560)}`.slice(0, 590),
      limitations: failedScenes.slice(0, 8).map((s) => `Scene ${s.idx} failed: ${s.errorMessage ?? 'unknown'}`),
    }).catch(() => undefined)
  }
  await recordUsage({
    userId: (await db.jazmiiProduction.findUnique({ where: { id: productionId }, select: { userId: true } }))?.userId ?? '',
    product: 'jazmii',
    backendId: COMPOSITION_BACKEND_ID,
    kind: 'video-production',
    success: false,
    errorCode: code,
  }).catch(() => undefined)
  logger.warn('jazmii.director_failed', { productionId, code, message: message.slice(0, 200) })
}

// ---- storyboard accessors (scene rows copy their spec at creation) ---------

function sceneSpec(sb: Storyboard, idx: number): Storyboard['scenes'][number] | null {
  return sb.scenes[idx - 1] ?? null
}

function sceneDuration(sb: Storyboard, idx: number): number {
  return sceneSpec(sb, idx)?.durationSeconds ?? 4
}

function sceneCaption(sb: Storyboard, idx: number): string | null {
  return sceneSpec(sb, idx)?.caption ?? null
}

function sceneTransition(sb: Storyboard, idx: number): 'cut' | 'fade' {
  return sceneSpec(sb, idx)?.transitionOut ?? 'cut'
}

/** Background hex from the aspect preset (dark studio ground, BEAN palette). */
function backgroundHex(_sb: Storyboard): string {
  return '0a0a0f'
}

function audioTrackAbs(plan: ApprovedPlan, workspace: string, role: 'music' | 'voiceover'): string | null {
  const track = plan.audioTracks.find((t) => t.role === role)
  if (!track) return null
  const abs = path.join(workspace, 'audio', path.basename(track.path))
  return fs.existsSync(abs) ? abs : null
}

function audioTrackVolume(plan: ApprovedPlan, role: 'music' | 'voiceover'): number {
  const track = plan.audioTracks.find((t) => t.role === role)
  return track?.volume ?? (role === 'music' ? 0.32 : 1.0)
}

function audioTrackAttribution(plan: ApprovedPlan, role: 'music' | 'voiceover'): string | null {
  const track = plan.audioTracks.find((t) => t.role === role)
  return track?.attribution ?? null
}

/**
 * M28 Priority C: narration-active regions for dynamic ducking, read from
 * the MEASURED narration-timing.json written when the voiceover was attached.
 * Only segments with a measured duration contribute; the returned regions
 * are the union of the segment windows (bounded by the duck module's cap).
 * No file / no measured timings → null (the engine then applies the honest
 * static duck and says so — timings are never guessed).
 */
function narrationDuckRegions(productionId: string, userId: string): Array<{ startSec: number; endSec: number }> | null {
  try {
    const timingPath = path.join(productionDir(userId, productionId), 'audio', 'narration-timing.json')
    if (!fs.existsSync(timingPath)) return null
    const parsed = JSON.parse(fs.readFileSync(timingPath, 'utf8')) as {
      segments?: Array<{ approximateStartSec?: number; durationMs?: number | null }>
    }
    const regions = (parsed.segments ?? [])
      .filter((s) => Number.isFinite(s.approximateStartSec) && Number.isFinite(s.durationMs) && (s.durationMs ?? 0) > 0)
      .map((s) => ({ startSec: Math.max(0, s.approximateStartSec as number), endSec: (s.approximateStartSec as number) + (s.durationMs as number) / 1000 }))
      .sort((a, b) => a.startSec - b.startSec)
      .slice(0, 50)
    return regions.length > 0 ? regions : null
  } catch {
    logger.warn('jazmii.composition.narration_timing_unreadable', { productionId })
    return null
  }
}

/** M28: user-configured ducking overrides from the approved plan (optional). */
function storyboardDuckParams(plan: ApprovedPlan): { duckTo?: number; attackMs?: number; releaseMs?: number; curve?: 'linear' | 'cosine'; minMusicLevel?: number } | undefined {
  return plan.duckParams
}

/**
 * M27: scene-timed SFX from the approved plan (bounded to 4). Paths resolve
 * against the production audio dir; a missing file is DROPPED WITH A NOTE —
 * never silently mixed as silence, never a hard failure of the whole
 * production.
 */
function audioSfxInputs(plan: ApprovedPlan, workspace: string): Array<{ path: string; startSec: number; volume: number; label: string | null; fadeInSeconds?: number; fadeOutSeconds?: number }> {
  return plan.audioTracks
    .filter((t) => t.role === 'sfx')
    .slice(0, 4)
    .map((t) => {
      const abs = path.join(workspace, 'audio', path.basename(t.path))
      return {
        path: abs,
        startSec: Math.max(0, t.startSec ?? 0),
        volume: Math.max(0.05, Math.min(1, t.volume ?? 0.9)),
        label: t.attribution ?? null,
        // M28 Priority D: per-effect fades pass through to both engines.
        fadeInSeconds: t.fadeInSeconds,
        fadeOutSeconds: t.fadeOutSeconds,
        exists: fs.existsSync(abs),
      }
    })
    .filter((s) => {
      if (!s.exists) {
        logger.warn('jazmii.composition.sfx_missing', { path: path.basename(s.path) })
        return false
      }
      return true
    })
    .map(({ path: p, startSec, volume, label, fadeInSeconds, fadeOutSeconds }) => ({
      path: p,
      startSec,
      volume,
      label,
      ...(fadeInSeconds !== undefined ? { fadeInSeconds } : {}),
      ...(fadeOutSeconds !== undefined ? { fadeOutSeconds } : {}),
    }))
}

export { latestValidTrustCheckpoint }
