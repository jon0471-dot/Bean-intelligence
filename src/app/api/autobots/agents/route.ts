/**
 * BEAN Intelligence — M49.1 BEAN AUTOBOTS agents collection API.
 *
 * GET  /api/autobots/agents → the signed-in user's agents (owner-scoped).
 * POST /api/autobots/agents → create an agent (from scratch or from a
 *      verified template via { templateKey }). Bounded fields, fixed
 *      capability vocabulary, per-account cap, rate-limited, audited.
 */
import { z } from 'zod'
import { ok, handle, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import {
  createAgent,
  listAgents,
  normalizeAgentInput,
  templateToInput,
  AgentValidationError,
} from '@/lib/autobots/agent-service'

const createSchema = z.object({
  /** Create from a verified catalogue template (bounds + capability seed). */
  templateKey: z.string().min(1).max(80).optional(),
  /** Custom agent fields (all re-validated server-side either way). */
  name: z.string().max(200).optional(),
  role: z.string().max(120).optional(),
  industry: z.string().max(160).optional(),
  description: z.string().max(2000).optional(),
  personality: z.string().max(2000).optional(),
  instructions: z.string().max(6000).optional(),
  language: z.string().max(120).optional(),
  capabilityKey: z.string().max(60).optional(),
  memoryMode: z.string().max(40).optional(),
})

/** AgentValidationError → honest 422 VALIDATION_ERROR (never a 500). */
function toApiError(e: unknown): Error {
  if (e instanceof AgentValidationError) return new BeanApiError('VALIDATION_ERROR', e.message)
  return e as Error
}

export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const agents = await listAgents(user.id)
    return ok({ agents })
  })
}

export async function POST(request: Request) {
  return handle(async () => {
    try {
      const user = await requireUser()
      const body = await parseBody(request, createSchema)
      // Templates instantiate through the SAME normalization as custom
      // agents: the seed is a starting point, never a validation bypass.
      if (body.templateKey) {
        const seed = templateToInput(body.templateKey)
        // Per-field overrides ride on top of the seed and are re-validated
        // through the same bounded normalization as any custom agent.
        const merged = normalizeAgentInput({ ...seed, ...body, templateKey: undefined })
        const agent = await createAgent(user.id, { ...merged, templateKey: body.templateKey })
        return ok({ agent }, { status: 201 })
      }
      const input = normalizeAgentInput(body)
      const agent = await createAgent(user.id, input)
      return ok({ agent }, { status: 201 })
    } catch (e) {
      throw toApiError(e)
    }
  })
}
