/**
 * BEAN Intelligence — Trust Engine executor checkpoint resume.
 *
 * The ACTUAL resume path for interrupted tasks: validates a persisted safe
 * checkpoint against the append-only step ledger, consumes it exactly once,
 * truthfully records the recovery in the ledger, and hands the executor a
 * resume plan. Honesty rules enforced HERE:
 *
 *   1. Resume is possible ONLY from a valid persisted checkpoint — never
 *      invented, never replayed twice (the checkpoint is superseded
 *      atomically before execution continues).
 *   2. Only explicitly registered task kinds are resumable; the registry
 *      starts EMPTY and an unregistered kind is honestly refused. No adapter
 *      = no resume claim.
 *   3. The step ledger is the authority: a checkpoint that claims completed
 *      steps the ledger does not show as `done` is stale/corrupt and is
 *      rejected before anything is re-executed.
 *   4. A step found `running` (interrupted mid-flight) is never blindly
 *      re-run: unless the registered kind explicitly declares
 *      `retryRunningStep` (idempotency is the executor's declared
 *      responsibility), it is truthfully failed with an explanatory note and
 *      the continuation starts at the next planned step.
 *   5. `waiting_for_approval` tasks are never resumed past approval — the
 *      approval must be decided first; resuming cannot bypass a pending
 *      approval.
 *   6. Terminal tasks are immutable: never resumed.
 *
 * The caller (executor) owns the continuation and the final truthful
 * settlement; the composed receipt shows the recovery step automatically
 * because the receipt IS the ledger.
 *
 * SERVER-ONLY.
 */

import { db } from '@/lib/db'
import {
  TRUST_LIMITS,
  TrustNotFoundError,
  TrustStateError,
} from './types'
import { latestValidTrustCheckpoint, supersedeTrustCheckpoint } from './checkpoints'
import { planTrustSteps } from './tasks'

export const TRUST_RESUME_CONTRACT = 'trust-resume-v1'

/** Safe checkpoint payload (never credentials, tokens or prompt text). */
export interface TrustResumeCheckpointPayload {
  contract: typeof TRUST_RESUME_CONTRACT
  /** The task kind this checkpoint was written for (must match the task). */
  resumableKind: string
  /** Highest step seq known persisted-complete when the checkpoint was written. */
  completedThroughSeq: number
  /** Bounded, secret-free honest note (optional). */
  note?: string
}

interface ResumeKindOptions {
  /**
   * Whether the executor may re-execute a step that was interrupted while
   * `running`. Declared per kind — declaring it is a claim that re-running
   * that kind's steps cannot duplicate side effects.
   */
  retryRunningStep: boolean
}

const RESUMABLE_KINDS = new Map<string, ResumeKindOptions>()

/**
 * Register a task kind as checkpoint-resumable. The registry starts empty on
 * purpose: a kind becomes resumable only when its executor both persists
 * checkpoints and takes responsibility for safe continuation.
 */
export function registerResumableKind(kind: string, options: ResumeKindOptions): void {
  RESUMABLE_KINDS.set(kind, { retryRunningStep: options.retryRunningStep === true })
}

/** Honest inventory of what is currently resumable (for routes/UI). */
export function describeResumeSupport(): Array<{ kind: string; retryRunningStep: boolean }> {
  return [...RESUMABLE_KINDS.entries()].map(([kind, o]) => ({
    kind,
    retryRunningStep: o.retryRunningStep,
  }))
}

export function isKindResumable(kind: string): boolean {
  return RESUMABLE_KINDS.has(kind)
}

export interface TrustResumePlan {
  taskId: string
  checkpointSeq: number
  recoveryStepSeq: number
  /** Ledger-derived highest `done` step seq after recovery bookkeeping. */
  completedThroughSeq: number
  /** First step the executor should run next; null when none is planned. */
  nextSeq: number | null
  /** Steps that were `running` when recovery happened. */
  interruptedStepSeqs: number[]
  retryRunningStep: boolean
}

export type TrustResumeRejection =
  | 'not_found'
  | 'already_settled'
  | 'not_started'
  | 'waiting_for_approval'
  | 'kind_not_resumable'
  | 'no_valid_checkpoint'
  | 'invalid_checkpoint'
  | 'checkpoint_ledger_mismatch'
  | 'checkpoint_already_consumed'

