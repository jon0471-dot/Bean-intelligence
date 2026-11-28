/**
 * BEAN Intelligence — M49.2 BEAN AUTOBOT TEAMS item API.
 *
 * GET    /api/autobots/teams/[id] → one team (owner-scoped; foreign ids are
 *        honest 404s).
 * PATCH  /api/autobots/teams/[id] → bounded edits (name/description/
 *        workflow+assignment preferences, roster replace, leader, archive/
 *        restore). Archiving refuses while a team mission is active.
 * DELETE /api/autobots/teams/[id] → delete (refused while a team mission is
 *        active — an active mission is never silently damaged).
 */
import { z } from 'zod'
import { ok, handle, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import {
  deleteTeam,
  getTeamView,
  normalizeTeamInput,
  TeamValidationError,
  updateTeam,
} from '@/lib/autobots/teams/team-service'

const patchSchema = z.object({
  name: z.string().max(160).optional(),
  description: z.string().max(1200).optional(),
  workflowPreference: z.string().max(40).optional(),
  assignmentPreference: z.string().max(40).optional(),
  leaderAgentId: z.string().max(80).nullable().optional(),
  members: z
    .array(
      z.object({
        agentId: z.string().max(80),
        responsibility: z.string().max(600).optional(),
      }),
    )
    .max(32)
    .optional(),
  status: z.string().max(20).optional(),
})

function toApiError(e: unknown): Error {
  if (e instanceof TeamValidationError) return new BeanApiError('VALIDATION_ERROR', e.message)
  return e as Error
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const team = await getTeamView(user.id, id)
    return ok({ team })
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    try {
      const user = await requireUser()
      const { id } = await params
      const body = await parseBody(request, patchSchema)
      // A roster replace re-runs the SAME bounded normalization as create;
      // plain field edits are validated individually inside updateTeam.
      const patch: {
        name?: string
        description?: string
        workflowPreference?: string
        assignmentPreference?: string
        leaderAgentId?: string | null
        members?: Array<{ agentId: string; responsibility: string }>
        status?: string
      } = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.workflowPreference !== undefined ? { workflowPreference: body.workflowPreference } : {}),
        ...(body.assignmentPreference !== undefined ? { assignmentPreference: body.assignmentPreference } : {}),
        ...(body.leaderAgentId !== undefined ? { leaderAgentId: body.leaderAgentId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      }
      if (body.members !== undefined) {
        const roster = normalizeTeamInput({
          name: body.name ?? 'x',
          description: body.description ?? '',
          workflowPreference: body.workflowPreference ?? 'auto',
          assignmentPreference: body.assignmentPreference ?? 'team-order',
          members: body.members.map((m) => ({ agentId: m.agentId, responsibility: m.responsibility })),
          leaderAgentId: body.leaderAgentId ?? null,
        })
        patch.members = roster.members
        patch.leaderAgentId = roster.leaderAgentId
      }
      const team = await updateTeam(user.id, id, patch)
      return ok({ team })
    } catch (e) {
      throw toApiError(e)
    }
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const result = await deleteTeam(user.id, id)
    return ok(result)
  })
}
