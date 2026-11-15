/**
 * BEAN Intelligence — JAZMII client-compute adapter (Phase 10.C).
 *
 * Scope (from the Phase 0 audit):
 *  - video.reference-check: client-side pre-check of a reference image
 *    against the SAME bounds the server enforces (256–4096 px/side,
 *    ≤16,777,216 px total, ≤15 MB, jpeg/png/webp, not animated — animation
 *    detection stays server-side since browsers do not expose frame counts
 *    via createImageBitmap). Saves wasted submissions; the server's
 *    reference-image module remains authoritative ("validates, does not
 *    substitute").
 *  - video.thumbnail: poster/thumbnail generation from a completed video
 *    element (the JAZMII UI already plays the artifact). Main-thread DOM
 *    work only (light class); video generation itself NEVER runs client-side.
 *
 * Client-safe: no Node-only imports.
 */
import { decodeImage } from './image-io'
import type { ClientCompute } from '../index'
import type { ComputeTaskOutput, RegisteredTaskKind, TargetHandler } from '../types'

export const REFERENCE_CHECK_KIND = 'video.reference-check'
export const THUMBNAIL_KIND = 'video.thumbnail'

/** Server-authoritative bounds mirrored for the client pre-check
 * (src/lib/jazmii/reference-image.ts). Keep in sync manually. */
export const JAZMII_REFERENCE_BOUNDS = {
  minSidePx: 256,
  maxSidePx: 4096,
  maxTotalPixels: 16_777_216,
  maxBytes: 15 * 1024 * 1024,
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
}

export interface ReferenceCheckInput {
  blob: Blob
}

export interface ReferenceCheckOutput {
  ok: boolean
  width: number | null
  height: number | null
  bytes: number
  reason?: string
}

export interface ThumbnailInput {
  /** A playing (or loadable) video element showing the completed artifact. */
  video: HTMLVideoElement
  /** Seek target in seconds (default 0.5s or 10% of duration). */
  timeSec?: number
  maxWidth?: number
}

export interface ThumbnailOutput {
  blob: Blob
  bytes: number
  width: number
  height: number
}

const referenceHandler: TargetHandler<ReferenceCheckInput, ReferenceCheckOutput> = async ({ input }) => {
  if (!(input?.blob instanceof Blob)) throw new Error('Reference check input must be an image blob.')
  const bytes = input.blob.size
  if (bytes > JAZMII_REFERENCE_BOUNDS.maxBytes) {
    return { ok: false, width: null, height: null, bytes, reason: `The image is larger than the 15 MB limit.` }
  }
  if (input.blob.type && !JAZMII_REFERENCE_BOUNDS.allowedTypes.includes(input.blob.type as (typeof JAZMII_REFERENCE_BOUNDS.allowedTypes)[number])) {
    return { ok: false, width: null, height: null, bytes, reason: 'Only JPEG, PNG and WebP reference images are supported.' }
  }
  let decoded
  try {
    decoded = await decodeImage(input.blob)
  } catch (error) {
    return { ok: false, width: null, height: null, bytes, reason: `The image could not be decoded: ${error instanceof Error ? error.message : 'unknown error'}` }
  }
  const { width, height } = decoded
  if (width < JAZMII_REFERENCE_BOUNDS.minSidePx || height < JAZMII_REFERENCE_BOUNDS.minSidePx) {
    return { ok: false, width, height, bytes, reason: `Both sides must be at least ${JAZMII_REFERENCE_BOUNDS.minSidePx}px.` }
  }
  if (width > JAZMII_REFERENCE_BOUNDS.maxSidePx || height > JAZMII_REFERENCE_BOUNDS.maxSidePx) {
    return { ok: false, width, height, bytes, reason: `Neither side may exceed ${JAZMII_REFERENCE_BOUNDS.maxSidePx}px.` }
  }
  if (width * height > JAZMII_REFERENCE_BOUNDS.maxTotalPixels) {
    return { ok: false, width, height, bytes, reason: 'The image has too many pixels.' }
  }
  return { ok: true, width, height, bytes }
}

