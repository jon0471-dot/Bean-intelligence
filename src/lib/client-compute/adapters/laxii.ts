/**
 * BEAN Intelligence — LAXII client-compute adapter (Phase 10.A, flagship).
 *
 * Scope (from the Phase 0 audit — LAXII's deterministic server pipeline):
 *  - image.preprocess: client-side downscale/compress BEFORE upload. This
 *    reduces upload bytes for large images; the server route remains fully
 *    authoritative (it re-validates decode + geometry server-side). The
 *    UPLOAD itself is always a separate explicit user action.
 *  - image.chroma-cutout: the deterministic chroma-key stage of the LAXII
 *    background-removal pipeline, ported 1:1 as pure math (image-kernels).
 *    This is NOT the hosted generative stage and makes no equivalence claim.
 *  - image.segmentation: honestly registered with a model requirement the
 *    current app cannot satisfy (no onnxruntime-web dependency, no verified
 *    model bytes) so the scheduler reports the truthful
 *    CLIENT_MODEL_UNSUPPORTED / CLIENT_MODEL_NOT_INSTALLED states instead of
 *    pretending the capability exists.
 *
 * GPU lane: none of these kernels has a GPU registry entry yet, so the GPU
 * target is never selected (the compatibility registry keeps this honest).
 *
 * Client-safe: no Node-only imports.
 */
import { chromaCutoutKernel, preprocessImageKernel, type PixelPayload } from './image-kernels'
import { decodeImage, encodeImage } from './image-io'
import type { CpuEngine } from '../cpu/engine'
import type { ClientCompute } from '../index'
import type { ComputeTaskOutput, RegisteredTaskKind, TargetHandler } from '../types'

export interface PreprocessTaskInput {
  blob: Blob
  maxWidth: number
  maxHeight: number
  quality?: number
}

export interface PreprocessTaskOutput extends PixelPayload {
  blob: Blob
  bytes: number
  originalBytes: number
  scaleApplied: number
  originalWidth: number
  originalHeight: number
}

export interface ChromaCutoutTaskInput {
  blob: Blob
}

export interface ChromaCutoutTaskOutput extends PixelPayload {
  blob: Blob
  bytes: number
  transparentFraction: number
  keyHue: number | null
  keySamples: number
}

export const PREPROCESS_KIND = 'image.preprocess'
export const CUTOUT_KIND = 'image.chroma-cutout'
export const SEGMENTATION_KIND = 'image.segmentation'

/** Build the LAXII task kinds. The CPU engine is injected (production passes
 * the shared engine's engine; tests pass an engine with a fake worker). */
