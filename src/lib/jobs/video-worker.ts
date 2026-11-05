/**
 * BEAN Intelligence — JAZMII asynchronous video job worker.
 *
 * Real job lifecycle (no browser HTTP request is ever held open):
 *   queued → running (submit to the provider, persist the PRIVATE task id)
 *          → polling loop (bounded: interval + hard deadline)
 *          → SUCCESS → server-side download → container validation
 *                      → BEAN storage → completed (media served per-user)
 *          → FAIL / timeout / breaker → honest failure, never a fake output
 *
 * Recovery contract: the provider task id is persisted in the job row's
 * resultJson the moment submission succeeds. `ensureVideoPoller` re-attaches
 * a poller to any running/queued job that has no live poller in this process
 * (dev-server restart, route-bundle reload) — a browser refresh that lists
 * jobs transparently reconnects tracking to the SAME provider task.
 *
 * Cancellation: the provider SDK exposes NO cancel API. BEAN cancellation
 * therefore means "stop tracking" and is labeled exactly that way in the
 * job record and the UI — never claimed to abort the upstream task.
 */
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { recordUsage } from '@/lib/observability/metering'
import {
  downloadVideo,
  queryVideoJob,
  submitVideoJob,
} from '@/lib/adapters/hosted-video'
import {
  noteRealAttempt,
  UPSTREAM_FAILURE_CATEGORIES,
  type RealAttemptRecord,
} from '@/lib/adapters/last-attempts'
import { classifyUpstreamError, healthFailureCategory } from '@/lib/upstream/gateway'
import { getBackend } from '@/lib/registry/backends'
import fs from 'fs'
import path from 'path'

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'jazmii')

const POLL_INTERVAL_MS = Number(process.env.JAZMII_VIDEO_POLL_INTERVAL_MS ?? 5_000)
const MAX_POLL_MS = Number(process.env.JAZMII_VIDEO_MAX_POLL_MS ?? 15 * 60_000)

export interface VideoJobParams {
  prompt: string
  imageUrl?: string
  quality?: 'speed' | 'quality'
  withAudio?: boolean
  size?: string
  durationSec?: number
  fps?: number
}

export interface VideoJobResult {
  /** PRIVATE provider task id — never exposed to clients. */
  providerTaskId?: string
  providerStatus?: string
  videoUrl?: string
  format?: string
  bytes?: number
  durationMs?: number
  width?: number
  height?: number
}

type JobRow = {
  id: string
  userId: string
  product: string
  task: string
  status: string
  paramsJson: string
  resultJson: string | null
}

/** Job ids with a live poller in THIS process (resume detection). */
const activePollers = new Set<string>()
/** Job ids for which the owner requested cancellation (stop-tracking). */
const cancelRequested = new Set<string>()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function updateJob(id: string, data: Record<string, unknown>): Promise<void> {
  await db.generationJob.update({ where: { id }, data })
}

function parseResult(job: JobRow): VideoJobResult {
  if (!job.resultJson) return {}
  try {
    return JSON.parse(job.resultJson) as VideoJobResult
  } catch {
    return {}
  }
}

export class VideoProviderFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VideoProviderFailedError'
  }
}

/**
 * Execute (or resume) one video job to completion. The in-memory poller
 * registry guarantees at most one live loop per job per process.
 */
