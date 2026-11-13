import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { sanitizeConversationTitle } from '@/lib/riishe/conversation-view'
import { z } from 'zod'
import { parseBody } from '@/lib/api/validate'

const renameSchema = z.object({
  title: z.string().min(1, 'Enter a title.').max(500),
})

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
        messages: messages.map((m) => {
          const meta = m.metaJson ? (JSON.parse(m.metaJson) as { changes?: Array<{ path: string; change: string }>; frontend?: unknown }) : {}
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            changes: meta.changes ?? [],
            // ADDITIVE: Frontend Intelligence summary (frontend turns only).
            ...(meta.frontend ? { frontend: meta.frontend } : {}),
          }
        }),
        files: files.map((f) => ({ path: f.path, content: f.content, origin: f.origin })),
      },
    })
  })
}

/**
 * Rename a project/conversation (owner-only). Same pure sanitizer RIISHE
 * uses, so the persisted title is exactly what the user typed (trimmed,
 * whitespace-collapsed, capped — never blank) and both products behave
 * identically. Renaming bumps updatedAt, so the conversation moves to the
 * top of the recents — the expected ChatGPT-style behavior.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, renameSchema)
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    const title = sanitizeConversationTitle(body.title, project.title)
    const updated = await db.codeProject.update({
      where: { id },
      data: { title },
    })
    return ok({ project: { id: updated.id, title: updated.title } })
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
