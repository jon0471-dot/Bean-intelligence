/**
 * BEAN Intelligence — DeviceCapabilityManager (task §4: the shared device
 * capability + runtime-selection layer of the universal AI runtime).
 *
 * Responsibilities (all honest, all measured):
 *  - Real capability detection (WebGPU adapter/device, WASM/SIMD, workers,
 *    storage) — never user-agent based, never fingerprinting: the report
 *    that can leave the device is the sanitized CapabilityReport (telemetry).
 *  - Runtime availability (web-llm / transformers.js / onnxruntime-web) via
 *    the registered probes.
 *  - Model compatibility + a SAFE MEMORY BUDGET (policy estimate from the
 *    browser's coarse device-memory bucket — browsers never expose exact RAM).
 *  - Active model residency (one large generative model per tab).
 *  - Local desktop engine pairing state + reachability (measured).
 *  - The RESILIENT SELECTION POLICY (task §4):
 *      1. compatible WebGPU model on this device,
 *      2. compatible CPU/WASM model on this device,
 *      3. authenticated, explicitly-configured local desktop inference,
 *      4. existing configured server-side provider or worker,
 *      5. honest unavailable state with a useful explanation.
 *  - Honest status vocabulary (task §8): ready / loading / downloading /
 *    not-installed / not-configured / unsupported-on-device / unavailable /
 *    degraded / failed. A status is never 'ready' because config says so.
 *
 * Privacy: this manager runs in the visitor's browser for the visitor's own
 * requests. It never sends prompts or media to another visitor's device, and
 * the only cross-network surfaces are the user-chosen server lane and the
 * user-paired loopback engine.
 *
 * Client-safe: no Node-only imports.
 */

import { getClientCompute } from '../index'
import { getDefaultModelRegistry, type ClientModelEntry } from '../model-registry'
import { getConsent, isLocalOnlyMode } from '../privacy'
import {
  getDeviceSettings,
  setDeviceSettings,
  onDeviceSettingsChange,
  type AiDeviceMode,
  type AiDeviceSettings,
  type LocalEnginePairing,
} from './device-settings'
import { ensureProbesResolved, registerClientRuntimeProbes, currentRuntimeAvailability } from './runtime-probes'
import { AiErrorImpl, toAiError, type AiError } from './errors'
import type { WebLlmChatClient } from './webllm-chat-client'
import type { WasmChatClient } from './wasm-chat-client'
import type { ExecutionTarget, ClientComputeConsent } from '../types'

/** Honest status vocabulary (task §8). */
export type AiCapabilityStatus =
  | 'ready'
  | 'loading'
  | 'downloading'
  | 'not-installed'
  | 'not-configured'
  | 'unsupported-on-device'
  | 'unavailable'
  | 'degraded'
  | 'failed'

export const AI_CAPABILITY_STATUS_EXPLANATIONS: Record<AiCapabilityStatus, string> = {
  ready: 'Verified available on this device right now.',
  loading: 'A model or runtime is loading (compiling / warming up).',
  downloading: 'A model is being downloaded with explicit user approval.',
  'not-installed': 'The model is not downloaded on this device yet.',
  'not-configured': 'No runtime or backend is configured for this capability.',
  'unsupported-on-device': 'This device cannot run this capability (capability or memory gate failed).',
  unavailable: 'The runtime/backend answered but the capability is currently failing.',
  degraded: 'Working, with a measured limitation (e.g. running on CPU instead of GPU).',
  failed: 'The last attempt failed; the reason and recovery are shown.',
}

/** AI capability kinds the manager routes. */
export type AiCapabilityKind =
  | 'chat.on-device'
  | 'chat.local-engine'
  | 'audio.transcription.on-device'
  | 'image.segmentation'

export interface AiCapabilityView {
  capability: AiCapabilityKind
  status: AiCapabilityStatus
  /** Where it WOULD / DOES run. */
  target: ExecutionTarget | 'local-engine' | 'server' | null
  modelId: string | null
  /** Honest explanation, always present unless status === 'ready'. */
  reason: string | null
}

export interface LocalEngineStatus {
  paired: boolean
  /** null = never measured this session; true/false = last measured probe. */
  reachable: boolean | null
  reportedModel: string | null
  checkedAt: string | null
}

export interface DeviceAiStatus {
  environment: 'browser' | 'non-browser'
  tier: number
  tierLabel: string
  conservative: boolean
  consent: ClientComputeConsent | null
  mode: AiDeviceMode
  webgpu: { supported: boolean; adapterAvailable: boolean; features: string[] }
  wasm: { supported: boolean; simd: boolean | null }
  workers: boolean
  runtimes: { webLlm: boolean; transformersJs: boolean; ortWeb: boolean; resolved: boolean }
  /** Policy estimate (never a measured free-RAM value — browsers hide that). */
  memoryBudgetMb: number | null
  activeHeavyModel: string | null
  localEngine: LocalEngineStatus
  capabilities: AiCapabilityView[]
  models: Array<{
    id: string
    /** M36-D: customer-safe capability name (never a foundation model name). */
    displayName: string
    runtime: string
    /** M36-D: runtime category label (never a runtime package name). */
    runtimeLabel: string
    runtimeAvailable: boolean
    gpuCompatible: boolean
    cpuCompatible: boolean
    sizeBytes: number | null
    sizeUnverified: boolean
    license: string
    /** M36-D: bare license name for the consent disclosure. */
    licenseName: string
    revision: string | null
    integrity: string
    downloadPath: string
    enabled: boolean
    supportedTasks: string[]
    limitations: string[]
    installed: boolean
    installedBytes: number | null
  }>
}

