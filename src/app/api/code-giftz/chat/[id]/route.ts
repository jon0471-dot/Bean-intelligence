import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'

/** Full project: messages (history) + files with contents (owner-only). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    const messages = await db.codeMessage.findMany({
      where: { projectId: id },
      orderBy: { createdAt: 'asc' },
    })
    const files = await db.codeFile.findMany({
      where: { projectId: id },
      orderBy: { path: 'asc' },
    })
    return ok({
      project: {
        id: project.id,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          changes: m.metaJson ? (JSON.parse(m.metaJson) as { changes?: Array<{ path: string; change: string }> }).changes ?? [] : [],
        })),
        files: files.map((f) => ({ path: f.path, content: f.content, origin: f.origin })),
      },
    })
  })
}

/** Delete a project (owner-only) — cascade removes messages and files. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
