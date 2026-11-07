/**
 * BEAN Intelligence — durable job queue on the application database.
 *
 * Why not Redis + BullMQ (evaluated per the engine brief): the deployment
 * runtime has no Redis service and BEAN must not purchase infrastructure;
 * BullMQ additionally requires a persistent Redis connection from every
 * worker. The existing database IS the existing infrastructure — SQLite
 * transactions give exactly-once claims via conditional updates (CAS), and
 * jobs survive application restarts because the queue state is durable
 * rows, not process memory. The engine's lease/takeover protocol provides
 * what BullMQ's stalled-job checker provides: a crashed worker's claims
 * expire and another worker resumes or honestly fails the job.
 *
 * Claim protocol (crash-safe):
 *  1. A worker CAS-claims a claimable row (queued / retry_wait due):
 *     status → starting, workerId + leaseUntil + attempts stamped.
 *     updateMany's WHERE guard makes concurrent claims exactly-once.
 *  2. The worker heartbeats (lease extended) while its handler runs.
 *  3. If the worker dies, the lease expires; recovery re-queues the job
 *     (RETRY_WAIT) up to maxAttempts, then fails it honestly (WORKER_LOST).
 *
 * 429 protocol: rate_limited failures are NEVER retried — a throttled
 * account is not hammered; the job fails with its honest class.
 *
 * SERVER-ONLY.
 */

import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { engineConfig } from './config'
import { appendJobEventSafe } from './events'
import {
  ACTIVE_STATES,
  CLAIMABLE_STATES,
  type ClaimedJob,
  type HandlerOutcome,
  type JobErrorClass,
  RETRYABLE_CLASSES,
} from './types'

export interface QueueJobRow {
  id: string
  userId: string
  product: string
  task: string
  status: string
  progress: number
  paramsJson: string
  resultJson: string | null
  errorCode: string | null
  errorMessage: string | null
  backendId: string | null
  capability: string | null
  workerId: string | null
  workerKind: string | null
  leaseUntil: Date | null
  heartbeatAt: Date | null
  attempts: number
  maxAttempts: number
  nextRunAt: Date | null
  errorClass: string | null
  dedupeKey: string | null
  cancelRequested: boolean
  queuedAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

/** Stable duplicate-submission key for a submission payload. */
export function dedupeKeyFor(
  userId: string,
  product: string,
  task: string,
  params: unknown,
): string {
  const hash = createHash('sha256').update(JSON.stringify(params ?? null)).digest('hex').slice(0, 32)
  return `${userId}:${product}:${task}:${hash}`
}

/**
 * True when the same user already has an ACTIVE job with this dedupe key —
 * used to prevent duplicate submissions (double-click, retry storms).
 */
export async function hasActiveDuplicate(dedupeKey: string): Promise<boolean> {
  if (!dedupeKey) return false
  const found = await db.generationJob.findFirst({
    where: { dedupeKey, status: { in: [...ACTIVE_STATES] } },
    select: { id: true },
  })
  return found !== null
}

function toClaimed(row: QueueJobRow, workerId: string, workerKind: string): ClaimedJob {
  return {
    id: row.id,
    userId: row.userId,
    productId: row.product as ClaimedJob['productId'],
    product: row.product,
    task: row.task as ClaimedJob['task'],
    capability: row.capability,
    status: 'starting',
    progress: row.progress,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    paramsJson: row.paramsJson,
    resultJson: row.resultJson,
    cancelRequested: row.cancelRequested,
    workerId,
    workerKind: workerKind === 'standalone' ? 'standalone' : 'embedded',
  }
}

export interface ClaimOptions {
  workerId: string
  workerKind: 'embedded' | 'standalone'
  /** Restrict the claim to one product (a product's worker pool). */
  product?: string
  /** Claim THIS job specifically (kick-after-submit path). */
  jobId?: string
}

const CLAIMABLE = [...CLAIMABLE_STATES]

/**
 * Claim the next runnable job. Returns null when the queue is empty.
 * The CAS (updateMany with the exact preconditions) makes this exactly-once
 * even with embedded + standalone workers racing on the same row.
 */
export async function claimNextJob(opts: ClaimOptions): Promise<ClaimedJob | null> {
  const now = new Date()
  const candidate = await db.generationJob.findFirst({
    where: {
      status: { in: CLAIMABLE },
      ...(opts.product ? { product: opts.product } : {}),
      ...(opts.jobId ? { id: opts.jobId } : {}),
      OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
    },
    orderBy: { queuedAt: 'asc' },
  })
  if (!candidate) return null
  if (candidate.cancelRequested) {
    // Cancel was requested while queued — settle it instead of running.
    const cancelled = await db.generationJob.updateMany({
      where: { id: candidate.id, status: candidate.status, cancelRequested: true },
      data: {
        status: 'cancelled',
        finishedAt: new Date(),
        errorClass: 'cancelled',
        errorCode: 'CANCELLED',
        errorMessage: 'Cancelled before processing started.',
      },
    })
    if (cancelled.count > 0) {
      await appendJobEventSafe(candidate.id, 'notice', { cancelled: 'before_start' })
      return claimNextJob(opts) // look for the next job
    }
    return null
  }

  const leaseUntil = new Date(now.getTime() + engineConfig().leaseMs)
  const won = await db.generationJob.updateMany({
    where: {
      id: candidate.id,
      status: candidate.status,
      attempts: candidate.attempts, // CAS: nobody else moved this row
      workerId: candidate.workerId ?? null,
    },
    data: {
      status: 'starting',
      workerId: opts.workerId,
      workerKind: opts.workerKind,
      leaseUntil,
      heartbeatAt: now,
      attempts: candidate.attempts + 1,
      startedAt: candidate.startedAt ?? now,
      errorClass: null,
    },
  })
  if (won.count !== 1) return null // another worker won the race
  return toClaimed(candidate as QueueJobRow, opts.workerId, opts.workerKind)
}

/** Extend the lease of a job this worker owns. No-op when ownership changed. */
export async function heartbeatJob(jobId: string, workerId: string): Promise<void> {
  const leaseUntil = new Date(Date.now() + engineConfig().leaseMs)
  await db.generationJob
    .updateMany({
      where: { id: jobId, workerId, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } },
      data: { leaseUntil, heartbeatAt: new Date() },
    })
    .catch(() => undefined)
}

