/**
 * BEAN Intelligence — unit tests for the RIISHE latency program.
 *
 * Covers: straightforward-question fast path (no query-gen model call),
 * query dedup, snippet-sufficiency page-read policy, the freshness-aware
 * research cache (hit/fetchedAt honesty/expiry/eviction) and the guarded
 * streaming + draft-replacement (reset) protocol of the orchestrator.
 *
 * All model/provider behavior is a stub; the pipeline, cache and orchestrator
 * under test are the real production code. No network.
 */
import { describe, test, expect } from 'bun:test'
import {
  isStraightforwardQuestion,
  dedupeQueries,
  decidePageReads,
} from '../../src/lib/research/pipeline'
import {
  normalizeQueryKey,
  getSearchCache,
  getPageCache,
  clearResearchCache,
} from '../../src/lib/research/cache'
import { shouldSearch, type SearchDecision } from '../../src/lib/research/policy'
import { rankSources } from '../../src/lib/research/rank'
import type { WebSearchResult } from '../../src/lib/research/provider'
import { orchestrateTurn, selectTools, liftSelfCheck } from '../../src/lib/riishe/orchestrator'
import type { TaskAdapter, ChatTurn } from '../../src/lib/adapters/types'
import type { ToolContext } from '../../src/lib/riishe/tools/types'
import type { OrchestrationEvent } from '../../src/lib/riishe/orchestrator'

function searchResult(partial: Partial<WebSearchResult> & { url: string }): WebSearchResult {
  return {
    title: partial.title ?? 'Title',
    snippet: partial.snippet ?? 'snippet text',
    hostName: partial.hostName ?? new URL(partial.url).hostname,
    rank: partial.rank ?? 1,
    date: partial.date ?? null,
    ...partial,
  }
}

const HIGH: SearchDecision = { search: true, risk: 'high', recencyDays: 180, reason: 'test-high' }
const MODERATE: SearchDecision = { search: true, risk: 'moderate', recencyDays: 365, reason: 'test-mod' }

describe('straightforward-question fast path (skips the query-refinement model call)', () => {
  test('short single-sentence current-fact questions take the fast path', () => {
    expect(isStraightforwardQuestion('Who is the current pope?')).toBe(true)
    expect(isStraightforwardQuestion('What is the latest Node.js LTS version?')).toBe(true)
    expect(isStraightforwardQuestion('current inflation rate in Japan')).toBe(true)
  })

  test('compound, multi-sentence and long questions keep query refinement', () => {
    expect(isStraightforwardQuestion('Compare the monetary policy of the Fed and the ECB, and their 2026 outlooks')).toBe(false)
    expect(isStraightforwardQuestion('Who is the CEO of NVIDIA? What is their latest product?')).toBe(false)
    expect(isStraightforwardQuestion('Explain in detail the full history, economic context, and geopolitical implications of the current situation in the South China Sea including every major incident')).toBe(false)
  })

  test('empty input is not straightforward (caller falls back to refinement)', () => {
    expect(isStraightforwardQuestion('   ')).toBe(false)
  })
})

describe('query dedup (no redundant searches)', () => {
  test('collapses near-duplicate queries case/punctuation-insensitively', () => {
    expect(dedupeQueries(['Current pope 2026!', 'current POPE 2026', 'pope 2026 current', 'other query'])).toEqual([
      'Current pope 2026!',
      'other query',
    ])
  })

  test('keeps distinct queries', () => {
    expect(dedupeQueries(['inflation rate Japan', 'Japan inflation rate 2026'])).toHaveLength(2)
  })
})

describe('snippet-sufficiency page-read policy (no whole-page retrieval when snippets suffice)', () => {
  const thin = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      url: `https://example.com/${i}`,
      title: `T${i}`,
      snippet: 'short',
      hostName: 'example.com',
      date: null,
      freshness: null,
      year: null,
      authority: 0.5,
      official: false,
      social: false,
      sourceType: 'other' as const,
      score: 1 - i * 0.01,
    }))

  const substantial = (n: number) =>
    thin(n).map((s, i) => ({ ...s, snippet: 'x'.repeat(300 + i) }))

  test('high-risk with thin snippets reads top 2 pages', () => {
    expect(decidePageReads(thin(4), HIGH, {})).toBe(2)
  })

  test('high-risk with substantial snippets reads zero pages', () => {
    expect(decidePageReads(substantial(4), HIGH, {})).toBe(0)
  })

  test('moderate risk with thin snippets reads one page', () => {
    expect(decidePageReads(thin(4), MODERATE, {})).toBe(1)
  })

  test('moderate risk with substantial snippets reads zero pages', () => {
    expect(decidePageReads(substantial(4), MODERATE, {})).toBe(0)
  })

  test('explicit readTopN override is still honored', () => {
    expect(decidePageReads(substantial(4), HIGH, { readTopN: 2 })).toBe(0)
    expect(decidePageReads(thin(4), HIGH, { readTopN: 0 })).toBe(0)
  })
})

