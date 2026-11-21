/**
 * BEAN Intelligence — JAZMII Auto Director: production service (route-level).
 *
 * All owner authorization happens HERE (requireUser + userId checks in every
 * query) — routes stay thin. The service never fabricates success: a failed
 * planner call, a refused regeneration or a missing deliverable surface the
 * real reason to the caller.
 *
 * SERVER-ONLY.
 */
import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { logger } from '@/lib/observability/logger'
import { dedupeKeyFor, hasActiveDuplicate } from '@/lib/ai-engine/queue'
import { enqueueJob } from '@/lib/jobs/queue'
import { requestVideoCancel } from '@/lib/jobs/video-worker'
import { validateVideoReferenceImage } from '@/lib/jazmii/reference-image'
import { generateStoryboard, StoryboardPlannerError } from './planner'
import {
  approvedPlanSchema,
  parseStoryboard,
  sceneGenerationLength,
  type ApprovedPlan,
  type DirectorRequest,
  type Storyboard,
  type AudioTrack,
  MUSIC_VOLUME_DEFAULT,
} from './schema'
import { productionDir } from './media'

const AUDIO_MAX_BYTES = 25 * 1024 * 1024
const AUDIO_MAGIC: Array<{ ext: string; type: string; test: (b: Buffer) => boolean }> = [
  { ext: 'mp3', type: 'audio/mpeg', test: (b) => b.length > 3 && ((b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33)) },
  { ext: 'wav', type: 'audio/wav', test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE' },
  { ext: 'ogg', type: 'audio/ogg', test: (b) => b.length > 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53 },
  { ext: 'm4a', type: 'audio/mp4', test: (b) => b.length > 11 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 },
  { ext: 'flac', type: 'audio/flac', test: (b) => b.length > 4 && b.toString('ascii', 0, 4) === 'fLaC' },
]

const PRODUCTION_ACTIVE_STATUSES = ['generating', 'composing', 'rendering', 'validating']
const PRODUCTION_TERMINAL_STATUSES = ['completed', 'completed_with_limitations', 'partially_completed', 'failed', 'cancelled']

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

export async function createProduction(userId: string, req: DirectorRequest) {
  // The scene-generation prerequisite: an enabled video backend must exist —
  // without it the production could accept scenes it can never generate.
  const { getBackendsForProduct } = await import('@/lib/registry/backends')
  const videoBackends = getBackendsForProduct('jazmii').filter((b) => b.task === 'video-generation')
  if (videoBackends.length > 0 && videoBackends.every((b) => !b.enabled)) {
    throw new BeanApiError('PRODUCT_UNAVAILABLE', `Scene generation is not operational yet. ${videoBackends[0].unavailableReason ?? ''}`.trim())
  }

  const referenceValidation = req.referenceImageUrl
    ? await validateVideoReferenceImage(req.referenceImageUrl)
    : null
  if (referenceValidation && !referenceValidation.ok) {
    throw new BeanApiError('VALIDATION_ERROR', referenceValidation.reason ?? 'The reference image is not usable.')
  }

  let planned
  try {
    planned = await generateStoryboard(req)
  } catch (e) {
    if (e instanceof StoryboardPlannerError) {
      throw new BeanApiError('VALIDATION_ERROR', `The Creative Director could not produce a valid storyboard: ${e.issues[0] ?? e.message}`.slice(0, 300))
    }
    throw e // upstream-class errors surface honestly (rate-limited etc.)
  }

  const production = await db.jazmiiProduction.create({
    data: {
      userId,
      title: planned.storyboard.title,
      status: 'awaiting_approval',
      briefJson: JSON.stringify({
        prompt: req.prompt,
        referenceImageUrl: req.referenceImageUrl ?? null,
        referenceValidation: referenceValidation
          ? { format: referenceValidation.format, width: referenceValidation.width, height: referenceValidation.height, bytes: referenceValidation.bytes }
          : null,
        plannerMeta: planned.meta,
      }),
      storyboardJson: JSON.stringify({ storyboard: planned.storyboard, rev: 1, proposedAt: new Date().toISOString() }),
      storyboardRev: 1,
      style: planned.storyboard.tone,
      aspect: planned.storyboard.format,
      width: planned.storyboard.width,
      height: planned.storyboard.height,
      fps: planned.storyboard.fps,
      requestedDurationSec: planned.storyboard.durationSeconds,
    },
  })
  logger.info('jazmii.director_created', { productionId: production.id, scenes: planned.storyboard.scenes.length, plannerAttempts: planned.meta.attempts })
  return { production, storyboard: planned.storyboard, plannerMeta: planned.meta }
}

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

export async function getProductionForOwner(userId: string, productionId: string) {
  const production = await db.jazmiiProduction.findUnique({
    where: { id: productionId },
    include: { scenes: { orderBy: { idx: 'asc' } } },
  })
  if (!production || production.userId !== userId) return null
  return production
}

/** Owner-scoped audio track metadata (roles only — never file bytes). */
export async function getAudioTracksForOwner(userId: string, productionId: string): Promise<AudioTrack[]> {
  const production = await getProductionForOwner(userId, productionId)
  if (!production) throw new BeanApiError('NOT_FOUND', 'Production not found.')
  return readAudioTracks(productionId, userId)
}

export async function listProductionsForOwner(userId: string, take = 20) {
  return db.jazmiiProduction.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Math.max(take, 1), 50),
    select: {
      id: true, title: true, status: true, style: true, aspect: true, width: true, height: true,
      fps: true, requestedDurationSec: true, progress: true, engine: true, approvedAt: true,
      finishedAt: true, errorMessage: true, errorCode: true, updatedAt: true, createdAt: true,
    },
  })
}

