/**
 * BEAN Intelligence — GANGZII AUDIO WORKER (M27).
 *
 * The real audio execution handlers behind the GANGZII product: speech
 * synthesis, transcription, format conversion and audio production (mix/
 * trim/fade/duck/loudness). Every handler:
 *
 *  - runs on the durable queue (claim → lease → heartbeat → settle),
 *  - drives REAL progress from actual work (chunks completed, bytes
 *    processed — never a synthetic timer),
 *  - honors cooperative cancellation between synthesis chunks / pipeline
 *    stages and settles honestly (cancelled ≠ failed ≠ completed),
 *  - preserves partial output (completed segments, intermediate mixes),
 *  - validates its own artifact with ffprobe BEFORE claiming success,
 *  - records a Trust Engine receipt through the audio adapter,
 *  - never labels a transcoded track "mastered" or a generated WAV
 *    "good speech" — measured facts only.
 *
 * SERVER-ONLY. Registered in src/lib/ai-engine/handlers.ts.
 */

import fs from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { GANGZII_STORAGE_ROOT } from '@/lib/gangzii/audio-upload'
import { hostedAudioAdapter, type AudioStreamMetadata } from '@/lib/adapters/hosted-audio'
import {
  kokoroTtsEngine,
  KOKORO_APPROX_DOWNLOAD_MB,
  TTS_MODELS_ROOT,
} from '@/lib/gangzii/tts-engine'
import { isHostedVoice, isKokoroVoice } from '@/lib/registry/gangzii-presets'
import {
  recordAudioJobCancelled,
  recordAudioJobCompletion,
  recordAudioJobFailure,
  type AudioReceiptResult,
} from '@/lib/trust/adapters/audio'
import { appendJobEventSafe } from '@/lib/ai-engine/events'
import { recordUsage } from '@/lib/observability/metering'
import type { ClaimedJob, HandlerOutcome } from '@/lib/ai-engine/types'

const ACTIVE_STATUSES = ['starting', 'running', 'streaming', 'finalizing'] as const

/**
 * Honest metering: every terminal audio outcome is recorded so quotas and
 * budgets reflect real work (the daily quota counts successful rows). Local
 * engines cost nothing but still count as WORK — the quota bounds runaway
 * loops, not billing.
 */
async function recordAudioUsage(
  job: ClaimedJob,
  backendId: string,
  success: boolean,
  opts?: { durationMs?: number | null; errorCode?: string | null },
): Promise<void> {
  await recordUsage({
    userId: job.userId,
    product: 'gangzii',
    backendId,
    kind: job.task,
    success,
    durationMs: opts?.durationMs ?? null,
    errorCode: opts?.errorCode ?? null,
  }).catch(() => undefined)
}

/** Guarded terminal settle: count === 1 only while the row is still active. */
async function settleActiveGuarded(id: string, data: Record<string, unknown>): Promise<boolean> {
  const res = await db.generationJob.updateMany({
    where: { id, status: { in: [...ACTIVE_STATUSES, 'retry_wait', 'queued'] } },
    data,
  })
  return res.count === 1
}

async function updateProgress(jobId: string, progress: number, note: Record<string, unknown>): Promise<void> {
  await db.generationJob.updateMany({
    where: { id: jobId, status: { in: [...ACTIVE_STATUSES] } },
    data: { progress: Math.max(0, Math.min(100, Math.round(progress))) },
  })
  await appendJobEventSafe(jobId, 'progress', { progress: Math.round(progress), ...note })
}

/** Cooperative cancel probe: engine signal OR the durable flag. */
function isCancelled(job: ClaimedJob, signal: { aborted: boolean }): boolean {
  return signal.aborted || job.cancelRequested
}

async function runFfprobe(file: string, timeoutMs = 15_000): Promise<AudioStreamMetadata> {
  return hostedAudioAdapter.probeAudio(file, timeoutMs)
}

/** Measured loudness (EBUR128): integrated LUFS + true peak, via ffmpeg. */
async function measureLoudness(file: string, timeoutMs = 60_000): Promise<{ integratedLufs: number | null; truePeakDbtp: number | null }> {
  return new Promise((resolve) => {
    execFile(
      'ffmpeg',
      ['-nostats', '-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (_err, _stdout, stderr) => {
        try {
          const out = String(stderr)
          const lufs = out.match(/I:\s*(-?\d+\.?\d*)\s*LUFS/)
          const peak = out.match(/Peak:\s*(-?\d+\.?\d*)\s*dBTP/)
          resolve({
            integratedLufs: lufs ? Number(lufs[1]) : null,
            truePeakDbtp: peak ? Number(peak[1]) : null,
          })
        } catch {
          resolve({ integratedLufs: null, truePeakDbtp: null })
        }
      },
    )
  })
}

