import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { ensureVideoPoller } from '@/lib/jobs/video-worker'
import { normalizeJobStatus, serializeJazmiiMessages } from '@/lib/jazmii/chat'

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
    const conv = await db.jazmiiConversation.findUnique({ where: { id } })
    if (!conv || conv.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
    }
    const rows = await db.jazmiiMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
    // Keep inflight jobs in this thread tracking while it is open (recovery
    // parity with the legacy list route).
    const jobIds = Array.from(new Set(rows.map((r) => r.jobId).filter((v): v is string => Boolean(v))))
    if (jobIds.length > 0) {
      const inflight = await db.generationJob.findMany({
        where: { id: { in: jobIds }, status: { in: ['queued', 'running', 'starting', 'streaming', 'finalizing', 'retry_wait'] } },
      })
      for (const j of inflight) {
        ensureVideoPoller({
          id: j.id,
          userId: j.userId,
          product: j.product,
          task: j.task,
          status: normalizeJobStatus(j.status),
          paramsJson: j.paramsJson,
          resultJson: j.resultJson,
        })
      }
    }
    return ok({
      conversation: { id: conv.id, title: conv.title, updatedAt: conv.updatedAt.toISOString() },
      messages: await serializeJazmiiMessages(rows),
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
    const conv = await db.jazmiiConversation.findUnique({ where: { id } })
    if (!conv || conv.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
    }
    const updated = await db.jazmiiConversation.update({ where: { id }, data: { title: body.title } })
    return ok({ conversation: { id: updated.id, title: updated.title, updatedAt: updated.updatedAt.toISOString() } })
  })
}

/** Delete a conversation after explicit confirmation (client-side). Messages
 *  cascade; GenerationJob rows, media artifacts and provider recovery are
 *  NOT touched — completed videos keep existing under their own pipeline. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const conv = await db.jazmiiConversation.findUnique({ where: { id } })
    if (!conv || conv.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
    }
    await db.jazmiiConversation.delete({ where: { id } })
    return ok({ deleted: true })
  })
}

export const dynamic = 'force-dynamic'