export interface ProposedStoryboardView {
  storyboard: Storyboard
  rev: number
  proposedAt: string
}

export function parseProposal(production: { storyboardJson: string | null; status: string }): ProposedStoryboardView | null {
  if (!production.storyboardJson) return null
  try {
    const raw = JSON.parse(production.storyboardJson) as { storyboard?: unknown; rev?: number; proposedAt?: string }
    // The proposal is ALWAYS schema-checked on read too (defensive honesty).
    const parsed = parseStoryboard(raw.storyboard)
    if (!parsed.ok) return null
    return { storyboard: parsed.storyboard, rev: raw.rev ?? 1, proposedAt: raw.proposedAt ?? new Date().toISOString() }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// approve → orchestration job
// ---------------------------------------------------------------------------

export async function approveProduction(
  userId: string,
  productionId: string,
  opts: { engine?: 'auto' | 'hyperframes' | 'ffmpeg' } = {},
) {
  const production = await getProductionForOwner(userId, productionId)
  if (!production) throw new BeanApiError('NOT_FOUND', 'Production not found.')
  if (production.status !== 'awaiting_approval') {
    throw new BeanApiError('VALIDATION_ERROR', `Only a production awaiting approval can be approved (current: ${production.status}).`)
  }
  const proposal = parseProposal(production)
  if (!proposal) throw new BeanApiError('VALIDATION_ERROR', 'The stored storyboard proposal is unreadable; regenerate it first.')

  // Audio intent recorded while awaiting approval (upload endpoints set it).
  const audioTracks = readAudioTracks(production.id, userId)

  const plan: ApprovedPlan = {
    storyboard: proposal.storyboard,
    approvedAt: new Date().toISOString(),
    approvedRev: proposal.rev,
    enginePreference: opts.engine ?? 'auto',
    audioTracks,
    sceneLimitAck: true,
  }
  // Final gate: the approved payload must satisfy the same schema.
  const checked = approvedPlanSchema.safeParse(plan)
  if (!checked.success) {
    throw new BeanApiError('VALIDATION_ERROR', `The approved plan failed validation: ${checked.error.issues[0]?.message ?? 'unknown'}`)
  }

  // Duplicate guard FIRST (against OTHER active orchestrations of the same
  // revision) — the row is created only after the check, never colliding
  // with itself.
  const dedupeKey = dedupeKeyFor(userId, 'jazmii', 'video-production', {
    productionId,
    rev: proposal.rev,
    approvedAt: plan.approvedAt,
  })
  if (await hasActiveDuplicate(dedupeKey)) {
    throw new BeanApiError('CONCURRENCY_LIMIT', 'This production is already being produced.')
  }

  const orchestration = await db.generationJob.create({
    data: {
      userId,
      product: 'jazmii',
      task: 'video-production',
      status: 'queued',
      progress: 0,
      dedupeKey,
      paramsJson: JSON.stringify({ productionId } satisfies { productionId: string }),
    },
  })

  await db.jazmiiProduction.update({
    where: { id: productionId },
    data: {
      status: 'generating',
      storyboardJson: JSON.stringify(checked.data),
      approvedAt: new Date(),
      jobId: orchestration.id,
      cancelRequested: false,
      errorMessage: null,
      errorCode: null,
      errorClass: null,
      finishedAt: null,
    },
  })
  enqueueJob(orchestration.id)
  logger.info('jazmii.director_approved', { productionId, orchestrationJobId: orchestration.id, scenes: proposal.storyboard.scenes.length })
  return { orchestrationJobId: orchestration.id, plan: checked.data }
}

// ---------------------------------------------------------------------------
// audio tracks (awaiting approval only)
// ---------------------------------------------------------------------------

export async function setProductionAudio(
  userId: string,
  productionId: string,
  role: 'music' | 'voiceover',
  input: { dataUrl: string; attribution?: string; volume?: number },
) {
  const production = await getProductionForOwner(userId, productionId)
  if (!production) throw new BeanApiError('NOT_FOUND', 'Production not found.')
  if (production.status !== 'awaiting_approval') {
    throw new BeanApiError('VALIDATION_ERROR', 'Audio is set while the storyboard is awaiting approval.')
  }
  const m = /^data:(audio\/[a-z0-9.+-]+);base64,(.+)$/s.exec(input.dataUrl)
  if (!m) throw new BeanApiError('VALIDATION_ERROR', 'Audio must be a base64 data URL (audio/*).')
  let bytes: Buffer
  try {
    bytes = Buffer.from(m[2], 'base64')
  } catch {
    throw new BeanApiError('VALIDATION_ERROR', 'The audio payload is not valid base64.')
  }
  if (bytes.length === 0) throw new BeanApiError('VALIDATION_ERROR', 'The audio file is empty.')
  if (bytes.length > AUDIO_MAX_BYTES) {
    throw new BeanApiError('VALIDATION_ERROR', `Audio exceeds the ${Math.round(AUDIO_MAX_BYTES / 1024 / 1024)} MB limit.`)
  }
  const kind = AUDIO_MAGIC.find((k) => k.test(bytes))
  if (!kind) {
    throw new BeanApiError('VALIDATION_ERROR', 'Unsupported audio container — use mp3, wav, ogg, m4a or flac (validated by magic bytes, not by extension).')
  }

  const dir = path.join(productionDir(userId, productionId), 'audio')
  fs.mkdirSync(dir, { recursive: true })
  const fileName = `${role}.${kind.ext}`
  fs.writeFileSync(path.join(dir, fileName), bytes)

  // Replace the track of this role (one track per role).
  const existing = readAudioTracks(productionId, userId).filter((t) => t.role !== role)
  const track: AudioTrack = {
    path: fileName,
    role,
    volume: input.volume ?? (role === 'music' ? MUSIC_VOLUME_DEFAULT : 1.0),
    attribution: input.attribution?.slice(0, 200),
  }
  await writeAudioTracks(productionId, userId, [...existing, track])
  return { audio: [...existing, track], bytes: bytes.length, type: kind.type }
}

export async function clearProductionAudio(userId: string, productionId: string, role: 'music' | 'voiceover') {
  const production = await getProductionForOwner(userId, productionId)
  if (!production) throw new BeanApiError('NOT_FOUND', 'Production not found.')
  if (production.status !== 'awaiting_approval') {
    throw new BeanApiError('VALIDATION_ERROR', 'Audio is editable while the storyboard is awaiting approval.')
  }
  const remaining = readAudioTracks(productionId, userId).filter((t) => t.role !== role)
  await writeAudioTracks(productionId, userId, remaining)
  // Remove the file (best effort).
  try {
    const dir = path.join(productionDir(userId, productionId), 'audio')
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${role}.`)) fs.rmSync(path.join(dir, f), { force: true })
    }
  } catch {
    /* nothing to clean */
  }
  return { audio: remaining }
}

function audioMetaPath(productionId: string, userId: string): string {
  return path.join(productionDir(userId, productionId), 'audio', 'tracks.json')
}

function readAudioTracks(productionId: string, userId: string): AudioTrack[] {
  try {
    const raw = fs.readFileSync(audioMetaPath(productionId, userId), 'utf8')
    const parsed = JSON.parse(raw) as AudioTrack[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((t) => t && (t.role === 'music' || t.role === 'voiceover') && typeof t.path === 'string').slice(0, 2)
  } catch {
    return []
  }
}

function writeAudioTracks(productionId: string, userId: string, tracks: AudioTrack[]): void {
  const p = audioMetaPath(productionId, userId)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(tracks), 'utf8')
}

// ---------------------------------------------------------------------------
// scene regeneration (partial results stay recoverable)
// ---------------------------------------------------------------------------

export async function regenerateScene(userId: string, productionId: string, idx: number) {
  const production = await getProductionForOwner(userId, productionId)
  if (!production) throw new BeanApiError('NOT_FOUND', 'Production not found.')
  const scene = production.scenes.find((s) => s.idx === idx)
  if (!scene) throw new BeanApiError('NOT_FOUND', 'Scene not found.')
  if (production.status !== 'generating' && !PRODUCTION_TERMINAL_STATUSES.includes(production.status)) {
    throw new BeanApiError('VALIDATION_ERROR', `Scene regeneration is not available while the production is ${production.status}.`)
  }
  if (production.status === 'cancelled') {
    throw new BeanApiError('VALIDATION_ERROR', 'This production was cancelled; regenerate from the storyboard instead.')
  }
  if (scene.status === 'ready' && !PRODUCTION_TERMINAL_STATUSES.includes(production.status)) {
    throw new BeanApiError('VALIDATION_ERROR', 'This scene is still being produced; wait for the current run to settle first.')
  }
  if (scene.status !== 'failed') {
    throw new BeanApiError('VALIDATION_ERROR', `Only a failed scene can be regenerated (scene ${idx} is ${scene.status}).`)
  }
  // The old job must be terminal before a new submission is created.
  if (scene.jobId) {
    const oldJob = await db.generationJob.findUnique({ where: { id: scene.jobId }, select: { status: true } })
    if (oldJob && !['completed', 'failed', 'cancelled', 'rejected', 'unsupported'].includes(oldJob.status)) {
      throw new BeanApiError('CONCURRENCY_LIMIT', 'The previous scene attempt is still running; wait for it to settle.')
    }
  }

  const updated = await db.jazmiiScene.update({
    where: { id: scene.id },
    data: {
      status: 'pending',
      jobId: null,
      assetPath: null,
      probeJson: null,
      rawAssetPath: null,
      attempts: { increment: 1 },
      errorClass: null,
      errorMessage: null,
    },
  })

  // If the production already settled, re-open generation with a fresh
  // orchestration job (checkpoint resume keeps every other delivered scene).
  const wasTerminal = PRODUCTION_TERMINAL_STATUSES.includes(production.status)
  let orchestrationJobId: string | null = null
  if (wasTerminal) {
    orchestrationJobId = await reenqueueOrchestration(userId, productionId, production.status)
  }
  logger.info('jazmii.director_scene_regenerated', { productionId, idx, wasTerminal, orchestrationJobId })
  return { scene: updated, orchestrationJobId }
}

async function reenqueueOrchestration(userId: string, productionId: string, fromStatus: string): Promise<string> {
  const job = await db.generationJob.create({
    data: {
      userId,
      product: 'jazmii',
      task: 'video-production',
      status: 'queued',
      progress: 0,
      dedupeKey: dedupeKeyFor(userId, 'jazmii', 'video-production', { productionId, resume: Date.now(), from: fromStatus }),
      paramsJson: JSON.stringify({ productionId } satisfies { productionId: string }),
    },
  })
  await db.jazmiiProduction.update({
    where: { id: productionId },
    data: { status: 'generating', jobId: job.id, finishedAt: null, progress: 5, errorMessage: null, errorCode: null, errorClass: null, deliverableJson: null, engine: null },
  })
  enqueueJob(job.id)
  return job.id
}

/**
 * Resume a production whose ORCHESTRATION died (worker OOM / WORKER_LOST /
 * composition crash) while delivered scene assets are intact. This is the
 * checkpoint-resume promise (spec §13): a failed RENDERING run must resume
 * without re-generating scene assets. Refuses honestly when an orchestration
 * is still active or the production has no approved plan.
 */
export async function resumeProductionForOwner(userId: string, productionId: string) {
  const production = await getProductionForOwner(userId, productionId)
  if (!production) throw new BeanApiError('NOT_FOUND', 'Production not found.')
  if (!production.storyboardJson || !production.approvedAt) {
    throw new BeanApiError('VALIDATION_ERROR', 'The production has no approved storyboard to resume.')
  }
  if (production.status === 'awaiting_approval') {
    throw new BeanApiError('VALIDATION_ERROR', 'The storyboard is still awaiting approval; approve it first.')
  }
  if (PRODUCTION_TERMINAL_STATUSES.includes(production.status) && production.deliverableJson) {
    return { resumed: false, note: `The production already delivered (${production.status}).` }
  }
  if (production.jobId) {
    const job = await db.generationJob.findUnique({ where: { id: production.jobId }, select: { status: true } })
    if (job && ['queued', 'retry_wait', 'starting', 'running', 'streaming', 'finalizing'].includes(job.status)) {
      return { resumed: false, note: 'The orchestration is still running — it will continue on its own.' }
    }
  }
  const jobId = await reenqueueOrchestration(userId, productionId, production.status)
  logger.info('jazmii.director_resumed', { productionId, orchestrationJobId: jobId, from: production.status })
  return { resumed: true, orchestrationJobId: jobId, note: 'Resumed — delivered scenes are kept; composition continues from the surviving assets.' }
}

// ---------------------------------------------------------------------------
// cancel / delete
// ---------------------------------------------------------------------------

export async function cancelProductionForOwner(userId: string, productionId: string) {
  const production = await getProductionForOwner(userId, productionId)
  if (!production) throw new BeanApiError('NOT_FOUND', 'Production not found.')
  if (PRODUCTION_TERMINAL_STATUSES.includes(production.status)) {
    return { cancelled: false, note: `The production already settled (${production.status}).` }
  }
  // The durable flag the orchestrator checks between every stage.
  await db.jazmiiProduction.update({
    where: { id: productionId },
    data: { cancelRequested: true },
  })
  // Scene jobs get the existing stop-tracking cancel immediately.
  for (const scene of production.scenes) {
    if (scene.jobId && scene.status !== 'ready' && scene.status !== 'failed') {
      await requestVideoCancel(scene.jobId).catch(() => undefined)
    }
  }
  // The orchestration job gets the queue's cooperative cancel.
  if (production.jobId) {
    const { requestCancel } = await import('@/lib/ai-engine/queue')
    await requestCancel(production.jobId, userId).catch(() => undefined)
  }
  logger.info('jazmii.director_cancel_requested', { productionId })
  return { cancelled: true, note: 'Cancellation requested — completed scenes are preserved and the production settles as cancelled.' }
}

export async function deleteProductionForOwner(userId: string, productionId: string) {
  const production = await getProductionForOwner(userId, productionId)
  if (!production) throw new BeanApiError('NOT_FOUND', 'Production not found.')
  if (PRODUCTION_ACTIVE_STATUSES.includes(production.status)) {
    throw new BeanApiError('CONCURRENCY_LIMIT', 'The production is still running — cancel it first, then delete.')
  }
  // Scenes cascade with the production row (schema onDelete: Cascade).
  await db.jazmiiProduction.delete({ where: { id: productionId } })
  // Workspace removal is best-effort (deliverables are gone; DB is truth).
  try {
    fs.rmSync(productionDir(userId, productionId), { recursive: true, force: true })
  } catch (e) {
    logger.warn('jazmii.director_workspace_cleanup_failed', {
      productionId,
      message: e instanceof Error ? e.message.slice(0, 120) : 'unknown',
    })
  }
  return { deleted: true }
}

/** Scene-level detail the API returns (never provider internals). */
export function sceneView(scene: { id: string; idx: number; status: string; jobId: string | null; assetPath: string | null; rawAssetPath: string | null; probeJson: string | null; attempts: number; errorClass: string | null; errorMessage: string | null; sceneJson: string; updatedAt: Date }) {
  let spec: { caption?: string; purpose?: string; durationSeconds?: number; visualDescription?: string } = {}
  try {
    spec = JSON.parse(scene.sceneJson)
  } catch {
    /* display-only */
  }
  let probe: unknown = null
  try {
    probe = scene.probeJson ? JSON.parse(scene.probeJson) : null
  } catch {
    probe = null
  }
  return {
    id: scene.id,
    idx: scene.idx,
    status: scene.status,
    purpose: spec.purpose ?? null,
    caption: spec.caption ?? null,
    durationSeconds: spec.durationSeconds ?? null,
    visualDescription: spec.visualDescription ?? null,
    hasClip: Boolean(scene.assetPath),
    hasRaw: Boolean(scene.rawAssetPath),
    probe,
    attempts: scene.attempts,
    errorClass: scene.errorClass,
    errorMessage: scene.errorMessage,
    updatedAt: scene.updatedAt,
  }
}
