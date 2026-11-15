import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { sanitizeConversationTitle } from '@/lib/riishe/conversation-view'
import { recordAudit } from '@/lib/observability/metering'

/**
 * CODE GIFTZ — project detail (owner-only): files (with contents for the
 * editor/preview) + the chat history.
 * M22 ADDITIVE: project metadata (description, framework, language, status,
 * lastOpenedAt, currentVersion). Existing response fields are unchanged.
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
        // M22 ADDITIVE metadata (honest values; nullable when unset).
        description: project.description,
        framework: project.framework,
        language: project.language,
        status: project.status,
        lastOpenedAt: project.lastOpenedAt,
        currentVersion: project.currentVersion,
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

/**
 * M22 — update project metadata (owner-only): rename (same sanitizer as the
 * chat route so both paths behave identically) and description edit.
 * Omitted fields stay untouched.
 */
const patchSchema = z.object({
  title: z.string().min(1, 'Enter a title.').max(500).optional(),
  description: z.string().max(2000).nullable().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, patchSchema)
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    const data: { title?: string; description?: string | null } = {}
    if (body.title !== undefined) data.title = sanitizeConversationTitle(body.title, project.title)
    if (body.description !== undefined) {
      const d = body.description?.replace(/\s+/g, ' ').trim() ?? ''
      data.description = d.length > 0 ? d.slice(0, 2000) : null
    }
    const updated = await db.codeProject.update({ where: { id }, data })
    await recordAudit({ actorId: user.id, action: 'code-giftz.project_update', target: id })
    return ok({
      project: {
        id: updated.id,
        title: updated.title,
        description: updated.description,
        updatedAt: updated.updatedAt,
      },
    })
  })
}

/** Delete a project and its files/messages (owner-only, cascading).
 *  M22: the delete also cascades to version history and content blobs
 *  (schema-level onDelete: Cascade). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    await db.codeProject.delete({ where: { id } })
    await recordAudit({ actorId: user.id, action: 'code-giftz.project_delete', target: id })
    return ok({ deleted: true })
  })
}
