/**
 * LAXII — preservation engine (Phase 1). THE core product mechanism.
 *
 * Guarantees implemented here (mechanisms, not prompt tricks):
 *  1. Masks are first-class byte artifacts: decoded at EXACT image geometry,
 *     never guessed or silently resized; positive/negative strokes merge
 *     into one scalar alpha field.
 *  2. Mask shaping is explicit and configurable: dilation (grow), erosion
 *     (shrink) and feathering (soft edge) are separable filters on the
 *     alpha field, so users choose how far generation may reach.
 *  3. Compositing is exact: for every pixel whose final mask alpha is 0 the
 *     output takes the ORIGINAL image bytes verbatim — bit-exact, not
 *     "close". Feathered bands blend linearly; the report counts them
 *     separately so "preserved" never quietly includes blended pixels.
 *  4. Face protection is a hard geometric gate: user-approved face regions
 *     are subtracted from the editable mask (with optional feathered
 *     boundary) BEFORE any generation runs, and the report measures whether
 *     protected regions changed in the final artifact.
 *  5. Validation is measurement: dimensions, exact-preserved %, changed %,
 *     protected-region equality, generative-op disclosure. All reported
 *     numbers are computed from the actual buffers, never asserted.
 */
import sharp from 'sharp'
import {
  LaxiiImageError,
  regionChanged,
  type RawImage,
  type Rect,
  clampRect,
} from './metrics'

export type MaskKind = 'edit' | 'protect'

export interface MaskStroke {
  kind: MaskKind
  /** PNG with alpha carrying stroke coverage; must match image geometry. */
  png: Buffer
}

export interface ShapedMask {
  /** Float32 alpha per pixel, 0..1 (1 = fully editable/generated). */
  alpha: Float32Array
  width: number
  height: number
}

export interface MaskShaping {
  /** Grow the editable region by N px before feathering (default 0). */
  expandPx: number
  /** Soft-edge width in px (gaussian sigma; 0 = hard edge). Default 4. */
  featherPx: number
}

export const DEFAULT_SHAPING: MaskShaping = { expandPx: 0, featherPx: 4 }

export interface PreservationReport {
  inputWidth: number
  inputHeight: number
  outputWidth: number
  outputHeight: number
  dimensionsChanged: boolean
  /** % of pixels that are bit-exact original bytes. */
  exactPreservedPct: number
  /** % of pixels in the feather/blend band (partially modified). */
  blendedPct: number
  /** % of pixels differing from the original beyond threshold 2/255. */
  changedPct: number
  /** Editable-region coverage after shaping (what generation could touch). */
  editablePct: number
  protectedRegions: Array<{ rect: Rect; changed: boolean; source: 'user' | 'face-auto' | 'face-user' }>
  generativeUsed: boolean
  /** Present only when an identity metric ran (worker); a similarity
   *  ESTIMATE — never proof of identical identity. */
  identitySimilarity?: { score: number; threshold: number; passed: boolean; metric: string }
  /** Human-readable summary computed from the numbers above. */
  summary: string
}

// ---- mask decoding & shaping ----------------------------------------------

/**
 * Decode stroke PNG(s) into a scalar alpha field at exact image geometry.
 * Any geometry mismatch is a hard error — a silently rescaled mask would
 * violate the preservation contract.
 */
export async function buildMask(
  strokes: MaskStroke[],
  width: number,
  height: number,
): Promise<ShapedMask> {
  if (strokes.length === 0) {
    throw new LaxiiImageError('A mask is required for this operation.')
  }
  const alpha = new Float32Array(width * height)
  for (const stroke of strokes) {
    let raw: { data: Buffer; width: number; height: number; channels: number }
    try {
      const decoded = await sharp(stroke.png).raw().toBuffer({ resolveWithObject: true })
      raw = { data: decoded.data, width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels }
    } catch {
      throw new LaxiiImageError('Mask is not a decodable image.')
    }
    if (raw.width !== width || raw.height !== height) {
      throw new LaxiiImageError(
        `Mask geometry ${raw.width}x${raw.height} does not match image ${width}x${height}. ` +
          'Masks must be exported at the exact image size; nothing is auto-rescaled.',
      )
    }
    const ch = raw.channels
    const weight = stroke.kind === 'edit' ? 1 : -1
    for (let p = 0; p < width * height; p++) {
      // Coverage source by channel count: G=the value itself, GA/G=opaque,
      // GA/RGBA=the alpha byte. (Grayscale masks are the common export.)
      const a =
        ch === 1
          ? raw.data[p]
          : ch === 2
            ? raw.data[p * 2 + 1]
            : ch === 3
              ? 255
              : raw.data[p * 4 + 3]
      alpha[p] = Math.max(0, Math.min(1, alpha[p] + weight * (a / 255)))
    }
  }
  return { alpha, width, height }
}

