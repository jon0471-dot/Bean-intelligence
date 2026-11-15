/**
 * BEAN Intelligence — client compute: centralized task scheduler (Phase 6).
 *
 * Implements the 12-step scheduling process from the architecture spec:
 *   receive → validate → client-execution allowed? → inspect capabilities →
 *   check model/dependency availability → estimate workload feasibility →
 *   select best execution target → start → report progress → validate
 *   output → release resources → return honest result.
 *
 * Non-negotiable behaviors:
 *  - No device execution without explicit consent (privacy.ts gate).
 *  - `local-only` tasks can NEVER reach the backend; the local-only flag is
 *    re-read on every fallback decision.
 *  - Unsupported large workloads are never pushed to CPU merely to honor the
 *    fixed priority order — every target passes a feasibility gate first.
 *  - Duplicate tasks (same dedupe key, still active) are rejected.
 *  - A task is completed ONLY after its output passes the registered
 *    validator; every failure maps to one of the honest states.
 *  - Existing product backend policies remain authoritative: backend
 *    execution is a delegate to the product's own authenticated routes.
 *
 * Client-safe: no Node-only imports.
 */
import { CpuEngine, type CpuEngineDeps } from './cpu/engine'
import { backendFallbackAllowed, mapCpuErrorToState, mapGpuErrorToState } from './fallback'
import { getDefaultModelRegistry, type ModelRegistry } from './model-registry'
import { isDeviceComputeAllowed, isLocalOnlyMode } from './privacy'
import { ResourceManager } from './resource-manager'
import { logDiagnostic } from './telemetry'
import { validateOutput } from './validate'
import type {
  ComputeStatus,
  ComputeTaskDescriptor,
  ComputeTaskOutput,
  ComputeTaskState,
  DeviceProfile,
  ExecutionTarget,
  ProgressEvent,
  RegisteredTaskKind,
  CapabilitySnapshot,
  ResourceClass,
} from './types'
import { DEFAULT_TARGET_ORDER, TIER_LABELS } from './types'
import type { WebGpuEngine } from './webgpu/engine'

export interface BackendDelegate {
  (ctx: {
    input: unknown
    productId: string
    kind: string
    taskId: string
    signal: AbortSignal
    reportProgress: (fraction: number, note?: string) => void
  }): Promise<unknown>
}

export interface SchedulerDeps {
  capabilities: () => CapabilitySnapshot | Promise<CapabilitySnapshot>
  profile: () => DeviceProfile
  resources: ResourceManager
  gpu?: WebGpuEngine
  cpu?: CpuEngine
  registry?: ModelRegistry
  /** Backend delegates registered per product (delegate to the products'
   * existing authenticated routes; the server remains authoritative). */
  backendDelegates?: Map<string, BackendDelegate>
  now?: () => number
}

const DEFAULT_TIMEOUT_MS: Record<ResourceClass, number> = {
  light: 15_000,
  medium: 60_000,
  heavy: 180_000,
}

interface ScheduledRecord {
  descriptor: ComputeTaskDescriptor
  kind: RegisteredTaskKind<unknown, unknown>
  registeredAt: number
}

export interface ScheduleOptions {
  onProgress?: (event: ProgressEvent) => void
}

export class ComputeScheduler {
  private readonly kinds = new Map<string, RegisteredTaskKind<unknown, unknown>>()
  private readonly registered = new Map<string, ScheduledRecord>()
  private readonly activeKeys = new Map<string, string>()
  private readonly adapters = new Map<string, { kinds: string[]; summary: string }>()
  private readonly resources: ResourceManager
  private readonly capabilitiesFn: SchedulerDeps['capabilities']
  private readonly profileFn: SchedulerDeps['profile']
  private readonly gpu: WebGpuEngine | null
  private readonly cpu: CpuEngine
  private readonly registry: ModelRegistry
  private readonly backendDelegates: Map<string, BackendDelegate>
  private readonly now: () => number
  private lastErrorNote: string | null = null

