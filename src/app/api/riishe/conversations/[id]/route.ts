import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { sanitizeConversationTitle } from '@/lib/riishe/conversation-view'

const renameSchema = z.object({
  title: z.string().min(1, 'Enter a title.').max(500),
})

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

/**
 * Rename a conversation (owner-only). The title is sanitized with the same
 * pure helper the client previews with, so what the user typed is exactly
 * what persists (trimmed, whitespace-collapsed, capped — never blank).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, renameSchema)
    const conv = await db.conversation.findUnique({ where: { id } })
    if (!conv || conv.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
    }
    const title = sanitizeConversationTitle(body.title, conv.title)
    const updated = await db.conversation.update({
      where: { id },
      data: { title },
    })
    return ok({ conversation: { id: updated.id, title: updated.title } })
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
