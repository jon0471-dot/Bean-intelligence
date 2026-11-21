/**
 * BEAN Intelligence — Trust Engine approval decision (owner-only).
 *
 * POST /api/trust/tasks/[id]/approvals/[approvalId] — grant or deny a
 * requested approval. The decision binds to the sha-256 actionDigest recorded
 * at request time: the owner is deciding on the EXACT proposed action, and
 * the grant is consumed on use (single-action scope, never unlimited).
 */

import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { getTrustTaskForOwner } from '@/lib/trust/tasks'
import { decideTaskApproval, resumeTaskAfterApprovals } from '@/lib/trust/approvals'
import { TrustStateError } from '@/lib/trust/types'
import { recordAudit } from '@/lib/observability/metering'

const schema = z.object({
  decision: z.enum(['grant', 'deny']),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; approvalId: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id, approvalId } = await params
    const body = await parseBody(request, schema)

    const task = await getTrustTaskForOwner(id, user.id)
    if (!task) {
      throw new BeanApiError('NOT_FOUND', 'Task not found.')
    }

    try {
      const status = await decideTaskApproval(id, approvalId, body.decision)
      // Resuming is the executor's concern; when no requested approvals
      // remain, the task returns to running. A deny with remaining pending
      // approvals keeps the task paused.
      const resumed = body.decision === 'grant' ? await resumeTaskAfterApprovals(id) : false
      await recordAudit({
        actorId: user.id,
        action: body.decision === 'grant' ? 'trust.approval.grant' : 'trust.approval.deny',
        target: approvalId,
        meta: { taskId: id, resumed },
      })
      return ok({ approval: { id: approvalId, status }, taskResumed: resumed })
    } catch (err) {
      if (err instanceof TrustStateError) {
        throw new BeanApiError('VALIDATION_ERROR', err.message)
      }
      throw err
    }
  })
}
