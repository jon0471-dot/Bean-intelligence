/**
 * M39 §A — quality-route integration tests (scheduler wiring of the M38 §B5
 * policy).
 *
 * Pinned behaviors:
 *  - the policy is consulted ONLY for MODEL-backed tasks (feasibility
 *    .requiredModelId); deterministic compute lanes keep their fixed order;
 *  - `prefer-backend`: a minimal-class local model never silently serves a
 *    standard task while an authorized backend exists — the backend runs
 *    FIRST, and only after a REAL backend failure does the local lane run,
 *    carrying the STATED limitation on the output;
 *  - `local-with-limitation`: adequate local model on a conservative/low-tier
 *    device runs locally with the limitation stated on the output;
 *  - `require-backend` / `no-route` terminal honesty: without a verified
 *    local model and without an authorized backend the task fails honestly
 *    (nothing is silently substituted);
 *  - a high-class local model (MODNet segmentation lane) keeps its
 *    client-first behavior — quality routing must NOT regress it;
 *  - the policy can never approve a lane the executor's own gates refuse
 *    (consent, runtime, install, memory, admission all still apply).
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import { ComputeScheduler } from '@/lib/client-compute/scheduler'
import { CpuEngine } from '@/lib/client-compute/cpu/engine'
import { ResourceManager } from '@/lib/client-compute/resource-manager'
import { ModelRegistry, type ModelCacheLike } from '@/lib/client-compute/model-registry'
import { setConsent } from '@/lib/client-compute/privacy'
import { deriveDeviceProfile } from '@/lib/client-compute/device-profile'
import type {
  CapabilitySnapshot,
  ClientComputeTier,
  ComputeTaskOutput,
  DeviceProfile,
  RegisteredTaskKind,
  TargetHandler,
} from '@/lib/client-compute/types'
import type { BackendDelegate } from '@/lib/client-compute/scheduler'

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

/** A registry whose one test entry behaves as INSTALLED on this device. */
function registryWithInstalledEntry(entryOverrides: Record<string, unknown> = {}): ModelRegistry {
  const cache: ModelCacheLike = {
    match: async (key: string) => {
      if (key === 'test-model-minimal@1' || key === 'test-model-high@1') {
        return new Response('bytes', {
          headers: { 'x-bean-model': key.split('@')[0], 'x-bean-model-version': '1', 'content-length': '1000' },
        })
      }
      return undefined
    },
    put: async () => undefined,
    delete: async () => true,
  }
  const registry = new ModelRegistry({ cacheFactory: async () => cache })
  // Inject honest test entries (qualityClass is the field under test).
  const base = {
    id: 'test-model-minimal',
    version: '1',
    sourceUrl: 'https://huggingface.co/test/minimal',
    revision: null,
    license: 'Apache-2.0 (test fixture)',
    runtime: 'custom' as const,
    runtimeAvailable: () => true,
    gpuCompatible: false,
    cpuCompatible: true,
    memoryEstimateMb: 64,
    sizeBytes: 1000,
    sizeUnverified: false,
    sha256: null,
    integrity: 'pinned-artifact-sha256' as const,
    downloadPath: 'bean-managed-cache' as const,
    supportedTasks: ['test.kind'],
    limitations: [],
    enabled: true,
    qualityClass: 'minimal' as const,
    ...entryOverrides,
  }
  const high = { ...base, id: 'test-model-high', qualityClass: 'high' as const }
  // getEntry is patched on the instance so the fixture entries resolve while
  // all other registry behavior (install gate, cache contract) stays REAL.
  const registryAny = registry as unknown as { getEntry: (id: string) => unknown }
  const realGetEntry = registryAny.getEntry.bind(registry)
  registryAny.getEntry = (id: string) => {
    if (id === base.id) return base
    if (id === high.id) return high
    return realGetEntry(id)
  }
  return registry
}

function profileOf(snap: CapabilitySnapshot, overrides: Partial<DeviceProfile> = {}): DeviceProfile {
  return { ...deriveDeviceProfile(snap), ...overrides }
}

interface Fixture {
  scheduler: ComputeScheduler
  calls: string[]
  backendShouldFail: boolean
}