export interface SelectionDecision {
  target: ExecutionTarget | 'local-engine' | 'server' | null
  modelId: string | null
  /** Why this decision (honest trail for UI + diagnostics). */
  reasons: string[]
}

/** M36-D: exported model ids (registry keys — internal routing truth, never
 *  rendered identity). Customer UI imports these instead of re-declaring the
 *  literal strings. */
export const CHAT_MODEL_ID = 'riishe-chat-webllm-qwen2.5-0.5b'
/** M39 §B: the registered CPU/WASM chat model (low-spec + GPU-failure lane). */
export const CHAT_CPU_MODEL_ID = 'riishe-chat-wasm-qwen2.5-0.5b-gguf'
export const ASR_MODEL_ID = 'gangzii-asr-browser-whisper-tiny'
const SEGMENTATION_MODEL_ID = 'laxii-bgremoval-modnet'

/** M39 §B test seams (production NEVER sets these): injectable client
 *  factories + verified-artifact source, same honesty pattern as the
 *  injectable engine fakes in cpu/engine and webgpu/engine. */
export interface ChatClientSeams {
  webllm?: () => Promise<{ getSharedWebLlmClient: () => WebLlmChatClient }>
  wasm?: () => Promise<{ getSharedWasmChatClient: () => WasmChatClient }>
  /** Produces the registry-verified artifact blob for a bean-managed model,
   *  downloading it first when `approval` is true (the caller's dialog). */
  artifact?: (modelId: string, approval: boolean, options: { onProgress?: (p: { note: string; progress: number | null }) => void; signal?: AbortSignal }) => Promise<Blob>
}

let chatClientSeams: ChatClientSeams = {}
/** Test-only seam injection. */
export function setChatClientSeamsForTests(seams: ChatClientSeams): void {
  chatClientSeams = seams
}

export interface DeviceCapabilityManagerEvents {
  onStatusChanged?: () => void
}

export class DeviceCapabilityManager {
  private initialized = false
  private initPromise: Promise<void> | null = null
  private listeners = new Set<() => void>()
  private localEngineReachable: boolean | null = null
  private localEngineCheckedAt: string | null = null
  private localEngineModel: string | null = null
  /** 'downloading' | 'loading' per capability (real progress-driven flags). */
  private readonly transient = new Map<string, AiCapabilityStatus>()
  /** Last failure per capability (honest 'failed' state with recovery). */
  private readonly lastFailure = new Map<string, AiError>()
  private unsubscribeSettings: (() => void) | null = null

