/**
 * BEAN Intelligence — shared client-first hybrid compute engine: core contracts.
 *
 * This module defines the typed seam shared by every BEAN product adapter that
 * wants to run supported workloads on the VISITOR'S OWN hardware (WebGPU,
 * WebGL, WebAssembly + Web Workers) before falling back to BEAN local workers
 * or the existing authorized backend providers.
 *
 * Design rules (from docs/BEAN-CLIENT-COMPUTE-AUDIT.md):
 *  - Additive only: nothing here replaces or bypasses any existing server
 *    pipeline. Backend execution targets delegate to the products' existing
 *    authenticated routes; the server remains authoritative.
 *  - Honesty: browsers do not expose exact VRAM, free RAM or GPU models. Every
 *    value in this file is either really measured, a clearly-labeled policy
 *    default, or null. `hardwareConcurrency` is reported verbatim but is NEVER
 *    treated as a CPU performance measure.
 *  - Privacy: a task marked `local-only` can NEVER be routed to a backend,
 *    regardless of scheduler policy or failure handling.
 *  - This module must stay importable from client components: no Node-only
 *    imports (no fs, no child_process, no node:crypto), no Prisma, no
 *    server-only modules.
 */

/** Product id as used by the BEAN registry (kept as `string` so future
 * products — BEAN FX, BEAN Folio — can attach without engine changes). */
export type ComputeProductId = string

/** Device capability tiers. Derived ONLY from real capability checks and
 * optional conservative benchmarks — never from user-agent strings. */
export type ClientComputeTier = 0 | 1 | 2 | 3 | 4

export const TIER_LABELS: Record<ClientComputeTier, string> = {
  0: 'Unsupported client compute',
  1: 'Basic CPU/WASM',
  2: 'WebGL or limited WebGPU',
  3: 'Capable WebGPU device',
  4: 'High-capability WebGPU device',
}

/** Where a task may execute, in default fallback order. */
export type ExecutionTarget = 'client-gpu' | 'client-cpu' | 'local-worker' | 'backend'

/** Default execution priority. The scheduler still applies workload-specific
 * feasibility gates — an unsupported large workload is never pushed to CPU
 * merely to honor this order, and existing product-specific backend policies
 * remain authoritative. */
export const DEFAULT_TARGET_ORDER: readonly ExecutionTarget[] = [
  'client-gpu',
  'client-cpu',
  'local-worker',
  'backend',
] as const

/** Privacy classification of a task. */
export type PrivacyClass =
  /** Must never leave the device. Backend fallback is forbidden. */
  | 'local-only'
  /** Device execution preferred; backend fallback allowed by policy. */
  | 'device-preferred'
  /** No device preference; scheduler picks the feasible target. */
  | 'backend-preferred'

/** Coarse workload resource class used for admission control. These are
 * policy labels, not measured device facts. */
export type ResourceClass = 'light' | 'medium' | 'heavy'

/** Honest execution states (spec Phase 11 — every outcome is reportable and
 * nothing is ever shown as completed without passing output validation). */
export type ComputeTaskState =
  | 'CLIENT_GPU_AVAILABLE'
  | 'CLIENT_CPU_AVAILABLE'
  | 'CLIENT_MODEL_NOT_INSTALLED'
  | 'CLIENT_MODEL_DOWNLOADING'
  | 'CLIENT_MODEL_UNSUPPORTED'
  | 'CLIENT_MEMORY_INSUFFICIENT'
  | 'CLIENT_GPU_DEVICE_LOST'
  | 'CLIENT_EXECUTION_FAILED'
  | 'BACKEND_FALLBACK_AVAILABLE'
  | 'BACKEND_FALLBACK_RUNNING'
  | 'NO_SUPPORTED_EXECUTION_PATH'

/** Task lifecycle phases, separate from the honest execution state above. */
export type TaskPhase =
  | 'queued'
  | 'planning'
  | 'downloading'
  | 'running'
  | 'validating'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** What a task needs from the device to be feasible on a given target. */
export interface CapabilityRequirement {
  webgpu?: boolean
  webgl?: boolean
  wasm?: boolean
  workers?: boolean
  minTier?: ClientComputeTier
}

/** Per-target feasibility gate for a task kind. Adapters register these so
 * the scheduler never routes a workload to a target that cannot honor it. */
export interface WorkloadFeasibility {
  /** Can this workload run on the GPU target at all? */
  gpuSupported: boolean
  /** Can this workload run on the CPU/WASM target at all? */
  cpuSupported: boolean
  /** Client model id required, if any (checked against the model registry). */
  requiredModelId?: string
  /** Rough working-memory need in MB (policy estimate, adapter-declared). */
  estimatedMemoryMb?: number
}

