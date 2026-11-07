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
import {
  classifyUpstreamError,
  healthFailureCategory,
  upstreamCooldownRemainingMs,
  UpstreamRateLimitError,
} from '@/lib/upstream/gateway'
import { appendJobEventSafe } from '@/lib/ai-engine/events'
import { getBackend } from '@/lib/registry/backends'
import fs from 'fs'
import path from 'path'

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'jazmii')

const POLL_INTERVAL_MS = Number(process.env.JAZMII_VIDEO_POLL_INTERVAL_MS ?? 5_000)
const MAX_POLL_MS = Number(process.env.JAZMII_VIDEO_MAX_POLL_MS ?? 15 * 60_000)
/** ISSUES 1-2 REPAIR: base delay between throttled download retries (5s, 10s). */
const DOWNLOAD_RETRY_BASE_MS = Number(process.env.JAZMII_VIDEO_DOWNLOAD_RETRY_MS ?? 5_000)

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
  /** Present while job tracking is being throttled upstream (honest UI
   *  display — FINAL FIX 2026-11-07: a throttled status poll never fails an
   *  accepted job, it backs off and keeps tracking). */
  trackingRetry?: { consecutive: number; kind: string; at: string }
  /** ISSUES 1-2 REPAIR (2026-11-08): bounded submission-throttle
   *  bookkeeping, persisted in resultJson so the retry budget survives
   *  worker restarts. submissionAttempts counts REAL submission requests
   *  (breaker skips are not attempts — no network I/O was made). */
  submissionAttempts?: number
  throttleWaitMs?: number
  throttle?: {
    attempt: number
    backoffMs: number
    retryAfterMs: number | null
    attempted: boolean
    at: string
  }
}

type JobRow = {
  id: string
  userId: string
  product: string
  task: string
  status: string
  paramsJson: string
  resultJson: string | null
  /** Set on retry_wait rows (engine schedule). Claimed engine rows and most
   *  legacy callers omit it — absence means "due now". */
  nextRunAt?: Date | string | null
}

/** Job ids with a live poller in THIS process (resume detection). */
const activePollers = new Set<string>()

/**
 * ISSUES 1-2 REPAIR: engine-handler visibility into the in-process poller
 * registry. When a video job's claim finds a LIVE poller already executing
 * the job (inline/recovery attach won the race), the handler must report
 * noSettle instead of double-running or letting the runner clobber the row
 * (measured: an empty-artifact finishCompleted landed on a live render).
 */
export function isVideoPollerActive(jobId: string): boolean {
  return activePollers.has(jobId)
}
/** Job ids for which the owner requested cancellation (stop-tracking). */
const cancelRequested = new Set<string>()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- ISSUES 1-2 REPAIR (2026-11-08): throttle-resilient submission --------
//
// MEASURED ROOT CAUSE (issue 1): the platform video gateway enforces
// account-wide 429 throttle WINDOWS that last minutes (20 of 24 historical
// jobs failed RATE_LIMITED across 02:21-07:02Z while two 5s jobs completed
// between windows — 5s AND 10s requests throttle alike, so duration/size/
// quality selection is NOT the trigger). The PREVIOUS worker treated a
// submission-time 429 as a terminal job failure — a provider refusal was
// destroying a job BEAN had already accepted. The repair:
//   - a throttled submission parks the job in RETRY_WAIT with a bounded,
//    breaker-aligned backoff (Retry-After honored when a provider sends
//    one — measured: the current gateway sends none);
//   - the retry budget is persisted in resultJson (survives restarts) and
//    is capped BOTH ways: real submission attempts AND cumulative wait;
//   - a breaker skip (cooldown open, zero network I/O) is never counted as
//    an attempt — it only extends the scheduled wait.

/** Max REAL submission attempts per video job (across restarts). */
export const VIDEO_MAX_SUBMIT_ATTEMPTS = 5
/** Max cumulative time a job may spend parked in throttle retry_wait. */
export const VIDEO_MAX_CUMULATIVE_THROTTLE_MS = 30 * 60_000
/** Backoff floor after a real submission 429 (matches the breaker base). */
export const VIDEO_SUBMIT_BACKOFF_FLOOR_MS = 60_000
/** Backoff cap — never probe a minutes-long throttle window faster than this. */
export const VIDEO_SUBMIT_BACKOFF_MAX_MS = 600_000