/** Separable max-filter (dilation) on a scalar field. */
export function dilateMask(mask: ShapedMask, radius: number): ShapedMask {
  if (radius <= 0) return mask
  const { alpha, width: w, height: h } = mask
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(w - 1, x + radius)
      for (let k = x0; k <= x1; k++) m = Math.max(m, alpha[y * w + k])
      tmp[y * w + x] = m
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 0
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(h - 1, y + radius)
      for (let k = y0; k <= y1; k++) m = Math.max(m, tmp[k * w + x])
      out[y * w + x] = m
    }
  }
  return { alpha: out, width: w, height: h }
}

/** Separable min-filter (erosion) on a scalar field. */
export function erodeMask(mask: ShapedMask, radius: number): ShapedMask {
  if (radius <= 0) return mask
  const { alpha, width: w, height: h } = mask
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 1
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(w - 1, x + radius)
      for (let k = x0; k <= x1; k++) m = Math.min(m, alpha[y * w + k])
      tmp[y * w + x] = m
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let m = 1
      const y0 = Math.max(0, y - radius)
      const y1 = Math.min(h - 1, y + radius)
      for (let k = y0; k <= y1; k++) m = Math.min(m, tmp[k * w + x])
      out[y * w + x] = m
    }
  }
  return { alpha: out, width: w, height: h }
}

/**
 * Feather the mask edge with a true gaussian blur (separable, two-pass) so
 * generated content blends instead of stamping a hard cut.
 */
export function featherMask(mask: ShapedMask, sigmaPx: number): ShapedMask {
  if (sigmaPx <= 0) return mask
  const { alpha, width: w, height: h } = mask
  const radius = Math.ceil(sigmaPx * 3)
  const kernel: number[] = []
  let kSum = 0
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp(-(k * k) / (2 * sigmaPx * sigmaPx))
    kernel.push(v)
    kSum += v
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum

  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k))
        acc += alpha[y * w + xx] * kernel[k + radius]
      }
      tmp[y * w + x] = acc
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k))
        acc += tmp[yy * w + x] * kernel[k + radius]
      }
      out[y * w + x] = acc
    }
  }
  return { alpha: out, width: w, height: h }
}

export function shapeMask(mask: ShapedMask, shaping: MaskShaping): ShapedMask {
  let m = mask
  if (shaping.expandPx > 0) m = dilateMask(m, shaping.expandPx)
  if (shaping.featherPx > 0) m = featherMask(m, shaping.featherPx)
  return m
}

// ---- face protection -------------------------------------------------------

export interface FaceZone {
  rect: Rect
  source: 'user' | 'face-auto' | 'face-user'
}

/**
 * Subtract protected zones from the editable mask (hard geometric gate run
 * BEFORE generation). `boundaryFeatherPx` softens the protection edge so
 * edited content fades out near faces instead of cutting abruptly.
 */