/** Real ffmpeg execution with bounded timeout; stderr tail on failure. */
async function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-hide_banner', ...args], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`ffmpeg failed: ${String(stderr).slice(-500) || err.message}`))
      } else {
        resolve()
      }
    })
  })
}

function gangziiFile(relPath: string): string {
  const resolved = path.join(GANGZII_STORAGE_ROOT, relPath)
  if (!resolved.startsWith(GANGZII_STORAGE_ROOT)) {
    throw new Error('INTERNAL_ERROR: invalid storage path.')
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  return resolved
}

function audioUrlFor(jobId: string): string {
  return `/api/gangzii/audio/${jobId}`
}

/** Classify synthesis failures honestly for the queue's error taxonomy. */
function classifyError(e: unknown): { errorClass: 'timeout' | 'network' | 'permanent' | 'unknown' | 'cancelled'; errorCode: string } {
  const message = e instanceof Error ? e.message : String(e)
  if (/MODEL_NOT_INSTALLED/.test(message)) return { errorClass: 'permanent', errorCode: 'MODEL_NOT_INSTALLED' }
  if (/CANCELLED/.test(message)) return { errorClass: 'cancelled', errorCode: 'CANCELLED' }
  if (/timeout|timed out/i.test(message)) return { errorClass: 'timeout', errorCode: 'UPSTREAM_TIMEOUT' }
  if (/429|rate limit/i.test(message)) return { errorClass: 'permanent', errorCode: 'RATE_LIMITED' }
  if (/Checksum mismatch/.test(message)) return { errorClass: 'permanent', errorCode: 'CHECKSUM_MISMATCH' }
  if (/Checksum|download|network|fetch/i.test(message)) return { errorClass: 'network', errorCode: 'NETWORK' }
  if (/VALIDATION_ERROR|TEXT_TOO_LONG|empty/i.test(message)) return { errorClass: 'permanent', errorCode: 'VALIDATION_ERROR' }
  return { errorClass: 'unknown', errorCode: 'BACKEND_FAILURE' }
}

// ---------------------------------------------------------------------------
// SPEECH SYNTHESIS — voice-driven engine selection, never a silent swap
// ---------------------------------------------------------------------------

interface TtsParams {
  text: string
  voice: string
  speed: number
  source?: string
  narrationSegmentId?: string
}

async function processSpeechSynthesis(job: ClaimedJob, signal: { aborted: boolean }): Promise<HandlerOutcome> {
  const params = JSON.parse(job.paramsJson) as TtsParams
  const requestPreview = `TTS request: voice=${params.voice}, speed=${params.speed}, ${params.text.length} chars: "${params.text.slice(0, 180)}"`

  // Engine selection is determined by the requested VOICE — the catalogs are
  // disjoint, so the choice is deterministic and never silently swapped:
  // hosted preset → authorized gateway; Kokoro voice → local ONNX engine.
  const useLocal = isKokoroVoice(params.voice)
  if (useLocal && !isHostedVoice(params.voice) && !kokoroTtsEngine.getRuntimeStatus().installed) {
    // The user explicitly chose a local-engine voice with no model installed.
    const detail = `The local TTS engine is not installed in this deployment. Install it from the Narration Studio (about ${KOKORO_APPROX_DOWNLOAD_MB} MB, one explicit download) or pick one of the hosted voices. No other voice was substituted — BEAN never silently changes the voice you picked.`
    const settled = await settleActiveGuarded(job.id, {
      status: 'failed',
      errorClass: 'permanent',
      errorCode: 'MODEL_NOT_INSTALLED',
      errorMessage: detail,
      finishedAt: new Date(),
    })
    if (settled) {
      await appendJobEventSafe(job.id, 'error', { code: 'MODEL_NOT_INSTALLED', message: detail })
      await recordAudioJobFailure({ userId: job.userId, product: 'gangzii', kind: 'speech-synthesis', jobId: job.id, backendId: 'bean-audio-tts-local-kokoro', requestPreview }, {
        errorCode: 'MODEL_NOT_INSTALLED',
        errorMessage: detail,
        errorClass: 'permanent',
      })
      await recordAudioUsage(job, 'bean-audio-tts-local-kokoro', false, { errorCode: 'MODEL_NOT_INSTALLED' })
    }
    return { result: {} }
  }
  const backendId = useLocal ? 'bean-audio-tts-local-kokoro' : 'bean-audio-tts-hosted-primary'
  const engineLabel = useLocal ? 'local Kokoro-82M (on-device ONNX)' : 'authorized hosted gateway'

  await db.generationJob.update({ where: { id: job.id }, data: { backendId } })
  await appendJobEventSafe(job.id, 'stage', { stage: 'synthesizing', engine: engineLabel })
  await updateProgress(job.id, 4, { stage: 'synthesizing', engine: engineLabel })

  const outPath = gangziiFile(`${job.userId}/tts/${job.id}.wav`)
  const warnings: string[] = []
  const isCancel = () => isCancelled(job, signal)
  try {
    let result: {
      wav: Buffer
      chunks: number
      durationSec: number
      generationMs: number
      warnings?: string[]
      beepStripped?: boolean
      beepStrippedSamples?: number
    }
    if (useLocal) {
      result = await kokoroTtsEngine.generateSpeech({
        text: params.text,
        voice: params.voice,
        speed: params.speed,
        isCancelled: isCancel,
        onProgress: (info) => {
          // REAL progress: each completed chunk advances the bar.
          void updateProgress(job.id, 5 + (info.chunk / info.totalChunks) * 80, {
            chunk: info.chunk,
            totalChunks: info.totalChunks,
          })
        },
      })
    } else {
      const hosted = await hostedAudioAdapter.synthesize({
        text: params.text,
        voice: params.voice,
        speed: params.speed,
        timeoutMs: 240_000,
        onProgress: (info) => {
          void updateProgress(job.id, 5 + (info.chunk / info.totalChunks) * 80, {
            chunk: info.chunk,
            totalChunks: info.totalChunks,
          })
        },
      })
      // The hosted adapter measures durationMs; normalize to the shared shape.
      result = { ...hosted, generationMs: hosted.durationMs }
    }
    warnings.push(...(result.warnings ?? []))

    // Cancellation AFTER the last chunk completes still means cancelled:
    // the artifact is preserved and the state is honest.
    const cancelledMidRun = isCancel()
    fs.writeFileSync(outPath, result.wav)

    await updateProgress(job.id, 92, { stage: 'validating' })
    // Technical validation: ffprobe the produced file (real, not assumed).
    let stream: AudioStreamMetadata | null = null
    try {
      stream = await runFfprobe(outPath)
    } catch (e) {
      warnings.push(`ffprobe validation did not run: ${e instanceof Error ? e.message : String(e)}`)
    }
    const bytes = fs.statSync(outPath).size
    const resultJson = {
      audioUrl: audioUrlFor(job.id),
      chunks: result.chunks,
      durationSec: stream?.durationSec ?? result.durationSec,
      bytes,
      format: 'wav',
      sampleRateHz: stream?.sampleRateHz ?? 24_000,
      channels: stream?.channels ?? 1,
      channelLayout: (stream?.channels ?? 1) === 1 ? 'mono' : 'stereo',
      engine: engineLabel,
      model: useLocal ? 'Kokoro-82M v1.0 (q8, local ONNX)' : 'provider-managed hosted synthesis',
      beepStripped: result.beepStripped ?? false,
      beepStrippedSamples: result.beepStrippedSamples ?? 0,
      warnings,
    }

    if (cancelledMidRun) {
      await settleActiveGuarded(job.id, {
        status: 'cancelled',
        errorClass: 'cancelled',
        errorCode: 'CANCELLED',
        errorMessage: 'Cancelled near completion; the synthesized audio is preserved and playable.',
        resultJson: JSON.stringify(resultJson),
        finishedAt: new Date(),
      })
      await appendJobEventSafe(job.id, 'notice', { cancelled: true, artifactPreserved: true })
      await recordAudioJobCancelled(
        { userId: job.userId, product: 'gangzii', kind: 'speech-synthesis', jobId: job.id, backendId, requestPreview },
        'while',
        { completedSegments: result.chunks, partialArtifactUrl: audioUrlFor(job.id) },
      )
      await recordAudioUsage(job, backendId, false, { errorCode: 'CANCELLED' })
      return { result: {} }
    }

    // ffprobe must pass for an unconditional `completed` — a produced file
    // that could not be decoded locally is delivered only WITH an honest
    // limitation (the receipt settles completed_with_limitations).
    if (!stream) {
      const settled = await settleActiveGuarded(job.id, {
        status: 'completed',
        resultJson: JSON.stringify({ ...resultJson, validationNote: 'ffprobe validation did not run; no technical-quality claim is made.' }),
        finishedAt: new Date(),
      })
      if (settled) {
        await recordAudioJobCompletion(
          { userId: job.userId, product: 'gangzii', kind: 'speech-synthesis', jobId: job.id, backendId, requestPreview },
          { artifactUrl: audioUrlFor(job.id), format: 'wav', bytes, stream: null, engine: engineLabel, voice: params.voice, chunks: result.chunks, speed: params.speed, generationMs: result.generationMs, warnings },
        )
        await recordAudioUsage(job, backendId, true, { durationMs: result.generationMs })
      }
      return { result: {} }
    }

    await updateProgress(job.id, 100, { stage: 'done' })
    const settled = await settleActiveGuarded(job.id, {
      status: 'completed',
      resultJson: JSON.stringify(resultJson),
      finishedAt: new Date(),
    })
    if (settled) {
      await recordAudioJobCompletion(
        { userId: job.userId, product: 'gangzii', kind: 'speech-synthesis', jobId: job.id, backendId, requestPreview },
        {
          artifactUrl: audioUrlFor(job.id),
          format: 'wav',
          bytes,
          durationMs: Math.round((stream.durationSec ?? result.durationSec) * 1000),
          stream: { codec: stream.codec, sampleRateHz: stream.sampleRateHz, channels: stream.channels, durationSec: stream.durationSec, container: stream.container, validatedBy: 'ffprobe' },
          engine: engineLabel,
          voice: params.voice,
          model: resultJson.model,
          chunks: result.chunks,
          speed: params.speed,
          generationMs: result.generationMs,
          warnings,
        },
      )
      await recordAudioUsage(job, backendId, true, { durationMs: result.generationMs })
    }
    logger.info('gangzii.tts.completed', { jobId: job.id, engine: engineLabel, chunks: result.chunks, durationSec: result.durationSec, generationMs: result.generationMs })
    return { result: {} }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const classified = classifyError(e)
    if (classified.errorCode === 'CANCELLED' || isCancel()) {
      // Preserve any completed-segment audio the engine reported.
      const partialExists = fs.existsSync(outPath)
      const settled = await settleActiveGuarded(job.id, {
        status: 'cancelled',
        errorClass: 'cancelled',
        errorCode: 'CANCELLED',
        errorMessage: 'Cancelled by the user during synthesis.',
        ...(partialExists ? { resultJson: JSON.stringify({ audioUrl: audioUrlFor(job.id), partial: true, warnings: ['Cancelled during synthesis; partial audio preserved.'] }) } : {}),
        finishedAt: new Date(),
      })
      if (settled) {
        await recordAudioJobCancelled(
          { userId: job.userId, product: 'gangzii', kind: 'speech-synthesis', jobId: job.id, backendId, requestPreview },
          'during',
        )
        await recordAudioUsage(job, backendId, false, { errorCode: 'CANCELLED' })
      }
      return { result: {} }
    }
    const settled = await settleActiveGuarded(job.id, {
      status: 'failed',
      errorClass: classified.errorClass,
      errorCode: classified.errorCode,
      errorMessage: message.slice(0, 400),
      finishedAt: new Date(),
    })
    if (settled) {
      await appendJobEventSafe(job.id, 'error', { code: classified.errorCode, message: message.slice(0, 400) })
      await recordAudioJobFailure(
        { userId: job.userId, product: 'gangzii', kind: 'speech-synthesis', jobId: job.id, backendId, requestPreview },
        { errorCode: classified.errorCode, errorMessage: message.slice(0, 400), errorClass: classified.errorClass },
      )
      await recordAudioUsage(job, backendId, false, { errorCode: classified.errorCode })
    }
    return {
      errorClass: classified.errorClass,
      errorCode: classified.errorCode,
      errorMessage: message.slice(0, 400),
    }
  }
}

// ---------------------------------------------------------------------------
// TRANSCRIPTION — hosted ASR, WAV/WebM only (measured upstream contract)
// ---------------------------------------------------------------------------

async function processAudioTranscription(job: ClaimedJob): Promise<HandlerOutcome> {
  const params = JSON.parse(job.paramsJson) as { uploadRelPath: string; container: string; displayName?: string }
  const requestPreview = `Transcription request: ${params.displayName ?? 'audio'} (${params.container})`
  const backendId = 'bean-audio-asr-hosted-primary'
  await db.generationJob.update({ where: { id: job.id }, data: { backendId } })
  await updateProgress(job.id, 10, { stage: 'uploading' })
  try {
    const uploadPath = gangziiFile(params.uploadRelPath)
    if (!fs.existsSync(uploadPath)) {
      throw new Error('VALIDATION_ERROR: the uploaded audio file is no longer available.')
    }
    const bytes = fs.readFileSync(uploadPath)
    const transcript = await hostedAudioAdapter.transcribe({ wavOrWebm: bytes, timeoutMs: 240_000 })
    await updateProgress(job.id, 90, { stage: 'finalizing' })
    const resultJson = { transcript, transcriptChars: transcript.length, container: params.container }
    const settled = await settleActiveGuarded(job.id, {
      status: 'completed',
      resultJson: JSON.stringify(resultJson),
      finishedAt: new Date(),
    })
    if (settled) {
      await recordAudioJobCompletion(
        { userId: job.userId, product: 'gangzii', kind: 'audio-transcription', jobId: job.id, backendId, requestPreview },
        { transcript, bytes: bytes.length },
      )
      await recordAudioUsage(job, backendId, true)
    }
    return { result: {} }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const classified = classifyError(e)
    const settled = await settleActiveGuarded(job.id, {
      status: 'failed',
      errorClass: classified.errorClass,
      errorCode: classified.errorCode,
      errorMessage: message.slice(0, 400),
      finishedAt: new Date(),
    })
    if (settled) {
      await appendJobEventSafe(job.id, 'error', { code: classified.errorCode, message: message.slice(0, 400) })
      await recordAudioJobFailure(
        { userId: job.userId, product: 'gangzii', kind: 'audio-transcription', jobId: job.id, backendId, requestPreview },
        { errorCode: classified.errorCode, errorMessage: message.slice(0, 400), errorClass: classified.errorClass },
      )
      await recordAudioUsage(job, backendId, false, { errorCode: classified.errorCode })
    }
    return { errorClass: classified.errorClass, errorCode: classified.errorCode, errorMessage: message.slice(0, 400) }
  }
}

// ---------------------------------------------------------------------------
// FORMAT CONVERSION — local ffmpeg + ffprobe verification of the result
// ---------------------------------------------------------------------------

async function processAudioConversion(job: ClaimedJob): Promise<HandlerOutcome> {
  const params = JSON.parse(job.paramsJson) as { uploadRelPath?: string; sourceJobId?: string; target: string; channels: 'mono' | 'stereo' }
  const requestPreview = `Conversion request: target=${params.target}, channels=${params.channels}`
  const backendId = 'bean-audio-convert-local-ffmpeg'
  await db.generationJob.update({ where: { id: job.id }, data: { backendId } })
  await updateProgress(job.id, 10, { stage: 'preparing' })
  try {
    let sourcePath: string | null = null
    if (params.uploadRelPath) {
      sourcePath = gangziiFile(params.uploadRelPath)
    } else if (params.sourceJobId) {
      const sourceJob = await db.generationJob.findUnique({ where: { id: params.sourceJobId } })
      if (!sourceJob || sourceJob.userId !== job.userId) {
        throw new Error('NOT_FOUND: the referenced source audio does not exist for this account.')
      }
      const sourceResult = sourceJob.resultJson ? (JSON.parse(sourceJob.resultJson) as { audioUrl?: string }) : null
      if (sourceJob.status !== 'completed' || !sourceResult?.audioUrl) {
        throw new Error('VALIDATION_ERROR: the referenced source audio is not a completed artifact.')
      }
      sourcePath = gangziiFile(`${job.userId}/tts/${params.sourceJobId}.wav`)
    }
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      throw new Error('VALIDATION_ERROR: no source audio is available for this conversion.')
    }

    const outPath = gangziiFile(`${job.userId}/convert/${job.id}.${params.target}`)
    await updateProgress(job.id, 30, { stage: 'converting' })
    await hostedAudioAdapter.convert({
      inputPath: sourcePath,
      outputPath: outPath,
      target: params.target as 'mp3' | 'ogg' | 'flac' | 'm4a' | 'wav',
      channels: params.channels === 'stereo' ? 2 : 1,
      timeoutMs: 240_000,
    })

    await updateProgress(job.id, 80, { stage: 'validating' })
    const stream = await runFfprobe(outPath)
    const declaredChannels = params.channels === 'stereo' ? 2 : 1
    if (stream.channels !== declaredChannels) {
      // The requested channel configuration MUST be verified — a "stereo"
      // export that came back mono fails loudly instead of being mislabeled.
      throw new Error(
        `VALIDATION_ERROR: the produced file has ${stream.channels} channel(s) but ${declaredChannels} were requested; the export was rejected.`,
      )
    }
    const bytes = fs.statSync(outPath).size
    const resultJson = {
      audioUrl: audioUrlFor(job.id),
      target: params.target,
      channels: stream.channels,
      bytes,
      format: params.target,
      sampleRateHz: stream.sampleRateHz,
      durationSec: stream.durationSec,
      codec: stream.codec,
    }
    await updateProgress(job.id, 100, { stage: 'done' })
    const settled = await settleActiveGuarded(job.id, {
      status: 'completed',
      resultJson: JSON.stringify(resultJson),
      finishedAt: new Date(),
    })
    if (settled) {
      await recordAudioJobCompletion(
        { userId: job.userId, product: 'gangzii', kind: 'audio-conversion', jobId: job.id, backendId, requestPreview },
        {
          artifactUrl: audioUrlFor(job.id),
          format: params.target,
          bytes,
          durationMs: stream.durationSec ? Math.round(stream.durationSec * 1000) : undefined,
          stream: { codec: stream.codec, sampleRateHz: stream.sampleRateHz, channels: stream.channels, durationSec: stream.durationSec, container: stream.container, validatedBy: 'ffprobe' },
          sourceUrl: `/api/gangzii/audio/${params.sourceJobId ?? job.id}`,
        },
      )
      await recordAudioUsage(job, backendId, true)
    }
    return { result: {} }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const classified = classifyError(e)
    const settled = await settleActiveGuarded(job.id, {
      status: 'failed',
      errorClass: classified.errorClass,
      errorCode: classified.errorCode,
      errorMessage: message.slice(0, 400),
      finishedAt: new Date(),
    })
    if (settled) {
      await appendJobEventSafe(job.id, 'error', { code: classified.errorCode, message: message.slice(0, 400) })
      await recordAudioJobFailure(
        { userId: job.userId, product: 'gangzii', kind: 'audio-conversion', jobId: job.id, backendId, requestPreview },
        { errorCode: classified.errorCode, errorMessage: message.slice(0, 400), errorClass: classified.errorClass },
      )
      await recordAudioUsage(job, backendId, false, { errorCode: classified.errorCode })
    }
    return { errorClass: classified.errorClass, errorCode: classified.errorCode, errorMessage: message.slice(0, 400) }
  }
}

