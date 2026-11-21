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
import { recordUsage, recordAudit } from '@/lib/observability/metering'
import { hostedImageAdapter, ImageProviderResponseError } from '@/lib/adapters/hosted-image'
import { withTimeout } from '@/lib/adapters/hosted-llm'
import {
  validateDimensions,
  planExactDimensions,
  planFinishStrategy,
  applyExactDimensions,
  measureImage,
  generationProvenance,
  aspectRatioLabel,
  isValidProviderSize,
  DimensionError,
  type DimensionPlan,
  type ExactStrategy,
} from '@/lib/laxii/dimensions'
import {
  extractExactTextDemands,
  compositeTypography,
  ocrText,
  validateExactText,
  type TextDemand,
  type TextValidation,
} from '@/lib/laxii/typography'
import {
  noteRealAttempt,
  UPSTREAM_FAILURE_CATEGORIES,
  type RealAttemptRecord,
} from '@/lib/adapters/last-attempts'
import { classifyUpstreamError, healthFailureCategory, upstreamCooldownRemainingMs, UpstreamRateLimitError } from '@/lib/upstream/gateway'
import { appendJobEventSafe } from '@/lib/ai-engine/events'
import { getBackend } from '@/lib/registry/backends'
import { storeResultAsset } from '@/lib/laxii/assets'
import { prepareImageIntelligence } from '@/lib/intel/grounding'
import { verifyGeneratedImage, imageBufferToDataUrl, unwantedTextDefects } from '@/lib/intel/continuity'
import { automatedQuotaState, automatedSkipReason } from '@/lib/providers/account-quota'
import { recordMediaJobCancelled, recordMediaJobCompletion, recordMediaJobFailure } from '@/lib/trust/adapters/media'
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
  /** Engine claim owner (M26 F-1 guarded writes); null for non-engine callers. */
  workerId?: string | null
}

// ---- ZERO-DOWNTIME RECOVERY (2026-11-11): throttle-resilient generation ---
//
// The PREVIOUS worker treated a generation-time 429 as a TERMINAL job
// failure — a provider throttle window destroyed a job BEAN had already
// accepted (and the user's request with it). The video worker has parked
// throttled submissions in RETRY_WAIT since 2026-11-08 (measured: throttle
// windows last MINUTES; retrying into an open window only deepens the
// throttle). LAXII image generation now gets the same recovery: a throttled
// generation PARKS the job with a bounded, breaker-aligned backoff, and the
// retry budget is persisted in resultJson so it survives restarts. Bounded
// BOTH ways (real attempts AND cumulative wait) so a stuck account can
// never hold a job forever, and a breaker skip (zero network I/O) is never
// counted as an attempt — at most one probe per cooldown window, never a
// retry storm.

/** Max REAL generation attempts per image job (across restarts). */
export const IMAGE_MAX_GENERATION_ATTEMPTS = 3
/** Max cumulative time a job may spend parked in throttle retry_wait. */
export const IMAGE_MAX_CUMULATIVE_THROTTLE_MS = 30 * 60_000
/** Backoff floor after a real generation 429 (matches the breaker base). */
export const IMAGE_GENERATION_BACKOFF_FLOOR_MS = 60_000
/** Backoff cap — never probe a minutes-long throttle window faster than this. */
export const IMAGE_GENERATION_BACKOFF_MAX_MS = 600_000

/**
 * POSTER-HOTFIX (2026-11-11): a 2xx provider response without a usable image
 * payload (measured: the SDK crashed on `result.data.map` for exactly this
 * shape) is treated as a TRANSIENT provider glitch — ONE bounded automatic
 * retry after a short jittered pause, then an honest terminal failure. Never
 * an unbounded retry loop; the attempt is visible on the job.
 */
export const IMAGE_MAX_TRANSIENT_RETRIES = 1
export const IMAGE_TRANSIENT_RETRY_FLOOR_MS = 5_000
export const IMAGE_TRANSIENT_RETRY_JITTER_MS = 2_000

/**
 * Customer-safe provider detail: strip anything credential-shaped or
 * binary-blob-shaped, collapse whitespace, cap length. The full unsanitized
 * exception stays in the structured log; the audit trail keeps the
 * sanitized diagnostic (brief PART 5 — diagnostics retained, secrets never
 * exposed).
 */
