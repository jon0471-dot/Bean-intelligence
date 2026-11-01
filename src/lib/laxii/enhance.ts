/**
 * LAXII — professional enhancement pipeline (Phase 5).
 *
 * Deterministic, non-generative first. The planner reads measured image
 * analysis and picks ONLY the operations the image actually needs (mission
 * §6: "Do not apply every filter to every image"). Every applied op is
 * recorded in the returned metadata with its measured reason, so the
 * processing metadata is an audit trail, not decoration.
 *
 * Order (mission §6): inspection → orientation → noise → denoise →
 * exposure/white-balance → grade → local contrast → (optional upscale) →
 * preservation-aware compositing (in preservation.ts) → validation.
 */
import sharp from 'sharp'
import {
  LaxiiImageError,
  analyzeImage,
  toRaw,
  type NoiseAnalysis,
  type RawImage,
} from './metrics'
import {
  compositePreserved,
  encodePng,
  type CompositeResult,
  type MaskShaping,
} from './preservation'

export interface EnhanceOptions {
  /** User-controlled switches — a measured need only ENABLES an op, the
   *  user can still turn it off. Global color work defaults off. */
  autoOrient: boolean // default true — EXIF orientation fix
  denoise: boolean
  exposureWhiteBalance: boolean
  grade: boolean
  localContrast: boolean
  /** Lanczos upscale factor 1..4; 1 = off. */
  upscaleFactor: number
  /** Allow global exposure/WB/grade to touch ALL pixels (mission §4:
   *  unmasked pixels stay exact unless the op is a global color/exposure
   *  change — when masked work happens with global ops disabled, unmasked
   *  pixels are bit-exact). */
  allowGlobalColor: boolean
  maxInputPixels: number
}

export const DEFAULT_ENHANCE_OPTIONS: EnhanceOptions = {
  autoOrient: true,
  denoise: true,
  exposureWhiteBalance: true,
  grade: true,
  localContrast: true,
  upscaleFactor: 1,
  allowGlobalColor: true,
  maxInputPixels: 16_777_216, // 4096x4096
}

export interface PlannedOp {
  op: string
  params: Record<string, number | string | boolean>
  reason: string
  measured: Record<string, number>
}

export interface EnhancePlan {
  ops: PlannedOp[]
  analysis: NoiseAnalysis
}

export interface EnhanceResult {
  /** PNG (lossless) of the composited result. */
  outputPng: Buffer
  plan: EnhancePlan
  composite: CompositeResult
  width: number
  height: number
  durationMs: number
}

/** Planner: measured analysis → explicit op list with reasons. */
export function planEnhancement(
  analysis: NoiseAnalysis,
  opts: EnhanceOptions,
): EnhancePlan {
  const ops: PlannedOp[] = []
  if (opts.autoOrient) {
    ops.push({
      op: 'auto-orient',
      params: {},
      reason: 'EXIF orientation applied; geometry otherwise untouched.',
      measured: {},
    })
  }
  if (opts.denoise && analysis.noiseSigma > 3.5) {
    ops.push({
      op: 'denoise',
      params: { strength: analysis.noiseSigma > 8 ? 2 : 1 },
      reason: `Measured noise sigma ${analysis.noiseSigma.toFixed(2)} exceeds the 3.5 threshold.`,
      measured: { noiseSigma: analysis.noiseSigma },
    })
  }
  if (opts.exposureWhiteBalance) {
    const { r, g, b } = analysis.channelMeans
    const gray = (r + g + b) / 3
    const maxCast = Math.max(Math.abs(r - gray), Math.abs(g - gray), Math.abs(b - gray)) / Math.max(1, gray)
    const target = 118 // pleasant mid exposure on 0..255
    if (maxCast > 0.06 || Math.abs(analysis.meanLuma - target) > 22) {
      ops.push({
        op: 'exposure-white-balance',
        params: { target, maxCastFix: maxCast, clampGain: 0.8 },
        reason: `Channel means r=${r.toFixed(1)} g=${g.toFixed(1)} b=${g.toFixed(1)} (cast ${(maxCast * 100).toFixed(1)}%), mean luma ${analysis.meanLuma.toFixed(1)} vs target ${target}.`,
        measured: {
          meanLuma: analysis.meanLuma,
          castPct: maxCast * 100,
          clippedShadowsPct: analysis.clippedShadowsPct,
          clippedHighlightsPct: analysis.clippedHighlightsPct,
        },
      })
    }
  }
  if (opts.grade && !analysis.isGrayscale) {
    if (analysis.saturationMean < 0.12) {
      ops.push({
        op: 'grade-saturation',
        params: { factor: 1.08 },
        reason: `Measured mean saturation ${(analysis.saturationMean * 100).toFixed(1)}% is very low; gentle lift.`,
        measured: { saturationMean: analysis.saturationMean },
      })
    } else if (analysis.saturationMean > 0.62) {
      ops.push({
        op: 'grade-saturation',
        params: { factor: 0.95 },
        reason: `Measured mean saturation ${(analysis.saturationMean * 100).toFixed(1)}% is very high; gentle settle.`,
        measured: { saturationMean: analysis.saturationMean },
      })
    }
  }
  if (opts.localContrast && analysis.laplacianVariance < 60 && analysis.noiseSigma <= 8) {
    ops.push({
      op: 'local-contrast',
      params: { sigma: 1.2, m1: 1.0, m2: 1.6 },
      reason: `Laplacian variance ${analysis.laplacianVariance.toFixed(1)} indicates soft detail (denoise gate ${analysis.noiseSigma.toFixed(2)} ≤ 8).`,
      measured: { laplacianVariance: analysis.laplacianVariance },
    })
  }
  if (opts.upscaleFactor > 1) {
    ops.push({
      op: 'upscale-lanczos',
      params: { factor: opts.upscaleFactor, kernel: 'lanczos3' },
      reason: `User-requested ${opts.upscaleFactor}× upscale (deterministic Lanczos; Real-ESRGAN is the optional model-based step on the worker host).`,
      measured: {},
    })
  }
  return { ops, analysis }
}

