/**
 * BEAN Intelligence — M49.2 team mission RUN API.
 *
 * POST /api/autobots/teams/[id]/run → validate the team (owner, active),
 * the members (same-owner, active), the deterministic M41 plan, the complete
 * assignment (a missing capability is a refusal that names the exact
 * requirement) and the active-mission guard — THEN record the immutable team
 * execution snapshot and submit the mission through the EXISTING store
 * (createMissionFromPlan → the SAME durable 'mission-run' job, the SAME
 * Trust task, the SAME duplicate guard). No second queue, no parallel
 * execution substrate.
 */
import { z } from 'zod'
import { ok, handle } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { runTeamMission } from '@/lib/autobots/teams/team-mission'

const runSchema = z.object({
  objective: z.string().min(1).max(8000),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, runSchema)
    const result = await runTeamMission(user.id, id, body.objective)
    return ok({ ...result }, { status: 201 })
  })
}
