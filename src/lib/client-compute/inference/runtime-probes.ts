/**
 * BEAN Intelligence — client runtime availability probes.
 *
 * Registers the REAL availability of each browser AI runtime with the client
 * model registry. Registration happens here — and only here — so there is
 * exactly one place where runtime availability is claimed, and every claim
 * is derived from measured browser facts (never from a config flag).
 *
 *  - web-llm:      WebGPU adapter + Web Workers (the engine runs in a worker).
 *  - transformers.js: WASM + Web Workers (GPU is attempted opportunistically
 *                  with an honest WASM fallback inside the pipeline loader).
 *  - onnxruntime-web: WASM SIMD + Web Workers.
 *
 * The registry's availability contract is SYNCHRONOUS, so probes answer from
 * the last RESOLVED capability detection. `ensureProbesResolved()` awaits the
 * first detection before any status surface is rendered — until then the
 * probes honestly answer false (refuse, never assume).
 *
 * Client-safe: no Node-only imports.
 */

import { detectCapabilities } from '../capabilities'
import { registerModelRuntime } from '../model-registry'
import type { CapabilitySnapshot as CapabilitySnapshotLike } from '../types'

interface ProbeState {
  registered: boolean
  resolved: boolean
  snapshot: CapabilitySnapshotLike | null
}

const state: ProbeState = {
  registered: false,
  resolved: false,
  snapshot: null,
}

function webLlmAvailable(s: CapabilitySnapshotLike | null): boolean {
  return s?.webgpu.adapterAvailable === true && s.workers === true
}
function transformersAvailable(s: CapabilitySnapshotLike | null): boolean {
  return s?.wasm.supported === true && s.workers === true
}
function ortAvailable(s: CapabilitySnapshotLike | null): boolean {
  // WASM with SIMD is the honest floor for the ORT build shipped here; when
  // SIMD support cannot be measured the answer is false (refuse, never assume).
  return s?.wasm.supported === true && s.wasm.simd === true && s.workers === true
}

/** Idempotent registration. Probes answer false until detection resolves. */
export function registerClientRuntimeProbes(): void {
  if (state.registered) return
  state.registered = true
  registerModelRuntime('web-llm', () => state.resolved && webLlmAvailable(state.snapshot))
  registerModelRuntime('transformers.js', () => state.resolved && transformersAvailable(state.snapshot))
  registerModelRuntime('onnxruntime-web', () => state.resolved && ortAvailable(state.snapshot))
}

/** Run (or reuse) the capability detection backing the probes. */
export async function ensureProbesResolved(snapshot?: CapabilitySnapshotLike): Promise<void> {
  registerClientRuntimeProbes()
  if (snapshot) {
    state.snapshot = snapshot
    state.resolved = true
    return
  }
  if (state.resolved) return
  state.snapshot = await detectCapabilities()
  state.resolved = true
}

/** Synchronous view of the current probe facts (for status surfaces). */
export function currentRuntimeAvailability(): { webLlm: boolean; transformersJs: boolean; ortWeb: boolean; resolved: boolean } {
  return {
    webLlm: state.resolved && webLlmAvailable(state.snapshot),
    transformersJs: state.resolved && transformersAvailable(state.snapshot),
    ortWeb: state.resolved && ortAvailable(state.snapshot),
    resolved: state.resolved,
  }
}

/** Test seam: reset probes + cache. */
export function resetRuntimeProbesForTests(): void {
  state.registered = false
  state.resolved = false
  state.snapshot = null
}