  constructor(events: DeviceCapabilityManagerEvents = {}) {
    registerClientRuntimeProbes()
    this.unsubscribeSettings = onDeviceSettingsChange(() => this.emit())
    if (events.onStatusChanged) this.listeners.add(events.onStatusChanged)
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private emit(): void {
    for (const cb of this.listeners) {
      try {
        cb()
      } catch {
        /* listener errors must never break the manager */
      }
    }
  }

  /** Initialize detection + probes (idempotent, safe to call repeatedly). */
  async init(): Promise<void> {
    if (this.initialized) return
    this.initPromise ??= (async () => {
      const cc = getClientCompute()
      await cc.init()
      await ensureProbesResolved(cc.getSnapshot() ?? undefined)
      this.initialized = true
      this.emit()
    })()
    await this.initPromise
  }

  /** Mark a capability as transiently loading/downloading (progress-driven). */
  setTransientStatus(capability: AiCapabilityKind, status: 'loading' | 'downloading' | null): void {
    if (status === null) this.transient.delete(capability)
    else this.transient.set(capability, status)
    this.emit()
  }

  /** Record an honest failure for a capability (drives 'failed' + recovery). */
  recordFailure(capability: AiCapabilityKind, error: unknown): AiError {
    const mapped = toAiError(error)
    this.lastFailure.set(capability, mapped)
    this.emit()
    return mapped
  }

  clearFailure(capability: AiCapabilityKind): void {
    this.lastFailure.delete(capability)
    this.emit()
  }

  /**
   * SAFE MODEL MEMORY BUDGET — a policy estimate, clearly labeled. Browsers
   * do not expose exact free RAM/VRAM; the estimate uses the coarse
   * device-memory bucket (Chromium) and conservative-mode tightening.
   */
  estimateSafeModelMemoryBudgetMb(): number | null {
    const cc = getClientCompute()
    const snapshot = cc.getSnapshot()
    if (!snapshot || snapshot.environment !== 'browser') return null
    const gb = snapshot.deviceMemoryGb
    const conservative = cc.getProfile()?.conservative ?? true
    if (gb === null) return conservative ? 512 : 1024
    const raw = gb * 1024 * 0.4 // 40% of the coarse device bucket
    const clamped = Math.min(4096, Math.max(256, Math.round(raw)))
    return conservative ? Math.min(clamped, 1024) : clamped
  }

  /** Does the device budget fit this model (with headroom)? */
  fitsMemoryBudget(entry: ClientModelEntry): { fits: boolean; budgetMb: number | null } {
    const budget = this.estimateSafeModelMemoryBudgetMb()
    if (budget === null) return { fits: false, budgetMb: null }
    const need = entry.memoryEstimateMb ?? 0
    return { fits: need === 0 ? true : need <= budget, budgetMb: budget }
  }

  /**
   * THE SELECTION POLICY (task §4), for one capability kind. Pure over
   * measured facts + user settings; never fabricates availability.
   */
  selectExecutionPath(kind: AiCapabilityKind, settings?: AiDeviceSettings): SelectionDecision {
    const s = settings ?? getDeviceSettings()
    const reasons: string[] = []
    const consent = getConsent()
    const cc = getClientCompute()
    const snapshot = cc.getSnapshot()
    const runtimes = currentRuntimeAvailability()
    const registry = getDefaultModelRegistry()

    const modeAllowsDevice = s.mode === 'auto' || s.mode === 'gpu-preferred' || s.mode === 'cpu-only'
    const modeAllowsLocalEngine = s.mode === 'auto' || s.mode === 'local-engine'

    if (kind === 'chat.on-device') {
      if (!modeAllowsDevice) {
        reasons.push(`mode "${s.mode}" does not use on-device inference`)
        return this.serverOrUnavailable(kind, reasons, s)
      }
      if (!consent?.granted) {
        reasons.push('device-compute consent has not been granted')
        return this.serverOrUnavailable(kind, reasons, s)
      }
      // Step 1: compatible WebGPU model (skipped honestly in cpu-only mode —
      // M39: the user's battery/thermal preference is respected on the GPU
      // chat lane exactly like on the ASR lane).
      const entry = registry.getEntry(CHAT_MODEL_ID)
      if (!entry) {
        reasons.push('chat model entry missing from the registry')
        return this.serverOrUnavailable(kind, reasons, s)
      }
      if (runtimes.webLlm && entry.gpuCompatible && snapshot?.webgpu.adapterAvailable && s.mode !== 'cpu-only') {
        const { fits, budgetMb } = this.fitsMemoryBudget(entry)
        if (fits) {
          return { target: 'client-gpu', modelId: entry.id, reasons: [...reasons, `WebGPU adapter available; memory budget ${budgetMb} MB fits the ${entry.memoryEstimateMb} MB policy estimate`] }
        }
        reasons.push(`WebGPU available but the memory budget (${budgetMb} MB) does not fit the model estimate (${entry.memoryEstimateMb} MB)`)
      } else {
        reasons.push(s.mode === 'cpu-only' ? 'CPU-only mode skips the WebGPU lane' : 'WebGPU adapter unavailable for the GPU chat lane')
      }
      // Step 2: compatible CPU/WASM model — M39 registers a WASM/GGUF chat
      // model, so low-spec devices (and devices whose GPU failed) get a
      // working compatible execution path instead of a dead end.
      const cpuEntry = registry.getEntry(CHAT_CPU_MODEL_ID)
      if (cpuEntry && runtimes.wasmBinary && snapshot?.wasm.supported && snapshot.workers) {
        const { fits, budgetMb } = this.fitsMemoryBudget(cpuEntry)
        if (fits) {
          return { target: 'client-cpu', modelId: cpuEntry.id, reasons: [...reasons, `WASM/SIMD CPU lane available; memory budget ${budgetMb} MB fits the ${cpuEntry.memoryEstimateMb} MB policy estimate; context length adapted to the budget`] }
        }
        reasons.push(`WASM CPU lane exists but the memory budget (${budgetMb} MB) does not fit the model estimate (${cpuEntry.memoryEstimateMb} MB)`)
      } else {
        reasons.push('no CPU/WASM chat runtime available on this device')
      }
      return this.serverOrUnavailable(kind, reasons, s)
    }

    if (kind === 'audio.transcription.on-device') {
      if (!modeAllowsDevice) {
        reasons.push(`mode "${s.mode}" does not use on-device inference`)
        return this.serverOrUnavailable(kind, reasons, s)
      }
      if (!consent?.granted) {
        reasons.push('device-compute consent has not been granted')
        return this.serverOrUnavailable(kind, reasons, s)
      }
      const entry = registry.getEntry(ASR_MODEL_ID)
      if (!entry) {
        reasons.push('ASR model entry missing from the registry')
        return this.serverOrUnavailable(kind, reasons, s)
      }
      // Step 1: WebGPU-capable pipeline when the adapter exists; Step 2: the
      // pipeline itself falls back to WASM (both honestly reported).
      if (runtimes.transformersJs && (snapshot?.webgpu.adapterAvailable || snapshot?.wasm.supported)) {
        const { fits, budgetMb } = this.fitsMemoryBudget(entry)
        if (fits) {
          const gpu = snapshot?.webgpu.adapterAvailable && s.mode !== 'cpu-only'
          return {
            target: gpu ? 'client-gpu' : 'client-cpu',
            modelId: entry.id,
            reasons: [...reasons, gpu ? 'WebGPU pipeline (WASM fallback built into the loader)' : 'WASM/SIMD pipeline', `memory budget ${budgetMb} MB fits the ${entry.memoryEstimateMb} MB policy estimate`],
          }
        }
        reasons.push(`memory budget (${budgetMb} MB) does not fit the model estimate (${entry.memoryEstimateMb} MB)`)
      } else {
        reasons.push('Transformers.js runtime unavailable (WASM/Workers gate failed)')
      }
      return this.serverOrUnavailable(kind, reasons, s)
    }

    if (kind === 'chat.local-engine') {
      if (!modeAllowsLocalEngine) {
        reasons.push(`mode "${s.mode}" does not use the local desktop engine`)
        return this.serverOrUnavailable(kind, reasons, s)
      }
      const pairing = s.localEngine
      if (!pairing) {
        reasons.push('no local desktop engine is paired')
        return this.serverOrUnavailable(kind, reasons, s)
      }
      if (this.localEngineReachable === false) {
        reasons.push('the paired engine did not answer the last reachability check')
        return this.serverOrUnavailable(kind, reasons, s)
      }
      return { target: 'local-engine', modelId: this.localEngineModel, reasons: [...reasons, 'paired loopback engine'] }
    }

    // image.segmentation (MODNet): WebGPU EP attempted, WASM/SIMD fallback.
    if (!modeAllowsDevice || !consent?.granted) {
      reasons.push(!consent?.granted ? 'device-compute consent has not been granted' : `mode "${s.mode}" does not use on-device inference`)
      return { target: null, modelId: null, reasons }
    }
    const entry = registry.getEntry(SEGMENTATION_MODEL_ID)
    if (!entry || !runtimes.ortWeb) {
      reasons.push(!runtimes.ortWeb ? 'onnxruntime-web runtime unavailable' : 'segmentation model missing from the registry')
      return { target: null, modelId: null, reasons }
    }
    const gpu = snapshot?.webgpu.adapterAvailable && s.mode !== 'cpu-only'
    return { target: gpu ? 'client-gpu' : 'client-cpu', modelId: entry.id, reasons }
  }

  /** Step 4 (server) unless local-only privacy forbids it — then step 5. */
  private serverOrUnavailable(kind: AiCapabilityKind, reasons: string[], _s: AiDeviceSettings): SelectionDecision {
    if (isLocalOnlyMode()) {
      return { target: null, modelId: null, reasons: [...reasons, 'local-only privacy mode forbids the server fallback (honest unavailable state)'] }
    }
    return { target: 'server', modelId: null, reasons: [...reasons, 'server lane available (existing BEAN gateway)'] }
  }

  /** Full status view for settings/UI surfaces. */
  async getStatus(): Promise<DeviceAiStatus> {
    await this.init()
    const cc = getClientCompute()
    const snapshot = cc.getSnapshot()
    const profile = cc.getProfile()
    const settings = getDeviceSettings()
    const registry = getDefaultModelRegistry()
    const consent = getConsent()
    const status = await cc.getStatus()

    const capabilities: AiCapabilityView[] = (['chat.on-device', 'chat.local-engine', 'audio.transcription.on-device', 'image.segmentation'] as AiCapabilityKind[]).map((kind) => {
      const decision = this.selectExecutionPath(kind, settings)
      const transient = this.transient.get(kind)
      const failure = this.lastFailure.get(kind)
      if (failure && !transient) {
        return { capability: kind, status: 'failed', target: decision.target, modelId: decision.modelId, reason: `${failure.message} ${failure.recovery}`.trim() }
      }
      if (transient) {
        return { capability: kind, status: transient, target: decision.target, modelId: decision.modelId, reason: null }
      }
      if (decision.target === null) {
        return { capability: kind, status: 'unsupported-on-device', target: null, modelId: decision.modelId, reason: decision.reasons.join('; ') }
      }
      if (decision.target === 'server') {
        return { capability: kind, status: kind === 'image.segmentation' ? 'unsupported-on-device' : 'not-configured', target: 'server', modelId: null, reason: decision.reasons.join('; ') }
      }
      if (kind === 'chat.local-engine') {
        const reachable = this.localEngineReachable
        return {
          capability: kind,
          status: reachable === false ? 'unavailable' : reachable === true ? 'ready' : 'degraded',
          target: 'local-engine',
          modelId: decision.modelId,
          reason: reachable === null ? 'paired; reachability not measured this session' : null,
        }
      }
      // Device lanes: 'ready' requires the model to actually be installed
      // (verified) or loadable — never a bare claim.
      const modelId = decision.modelId
      if (!modelId) {
        return { capability: kind, status: 'not-configured', target: decision.target, modelId: null, reason: 'no model selected for this lane' }
      }
      return {
        capability: kind,
        status: 'not-installed',
        target: decision.target,
        modelId,
        reason: `${modelId} is available for download on this device (not installed yet)`,
      }
    })

    const models = await Promise.all(
      registry.listPublic().map(async (m) => {
        const installed = await registry.getInstallState(m.id)
        return {
          ...m,
          installed: installed.installed,
          installedBytes: installed.installed ? installed.bytes : null,
        }
      }),
    )

    return {
      environment: snapshot?.environment ?? 'non-browser',
      tier: profile?.tier ?? 0,
      tierLabel: profile ? tierLabelOf(profile.tier) : 'undetected',
      conservative: profile?.conservative ?? true,
      consent,
      mode: settings.mode,
      webgpu: {
        supported: snapshot?.webgpu.supported ?? false,
        adapterAvailable: snapshot?.webgpu.adapterAvailable ?? false,
        features: snapshot?.webgpu.features ?? [],
      },
      wasm: snapshot?.wasm ?? { supported: false, simd: null },
      workers: snapshot?.workers ?? false,
      runtimes: currentRuntimeAvailability(),
      memoryBudgetMb: this.estimateSafeModelMemoryBudgetMb(),
      activeHeavyModel: status.activeHeavyModel ?? getSharedChatModelResidency(),
      localEngine: {
        paired: settings.localEngine !== null,
        reachable: this.localEngineReachable,
        reportedModel: this.localEngineModel ?? settings.localEngine?.reportedModel ?? null,
        checkedAt: this.localEngineCheckedAt,
      },
      capabilities,
      models,
    }
  }

  // -------------------------------------------------------------------------
  // On-device chat lane (Tier A)
  // -------------------------------------------------------------------------

  /**
   * Load the on-device chat model (consent + policy enforced). M39 §B: the
   * GPU lane is attempted first; when it fails with an honest GPU-class
   * failure (device lost / WebGPU unavailable / out of memory) AND a
   * compatible CPU/WASM lane exists, the CPU lane is the AUTOMATIC fallback
   * — never a silent substitution (the degraded state records exactly why).
   * `approval` is the user's explicit download decision from the size
   * dialog (required before the bean-managed CPU artifact downloads).
   */
  async ensureOnDeviceChatReady(
    options: { onProgress?: (p: { note: string; progress: number | null }) => void; signal?: AbortSignal; approval?: boolean } = {},
  ): Promise<{ modelId: string; target: 'client-gpu' | 'client-cpu' }> {
    const decision = this.selectExecutionPath('chat.on-device')
    if (decision.target === 'client-gpu') {
      // M36-B — reserve the device's ONE heavy-model slot BEFORE loading
      // (brief §7: "Reserve resources before loading or executing"). The slot
      // makes chat and ASR mutually exclusive on this device instead of
      // silently competing for memory.
      const slot = await this.acquireDeviceHeavySlot(CHAT_MODEL_ID)
      if (!slot.ok) {
        const error = new AiErrorImpl('AI_RUNTIME_UNAVAILABLE', slot.reason)
        this.recordFailure('chat.on-device', error)
        throw error
      }
      this.clearFailure('chat.on-device')
      this.setTransientStatus('chat.on-device', 'downloading')
      const { getSharedWebLlmClient } = await this.importWebLlm()
      const client = getSharedWebLlmClient()
      try {
        const modelId = await client.load(CHAT_MODEL_ID, options)
        this.setTransientStatus('chat.on-device', null)
        webLlmResidency.current = modelId
        return { modelId, target: 'client-gpu' }
      } catch (error) {
        this.setTransientStatus('chat.on-device', null)
        this.releaseDeviceHeavySlot(CHAT_MODEL_ID)
        const mapped = toAiError(error)
        // M39 §B — GPU unavailable or UNRELIABLE at load time: the registered
        // CPU/WASM lane is the automatic fallback when this device can serve
        // it. The fallback is never silent — it records the honest reason.
        const gpuFailure = mapped.code === 'AI_GPU_DEVICE_LOST' || mapped.code === 'AI_WEBGPU_UNAVAILABLE' || mapped.code === 'AI_OUT_OF_MEMORY'
        if (gpuFailure && this.canUseCpuChatLane()) {
          try {
            return await this.ensureCpuChatReady(options, `The GPU chat lane failed on this device (${mapped.code}); the model loaded on the CPU lane instead — slower generation, same device, same privacy.`)
          } catch (cpuError) {
            throw this.recordFailure('chat.on-device', cpuError)
          }
        }
        throw this.recordFailure('chat.on-device', error)
      }
    }
    if (decision.target === 'client-cpu') {
      return await this.ensureCpuChatReady(options)
    }
    const error = new AiErrorImpl('AI_WEBGPU_UNAVAILABLE', decision.reasons.join('; '))
    this.recordFailure('chat.on-device', error)
    throw error
  }

  /** M39 §B: does this device honestly qualify for the CPU/WASM chat lane? */
  private canUseCpuChatLane(): boolean {
    const s = getDeviceSettings()
    if (s.mode !== 'auto' && s.mode !== 'gpu-preferred' && s.mode !== 'cpu-only') return false
    if (!getConsent()?.granted) return false
    const runtimes = currentRuntimeAvailability()
    const entry = getDefaultModelRegistry().getEntry(CHAT_CPU_MODEL_ID)
    if (!entry) return false
    const snapshot = getClientCompute().getSnapshot()
    if (!runtimes.wasmBinary || snapshot?.wasm.supported !== true || snapshot.workers !== true) return false
    return this.fitsMemoryBudget(entry).fits
  }

  /** M39 §B: honest context-length adaptation from the SAME policy budget
   *  that gated the model — constrained devices get a smaller context, not
   *  a crashed heap. */
  private cpuChatContextLength(): number {
    const budget = this.estimateSafeModelMemoryBudgetMb() ?? 1024
    if (budget >= 2048) return 2048
    if (budget >= 1536) return 1536
    return 1024
  }

  /** CPU/WASM chat lane load (heavy slot + verified artifact + runtime). */
  private async ensureCpuChatReady(
    options: { onProgress?: (p: { note: string; progress: number | null }) => void; signal?: AbortSignal; approval?: boolean } = {},
    degradedNote?: string,
  ): Promise<{ modelId: string; target: 'client-cpu' }> {
    const slot = await this.acquireDeviceHeavySlot(CHAT_CPU_MODEL_ID)
    if (!slot.ok) {
      const error = new AiErrorImpl('AI_RUNTIME_UNAVAILABLE', slot.reason)
      this.recordFailure('chat.on-device', error)
      throw error
    }
    this.clearFailure('chat.on-device')
    this.setTransientStatus('chat.on-device', 'downloading')
    try {
      const blob = await this.loadVerifiedChatArtifact(CHAT_CPU_MODEL_ID, options.approval === true, options)
      this.setTransientStatus('chat.on-device', 'loading')
      const { getSharedWasmChatClient } = await this.importWasm()
      const modelId = await getSharedWasmChatClient().load(CHAT_CPU_MODEL_ID, blob, {
        nCtx: this.cpuChatContextLength(),
        onProgress: options.onProgress,
        signal: options.signal,
      })
      this.setTransientStatus('chat.on-device', null)
      wasmChatResidency.current = modelId
      if (degradedNote) {
        // Record the honest degradation so the capability view can state it.
        this.recordFailure('chat.on-device', new AiErrorImpl('AI_RUNTIME_UNAVAILABLE', degradedNote))
        this.clearFailure('chat.on-device')
      }
      return { modelId, target: 'client-cpu' }
    } catch (error) {
      this.setTransientStatus('chat.on-device', null)
      this.releaseDeviceHeavySlot(CHAT_CPU_MODEL_ID)
      throw this.recordFailure('chat.on-device', error)
    }
  }

  /** Registry-backed verified artifact (download with the caller's explicit
   *  approval → SHA-256 gate → cached bytes). Never a raw upstream fetch. */
  private async loadVerifiedChatArtifact(
    modelId: string,
    approval: boolean,
    options: { onProgress?: (p: { note: string; progress: number | null }) => void; signal?: AbortSignal } = {},
  ): Promise<Blob> {
    if (chatClientSeams.artifact) return chatClientSeams.artifact(modelId, approval, options)
    const { getDefaultModelRegistry } = await import('../model-registry')
    const registry = getDefaultModelRegistry()
    const install = await registry.getInstallState(modelId)
    if (!install.installed) {
      const result = await registry.requestDownload(modelId, {
        approval,
        signal: options.signal,
        onProgress: (fraction, note) => options.onProgress?.({ note: note ?? 'downloading model', progress: fraction ?? null }),
      })
      if (!result.ok) {
        const code = result.code === 'FETCH_ABORTED'
          ? 'AI_MODEL_DOWNLOAD_CANCELLED'
          : result.code === 'STORAGE_INSUFFICIENT'
            ? 'AI_STORAGE_INSUFFICIENT'
            : 'AI_MODEL_DOWNLOAD_FAILED'
        throw new AiErrorImpl(code, result.reason)
      }
    }
    const bytes = await registry.getArtifact(modelId)
    if (!bytes) {
      throw new AiErrorImpl('AI_MODEL_NOT_INSTALLED', 'The verified artifact is not readable from the browser cache.')
    }
    // Uint8Array is a valid BlobPart at runtime (the view's own bytes are
    // used, no buffer copy); the cast satisfies the narrowed TS lib type.
    return new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' })
  }

  private importWebLlm(): Promise<{ getSharedWebLlmClient: () => WebLlmChatClient }> {
    if (chatClientSeams.webllm) return chatClientSeams.webllm()
    return import('./webllm-chat-client')
  }

  private importWasm(): Promise<{ getSharedWasmChatClient: () => WasmChatClient }> {
    if (chatClientSeams.wasm) return chatClientSeams.wasm()
    return import('./wasm-chat-client')
  }

  /** Stream one on-device chat turn. Resolves ONLY with real engine output.
   *  M39 §B: routes to whichever chat engine is ACTUALLY loaded (GPU or CPU
   *  lane) and reports the target honestly. */
  async streamOnDeviceChat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: { onDelta?: (delta: string) => void; signal?: AbortSignal; maxTokens?: number; temperature?: number } = {},
  ): Promise<{ text: string; finishReason: string; target: 'client-gpu' | 'client-cpu'; modelId: string }> {
    if (wasmChatResidency.current) {
      const { getSharedWasmChatClient } = await this.importWasm()
      try {
        const result = await getSharedWasmChatClient().streamChat(messages, options)
        this.clearFailure('chat.on-device')
        return { ...result, target: 'client-cpu', modelId: wasmChatResidency.current }
      } catch (error) {
        throw this.recordFailure('chat.on-device', error)
      }
    }
    if (webLlmResidency.current) {
      const { getSharedWebLlmClient } = await this.importWebLlm()
      try {
        const result = await getSharedWebLlmClient().streamChat(messages, options)
        this.clearFailure('chat.on-device')
        return { ...result, target: 'client-gpu', modelId: webLlmResidency.current }
      } catch (error) {
        throw this.recordFailure('chat.on-device', error)
      }
    }
    const decision = this.selectExecutionPath('chat.on-device')
    throw this.recordFailure('chat.on-device', new AiErrorImpl('AI_MODEL_NOT_INSTALLED', `The on-device model is not loaded. ${decision.reasons.join('; ')}`))
  }