function makeFixture(opts: {
  qualityClass?: 'minimal' | 'balanced' | 'high'
  modelId?: string
  requiredModelId?: string | null
  conservative?: boolean
  tier?: number
  withBackend?: boolean
  backendShouldFail?: boolean
  complexity?: 'light' | 'standard' | 'demanding'
} = {}): Fixture {
  const calls: string[] = []
  const backendShouldFail = opts.backendShouldFail ?? false
  const snap = snapshot({ deviceMemoryGb: 8 })
  const registry = registryWithInstalledEntry({
    id: opts.modelId ?? 'test-model-minimal',
    qualityClass: opts.qualityClass ?? 'minimal',
  })
  const scheduler = new ComputeScheduler({
    capabilities: async () => snap,
    profile: () => profileOf(snap, { conservative: opts.conservative ?? false, tier: (opts.tier ?? 3) as ClientComputeTier }),
    resources: new ResourceManager({ conservative: false }),
    cpu: new CpuEngine({ workerFactory: () => null }),
    registry,
  })
  const cpuHandler: TargetHandler<unknown, { ok: boolean }> = async () => {
    calls.push('client-cpu')
    return { ok: true }
  }
  const kind: RegisteredTaskKind<unknown, unknown> = {
    kind: 'test.kind',
    productId: 'test-product',
    preferredOrder: ['client-cpu', 'backend'],
    handlers: { 'client-cpu': cpuHandler as TargetHandler<unknown, unknown> },
    validate: () => ({ valid: true }),
    feasibility: {
      gpuSupported: false,
      cpuSupported: true,
      ...(opts.requiredModelId === null ? {} : { requiredModelId: opts.requiredModelId ?? 'test-model-minimal' }),
    },
    complexity: opts.complexity,
    timeoutMs: 2000,
  }
  scheduler.registerTaskKind(kind)
  if (opts.withBackend !== false) {
    const delegate: BackendDelegate = async () => {
      calls.push('backend')
      if (backendShouldFail) throw new Error('backend unavailable (test)')
      return { ok: true, via: 'backend' }
    }
    scheduler.registerBackendDelegate('test-product', delegate)
  }
  return { scheduler, calls, backendShouldFail }
}

function descriptor(productId: string, kind: string, complexity?: 'light' | 'standard' | 'demanding') {
  return {
    productId,
    kind,
    input: {},
    privacy: 'device-preferred' as const,
    ...(complexity ? { complexity } : {}),
  }
}

