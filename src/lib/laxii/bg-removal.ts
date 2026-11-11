/**
 * BEAN Intelligence — LAXII background removal (deterministic cutout stage).
 *
 * OPERATIONAL-TRANSFORMATION (2026-11-11), Phase 4. MEASURED constraint:
 * the authorized hosted editing endpoint returns OPAQUE JPEG only — it has
 * no alpha output (measured 2026-11-11: request for a transparent cutout
 * returned 1312x1312 JPEG, 0% transparent pixels). Claiming "background
 * removal → transparent PNG" directly from that endpoint would be a fake
 * capability. The REAL pipeline is two stages, each genuinely executed:
 *
 *  1. GENERATIVE subject separation (hosted edit): the provider is asked to
 *     replace the entire background with a uniform chroma-key green. A
 *     2026-11-11 live probe measured a highly uniform key (corner samples
 *     within ±3 RGB, ~86% of pixels in the green class) — the provider
 *     performs the subject/background SEPARATION.
 *  2. DETERMINISTIC chroma cutout (this module, Sharp-free math on raw
 *     buffers): the border-ring median color is measured as the key, every
 *     pixel's distance to the key sets its alpha through a smooth feather,
 *     and green spill on semi-transparent edges is suppressed. The output
 *     is a true alpha PNG.
 *
 * Honesty rules:
 *  - the key color is MEASURED from the image, never assumed #00FF00;
 *  - every result carries the measured key, thresholds and coverage
 *    fractions — the job payload states what actually happened;
 *  - a result without meaningful transparency (or without a subject) is an
 *    HONEST FAILURE, never stored as a successful cutout;
 *  - the original image is never modified.
 */
import type { RawImage } from './metrics'

export interface ChromaStats {
  /** The measured key color (border-ring median). */
  key: { r: number; g: number; b: number }
  /** Per-channel max deviation across the border ring (uniformity measure). */
  keySpread: number
  /** Distance thresholds derived from the measured spread. */
  inner: number
  outer: number
  /** Fraction of pixels fully transparent (background removed). */
  transparentFraction: number
  /** Fraction of pixels fully opaque (the subject). */
  opaqueFraction: number
}

export interface CutoutResult {
  /** RGBA buffer (width*height*4). */
  rgba: Buffer
  width: number
  height: number
  stats: ChromaStats
}

/** Median of a numeric array (even lengths: lower middle). */
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

/**
 * Measure the chroma key from the image BORDER RING (outermost 2% of each
 * dimension, min 2px): the median R/G/B of the ring plus the max per-channel
 * spread — the honest measure of how uniform the provider's background is.
 */
export function measureChromaKey(raw: RawImage): { key: { r: number; g: number; b: number }; spread: number } {
  const band = Math.max(2, Math.round(Math.min(raw.width, raw.height) * 0.02))
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const sample = (x: number, y: number) => {
    const i = (y * raw.width + x) * 3
    rs.push(raw.data[i])
    gs.push(raw.data[i + 1])
    bs.push(raw.data[i + 2])
  }
  for (let y = 0; y < raw.height; y++) {
    const edgeRow = y < band || y >= raw.height - band
    for (let x = 0; x < raw.width; x++) {
      if (edgeRow || x < band || x >= raw.width - band) sample(x, y)
    }
  }
  const key = { r: Math.round(median(rs)), g: Math.round(median(gs)), b: Math.round(median(bs)) }
  // Spread: max deviation of ring samples from the key (per channel, 95th
  // percentile to ignore isolated border artifacts).
  const deviations: number[] = []
  for (let i = 0; i < rs.length; i++) {
    deviations.push(Math.max(Math.abs(rs[i] - key.r), Math.abs(gs[i] - key.g), Math.abs(bs[i] - key.b)))
  }
  deviations.sort((a, b) => a - b)
  const spread = deviations[Math.floor(deviations.length * 0.95)] ?? 0
  return { key, spread }
}

/**
 * Two-stage chroma cutout (see module doc): measured key → per-pixel alpha
 * with smooth feather → green spill suppression on semi-transparent edges.
 */
export function chromaCutout(raw: RawImage): CutoutResult {
  const { key, spread } = measureChromaKey(raw)
  // Thresholds adapt to the measured uniformity: pixels essentially ON the
  // key go fully transparent; beyond `outer` they stay fully opaque; between
  // them alpha feathers smoothly (soft hair/edge handling).
  const inner = Math.max(24, spread * 2.5)
  const outer = Math.max(inner + 32, spread * 6)
  const rgba = Buffer.alloc(raw.width * raw.height * 4)
  let transparent = 0
  let opaque = 0
  for (let p = 0; p < raw.width * raw.height; p++) {
    const i = p * 3
    const o = p * 4
    const r = raw.data[i]
    const g = raw.data[i + 1]
    const b = raw.data[i + 2]
    const dr = r - key.r
    const dg = g - key.g
    const db = b - key.b
    const dist = Math.sqrt(dr * dr + dg * dg + db * db)
    let alpha: number
    if (dist <= inner) alpha = 0
    else if (dist >= outer) alpha = 255
    else {
      const t = (dist - inner) / (outer - inner)
      // smoothstep for a clean feather
      alpha = Math.round(t * t * (3 - 2 * t) * 255)
    }
    let or_ = r
    let og = g
    let ob = b
    if (alpha > 0 && alpha < 255) {
      // DESPILL: on feathered edges, clamp green to the max of R/B so the
      // key's green does not halo the subject.
      og = Math.min(g, Math.max(r, b) + 8)
    }
    rgba[o] = or_
    rgba[o + 1] = og
    rgba[o + 2] = ob
    rgba[o + 3] = alpha
    if (alpha === 0) transparent++
    else if (alpha === 255) opaque++
  }
  const total = raw.width * raw.height
  return {
    rgba,
    width: raw.width,
    height: raw.height,
    stats: {
      key,
      keySpread: spread,
      inner: Math.round(inner),
      outer: Math.round(outer),
      transparentFraction: +(transparent / total).toFixed(4),
      opaqueFraction: +(opaque / total).toFixed(4),
    },
  }
}

/** The fixed generative instruction for stage 1 (kept beside the math so the
 *  two stages stay consistent). The subject must not be green — enforced by
 *  the prompt and verified by the coverage validation below. */
export const CHROMA_BG_PROMPT =
  'Replace the entire background with a completely uniform, solid, flat pure green chroma-key ' +
  'background (exact color #00FF00 everywhere behind the subject, no gradients, no shadows on ' +
  'the background, no green tint on the subject). Keep the main subject exactly as it is, with ' +
  'clean edges. The subject itself must NOT be green.'

/**
 * Validate the cutout is a real, usable transparency — not a degenerate
 * all-transparent or all-opaque frame. Returns an honest error string or
 * null when the measurement supports a "background removed" claim.
 */
export function validateCutout(stats: ChromaStats): string | null {
  if (stats.transparentFraction < 0.02) {
    return `no meaningful background separation measured (transparent fraction ${stats.transparentFraction}) — the background could not be removed`
  }
  if (stats.opaqueFraction < 0.02) {
    return `no subject measured (opaque fraction ${stats.opaqueFraction}) — the cutout would remove the image content`
  }
  if (stats.keySpread > 120) {
    return `the generated background was not uniform enough to key reliably (border spread ${stats.keySpread})`
  }
  return null
}
