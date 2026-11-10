import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { enqueueJob } from '@/lib/jobs/queue'
import { recordAudit } from '@/lib/observability/metering'
import { GANGZII_VOICES, GANGZII_LIMITS } from '@/lib/registry/products'
import { TTS_SPEED_MIN, TTS_SPEED_MAX, chunkTextForTts } from '@/lib/adapters/hosted-audio'

const schema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Enter the text GANGZII should speak.')
    .max(GANGZII_LIMITS.maxCharsPerRequest),
  voice: z.enum(GANGZII_VOICES.map((v) => v.value) as [string, ...string[]], {
    message: 'Choose one of the seven GANGZII voices.',
  }),
  speed: z
    .number()
    .min(TTS_SPEED_MIN, `Speed must be between ${TTS_SPEED_MIN} and ${TTS_SPEED_MAX}.`)
    .max(TTS_SPEED_MAX, `Speed must be between ${TTS_SPEED_MIN} and ${TTS_SPEED_MAX}.`),
  /** Which studio surface submitted the job — used for truthful labeling in history. */
  source: z.enum(['studio', 'voice-preview', 'song-preview', 'live']).optional(),
})

/**
 * GANGZII — submit a speech-synthesis job.
 * The queue chunks the text on sentence boundaries (upstream limit: 1024
 * chars per call), synthesizes each chunk as raw PCM and assembles ONE
 * valid 24 kHz WAV. Jobs reach `completed` only when real audio is stored.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)
    const { backend, release } = await preflight(user.id, 'gangzii', 'speech-synthesis')
    release() // queue slot is held by the worker, not by this HTTP request

    // Fail fast on chunk overflow BEFORE persisting a doomed job.
    chunkTextForTts(body.text)

    const job = await db.generationJob.create({
      data: {
        userId: user.id,
        product: 'gangzii',
        task: 'speech-synthesis',
        status: 'queued',
        backendId: backend.id,
        paramsJson: JSON.stringify({
          text: body.text,
          voice: body.voice,
          speed: body.speed,
          source: body.source ?? 'studio',
        }),
      },
    })

    await recordAudit({
      actorId: user.id,
      action: 'gangzii.tts.submit',
      target: job.id,
      meta: { voice: body.voice, speed: body.speed, chars: body.text.length },
    })

    enqueueJob(job.id)

    return ok(
      {
        job: {
          id: job.id,
          status: job.status,
          progress: job.progress,
          voice: body.voice,
          speed: body.speed,
          source: body.source ?? 'studio',
          // The SOURCE asset is always the provider's original mono WAV.
          // Mono/stereo EXPORTS are separate, explicitly-labeled conversions.
          sourceChannels: 1,
        },
      },
      { status: 202 },
    )
  })
}

/** Voice Studio history (newest first). */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const jobs = await db.generationJob.findMany({
      where: { userId: user.id, product: 'gangzii', task: 'speech-synthesis' },
      orderBy: { queuedAt: 'desc' },
      take: 40,
    })
    return ok({
      jobs: jobs.map((j) => {
        const params = JSON.parse(j.paramsJson) as {
          voice?: string
          speed?: number
          text?: string
          source?: string
        }
        const result = j.resultJson ? (JSON.parse(j.resultJson) as Record<string, unknown>) : null
        return {
          id: j.id,
          status: j.status,
          progress: j.progress,
          voice: params.voice ?? null,
          speed: params.speed ?? null,
          text: params.text ?? null,
          source: params.source ?? 'studio',
          errorCode: j.errorCode,
          errorMessage: j.errorMessage,
          audioUrl: result && j.status === 'completed' ? result.audioUrl : null,
          chunks: result?.chunks,
          durationSec: result?.durationSec,
          bytes: result?.bytes,
          format: result?.format,
          sampleRateHz: result?.sampleRateHz,
          channels: result?.channels,
          channelLayout: result?.channelLayout,
          queuedAt: j.queuedAt,
          finishedAt: j.finishedAt,
        }
      }),
    })
  })
}
