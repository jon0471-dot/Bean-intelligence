/**
 * BEAN Intelligence — four-product connectivity & honest health contract
 * tests (2026-11-04 connectivity audit).
 *
 * What is pinned here, against REAL production code:
 *  1. STRUCTURED FAILURE EVIDENCE — every unhealthy HealthReport carries a
 *     coarse failureCategory + the observed HTTP status (when a real HTTP
 *     exchange happened), so the dashboard renders WHY a backend is down
 *     without parsing free-text details.
 *  2. REDIRECTS ARE NOT HEALTH — the LAXII reachability probe uses
 *     `redirect: 'manual'` and NEVER treats a 3xx answer (which comes from
 *     whoever the gateway redirects to) as a verified gateway response.
 *     The redirect target is intentionally not surfaced.
 *  3. 5xx IS NOT HEALTH — the previous probe treated ANY status except
 *     401/403/429 as healthy (a 500-ing backend would have shown as
 *     operational). Only 2xx (or the known-absent metadata route, 404)
 *     counts as verified now.
 *  4. TIMEOUTS AND CONNECTION REFUSALS are distinct honest categories
 *     (timeout vs unreachable), never conflated with misconfiguration.
 *  5. PROBE FAILURE ISOLATION — safeProbe turns a THROWING probe into an
 *     honest failed report; the other probes' results are unaffected (one
 *     broken probe must never 500 the whole health endpoint).
 *  6. LAST-SUCCESS TRACKING — lastHealthyAtFor(key) records when a backend
 *     last PASSED a real probe; cached replays never fabricate new
 *     successes; failures leave the last success untouched.
 *  7. CLIENT TIMEOUTS — beanFetch's opt-in timeoutMs aborts a hung request
 *     into an AbortError instead of pending forever (undefined = unchanged
 *     behavior for every existing caller).
 *
 * Faults are injected ONLY at the real boundaries: the SDK module mock,
 * global fetch, and injected probe functions. No fake endpoints.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

/** Mutable boundaries each test installs. */
let sdkConfig: { baseUrl?: string; apiKey?: string } | null = {
  baseUrl: 'https://gateway.example.internal/v1',
  apiKey: 'test-tenant-key',
}
type FetchStub = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>
let fetchImpl: FetchStub = async () => new Response('{}', { status: 200 })
let fetchCalls: Array<{ input: Parameters<typeof fetch>[0]; init?: Parameters<typeof fetch>[1] }> = []

mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      config: sdkConfig,
      images: { generations: { create: async () => { throw new Error('generation must never run from a health probe') } } },
      chat: { completions: { create: async () => ({ choices: [{ message: { content: 'OK' } }] }) } },
    }),
  },
}))

const realFetch = globalThis.fetch

beforeEach(() => {
  sdkConfig = { baseUrl: 'https://gateway.example.internal/v1', apiKey: 'test-tenant-key' }
  fetchCalls = []
  fetchImpl = async (input, init) => {
    fetchCalls.push({ input, init })
    return new Response('{}', { status: 200 })
  }
  globalThis.fetch = ((input, init) => fetchImpl(input, init)) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  delete (globalThis as unknown as Record<string, unknown>).__bean_upstream_cooldown__
})

const { hostedImageAdapter } = await import('../../src/lib/adapters/hosted-image')
const { clearHealthCacheForTests, lastHealthyAtFor } = await import('../../src/lib/adapters/health-cache')
const { safeProbe } = await import('../../src/lib/adapters/safe-probe')
const { _resetUpstreamCooldownForTests } = await import('../../src/lib/upstream/gateway')
const { beanFetch } = await import('../../src/components/bean/shared')

beforeEach(() => {
  clearHealthCacheForTests()
  _resetUpstreamCooldownForTests()
})

// ---------------------------------------------------------------------------
// 1. Redirect handling (the audit's "do not mistake redirects for health")
// ---------------------------------------------------------------------------

