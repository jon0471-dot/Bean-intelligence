/**
 * BEAN Intelligence — Trust Engine scoped approvals.
 *
 * Approval semantics (February 2027 brief):
 *   - consequential external/destructive actions require explicit approval;
 *   - approval is scoped to the ACTUAL proposed action — the sha-256
 *     actionDigest binds the decision to the exact canonical action JSON
 *     (same integrity pattern as the CodeFileOperation planHash);
 *   - an approval is consumed on use and never carries over — approval for
 *     one action is never unlimited future permission;
 *   - approvals expire; expired grants can never be consumed.
 *
 * SERVER-ONLY.
 */

import { db } from '@/lib/db'
import { actionDigestFor } from './digest'
import {
  TRUST_LIMITS,
  TrustNotFoundError,
  TrustStateError,
  type TrustTaskStatus,
} from './types'

const REQUESTABLE_STATUSES: readonly TrustTaskStatus[] = ['planned', 'running', 'waiting_for_approval']
const DEFAULT_TTL_MS = 15 * 60 * 1000
const MIN_TTL_MS = 60 * 1000
const MAX_TTL_MS = 24 * 60 * 60 * 1000

export interface RequestApprovalInput {
  action: unknown
  summary: string
  ttlMs?: number
}

/**
 * Record a requested approval and pause the task in waiting_for_approval.
 * While waiting, the owning executor must not perform the action.
 */
export async function requestTaskApproval(taskId: string, input: RequestApprovalInput) {
  const task = await db.trustTask.findUnique({ where: { id: taskId } })
  if (!task) throw new TrustNotFoundError('Trust task not found.')
  if (!(REQUESTABLE_STATUSES as readonly string[]).includes(task.status)) {
    throw new TrustStateError(`Cannot request approval for a "${task.status}" task.`)
  }
  const actionJson = JSON.stringify(input.action ?? null)
  if (actionJson.length > TRUST_LIMITS.actionJson) {
    throw new TrustStateError(`Proposed action exceeds its ${TRUST_LIMITS.actionJson}-character bound.`)
  }
  const summary = input.summary
  if (!summary.trim() || summary.length > TRUST_LIMITS.summaryField) {
    throw new TrustStateError('An approval needs a short, truthful summary of the action.')
  }
  const ttl = Math.min(Math.max(input.ttlMs ?? DEFAULT_TTL_MS, MIN_TTL_MS), MAX_TTL_MS)
  const approval = await db.trustApproval.create({
    data: {
      taskId,
      actionDigest: actionDigestFor(input.action ?? null),
      actionJson,
      summary,
      scope: 'single',
      status: 'requested',
      expiresAt: new Date(Date.now() + ttl),
    },
  })
  if (task.status !== 'waiting_for_approval') {
    await db.trustTask.updateMany({
      where: { id: taskId, status: task.status },
      data: { status: 'waiting_for_approval' },
    })
  }
  return approval
}

export type ApprovalDecision = 'grant' | 'deny'

/** Owner decision on a requested approval. The decision binds to the digest. */
export async function decideTaskApproval(
  taskId: string,
  approvalId: string,
  decision: ApprovalDecision,
) {
  const res = await db.trustApproval.updateMany({
    where: { id: approvalId, taskId, status: 'requested' },
    data: { status: decision === 'grant' ? 'granted' : 'denied', decidedAt: new Date() },
  })
  if (res.count !== 1) {
    throw new TrustStateError('Approval is not in the "requested" state (or was decided concurrently).')
  }
  return decision === 'grant' ? 'granted' : 'denied'
}

export type ConsumeResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_granted' | 'expired' | 'already_consumed' }

/**
 * Atomically consume a granted approval immediately BEFORE performing the
 * action. Consume-once: a second attempt with the same approval returns
 * { ok: false, reason: 'already_consumed' } — duplicate side effects are
 * structurally prevented, and the caller must check the result.
 */
export async function consumeTaskApproval(taskId: string, approvalId: string): Promise<ConsumeResult> {
  const now = new Date()
  const res = await db.trustApproval.updateMany({
    where: {
      id: approvalId,
      taskId,
      status: 'granted',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    data: { status: 'consumed', consumedAt: now },
  })
  if (res.count === 1) return { ok: true }
  const row = await db.trustApproval.findUnique({ where: { id: approvalId } })
  if (!row || row.taskId !== taskId) return { ok: false, reason: 'not_found' }
  if (row.status === 'granted' && row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    await db.trustApproval.updateMany({
      where: { id: approvalId, status: 'granted' },
      data: { status: 'expired' },
    })
    return { ok: false, reason: 'expired' }
  }
  if (row.status === 'consumed') return { ok: false, reason: 'already_consumed' }
  return { ok: false, reason: 'not_granted' }
}

/** Expire stale approvals for a task (requested or granted but past expiry). */
export async function expireStaleTaskApprovals(taskId: string): Promise<number> {
  const res = await db.trustApproval.updateMany({
    where: {
      taskId,
      status: { in: ['requested', 'granted'] },
      expiresAt: { lte: new Date() },
    },
    data: { status: 'expired' },
  })
  return res.count
}

/** Resume a waiting task after its pending approvals were decided. */
export async function resumeTaskAfterApprovals(taskId: string) {
  const pending = await db.trustApproval.count({ where: { taskId, status: 'requested' } })
  if (pending > 0) return false
  const res = await db.trustTask.updateMany({
    where: { id: taskId, status: 'waiting_for_approval' },
    data: { status: 'running' },
  })
  return res.count === 1
}
