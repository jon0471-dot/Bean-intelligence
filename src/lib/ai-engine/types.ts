/**
 * BEAN Intelligence — BACKGROUND AI EXECUTION ENGINE, shared types.
 *
 * The engine decouples AI work from any browser session: products submit
 * jobs, independent workers claim them from the durable queue, stream
 * progress into an append-only event log, and persist real artifacts.
 * A user can close the tab, restart the server, come back later — and the
 * job state, streaming transcript and artifacts are all still there.
 *
 * SERVER-ONLY module: never import from client components.
 */

import type { BeanProductId, BeanTask } from '@/lib/registry/products'

/**
 * Full job state machine. EXTENDS the legacy status vocabulary
 * (queued | running | completed | failed | rejected | unsupported) — every
 * new state is normalized back to the legacy vocabulary at the four product
 * API boundaries so existing product interfaces keep their exact wire shape.
 *
 *   QUEUED      persisted, waiting for a worker
 *   STARTING    claimed by a worker (lease held), handler starting
 *   RUNNING     real work in progress (provider call, GPU render, sandbox…)
 *   STREAMING   partial text/tokens are flowing to the event log
 *   FINALIZING  work done; persisting artifacts/results
 *   COMPLETED   real output stored — never set without a real artifact
 *   FAILED      honest failure with classified cause
 *   CANCELLED   cancelled by its owner before/while running
 *   RETRY_WAIT  transient failure (crash/network/timeout); scheduled retry
 */
export type JobState =
  | 'queued'
  | 'starting'
  | 'running'
  | 'streaming'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retry_wait'

export const TERMINAL_STATES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'cancelled',
  // Legacy vocabulary terminals preserved:
  'rejected',
  'unsupported',
])

export const ACTIVE_STATES: ReadonlySet<string> = new Set([
  'queued',
  'starting',
  'running',
  'streaming',
  'finalizing',
  'retry_wait',
])

/** States a worker claim can target. */
export const CLAIMABLE_STATES: ReadonlySet<string> = new Set(['queued', 'retry_wait'])

/**
 * Map an engine state to the LEGACY status vocabulary used by the four
 * product APIs so existing clients need no change:
 *  - starting/streaming/finalizing are all "running" to the products;
 *  - retry_wait is still "queued" (the job has not started real work);
 *  - cancelled is reported as legacy "failed" with errorCode CANCELLED —
 *    exactly what the pre-engine code did when cancelling a queued job.
 */
export function normalizeStatusForProduct(status: string): string {
  switch (status) {
    case 'starting':
    case 'running':
    case 'streaming':
    case 'finalizing':
      return 'running'
    case 'retry_wait':
      return 'queued'
    default:
      return status
  }
}

/** Honest failure classification persisted with every failed job. */
export type JobErrorClass =
  | 'rate_limited' // upstream 429 — NEVER retried (throttle protocol)
  | 'auth'
  | 'billing'
  | 'timeout'
  | 'network'
  | 'worker_lost' // lease expired without the worker finishing
  | 'permanent' // validation, content policy, missing capability
  | 'budget' // operator request-budget exhausted
  | 'cancelled'
  | 'unknown'

/** Error classes that are TRANSIENT infrastructure failures eligible for a
 *  bounded RETRY_WAIT. Rate limiting is deliberately NOT retryable: BEAN
 *  never repeats a throttled upstream request (429 protocol). */
export const RETRYABLE_CLASSES: ReadonlySet<string> = new Set([
  'timeout',
  'network',
  'worker_lost',
  'unknown',
])

/** Event types written to the per-job append-only log. */
export type JobEventType =
  | 'delta' // partial chat/coding text
  | 'reset' // streamed draft replaced (verification rewrite)
  | 'stage' // orchestration stage changes (researching, solving, verifying…)
  | 'progress' // numeric progress 0..100 (image/video)
  | 'research' // web research queries used
  | 'tool' // tool-loop execution notices
  | 'notice' // worker/cancel/recovery notices
  | 'error' // failure frame (job ends FAILED right after)
  | 'artifact' // completed artifact link(s)

export interface JobEventData {
  [key: string]: unknown
}

/** A job row as handed to a worker handler. */
export interface ClaimedJob {
  id: string
  userId: string
  productId: BeanProductId
  /** Legacy vocabulary alias of productId (existing processors accept string). */
  product: string
  task: BeanTask
  capability: string | null
  status: JobState
  progress: number
  attempts: number
  maxAttempts: number
  paramsJson: string
  resultJson: string | null
  cancelRequested: boolean
  workerId: string
  workerKind: 'embedded' | 'standalone'
}

export interface HandlerOutcome {
  /** Terminal result payload persisted to resultJson (artifact links etc). */
  result?: Record<string, unknown>
  /** Usage rollup for metering (tokens/images/duration). */
  usage?: Record<string, unknown>
  /** On failure: honest classification. */
  errorClass?: JobErrorClass
  errorCode?: string
  errorMessage?: string
  /** Present when the outcome is a bounded RETRY_WAIT instead of a terminal state. */
  retry?: { scheduledForMs: number; reason: string }
  /** ISSUES 1-2 REPAIR: present when the handler delegated the row to
   *  another live executor in this process (e.g. the video poller registry
   *  already owns the job) — the runner settles NOTHING (no finishCompleted
   *  with an empty result, no failure) because the row's fate belongs to the
   *  live executor. */
  noSettle?: boolean
}

/**
 * A worker handler performs the REAL work for one claimed job. It must:
 *  - never fabricate success (complete only with a real artifact/result),
 *  - honor cooperative cancellation between natural checkpoints,
 *  - leave state transitions to its own honest judgment (the engine only
 *    enforces the lease; the handler owns progress/streaming events).
 */
export type WorkerHandler = (
  job: ClaimedJob,
  ctx: { signal: { aborted: boolean } },
) => Promise<HandlerOutcome>

export function isTerminal(status: string): boolean {
  return TERMINAL_STATES.has(status)
}