export function sanitizeProviderDetail(msg: string): string {
  return msg
    .replace(/(sk-|Bearer\s+)[A-Za-z0-9._-]+/gi, '$1<redacted>')
    .replace(/[A-Za-z0-9+/=]{120,}/g, '<redacted-blob>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function parseTransientRetries(resultJson: string | null): number {
  if (!resultJson) return 0
  try {
    const parsed = JSON.parse(resultJson) as { transientRetries?: unknown }
    return typeof parsed.transientRetries === 'number' && Number.isFinite(parsed.transientRetries)
      ? parsed.transientRetries
      : 0
  } catch {
    return 0
  }
}

/**
 * Bounded, throttle-aware backoff for the next generation attempt.
 * Priority: an actual provider Retry-After (clamped 5s..10min) → the images
 * breaker's remaining window (never generate into an open cooldown) →
 * BEAN's escalating schedule 60s·2^(n-1). Capped at 10 minutes. Pure;
 * exported for unit tests.
 */
export function imageGenerationBackoffMs(
  attempt: number,
  breakerRemainingMs: number,
  retryAfterMs: number | null,
): number {
  if (retryAfterMs !== null) {
    return Math.min(Math.max(Math.round(retryAfterMs), 5_000), IMAGE_GENERATION_BACKOFF_MAX_MS)
  }
  const escalated = IMAGE_GENERATION_BACKOFF_FLOOR_MS * 2 ** Math.max(0, Math.min(Math.max(1, attempt), 6) - 1)
  return Math.min(Math.max(breakerRemainingMs, escalated), IMAGE_GENERATION_BACKOFF_MAX_MS)
}

/** True when the error is an upstream throttle (real 429 or breaker skip). */
function isGenerationThrottle(e: unknown): boolean {
  return e instanceof UpstreamRateLimitError || classifyUpstreamError(e).kind === 'rate_limited'
}

/** Retry-After hint in ms when an adapter ever surfaces one (else null).
 *  EXPORTED for the hosted-edit / background-removal paths — CAPABILITY
 *  RECOVERY (2026-11-11) reuses the identical hint resolution instead of a
 *  second, divergent one. */
export function retryAfterMsOf(e: unknown): number | null {
  const raw = (e as { retryAfterMs?: unknown } | null)?.retryAfterMs
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null
}

/** Persisted throttle state (survives restarts — same design as video). */
export interface ImageThrottleState {
  submissionAttempts: number
  throttleWaitMs: number
}

/** EXPORTED: the hosted-edit / background-removal parking path reads the
 *  same persisted budget shape (one mechanism, no divergent copy). */
export function parseThrottleState(resultJson: string | null): ImageThrottleState {
  if (!resultJson) return { submissionAttempts: 0, throttleWaitMs: 0 }
  try {
    const parsed = JSON.parse(resultJson) as { submissionAttempts?: unknown; throttleWaitMs?: unknown }
    return {
      submissionAttempts: typeof parsed.submissionAttempts === 'number' ? parsed.submissionAttempts : 0,
      throttleWaitMs: typeof parsed.throttleWaitMs === 'number' ? parsed.throttleWaitMs : 0,
    }
  } catch {
    return { submissionAttempts: 0, throttleWaitMs: 0 }
  }
}

/**
 * LAXII IMAGE QUALITY (2026-11-10, Part B §5): which detected defects are
 * SERIOUS enough to justify ONE bounded targeted correction. Anatomy-class
 * errors (limbs, fingers, faces, wings, joints, subject count) — the classes
 * curated world knowledge warns about — qualify; lighting/material nuances
 * reported by the checker do not trigger regeneration. Exported pure for
 * unit testing.
 */
export function seriousAnatomyDefects(defects: string[]): string[] {
  return defects.filter((d) =>
    /\b(extra|missing|duplicat\w*|wrong\s+(?:number|count|limb\w*|digit\w*|wing\w*)|limb\w*|finger\w*|digit\w*|hand\w*|face\w*|wing\w*|joint\w*|knee\w*|elbow\w*|anatom\w*|pose\b|body\s+part\w*|deform\w*|subject count|too many|two left|float\w*|unsupport\w*|persist\w*|persistence|geometry|spatial\s+relation\w*|appearing|disappear\w*)\b/i.test(d),
  )
}

/**
 * The targeted-correction edit prompt: fixes ONLY the observed defects and
 * preserves everything else about the image (composition, identity, style,
 * lighting, background). Never a wholesale re-imagination.
 */
export function buildCorrectionPrompt(defects: string[]): string {
  return (
    'Targeted quality correction. Keep this image EXACTLY as it is — same composition, same subject identity, ' +
    'same clothing, same background, same lighting direction, same color grade — and fix ONLY these observed defects: ' +
    defects.map((d) => d.replace(/^\W+/, '')).join('; ') +
    '. Do not add or remove any other element.'
  )
}

async function updateJob(id: string, data: Record<string, unknown>) {
  await db.generationJob.update({ where: { id }, data })
}

// ---------------------------------------------------------------------------
// M26 (audit F-1): cancellation contract for the TEXT-TO-IMAGE processor.
// The cancel route documents "the worker will stop at its next checkpoint" —
// but this processor had NO checkpoints and completed an unconditional write,
// so a cancelled RUNNING job still generated, stored the artifact and flipped
// the row to completed/100. Now: (a) checkpoints BEFORE provider work and
// BEFORE any completion write; (b) the completion itself is a guarded CAS
// (status still running, not cancel-requested, still our worker) — a job
// cancelled mid-generation is settled 'cancelled' instead of 'completed'.
// ---------------------------------------------------------------------------

async function isCancelRequested(id: string): Promise<boolean> {
  const row = await db.generationJob.findUnique({ where: { id }, select: { cancelRequested: true } })
  return row?.cancelRequested === true
}

/** Guarded completion write: count === 1 only when the job is still ours to complete. */
async function completeJobGuarded(
  id: string,
  workerId: string | null | undefined,
  data: Record<string, unknown>,
): Promise<boolean> {
  const where: Record<string, unknown> = { id, status: 'running', cancelRequested: false }
  if (workerId) where.workerId = workerId
  const res = await db.generationJob.updateMany({ where, data })
  return res.count === 1
}

/** Honest cancellation settle (checked-point cancel — before or after provider work). */
async function settleCancelled(job: { id: string; userId: string }, workerId: string | null | undefined, when: string, providerSpent: boolean): Promise<void> {
  const where: Record<string, unknown> = { id: job.id, cancelRequested: true }
  if (workerId) where.workerId = workerId
  await db.generationJob.updateMany({
    where,
    data: {
      status: 'cancelled',
      finishedAt: new Date(),
      errorCode: 'CANCELLED',
      errorMessage: `Generation cancelled by the user ${when} it completed (no artifact was delivered).`,
    },
  })
  // Conservative accounting: when provider work already happened, the spend
  // is metered as a cancelled failure — the account budget never under-counts.
  if (providerSpent) {
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId: getBackend('bean-image-hosted-primary')!.id,
      kind: 'image-generation',
      success: false,
      errorCode: 'CANCELLED',
      durationMs: 0,
    }).catch(() => undefined)
  }
  logger.info('laxii.job_cancelled_at_checkpoint', { jobId: job.id, when })
  // Trust Engine: the cancelled job gets an honest receipt (best-effort).
  await recordMediaJobCancelled(
    {
      userId: job.userId,
      product: 'laxii',
      kind: 'image-generation',
      jobId: job.id,
      requestPreview: await jobPromptPreview(job.id),
    },
    when,
  )
}

/** Bounded prompt preview straight from the job row (owner's own data). */
async function jobPromptPreview(jobId: string): Promise<string> {
  try {
    const row = await db.generationJob.findUnique({ where: { id: jobId }, select: { paramsJson: true } })
    if (!row) return 'image generation job'
    const p = JSON.parse(row.paramsJson) as { prompt?: unknown }
    return typeof p.prompt === 'string' ? p.prompt : 'image generation job'
  } catch {
    return 'image generation job'
  }
}

