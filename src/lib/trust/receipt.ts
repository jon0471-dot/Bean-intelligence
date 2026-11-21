/**
 * BEAN Intelligence — Trust Engine execution receipt (composed view).
 *
 * The receipt IS the ledger: task + steps + evidence + approvals +
 * checkpoints composed read-only, with a sha-256 integrity digest over the
 * canonical receipt content. Nothing is copied into a separate store, so a
 * receipt can never drift from the real records.
 *
 * The digest excludes `generatedAt` (wall-clock) and includes everything
 * else, so the same ledger state always yields the same digest — any later
 * ledger mutation (impossible for terminal tasks; visible for active ones)
 * changes the digest.
 *
 * Secrecy note: receipts expose exactly what the ledger holds. Every ledger
 * writer is bounded and the adapters store provenance only — no secrets,
 * tokens or key material are ever written to trust rows.
 *
 * SERVER-ONLY.
 */

import { db } from '@/lib/db'
import { canonicalJson, sha256Hex } from './digest'
import { TrustNotFoundError } from './types'

export interface TrustReceiptStepView {
  seq: number
  kind: string
  title: string
  status: string
  detail: Record<string, unknown> | null
  errorNote: string | null
  startedAt: string | null
  finishedAt: string | null
}

export interface TrustReceiptEvidenceView {
  seq: number
  kind: string
  ref: string
  title: string | null
  locator: string | null
  digest: string | null
  origin: string
  note: string | null
  createdAt: string
}

export interface TrustReceiptApprovalView {
  id: string
  actionDigest: string
  action: Record<string, unknown> | null
  summary: string
  scope: string
  status: string
  requestedAt: string
  decidedAt: string | null
  consumedAt: string | null
}

export interface TrustReceiptCheckpointView {
  seq: number
  label: string
  status: string
  createdAt: string
}

export interface TrustReceipt {
  version: 1
  task: {
    id: string
    product: string
    kind: string
    title: string
    requestPreview: string | null
    requestChars: number | null
    status: string
    outcomeSummary: string | null
    verificationSummary: string | null
    limitations: string[]
    failureNote: string | null
    jobId: string | null
    conversationId: string | null
    projectId: string | null
    startedAt: string | null
    completedAt: string | null
    cancelledAt: string | null
    createdAt: string
  }
  steps: TrustReceiptStepView[]
  evidence: TrustReceiptEvidenceView[]
  approvals: TrustReceiptApprovalView[]
  checkpoints: TrustReceiptCheckpointView[]
  counts: { steps: number; evidence: number; approvals: number; checkpoints: number }
  receiptDigest: string
  generatedAt: string
}

function safeParse(json: string | null): Record<string, unknown> | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

/**
 * Compose the execution receipt for one task. Owner-scoped: pass the userId;
 * a mismatch returns null (IDOR-safe 404 at the route).
 */
export async function composeTrustReceipt(
  taskId: string,
  userId: string,
): Promise<TrustReceipt | null> {
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

  let limitations: string[] = []
  if (task.limitationsJson) {
    try {
      const parsed = JSON.parse(task.limitationsJson) as unknown
      if (Array.isArray(parsed)) limitations = parsed.map(String)
    } catch {
      limitations = []
    }
  }

  const steps: TrustReceiptStepView[] = task.steps.map((s) => ({
    seq: s.seq,
    kind: s.kind,
    title: s.title,
    status: s.status,
    detail: safeParse(s.detailJson),
    errorNote: s.errorNote,
    startedAt: iso(s.startedAt),
    finishedAt: iso(s.finishedAt),
  }))

  const evidence: TrustReceiptEvidenceView[] = task.evidence.map((e, i) => ({
    seq: i + 1,
    kind: e.kind,
    ref: e.ref,
    title: e.title,
    locator: e.locator,
    digest: e.digest,
    origin: e.origin,
    note: e.note,
    createdAt: e.createdAt.toISOString(),
  }))

  const approvals: TrustReceiptApprovalView[] = task.approvals.map((a) => ({
    id: a.id,
    actionDigest: a.actionDigest,
    action: safeParse(a.actionJson),
    summary: a.summary,
    scope: a.scope,
    status: a.status,
    requestedAt: a.requestedAt.toISOString(),
    decidedAt: iso(a.decidedAt),
    consumedAt: iso(a.consumedAt),
  }))

  const checkpoints: TrustReceiptCheckpointView[] = task.checkpoints.map((c) => ({
    seq: c.seq,
    label: c.label,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
  }))

  const receiptCore = {
    version: 1 as const,
    task: {
      id: task.id,
      product: task.product,
      kind: task.kind,
      title: task.title,
      requestPreview: task.requestPreview,
      requestChars: task.requestChars,
      status: task.status,
      outcomeSummary: task.outcomeSummary,
      verificationSummary: task.verificationSummary,
      limitations,
      failureNote: task.failureNote,
      jobId: task.jobId,
      conversationId: task.conversationId,
      projectId: task.projectId,
      startedAt: iso(task.startedAt),
      completedAt: iso(task.completedAt),
      cancelledAt: iso(task.cancelledAt),
      createdAt: task.createdAt.toISOString(),
    },
    steps,
    evidence,
    approvals,
    checkpoints,
    counts: {
      steps: steps.length,
      evidence: evidence.length,
      approvals: approvals.length,
      checkpoints: checkpoints.length,
    },
  }

  return {
    ...receiptCore,
    receiptDigest: sha256Hex(canonicalJson(receiptCore)),
    generatedAt: new Date().toISOString(),
  }
}
