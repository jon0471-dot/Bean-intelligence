/**
 * BEAN Intelligence — asynchronous job queue.
 *
 * Long-running generation tasks (images today; video when a worker exists)
 * are persisted as GenerationJob rows and processed by this in-process
 * worker. Jobs are NEVER marked completed unless real work actually
 * produced a result; failures and cancellations are recorded truthfully.
 *
 * Scaling note (documented in docs/operations): this is a single-node
 * in-process queue. Multi-node deployments should swap this module for a
 * durable queue (e.g. database-backed or Redis) without changing the API.
 */
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { recordUsage } from '@/lib/observability/metering'
import { hostedImageAdapter } from '@/lib/adapters/hosted-image'
import { withTimeout } from '@/lib/adapters/hosted-llm'
import {
  noteRealAttempt,
  UPSTREAM_FAILURE_CATEGORIES,
  type RealAttemptRecord,
} from '@/lib/adapters/last-attempts'
import { classifyUpstreamError, healthFailureCategory } from '@/lib/upstream/gateway'
import { getBackend } from '@/lib/registry/backends'
import { processEnhancementJob, processEditJob } from '@/lib/laxii/jobs'
import fs from 'fs'
import path from 'path'

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'laxii')

type JobRow = {
  id: string
  userId: string
  product: string
  task: string
  status: string
  paramsJson: string
}

async function updateJob(id: string, data: Record<string, unknown>) {
  await db.generationJob.update({ where: { id }, data })
}

async function processImageJob(job: JobRow): Promise<void> {
  const params = JSON.parse(job.paramsJson) as { prompt: string; size: string }
  const backend = getBackend('bean-image-hosted-primary')!
  const startedAt = new Date()

  await updateJob(job.id, { status: 'running', startedAt, progress: 15 })

  try {
    const result = await withTimeout(
      hostedImageAdapter.generateImage!({
        prompt: params.prompt,
        size: params.size,
        timeoutMs: backend.timeouts.requestMs,
      }),
      backend.timeouts.requestMs,
      'Image generation',
    )

    // Persist artifact under BEAN storage; access is authorized per-user.
    const dir = path.join(STORAGE_ROOT, job.userId)
    fs.mkdirSync(dir, { recursive: true })
    const ext = result.format === 'png' ? 'png' : 'jpg'
    const filename = `${job.id}.${ext}`
    fs.writeFileSync(path.join(dir, filename), result.bytes)

    await updateJob(job.id, {
      status: 'completed',
      progress: 100,
      finishedAt: new Date(),
      backendId: backend.id,
      resultJson: JSON.stringify({
        imageUrl: `/api/laxii/images/${job.id}`,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes.length,
        durationMs: result.durationMs,
      }),
    })
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId: backend.id,
      kind: 'image-generation',
      imageCount: 1,
      durationMs: result.durationMs,
      success: true,
    })
    logger.info('laxii.job_completed', { jobId: job.id, durationMs: result.durationMs })
    // REAL-attempt evidence (2026-11-04 connectivity audit): a genuine
    // success overrides any previous upstream-failure evidence.
    noteRealAttempt('image-generation', {
      at: new Date().toISOString(),
      ok: true,
      backendId: backend.id,
      failureCategory: null,
      httpStatus: null,
      upstream: false,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const timedOut = message.includes('timed out')
    // Classify the failure honestly: only UPSTREAM-class failures (throttle,
    // auth, network...) count as product-health evidence; a content-policy
    // or user-error rejection is request-specific, not a product state.
    const failure = classifyUpstreamError(e)
    const category = timedOut && failure.kind === 'other' ? 'timeout' : healthFailureCategory(failure.kind)
    const isUpstream = UPSTREAM_FAILURE_CATEGORIES.has(category)
    const record: RealAttemptRecord = {
      at: new Date().toISOString(),
      ok: false,
      backendId: backend.id,
      failureCategory: category,
      httpStatus: failure.status,
      upstream: isUpstream,
    }
    noteRealAttempt('image-generation', record)
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      backendId: backend.id,
      errorCode: timedOut ? 'BACKEND_TIMEOUT' : 'BACKEND_FAILURE',
      errorMessage: timedOut
        ? 'Generation exceeded the time limit and was stopped.'
        : 'The image backend could not complete this request.',
    })
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId: backend.id,
      kind: 'image-generation',
      success: false,
      errorCode: timedOut ? 'BACKEND_TIMEOUT' : 'BACKEND_FAILURE',
      durationMs: Date.now() - startedAt.getTime(),
    })
    logger.warn('laxii.job_failed', { jobId: job.id, message })
  }
}

/** Fire-and-forget enqueue used by API routes after the row is persisted. */
export function enqueueJob(jobId: string): void {
  void (async () => {
    try {
      const job = (await db.generationJob.findUnique({
        where: { id: jobId },
      })) as JobRow | null
      if (!job) return
      if (job.status !== 'queued') return // cancelled/rejected while queued

      if (job.task === 'image-generation') {
        await processImageJob(job)
      } else if (job.task === 'image-enhancement') {
        await processEnhancementJob(job)
      } else if (job.task === 'image-editing') {
        await processEditJob(job)
      } else {
        await updateJob(job.id, {
          status: 'failed',
          finishedAt: new Date(),
          errorCode: 'NO_BACKEND',
          errorMessage: 'No worker is available for this task type.',
        })
      }
    } catch (e) {
      logger.error('jobs.enqueue_failed', {
        jobId,
        message: e instanceof Error ? e.message : String(e),
      })
      await db.generationJob
        .update({
          where: { id: jobId },
          data: {
            status: 'failed',
            finishedAt: new Date(),
            errorCode: 'INTERNAL_ERROR',
            errorMessage: 'The job could not be processed.',
          },
        })
        .catch(() => undefined)
    }
  })()
}

/** Cancel a queued/running job. Running jobs are marked cancelled-at-best-effort:
 *  the adapter call itself cannot be interrupted mid-flight in-process, so the
 *  job row is marked `failed` with CANCELLED semantics only while still queued. */
export async function cancelQueuedJob(jobId: string, userId: string): Promise<boolean> {
  const job = await db.generationJob.findUnique({ where: { id: jobId } })
  if (!job || job.userId !== userId) return false
  if (job.status !== 'queued') return false
  await db.generationJob.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      errorCode: 'CANCELLED',
      errorMessage: 'Cancelled before processing started.',
    },
  })
  return true
}
