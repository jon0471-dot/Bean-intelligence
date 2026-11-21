/**
 * CODE GIFTZ — project open (M22). Records the owner's open so the project
 * metadata can honestly show recency ("last opened"). Owner-only; opening is
 * a real metadata write, so it is an explicit POST (GETs stay side-effect
 * free).
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
    const now = new Date()
    await db.codeProject.update({ where: { id }, data: { lastOpenedAt: now } })
    await recordAudit({ actorId: user.id, action: 'code-giftz.project_open', target: id })
    return ok({
      project: {
        id: project.id,
        title: project.title,
        status: project.status,
        lastOpenedAt: now.toISOString(),
      },
    })
  })
}
