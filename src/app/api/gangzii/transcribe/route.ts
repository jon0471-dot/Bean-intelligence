import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { enqueueJob } from '@/lib/jobs/queue'
import { recordAudit } from '@/lib/observability/metering'
import { persistAudioUpload } from '@/lib/gangzii/audio-upload'
import { BeanApiError } from '@/lib/api/errors'

/**
 * GANGZII — Audio Lab upload + transcription.
 * multipart/form-data, field "file". Container identity is decided by magic
 * bytes; WAV/WebM only (the ASR gateway rejects everything else — measured).
 * The upload is stored owner-scoped and processed as a real async job.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new BeanApiError('VALIDATION_ERROR', 'Send the audio as multipart/form-data (field "file").')
    }
    const file = form.get('file')
    if (!(file instanceof File)) {
      throw new BeanApiError('VALIDATION_ERROR', 'Attach an audio file in the "file" field.')
    }

    const { backend, release } = await preflight(user.id, 'gangzii', 'audio-transcription')
    release() // queue slot is held by the worker

    const upload = persistAudioUpload(user.id, Buffer.from(await file.arrayBuffer()))

    const job = await db.generationJob.create({
      data: {
        userId: user.id,
        product: 'gangzii',
        task: 'audio-transcription',
        status: 'queued',
        backendId: backend.id,
        paramsJson: JSON.stringify({
          uploadRelPath: upload.relPath,
          container: upload.container,
          displayName: file.name.slice(0, 120) || 'audio',
        }),
      },
    })

    await recordAudit({
      actorId: user.id,
      action: 'gangzii.transcribe.submit',
      target: job.id,
      meta: { container: upload.container, bytes: upload.bytes },
    })

    enqueueJob(job.id)

    return ok(
      { job: { id: job.id, status: job.status, progress: job.progress, container: upload.container } },
      { status: 202 },
    )
  })
}

/** Transcription history (newest first). */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const jobs = await db.generationJob.findMany({
      where: { userId: user.id, product: 'gangzii', task: 'audio-transcription' },
      orderBy: { queuedAt: 'desc' },
      take: 40,
    })
    return ok({
      jobs: jobs.map((j) => {
        const params = JSON.parse(j.paramsJson) as { displayName?: string; container?: string }
        const result = j.resultJson ? (JSON.parse(j.resultJson) as Record<string, unknown>) : null
        return {
          id: j.id,
          status: j.status,
          progress: j.progress,
          displayName: params.displayName ?? 'audio',
          container: params.container ?? null,
          errorCode: j.errorCode,
          errorMessage: j.errorMessage,
          transcript: result && j.status === 'completed' ? result.transcript : null,
          audioUrl: result && j.status === 'completed' ? result.audioUrl : null,
          bytes: result?.bytes,
          queuedAt: j.queuedAt,
          finishedAt: j.finishedAt,
        }
      }),
    })
  })
}
