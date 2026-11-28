/**
 * BEAN Intelligence — M49.1 BEAN AUTOBOTS agent detail API (owner-only).
 *
 * GET    /api/autobots/agents/[id] → agent profile + workspace conversations.
 * PATCH  /api/autobots/agents/[id] → bounded field updates / archive /
 *          unarchive (status). Capability changes stay in the fixed
 *          vocabulary; nothing here can widen execution permissions beyond
 *          what the chosen capability authorizes.
 * DELETE /api/autobots/agents/[id] → hard delete (cascades this agent's
 *          conversations and messages only).
 *
 * Ownership is enforced on EVERY method: (id, userId) must match; a miss is
 * an honest 404 with no existence disclosure.
 */
import { z } from 'zod'
import { ok, handle, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { db } from '@/lib/db'
import {
  deleteAgent,
  duplicateAgent,
  getAgentRow,
  toAgentView,
  updateAgent,
  AgentValidationError,
} from '@/lib/autobots/agent-service'

const patchSchema = z.object({
  name: z.string().max(200).optional(),
  role: z.string().max(120).optional(),
  industry: z.string().max(160).optional(),
  description: z.string().max(2000).optional(),
  personality: z.string().max(2000).optional(),
  instructions: z.string().max(6000).optional(),
  language: z.string().max(120).optional(),
  capabilityKey: z.string().max(60).optional(),
  memoryMode: z.string().max(40).optional(),
  status: z.string().max(20).optional(),
  /** Convenience flag: duplicate the agent instead of patching. */
  duplicate: z.boolean().optional(),
})

function toApiError(e: unknown): Error {
  if (e instanceof AgentValidationError) return new BeanApiError('VALIDATION_ERROR', e.message)
  return e as Error
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const row = await getAgentRow(user.id, id)
    const conversations = await db.autobotConversation.findMany({
      where: { agentId: row.id, userId: user.id },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { id: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
    })
    return ok({
      agent: toAgentView(row),
      conversations: conversations.map((c) => ({
        id: c.id,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        messageCount: c._count.messages,
      })),
    })
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    try {
      const user = await requireUser()
      const { id } = await params
      const body = await parseBody(request, patchSchema)
      if (body.duplicate === true) {
        const agent = await duplicateAgent(user.id, id)
        return ok({ agent })
      }
      const { duplicate: _dup, ...patch } = body
      const agent = await updateAgent(user.id, id, patch)
      return ok({ agent })
    } catch (e) {
      throw toApiError(e)
    }
  })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const result = await deleteAgent(user.id, id)
    return ok(result)
  })
}
