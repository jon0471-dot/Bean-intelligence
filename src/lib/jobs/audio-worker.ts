/**
 * BEAN Intelligence — GANGZII audio processors (2026-11-18).
 *
 * Wires the three GANGZII task types to REAL execution so the product stops
 * being an orphaned surface:
 *  - speech-synthesis     -> hostedAudioAdapter.synthesize (chunked gateway
 *                            TTS, WAV containers per chunk, one assembled
 *                            24 kHz mono WAV, defensive leading-tone guard)
 *  - audio-transcription  -> hostedAudioAdapter.transcribe (gateway ASR;
 *                            WAV/WebM uploads only — enforced upstream)
 *  - audio-conversion     -> hostedAudioAdapter.convert (deterministic local
 *                            ffmpeg transcode; dual-mono stereo is labeled,
 *                            and the produced file is verified with ffprobe
 *                            so a mono file can never be mislabeled stereo)
 *
 * Patterns mirror the LAXII image processor (checkpointed cooperative
 * cancellation, guarded completion writes, honest failure classes, usage
 * metering, job events). Nothing is faked: a job reaches `completed` only
 * with a real stored artifact or transcript.
 */

import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { recordUsage } from '@/lib/observability/metering'
import { hostedAudioAdapter } from '@/lib/adapters/hosted-audio'
import { GANGZII_STORAGE_ROOT, readGangziiFile } from '@/lib/gangzii/audio-upload'
import { appendJobEventSafe } from '@/lib/ai-engine/events'
import { getBackend } from '@/lib/registry/backends'

export type AudioJobRow = {
  id: string
  userId: string
  product: string
  task: string
  status: string
  paramsJson: string
  resultJson: string | null
  /** Engine claim owner (guarded writes); undefined for non-engine callers. */
  workerId?: string | null
}

/** Per-upstream-call budget (one TTS chunk / one ASR call). */
const TTS_CHUNK_TIMEOUT_MS = 60_000
const ASR_TIMEOUT_MS = 90_000
const CONVERT_TIMEOUT_MS = 120_000

async function updateJob(id: string, data: Record<string, unknown>) {
  await db.generationJob.update({ where: { id }, data })
}

async function isCancelRequested(id: string): Promise<boolean> {
  const row = await db.generationJob.findUnique({ where: { id }, select: { cancelRequested: true } })
  return row?.cancelRequested === true
}

/** Guarded completion write: succeeds only when the job is still ours. */
async function completeJobGuarded(
  id: string,
  workerId: string | null | undefined,
  data: Record<string, unknown>,
): Promise<boolean> {
  const where: Record<string, unknown> = { id, status: 'running', cancelRequested: false }
  if (workerId) where.workerId = workerId
  const res = await db.generationJob.updateMany({ where, data })
  return res.count === 1
}

/** Honest cancellation settle at a checkpoint. */
async function settleCancelled(job: { id: string; userId: string; task: string }, workerId: string | null | undefined, when: string): Promise<void> {
  const where: Record<string, unknown> = { id: job.id, cancelRequested: true }
  if (workerId) where.workerId = workerId
  await db.generationJob.updateMany({
    where,
    data: {
      status: 'cancelled',
      finishedAt: new Date(),
      errorCode: 'CANCELLED',
      errorMessage: `Job cancelled by the user ${when} it completed.`,
    },
  })
  logger.info('gangzii.audio_job_cancelled', { jobId: job.id, task: job.task, when })
}

/** Classify an upstream failure honestly (rate limits are transient). */
function classifyAudioError(error: unknown): { errorClass: 'rate_limited' | 'permanent'; errorCode: string } {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('429')) return { errorClass: 'rate_limited', errorCode: 'RATE_LIMITED' }
  if (message.includes('abort') || message.toLowerCase().includes('timeout')) {
    return { errorClass: 'rate_limited', errorCode: 'UPSTREAM_TIMEOUT' }
  }
  return { errorClass: 'permanent', errorCode: 'UPSTREAM_FAILURE' }
}

