/**
 * LLM health-probe resilience — unit tests for the 2026-10-27 rate-limit
 * incident fix (false "Unavailable" on RIISHE + CODE GIFTZ).
 *
 * What is proven here (against the REAL production probe code, with only the
 * external SDK boundary fault-injected):
 *  1. a healthy probe is TTL-cached — dashboard loads stop consuming one
 *     real gateway completion per page view;
 *  2. concurrent callers share ONE in-flight probe (no duplicate gateway
 *     traffic);
 *  3. an HTTP 429 is retried exactly once (bounded), reported with
 *     rateLimited: true and an honest detail that separates provider
 *     throttling from product failure, and cached only briefly (10s) so
 *     recovery is visible fast;
 *  4. a hard non-429 failure is NOT retried and does not claim rate-limiting.
 *
 * The globalThis probe store is reset between scenarios via the documented
 * PROBE_STORE_KEY ('__bean_llm_probe_cache__').
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

const PROBE_STORE_KEY = '__bean_llm_probe_cache__'

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
type HealthReport = Awaited<ReturnType<typeof hostedLlmAdapter.health>>

function resetStore(): void {
  delete (globalThis as unknown as Record<string, unknown>)[PROBE_STORE_KEY]
}

function rewindStoreTtl(ms: number): void {
  const store = (globalThis as unknown as Record<string, unknown>)[PROBE_STORE_KEY] as
    | { at?: number }
    | undefined
  if (store?.at != null) store.at = store.at - ms
}

const OK_BODY = { choices: [{ message: { content: 'OK' } }] }

beforeEach(() => {
  resetStore()
  currentCreate = async () => OK_BODY
})

describe('LLM health probe cache + rate-limit semantics', () => {
  test('healthy probe is TTL-cached: a second health() call does not touch the gateway', async () => {
    let calls = 0
    currentCreate = async () => {
      calls++
      return OK_BODY
    }

    const first: HealthReport = await hostedLlmAdapter.health()
    const second: HealthReport = await hostedLlmAdapter.health()

    expect(calls).toBe(1) // one real probe, two health() calls
    expect(first.healthy).toBe(true)
    expect(first.rateLimited).toBeUndefined()
    expect(second).toBe(first) // identical cached report object
    expect(second.detail).toContain('live completion probe')
  })

  test('concurrent callers share one in-flight probe (no duplicate gateway traffic)', async () => {
    let calls = 0
    let release!: (v: unknown) => void
    const deferred = new Promise((resolve) => {
      release = resolve
    })
    currentCreate = async () => {
      calls++
      return deferred
    }

    const p1 = hostedLlmAdapter.health()
    const p2 = hostedLlmAdapter.health()
    release(OK_BODY)
    const [r1, r2] = (await Promise.all([p1, p2])) as HealthReport[]

    expect(calls).toBe(1)
    expect(r1).toBe(r2)
    expect(r1.healthy).toBe(true)
  })

  test('429 is retried exactly once, reported as rateLimited with honest detail, and briefly cached', async () => {
    let calls = 0
    currentCreate = async () => {
      calls++
      throw new Error('API request failed with status 429: {"error":"Too many requests, please try again later"}')
    }

    const t0 = Date.now()
    const report: HealthReport = await hostedLlmAdapter.health()
    const elapsed = Date.now() - t0

    // Exactly ONE backoff retry happened (2 gateway attempts total).
    expect(calls).toBe(2)
    // The retry really backed off before re-probing (>= the 3s backoff).
    expect(elapsed).toBeGreaterThanOrEqual(2_900)

    expect(report.healthy).toBe(false)
    expect(report.rateLimited).toBe(true)
    // Honest semantics: provider throttling, not a broken product.
    expect(report.detail).toContain('429')
    expect(report.detail).toContain('rate-limiting this deployment')
    expect(report.detail).toContain('product wiring is intact')

    // Rate-limited failure is cached only briefly: an immediate second call
    // must NOT re-probe…
    const cached: HealthReport = await hostedLlmAdapter.health()
    expect(calls).toBe(2)
    expect(cached).toBe(report)

    // …but once the short TTL lapses, the next health() probes again and a
    // recovered gateway flips the status back to healthy WITHOUT the flag.
    rewindStoreTtl(11_000)
    currentCreate = async () => {
      calls++
      return OK_BODY
    }
    const recovered: HealthReport = await hostedLlmAdapter.health()
    expect(calls).toBe(3)
    expect(recovered.healthy).toBe(true)
    expect(recovered.rateLimited).toBeUndefined()
  })

  test('hard non-429 failure is not retried and never claims rate-limiting', async () => {
    let calls = 0
    currentCreate = async () => {
      calls++
      throw new Error('API request failed with status 500: {"error":"internal"}')
    }

    const report: HealthReport = await hostedLlmAdapter.health()

    expect(calls).toBe(1) // no retry for non-429 failures
    expect(report.healthy).toBe(false)
    expect(report.rateLimited).toBeUndefined()
    expect(report.detail).toContain('500')
    expect(report.detail).not.toContain('rate-limiting this deployment')
  })
})
