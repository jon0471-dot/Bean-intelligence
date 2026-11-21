/**
 * Client compute — scheduler contract tests.
 *
 * Pinned behaviors (spec Phase 6 + 8 + 11):
 *  - no device compute without explicit consent;
 *  - local-only tasks NEVER reach the backend (kind privacy OR consent mode);
 *  - duplicate tasks (same product+kind, still active) are rejected;
 *  - a task is completed ONLY after output validation passes;
 *  - enforced timeouts, honest cancellation, memory/concurrency admission;
 *  - honest model availability states (CLIENT_MODEL_UNSUPPORTED /
 *    CLIENT_MODEL_NOT_INSTALLED) surface before any handler would run.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { ComputeScheduler } from '@/lib/client-compute/scheduler'
import { CpuEngine } from '@/lib/client-compute/cpu/engine'
import { ResourceManager } from '@/lib/client-compute/resource-manager'
import { ModelRegistry, registerModelRuntime } from '@/lib/client-compute/model-registry'
import { setConsent } from '@/lib/client-compute/privacy'
import { deriveDeviceProfile } from '@/lib/client-compute/device-profile'
import { buildLaxiiKinds, SEGMENTATION_KIND } from '@/lib/client-compute/adapters/laxii'
import type { CapabilitySnapshot, DeviceProfile, RegisteredTaskKind, TargetHandler } from '@/lib/client-compute/types'

function snapshot(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    environment: 'browser',
    secureContext: true,
    webgpu: { supported: false, adapterAvailable: false, features: [], limits: null, fallbackAdapter: null },
    webgl: { webgl2: false, webgl1: false, maxTextureSize: null },
    wasm: { supported: true, simd: true },
    workers: true,
    offscreenCanvas: true,
    sharedArrayBuffer: false,
    crossOriginIsolated: false,
    hardwareConcurrency: 4,
    deviceMemoryGb: null,
    storage: null,
    browser: { family: 'Test', mobileHint: false },
    detectedAt: Date.now(),
    ...overrides,
  }
}

function profile(snap: CapabilitySnapshot): DeviceProfile {
  return deriveDeviceProfile(snap)
}

function makeScheduler(overrides: { resources?: ResourceManager; registry?: ModelRegistry } = {}) {
  const snap = snapshot()
  return new ComputeScheduler({
    capabilities: async () => snap,
    profile: () => profile(snap),
    resources: overrides.resources ?? new ResourceManager({ conservative: false }),
    cpu: new CpuEngine({ workerFactory: () => null }),
    registry: overrides.registry ?? new ModelRegistry({ cacheFactory: async () => null }),
  })
}

function cpuKind<TOut>(opts: {
  kind: string
  productId?: string
  handler: TargetHandler<unknown, TOut>
  validate?: (output: TOut) => { valid: boolean; reason?: string }
  privacy?: 'local-only' | 'device-preferred' | 'backend-preferred'
  feasibility?: { gpuSupported: boolean; cpuSupported: boolean; estimatedMemoryMb?: number; requiredModelId?: string }
  timeoutMs?: number
}): RegisteredTaskKind<unknown, unknown> {
  return {
    kind: opts.kind,
    productId: opts.productId ?? 'test-product',
    preferredOrder: ['client-cpu', 'backend'],
    handlers: { 'client-cpu': opts.handler as TargetHandler<unknown, unknown> },
    validate: opts.validate as ((output: unknown) => { valid: boolean; reason?: string }) | undefined,
    privacy: opts.privacy,
    feasibility: opts.feasibility ?? { gpuSupported: false, cpuSupported: true },
    timeoutMs: opts.timeoutMs,
  }
}

const originalDocument = (globalThis as Record<string, unknown>).document

afterEach(() => {
  ;(globalThis as Record<string, unknown>).document = originalDocument
})

describe('client-compute scheduler', () => {
  beforeEach(() => {
    setConsent(false, false)
  })

  test('no device compute without explicit consent (honest gate reason)', async () => {
    const scheduler = makeScheduler()
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.kind',
        handler: async () => ({ ok: true }),
        validate: () => ({ valid: true }),
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.kind', input: {} })
    expect(out.phase).toBe('failed')
    expect(out.target).toBeUndefined()
    expect(out.attempts?.length).toBeGreaterThan(0)
    expect(out.attempts?.every((a) => a.state === 'NO_SUPPORTED_EXECUTION_PATH')).toBe(true)
    expect(out.attempts?.[0].reason).toMatch(/consent/i)
  })

  test('consent granted: CPU handler runs, output validated, honest success state', async () => {
    setConsent(true, false)
    const scheduler = makeScheduler()
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.kind',
        handler: async ({ reportProgress }) => {
          reportProgress(0.5, 'halfway')
          return { value: 42 }
        },
        validate: (o) => ({ valid: (o as { value: number }).value === 42 }),
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.kind', input: {} })
    expect(out.phase).toBe('completed')
    expect(out.state).toBe('CLIENT_CPU_AVAILABLE')
    expect(out.target).toBe('client-cpu')
    expect(out.outputValidated).toBe(true)
    expect((out.output as { value: number }).value).toBe(42)
  })

  test('a handler result that fails validation is NEVER reported completed', async () => {
    setConsent(true, false)
    const scheduler = makeScheduler()
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.kind',
        handler: async () => ({ value: 41 }),
        validate: (o) => ({ valid: (o as { value: number }).value === 42, reason: 'wrong value' }),
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.kind', input: {} })
    expect(out.phase).toBe('failed')
    expect(out.outputValidated).toBe(false)
    expect(out.reason).toMatch(/wrong value/)
  })

  test('unvalidated kinds without a registered validator fail honestly (never auto-pass)', async () => {
    setConsent(true, false)
    const scheduler = makeScheduler()
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'unknown.kind',
        handler: async () => ({ whatever: 1 }),
        // no validate → falls back to validate.ts registry, which has no entry
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'unknown.kind', input: {} })
    expect(out.phase).toBe('failed')
    expect(out.reason).toMatch(/validator/i)
  })

  test('local-only KIND privacy forbids backend fallback even when the device lane fails', async () => {
    setConsent(true, false)
    const scheduler = makeScheduler()
    let backendCalled = false
    scheduler.registerBackendDelegate('test-product', async () => {
      backendCalled = true
      return { backend: true }
    })
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.localkind',
        privacy: 'local-only',
        handler: async () => {
          throw new Error('device execution blew up')
        },
        validate: () => ({ valid: true }),
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.localkind', input: {} })
    expect(out.phase).toBe('failed')
    expect(backendCalled).toBe(false)
    // Backend was never EXECUTED (only its refusal was recorded honestly).
    expect(out.attempts?.some((a) => a.target === 'backend' && a.state === 'BACKEND_FALLBACK_RUNNING')).toBe(false)
    // The real device failure surfaces as the final state, not the refusal note.
    expect(out.state).toBe('CLIENT_EXECUTION_FAILED')
    expect(out.reason).toMatch(/blew up/)
  })

  test('local-only CONSENT mode forbids backend fallback for device-preferred kinds', async () => {
    setConsent(true, true) // local-only mode
    const scheduler = makeScheduler()
    let backendCalled = false
    scheduler.registerBackendDelegate('test-product', async () => {
      backendCalled = true
      return { backend: true }
    })
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.devicekind',
        privacy: 'device-preferred',
        handler: async () => {
          throw new Error('device failed')
        },
        validate: () => ({ valid: true }),
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.devicekind', input: {} })
    expect(backendCalled).toBe(false)
    expect(out.attempts?.some((a) => a.target === 'backend' && a.state === 'BACKEND_FALLBACK_RUNNING')).toBe(false)
    expect(out.attempts?.some((a) => a.target === 'backend' && a.reason?.match(/local-only/i))).toBe(true)
  })

  test('backend fallback runs when allowed and the device lane fails', async () => {
    setConsent(true, false)
    const scheduler = makeScheduler()
    scheduler.registerBackendDelegate('test-product', async ({ reportProgress }) => {
      reportProgress(1, 'backend done')
      return { backend: true }
    })
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.fallbackkind',
        privacy: 'device-preferred',
        handler: async () => {
          throw new Error('device failed')
        },
        validate: (o) => ({ valid: (o as { backend: boolean }).backend === true }),
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.fallbackkind', input: {} })
    expect(out.phase).toBe('completed')
    expect(out.target).toBe('backend')
    expect(out.state).toBe('BACKEND_FALLBACK_RUNNING')
    expect((out.output as { backend: boolean }).backend).toBe(true)
    expect(out.attempts?.length).toBe(1) // the failed CPU attempt is recorded honestly
  })

  test('no backend delegate registered → NO_SUPPORTED_EXECUTION_PATH (no fake fallback)', async () => {
    setConsent(true, false)
    const scheduler = makeScheduler()
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.nobackend',
        handler: async () => {
          throw new Error('device failed')
        },
        validate: () => ({ valid: true }),
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.nobackend', input: {} })
    expect(out.phase).toBe('failed')
    expect(out.attempts?.some((a) => a.target === 'backend' && a.reason?.match(/No backend delegate/))).toBe(true)
  })

  test('duplicate tasks (same product+kind, still active) are rejected', async () => {
    setConsent(true, false)
    const scheduler = makeScheduler()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.dupe',
        handler: async () => {
          await gate
          return { done: true }
        },
        validate: () => ({ valid: true }),
      }),
    )
    const first = scheduler.runTask({ productId: 'test-product', kind: 'test.dupe', input: {} })
    await new Promise((r) => setTimeout(r, 10))
    const second = await scheduler.runTask({ productId: 'test-product', kind: 'test.dupe', input: {} })
    expect(second.phase).toBe('failed')
    expect(second.reason).toMatch(/already running/i)
    release()
    const firstOut = await first
    expect(firstOut.phase).toBe('completed')
  })

  test('enforced timeout: a handler that ignores the abort signal still fails honestly', async () => {
    setConsent(true, false)
    const scheduler = makeScheduler()
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.slowkind',
        handler: async () => {
          await new Promise((r) => setTimeout(r, 500)) // ignores signal
          return { ok: true }
        },
        validate: () => ({ valid: true }),
        timeoutMs: 40,
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.slowkind', input: {} })
    expect(out.phase).toBe('failed')
    expect(out.reason).toMatch(/time budget/i)
  })

  test('cancellation: aborted signal → cancelled phase, honest reason', async () => {
    setConsent(true, false)
    const scheduler = makeScheduler()
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.cancelkind',
        handler: async ({ signal }) => {
          await new Promise((r) => setTimeout(r, 30))
          if (signal.aborted) throw new Error('aborted')
          return { ok: true }
        },
        validate: () => ({ valid: true }),
        timeoutMs: 5_000,
      }),
    )
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5)
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.cancelkind', input: {}, signal: controller.signal })
    expect(out.phase).toBe('cancelled')
    expect(out.reason).toMatch(/cancel/i)
  })

  test('model-gated kinds report honest availability states (real LAXII segmentation kind)', async () => {
    setConsent(true, false)
    const cpu = new CpuEngine({ workerFactory: () => null })
    const scheduler = makeScheduler()
    scheduler.registerProductAdapter({ productId: 'laxii', summary: 'test', kinds: buildLaxiiKinds(cpu) })

    // No runtime registered → CLIENT_MODEL_UNSUPPORTED.
    const unsupported = await scheduler.runTask({ productId: 'laxii', kind: SEGMENTATION_KIND, input: {} })
    expect(unsupported.phase).toBe('failed')
    expect(unsupported.state).toBe('CLIENT_MODEL_UNSUPPORTED')
    expect(unsupported.attempts?.every((a) => /runtime is not available/i.test(a.reason ?? ''))).toBe(true)

    // Runtime probe registered but model not installed → CLIENT_MODEL_NOT_INSTALLED.
    registerModelRuntime('onnxruntime-web', () => true)
    const notInstalled = await scheduler.runTask({ productId: 'laxii', kind: SEGMENTATION_KIND, input: {} })
    expect(notInstalled.phase).toBe('failed')
    expect(notInstalled.state).toBe('CLIENT_MODEL_NOT_INSTALLED')
    expect(notInstalled.attempts?.[0].reason).toMatch(/not downloaded|cache|Model not/i)
  })

  test('memory gate: workload above the policy budget is refused honestly', async () => {
    setConsent(true, false)
    const scheduler = makeScheduler()
    let ran = false
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.hog',
        handler: async () => {
          ran = true
          return { ok: true }
        },
        validate: () => ({ valid: true }),
        feasibility: { gpuSupported: false, cpuSupported: true, estimatedMemoryMb: 100_000 },
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.hog', input: {}, resourceClass: 'medium' })
    expect(ran).toBe(false)
    expect(out.attempts?.[0].state).toBe('CLIENT_MEMORY_INSUFFICIENT')
    expect(out.attempts?.[0].reason).toMatch(/budget/i)
  })

  test('concurrency admission: only N device tasks run at once (cap 1)', async () => {
    setConsent(true, false)
    const resources = new ResourceManager({ maxConcurrentDeviceTasks: 1 })
    const scheduler = makeScheduler({ resources })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.one',
        handler: async () => {
          await gate
          return { ok: true }
        },
        validate: () => ({ valid: true }),
      }),
    )
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.two',
        handler: async () => ({ ok: true }),
        validate: () => ({ valid: true }),
      }),
    )
    const first = scheduler.runTask({ productId: 'test-product', kind: 'test.one', input: {} })
    await new Promise((r) => setTimeout(r, 10))
    // A different kind (same product) — not a dedupe collision, but the
    // concurrency slot is occupied → honest admission refusal.
    const second = await scheduler.runTask({ productId: 'test-product', kind: 'test.two', input: {} })
    expect(second.attempts?.[0].reason).toMatch(/Concurrency cap/)
    release()
    expect((await first).phase).toBe('completed')
  })

  test('hidden tab: device tasks are not started while the page is hidden', async () => {
    setConsent(true, false)
    ;(globalThis as Record<string, unknown>).document = { visibilityState: 'hidden' }
    const scheduler = makeScheduler()
    let ran = false
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.hidden',
        handler: async () => {
          ran = true
          return { ok: true }
        },
        validate: () => ({ valid: true }),
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.hidden', input: {} })
    expect(ran).toBe(false)
    expect(out.attempts?.[0].reason).toMatch(/tab is hidden/i)
  })

  test('registration validation: unknown kinds and product mismatches are rejected', async () => {
    const scheduler = makeScheduler()
    expect(scheduler.registerTask({ productId: 'p', kind: 'does.not.exist', input: {} }).ok).toBe(false)
    scheduler.registerTaskKind(cpuKind({ kind: 'test.k', handler: async () => ({}) }))
    expect(scheduler.registerTask({ productId: 'other-product', kind: 'test.k', input: {} }).ok).toBe(false)
    expect(scheduler.registerTask({ productId: 'test-product', kind: 'test.k', input: {} }).ok).toBe(true)
    expect(scheduler.registerTask({ productId: 'test-product', kind: 'test.k', input: {} }).ok).toBe(true) // ids unique
  })

  test('backend-preferred privacy: backend runs first without device attempts', async () => {
    const scheduler = makeScheduler() // NO consent — irrelevant for backend path
    let backendCalls = 0
    scheduler.registerBackendDelegate('test-product', async () => {
      backendCalls += 1
      return { ok: true }
    })
    scheduler.registerTaskKind(
      cpuKind({
        kind: 'test.backendpreferred',
        privacy: 'backend-preferred',
        handler: async () => ({ device: true }),
        validate: () => ({ valid: true }),
      }),
    )
    const out = await scheduler.runTask({ productId: 'test-product', kind: 'test.backendpreferred', input: {} })
    expect(out.phase).toBe('completed')
    expect(out.target).toBe('backend')
    expect(backendCalls).toBe(1)
  })

  test('getStatus reports honest usable targets and registered adapters', async () => {
    setConsent(true, false)
    const cpu = new CpuEngine({ workerFactory: () => null })
    const scheduler = makeScheduler()
    scheduler.registerProductAdapter({ productId: 'laxii', summary: 'test adapter', kinds: buildLaxiiKinds(cpu) })
    const status = await scheduler.getStatus()
    expect(status.tierLabel).toBeTruthy()
    expect(status.usableTargets).toContain('client-cpu')
    expect(status.usableTargets).toContain('backend')
    expect(status.adapters.some((a) => a.productId === 'laxii' && a.kinds.includes(SEGMENTATION_KIND))).toBe(true)
  })
})