function audioArtifactUrl(jobId: string): string {
  return `/api/gangzii/audio/${jobId}`
}

// ---------------------------------------------------------------------------
// Speech synthesis
// ---------------------------------------------------------------------------

export async function processSpeechSynthesisJob(job: AudioJobRow): Promise<void> {
  const startedAt = new Date()
  const params = JSON.parse(job.paramsJson || '{}') as {
    text?: string
    voice?: string
    speed?: number
    source?: string
  }
  const backendId = getBackend('bean-audio-tts-hosted-primary')?.id ?? 'bean-audio-tts-hosted-primary'

  if (!params.text || !params.voice || typeof params.speed !== 'number') {
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      errorClass: 'permanent',
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'The speech job is missing its text, voice or speed parameters.',
    })
    return
  }

  if (await isCancelRequested(job.id)) {
    await settleCancelled(job, job.workerId, 'before synthesis started')
    return
  }

  await updateJob(job.id, { status: 'running', startedAt, progress: 10 })
  await appendJobEventSafe(job.id, 'stage', { stage: 'synthesis', note: 'Synthesizing speech with the authorized gateway.' })

  try {
    const result = await hostedAudioAdapter.synthesize({
      text: params.text,
      voice: params.voice,
      speed: params.speed,
      timeoutMs: TTS_CHUNK_TIMEOUT_MS,
      onProgress: ({ chunk, totalChunks }) => {
        const fraction = totalChunks > 0 ? chunk / totalChunks : 1
        const progress = 15 + Math.round(80 * fraction)
        void updateJob(job.id, { progress }).catch(() => undefined)
        void appendJobEventSafe(job.id, 'progress', {
          progress,
          chunk,
          totalChunks,
          note: `Synthesized chunk ${chunk} of ${totalChunks}.`,
        }).catch(() => undefined)
      },
    })

    if (await isCancelRequested(job.id)) {
      await settleCancelled(job, job.workerId, 'after synthesis finished (artifact discarded)')
      return
    }

    // Persist the artifact OUTSIDE /public; delivery goes through the
    // owner-checked /api/gangzii/audio/[id] route (same contract the routes
    // and UI already expect).
    const outDir = path.join(GANGZII_STORAGE_ROOT, job.userId, 'tts')
    fs.mkdirSync(outDir, { recursive: true })
    const outPath = path.join(outDir, `${job.id}.wav`)
    fs.writeFileSync(outPath, result.wav)

    const completed = await completeJobGuarded(job.id, job.workerId, {
      status: 'completed',
      progress: 100,
      finishedAt: new Date(),
      resultJson: JSON.stringify({
        audioUrl: audioArtifactUrl(job.id),
        chunks: result.chunks,
        durationSec: Math.round(result.durationSec * 100) / 100,
        sampleRateHz: result.sampleRateHz,
        beepStripped: result.beepStripped,
        beepStrippedSamples: result.beepStrippedSamples,
        synthesisMs: result.durationMs,
        voice: params.voice,
        speed: params.speed,
        source: params.source ?? 'studio',
      }),
    })
    if (!completed) {
      // Cancelled mid-write: the guarded CAS refused the completion. The
      // artifact is removed so no orphan file lingers.
      try {
        fs.rmSync(outPath)
      } catch {
        /* best-effort cleanup */
      }
    }

    await recordUsage({
      userId: job.userId,
      product: 'gangzii',
      backendId,
      kind: 'speech-synthesis',
      success: true,
      durationMs: Date.now() - startedAt.getTime(),
    })
    logger.info('gangzii.tts_completed', {
      jobId: job.id,
      chunks: result.chunks,
      durationSec: Math.round(result.durationSec * 100) / 100,
    })
  } catch (error) {
    const cls = classifyAudioError(error)
    const message = error instanceof Error ? error.message.slice(0, 400) : 'Speech synthesis failed.'
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      errorClass: cls.errorClass,
      errorCode: cls.errorCode,
      errorMessage: message,
    })
    await recordUsage({
      userId: job.userId,
      product: 'gangzii',
      backendId,
      kind: 'speech-synthesis',
      success: false,
      errorCode: cls.errorCode,
      durationMs: Date.now() - startedAt.getTime(),
    })
    logger.warn('gangzii.tts_failed', { jobId: job.id, errorCode: cls.errorCode })
  }
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