describe('LAXII probe: redirects are deliberate, never health', () => {
  test('a 302 from the gateway host is reported, NOT followed, NOT healthy', async () => {
    fetchImpl = async (input, init) => {
      fetchCalls.push({ input, init })
      return new Response(null, { status: 302, headers: { location: 'https://elsewhere.example.internal/health' } })
    }
    const report = await hostedImageAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.failureCategory).toBe('redirected')
    expect(report.httpStatus).toBe(302)
    expect(report.detail).toContain('HTTP 302 redirect')
    expect(report.detail).toContain('never followed')
    // The redirect TARGET is never surfaced into the browser-visible report.
    expect(report.detail).not.toContain('elsewhere')
    // Redirects are never silently followed: the fetch call itself opted
    // into manual redirect handling.
    expect(fetchCalls[0]?.init?.redirect).toBe('manual')
  })

  test('a 307 redirect is equally NOT a verified health response', async () => {
    fetchImpl = async (input, init) => {
      fetchCalls.push({ input, init })
      return new Response(null, { status: 307, headers: { location: 'https://other.example/v1/models' } })
    }
    const report = await hostedImageAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.failureCategory).toBe('redirected')
    expect(report.httpStatus).toBe(307)
    expect(fetchCalls[0]?.init?.redirect).toBe('manual')
  })
})

// ---------------------------------------------------------------------------
// 2. Timeout vs connection refusal vs invalid configuration
// ---------------------------------------------------------------------------

describe('LAXII probe: timeout / refusal / configuration are distinct categories', () => {
  test('a gateway that never answers within the deadline = TIMEOUT (abort, no HTTP status)', async () => {
    // Shorten the probe's connection deadline for this test (bounded env
    // override, 100ms floor) — the abort-signal path is what's pinned.
    process.env.BEAN_IMAGE_PROBE_TIMEOUT_MS = '120'
    try {
      fetchImpl = (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          // Simulate the fetch hanging until the probe's own abort fires.
          init?.signal?.addEventListener('abort', () => {
            const e = new Error('This operation was aborted')
            e.name = 'AbortError'
            reject(e)
          })
        })
      const report = await hostedImageAdapter.health()
      expect(report.healthy).toBe(false)
      expect(report.failureCategory).toBe('timeout')
      expect(report.httpStatus).toBeNull()
      expect(report.detail).toContain('answered no request')
      expect(report.detail).toContain('no response within 120ms')
    } finally {
      delete process.env.BEAN_IMAGE_PROBE_TIMEOUT_MS
    }
  }, 4000)

  test('connection refused = UNREACHABLE with category, distinct from timeout', async () => {
    fetchImpl = async () => {
      const e = new Error('connect ECONNREFUSED 10.0.0.1:443')
      throw e
    }
    const report = await hostedImageAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.failureCategory).toBe('unreachable')
    expect(report.httpStatus).toBeNull()
    expect(report.detail).toContain('not a configuration gap')
  })

  test('missing baseUrl/apiKey = MISCONFIGURED (invalid configuration is its own state)', async () => {
    sdkConfig = { baseUrl: '', apiKey: '' }
    const report = await hostedImageAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.failureCategory).toBe('misconfigured')
    expect(report.httpStatus).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. Backend failures: 5xx and unexpected answers are NOT health
// ---------------------------------------------------------------------------

describe('LAXII probe: backend failure statuses never masquerade as health', () => {
  test('a 500 from the gateway host is UNHEALTHY (previously wrongly healthy)', async () => {
    fetchImpl = async () => new Response('{"error":"boom"}', { status: 500 })
    const report = await hostedImageAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.failureCategory).toBe('backend-error')
    expect(report.httpStatus).toBe(500)
  })

  test('an unexpected 4xx (405) is NOT a verified health response', async () => {
    fetchImpl = async () => new Response('', { status: 405 })
    const report = await hostedImageAdapter.health()
    expect(report.healthy).toBe(false)
    expect(report.failureCategory).toBe('backend-error')
    expect(report.httpStatus).toBe(405)
  })

  test('success paths keep their structured evidence (2xx healthy, 404 = known-absent metadata route)', async () => {
    fetchImpl = async () => new Response('{"data":[]}', { status: 200 })
    const ok = await hostedImageAdapter.health()
    expect(ok.healthy).toBe(true)
    expect(ok.httpStatus).toBe(200)
    expect(ok.failureCategory).toBeNull()

    fetchImpl = async () => new Response('', { status: 404 })
    const absent = await hostedImageAdapter.health()
    expect(absent.healthy).toBe(true)
    expect(absent.httpStatus).toBe(404)
    expect(absent.failureCategory).toBeNull()
    expect(absent.detail).toContain('does NOT run a generation')
  })

  test('credentials rejected / rate-limited keep their categories AND structured statuses', async () => {
    fetchImpl = async () => new Response('', { status: 401 })
    const auth = await hostedImageAdapter.health()
    expect(auth.healthy).toBe(false)
    expect(auth.failureCategory).toBe('auth')
    expect(auth.httpStatus).toBe(401)

    fetchImpl = async () => new Response('', { status: 429 })
    const limited = await hostedImageAdapter.health()
    expect(limited.healthy).toBe(false)
    expect(limited.failureCategory).toBe('rate-limited')
    expect(limited.httpStatus).toBe(429)
  })
})

