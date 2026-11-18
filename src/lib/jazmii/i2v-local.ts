/**
 * BEAN Intelligence — JAZMII LOCAL image-to-video engine (M26.2).
 *
 * The REAL executable I2V lane on CPU hosts. Honest class disclosure: this
 * lane animates the PROVIDED STILL with explicit motion programs and
 * synthesizes in-between frames with a real neural frame-interpolation
 * model (RIFE, MIT). It is NOT diffusion scene synthesis — new objects,
 * subject motion or scene changes are out of scope and never claimed. The
 * selected diffusion-class I2V models (WAN 2.2 I2V / SVD / CogVideoX-I2V)
 * require a GPU worker class this host does not have; that evaluation and
 * their honest unavailability live in M26_2_MODEL_INTEGRATION.md.
 *
 * Pipeline (every frame is really generated — never a static image):
 *   1. source image -> working canvas (multiple-of-32, bounded side);
 *   2. motion program parsed from the instruction (zoom/pan/strength);
 *   3. anchor frames sampled along the trajectory (affine crop + resize);
 *   4. RIFE recursively interpolates anchors to the target fps — every
 *      in-between frame is model inference, not blending;
 *   5. frames are encoded with ffmpeg (libx264) and validated by ffprobe
 *      by the caller before storage.
 *
 * Cancellation: the worker glue checks the durable cancel flag between
 * segments; this module exposes per-frame progress callbacks.
 */
import sharp from 'sharp'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as ort from 'onnxruntime-node'
import { getSession, localModelState } from '@/lib/media/local-models'

export interface MotionProgram {
  /** Multiplicative zoom per full timeline (0.15 = gentle push-in). */
  zoom: number
  /** Horizontal drift fraction of frame width over the timeline. */
  panX: number
  /** Vertical drift fraction of frame height over the timeline. */
  panY: number
  /** Human-readable summary recorded in provenance. */
  description: string
}

export interface ParsedMotion {
  program: MotionProgram
  /** Instruction fragments that the motion lane cannot perform honestly. */
  unsupported: string[]
}

/** Parse motion instructions conservatively (pure, no I/O). */
export function parseMotionProgram(instruction: string): ParsedMotion {
  const lower = instruction.toLowerCase()
  const unsupported: string[] = []
  let zoom = 0
  let panX = 0
  let panY = 0
  const parts: string[] = []

  if (/\b(zoom in|push in|closer|move (the )?camera (closer|in)|dolly in)\b/.test(lower)) zoom += 0.18
  if (/\b(zoom out|pull (back|out)|farther|dolly out)\b/.test(lower)) zoom -= 0.18
  if (/\b(pan|drift|move|slide|sweep)\b[^.!?]*\b(left)\b/.test(lower)) panX -= 0.1
  if (/\b(pan|drift|move|slide|sweep)\b[^.!?]*\b(right)\b/.test(lower)) panX += 0.1
  if (/\b(pan|drift|move|slide|sweep|tilt)\b[^.!?]*\b(up|upward|top)\b/.test(lower)) panY -= 0.08
  if (/\b(pan|drift|move|slide|sweep|tilt)\b[^.!?]*\b(down|downward|bottom)\b/.test(lower)) panY += 0.08
  // "slow motion" is about playback feel — the lane animates a still; note it.
  if (/\b(make (the )?(subject|person|object|car|water|clouds|tree|leaves|hair|dog|cat)[^.!?]*\b(move|walk|run|dance|talk|wave|fly)\b)/.test(lower)) {
    unsupported.push('asking for SUBJECT motion (walking/talking/…) requires diffusion-class video synthesis, which this lane does not perform')
  }
  if (/\b(add|insert|create|generate)\b[^.!?]*\b(new|another|a)\b[^.!?]*\b(object|person|animal|scene|car|building)\b/.test(lower)) {
    unsupported.push('asking to ADD new content to the scene requires diffusion-class video synthesis, which this lane does not perform')
  }

  const strong = /\b(strong|fast|dynamic|dramatic|big|rapid|energetic)\b/.test(lower)
  const subtle = /\b(subtle|gentle|slow|slight|calm|soft|minimal|little)\b/.test(lower)
  const scale = strong ? 1.6 : subtle ? 0.6 : 1

  if (zoom === 0 && panX === 0 && panY === 0) {
    // No explicit motion: the honest default is a gentle cinematic push-in
    // (the classic Ken Burns move) — disclosed, not hidden.
    zoom = 0.12
    parts.push('default gentle push-in (no explicit motion in the instruction)')
  }
  zoom *= scale
  panX *= scale
  panY *= scale
  if (zoom !== 0) parts.push(`${zoom > 0 ? 'push-in' : 'pull-back'} ${(Math.abs(zoom) * 100).toFixed(0)}%`)
  if (panX !== 0) parts.push(`horizontal drift ${(panX * 100).toFixed(0)}% ${panX > 0 ? 'right' : 'left'}`)
  if (panY !== 0) parts.push(`vertical drift ${(panY * 100).toFixed(0)}% ${panY > 0 ? 'down' : 'up'}`)
  if (strong) parts.push('strong intensity')
  if (subtle) parts.push('subtle intensity')

  return { program: { zoom, panX, panY, description: parts.join('; ') || 'static hold' }, unsupported }
}

