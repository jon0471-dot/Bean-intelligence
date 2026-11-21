/**
 * BEAN Intelligence — asynchronous job queue → BACKGROUND AI ENGINE bridge.
 *
 * Since the background execution engine (2026-11-07) this module is a thin
 * compatibility layer. The product routes' `enqueueJob` call keeps its name
 * and signature (submit → job id immediately), but execution now happens
 * ONLY in worker-pool task contexts:
 *
 *  - when pools are running (embedded by default, standalone optionally),
 *    `enqueueJob` simply WAKES them — they claim the job through the same
 *    durable CAS protocol and execute in their long-lived contexts.
 *    (Measured 2026-11-07: executing inside the HTTP request's task context
 *    can freeze mid-settle when Next.js tears the request down; pool
 *    contexts never exhibited that stall.)
 *  - when NO pool runs (BEAN_ENGINE_EMBEDDED=0 and no standalone worker),
 *    the call falls back to inline execution so tests and minimal
 *    deployments still process jobs.
 *
 * Jobs persist in GenerationJob rows; running work survives application
 * restarts via lease expiry + recovery (see src/lib/ai-engine).
 */
import { db } from '@/lib/db'
import { claimNextJob, finishFailed, heartbeatJob } from '@/lib/ai-engine/queue'
import { engineHandlers } from '@/lib/ai-engine/handlers'
import { kickProduct, poolsRunning } from '@/lib/ai-engine/runner'
import { setVideoPoolsActiveProbe } from '@/lib/jobs/video-worker'
import { logger } from '@/lib/observability/logger'
import { appendJobEventSafe } from '@/lib/ai-engine/events'

const ENGINE_KIND = 'embedded'

// ISSUES 1-2 REPAIR (2026-11-08): teach the video worker whether engine
// pools are active so its poller re-attach path never executes queued /
// retry_wait jobs outside the claim protocol. Wired here because this
// module already imports the runner; the worker itself stays out of the
// runner→handlers→video-worker import cycle.
setVideoPoolsActiveProbe(poolsRunning)

/** Execute one claimed job inline (fallback for pool-less deployments). */
async function executeInline(jobId: string): Promise<void> {
  const claimed = await claimNextJob({
    jobId,
    workerId: `wk_kick_${process.pid.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    workerKind: ENGINE_KIND,
  })
  if (!claimed) return // cancelled/rejected/claimed elsewhere while queued
  const handler = engineHandlers[claimed.task]
  if (!handler) {
    await finishFailed(claimed.id, claimed.workerId, {
      errorClass: 'permanent',
      errorCode: 'NO_BACKEND',
      errorMessage: 'No worker is available for this task type.',
    })
    return
  }
  const heartbeat = setInterval(() => {
    void heartbeatJob(claimed.id, claimed.workerId)
  }, 30_000)
  try {
    await handler(claimed, { signal: { aborted: false } })
  } finally {
    clearInterval(heartbeat)
  }
}

/** Hand a freshly persisted job to the engine (pool wake; inline fallback). */
export function enqueueJob(jobId: string): void {
  if (poolsRunning()) {
    // M26 (audit F-G1): a task with NO wired handler can never be claimed by
    // any pool — GANGZII's speech-synthesis/audio-transcription/audio-conversion
    // jobs (no pool, no handler) previously stayed `queued` FOREVER. Settle
    // such jobs honestly (NO_BACKEND) instead of parking them indefinitely.
    // The settle is awaited inside the fire-and-forget envelope so callers
    // keep their existing sync contract.
    void (async () => {
      try {
        const job = await db.generationJob.findUnique({
          where: { id: jobId },
          select: { task: true, status: true },
        })
        if (job && !engineHandlers[job.task] && ['queued', 'starting', 'retry_wait'].includes(job.status)) {
          // Settle directly: finishFailed's terminal write matches only
          // ACTIVE/claimed statuses, and a queued row with no handler is
          // exactly the case that must be ended honestly.
          await db.generationJob.updateMany({
            where: { id: jobId, status: { in: ['queued', 'starting', 'retry_wait'] } },
            data: {
              status: 'failed',
              errorClass: 'permanent',
              errorCode: 'NO_BACKEND',
              errorMessage: 'No worker is configured for this task type in this deployment.',
              finishedAt: new Date(),
              leaseUntil: null,
            },
          })
          await appendJobEventSafe(jobId, 'error', {
            code: 'NO_BACKEND',
            message: 'No worker is configured for this task type in this deployment.',
            errorClass: 'permanent',
          })
          logger.warn('jobs.no_handler_settled', { jobId, task: job.task })
          return
        }
      } catch (e) {
        logger.warn('jobs.no_handler_check_failed', {
          jobId,
          message: e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
        })
      }
      // Wake every product pool: the first idle slot to claim wins; the other
      // wakes find an empty queue and sleep again (four cheap queries).
      for (const p of ['riishe', 'laxii', 'jazmii', 'code-giftz']) kickProduct(p)
    })()
    return
  }
  void (async () => {
    try {
      await executeInline(jobId)
    } catch (e) {
      logger.error('jobs.enqueue_failed', {
        jobId,
        message: e instanceof Error ? e.message : String(e),
      })
      // M26 (audit F-9): the previous '__kick__' id NEVER matched the
      // finishFailed ownership guard (only the claim owner or '__recovery__'
      // may settle) — the failure path was a silent no-op and the row stayed
      // stuck. The recovery-privileged id settles it for real.
      await finishFailed(jobId, '__recovery__', {
        errorClass: 'unknown',
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'The job could not be processed.',
      }).catch(() => undefined)
    }
  })()
}

export { recoverStaleJobs } from '@/lib/ai-engine/queue'