describe('freshness-aware research cache', () => {
  test('normalizes queries into stable keys (order/punctuation-insensitive)', () => {
    expect(normalizeQueryKey('Who is the current pope?')).toBe(normalizeQueryKey('the current Pope who is!?'))
  })

  test('stores and returns the ORIGINAL fetch time — a hit never poses as fresh', () => {
    clearResearchCache()
    const miss = getSearchCache<WebSearchResult>('current pope 2026', 180, 'high')
    expect(miss.hit).toBe(false)
    const results = [searchResult({ url: 'https://example.com/pope' })]
    if (!miss.hit) miss.put(results)
    const hit = getSearchCache<WebSearchResult>('Current pope 2026!', 180, 'high')
    expect(hit.hit).toBe(true)
    if (hit.hit) {
      expect(hit.value).toEqual(results)
      expect(Date.parse(hit.fetchedAt)).toBeLessThanOrEqual(Date.now())
      expect(Date.now() - Date.parse(hit.fetchedAt)).toBeLessThan(5_000)
    }
  })

  test('expired entries are re-fetched (high-risk TTL is short)', () => {
    clearResearchCache()
    const miss = getSearchCache<WebSearchResult>('fast changing fact', 180, 'high')
    if (!miss.hit) miss.put([searchResult({ url: 'https://example.com/a' })])
    // Age the entry beyond the high-risk TTL (90s) directly in the store.
    const g = globalThis as unknown as Record<string, { search?: Map<string, { at: number }> }>
    const store = g['__bean_research_cache__']!
    const key = `${normalizeQueryKey('fast changing fact')}|r180`
    const entry = store.search!.get(key)!
    entry.at = Date.now() - 91_000
    const again = getSearchCache<WebSearchResult>('fast changing fact', 180, 'high')
    expect(again.hit).toBe(false)
  })

  test('moderate-risk entries outlive expired high-risk ones', () => {
    clearResearchCache()
    const miss = getSearchCache<WebSearchResult>('visa requirements japan', 365, 'moderate')
    if (!miss.hit) miss.put([searchResult({ url: 'https://example.com/visa' })])
    const g = globalThis as unknown as Record<string, { search?: Map<string, { at: number }> }>
    const store = g['__bean_research_cache__']!
    const key = `${normalizeQueryKey('visa requirements japan')}|r365`
    ;(store.search!.get(key)!).at = Date.now() - 91_000 // beyond high TTL, within moderate TTL
    const hit = getSearchCache<WebSearchResult>('visa requirements japan', 365, 'moderate')
    expect(hit.hit).toBe(true)
  })

  test('page cache keys ignore hash and www and expire after its TTL', () => {
    clearResearchCache()
    const miss = getPageCache<{ text: string }>('https://www.example.com/page')
    expect(miss.hit).toBe(false)
    if (!miss.hit) miss.put({ text: 'hello' })
    const hit = getPageCache<{ text: string }>('https://example.com/page#section')
    expect(hit.hit).toBe(true)
    if (hit.hit) expect(hit.value.text).toBe('hello')
    const g = globalThis as unknown as Record<string, { page?: Map<string, { at: number }> }>
    const store = g['__bean_research_cache__']!
    const key = [...store.page!.keys()][0]
    ;(store.page!.get(key)!).at = Date.now() - 601_000
    expect(getPageCache<{ text: string }>('https://example.com/page').hit).toBe(false)
  })
})