const REJECTION_MESSAGES: Record<TrustResumeRejection, string> = {
  not_found: 'Task not found.',
  already_settled: 'The task is already settled; terminal ledger rows are immutable and never resumed.',
  not_started: 'The task was never started; start it instead of resuming.',
  waiting_for_approval: 'The task is waiting for an approval decision; resuming cannot bypass a pending approval.',
  kind_not_resumable: 'This task kind has no registered checkpoint resume support; resume is not claimed for it.',
  no_valid_checkpoint: 'No valid persisted checkpoint exists; recovery cannot honestly continue from nothing.',
  invalid_checkpoint: 'The persisted checkpoint is malformed or was written for another contract/kind.',
  checkpoint_ledger_mismatch: 'The checkpoint disagrees with the step ledger (stale or corrupted); nothing was re-executed.',
  checkpoint_already_consumed: 'The checkpoint was already consumed by a concurrent recovery attempt.',
}

export class TrustResumeRejectionError extends TrustStateError {
  reason: TrustResumeRejection
  constructor(reason: TrustResumeRejection) {
    super(REJECTION_MESSAGES[reason])
    this.reason = reason
  }
}

function rejectionError(reason: TrustResumeRejection): TrustResumeRejectionError {
  return new TrustResumeRejectionError(reason)
}

function parsePayload(json: string | null): TrustResumeCheckpointPayload | null {
  if (!json) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Record<string, unknown>
  if (p.contract !== TRUST_RESUME_CONTRACT) return null
  if (typeof p.resumableKind !== 'string' || !p.resumableKind) return null
  if (typeof p.completedThroughSeq !== 'number' || !Number.isInteger(p.completedThroughSeq)) return null
  if (p.completedThroughSeq < 0 || p.completedThroughSeq > TRUST_LIMITS.stepsPerTask) return null
  if (p.note !== undefined && typeof p.note !== 'string') return null
  return {
    contract: TRUST_RESUME_CONTRACT,
    resumableKind: p.resumableKind,
    completedThroughSeq: p.completedThroughSeq,
    ...(typeof p.note === 'string' ? { note: p.note.slice(0, TRUST_LIMITS.noteField) } : {}),
  }
}

interface ValidatedResume {
  task: { id: string; userId: string; status: string; kind: string }
  checkpoint: { seq: number; payload: TrustResumeCheckpointPayload }
  steps: Array<{ seq: number; status: string }>
}

/** Read-only shared validation for plan/resume. Throws rejection errors. */
async function validateForResume(taskId: string, userId: string): Promise<ValidatedResume> {
  const task = await db.trustTask.findUnique({ where: { id: taskId } })
  if (!task || task.userId !== userId) throw rejectionError('not_found')
  if (['completed', 'completed_with_limitations', 'partially_completed', 'failed', 'cancelled'].includes(task.status)) {
    throw rejectionError('already_settled')
  }
  if (task.status === 'planned') throw rejectionError('not_started')
  if (task.status === 'waiting_for_approval') throw rejectionError('waiting_for_approval')

  const options = RESUMABLE_KINDS.get(task.kind)
  if (!options) throw rejectionError('kind_not_resumable')

  const checkpoint = await latestValidTrustCheckpoint(taskId)
  if (!checkpoint) throw rejectionError('no_valid_checkpoint')
  const payload = parsePayload(checkpoint.payloadJson)
  if (!payload || payload.resumableKind !== task.kind) throw rejectionError('invalid_checkpoint')

  const steps = await db.trustStep.findMany({ where: { taskId }, orderBy: { seq: 'asc' } })
  // Ledger is the authority: every step the checkpoint claims complete must
  // actually be `done` in the ledger — otherwise the checkpoint is stale.
  for (const step of steps) {
    if (step.seq <= payload.completedThroughSeq && step.status !== 'done') {
      throw rejectionError('checkpoint_ledger_mismatch')
    }
  }
  return {
    task: { id: task.id, userId: task.userId, status: task.status, kind: task.kind },
    checkpoint: { seq: checkpoint.seq, payload },
    steps: steps.map((s) => ({ seq: s.seq, status: s.status })),
  }
}

function derivePlan(
  validated: ValidatedResume,
  options: ResumeKindOptions,
  recoveryStepSeq: number,
): TrustResumePlan {
  // The recovery bookkeeping step is ledger history, not task progress — it
  // never counts toward the completed-through cursor.
  const doneSeqs = validated.steps
    .filter((s) => s.status === 'done' && s.seq !== recoveryStepSeq)
    .map((s) => s.seq)
  const completedThroughSeq = Math.max(validated.checkpoint.payload.completedThroughSeq, ...doneSeqs, 0)
  const interrupted = validated.steps.filter((s) => s.status === 'running').map((s) => s.seq)
  const runnableStatuses = options.retryRunningStep ? ['planned', 'running'] : ['planned']
  const runnable = validated.steps
    .filter((s) => runnableStatuses.includes(s.status) && s.seq <= recoveryStepSeq)
    .map((s) => s.seq)
  const nextSeq = runnable.length ? Math.min(...runnable) : null
  return {
    taskId: validated.task.id,
    checkpointSeq: validated.checkpoint.seq,
    recoveryStepSeq,
    completedThroughSeq,
    nextSeq,
    interruptedStepSeqs: interrupted,
    retryRunningStep: options.retryRunningStep,
  }
}

