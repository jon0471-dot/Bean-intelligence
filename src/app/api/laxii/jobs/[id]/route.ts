import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'

/** Poll a single LAXII job (owner-only). Status is reported exactly as it is. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const job = await db.generationJob.findUnique({ where: { id } })
    if (!job || job.userId !== user.id || job.product !== 'laxii') {
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
        // Prefer the owned result-asset URL: every completed generation is
        // registered as a real ImageAsset, and the UI's "Use as source" /
        // download flows key off the /api/laxii/assets/<id> shape. Falls back
        // to the raw job-image route for older rows without a stored asset.
        imageUrl:
          result && job.status === 'completed' ? (result.assetUrl ?? result.imageUrl ?? null) : null,
        width: result?.width,
        height: result?.height,
        format: result?.format,
        bytes: result?.bytes,
        durationMs: result?.durationMs,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      },
    })
  })
}
