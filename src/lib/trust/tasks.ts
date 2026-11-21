/**
 * BEAN Intelligence — Trust Engine task ledger (database-backed).
 *
 * One TrustTask per meaningful agent task; steps and evidence are append-only
 * child rows. Every status change is validated against the lifecycle table in
 * ./types.ts and settled with a CAS-style conditional write so two workers
 * can never both settle the same task (SQLite single-writer + updateMany).
 *
 * Honesty rules enforced HERE, not by callers:
 *   - finalize requires a non-empty verification summary for every
 *     completed/partially-completed outcome;
 *   - failure and cancellation require a truthful reason;
 *   - terminal rows are immutable (no re-settling, no status edits).
 *
 * Secrecy rule: never store secrets, tokens or key material in any field;
 * every free-text field is size-bounded (TRUST_LIMITS).
 *
 * SERVER-ONLY.
 */

import { db } from '@/lib/db'
import {
  TRUST_EVIDENCE_KINDS,
  TRUST_EVIDENCE_ORIGINS,
  TRUST_LIMITS,
  TRUST_STEP_KINDS,
  canTransitionStep,
  canTransitionTask,
  isTerminalTaskStatus,
  TrustLimitError,
  TrustNotFoundError,
  TrustStateError,
  type TrustEvidenceKind,
  type TrustEvidenceOrigin,
  type TrustStepKind,
  type TrustStepStatus,
  type TrustTaskStatus,
} from './types'

const ACTIVE_TASK_STATUSES: readonly TrustTaskStatus[] = ['planned', 'waiting_for_approval', 'running']
const SETTLEABLE_STATUSES: readonly TrustTaskStatus[] = ['running', 'waiting_for_approval']

function bounded(value: string, max: number, field: string): string {
  if (value.length > max) {
    throw new TrustLimitError(`trust.${field} exceeds its ${max}-character bound`)
  }
  return value
}

function boundedOptional(value: string | null | undefined, max: number, field: string): string | null {
  if (value === null || value === undefined) return null
  return bounded(value, max, field)
}

export interface CreateTrustTaskInput {
  userId: string
  product: string
  kind: string
  title: string
  requestPreview?: string
  requestChars?: number
  jobId?: string
  conversationId?: string
  projectId?: string
}

export async function createTrustTask(input: CreateTrustTaskInput) {
  const title = bounded(input.title, TRUST_LIMITS.title, 'title')
  const requestPreview = boundedOptional(input.requestPreview, TRUST_LIMITS.requestPreview, 'requestPreview')
  return db.trustTask.create({
    data: {
      userId: input.userId,
      product: input.product,
      kind: input.kind,
      title,
      requestPreview,
      requestChars: input.requestChars ?? null,
      jobId: input.jobId ?? null,
      conversationId: input.conversationId ?? null,
      projectId: input.projectId ?? null,
      status: 'planned',
    },
  })
}

/** planned → running (CAS). Idempotent-safe: starting an already-running task is a no-op. */
export async function startTrustTask(taskId: string) {
  const task = await db.trustTask.findUnique({ where: { id: taskId } })
  if (!task) throw new TrustNotFoundError('Trust task not found.')
  if (task.status === 'running') return task
  if (!canTransitionTask(task.status as TrustTaskStatus, 'running')) {
    throw new TrustStateError(`Cannot start a task in status "${task.status}".`)
  }
  const res = await db.trustTask.updateMany({
    where: { id: taskId, status: task.status },
    data: { status: 'running', startedAt: task.startedAt ?? new Date() },
  })
  if (res.count !== 1) throw new TrustStateError('Task was settled concurrently; start rejected.')
  return { ...task, status: 'running' as const }
}

export interface PlanStepInput {
  kind: TrustStepKind
  title: string
  detailJson?: string
}

