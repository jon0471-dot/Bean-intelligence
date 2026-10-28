/**
 * Research-quality integration test — REAL orchestrator/pipeline/prompts,
 * fixture SDK boundary.
 *
 * The z-ai-web-dev-sdk boundary is the ONLY mock: it returns a FIXED search
 * result fixture (cross-query duplicates + a social-media result), a page
 * fixture with JSON-LD dates, and a two-pass solver script (first pass with
 * an unattributed allegation + a duplicate-source citation, second pass the
 * corrected rewrite). This proves the wiring — dedup, id remap, staleness,
 * incident freshness query, sensitive-case guard rewrite, citation audit —
 * against real production code. Live gateway acceptance is proven separately
 * by scripts/e2e-research-quality.sh (vendor 429s permitting).
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

const PAGE_HTML =
  '<html><head><script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-22T09:00:00+05:30"}</script></head>' +
  '<body><article><p>Police said the search for the missing girl continues and no arrest has been made.</p></article></body></html>'

let searchCalls = 0
const fixtureZai = {
  functions: {
    invoke: async (tool: string, input: { query?: string; url?: string }) => {
      if (tool === 'web_search') {
        searchCalls += 1
        // Both queries return the same fixture pool -> exercises dedup.
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
        // Query-gen: return a refined query set (JSON protocol).
        return {
          choices: [
            {
              message: {
                content:
                  '{"queries": ["Gingee girl missing search update", "Gingee missing case police statement"]}',
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
const { buildSystemPrompt } = await import('../../src/lib/riishe/prompts')

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
  test('incident turn: freshness query, dedup+remap, official/social flags, sensitive rewrite', async () => {
    searchCalls = 0
    // Pass 1 cites the DUPLICATE id [5] (second Hindu entry in fixture order
    // after rank/dedup this maps to the canonical id) and makes an
    // unattributed allegation -> triggers the bounded rewrite.
    // Pass 2 (the rewrite) attributes the allegation and cites properly.
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

    // 1. incident detection added the deterministic newest-coverage query
    expect(result.metadata.degraded.some((d) => d.includes('newest-coverage query'))).toBe(true)
    expect(searchCalls).toBeGreaterThanOrEqual(2) // LLM queries + freshness query

    // 2. the solver prompt contained the sensitive-case protocol
    expect(adapter.prompts[0]).toContain('Sensitive ongoing-case protocol')
    expect(adapter.prompts[0]).toContain('Current-topic synthesis protocol')

    // 3. the rewrite pass actually ran (second solve pass)
    expect(adapter.prompts.length).toBe(2)
    expect(adapter.prompts[1]).toContain('sensitive-case guard flagged')

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
    const social = sources.find((s) => s.url.includes('x.com'))
    expect(social?.social).toBe(true)

    // 6. page-read date extraction filled the publication date from JSON-LD
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
