/**
 * BEAN Intelligence — client compute: WebGPU execution engine (Phase 3).
 *
 * Responsibilities (spec):
 *  - Request a GPU adapter safely and a device with appropriate limits.
 *  - Detect unsupported features (via webgpu/compatibility.ts).
 *  - Handle adapter/device loss and out-of-memory honestly.
 *  - Support cancellation where possible, task timeouts, and ALWAYS release
 *    GPU buffers created during a task (automatic cleanup after completion).
 *  - Never block the main browser thread: GPU work must be dispatched from
 *    async handlers; the CPU/WASM lane handles everything this engine
 *    declines (see the compatibility registry).
 *
 * TypeScript note: the repo does not carry @webgpu/types, so this module
 * defines minimal STRUCTURAL interfaces for the WebGPU objects it touches.
 * They describe only what the engine actually uses; the browser's real
 * objects satisfy them structurally. No vendor assumptions are made.
 *
 * HONESTY LABEL: unit tests for this engine exercise its LOGIC with injected
 * structural fakes. They never claim real-GPU execution passed. Real-GPU
 * execution requires supported hardware and is verified separately (see
 * docs/BEAN-CLIENT-COMPUTE-IMPLEMENTATION-REPORT.md for the measured record).
 *
 * Client-safe: no Node-only imports.
 */
import { checkGpuOperationSupport } from './compatibility'
import { mapGpuErrorToState } from '../fallback'
import type { CapabilitySnapshot, ComputeTaskState } from '../types'

// ---- minimal structural WebGPU surface (engine view only) -------------------

export interface StructGPUAdapter {
  features?: Iterable<string>
  limits?: Record<string, number>
  isFallbackAdapter?: boolean
  requestDevice?: (options?: { requiredLimits?: Record<string, number>; requiredFeatures?: string[] }) => Promise<StructGPUDevice>
}

export interface StructGPUBuffer {
  destroy?: () => void
  size?: number
  mapState?: string
}

export interface StructGPUDeviceLostInfo {
  reason?: string
  message?: string
}

export interface StructGPUDevice {
  features?: Iterable<string>
  limits?: Record<string, number>
  lost?: Promise<StructGPUDeviceLostInfo>
  destroy?: () => void
  createBuffer?: (descriptor: { size: number; usage: number; mappedAtCreation?: boolean }) => StructGPUBuffer
  pushErrorScope?: (filter: string) => void
  popErrorScope?: () => Promise<unknown>
}

export interface StructGPU {
  requestAdapter?: (options?: { powerPreference?: string; forceSoftware?: boolean }) => Promise<StructGPUAdapter | null>
  getPreferredCanvasFormat?: () => string
}

export interface GpuExecutionHelpers {
  device: StructGPUDevice
  /** Create a tracked buffer: destroyed automatically when the task ends. */
  createBuffer: (descriptor: { size: number; usage: number; mappedAtCreation?: boolean }) => StructGPUBuffer
}

export interface GpuExecuteOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export type GpuExecuteResult<T> =
  | { ok: true; output: T; state: ComputeTaskState; durationMs: number }
  | { ok: false; state: ComputeTaskState; reason: string; durationMs: number }

export interface GpuEngineDeps {
  /** Injectable GPU surface (tests pass structural fakes; production passes
   * the browser's navigator.gpu). Default resolves navigator.gpu. */
  gpu?: StructGPU | null
  now?: () => number
}

const DEFAULT_GPU_TIMEOUT_MS = 30_000

const BUFFER_USAGE = {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
} as const

export const GPU_BUFFER_USAGE = BUFFER_USAGE

export class WebGpuEngine {
  private adapter: StructGPUAdapter | null = null
  private device: StructGPUDevice | null = null
  private deviceLost = false
  private trackedBuffers = new Set<StructGPUBuffer>()
  private readonly gpu: StructGPU | null
  private readonly now: () => number
  private lostHandlerAttached = false

  constructor(deps: GpuEngineDeps = {}) {
    if (deps.gpu !== undefined) {
      this.gpu = deps.gpu
    } else {
      this.gpu =
        typeof navigator !== 'undefined'
          ? ((navigator as Navigator & { gpu?: StructGPU }).gpu ?? null)
          : null
    }
    this.now = deps.now ?? (() => Date.now())
  }

  /** Raw availability of the WebGPU surface (before any device request). */
  isSupported(): boolean {
    return this.gpu?.requestAdapter !== undefined
  }

  /** Registry-gated support check against a measured capability snapshot. */
  isOperationSupported(operationId: string, snapshot: CapabilitySnapshot): { supported: boolean; reason: string } {
    return checkGpuOperationSupport(operationId, snapshot)
  }

  /** Obtain (or reuse) the adapter + device. Fails honestly — never throws. */
  async ensureDevice(): Promise<{ ok: true; device: StructGPUDevice } | { ok: false; reason: string }> {
    if (this.deviceLost) {
      return { ok: false, reason: 'The previous GPU device was lost; a new device was not yet requested.' }
    }
    if (this.device) return { ok: true, device: this.device }
    if (!this.gpu?.requestAdapter) return { ok: false, reason: 'WebGPU is not available in this browser.' }
    try {
      this.adapter = (await this.gpu.requestAdapter()) ?? null
    } catch (error) {
      return { ok: false, reason: `Requesting a GPU adapter failed: ${describeError(error)}` }
    }
    if (!this.adapter) return { ok: false, reason: 'No WebGPU adapter is available.' }
    try {
      const device = (await this.adapter.requestDevice?.()) ?? null
      if (!device) return { ok: false, reason: 'The GPU adapter did not provide a device.' }
      this.device = device
      this.attachLostHandler(device)
      return { ok: true, device }
    } catch (error) {
      return { ok: false, reason: `Requesting a GPU device failed: ${describeError(error)}` }
    }
  }

