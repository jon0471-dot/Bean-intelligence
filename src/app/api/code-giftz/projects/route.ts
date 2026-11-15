import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { sanitizeConversationTitle } from '@/lib/riishe/conversation-view'
import { recordAudit } from '@/lib/observability/metering'

/** CODE GIFTZ — project list for the sidebar (owner-scoped).
 *  M22 ADDITIVE: `?status=archived|all` extends the list beyond the default
 *  active-only view; every row now carries the persistence metadata. */
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const status = new URL(request.url).searchParams.get('status')
    const statusFilter = status === 'archived' ? 'archived' : status === 'all' ? undefined : 'active'
    const projects = await db.codeProject.findMany({
      where: { userId: user.id, ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: {
        _count: { select: { files: true, messages: true } },
      },
    })
    return ok({
      projects: projects.map((p) => ({
        id: p.id,
        // Schema truth: the display name column is `title` (no `name`).
        title: p.title,
        status: p.status,
        framework: p.framework,
        language: p.language,
        currentVersion: p.currentVersion,
        lastOpenedAt: p.lastOpenedAt,
        files: p._count.files,
        messages: p._count.messages,
        updatedAt: p.updatedAt,
      })),
    })
  })
}

/**
 * M22 — explicit project creation (owner-only). The chat flow still
 * auto-creates projects on the first message; this endpoint supports the
 * "create a project first" workflow with an honest empty state (no files,
 * no versions — version 0).
 */
const createSchema = z.object({
  title: z.string().min(1, 'Enter a project name.').max(500),
  description: z.string().max(2000).optional(),
})

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, createSchema)
    const title = sanitizeConversationTitle(body.title, 'New project')
    const description = body.description?.replace(/\s+/g, ' ').trim()
    const project = await db.codeProject.create({
      data: {
        userId: user.id,
        title,
        description: description && description.length > 0 ? description.slice(0, 2000) : null,
        status: 'active',
      },
    })
    await recordAudit({ actorId: user.id, action: 'code-giftz.project_create', target: project.id })
    return ok({
      project: {
        id: project.id,
        title: project.title,
        description: project.description,
        status: project.status,
        currentVersion: 0,
        createdAt: project.createdAt,
      },
    })
  })
}
