/**
 * BEAN Intelligence — LAXII image-generation processor.
 *
 * Moved verbatim (2026-11-07) from jobs/queue.ts so the background engine's
 * handler map can dispatch to it; queue.ts re-exports for its own dispatch.
 * Behavior is UNCHANGED: real hosted generation, storage persistence,
 * ImageAsset registration, honest failure classification, usage metering.
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
import { storeResultAsset } from '@/lib/laxii/assets'
import fs from 'fs'
import path from 'path'

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'laxii')

export type ImageJobRow = {
  id: string
  userId: string
  product: string
  task: string
  status: string
  paramsJson: string
  resultJson: string | null
}

async function updateJob(id: string, data: Record<string, unknown>) {
  await db.generationJob.update({ where: { id }, data })
}

export async function processImageJob(job: ImageJobRow): Promise<void> {
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

    // 2026-11-04 go-live: the generation result is ALSO registered as a
    // real ImageAsset so it can seed follow-up work (conversational edits,
    // variations) with full ownership checks — the UI's "Use as source"
    // chains from any completed generation.
    let assetUrl: string | null = null
    let assetId: string | null = null
    try {
      const asset = await storeResultAsset(job.userId, 'result', result.bytes, result.width, result.height, {
        jobId: job.id,
        artifact: 'generation',
        mime: 'image/jpeg',
      })
      assetUrl = asset.url
      assetId = asset.id
    } catch (e) {
      logger.warn('laxii.generation_asset_failed', {
        jobId: job.id,
        message: e instanceof Error ? e.message : String(e),
      })
    }

    await updateJob(job.id, {
      status: 'completed',
      progress: 100,
      finishedAt: new Date(),
      backendId: backend.id,
      resultJson: JSON.stringify({
        imageUrl: `/api/laxii/images/${job.id}`,
        ...(assetUrl ? { assetUrl, assetId } : {}),
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
      errorClass: failure.kind === 'other' && timedOut ? 'timeout' : failure.kind,
      errorCode: timedOut ? 'BACKEND_TIMEOUT' : 'BACKEND_FAILURE',
      errorMessage: timedOut
        ? 'Generation exceeded the time limit and was stopped.'
        : failure.kind === 'rate_limited'
          ? 'The image gateway is rate-limited right now (HTTP 429). The request was not repeated.'
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
