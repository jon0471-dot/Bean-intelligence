/**
 * Bounded single-retry for transient search-provider failures.
 *
 * Measured evidence (worklog 2026-10-27, quota-recovery verification): the
 * web_search backend intermittently returns HTTP 422 "No search results
 * available" for a query it serves successfully seconds later. Previously one
 * such flake killed grounding for the whole turn (TOOL_UNAVAILABLE). The
 * pipeline now retries ONCE with the same query after a short backoff —
 * bounded, honest, never fabricated.
 *
 * Only the SDK boundary is scripted; the pipeline, cache and ranking are the
 * REAL production code. No fake success path exists — a scripted "failure"
 * only ever fails; "results" simulate a healthy provider the same way the
 * outage test simulates a dead one.
 */
import { describe, test, expect, mock } from 'bun:test'

type Behavior = 'healthy' | 'fail-first' | 'always-fail' | 'empty-first'

const behaviors = new Map<string, Behavior>()
const callsByQuery = new Map<string, number>()

const scriptedZai = {
  functions: {
    invoke: async (tool: string, args: { query: string }) => {
      if (tool !== 'web_search') throw new Error(`unexpected tool: ${tool}`)
      const n = (callsByQuery.get(args.query) ?? 0) + 1
      callsByQuery.set(args.query, n)
      const behavior = behaviors.get(args.query) ?? 'healthy'
      if (behavior === 'fail-first' && n === 1) {
        throw new Error(
          'Function invoke failed with status 500: No search results available for query',
        )
      }
      if (behavior === 'always-fail') {
        throw new Error('simulated web_search outage: provider returned 503')
      }
      if (behavior === 'empty-first' && n === 1) return []
      return [
        {
          url: `https://example.com/${encodeURIComponent(args.query)}-${n}`,
          name: `Result for ${args.query}`,
          // Substantial snippet (>260 chars) so the real pipeline's
          // snippet-sufficiency rule skips page reads (page_reader is not
          // scripted — these tests isolate the SEARCH retry behavior).
          snippet:
            'A substantive snippet carrying the grounded fact with enough context to answer the question directly. '.repeat(3),
          host_name: 'example.com',
          rank: 1,
          date: '2026-10-27',
        },
      ]
    },
  },
  chat: {
    completions: {
      create: async () => {
        throw new Error('query refinement must not run for straightforward questions')
      },
    },
  },
}

mock.module('z-ai-web-dev-sdk', () => ({ default: { create: async () => scriptedZai } }))

const { runResearch, SEARCH_RETRY_BACKOFF_MS } = await import('../../src/lib/research/pipeline')
import type { SearchDecision } from '../../src/lib/research/policy'

const DECISION: SearchDecision = { search: true, risk: 'high', recencyDays: 180, reason: 'test' }

// Unique message per test -> unique fast-path query -> no cross-test cache hits.
const msg = (tag: string) => `Unique retry probe ${tag}: what is the current status right now?`

describe('search bounded retry (transient provider flake)', () => {
  test('first attempt 422s, single retry recovers real grounding', async () => {
    const m = msg('recover')
    behaviors.set(m, 'fail-first')
    const pack = await runResearch(m, DECISION)
    expect(callsByQuery.get(m)).toBe(2) // exactly ONE extra provider call
    expect(pack.searchCalls).toBe(2)
    expect(pack.searchRetries).toBe(1)
    expect(pack.sources.length).toBeGreaterThan(0)
    expect(pack.degraded).toHaveLength(0) // recovery is not a degradation
    expect(pack.queries).toEqual([m])
  })

  test('hard outage: both attempts fail, degradation stays honest (exactly two calls, never loops)', async () => {
    const m = msg('outage')
    behaviors.set(m, 'always-fail')
    const pack = await runResearch(m, DECISION)
    expect(callsByQuery.get(m)).toBe(2) // bounded — no infinite retry
    expect(pack.searchCalls).toBe(2)
    expect(pack.searchRetries).toBe(1)
    expect(pack.sources).toHaveLength(0)
    expect(pack.degraded.join(' ')).toContain('web_search failed')
  })

  test('empty-but-healthy first response also gets exactly one retry', async () => {
    const m = msg('empty')
    behaviors.set(m, 'empty-first')
    const pack = await runResearch(m, DECISION)
    expect(callsByQuery.get(m)).toBe(2)
    expect(pack.searchRetries).toBe(1)
    expect(pack.sources.length).toBeGreaterThan(0)
    expect(pack.degraded).toHaveLength(0)
  })

  test('healthy first attempt: NO retry, NO extra provider call (latency guard)', async () => {
    const m = msg('healthy')
    behaviors.set(m, 'healthy')
    const pack = await runResearch(m, DECISION)
    expect(callsByQuery.get(m)).toBe(1)
    expect(pack.searchCalls).toBe(1)
    expect(pack.searchRetries).toBe(0)
    expect(pack.sources.length).toBeGreaterThan(0)
  })

  test('retry backoff is short and bounded (latency budget)', () => {
    expect(SEARCH_RETRY_BACKOFF_MS).toBeLessThanOrEqual(2_000)
  })
})
