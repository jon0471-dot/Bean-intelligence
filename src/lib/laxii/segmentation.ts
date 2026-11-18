/**
 * BEAN Intelligence — LAXII local segmentation service (M26.2).
 *
 * REAL server-side matting on onnxruntime-node (CPU EP by default):
 *  - MODNet (Apache-2.0): trimap-free portrait/subject matting, dynamic
 *    HxW input — runs at the capped working resolution and the matte is
 *    upsampled back to the FULL source resolution (source pixels are never
 *    discarded).
 *  - U^2-Netp (Apache-2.0): lightweight salient-object fallback when the
 *    portrait model finds no usable subject.
 *
 * Honesty rules:
 *  - every matte carries MEASURED coverage stats (subject fraction, matte
 *    resolution, model id, latency);
 *  - a matte without a usable subject is an HONEST failure — never a fake
 *    cutout;
 *  - sessions come from the local-model manager (one per model, idle
 *    unloaded); models are never claimed installed when they are not.
 */
import sharp from 'sharp'
import * as ort from 'onnxruntime-node'
import { getSession, localModelState } from '@/lib/media/local-models'

export interface RawImage {
  data: Uint8Array
  width: number
  height: number
}

export interface MatteStats {
  model: 'modnet' | 'u2netp'
  matteWidth: number
  matteHeight: number
  sourceWidth: number
  sourceHeight: number
  subjectFraction: number
  /** Fraction of pixels that are clearly background. */
  backgroundFraction: number
  latencyMs: number
}

export interface MatteResult {
  /** Float32 alpha at the SOURCE resolution (w*h), 0..1. */
  alpha: Float32Array
  width: number
  height: number
  stats: MatteStats
  /** True when the measured coverage supports a usable subject. */
  usable: boolean
  /** Honest rejection reason when unusable. */
  rejection?: string
}

const MATTE_MAX_SIDE = Number(process.env.BEAN_MATTE_MAX_SIDE ?? 1024)
const MATTE_SHORT_EDGE = Number(process.env.BEAN_MATTE_SHORT_EDGE ?? 512)

/**
 * Working dims for MODNet, matching the Xenova/modnet processor config
 * (resize so the SHORTEST edge is 512, keep aspect, snap both sides to /32
 * for the encoder's concat alignment — non-aligned dims fail with a Concat
 * axis-3 mismatch, measured). The long side is bounded by MATTE_MAX_SIDE to
 * keep CPU compute/memory bounded; the alpha is always upsampled back to the
 * FULL source resolution, so working scale never discards source pixels.
 */
function evenDims(w: number, h: number): { mw: number; mh: number } {
  const short = Math.min(w, h)
  const scale = MATTE_SHORT_EDGE / short
  const cap = MATTE_MAX_SIDE / Math.max(w, h)
  const s = Math.min(scale, cap, 4)
  return {
    mw: Math.max(32, Math.round((w * s) / 32) * 32),
    mh: Math.max(32, Math.round((h * s) / 32) * 32),
  }
}

/** Decode arbitrary image bytes into RGB raw at source dimensions. */
export async function decodeRaw(bytes: Buffer): Promise<RawImage> {
  const img = sharp(bytes).rotate()
  const meta = await img.metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  if (!w || !h) throw new Error('The image could not be decoded (missing dimensions).')
  const data = await img.removeAlpha().raw().toBuffer()
  return { data, width: w, height: h }
}

/**
 * Bilinear upsample of a single-channel float matte to target dims — pure
 * typed-array math, NO sharp pipeline. Measured 2026-11-18: routing the
 * 1-channel raw matte through sharp's resize silently corrupted it in this
 * environment (striped, coverage collapsed 57%→19%) — the same failure the
 * transposed-tensor bug produced. Plain bilinear sampling is deterministic,
 * keeps the model's soft edge quality, and has no format quirks.
 */
function upsampleAlpha(
  alpha: Float32Array,
  w: number,
  h: number,
  tw: number,
  th: number,
): Float32Array {
  const out = new Float32Array(tw * th)
  const sx = w / tw
  const sy = h / th
  for (let y = 0; y < th; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(h - 1, y0 + 1)
    const wy = fy - y0
    const row0 = y0 * w
    const row1 = y1 * w
    const outRow = y * tw
    for (let x = 0; x < tw; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(w - 1, x0 + 1)
      const wx = fx - x0
      const a00 = alpha[row0 + x0]
      const a01 = alpha[row0 + x1]
      const a10 = alpha[row1 + x0]
      const a11 = alpha[row1 + x1]
      out[outRow + x] = a00 * (1 - wy) * (1 - wx) + a01 * (1 - wy) * wx + a10 * wy * (1 - wx) + a11 * wy * wx
    }
  }
  return out
}