/**
 * Bounded, throttle-aware backoff for the next submission attempt.
 * Priority: an actual provider Retry-After (clamped 5s..10min) → the video
 * breaker's remaining window (never submit into an open cooldown) → BEAN's
 * escalating schedule 60s·2^(n-1). Everything is capped at 10 minutes.
 */
export function videoSubmitBackoffMs(
  attempt: number,
  breakerRemainingMs: number,
  retryAfterMs: number | null,
): number {
  if (retryAfterMs !== null) {
    return Math.min(Math.max(Math.round(retryAfterMs), 5_000), VIDEO_SUBMIT_BACKOFF_MAX_MS)
  }
  const escalated = VIDEO_SUBMIT_BACKOFF_FLOOR_MS * 2 ** Math.max(0, Math.min(Math.max(1, attempt), 6) - 1)
  return Math.min(Math.max(breakerRemainingMs, escalated), VIDEO_SUBMIT_BACKOFF_MAX_MS)
}

/** True when the error is an upstream throttle (real 429 or breaker skip). */
function isSubmissionThrottle(e: unknown): boolean {
  return e instanceof UpstreamRateLimitError || classifyUpstreamError(e).kind === 'rate_limited'
}

/** Retry-After hint in ms when a provider ever surfaces one (else null). */
function retryAfterMsOf(e: unknown): number | null {
  const raw = (e as { retryAfterMs?: unknown } | null)?.retryAfterMs
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null
}

/**
 * Engine-pool probe (injected by jobs/queue.ts, which already imports the
 * runner — kept injectable so this module never participates in the
 * runner→handlers→video-worker import cycle). Default "no pools": the
 * legacy inline/poller execution shape.
 */
