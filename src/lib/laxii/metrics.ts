/**
 * LAXII — image metrics (Phase 1/7).
 *
 * Pure, deterministic measurement utilities used by the preservation engine
 * and the validation reports. Everything here operates on raw RGB buffers
 * (sharp `.raw()` output) so the numbers are exact pixel facts, not
 * perceptual guesses. No ML model is involved in ANY metric in this module.
 */
import sharp from 'sharp'

export interface RawImage {
  data: Uint8Array // RGB, 3 bytes per pixel
  width: number
  height: number
}

export interface ChangeStats {
  totalPixels: number
  /** Pixels whose |diff| exceeds `threshold` on any channel. */
  changedPixels: number
  changedPct: number
  meanAbsDiff: number
  /** Peak signal-to-noise ratio in dB (null for identical buffers). */
  psnrDb: number | null
}

export class LaxiiImageError extends Error {}

/** Decode any supported image into an RGB raw buffer. */
export async function toRaw(input: Buffer): Promise<RawImage> {
  try {
    const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({
      resolveWithObject: true,
    })
    return { data: new Uint8Array(data), width: info.width, height: info.height }
  } catch (e) {
    throw new LaxiiImageError(
      `Input could not be decoded as an image: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

export function assertSameGeometry(a: RawImage, b: RawImage, what = 'comparison'): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new LaxiiImageError(
      `${what}: geometry mismatch (${a.width}x${a.height} vs ${b.width}x${b.height})`,
    )
  }
  if (a.data.length !== b.data.length) {
    throw new LaxiiImageError(`${what}: buffer length mismatch`)
  }
}

function lumaAt(img: RawImage, x: number, y: number): number {
  const i = (y * img.width + x) * 3
  return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]
}

/** Compare two raw images pixel-by-pixel. */
export function analyzeChange(
  original: RawImage,
  output: RawImage,
  threshold = 2,
): ChangeStats {
  assertSameGeometry(original, output, 'change analysis')
  const n = original.width * original.height
  let changed = 0
  let sumAbs = 0
  let sumSq = 0
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    const dr = Math.abs(original.data[i] - output.data[i])
    const dg = Math.abs(original.data[i + 1] - output.data[i + 1])
    const db = Math.abs(original.data[i + 2] - output.data[i + 2])
    const m = Math.max(dr, dg, db)
    sumAbs += dr + dg + db
    sumSq += dr * dr + dg * dg + db * db
    if (m > threshold) changed++
  }
  const mse = sumSq / (n * 3)
  return {
    totalPixels: n,
    changedPixels: changed,
    changedPct: n === 0 ? 0 : (changed / n) * 100,
    meanAbsDiff: n === 0 ? 0 : sumAbs / (n * 3),
    psnrDb: mse === 0 ? null : 10 * Math.log10((255 * 255) / mse),
  }
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(w, Math.ceil(r.x + r.width))
  const y1 = Math.min(h, Math.ceil(r.y + r.height))
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** True when ANY pixel inside the rect differs beyond `threshold`. */
export function regionChanged(
  original: RawImage,
  output: RawImage,
  rect: Rect,
  threshold = 0,
): boolean {
  assertSameGeometry(original, output, 'region check')
  const c = clampRect(rect, original.width, original.height)
  if (!c) return false
  for (let y = c.y; y < c.y + c.height; y++) {
    for (let x = c.x; x < c.x + c.width; x++) {
      const i = (y * original.width + x) * 3
      if (
        Math.abs(original.data[i] - output.data[i]) > threshold ||
        Math.abs(original.data[i + 1] - output.data[i + 1]) > threshold ||
        Math.abs(original.data[i + 2] - output.data[i + 2]) > threshold
      ) {
        return true
      }
    }
  }
  return false
}

/**
 * Render an amplified visual difference map (PNG). Pure |diff| scaled by
 * `amplify` — a presentation artifact to help users see what moved, never a
 * substitute for the numeric report.
 */
export async function differenceMap(
  original: RawImage,
  output: RawImage,
  amplify = 8,
): Promise<Buffer> {
  assertSameGeometry(original, output, 'difference map')
  const n = original.width * original.height
  const px = Buffer.alloc(n * 3)
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    const dr = Math.abs(original.data[i] - output.data[i])
    const dg = Math.abs(original.data[i + 1] - output.data[i + 1])
    const db = Math.abs(original.data[i + 2] - output.data[i + 2])
    const m = Math.min(255, Math.max(dr, dg, db) * amplify)
    px[i] = m
    px[i + 1] = Math.max(0, m - 96)
    px[i + 2] = 0
  }
  return sharp(px, { raw: { width: original.width, height: original.height, channels: 3 } })
    .png({ compressionLevel: 6 })
    .toBuffer()
}

export interface NoiseAnalysis {
  /** Robust noise estimate (MAD of Laplacian) on luma, 0–255 scale. */
  noiseSigma: number
  /** Variance of the Laplacian — a sharpness proxy. */
  laplacianVariance: number
  meanLuma: number
  channelMeans: { r: number; g: number; b: number }
  clippedShadowsPct: number
  clippedHighlightsPct: number
  saturationMean: number
  isGrayscale: boolean
  width: number
  height: number
}

/**
 * Image analysis that drives the enhancement planner. Deterministic; the
 * noise figure uses a robust MAD estimator on the Laplacian so a handful of
 * edges cannot inflate it, subsampled on large images for bounded runtime.
 */
export function analyzeImage(img: RawImage): NoiseAnalysis {
  const { width: w, height: h, data } = img
  const n = w * h
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let sumSat = 0
  let shadows = 0
  let highlights = 0
  let lumaSum = 0
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    sumR += r
    sumG += g
    sumB += b
    lumaSum += 0.2126 * r + 0.7152 * g + 0.0722 * b
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    sumSat += mx === 0 ? 0 : (mx - mn) / mx
    if (mx <= 4) shadows++
    if (mn >= 251) highlights++
  }
  // Laplacian on the luma interior.
  const laps: number[] = []
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const l =
        4 * lumaAt(img, x, y) -
        lumaAt(img, x - 1, y) -
        lumaAt(img, x + 1, y) -
        lumaAt(img, x, y - 1) -
        lumaAt(img, x, y + 1)
      laps.push(l)
    }
  }
  const lapCount = laps.length || 1
  const lapMean = laps.reduce((s, v) => s + v, 0) / lapCount
  const lapVar = laps.reduce((s, v) => s + (v - lapMean) * (v - lapMean), 0) / lapCount
  // MAD-based sigma: sigma ≈ 1.4826 * median(|l - median|), subsampled for
  // bounded runtime on large images.
  const sample = laps.length > 400_000 ? laps.filter((_, k) => k % 7 === 0) : laps
  sample.sort((a, b) => a - b)
  const med = sample.length ? sample[Math.floor(sample.length / 2)] : 0
  const devs = sample.map((v) => Math.abs(v - med)).sort((a, b) => a - b)
  const mad = devs.length ? devs[Math.floor(devs.length / 2)] : 0
  return {
    noiseSigma: 1.4826 * mad,
    laplacianVariance: lapVar,
    meanLuma: lumaSum / n,
    channelMeans: { r: sumR / n, g: sumG / n, b: sumB / n },
    clippedShadowsPct: (shadows / n) * 100,
    clippedHighlightsPct: (highlights / n) * 100,
    saturationMean: sumSat / n,
    isGrayscale: sumSat / n < 0.02,
    width: w,
    height: h,
  }
}