// ---------------------------------------------------------------------------
// 4. Probe failure isolation (one broken probe ≠ four broken products)
// ---------------------------------------------------------------------------

describe('safeProbe: a throwing probe is isolated into an honest failed report', () => {
  test('a probe that THROWS becomes a failed HealthReport with backend-error category', async () => {
    const report = await safeProbe('iso-test-a', async () => {
      throw new Error('unexpected internal explosion')
    })
    expect(report.healthy).toBe(false)
    expect(report.failureCategory).toBe('backend-error')
    expect(report.latencyMs).toBeNull()
    expect(report.detail).toContain('isolated so other products are unaffected')
    expect(report.detail).toContain('unexpected internal explosion')
    // No stack trace leaks into the browser-visible detail.
    expect(report.detail).not.toContain('at ')
  })

  test('other probes are unaffected: a succeeding probe still returns its real result', async () => {
    const [failed, ok] = await Promise.all([
      safeProbe('iso-test-broken', async () => {
        throw new Error('probe X is broken')
      }),
      safeProbe('iso-test-ok', async () => ({
        healthy: true,
        checkedAt: new Date().toISOString(),
        latencyMs: 12,
        detail: 'real probe passed',
      })),
    ])
    expect(failed.healthy).toBe(false)
    expect(ok.healthy).toBe(true)
    expect(ok.latencyMs).toBe(12)
    // The failure did not contaminate the healthy report's evidence.
    expect(ok.detail).toBe('real probe passed')
  })
})

// ---------------------------------------------------------------------------
// 5. Last-success tracking (stale-info honesty)
// ---------------------------------------------------------------------------

