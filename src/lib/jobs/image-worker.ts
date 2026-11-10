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
import { classifyUpstreamError, healthFailureCategory, upstreamCooldownRemainingMs, UpstreamRateLimitError } from '@/lib/upstream/gateway'
import { appendJobEventSafe } from '@/lib/ai-engine/events'
import { getBackend } from '@/lib/registry/backends'
import { storeResultAsset } from '@/lib/laxii/assets'
import { prepareImageIntelligence } from '@/lib/intel/grounding'
import { verifyGeneratedImage, imageBufferToDataUrl } from '@/lib/intel/continuity'
import { automatedQuotaState, automatedSkipReason } from '@/lib/providers/account-quota'
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

/** Retry-After hint in ms when an adapter ever surfaces one (else null). */
function retryAfterMsOf(e: unknown): number | null {
  const raw = (e as { retryAfterMs?: unknown } | null)?.retryAfterMs
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null
}

/** Persisted throttle state (survives restarts — same design as video). */
export interface ImageThrottleState {
  submissionAttempts: number
  throttleWaitMs: number
}

function parseThrottleState(resultJson: string | null): ImageThrottleState {
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

export async function processImageJob(job: ImageJobRow): Promise<void> {
  const params = JSON.parse(job.paramsJson) as { prompt: string; size: string }
  const backend = getBackend('bean-image-hosted-primary')!
  const startedAt = new Date()
  // Persisted throttle budget (survives restarts — parked jobs re-claim with
  // the SAME row, so the attempt/wait history rides in resultJson).
  const throttle0 = parseThrottleState(job.resultJson)

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
    const result = await withTimeout(
      hostedImageAdapter.generateImage!({
        prompt: conditionedPrompt,
        size: params.size,
        timeoutMs: backend.timeouts.requestMs,
      }),
      backend.timeouts.requestMs,
      'Image generation',
    )

    // ---- BEAN Intelligence: post-generation verification (non-fatal) -------
    // One bounded vision check against the defect checklist. A skipped or
    // failed check is reported as exactly that — never claimed as passed.
    let verification: Record<string, unknown> | null = null
    let verifiedBytes = result.bytes
    let verifiedFormat = result.format
    try {
      const dataUrl = await imageBufferToDataUrl(result.bytes, result.format === 'png' ? 'image/png' : 'image/jpeg')
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
            size: params.size,
            timeoutMs: backend.timeouts.requestMs,
          })
          const corrDataUrl = await imageBufferToDataUrl(corr.bytes, corr.format === 'png' ? 'image/png' : 'image/jpeg')
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
            verifiedBytes = corr.bytes
            verifiedFormat = corr.format
            const corrAsset = await storeResultAsset(job.userId, 'result', corr.bytes, corr.width, corr.height, {
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

    // Persist artifact under BEAN storage; access is authorized per-user.
    // The bytes written are the VERIFIED bytes (the applied correction replaces
    // the original file when — and only when — the re-check proved it better).
    const dir = path.join(STORAGE_ROOT, job.userId)
    fs.mkdirSync(dir, { recursive: true })
    const ext = verifiedFormat === 'png' ? 'png' : 'jpg'
    const filename = `${job.id}.${ext}`
    fs.writeFileSync(path.join(dir, filename), verifiedBytes)

    // 2026-11-04 go-live: the generation result is ALSO registered as a
    // real ImageAsset so it can seed follow-up work (conversational edits,
    // variations) with full ownership checks — the UI's "Use as source"
    // chains from any completed generation. The stored bytes are the VERIFIED
    // bytes (the applied quality correction replaces the original when the
    // re-check proved it better).
    let assetUrl: string | null = null
    let assetId: string | null = null
    try {
      const asset = await storeResultAsset(job.userId, 'result', verifiedBytes, result.width, result.height, {
        jobId: job.id,
        artifact: 'generation',
        mime: verifiedFormat === 'png' ? 'image/png' : 'image/jpeg',
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
        format: verifiedFormat,
        bytes: verifiedBytes.length,
        durationMs: result.durationMs,
        ...(intelMeta ? { intel: intelMeta } : {}),
        ...(verification ? { verification } : {}),
        // Honest recovery history: when this job was parked on a throttle
        // window before succeeding, the parked attempts remain visible.
        ...(throttle0.submissionAttempts > 0 || throttle0.throttleWaitMs > 0
          ? { submissionAttempts: throttle0.submissionAttempts + 1, throttleWaitMs: throttle0.throttleWaitMs }
          : {}),
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
    // ZERO-DOWNTIME RECOVERY (2026-11-11): a throttle-class failure (real 429
    // or a breaker skip) PARKS the job instead of destroying it — bounded,
    // breaker-aligned retry_wait exactly like the video worker. Everything
    // else fails terminally with its honest class, as before.
    if (isGenerationThrottle(e)) {
      await settleThrottledGeneration(job, e, backend.id, startedAt, throttle0)
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
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      backendId: backend.id,
      errorClass: failure.kind === 'other' && timedOut ? 'timeout' : failure.kind,
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
