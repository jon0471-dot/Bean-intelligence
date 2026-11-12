/**
 * LAXII — job processors for the preservation engine (Phase 4/5).
 *
 * Two job tasks are handled here (dispatched from src/lib/jobs/queue.ts):
 *  - 'image-enhancement': fully deterministic (Sharp) pipeline with optional
 *    mask compositing. Runs today, on this host, for real.
 *  - 'image-editing': generative editing through the local Diffusers worker.
 *    The worker is registry-gated; while disabled the job is marked failed
 *    with the truthful PROVIDER_UNAVAILABLE reason (defense in depth — the
 *    route already refuses to create such jobs while disabled).
 *
 * Preservation invariants enforced HERE, not in prompts:
 *  - unmasked pixels are composited from exact original bytes even when a
 *    model ran (defense in depth against model bleed);
 *  - face zones are subtracted from the mask BEFORE generation;
 *  - every completed job carries a computed PreservationReport and a
 *    difference map — measured, never asserted.
 */
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { recordUsage } from '@/lib/observability/metering'
import { BeanApiError } from '@/lib/api/errors'
import sharp from 'sharp'
import { LaxiiImageError, toRaw, differenceMap, type RawImage, type Rect } from './metrics'
import {
  applyFaceProtection,
  buildMask,
  compositePreserved,
  encodePng,
  shapeMask,
  validatePreservation,
  type FaceZone,
  type MaskShaping,
  type ShapedMask,
} from './preservation'
import { enhanceImage, type EnhanceOptions } from './enhance'
import { loadAsset, readAssetBytes, storeResultAsset } from './assets'
import { workerRequest } from './worker'
import { getBackend } from '@/lib/registry/backends'
import { hostedImageAdapter } from '@/lib/adapters/hosted-image'
import {
  noteRealAttempt,
  UPSTREAM_FAILURE_CATEGORIES,
  type RealAttemptRecord,
} from '@/lib/adapters/last-attempts'
import {
  classifyUpstreamError,
  healthFailureCategory,
  upstreamCooldownRemainingMs,
  UpstreamRateLimitError,
} from '@/lib/upstream/gateway'
import {
  IMAGE_MAX_CUMULATIVE_THROTTLE_MS,
  IMAGE_MAX_GENERATION_ATTEMPTS,
  imageGenerationBackoffMs,
  parseThrottleState,
  retryAfterMsOf,
} from '@/lib/jobs/image-worker'
import type { HealthFailureCategory } from '@/lib/adapters/types'
import { appendJobEventSafe } from '@/lib/ai-engine/events'
import { CHROMA_BG_PROMPT, chromaCutout, validateCutout } from './bg-removal'

export interface JobLike {
  id: string
  userId: string
  status: string
  paramsJson: string
  /** CAPABILITY RECOVERY (2026-11-11): the engine claim hands the row's
   *  resultJson through, so the hosted-edit / bg-removal throttle parking
   *  can persist its bounded retry budget in the same place T2I does. */
  resultJson?: string | null
}

export interface MaskStrokeSpec {
  assetId: string
  kind: 'edit' | 'protect'
}

export interface FaceZoneSpec {
  rect: Rect
  source: 'user' | 'face-auto' | 'face-user'
}

export interface EnhanceJobParams {
  assetId: string
  maskStrokes: MaskStrokeSpec[]
  faceZones: FaceZoneSpec[]
  shaping: MaskShaping
  options: Partial<EnhanceOptions>
  globalColor: boolean
}

export interface EditJobParams {
  mode: 'smart-edit' | 'object-removal' | 'reference-guided' | 'conversational-edit' | 'background-removal'
  assetId: string
  maskStrokes?: MaskStrokeSpec[]
  faceZones?: FaceZoneSpec[]
  shaping?: MaskShaping
  prompt: string
  negativePrompt?: string
  steps?: number
  guidance?: number
  seed?: number
  strength?: number
  identityThreshold?: number
  referenceAssetId?: string
  ipAdapterScale?: number
  maxGenerativeSidePx?: number
  /** Hosted conversational edit: edited-output dimensions (optional). */
  size?: string
}

interface StageCtx {
  job: JobLike
  lastProgress: number
}

/**
 * Cancellation checkpoint that also SETTLES the row (OPERATIONAL-
 * TRANSFORMATION, 2026-11-11): the engine's cooperative cancel only sets
 * `cancelRequested` on running jobs — the processor must stop AND mark the
 * job cancelled, otherwise the row would stay "running" forever. Returns
 * true when processing must stop (row already terminal, or cancelled now).
 */
async function stopIfCancelled(ctx: StageCtx): Promise<boolean> {
  const fresh = await db.generationJob.findUnique({
    where: { id: ctx.job.id },
    select: { status: true, cancelRequested: true },
  })
  if (!fresh || fresh.status === 'failed' || fresh.status === 'rejected') return true
  if (fresh.cancelRequested === true) {
    await db.generationJob
      .update({
        where: { id: ctx.job.id },
        data: {
          status: 'cancelled',
          errorClass: 'cancelled',
          errorCode: 'CANCELLED',
          errorMessage:
            'Cancelled at your request — processing stopped between stages. The original image was never modified by this job.',
          finishedAt: new Date(),
        },
      })
      .catch(() => undefined)
    await appendJobEventSafe(ctx.job.id, 'notice', { cancelled: 'between_stages' }).catch(() => undefined)
    return true
  }
  return fresh.status === 'cancelled'
}