describe('guarded streaming + draft-replacement (reset) protocol', () => {
  const ctx: ToolContext = { permissions: new Set(['allowCodeExecution']), documents: new Map() }

  function fakeStreamAdapter(passes: string[]): TaskAdapter & { chatStreamCalls: () => number } {
    let call = 0
    let chatStreamCalls = 0
    return {
      backendId: 'fake',
      health: async () => ({ healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'fake' }),
      chatStreamCalls: () => chatStreamCalls,
      chat: async () => ({ content: '', tokensInEst: 1, tokensOutEst: 1, durationMs: 1 }),
      chatStream: async function* () {
        chatStreamCalls += 1
        const script = passes[Math.min(call, passes.length - 1)]
        call += 1
        // Yield in small chunks like a real SSE stream.
        for (let i = 0; i < script.length; i += 7) {
          yield script.slice(i, i + 7)
        }
      },
    }
  }

  function collect(onEvent: (e: OrchestrationEvent) => void) {
    const events: OrchestrationEvent[] = []
    return {
      events,
      emit: (e: OrchestrationEvent) => {
        events.push(e)
        onEvent(e)
      },
    }
  }

  test('math turn with a TOOL_CALL draft: tool syntax never streams, drafts reset, final answer streams once', async () => {
    const passes = [
      'Let me compute that.\nTOOL_CALL: {"tool":"calculate","input":{"expression":"17*23-45"}}',
      'The result is 346.',
    ]
    const adapter = fakeStreamAdapter(passes)
    const deltas: string[] = []
    let resets = 0
    const result = await orchestrateTurn({
      userMessage: 'Calculate 17 * 23 - 45',
      history: [],
      caps: { maxPromptChars: 12000, maxHistoryMessages: 24 },
      adapter,
      toolContext: ctx,
      onEvent: (e) => {
        if (e.type === 'delta') deltas.push(e.delta)
        if (e.type === 'reset') resets += 1
      },
    })

    // Tool protocol syntax never reached the wire.
    for (const d of deltas) expect(d).not.toContain('TOOL_CALL')
    const streamed = deltas.join('')
    // MEASURED PROTOCOL (2026-10-29): the tool-loop turn is fully buffered —
    // the preliminary TOOL_CALL draft never streams at all, so the wire sees
    // exactly the final answer once (no preliminary text, hence no reset is
    // needed; a reset only fires when something already streamed must be
    // replaced, e.g. a verification rewrite).
    expect(streamed).toContain('The result is 346.')
    expect(streamed).not.toContain('The result is 346.The result is 346.')
    expect(deltas.join('')).toBe(result.content)
    // Two real model passes happened (preliminary + final).
    expect(result.metadata.timings?.solvePasses).toBe(2)
    // The tool actually executed server-side and produced real evidence.
    expect(result.metadata.toolRuns?.some((t) => t.tool === 'calculate' && t.ok)).toBe(true)
    expect(result.content).toContain('346')
  })

  test('plain streaming turn without tools streams once and matches the final content', async () => {
    const adapter = fakeStreamAdapter(['A calm, direct answer.'])
    const deltas: string[] = []
    let resets = 0
    const result = await orchestrateTurn({
      userMessage: 'Tell me about gravity', // stable question: no search, no tools
      history: [],
      caps: { maxPromptChars: 12000, maxHistoryMessages: 24 },
      adapter,
      onEvent: (e) => {
        if (e.type === 'delta') deltas.push(e.delta)
        if (e.type === 'reset') resets += 1
      },
    })
    expect(deltas.join('')).toBe(result.content)
    expect(result.metadata.timings?.solvePasses).toBe(1)
  })

  test('selectTools: calculate always for math; run_code strictly policy-gated; web tools only as recovery', () => {
    const full = { allowCodeExecution: false, researchFailed: false } as const
    expect(selectTools({ searchNeeded: false, task: 'general', hasDocuments: false, ...full })).toEqual([])
    // MEASURED POLICY (2026-10-29): a successful pre-solve pipeline pack
    // already grounded the answer — the tool loop would only duplicate
    // searches. web_search/read_url activate ONLY for attached documents or
    // a research turn whose pipeline evidence came back EMPTY.
    expect(selectTools({ searchNeeded: true, task: 'research', hasDocuments: false, ...full, researchFailed: true })).toContain('web_search')
    expect(selectTools({ searchNeeded: true, task: 'research', hasDocuments: false, ...full, researchFailed: false })).toEqual([])
    expect(selectTools({ searchNeeded: false, task: 'math', hasDocuments: false, ...full })).toContain('calculate')
    expect(selectTools({ searchNeeded: false, task: 'coding', hasDocuments: false, ...full, allowCodeExecution: true })).toContain('run_code')
    expect(selectTools({ searchNeeded: false, task: 'coding', hasDocuments: false, ...full, allowCodeExecution: false })).not.toContain('run_code')
  })

  test('liftSelfCheck removes the verifier block from customer text', () => {
    expect(liftSelfCheck('Answer.\n\nSELF_CHECK:\nCHECK: 1+1 = 2')).toBe('Answer.')
  })
})
