import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'

/** Poll a single JAZMII job (owner-only). Reflects the stored status as-is. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const job = await db.generationJob.findUnique({ where: { id } })
    if (!job || job.userId !== user.id || job.product !== 'jazmii') {
      throw new BeanApiError('NOT_FOUND', 'Job not found.')
    }
    return ok({
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        queuedAt: job.queuedAt,
      },
    })
  })
}
