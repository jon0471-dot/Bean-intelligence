/**
 * BEAN Intelligence — Trust Engine task list (owner-only).
 *
 * GET /api/trust/tasks — the caller's execution receipts index: one row per
 * meaningful agent task, newest first. Statuses are the truthful lifecycle
 * (planned | waiting_for_approval | running | completed |
 * completed_with_limitations | partially_completed | failed | cancelled).
 *
 * Security: session-authenticated, owner-scoped rows only. No secrets are
 * stored in trust rows, so nothing can leak through this surface.
 */

import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { listTrustTasksForOwner } from '@/lib/trust/tasks'
import { TRUST_TASK_STATUSES } from '@/lib/trust/types'

const querySchema = z.object({
  status: z.string().optional(),
  product: z.enum(['riishe', 'laxii', 'jazmii', 'code-giftz']).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
})

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const url = new URL(request.url)
    const parsed = querySchema.safeParse({
      status: url.searchParams.get('status') ?? undefined,
      product: url.searchParams.get('product') ?? undefined,
      take: url.searchParams.get('take') ?? undefined,
    })
    if (!parsed.success) {
      throw new BeanApiError('VALIDATION_ERROR', 'Unknown filter value. Filter by a real task status or product.')
    }
    const { status, product, take } = parsed.data
    if (status && !(TRUST_TASK_STATUSES as readonly string[]).includes(status)) {
      throw new BeanApiError('VALIDATION_ERROR', `Unknown status filter "${status}".`)
    }
    const tasks = await listTrustTasksForOwner(user.id, { status, product, take })
    return ok({
      tasks: tasks.map((t) => ({
        id: t.id,
        product: t.product,
        kind: t.kind,
        title: t.title,
        status: t.status,
        jobId: t.jobId,
        createdAt: t.createdAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
      })),
    })
  })
}