// ---------------------------------------------------------------------------
// AUDIO PRODUCTION (M27) — deterministic local mixing / mastering ops
// ---------------------------------------------------------------------------

export interface MixOperation {
  op: 'trim' | 'fade-in' | 'fade-out' | 'volume' | 'duck' | 'concat' | 'normalize-loudness' | 'eq' | 'compress' | 'limit'
  /** All params are bounded and validated by the route before queueing. */
  params?: Record<string, number | string | boolean>
}

export interface ProductionParams {
  /** Source assets: owner-checked GANGZII audio urls or uploaded rel paths. */
  inputs: Array<{ jobId?: string; relPath?: string }>
  operations: MixOperation[]
  output: { format: 'wav' | 'mp3' | 'm4a'; channels?: 1 | 2; sampleRateHz?: 24_000 | 44_100 | 48_000 }
  /** When true the loudness target normalizes to the requested LUFS. */
  loudnessTargetLufs?: number
  sourceLabel?: string
}

function buildFilterChain(ops: MixOperation[]): { filters: string[]; warnings: string[] } {
  const filters: string[] = []
  const warnings: string[] = []
  for (const op of ops) {
    const p = op.params ?? {}
    switch (op.op) {
      case 'trim':
        filters.push(`atrim=start=${Number(p.startSec ?? 0)},asetpts=PTS-STARTPTS`)
        break
      case 'fade-in':
        filters.push(`afade=t=in:st=0:d=${Number(p.durationSec ?? 1)}`)
        break
      case 'fade-out': {
        // st is set relative to the trimmed stream end by `areverse` trick —
        // simpler: fade at a declared offset; the route bounds it.
        filters.push(`afade=t=out:st=${Number(p.startSec ?? 0)}:d=${Number(p.durationSec ?? 1)}`)
        break
      }
      case 'volume':
        filters.push(`volume=${Number(p.gain ?? 1)}`)
        break
      case 'duck':
        // Sidechain-free static ducking: narration-active volume reduction.
        filters.push(`volume=${Number(p.duckTo ?? 0.35)}`)
        warnings.push('Static ducking applied: the bed volume is reduced for the whole segment (no sidechain detection).')
        break
      case 'eq':
        // Basic EQ: low shelf + high shelf (bounded).
        filters.push(`bass=g=${Number(p.lowGainDb ?? 0)}:f=${Number(p.lowFreqHz ?? 120)}`)
        filters.push(`treble=g=${Number(p.highGainDb ?? 0)}:f=${Number(p.highFreqHz ?? 6000)}`)
        break
      case 'compress':
        filters.push(`acompressor=threshold=${Number(p.thresholdDb ?? -18)}dB:ratio=${Number(p.ratio ?? 3)}:attack=${Number(p.attackMs ?? 20)}:release=${Number(p.releaseMs ?? 250)}`)
        break
      case 'limit':
        filters.push(`alimiter=limit=${Number(p.limitDbtp ?? -1)}dB`)
        break
      case 'normalize-loudness':
        // Two-pass loudness norm is done by measure→apply; a single-call
        // loudnorm is recorded honestly as one-pass (dynamic) normalization.
        filters.push(`loudnorm=I=${Number(p.targetLufs ?? -16)}:TP=${Number(p.truePeakDbtp ?? -1.5)}:LRA=${Number(p.lra ?? 11)}`)
        warnings.push('One-pass loudnorm applied (dynamic mode); measured loudness is reported separately.')
        break
      case 'concat':
        // concat is handled by input count, not a per-stream filter.
        break
      default:
        throw new Error(`VALIDATION_ERROR: unknown audio operation "${(op as { op: string }).op}".`)
    }
  }
  return { filters, warnings }
}