async function progress(ctx: StageCtx, value: number): Promise<void> {
  if (value <= ctx.lastProgress) return
  ctx.lastProgress = value
  await db.generationJob.update({ where: { id: ctx.job.id }, data: { progress: value } })
}

async function failJob(jobId: string, code: string, message: string, errorClass?: string): Promise<void> {
  await db.generationJob.update({
    where: { id: jobId },
    data: {
      status: 'failed',
      finishedAt: new Date(),
      errorCode: code,
      errorMessage: message,
      ...(errorClass ? { errorClass } : {}),
    },
  })
}

/**
 * CAPABILITY RECOVERY (2026-11-11): honest errorClass on every persisted
 * failure. The hosted-edit and background-removal paths previously called
 * failJob WITHOUT an errorClass, so their failed rows carried only
 * errorCode — and the restart-proof evidence chain (which maps errorClass)
 * was blind to their genuine upstream failures: measured live, their real
 * HTTP 429 rows were invisible to the persisted chain, so a restart
 * whitewashed a throttled capability back to an older success. Only
 * UPSTREAM classes become errorClass; request-specific rejections
 * (validation, contract 400s, cancellations) stay class-less — they are not
 * product-health evidence (pinned real-attempt semantics, unchanged).
 */
function jobErrorClassFor(category: HealthFailureCategory): string | undefined {
  switch (category) {
    case 'rate-limited':
      return 'rate_limited'
    case 'auth':
      return 'auth'
    case 'billing':
      return 'billing'
    case 'timeout':
      return 'timeout'
    case 'network':
      return 'network'
    default:
      return undefined
  }
}

/**
 * ZERO-DOWNTIME RECOVERY for hosted edit / background removal (CAPABILITY
 * RECOVERY, 2026-11-11) — the SAME bounded throttle recovery the image
 * worker's settleThrottledGeneration runs for T2I (and the video worker
 * since 2026-11-08; measured: throttle windows last minutes, and retrying
 * INTO an open window only deepens the throttle). A genuine HTTP 429 PARKS
 * the job in retry_wait with a breaker-aligned backoff (provider Retry-After
 * honored when an adapter ever surfaces one — the gateway sends none today;
 * else the images breaker's remaining window; else the escalating
 * 60s·2^(n-1) schedule, capped at 10 minutes). The retry budget persists in
 * resultJson so it survives restarts, and is bounded BOTH ways
 * (IMAGE_MAX_GENERATION_ATTEMPTS real attempts; IMAGE_MAX_CUMULATIVE_
 * THROTTLE_MS total parked wait) so exhaustion ends in an honest terminal
 * failure. A breaker SKIP made no network request — it counts no attempt and
 * only extends the scheduled wait. Re-claim is the engine claim protocol's
 * existing job (CLAIMABLE_STATES includes retry_wait-due) and re-execution
 * is idempotent: no artifact exists until the result asset is stored, so the
 * retry IS the first accepted generation — no duplicate submission.
 *
 * Returns true when the error WAS a throttle and the job is settled (parked
 * or terminally exhausted); false → not a throttle, caller's generic failure
 * path proceeds.
 */
