import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'

/**
 * CODE GIFTZ — project detail (owner-only): files (with contents for the
 * editor/preview) + the chat history.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const project = await db.codeProject.findUnique({
      where: { id },
      include: {
        files: { orderBy: { path: 'asc' } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    return ok({
      project: {
        id: project.id,
        // Schema truth (2026-10-29): CodeProject stores the display name in
        // `title`; files carry `origin` (generated|modified) — there is no
        // version column; messages keep their changes summary in `metaJson`.
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        files: project.files.map((f) => ({
          id: f.id,
          path: f.path,
          content: f.content,
          origin: f.origin,
          updatedAt: f.updatedAt,
        })),
        messages: project.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          metaJson: m.metaJson,
          createdAt: m.createdAt,
        })),
      },
    })
  })
}

/** Delete a project and its files/messages (owner-only, cascading). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    await db.codeProject.delete({ where: { id } })
    return ok({ deleted: true })
  })
}