  async interruptOnDeviceChat(): Promise<void> {
    if (wasmChatResidency.current) {
      await (await this.importWasm()).getSharedWasmChatClient().interruptLoad()
      return
    }
    await (await this.importWebLlm()).getSharedWebLlmClient().interruptLoad()
  }

  /** Unload the on-device model (frees VRAM/wasm heap; cached weights stay). */
  async unloadOnDeviceChat(): Promise<void> {
    if (wasmChatResidency.current) {
      await (await this.importWasm()).getSharedWasmChatClient().unload()
      wasmChatResidency.current = null
      this.releaseDeviceHeavySlot(CHAT_CPU_MODEL_ID)
    } else {
      await (await this.importWebLlm()).getSharedWebLlmClient().unload()
      webLlmResidency.current = null
      this.releaseDeviceHeavySlot(CHAT_MODEL_ID)
    }
    this.emit()
  }

  /**
   * M36-B — heavy-model slot reservation through the shared ResourceManager
   * (one heavy model at a time per device budget). Lazy import keeps this
   * module loadable in non-DOM tests.
   */
  private async acquireDeviceHeavySlot(modelId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const { getClientCompute } = await import('../index')
      return getClientCompute().resources.acquireHeavyModel(modelId)
    } catch {
      // No client-compute surface (tests / non-browser): do not block the lane.
      return { ok: true }
    }
  }

  private releaseDeviceHeavySlot(modelId: string): void {
    try {
      // Fire-and-forget dynamic import; release is synchronous on arrival.
      void import('../index').then(({ getClientCompute }) => {
        getClientCompute().resources.releaseHeavyModel(modelId)
      }).catch(() => {})
    } catch {
      /* non-DOM tests */
    }
  }

  // -------------------------------------------------------------------------
  // Browser ASR lane (Tier A, GANGZII live voice)
  // -------------------------------------------------------------------------

  async ensureBrowserAsrReady(
    options: { onProgress?: (p: { note: string; progress: number | null }) => void; signal?: AbortSignal } = {},
  ): Promise<string> {
    const decision = this.selectExecutionPath('audio.transcription.on-device')
    if (decision.target !== 'client-gpu' && decision.target !== 'client-cpu') {
      const error = new AiErrorImpl('AI_RUNTIME_UNAVAILABLE', decision.reasons.join('; '))
      this.recordFailure('audio.transcription.on-device', error)
      throw error
    }
    this.clearFailure('audio.transcription.on-device')
    this.setTransientStatus('audio.transcription.on-device', 'downloading')
    // M36-B — the ASR model is also a heavy model: reserve the same
    // one-heavy-model slot before loading (never compete with chat silently).
    const slot = await this.acquireDeviceHeavySlot(ASR_MODEL_ID)
    if (!slot.ok) {
      this.setTransientStatus('audio.transcription.on-device', null)
      const error = new AiErrorImpl('AI_RUNTIME_UNAVAILABLE', slot.reason)
      this.recordFailure('audio.transcription.on-device', error)
      throw error
    }
    const { getSharedBrowserAsrClient } = await import('./browser-asr-client')
    try {
      const model = await getSharedBrowserAsrClient().ensureLoaded(options)
      this.setTransientStatus('audio.transcription.on-device', null)
      return model
    } catch (error) {
      this.setTransientStatus('audio.transcription.on-device', null)
      this.releaseDeviceHeavySlot(ASR_MODEL_ID)
      throw this.recordFailure('audio.transcription.on-device', error)
    }
  }

  /** Transcribe one recording locally. Audio never leaves the device. */
  async transcribeLocally(
    blob: Blob,
    options: { language?: string; onProgress?: (p: { note: string; progress: number | null }) => void; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{ text: string; durationMs: number; target: 'client-gpu' | 'client-cpu' }> {
    const decision = this.selectExecutionPath('audio.transcription.on-device')
    if (decision.target !== 'client-gpu' && decision.target !== 'client-cpu') {
      throw new AiErrorImpl('AI_RUNTIME_UNAVAILABLE', decision.reasons.join('; '))
    }
    const { getSharedBrowserAsrClient } = await import('./browser-asr-client')
    try {
      const result = await getSharedBrowserAsrClient().transcribe(blob, options)
      this.clearFailure('audio.transcription.on-device')
      return { ...result, target: decision.target as 'client-gpu' | 'client-cpu' }
    } catch (error) {
      throw this.recordFailure('audio.transcription.on-device', error)
    }
  }

  // -------------------------------------------------------------------------
  // Local desktop engine lane (Tier B)
  // -------------------------------------------------------------------------

  /** Pair with a local llama.cpp server (measured probe; persists on success). */
  async pairLocalEngine(pairing: { host: LocalEnginePairing['host']; port: number; apiKey: string }): Promise<{ ok: true; model: string | null } | { ok: false; error: AiError }> {
    const { LocalEngineClient } = await import('@/lib/local-engine/llamacpp-client')
    const client = new LocalEngineClient()
    const candidate: LocalEnginePairing = { ...pairing, verifiedAt: null, reportedModel: null }
    const result = await client.pair(candidate)
    if (!result.ok) {
      this.localEngineReachable = false
      this.localEngineCheckedAt = new Date().toISOString()
      this.emit()
      return { ok: false, error: result.error }
    }
    const settings = setDeviceSettings({
      localEngine: {
        host: pairing.host,
        port: pairing.port,
        apiKey: pairing.apiKey,
        verifiedAt: new Date().toISOString(),
        reportedModel: result.serverModel,
      },
    })
    this.localEngineReachable = true
    this.localEngineCheckedAt = settings.localEngine?.verifiedAt ?? new Date().toISOString()
    this.localEngineModel = result.serverModel
    this.emit()
    return { ok: true, model: result.serverModel }
  }

  /** Re-measure reachability of the paired engine. */
  async verifyLocalEngine(): Promise<boolean> {
    const settings = getDeviceSettings()
    if (!settings.localEngine) {
      this.localEngineReachable = null
      this.emit()
      return false
    }
    const { LocalEngineClient } = await import('@/lib/local-engine/llamacpp-client')
    const result = await new LocalEngineClient().pair(settings.localEngine)
    this.localEngineReachable = result.ok
    this.localEngineCheckedAt = new Date().toISOString()
    if (result.ok) {
      this.localEngineModel = result.serverModel
      setDeviceSettings({
        localEngine: {
          ...settings.localEngine,
          verifiedAt: this.localEngineCheckedAt,
          reportedModel: result.serverModel,
        },
      })
    }
    this.emit()
    return result.ok
  }

  /** Unpair (deletes the stored pairing key with it). */
  unpairLocalEngine(): void {
    setDeviceSettings({ localEngine: null })
    this.localEngineReachable = null
    this.localEngineModel = null
    this.emit()
  }

  /** Stream one chat turn through the paired local engine. */
  async streamLocalEngineChat(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: { onDelta?: (delta: string) => void; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{ text: string; finishReason: string | null; target: 'local-engine'; modelId: string | null }> {
    const settings = getDeviceSettings()
    if (!settings.localEngine) throw new AiErrorImpl('AI_LOCAL_ENGINE_INVALID_CONFIG')
    const { getDefaultLocalEngineClient } = await import('@/lib/local-engine/llamacpp-client')
    try {
      const result = await getDefaultLocalEngineClient().streamChat(settings.localEngine, messages, options)
      this.localEngineReachable = true
      this.localEngineCheckedAt = new Date().toISOString()
      this.clearFailure('chat.local-engine')
      return { ...result, target: 'local-engine', modelId: this.localEngineModel ?? settings.localEngine.reportedModel }
    } catch (error) {
      throw this.recordFailure('chat.local-engine', error)
    }
  }

  dispose(): void {
    this.unsubscribeSettings?.()
    this.unsubscribeSettings = null
    this.listeners.clear()
  }
}

function tierLabelOf(tier: number): string {
  const labels = ['Unsupported client compute', 'Basic CPU/WASM', 'WebGL or limited WebGPU', 'Capable WebGPU device', 'High-capability WebGPU device']
  return labels[tier] ?? 'undetected'
}

function getSharedChatModelResidency(): string | null {
  // Synchronous residency read without importing the worker bundle: the
  // client module records the loaded id on the singleton class instance.
  return (webLlmResidency as { current: string | null }).current ?? (wasmChatResidency as { current: string | null }).current
}

/** Sync mirror of the WebLLM residency (set by the client after load). */
export const webLlmResidency: { current: string | null } = { current: null }
/** M39 §B: sync mirror of the CPU/WASM chat residency. */
export const wasmChatResidency: { current: string | null } = { current: null }

let singleton: DeviceCapabilityManager | null = null
/** The shared manager instance (one per tab). */
export function getDeviceCapabilityManager(): DeviceCapabilityManager {
  if (!singleton) singleton = new DeviceCapabilityManager()
  return singleton
}
