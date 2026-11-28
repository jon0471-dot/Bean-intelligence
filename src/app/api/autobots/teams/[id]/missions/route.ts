/**
 * BEAN Intelligence — M49.2 team mission history API.
 *
 * GET /api/autobots/teams/[id]/missions → owner-scoped team missions with
 * the customer-safe progress contract (the EXISTING mission states), each
 * task's assigned member (from the immutable per-task assignment snapshot)
 * and the REAL admitted artifacts (project ids / asset refs) for follow-up
 * in the existing product surfaces.
 */
import { ok, handle } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { listTeamMissions } from '@/lib/autobots/teams/team-mission'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const take = Number(new URL(request.url).searchParams.get('take') ?? '10')
    const missions = await listTeamMissions(user.id, id, Number.isFinite(take) ? take : 10)
    return ok({ missions })
  })
}