async function settleThrottledEditJob(
  job: JobLike,
  e: unknown,
  backendId: string,
  startedAt: number,
  opts: { noteTask: 'image-editing' | 'image-bg-removal'; label: string },
): Promise<boolean> {
  if (classifyUpstreamError(e).kind !== 'rate_limited') return false
  // Product-health evidence: a real 429 is genuine upstream evidence; a
  // breaker skip is an application-side deferral (no request left the host).
  const attempted = !(e instanceof UpstreamRateLimitError && !e.attempted)
  noteRealAttempt(opts.noteTask, {
    at: new Date().toISOString(),
    ok: false,
    backendId,
    failureCategory: 'rate-limited',
    httpStatus: attempted ? 429 : null,
    upstream: attempted,
  })
  const throttle0 = parseThrottleState(job.resultJson ?? null)
  const attempt = attempted ? throttle0.submissionAttempts + 1 : throttle0.submissionAttempts
  const breakerRemainingMs = upstreamCooldownRemainingMs('images')
  const retryAfterMs = retryAfterMsOf(e)
  const backoffMs = imageGenerationBackoffMs(Math.max(1, attempt), breakerRemainingMs, retryAfterMs)
  const cumulativeWaitMs = throttle0.throttleWaitMs + backoffMs
  const exhausted =
    (attempted && attempt >= IMAGE_MAX_GENERATION_ATTEMPTS) ||
    cumulativeWaitMs > IMAGE_MAX_CUMULATIVE_THROTTLE_MS
  const throttle = {
    attempt: Math.max(1, attempt),
    backoffMs,
    retryAfterMs,
    attempted,
    at: new Date().toISOString(),
  }
  if (exhausted) {
    const message =
      `The image gateway kept throttling this ${opts.label} (HTTP 429): ${Math.max(1, attempt)} authorized attempt(s) ` +
      `over ~${Math.round(cumulativeWaitMs / 60_000)} minutes all landed inside the same account-wide throttle window, ` +
      `so no edited image was produced. The job keeps its full attempt history. Resubmitting is the way to try again — ` +
      `it will succeed once the provider's throttle window closes.`
    await db.generationJob
      .update({
        where: { id: job.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          errorClass: 'rate_limited',
          errorCode: 'RATE_LIMITED',
          errorMessage: message,
          resultJson: JSON.stringify({ submissionAttempts: attempt, throttleWaitMs: cumulativeWaitMs, throttle }),
        },
      })
      .catch(() => undefined)
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId,
      kind: 'image-editing',
      success: false,
      errorCode: 'RATE_LIMITED',
      durationMs: Date.now() - startedAt,
    })
    logger.warn('laxii.edit_throttle_exhausted', {
      jobId: job.id,
      label: opts.label,
      attempt,
      cumulativeWaitMs,
    })
    return true
  }
  const message = attempted
    ? `The image gateway is throttling edits (HTTP 429). The job stays queued — attempt ` +
      `${attempt + 1} of ${IMAGE_MAX_GENERATION_ATTEMPTS} starts automatically in ~${Math.round(backoffMs / 1000)}s. ` +
      `Nothing was lost; no duplicate was created.`
    : `The image gateway is inside its 429 cooldown window, so no ${opts.label} was attempted (submitting into ` +
      `an open throttle only deepens it). The job stays queued and will run when the window clears ` +
      `(~${Math.round(backoffMs / 1000)}s).`
  await db.generationJob
    .update({
      where: { id: job.id },
      data: {
        status: 'retry_wait',
        nextRunAt: new Date(Date.now() + backoffMs),
        errorClass: 'rate_limited',
        errorCode: 'RATE_LIMITED',
        errorMessage: message,
        resultJson: JSON.stringify({ submissionAttempts: attempt, throttleWaitMs: cumulativeWaitMs, throttle }),
      },
    })
    .catch(() => undefined)
  await appendJobEventSafe(job.id, 'notice', {
    edit_throttled: true,
    label: opts.label,
    attempt: Math.max(1, attempt),
    backoffMs,
    retryAfterMs,
    attempted,
  }).catch(() => undefined)
  logger.warn('laxii.edit_throttled', {
    jobId: job.id,
    label: opts.label,
    attempt: Math.max(1, attempt),
    backoffMs,
  })
  return true
}

async function loadMaskStrokes(
  userId: string,
  strokes: MaskStrokeSpec[],
): Promise<Array<{ kind: 'edit' | 'protect'; png: Buffer }>> {
  const out: Array<{ kind: 'edit' | 'protect'; png: Buffer }> = []
  for (const s of strokes) {
    const a = await loadAsset(userId, s.assetId)
    if (a.kind !== 'mask') {
      throw new BeanApiError('VALIDATION_ERROR', 'Mask strokes must reference mask assets.')
    }
    out.push({ kind: s.kind, png: a.data })
  }
  return out
}

function toFaceZones(zones: FaceZoneSpec[]): FaceZone[] {
  return zones.map((z) => ({ rect: z.rect, source: z.source }))
}

// ---- raw/encoding helpers --------------------------------------------------

async function decodeToRaw(bytes: Buffer): Promise<RawImage> {
  return toRaw(bytes)
}

async function encodePngB64(raw: RawImage | ShapedMask, isMask: boolean): Promise<string> {
  let png: Buffer
  if (isMask) {
    const m = raw as ShapedMask
    const gray = Buffer.alloc(m.width * m.height)
    for (let p = 0; p < m.width * m.height; p++) {
      gray[p] = Math.round(Math.max(0, Math.min(1, m.alpha[p])) * 255)
    }
    png = await sharp(gray, { raw: { width: m.width, height: m.height, channels: 1 } })
      .png({ compressionLevel: 6 })
      .toBuffer()
  } else {
    const r = raw as RawImage
    png = await encodePng(r.data, r.width, r.height)
  }
  return png.toString('base64')
}

async function resizeRaw(img: RawImage, w: number, h: number): Promise<RawImage> {
  const buf = await sharp(
    Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength),
    { raw: { width: img.width, height: img.height, channels: 3 } },
  )
    .resize(w, h, { kernel: 'lanczos3', fit: 'fill' })
    .raw()
    .toBuffer()
  return { data: new Uint8Array(buf), width: w, height: h }
}

/** Nearest-neighbour mask resize — masks are control fields, not pictures. */
function resizeMask(mask: ShapedMask, w: number, h: number): ShapedMask {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(mask.height - 1, Math.floor((y * mask.height) / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(mask.width - 1, Math.floor((x * mask.width) / w))
      out[y * w + x] = mask.alpha[sy * mask.width + sx]
    }
  }
  return { alpha: out, width: w, height: h }
}

