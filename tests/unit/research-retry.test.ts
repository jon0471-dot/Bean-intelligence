/**
 * Bounded single-retry for transient search-provider failures (pipeline layer).
 *
 * Measured evidence (worklog 2026-10-27, quota-recovery verification): the
 * web_search backend intermittently returns HTTP 422 "No search results
 * available" for a query it serves successfully seconds later. One such flake
 * must not kill grounding for the whole turn. The pipeline retries ONCE with
 * the same query after a short backoff — bounded, honest, never fabricated —
 * while a 429 is NEVER retried (breaker + typed error; provider-retry.test.ts
 * covers that contract at the boundary).
 *
 * Only the SDK boundary is scripted; the pipeline, cache and ranking are the
 * REAL production code. Behavior keys use toSearchQuery() — the pipeline
 * strips directive scaffolding ("right now?", "Research ...") before
 * searching, so the test keys on the query the provider will actually see.
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

mock.module('../../src/lib/research/direct', () => ({
  // The independent lane is a REAL network path (Wikipedia API, official
  // sources). These tests exercise gateway retry/repair semantics, so the
  // lane is neutralized at its module boundary; its live behavior is covered
  // by scripts/riishe-gateway-down-acceptance.test.ts (real network).
  runDirectRetrieval: async () => ({ results: [], pages: [], notes: [] }),
  directFetchPage: async () => {
    throw new Error('direct fetch disabled in this test')
  },
  isUsablePageText: (text: string) => text.trim().length >= 200,
  PAGE_MIN_USEFUL_CHARS: 200,
  // MEASURED FIX (2026-11-10): pipeline.ts statically binds these two
  // helpers; a partial mock record fails ESM linking ("Export named
  // 'resolveRedirectUrl' not found"). Under these tests' premise they are
  // never reached, so honest pure stubs suffice.
  isRedirectWrapperUrl: (url: string) => /google\.[^/]+\/goto|news\.google\.com/i.test(url ?? ''),
  resolveRedirectUrl: async (url: string) => url,
}))

const { runResearch, toSearchQuery, SEARCH_RETRY_BACKOFF_MS } = await import(
  '../../src/lib/research/pipeline'
)
const { _resetUpstreamCooldownForTests } = await import('../../src/lib/upstream/gateway')
import type { SearchDecision } from '../../src/lib/research/policy'

const DECISION: SearchDecision = { search: true, risk: 'high', recencyDays: 180, reason: 'test' }

// Unique message per test -> unique fast-path query -> no cross-test cache
// hits. The KEY is the query the provider actually receives (post-cleaning).
// The wording survives toSearchQuery unchanged (no directive prefix, no
// "right now" tail) — the guard test below turns any drift into a loud fail.
const msg = (tag: string) => `Unique retry probe ${tag}: what is the current status?`
const keyOf = (tag: string) => toSearchQuery(msg(tag))

describe('search bounded retry (transient provider flake)', () => {
  test('toSearchQuery keys match what the provider receives (guard against contract drift)', () => {
    // If the cleaner ever rewrites these fixtures, the keyed behaviors below
    // would silently stop matching — this guard turns that into a loud fail.
    for (const tag of ['recover', 'outage', 'empty', 'healthy']) {
      expect(keyOf(tag)).toBe(msg(tag))
    }
  })

  test('first attempt 422s, single retry recovers real grounding', async () => {
    _resetUpstreamCooldownForTests()
    const m = msg('recover')
    const k = keyOf('recover')
    behaviors.set(k, 'fail-first')
    const pack = await runResearch(m, DECISION)
    expect(callsByQuery.get(k)).toBe(2) // exactly ONE extra provider call
    expect(pack.searchCalls).toBe(2)
    expect(pack.sources.length).toBeGreaterThan(0)
    expect(pack.degraded).toHaveLength(0) // recovery is not a degradation
    expect(pack.queries).toEqual([k])
  })

  test('hard outage: both attempts fail, degradation stays honest (exactly two calls, never loops)', async () => {
    _resetUpstreamCooldownForTests()
    const m = msg('outage')
    const k = keyOf('outage')
    behaviors.set(k, 'always-fail')
    const pack = await runResearch(m, DECISION)
    expect(callsByQuery.get(k)).toBe(2) // bounded — no infinite retry
    expect(pack.searchCalls).toBe(2)
    expect(pack.sources).toHaveLength(0)
    expect(pack.degraded.join(' ')).toContain('web_search failed')
  })

  test('empty-but-healthy first response also gets exactly one retry', async () => {
    _resetUpstreamCooldownForTests()
    const m = msg('empty')
    const k = keyOf('empty')
    behaviors.set(k, 'empty-first')
    const pack = await runResearch(m, DECISION)
    expect(callsByQuery.get(k)).toBe(2)
    expect(pack.sources.length).toBeGreaterThan(0)
    expect(pack.degraded).toHaveLength(0)
  })

  test('healthy first attempt: NO retry, NO extra provider call (latency guard)', async () => {
    _resetUpstreamCooldownForTests()
    const m = msg('healthy')
    const k = keyOf('healthy')
    behaviors.set(k, 'healthy')
    const pack = await runResearch(m, DECISION)
    expect(callsByQuery.get(k)).toBe(1)
    expect(pack.searchCalls).toBe(1)
    expect(pack.sources.length).toBeGreaterThan(0)
  })

  test('retry backoff is short and bounded (latency budget)', () => {
    expect(SEARCH_RETRY_BACKOFF_MS).toBeLessThanOrEqual(2_000)
  })
})