export function applyFaceProtection(
  mask: ShapedMask,
  zones: FaceZone[],
  boundaryFeatherPx = 3,
): { mask: ShapedMask; suppressedPct: number } {
  if (zones.length === 0) return { mask, suppressedPct: 0 }
  const { width: w, height: h } = mask
  const protect = new Float32Array(w * h) // 1 = protected
  for (const z of zones) {
    const c = clampRect(z.rect, w, h)
    if (!c) continue
    for (let y = c.y; y < c.y + c.height; y++) {
      for (let x = c.x; x < c.x + c.width; x++) protect[y * w + x] = 1
    }
  }
  // Expand protection slightly so the feather eats into the EDIT area, not
  // into the protected face itself. The soft field is then CLAMPED by the
  // hard rect: inside the rect protection is exactly 1 (zero editability),
  // and the feather only softens the transition on the edit side.
  const grown = dilateMask({ alpha: protect, width: w, height: h }, boundaryFeatherPx)
  const soft = boundaryFeatherPx > 0 ? featherMask(grown, boundaryFeatherPx) : grown
  const out = new Float32Array(w * h)
  let suppressed = 0
  for (let p = 0; p < w * h; p++) {
    const pSoft = Math.max(soft.alpha[p], protect[p])
    const keepEditable = 1 - pSoft // 1 outside protection
    const v = mask.alpha[p] * keepEditable
    if (mask.alpha[p] > 0 && v === 0) suppressed++
    out[p] = v
  }
  return {
    mask: { alpha: out, width: w, height: h },
    suppressedPct: (suppressed / (w * h)) * 100,
  }
}

// ---- compositing -----------------------------------------------------------

export interface CompositeOptions {
  /**
   * false (default): every pixel outside the final mask takes the ORIGINAL
   *   bytes verbatim — the strict-preserve guarantee.
   * true: the operation is a user-approved GLOBAL color/exposure change, so
   *   processed values are kept everywhere; geometry still comes from the
   *   original and the report labels the operation accordingly.
   */
  globalColorChange: boolean
}

export interface CompositeResult {
  data: Uint8Array
  /** bit-exact original pixels (%). */
  exactPreservedPct: number
  /** partial-blend band (%). */
  blendedPct: number
  /** generated/processed pixels (%). */
  generatedPct: number
}

/**
 * Blend a processed/generated buffer with the original under mask control.
 * alpha==0 -> exact original bytes; alpha==1 -> processed bytes; between ->
 * linear blend. With globalColorChange the whole frame uses the processed
 * values (still blended by mask so untouched regions stay exact when the
 * op is region-scoped in its own math — the flag documents the intent).
 */
export function compositePreserved(
  original: RawImage,
  processed: RawImage,
  mask: ShapedMask,
  opts: CompositeOptions = { globalColorChange: false },
): CompositeResult {
  const w = original.width
  const h = original.height
  if (processed.width !== w || processed.height !== h) {
    throw new LaxiiImageError('Processed buffer geometry must match the original.')
  }
  if (mask.width !== w || mask.height !== h) {
    throw new LaxiiImageError('Mask geometry must match the original.')
  }
  const out = new Uint8Array(w * h * 3)
  let exact = 0
  let blended = 0
  let generated = 0
  const n = w * h
  for (let p = 0, i = 0; p < n; p++, i += 3) {
    const a = opts.globalColorChange ? 1 : mask.alpha[p]
    if (a <= 0) {
      out[i] = original.data[i]
      out[i + 1] = original.data[i + 1]
      out[i + 2] = original.data[i + 2]
      exact++
    } else if (a >= 1) {
      out[i] = processed.data[i]
      out[i + 1] = processed.data[i + 1]
      out[i + 2] = processed.data[i + 2]
      generated++
    } else {
      const ia = 1 - a
      out[i] = Math.round(original.data[i] * ia + processed.data[i] * a)
      out[i + 1] = Math.round(original.data[i + 1] * ia + processed.data[i + 1] * a)
      out[i + 2] = Math.round(original.data[i + 2] * ia + processed.data[i + 2] * a)
      blended++
    }
  }
  return {
    data: out,
    exactPreservedPct: (exact / n) * 100,
    blendedPct: (blended / n) * 100,
    generatedPct: (generated / n) * 100,
  }
}

/** Encode a raw RGB buffer as PNG (lossless hand-off between stages). */
export function encodePng(data: Uint8Array, width: number, height: number): Promise<Buffer> {
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
    raw: { width, height, channels: 3 },
  })
    .png({ compressionLevel: 6 })
    .toBuffer()
}