async function finishWithArtifacts(opts: {
  ctx: StageCtx
  original: RawImage
  outputData: Uint8Array
  width: number
  height: number
  mask: ShapedMask | null
  faceZones: FaceZone[]
  generativeUsed: boolean
  pipeline: string
  provenance: Record<string, unknown>
  inputAssetUrl: string
  startedAt: number
  backendId: string
  usageKind: string
  identity?: { score: number; threshold: number; passed: boolean; metric: string }
}): Promise<void> {
  await progress(opts.ctx, 88)
  const outputRaw: RawImage = { data: opts.outputData, width: opts.width, height: opts.height }
  const report = validatePreservation({
    original: opts.original,
    output: outputRaw,
    mask: opts.mask,
    faceZones: opts.faceZones,
    generativeUsed: opts.generativeUsed,
    pipeline: opts.pipeline,
    identitySimilarity: opts.identity,
  })
  const diffPng = await (async () => {
    if (opts.width === opts.original.width && opts.height === opts.original.height) {
      return differenceMap(opts.original, outputRaw)
    }
    // UPSCALE PATH (fixed 2026-11-12, measured via conversational acceptance):
    // a Lanczos upscale legitimately changes the output geometry, so the
    // difference map is computed against the geometry-matched (resampled)
    // baseline — it then shows what the enhancement changed BEYOND pure
    // rescaling. The previous code asserted same-geometry and failed the job
    // AFTER the upscaled image had been produced (geometry mismatch), which
    // discarded a genuine result.
    const baseline = await resizeRaw(opts.original, opts.width, opts.height)
    return differenceMap(baseline, outputRaw)
  })()
  const resultPng = await encodePng(opts.outputData, opts.width, opts.height)

  const resultAsset = await storeResultAsset(opts.ctx.job.userId, 'result', resultPng, opts.width, opts.height, {
    jobId: opts.ctx.job.id,
    provenance: opts.provenance,
  })
  const diffAsset = await storeResultAsset(opts.ctx.job.userId, 'result', diffPng, opts.width, opts.height, {
    jobId: opts.ctx.job.id,
    artifact: 'difference-map',
  })

  await db.generationJob.update({
    where: { id: opts.ctx.job.id },
    data: {
      status: 'completed',
      progress: 100,
      finishedAt: new Date(),
      backendId: opts.backendId,
      resultJson: JSON.stringify({
        imageUrl: resultAsset.url,
        originalUrl: opts.inputAssetUrl,
        diffUrl: diffAsset.url,
        width: opts.width,
        height: opts.height,
        format: 'png',
        bytes: resultPng.length,
        durationMs: Date.now() - opts.startedAt,
        report,
        provenance: opts.provenance,
      }),
    },
  })
  await recordUsage({
    userId: opts.ctx.job.userId,
    product: 'laxii',
    backendId: opts.backendId,
    kind: opts.usageKind,
    imageCount: 1,
    durationMs: Date.now() - opts.startedAt,
    success: true,
  })
  logger.info('laxii.preservation_job_completed', {
    jobId: opts.ctx.job.id,
    pipeline: opts.pipeline,
    exactPreservedPct: report.exactPreservedPct,
    generativeUsed: opts.generativeUsed,
  })
}

// ---------------------------------------------------------------------------
// Deterministic enhancement (Strict Preserve compatible)
// ---------------------------------------------------------------------------

export async function processEnhancementJob(job: JobLike): Promise<void> {
  const ctx: StageCtx = { job, lastProgress: 0 }
  const startedAt = Date.now()
  try {
    const params = JSON.parse(job.paramsJson) as EnhanceJobParams
    await progress(ctx, 15)

    if (await stopIfCancelled(ctx)) return
    const imageBytes = await readAssetBytes(job.userId, params.assetId)
    const inputAsset = await loadAsset(job.userId, params.assetId)

    await progress(ctx, 35)
    // runEnhancement decodes with auto-orientation; the returned `original`
    // is the oriented baseline the user saw when painting their mask.
    const { result, original } = await enhanceImage({
      image: imageBytes,
      options: params.options,
      mask: null, // compositing happens here under mask control
    })
    const processedRaw = await decodeToRaw(result.outputPng)

    await progress(ctx, 60)
    if (await stopIfCancelled(ctx)) return

    let mask: ShapedMask | null = null
    let faceZones: FaceZone[] = []
    if (params.maskStrokes.length > 0) {
      mask = await buildMask(await loadMaskStrokes(job.userId, params.maskStrokes), original.width, original.height)
      mask = shapeMask(mask, params.shaping)
      faceZones = toFaceZones(params.faceZones)
      mask = applyFaceProtection(mask, faceZones).mask
    }

    const finalData =
      mask !== null
        ? compositePreserved(original, processedRaw, mask, { globalColorChange: params.globalColor }).data
        : processedRaw.data

    await finishWithArtifacts({
      ctx,
      original,
      outputData: finalData,
      width: result.width,
      height: result.height,
      mask,
      faceZones,
      generativeUsed: false,
      pipeline: 'deterministic-sharp',
      provenance: {
        engine: 'sharp-deterministic',
        modelIdentity: 'No ML model — deterministic Sharp operations',
        ops: result.plan.ops.map((o) => ({ op: o.op, params: o.params, reason: o.reason })),
        globalColorChange: params.globalColor,
      },
      inputAssetUrl: inputAsset.url,
      startedAt,
      backendId: 'bean-image-local-sharp',
      usageKind: 'image-enhancement',
    })
  } catch (e) {
    const isBean = e instanceof BeanApiError
    const message = isBean
      ? e.message
      : e instanceof LaxiiImageError
        ? e.message
        : 'The enhancement pipeline could not process this image.'
    const code = isBean ? e.code : 'BACKEND_FAILURE'
    logger.warn('laxii.enhance_job_failed', {
      jobId: job.id,
      code,
      message,
      raw: e instanceof Error ? e.message : String(e),
    })
    await failJob(job.id, code, message)
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId: 'bean-image-local-sharp',
      kind: 'image-enhancement',
      success: false,
      errorCode: code,
      durationMs: Date.now() - startedAt,
    })
  }
}

