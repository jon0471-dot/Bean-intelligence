/**
 * BEAN Intelligence — Trust Engine checkpoints.
 *
 * Append-only safe checkpoints for long-running tasks: the newest valid row
 * is the resume point. A checkpoint payload holds only SAFE resumable state
 * (cursor positions, completed-step markers, provider task ids) — never
 * credentials, tokens or prompt text.
 *
 * SERVER-ONLY.
 */

import { db } from '@/lib/db'
import {
  TRUST_LIMITS,
  TrustLimitError,
  TrustNotFoundError,
  TrustStateError,
} from './types'

const RESUMABLE_STATUSES = ['running', 'waiting_for_approval'] as const

export interface WriteCheckpointInput {
  label: string
  payload?: unknown
}

/** Append a checkpoint and supersede older ones (newest valid = resume point). */
export async function writeTrustCheckpoint(taskId: string, input: WriteCheckpointInput) {
  const task = await db.trustTask.findUnique({ where: { id: taskId } })
  if (!task) throw new TrustNotFoundError('Trust task not found.')
  if (!(RESUMABLE_STATUSES as readonly string[]).includes(task.status)) {
    throw new TrustStateError(`Checkpoints can only be written while a task is active ("${task.status}").`)
  }
  if (!input.label.trim() || input.label.length > TRUST_LIMITS.summaryField) {
    throw new TrustStateError('A checkpoint needs a short label.')
  }
  const count = await db.trustCheckpoint.count({ where: { taskId } })
  if (count >= TRUST_LIMITS.checkpointsPerTask) {
    throw new TrustLimitError(`trust.checkpointsPerTask exceeds ${TRUST_LIMITS.checkpointsPerTask}`)
  }
  const last = await db.trustCheckpoint.findFirst({
    where: { taskId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  })
  const seq = (last?.seq ?? 0) + 1
  const payloadJson = input.payload === undefined ? null : JSON.stringify(input.payload)
  if (payloadJson && payloadJson.length > TRUST_LIMITS.payloadJson) {
    throw new TrustLimitError(`trust.payloadJson exceeds its ${TRUST_LIMITS.payloadJson}-character bound`)
  }
  const checkpoint = await db.trustCheckpoint.create({
    data: { taskId, seq, label: input.label, status: 'valid', payloadJson },
  })
  await db.trustCheckpoint.updateMany({
    where: { taskId, status: 'valid', seq: { lt: seq } },
    data: { status: 'superseded' },
  })
  return checkpoint
}

/** The resume point: newest valid checkpoint, or null when none exists. */
export async function latestValidTrustCheckpoint(taskId: string) {
  return db.trustCheckpoint.findFirst({
    where: { taskId, status: 'valid' },
    orderBy: { seq: 'desc' },
  })
}

/**
 * Mark the resume point consumed-safe: a checkpoint that has been used for a
 * recovery attempt is superseded so recovery never replays it twice.
 */
export async function supersedeTrustCheckpoint(taskId: string, seq: number) {
  const res = await db.trustCheckpoint.updateMany({
    where: { taskId, seq, status: 'valid' },
    data: { status: 'superseded' },
  })
  return res.count === 1
}