/** Append planned steps while the task is still active. Sequence is per-task monotonic. */
export async function planTrustSteps(taskId: string, steps: PlanStepInput[]) {
  if (steps.length > TRUST_LIMITS.stepsPerTask) {
    throw new TrustLimitError(`trust.stepsPerTask exceeds ${TRUST_LIMITS.stepsPerTask}`)
  }
  const last = await db.trustStep.findFirst({
    where: { taskId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  })
  let seq = last?.seq ?? 0
  for (const step of steps) {
    if (!TRUST_STEP_KINDS.includes(step.kind)) {
      throw new TrustStateError(`Unknown step kind "${step.kind}".`)
    }
    seq += 1
    await db.trustStep.create({
      data: {
        taskId,
        seq,
        kind: step.kind,
        title: bounded(step.title, TRUST_LIMITS.summaryField, 'step.title'),
        detailJson: boundedOptional(step.detailJson, TRUST_LIMITS.detailJson, 'step.detailJson'),
        status: 'planned',
      },
    })
  }
  return seq
}

async function requireActiveTask(taskId: string) {
  const task = await db.trustTask.findUnique({ where: { id: taskId } })
  if (!task) throw new TrustNotFoundError('Trust task not found.')
  if (isTerminalTaskStatus(task.status)) {
    throw new TrustStateError(`Task is settled ("${task.status}"); ledger rows are immutable afterwards.`)
  }
  return task
}

/** Advance a step's status (append-only ledger: never rewinds). */
export async function updateTrustStepStatus(
  taskId: string,
  seq: number,
  status: TrustStepStatus,
  patch?: { detailJson?: string; errorNote?: string },
) {
  await requireActiveTask(taskId)
  const step = await db.trustStep.findUnique({
    where: { taskId_seq: { taskId, seq } },
  })
  if (!step) throw new TrustNotFoundError('Trust step not found.')
  if (!canTransitionStep(step.status as TrustStepStatus, status)) {
    throw new TrustStateError(`Step ${seq} cannot move from "${step.status}" to "${status}".`)
  }
  const now = new Date()
  await db.trustStep.update({
    where: { id: step.id },
    data: {
      status,
      detailJson:
        patch?.detailJson !== undefined
          ? boundedOptional(patch.detailJson, TRUST_LIMITS.detailJson, 'step.detailJson')
          : step.detailJson,
      errorNote:
        patch?.errorNote !== undefined
          ? boundedOptional(patch.errorNote, TRUST_LIMITS.noteField, 'step.errorNote')
          : step.errorNote,
      startedAt: step.startedAt ?? (status === 'running' ? now : null),
      finishedAt: status === 'done' || status === 'failed' || status === 'skipped' ? now : null,
    },
  })
}

export interface AddEvidenceInput {
  stepSeq?: number
  kind: TrustEvidenceKind
  ref: string
  title?: string
  locator?: string
  digest?: string
  origin?: TrustEvidenceOrigin
  note?: string
}

/** Append an evidence row. `origin` keeps extracted facts separate from model interpretation. */
export async function addTrustEvidence(taskId: string, input: AddEvidenceInput) {
  await requireActiveTask(taskId)
  if (!TRUST_EVIDENCE_KINDS.includes(input.kind)) {
    throw new TrustStateError(`Unknown evidence kind "${input.kind}".`)
  }
  const origin: TrustEvidenceOrigin = input.origin ?? 'extracted'
  if (!TRUST_EVIDENCE_ORIGINS.includes(origin)) {
    throw new TrustStateError(`Unknown evidence origin "${origin}".`)
  }
  if (input.digest && !/^[0-9a-f]{64}$/.test(input.digest)) {
    throw new TrustStateError('Evidence digest must be a 64-hex sha-256 value.')
  }
  const count = await db.trustEvidence.count({ where: { taskId } })
  if (count >= TRUST_LIMITS.evidencePerTask) {
    throw new TrustLimitError(`trust.evidencePerTask exceeds ${TRUST_LIMITS.evidencePerTask}`)
  }
  return db.trustEvidence.create({
    data: {
      taskId,
      stepSeq: input.stepSeq ?? null,
      kind: input.kind,
      ref: bounded(input.ref, TRUST_LIMITS.refChars, 'evidence.ref'),
      title: boundedOptional(input.title, TRUST_LIMITS.summaryField, 'evidence.title'),
      locator: boundedOptional(input.locator, TRUST_LIMITS.noteField, 'evidence.locator'),
      digest: input.digest ?? null,
      origin,
      note: boundedOptional(input.note, TRUST_LIMITS.noteField, 'evidence.note'),
    },
  })
}

export interface FinalizeTrustTaskInput {
  outcome: 'completed' | 'completed_with_limitations' | 'partially_completed'
  outcomeSummary: string
  verificationSummary: string
  limitations?: string[]
}

/**
 * Settle a task as honestly completed. THE core never-pretend rule: a
 * completed-family outcome without a verification summary is a programming
 * error and is rejected before any write — a task is never marked completed
 * merely because a model produced a response.
 */
export async function finalizeTrustTask(taskId: string, input: FinalizeTrustTaskInput) {
  const task = await db.trustTask.findUnique({ where: { id: taskId } })
  if (!task) throw new TrustNotFoundError('Trust task not found.')
  if (!canTransitionTask(task.status as TrustTaskStatus, input.outcome)) {
    throw new TrustStateError(`Cannot settle a "${task.status}" task as "${input.outcome}".`)
  }
  if (!input.verificationSummary.trim()) {
    throw new TrustStateError(
      `A "${input.outcome}" outcome requires a verification summary — completion is never assumed from a model response.`,
    )
  }
  const limitations = input.limitations ?? []
  if (limitations.length > TRUST_LIMITS.limitationsPerTask) {
    throw new TrustLimitError(`trust.limitationsPerTask exceeds ${TRUST_LIMITS.limitationsPerTask}`)
  }
  const res = await db.trustTask.updateMany({
    where: { id: taskId, status: { in: [...SETTLEABLE_STATUSES] } },
    data: {
      status: input.outcome,
      outcomeSummary: bounded(input.outcomeSummary, TRUST_LIMITS.summaryField, 'outcomeSummary'),
      verificationSummary: bounded(input.verificationSummary, TRUST_LIMITS.summaryField, 'verificationSummary'),
      limitationsJson: limitations.length
        ? JSON.stringify(limitations.map((l) => bounded(l, TRUST_LIMITS.limitationChars, 'limitation')))
        : null,
      completedAt: new Date(),
    },
  })
  if (res.count !== 1) throw new TrustStateError('Task was settled concurrently; finalize rejected.')
  return { ...task, status: input.outcome }
}

export interface FailTrustTaskInput {
  failureNote: string
  verificationSummary?: string
  limitations?: string[]
}

/** Settle a task as failed with a truthful reason. */
export async function failTrustTask(taskId: string, input: FailTrustTaskInput) {
  const task = await db.trustTask.findUnique({ where: { id: taskId } })
  if (!task) throw new TrustNotFoundError('Trust task not found.')
  if (!canTransitionTask(task.status as TrustTaskStatus, 'failed')) {
    throw new TrustStateError(`Cannot settle a "${task.status}" task as failed.`)
  }
  if (!input.failureNote.trim()) {
    throw new TrustStateError('A failure requires a truthful failure note.')
  }
  const limitations = input.limitations ?? []
  const res = await db.trustTask.updateMany({
    where: { id: taskId, status: { in: [...ACTIVE_TASK_STATUSES] } },
    data: {
      status: 'failed',
      failureNote: bounded(input.failureNote, TRUST_LIMITS.summaryField, 'failureNote'),
      verificationSummary: boundedOptional(input.verificationSummary, TRUST_LIMITS.summaryField, 'verificationSummary'),
      limitationsJson: limitations.length
        ? JSON.stringify(limitations.map((l) => bounded(l, TRUST_LIMITS.limitationChars, 'limitation')))
        : null,
      completedAt: new Date(),
    },
  })
  if (res.count !== 1) throw new TrustStateError('Task was settled concurrently; failure rejected.')
  return { ...task, status: 'failed' as const }
}

/** Settle a task as cancelled with a truthful reason. */
export async function cancelTrustTask(taskId: string, note: string) {
  const task = await db.trustTask.findUnique({ where: { id: taskId } })
  if (!task) throw new TrustNotFoundError('Trust task not found.')
  if (isTerminalTaskStatus(task.status)) {
    throw new TrustStateError(`Task already settled ("${task.status}").`)
  }
  if (!note.trim()) {
    throw new TrustStateError('A cancellation requires a truthful note.')
  }
  const res = await db.trustTask.updateMany({
    where: { id: taskId, status: { in: [...ACTIVE_TASK_STATUSES] } },
    data: {
      status: 'cancelled',
      failureNote: bounded(note, TRUST_LIMITS.summaryField, 'cancelNote'),
      cancelledAt: new Date(),
      completedAt: new Date(),
    },
  })
  if (res.count !== 1) throw new TrustStateError('Task was settled concurrently; cancel rejected.')
  return { ...task, status: 'cancelled' as const }
}

/** Owner-scoped fetch with the full ledger attached. */
export async function getTrustTaskForOwner(taskId: string, userId: string) {
  const task = await db.trustTask.findUnique({
    where: { id: taskId },
    include: {
      steps: { orderBy: { seq: 'asc' } },
      evidence: { orderBy: { createdAt: 'asc' } },
      approvals: { orderBy: { requestedAt: 'asc' } },
      checkpoints: { orderBy: { seq: 'asc' } },
    },
  })
  if (!task || task.userId !== userId) return null
  return task
}

export interface ListTrustTasksFilter {
  status?: string
  product?: string
  take?: number
}

export async function listTrustTasksForOwner(userId: string, filter: ListTrustTasksFilter = {}) {
  const take = Math.min(Math.max(filter.take ?? 40, 1), 100)
  return db.trustTask.findMany({
    where: {
      userId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.product ? { product: filter.product } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take,
  })
}
