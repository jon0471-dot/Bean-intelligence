/**
 * BEAN Intelligence — shared client-first hybrid compute engine: public API.
 *
 * This is the single entry point products use. It wires:
 *   capability detection → device profile/tier → consent → resource manager
 *   → WebGPU engine → CPU/WASM engine → model registry → scheduler
 *   → product adapters.
 *
 * Nothing here starts work on its own: detection runs once (on demand),
 * compute runs only when a product schedules a task AND the user consented,
 * and backend execution remains each product's own authoritative flow.
 *
 * Client-safe: no Node-only imports.
 */
import { detectCapabilities } from './capabilities'
import { CpuEngine } from './cpu/engine'
import { deriveDeviceProfile } from './device-profile'
import { registerLaxiiAdapter } from './adapters/laxii'
import { registerCodeGiftzAdapter } from './adapters/code-giftz'
import { registerJazmiiAdapter } from './adapters/jazmii'
import { getConsent, revokeConsent, setConsent } from './privacy'
import { ModelRegistry, getDefaultModelRegistry } from './model-registry'
import { ResourceManager } from './resource-manager'
import { ComputeScheduler } from './scheduler'
import { buildCapabilityReport, clearDiagnostics, recentDiagnostics } from './telemetry'
import type {
  CapabilityReport,
  CapabilitySnapshot,
  ClientComputeConsent,
  ComputeStatus,
  DeviceProfile,
  ProductComputeAdapter,
} from './types'
import { WebGpuEngine } from './webgpu/engine'

export interface ClientCompute {
  /** Run detection + derive the profile (safe to call repeatedly; cached). */
  init: () => Promise<void>
  /** Measured capability snapshot (cached from the last init). */
  getSnapshot: () => CapabilitySnapshot | null
  getProfile: () => DeviceProfile | null
  /** Re-run detection + tier derivation (e.g. after a context change). */
  refresh: () => Promise<void>
  /** Optional, strictly-bounded CPU benchmark for tier refinement. */
  runBenchmark: () => Promise<void>
  scheduler: ComputeScheduler
  registry: ModelRegistry
  gpu: WebGpuEngine
  cpu: CpuEngine
  resources: ResourceManager
  registerAdapter: (adapter: ProductComputeAdapter) => void
  getStatus: () => Promise<ComputeStatus>
  consent: {
    get: () => ClientComputeConsent | null
    set: (granted: boolean, localOnly: boolean) => ClientComputeConsent
    revoke: () => ClientComputeConsent
  }
  /** Sanitized capability report (the only shareable surface). */
  buildReport: () => Promise<CapabilityReport | null>
  /** Send the sanitized report to the BEAN backend (explicit-consent only). */
  shareReport: () => Promise<{ ok: boolean; reason?: string }>
  diagnostics: { recent: typeof recentDiagnostics; clear: typeof clearDiagnostics }
}

class ClientComputeImpl implements ClientCompute {
  private snapshot: CapabilitySnapshot | null = null
  private profile: DeviceProfile | null = null
  private benchmarkRun = false
  readonly gpu = new WebGpuEngine()
  readonly cpu = new CpuEngine()
  readonly registry: ModelRegistry
  readonly resources: ResourceManager
  readonly scheduler: ComputeScheduler

  constructor() {
    this.registry = getDefaultModelRegistry()
    this.resources = new ResourceManager({ conservative: false })
    this.scheduler = new ComputeScheduler({
      capabilities: async () => {
        if (!this.snapshot) await this.init()
        return this.snapshot as CapabilitySnapshot
      },
      profile: () => {
        if (!this.profile) {
          // Synchronous fallback profile when init was skipped: derive from
          // the last snapshot, or a Tier-0 profile if detection never ran.
          if (this.snapshot) {
            this.profile = deriveDeviceProfile(this.snapshot)
          } else {
            this.profile = {
              tier: 0,
              tierReasons: ['detection has not run yet'],
              conservative: true,
              benchmark: null,
              derivedAt: Date.now(),
            }
          }
        }
        return this.profile
      },
      resources: this.resources,
      gpu: this.gpu,
      cpu: this.cpu,
      registry: this.registry,
    })
    // Built-in product adapters (BEAN FX / BEAN Folio do not exist yet; see audit).
    registerLaxiiAdapter(this)
    registerCodeGiftzAdapter(this)
    registerJazmiiAdapter(this)
    // M36-B — page-shutdown resource release: pagehide previously released
    // only the ResourceManager's own counters; the GPU device and CPU workers
    // stayed resident. Register the engines as cleanup hooks so releaseAll()
    // tears down every registered resource surface (brief §7: "Release
    // model/GPU resources after idle or page shutdown").
    this.resources.registerCleanup(() => this.gpu.releaseAll())
    this.resources.registerCleanup(() => this.cpu.releaseAll())
  }