/**
 * Re-read the cancel flag between checkpoints (cheap single-column read).
 * Handlers call this at natural boundaries and unwind honestly when set.
 */
export async function isCancelRequested(jobId: string): Promise<boolean> {
  const row = await db.generationJob.findUnique({
    where: { id: jobId },
    select: { cancelRequested: true, status: true },
  })
  if (!row) return true
  if (row.cancelRequested && row.status === 'queued') return true
  return row.cancelRequested
}

/** Transition a claimed job between active states (handler-owned). */
export async function transitionJob(
  jobId: string,
  workerId: string,
  to: 'running' | 'streaming' | 'finalizing',
  extra?: { progress?: number; backendId?: string },
): Promise<boolean> {
  const res = await db.generationJob.updateMany({
    where: { id: jobId, workerId, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } },
    data: {
      status: to,
      ...(extra?.progress !== undefined ? { progress: Math.max(0, Math.min(100, extra.progress)) } : {}),
      ...(extra?.backendId ? { backendId: extra.backendId } : {}),
      leaseUntil: new Date(Date.now() + engineConfig().leaseMs),
      heartbeatAt: new Date(),
    },
  })
  return res.count === 1
}

export async function finishCompleted(
  jobId: string,
  workerId: string,
  result: Record<string, unknown>,
): Promise<boolean> {
  const res = await db.generationJob
    .updateMany({
      where: { id: jobId, workerId, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } },
      data: {
        status: 'completed',
        progress: 100,
        resultJson: JSON.stringify(result),
        errorClass: 'none',
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
        leaseUntil: null,
        heartbeatAt: new Date(),
      },
    })
    .catch(() => null)
  return res !== null && res.count === 1
}

export interface FailureInput {
  errorClass: JobErrorClass
  errorCode: string
  errorMessage: string // customer-safe
}

/**
 * Record an honest failure. Transient classes (crash/network/timeout) get a
 * bounded RETRY_WAIT up to maxAttempts; rate_limited/auth/billing/permanent
 * fail terminally — a throttled account is never re-hit automatically.
 */
export async function finishFailed(
  jobId: string,
  workerId: string,
  failure: FailureInput,
): Promise<{ terminal: boolean; retryWait: boolean }> {
  const job = await db.generationJob.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true, workerId: true, status: true },
  })
  if (!job || (job.workerId !== workerId && workerId !== '__recovery__')) {
    return { terminal: false, retryWait: false }
  }
  const retryable = RETRYABLE_CLASSES.has(failure.errorClass) && job.attempts < job.maxAttempts
  if (retryable) {
    const backoff = engineConfig().retryBackoffMs[
      Math.min(job.attempts - 1, engineConfig().retryBackoffMs.length - 1)
    ]
    const nextRunAt = new Date(Date.now() + backoff)
    await db.generationJob.updateMany({
      where: { id: jobId, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } },
      data: {
        status: 'retry_wait',
        nextRunAt,
        errorClass: failure.errorClass,
        errorCode: failure.errorCode,
        errorMessage: failure.errorMessage,
        workerId: null,
        workerKind: null,
        leaseUntil: null,
      },
    })
    await appendJobEventSafe(jobId, 'notice', {
      retry_wait: true,
      attempt: job.attempts,
      nextAttemptMs: backoff,
      reason: failure.errorMessage,
    })
    return { terminal: false, retryWait: true }
  }
  await db.generationJob.updateMany({
    where: { id: jobId, status: { in: ['starting', 'running', 'streaming', 'finalizing', 'retry_wait'] } },
    data: {
      status: 'failed',
      errorClass: failure.errorClass,
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
      finishedAt: new Date(),
      leaseUntil: null,
    },
  })
  await appendJobEventSafe(jobId, 'error', {
    code: failure.errorCode,
    message: failure.errorMessage,
    errorClass: failure.errorClass,
  })
  return { terminal: true, retryWait: false }
}

