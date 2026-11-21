/**
 * BEAN Intelligence — LAXII REAL local background-removal lane (M26.2).
 *
 * Replaces the blocked hosted two-stage path as the primary lane:
 *  1. REAL matting inference (MODNet, u2netp fallback — see segmentation.ts)
 *     produces a true per-pixel alpha at the FULL source resolution;
 *  2. deterministic export produces
 *       - a transparent PNG (source dimensions preserved), or
 *       - a JPEG/PNG flattened on an EXPLICIT user-chosen background
 *         (solid color) or a blurred-background composite;
 *  3. honest validation gates (no subject, degenerate matte) fail the job
 *     with the measured reason — never a stored fake cutout.
 *
 * The hosted chroma two-stage pipeline (bg-removal.ts) remains available as
 * an alternative lane when the hosted editing provider is usable.
 */
import sharp from 'sharp'
import { BeanApiError } from '@/lib/api/errors'
import { decodeRaw, runBestMatte, alphaToRgba, flattenOnColor, parseBackgroundColor, type RawImage } from './segmentation'

export interface LocalBgRemovalParams {
  /** 'png' (default) keeps true alpha; 'jpeg' requires an explicit background. */
  format?: 'png' | 'jpeg'
  /** Solid background for flattened output: '#rrggbb' | 'white' | 'black'. */
  backgroundColor?: string
  /** Blur the ORIGINAL background under the cutout (portrait-mode effect). */
  backgroundBlur?: boolean
  blurSigma?: number
}

export interface LocalBgRemovalResult {
  bytes: Buffer
  format: 'png' | 'jpeg'
  width: number
  height: number
  transparent: boolean
  stats: {
    model: string
    matteWidth: number
    matteHeight: number
    sourceWidth: number
    sourceHeight: number
    subjectFraction: number
    backgroundFraction: number
    latencyMs: number
  }
  provenance: Record<string, unknown>
}

/** REAL local background removal — full pipeline, measured, honest. */
export async function runLocalBackgroundRemoval(
  imageBytes: Buffer,
  params: LocalBgRemovalParams = {},
): Promise<LocalBgRemovalResult> {
  const source: RawImage = await decodeRaw(imageBytes)
  let matte: Awaited<ReturnType<typeof runBestMatte>>
  try {
    matte = await runBestMatte(source)
  } catch (e) {
    // The no-subject rejection is a VALIDATION outcome (the lane executed
    // correctly and refused content without a separable subject), not a
    // backend failure — the honest message is preserved verbatim.
    const msg = e instanceof Error ? e.message : 'Background removal could not find a usable subject.'
    if (/could not find a usable subject/i.test(msg)) {
      throw new BeanApiError('VALIDATION_ERROR', msg)
    }
    throw e
  }
  const rgba = alphaToRgba(source, matte.alpha)

  const format = params.format ?? 'png'
  if (format === 'jpeg' && !params.backgroundColor && !params.backgroundBlur) {
    throw new Error(
      "JPEG output has no alpha channel — choose an explicit background ('backgroundColor' or 'backgroundBlur') or request PNG for transparency.",
    )
  }

  let bytes: Buffer
  let transparent = false
  let flattenedColor: string | null = null
  let backgroundBlur = false
  if (format === 'png' && !params.backgroundBlur) {
    bytes = await sharp(rgba, { raw: { width: source.width, height: source.height, channels: 4 } })
      .png({ compressionLevel: 6 })
      .toBuffer()
    transparent = true
  } else if (params.backgroundBlur) {
    // Portrait-mode: blurred original UNDER the sharp cutout.
    const sigma = Math.max(1, Math.min(24, params.blurSigma ?? 10))
    const blurred = await sharp(source.data, { raw: { width: source.width, height: source.height, channels: 3 } })
      .blur(sigma)
      .raw()
      .toBuffer()
    const rgb = Buffer.alloc(source.width * source.height * 3)
    for (let p = 0; p < source.width * source.height; p++) {
      const a = rgba[p * 4 + 3] / 255
      for (let c = 0; c < 3; c++) {
        rgb[p * 3 + c] = Math.round(rgba[p * 4 + c] * a + blurred[p * 3 + c] * (1 - a))
      }
    }
    const pipe = sharp(rgb, { raw: { width: source.width, height: source.height, channels: 3 } })
    bytes = format === 'jpeg' ? await pipe.jpeg({ quality: 92 }).toBuffer() : await pipe.png().toBuffer()
    backgroundBlur = true
  } else {
    const color = parseBackgroundColor(params.backgroundColor ?? '#ffffff')
    const rgb = flattenOnColor(rgba, source.width, source.height, color)
    flattenedColor = params.backgroundColor ?? '#ffffff'
    const pipe = sharp(rgb, { raw: { width: source.width, height: source.height, channels: 3 } })
    bytes = format === 'jpeg' ? await pipe.jpeg({ quality: 92 }).toBuffer() : await pipe.png().toBuffer()
  }

  return {
    bytes,
    format,
    width: source.width,
    height: source.height,
    transparent,
    stats: {
      model: matte.stats.model,
      matteWidth: matte.stats.matteWidth,
      matteHeight: matte.stats.matteHeight,
      sourceWidth: source.width,
      sourceHeight: source.height,
      subjectFraction: matte.stats.subjectFraction,
      backgroundFraction: matte.stats.backgroundFraction,
      latencyMs: matte.stats.latencyMs,
    },
    provenance: {
      engine: 'local-segmentation',
      pipeline: 'local-matting-cutout',
      mode: 'background-removal',
      matteModel: matte.stats.model,
      sourceResolutionPreserved: matte.stats.sourceWidth === source.width && matte.stats.sourceHeight === source.height,
      transparent,
      flattenedBackgroundColor: flattenedColor,
      backgroundBlur,
      note: 'REAL neural matting (alpha matte) + deterministic export. The original image is never modified.',
    },
  }
}