  async init(): Promise<void> {
    await this.refresh()
  }

  async refresh(): Promise<void> {
    const snapshot = await detectCapabilities()
    this.snapshot = snapshot
    this.profile = deriveDeviceProfile(snapshot, this.profile?.benchmark ?? null)
    // Conservative mode drives the shared resource caps.
    this.resources.configure({ conservative: this.profile.conservative })
    this.resources.attachPageLifecycle()
  }

  async runBenchmark(): Promise<void> {
    const { runBoundedCpuBenchmark } = await import('./device-profile')
    const cpu = await runBoundedCpuBenchmark()
    // M36-B — tier 4 evidence is now a REAL GPU round-trip: on a device with
    // no adapter (or a broken compute surface) gpuComputeOk stays false and
    // the tier stays 3 — never an assumed pass, never a main-thread stall.
    let gpuComputeOk: boolean | null = null
    try {
      const gpu = await this.gpu.runComputeBenchmark({ timeoutMs: 5_000 })
      gpuComputeOk = gpu.ok
    } catch {
      gpuComputeOk = false
    }
    const merged = { ...cpu, gpuComputeOk }
    this.benchmarkRun = true
    this.profile = deriveDeviceProfile(this.snapshot ?? (await detectCapabilities()), merged)
  }

  getSnapshot(): CapabilitySnapshot | null {
    return this.snapshot
  }

  getProfile(): DeviceProfile | null {
    return this.profile
  }

  registerAdapter(adapter: ProductComputeAdapter): void {
    this.scheduler.registerProductAdapter(adapter)
  }

  async getStatus(): Promise<ComputeStatus> {
    const status = await this.scheduler.getStatus()
    return { ...status, consent: getConsent() }
  }

  get consent() {
    return {
      get: () => getConsent(),
      set: (granted: boolean, localOnly: boolean) => {
        const consent = setConsent(granted, localOnly)
        this.resources.setNote(consent.granted ? null : 'consent withdrawn')
        return consent
      },
      revoke: () => revokeConsent(),
    }
  }

  async buildReport(): Promise<CapabilityReport | null> {
    if (!this.snapshot || !this.profile) await this.init()
    if (!this.snapshot || !this.profile) return null
    const installedModels = await this.registry.installedModelIds()
    return buildCapabilityReport({ snapshot: this.snapshot, profile: this.profile, installedModels })
  }

  async shareReport(): Promise<{ ok: boolean; reason?: string }> {
    const consent = getConsent()
    if (consent?.granted !== true) {
      return { ok: false, reason: 'Sharing a capability report requires explicit client-compute consent.' }
    }
    const report = await this.buildReport()
    if (!report) return { ok: false, reason: 'Capability detection has not run yet.' }
    try {
      const res = await fetch('/api/client-compute/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ report }),
      })
      if (!res.ok) return { ok: false, reason: `The report was not accepted (HTTP ${res.status}).` }
      return { ok: true }
    } catch {
      return { ok: false, reason: 'The report could not be sent (network error).' }
    }
  }

  get hasBenchmark(): boolean {
    return this.benchmarkRun
  }

  get diagnostics() {
    return { recent: recentDiagnostics, clear: clearDiagnostics }
  }
}

let singleton: ClientComputeImpl | null = null

/** The shared engine instance. Creation is lazy and side-effect free. */
export function getClientCompute(): ClientCompute {
  if (!singleton) singleton = new ClientComputeImpl()
  return singleton
}

export { deriveDeviceProfile, runBoundedCpuBenchmark } from './device-profile'
export { detectCapabilities as detectBrowserCapabilities } from './capabilities'
export { setConsent, getConsent, revokeConsent, isDeviceComputeAllowed, isLocalOnlyMode, onConsentChange } from './privacy'
export { STATE_EXPLANATIONS } from './fallback'
export type {
  CapabilitySnapshot,
  ClientComputeConsent,
  ComputeStatus,
  ComputeTaskDescriptor,
  ComputeTaskOutput,
  DeviceProfile,
  ExecutionTarget,
  ComputeTaskState,
} from './types'
