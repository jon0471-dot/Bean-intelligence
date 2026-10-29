/**
 * Research-quality integration test — REAL orchestrator/pipeline/prompts,
 * fixture SDK boundary.
 *
 * The z-ai-web-dev-sdk boundary is the ONLY mock: it returns a FIXED search
 * result fixture (cross-query duplicates + a social-media result + an
 * official police domain), a page fixture with JSON-LD dates, and a
 * two-pass solver script (first pass with an unattributed allegation + an
 * invalid citation id, second pass the corrected, attributed rewrite). This
 * proves the wiring — sensitive-case query set, page-read date extraction,
 * claim-support repair, official/social flags, citation audit — against real
 * production code. Live gateway acceptance is proven separately by the
 * e2e script (vendor 429s permitting).
 */
import { describe, test, expect, mock } from 'bun:test'
import type { TaskAdapter } from '../../src/lib/adapters/types'

// ---- Fixture search results (clearly synthetic; used ONLY to test wiring) --
const SEARCH_RESULTS = [
  {
    url: 'https://www.thehindu.com/news/national/tamil-nadu/gingee-search',
    name: 'Gingee girl search: police expand operation',
    snippet: 'Police confirmed the search operation continues.',
    host_name: 'www.thehindu.com',
    rank: 1,
    date: '2026-10-20',
  },
  {
    url: 'https://x.com/user/status/999',
    name: 'Twitter post claiming a suspect',
    snippet: 'Unverified claims about a suspect.',
    host_name: 'x.com',
    rank: 2,
    date: '2026-10-21',
  },
  {
    url: 'https://x.com/user/status/999?utm=share', // duplicate of the above
    name: 'Twitter post claiming a suspect (share)',
    snippet: 'Same post via share link.',
    host_name: 'x.com',
    rank: 3,
    date: '2026-10-21',
  },
  {
    url: 'https://www.thehindu.com/news/national/tamil-nadu/gingee-search?utm=rss', // duplicate of the first
    name: 'Gingee girl search (RSS variant)',
    snippet: 'Same article via RSS.',
    host_name: 'www.thehindu.com',
    rank: 4,
    date: '2026-10-20',
  },
  {
    url: 'https://tnpolice.gov.in/press/gingee-missing',
    name: 'Villupuram police press note',
    snippet: 'Official police statement on the Gingee missing case.',
    host_name: 'tnpolice.gov.in',
    rank: 5,
    date: '2026-10-22',
  },
]

const PAGE_TEXT =
  'Police said the search for the missing girl continues and no arrest has been made. '.repeat(6)
const PAGE_HTML =
  '<html><head><script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-22T09:00:00+05:30"}</script></head>' +
  `<body><article><p>${PAGE_TEXT}</p></article></body></html>`

let searchCalls = 0
const fixtureZai = {
  functions: {
    invoke: async (tool: string, input: { query?: string; url?: string }) => {
      if (tool === 'web_search') {
        searchCalls += 1
        // Every query returns the same fixture pool -> exercises dedup.
        return SEARCH_RESULTS
      }
      if (tool === 'page_reader') {
        return { data: { url: input.url, title: 'Page', html: PAGE_HTML, publishedTime: null } }
      }
      throw new Error(`unexpected tool ${tool}`)
    },
  },
  chat: {
    completions: {
      create: async () => {
        // Query-gen: refined queries with NEITHER a freshness intent nor an
        // official-statement intent, so the deterministic sensitive-case
        // query set must supply both (that is the contract under test).
        return {
          choices: [
            {
              message: {
                content:
                  '{"queries": ["Gingee girl missing search", "Gingee missing case timeline"]}',
              },
            },
          ],
        }
      },
    },
  },
}

mock.module('z-ai-web-dev-sdk', () => ({ default: { create: async () => fixtureZai } }))

const { orchestrateTurn } = await import('../../src/lib/riishe/orchestrator')
const { clearResearchCache } = await import('../../src/lib/research/cache')