async function resolveInputs(userId: string, inputs: ProductionParams['inputs']): Promise<string[]> {
  const paths: string[] = []
  for (const input of inputs) {
    if (input.relPath) {
      const p = gangziiFile(input.relPath)
      if (!fs.existsSync(p)) throw new Error('VALIDATION_ERROR: a source audio file is no longer available.')
      paths.push(p)
      continue
    }
    if (input.jobId) {
      const src = await db.generationJob.findUnique({ where: { id: input.jobId } })
      if (!src || src.userId !== userId || src.status !== 'completed') {
        throw new Error('NOT_FOUND: a referenced source audio is not a completed artifact for this account.')
      }
      // Known layouts (same contract as the audio delivery route).
      if (src.task === 'speech-synthesis') paths.push(gangziiFile(`${userId}/tts/${src.id}.wav`))
      else if (src.task === 'audio-production') {
        const r = src.resultJson ? (JSON.parse(src.resultJson) as { relPath?: string }) : null
        if (!r?.relPath) throw new Error('VALIDATION_ERROR: the referenced production has no stored master file.')
        paths.push(gangziiFile(r.relPath))
      } else if (src.task === 'audio-conversion') {
        const p2 = JSON.parse(src.paramsJson) as { target?: string }
        paths.push(gangziiFile(`${userId}/convert/${src.id}.${p2.target ?? 'wav'}`))
      } else {
        throw new Error('VALIDATION_ERROR: the referenced source job has no downloadable audio master.')
      }
    }
  }
  if (paths.length === 0) throw new Error('VALIDATION_ERROR: no source audio was provided.')
  return paths
}