function applyLinear(
  img: RawImage,
  gains: { r: number; g: number; b: number },
  offset: number,
): Uint8Array {
  const out = new Uint8Array(img.data.length)
  for (let p = 0, i = 0; p < img.width * img.height; p++, i += 3) {
    out[i] = Math.max(0, Math.min(255, Math.round(img.data[i] * gains.r + offset)))
    out[i + 1] = Math.max(0, Math.min(255, Math.round(img.data[i + 1] * gains.g + offset)))
    out[i + 2] = Math.max(0, Math.min(255, Math.round(img.data[i + 2] * gains.b + offset)))
  }
  return out
}

async function rawToSharpBuffer(img: RawImage): Promise<Buffer> {
  return Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength)
}

/**
 * Run the planned pipeline over the decoded image. Returns the processed
 * full-frame result (NOT yet composited with the original — the caller
 * composites under mask control so unmasked pixels stay exact).
 */
export async function runEnhancement(
  inputPngOrJpeg: Buffer,
  opts: EnhanceOptions = DEFAULT_ENHANCE_OPTIONS,
): Promise<{ processedRaw: RawImage; plan: EnhancePlan; original: RawImage }> {
  let working = inputPngOrJpeg
  let current: RawImage
  try {
    // Decode WITH auto-orientation applied so the preservation baseline is
    // exactly what the user sees in the UI (their mask is drawn there).
    working = opts.autoOrient
      ? await sharp(inputPngOrJpeg).rotate().removeAlpha().png().toBuffer()
      : inputPngOrJpeg
    current = await toRaw(working)
  } catch (e) {
    throw e instanceof LaxiiImageError ? e : new LaxiiImageError(String(e))
  }
  if (current.width * current.height > opts.maxInputPixels) {
    throw new LaxiiImageError(
      `Image is ${current.width}x${current.height} (${(current.width * current.height / 1e6).toFixed(1)} MP) — above the ${(opts.maxInputPixels / 1e6).toFixed(0)} MP limit for local enhancement.`,
    )
  }
  const original: RawImage = { data: new Uint8Array(current.data), width: current.width, height: current.height }

  const plan = planEnhancement(analyzeImage(current), opts)

  for (const op of plan.ops) {
    switch (op.op) {
      case 'denoise': {
        const strength = op.params.strength as number
        working = await sharp(
          await rawToSharpBuffer(current),
          { raw: { width: current.width, height: current.height, channels: 3 } },
        )
          .median(strength > 1 ? 5 : 3)
          .raw()
          .toBuffer()
        current = { data: new Uint8Array(working), width: current.width, height: current.height }
        break
      }
      case 'exposure-white-balance': {
        const { r, g, b } = analyzeImage(current).channelMeans
        const gray = (r + g + b) / 3
        const clamp = op.params.clampGain as number
        const gain = (c: number) => Math.max(clamp, Math.min(1 / clamp, gray / Math.max(1, c)))
        const gains = { r: gain(r), g: gain(g), b: gain(b) }
        const target = op.params.target as number
        const meanNow = (r * gains.r + g * gains.g + b * gains.b) / 3
        const exposure = Math.max(0.6, Math.min(1.6, target / Math.max(1, meanNow)))
        const data = applyLinear(current, {
          r: gains.r * exposure,
          g: gains.g * exposure,
          b: gains.b * exposure,
        }, 0)
        current = { data, width: current.width, height: current.height }
        break
      }
      case 'grade-saturation': {
        const factor = op.params.factor as number
        const buf = await sharp(
          await rawToSharpBuffer(current),
          { raw: { width: current.width, height: current.height, channels: 3 } },
        )
          .modulate({ saturation: factor })
          .raw()
          .toBuffer()
        current = { data: new Uint8Array(buf), width: current.width, height: current.height }
        break
      }
      case 'local-contrast': {
        const buf = await sharp(
          await rawToSharpBuffer(current),
          { raw: { width: current.width, height: current.height, channels: 3 } },
        )
          .sharpen({
            sigma: op.params.sigma as number,
            m1: op.params.m1 as number,
            m2: op.params.m2 as number,
          })
          .raw()
          .toBuffer()
        current = { data: new Uint8Array(buf), width: current.width, height: current.height }
        break
      }
      case 'upscale-lanczos': {
        const factor = op.params.factor as number
        const outW = Math.round(current.width * factor)
        const outH = Math.round(current.height * factor)
        if (outW * outH > opts.maxInputPixels) {
          throw new LaxiiImageError(
            `Upscaling to ${outW}x${outH} would exceed the ${opts.maxInputPixels}-pixel processing limit.`,
          )
        }
        const buf = await sharp(
          await rawToSharpBuffer(current),
          { raw: { width: current.width, height: current.height, channels: 3 } },
        )
          .resize(outW, outH, { kernel: 'lanczos3', fit: 'fill' })
          .raw()
          .toBuffer()
        current = { data: new Uint8Array(buf), width: outW, height: outH }
        break
      }
      default:
        break
    }
  }
  return { processedRaw: current, plan, original }
}