  private attachLostHandler(device: StructGPUDevice): void {
    if (this.lostHandlerAttached || !device.lost) return
    this.lostHandlerAttached = true
    device.lost
      .then((info) => {
        this.deviceLost = true
        this.releaseAll()
        // Reason recorded for the next ensureDevice() call's honest refusal.
        this.lastLostReason = info?.reason ? `GPU device lost (${info.reason})` : 'GPU device lost'
      })
      .catch(() => {
        /* lost-promise rejection is not actionable beyond marking loss */
      })
  }

  private lastLostReason: string | null = null

  /**
   * Execute a GPU operation under the registry gate, with timeout,
   * cancellation, automatic buffer cleanup, and honest error mapping.
   * `operationId` must have a compatibility-registry entry.
   */
  async execute<T>(
    operationId: string,
    snapshot: CapabilitySnapshot,
    fn: (helpers: GpuExecutionHelpers) => Promise<T>,
    options: GpuExecuteOptions = {},
  ): Promise<GpuExecuteResult<T>> {
    const started = this.now()
    const support = this.isOperationSupported(operationId, snapshot)
    if (!support.supported) {
      return { ok: false, state: 'CLIENT_MODEL_UNSUPPORTED', reason: support.reason, durationMs: this.now() - started }
    }
    const ensured = await this.ensureDevice()
    if (!ensured.ok) {
      return { ok: false, state: this.deviceLost ? 'CLIENT_GPU_DEVICE_LOST' : 'CLIENT_EXECUTION_FAILED', reason: ensured.reason, durationMs: this.now() - started }
    }
    const device = ensured.device

    const timeoutMs = options.timeoutMs ?? DEFAULT_GPU_TIMEOUT_MS
    const controller = new AbortController()
    const onExternalAbort = () => controller.abort()
    if (options.signal) {
      if (options.signal.aborted) controller.abort()
      else options.signal.addEventListener('abort', onExternalAbort, { once: true })
    }
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const taskBuffers = new Set<StructGPUBuffer>()
    const helpers: GpuExecutionHelpers = {
      device,
      createBuffer: (descriptor) => {
        const buffer = device.createBuffer?.(descriptor) ?? { size: descriptor.size }
        taskBuffers.add(buffer)
        this.trackedBuffers.add(buffer)
        return buffer
      },
    }

    try {
      const work = fn(helpers)
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort()
          reject(new Error('WebGPU execution exceeded the time budget.'))
        }, timeoutMs)
      })
      const abort = new Promise<never>((_, reject) => {
        if (controller.signal.aborted) reject(new Error('Task cancelled.'))
        else controller.signal.addEventListener('abort', () => reject(new Error('Task cancelled.')), { once: true })
      })
      const output = await Promise.race([work, timeout, abort])
      return { ok: true, output, state: 'CLIENT_GPU_AVAILABLE', durationMs: this.now() - started }
    } catch (error) {
      const mapped = mapGpuErrorToState(error)
      const isTimeout = /time budget/i.test(describeError(error))
      const isCancel = /cancel/i.test(describeError(error))
      return {
        ok: false,
        state: mapped.state,
        reason: isTimeout ? 'GPU execution exceeded its time budget.' : isCancel ? 'The task was cancelled.' : mapped.reason,
        durationMs: this.now() - started,
      }
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
      options.signal?.removeEventListener('abort', onExternalAbort)
      // Automatic cleanup: destroy every buffer created during this task.
      for (const buffer of taskBuffers) {
        try {
          buffer.destroy?.()
        } catch {
          /* destroy failures are not actionable */
        }
        this.trackedBuffers.delete(buffer)
      }
    }
  }

  /** Whether the current device has been reported lost. */
  isDeviceLost(): boolean {
    return this.deviceLost
  }

  /** Honest note about device loss, when one is recorded. */
  getLossNote(): string | null {
    return this.deviceLost ? (this.lastLostReason ?? 'GPU device lost') : null
  }

  /** Release the device and every tracked buffer (idempotent). */
  releaseAll(): void {
    for (const buffer of this.trackedBuffers) {
      try {
        buffer.destroy?.()
      } catch {
        /* not actionable */
      }
    }
    this.trackedBuffers.clear()
    try {
      this.device?.destroy?.()
    } catch {
      /* not actionable */
    }
    this.device = null
    this.adapter = null
    this.lostHandlerAttached = false
  }

  /** Count of currently tracked (not yet destroyed) buffers — diagnostics. */
  trackedBufferCount(): number {
    return this.trackedBuffers.size
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

/** Default engine instance (production). Tests construct their own. */
let defaultEngine: WebGpuEngine | null = null
export function getDefaultGpuEngine(): WebGpuEngine {
  if (!defaultEngine) defaultEngine = new WebGpuEngine()
  return defaultEngine
}
