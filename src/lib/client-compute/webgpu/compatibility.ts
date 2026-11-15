/**
 * BEAN Intelligence — client compute: WebGPU operation/model compatibility
 * registry (Phase 3).
 *
 * "Never assume that every model supports WebGPU." This registry is the
 * gate: an operation or model runs on the GPU lane only when an entry here
 * says so AND the runtime check passes. Entries are code-defined facts about
 * BEAN's own kernels — not claims about arbitrary third-party workloads.
 *
 * Client-safe: no Node-only imports.
 */
import type { CapabilitySnapshot } from '../types'

export interface GpuOperationRequirement {
  /** WebGPU features the operation requires (checked against the adapter). */
  requiredFeatures?: string[]
  /** Minimum adapter limits the operation requires (checked against the
   * adapter's reported limits; absent limits = check fails honestly). */
  minLimits?: Record<string, number>
  /** Whether the operation can accept a fallback (software) adapter. */
  allowFallbackAdapter?: boolean
}

export interface GpuOperationEntry {
  operationId: string
  requirement: GpuOperationRequirement
  /** Honest note about what this operation does on the GPU lane. */
  note: string
}

/** Registry of BEAN GPU operations. Currently intentionally MINIMAL: the
 * engine ships GPU capability plumbing; real GPU kernels land with their
 * entries here (a kernel without an entry will never run on the GPU lane). */
export const GPU_OPERATIONS: Record<string, GpuOperationEntry> = {
  'image.chroma-cutout': {
    operationId: 'image.chroma-cutout',
    requirement: { allowFallbackAdapter: false },
    note: 'Per-pixel chroma keying + despill (deterministic math). GPU port planned; CPU/WASM lane is the default executor.',
  },
}

export function getGpuOperation(operationId: string): GpuOperationEntry | undefined {
  return GPU_OPERATIONS[operationId]
}

/** Runtime check: does the measured snapshot satisfy the entry's requirement?
 * Returns an honest verdict with a reason — never silently permissive. */
export function checkGpuOperationSupport(
  operationId: string,
  snapshot: CapabilitySnapshot,
): { supported: boolean; reason: string } {
  const entry = getGpuOperation(operationId)
  if (!entry) return { supported: false, reason: `Operation "${operationId}" has no GPU registry entry.` }
  if (!snapshot.webgpu.supported) return { supported: false, reason: 'WebGPU is not available in this browser.' }
  if (!snapshot.webgpu.adapterAvailable) return { supported: false, reason: 'No WebGPU adapter is available.' }
  if (snapshot.webgpu.fallbackAdapter === true && entry.requirement.allowFallbackAdapter !== true) {
    return { supported: false, reason: 'Only a software fallback adapter is available; this operation requires a hardware adapter.' }
  }
  if (entry.requirement.requiredFeatures?.length) {
    const missing = entry.requirement.requiredFeatures.filter((f) => !snapshot.webgpu.features.includes(f))
    if (missing.length) return { supported: false, reason: `Adapter lacks required GPU feature(s): ${missing.join(', ')}.` }
  }
  if (entry.requirement.minLimits) {
    const limits = snapshot.webgpu.limits
    if (!limits) return { supported: false, reason: 'Adapter limits are not exposed; cannot verify requirements.' }
    for (const [key, min] of Object.entries(entry.requirement.minLimits)) {
      const actual = limits[key]
      if (typeof actual !== 'number') return { supported: false, reason: `Adapter does not report limit "${key}".` }
      if (actual < min) return { supported: false, reason: `Adapter limit "${key}" (${actual}) is below the required ${min}.` }
    }
  }
  return { supported: true, reason: entry.note }
}
