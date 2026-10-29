/**
 * Research provider error classification + bounded retry.
 *
 * Proves the explicit upstream-failure contract added after the measured
 * 502 diagnosis:
 *   - transient failures (429 / 5xx) get exactly ONE bounded retry;
 *   - a retry that succeeds returns real results (no fabrication);
 *   - a retry that fails again surfaces a TYPED error carrying the real
 *     provider reason (never a generic "unavailable");
 *   - timeouts and malformed payloads are NOT retried (they would double
 *     the latency budget for no benefit).
 */
import { describe, test, expect, mock } from 'bun:test'

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

describe('provider failure classification + bounded retry', () => {
  test('429 then success: one bounded retry recovers real results', async () => {
    const calls = mockSdk([
      () => new Error('Function invoke failed with status 429: {"error":"Too many requests"}'),
      () => SEARCH_OK,
    ])
    const results = await webSearch('current office holder', { num: 3 })
    expect(calls()).toBe(2)
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://example.gov/office')
  })

  test('429 twice: typed rate_limited error with the real reason, exactly two attempts', async () => {
    const calls = mockSdk([
      () => new Error('Function invoke failed with status 429: {"error":"Too many requests"}'),
      () => new Error('Function invoke failed with status 429: {"error":"Too many requests"}'),
    ])
    try {
      await webSearch('current office holder')
      throw new Error('expected webSearch to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(ResearchToolError)
      const err = e as InstanceType<typeof ResearchToolError>
      expect(err.kind).toBe('rate_limited')
      expect(err.message).toContain('429')
    }
    expect(calls()).toBe(2)
  })

  test('upstream 503 is retried once; if it persists the typed error says so', async () => {
    const calls = mockSdk([
      () => new Error('Function invoke failed with status 503: backend unavailable'),
      () => new Error('Function invoke failed with status 503: backend unavailable'),
    ])
    try {
      await webSearch('anything')
      throw new Error('expected webSearch to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(ResearchToolError)
      expect((e as InstanceType<typeof ResearchToolError>).kind).toBe('upstream_error')
      expect((e as InstanceType<typeof ResearchToolError>).message).toContain('503')
    }
    expect(calls()).toBe(2)
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
      const err = e as InstanceType<typeof ResearchToolError>
      expect(err.kind).toBe('timeout')
      expect(err.message).toContain('timed out after 200ms')
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
      expect((e as InstanceType<typeof ResearchToolError>).kind).toBe('malformed')
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
      expect((e as InstanceType<typeof ResearchToolError>).kind).toBe('malformed')
      expect((e as InstanceType<typeof ResearchToolError>).tool).toBe('page_reader')
    }
    expect(calls()).toBe(1)
  })
})
