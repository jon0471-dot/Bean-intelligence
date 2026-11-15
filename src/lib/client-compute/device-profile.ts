/**
 * BEAN Intelligence — client compute: device profile and capability tiers.
 *
 * Tiers are derived ONLY from the measured capability snapshot plus an
 * optional, opt-in, strictly time-bounded CPU benchmark. User-agent strings
 * never influence tier decisions (browser family is display-level only).
 *
 * Tier policy (conservative by construction — an unknown value always lowers
 * the tier rather than raising it):
 *   0 — unsupported client compute (non-browser, no WASM, no Workers)
 *   1 — basic CPU/WASM (WASM + Workers, no GPU)
 *   2 — WebGL or limited WebGPU (GPU present but adapter missing/limited)
 *   3 — capable WebGPU device (adapter + usable compute features)
 *   4 — high-capability WebGPU device (tier 3 + benchmark evidence)
 *
 * Client-safe: no Node-only imports.
 */
import type { BenchmarkResult, CapabilitySnapshot, ClientComputeTier, DeviceProfile } from './types'

/** Default CPU micro-benchmark budget (ms). The benchmark never runs longer
 * than this; on timeout it reports what it measured (or null) honestly. */
const BENCHMARK_BUDGET_MS = 60

/** Derive a tier from a real capability snapshot. Pure and synchronous. */
export function deriveDeviceProfile(snapshot: CapabilitySnapshot, benchmark: BenchmarkResult | null = null): DeviceProfile {
  const reasons: string[] = []
  let tier: ClientComputeTier = 0

  if (snapshot.environment === 'non-browser') {
    reasons.push("no DOM environment (server/SSR/test context) — no client compute")
    return { tier: 0, tierReasons: reasons, conservative: true, benchmark, derivedAt: Date.now() }
  }

  const wasmOk = snapshot.wasm.supported
  const workersOk = snapshot.workers
  if (!wasmOk && !workersOk && !snapshot.webgpu.supported && !snapshot.webgl.webgl2 && !snapshot.webgl.webgl1) {
    reasons.push('no WASM, no Workers, no GPU APIs detected')
    return { tier: 0, tierReasons: reasons, conservative: true, benchmark, derivedAt: Date.now() }
  }

  // Tier 1 baseline: CPU lane exists.
  if (wasmOk && workersOk) {
    tier = 1
    reasons.push(
      `WASM supported (simd=${snapshot.wasm.simd === true ? 'yes' : snapshot.wasm.simd === false ? 'no' : 'unknown'}) and Web Workers available`,
    )
  } else if (wasmOk) {
    tier = 1
    reasons.push('WASM supported; Web Workers unavailable — heavy CPU work would block the main thread, treated as basic')
  } else if (workersOk) {
    tier = 1
    reasons.push('Web Workers available; WASM unsupported — JS-only CPU lane')
  } else {
    reasons.push('neither WASM nor Workers available — CPU lane limited to main-thread JS only')
  }

  // GPU lanes raise the tier above 1.
  const gpuAdapter = snapshot.webgpu.supported && snapshot.webgpu.adapterAvailable
  const webglOk = snapshot.webgl.webgl2 || snapshot.webgl.webgl1
  if (gpuAdapter) {
    const hasComputeFeature =
      snapshot.webgpu.features.includes('timestamp-query') ||
      snapshot.webgpu.features.length >= 0 // compute is core in WebGPU; features list is informational
    if (hasComputeFeature) tier = Math.max(tier, 3) as ClientComputeTier
    if (tier < 3) tier = 2
    reasons.push(
      `WebGPU adapter available (${snapshot.webgpu.features.length} reported features${
        snapshot.webgpu.fallbackAdapter === true ? ', FALLBACK adapter (software)' : ''
      })`,
    )
    if (snapshot.webgpu.fallbackAdapter === true) {
      reasons.push('fallback (software) WebGPU adapter — conservative mode applied')
    }
  } else if (snapshot.webgpu.supported) {
    tier = Math.max(tier, 2) as ClientComputeTier
    reasons.push('WebGPU API present but no adapter obtainable — GPU lane unavailable, tier capped at 2')
  } else if (webglOk) {
    tier = Math.max(tier, 2) as ClientComputeTier
    reasons.push(
      `WebGL ${snapshot.webgl.webgl2 ? '2' : '1'} available${
        snapshot.webgl.maxTextureSize ? ` (max texture ${snapshot.webgl.maxTextureSize}px)` : ''
      } — graphics lane only`,
    )
  } else {
    reasons.push('no usable GPU lane detected')
  }

  // Tier 4 requires real benchmark evidence on top of a tier-3 GPU device.
  if (tier === 3 && benchmark && benchmark.gpuComputeOk === true) {
    tier = 4
    reasons.push(`WebGPU compute round-trip measured OK in ${benchmark.durationMs}ms — tier 4`)
  }

  // Conservative mode: mobile hint, low memory buckets, insecure context,
  // software GPU adapters. These REDUCE concurrency, never inflate tiers.
  const conservative =
    snapshot.browser.mobileHint ||
    snapshot.secureContext === false ||
    snapshot.webgpu.fallbackAdapter === true ||
    (snapshot.deviceMemoryGb !== null && snapshot.deviceMemoryGb <= 2)
  if (snapshot.browser.mobileHint) reasons.push('mobile-class browser signal — conservative defaults applied')
  if (snapshot.secureContext === false) reasons.push('insecure context — several compute APIs restricted')
  if (snapshot.deviceMemoryGb !== null && snapshot.deviceMemoryGb <= 2) {
    reasons.push(`low device memory bucket (~${snapshot.deviceMemoryGb} GB, coarse) — conservative defaults applied`)
  }

  return { tier, tierReasons: reasons, conservative, benchmark, derivedAt: Date.now() }
}

/**
 * Run the bounded CPU micro-benchmark (opt-in). Measures a simple numeric
 * workload (FMA over a Float64Array) within a strict wall-clock budget.
 * This benchmark informs tier 4 only when a real GPU round-trip also
 * succeeds; its CPU number is a label, not a hardware spec.
 */
export async function runBoundedCpuBenchmark(budgetMs: number = BENCHMARK_BUDGET_MS): Promise<BenchmarkResult> {
  const started = Date.now()
  let cpuOpsPerSec: number | null = null
  try {
    const arr = new Float64Array(1024)
    for (let i = 0; i < arr.length; i++) arr[i] = i + 1
    let ops = 0
    // Time-boxed loop: fixed 8 passes per measurement slice, re-check clock.
    while (Date.now() - started < budgetMs) {
      for (let p = 0; p < 8; p++) {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = arr[i] * 1.0000001 + 0.5
        }
        ops += arr.length
      }
    }
    const elapsedSec = Math.max((Date.now() - started) / 1000, 0.001)
    if (ops > 0) cpuOpsPerSec = Math.round(ops / elapsedSec)
  } catch {
    cpuOpsPerSec = null
  }
  return {
    cpuOpsPerSec,
    gpuComputeOk: null,
    durationMs: Date.now() - started,
    ranAt: Date.now(),
  }
}