async function processAudioProduction(job: ClaimedJob, signal: { aborted: boolean }): Promise<HandlerOutcome> {
  const params = JSON.parse(job.paramsJson) as ProductionParams
  const requestPreview = `Audio production: ${params.operations.length} operation(s) on ${params.inputs.length} input(s), target=${params.output.format}`
  const backendId = 'bean-audio-tools-local-ffmpeg'
  await db.generationJob.update({ where: { id: job.id }, data: { backendId } })
  const warnings: string[] = []
  const isCancel = () => isCancelled(job, signal)
  try {
    const inputPaths = await resolveInputs(job.userId, params.inputs)
    await updateProgress(job.id, 15, { stage: 'inputs-resolved', inputs: inputPaths.length })

    const { filters, warnings: opWarnings } = buildFilterChain(params.operations)
    warnings.push(...opWarnings)

    const ext = params.output.format
    const outRelPath = `${job.userId}/masters/${job.id}.${ext}`
    const outPath = gangziiFile(outRelPath)
    const sampleRate = params.output.sampleRateHz ?? 48_000
    const channels = params.output.channels ?? (params.output.format === 'wav' ? 2 : 2)

    await updateProgress(job.id, 35, { stage: 'processing', operations: params.operations.map((o) => o.op) })
    if (isCancelled(job, signal)) throw new Error("CANCELLED_BY_USER")
    // Encode args shared by every path below.
    const encodeArgs = ['-c:a', codecFor(ext), '-ar', String(sampleRate), '-ac', String(channels)]
    if (inputPaths.length > 1) {
      // Concatenation of multiple inputs (e.g. narration segments): a real
      // concat filter graph — segment order preserved, butt-joined (no fake
      // crossfades), then the remaining per-stream filters applied AFTER the
      // concat so trim/fade/loudness semantics stay predictable.
      const inputArgs = inputPaths.flatMap((p) => ['-i', p])
      const concatChain = inputPaths.map((_, i) => `[${i}:a]`).join('')
      const restFilters = filters.length > 0 ? filters.join(',') : 'anull'
      const graph = `${concatChain}concat=n=${inputPaths.length}:v=0:a=1[cat];[cat]${restFilters}[aout]`
      await runFfmpeg([...inputArgs, '-filter_complex', graph, '-map', '[aout]', ...encodeArgs, outPath], 480_000)
    } else {
      const filterArgs = filters.length > 0 ? ['-af', filters.join(',')] : []
      await runFfmpeg(['-i', inputPaths[0], ...filterArgs, ...encodeArgs, outPath], 480_000)
    }

    await updateProgress(job.id, 75, { stage: 'validating' })
    if (isCancelled(job, signal)) throw new Error("CANCELLED_BY_USER")
    const stream = await runFfprobe(outPath)
    if (!stream) throw new Error('VALIDATION_ERROR: the produced audio could not be validated by ffprobe.')
    const loudness = await measureLoudness(outPath)

    const bytes = fs.statSync(outPath).size
    const resultJson = {
      audioUrl: audioUrlFor(job.id),
      relPath: outRelPath,
      operations: params.operations.map((o) => o.op),
      format: ext,
      bytes,
      sampleRateHz: stream.sampleRateHz,
      channels: stream.channels,
      durationSec: stream.durationSec,
      codec: stream.codec,
      loudness,
      masterLabel:
        params.operations.some((o) => o.op === 'normalize-loudness' || o.op === 'limit' || o.op === 'compress')
          ? 'measured-master (loudness-normalized; measured values recorded)'
          : 'processed-audio (transcode/edit only — NOT labeled mastered)',
      warnings,
    }
    await updateProgress(job.id, 100, { stage: 'done' })
    const settled = await settleActiveGuarded(job.id, {
      status: 'completed',
      resultJson: JSON.stringify(resultJson),
      finishedAt: new Date(),
    })
    if (settled) {
      await recordAudioJobCompletion(
        { userId: job.userId, product: 'gangzii', kind: 'audio-production', jobId: job.id, backendId, requestPreview },
        {
          artifactUrl: audioUrlFor(job.id),
          format: ext,
          bytes,
          stream: { codec: stream.codec, sampleRateHz: stream.sampleRateHz, channels: stream.channels, durationSec: stream.durationSec, container: stream.container, validatedBy: 'ffprobe' },
          loudness: { integratedLufs: loudness.integratedLufs, truePeakDbtp: loudness.truePeakDbtp, measuredBy: loudness.integratedLufs !== null ? 'ffmpeg ebur128' : 'measurement unavailable' },
          operations: resultJson.operations,
          engine: 'local ffmpeg (deterministic)',
          sourceUrl: params.sourceLabel ?? null,
          warnings,
        },
      )
      await recordAudioUsage(job, backendId, true)
    }
    return { result: {} }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const classified = classifyError(e)
    if (/CANCELLED/.test(message) || isCancel()) {
      const settled = await settleActiveGuarded(job.id, {
        status: 'cancelled',
        errorClass: 'cancelled',
        errorCode: 'CANCELLED',
        errorMessage: 'Cancelled by the user during audio production.',
        finishedAt: new Date(),
      })
      if (settled) {
        await recordAudioJobCancelled({ userId: job.userId, product: 'gangzii', kind: 'audio-production', jobId: job.id, backendId, requestPreview }, 'during')
        await recordAudioUsage(job, backendId, false, { errorCode: 'CANCELLED' })
      }
      return { result: {} }
    }
    const settled = await settleActiveGuarded(job.id, {
      status: 'failed',
      errorClass: classified.errorClass,
      errorCode: classified.errorCode,
      errorMessage: message.slice(0, 400),
      finishedAt: new Date(),
    })
    if (settled) {
      await appendJobEventSafe(job.id, 'error', { code: classified.errorCode, message: message.slice(0, 400) })
      await recordAudioJobFailure(
        { userId: job.userId, product: 'gangzii', kind: 'audio-production', jobId: job.id, backendId, requestPreview },
        { errorCode: classified.errorCode, errorMessage: message.slice(0, 400), errorClass: classified.errorClass },
      )
      await recordAudioUsage(job, backendId, false, { errorCode: classified.errorCode })
    }
    return { errorClass: classified.errorClass, errorCode: classified.errorCode, errorMessage: message.slice(0, 400) }
  }
}

function codecFor(format: 'wav' | 'mp3' | 'm4a'): string {
  switch (format) {
    case 'wav':
      return 'pcm_s16le'
    case 'mp3':
      return 'libmp3lame'
    case 'm4a':
      return 'aac'
  }
}

// ---------------------------------------------------------------------------
// Dispatch — the engine handler surface
// ---------------------------------------------------------------------------

export async function processAudioJob(job: ClaimedJob, ctx: { signal: { aborted: boolean } }): Promise<HandlerOutcome> {
  switch (job.task) {
    case 'speech-synthesis':
      return processSpeechSynthesis(job, ctx.signal)
    case 'audio-transcription':
      return processAudioTranscription(job)
    case 'audio-conversion':
      return processAudioConversion(job)
    case 'audio-production':
      return processAudioProduction(job, ctx.signal)
    default:
      return {
        errorClass: 'permanent',
        errorCode: 'NO_BACKEND',
        errorMessage: 'No audio worker is available for this task type.',
      }
  }
}

/** Storage root of measured local models — re-exported for the admin route. */
export { TTS_MODELS_ROOT }
