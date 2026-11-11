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

/** The 7 provider-native generation sizes (registry LAXII_SIZES values). */
export const NATIVE_SIZES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 1024, height: 1024 },
  { width: 768, height: 1344 },
  { width: 864, height: 1152 },
  { width: 1344, height: 768 },
  { width: 1152, height: 864 },
  { width: 1440, height: 720 },
  { width: 720, height: 1440 },
]

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

/** Decode actual pixel dimensions from image bytes (never trust metadata). */
export async function measureImage(bytes: Buffer): Promise<{ width: number; height: number; format: string }> {
  const meta = await sharp(bytes).metadata()
  if (!meta.width || !meta.height) throw new Error('decoded image has no measurable dimensions')
  return { width: meta.width, height: meta.height, format: meta.format ?? 'unknown' }
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
): Record<string, unknown> {
  if (plan.strategy.kind === 'native') {
    return {
      requested: `${requested.width}x${requested.height}`,
      generated: `${plan.generateWidth}x${plan.generateHeight}`,
      strategy: 'native',
      note: 'generated at the exact requested resolution by the provider',
    }
  }
  return {
    requested: `${requested.width}x${requested.height}`,
    generated: `${plan.generateWidth}x${plan.generateHeight}`,
    strategy: plan.strategy.kind,
    ...(plan.strategy.kind === 'cover-crop' ? { cropLossPct: plan.strategy.cropLossPct } : {}),
    ...(plan.strategy.kind === 'pad-extend' ? { paddedAreaPct: plan.strategy.padPct } : {}),
    note: plan.strategy.note,
  }
}
