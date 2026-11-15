/**
 * BEAN Intelligence — client compute: memory and resource management
 * (Phase 7 — "this phase is essential").
 *
 * Rules implemented:
 *  - ONE active heavy model per resource budget by default (heavy model slot).
 *  - Configurable task concurrency (the scheduler consults these caps).
 *  - Registration of every resource type (GPU buffers via the GPU engine,
 *    workers via the CPU engine, cached models via the registry) so cleanup
 *    is always possible in one call.
 *  - Automatic cleanup hooks on page shutdown (pagehide) and honest handling
 *    of tab suspension (visibilitychange is recorded; no hidden work happens
 *    while hidden — tasks are simply not started while the tab is hidden).
 *  - Conservative defaults for mobile/conservative devices.
 *  - Device GPU resources are never held in the background: the GPU engine
 *    destroys the device when the last task completes (no continuous GPU
 *    reservation).
 *
 * Client-safe: no Node-only imports.
 */
import type { ResourceClass } from './types'

export interface ResourceManagerOptions {
  /** Max concurrent device tasks (default 2; conservative mode 1). */
  maxConcurrentDeviceTasks?: number
  /** Whether the device is in conservative mode (mobile/low memory). */
  conservative?: boolean
}

/** Policy memory budget per resource class, in MB. These are BEAN policy
 * caps (what we are willing to allocate), NOT measurements of the device. */
const MEMORY_BUDGET_MB: Record<ResourceClass, number> = {
  light: 64,
  medium: 256,
  heavy: 1024,
}

const CONSERVATIVE_MEMORY_BUDGET_MB: Record<ResourceClass, number> = {
  light: 32,
  medium: 96,
  heavy: 384,
}

export class ResourceManager {
  private maxConcurrent = 2
  private conservative = false
  private activeTasks = 0
  private activeHeavyModel: string | null = null
  private readonly cleanupHooks: Array<() => void> = []
  private pageLifecycleAttached = false
  private lastNote: string | null = null

  constructor(options: ResourceManagerOptions = {}) {
    this.configure(options)
  }

  /** (Re)configure caps — used when the device profile changes after a
   * refresh (e.g. conservative mode detected later). */
  configure(options: ResourceManagerOptions): void {
    this.conservative = options.conservative === true
    this.maxConcurrent = Math.max(1, options.maxConcurrentDeviceTasks ?? (this.conservative ? 1 : 2))
  }

  /** Attach page-lifecycle cleanup (call once from the browser entry). */
  attachPageLifecycle(): void {
    if (this.pageLifecycleAttached || typeof window === 'undefined') return
    this.pageLifecycleAttached = true
    const onPageHide = () => {
      // Any active device task is cancelled and resources released — no
      // compute continues after the page is gone.
      this.releaseAll('page hidden')
    }
    window.addEventListener('pagehide', onPageHide, { once: true })
    this.cleanupHooks.push(() => window.removeEventListener('pagehide', onPageHide))
  }

  /** Admission gate: can another device task start now? */
  canStartDeviceTask(): { allowed: boolean; reason?: string } {
    if (this.activeTasks >= this.maxConcurrent) {
      return { allowed: false, reason: `Concurrency cap reached (${this.maxConcurrent} device task${this.maxConcurrent === 1 ? '' : 's'} at a time).` }
    }
    return { allowed: true }
  }

  onDeviceTaskStart(): void {
    this.activeTasks += 1
  }

  onDeviceTaskEnd(): void {
    this.activeTasks = Math.max(0, this.activeTasks - 1)
  }

  /** Memory budget policy for a resource class (labeled as policy, not fact). */
  memoryBudgetMb(resourceClass: ResourceClass): number {
    return (this.conservative ? CONSERVATIVE_MEMORY_BUDGET_MB : MEMORY_BUDGET_MB)[resourceClass]
  }

  /** Heavy-model slot: only ONE heavy model is active per budget. */
  acquireHeavyModel(modelId: string): { ok: true } | { ok: false; reason: string } {
    if (this.activeHeavyModel !== null && this.activeHeavyModel !== modelId) {
      return { ok: false, reason: `Another heavy model (${this.activeHeavyModel}) is active; only one heavy model runs at a time.` }
    }
    this.activeHeavyModel = modelId
    return { ok: true }
  }

  releaseHeavyModel(modelId: string): void {
    if (this.activeHeavyModel === modelId) this.activeHeavyModel = null
  }

  getActiveHeavyModel(): string | null {
    return this.activeHeavyModel
  }

  /** Register an extra cleanup hook (custom resources). */
  registerCleanup(hook: () => void): void {
    this.cleanupHooks.push(hook)
  }

  /** Whether task START should be deferred because the tab is hidden. */
  shouldDeferForVisibility(): boolean {
    try {
      if (typeof document === 'undefined') return false
      return document.visibilityState === 'hidden'
    } catch {
      return false
    }
  }

  setNote(note: string | null): void {
    this.lastNote = note
  }

  getLastNote(): string | null {
    return this.lastNote
  }

  /** Release every registered resource (idempotent). */
  releaseAll(reason?: string): void {
    for (const hook of this.cleanupHooks.splice(0)) {
      try {
        hook()
      } catch {
        /* cleanup failures are not actionable */
      }
    }
    this.activeTasks = 0
    this.activeHeavyModel = null
    this.pageLifecycleAttached = false
    if (reason) this.lastNote = `resources released (${reason})`
  }

  getConcurrencyCap(): number {
    return this.maxConcurrent
  }

  isConservative(): boolean {
    return this.conservative
  }
}