export async function processTranscriptionJob(job: AudioJobRow): Promise<void> {
  const startedAt = new Date()
  const params = JSON.parse(job.paramsJson || '{}') as {
    uploadRelPath?: string
    container?: string
    displayName?: string
  }
  const backendId = getBackend('bean-audio-asr-hosted-primary')?.id ?? 'bean-audio-asr-hosted-primary'

  if (!params.uploadRelPath) {
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      errorClass: 'permanent',
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'The transcription job has no uploaded audio attached.',
    })
    return
  }

  if (await isCancelRequested(job.id)) {
    await settleCancelled(job, job.workerId, 'before transcription started')
    return
  }

  await updateJob(job.id, { status: 'running', startedAt, progress: 20 })
  await appendJobEventSafe(job.id, 'stage', { stage: 'transcription', note: 'Transcribing with the authorized gateway.' })

  try {
    const bytes = readGangziiFile(params.uploadRelPath, job.userId)
    const transcript = await hostedAudioAdapter.transcribe({
      wavOrWebm: bytes,
      timeoutMs: ASR_TIMEOUT_MS,
    })

    if (await isCancelRequested(job.id)) {
      await settleCancelled(job, job.workerId, 'after transcription finished')
      return
    }

    await completeJobGuarded(job.id, job.workerId, {
      status: 'completed',
      progress: 100,
      finishedAt: new Date(),
      resultJson: JSON.stringify({
        transcript,
        audioUrl: audioArtifactUrl(job.id),
        displayName: params.displayName ?? 'audio',
        container: params.container ?? 'wav',
      }),
    })
    await recordUsage({
      userId: job.userId,
      product: 'gangzii',
      backendId,
      kind: 'audio-transcription',
      success: true,
      durationMs: Date.now() - startedAt.getTime(),
    })
    logger.info('gangzii.transcribe_completed', { jobId: job.id, chars: transcript.length })
  } catch (error) {
    const cls = classifyAudioError(error)
    const message = error instanceof Error ? error.message.slice(0, 400) : 'Transcription failed.'
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      errorClass: cls.errorClass,
      errorCode: cls.errorCode,
      errorMessage: message,
    })
    await recordUsage({
      userId: job.userId,
      product: 'gangzii',
      backendId,
      kind: 'audio-transcription',
      success: false,
      errorCode: cls.errorCode,
      durationMs: Date.now() - startedAt.getTime(),
    })
    logger.warn('gangzii.transcribe_failed', { jobId: job.id, errorCode: cls.errorCode })
  }
}

// ---------------------------------------------------------------------------
// Deterministic conversion (local ffmpeg)
// ---------------------------------------------------------------------------

/** ffprobe verification of the produced file's channel layout. */
async function probeAudioChannels(file: string, timeoutMs = 20_000): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'json', file],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(new Error(`ffprobe verification failed: ${String(err.message).slice(-200)}`))
          return
        }
        try {
          const parsed = JSON.parse(stdout) as { streams?: Array<{ channels?: number }> }
          const channels = parsed.streams?.[0]?.channels
          if (typeof channels !== 'number') {
            reject(new Error('ffprobe could not read the produced audio stream.'))
            return
          }
          resolve(channels)
        } catch (e) {
          reject(new Error(`ffprobe output was not valid JSON: ${e instanceof Error ? e.message : String(e)}`))
        }
      },
    )
  })
}

