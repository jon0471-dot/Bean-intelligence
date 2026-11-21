import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { enqueueJob } from '@/lib/jobs/queue'
import { recordAudit } from '@/lib/observability/metering'
import { GANGZII_LIMITS } from '@/lib/registry/products'
import { GANGZII_VOICES, KOKORO_VOICE_PRESETS, isHostedVoice, isKokoroVoice } from '@/lib/registry/gangzii-presets'
import { TTS_SPEED_MIN, TTS_SPEED_MAX, chunkTextForTts } from '@/lib/adapters/hosted-audio'

const HOSTED_VOICE_IDS = GANGZII_VOICES.map((v) => v.value) as [string, ...string[]]
const KOKORO_VOICE_IDS = KOKORO_VOICE_PRESETS.map((v) => v.id) as [string, ...string[]]

const schema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Enter the text GANGZII should speak.')
    .max(GANGZII_LIMITS.maxCharsPerRequest),
  /** Voice id from EITHER engine catalog (hosted 7-voice set or the local
   *  Kokoro-82M set) — engine selection is voice-driven and never swaps. */
  voice: z
    .union([z.enum(HOSTED_VOICE_IDS), z.enum(KOKORO_VOICE_IDS)], {
      message: 'Choose one of the GANGZII voices (hosted or local-engine presets).',
    })
    .refine((v) => isHostedVoice(v) || isKokoroVoice(v), 'Unknown voice.'),
  speed: z
    .number()
    .min(TTS_SPEED_MIN, `Speed must be between ${TTS_SPEED_MIN} and ${TTS_SPEED_MAX}.`)
    .max(TTS_SPEED_MAX, `Speed must be between ${TTS_SPEED_MIN} and ${TTS_SPEED_MAX}.`),
  /** Which studio surface submitted the job — used for truthful labeling in history. */
  source: z.enum(['studio', 'voice-preview', 'song-preview', 'live', 'narration', 'narration-segment']).optional(),
  /** Narration linkage: segment id for per-segment regeneration receipts. */
  narrationSegmentId: z.string().regex(/^\w[\w-]{0,60}$/).optional(),
})

/**
 * GANGZII — submit a speech-synthesis job (M27: real audio worker).
 * Engine selection is VOICE-DRIVEN (deterministic, never a silent swap):
 *  - hosted preset (tongtong, …) → the authorized hosted gateway;
 *  - Kokoro voice (af_heart, …) → the local ONNX engine (an honest
 *    MODEL_NOT_INSTALLED failure if the owner has not installed it —
 *    no voice substitution).
 * The queue chunks text on sentence boundaries per the selected engine's
 * REAL limits, synthesizes each chunk and assembles ONE valid 24 kHz WAV.
 * Jobs reach `completed` only when real audio is stored and ffprobe-read.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)
    const { backend, release } = await preflight(user.id, 'gangzii', 'speech-synthesis')
    release() // queue slot is held by the worker, not by this HTTP request

    // Fail fast on chunk overflow BEFORE persisting a doomed job. The hosted
    // engine caps calls at 1024 chars; the local Kokoro engine splits at 400
    // — both are handled inside the worker, so only the REQUEST cap needs a
    // pre-flight here (chunkTextForTts also enforces the hosted chunk math
    // for hosted voices; local voices skip the 1024-chunk cap check).
    if (isHostedVoice(body.voice)) chunkTextForTts(body.text)

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
          narrationSegmentId: body.narrationSegmentId ?? null,
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
