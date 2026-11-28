/**
 * BEAN Intelligence — M49.1 BEAN AUTOBOTS agent history API (owner-only).
 *
 * GET /api/autobots/agents/[id]/history?conversationId=… → the workspace
 * transcript for ONE conversation, oldest-first, with the same honest
 * orchestration metadata the RIISHE view shows (sources, states,
 * verification). Ownership enforced on BOTH the agent and the conversation;
 * foreign ids are honest 404s. Without a conversationId, the agent's most
 * recent conversation is served.
 */
import { ok, handle } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { getAgentRow } from '@/lib/autobots/agent-service'
import { resolveAgentConversation } from '@/lib/autobots/agent-run'
import { AUTOBOT_LIMITS } from '@/lib/autobots/catalog'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    // Agent existence + ownership first (honest 404 for foreign ids).
    await getAgentRow(user.id, id)
    const conversationId = new URL(request.url).searchParams.get('conversationId') ?? undefined
    const { conversationId: convId } = await resolveAgentConversation(user.id, id, conversationId)
    const rows = await db.autobotMessage.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: 'asc' },
      take: AUTOBOT_LIMITS.historyPageSize,
    })
    return ok({
      conversationId: convId,
      messages: rows.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        latencyMs: m.latencyMs,
        metadata: m.metadata,
      })),
    })
  })
}
