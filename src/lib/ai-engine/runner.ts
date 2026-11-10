/**
 * BEAN Intelligence — worker pools + handler dispatch.
 *
 * Two execution shapes share one code path:
 *  - EMBEDDED: a small worker pool started inside the Next.js server via
 *    instrumentation — background execution works with zero ops setup.
 *  - STANDALONE: `scripts/ai-workers/worker.ts` processes (per product)
 *    for operators who want process isolation / a dedicated GPU host.
 *
 * Claims are CAS'd in the database, so embedded and standalone pools can
 * run simultaneously without double execution — first claim wins.
 *
 * SERVER-ONLY.
 */

import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { engineConfig, jitteredRetryBackoffMs } from './config'
import { appendJobEventSafe, pruneOldJobEvents } from './events'
import {
  claimNextJob,
  finishCompleted,
  finishFailed,
  heartbeatJob,
  recoverStaleJobs,
} from './queue'
import { isTerminal, type ClaimedJob, type HandlerOutcome, type WorkerHandler } from './types'
import { engineHandlers } from './handlers'
import type { BeanProductId } from '@/lib/registry/products'

const WORKER_EPOCH = Date.now().toString(36)

/**
 * Kick signals: submission paths wake a product's idle slots immediately so
 * a fresh job starts in the SAME millisecond without waiting for the poll
 * interval. Execution itself ALWAYS happens in the pool's own task context
 * (measured 2026-11-07: executing inside the HTTP request's task context can
 * freeze mid-settle when Next.js tears the request down — pool contexts are
 * long-lived and do not have that problem).
 */
const kickWaiters = new Map<string, Array<() => void>>()

export function kickProduct(product: string): void {
  const waiters = kickWaiters.get(product)
  if (!waiters || waiters.length === 0) return
  kickWaiters.set(product, [])
  for (const w of waiters) {
    try {
      w()
    } catch {
      /* waiter already gone */
    }
  }
}

function sleepInterruptible(ms: number, product: string): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      const list = kickWaiters.get(product)
      if (list) {
        const i = list.indexOf(done)
        if (i >= 0) list.splice(i, 1)
      }
      resolve()
    }
    const list = kickWaiters.get(product) ?? []
    list.push(done)
    kickWaiters.set(product, list)
  })
}

export function poolsRunning(): boolean {
  const registry = globalThis as unknown as { __bean_engine_pools__?: Map<string, PoolHandle> }
  return (registry.__bean_engine_pools__?.size ?? 0) > 0
}

function workerInstanceId(kind: 'embedded' | 'standalone', product: string): string {
  return `wk_${kind}_${product}_${process.pid.toString(36)}_${WORKER_EPOCH}_${randomUUID().slice(0, 8)}`
}

export interface PoolHandle {
  stop: () => Promise<void>
  product: BeanProductId
  workerId: string
}

interface PoolState {
  stopping: boolean
  idle: Set<ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>>
}

/**
 * Run ONE claimed job to a terminal state (or a bounded retry).
 *
 * Ownership model: the HANDLER owns its state transitions. The legacy image/
 * video processors set running→completed/failed themselves; the chat/coding
 * handlers use the engine's transition helpers. After the handler returns,
 * the runner settles any still-active row from the handler's outcome so an
 * unexpected throw can never leave a job running forever.
 */