describe('lastHealthyAt tracking: only REAL probe successes record a timestamp', () => {
  test('a healthy probe records lastHealthyAt; failures and cache replays do not fake it', async () => {
    const t0 = new Date().toISOString()
    const first = await safeProbe('lhs-key', async () => ({
      healthy: true,
      checkedAt: t0,
      latencyMs: 5,
      detail: 'first success',
    }))
    expect(first.healthy).toBe(true)
    expect(lastHealthyAtFor('lhs-key')).toBe(t0)

    // A later FAILURE leaves the last success untouched (it never erases
    // real history, and it never fabricates a new success).
    await safeProbe('lhs-key', async () => ({
      healthy: false,
      checkedAt: new Date().toISOString(),
      latencyMs: 7,
      detail: 'now failing',
    }))
    expect(lastHealthyAtFor('lhs-key')).toBe(t0)

    // A never-successful key has NO last-healthy timestamp (honest unknown).
    expect(lastHealthyAtFor('never-probed-key')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5b. Real-attempt evidence: a reachable gateway that THROTTLES generations
//     must not keep the product "Operational" (measured live 2026-11-04)
// ---------------------------------------------------------------------------

const {
  noteRealAttempt,
  recentUpstreamFailure,
  lastRealAttempt,
  _resetRealAttemptsForTests,
  ATTEMPT_FRESHNESS_MS,
} = await import('../../src/lib/adapters/last-attempts')
const { productStatus } = await import('../../src/lib/registry/status')

describe('real-attempt evidence: LAXII degradation from REAL generation outcomes', () => {
  beforeEach(() => {
    // Process-global store — each test starts with no attempt evidence.
    _resetRealAttemptsForTests()
  })
  test('a fresh upstream-class generation failure is status-affecting evidence', () => {
    noteRealAttempt('image-generation', {
      at: new Date().toISOString(),
      ok: false,
      backendId: 'bean-image-hosted-primary',
      failureCategory: 'rate-limited',
      httpStatus: 429,
      upstream: true,
    })
    const failure = recentUpstreamFailure('image-generation')
    expect(failure).not.toBeNull()
    expect(failure?.failureCategory).toBe('rate-limited')
    expect(failure?.httpStatus).toBe(429)
    // The probe (reachable) still passes, but the measured generation
    // capability is failing -> DEGRADED, never "Operational".
    const status = productStatus(true, {
      available: true,
      generation: { available: false, failureCategory: 'rate-limited', httpStatus: 429 },
    })
    expect(status).toBe('degraded')
  })

  test('a successful generation attempt overrides the failure evidence', () => {
    noteRealAttempt('image-generation', {
      at: new Date().toISOString(),
      ok: false,
      backendId: 'bean-image-hosted-primary',
      failureCategory: 'rate-limited',
      httpStatus: 429,
      upstream: true,
    })
    noteRealAttempt('image-generation', {
      at: new Date().toISOString(),
      ok: true,
      backendId: 'bean-image-hosted-primary',
      failureCategory: null,
      httpStatus: null,
      upstream: false,
    })
    expect(recentUpstreamFailure('image-generation')).toBeNull()
    expect(lastRealAttempt('image-generation')?.ok).toBe(true)
    const status = productStatus(true, {
      available: true,
      generation: { available: true, failureCategory: null, httpStatus: null },
    })
    expect(status).toBe('operational')
  })

  test('a content/user-specific rejection (non-upstream class) is NOT product-health evidence', () => {
    noteRealAttempt('image-generation', {
      at: new Date().toISOString(),
      ok: false,
      backendId: 'bean-image-hosted-primary',
      failureCategory: 'backend-error',
      httpStatus: 400,
      upstream: false,
    })
    expect(recentUpstreamFailure('image-generation')).toBeNull()
    const status = productStatus(true, { available: true })
    expect(status).toBe('operational')
  })

  test('failure evidence EXPIRES after the freshness window (falls back to the probe)', () => {
    noteRealAttempt('image-generation', {
      at: new Date(Date.now() - ATTEMPT_FRESHNESS_MS - 1000).toISOString(),
      ok: false,
      backendId: 'bean-image-hosted-primary',
      failureCategory: 'rate-limited',
      httpStatus: 429,
      upstream: true,
    })
    expect(recentUpstreamFailure('image-generation')).toBeNull()
    // The attempt is still visible as history, just not status-affecting.
    expect(lastRealAttempt('image-generation')?.ok).toBe(false)
  })

  test('a never-attempted product has no generation evidence and stays probe-driven', () => {
    expect(recentUpstreamFailure('image-generation' as never)).toBeNull()
    expect(productStatus(true, { available: true })).toBe('operational')
  })
})

// ---------------------------------------------------------------------------
// 6. Client timeout (connection handling on the browser side)
// ---------------------------------------------------------------------------

describe('beanFetch timeoutMs: a hung request resolves into an AbortError', () => {
  test('a fetch that never settles is aborted after the deadline', async () => {
    globalThis.fetch = ((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      })) as unknown as typeof fetch
    let error: Error | null = null
    try {
      await beanFetch('/api/health', { timeoutMs: 50 })
    } catch (e) {
      error = e as Error
    }
    expect(error).not.toBeNull()
    expect(error?.name).toBe('AbortError')
  }, 2000)

  test('a fast response is unaffected by the timeout option (unchanged shape)', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true, value: 42 }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    const data = await beanFetch<{ value: number }>('/api/anything', { timeoutMs: 1000 })
    expect(data.value).toBe(42)
  }, 2000)

  test('without timeoutMs the behavior is exactly as before (no abort wired)', async () => {
    let sawSignal: AbortSignal | null | undefined = undefined
    globalThis.fetch = ((_input, init) => {
      sawSignal = init?.signal
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    }) as unknown as typeof fetch
    await beanFetch('/api/anything')
    expect(sawSignal).toBeUndefined()
  }, 2000)
})
