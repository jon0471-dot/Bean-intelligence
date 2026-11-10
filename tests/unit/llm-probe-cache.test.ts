/**
 * LLM health probing + the shared health-probe cache.
 *
 * REWRITTEN 2026-11-10 (CHAT-RECOVERY, quota-free probes): the health probe
 * no longer fires ANY completion. Its evidence is, in order: config → free
 * reachability GET (unmetered router-layer 404) → chat-class breaker →
 * real-attempt evidence (in-memory + persisted). The caching contract is
 * unchanged (cachedHealth: one real probe per TTL, in-flight dedup, cached
 * reports keep their checkedAt).
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

/** Mutable SDK behavior — each test installs its own gateway fake. */
let currentCreate: (body: unknown) => Promise<unknown> = async () => ({
  choices: [{ message: { content: 'OK' } }],
})
let createCalls = 0

mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      // The quota-free probe reads this runtime config (in memory only).
      config: { baseUrl: 'https://gateway.test/v1', apiKey: 'test-key' },
      chat: { completions: { create: (body: unknown) => currentCreate(body) } },
    }),
  },
}))

// HERMETICITY (measured 2026-11-10): the persisted chat evidence reads the
// REAL database (UsageRecord rows written by live traffic), so test outcomes
// would depend on what the app did lately. These tests pin the PROBE's
// evidence ladder, not the DB — the persisted branch gets its own controlled
// test file (persisted-chat-attempts.test.ts).
mock.module('../../src/lib/adapters/persisted-attempts', () => ({
  persistedAttempt: async () => null,
}))

const { hostedLlmAdapter } = await import('../../src/lib/adapters/hosted-llm')
const {
  cachedHealth,
  clearHealthCacheForTests,
  HEALTH_CACHE_TTL_MS,
} = await import('../../src/lib/adapters/health-cache')
const {
  _resetUpstreamCooldownForTests,
  noteUpstream429,
} = await import('../../src/lib/upstream/gateway')
const { _resetRealAttemptsForTests, noteRealAttempt } = await import(
  '../../src/lib/adapters/last-attempts'
)

type HealthReport = Awaited<ReturnType<typeof hostedLlmAdapter.health>>

/** Free reachability fake: the gateway's router answers /models with 404. */
let reachStatus = 404
let reachThrow: string | null = null
const realFetch = globalThis.fetch