async function executeClaimed(
  claimed: ClaimedJob,
  handler: WorkerHandler,
  poolKind: 'embedded' | 'standalone',
): Promise<void> {
  const t0 = Date.now()
  const signal = { aborted: false }
  const heartbeat = setInterval(() => {
    if (signal.aborted) return
    void heartbeatJob(claimed.id, claimed.workerId)
  }, engineConfig().heartbeatMs)
  try {
    const outcome = await withSettleTimeout(handler(claimed, { signal }), claimed.id)
    // Settle the row unless the handler already drove it to a terminal state.
    const row = await db.generationJob.findUnique({
      where: { id: claimed.id },
      select: { status: true },
    })
    if (!row || isTerminal(row.status)) return
    // The handler delegated the row to another live executor in this process
    // (e.g. the video poller registry already owns it) — settle NOTHING: a
    // blind finishCompleted here measured clobbering a live render's row
    // with an empty artifact (issues 1-2 repair, 2026-11-08).
    if (outcome.noSettle) return
    if (outcome.retry) {
      await settleRetry(claimed, outcome)
      return
    }
    if (outcome.result) {
      const done = await finishCompleted(claimed.id, claimed.workerId, outcome.result)
      if (done) {
        await appendJobEventSafe(claimed.id, 'artifact', { result: outcome.result })
      }
      return
    }
    await finishFailed(claimed.id, claimed.workerId, {
      errorClass: outcome.errorClass ?? 'unknown',
      errorCode: outcome.errorCode ?? 'BACKEND_FAILURE',
      errorMessage: outcome.errorMessage ?? 'The job could not be completed.',
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error('engine.handler_crash', {
      jobId: claimed.id,
      product: claimed.productId,
      task: claimed.task,
      workerKind: poolKind,
      message,
    })
    await finishFailed(claimed.id, claimed.workerId, {
      errorClass: 'unknown',
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'The job failed unexpectedly and can be retried.',
    }).catch(() => undefined)
  } finally {
    signal.aborted = true
    clearInterval(heartbeat)
    logger.info('engine.job_settled', {
      jobId: claimed.id,
      product: claimed.productId,
      task: claimed.task,
      attempt: claimed.attempts,
      durationMs: Date.now() - t0,
      workerKind: poolKind,
    })
  }
}

/**
 * Bound the handler + settle phase — LEASE-AWARE STALL WATCHDOG (issues 1-2
 * repair, measured 2026-11-08): the PREVIOUS implementation raced the handler
 * with a FIXED leaseMs+60s deadline, which FALSE-FAILED legitimately
 * long-running handlers — a healthy 10s-quality video render (polling the
 * provider for minutes while the runner's heartbeat kept renewing its lease)
 * was marked INTERNAL_ERROR at +180s, re-claimed, and its row was settled
 * "completed" with an empty result WHILE the real render was still running.
 * The honest stall signal is not wall-clock — it is the LEASE: the runner
 * heartbeats every heartbeatMs while a handler works, so a handler that
 * stops renewing its lease is genuinely dead. This watchdog rejects only
 * when the job's leaseUntil lapses (bounded by leaseMs after the last
 * heartbeat); legacy inline rows without a lease are never raced. A crashed
 * worker is still caught: its heartbeats stop, the lease lapses, recovery
 * takes over.
 */
function withSettleTimeout<T>(p: Promise<T>, jobId: string): Promise<T> {
  let timer: ReturnType<typeof setInterval> | undefined
  const watch = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      void (async () => {
        const row = await db.generationJob
          .findUnique({ where: { id: jobId }, select: { leaseUntil: true } })
          .catch(() => null)
        if (!row || !row.leaseUntil) return // inline/no-lease rows: no watchdog
        if (row.leaseUntil.getTime() < Date.now()) {
          clearInterval(timer)
          logger.error('engine.handler_lease_lapsed', { jobId })
          reject(new Error('handler lease lapsed without heartbeat (stall watchdog)'))
        }
      })()
    }, 30_000)
    timer.unref?.()
  })
  return Promise.race([p, watch]).finally(() => clearInterval(timer))
}

async function settleRetry(claimed: ClaimedJob, outcome: HandlerOutcome): Promise<void> {
  const backoffBase = outcome.retry?.scheduledForMs ?? 15_000
  // ZERO-DOWNTIME RECOVERY (2026-11-11): bounded ±20% jitter — same
  // retry-storm rationale as queue.ts finishFailed (a synchronized cohort
  // of failing jobs must not re-hit the provider at the same instant).
  const scheduledForMs = jitteredRetryBackoffMs(backoffBase)
  await db.generationJob
    .updateMany({
      where: { id: claimed.id, workerId: claimed.workerId, status: { in: ['starting', 'running', 'streaming', 'finalizing'] } },
      data: {
        status: 'retry_wait',
        nextRunAt: new Date(Date.now() + scheduledForMs),
        errorClass: outcome.errorClass ?? 'unknown',
        errorCode: outcome.errorCode ?? 'RETRY_SCHEDULED',
        errorMessage: outcome.errorMessage ?? 'A transient error occurred; the job will resume automatically.',
        workerId: null,
        workerKind: null,
        leaseUntil: null,
      },
    })
    .catch(() => undefined)
  await appendJobEventSafe(claimed.id, 'notice', {
    retry_wait: true,
    attempt: claimed.attempts,
    nextAttemptMs: scheduledForMs,
    reason: outcome.retry?.reason ?? 'transient',
  })
}