let poolsActiveProbe: () => boolean = () => false
export function setVideoPoolsActiveProbe(fn: () => boolean): void {
  poolsActiveProbe = fn
}

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
    // ISSUES 1-2 REPAIR (2026-11-08): the submit-vs-resume decision is keyed
    // on the PERSISTED provider task id, never on the row status. Engine
    // re-claims and poller re-attaches both present the row as 'queued';
    // keying on status either re-submitted a task the provider had already
    // accepted (a duplicate generation) or threw "resumed video job has no
    // persisted provider task id" (measured: job cmw60bf4 failed exactly
    // that way when the jobs-list poller raced an engine claim).
    if (result.providerTaskId) {
      // Resume path: the provider task id is the single source of truth; the
      // submission already happened and is NEVER repeated.
      logger.info('jazmii.job_resumed', { jobId: job.id })
    } else {
      // Inline / re-attach paths honor a scheduled retry_wait (the engine
      // claim path is already scheduled by claimNextJob — claimed rows carry
      // no nextRunAt).
      await waitForDue(job, job.id)
      if (cancelRequested.has(job.id)) {
        await markCancelled(job.id)
        return
      }
      await updateJob(job.id, { status: 'running', startedAt, progress: 5 })
      // REAL submission — upstream-class failures propagate to the honest
      // failure path; a THROTTLE parks the job for a bounded retry instead
      // of destroying an accepted job (issues 1-2 repair).
      try {
        const handle = await submitVideoJob({
          prompt: params.prompt,
          ...(params.imageUrl ? { imageUrl: params.imageUrl } : {}),
          ...(params.quality ? { quality: params.quality } : {}),
          ...(params.withAudio !== undefined ? { withAudio: params.withAudio } : {}),
          ...(params.size ? { size: params.size } : {}),
          ...(params.durationSec ? { durationSec: params.durationSec } : {}),
          ...(params.fps ? { fps: params.fps } : {}),
        })
        result = {
          ...result,
          providerTaskId: handle.taskId,
          providerStatus: handle.providerStatus,
          // The successful submission was ALSO a real attempt — the counter
          // always equals the total real submissions made for this job.
          submissionAttempts: (result.submissionAttempts ?? 0) + 1,
          // A pending throttle frame is no longer pending; the attempt
          // history (submissionAttempts/throttleWaitMs) is kept as evidence.
          throttle: undefined,
        }
        await updateJob(job.id, {
          progress: 10,
          backendId: backend.id,
          resultJson: JSON.stringify(result),
          // Clear the stale throttle verdict from the retry_wait parking —
          // the submission went through.
          errorClass: 'none',
          errorCode: null,
          errorMessage: null,
        })
        logger.info('jazmii.job_submitted', { jobId: job.id })
      } catch (e) {
        if (isSubmissionThrottle(e)) {
          await settleThrottledSubmission(job, result, e, backend.id, params, startedAt)
          return
        }
        throw e
      }
    }

    const taskId = result.providerTaskId!
    const deadline = Date.now() + MAX_POLL_MS
    let progress = 12
    let videoUrl: string | null = null
    // FINAL FIX (2026-11-07) — tracking resilience (the "remaining job
    // tracking 429"). Measured: the async-result query endpoint is throttled
    // by the same account-wide 429 windows as every other endpoint class,
    // and the PREVIOUS loop treated one throttled poll as a job failure —
    // an APPLICATION DEFECT on top of the provider throttle: a job the
    // provider had ACCEPTED was marked failed (and product health evidence
    // poisoned) because a STATUS POLL was refused. Now: transient upstream
    // failures on a poll back off (bounded doubling 5s→60s, hard deadline
    // unchanged) and tracking continues; the failure streak is recorded in
    // the job result for honest UI display and reset by the next good poll.
    // Only the hard deadline, a provider FAIL verdict, an owner cancellation
    // or an unretryable auth/billing rejection end the job.
    let pollIntervalMs = POLL_INTERVAL_MS
    let consecutiveTrackingFailures = 0
    let lastTrackingFailure: { kind: string; at: string } | null = null

    while (Date.now() < deadline) {
      if (cancelRequested.has(job.id)) {
        await markCancelled(job.id)
        return
      }
      await sleep(pollIntervalMs)
      if (cancelRequested.has(job.id)) {
        await markCancelled(job.id)
        return
      }
      let status
      try {
        status = await queryVideoJob(taskId)
      } catch (e) {
        const failure = classifyUpstreamError(e)
        // Unretryable account/configuration rejections: honest immediate
        // failure (retrying cannot fix credentials or billing).
        if (failure.kind === 'auth' || failure.kind === 'billing') throw e
        consecutiveTrackingFailures += 1
        lastTrackingFailure = { kind: failure.kind, at: new Date().toISOString() }
        pollIntervalMs = Math.min(pollIntervalMs * 2, 60_000)
        logger.warn('jazmii.job_tracking_retry', {
          jobId: job.id,
          kind: failure.kind,
          consecutive: consecutiveTrackingFailures,
          backoffMs: pollIntervalMs,
        })
        result = {
          ...result,
          trackingRetry: { consecutive: consecutiveTrackingFailures, kind: failure.kind, at: lastTrackingFailure.at },
        }
        await updateJob(job.id, { resultJson: JSON.stringify(result) }).catch(() => undefined)
        continue
      }
      // A good poll resets the backoff and the failure streak.
      pollIntervalMs = POLL_INTERVAL_MS
      consecutiveTrackingFailures = 0
      lastTrackingFailure = null
      result = { ...result, providerStatus: status.state, trackingRetry: undefined }
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
      // never a fabricated completion. When tracking was throttled, the
      // message says exactly that (provider throttling, not app death).
      await failJob(
        job,
        backend.id,
        'BACKEND_TIMEOUT',
        lastTrackingFailure
          ? `Video tracking exceeded its time limit — the provider's status endpoint kept failing (${lastTrackingFailure.kind}, last at ${lastTrackingFailure.at}) before reporting completion. No video was produced.`
          : 'Video tracking exceeded its time limit before the provider reported completion. No video was produced.',
      )
      return
    }

    await updateJob(job.id, { progress: 95 })
    // ISSUES 1-2 REPAIR: the download is ALSO a provider request — if the
    // account-wide throttle window swallows it, the provider still holds the
    // finished task and destroying the job would discard a real result.
    // Bounded retry (3 attempts, 5s/15s) for throttle-class failures only;
    // every other download error propagates to the honest failure path.
    let dl: Awaited<ReturnType<typeof downloadVideo>> | null = null
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        dl = await downloadVideo(videoUrl)
        break
      } catch (e) {
        if (attempt === 3 || classifyUpstreamError(e).kind !== 'rate_limited') throw e
        logger.warn('jazmii.job_download_throttled', { jobId: job.id, attempt, retryInMs: DOWNLOAD_RETRY_BASE_MS * attempt })
        await sleep(DOWNLOAD_RETRY_BASE_MS * attempt)
        if (cancelRequested.has(job.id)) {
          await markCancelled(job.id)
          return
        }
      }
    }
    if (!dl) throw new Error('video download failed') // unreachable; keeps TS narrowing honest
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
 * Honor a scheduled retry_wait on the inline/re-attach paths: sleep until
 * the row's nextRunAt (interruptible by cancellation, re-reading the clock
 * so a changed schedule is respected). A no-op when the row carries no
 * schedule or it is already due.
 */