export function buildLaxiiKinds(cpu: CpuEngine): Array<RegisteredTaskKind<unknown, unknown>> {
  const preprocessHandler: TargetHandler<PreprocessTaskInput, PreprocessTaskOutput> = async (ctx) => {
    const { input, signal, reportProgress } = ctx
    if (!(input?.blob instanceof Blob)) throw new Error('Preprocess input must be an image blob.')
    const decoded = await decodeImage(input.blob)
    reportProgress(0.25, 'image decoded')
    const run = await cpu.runFunction(
      preprocessImageKernel,
      { pixels: decoded.pixels, width: decoded.width, height: decoded.height, maxWidth: input.maxWidth, maxHeight: input.maxHeight },
      { signal, allowMainThreadFallback: false },
    )
    if (!run.ok) throw new Error(run.reason)
    reportProgress(0.75, 'resized locally')
    const quality = typeof input.quality === 'number' ? Math.min(1, Math.max(0.1, input.quality)) : undefined
    const blob = await encodeImage(run.output, 'image/jpeg', quality)
    reportProgress(0.95, 'encoded locally')
    return {
      blob,
      bytes: blob.size,
      originalBytes: input.blob.size,
      width: run.output.width,
      height: run.output.height,
      pixels: run.output.pixels,
      scaleApplied: run.output.scaleApplied,
      originalWidth: run.output.originalWidth,
      originalHeight: run.output.originalHeight,
    }
  }

  const cutoutHandler: TargetHandler<ChromaCutoutTaskInput, ChromaCutoutTaskOutput> = async (ctx) => {
    const { input, signal, reportProgress } = ctx
    if (!(input?.blob instanceof Blob)) throw new Error('Cutout input must be an image blob.')
    const decoded = await decodeImage(input.blob)
    reportProgress(0.25, 'image decoded')
    const run = await cpu.runFunction(
      chromaCutoutKernel,
      { pixels: decoded.pixels, width: decoded.width, height: decoded.height },
      { signal, allowMainThreadFallback: false },
    )
    if (!run.ok) throw new Error(run.reason)
    reportProgress(0.8, 'chroma key applied')
    const blob = await encodeImage(run.output, 'image/png')
    return {
      blob,
      bytes: blob.size,
      width: run.output.width,
      height: run.output.height,
      pixels: run.output.pixels,
      transparentFraction: run.output.transparentFraction,
      keyHue: run.output.keyHue,
      keySamples: run.output.keySamples,
    }
  }

  return [
    {
      kind: PREPROCESS_KIND,
      productId: 'laxii',
      preferredOrder: ['client-cpu'],
      handlers: { 'client-cpu': preprocessHandler as TargetHandler<unknown, unknown> },
      feasibility: { gpuSupported: false, cpuSupported: true },
      resourceClass: 'medium',
      privacy: 'device-preferred',
      timeoutMs: 60_000,
    },
    {
      kind: CUTOUT_KIND,
      productId: 'laxii',
      preferredOrder: ['client-cpu'],
      handlers: { 'client-cpu': cutoutHandler as TargetHandler<unknown, unknown> },
      feasibility: { gpuSupported: false, cpuSupported: true },
      resourceClass: 'medium',
      privacy: 'device-preferred',
      timeoutMs: 60_000,
    },
    {
      // Honest placeholder: model-gated. No handlers — the scheduler's model
      // gate fires FIRST and reports the truthful unavailability state.
      kind: SEGMENTATION_KIND,
      productId: 'laxii',
      preferredOrder: ['client-gpu', 'client-cpu'],
      handlers: {},
      feasibility: { gpuSupported: true, cpuSupported: true, requiredModelId: 'laxii-bgremoval-modnet', estimatedMemoryMb: 300 },
      resourceClass: 'heavy',
      privacy: 'device-preferred',
      timeoutMs: 120_000,
    },
  ]
}

export function registerLaxiiAdapter(client: Pick<ClientCompute, 'scheduler' | 'cpu'>): void {
  client.scheduler.registerProductAdapter({
    productId: 'laxii',
    summary: 'Client-side image preprocessing (downscale/compress before upload) and deterministic chroma-key cutout; ML segmentation stays model-gated and honestly unavailable.',
    kinds: buildLaxiiKinds(client.cpu),
  })
}

/** Typed convenience wrappers used by product UI. */
export async function scheduleImagePreprocess(
  client: Pick<ClientCompute, 'scheduler'>,
  input: PreprocessTaskInput,
  options: { signal?: AbortSignal; onProgress?: (fraction: number, note?: string) => void } = {},
): Promise<ComputeTaskOutput<PreprocessTaskOutput>> {
  return client.scheduler.runTask<PreprocessTaskInput, PreprocessTaskOutput>(
    {
      productId: 'laxii',
      kind: PREPROCESS_KIND,
      input,
      signal: options.signal,
    },
    { onProgress: options.onProgress ? (e) => options.onProgress!(e.fraction, e.note) : undefined },
  )
}

export async function scheduleChromaCutout(
  client: Pick<ClientCompute, 'scheduler'>,
  input: ChromaCutoutTaskInput,
  options: { signal?: AbortSignal; onProgress?: (fraction: number, note?: string) => void } = {},
): Promise<ComputeTaskOutput<ChromaCutoutTaskOutput>> {
  return client.scheduler.runTask<ChromaCutoutTaskInput, ChromaCutoutTaskOutput>(
    {
      productId: 'laxii',
      kind: CUTOUT_KIND,
      input,
      signal: options.signal,
    },
    { onProgress: options.onProgress ? (e) => options.onProgress!(e.fraction, e.note) : undefined },
  )
}
