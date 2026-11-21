/**
 * BEAN Intelligence — Trust Engine task cancellation (owner-only).
 *
 * POST /api/trust/tasks/[id]/cancel — the owner cancels a not-yet-settled
 * task. When the task runs on the durable queue, the cooperative cancel flag
 * is raised on the linked GenerationJob first (the worker observes it at its
 * natural checkpoints); the trust task itself settles as "cancelled" with a
 * truthful note. Already-settled tasks are rejected honestly, not silently.
 */

import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { getTrustTaskForOwner, cancelTrustTask } from '@/lib/trust/tasks'
import { TrustStateError } from '@/lib/trust/types'
import { requestCancel } from '@/lib/ai-engine/queue'
import { recordAudit } from '@/lib/observability/metering'

const schema = z.object({
  note: z.string().trim().min(1).max(400).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, schema).catch(() => ({ note: undefined }))
    const task = await getTrustTaskForOwner(id, user.id)
    if (!task) {
      throw new BeanApiError('NOT_FOUND', 'Task not found.')
    }

    // Raise the cooperative cancel flag on the linked job (if any) so the
    // worker stops at its next natural checkpoint. Best-effort: a queue
    // problem must not prevent the trust task from recording the cancel.
    let jobSignal: string | null = null
    if (task.jobId) {
      try {
        const result = await requestCancel(task.jobId)
        jobSignal = result
      } catch {
        jobSignal = null
      }
    }

    try {
      const cancelled = await cancelTrustTask(
        id,
        body.note?.trim() ||
          'Cancelled by the owner; execution stops at the next safe checkpoint and no result was produced.',
      )
      await recordAudit({
        actorId: user.id,
        action: 'trust.task_cancel',
        target: id,
        meta: { jobSignal, status: cancelled.status },
      })
      return ok({ task: { id: cancelled.id, status: cancelled.status }, jobSignal })
    } catch (err) {
      if (err instanceof TrustStateError) {
        throw new BeanApiError(
          'CONCURRENCY_LIMIT',
          'The task was settled concurrently (or is already terminal); its recorded outcome stands.',
        )
      }
      throw err
    }
  })
}
