import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { serializeLaxiiMessages } from '@/lib/laxii/chat'

const patchSchema = z.object({
  title: z.string().min(1).max(120),
})

/** Load one conversation: every message with its LIVE linked job state. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const conv = await db.laxiiConversation.findUnique({ where: { id } })
    if (!conv || conv.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
    }
    const rows = await db.laxiiMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    return ok({
      conversation: { id: conv.id, title: conv.title, updatedAt: conv.updatedAt.toISOString() },
      messages: await serializeLaxiiMessages(rows),
    })
  })
}

/** Rename a conversation. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, patchSchema)
    const conv = await db.laxiiConversation.findUnique({ where: { id } })
    if (!conv || conv.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
    }
    const updated = await db.laxiiConversation.update({ where: { id }, data: { title: body.title } })
    return ok({ conversation: { id: updated.id, title: updated.title, updatedAt: updated.updatedAt.toISOString() } })
  })
}

/** Delete a conversation. Messages cascade; jobs and assets are NOT touched —
 *  they keep existing under their own pipelines and remain visible in the
 *  backfilled "Earlier generations" thread. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const conv = await db.laxiiConversation.findUnique({ where: { id } })
    if (!conv || conv.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
    }
    await db.laxiiConversation.delete({ where: { id } })
    return ok({ deleted: true })
  })
}

export const dynamic = 'force-dynamic'