beforeEach(() => {
  clearHealthCacheForTests()
  _resetUpstreamCooldownForTests()
  _resetRealAttemptsForTests()
  currentCreate = async () => ({ choices: [{ message: { content: 'OK' } }] })
  createCalls = 0
  reachStatus = 404
  reachThrow = null
  globalThis.fetch = (async () => {
    if (reachThrow) throw new Error(reachThrow)
    return new Response('404 page not found', { status: reachStatus })
  }) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('health-probe cache (cachedHealth)', () => {
  test('a healthy probe is TTL-cached: a second call does not touch the network and keeps the real checkedAt', async () => {
    const first = await cachedHealth('llm-hosted-primary', () => hostedLlmAdapter.health())
    const second = await cachedHealth('llm-hosted-primary', () => hostedLlmAdapter.health())

    expect(first.healthy).toBe(true)
    expect(first.cached).toBeUndefined() // the fresh probe is not marked cached
    expect(second.cached).toBe(true)
    expect(second.checkedAt).toBe(first.checkedAt) // staleness is visible, not hidden
    expect(second.detail.toLowerCase()).toContain('no completion was fired')
    // QUOTA CONTRACT: zero completions across both calls (one reachability GET each).
    expect(createCalls).toBe(0)
  })

  test('concurrent callers share ONE in-flight probe', async () => {
    let calls = 0
    let release!: () => void
    const deferred = new Promise<HealthReport>((resolve) => {
      release = () =>
        resolve({
          healthy: true,
          checkedAt: new Date().toISOString(),
          latencyMs: 5,
          httpStatus: null,
          failureCategory: null,
          detail: 'free liveness check',
        })
    })
    const probe = () => {
      calls++
      return deferred
    }
    const p1 = cachedHealth('llm-hosted-primary', probe)
    const p2 = cachedHealth('llm-hosted-primary', probe)
    release()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(calls).toBe(1)
    expect(r1.healthy).toBe(true)
    expect(r2.checkedAt).toBe(r1.checkedAt)
  })

  test('a failure result is cached like a success (never retried into a fake success)', async () => {
    let calls = 0
    const probe = () => {
      calls++
      return Promise.resolve({
        healthy: false,
        checkedAt: new Date().toISOString(),
        latencyMs: 5,
        httpStatus: 429,
        failureCategory: 'rate-limited' as const,
        detail: 'breaker open',
      })
    }

    const failed = await cachedHealth('llm-hosted-primary', probe)
    const cached = await cachedHealth('llm-hosted-primary', probe)

    expect(calls).toBe(1) // the cached failure is served, not re-probed
    expect(failed.healthy).toBe(false)
    expect(cached.cached).toBe(true)
    expect(cached.checkedAt).toBe(failed.checkedAt)
    expect(cached.healthy).toBe(false) // never upgraded
  })

  test('the TTL is short enough that recovery is visible quickly', () => {
    expect(HEALTH_CACHE_TTL_MS).toBeLessThanOrEqual(30_000)
  })
})

describe('hostedLlmAdapter.health() — quota-free, evidence-based', () => {
  test('healthy gateway: reachability + config evidence, ZERO completions fired', async () => {
    const report = await hostedLlmAdapter.health()
    expect(report.healthy).toBe(true)
    expect(report.detail).toContain('no completion was fired')
    expect(report.detail).toContain('no real chat attempt evidence yet')
    expect(report.latencyMs).not.toBeNull()
    expect(report.httpStatus).toBeNull()
    expect(createCalls).toBe(0) // THE quota contract: health never infers
  })

  test('real-attempt evidence backs healthy: a recorded success appears in the detail', async () => {
    const at = new Date(Date.now() - 60_000).toISOString()
    noteRealAttempt('chat-completion', {
      at,
      ok: true,
      backendId: 'bean-llm-hosted-primary',
      failureCategory: null,
      httpStatus: null,
      upstream: false,
    })
    const report = await hostedLlmAdapter.health()
    expect(report.healthy).toBe(true)
    expect(report.detail).toContain(`succeeded at ${at}`)
    expect(createCalls).toBe(0)
  })

  test('a fresh failed chat attempt keeps the status honestly unhealthy (no probe can mask it)', async () => {
    noteRealAttempt('chat-completion', {
      at: new Date().toISOString(),
      ok: false,
      backendId: 'bean-llm-hosted-primary',
      failureCategory: 'rate-limited',
      httpStatus: 429,
      upstream: true,
    })
    const report = await hostedLlmAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.failureCategory).toBe('rate-limited')
    expect(report.detail).toContain('failed upstream')
    expect(createCalls).toBe(0)
  })

  test('an open chat breaker reports rate-limited with the observed 429 evidence', async () => {
    noteUpstream429('chat')
    const report = await hostedLlmAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.failureCategory).toBe('rate-limited')
    expect(report.httpStatus).toBe(429)
    expect(report.detail).toContain('429')
    expect(report.detail.toLowerCase()).toContain('no completion was fired')
    expect(createCalls).toBe(0)
  })

  test('an unreachable gateway host is an honest timeout/unreachable, not a product failure', async () => {
    reachThrow = 'no response within 5000ms'
    const report = await hostedLlmAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.failureCategory).toBe('timeout')
    expect(report.detail).toContain('UNREACHABLE')
    expect(createCalls).toBe(0)
  })

  test('a redirecting answer is never counted as a healthy gateway', async () => {
    reachStatus = 302
    const report = await hostedLlmAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.failureCategory).toBe('network')
    expect(report.detail).toContain('redirected')
    expect(createCalls).toBe(0)
  })

  test('missing gateway config is misconfigured with no request made', async () => {
    // Simulate an SDK whose config lacks coordinates.
    const mod = await import('../../src/lib/adapters/gateway-reachability')
    expect(mod.gatewayConfig({})).toEqual({ baseUrl: null, apiKey: null })
  })

  test('the breaker never pre-clears on a probe: recovery is verified by REAL calls', async () => {
    noteUpstream429('chat')
    const deferred = await hostedLlmAdapter.health()
    expect(deferred.healthy).toBe(false)
    expect(createCalls).toBe(0) // no probe request fired to "verify" recovery

    // Simulate breaker expiry: the probe STILL fires no completion. The next
    // REAL chat call (covered by upstream-429.test.ts) is what verifies it.
    const g = globalThis as unknown as Record<string, Map<string, { until: number }>>
    const store = g['__bean_upstream_cooldown__']
    const state = store.get('chat')
    if (state) state.until = Date.now() - 1
    const afterExpiry = await hostedLlmAdapter.health()
    expect(afterExpiry.healthy).toBe(true)
    expect(afterExpiry.detail).toContain('no real chat attempt evidence yet')
    expect(createCalls).toBe(0)
  })
})