/** Recording adapter with a scripted sequence of replies (per solve pass). */
function scriptedAdapter(replies: string[]): TaskAdapter & { prompts: string[] } {
  const prompts: string[] = []
  let i = 0
  return {
    prompts,
    backendId: 'stub-scripted',
    async health() {
      return { healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'stub' }
    },
    async chat(init: { messages: Array<{ role: string; content: string }> }) {
      prompts.push(init.messages.map((m) => m.content).join('\n---\n'))
      return { content: replies[Math.min(i++, replies.length - 1)], tokensInEst: 10, tokensOutEst: 5, durationMs: 1 }
    },
    // nonStreaming path used by the test
    async *chatStream() {
      yield ''
    },
  } as unknown as TaskAdapter & { prompts: string[] }
}

const CAPS = { maxPromptChars: 100_000, maxHistoryMessages: 12 }

describe('research-quality integration (fixture SDK, real orchestrator)', () => {
  test('incident turn: sensitive queries, dedup, official/social flags, date extraction, repair', async () => {
    clearResearchCache()
    searchCalls = 0
    // Pass 1 makes an unattributed allegation ("Ravi Kumar abducted the girl")
    // and cites an out-of-range id [5] -> the bounded claim-repair pass must
    // fire. Pass 2 is the attributed, properly cited rewrite.
    const adapter = scriptedAdapter([
      'Search teams expanded the operation. Ravi Kumar abducted the girl. [5]',
      'Search teams expanded the operation [1]. Local reporting attributed the claim to police, who stated no arrest has been made [2].',
    ])

    const result = await orchestrateTurn({
      userMessage: 'Research a current topic: Gingee girl missing',
      history: [],
      caps: CAPS,
      adapter,
      nonStreaming: true,
      backendCapabilities: ['general', 'math', 'coding', 'research', 'document'],
    })

    // 1. the sensitive-case query set deterministically added BOTH targeted
    //    searches (newest coverage + official statements)
    expect(result.metadata.degraded.some((d) => d.includes('newest-coverage query'))).toBe(true)
    expect(result.metadata.degraded.some((d) => d.includes('official-statement query'))).toBe(true)
    expect(searchCalls).toBeGreaterThanOrEqual(4) // 2 LLM queries + 2 deterministic

    // 2. the solver prompt contained the sensitive-case + research-shape protocols
    expect(adapter.prompts[0]).toContain('Sensitive ongoing-case protocol')
    expect(adapter.prompts[0]).toContain('Research answer structure')
    expect(adapter.prompts[0]).toContain('OFFICIALLY CONFIRMED')

    // 3. the repair pass actually ran (second solve pass)
    expect(adapter.prompts.length).toBe(2)
    expect(adapter.prompts[1]).toContain('claim-support audit found problems')
    expect(adapter.prompts[1]).toContain('WITHOUT attribution')

    // 4. final content is the rewrite; allegation gone; citations canonical
    expect(result.content).toContain('no arrest has been made [2]')
    expect(result.content).not.toContain('Ravi Kumar abducted')

    // 5. sources: deduped fixture pool (Hindu article, police, x.com post)
    const sources = result.metadata.sources
    const urls = sources.map((s) => s.url.split('?')[0])
    expect(new Set(urls).size).toBe(urls.length) // no duplicate URLs
    expect(urls.some((u) => u.includes('tnpolice.gov.in'))).toBe(true)
    const police = sources.find((s) => s.url.includes('tnpolice.gov.in'))
    expect(police?.official).toBe(true)
    // Cited-only display contract: the answer cited the police note and the
    // Hindu article, so the UNCITED social post is not listed as a displayed
    // source (it supported nothing). The social classification itself is
    // unit-tested in research-merge.test.ts.
    expect(urls.some((u) => u.includes('x.com'))).toBe(false)
    expect(sources.every((s) => !s.social)).toBe(true)

    // 6. page-read date extraction: the page's JSON-LD datePublishED is the
    //    authoritative publication date and OVERRIDES the search date
    const hindu = sources.find((s) => s.url.includes('thehindu.com'))
    expect(hindu?.pageRead).toBe(true)
    expect(hindu?.date).toBe('2026-10-22T09:00:00+05:30')

    // 7. states + verification honesty
    expect(result.metadata.states).toContain('VERIFIED_FROM_SOURCES')
    const guard = result.metadata.verification.find((v) => v.check === 'sensitive-case guard')
    expect(guard?.status).toBe('passed')
    expect(result.metadata.retrievedAt).toBeTruthy()
  })
})