export async function processImageJob(job: ImageJobRow): Promise<void> {
  const params = JSON.parse(job.paramsJson) as {
    prompt: string
    size?: string
    width?: number
    height?: number
  }
  const backend = getBackend('bean-image-hosted-primary')!
  const startedAt = new Date()
  // Persisted throttle budget (survives restarts — parked jobs re-claim with
  // the SAME row, so the attempt/wait history rides in resultJson).
  const throttle0 = parseThrottleState(job.resultJson)
  const transientRetries0 = parseTransientRetries(job.resultJson)

  // ---- CUSTOM IMAGE DIMENSIONS (2026-11-11): resolve the exact target ------
  // Preset jobs carry {size} (one of the 7 native strings — behavior
  // unchanged); custom jobs carry {width, height}. Both resolve to a target
  // plus a plan that always generates at a PROVIDER-NATIVE size and delivers
  // exactly the requested pixels (verified from decoded bytes below).
  let target: { width: number; height: number }
  let plan: DimensionPlan
  try {
    if (typeof params.width === 'number' && typeof params.height === 'number') {
      target = validateDimensions(params.width, params.height)
    } else if (typeof params.size === 'string' && /^\d+x\d+$/.test(params.size)) {
      const [w, h] = params.size.split('x').map(Number)
      target = { width: w, height: h }
    } else {
      throw new DimensionError('INVALID_DIMENSIONS', 'the job carries neither a valid size nor width/height')
    }
    plan = planExactDimensions(target.width, target.height)
  } catch (e) {
    // Invalid job parameters: honest terminal failure, no provider call,
    // no cost. Preserved prompt/settings remain on the row for safe retry.
    const message =
      e instanceof DimensionError
        ? e.message
        : `This generation request has invalid image dimensions. Original request preserved — resubmit with a supported size.`
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      backendId: backend.id,
      errorClass: 'invalid_request',
      errorCode: 'INVALID_DIMENSIONS',
      errorMessage: message,
    })
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId: backend.id,
      kind: 'image-generation',
      success: false,
      errorCode: 'INVALID_DIMENSIONS',
      durationMs: Date.now() - startedAt.getTime(),
    })
    // Trust Engine: the request was truly attempted and honestly failed
    // before any provider call — the receipt says exactly that (best-effort).
    await recordMediaJobFailure(
      {
        userId: job.userId,
        product: 'laxii',
        kind: 'image-generation',
        jobId: job.id,
        backendId: backend.id,
        requestPreview: typeof params?.prompt === 'string' ? params.prompt : 'image generation job',
      },
      {
        errorCode: 'INVALID_DIMENSIONS',
        errorClass: 'invalid_request',
        errorMessage: 'Invalid image dimensions — the job failed before any provider call was made.',
      },
    )
    logger.warn('laxii.job_invalid_dimensions', { jobId: job.id, message })
    return
  }
  const generateSize = `${plan.generateWidth}x${plan.generateHeight}`

  // ---- TEXT-HEAVY GENERATION (PART 4, 2026-11-11): explicit exact-text
  // demands (quoted wording in a typography context) route through the
  // measured hybrid pipeline when the model itself cannot honor them.
  const textDemands: TextDemand | null = extractExactTextDemands(params.prompt)

  // M26 F-1 checkpoint: a cancel arriving between claim and generation ends
  // the job honestly BEFORE any provider spend.
  if (await isCancelRequested(job.id)) {
    await settleCancelled(job, job.workerId, 'before generation started', false)
    return
  }

  /**
   * The single completion path: store the VERIFIED artifact, register the
   * asset, complete the job with honest metadata, meter the success.
   * Shared by the direct pipeline and the hybrid-typography recovery.
   * M26 F-1: cancelled jobs are never completed — the write is a guarded
   * CAS and a raced cancel settles the row 'cancelled' (no artifact
   * delivery, no success metering).
   */
  const completeJob = async (io: {
    bytes: Buffer
    format: string
    durationMs: number
    generation: Record<string, unknown>
    verification: Record<string, unknown> | null
    artifact?: Record<string, unknown> | null
  }): Promise<void> => {
    if (await isCancelRequested(job.id)) {
      await settleCancelled(job, job.workerId, 'after generation finished', true)
      return
    }
    const dir = path.join(STORAGE_ROOT, job.userId)
    fs.mkdirSync(dir, { recursive: true })
    const ext = io.format === 'png' ? 'png' : 'jpg'
    fs.writeFileSync(path.join(dir, `${job.id}.${ext}`), io.bytes)

    let assetUrl: string | null = null
    let assetId: string | null = null
    try {
      const asset = await storeResultAsset(job.userId, 'result', io.bytes, target.width, target.height, {
        jobId: job.id,
        artifact: 'generation',
        mime: io.format === 'png' ? 'image/png' : 'image/jpeg',
      })
      assetUrl = asset.url
      assetId = asset.id
    } catch (e) {
      logger.warn('laxii.generation_asset_failed', {
        jobId: job.id,
        message: e instanceof Error ? e.message : String(e),
      })
    }

    const resultJson = JSON.stringify({
      imageUrl: `/api/laxii/images/${job.id}`,
      ...(assetUrl ? { assetUrl, assetId } : {}),
      width: target.width,
      height: target.height,
      format: io.format,
      bytes: io.bytes.length,
      durationMs: io.durationMs,
      // M26.3 honest quality report: the aspect ratio is the reduced fraction
      // of the FINAL encoded dimensions, and the model identity comes from
      // the registry — measured values only, never invented.
      aspectRatio: aspectRatioLabel(target.width, target.height),
      model: backend.modelIdentity,
      backendId: backend.id,
      generation: io.generation,
      ...(io.artifact ? { artifact: io.artifact } : {}),
      ...(intelMeta ? { intel: intelMeta } : {}),
      ...(io.verification ? { verification: io.verification } : {}),
      ...(throttle0.submissionAttempts > 0 || throttle0.throttleWaitMs > 0
        ? { submissionAttempts: throttle0.submissionAttempts + 1, throttleWaitMs: throttle0.throttleWaitMs }
        : {}),
      ...(transientRetries0 > 0 ? { transientRetries: transientRetries0 } : {}),
    })
    const stillOurs = await completeJobGuarded(job.id, job.workerId, {
      status: 'completed',
      progress: 100,
      finishedAt: new Date(),
      backendId: backend.id,
      resultJson,
    })
    if (!stillOurs) {
      // The job was cancelled (or its ownership changed) between the
      // checkpoint and this write — settle honestly, never clobber.
      await settleCancelled(job, job.workerId, 'at completion', true)
      return
    }
    // Trust Engine: the delivered artifact gets an inspectable receipt from
    // the ACTUAL result — the bounded vision check is recorded as checked or
    // not-run, never inflated (best-effort; never breaks the worker).
    await recordMediaJobCompletion(
      {
        userId: job.userId,
        product: 'laxii',
        kind: 'image-generation',
        jobId: job.id,
        backendId: backend.id,
        requestPreview: typeof params?.prompt === 'string' ? params.prompt : 'image generation job',
      },
      {
        artifactUrl: `/api/laxii/images/${job.id}`,
        assetId: assetId ?? null,
        width: target.width,
        height: target.height,
        format: io.format,
        bytes: io.bytes.length,
        durationMs: io.durationMs,
        verification: io.verification ?? null,
      },
    )
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId: backend.id,
      kind: 'image-generation',
      imageCount: 1,
      durationMs: io.durationMs,
      success: true,
    })
    logger.info('laxii.job_completed', { jobId: job.id, durationMs: io.durationMs })
    noteRealAttempt('image-generation', {
      at: new Date().toISOString(),
      ok: true,
      backendId: backend.id,
      failureCategory: null,
      httpStatus: null,
      upstream: false,
    })
  }

  /**
   * HYBRID TYPOGRAPHY (brief PART 4): one text-free background generation
   * at the planned native size + the exact wording composited
   * deterministically + OCR validation. Bounded to ONE attempt per job by
   * its callers. The extra background provider call is metered explicitly
   * (conservative accounting: the account-quota counter never under-counts).
   */
  const hybridTypography = async (reason: string): Promise<boolean> => {
    if (!textDemands) return false
    try {
      const bg = await withTimeout(
        hostedImageAdapter.generateImage!({
          prompt: textDemands.textFreePrompt,
          size: generateSize,
          timeoutMs: backend.timeouts.requestMs,
        }),
        backend.timeouts.requestMs,
        'Image generation',
      )
      await recordUsage({
        userId: job.userId,
        product: 'laxii',
        backendId: backend.id,
        kind: 'image-generation',
        imageCount: 1,
        durationMs: bg.durationMs,
        success: true,
      })
      const bgMeasured = await measureImage(bg.bytes)
      const base =
        plan.strategy.kind === 'native' ? bg.bytes : (await applyExactDimensions(bg.bytes, target, plan)).bytes
      const comp = await compositeTypography(base, textDemands.segments, target)
      const measured = await measureImage(comp.bytes)
      if (measured.width !== target.width || measured.height !== target.height) {
        logger.warn('laxii.hybrid_dimension_mismatch', {
          jobId: job.id,
          measured: `${measured.width}x${measured.height}`,
        })
        return false
      }
      const textValidation = validateExactText(await ocrText(comp.bytes), textDemands.segments)
      await completeJob({
        bytes: comp.bytes,
        format: 'jpeg',
        durationMs: Date.now() - startedAt.getTime(),
        generation: {
          ...generationProvenance(plan, target),
          strategy: 'hybrid-typography',
          generated: `${bgMeasured.width}x${bgMeasured.height}`,
          typography: 'deterministic composite — the exact wording is rendered by BEAN, never by the model',
          directAttempt: reason,
        },
        verification: {
          checked: textValidation.method === 'tesseract',
          method: `ocr:${textValidation.method}`,
          textValidation,
          observation:
            textValidation.method === 'tesseract'
              ? textValidation.missing.length === 0
                ? 'all demanded wording confirmed present by OCR on the final artifact'
                : `OCR could not confirm: ${textValidation.missing.join(' | ')}`
              : 'OCR unavailable on this host — the wording is still deterministic (SVG-rendered), but not independently validated',
        },
      })
      logger.info('laxii.hybrid_typography_completed', { jobId: job.id, reason: reason.slice(0, 120) })
      return true
    } catch (he) {
      logger.warn('laxii.hybrid_typography_failed', {
        jobId: job.id,
        message: he instanceof Error ? he.message : String(he),
      })
      return false
    }
  }

  await updateJob(job.id, { status: 'running', startedAt, progress: 15 })

  // ---- BEAN Intelligence: world-knowledge grounding (invisible to users) ---
  // The user's prompt is preserved VERBATIM and FIRST; the intelligence layer
  // appends compact structured conditioning (physical-reality reference,
  // camera/light directives, retrieved fidelity notes) around it. Every
  // failure degrades honestly to the raw prompt — grounding can delay a
  // generation by at most one bounded search, never break it.
  let conditionedPrompt = params.prompt
  let intelMeta: Record<string, unknown> | null = null
  try {
    const intel = await prepareImageIntelligence(params.prompt)
    conditionedPrompt = intel.conditionedPrompt
    intelMeta = {
      layer: 'bean-intel/2',
      mode: intel.mode,
      promptLanguage: intel.promptLanguage,
      knowledgeComponents: intel.knowledgeKeys,
      sceneSpec: intel.sceneSpec,
      evidenceHosts: intel.evidence.map((e) => e.host),
      evidenceUrls: intel.evidence.map((e) => e.url),
      degraded: intel.degraded,
      conditioningChars: intel.conditioning.length,
      timingMs: intel.timing,
    }
    if (intel.degraded.length > 0) {
      logger.info('laxii.intel_degraded', { jobId: job.id, degraded: intel.degraded })
    }
  } catch (e) {
    // Absolute guard: intelligence must never fail a generation.
    logger.warn('laxii.intel_failed', { jobId: job.id, message: e instanceof Error ? e.message : String(e) })
  }

  try {
    // M26.3 — MEASURED provider size contract (HTTP 400 code 1214): both
    // sides 512–2880px AND multiples of 32 AND ≤ 2^22 px total. The old
    // native list contained two misaligned sizes (1440x720 / 720x1440) that
    // ALWAYS failed after quota spend; the planner is corrected and this
    // guard makes any future drift fail fast BEFORE the provider call.
    if (!isValidProviderSize(plan.generateWidth, plan.generateHeight)) {
      throw new DimensionError(
        'INVALID_DIMENSIONS',
        `the planned generation size ${plan.generateWidth}x${plan.generateHeight} violates the ` +
          "provider's measured size contract (each side 512-2880px, a multiple of 32, total pixels <= 2^22) — nothing was generated",
      )
    }
    const result = await withTimeout(
      hostedImageAdapter.generateImage!({
        prompt: conditionedPrompt,
        size: generateSize,
        timeoutMs: backend.timeouts.requestMs,
      }),
      backend.timeouts.requestMs,
      'Image generation',
    )

    // ---- EXACT OUTPUT DIMENSIONS (2026-11-11): native sizes pass through;
    // custom targets are finished to the EXACT requested pixels here, before
    // verification, so every downstream consumer sees the delivered artifact.
    // The decoded byte dimensions are MEASURED, never trusted from metadata
    // (brief PART 2 §9); a mismatch fails the job honestly.
    // M26.3 RESILIENCE: the FIELD measured the provider answering a landscape
    // request with its own square default (1312x1312). Failing the job there
    // leaves the user with nothing; instead the ACTUAL bytes are finished to
    // the exact requested target with the least-loss strategy (same decision
    // rules: no stretching, no crop beyond COVER_CROP_LOSS_MAX, blurred
    // edge-derived padding otherwise) and the WHOLE truth is persisted in the
    // generation provenance — requested vs planned vs providerReturned vs
    // finalStrategy. A genuine unusable response still fails honestly.
    let finalBytes = result.bytes
    let finalFormat = result.format
    let finishFromActual: { providerReturned: { width: number; height: number }; strategy: ExactStrategy } | null = null
    const nativeResult = await measureImage(result.bytes)
    if (
      nativeResult.width !== plan.generateWidth ||
      nativeResult.height !== plan.generateHeight
    ) {
      const finishStrategy = planFinishStrategy(nativeResult, target)
      const applied = await applyExactDimensions(result.bytes, target, {
        generateWidth: nativeResult.width,
        generateHeight: nativeResult.height,
        strategy: finishStrategy,
      })
      const measured = await measureImage(applied.bytes)
      if (measured.width !== target.width || measured.height !== target.height) {
        throw new Error(
          `the exact-dimension pipeline produced ${measured.width}x${measured.height} ` +
            `instead of the requested ${target.width}x${target.height} — artifact rejected`,
        )
      }
      finalBytes = applied.bytes
      finalFormat = 'jpeg'
      finishFromActual = { providerReturned: { width: nativeResult.width, height: nativeResult.height }, strategy: finishStrategy }
      logger.warn('laxii.provider_size_mismatch_finished', {
        jobId: job.id,
        planned: `${plan.generateWidth}x${plan.generateHeight}`,
        providerReturned: `${nativeResult.width}x${nativeResult.height}`,
        finishStrategy: finishStrategy.kind,
        delivered: `${target.width}x${target.height}`,
      })
    }
    if (plan.strategy.kind !== 'native' && !finishFromActual) {
      const applied = await applyExactDimensions(result.bytes, target, plan)
      const measured = await measureImage(applied.bytes)
      if (measured.width !== target.width || measured.height !== target.height) {
        throw new Error(
          `the exact-dimension pipeline produced ${measured.width}x${measured.height} ` +
            `instead of the requested ${target.width}x${target.height} — artifact rejected`,
        )
      }
      finalBytes = applied.bytes
      finalFormat = 'jpeg'
    }

    // M26.3 — one reusable exact-finish pass for ANY provider bytes (the
    // original run and, if needed, the bounded watermark regeneration below):
    // measure → mismatch finish → verified exact target.
    const finishProviderBytes = async (
      bytes: Buffer,
    ): Promise<{ bytes: Buffer; format: 'jpeg' | 'png'; providerReturned: { width: number; height: number } }> => {
      const measured = await measureImage(bytes)
      let outBytes = bytes
      let outFormat: 'jpeg' | 'png' = measured.format === 'png' ? 'png' : 'jpeg'
      let mismatch: { providerReturned: { width: number; height: number }; strategy: ExactStrategy } | null = null
      if (measured.width !== plan.generateWidth || measured.height !== plan.generateHeight) {
        const strategy = planFinishStrategy(measured, target)
        const applied = await applyExactDimensions(bytes, target, {
          generateWidth: measured.width,
          generateHeight: measured.height,
          strategy,
        })
        outBytes = applied.bytes
        outFormat = 'jpeg'
        mismatch = { providerReturned: { width: measured.width, height: measured.height }, strategy }
      } else if (plan.strategy.kind !== 'native') {
        const applied = await applyExactDimensions(bytes, target, plan)
        outBytes = applied.bytes
        outFormat = 'jpeg'
      }
      const final = await measureImage(outBytes)
      if (final.width !== target.width || final.height !== target.height) {
        throw new Error(
          `the exact-dimension pipeline produced ${final.width}x${final.height} ` +
            `instead of the requested ${target.width}x${target.height} — artifact rejected`,
        )
      }
      return { bytes: outBytes, format: outFormat, providerReturned: mismatch?.providerReturned ?? { width: plan.generateWidth, height: plan.generateHeight } }
    }

    // ---- TEXT-HEAVY GENERATION (PART 4): when the prompt demanded exact
    // wording, OCR the direct artifact. If the model did not honor the
    // wording, ONE hybrid attempt (text-free background + deterministic
    // typography) delivers the poster honestly. The local OCR runs on every
    // text-demanding generation — zero provider cost.
    let textValidation: TextValidation | null = null
    if (textDemands) {
      textValidation = validateExactText(await ocrText(finalBytes), textDemands.segments)
      if (textValidation.method === 'tesseract' && textValidation.missing.length > 0) {
        logger.info('laxii.direct_text_incomplete', { jobId: job.id, missing: textValidation.missing })
        if (
          await hybridTypography(
            `the model rendered the demanded wording incompletely (OCR could not confirm: ${textValidation.missing.join(' | ')})`,
          )
        ) {
          return // completed through the hybrid pipeline
        }
        // Hybrid declined/failed — the direct artifact stays the result and
        // the text validation below reports exactly what is missing.
      }
    }

    // ---- BEAN Intelligence: post-generation verification (non-fatal) -------
    // One bounded vision check against the defect checklist. A skipped or
    // failed check is reported as exactly that — never claimed as passed.
    // The check runs on the FINAL (exact-dimension) artifact.
    let verification: Record<string, unknown> | null = null
    let verifiedBytes = finalBytes
    let verifiedFormat = finalFormat
    try {
      const dataUrl = await imageBufferToDataUrl(finalBytes, finalFormat === 'png' ? 'image/png' : 'image/jpeg')
      const report = await verifyGeneratedImage(dataUrl, params.prompt)
      verification = {
        checked: report.checked,
        method: report.method,
        defects: report.defects,
        observation: report.observation,
        checkedAt: report.checkedAt,
        durationMs: report.durationMs,
        ...(report.reason ? { reason: report.reason } : {}),
      }
      if (report.checked && report.defects.length > 0) {
        logger.info('laxii.intel_defects_reported', { jobId: job.id, defects: report.defects })
      }

      // ---- LAXII IMAGE QUALITY (Part B §5): ONE bounded targeted correction
      // when the vision check reports a SERIOUS anatomy-class defect. Exactly
      // ONE edit attempt through the EXISTING editing pipeline, one re-check
      // of the corrected image, then a decision — never repeated silent
      // regeneration. The original is kept and the report is honest when the
      // correction fails or does not reduce the serious defects.
      const serious = report.checked ? seriousAnatomyDefects(report.defects) : []
      if (serious.length > 0) {
        const tCorr = Date.now()
        try {
          // ZERO-DOWNTIME RECOVERY (2026-11-11): the targeted correction is
          // AUTOMATED consumption of the shared provider account — when the
          // account's user reserve is consumed, the correction stands down
          // HONESTLY and the original (already-produced) image stays the
          // result. The user's primary request is never withheld by the
          // reserve; only this optional enhancement layer is.
          const quotaState = await automatedQuotaState()
          const reserveReason = automatedSkipReason(quotaState)
          if (reserveReason) throw new Error(`correction not attempted: ${reserveReason}`)
          const corr = await hostedImageAdapter.editImage!({
            prompt: buildCorrectionPrompt(serious),
            imageBase64: result.bytes.toString('base64'),
            size: generateSize,
            timeoutMs: backend.timeouts.requestMs,
          })
          // The correction is edited at the NATIVE generated size; for custom
          // targets the exact-dimension finish is re-applied so the stored
          // correction still measures exactly what the user requested.
          const corrected =
            plan.strategy.kind === 'native'
              ? { bytes: corr.bytes, format: corr.format }
              : {
                  bytes: (await applyExactDimensions(corr.bytes, target, plan)).bytes,
                  format: 'jpeg' as const,
                }
          const corrDataUrl = await imageBufferToDataUrl(corrected.bytes, corrected.format === 'png' ? 'image/png' : 'image/jpeg')
          const recheck = await verifyGeneratedImage(corrDataUrl, params.prompt)
          const seriousAfter = seriousAnatomyDefects(recheck.defects)
          const applied = recheck.checked && seriousAfter.length < serious.length
          verification = {
            ...verification,
            correction: {
              attempted: true,
              applied,
              seriousDefectsBefore: serious,
              seriousDefectsAfter: recheck.checked ? seriousAfter : null,
              recheckMethod: recheck.method,
              ...(recheck.observation ? { recheckObservation: recheck.observation.slice(0, 200) } : {}),
              durationMs: Date.now() - tCorr,
              ...(!recheck.checked && recheck.reason ? { recheckReason: recheck.reason.slice(0, 160) } : {}),
              note: applied
                ? 'the corrected image replaced the original result (fewer serious defects after exactly one targeted edit + re-check)'
                : 'the ORIGINAL image was kept: the single bounded correction did not verifiably reduce the serious defects',
            },
          }
          await recordUsage({
            userId: job.userId,
            product: 'laxii',
            backendId: backend.id,
            kind: 'image-editing',
            imageCount: 1,
            durationMs: Date.now() - tCorr,
            success: true,
          })
          if (applied) {
            verifiedBytes = corrected.bytes
            verifiedFormat = corrected.format
            const corrAsset = await storeResultAsset(job.userId, 'result', corrected.bytes, target.width, target.height, {
              jobId: job.id,
              artifact: 'quality-correction',
              mime: corr.format === 'png' ? 'image/png' : 'image/jpeg',
            })
            verification = {
              ...verification,
              ...(verification as Record<string, unknown>),
              correctionAppliedAssetUrl: corrAsset.url,
            }
            logger.info('laxii.quality_correction_applied', { jobId: job.id, durationMs: Date.now() - tCorr })
          } else {
            logger.info('laxii.quality_correction_kept_original', { jobId: job.id })
          }
        } catch (e) {
          // Bounded honest failure: the correction attempt is reported, the
          // original stays the result, and the failed edit is metered as such.
          const msg = e instanceof Error ? e.message : String(e)
          verification = {
            ...verification,
            correction: {
              attempted: true,
              applied: false,
              seriousDefectsBefore: serious,
              reason: `correction failed: ${msg.slice(0, 160)}`,
              durationMs: Date.now() - tCorr,
              note: 'the ORIGINAL image was kept after the bounded correction attempt failed',
            },
          }
          await recordUsage({
            userId: job.userId,
            product: 'laxii',
            backendId: backend.id,
            kind: 'image-editing',
            durationMs: Date.now() - tCorr,
            success: false,
            errorCode: 'BACKEND_FAILURE',
          })
          logger.warn('laxii.quality_correction_failed', { jobId: job.id, message: msg.slice(0, 200) })
        }
      }
    } catch (e) {
      verification = { checked: false, method: 'unavailable', reason: `verification errored: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown'}` }
      logger.warn('laxii.intel_verification_failed', { jobId: job.id, message: e instanceof Error ? e.message : String(e) })
    }

    // ---- M26.3 WATERMARK / UNWANTED-MARK HANDLING ---------------------------
    // The field showed an IMAX-like wordmark rendered INTO a cinematic image
    // that never asked for text. Classification (M26_3_WATERMARK_INVESTIGATION.md):
    // the mark is generated directly by the model — no BEAN overlay exists
    // anywhere in the pipeline, and clean generations carry no mark. Handling
    // per the milestone contract:
    //   1. the prompt conditioning now EXCLUDES text/logos/watermarks;
    //   2. when the bounded vision check reports UNWANTED marks, ONE
    //      regeneration attempt runs with the same prompt and planned size
    //      (quota-guarded exactly like every automated provider consumption);
    //   3. the regenerated image replaces the flagged one ONLY when its own
    //      re-check is clean; otherwise the ORIGINAL stays the result and is
    //      flagged — never silently cropped, never overwritten dishonestly;
    //   4. the result records the whole truth; the UI surfaces the flag and
    //      an explicit Regenerate action.
    let artifactReport: Record<string, unknown> | null = null
    {
      const checked = verification?.checked === true
      const defects = checked && Array.isArray((verification as Record<string, unknown>)?.defects)
        ? ((verification as Record<string, unknown>).defects as string[])
        : []
      const unwanted = checked ? unwantedTextDefects(defects) : []
      if (!checked) {
        artifactReport = {
          checked: false,
          unwantedTextDetected: null,
          reason: String((verification as Record<string, unknown>)?.reason ?? 'verification unavailable').slice(0, 160),
        }
      } else if (unwanted.length === 0) {
        artifactReport = { checked: true, unwantedTextDetected: false, checkedAt: (verification as Record<string, unknown>).checkedAt }
      } else {
        artifactReport = { checked: true, unwantedTextDetected: true, defects: unwanted, checkedAt: (verification as Record<string, unknown>).checkedAt }
        const tRegen = Date.now()
        try {
          const quotaState = await automatedQuotaState()
          const reserveReason = automatedSkipReason(quotaState)
          if (reserveReason) throw new Error(`regeneration not attempted: ${reserveReason}`)
          const regen = await withTimeout(
            hostedImageAdapter.generateImage!({
              prompt: conditionedPrompt,
              size: generateSize,
              timeoutMs: backend.timeouts.requestMs,
            }),
            backend.timeouts.requestMs,
            'Image regeneration',
          )
          const regenFinished = await finishProviderBytes(regen.bytes)
          const regenDataUrl = await imageBufferToDataUrl(regenFinished.bytes, regenFinished.format === 'png' ? 'image/png' : 'image/jpeg')
          const recheck = await verifyGeneratedImage(regenDataUrl, params.prompt)
          const unwantedAfter = recheck.checked ? unwantedTextDefects(recheck.defects) : []
          const clean = recheck.checked && unwantedAfter.length === 0
          artifactReport = {
            ...artifactReport,
            regeneration: {
              attempted: true,
              used: clean,
              defectsAfter: recheck.checked ? unwantedAfter : null,
              ...(recheck.checked ? {} : { recheckReason: String(recheck.reason ?? '').slice(0, 160) }),
              durationMs: Date.now() - tRegen,
              note: clean
                ? 'the regenerated image is text/artifact-clean and replaced the flagged first attempt — the flagged original is preserved and linked in flaggedOriginalAssetUrl'
                : 'the ORIGINAL flagged image stays the result: the single bounded regeneration still showed unwanted text (an explicit Regenerate action remains available)',
            },
          }
          if (clean) {
            // Preserve the FLAGGED original, deliver the clean regeneration.
            const flaggedAsset = await storeResultAsset(job.userId, 'result', finalBytes, target.width, target.height, {
              jobId: job.id,
              artifact: 'flagged-original',
              mime: finalFormat === 'png' ? 'image/png' : 'image/jpeg',
            })
            artifactReport.flaggedOriginalAssetUrl = flaggedAsset.url
            finalBytes = regenFinished.bytes
            finalFormat = regenFinished.format
            finishFromActual =
              regenFinished.providerReturned.width !== plan.generateWidth ||
              regenFinished.providerReturned.height !== plan.generateHeight
                ? {
                    providerReturned: regenFinished.providerReturned,
                    strategy: planFinishStrategy(regenFinished.providerReturned, target),
                  }
                : null
            await recordUsage({
              userId: job.userId,
              product: 'laxii',
              backendId: backend.id,
              kind: 'image-generation',
              imageCount: 1,
              durationMs: Date.now() - tRegen,
              success: true,
            })
            logger.info('laxii.artifact_regeneration_clean', { jobId: job.id, durationMs: Date.now() - tRegen })
          } else {
            await recordUsage({
              userId: job.userId,
              product: 'laxii',
              backendId: backend.id,
              kind: 'image-generation',
              imageCount: 1,
              durationMs: Date.now() - tRegen,
              success: true,
            })
            logger.info('laxii.artifact_regeneration_still_flagged', { jobId: job.id })
          }
        } catch (e) {
          artifactReport = {
            ...artifactReport,
            regeneration: {
              attempted: false,
              used: false,
              reason: String(e instanceof Error ? e.message : e).slice(0, 180),
              durationMs: Date.now() - tRegen,
              note: 'the ORIGINAL flagged image stays the result',
            },
          }
          logger.warn('laxii.artifact_regeneration_failed', { jobId: job.id, message: e instanceof Error ? e.message : String(e) })
        }
      }
    }

    // Persist artifact under BEAN storage; access is authorized per-user.
    // The bytes written are the VERIFIED bytes (the applied correction replaces
    // the original file when — and only when — the re-check proved it better).
    await completeJob({
      bytes: verifiedBytes,
      format: verifiedFormat,
      durationMs: result.durationMs,
      generation: generationProvenance(plan, target, finishFromActual ? finishFromActual : undefined),
      verification: {
        ...(verification ?? {}),
        ...(textValidation ? { textValidation } : {}),
      },
      artifact: artifactReport,
    })
  } catch (e) {
    // ZERO-DOWNTIME RECOVERY (2026-11-11): a throttle-class failure (real 429
    // or a breaker skip) PARKS the job instead of destroying it — bounded,
    // breaker-aligned retry_wait exactly like the video worker. Everything
    // else fails terminally with its honest class, as before.
    if (isGenerationThrottle(e)) {
      await settleThrottledGeneration(job, e, backend.id, startedAt, throttle0)
      return
    }
    // POSTER-HOTFIX (2026-11-11): a 2xx response without a usable image
    // payload is a TRANSIENT provider glitch — ONE bounded, jittered retry,
    // then an honest terminal failure that carries the provider's actual
    // answer (sanitized). Never the old silent TypeError → generic
    // BACKEND_FAILURE with zero diagnostics.
    if (e instanceof ImageProviderResponseError) {
      if (transientRetries0 < IMAGE_MAX_TRANSIENT_RETRIES) {
        const backoffMs =
          IMAGE_TRANSIENT_RETRY_FLOOR_MS + Math.floor(Math.random() * IMAGE_TRANSIENT_RETRY_JITTER_MS)
        await updateJob(job.id, {
          status: 'retry_wait',
          nextRunAt: new Date(Date.now() + backoffMs),
          backendId: backend.id,
          errorClass: 'transient',
          errorCode: 'UPSTREAM_RESPONSE_INVALID',
          errorMessage:
            `The image service returned an incomplete response — the job stays queued and attempt ` +
            `${transientRetries0 + 2} starts automatically in ~${Math.round(backoffMs / 1000)}s. ` +
            `Detail retained: ${sanitizeProviderDetail(e.providerDetail || e.message)}`,
          resultJson: JSON.stringify({
            ...(throttle0.submissionAttempts > 0 ? { submissionAttempts: throttle0.submissionAttempts, throttleWaitMs: throttle0.throttleWaitMs } : {}),
            transientRetries: transientRetries0 + 1,
            lastTransient: { at: new Date().toISOString(), detail: sanitizeProviderDetail(e.message) },
          }),
        })
        await appendJobEventSafe(job.id, 'notice', {
          generation_transient_retry: true,
          attempt: transientRetries0 + 1,
          backoffMs,
          bodyKeys: e.bodyKeys,
        })
        logger.warn('laxii.job_transient_response_retry', {
          jobId: job.id,
          attempt: transientRetries0 + 1,
          backoffMs,
          detail: sanitizeProviderDetail(e.message),
        })
        return
      }
      const detail = sanitizeProviderDetail(e.providerDetail || e.message)
      noteRealAttempt('image-generation', {
        at: new Date().toISOString(),
        ok: false,
        backendId: backend.id,
        failureCategory: 'backend-error',
        httpStatus: null,
        upstream: false,
      })
      await updateJob(job.id, {
        status: 'failed',
        finishedAt: new Date(),
        backendId: backend.id,
        errorClass: 'malformed_response',
        errorCode: 'UPSTREAM_RESPONSE_INVALID',
        errorMessage:
          `The image service could not produce this image (${IMAGE_MAX_TRANSIENT_RETRIES + 1} attempts — ` +
          `it returned an incomplete response each time). The prompt and settings are preserved for retry.` +
          (detail ? ` Provider said: ${detail}` : ''),
        resultJson: JSON.stringify({
          ...(throttle0.submissionAttempts > 0 ? { submissionAttempts: throttle0.submissionAttempts, throttleWaitMs: throttle0.throttleWaitMs } : {}),
          transientRetries: transientRetries0,
          lastTransient: { at: new Date().toISOString(), detail: sanitizeProviderDetail(e.message), bodyKeys: e.bodyKeys },
        }),
      })
      await recordUsage({
        userId: job.userId,
        product: 'laxii',
        backendId: backend.id,
        kind: 'image-generation',
        success: false,
        errorCode: 'UPSTREAM_RESPONSE_INVALID',
        durationMs: Date.now() - startedAt.getTime(),
      })
      await recordAudit({
        actorId: job.userId,
        action: 'laxii.generation_provider_response_invalid',
        target: job.id,
        meta: { httpStatus: e.httpStatus, bodyKeys: e.bodyKeys, detail: sanitizeProviderDetail(e.providerDetail || e.message), transientRetries: transientRetries0 },
      }).catch(() => undefined)
      // Trust Engine: the provider answered unusable output on every allowed
      // attempt — the receipt records the real class and the bounded retries.
      await recordMediaJobFailure(
        {
          userId: job.userId,
          product: 'laxii',
          kind: 'image-generation',
          jobId: job.id,
          backendId: backend.id,
          requestPreview: typeof params?.prompt === 'string' ? params.prompt : 'image generation job',
        },
        {
          errorCode: 'UPSTREAM_RESPONSE_INVALID',
          errorClass: 'malformed_response',
          errorMessage: `The image service could not produce this image after ${IMAGE_MAX_TRANSIENT_RETRIES + 1} attempts (incomplete response each time).`,
        },
      )
      logger.warn('laxii.job_failed_malformed_response', {
        jobId: job.id,
        httpStatus: e.httpStatus,
        bodyKeys: e.bodyKeys,
        detail: sanitizeProviderDetail(e.message),
      })
      // HYBRID TYPOGRAPHY RECOVERY (PART 4): for text-heavy prompts the
      // measured provider fault (e.g. the poster prompt's deterministic
      // StackOverflowError body) does not have to kill the request — the
      // text-free background prompt is a DIFFERENT prompt and one bounded
      // hybrid attempt can still deliver exactly what the user asked for.
      if (textDemands && (await hybridTypography(`the provider could not process the original prompt (${sanitizeProviderDetail(e.providerDetail || e.message)})`))) {
        return
      }
      return
    }
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
    // POSTER-HOTFIX (2026-11-11): the sanitized provider reason is retained
    // on the job and in the audit trail — never again a bare generic
    // BACKEND_FAILURE with the actual exception lost.
    const sanitizedReason = sanitizeProviderDetail(message)
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      backendId: backend.id,
      errorClass: failure.kind === 'other' && timedOut ? 'timeout' : failure.kind,
      errorCode: timedOut ? 'BACKEND_TIMEOUT' : 'BACKEND_FAILURE',
      errorMessage: timedOut
        ? 'Generation exceeded the time limit and was stopped.'
        : `The image backend could not complete this request. Reason: ${sanitizedReason}`,
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
    await recordAudit({
      actorId: job.userId,
      action: 'laxii.generation_failed',
      target: job.id,
      meta: { errorClass: failure.kind === 'other' && timedOut ? 'timeout' : failure.kind, reason: sanitizedReason },
    }).catch(() => undefined)
    // Trust Engine: the terminal failure records its REAL class (timeout,
    // rate-limit, auth, network, backend) and the sanitized reason — the
    // attempt happened, it did not produce an artifact (best-effort).
    await recordMediaJobFailure(
      {
        userId: job.userId,
        product: 'laxii',
        kind: 'image-generation',
        jobId: job.id,
        backendId: backend.id,
        requestPreview: typeof params?.prompt === 'string' ? params.prompt : 'image generation job',
      },
      {
        errorCode: timedOut ? 'BACKEND_TIMEOUT' : 'BACKEND_FAILURE',
        errorClass: failure.kind === 'other' && timedOut ? 'timeout' : failure.kind,
        errorMessage: timedOut
          ? 'Generation exceeded the time limit and was stopped.'
          : `The image backend could not complete this request. Reason: ${sanitizedReason}`,
      },
    )
    logger.warn('laxii.job_failed', { jobId: job.id, message })
  }
}