  constructor(deps: SchedulerDeps) {
    this.capabilitiesFn = deps.capabilities
    this.profileFn = deps.profile
    this.resources = deps.resources
    this.gpu = deps.gpu ?? null
    this.cpu = deps.cpu ?? new CpuEngine({} as CpuEngineDeps)
    this.registry = deps.registry ?? getDefaultModelRegistry()
    this.backendDelegates = deps.backendDelegates ?? new Map()
    this.now = deps.now ?? (() => Date.now())
  }

  // ---- registration (steps 1–2 of the process) -----------------------------

  /** Register a task kind. Replaces any existing kind with the same id. */
  registerTaskKind(kind: RegisteredTaskKind<unknown, unknown>): void {
    if (!kind?.kind || typeof kind.kind !== 'string') throw new Error('Task kind id is required.')
    this.kinds.set(kind.kind, kind)
    const existing = this.adapters.get(kind.productId)
    if (existing) {
      if (!existing.kinds.includes(kind.kind)) existing.kinds.push(kind.kind)
    } else {
      this.adapters.set(kind.productId, { kinds: [kind.kind], summary: '' })
    }
  }

  /** Register a product adapter (registers all of its kinds). */
  registerProductAdapter(adapter: { productId: string; summary: string; kinds: Array<RegisteredTaskKind<unknown, unknown>> }): void {
    for (const kind of adapter.kinds) this.registerTaskKind(kind)
    const kinds = this.adapters.get(adapter.productId)?.kinds ?? adapter.kinds.map((k) => k.kind)
    this.adapters.set(adapter.productId, { kinds, summary: adapter.summary })
  }

  /** Register the backend delegate for a product (its own server routes). */
  registerBackendDelegate(productId: string, delegate: BackendDelegate): void {
    this.backendDelegates.set(productId, delegate)
  }

