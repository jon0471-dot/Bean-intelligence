/**
 * CODE GIFTZ — archive project (M22).
 *
 * Archiving hides a project from the default lists WITHOUT deleting anything
 * (files, messages and version history all stay). Owner-only; archiving an
 * already-archived project is an honest no-op. Restore is the inverse.
 */
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'

export async function POST(
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
    if (project.status === 'archived') {
      return ok({ project: { id, status: 'archived' }, alreadyArchived: true })
    }
    await db.codeProject.update({ where: { id }, data: { status: 'archived' } })
    await recordAudit({ actorId: user.id, action: 'code-giftz.project_archive', target: id })
    return ok({ project: { id, status: 'archived' } })
  })
}
