import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'

/**
 * Poll a single JAZMII job (owner-only). Reflects the stored status as-is.
 * The provider task id and provider URLs are PRIVATE — never included here.
 */
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
    const result = job.resultJson ? (JSON.parse(job.resultJson) as Record<string, unknown>) : null
    return ok({
      job: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        videoUrl: result && job.status === 'completed' ? result.videoUrl : null,
        format: result?.format,
        bytes: result?.bytes,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      },
    })
  })
}

/**
 * Cancel a queued/running video job (owner-only). Honest semantics: the
 * provider exposes no cancel API, so this STOPS TRACKING — stated verbatim
 * in the job record. A job already completed/failed cannot be cancelled.
 */
export async function DELETE(
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
    const { requestVideoCancel } = await import('@/lib/jobs/video-worker')
    const accepted = await requestVideoCancel(job.id)
    if (!accepted) {
      throw new BeanApiError(
        'VALIDATION_ERROR',
        'Only queued or running jobs can be cancelled.',
      )
    }
    return ok({ cancelled: true, id: job.id })
  })
}
