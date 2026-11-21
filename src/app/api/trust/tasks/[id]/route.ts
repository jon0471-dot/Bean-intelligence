/**
 * BEAN Intelligence — Trust Engine task detail (owner-only).
 *
 * GET /api/trust/tasks/[id] — the full trust ledger for one task: planned vs
 * actually-attempted steps, evidence with provenance, scoped approvals and
 * checkpoints. IDOR-safe: the task must belong to the caller.
 */

import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { getTrustTaskForOwner } from '@/lib/trust/tasks'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const task = await getTrustTaskForOwner(id, user.id)
    if (!task) {
      throw new BeanApiError('NOT_FOUND', 'Task not found.')
    }
    return ok({
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
        limitations: task.limitationsJson ? safeParseArray(task.limitationsJson) : [],
        failureNote: task.failureNote,
        jobId: task.jobId,
        conversationId: task.conversationId,
        projectId: task.projectId,
        startedAt: task.startedAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        cancelledAt: task.cancelledAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
      },
      steps: task.steps.map((s) => ({
        seq: s.seq,
        kind: s.kind,
        title: s.title,
        status: s.status,
        detail: safeParseRecord(s.detailJson),
        errorNote: s.errorNote,
        startedAt: s.startedAt?.toISOString() ?? null,
        finishedAt: s.finishedAt?.toISOString() ?? null,
      })),
      evidence: task.evidence.map((e) => ({
        kind: e.kind,
        ref: e.ref,
        title: e.title,
        locator: e.locator,
        digest: e.digest,
        origin: e.origin,
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
      approvals: task.approvals.map((a) => ({
        id: a.id,
        actionDigest: a.actionDigest,
        summary: a.summary,
        scope: a.scope,
        status: a.status,
        requestedAt: a.requestedAt.toISOString(),
        decidedAt: a.decidedAt?.toISOString() ?? null,
        consumedAt: a.consumedAt?.toISOString() ?? null,
      })),
      checkpoints: task.checkpoints.map((c) => ({
        seq: c.seq,
        label: c.label,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
    })
  })
}

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function safeParseRecord(json: string | null): Record<string, unknown> | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
