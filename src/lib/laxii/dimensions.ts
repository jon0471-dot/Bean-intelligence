/**
 * BEAN Intelligence — LAXII exact-dimension pipeline (CUSTOM IMAGE
 * DIMENSIONS + EXACT OUTPUT DIMENSION ACCURACY, 2026-11-11).
 *
 * The hosted provider generates only its 7 native sizes. Users may now
 * request ANY dimensions in the validated range, and the FINAL artifact must
 * measure exactly the requested pixels — verified from the decoded output
 * bytes, never from claimed metadata. The pipeline:
 *
 *   1. validate the requested dimensions (positive integers, bounds);
 *   2. check the provider's native dimension constraints;
 *   3. select a generation strategy that minimizes content loss:
 *        - native          -> requested size IS a provider size (zero
 *                             post-processing, identical to the preset path);
 *        - cover-crop      -> generate the native size that best COVERS the
 *                             target, high-quality Lanczos scale + center
 *                             crop (no distortion; main subject preserved —
 *                             center-biased);
 *        - pad-extend      -> for extreme aspect ratios where cover-crop
 *                             would discard too much (> CROP_LOSS_MAX),
 *                             generate the best-fitting native, scale to
 *                             FIT and extend the background with a blurred,
 *                             edge-derived fill (no black bars, no
 *                             distortion, nothing of the subject removed);
 *   4. re-encode with high-quality resampling and VERIFY the decoded
 *      dimensions equal the request exactly.
 *
 * Honesty rules (brief PART 2): exact output dimensions never imply native
 * model detail — the planner reports the GENERATION resolution and the
 * strategy separately from the final resolution, and callers must persist
 * both. Nothing is ever stretched to fit.
 */
import sharp from 'sharp'

/**
 * The provider-native generation sizes (M26.3 CORRECTED — measured contract).
 *
 * MEASURED PROVIDER CONTRACT (2026-11-18, live HTTP 400 code 1214, message
 * quoted verbatim from the gateway): both sides must be within 512–2880px,
 * BOTH MUST BE MULTIPLES OF 32, and total pixels must not exceed 2²².
 * The previous list contained 1440x720 and 720x1440 — 720 is NOT a multiple
 * of 32, so every generation planned onto them failed with HTTP 400.
 * Replacements and the true-16:9 additions below are all /32-aligned, inside
 * the per-side range, and under the pixel cap:
 *   2048x1152 = 2,359,296 px  (exact 16:9)
 *   1152x2048 = 2,359,296 px  (exact 9:16)
 *   2048x1024 = 2,097,152 px  (exact 2:1)
 *   1024x2048 = 2,097,152 px  (exact 1:2)
 */
export const NATIVE_SIZES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1024, height: 1024 },
  { width: 768, height: 1344 },
  { width: 864, height: 1152 },
  { width: 1344, height: 768 },
  { width: 1152, height: 864 },
  { width: 2048, height: 1152 },
  { width: 1152, height: 2048 },
  { width: 2048, height: 1024 },
  { width: 1024, height: 2048 },
]

/**
 * M26.3 — the provider's measured size contract (see NATIVE_SIZES above).
 * Every planned generation size is validated against this BEFORE the provider
 * call: a violation fails fast with an honest message instead of a cryptic
 * upstream 400 after quota spend.
 */
export const PROVIDER_SIZE_CONTRACT = {
  minSidePx: 512,
  maxSidePx: 2880,
  sideMultipleOf: 32,
  maxTotalPixels: 2 ** 22,
} as const

export function isValidProviderSize(width: number, height: number): boolean {
  const c = PROVIDER_SIZE_CONTRACT
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width % c.sideMultipleOf === 0 &&
    height % c.sideMultipleOf === 0 &&
    width >= c.minSidePx &&
    height >= c.minSidePx &&
    width <= c.maxSidePx &&
    height <= c.maxSidePx &&
    width * height <= c.maxTotalPixels
  )
}

/** Inclusive bounds for user-requested dimensions (server-authoritative). */
export const MIN_DIMENSION_PX = 256
export const MAX_DIMENSION_PX = 4096