export async function processConversionJob(job: AudioJobRow): Promise<void> {
  const startedAt = new Date()
  const params = JSON.parse(job.paramsJson || '{}') as {
    uploadRelPath?: string
    target?: string
    channels?: string
    displayName?: string
  }
  const backendId = 'bean-audio-tools-local'

  const target = params.target
  const channelsParam = params.channels === 'stereo' ? 2 : 1
  if (!target || !params.uploadRelPath) {
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      errorClass: 'permanent',
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'The conversion job is missing its source audio or target format.',
    })
    return
  }

  if (await isCancelRequested(job.id)) {
    await settleCancelled(job, job.workerId, 'before conversion started')
    return
  }

  await updateJob(job.id, { status: 'running', startedAt, progress: 15 })
  await appendJobEventSafe(job.id, 'stage', {
    stage: 'conversion',
    note: 'Converting with deterministic local ffmpeg (no model involved).',
  })

  try {
    // The source file already exists on disk (uploads and completed speech
    // artifacts are both stored under the gangzii storage root). Resolve it
    // through the same owner-checked path rules as the delivery route.
    const sourceAbs = path.join(GANGZII_STORAGE_ROOT, params.uploadRelPath)
    if (!sourceAbs.startsWith(GANGZII_STORAGE_ROOT) || !sourceAbs.includes(job.userId)) {
      throw new Error('INTERNAL_ERROR: invalid source path.')
    }
    if (!fs.existsSync(sourceAbs)) {
      throw new Error('The source audio file is no longer available on disk.')
    }

    const outDir = path.join(GANGZII_STORAGE_ROOT, job.userId, 'convert')
    fs.mkdirSync(outDir, { recursive: true })
    const outPath = path.join(outDir, `${job.id}.${target}`)

    await updateJob(job.id, { progress: 40 })
    await hostedAudioAdapter.convert({
      inputPath: sourceAbs,
      outputPath: outPath,
      target: target as 'mp3' | 'ogg' | 'flac' | 'm4a' | 'wav',
      channels: channelsParam === 2 ? 2 : 1,
      timeoutMs: CONVERT_TIMEOUT_MS,
    })

    // TRUTH POLICY: verify what was actually produced. A "stereo" export
    // that came back mono fails loudly instead of being mislabeled.
    const producedChannels = await probeAudioChannels(outPath)
    if (channelsParam === 2 && producedChannels !== 2) {
      try {
        fs.rmSync(outPath)
      } catch {
        /* cleanup is best-effort */
      }
      throw new Error(
        `The conversion produced ${producedChannels} channel(s) but a stereo export was requested; the output was discarded rather than mislabeled.`,
      )
    }

    if (await isCancelRequested(job.id)) {
      await settleCancelled(job, job.workerId, 'after conversion finished (artifact discarded)')
      return
    }

    const completed = await completeJobGuarded(job.id, job.workerId, {
      status: 'completed',
      progress: 100,
      finishedAt: new Date(),
      resultJson: JSON.stringify({
        audioUrl: audioArtifactUrl(job.id),
        target,
        channels: producedChannels === 2 ? 'dual-mono-stereo' : 'mono',
        displayName: params.displayName ?? 'audio',
        bytes: fs.existsSync(outPath) ? fs.statSync(outPath).size : null,
      }),
    })
    if (!completed) {
      try {
        fs.rmSync(outPath)
      } catch {
        /* best-effort cleanup */
      }
    }
    await recordUsage({
      userId: job.userId,
      product: 'gangzii',
      backendId,
      kind: 'audio-conversion',
      success: true,
      durationMs: Date.now() - startedAt.getTime(),
    })
    logger.info('gangzii.convert_completed', { jobId: job.id, target, channels: producedChannels })
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : 'Conversion failed.'
    await updateJob(job.id, {
      status: 'failed',
      finishedAt: new Date(),
      errorClass: 'permanent',
      errorCode: 'CONVERSION_FAILED',
      errorMessage: message,
    })
    await recordUsage({
      userId: job.userId,
      product: 'gangzii',
      backendId,
      kind: 'audio-conversion',
      success: false,
      errorCode: 'CONVERSION_FAILED',
      durationMs: Date.now() - startedAt.getTime(),
    })
    logger.warn('gangzii.convert_failed', { jobId: job.id })
  }
}
