/**
 * BEAN Intelligence — real media stream validation via ffprobe.
 *
 * OPERATIONAL-TRANSFORMATION (2026-11-11), Phase 5: the video completion gate
 * previously accepted any payload whose first bytes looked like an MP4/WebM
 * container. A degenerate capture (zero frames, no decodable stream, a
 * 0.04s sliver) passed that gate and would have been advertised as a real
 * generated video. This module closes that gap: the bytes are written to a
 * temp file and probed with the system ffprobe binary — the SAME validation
 * the offline acceptance scripts have always applied (codec, resolution,
 * duration, frame count) becomes part of the PRODUCTION completion gate.
 *
 * Honesty rules:
 *  - a probe that cannot run (ffprobe missing) reports exactly that and the
 *    caller decides — it never silently passes;
 *  - every rejection carries the measured reason (what ffprobe actually
 *    saw / failed to see), never a generic message;
 *  - the probe is read-only on a temp file and bounded by a hard timeout.
 */
import { execFile } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { logger } from '@/lib/observability/logger'

export interface VideoStreamProbe {
  ok: boolean
  /** Measured stream facts when ok (all from ffprobe, never estimated). */
  video?: {
    codec: string
    width: number
    height: number
    durationSec: number
    /** Decoded frame count when ffprobe reports one; null when the container
     *  does not expose it (duration × fps is never guessed in its place). */
    frames: number | null
    fps: number | null
  }
  audio?: { codec: string } | null
  /** The measured reason this payload is not a real, playable video. */
  error?: string
}

/** Minimum accepted duration for a "generated video" (seconds). */
export const MIN_DURATION_SEC = 0.5
/** Minimum accepted frame count (a 1-frame artifact is not a video). */
export const MIN_FRAMES = 8

interface FFprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  duration?: string
  nb_frames?: string
  avg_frame_rate?: string
  r_frame_rate?: string
}

interface FFprobeOutput {
  streams?: FFprobeStream[]
  format?: { duration?: string; format_name?: string }
}

function parseFps(rate: string | undefined): number | null {
  if (!rate) return null
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(rate.trim())
  if (!m) return null
  const den = Number(m[2])
  if (!den) return null
  const fps = Number(m[1]) / den
  return Number.isFinite(fps) && fps > 0 ? fps : null
}

/**
 * Probe a media BYTE BUFFER with ffprobe (temp file, bounded 20s). A
 * playable-looking but degenerate payload returns { ok:false, error } with
 * the measured reason.
 */
export async function probeVideoBytes(
  bytes: Buffer,
  ext: 'mp4' | 'webm',
  timeoutMs = 20_000,
): Promise<VideoStreamProbe> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bean-ffprobe-'))
  const file = path.join(dir, `probe.${ext}`)
  try {
    fs.writeFileSync(file, bytes)
    return await probeVideoFile(file, timeoutMs)
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* temp cleanup best-effort */
    }
  }
}

/** Probe a media FILE on disk with ffprobe (read-only, bounded). */
export async function probeVideoFile(file: string, timeoutMs = 20_000): Promise<VideoStreamProbe> {
  const raw = await new Promise<{ stdout: string; stderr: string }>((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // ffprobe exits non-zero on undecodable input — that IS the
          // measurement, carried in stderr. Resolve, don't reject.
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? err.message) })
        } else {
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
        }
      },
    )
  })

  if (!raw.stdout.trim()) {
    return {
      ok: false,
      error: `ffprobe could not decode the payload: ${raw.stderr.slice(0, 240) || 'no output'}`,
    }
  }
  let parsed: FFprobeOutput
  try {
    parsed = JSON.parse(raw.stdout) as FFprobeOutput
  } catch {
    return { ok: false, error: 'ffprobe produced unparseable output' }
  }
  const streams = parsed.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const audio = streams.find((s) => s.codec_type === 'audio')
  if (!video || !video.codec_name) {
    return { ok: false, error: 'no decodable video stream found by ffprobe' }
  }
  const durationSec = Number(video.duration ?? parsed.format?.duration ?? NaN)
  if (!Number.isFinite(durationSec) || durationSec < MIN_DURATION_SEC) {
    return {
      ok: false,
      error: `video stream duration measured ${
        Number.isFinite(durationSec) ? durationSec.toFixed(3) : 'unknown'
      }s (below the ${MIN_DURATION_SEC}s minimum)`,
      video: {
        codec: video.codec_name,
        width: video.width ?? 0,
        height: video.height ?? 0,
        durationSec: Number.isFinite(durationSec) ? durationSec : 0,
        frames: null,
        fps: parseFps(video.avg_frame_rate ?? video.r_frame_rate),
      },
    }
  }
  const framesRaw = video.nb_frames ? Number(video.nb_frames) : NaN
  const frames = Number.isFinite(framesRaw) ? framesRaw : null
  if (frames !== null && frames < MIN_FRAMES) {
    return {
      ok: false,
      error: `video stream contains only ${frames} frame(s) (below the ${MIN_FRAMES}-frame minimum for a real video)`,
      video: {
        codec: video.codec_name,
        width: video.width ?? 0,
        height: video.height ?? 0,
        durationSec,
        frames,
        fps: parseFps(video.avg_frame_rate ?? video.r_frame_rate),
      },
    }
  }
  return {
    ok: true,
    video: {
      codec: video.codec_name,
      width: video.width ?? 0,
      height: video.height ?? 0,
      durationSec,
      frames,
      fps: parseFps(video.avg_frame_rate ?? video.r_frame_rate),
    },
    audio: audio?.codec_name ? { codec: audio.codec_name } : null,
  }
}

/**
 * The PRODUCTION completion gate (Phase 5): the payload must decode into a
 * real video stream with sane duration/frame facts. Returns the measured
 * probe either way — the caller (video worker) turns { ok:false } into a
 * failed job, never a completion.
 */
export async function validateVideoArtifact(
  bytes: Buffer,
  ext: 'mp4' | 'webm',
  context: { jobId: string },
): Promise<VideoStreamProbe> {
  const probe = await probeVideoBytes(bytes, ext)
  if (!probe.ok) {
    logger.warn('jazmii.artifact_ffprobe_rejected', {
      jobId: context.jobId,
      error: probe.error,
    })
  }
  return probe
}
