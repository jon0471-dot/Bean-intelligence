/**
 * BEAN Intelligence — M49.1 BEAN AUTOBOTS agent duplicate API (owner-only).
 *
 * POST /api/autobots/agents/[id]/duplicate → a fresh independent copy of the
 * agent profile (same bounded persona fields, same capability). Conversations
 * are NOT copied — the duplicate starts with an empty workspace.
 */
import { ok, handle, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { duplicateAgent, AgentValidationError } from '@/lib/autobots/agent-service'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    try {
      const user = await requireUser()
      const { id } = await params
      const agent = await duplicateAgent(user.id, id)
      return ok({ agent }, { status: 201 })
    } catch (e) {
      if (e instanceof AgentValidationError) throw new BeanApiError('VALIDATION_ERROR', e.message)
      throw e as Error
    }
  })
}
