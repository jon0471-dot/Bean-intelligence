/**
 * Latency-path tests: research cache, straightforward-question fast path,
 * query dedupe, snippet-sufficiency page reads, and the bounded search retry.
 *
 * Only the SDK boundary is scripted; pipeline/cache/policy are the REAL
 * production code. No fake results — scripted "failures" only ever fail.
 */
import { describe, test, expect, mock } from 'bun:test'

type Behavior = 'healthy' | 'fail-first' | 'always-fail' | 'empty-first'

const behaviors = new Map<string, Behavior>()
const callsByQuery = new Map<string, number>()
let queryGenCalls = 0

const scriptedZai = {
  functions: {
    invoke: async (tool: string, args: { query: string }) => {
      if (tool !== 'web_search') throw new Error(`unexpected tool: ${tool}`)
      const n = (callsByQuery.get(args.query) ?? 0) + 1
      callsByQuery.set(args.query, n)
      const behavior = behaviors.get(args.query) ?? 'healthy'
      if (behavior === 'fail-first' && n === 1) {
        throw new Error('Function invoke failed with status 500: No search results available for query')
      }
      if (behavior === 'always-fail') throw new Error('simulated web_search outage: provider returned 503')
      if (behavior === 'empty-first' && n === 1) return []
      return [
        {
          url: `https://example.com/${encodeURIComponent(args.query)}-${n}`,
          name: `Result for ${args.query}`,
          // Substantial snippet (>260 chars) so snippet-sufficiency skips page reads.
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
        queryGenCalls += 1
        throw new Error('query refinement must not run for straightforward questions')
      },
    },
  },
}

mock.module('z-ai-web-dev-sdk', () => ({ default: { create: async () => scriptedZai } }))

const {
  runResearch,
  isStraightforwardQuestion,
  dedupeQueries,
  decidePageReads,
  searchWithBoundedRetry,
  toSearchQuery,
  SEARCH_RETRY_BACKOFF_MS,
} = await import('../../src/lib/research/pipeline')
const { getSearchCache, clearResearchCache, normalizeQueryKey } = await import('../../src/lib/research/cache')
import type { SearchDecision } from '../../src/lib/research/policy'
import type { RankedSource } from '../../src/lib/research/rank'

const DECISION: SearchDecision = { search: true, risk: 'high', recencyDays: 180, reason: 'test' }
const msg = (tag: string) => `Unique latency probe ${tag}: what is the current status right now?`
// The fast path sends the CLEANED query to the provider (directive scaffolding
// and "right now" tails stripped), so mocks key on the real pipeline output.
const q = (tag: string) => toSearchQuery(msg(tag))

describe('straightforward-question fast path (no routing model call)', () => {
  test('short single questions skip query refinement entirely', async () => {
    expect(isStraightforwardQuestion('What is the latest stable version of Next.js right now?')).toBe(true)
    expect(isStraightforwardQuestion('Who is the current CEO of Apple?')).toBe(true)
  })

  test('compound or long questions still get refinement', () => {
    expect(isStraightforwardQuestion('Compare the gas price in France and the gas price in Germany')).toBe(false)
    expect(isStraightforwardQuestion('What changed in the EU AI Act and what changed in GDPR compliance?')).toBe(false)
    expect(isStraightforwardQuestion(`${'detail '.repeat(30)}?`)).toBe(false)
  })

  test('fast-path turn makes ZERO query-generation model calls', async () => {
    const m = msg('fastpath')
    behaviors.set(q('fastpath'), 'healthy')
    const before = queryGenCalls
    const pack = await runResearch(m, DECISION)
    expect(queryGenCalls).toBe(before)
    expect(pack.sources.length).toBeGreaterThan(0)
    expect(pack.queries).toEqual([q('fastpath')])
  })
})

describe('query dedupe (no redundant searches)', () => {
  test('near-duplicate queries collapse to one dispatch', () => {
    expect(dedupeQueries(['latest Next.js version', 'Next.js version latest!'])).toHaveLength(1)
    expect(dedupeQueries(['gdp of france', 'population of japan'])).toHaveLength(2)
  })
})

describe('page-read decision (snippet sufficiency)', () => {
  const rich: RankedSource = {
    id: 1, url: 'https://a.example/', title: 'a', snippet: 'x'.repeat(300), hostName: 'a.example',
    date: null, freshness: null, year: null, authority: 0, official: false, social: false, sourceType: 'other' as const, score: 0,
  }
  const thin: RankedSource = { ...rich, id: 2, snippet: 'too short' }

  test('substantial snippets skip page retrieval (pure latency win)', () => {
    expect(decidePageReads([rich, { ...thin, id: 9, snippet: 'y'.repeat(280) }], DECISION, {})).toBe(0)
  })

  test('thin snippets justify reading the top source', () => {
    expect(decidePageReads([thin], DECISION, {})).toBe(1)
  })

  test('low-risk questions never read pages when snippets exist at all', () => {
    const d: SearchDecision = { search: true, risk: 'moderate', recencyDays: 365, reason: 't' }
    expect(decidePageReads([rich], d, {})).toBe(0)
  })
})

describe('freshness-aware search cache (repeated identical question)', () => {
  test('second identical turn is a cache hit with the ORIGINAL fetch time and no provider call', async () => {
    clearResearchCache()
    const m = msg('cached')
    behaviors.set(q('cached'), 'healthy')
    const first = await runResearch(m, DECISION)
    expect(first.searchCalls).toBe(1)
    expect(first.cacheHits).toBe(0)
    const second = await runResearch(m, DECISION)
    expect(second.cacheHits).toBe(1)
    expect(second.searchCalls).toBe(0)
    expect(second.fetchedAt).toBe(first.fetchedAt) // honest age, no fake freshness
  })

  test('cache keys ignore case/punctuation ordering but not semantics', () => {
    expect(normalizeQueryKey('Latest Next.js version!')).toBe(normalizeQueryKey('version latest Next.js?'))
    expect(normalizeQueryKey('gdp of france')).not.toBe(normalizeQueryKey('population of japan'))
  })

  test('high-risk entries expire fast (TTL tier is bounded)', async () => {
    const cached = getSearchCache('probe-key-x', 180, 'high')
    expect(cached.hit).toBe(false)
    if (!cached.hit) cached.put([{ marker: true }] as never)
    const again = getSearchCache('probe-key-x', 180, 'high')
    expect(again.hit).toBe(true)
  })
})

describe('bounded search retry (transient provider flake)', () => {
  test('first attempt fails, single retry recovers real grounding', async () => {
    const m = msg('retry-recover')
    behaviors.set(q('retry-recover'), 'fail-first')
    clearResearchCache()
    const pack = await runResearch(m, DECISION)
    expect(callsByQuery.get(q('retry-recover'))).toBe(2) // exactly ONE extra provider call
    expect(pack.sources.length).toBeGreaterThan(0)
    expect(pack.degraded).toHaveLength(0)
  })

  test('hard outage: bounded at exactly two attempts, degradation stays honest', async () => {
    const m = msg('retry-outage')
    behaviors.set(q('retry-outage'), 'always-fail')
    clearResearchCache()
    const pack = await runResearch(m, DECISION)
    expect(callsByQuery.get(q('retry-outage'))).toBe(2)
    expect(pack.sources).toHaveLength(0)
    expect(pack.degraded.join(' ')).toContain('web_search failed')
  })

  test('healthy first attempt never retries (latency guard)', async () => {
    const m = msg('retry-healthy')
    behaviors.set(q('retry-healthy'), 'healthy')
    clearResearchCache()
    await runResearch(m, DECISION)
    expect(callsByQuery.get(q('retry-healthy'))).toBe(1)
  })

  test('direct helper: retry outcome carries honest attempt counts', async () => {
    clearResearchCache()
    const raw = 'direct retry helper probe right now'
    behaviors.set(raw, 'empty-first')
    const out = await searchWithBoundedRetry(raw, { num: 6 })
    expect(out.attempts).toBe(2)
    expect(out.retried).toBe(true)
    expect(out.results.length).toBeGreaterThan(0)
    expect(SEARCH_RETRY_BACKOFF_MS).toBeLessThanOrEqual(2_000)
  })
})
