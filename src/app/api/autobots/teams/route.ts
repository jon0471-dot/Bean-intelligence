/**
 * BEAN Intelligence — M49.2 BEAN AUTOBOT TEAMS collection API.
 *
 * GET  /api/autobots/teams → the signed-in user's teams with member rosters
 *      and real mission stats (owner-scoped).
 * POST /api/autobots/teams → create a team (from scratch, or from a verified
 *      catalogue template via { templateKey } — which instantiates REAL
 *      agents through the SAME bounded agent-service path). Every field is
 *      re-validated server-side; membership rules (same-owner active agents,
 *      2..8 members, no duplicates) are enforced here.
 */
import { z } from 'zod'
import { ok, handle, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import {
  createTeam,
  createTeamFromTemplate,
  listTeams,
  normalizeTeamInput,
  TeamValidationError,
} from '@/lib/autobots/teams/team-service'

const createSchema = z.object({
  /** Create from a verified team template (composes real agent templates). */
  templateKey: z.string().min(1).max(80).optional(),
  /** Custom team fields (all re-validated server-side either way). */
  name: z.string().max(160).optional(),
  description: z.string().max(1200).optional(),
  workflowPreference: z.string().max(40).optional(),
  assignmentPreference: z.string().max(40).optional(),
  leaderAgentId: z.string().max(80).optional(),
  members: z
    .array(
      z.object({
        agentId: z.string().max(80),
        responsibility: z.string().max(600).optional(),
      }),
    )
    .max(32)
    .optional(),
})

/** TeamValidationError → honest 422 VALIDATION_ERROR (never a 500). */
function toApiError(e: unknown): Error {
  if (e instanceof TeamValidationError) return new BeanApiError('VALIDATION_ERROR', e.message)
  return e as Error
}

export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const teams = await listTeams(user.id)
    return ok({ teams })
  })
}

export async function POST(request: Request) {
  return handle(async () => {
    try {
      const user = await requireUser()
      const body = await parseBody(request, createSchema)
      if (body.templateKey) {
        const team = await createTeamFromTemplate(user.id, body.templateKey)
        return ok({ team }, { status: 201 })
      }
      const input = normalizeTeamInput(body)
      const team = await createTeam(user.id, input)
      return ok({ team }, { status: 201 })
    } catch (e) {
      throw toApiError(e)
    }
  })
}