export async function processVideoJob(job: JobRow): Promise<void> {
  if (activePollers.has(job.id)) return
  activePollers.add(job.id)
  const backend = getBackend('bean-video-hosted-primary')!
  const startedAt = new Date()
  const params = JSON.parse(job.paramsJson) as VideoJobParams
  let result = parseResult(job)

  try {
    // Cancellation is honored FIRST — including the enqueue/cancel race where
    // the owner cancels between row creation and worker pickup.
    if (cancelRequested.has(job.id)) {
      await markCancelled(job.id)
      return
    }
    if (job.status === 'queued') {
      await updateJob(job.id, { status: 'running', startedAt, progress: 5 })
      // REAL submission — a failure here propagates to the honest failure path.
      const handle = await submitVideoJob({
        prompt: params.prompt,
        ...(params.imageUrl ? { imageUrl: params.imageUrl } : {}),
        ...(params.quality ? { quality: params.quality } : {}),
        ...(params.withAudio !== undefined ? { withAudio: params.withAudio } : {}),
        ...(params.size ? { size: params.size } : {}),
        ...(params.durationSec ? { durationSec: params.durationSec } : {}),
        ...(params.fps ? { fps: params.fps } : {}),
      })
      result = { ...result, providerTaskId: handle.taskId, providerStatus: handle.providerStatus }
      await updateJob(job.id, {
        progress: 10,
        backendId: backend.id,
        resultJson: JSON.stringify(result),
      })
      logger.info('jazmii.job_submitted', { jobId: job.id })
    } else {
      // Resume path: a providerTaskId must already be persisted; without it
      // the job cannot be continued honestly.
      if (!result.providerTaskId) {
        throw new Error('resumed video job has no persisted provider task id')
      }
      logger.info('jazmii.job_resumed', { jobId: job.id })
    }

    const taskId = result.providerTaskId!
    const deadline = Date.now() + MAX_POLL_MS
    let progress = 12
    let videoUrl: string | null = null

    while (Date.now() < deadline) {
      if (cancelRequested.has(job.id)) {
        await markCancelled(job.id)
        return
      }
      await sleep(POLL_INTERVAL_MS)
      if (cancelRequested.has(job.id)) {
        await markCancelled(job.id)
        return
      }
      const status = await queryVideoJob(taskId)
      result = { ...result, providerStatus: status.state }
      if (status.state === 'processing') {
        // Progress is BEAN's tracking estimate, not a provider percentage.
        progress = Math.min(90, progress + 5)
        await updateJob(job.id, { progress, resultJson: JSON.stringify(result) })
        continue
      }
      if (status.state === 'fail') {
        throw new VideoProviderFailedError(status.providerMessage ?? 'The provider reported the video task as failed.')
      }
      videoUrl = status.videoUrl
      break
    }

    if (!videoUrl) {
      // Bounded tracking window exhausted — honest timeout, never a hang and
      // never a fabricated completion.
      await failJob(job, backend.id, 'BACKEND_TIMEOUT', 'Video tracking exceeded its time limit before the provider reported completion. No video was produced.')
      return
    }

    await updateJob(job.id, { progress: 95 })
    const dl = await downloadVideo(videoUrl)
    const dir = path.join(STORAGE_ROOT, job.userId)
    fs.mkdirSync(dir, { recursive: true })
    const filename = `${job.id}.${dl.format}`
    fs.writeFileSync(path.join(dir, filename), dl.bytes)

    result = {
      ...result,
      videoUrl: `/api/jazmii/jobs/${job.id}/media`,
      format: dl.format,
      bytes: dl.bytesLength,
      durationMs: dl.durationMs,
    }
    await updateJob(job.id, {
      status: 'completed',
      progress: 100,
      finishedAt: new Date(),
      backendId: backend.id,
      resultJson: JSON.stringify(result),
    })
    await recordUsage({
      userId: job.userId,
      product: 'jazmii',
      backendId: backend.id,
      kind: 'video-generation',
      durationMs: Date.now() - startedAt.getTime(),
      success: true,
    })
    logger.info('jazmii.job_completed', { jobId: job.id, bytes: dl.bytesLength, format: dl.format })
    // REAL-attempt evidence: a genuine completion is the capability proof.
    noteVideoAttempt(params, {
      at: new Date().toISOString(),
      ok: true,
      backendId: backend.id,
      failureCategory: null,
      httpStatus: null,
      upstream: false,
    })
  } catch (e) {
    await handleVideoFailure(job, backend.id, e, startedAt)
  } finally {
    activePollers.delete(job.id)
    cancelRequested.delete(job.id)
  }
}

function upstreamRecord(backendId: string, category: string, status: number | null): RealAttemptRecord {
  const upstream = UPSTREAM_FAILURE_CATEGORIES.has(category)
  return {
    at: new Date().toISOString(),
    ok: false,
    backendId,
    failureCategory: category as RealAttemptRecord['failureCategory'],
    httpStatus: status,
    upstream,
  }
}

/**
 * GO-LIVE (2026-11-05): record a real video attempt under the umbrella key
 * ('video-generation' — product-level evidence, unchanged semantics) AND the
 * per-capability key, so a t2v attempt can never overwrite the i2v
 * capability's evidence (or vice versa). The capability health model reads
 * the per-capability keys; the product slot reads the umbrella.
 */
function noteVideoAttempt(params: VideoJobParams, record: RealAttemptRecord): void {
  noteRealAttempt('video-generation', record)
  noteRealAttempt(params.imageUrl ? 'video-generation-i2v' : 'video-generation-t2v', record)
}

function jobParams(job: JobRow): VideoJobParams {
  try {
    return JSON.parse(job.paramsJson) as VideoJobParams
  } catch {
    return { prompt: '' }
  }
}

