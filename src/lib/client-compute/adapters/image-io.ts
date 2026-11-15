/**
 * BEAN Intelligence — client compute: image decode/encode IO helpers.
 *
 * Browser defaults use createImageBitmap + canvas. Both decode and encode
 * are injectable so adapter logic is testable outside a DOM (unit tests
 * register synthetic decoders/encoders; production registers nothing and
 * uses the browser paths). Decoding never happens inside worker kernels —
 * kernels receive plain pixel buffers.
 *
 * Client-safe: no Node-only imports.
 */
import type { PixelPayload } from './image-kernels'

export type ImageDecoder = (blob: Blob) => Promise<PixelPayload>
export type ImageEncoder = (payload: PixelPayload, type: 'image/jpeg' | 'image/png', quality?: number) => Promise<Blob>

let injectedDecoder: ImageDecoder | null = null
let injectedEncoder: ImageEncoder | null = null

/** Tests may inject a synthetic decoder/encoder. Production leaves both unset. */
export function registerImageDecoder(decoder: ImageDecoder | null): void {
  injectedDecoder = decoder
}
export function registerImageEncoder(encoder: ImageEncoder | null): void {
  injectedEncoder = encoder
}

/** Decode a blob to RGBA pixels. Browser default: createImageBitmap + canvas. */
export async function decodeImage(blob: Blob): Promise<PixelPayload> {
  if (injectedDecoder) return injectedDecoder(blob)
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    throw new Error('Image decoding requires a browser environment.')
  }
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('Canvas 2D context is unavailable.')
    ctx.drawImage(bitmap, 0, 0)
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    return { pixels: data.data, width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

/** Encode RGBA pixels to a JPEG/PNG blob. Browser default: canvas.toBlob. */
export async function encodeImage(payload: PixelPayload, type: 'image/jpeg' | 'image/png', quality?: number): Promise<Blob> {
  if (injectedEncoder) return injectedEncoder(payload, type, quality)
  if (typeof document === 'undefined') {
    throw new Error('Image encoding requires a browser environment.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = payload.width
  canvas.height = payload.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is unavailable.')
  const imageData = ctx.createImageData(payload.width, payload.height)
  imageData.data.set(payload.pixels)
  ctx.putImageData(imageData, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('Canvas encoding produced no blob.'))
      },
      type,
      quality,
    )
  })
  return blob
}