// ---------------------------------------------------------------------------
// Hosted conversational edit (authorized images.edit endpoint — real)
// ---------------------------------------------------------------------------

/**
 * Whole-image generative edit through the authorized backend: the user's
 * image + prompt → edited image. NOT pixel-preserving by design (that is
 * what the masked worker path is for); provenance states exactly that.
 * The images-class 429 breaker is honored inside the adapter.
 */
async function processHostedEditJob(job: JobLike, startedAt: number): Promise<void> {
  const ctx: StageCtx = { job, lastProgress: 0 }
  const backend = getBackend('bean-image-hosted-edit')!
  const params = JSON.parse(job.paramsJson) as EditJobParams
  try {
    if (backend.enabled !== true) {
      throw new BeanApiError('PROVIDER_UNAVAILABLE', 'Hosted image editing is not enabled in this deployment.')
    }
    await progress(ctx, 10)
    if (await stopIfCancelled(ctx)) return

    const imageBytes = await readAssetBytes(job.userId, params.assetId)
    const inputAsset = await loadAsset(job.userId, params.assetId)
    await progress(ctx, 30)

    // Bound the submission payload: longest side ≤ 1024, JPEG q90.
    const prepared = await sharp(imageBytes)
      .rotate()
      .removeAlpha()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer()
    if (await stopIfCancelled(ctx)) return

    await progress(ctx, 45)
    const editFn = hostedImageAdapter.editImage
    if (!editFn) throw new Error('The hosted edit adapter has no edit implementation.')
    const result = await editFn.call(hostedImageAdapter, {
      prompt: params.prompt,
      imageBase64: prepared.toString('base64'),
      ...(params.size ? { size: params.size } : {}),
      timeoutMs: backend.timeouts.requestMs,
    })
    await progress(ctx, 80)

    // Decode the provider output and re-encode as PNG (asset pipeline).
    const outRaw = await toRaw(result.bytes)
    const outPng = await encodePng(outRaw.data, outRaw.width, outRaw.height)
    const resultAsset = await storeResultAsset(job.userId, 'result', outPng, outRaw.width, outRaw.height, {
      jobId: job.id,
      provenance: {
        engine: 'hosted-edit',
        pipeline: 'managed-images-edit',
        mode: 'conversational-edit',
        promptLength: params.prompt.length,
        requestedSize: params.size ?? null,
        note: 'Whole-image generative edit — NOT pixel-preserving. The full output is the provider edit of the prepared input.',
      },
    })

    await db.generationJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        progress: 100,
        finishedAt: new Date(),
        backendId: backend.id,
        resultJson: JSON.stringify({
          imageUrl: resultAsset.url,
          originalUrl: inputAsset.url,
          width: outRaw.width,
          height: outRaw.height,
          format: 'png',
          bytes: outPng.length,
          durationMs: Date.now() - startedAt,
          provenance: {
            engine: 'hosted-edit',
            pipeline: 'managed-images-edit',
            mode: 'conversational-edit',
            inputPreparedMaxSidePx: 1024,
          },
        }),
      },
    })
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId: backend.id,
      kind: 'image-editing',
      imageCount: 1,
      durationMs: Date.now() - startedAt,
      success: true,
    })
    noteRealAttempt('image-editing', {
      at: new Date().toISOString(),
      ok: true,
      backendId: backend.id,
      failureCategory: null,
      httpStatus: null,
      upstream: false,
    })
    logger.info('laxii.hosted_edit_completed', { jobId: job.id, bytes: outPng.length })
  } catch (e) {
    // CAPABILITY RECOVERY (2026-11-11): a genuine HTTP 429 PARKS the job
    // (bounded, breaker-aligned retry_wait — the T2I recovery) instead of
    // failing it terminally on the first throttle.
    if (await settleThrottledEditJob(job, e, backend.id, startedAt, { noteTask: 'image-editing', label: 'conversational edit' })) return
    const isBean = e instanceof BeanApiError
    const failure = classifyUpstreamError(e)
    const category = healthFailureCategory(failure.kind)
    const message = isBean ? e.message : e instanceof Error ? e.message.slice(0, 240) : 'The hosted edit could not complete.'
    const code = failure.kind === 'rate_limited' ? 'RATE_LIMITED' : isBean ? e.code : 'BACKEND_FAILURE'
    const record: RealAttemptRecord = {
      at: new Date().toISOString(),
      ok: false,
      backendId: backend.id,
      failureCategory: category,
      httpStatus: failure.status,
      upstream: UPSTREAM_FAILURE_CATEGORIES.has(category),
    }
    noteRealAttempt('image-editing', record)
    logger.warn('laxii.hosted_edit_failed', { jobId: job.id, code, kind: failure.kind, message: message.slice(0, 200) })
    await failJob(
      job.id,
      code,
      failure.kind === 'rate_limited'
        ? 'The image backend is rate-limited right now (HTTP 429). Try again shortly.'
        : failure.kind === 'timeout'
          ? 'The image backend stopped responding before the edit finished.'
          : failure.kind === 'auth' || failure.kind === 'billing'
            ? 'The image backend rejected the request for account/configuration reasons. This needs an operator — retrying will not change it.'
            : message,
      // HONEST PERSISTED CLASS (CAPABILITY RECOVERY): upstream classes
      // (auth/billing/timeout/network) survive restarts as health evidence;
      // request-specific rejections stay class-less on purpose.
      jobErrorClassFor(category),
    )
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId: backend.id,
      kind: 'image-editing',
      success: false,
      errorCode: code,
      durationMs: Date.now() - startedAt,
    })
  }
}

