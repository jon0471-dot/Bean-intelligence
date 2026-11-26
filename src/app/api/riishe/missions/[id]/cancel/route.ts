/**
 * POST /api/riishe/missions/[id]/cancel — owner-scoped cancellation request.
 * The mission runner polls the flag and propagates: it stops starting new
 * tasks, signals active specialist jobs to stop and cancels dependent tasks.
 * Already-finished tasks keep their recorded results.
 */
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { requestMissionCancel } from '@/lib/riishe/mission/store'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const cancelled = await requestMissionCancel(id, user.id)
    if (!cancelled) throw new BeanApiError('NOT_FOUND', 'No active mission with that id exists for this account.')
    return ok({ missionId: id, cancelRequested: true })
  })
}