  /**
   * Register a task: validates the descriptor and stores it. Returns the
   * task id. Registration NEVER executes anything.
   */
  registerTask(descriptor: ComputeTaskDescriptor<unknown, unknown>): { ok: true; taskId: string } | { ok: false; reason: string } {
    if (!descriptor || typeof descriptor !== 'object') return { ok: false, reason: 'Task descriptor missing.' }
    if (typeof descriptor.productId !== 'string' || descriptor.productId.length === 0) {
      return { ok: false, reason: 'Task must declare its owning product.' }
    }
    if (typeof descriptor.kind !== 'string' || descriptor.kind.length === 0) {
      return { ok: false, reason: 'Task must declare a task kind.' }
    }
    const kind = this.kinds.get(descriptor.kind)
    if (!kind) return { ok: false, reason: `Unknown task kind "${descriptor.kind}".` }
    if (descriptor.productId !== kind.productId) {
      return { ok: false, reason: `Task kind "${descriptor.kind}" belongs to product "${kind.productId}".` }
    }
    const taskId = descriptor.id ?? `cc-task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    if (this.registered.has(taskId)) return { ok: false, reason: 'Task id already registered.' }
    this.registered.set(taskId, { descriptor: { ...descriptor, id: taskId }, kind, registeredAt: this.now() })
    return { ok: true, taskId }
  }

  // ---- scheduling (steps 3–12) ----------------------------------------------

  /** Execute a task by id (previously registered). */
  async scheduleTask(taskId: string, options: ScheduleOptions = {}): Promise<ComputeTaskOutput> {
    const record = this.registered.get(taskId)
    if (!record) {
      return this.failed(taskId, 'NO_SUPPORTED_EXECUTION_PATH', 'Task id was never registered (or was already consumed).')
    }
    this.registered.delete(taskId)
    return this.executeDescriptor(record.descriptor, record.kind, options)
  }

  /** Register + schedule in one call. */
  async runTask<TInput = unknown, TOutput = unknown>(
    descriptor: ComputeTaskDescriptor<TInput, TOutput>,
    options: ScheduleOptions = {},
  ): Promise<ComputeTaskOutput<TOutput>> {
    const reg = this.registerTask(descriptor as ComputeTaskDescriptor<unknown, unknown>)
    if (!reg.ok) return this.failed('', 'NO_SUPPORTED_EXECUTION_PATH', reg.reason) as unknown as ComputeTaskOutput<TOutput>
    return (await this.scheduleTask(reg.taskId, options)) as unknown as ComputeTaskOutput<TOutput>
  }

  private async executeDescriptor(
    descriptor: ComputeTaskDescriptor,
    kind: RegisteredTaskKind<unknown, unknown>,
    options: ScheduleOptions,
  ): Promise<ComputeTaskOutput> {
    const taskId = descriptor.id ?? ''
    const started = this.now()
    const attempts: Array<{ target: ExecutionTarget; state: ComputeTaskState; reason?: string }> = []
    const reportProgress = (fraction: number, note?: string) => {
      const event: ProgressEvent = { taskId, fraction: Math.min(1, Math.max(0, fraction)), note, at: Date.now() }
      logDiagnostic('info', 'scheduler', `task ${taskId} progress ${Math.round(event.fraction * 100)}% ${note ?? ''}`)
      try {
        options.onProgress?.(event)
      } catch {
        /* observer errors must not affect execution */
      }
    }

    // Duplicate prevention.
    const dedupeKey = `${descriptor.productId}:${descriptor.kind}`
    if (this.activeKeys.has(dedupeKey)) {
      return this.failed(taskId, 'NO_SUPPORTED_EXECUTION_PATH', 'An identical task is already running.')
    }
    this.activeKeys.set(dedupeKey, taskId)
    try {
      // Step 3: is client execution allowed? (consent + visibility)
      const consentAllowsDevice = isDeviceComputeAllowed()
      const privacy = descriptor.privacy ?? kind.privacy ?? 'device-preferred'
      const localOnly = privacy === 'local-only' || isLocalOnlyMode()

      // Step 4: capabilities + profile (real snapshot).
      let snapshot: CapabilitySnapshot
      try {
        snapshot = await this.capabilitiesFn()
      } catch (error) {
        logDiagnostic('error', 'scheduler', `capability detection failed: ${error instanceof Error ? error.message : 'unknown'}`)
        snapshot = await this.capabilitiesFn()
      }
      const profile = this.profileFn()

      // Step 5: model / dependency availability for client targets.
      const feasibility = descriptor.feasibility ?? kind.feasibility
      let modelGate: { ok: true } | { ok: false; state: ComputeTaskState; reason: string } = { ok: true }
      if (feasibility?.requiredModelId) {
        const entry = this.registry.getEntry(feasibility.requiredModelId)
        if (!entry) {
          modelGate = { ok: false, state: 'CLIENT_MODEL_UNSUPPORTED', reason: 'Required model is not in the registry.' }
        } else if (!entry.runtimeAvailable()) {
          modelGate = { ok: false, state: 'CLIENT_MODEL_UNSUPPORTED', reason: `The "${entry.runtime}" runtime is not available in this app.` }
        } else {
          const install = await this.registry.getInstallState(feasibility.requiredModelId)
          if (!install.installed) {
            modelGate = { ok: false, state: 'CLIENT_MODEL_NOT_INSTALLED', reason: install.reason }
          }
        }
      }

      // Step 6: workload feasibility (memory class + admission + visibility).
      const resourceClass: ResourceClass = descriptor.resourceClass ?? kind.resourceClass ?? 'light'
      const memoryGate = (() => {
        const estimate = feasibility?.estimatedMemoryMb
        if (estimate === undefined) return { ok: true as const }
        const budget = this.resources.memoryBudgetMb(resourceClass)
        if (estimate > budget) {
          return { ok: false as const, state: 'CLIENT_MEMORY_INSUFFICIENT' as ComputeTaskState, reason: `This workload needs ~${estimate} MB; the ${this.resources.isConservative() ? 'conservative ' : ''}policy budget is ${budget} MB.` }
        }
        return { ok: true as const }
      })()
      const admissionGate = this.resources.canStartDeviceTask()
      const visibilityDeferred = this.resources.shouldDeferForVisibility()

      // Step 7: target selection — every candidate passes ALL gates.
      const policyOrder = descriptor.fallbackPolicy?.order ?? kind.preferredOrder ?? [...DEFAULT_TARGET_ORDER]
      const orderedTargets = orderedIntersection(DEFAULT_TARGET_ORDER, policyOrder)
      const plan: Array<{ target: ExecutionTarget; gateState: ComputeTaskState; gateReason: string }> = []

      for (const target of orderedTargets) {
        if (target === 'client-gpu' || target === 'client-cpu') {
          if (!consentAllowsDevice) {
            plan.push({ target, gateState: 'NO_SUPPORTED_EXECUTION_PATH', gateReason: 'Client-side compute requires your explicit consent; it was not given.' })
            continue
          }
          if (visibilityDeferred) {
            plan.push({ target, gateState: 'CLIENT_EXECUTION_FAILED', gateReason: 'The task was not started because the tab is hidden.' })
            continue
          }
          if (admissionGate.allowed === false) {
            plan.push({ target, gateState: 'CLIENT_MEMORY_INSUFFICIENT', gateReason: admissionGate.reason ?? 'Device task admission refused.' })
            continue
          }
          if (target === 'client-gpu') {
            if (feasibility?.gpuSupported !== true) {
              plan.push({ target, gateState: 'CLIENT_MODEL_UNSUPPORTED', gateReason: 'This workload is not supported on the GPU lane.' })
              continue
            }
            if (descriptor.requiredCapabilities?.webgpu === true && !snapshot.webgpu.adapterAvailable) {
              plan.push({ target, gateState: 'NO_SUPPORTED_EXECUTION_PATH', gateReason: 'WebGPU adapter is not available.' })
              continue
            }
            const capTier = descriptor.requiredCapabilities?.minTier
            if (capTier !== undefined && profile.tier < capTier) {
              plan.push({ target, gateState: 'NO_SUPPORTED_EXECUTION_PATH', gateReason: `Device tier (${profile.tier}) is below the required tier (${capTier}).` })
              continue
            }
            if (modelGate.ok === false) {
              plan.push({ target, gateState: modelGate.state, gateReason: modelGate.reason })
              continue
            }
            if (memoryGate.ok === false) {
              plan.push({ target, gateState: memoryGate.state, gateReason: memoryGate.reason })
              continue
            }
            if (!kind.handlers[target]) {
              plan.push({ target, gateState: 'NO_SUPPORTED_EXECUTION_PATH', gateReason: `No ${target} handler is registered for "${descriptor.kind}".` })
              continue
            }
            plan.push({ target, gateState: 'CLIENT_GPU_AVAILABLE', gateReason: 'GPU lane selected.' })
          } else {
            if (feasibility?.cpuSupported !== true) {
              plan.push({ target, gateState: 'CLIENT_MODEL_UNSUPPORTED', gateReason: 'This workload is not supported on the CPU lane.' })
              continue
            }
            if (descriptor.requiredCapabilities?.wasm === true && !snapshot.wasm.supported) {
              plan.push({ target, gateState: 'NO_SUPPORTED_EXECUTION_PATH', gateReason: 'WebAssembly is not available in this browser.' })
              continue
            }
            if (descriptor.requiredCapabilities?.workers === true && !snapshot.workers) {
              plan.push({ target, gateState: 'NO_SUPPORTED_EXECUTION_PATH', gateReason: 'Web Workers are not available in this browser.' })
              continue
            }
            const capTier = descriptor.requiredCapabilities?.minTier
            if (capTier !== undefined && profile.tier < capTier) {
              plan.push({ target, gateState: 'NO_SUPPORTED_EXECUTION_PATH', gateReason: `Device tier (${profile.tier}) is below the required tier (${capTier}).` })
              continue
            }
            if (modelGate.ok === false) {
              plan.push({ target, gateState: modelGate.state, gateReason: modelGate.reason })
              continue
            }
            if (memoryGate.ok === false) {
              plan.push({ target, gateState: memoryGate.state, gateReason: memoryGate.reason })
              continue
            }
            if (!kind.handlers[target]) {
              plan.push({ target, gateState: 'NO_SUPPORTED_EXECUTION_PATH', gateReason: `No ${target} handler is registered for "${descriptor.kind}".` })
              continue
            }
            plan.push({ target, gateState: 'CLIENT_CPU_AVAILABLE', gateReason: snapshot.workers ? 'CPU/Worker lane selected.' : 'CPU main-thread lane selected (Workers unavailable — light task only).' })
          }
        } else if (target === 'local-worker') {
          // Phase 12 bridge is an INVESTIGATION item this milestone: honest
          // refusal until an authenticated loopback bridge is configured.
          plan.push({ target, gateState: 'NO_SUPPORTED_EXECUTION_PATH', gateReason: 'The local worker bridge is not configured on this device.' })
        } else {
          // backend — the product's own server route remains authoritative.
          const allow = backendFallbackAllowed({
            privacy,
            fallbackPolicyAllowBackend: descriptor.fallbackPolicy?.allowBackendFallback,
            isLocalOnlyMode,
          })
          if (!allow.allowed) {
            plan.push({ target, gateState: 'NO_SUPPORTED_EXECUTION_PATH', gateReason: allow.reason ?? 'Backend fallback is not allowed for this task.' })
            continue
          }
          const delegate = this.backendDelegates.get(descriptor.productId)
          if (!delegate) {
            plan.push({ target, gateState: 'NO_SUPPORTED_EXECUTION_PATH', gateReason: `No backend delegate is registered for "${descriptor.productId}".` })
            continue
          }
          plan.push({ target, gateState: 'BACKEND_FALLBACK_RUNNING', gateReason: 'Backend execution path selected.' })
        }
      }

      // Step 8–10: execute in order, first success with valid output wins.
      for (const step of plan) {
        if (step.gateState !== 'CLIENT_GPU_AVAILABLE' && step.gateState !== 'CLIENT_CPU_AVAILABLE' && step.gateState !== 'BACKEND_FALLBACK_RUNNING') {
          attempts.push({ target: step.target, state: step.gateState, reason: step.gateReason })
          continue
        }
        const handler = step.target === 'backend' ? undefined : kind.handlers[step.target]
        const timeoutMs = descriptor.timeoutMs ?? kind.timeoutMs ?? DEFAULT_TIMEOUT_MS[resourceClass]
        const controller = new AbortController()
        const onAbort = () => controller.abort()
        if (descriptor.signal) {
          if (descriptor.signal.aborted) onAbort()
          else descriptor.signal.addEventListener('abort', onAbort, { once: true })
        }
        // The timeout is ENFORCED, not advisory: a handler that ignores the
        // abort signal still loses the race and the task fails honestly.
        let timedOutFlag = false
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null
        const deadline = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            timedOutFlag = true
            controller.abort()
            reject(new Error('execution exceeded the time budget'))
          }, timeoutMs)
          controller.signal.addEventListener(
            'abort',
            () => reject(new Error(timedOutFlag ? 'execution exceeded the time budget' : 'task cancelled')),
            { once: true },
          )
        })

        this.resources.onDeviceTaskStart()
        try {
          let output: unknown
          if (step.target === 'backend') {
            const delegate = this.backendDelegates.get(descriptor.productId)
            if (!delegate) {
              attempts.push({ target: step.target, state: 'NO_SUPPORTED_EXECUTION_PATH', reason: 'Backend delegate disappeared mid-schedule.' })
              continue
            }
            output = await Promise.race([
              delegate({
                input: descriptor.input,
                productId: descriptor.productId,
                kind: descriptor.kind,
                taskId,
                signal: controller.signal,
                reportProgress,
              }),
              deadline,
            ])
          } else {
            output = await Promise.race([
              handler!({ input: descriptor.input, signal: controller.signal, reportProgress }),
              deadline,
            ])
          }

          // Step 10: output validation — mandatory.
          const validation = kind.validate
            ? safeValidate(kind.validate, output)
            : validateOutput(descriptor.kind, output)
          if (!validation.valid) {
            attempts.push({ target: step.target, state: 'CLIENT_EXECUTION_FAILED', reason: validation.reason ?? 'Output failed validation.' })
            this.lastErrorNote = validation.reason ?? 'The result did not pass validation.'
            continue
          }

          return {
            taskId,
            phase: 'completed',
            target: step.target,
            state: step.gateState,
            output,
            outputValidated: true,
            durationMs: this.now() - started,
            attempts: attempts.length > 0 ? attempts : undefined,
          }
        } catch (error) {
          const aborted = descriptor.signal?.aborted === true || controller.signal.aborted
          const timedOut = timedOutFlag
          const mapped =
            step.target === 'client-gpu'
              ? mapGpuErrorToState(error)
              : step.target === 'client-cpu'
                ? mapCpuErrorToState(error)
                : { state: 'CLIENT_EXECUTION_FAILED' as ComputeTaskState, reason: 'Backend execution failed.' }
          const reason = timedOut
            ? 'The task exceeded its execution time budget.'
            : aborted
              ? 'The task was cancelled.'
              : error instanceof Error && error.message
                ? error.message // first-party handlers throw customer-safe messages
                : mapped.reason
          attempts.push({ target: step.target, state: mapped.state, reason })
          this.lastErrorNote = reason
          logDiagnostic('warn', 'scheduler', `task ${taskId} target ${step.target} failed: ${reason}`)
          if (aborted) break
        } finally {
          if (timeoutHandle !== null) clearTimeout(timeoutHandle)
          if (descriptor.signal) descriptor.signal.removeEventListener('abort', onAbort)
          this.resources.onDeviceTaskEnd()
        }
      }

      // Step 12: no target produced a validated output. The final state
      // prefers the most recent REAL execution failure over a trailing gate
      // refusal (e.g. "no backend delegate") so the honest cause surfaces.
      const realFailureStates = new Set<ComputeTaskState>([
        'CLIENT_EXECUTION_FAILED',
        'CLIENT_GPU_DEVICE_LOST',
        'CLIENT_MEMORY_INSUFFICIENT',
        'CLIENT_MODEL_UNSUPPORTED',
        'CLIENT_MODEL_NOT_INSTALLED',
      ])
      const lastReal = [...attempts].reverse().find((a) => realFailureStates.has(a.state))
      const last = lastReal ?? attempts[attempts.length - 1]
      return {
        taskId,
        phase: descriptor.signal?.aborted === true ? 'cancelled' : 'failed',
        state: last?.state ?? 'NO_SUPPORTED_EXECUTION_PATH',
        reason: last?.reason ?? 'No execution path could run this task.',
        outputValidated: false,
        durationMs: this.now() - started,
        attempts,
      }
    } finally {
      this.activeKeys.delete(dedupeKey)
    }
  }

  /** Aggregate status for UI surfaces (minimal, honest). */
  async getStatus(): Promise<ComputeStatus> {
    let snapshot: CapabilitySnapshot
    try {
      snapshot = await this.capabilitiesFn()
    } catch {
      snapshot = await this.capabilitiesFn()
    }
    const profile = this.profileFn()
    const consentAllowed = isDeviceComputeAllowed()
    const usableTargets: ExecutionTarget[] = []
    if (consentAllowed) {
      if (profile.tier >= 2 && (snapshot.webgpu.adapterAvailable || snapshot.webgl.webgl2 || snapshot.webgl.webgl1)) usableTargets.push('client-gpu')
      if (profile.tier >= 1) usableTargets.push('client-cpu')
    }
    usableTargets.push('backend')
    return {
      environment: snapshot.environment,
      tier: profile.tier,
      tierLabel: TIER_LABELS[profile.tier],
      conservative: profile.conservative,
      consent: null,
      usableTargets,
      adapters: [...this.adapters.entries()].map(([productId, v]) => ({ productId, kinds: v.kinds, summary: v.summary })),
      activeHeavyModel: this.resources.getActiveHeavyModel(),
      lastErrorNote: this.lastErrorNote ?? undefined,
    }
  }

  /** Note of the most recent failure (honest UI hint). */
  getLastErrorNote(): string | null {
    return this.lastErrorNote
  }

  private failed(taskId: string, state: ComputeTaskState, reason: string): ComputeTaskOutput {
    this.lastErrorNote = reason
    return { taskId, phase: 'failed', state, reason, outputValidated: false }
  }
}

function orderedIntersection(defaults: readonly ExecutionTarget[], requested: ExecutionTarget[]): ExecutionTarget[] {
  const set = new Set(requested)
  return defaults.filter((t) => set.has(t))
}

function safeValidate(validate: (output: unknown) => { valid: boolean; reason?: string }, output: unknown): { valid: boolean; reason?: string } {
  try {
    return validate(output)
  } catch (error) {
    return { valid: false, reason: `Output validator crashed: ${error instanceof Error ? error.message : 'unknown error'}` }
  }
}