/**
 * Max share of the generated image that may be discarded by the center
 * crop before the planner switches to background-extension padding.
 * Measured design point: the common photo aspect ratios lose well under
 * 15% with the best native cover; beyond that, cropping starts eating
 * subject/composition and extension preserves it.
 */
export const COVER_CROP_LOSS_MAX = 0.15

export class DimensionError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * Validate one requested dimension. Clear, specific rejections — the
 * customer-facing message explains exactly what is wrong.
 */
export function validateDimension(value: number, axis: 'width' | 'height'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new DimensionError(
      'INVALID_DIMENSIONS',
      `Custom ${axis} must be a whole number of pixels (no decimals).`,
    )
  }
  if (value <= 0) {
    throw new DimensionError(
      'INVALID_DIMENSIONS',
      `Custom ${axis} must be a positive pixel value.`,
    )
  }
  if (value < MIN_DIMENSION_PX) {
    throw new DimensionError(
      'INVALID_DIMENSIONS',
      `Custom ${axis} must be at least ${MIN_DIMENSION_PX}px — smaller images fall apart.`,
    )
  }
  if (value > MAX_DIMENSION_PX) {
    throw new DimensionError(
      'INVALID_DIMENSIONS',
      `Custom ${axis} exceeds the ${MAX_DIMENSION_PX}px maximum for image generation.`,
    )
  }
  return value
}

export function validateDimensions(width: number, height: number): { width: number; height: number } {
  return { width: validateDimension(width, 'width'), height: validateDimension(height, 'height') }
}

export type ExactStrategy =
  | { kind: 'native' }
  | { kind: 'resize'; note: 'same aspect ratio — high-quality scale, no crop and no distortion' }
  | { kind: 'cover-crop'; cropLossPct: number; note: 'scaled to cover and center-cropped — no distortion, edges trimmed' }
  | { kind: 'pad-extend'; padPct: number; note: 'scaled to fit; background extended with a blurred edge-derived fill' }

export interface DimensionPlan {
  /** What the provider is asked to generate (always one of NATIVE_SIZES). */
  generateWidth: number
  generateHeight: number
  strategy: ExactStrategy
}

function aspect(w: number, h: number): number {
  return w / h
}

/**
 * Select the native size + strategy for an exact target. Deterministic,
 * pure, unit-tested. Prefers zero-loss strategies, then minimal crop loss,
 * then minimal padding, and among equals the LARGER native (real detail
 * beats upscaling — brief PART 2 "native high-resolution generation").
 */
export function planExactDimensions(width: number, height: number): DimensionPlan {
  const targetAspect = aspect(width, height)

  // 1. Exact native match — the preset path, byte-for-byte unchanged.
  const native = NATIVE_SIZES.find((n) => n.width === width && n.height === height)
  if (native) return { generateWidth: width, generateHeight: height, strategy: { kind: 'native' } }

  // 2. Cover candidates: scale the native so it fully covers the target,
  //    center-crop the remainder. cropLoss = discarded share of the scaled
  //    native. Zero loss == pure resize (same aspect after rounding).
  const covers = NATIVE_SIZES.map((n) => {
    const s = Math.max(width / n.width, height / n.height)
    const scaledW = n.width * s
    const scaledH = n.height * s
    const cropLoss = 1 - (width * height) / (scaledW * scaledH)
    return { n, s, cropLoss }
  }).sort((a, b) => a.cropLoss - b.cropLoss || b.n.width * b.n.height - a.n.width * a.n.height)

  const bestCover = covers[0]
  // Aspect equality tolerance: sub-pixel rounding of the scaled native must
  // not turn a pure resize into a "crop" (e.g. 2048x2048 from 1024x1024).
  const sameAspect =
    Math.abs(aspect(bestCover.n.width, bestCover.n.height) - targetAspect) < 1e-6 ||
    bestCover.cropLoss < 0.001
  if (sameAspect || bestCover.cropLoss <= COVER_CROP_LOSS_MAX) {
    return {
      generateWidth: bestCover.n.width,
      generateHeight: bestCover.n.height,
      strategy: sameAspect
        ? { kind: 'resize', note: 'same aspect ratio — high-quality scale, no crop and no distortion' }
        : { kind: 'cover-crop', cropLossPct: Math.round(bestCover.cropLoss * 1000) / 10, note: 'scaled to cover and center-cropped — no distortion, edges trimmed' },
    }
  }

  // 3. Extreme aspect ratio: cover-cropping would eat the subject — pad.
  const fits = NATIVE_SIZES.map((n) => {
    const s = Math.min(width / n.width, height / n.height)
    const fittedW = n.width * s
    const fittedH = n.height * s
    const padShare = 1 - (fittedW * fittedH) / (width * height)
    return { n, s, padShare }
  }).sort((a, b) => a.padShare - b.padShare || b.n.width * b.n.height - a.n.width * a.n.height)
  const bestFit = fits[0]
  return {
    generateWidth: bestFit.n.width,
    generateHeight: bestFit.n.height,
    strategy: {
      kind: 'pad-extend',
      padPct: Math.round(bestFit.padShare * 1000) / 10,
      note: 'scaled to fit; background extended with a blurred edge-derived fill',
    },
  }
}