/** Fallback routing policy. */
export interface FallbackPolicy {
  /** Ordered targets to try. Default: DEFAULT_TARGET_ORDER. */
  order?: ExecutionTarget[]
  /** Whether backend fallback is allowed at all (default true). A
   * `local-only` privacy class overrides this to false unconditionally. */
  allowBackendFallback?: boolean
}

/** Progress event. Fractions are [0, 1]; notes are safe, non-sensitive text
 * (no raw media, no raw prompts — adapters must not embed payloads here). */
export interface ProgressEvent {
  taskId: string
  fraction: number
  note?: string
  at: number
}

/** The registration contract for a compute task (spec Phase 6). */
export interface ComputeTaskDescriptor<TInput = unknown, TOutput = unknown> {
  /** Unique task id (generated by the scheduler when omitted). */
  id?: string
  /** Owning product adapter id (e.g. 'laxii', 'code-giftz', 'jazmii'). */
  productId: ComputeProductId
  /** Task kind — adapters register kind-specific handlers + validators. */
  kind: string
  /** Task input reference (for device-local tasks this is the payload;
   * adapters must keep large payloads out of diagnostics). */
  input: TInput
  /** Minimum device capabilities required for CLIENT targets. */
  requiredCapabilities?: CapabilityRequirement
  /** Workload feasibility facts (which targets can honor this kind). */
  feasibility?: WorkloadFeasibility
  /** Coarse resource class for admission control (default 'light'). */
  resourceClass?: ResourceClass
  /** Privacy classification (default 'device-preferred'). */
  privacy?: PrivacyClass
  /** Wall-clock timeout for device execution (default per resource class). */
  timeoutMs?: number
  /** Higher runs first within the same concurrency slot. */
  priority?: number
  /** Fallback policy override. */
  fallbackPolicy?: FallbackPolicy
  /** External cancellation signal. */
  signal?: AbortSignal
  /** Expected output validator id (registered per kind). */
  outputValidator?: string
}

export interface ComputeTaskOutput<TOutput = unknown> {
  taskId: string
  phase: 'completed' | 'failed' | 'cancelled'
  /** Target that produced the output (absent when nothing executed). */
  target?: ExecutionTarget
  /** Execution state — honest, even for failures. */
  state: ComputeTaskState
  /** Customer-safe reason (never contains payloads or internal details). */
  reason?: string
  /** Validated output (present only when phase === 'completed'). */
  output?: TOutput
  /** Whether the output passed the registered validator. */
  outputValidated: boolean
  /** Measured wall-clock duration of the execution attempt (ms), if any. */
  durationMs?: number
  /** Failed-target attempts, for honest diagnostics (states + reasons only). */
  attempts?: Array<{ target: ExecutionTarget; state: ComputeTaskState; reason?: string }>
}

/** Handler executed on a selected target. Receives bounded helpers — the
 * handler itself is responsible for progress reporting and cleanup.
 * Handlers are FIRST-PARTY code: any error they throw is treated as a
 * customer-safe message (never embed payloads); unknown/untyped errors fall
 * back to the generic mapped reason. */
export interface TargetHandler<TInput = unknown, TOutput = unknown> {
  (ctx: {
    input: TInput
    signal: AbortSignal
    reportProgress: (fraction: number, note?: string) => void
  }): Promise<TOutput>
}

/** Registered per-kind executable. Kinds are stored with erased payload
 * types; each handler validates its input shape at runtime. */
export interface RegisteredTaskKind<TInput = unknown, TOutput = unknown> {
  kind: string
  productId: ComputeProductId
  /** Preferred target order for this kind (must be a subset of DEFAULT_TARGET_ORDER). */
  preferredOrder?: ExecutionTarget[]
  /** Handlers per target. A kind with no handler for a target is not
   * feasible on it — this drives the feasibility gate. */
  handlers: Partial<Record<ExecutionTarget, TargetHandler<TInput, TOutput>>>
  feasibility?: WorkloadFeasibility
  /** Output validator (runs on every successful execution, any target). */
  validate?: (output: TOutput) => { valid: boolean; reason?: string }
  /** Default privacy class for the kind. */
  privacy?: PrivacyClass
  /** Default resource class for the kind. */
  resourceClass?: ResourceClass
  /** Default timeout for the kind (ms). */
  timeoutMs?: number
}

/** Measured browser capability snapshot (spec Phase 2). Every field is a
 * real check result or null — nothing is invented. */