function matteStats(alpha: Float32Array, w: number, h: number, model: MatteStats['model'], latencyMs: number, sourceWidth: number, sourceHeight: number): Omit<MatteStats, 'matteWidth' | 'matteHeight'> {
  let subject = 0
  let background = 0
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] > 0.5) subject++
    else if (alpha[i] < 0.05) background++
  }
  return {
    model,
    sourceWidth,
    sourceHeight,
    subjectFraction: +(subject / alpha.length).toFixed(4),
    backgroundFraction: +(background / alpha.length).toFixed(4),
    latencyMs,
  }
}

/** MODNet matting at the working resolution; alpha returned at source dims. */
export async function runPortraitMatte(
  source: RawImage,
): Promise<MatteResult & { usable: boolean; rejection?: string }> {
  const t0 = Date.now()
  const { mw, mh } = evenDims(source.width, source.height)
  const session = await getSession('modnet')
  const work = await sharp(source.data, { raw: { width: source.width, height: source.height, channels: 3 } })
    .resize(mw, mh, { fit: 'fill' })
    .raw()
    .toBuffer()
  // ONNX vision tensors are CHANNELS-FIRST (NCHW): the buffer is three
  // planes (R, G, B), NOT pixel-interleaved. Feeding HWC-interleaved bytes
  // as [1,3,mw,mh] produces garbage mattes (measured 2026-11-18: noise with
  // horizontal striping on portraits the model segments near-perfectly in
  // the correct layout). Preprocessing per the Xenova/modnet processor
  // config: rescale 1/255, then normalize mean 0.5 / std 0.5 → [-1, 1].
  const n = mw * mh
  const input = new Float32Array(n * 3)
  for (let p = 0; p < n; p++) {
    input[p] = (work[p * 3] / 255 - 0.5) / 0.5
    input[n + p] = (work[p * 3 + 1] / 255 - 0.5) / 0.5
    input[2 * n + p] = (work[p * 3 + 2] / 255 - 0.5) / 0.5
  }
  // Tensor names are model-specific (MODNet: 'input'; other exports differ)
  // — use the session's own names instead of hardcoding.
  // DIMS ORDER: [1, 3, H, W] = [1, 3, mh, mw] (rows = mh). Building it as
  // [1,3,mw,mh] silently TRANSPOSES the image for every non-square input —
  // measured 2026-11-18: a 512x768 portrait fed transposed produced a
  // garbage 14.6%-subject matte; the same pixels in the correct order
  // produce a clean 57%-subject matte with crisp hair edges.
  const inName = session.inputNames[0]
  const out = await session.run({ [inName]: new ort.Tensor('float32', input, [1, 3, mh, mw]) })
  const alphaOut = out[session.outputNames[0]] as ort.Tensor
  const rawAlpha = alphaOut.data as Float32Array
  const alpha = upsampleAlpha(rawAlpha, mw, mh, source.width, source.height)
  const stats = matteStats(alpha, source.width, source.height, 'modnet', Date.now() - t0, source.width, source.height)
  const usable = stats.subjectFraction >= 0.01 && stats.subjectFraction <= 0.985
  return {
    alpha,
    width: source.width,
    height: source.height,
    stats: { ...stats, matteWidth: mw, matteHeight: mh },
    usable,
    rejection: usable
      ? undefined
      : stats.subjectFraction < 0.01
        ? `no usable subject measured (subject fraction ${stats.subjectFraction}) — the matte would remove the whole image`
        : `the matte covers nearly the whole frame (subject fraction ${stats.subjectFraction}) — no separable background`,
  }
}

/** U^2-Netp salient-object fallback (320x320 internal). */
export async function runSaliencyMatte(source: RawImage): Promise<MatteResult & { usable: boolean; rejection?: string }> {
  const t0 = Date.now()
  const session = await getSession('u2netp')
  const size = 320
  const work = await sharp(source.data, { raw: { width: source.width, height: source.height, channels: 3 } })
    .resize(size, size, { fit: 'fill' })
    .raw()
    .toBuffer()
  const input = new Float32Array(size * size * 3)
  // U^2-Net preprocessing (rembg reference): ImageNet mean/std — plain /255
  // collapses the saliency map (measured 2026-11-18: subject fraction 0.0005
  // on a high-contrast synthetic subject vs 0.44 with proper normalization).
  // ALSO channels-first (NCHW): three planes, not pixel-interleaved — same
  // layout rule verified on MODNet (see runPortraitMatte).
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  const n = size * size
  for (let p = 0; p < n; p++) {
    input[p] = (work[p * 3] / 255 - mean[0]) / std[0]
    input[n + p] = (work[p * 3 + 1] / 255 - mean[1]) / std[1]
    input[2 * n + p] = (work[p * 3 + 2] / 255 - mean[2]) / std[2]
  }
  // U^2-Netp exports name the single input 'input.1' and emit seven side
  // outputs — the FIRST output is the final saliency map (d0).
  const inName = session.inputNames[0]
  const out = await session.run({ [inName]: new ort.Tensor('float32', input, [1, 3, size, size]) })
  const map = out[session.outputNames[0]] as ort.Tensor
  const d = map.data as Float32Array
  // min-max normalize (standard U^2-Net post-processing)
  let min = 1, max = 0
  for (const v of d) { if (v < min) min = v; if (v > max) max = v }
  const norm = new Float32Array(d.length)
  const span = Math.max(1e-6, max - min)
  for (let i = 0; i < d.length; i++) norm[i] = (d[i] - min) / span
  const alpha = upsampleAlpha(norm, size, size, source.width, source.height)
  const stats = matteStats(alpha, source.width, source.height, 'u2netp', Date.now() - t0, source.width, source.height)
  const usable = stats.subjectFraction >= 0.01 && stats.subjectFraction <= 0.985
  return {
    alpha,
    width: source.width,
    height: source.height,
    stats: { ...stats, matteWidth: size, matteHeight: size },
    usable,
    rejection: usable
      ? undefined
      : `no usable salient subject measured (subject fraction ${stats.subjectFraction}) — the image does not contain a distinct subject`,
  }
}