/**
 * ZERO-DOWNTIME RECOVERY (2026-11-11): park a throttled image generation in
 * RETRY_WAIT with a bounded, breaker-aligned backoff — the exact recovery
 * the video worker has run since 2026-11-08 (measured: throttle windows
 * last minutes; a real 429 must never be retried INTO the window). Bounded
 * both ways (IMAGE_MAX_GENERATION_ATTEMPTS real attempts;
 * IMAGE_MAX_CUMULATIVE_THROTTLE_MS total parked wait) so exhaustion ends in
 * an honest terminal failure that states exactly what happened. A breaker
 * SKIP made no network request — it counts no attempt and only extends the
 * scheduled wait. No duplicate submission is possible: with no provider
 * artifact, the retry IS the first accepted generation.
 */
async function settleThrottledGeneration(
  job: ImageJobRow,
  e: unknown,
  backendId: string,
  startedAt: Date,
  throttle0: ImageThrottleState,
): Promise<void> {
  const attempted = !(e instanceof UpstreamRateLimitError && !e.attempted)
  // Product-health evidence: a real 429 is genuine upstream evidence; a
  // breaker skip is an application-side deferral (no request left the host).
  noteRealAttempt('image-generation', {
    at: new Date().toISOString(),
    ok: false,
    backendId,
    failureCategory: 'rate-limited',
    httpStatus: attempted ? 429 : null,
    upstream: attempted,
  })
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
      `The image gateway kept throttling this generation (HTTP 429): ${Math.max(1, attempt)} authorized attempt(s) ` +
      `over ~${Math.round(cumulativeWaitMs / 60_000)} minutes all landed inside the same account-wide throttle window, ` +
      `so no image was produced. The job keeps its full attempt history. Resubmitting the same prompt is the way to try again — ` +
      `it will succeed once the provider's throttle window closes.`
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      backendId,
      errorClass: 'rate_limited',
      errorCode: 'RATE_LIMITED',
      errorMessage: message,
      resultJson: JSON.stringify({ submissionAttempts: attempt, throttleWaitMs: cumulativeWaitMs, throttle }),
    })
    await recordUsage({
      userId: job.userId,
      product: 'laxii',
      backendId,
      kind: 'image-generation',
      success: false,
      errorCode: 'RATE_LIMITED',
      durationMs: Date.now() - startedAt.getTime(),
    })
    // Trust Engine: bounded throttle retries were exhausted — the receipt
    // records the exhausted budget and that no image was ever produced.
    await recordMediaJobFailure(
      {
        userId: job.userId,
        product: 'laxii',
        kind: 'image-generation',
        jobId: job.id,
        backendId,
        requestPreview: await jobPromptPreview(job.id),
      },
      {
        errorCode: 'RATE_LIMITED',
        errorClass: 'rate_limited',
        errorMessage: message,
      },
    )
    logger.warn('laxii.job_generation_throttle_exhausted', {
      jobId: job.id,
      attempt,
      cumulativeWaitMs,
    })
    return
  }
  const message = attempted
    ? `The image gateway is throttling generations (HTTP 429). The job stays queued — attempt ` +
      `${attempt + 1} of ${IMAGE_MAX_GENERATION_ATTEMPTS} starts automatically in ~${Math.round(backoffMs / 1000)}s. ` +
      `Nothing was lost; no duplicate was created.`
    : `The image gateway is inside its 429 cooldown window, so no generation was attempted (generating into ` +
      `an open throttle only deepens it). The job stays queued and will run when the window clears ` +
      `(~${Math.round(backoffMs / 1000)}s).`
  await updateJob(job.id, {
    status: 'retry_wait',
    nextRunAt: new Date(Date.now() + backoffMs),
    backendId,
    errorClass: 'rate_limited',
    errorCode: 'RATE_LIMITED',
    errorMessage: message,
    resultJson: JSON.stringify({ submissionAttempts: attempt, throttleWaitMs: cumulativeWaitMs, throttle }),
  })
  await appendJobEventSafe(job.id, 'notice', {
    generation_throttled: true,
    attempt: Math.max(1, attempt),
    backoffMs,
    retryAfterMs,
    attempted,
  })
  logger.warn('laxii.job_generation_throttled', {
    jobId: job.id,
    attempt: Math.max(1, attempt),
    backoffMs,
    attempted,
  })
}