export interface CapabilitySnapshot {
  /** 'browser' when a DOM environment is present; 'non-browser' otherwise
   * (SSR/tests) — detection always succeeds, honestly. */
  environment: 'browser' | 'non-browser'
  secureContext: boolean
  webgpu: {
    supported: boolean
    /** Adapter obtained via a REAL requestAdapter() probe. */
    adapterAvailable: boolean
    /** Feature names actually reported by the adapter (may be empty). */
    features: string[]
    /** Selected device limits actually reported by the adapter (may be null). */
    limits: Record<string, number> | null
    /** isFallbackAdapter, when the adapter reports one. */
    fallbackAdapter: boolean | null
  }
  webgl: {
    webgl2: boolean
    webgl1: boolean
    /** MAX_TEXTURE_SIZE actually reported by the context, or null. */
    maxTextureSize: number | null
  }
  wasm: {
    supported: boolean
    /** Measured by compiling a real SIMD-bearing wasm module; null if untested. */
    simd: boolean | null
  }
  workers: boolean
  offscreenCanvas: boolean
  /** Requires cross-origin isolation; false unless BOTH hold. */
  sharedArrayBuffer: boolean
  crossOriginIsolated: boolean
  /** navigator.hardwareConcurrency, reported verbatim; never a performance
   * measure and never used alone to pick a tier. */
  hardwareConcurrency: number | null
  /** navigator.deviceMemory (Chromium-only, coarse bucket in GB) if exposed. */
  deviceMemoryGb: number | null
  /** navigator.storage.estimate() when available; null otherwise. */
  storage: { quotaBytes: number | null; usageBytes: number | null; persisted: boolean | null } | null
  /** Browser family — display-level fact, never used for capability decisions. */
  browser: { family: string; mobileHint: boolean }
  detectedAt: number
}

/** Conservative, opt-in micro-benchmark result (spec Phase 2: tiers must come
 * from real checks and conservative benchmarks, not user-agent assumptions). */
export interface BenchmarkResult {
  /** Measured throughput label of the bounded CPU micro-benchmark. */
  cpuOpsPerSec: number | null
  /** WebGPU compute round-trip completed? (Only meaningful on real hardware.) */
  gpuComputeOk: boolean | null
  /** Measured benchmark wall-clock budget actually consumed (ms). */
  durationMs: number
  ranAt: number
}

export interface DeviceProfile {
  tier: ClientComputeTier
  /** Honest derivation trail — each reason cites the real check it used. */
  tierReasons: string[]
  /** Conservative mode: mobile-class signals or low memory buckets. When
   * true, the scheduler applies stricter concurrency/memory defaults. */
  conservative: boolean
  /** Benchmark result if one was run (null = none run). */
  benchmark: BenchmarkResult | null
  derivedAt: number
}

/** Explicit user consent for client-side compute (spec Phase 8). */
export interface ClientComputeConsent {
  version: 1
  /** Explicit opt-in — no device compute without it. */
  granted: boolean
  /** Local-only mode: tasks must never be sent to a backend. */
  localOnly: boolean
  updatedAt: string
}

/** Storage keys used by the consent store (localStorage, versioned). */
export const CLIENT_COMPUTE_CONSENT_KEY = 'bean.clientCompute.consent.v1'

/** Sanitized capability report (spec Phase 13) — safe to send to the BEAN
 * backend. Deliberately excludes: vendor/architecture strings, user agents,
 * raw device model info, any task payload or prompt text. */
export interface CapabilityReport {
  tier: ClientComputeTier
  conservative: boolean
  webgpuSupported: boolean
  webgpuAdapterAvailable: boolean
  webgl2: boolean
  wasm: boolean
  workers: boolean
  offscreenCanvas: boolean
  sharedArrayBuffer: boolean
  secureContext: boolean
  hardwareConcurrency: number | null
  deviceMemoryGb: number | null
  storageQuotaBytes: number | null
  benchmark: { cpuOpsPerSec: number | null; gpuComputeOk: boolean | null; durationMs: number } | null
  /** Installed client model ids (verified only — never claimed before verification). */
  installedModels: string[]
  reportedAt: string
}

/** Adapter contract: a product plugs its kinds into the shared engine. */
export interface ProductComputeAdapter {
  productId: ComputeProductId
  /** Registered task kinds (the adapter owns handler implementations). */
  kinds: Array<RegisteredTaskKind<unknown, unknown>>
  /** Human-readable capability summary for status surfaces. */
  summary: string
}

/** Overall compute status for UI surfaces (spec Phase 13 — minimal, honest). */
export interface ComputeStatus {
  environment: CapabilitySnapshot['environment']
  tier: ClientComputeTier
  tierLabel: string
  conservative: boolean
  consent: ClientComputeConsent | null
  /** Which targets are currently usable given consent + capabilities. */
  usableTargets: ExecutionTarget[]
  /** Registered adapters and their kinds. */
  adapters: Array<{ productId: ComputeProductId; kinds: string[]; summary: string }>
  /** Heavy model slot occupancy (model id or null). */
  activeHeavyModel: string | null
  /** Honest last-error note for UI display, if any. */
  lastErrorNote?: string
}
