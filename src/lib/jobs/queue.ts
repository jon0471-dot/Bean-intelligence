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
import { claimNextJob, finishFailed, heartbeatJob } from '@/lib/ai-engine/queue'
import { engineHandlers } from '@/lib/ai-engine/handlers'
import { kickProduct, poolsRunning } from '@/lib/ai-engine/runner'
import { logger } from '@/lib/observability/logger'

const ENGINE_KIND = 'embedded'

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
    // Wake every product pool: the first idle slot to claim wins; the other
    // wakes find an empty queue and sleep again (four cheap queries).
    for (const p of ['riishe', 'laxii', 'jazmii', 'code-giftz']) kickProduct(p)
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
      await finishFailed(jobId, '__kick__', {
        errorClass: 'unknown',
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'The job could not be processed.',
      }).catch(() => undefined)
    }
  })()
}

export { recoverStaleJobs } from '@/lib/ai-engine/queue'
