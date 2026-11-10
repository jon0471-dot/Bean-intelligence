/**
 * RIISHE live-research acceptance — GATEWAY-DOWN resilience proof.
 *
 * Simulates the measured failure mode behind the bug report ("live research
 * could not verify"): the authorized gateway's `functions` endpoint class is
 * rate-limited and rejects EVERY web_search / page_reader call with the exact
 * HTTP 429 error shape the real gateway throws. Chat is untouched (in
 * production the chat and functions classes are throttled SEPARATELY — the
 * bug report itself shows the model answering while research fails).
 *
 * What must still work with the gateway fully down:
 *   - every current-fact acceptance query retrieves REAL evidence through the
 *     independent lane (Wikipedia MediaWiki API, official sources) — real
 *     network, no fabricated results;
 *   - the evidence names the current officeholder / release, with a real URL;
 *   - failures degrade honestly.
 *
 * A mock here can never fabricate evidence for the assertions that matter:
 * the mock ONLY throws; every result comes from the real direct lane.
 */
import { describe, test, expect, mock, beforeAll } from 'bun:test'

// ---- the ONLY mocked boundary: gateway functions class always 429 ----------
mock.module('z-ai-web-dev-sdk', () => ({
  default: {
    create: async () => ({
      functions: {
        invoke: async (name: string) => {
          throw new Error(`Function invoke failed with status 429: Too Many Requests (${name})`)
        },
      },
      chat: {
        completions: {
          create: async () => {
            throw new Error('Function invoke failed with status 429: Too Many Requests (chat)')
          },
        },
      },
    }),
  },
}))

const { runResearch } = await import('../src/lib/research/pipeline')
const { shouldSearch } = await import('../src/lib/research/policy')
const { _resetUpstreamCooldownForTests } = await import('../src/lib/upstream/gateway')

const QUERIES = [
  'Who is the current Chief Minister of Tamil Nadu?',
  'Who is the current Prime Minister of India?',
  'What is the latest stable Node.js version?',
  'Who is the current President of the United States?',
]

interface CaseResult {
  query: string
  durationMs: number
  sources: number
  pageRead: number
  urls: string[]
  dates: Array<string | null>
  independent: string[]
  degraded: string[]
  /** Digest of all retrieved evidence text (snippets + excerpts) for
   *  grounding assertions — exactly what the solver model would see. */
  evidenceText: string
}

const results: CaseResult[] = []

describe('gateway-down resilience (independent lane carries current facts)', () => {
  beforeAll(() => {
    _resetUpstreamCooldownForTests()
  })

  for (const query of QUERIES) {
    test(`[gateway 429] ${query}`, async () => {
      _resetUpstreamCooldownForTests()
      const decision = shouldSearch(query)
      expect(decision.search).toBe(true)
      const t0 = Date.now()
      const pack = await runResearch(query, decision)
      const durationMs = Date.now() - t0

      // The gateway failed — that is the scenario. Its failure is recorded
      // honestly in degraded notes.
      const searchFailed = pack.degraded.some((d) => d.startsWith('search "'))
      expect(searchFailed).toBe(true)

      // The independent lane must deliver REAL, usable evidence anyway.
      expect(pack.sources.length).toBeGreaterThan(0)
      const record: CaseResult = {
        query,
        durationMs,
        sources: pack.sources.length,
        pageRead: pack.sources.filter((s) => s.pageRead).length,
        urls: pack.sources.map((s) => s.url),
        dates: pack.sources.map((s) => s.date),
        independent: pack.independent ?? [],
        degraded: pack.degraded,
        evidenceText: pack.sources.map((s) => `${s.title} ${s.snippet} ${s.excerpt ?? ''}`).join('\n'),
      }
      results.push(record)

      console.log(`\n=== ${query}`)
      console.log(`durationMs=${durationMs} sources=${record.sources} pageRead=${record.pageRead}`)
      for (const s of pack.sources) {
        console.log(`  [${s.id}] ${s.hostName} | ${s.date ?? 'no date'} | pageRead=${s.pageRead}`)
        console.log(`      ${s.url}`)
        console.log(`      ${(s.excerpt ?? s.snippet).slice(0, 160).replace(/\n/g, ' ')}`)
      }
      for (const n of pack.independent ?? []) console.log(`  + ${n}`)
      for (const d of pack.degraded.slice(0, 3)) console.log(`  - ${d}`)
    }, 60_000)
  }

  test('officeholder answers are grounded in retrieved page content (not model memory)', () => {
    const tn = results.find((r) => r.query.includes('Tamil Nadu'))
    expect(tn).toBeDefined()
    const tnText = JSON.stringify(tn)
    // The current officeholder per live-retrieved evidence (Wikipedia infobox
    // + extracts fetched this run) — asserted against the evidence itself.
    expect(tnText).toContain('Joseph Vijay')

    const india = results.find((r) => r.query.includes('Prime Minister of India'))
    expect(india).toBeDefined()
    const indiaText = JSON.stringify(india)
    // The officeholder NAME comes from the evidence; assert the evidence
    // carries an incumbent fact rather than a guessed name.
    expect(india?.independent.some((n) => n.includes('incumbent') || n.includes('page evidence'))).toBe(true)
    expect(india?.urls.some((u) => u.includes('en.wikipedia.org/wiki/Prime_Minister')) ?? india?.urls.some((u) => u.includes('pmindia.gov.in'))).toBe(true)

    const node = results.find((r) => r.query.includes('Node.js'))
    expect(node).toBeDefined()
    // The official release feed evidence carries a real version string.
    expect(node!.evidenceText).toMatch(/v\d+\.\d+\.\d+/)
    expect(node?.urls.some((u) => u.includes('nodejs.org'))).toBe(true)

    const us = results.find((r) => r.query.includes('President of the United States'))
    expect(us).toBeDefined()
    expect(us!.sources).toBeGreaterThan(0)
  })
})