async function handleVideoFailure(job: JobRow, backendId: string, e: unknown, startedAt: Date): Promise<void> {
  const message = e instanceof Error ? e.message : String(e)
  if (e instanceof VideoProviderFailedError) {
    // Provider-reported failure: request-specific, not product-health evidence.
    noteVideoAttempt(jobParams(job), {
      at: new Date().toISOString(),
      ok: false,
      backendId,
      failureCategory: null,
      httpStatus: null,
      upstream: false,
    })
    await failJob(job, backendId, 'GENERATION_FAILED', message)
    await recordUsage({
      userId: job.userId,
      product: 'jazmii',
      backendId,
      kind: 'video-generation',
      success: false,
      errorCode: 'GENERATION_FAILED',
      durationMs: Date.now() - startedAt.getTime(),
    })
    logger.warn('jazmii.job_provider_failed', { jobId: job.id, message: message.slice(0, 200) })
    return
  }
  const failure = classifyUpstreamError(e)
  const category = healthFailureCategory(failure.kind)
  noteVideoAttempt(jobParams(job), upstreamRecord(backendId, category, failure.status))
  const code = failure.kind === 'rate_limited' ? 'RATE_LIMITED' : failure.kind === 'timeout' ? 'BACKEND_TIMEOUT' : 'BACKEND_FAILURE'
  // Honest display: upstream classes get the product-safe explanation; an
  // unclassified local/boundary failure (e.g. output validation) carries its
  // REAL reason — never a generic wall that hides what actually happened.
  const display =
    failure.kind === 'rate_limited'
      ? 'The video gateway is rate-limited right now (HTTP 429). Try again shortly.'
      : failure.kind === 'timeout'
        ? 'The video gateway stopped responding before the task completed.'
        : failure.kind === 'auth' || failure.kind === 'billing'
          ? 'The video gateway rejected the request for account/configuration reasons. This needs an operator — retrying will not change it.'
          : message.slice(0, 240)
  await failJob(job, backendId, code, display)
  await recordUsage({
    userId: job.userId,
    product: 'jazmii',
    backendId,
    kind: 'video-generation',
    success: false,
    errorCode: code,
    durationMs: Date.now() - startedAt.getTime(),
  })
  logger.warn('jazmii.job_failed', { jobId: job.id, kind: failure.kind, message: message.slice(0, 200) })
}

async function failJob(job: JobRow, backendId: string, code: string, display: string): Promise<void> {
  await updateJob(job.id, {
    status: 'failed',
    finishedAt: new Date(),
    backendId,
    errorCode: code,
    errorMessage: display,
  })
}

/** Honest cancellation: stop tracking; the provider task is NOT aborted. */
async function markCancelled(jobId: string): Promise<void> {
  await db.generationJob
    .update({
      where: { id: jobId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorCode: 'CANCELLED',
        errorMessage:
          'Tracking cancelled at your request. The provider exposes no cancel API, so its task may still finish upstream — BEAN stopped tracking it and no output will be stored.',
      },
    })
    .catch(() => undefined)
  logger.info('jazmii.job_cancelled', { jobId })
}

/**
 * Re-attach a poller to a video job with no live poller in this process
 * (restart/recovery). Called from the jobs-list path so a browser refresh
 * reconnects tracking without any user action.
 */
export function ensureVideoPoller(job: {
  id: string
  userId: string
  product: string
  task: string
  status: string
  paramsJson: string
  resultJson: string | null
}): void {
  if (job.product !== 'jazmii' || job.task !== 'video-generation') return
  if (job.status !== 'queued' && job.status !== 'running') return
  if (activePollers.has(job.id)) return
  if (cancelRequested.has(job.id)) return
  void processVideoJob(job)
}

/**
 * Request cancellation (owner-verified by the caller). Returns whether the
 * request was accepted. Cancellation is stop-tracking only — stated in the
 * job record.
 */
export async function requestVideoCancel(jobId: string): Promise<boolean> {
  const job = await db.generationJob.findUnique({ where: { id: jobId } })
  if (!job || job.product !== 'jazmii' || job.task !== 'video-generation') return false
  if (job.status !== 'queued' && job.status !== 'running') return false
  if (activePollers.has(jobId)) {
    cancelRequested.add(jobId)
    return true
  }
  // No live poller (e.g. right after a restart): mark honestly here — the
  // enqueue/resume path also honors cancelRequested before submitting.
  cancelRequested.add(jobId)
  await markCancelled(jobId)
  return true
}