const DUE_CHECK_MS = 15_000
async function waitForDue(job: JobRow, jobId: string): Promise<void> {
  const dueMs = job.nextRunAt ? new Date(job.nextRunAt).getTime() : 0
  let remaining = dueMs - Date.now()
  if (remaining <= 0) return
  logger.info('jazmii.job_waiting_for_retry_window', { jobId, dueInMs: remaining })
  while (remaining > 0) {
    if (cancelRequested.has(jobId)) return
    await sleep(Math.min(remaining, DUE_CHECK_MS))
    remaining = dueMs - Date.now()
  }
}

/**
 * ISSUES 1-2 REPAIR: a submission refused with HTTP 429 (or skipped by the
 * open video breaker) must NOT destroy an accepted job. Park the job in
 * RETRY_WAIT with a bounded, breaker-aligned backoff:
 *  - a REAL provider 429 consumes one submission attempt (budget of
 *    VIDEO_MAX_SUBMIT_ATTEMPTS, persisted in resultJson so restarts cannot
 *    reset it) and re-schedules after videoSubmitBackoffMs();
 *  - a breaker SKIP made no network request — it counts no attempt and only
 *    extends the scheduled wait (cumulative-wait budget still bounds it);
 *  - either budget exhausted → honest terminal RATE_LIMITED failure that
 *    states exactly what happened and what is missing (one authorized video
 *    provider whose account-wide throttle window never opened).
 * Duplicate-submission safety: with no provider task id, no upstream
 * generation exists — resubmitting the SAME job payload later is the FIRST
 * accepted submission, never a duplicate.
 */
