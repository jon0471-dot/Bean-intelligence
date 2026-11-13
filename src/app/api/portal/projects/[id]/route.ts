/**
 * BEAN Intelligence — /api/portal/projects/:id (Phase 1 developer portal).
 *
 *   GET   — read an owned Project.
 *   PATCH — update permitted details (name, and status active|archived).
 *
 * Ownership is enforced centrally (requireOwnedProject): an unknown project
 * AND another user's project are indistinguishable — both 404, never a
 * presence leak. API-key principals are 403; no session is 401.
 */
import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireOwnedProject, projectView } from '@/lib/security/portal'
import { recordAudit } from '@/lib/observability/metering'
import { db } from '@/lib/db'

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  status: z.enum(['active', 'archived']).optional(),
})

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params
    const { project } = await requireOwnedProject(request, id)
    return ok({ project: projectView(project) })
  })
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params
    const { principal, project } = await requireOwnedProject(request, id)
    const body = await parseBody(request, patchSchema)
    if (body.name === undefined && body.status === undefined) {
      throw new BeanApiError('VALIDATION_ERROR', 'Nothing to update — provide a name and/or a status.')
    }
    const updated = await db.project.update({
      where: { id: project.id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim().slice(0, 100) || project.name } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      },
    })
    await recordAudit({
      actorId: principal.userId,
      action: 'portal.project_updated',
      target: project.id,
      meta: { name: body.name !== undefined, status: body.status ?? null },
    })
    return ok({ project: projectView(updated) })
  })
}