/**
 * One worker slot loop: claim → execute → repeat. Several slots form a
 * product's pool; several pools (products) run concurrently.
 */
async function slotLoop(
  product: BeanProductId,
  workerId: string,
  kind: 'embedded' | 'standalone',
  state: PoolState,
): Promise<void> {
  while (!state.stopping) {
    let claimed: ClaimedJob | null = null
    try {
      claimed = await claimNextJob({ product, workerId, workerKind: kind })
    } catch (e) {
      logger.error('engine.claim_failed', {
        product,
        message: e instanceof Error ? e.message : String(e),
      })
    }
    if (!claimed) {
      await sleepInterruptible(engineConfig().pollMs, product)
      continue
    }
    const handler = engineHandlers[claimed.task]
    if (!handler) {
      // Preserves the pre-engine behavior for tasks without a wired
      // processor (e.g. GANGZII audio tasks): honest NO_BACKEND failure.
      await finishFailed(claimed.id, claimed.workerId, {
        errorClass: 'permanent',
        errorCode: 'NO_BACKEND',
        errorMessage: 'No worker is available for this task type.',
      }).catch(() => undefined)
      continue
    }
    await executeClaimed(claimed, handler, kind)
  }
}

/**
 * Start a product worker pool. Returns a handle; starting the same product
 * twice in one process is a no-op (embedded + standalone safety).
 */
export function startWorkerPool(
  product: BeanProductId,
  kind: 'embedded' | 'standalone',
  concurrencyOverride?: number,
): PoolHandle | null {
  const registry = globalThis as unknown as { __bean_engine_pools__?: Map<string, PoolHandle> }
  if (!registry.__bean_engine_pools__) registry.__bean_engine_pools__ = new Map()
  const pools = registry.__bean_engine_pools__
  const key = `${kind}:${product}`
  if (pools.has(key)) return null

  const concurrency = Math.max(1, concurrencyOverride ?? engineConfig().concurrency[product] ?? 1)
  const workerId = workerInstanceId(kind, product)
  const state: PoolState = { stopping: false, idle: new Set() }

  const slots = Array.from({ length: concurrency }, () => slotLoop(product, workerId, kind, state))
  void Promise.all(slots).catch((e) =>
    logger.error('engine.pool_crashed', { product, message: e instanceof Error ? e.message : String(e) }),
  )

  const maintenance = setInterval(() => {
    if (state.stopping) return
    void recoverStaleJobs().catch(() => undefined)
    void pruneOldJobEvents(engineConfig().eventRetentionHours).catch(() => undefined)
  }, 60_000)
  state.idle.add(maintenance)
  // Immediate recovery on startup — jobs orphaned by a previous process
  // (crash/restart) are re-queued before the first poll.
  void recoverStaleJobs().catch(() => undefined)

  const handle: PoolHandle = {
    product,
    workerId,
    stop: async () => {
      state.stopping = true
      for (const t of state.idle) {
        clearInterval(t as ReturnType<typeof setInterval>)
        clearTimeout(t as ReturnType<typeof setTimeout>)
      }
      state.idle.clear()
      pools.delete(key)
    },
  }
  pools.set(key, handle)
  logger.info('engine.pool_started', { product, kind, concurrency, workerId })
  return handle
}

/** Start the embedded engine (all four product pools). Idempotent. */
export function startEmbeddedEngine(): void {
  const flag = globalThis as unknown as { __bean_engine_embedded__?: boolean }
  if (flag.__bean_engine_embedded__) return
  flag.__bean_engine_embedded__ = true
  const cfg = engineConfig()
  if (!cfg.embeddedWorkers) {
    logger.info('engine.embedded_disabled', {})
    return
  }
  const products: BeanProductId[] = ['riishe', 'laxii', 'jazmii', 'code-giftz']
  for (const p of products) startWorkerPool(p, 'embedded')
  logger.info('engine.embedded_started', {})
}

/** Snapshot for the admin console (counts per product/status). */
export async function engineQueueSnapshot() {
  const grouped = await db.generationJob.groupBy({
    by: ['product', 'status'],
    _count: { _all: true },
    where: { status: { in: ['queued', 'retry_wait', 'starting', 'running', 'streaming', 'finalizing'] } },
  })
  return grouped.map((g) => ({ product: g.product, status: g.status, count: g._count._all }))
}
