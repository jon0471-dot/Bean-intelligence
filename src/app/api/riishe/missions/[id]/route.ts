/**
 * GET /api/riishe/missions/[id] — owner-scoped mission progress (the
 * customer-safe view: per-task states, delivered artifacts summary, honest
 * failure notes). Unknown or foreign ids are honest 404s.
 */
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { getMissionForOwner, toProgressView } from '@/lib/riishe/mission/store'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const mission = await getMissionForOwner(id, user.id)
    if (!mission) throw new BeanApiError('NOT_FOUND', 'No mission with that id exists for this account.')
    const view = toProgressView(mission)
    if (!view) throw new BeanApiError('NOT_FOUND', 'No mission with that id exists for this account.')
    return ok({ mission: view })
  })
}
