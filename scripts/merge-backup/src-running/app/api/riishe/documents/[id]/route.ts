/** Document metadata (owner-only). Text never leaves the server via this
 *  route — it reaches the model only through the chat pipeline. */
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const doc = await db.document.findUnique({
      where: { id },
      select: { id: true, userId: true, name: true, mime: true, size: true, truncated: true, createdAt: true },
    })
    if (!doc || doc.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Document not found.')
    }
    return ok({ document: doc })
  })
}

/** Delete an uploaded document (owner-only). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const doc = await db.document.findUnique({ where: { id } })
    if (!doc || doc.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Document not found.')
    }
    await db.document.delete({ where: { id } })
    return ok({ deleted: true })
  })
}