const thumbnailHandler: TargetHandler<ThumbnailInput, ThumbnailOutput> = async ({ input, signal, reportProgress }) => {
  const video = input?.video
  if (!video || typeof (video as HTMLVideoElement).addEventListener !== 'function') {
    throw new Error('Thumbnail input must be a video element.')
  }
  if (typeof document === 'undefined') throw new Error('Thumbnail generation requires a browser environment.')
  reportProgress(0.2, 'seeking video frame')
  const target = typeof input.timeSec === 'number' && Number.isFinite(input.timeSec) && input.timeSec >= 0
    ? input.timeSec
    : Number.isFinite(video.duration) && video.duration > 0
      ? Math.min(video.duration * 0.1, 0.5)
      : 0
  await seekVideo(video, target, signal)
  reportProgress(0.6, 'capturing frame')
  const canvas = document.createElement('canvas')
  const maxWidth = typeof input.maxWidth === 'number' && input.maxWidth > 0 ? input.maxWidth : 640
  const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth))
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is unavailable.')
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('Thumbnail encoding produced no blob.'))
      },
      'image/jpeg',
      0.85,
    )
  })
  reportProgress(1, 'thumbnail captured')
  return { blob, bytes: blob.size, width: canvas.width, height: canvas.height }
}

function seekVideo(video: HTMLVideoElement, timeSec: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Task cancelled.'))
      return
    }
    if (Math.abs(video.currentTime - timeSec) < 0.05 && video.readyState >= 2) {
      resolve()
      return
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('The video could not be read for thumbnail capture.'))
    }
    const onAbort = () => {
      cleanup()
      reject(new Error('Task cancelled.'))
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      video.currentTime = timeSec
    } catch (error) {
      cleanup()
      reject(new Error(`Seeking the video failed: ${error instanceof Error ? error.message : 'unknown error'}`))
    }
  })
}

export function buildJazmiiKinds(): Array<RegisteredTaskKind<unknown, unknown>> {
  return [
    {
      kind: REFERENCE_CHECK_KIND,
      productId: 'jazmii',
      preferredOrder: ['client-cpu'],
      handlers: { 'client-cpu': referenceHandler as TargetHandler<unknown, unknown> },
      feasibility: { gpuSupported: false, cpuSupported: true },
      resourceClass: 'light',
      privacy: 'local-only', // the image is only measured locally
      timeoutMs: 20_000,
    },
    {
      kind: THUMBNAIL_KIND,
      productId: 'jazmii',
      preferredOrder: ['client-cpu'],
      handlers: { 'client-cpu': thumbnailHandler as TargetHandler<unknown, unknown> },
      feasibility: { gpuSupported: false, cpuSupported: true },
      resourceClass: 'light',
      privacy: 'local-only',
      timeoutMs: 30_000,
    },
  ]
}

export function registerJazmiiAdapter(client: Pick<ClientCompute, 'scheduler'>): void {
  client.scheduler.registerProductAdapter({
    productId: 'jazmii',
    summary: 'Client-side reference-image pre-check (server bounds mirrored) and video thumbnail capture; video generation itself stays server-side.',
    kinds: buildJazmiiKinds(),
  })
}

export async function scheduleReferenceCheck(
  client: Pick<ClientCompute, 'scheduler'>,
  input: ReferenceCheckInput,
  options: { signal?: AbortSignal } = {},
): Promise<ComputeTaskOutput<ReferenceCheckOutput>> {
  return client.scheduler.runTask<ReferenceCheckInput, ReferenceCheckOutput>(
    { productId: 'jazmii', kind: REFERENCE_CHECK_KIND, input, signal: options.signal },
  )
}

export async function scheduleThumbnail(
  client: Pick<ClientCompute, 'scheduler'>,
  input: ThumbnailInput,
  options: { signal?: AbortSignal; onProgress?: (fraction: number, note?: string) => void } = {},
): Promise<ComputeTaskOutput<ThumbnailOutput>> {
  return client.scheduler.runTask<ThumbnailInput, ThumbnailOutput>(
    { productId: 'jazmii', kind: THUMBNAIL_KIND, input, signal: options.signal },
    { onProgress: options.onProgress ? (e) => options.onProgress!(e.fraction, e.note) : undefined },
  )
}
