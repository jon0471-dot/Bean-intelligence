/**
 * BEAN Intelligence — client compute: honest execution states and fallback
 * semantics (Phase 11).
 *
 * Every terminal task outcome maps to one of the honest states. Nothing here
 * ever upgrades a failure into a success; a task is "completed" only after
 * its output passed the registered validator. Backend fallback is decided
 * per-attempt against the CURRENT local-only flag (privacy expectations are
 * never silently changed).
 *
 * Client-safe: no Node-only imports.
 */
import type { ComputeTaskState } from './types'

/** Customer-safe explanation for each state (UI-facing; no internals). */
export const STATE_EXPLANATIONS: Record<ComputeTaskState, string> = {
  CLIENT_GPU_AVAILABLE: 'Your GPU can run this task locally.',
  CLIENT_CPU_AVAILABLE: 'This task can run locally on your device.',
  CLIENT_MODEL_NOT_INSTALLED: 'The model needed for this task is not installed on your device.',
  CLIENT_MODEL_DOWNLOADING: 'A required model is downloading to your device.',
  CLIENT_MODEL_UNSUPPORTED: 'This model is not supported on your device or browser.',
  CLIENT_MEMORY_INSUFFICIENT: 'Your device does not have enough available memory for this task.',
  CLIENT_GPU_DEVICE_LOST: 'The GPU was lost or reset while running the task.',
  CLIENT_EXECUTION_FAILED: 'Local execution failed.',
  BACKEND_FALLBACK_AVAILABLE: 'This task can also run on BEAN servers.',
  BACKEND_FALLBACK_RUNNING: 'Running on BEAN servers instead of your device.',
  NO_SUPPORTED_EXECUTION_PATH: 'No execution path can run this task right now.',
}

/** Human-facing summary of a state: success-flavored states vs failures. */
export function isTerminalSuccessState(state: ComputeTaskState): boolean {
  return state === 'CLIENT_GPU_AVAILABLE' || state === 'CLIENT_CPU_AVAILABLE' || state === 'BACKEND_FALLBACK_RUNNING'
}

/** Map a thrown error from a GPU execution attempt to an honest state.
 * Recognizes WebGPU device-loss and out-of-memory error shapes without
 * assuming a specific browser implementation. */
export function mapGpuErrorToState(error: unknown): { state: ComputeTaskState; reason: string } {
  const name = typeof (error as { name?: string })?.name === 'string' ? (error as { name: string }).name : ''
  const message = typeof (error as { message?: string })?.message === 'string' ? (error as { message: string }).message : ''
  if (name === 'GPUDeviceLostInfo' || /device.*(lost|destroyed)/i.test(message)) {
    return { state: 'CLIENT_GPU_DEVICE_LOST', reason: 'The GPU device was lost during execution.' }
  }
  if (name === 'GPUOutOfMemoryError' || /out of memory/i.test(message)) {
    return { state: 'CLIENT_MEMORY_INSUFFICIENT', reason: 'The GPU ran out of memory during execution.' }
  }
  return { state: 'CLIENT_EXECUTION_FAILED', reason: 'Local GPU execution failed.' }
}

/** Map a thrown error from a CPU/worker execution attempt to an honest state. */
export function mapCpuErrorToState(error: unknown): { state: ComputeTaskState; reason: string } {
  const name = typeof (error as { name?: string })?.name === 'string' ? (error as { name: string }).name : ''
  const message = typeof (error as { message?: string })?.message === 'string' ? (error as { message: string }).message : ''
  if (/aborted|cancel/i.test(`${name} ${message}`)) {
    return { state: 'CLIENT_EXECUTION_FAILED', reason: 'The task was cancelled.' }
  }
  return { state: 'CLIENT_EXECUTION_FAILED', reason: 'Local CPU execution failed.' }
}

/** Decide whether backend fallback is permitted for this attempt. The
 * local-only flag is re-read on EVERY call — consent may change mid-flight. */
export function backendFallbackAllowed(options: {
  privacy: 'local-only' | 'device-preferred' | 'backend-preferred'
  fallbackPolicyAllowBackend?: boolean
  isLocalOnlyMode: () => boolean
}): { allowed: boolean; reason?: string } {
  const localOnly = options.isLocalOnlyMode()
  if (options.privacy === 'local-only' || localOnly) {
    return {
      allowed: false,
      reason:
        options.privacy === 'local-only'
          ? 'This task is marked local-only; it cannot be sent to a backend.'
          : 'You selected local-only processing; this task will not be sent to a backend.',
    }
  }
  if (options.fallbackPolicyAllowBackend === false) {
    return { allowed: false, reason: 'Task policy disallows backend fallback.' }
  }
  return { allowed: true }
}