// ---- validation ------------------------------------------------------------

export interface ValidationInput {
  original: RawImage
  output: RawImage
  /** Final shaped mask (after face protection). Null = no mask existed. */
  mask: ShapedMask | null
  faceZones: FaceZone[]
  generativeUsed: boolean
  identitySimilarity?: PreservationReport['identitySimilarity']
  /** Label of the pipeline that produced `output` (for the summary). */
  pipeline: string
}

/**
 * Measure what ACTUALLY happened between the original and the final output.
 * Every number is computed from bytes. This is the artifact users see.
 */
export function validatePreservation(input: ValidationInput): PreservationReport {
  const { original, output, mask, faceZones, generativeUsed, pipeline } = input
  const n = original.width * original.height
  const dimsChanged = original.width !== output.width || original.height !== output.height

  let exact = 0
  let blended = 0
  let changed = 0
  if (!dimsChanged) {
    for (let p = 0, i = 0; p < n; p++, i += 3) {
      const a = mask ? mask.alpha[p] : 0
      const differs =
        Math.abs(original.data[i] - output.data[i]) > 2 ||
        Math.abs(original.data[i + 1] - output.data[i + 1]) > 2 ||
        Math.abs(original.data[i + 2] - output.data[i + 2]) > 2
      if (differs) changed++
      if (a <= 0) {
        if (
          original.data[i] === output.data[i] &&
          original.data[i + 1] === output.data[i + 1] &&
          original.data[i + 2] === output.data[i + 2]
        ) {
          exact++
        }
      } else if (a < 1) {
        blended++
      }
    }
  }

  const protectedRegions = faceZones.map((z) => ({
    rect: z.rect,
    changed: dimsChanged ? true : regionChanged(original, output, z.rect, 0),
    source: z.source,
  }))

  let editablePct = 0
  if (mask) {
    let e = 0
    for (let p = 0; p < n; p++) if (mask.alpha[p] > 0) e++
    editablePct = (e / n) * 100
  }

  const exactPreservedPct = dimsChanged ? 0 : (exact / n) * 100
  const changedPct = dimsChanged ? 100 : (changed / n) * 100
  const blendedPct = dimsChanged ? 0 : (blended / n) * 100
  const anyProtectedChanged = protectedRegions.some((r) => r.changed)

  const parts: string[] = []
  parts.push(
    dimsChanged
      ? `Output dimensions differ from the original (${original.width}x${original.height} → ${output.width}x${output.height}); pixel-preservation percentages are not comparable and are reported as 0/100.`
      : `${exactPreservedPct.toFixed(2)}% of pixels are bit-exact original bytes; ${blendedPct.toFixed(2)}% sit in a feathered blend band; ${changedPct.toFixed(2)}% changed beyond the 2/255 threshold.`,
  )
  parts.push(generativeUsed ? 'A generative model ran inside the editable region.' : 'No generative model ran — deterministic processing only.')
  if (faceZones.length > 0) {
    parts.push(
      anyProtectedChanged
        ? `WARNING: ${protectedRegions.filter((r) => r.changed).length} of ${faceZones.length} protected face regions changed.`
        : `All ${faceZones.length} protected face regions are pixel-identical to the original.`,
    )
  }
  if (input.identitySimilarity) {
    parts.push(
      `Face similarity score ${input.identitySimilarity.score.toFixed(3)} (${input.identitySimilarity.metric}) against threshold ${input.identitySimilarity.threshold}: ${input.identitySimilarity.passed ? 'within range' : 'FLAGGED — review before use'}. A similarity score is an estimate, not proof of identical identity.`,
    )
  }
  parts.push(`Pipeline: ${pipeline}.`)

  return {
    inputWidth: original.width,
    inputHeight: original.height,
    outputWidth: output.width,
    outputHeight: output.height,
    dimensionsChanged: dimsChanged,
    exactPreservedPct,
    blendedPct,
    changedPct,
    editablePct,
    protectedRegions,
    generativeUsed,
    identitySimilarity: input.identitySimilarity,
    summary: parts.join(' '),
  }
}