describe('M39 quality-route integration (scheduler wiring)', () => {
  beforeEach(() => {
    setConsent(true, false)
  })

  test('prefer-backend: minimal local model never silently serves a standard task — backend first', async () => {
    const f = makeFixture({ qualityClass: 'minimal', complexity: 'standard', withBackend: true })
    const out = await f.scheduler.runTask(descriptor('test-product', 'test.kind', 'standard'))
    expect(out.phase).toBe('completed')
    expect(out.target).toBe('backend')
    expect(f.calls[0]).toBe('backend')
    expect(f.calls).toEqual(['backend'])
  })

  test('prefer-backend fallback: after a REAL backend failure the local lane runs WITH the stated limitation', async () => {
    const f = makeFixture({ qualityClass: 'minimal', complexity: 'standard', withBackend: true, backendShouldFail: true })
    const out = await f.scheduler.runTask(descriptor('test-product', 'test.kind', 'standard')) as ComputeTaskOutput<{ ok: boolean }>
    expect(out.phase).toBe('completed')
    expect(out.target).toBe('client-cpu')
    expect(f.calls).toEqual(['backend', 'client-cpu'])
    expect(out.limitation).toBeTruthy()
    expect(out.limitation).toContain('minimal')
    expect(out.attempts?.some((a) => a.target === 'backend' && a.state === 'CLIENT_EXECUTION_FAILED')).toBe(true)
  })

  test('local-with-limitation: adequate local model on a conservative device runs locally and STATES the limitation', async () => {
    // M38 policy semantics: an adequate model on a low device with a LIGHT
    // task is 'local-approved' (no caveat); a STANDARD task on a conservative
    // device is where the caveat becomes honest.
    const f = makeFixture({ qualityClass: 'balanced', complexity: 'standard', conservative: true, withBackend: true })
    const out = await f.scheduler.runTask(descriptor('test-product', 'test.kind', 'standard')) as ComputeTaskOutput<{ ok: boolean }>
    expect(out.phase).toBe('completed')
    expect(out.target).toBe('client-cpu')
    expect(f.calls).toEqual(['client-cpu'])
    expect(out.limitation).toBeTruthy()
  })

  test('local-approved: adequate model on a capable device runs locally with NO limitation', async () => {
    const f = makeFixture({ qualityClass: 'high', complexity: 'demanding', withBackend: true })
    const out = await f.scheduler.runTask(descriptor('test-product', 'test.kind', 'demanding')) as ComputeTaskOutput<{ ok: boolean }>
    expect(out.phase).toBe('completed')
    expect(out.target).toBe('client-cpu')
    expect(f.calls).toEqual(['client-cpu'])
    expect(out.limitation).toBeUndefined()
  })

  test('deterministic lane (no requiredModelId): quality policy NOT consulted — order unchanged', async () => {
    const f = makeFixture({ requiredModelId: null, qualityClass: 'minimal', complexity: 'standard', withBackend: true })
    const out = await f.scheduler.runTask(descriptor('test-product', 'test.kind', 'standard'))
    expect(out.phase).toBe('completed')
    expect(out.target).toBe('client-cpu')
    expect(f.calls).toEqual(['client-cpu'])
  })

  test('no-route: no verified local model and no backend → honest failure with the policy limitation, nothing substituted', async () => {
    const f = makeFixture({ withBackend: false })
    // Force the model gate to fail: unknown required model id.
    const kind = f.scheduler as unknown as { kinds: Map<string, RegisteredTaskKind<unknown, unknown>> }
    const existing = kind.kinds.get('test.kind')
    if (existing?.feasibility) existing.feasibility.requiredModelId = 'totally-unknown-model'
    const out = await f.scheduler.runTask(descriptor('test-product', 'test.kind', 'standard'))
    expect(out.phase).toBe('failed')
    expect(f.calls).toEqual([])
    // The terminal state stays the executor's precise vocabulary; the policy
    // limitation rides on the reason.
    expect(out.reason).toContain('cannot be executed')
    expect(out.reason).toContain('Nothing will be silently substituted')
  })

  test('high-class segmentation lane regression: MODNet-style entry keeps client-first behavior', async () => {
    const f = makeFixture({ qualityClass: 'high', modelId: 'test-model-high', complexity: 'demanding', withBackend: true })
    const kind = f.scheduler as unknown as { kinds: Map<string, RegisteredTaskKind<unknown, unknown>> }
    const existing = kind.kinds.get('test.kind')
    if (existing?.feasibility) existing.feasibility.requiredModelId = 'test-model-high'
    const out = await f.scheduler.runTask(descriptor('test-product', 'test.kind', 'demanding')) as ComputeTaskOutput<{ ok: boolean }>
    expect(out.phase).toBe('completed')
    expect(out.target).toBe('client-cpu')
    expect(f.calls).toEqual(['client-cpu'])
    expect(out.limitation).toBeUndefined()
  })

  test('policy never bypasses executor gates: without consent the local lane is refused even when the policy would approve it', async () => {
    setConsent(false, false)
    const f = makeFixture({ qualityClass: 'high', complexity: 'light', withBackend: true })
    const out = await f.scheduler.runTask(descriptor('test-product', 'test.kind', 'light'))
    expect(out.phase).toBe('completed')
    expect(out.target).toBe('backend')
    expect(f.calls).toEqual(['backend'])
  })

  test('local-only mode + verified local model: backend never runs even when registered', async () => {
    setConsent(true, true) // local-only consent mode
    const f = makeFixture({ qualityClass: 'balanced', complexity: 'light', withBackend: true })
    const out = await f.scheduler.runTask(descriptor('test-product', 'test.kind', 'light')) as ComputeTaskOutput<{ ok: boolean }>
    expect(out.phase).toBe('completed')
    expect(out.target).toBe('client-cpu')
    expect(f.calls).toEqual(['client-cpu'])
  })
})
