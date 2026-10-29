/**
 * Research provider error classification at the upstream boundary.
 *
 * MEASURED CONTRACT (rewritten 2026-10-29 for the upstream-429 root-cause
 * fix): the provider makes EXACTLY ONE attempt per call — there is no retry
 * at this layer anymore. A 429 opens the per-endpoint-class cooldown breaker
 * (a retry here would fire into an actively throttling gateway; the bounded
 * transient-failure retry lives one layer up, in the pipeline, and is covered
 * by research-retry.test.ts). Typed failures:
 *   - 429         -> UpstreamRateLimitError (attempted=true) + breaker opens
 *   - breaker open -> UpstreamRateLimitError (attempted=false), ZERO network
 *   - 401/403     -> UpstreamAuthError; 402 -> UpstreamBillingError
 *   - timeout     -> ResearchToolError (timeout wording), NOT retried
 *   - other/malformed -> ResearchToolError with the REAL provider text
 *
 * Only the SDK boundary is scripted; the provider code under test is the
 * real production module. The breaker is process-global, so every test
 * resets it first.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'

/** Scripted SDK: each tool call consumes the next behavior in the script. */
function scriptedZai(script: Array<() => unknown>) {
  let call = 0
  const zai = {
    functions: {
      invoke: async () => {
        const step = script[Math.min(call, script.length - 1)]
        call += 1
        const out = typeof step === 'function' ? (step as () => unknown)() : step
        if (out instanceof Error) throw out
        return out
      },
    },
  }
  return { zai, calls: () => call }
}

function mockSdk(script: Array<() => unknown>) {
  const { zai, calls } = scriptedZai(script)
  mock.module('z-ai-web-dev-sdk', () => ({ default: { create: async () => zai } }))
  return calls
}

const SEARCH_OK = [
  { url: 'https://example.gov/office', name: 'Office holder', snippet: 'The current office holder is X.', host_name: 'example.gov', rank: 1, date: null },
]

// Import AFTER the mock registers.
const { webSearch, readPage, ResearchToolError } = await import('../../src/lib/research/provider')
const {
  UpstreamRateLimitError,
  UpstreamAuthError,
  UpstreamBillingError,
  _resetUpstreamCooldownForTests,
} = await import('../../src/lib/upstream/gateway')

beforeEach(() => {
  _resetUpstreamCooldownForTests()
})

afterEach(() => {
  // Never leak an open breaker into other test files in the same process.
  _resetUpstreamCooldownForTests()
})

describe('provider failure classification (one attempt, typed errors, breaker)', () => {
  test('429 is a typed rate_limited error with the real reason, EXACTLY ONE attempt (no retry into a throttle)', async () => {
    const calls = mockSdk([
      () => new Error('Function invoke failed with status 429: {"error":"Too many requests"}'),
      () => SEARCH_OK,
    ])
    try {
      await webSearch('current office holder')
      throw new Error('expected webSearch to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(UpstreamRateLimitError)
      const err = e as InstanceType<typeof UpstreamRateLimitError>
      expect(err.endpointClass).toBe('functions')
      expect(err.attempted).toBe(true)
      expect(err.message).toContain('429')
    }
    expect(calls()).toBe(1) // one attempt — the second scripted step is never consumed
  })

  test('an observed 429 opens the breaker: the next call fails fast with ZERO network traffic', async () => {
    const calls = mockSdk([
      () => new Error('Function invoke failed with status 429: {"error":"Too many requests"}'),
    ])
    await webSearch('first').catch(() => undefined)
    expect(calls()).toBe(1)

    try {
      await webSearch('second within cooldown')
      throw new Error('expected webSearch to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(UpstreamRateLimitError)
      const err = e as InstanceType<typeof UpstreamRateLimitError>
      expect(err.attempted).toBe(false) // deferred, never sent
      expect(err.message).toContain('not attempted')
    }
    expect(calls()).toBe(1) // breaker absorbed the second call — no new traffic
  })

  test('auth (401) and billing (402) are typed distinctly and do NOT open the breaker', async () => {
    const calls = mockSdk([
      () => new Error('Function invoke failed with status 401: {"error":"unauthorized"}'),
      () => new Error('Function invoke failed with status 402: {"error":"payment required"}'),
    ])
    try {
      await webSearch('a')
      throw new Error('expected webSearch to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(UpstreamAuthError)
      expect((e as InstanceType<typeof UpstreamAuthError>).status).toBe(401)
    }
    // The 401 did not open the breaker: this call reaches the gateway.
    try {
      await webSearch('b')
      throw new Error('expected webSearch to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(UpstreamBillingError)
      expect((e as InstanceType<typeof UpstreamBillingError>).status).toBe(402)
    }
    expect(calls()).toBe(2)
  })

  test('a non-429 upstream failure (503) stays a ResearchToolError with the REAL provider text, one attempt', async () => {
    const calls = mockSdk([
      () => new Error('Function invoke failed with status 503: backend unavailable'),
    ])
    try {
      await webSearch('anything')
      throw new Error('expected webSearch to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(ResearchToolError)
      expect((e as InstanceType<typeof ResearchToolError>).tool).toBe('web_search')
      expect((e as Error).message).toContain('503')
    }
    expect(calls()).toBe(1) // the bounded 5xx retry lives in the pipeline layer, not here
  })

  test('timeout is NOT retried (one attempt only)', async () => {
    const calls = mockSdk([
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(SEARCH_OK), 5_000)
        }),
    ])
    try {
      await webSearch('anything', { timeoutMs: 200 })
      throw new Error('expected webSearch to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(ResearchToolError)
      expect((e as Error).message).toContain('timed out after 200ms')
    }
    expect(calls()).toBe(1)
  }, 10_000)

  test('malformed (non-array) payload: typed malformed error, no retry', async () => {
    const calls = mockSdk([() => ({ unexpected: 'shape' })])
    try {
      await webSearch('anything')
      throw new Error('expected webSearch to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(ResearchToolError)
      expect((e as Error).message).toContain('Malformed search response')
    }
    expect(calls()).toBe(1)
  })

  test('page_reader malformed payload: typed malformed error, no retry', async () => {
    const calls = mockSdk([() => ({ data: { html: '' } })])
    try {
      await readPage('https://example.gov/page')
      throw new Error('expected readPage to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(ResearchToolError)
      expect((e as InstanceType<typeof ResearchToolError>).tool).toBe('page_reader')
    }
    expect(calls()).toBe(1)
  })

  test('a healthy response passes through unchanged (no extra provider call)', async () => {
    const calls = mockSdk([() => SEARCH_OK])
    const results = await webSearch('current office holder', { num: 3 })
    expect(calls()).toBe(1)
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://example.gov/office')
  })
})
