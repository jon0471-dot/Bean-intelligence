/**
 * BEAN Intelligence — M49.2 BEAN AUTOBOT TEAMS duplicate API.
 *
 * POST /api/autobots/teams/[id]/duplicate → an owner-scoped copy of the team
 * (same roster, same order, reset leader default). Same quotas and member
 * validation as a manual create.
 */
import { ok, handle } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { duplicateTeam } from '@/lib/autobots/teams/team-service'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const team = await duplicateTeam(user.id, id)
    return ok({ team }, { status: 201 })
  })
}
