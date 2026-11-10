import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { removeGangziiFile } from '@/lib/gangzii/audio-upload'
import { recordAudit } from '@/lib/observability/metering'

/** Poll a single GANGZII job (owner-only). Status is reported exactly as it is. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const job = await db.generationJob.findUnique({ where: { id } })
    if (!job || job.userId !== user.id || job.product !== 'gangzii') {
      throw new BeanApiError('NOT_FOUND', 'Job not found.')
    }
    const result = job.resultJson ? (JSON.parse(job.resultJson) as Record<string, unknown>) : null
    return ok({
      job: {
        id: job.id,
        task: job.task,
        status: job.status,
        progress: job.progress,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        audioUrl: result && job.status === 'completed' ? result.audioUrl : null,
        transcript: result && job.status === 'completed' ? result.transcript : null,
        result,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
      },
    })
  })
}

/**
 * Delete a GANGZII job AND its stored audio (uploads + artifacts).
 * This is the user-facing data-rights control: deletion removes the database
 * row and every file referenced by the job, so nothing lingers on disk.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const job = await db.generationJob.findUnique({ where: { id } })
    if (!job || job.userId !== user.id || job.product !== 'gangzii') {
      throw new BeanApiError('NOT_FOUND', 'Job not found.')
    }

    // Collect every file this job owns, then delete for real.
    const files: string[] = []
    const paramsData = JSON.parse(job.paramsJson) as { uploadRelPath?: string }
    if (paramsData.uploadRelPath) files.push(paramsData.uploadRelPath)
    const result = job.resultJson ? (JSON.parse(job.resultJson) as Record<string, unknown>) : null
    if (job.task === 'speech-synthesis' && (job.status === 'completed' || job.status === 'failed')) {
      files.push(`${job.userId}/tts/${job.id}.wav`)
    }
    if (job.task === 'audio-conversion' && job.status === 'completed') {
      const target = (JSON.parse(job.paramsJson) as { target?: string }).target ?? 'wav'
      files.push(`${job.userId}/convert/${job.id}.${target}`)
    }
    for (const f of files) removeGangziiFile(f)

    await db.generationJob.delete({ where: { id: job.id } })
    await recordAudit({
      actorId: user.id,
      action: 'gangzii.job.delete',
      target: job.id,
      meta: { task: job.task, filesRemoved: files.length },
    })
    return ok({ deleted: true, id: job.id })
  })
}