// ---------------------------------------------------------------------------
// Background removal (two-stage: hosted chroma replacement + deterministic
// cutout) — OPERATIONAL-TRANSFORMATION, Phase 4
// ---------------------------------------------------------------------------

/**
 * REAL background removal. The authorized hosted edit endpoint returns
 * OPAQUE JPEG only (measured 2026-11-11: no alpha output exists), so a
 * direct "transparent cutout" claim would be fake. The honest pipeline:
 *  1. the provider performs the SUBJECT/BACKGROUND SEPARATION by replacing
 *     the background with a uniform chroma-key green (measured live: corner
 *     samples within ±3 RGB);
 *  2. bg-removal.ts keys that color out deterministically into a true alpha
 *     PNG, with the key, thresholds and coverage fractions all measured.
 * A result without meaningful transparency is an HONEST failure — never a
 * stored fake cutout.
 */
async function processBackgroundRemovalJob(job: JobLike, startedAt: number): Promise<void> {
  const ctx: StageCtx = { job, lastProgress: 0 }
  const backend = getBackend('bean-image-hosted-edit')!
  const params = JSON.parse(job.paramsJson) as EditJobParams
  try {
    if (backend.enabled !== true) {
      throw new BeanApiError('PROVIDER_UNAVAILABLE', 'Hosted image editing is not enabled in this deployment.')
    }
    await progress(ctx, 10)
    if (await stopIfCancelled(ctx)) return

    const imageBytes = await readAssetBytes(job.userId, params.assetId)
    const inputAsset = await loadAsset(job.userId, params.assetId)
    await progress(ctx, 25)

    // Bound the submission payload: longest side ≤ 1024, JPEG q90.
    const prepared = await sharp(imageBytes)
      .rotate()
      .removeAlpha()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer()
    if (await stopIfCancelled(ctx)) return

    await progress(ctx, 45)
    const editFn = hostedImageAdapter.editImage
    if (!editFn) throw new Error('The hosted edit adapter has no edit implementation.')
    const result = await editFn.call(hostedImageAdapter, {
      prompt: CHROMA_BG_PROMPT,
      imageBase64: prepared.toString('base64'),
      timeoutMs: backend.timeouts.requestMs,
    })
    await progress(ctx, 75)

    // Stage 2: measure the key, cut it out, validate the coverage.
    const keyed = await toRaw(result.bytes)
    const cutout = chromaCutout(keyed)
    const rejection = validateCutout(cutout.stats)
    if (rejection) {
      // The provider answered but the two-stage pipeline could not produce a
      // usable transparency. HONEST failure with the measured reason.
      throw new LaxiiImageError(`Background removal failed validation: ${rejection}. Your original image was not modified.`)
    }
    const png = await sharp(cutout.rgba, {
      raw: { width: cutout.width, height: cutout.height, channels: 4 },
    })
      .png({ compressionLevel: 6 })
      .toBuffer()
    await progress(ctx, 90)

    const resultAsset = await storeResultAsset(job.userId, 'result', png, cutout.width, cutout.height, {
      jobId: job.id,
      provenance: {
        engine: 'hosted-edit+chroma-cutout',
        pipeline: 'two-stage-bg-removal',
        mode: 'background-removal',
        note:
          'Stage 1 (provider): background replaced with uniform chroma-key green. Stage 2 (deterministic): key measured from the border ring and cut out to true alpha. Transparent PNG.',
      },
    })

    await db.generationJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        progress: 100,
        finishedAt: new Date(),
        backendId: backend.id,
        resultJson: JSON.stringify({
          imageUrl: resultAsset.url,
          originalUrl: inputAsset.url,
          width: cutout.width,
          height: cutout.height,
          format: 'png',
          transparent: true,
          bytes: png.length,
          durationMs: Date.now() - startedAt,
          chroma: cutout.stats,
          provenance: {
            engine: 'hosted-edit+chroma-cutout',
            pipeline: 'two-stage-bg-removal',
            mode: 'background-removal',
            inputPreparedMaxSidePx: 1024,
          },
        }),
      },
    })
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId: backend.id,
      kind: 'image-editing',
      imageCount: 1,
      durationMs: Date.now() - startedAt,
      success: true,
    })
    noteRealAttempt('image-bg-removal', {
      at: new Date().toISOString(),
      ok: true,
      backendId: backend.id,
      failureCategory: null,
      httpStatus: null,
      upstream: false,
    })
    // ISOLATION (CAPABILITY RECOVERY, 2026-11-11): a background-removal
    // completion records evidence ONLY under its own capability key — the
    // previous cross-write to 'image-editing' let a bg-removal success stand
    // in for a conversational-edit success (and a bg failure block editing),
    // which the capability model explicitly forbids: one capability's
    // evidence must never mask another's.
    logger.info('laxii.bg_removal_completed', {
      jobId: job.id,
      bytes: png.length,
      transparentFraction: cutout.stats.transparentFraction,
      opaqueFraction: cutout.stats.opaqueFraction,
    })
  } catch (e) {
    // CAPABILITY RECOVERY (2026-11-11): a genuine HTTP 429 PARKS the job
    // (bounded, breaker-aligned retry_wait — the T2I recovery) instead of
    // failing it terminally on the first throttle. Evidence is noted under
    // THIS capability's key only (no cross-write to 'image-editing').
    if (await settleThrottledEditJob(job, e, backend.id, startedAt, { noteTask: 'image-bg-removal', label: 'background removal' })) return
    const isBean = e instanceof BeanApiError
    const failure = classifyUpstreamError(e)
    const category = healthFailureCategory(failure.kind)
    const message = isBean ? e.message : e instanceof LaxiiImageError ? e.message : e instanceof Error ? e.message.slice(0, 240) : 'Background removal could not complete.'
    const code = failure.kind === 'rate_limited' ? 'RATE_LIMITED' : isBean ? e.code : 'BACKEND_FAILURE'
    const record: RealAttemptRecord = {
      at: new Date().toISOString(),
      ok: false,
      backendId: backend.id,
      failureCategory: category,
      httpStatus: failure.status,
      upstream: UPSTREAM_FAILURE_CATEGORIES.has(category),
    }
    // ISOLATION: recorded under 'image-bg-removal' ONLY — the removed
    // 'image-editing' cross-write let a bg-removal failure block the
    // conversational-editing capability (the measured "Blocked (HTTP 429)"
    // state that pinned editing after this job's 429).
    noteRealAttempt('image-bg-removal', record)
    logger.warn('laxii.bg_removal_failed', { jobId: job.id, code, kind: failure.kind, message: message.slice(0, 200) })
    await failJob(job.id, code, message, jobErrorClassFor(category))
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId: backend.id,
      kind: 'image-editing',
      success: false,
      errorCode: code,
      durationMs: Date.now() - startedAt,
    })
  }
}

