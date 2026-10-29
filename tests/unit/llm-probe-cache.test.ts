/**
 * LLM health probing + the shared health-probe cache.
 *
 * REWRITTEN 2026-10-29 for the current architecture (the previous version
 * tested an adapter-internal cache and a 429 retry that no longer exist):
 *  - caching moved OUT of the adapter into health-cache.ts (cachedHealth):
 *    the /api/health route dedupes and TTL-caches REAL probe results; a
 *    cached report keeps the original checkedAt and carries cached:true —
 *    it is the last real probe outcome, never a fabricated fresh success;
 *  - the adapter itself makes exactly ONE gateway attempt per health() call.
 *    A 429 is NOT retried (measured: the throttle window lasts minutes; a
 *    retry only deepens it — see upstream-429.test.ts) and the failure is
 *    classified honestly (rate-limited / auth / billing / other);
 *  - while the chat-class breaker is open, the probe is DEFERRED: zero
 *    network traffic, latencyMs null, detail says no call was made.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

/** Mutable SDK behavior — each test installs its own gateway fake. */
let currentCreate: (body: unknown) => Promise<unknown> = async () => ({
  choices: [{ message: { content: 'OK' } }],
})

mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      chat: { completions: { create: (body: unknown) => currentCreate(body) } },
    }),
  },
}))

const { hostedLlmAdapter } = await import('../../src/lib/adapters/hosted-llm')
const {
  cachedHealth,
  clearHealthCacheForTests,
  HEALTH_CACHE_TTL_MS,
} = await import('../../src/lib/adapters/health-cache')
const { _resetUpstreamCooldownForTests } = await import('../../src/lib/upstream/gateway')

type HealthReport = Awaited<ReturnType<typeof hostedLlmAdapter.health>>

const OK_BODY = { choices: [{ message: { content: 'OK' } }] }

beforeEach(() => {
  clearHealthCacheForTests()
  _resetUpstreamCooldownForTests()
  currentCreate = async () => OK_BODY
})

describe('health-probe cache (cachedHealth)', () => {
  test('a healthy probe is TTL-cached: a second call does not touch the gateway and keeps the real checkedAt', async () => {
    let calls = 0
    currentCreate = async () => {
      calls++
      return OK_BODY
    }

    const first = await cachedHealth('llm-hosted-primary', () => hostedLlmAdapter.health())
    const second = await cachedHealth('llm-hosted-primary', () => hostedLlmAdapter.health())

    expect(calls).toBe(1) // one real probe, two health() consumers
    expect(first.healthy).toBe(true)
    expect(first.cached).toBeUndefined() // the fresh probe is not marked cached
    expect(second.cached).toBe(true)
    expect(second.checkedAt).toBe(first.checkedAt) // staleness is visible, not hidden
    expect(second.detail).toContain('live completion probe')
  })

  test('concurrent callers share ONE in-flight probe (no duplicate gateway traffic)', async () => {
    let calls = 0
    let release!: (v: unknown) => void
    const deferred = new Promise((resolve) => {
      release = resolve
    })
    currentCreate = async () => {
      calls++
      return deferred
    }

    const probe = () => hostedLlmAdapter.health()
    const p1 = cachedHealth('llm-hosted-primary', probe)
    const p2 = cachedHealth('llm-hosted-primary', probe)
    release(OK_BODY)
    const [r1, r2] = await Promise.all([p1, p2])

    expect(calls).toBe(1)
    expect(r1.healthy).toBe(true)
    expect(r2.checkedAt).toBe(r1.checkedAt)
  })

  test('a failure result is cached like a success (never retried into a fake success)', async () => {
    let calls = 0
    currentCreate = async () => {
      calls++
      throw new Error('API request failed with status 500: {"error":"internal"}')
    }

    const failed = await cachedHealth('llm-hosted-primary', () => hostedLlmAdapter.health())
    const cached = await cachedHealth('llm-hosted-primary', () => hostedLlmAdapter.health())

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

describe('hostedLlmAdapter.health() honesty (one real attempt, typed failures)', () => {
  test('a healthy gateway reports a live completion probe', async () => {
    const report = await hostedLlmAdapter.health()
    expect(report.healthy).toBe(true)
    expect(report.detail).toContain('live completion probe')
    expect(report.latencyMs).not.toBeNull()
  })

  test('a 429 is NOT retried (exactly one attempt) and is reported as upstream rate-limiting, not product failure', async () => {
    let calls = 0
    currentCreate = async () => {
      calls++
      throw new Error('API request failed with status 429: {"error":"Too many requests, please try again later"}')
    }

    const report = await hostedLlmAdapter.health()

    expect(calls).toBe(1) // no retry into a measured multi-minute throttle
    expect(report.healthy).toBe(false)
    expect(report.detail).toContain('429')
    expect(report.detail).toContain('rate-limited')
    // The detail names the upstream cause — never a fabricated reset time.
    expect(report.detail.toLowerCase()).not.toContain('reset')
  })

  test('while the chat breaker is open the probe is DEFERRED: zero network, latencyMs null', async () => {
    const { noteUpstream429 } = await import('../../src/lib/upstream/gateway')
    noteUpstream429('chat')

    let calls = 0
    currentCreate = async () => {
      calls++
      return OK_BODY
    }

    const report = await hostedLlmAdapter.health()

    expect(calls).toBe(0) // breaker absorbed the probe — no traffic
    expect(report.healthy).toBe(false)
    expect(report.latencyMs).toBeNull() // a skipped probe never poses as a measured one
    expect(report.detail).toContain('deferred')
    expect(report.detail).toContain('no network call was made')
  })

  test('a hard non-429 failure is not retried and never claims rate-limiting', async () => {
    let calls = 0
    currentCreate = async () => {
      calls++
      throw new Error('API request failed with status 500: {"error":"internal"}')
    }

    const report = await hostedLlmAdapter.health()

    expect(calls).toBe(1)
    expect(report.healthy).toBe(false)
    expect(report.detail).toContain('500')
    expect(report.detail).not.toContain('rate-limited')
  })

  test('breaker recovery is verified by the next real probe, never assumed', async () => {
    const { noteUpstream429 } = await import('../../src/lib/upstream/gateway')
    noteUpstream429('chat')
    const deferred = await hostedLlmAdapter.health()
    expect(deferred.healthy).toBe(false)
    expect(deferred.detail).toContain('deferred')

    // Cooldown expiry (60s) is BEAN's own conservative backoff; the breaker
    // re-opens only on a NEW observed 429. Simulate expiry for the probe.
    const g = globalThis as unknown as Record<string, Map<string, { until: number }>>
    const store = g['__bean_upstream_cooldown__']
    const state = store.get('chat')
    if (state) state.until = Date.now() - 1

    let calls = 0
    currentCreate = async () => {
      calls++
      return OK_BODY
    }
    const recovered = await hostedLlmAdapter.health()
    expect(calls).toBe(1) // a REAL call verified recovery
    expect(recovered.healthy).toBe(true)
  })
})
