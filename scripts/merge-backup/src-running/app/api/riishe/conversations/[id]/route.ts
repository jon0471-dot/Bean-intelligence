import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'

/** Conversation detail with full message history (owner-only). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const conv = await db.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!conv || conv.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
    }
    return ok({
      conversation: {
        id: conv.id,
        title: conv.title,
        messages: conv.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          metadata: m.metadata,
        })),
      },
    })
  })
}

/** Delete a conversation and its messages (owner-only). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const conv = await db.conversation.findUnique({ where: { id } })
    if (!conv || conv.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
    }
    await db.conversation.delete({ where: { id } })
    return ok({ deleted: true })
  })
}
