/**
 * CODE GIFTZ — restore archived project (M22). Owner-only inverse of archive.
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
    if (project.status === 'active') {
      return ok({ project: { id, status: 'active' }, alreadyActive: true })
    }
    await db.codeProject.update({ where: { id }, data: { status: 'active' } })
    await recordAudit({ actorId: user.id, action: 'code-giftz.project_restore', target: id })
    return ok({ project: { id, status: 'active' } })
  })
}