export interface EnhanceJobInput {
  image: Buffer
  options?: Partial<EnhanceOptions>
  /** Optional edit mask (ShapedMask alpha) — when provided, only masked
   *  pixels may change unless allowGlobalColor is true (documented global
   *  change). Face zones are honored by the caller before calling. */
  mask?: { alpha: Float32Array; width: number; height: number } | null
  shaping?: MaskShaping
}

/**
 * Full deterministic enhancement: analyze → plan → apply → composite under
 * mask control → PNG. When no mask is provided the processed frame IS the
 * result (a documented global change, exactly what "Enhance Image" means);
 * when a mask is provided, unmasked pixels are the original bytes.
 */
export async function enhanceImage(
  job: EnhanceJobInput,
): Promise<{ result: EnhanceResult; original: RawImage }> {
  const opts: EnhanceOptions = { ...DEFAULT_ENHANCE_OPTIONS, ...job.options }
  const t0 = Date.now()
  const { processedRaw, plan, original } = await runEnhancement(job.image, opts)

  let composite: CompositeResult
  if (job.mask) {
    if (job.mask.width !== original.width || job.mask.height !== original.height) {
      throw new LaxiiImageError('Mask geometry must match the (oriented) image.')
    }
    composite = compositePreserved(original, processedRaw, job.mask, {
      globalColorChange: opts.allowGlobalColor,
    })
  } else {
    composite = {
      data: processedRaw.data,
      exactPreservedPct: 0,
      blendedPct: 0,
      generatedPct: 100,
    }
  }
  const outputPng = await encodePng(composite.data, processedRaw.width, processedRaw.height)
  return {
    result: {
      outputPng,
      plan,
      composite,
      width: processedRaw.width,
      height: processedRaw.height,
      durationMs: Date.now() - t0,
    },
    original,
  }
}
