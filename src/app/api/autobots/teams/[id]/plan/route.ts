/**
 * BEAN Intelligence — M49.2 team mission PLAN preview API (READ-ONLY).
 *
 * POST /api/autobots/teams/[id]/plan → the deterministic M41 plan for the
 * given objective + the server-built member assignments. This endpoint
 * WRITES NOTHING and ENQUEUES NOTHING (pinned by tests: mission, task and
 * job row counts are unchanged after a call). The run endpoint performs the
 * full validation before any submission.
 */
import { z } from 'zod'
import { ok, handle } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { planTeamMission } from '@/lib/autobots/teams/team-mission'

const planSchema = z.object({
  objective: z.string().min(1).max(8000),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, planSchema)
    const preview = await planTeamMission(user.id, id, body.objective)
    // Honest shape: ok=false carries the deterministic gap messages (missing
    // member capability) so the UI can render exactly what is required.
    return ok({ plan: preview })
  })
}
