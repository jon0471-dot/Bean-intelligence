/**
 * BEAN Intelligence — RIISHE bounded-retry behavior tests
 * (2026-11-12 approved minimal live-research reliability fix).
 *
 * Pins the retry contract through the REAL pipeline boundary with the SDK
 * mocked (the mock only throws — it can never fabricate results):
 *   - the REAL wrapped 500/429/42900 failure performs EXACTLY ONE attempt,
 *     opens the functions-class 429 breaker (fail-fast/breaker contract);
 *   - the authoritative wrapped 422 "No search results available" performs
 *     NO doomed retry (attempts === 1) and reports noResults honestly;
 *   - a transient plain 500 (no inner signal) KEEPS its single bounded
 *     retry (pre-existing measured behavior preserved);
 *   - runResearch's degraded notes distinguish authoritative empty results
 *     from failures, and the independent-lane notes survive in the pack.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

let invokeCalls = 0
let throwMessage: string | null = null

mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      functions: {
        invoke: async () => {
          invokeCalls += 1
          if (throwMessage) throw new Error(throwMessage)
          return []
        },
      },
    }),
  },
}))

const { searchWithBoundedRetry, runResearch } = await import('../../src/lib/research/pipeline')
const {
  classifyUpstreamError,
  upstreamBreakerState,
  _resetUpstreamCooldownForTests,
} = await import('../../src/lib/upstream/gateway')

const WRAPPED_429 =
  'Failed to invoke remote function: Error: Function invoke failed with status 500: ' +
  '{"result":null,"error":"Search failed: request failed with status 429: ' +
  '{\\"code\\":429,\\"message\\":\\"Primary search failed: ReadTimeout(ReadTimeoutError(' +
  '\\"HTTPSConnectionPool(host=\'google.serper.dev.psmoe.com\', port=443): Read timed out. ' +
  '(read timeout=4)\\"))\\",\\"name\\":\\"UpstreamAPIError\\",\\"status\\":42900}",' +
  '"name":"UpstreamAPIError","status":42900}'

const WRAPPED_422 =
  'Failed to invoke remote function: Error: Function invoke failed with status 500: ' +
  '{"result":null,"error":"Search failed: request failed with status 422: ' +
  '{\\"code\\":422,\\"message\\":\\"No search results available for query ' +
  '\\\"q\\\"\\",\\"name\\":\\"UpstreamAPIError\\",\\"status\\":42206},' +
  '"name":"UpstreamAPIError","status":42206}'

beforeEach(() => {
  invokeCalls = 0
  throwMessage = null
  _resetUpstreamCooldownForTests()
})

describe('wrapped 429: fail-fast on the documented breaker contract', () => {
  test('exactly ONE attempt, no retry into the throttle, breaker opens', async () => {
    throwMessage = WRAPPED_429
    const outcome = await searchWithBoundedRetry('who is the current president of the united states', {})
    expect(outcome.attempts).toBe(1)
    expect(outcome.retried).toBe(false)
    expect(outcome.noResults).toBe(false)
    expect(outcome.results).toEqual([])
    expect(outcome.error).toContain('429')
    expect(invokeCalls).toBe(1) // EXACTLY one real provider call — no doomed retry
    const breaker = upstreamBreakerState('functions')
    expect(breaker.coolingDown).toBe(true) // the 429 was actually OBSERVED now
    expect(breaker.consecutive429s).toBe(1)
  })

  test('classification feeds the same path as a direct 429 (no behavior drift)', () => {
    expect(classifyUpstreamError(new Error(WRAPPED_429)).kind).toBe('rate_limited')
  })
})

describe('authoritative 422 zero-results: no doomed retry', () => {
  test('attempts === 1 and the outcome reports honest empty results', async () => {
    throwMessage = WRAPPED_422
    const outcome = await searchWithBoundedRetry('some extremely specific nonexistent widget', {})
    expect(outcome.attempts).toBe(1)
    expect(outcome.retried).toBe(false)
    expect(outcome.noResults).toBe(true)
    expect(outcome.results).toEqual([])
    expect(invokeCalls).toBe(1) // one authoritative answer — retrying is pointless
  })
})

describe('transient failures keep their single bounded retry (preserved behavior)', () => {
  test('a plain 500 with no inner signal still gets exactly one retry', async () => {
    throwMessage = 'Function invoke failed with status 500: upstream exploded'
    const outcome = await searchWithBoundedRetry('transient failure query', {})
    expect(outcome.attempts).toBe(2)
    expect(outcome.retried).toBe(true)
    expect(invokeCalls).toBe(2)
    expect(outcome.noResults).toBe(false)
  })
})

describe('runResearch degraded notes separate outages from authoritative empty results', () => {
  test('wrapped 422 produces the honest "returned no results" note, not "failed"', async () => {
    throwMessage = WRAPPED_422
    const pack = await runResearch('some extremely specific nonexistent widget test', {
      search: true,
      risk: 'high',
      reason: 'acceptance: wrapped-422 classification',
    })
    expect(pack.sources.length).toBe(0)
    expect(pack.degraded.some((d) => d.includes('returned no results'))).toBe(true)
    expect(pack.degraded.some((d) => d.includes('not an outage'))).toBe(true)
  }, 30_000)

  test('wrapped 429 still reads as a search failure (outage wording)', async () => {
    throwMessage = WRAPPED_429
    const pack = await runResearch('who is the current prime minister of india', {
      search: true,
      risk: 'high',
      reason: 'acceptance: wrapped-429 classification',
    })
    expect(pack.degraded.some((d) => d.includes('failed:'))).toBe(true)
    expect(pack.degraded.some((d) => d.includes('returned no results (authoritative'))).toBe(false)
  }, 30_000)

  test('the independent-lane diagnostics are present in the pack (persisted next by the orchestrator)', async () => {
    throwMessage = WRAPPED_429
    const pack = await runResearch('what is the latest stable Node.js version', {
      search: true,
      risk: 'high',
      reason: 'acceptance: independent-lane diagnostics',
    })
    expect(Array.isArray(pack.independent)).toBe(true)
    expect((pack.independent ?? []).length).toBeGreaterThan(0)
    expect(pack.searchCalls).toBeGreaterThanOrEqual(1)
  }, 45_000)
})