/**
 * Best-available matte: MODNet first, u2netp fallback when the portrait
 * matte finds no usable subject. Fails honestly when neither model is
 * installed or neither finds a subject.
 */
export async function runBestMatte(source: RawImage): Promise<MatteResult & { usable: boolean; rejection?: string }> {
  if (localModelState('modnet').state !== 'ready' && localModelState('u2netp').state !== 'ready') {
    throw new Error(
      'Background removal needs a local matting model (modnet or u2netp) and neither is installed on this host. Install it explicitly — see the deployment guide.',
    )
  }
  if (localModelState('modnet').state === 'ready') {
    const m = await runPortraitMatte(source)
    if (m.usable) return m
    if (localModelState('u2netp').state === 'ready') {
      const s = await runSaliencyMatte(source)
      if (s.usable) return s
      throw new Error(`Background removal could not find a usable subject: ${m.rejection} (portrait matte) / ${s.rejection} (saliency fallback).`)
    }
    throw new Error(`Background removal could not find a usable subject: ${m.rejection}.`)
  }
  const s = await runSaliencyMatte(source)
  if (!s.usable) throw new Error(`Background removal could not find a usable subject: ${s.rejection}.`)
  return s
}

/** Composite a float alpha over the source RGB into an RGBA buffer. */
export function alphaToRgba(source: RawImage, alpha: Float32Array): Buffer {
  const rgba = Buffer.alloc(source.width * source.height * 4)
  for (let p = 0; p < source.width * source.height; p++) {
    rgba[p * 4] = source.data[p * 3]
    rgba[p * 4 + 1] = source.data[p * 3 + 1]
    rgba[p * 4 + 2] = source.data[p * 3 + 2]
    // Near-binary hardening for cutout export (measured 2026-11-18: MODNet's
    // soft interior alphas top out around 0.98-0.99, so a naive round() never
    // reaches alpha 255 and the exported cutout has NO fully-opaque pixel).
    // Standard matte hardening: snap the clear background and the confident
    // subject interior to binary while the feather band keeps its soft edge.
    let a = alpha[p]
    if (a >= 0.95) a = 1
    else if (a <= 0.05) a = 0
    rgba[p * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)))
  }
  return rgba
}

/** Hex color (#rgb/#rrggbb) or named white/black → RGB triple. */
export function parseBackgroundColor(spec: string): { r: number; g: number; b: number } {
  const named: Record<string, [number, number, number]> = {
    white: [255, 255, 255],
    black: [0, 0, 0],
  }
  const n = named[spec.toLowerCase()]
  if (n) return { r: n[0], g: n[1], b: n[2] }
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(spec)
  if (!m) throw new Error(`Unsupported background color '${spec}' — use #rrggbb, 'white' or 'black'.`)
  const hex = m[1]
  if (hex.length === 3) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    }
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  }
}

/** Flatten RGBA over a solid background color → RGB buffer. */
export function flattenOnColor(rgba: Buffer, w: number, h: number, color: { r: number; g: number; b: number }): Buffer {
  const rgb = Buffer.alloc(w * h * 3)
  for (let p = 0; p < w * h; p++) {
    const a = rgba[p * 4 + 3] / 255
    rgb[p * 3] = Math.round(rgba[p * 4] * a + color.r * (1 - a))
    rgb[p * 3 + 1] = Math.round(rgba[p * 4 + 1] * a + color.g * (1 - a))
    rgb[p * 3 + 2] = Math.round(rgba[p * 4 + 2] * a + color.b * (1 - a))
  }
  return rgb
}