/**
 * Cancel: queued/retry_wait jobs are settled immediately; running jobs get
 * the cooperative flag (their handler unwinds at the next checkpoint).
 * Ownership is enforced by the caller (route checks userId).
 */
export async function requestCancel(jobId: string, userId: string): Promise<'cancelled' | 'signalled' | 'not_found'> {
  const job = await db.generationJob.findUnique({ where: { id: jobId } })
  if (!job || job.userId !== userId) return 'not_found'
  if (['completed', 'failed', 'cancelled', 'rejected', 'unsupported'].includes(job.status)) {
    return 'not_found' // already terminal — nothing to cancel
  }
  if (job.status === 'queued' || job.status === 'retry_wait') {
    // CAS so a claim racing the cancel cannot resurrect the job.
    const res = await db.generationJob.updateMany({
      where: { id: jobId, status: job.status, cancelRequested: false },
      data: {
        cancelRequested: true,
        status: 'cancelled',
        errorClass: 'cancelled',
        errorCode: 'CANCELLED',
        errorMessage: 'Cancelled before processing started.',
        finishedAt: new Date(),
      },
    })
    if (res.count === 1) {
      await appendJobEventSafe(jobId, 'notice', { cancelled: 'before_start' })
      return 'cancelled'
    }
    // Lost the race — the job was just claimed; fall through to signal.
  }
  await db.generationJob.updateMany({
    where: { id: jobId, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } },
    data: { cancelRequested: true },
  })
  await appendJobEventSafe(jobId, 'notice', { cancel_requested: true })
  return 'signalled'
}

/**
 * Recovery sweep: take over jobs whose worker died (lease expired while
 * active) and settle cancel-flagged queued jobs. Called on worker startup
 * and periodically by the embedded engine.
 */
export async function recoverStaleJobs(): Promise<{ requeued: number; failed: number; cancelled: number }> {
  const now = new Date()
  let requeued = 0
  let failed = 0
  let cancelled = 0

  const stale = await db.generationJob.findMany({
    where: {
      status: { in: ['starting', 'running', 'streaming', 'finalizing'] },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    select: { id: true, attempts: true, maxAttempts: true, workerId: true },
    take: 100,
  })
  for (const job of stale) {
    if (job.attempts < job.maxAttempts) {
      const res = await db.generationJob.updateMany({
        where: { id: job.id, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } },
        data: {
          status: 'retry_wait',
          nextRunAt: new Date(Date.now() + 5_000),
          errorClass: 'worker_lost',
          errorCode: 'WORKER_LOST',
          errorMessage: 'The worker executing this job stopped responding; the job will resume automatically.',
          workerId: null,
          workerKind: null,
          leaseUntil: null,
        },
      })
      if (res.count === 1) {
        requeued += 1
        await appendJobEventSafe(job.id, 'notice', {
          recovered: true,
          reason: 'worker_lease_expired',
          attempt: job.attempts,
        })
      }
    } else {
      const outcome = await finishFailed(
        job.id,
        '__recovery__',
        {
          errorClass: 'worker_lost',
          errorCode: 'WORKER_LOST',
          errorMessage:
            'The worker executing this job stopped responding and the retry budget was exhausted.',
        },
      )
      if (outcome.terminal) failed += 1
    }
  }

  // Queued jobs with a cancel request that no worker has settled yet.
  const settle = await db.generationJob.updateMany({
    where: { status: 'queued', cancelRequested: true },
    data: {
      status: 'cancelled',
      errorClass: 'cancelled',
      errorCode: 'CANCELLED',
      errorMessage: 'Cancelled before processing started.',
      finishedAt: now,
    },
  })
  cancelled = settle.count
  if (requeued + failed + cancelled > 0) {
    logger.info('engine.recovery', { requeued, failed, cancelled })
  }
  return { requeued, failed, cancelled }
}