export interface I2VFrameOptions {
  width: number
  height: number
  durationSec: number
  fps: number
  program: MotionProgram
  sourceBytes: Buffer
  /** Called after each segment with 0..1 progress. */
  onProgress?: (fraction: number) => void
  /** Cooperative cancellation — checked between segments. */
  isCancelled?: () => boolean
}

export interface I2VFrames {
  /** RGB24 raw frame buffers (width*height*3 each), in timeline order. */
  frames: Buffer[]
  width: number
  height: number
  fps: number
  frameCount: number
  rifeCalls: number
  stats: { latencyMs: number; workingWidth: number; workingHeight: number }
}

function snap32(v: number): number {
  return Math.max(32, Math.round(v / 32) * 32)
}

/** One RIFE midpoint: real model inference between two frames. */
async function rifeMidpoint(
  a: Float32Array,
  b: Float32Array,
  size: { w: number; h: number },
): Promise<Float32Array> {
  const session = await getSession('rife')
  const input = new Float32Array(a.length + b.length)
  input.set(a, 0)
  input.set(b, a.length)
  const out = await session.run({
    input: new ort.Tensor('float32', input, [1, 6, size.h, size.w]),
  })
  return out[session.outputNames[0]].data as Float32Array
}

/** RGB24 buffer → three CHW planes (the layout ONNX vision tensors expect). */
function rgbToPlanes(buf: Buffer): Float32Array {
  const n = buf.length / 3
  const out = new Float32Array(n * 3)
  for (let p = 0; p < n; p++) {
    out[p] = buf[p * 3] / 255
    out[n + p] = buf[p * 3 + 1] / 255
    out[2 * n + p] = buf[p * 3 + 2] / 255
  }
  return out
}

/** CHW planes (RGB, 0..1) → RGB24 buffer. */
function planesToRgb(f: Float32Array): Buffer {
  const n = f.length / 3
  const out = Buffer.alloc(n * 3)
  for (let p = 0; p < n; p++) {
    out[p * 3] = Math.max(0, Math.min(255, Math.round(f[p] * 255)))
    out[p * 3 + 1] = Math.max(0, Math.min(255, Math.round(f[n + p] * 255)))
    out[p * 3 + 2] = Math.max(0, Math.min(255, Math.round(f[2 * n + p] * 255)))
  }
  return out
}

/**
 * Recursively fill (2^levels - 1) frames between two anchors with RIFE
 * midpoint inference — the standard recursive interpolation schedule.
 */
async function interpolateRange(
  left: Float32Array,
  right: Float32Array,
  levels: number,
  size: { w: number; h: number },
  sink: (f: Float32Array) => void,
  counters: { rifeCalls: number },
): Promise<void> {
  if (levels <= 0) return
  const mid = await rifeMidpoint(left, right, size)
  counters.rifeCalls++
  // Left half first so the sink receives frames in timeline order.
  await interpolateRange(left, mid, levels - 1, size, sink, counters)
  sink(mid)
  await interpolateRange(mid, right, levels - 1, size, sink, counters)
}

/**
 * Generate ALL frames for one I2V job — real synthesis end to end.
 * Returns raw RGB24 frames ready for ffmpeg encoding.
 */