/**
 * M26.3 — finish plan from the ACTUAL provider output to the exact target.
 * The provider is asked for one of its native sizes, but the FIELD showed it
 * can answer with different dimensions (a square default) for landscape
 * requests. Instead of failing the job, the actual bytes are finished to the
 * exact requested target with the least-loss strategy — never stretched,
 * never silently cropped beyond COVER_CROP_LOSS_MAX, always disclosed.
 * Same decision math as planExactDimensions, with the source being the
 * provider's real output instead of a native size.
 */
export function planFinishStrategy(
  actual: { width: number; height: number },
  target: { width: number; height: number },
): ExactStrategy {
  const targetAspect = aspect(target.width, target.height)
  const sourceAspect = aspect(actual.width, actual.height)

  // Same aspect (within tolerance): a pure high-quality scale — no crop, no
  // distortion, no padding.
  if (Math.abs(sourceAspect - targetAspect) < 1e-6) {
    return { kind: 'resize', note: 'same aspect ratio — high-quality scale, no crop and no distortion' }
  }

  // Cover: scale the actual output so it covers the target, center-crop the
  // remainder when the discarded share stays within the design bound.
  const s = Math.max(target.width / actual.width, target.height / actual.height)
  const scaledW = actual.width * s
  const scaledH = actual.height * s
  const cropLoss = 1 - (target.width * target.height) / (scaledW * scaledH)
  if (cropLoss <= COVER_CROP_LOSS_MAX) {
    return {
      kind: 'cover-crop',
      cropLossPct: Math.round(cropLoss * 1000) / 10,
      note: 'scaled to cover and center-cropped — no distortion, edges trimmed',
    }
  }

  // Otherwise pad-extend: the actual output scaled to FIT, composed over a
  // blurred edge-derived background — nothing of the subject discarded.
  const fittedS = Math.min(target.width / actual.width, target.height / actual.height)
  const fittedW = actual.width * fittedS
  const fittedH = actual.height * fittedS
  const padShare = 1 - (fittedW * fittedH) / (target.width * target.height)
  return {
    kind: 'pad-extend',
    padPct: Math.round(padShare * 1000) / 10,
    note: 'scaled to fit; background extended with a blurred edge-derived fill',
  }
}

/** Decode actual pixel dimensions from image bytes (never trust metadata). */
export async function measureImage(bytes: Buffer): Promise<{ width: number; height: number; format: string }> {
  const meta = await sharp(bytes).metadata()
  if (!meta.width || !meta.height) throw new Error('decoded image has no measurable dimensions')
  return { width: meta.width, height: meta.height, format: meta.format ?? 'unknown' }
}

/**
 * M26.3 — reduce a final width×height to its small fraction label ("16:9").
 * Pure, integer-exact (no float rounding traps): gcd reduction with a
 * graceful fallback to one-decimal precision for ratios that do not reduce
 * cleanly (e.g. 1344x768 → "7:4"; 1921×1081 → "1.8:1"). Used for the honest
 * quality report — the label ALWAYS describes the FINAL encoded dimensions.
 */