/** Read-only eligibility check: what a resume of this task would do. Never mutates. */
export async function planTrustResume(taskId: string, userId: string): Promise<TrustResumePlan> {
  const validated = await validateForResume(taskId, userId)
  const options = RESUMABLE_KINDS.get(validated.task.kind)!
  // A hypothetical recovery step would append after the current last step.
  const lastSeq = validated.steps.reduce((max, s) => Math.max(max, s.seq), 0)
  return derivePlan(validated, options, lastSeq + 1)
}

/**
 * Consume the newest valid checkpoint and prepare continuation. The task
 * stays active; the executor runs the returned plan's steps through the
 * normal ledger API and settles the task with a truthful verification
 * summary (the receipt shows the recovery step automatically).
 */
export async function resumeTrustTask(
  taskId: string,
  userId: string,
  opts: { note?: string } = {},
): Promise<TrustResumePlan> {
  const validated = await validateForResume(taskId, userId)
  const options = RESUMABLE_KINDS.get(validated.task.kind)!

  // Consume the checkpoint EXACTLY once, atomically, before anything runs.
  const consumed = await supersedeTrustCheckpoint(taskId, validated.checkpoint.seq)
  if (!consumed) throw rejectionError('checkpoint_already_consumed')

  // Truthful handling of the interrupted `running` step(s).
  const interruptedStepSeqs: number[] = []
  for (const step of validated.steps) {
    if (step.status !== 'running') continue
    interruptedStepSeqs.push(step.seq)
    if (!options.retryRunningStep) {
      await db.trustStep.updateMany({
        where: { taskId, seq: step.seq, status: 'running' },
        data: {
          status: 'failed',
          errorNote:
            'Interrupted mid-execution; recovery did not re-run it to avoid duplicating possible side effects. Outcome must reflect this truthfully.',
          finishedAt: new Date(),
        },
      })
    }
  }

  // Append the recovery record to the append-only ledger.
  const last = await db.trustStep.findFirst({
    where: { taskId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  })
  const recoveryStepSeq = (last?.seq ?? 0) + 1
  const detailJson = JSON.stringify({
    contract: TRUST_RESUME_CONTRACT,
    checkpointSeq: validated.checkpoint.seq,
    completedThroughSeq: validated.checkpoint.payload.completedThroughSeq,
    interruptedStepSeqs,
    retryRunningStep: options.retryRunningStep,
    ...(opts.note ? { note: opts.note.slice(0, TRUST_LIMITS.noteField) } : {}),
  }).slice(0, TRUST_LIMITS.detailJson)
  const recoveryStep = await db.trustStep.create({
    data: {
      taskId,
      seq: recoveryStepSeq,
      kind: 'recovery',
      title: `Recovered from checkpoint #${validated.checkpoint.seq}`,
      detailJson,
      status: 'done',
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  })

  return derivePlan({ ...validated, steps: [...validated.steps, { seq: recoveryStep.seq, status: 'done' }] }, options, recoveryStep.seq)
}

/**
 * Persist a safe resume checkpoint for an active task of a registered kind.
 * Payload holds only the contract, the kind, the completed-through step seq
 * and an optional bounded note — never credentials, tokens or prompt text.
 */
export async function writeResumeCheckpoint(
  taskId: string,
  input: { completedThroughSeq: number; note?: string },
): Promise<void> {
  const task = await db.trustTask.findUnique({ where: { id: taskId } })
  if (!task) throw new TrustNotFoundError('Trust task not found.')
  const options = RESUMABLE_KINDS.get(task.kind)
  if (!options) {
    throw new TrustStateError(`Task kind "${task.kind}" is not registered for checkpoint resume; refusing to write a checkpoint it could never honor.`)
  }
  if (!Number.isInteger(input.completedThroughSeq) || input.completedThroughSeq < 0 || input.completedThroughSeq > TRUST_LIMITS.stepsPerTask) {
    throw new TrustStateError('completedThroughSeq must be a step seq within the ledger bounds.')
  }
  const payload: TrustResumeCheckpointPayload = {
    contract: TRUST_RESUME_CONTRACT,
    resumableKind: task.kind,
    completedThroughSeq: input.completedThroughSeq,
    ...(input.note ? { note: input.note.slice(0, TRUST_LIMITS.noteField) } : {}),
  }
  const { writeTrustCheckpoint } = await import('./checkpoints')
  await writeTrustCheckpoint(taskId, {
    label: `resume@step-${input.completedThroughSeq}`,
    payload,
  })
}

/** Convenience for executors: plan steps on a task (re-export to keep the resume contract in one place). */
export { planTrustSteps }
