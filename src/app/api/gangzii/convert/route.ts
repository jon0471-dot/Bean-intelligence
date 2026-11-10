import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { enqueueJob } from '@/lib/jobs/queue'
import { recordAudit } from '@/lib/observability/metering'
import { persistAudioUpload } from '@/lib/gangzii/audio-upload'
import { BeanApiError } from '@/lib/api/errors'

const formSchema = z.object({
  target: z.enum(['mp3', 'ogg', 'flac', 'm4a', 'wav'], {
    message: 'Choose a supported output format.',
  }),
  /** 'stereo' duplicates the mono source into L/R (dual-mono export). */
  channels: z.enum(['mono', 'stereo']).default('mono'),
  /**
   * Optional: export an EXISTING GANGZII audio asset (e.g. a completed
   * speech job) instead of a fresh upload. The source file itself is
   * preserved untouched — the export becomes a NEW converted artifact.
   */
  sourceJobId: z.string().regex(/^[\w-]+$/).optional(),
})

/**
 * GANGZII — Audio Lab format conversion + mono/stereo export.
 *
 * multipart/form-data, fields "file" (or "sourceJobId") + "target" +
 * optional "channels". Deterministic local ffmpeg transcoding (no model):
 * magic-byte container sniffing for uploads, owner-checked source assets,
 * 25 MiB cap, per-user storage. The requested channel configuration is
 * verified against the produced file with ffprobe by the queue worker, so
 * a "stereo" export that came back mono would fail loudly instead of
 * being mislabeled.
 *
 * TRUTH POLICY: the speech provider emits MONO. A stereo export duplicates
 * the mono signal into L/R (dual-mono) and is labeled as such — it is NOT
 * spatial stereo and creates no stereo separation.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      throw new BeanApiError(
        'VALIDATION_ERROR',
        'Send the audio as multipart/form-data (fields "file" or "sourceJobId", "target", optional "channels").',
      )
    }
    const parsed = formSchema.safeParse({
      target: form.get('target'),
      channels: form.get('channels') ?? 'mono',
      sourceJobId: form.get('sourceJobId') || undefined,
    })
    if (!parsed.success) {
      throw new BeanApiError('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid conversion parameters.')
    }
    const { target, channels, sourceJobId } = parsed.data

    let upload: { relPath: string; container: 'wav' | 'webm'; bytes: number } | null = null
    let displayName = 'audio'

    if (sourceJobId) {
      // Export an existing owner-checked GANGZII artifact (speech output,
      // transcription upload or previous conversion).
      const source = await db.generationJob.findUnique({ where: { id: sourceJobId } })
      if (!source || source.userId !== user.id || source.product !== 'gangzii' || source.status !== 'completed') {
        throw new BeanApiError('NOT_FOUND', 'The source audio job was not found or is not ready.')
      }
      const sourceResult = source.resultJson ? (JSON.parse(source.resultJson) as Record<string, unknown>) : null
      if (!sourceResult?.audioUrl) {
        throw new BeanApiError('VALIDATION_ERROR', 'The source job has no completed audio artifact to export.')
      }
      // Re-derive the artifact path exactly like the delivery route does.
      let relPath: string | null = null
      if (source.task === 'speech-synthesis') {
        relPath = `${source.userId}/tts/${source.id}.wav`
      } else if (source.task === 'audio-transcription') {
        relPath = (JSON.parse(source.paramsJson) as { uploadRelPath?: string }).uploadRelPath ?? null
      } else if (source.task === 'audio-conversion') {
        const t = (JSON.parse(source.paramsJson) as { target?: string }).target ?? 'wav'
        relPath = `${source.userId}/convert/${source.id}.${t}`
      }
      if (!relPath) {
        throw new BeanApiError('VALIDATION_ERROR', 'This job type has no exportable audio artifact.')
      }
      upload = { relPath, container: relPath.endsWith('.webm') ? 'webm' : 'wav', bytes: 0 }
      displayName = `export from ${source.id.slice(0, 8)}`
    } else {
      const file = form.get('file')
      if (!(file instanceof File)) {
        throw new BeanApiError('VALIDATION_ERROR', 'Attach an audio file in the "file" field or pass "sourceJobId".')
      }
      upload = persistAudioUpload(user.id, Buffer.from(await file.arrayBuffer()))
      displayName = file.name.slice(0, 120) || 'audio'
    }

    const { backend, release } = await preflight(user.id, 'gangzii', 'audio-conversion')
    release() // queue slot is held by the worker

    const job = await db.generationJob.create({
      data: {
        userId: user.id,
        product: 'gangzii',
        task: 'audio-conversion',
        status: 'queued',
        backendId: backend.id,
        paramsJson: JSON.stringify({
          uploadRelPath: upload.relPath,
          container: upload.container,
          target,
          channels, // 'mono' | 'stereo'
          sourceJobId: sourceJobId ?? null,
          displayName,
        }),
      },
    })

    await recordAudit({
      actorId: user.id,
      action: 'gangzii.convert.submit',
      target: job.id,
      meta: { container: upload.container, target, channels, sourceJobId: sourceJobId ?? null },
    })

    enqueueJob(job.id)

    return ok(
      {
        job: {
          id: job.id,
          status: job.status,
          progress: job.progress,
          container: upload.container,
          target,
          channels,
          // Truthful labeling up front — the UI mirrors it after completion.
          channelSemantics:
            channels === 'stereo'
              ? 'dual-mono export (the mono source duplicated to L/R — no spatial separation)'
              : 'mono (matches the source)',
        },
      },
      { status: 202 },
    )
  })
}

/** Conversion history (newest first) with real produced-file metadata. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const jobs = await db.generationJob.findMany({
      where: { userId: user.id, product: 'gangzii', task: 'audio-conversion' },
      orderBy: { queuedAt: 'desc' },
      take: 40,
    })
    return ok({
      jobs: jobs.map((j) => {
        const params = JSON.parse(j.paramsJson) as {
          displayName?: string
          container?: string
          target?: string
          channels?: string
        }
        const result = j.resultJson ? (JSON.parse(j.resultJson) as Record<string, unknown>) : null
        return {
          id: j.id,
          status: j.status,
          progress: j.progress,
          displayName: params.displayName ?? 'audio',
          container: params.container ?? null,
          target: params.target ?? null,
          channels: params.channels ?? 'mono',
          channelSemantics: result?.channelSemantics ?? null,
          errorCode: j.errorCode,
          errorMessage: j.errorMessage,
          audioUrl: result && j.status === 'completed' ? result.audioUrl : null,
          // Real ffprobe-verified metadata from the produced file:
          codec: result?.codec ?? null,
          sampleRateHz: result?.sampleRateHz ?? null,
          actualChannels: result?.channels ?? null,
          durationSec: result?.durationSec ?? null,
          bytes: result?.bytes,
          queuedAt: j.queuedAt,
          finishedAt: j.finishedAt,
        }
      }),
    })
  })
}