export function aspectRatioLabel(width: number, height: number): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return 'unknown'
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(width, height)
  const rw = width / g
  const rh = height / g
  if (rw <= 64 && rh <= 64) return `${rw}:${rh}`
  // Not a clean small fraction: one decimal on the larger term.
  const ratio = width / height
  const r = ratio >= 1 ? `${(ratio).toFixed(1)}:1` : `1:${(1 / ratio).toFixed(1)}`
  return r
}

const JPEG_QUALITY = 93

/**
 * Apply a plan to provider output so the delivered bytes measure EXACTLY
 * the requested dimensions (verified by the caller via measureImage).
 * High-quality Lanczos resampling; center crop for cover; blurred
 * edge-derived background extension for pad. Never distorts.
 */
export async function applyExactDimensions(
  bytes: Buffer,
  target: { width: number; height: number },
  plan: DimensionPlan,
): Promise<{ bytes: Buffer; width: number; height: number; format: 'jpeg' }> {
  const img = sharp(bytes, { failOn: 'none' })

  if (plan.strategy.kind === 'native' || plan.strategy.kind === 'resize') {
    // Same aspect (or already exact): a straight Lanczos scale to target —
    // geometrically identical to the source, zero distortion.
    const out = await img
      .resize(target.width, target.height, { kernel: 'lanczos3', fit: 'fill' })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
    return { bytes: out, width: target.width, height: target.height, format: 'jpeg' }
  }

  if (plan.strategy.kind === 'cover-crop') {
    // scale-to-cover + center crop in one high-quality operation.
    const out = await img
      .resize(target.width, target.height, { kernel: 'lanczos3', fit: 'cover', position: 'centre' })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()
    return { bytes: out, width: target.width, height: target.height, format: 'jpeg' }
  }

  // pad-extend: background = the image itself scaled to COVER the target,
  // heavily blurred and slightly darkened (edge-derived, seam-free); the
  // subject is scaled to FIT and composited centered on top. Nothing of the
  // subject is discarded and nothing is stretched.
  const background = await sharp(bytes, { failOn: 'none' })
    .resize(target.width, target.height, { kernel: 'lanczos3', fit: 'cover' })
    .blur(40)
    .modulate({ brightness: 0.55 })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
  const fitted = await sharp(bytes, { failOn: 'none' })
    .resize(target.width, target.height, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const out = await sharp(background)
    .composite([{ input: fitted, blend: 'over' }])
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
  return { bytes: out, width: target.width, height: target.height, format: 'jpeg' }
}

/** Honest provenance block persisted in the job result (brief PART 2). */
export function generationProvenance(
  plan: DimensionPlan,
  requested: { width: number; height: number },
  finish?: {
    /** What the provider ACTUALLY returned, when it ignored the plan. */
    providerReturned: { width: number; height: number }
    /** The strategy applied to finish the actual bytes to the target. */
    strategy: ExactStrategy
  },
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    requested: `${requested.width}x${requested.height}`,
    generated: `${plan.generateWidth}x${plan.generateHeight}`,
  }
  if (plan.strategy.kind !== 'native') {
    base.strategy = plan.strategy.kind
    if (plan.strategy.kind === 'cover-crop') base.cropLossPct = plan.strategy.cropLossPct
    if (plan.strategy.kind === 'pad-extend') base.paddedAreaPct = plan.strategy.padPct
    base.note = plan.strategy.note
  } else {
    base.strategy = 'native'
    base.note = 'generated at the exact requested resolution by the provider'
  }
  if (finish) {
    // M26.3: the provider ignored the planned size — record the WHOLE truth:
    // what was asked, what came back, and how the exact target was reached.
    base.providerReturned = `${finish.providerReturned.width}x${finish.providerReturned.height}`
    base.finishStrategy = finish.strategy.kind
    if (finish.strategy.kind === 'cover-crop') base.finishCropLossPct = finish.strategy.cropLossPct
    if (finish.strategy.kind === 'pad-extend') base.finishPaddedAreaPct = finish.strategy.padPct
    const finishNote = 'note' in finish.strategy ? finish.strategy.note : 'finished to the exact requested dimensions'
    base.note = `${base.note}; the provider returned ${finish.providerReturned.width}x${finish.providerReturned.height} instead of the planned ${plan.generateWidth}x${plan.generateHeight} — the output was finished to the exact requested dimensions (${finishNote})`
  }
  return base
}