// ---------------------------------------------------------------------------
// Generative editing (Diffusers worker — registry-gated)
// ---------------------------------------------------------------------------

export async function processEditJob(job: JobLike): Promise<void> {
  const startedAt = Date.now()
  // PHASE 4: whole-image conversational edits run on the authorized hosted
  // editing backend (real provider execution, honest failure classes).
  const params = JSON.parse(job.paramsJson) as EditJobParams
  if (params.mode === 'conversational-edit') {
    await processHostedEditJob(job, startedAt)
    return
  }
  if (params.mode === 'background-removal') {
    await processBackgroundRemovalJob(job, startedAt)
    return
  }
  const ctx: StageCtx = { job, lastProgress: 0 }
  const backend = getBackend('bean-image-selfhosted-diffusers')
  try {
    if (backend?.enabled !== true) {
      throw new BeanApiError(
        'PROVIDER_UNAVAILABLE',
        'Generative editing is not operational: the local Diffusers worker has not passed its hardware preflight and no real inference test has completed in this environment (no GPU). Your image was not modified.',
      )
    }
    const params = JSON.parse(job.paramsJson) as EditJobParams
    await progress(ctx, 10)

    if (await stopIfCancelled(ctx)) return
    const imageBytes = await readAssetBytes(job.userId, params.assetId)
    const inputAsset = await loadAsset(job.userId, params.assetId)

    await progress(ctx, 18)
    const workingOriginal = await decodeToRaw(
      // Orient exactly like the deterministic path so masks line up.
      await sharp(imageBytes).rotate().removeAlpha().png().toBuffer(),
    )

    const maskStrokes = await loadMaskStrokes(job.userId, params.maskStrokes ?? [])
    if (maskStrokes.length === 0) {
      throw new BeanApiError('VALIDATION_ERROR', 'A mask is required for generative editing.')
    }
    let mask = await buildMask(maskStrokes, workingOriginal.width, workingOriginal.height)
    mask = shapeMask(mask, params.shaping ?? { expandPx: 2, featherPx: 8 })
    const faceZones = toFaceZones(params.faceZones ?? [])
    const protection = applyFaceProtection(mask, faceZones)
    mask = protection.mask
    await progress(ctx, 26)

    // Generation runs at model-native resolution; the result is restored to
    // original size and re-composited so unmasked pixels stay EXACT.
    const maxSide = Math.min(params.maxGenerativeSidePx ?? 1024, 1024)
    const scale = Math.min(1, maxSide / Math.max(workingOriginal.width, workingOriginal.height))
    const genW = Math.max(64, Math.round((workingOriginal.width * scale) / 8) * 8)
    const genH = Math.max(64, Math.round((workingOriginal.height * scale) / 8) * 8)
    const genImage = await resizeRaw(workingOriginal, genW, genH)
    const genMask = resizeMask(mask, genW, genH)

    if (await stopIfCancelled(ctx)) return
    let workerResult: Record<string, unknown>
    if (params.mode === 'object-removal') {
      workerResult = await workerRequest(
        'object_removal',
        { image: await encodePngB64(genImage, false), mask: await encodePngB64(genMask, true) },
        { timeoutMs: backend.timeouts.requestMs },
      )
    } else if (params.mode === 'reference-guided') {
      if (!params.referenceAssetId) {
        throw new BeanApiError('VALIDATION_ERROR', 'A reference image is required for reference-guided generation.')
      }
      const refRaw = await decodeToRaw(await readAssetBytes(job.userId, params.referenceAssetId))
      const refResized = await resizeRaw(refRaw, genW, genH)
      workerResult = await workerRequest(
        'reference_generate',
        {
          prompt: params.prompt,
          referenceImage: await encodePngB64(refResized, false),
          ipAdapter: { scale: params.ipAdapterScale ?? 0.6 },
          width: genW,
          height: genH,
          steps: params.steps,
          guidance: params.guidance,
          seed: params.seed,
          negativePrompt: params.negativePrompt,
          model: 'sd15-inpaint',
        },
        { timeoutMs: backend.timeouts.requestMs },
      )
    } else {
      workerResult = await workerRequest(
        'inpaint',
        {
          image: await encodePngB64(genImage, false),
          mask: await encodePngB64(genMask, true),
          prompt: params.prompt,
          negativePrompt: params.negativePrompt,
          steps: params.steps,
          guidance: params.guidance,
          seed: params.seed,
          strength: params.strength,
          model: 'sd15-inpaint',
        },
        {
          timeoutMs: backend.timeouts.requestMs,
          onProgress: (step, total) => {
            void progress(ctx, 30 + Math.round((step / Math.max(1, total ?? params.steps ?? 30)) * 50))
          },
        },
      )
    }
    const images = workerResult.images as string[] | undefined
    if (!images?.length) throw new LaxiiImageError('Worker returned no image.')
    await progress(ctx, 80)

    const generatedRaw = await decodeToRaw(Buffer.from(images[0], 'base64'))
    const restored = await resizeRaw(generatedRaw, workingOriginal.width, workingOriginal.height)
    const finalComposite = compositePreserved(workingOriginal, restored, mask, { globalColorChange: false })
    await progress(ctx, 86)

    // Identity drift gate — runs only when face zones exist and a threshold
    // was configured. If the gate cannot run, that fact is recorded and the
    // report carries no similarity number (never a fabricated score).
    let identity: { score: number; threshold: number; passed: boolean; metric: string } | undefined
    if (faceZones.length > 0 && params.identityThreshold != null) {
      try {
        const check = await workerRequest(
          'identity_check',
          {
            imageA: await encodePngB64(workingOriginal, false),
            imageB: await encodePngB64({ data: finalComposite.data, width: workingOriginal.width, height: workingOriginal.height }, false),
            threshold: params.identityThreshold,
          },
          { timeoutMs: 30_000 },
        )
        if (typeof check.similarity === 'number') {
          identity = {
            score: check.similarity,
            threshold: params.identityThreshold,
            passed: check.passed === true,
            metric: String(check.metric ?? 'worker-metric'),
          }
        }
      } catch (e) {
        logger.warn('laxii.identity_check_unavailable', {
          jobId: job.id,
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }

    await finishWithArtifacts({
      ctx,
      original: workingOriginal,
      outputData: finalComposite.data,
      width: workingOriginal.width,
      height: workingOriginal.height,
      mask,
      faceZones,
      generativeUsed: true,
      pipeline: `diffusers-worker:${String(workerResult.model ?? params.mode)}`,
      provenance: {
        engine: 'diffusers-worker',
        model: workerResult.model ?? 'sd15-inpaint',
        mode: params.mode,
        seed: workerResult.seed ?? params.seed ?? null,
        steps: params.steps ?? null,
        guidance: params.guidance ?? null,
        generatedAtResolution: [genW, genH],
        generatedRegionUpscaled: scale < 1,
        maskedSuppressedByFaceProtectionPct: protection.suppressedPct,
        identityCheckRan: identity != null,
        note: 'Generated content was composited back at original resolution; every unmasked pixel is enforced bit-exact original.',
      },
      inputAssetUrl: inputAsset.url,
      startedAt,
      backendId: 'bean-image-selfhosted-diffusers',
      usageKind: 'image-editing',
      identity,
    })
  } catch (e) {
    const isBean = e instanceof BeanApiError
    const message = isBean ? e.message : e instanceof LaxiiImageError ? e.message : 'The generative edit could not complete.'
    const code = isBean ? e.code : 'BACKEND_FAILURE'
    logger.warn('laxii.edit_job_failed', { jobId: job.id, code, message })
    await failJob(job.id, code, message)
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId: 'bean-image-selfhosted-diffusers',
      kind: 'image-editing',
      success: false,
      errorCode: code,
      durationMs: Date.now() - startedAt,
    })
  }
}
