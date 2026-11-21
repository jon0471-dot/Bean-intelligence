/**
 * BEAN Intelligence — LAXII local structural inpainting service (M26.2).
 *
 * REAL LaMa inference (OpenCV Zoo inpainting_lama, Apache-2.0) on
 * onnxruntime-node: image (BGR/255) + binary mask at 512x512 (the model's
 * fixed internal resolution), result resized back to the working geometry
 * and composited ONLY inside the mask — every pixel outside the mask stays
 * EXACTLY the original (preservation-first).
 */
import sharp from 'sharp'
import * as ort from 'onnxruntime-node'
import { getSession, localModelState } from '@/lib/media/local-models'
import type { RawImage } from './segmentation'

export interface InpaintResult {
  /** RGB buffer at the working resolution with only masked pixels changed. */
  rgb: Buffer
  width: number
  height: number
  stats: { latencyMs: number; maskedPixels: number; width: number; height: number }
}

/** LaMa is available on this host (real file verified by the model manager). */
export function lamaInstalled(): boolean {
  return localModelState('lama').state === 'ready'
}

/**
 * Structural inpaint of the masked region. `image` and `mask` share dims.
 * Mask values >0 are replaced by the model's synthesis; values <=0 are
 * preserved bit-exact after the resize-back composite.
 */
export async function lamaInpaint(
  image: RawImage,
  mask: { data: Uint8Array; width: number; height: number },
): Promise<InpaintResult> {
  const t0 = Date.now()
  const session = await getSession('lama')
  const S = 512
  // Squash to the model's fixed 512x512 (OpenCV zoo convention); the output
  // is resized back and only masked pixels are composited, so geometry is
  // restored exactly outside the mask.
  const img512 = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } })
    .resize(S, S, { fit: 'fill' })
    .raw()
    .toBuffer()
  const mask512 = await sharp(mask.data, { raw: { width: mask.width, height: mask.height, channels: 1 } })
    .resize(S, S, { fit: 'fill' })
    .raw()
    .toBuffer()

  // OpenCV-dnn blob convention: CHANNELS-FIRST (NCHW) BGR scaled to 0..1.
  // Feeding HWC-interleaved bytes as [1,3,S,S] misrenders every plane
  // (measured 2026-11-18 — same layout rule verified on MODNet).
  const n = S * S
  const img = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    img[i] = img512[i * 3 + 2] / 255 // B plane
    img[n + i] = img512[i * 3 + 1] / 255 // G plane
    img[2 * n + i] = img512[i * 3] / 255 // R plane
  }
  const m = new Float32Array(n)
  let masked = 0
  for (let i = 0; i < S * S; i++) {
    const v = mask512[i] > 0 ? 1 : 0
    m[i] = v
    if (v) masked++
  }

  const out = await session.run({
    image: new ort.Tensor('float32', img, [1, 3, S, S]),
    mask: new ort.Tensor('float32', m, [1, 1, S, S]),
  })
  const result = out[Object.keys(out)[0]] as ort.Tensor
  // Output: [1,3,S,S] CHW BGR floats 0..255 → RGB buffer (de-interleave).
  const rd = result.data as Float32Array
  const rgb512 = Buffer.alloc(n * 3)
  for (let i = 0; i < n; i++) {
    rgb512[i * 3] = Math.max(0, Math.min(255, Math.round(rd[2 * n + i]))) // R
    rgb512[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(rd[n + i]))) // G
    rgb512[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(rd[i]))) // B
  }

  // Resize the 512 synthesis back to the working geometry.
  const gen = await sharp(rgb512, { raw: { width: S, height: S, channels: 3 } })
    .resize(image.width, image.height, { fit: 'fill' })
    .raw()
    .toBuffer()

  // Preservation composite: masked pixels from the model, everything else
  // EXACT from the source.
  const outRgb = Buffer.alloc(image.width * image.height * 3)
  outRgb.set(image.data)
  for (let p = 0; p < image.width * image.height; p++) {
    if (mask.data[p] > 0) {
      outRgb[p * 3] = gen[p * 3]
      outRgb[p * 3 + 1] = gen[p * 3 + 1]
      outRgb[p * 3 + 2] = gen[p * 3 + 2]
    }
  }
  return {
    rgb: outRgb,
    width: image.width,
    height: image.height,
    stats: { latencyMs: Date.now() - t0, maskedPixels: masked, width: image.width, height: image.height },
  }
}