async function settleThrottledSubmission(
  job: JobRow,
  result: VideoJobResult,
  e: unknown,
  backendId: string,
  params: VideoJobParams,
  startedAt: Date,
): Promise<void> {
  const attempted = !(e instanceof UpstreamRateLimitError && !e.attempted)
  // Product-health evidence: a real 429 is genuine upstream evidence; a
  // breaker skip is an application-side deferral (no request left the host).
  noteVideoAttempt(params, {
    at: new Date().toISOString(),
    ok: false,
    backendId,
    failureCategory: 'rate-limited',
    httpStatus: attempted ? 429 : null,
    upstream: attempted,
  })
  const prevAttempts = result.submissionAttempts ?? 0
  const attempt = attempted ? prevAttempts + 1 : prevAttempts
  const breakerRemainingMs = upstreamCooldownRemainingMs('video')
  const retryAfterMs = retryAfterMsOf(e)
  const backoffMs = videoSubmitBackoffMs(Math.max(1, attempt), breakerRemainingMs, retryAfterMs)
  const cumulativeWaitMs = (result.throttleWaitMs ?? 0) + backoffMs
  const exhausted =
    (attempted && attempt >= VIDEO_MAX_SUBMIT_ATTEMPTS) ||
    cumulativeWaitMs > VIDEO_MAX_CUMULATIVE_THROTTLE_MS
  const throttle = {
    attempt: Math.max(1, attempt),
    backoffMs,
    retryAfterMs,
    attempted,
    at: new Date().toISOString(),
  }
  if (exhausted) {
    const message =
      `The video provider kept throttling submissions (HTTP 429): ${Math.max(1, attempt)} authorized submission ` +
      `attempt(s) over ~${Math.round(cumulativeWaitMs / 60_000)} minutes all landed inside the same account-wide ` +
      `throttle window, so no generation was ever accepted and no video was produced. The job was not deleted — ` +
      `every attempt is recorded here. BEAN has exactly one authorized video provider (the platform gateway ` +
      `account); a submission can succeed only once its throttle window closes, so a resubmitted job is the way to try again.`
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      backendId,
      errorClass: 'rate_limited',
      errorCode: 'RATE_LIMITED',
      errorMessage: message,
      resultJson: JSON.stringify({ ...result, submissionAttempts: attempt, throttleWaitMs: cumulativeWaitMs, throttle }),
    })
    await recordUsage({
      userId: job.userId,
      product: 'jazmii',
      backendId,
      kind: 'video-generation',
      success: false,
      errorCode: 'RATE_LIMITED',
      durationMs: Date.now() - startedAt.getTime(),
    })
    logger.warn('jazmii.job_submission_throttle_exhausted', {
      jobId: job.id,
      attempt,
      cumulativeWaitMs,
    })
    return
  }
  const message = attempted
    ? `The video provider is throttling new submissions (HTTP 429). The job stays queued — submission attempt ` +
      `${attempt + 1} of ${VIDEO_MAX_SUBMIT_ATTEMPTS} starts automatically in ~${Math.round(backoffMs / 1000)}s. ` +
      `Nothing was lost; no duplicate was created.`
    : `The video gateway is inside its 429 cooldown window, so no new submission was attempted (submitting into ` +
      `an open throttle only deepens it). The job stays queued and will submit when the window clears ` +
      `(~${Math.round(backoffMs / 1000)}s).`
  await updateJob(job.id, {
    status: 'retry_wait',
    nextRunAt: new Date(Date.now() + backoffMs),
    backendId,
    errorClass: 'rate_limited',
    errorCode: 'RATE_LIMITED',
    errorMessage: message,
    resultJson: JSON.stringify({ ...result, submissionAttempts: attempt, throttleWaitMs: cumulativeWaitMs, throttle }),
  })
  await appendJobEventSafe(job.id, 'notice', {
    submission_throttled: true,
    attempt: Math.max(1, attempt),
    backoffMs,
    retryAfterMs,
    attempted,
  })
  logger.warn('jazmii.job_submission_throttled', {
    jobId: job.id,
    attempt: Math.max(1, attempt),
    backoffMs,
    attempted,
  })
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
  await failJob(job, backendId, code, display, failure.kind)
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

async function failJob(
  job: JobRow,
  backendId: string,
  code: string,
  display: string,
  errorClass?: string,
): Promise<void> {
  await updateJob(job.id, {
    status: 'failed',
    finishedAt: new Date(),
    backendId,
    errorCode: code,
    errorMessage: display,
    ...(errorClass ? { errorClass } : {}),
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
 *
 * ISSUES 1-2 REPAIR (2026-11-08): with engine pools running, QUEUED and
 * RETRY_WAIT jobs belong to the pool's claim protocol (CAS + lease +
 * nextRunAt schedule). Attaching an execution poller here raced engine
 * claims — measured: a queued job was executed by BOTH paths and the loser
 * failed it with "resumed video job has no persisted provider task id"
 * (job cmw60bf4) — and it bypassed the throttle retry schedule. When no
 * pool runs (inline deployments/tests), this path remains the executor.
 * Running/streaming/finalizing rows (orphaned pollers after a reload) are
 * still re-attached in both shapes.
 */
export function ensureVideoPoller(job: {
  id: string
  userId: string
  product: string
  task: string
  status: string
  paramsJson: string
  resultJson: string | null
  nextRunAt?: Date | string | null
}): void {
  if (job.product !== 'jazmii' || job.task !== 'video-generation') return
  // Engine states: finalizing/streaming/starting are running; retry_wait is queued.
  const queuedOrRunning = ['queued', 'running', 'starting', 'streaming', 'finalizing', 'retry_wait'].includes(job.status)
  if (!queuedOrRunning) return
  if (activePollers.has(job.id)) return
  if (cancelRequested.has(job.id)) return
  if (poolsActiveProbe() && (job.status === 'queued' || job.status === 'retry_wait')) return
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
  const queuedOrRunning = ['queued', 'running', 'starting', 'streaming', 'finalizing', 'retry_wait'].includes(job.status)
  if (!queuedOrRunning) return false
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