export async function generateLocalI2VFrames(opts: I2VFrameOptions): Promise<I2VFrames> {
  const t0 = Date.now()
  const maxSide = Number(process.env.BEAN_I2V_MAX_SIDE ?? 512)
  const maxFrames = Number(process.env.BEAN_I2V_MAX_FRAMES ?? 240)
  const srcMeta = await sharp(opts.sourceBytes).rotate().metadata()
  if (!srcMeta.width || !srcMeta.height) throw new Error('The reference image could not be decoded.')

  // Working resolution: honor the request when it fits the model budget,
  // otherwise scale down — the ACTUAL output dims are what gets encoded and
  // measured (never silently claimed to be the requested size).
  let w = snap32(Math.min(opts.width, maxSide))
  let h = snap32(Math.min(opts.height, maxSide))
  const srcAspect = srcMeta.width / srcMeta.height
  if (Math.abs(w / h - srcAspect) / srcAspect > 0.15) {
    // Request aspect differs strongly from the source: keep the SOURCE
    // aspect inside the requested box (no letterbox surprises).
    if (srcAspect >= 1) h = snap32(w / srcAspect)
    else w = snap32(h * srcAspect)
  }

  // Canvas with pan/zoom headroom (25% larger than the crop window).
  const canvasW = Math.round(w * 1.25)
  const canvasH = Math.round(h * 1.25)
  const canvas = await sharp(opts.sourceBytes)
    .rotate()
    .resize(canvasW, canvasH, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer()

  const fps = opts.fps
  const totalFrames = Math.max(2, Math.min(maxFrames, Math.round(opts.durationSec * fps)))
  const program = opts.program

  // Anchor schedule: an anchor every `seg` frames; seg is a power of two so
  // the recursive RIFE schedule fills it exactly.
  const anchorCount = Math.min(25, Math.max(5, Math.round(totalFrames / 8) + 1))
  let seg = Math.max(1, Math.round((totalFrames - 1) / (anchorCount - 1)))
  seg = Math.min(seg, 32)
  const levels = Math.round(Math.log2(seg))
  seg = Math.pow(2, levels)

  const frameFloats: Float32Array[] = []
  const counters = { rifeCalls: 0 }

  // Sample anchor frames along the trajectory (affine crop of the canvas).
  const anchors: Float32Array[] = []
  for (let a = 0; a < anchorCount; a++) {
    const t = a / (anchorCount - 1)
    const zoomT = 1 + program.zoom * t
    const cropW = Math.max(32, Math.min(canvasW, Math.round(canvasW / zoomT)))
    const cropH = Math.max(32, Math.min(canvasH, Math.round(canvasH / zoomT)))
    const freeX = Math.max(0, canvasW - cropW)
    const freeY = Math.max(0, canvasH - cropH)
    const left = Math.round((freeX / 2) + (program.panX * canvasW / 2) * t)
    const top = Math.round((freeY / 2) + (program.panY * canvasH / 2) * t)
    const crop = await sharp(canvas, { raw: { width: canvasW, height: canvasH, channels: 3 } })
      .extract({
        left: Math.min(Math.max(0, left), freeX),
        top: Math.min(Math.max(0, top), freeY),
        width: cropW,
        height: cropH,
      })
      .resize(w, h, { fit: 'fill' })
      .raw()
      .toBuffer()
    anchors.push(rgbToPlanes(crop))
  }

  // First anchor is frame 0; recursively fill each segment with real RIFE
  // inference until the timeline is complete.
  frameFloats.push(anchors[0])
  for (let s = 0; s < anchors.length - 1; s++) {
    if (opts.isCancelled?.()) {
      const err = new Error('cancelled by user request')
      ;(err as Error & { code?: string }).code = 'CANCELLED'
      throw err
    }
    await interpolateRange(anchors[s], anchors[s + 1], levels, { w, h }, (f) => frameFloats.push(f), counters)
    frameFloats.push(anchors[s + 1])
    opts.onProgress?.(Math.min(0.9, ((s + 1) / (anchors.length - 1)) * 0.9))
    if (frameFloats.length >= totalFrames) break
  }
  const frames = frameFloats.slice(0, totalFrames).map(planesToRgb)
  return {
    frames,
    width: w,
    height: h,
    fps,
    frameCount: frames.length,
    rifeCalls: counters.rifeCalls,
    stats: { latencyMs: Date.now() - t0, workingWidth: w, workingHeight: h },
  }
}

export interface EncodedVideo {
  bytes: Buffer
  format: 'mp4'
  width: number
  height: number
  fps: number
  frameCount: number
}

/** Encode raw RGB24 frames into an mp4 with ffmpeg (real container output). */
export async function encodeFramesToMp4(frames: Buffer[], width: number, height: number, fps: number): Promise<EncodedVideo> {
  // The MP4 muxer requires a SEEKABLE output — a pipe fails with exit 234
  // ("Nothing was written into output file", measured 2026-11-18). Frames go
  // to stdin; the muxer writes to a temp file which is read back and removed.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bean-i2v-'))
  const outPath = path.join(tmpDir, 'out.mp4')
  const args = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-s', `${width}x${height}`,
    '-r', String(fps),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outPath,
  ]
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] })
  const stderr: Buffer[] = []
  proc.stderr.on('data', (c: Buffer) => {
    stderr.push(c)
    if (stderr.length > 40) stderr.shift()
  })
  let failed = false
  const done = new Promise<void>((resolve, reject) => {
    proc.on('error', (e) => {
      failed = true
      reject(e)
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else {
        failed = true
        reject(new Error(`ffmpeg exited with code ${code}: ${Buffer.concat(stderr).toString('utf8').slice(-400)}`))
      }
    })
  })
  // EPIPE when ffmpeg dies mid-feed must not crash the process — `done`
  // carries the real failure and the write loop stops on it.
  proc.stdin.on('error', () => undefined)
  for (const frame of frames) {
    if (failed) break
    const writable = proc.stdin.write(frame)
    if (!writable && !failed) {
      await new Promise<void>((resolve) => {
        const onDrain = () => {
          proc.stdin.off('drain', onDrain)
          resolve()
        }
        proc.stdin.once('drain', onDrain)
        // Never wait on a dead pipe: if ffmpeg settles while we are blocked,
        // the failure path resolves `done` and this promise unblocks.
        done.then(() => resolve()).catch(() => resolve())
      })
    }
  }
  proc.stdin.end()
  try {
    await done
    const bytes = fs.readFileSync(outPath)
    if (bytes.length === 0) throw new Error('ffmpeg produced no output — encoding failed')
    return { bytes, format: 'mp4', width, height, fps, frameCount: frames.length }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      /* best-effort cleanup */
    }
  }
}

/** Honest readiness check for the local lane (models actually on disk). */
export function localI2VReady(): boolean {
  return localModelState('rife').state === 'ready'
}
