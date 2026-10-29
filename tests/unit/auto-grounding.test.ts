/**
 * Unit tests for the RIISHE citation/source redesign, Auto-mode semantic
 * routing and claim-level grounding.
 *
 * Run: bun test tests/unit/auto-grounding.test.ts
 *
 * All network behavior is an injected stub — the policy, router, claim
 * checker, citation/source builders and orchestrator wiring under test are
 * the real production code.
 */
import { describe, test, expect } from 'bun:test'
import { shouldSearch, isConfidentExclusion, type SearchDecision } from '../../src/lib/research/policy'
import {
  semanticFreshnessCheck,
  resolveAutoSearchDecision,
  clearRoutingCacheForTests,
  type RoutingTransport,
} from '../../src/lib/research/semantic-router'
import {
  checkClaims,
  findMaterialProblems,
  buildRegenerationFeedback,
  claimVerificationEntries,
  groundingSummary,
  type ClaimCheckTransport,
} from '../../src/lib/verify/claims'
import {
  canonicalUrl,
  stripInvalidCitationMarkers,
  buildDisplaySources,
} from '../../src/lib/verify/citations'
import { renderNamedCitations, stripCitationMarkers, compactSourceName } from '../../src/lib/riishe/citation-view'
import { orchestrateTurn, resolveSearchDecisionLive } from '../../src/lib/riishe/orchestrator'
import type { TaskAdapter, ChatRequest, ChatResult, ChatTurn, HealthReport } from '../../src/lib/adapters/types'
import type { EvidencePack } from '../../src/lib/research/pipeline'

// ---------------------------------------------------------------------------
// 1. Deterministic freshness policy — the proven Auto routing gap
// ---------------------------------------------------------------------------

describe('expanded freshness policy (Auto routing)', () => {
  test('searches for officeholder questions WITHOUT the word "current" (the proven gap)', () => {
    const d = shouldSearch('Who is the Chief Minister of Tamil Nadu?')
    expect(d.search).toBe(true)
    expect(d.risk).toBe('high')
  })

  test('searches for present-tense officeholders across titles', () => {
    expect(shouldSearch('Who is the president of Brazil?').search).toBe(true)
    expect(shouldSearch('Who is the CEO of Apple?').search).toBe(true)
    expect(shouldSearch('What is the prime minister of Japan called?').search).toBe(true)
    expect(shouldSearch('Who is the mayor of Chennai?').search).toBe(true)
  })

  test('searches for election results and outcomes', () => {
    expect(shouldSearch('Who won the Tamil Nadu assembly election?').search).toBe(true)
    expect(shouldSearch('What was the result of the 2026 general election?').search).toBe(true)
  })

  test('searches for weather and as-of-date anchors', () => {
    expect(shouldSearch('What is the weather in Chennai?').search).toBe(true)
    expect(shouldSearch('What is the population of India as of 2025?').search).toBe(true)
  })

  test('historical past-tense questions do NOT keyword-trigger (semantic router adjudicates)', () => {
    // "who was" must not match the present-tense officeholder rule.
    const d = shouldSearch('Who was the president of the United States in 1950?')
    expect(d.search).toBe(false)
    // ...but it is NOT a confident exclusion: the semantic router decides.
    expect(isConfidentExclusion(d)).toBe(false)
  })

  test('confident exclusions skip the semantic router', () => {
    expect(isConfidentExclusion(shouldSearch('Calculate 17 * 23 - 45'))).toBe(true)
    expect(isConfidentExclusion(shouldSearch('Write a haiku about autumn'))).toBe(true)
    expect(isConfidentExclusion(shouldSearch('hi there'))).toBe(true)
    expect(isConfidentExclusion(shouldSearch('My python function throws a KeyError, how do I fix it?'))).toBe(true)
    expect(isConfidentExclusion(shouldSearch('Who is the current CEO of NVIDIA?'))).toBe(false) // it searches
  })

  test('stable knowledge stays fast (no search)', () => {
    expect(shouldSearch('Why is the sky blue?').search).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. Semantic freshness router
// ---------------------------------------------------------------------------

const NO_SEARCH: SearchDecision = {
  search: false,
  risk: 'none',
  reason: 'no freshness signals; answerable from stable knowledge',
}

function transportReply(needsCurrent: boolean, reason = 'time-sensitive topic'): RoutingTransport {
  return async () => JSON.stringify({ needsCurrent, reason })
}

describe('semantic freshness router', () => {
  test('classifies a message as needing current information', async () => {
    clearRoutingCacheForTests()
    const r = await semanticFreshnessCheck('Is the Louvre open today?', transportReply(true, 'opening status changes daily'))
    expect(r).not.toBeNull()
    expect(r!.needsCurrent).toBe(true)
    expect(r!.reason).toBe('opening status changes daily')
  })

  test('malformed and failed transports degrade to null (honest fallback)', async () => {
    clearRoutingCacheForTests()
    expect(await semanticFreshnessCheck('q1', async () => 'not json at all')).toBeNull()
    expect(await semanticFreshnessCheck('q2', async () => '{"needsCurrent": "yes"}')).toBeNull() // schema fail
    expect(await semanticFreshnessCheck('q3', async () => { throw new Error('gateway down') })).toBeNull()
    expect(await semanticFreshnessCheck('   ', transportReply(true))).toBeNull() // empty
  })

  test('identical messages hit the per-process cache', async () => {
    clearRoutingCacheForTests()
    let calls = 0
    const t: RoutingTransport = async () => { calls += 1; return '{"needsCurrent": false, "reason": "stable concept"}' }
    const first = await semanticFreshnessCheck('Explain recursion simply', t)
    const second = await semanticFreshnessCheck('Explain recursion simply', t)
    expect(calls).toBe(1)
    expect(first!.needsCurrent).toBe(false)
    expect(second!.needsCurrent).toBe(false)
  })

  test('resolveAutoSearchDecision: semantic yes ADDS retrieval with an auditable reason', async () => {
    const routed = await resolveAutoSearchDecision('Is the Louvre open today?', NO_SEARCH, transportReply(true, 'status changes daily'))
    expect(routed.decision.search).toBe(true)
    expect(routed.decision.reason).toContain('semantic router')
    expect(routed.semanticRan).toBe(true)
  })

  test('resolveAutoSearchDecision: semantic no keeps the deterministic no-search', async () => {
    const routed = await resolveAutoSearchDecision('Why is the sky blue?', NO_SEARCH, transportReply(false, 'stable science'))
    expect(routed.decision.search).toBe(false)
    expect(routed.decision.reason).toContain('semantic router: stable science')
  })

  test('resolveAutoSearchDecision NEVER suppresses a deterministic search verdict', async () => {
    const searching: SearchDecision = { search: true, risk: 'high', recencyDays: 180, reason: 'asks about a current officeholder' }
    const routed = await resolveAutoSearchDecision('Who is the CM of Tamil Nadu?', searching, transportReply(false))
    expect(routed.decision.search).toBe(true)
    expect(routed.semanticRan).toBe(false)
  })

  test('orchestrator live resolver: off/on modes bypass the semantic router entirely', async () => {
    let calls = 0
    const t: RoutingTransport = async () => { calls += 1; return '{"needsCurrent": true, "reason": "x"}' }
    expect((await resolveSearchDecisionLive('Explain recursion', 'off', t)).search).toBe(false)
    expect((await resolveSearchDecisionLive('Explain recursion', 'on', t)).search).toBe(true)
    expect(calls).toBe(0)
  })

  test('orchestrator live resolver: unrouterable ambiguous question stays deterministic', async () => {
    const d = await resolveSearchDecisionLive('Why is the sky blue?', 'auto', async () => { throw new Error('down') })
    expect(d.search).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. Claim-level grounding
// ---------------------------------------------------------------------------

const EVIDENCE = `[1] Tamil Nadu Government — Council of Ministers (dated May 10, 2026)
URL: https://www.tn.gov.in/council
EXCERPT: The Chief Minister of Tamil Nadu is M.K. Stalin, in office since May 7, 2021.`

describe('claim checker (claims.ts)', () => {
  const stubTransport = (payload: unknown): ClaimCheckTransport => async () => JSON.stringify(payload)

  test('parses a valid verdict list', async () => {
    const r = await checkClaims({
      answer: 'M.K. Stalin is the Chief Minister of Tamil Nadu [1].',
      evidenceBlock: EVIDENCE,
      transport: stubTransport({
        claims: [{ text: 'M.K. Stalin is the Chief Minister of Tamil Nadu', changing: true, verdict: 'supported', evidenceIds: [1] }],
      }),
    })
    expect(r.ran).toBe(true)
    expect(r.claims).toHaveLength(1)
    expect(r.claims[0].verdict).toBe('supported')
  })

  test('malformed output and transport failure degrade honestly (never a fake pass)', async () => {
    const bad = await checkClaims({ answer: 'Answer text long enough to check.', evidenceBlock: EVIDENCE, transport: async () => 'no json' })
    expect(bad.ran).toBe(false)
    expect(bad.degraded[0]).toContain('no parseable output')
    const down = await checkClaims({ answer: 'Answer text long enough to check.', evidenceBlock: EVIDENCE, transport: async () => { throw new Error('429') } })
    expect(down.ran).toBe(false)
    expect(down.degraded[0]).toContain('claim check unavailable')
  })

  test('material problems: contradicted claims and unsupported CHANGING claims', () => {
    const problems = findMaterialProblems({
      ran: true,
      claims: [
        { text: 'X is the Chief Minister', changing: true, verdict: 'contradicted', evidenceIds: [1] },
        { text: 'X won the 2026 election', changing: true, verdict: 'unsupported', evidenceIds: [] },
        { text: 'Chennai is the capital of Tamil Nadu', changing: false, verdict: 'unsupported', evidenceIds: [] },
      ],
      degraded: [],
    })
    expect(problems).not.toBeNull()
    expect(problems!.contradicted).toHaveLength(1)
    expect(problems!.unsupportedChanging).toHaveLength(1) // the stable claim is NOT material
  })

  test('a clean verdict list has no material problems', () => {
    expect(findMaterialProblems({ ran: true, claims: [{ text: 'Stalin is CM', changing: true, verdict: 'supported', evidenceIds: [1] }], degraded: [] })).toBeNull()
    expect(findMaterialProblems({ ran: false, claims: [], degraded: ['x'] })).toBeNull()
  })

  test('regeneration feedback names each problem and forbids inference-by-mention', () => {
    const feedback = buildRegenerationFeedback({
      contradicted: [{ text: 'X is the Chief Minister', changing: true, verdict: 'contradicted', evidenceIds: [1], note: 'evidence states M.K. Stalin holds the office' }],
      unsupportedChanging: [{ text: 'X won the 2026 election', changing: true, verdict: 'unsupported', evidenceIds: [] }],
      dateConflicts: [],
    })
    expect(feedback).toContain('CONTRADICTED: "X is the Chief Minister"')
    expect(feedback).toContain('NOT SUPPORTED: "X won the 2026 election"')
    expect(feedback).toContain('merely mention')
    expect(feedback).toContain('state the disagreement and the source dates')
  })

  test('date conflicts are material and named in the feedback', () => {
    const problems = findMaterialProblems({
      ran: true,
      claims: [
        { text: 'Stalin is the Chief Minister', changing: true, verdict: 'supported', evidenceIds: [1] },
        { text: 'Stalin took office in May 2026', changing: true, verdict: 'supported', evidenceIds: [1], dateConflict: true, note: 'evidence says May 2021' },
      ],
      degraded: [],
    })
    expect(problems).not.toBeNull()
    expect(problems!.dateConflicts).toHaveLength(1)
    const feedback = buildRegenerationFeedback({
      contradicted: [],
      unsupportedChanging: [],
      dateConflicts: problems!.dateConflicts,
    })
    expect(feedback).toContain('DATE CONFLICT: "Stalin took office in May 2026"')
    const entries = claimVerificationEntries(
      { ran: true, claims: [{ text: 'Stalin took office in May 2026', changing: true, verdict: 'supported', evidenceIds: [1], dateConflict: true }], degraded: [] },
      false,
    )
    expect(entries.some((e) => e.check === 'date consistency' && e.status === 'failed')).toBe(true)
  })

  test('verification entries: failed claims become FAILED entries; clean check passes', () => {
    const failed = claimVerificationEntries({
      ran: true,
      claims: [{ text: 'X won the election', changing: true, verdict: 'unsupported', evidenceIds: [] }],
      degraded: [],
    }, false)
    expect(failed).toHaveLength(1)
    expect(failed[0].status).toBe('failed')
    expect(failed[0].detail).toContain('no retrieved source states this changing fact')

    const passed = claimVerificationEntries({ ran: true, claims: [{ text: 'Stalin is CM', changing: true, verdict: 'supported', evidenceIds: [1] }], degraded: [] }, true)
    expect(passed[0].status).toBe('passed')
    expect(passed[0].detail).toContain('after one verification pass')

    const unavailable = claimVerificationEntries({ ran: false, claims: [], degraded: ['claim check unavailable: 429'] }, false)
    // Verification INCOMPLETE must stay visible — never silently dropped.
    expect(unavailable[0].status).toBe('incomplete')
    expect(unavailable[0].detail).toContain('could not be independently re-checked')
  })

  test('background claims without evidence support are reported as incomplete, not failed', () => {
    const entries = claimVerificationEntries(
      {
        ran: true,
        claims: [
          { text: 'Stalin is the Chief Minister', changing: true, verdict: 'supported', evidenceIds: [1] },
          { text: 'Chennai is a large city', changing: false, verdict: 'unsupported', evidenceIds: [] },
        ],
        degraded: [],
      },
      false,
    )
    expect(entries[0].status).toBe('passed')
    const gap = entries.find((e) => e.status === 'incomplete')
    expect(gap).toBeDefined()
    expect(gap!.detail).toContain('Chennai is a large city')
  })

  test('grounding summary records regeneration and pass/fail honestly', () => {
    expect(groundingSummary({ ran: true, claims: [], degraded: [] }, false)).toEqual({
      checked: true, regenerated: false, contradicted: 0, unsupported: 0, passed: true,
    })
    expect(groundingSummary({ ran: false, claims: [], degraded: ['down'] }, false)).toMatchObject({ checked: false, passed: false })
  })
})

// ---------------------------------------------------------------------------
// 4. Source list: canonical dedup, cited flag, usefulness ordering
// ---------------------------------------------------------------------------

describe('display sources (citations.ts)', () => {
  test('canonicalUrl normalizes www/query/trailing slash', () => {
    expect(canonicalUrl('https://www.gov.tn/a/?utm=1#x')).toBe('https://gov.tn/a')
    expect(canonicalUrl('https://gov.tn/a/')).toBe('https://gov.tn/a')
    expect(canonicalUrl('garbage')).toBe('garbage')
  })

  test('dedups duplicates reached via different query strings, merging page-read and dates', () => {
    const merged = buildDisplaySources(
      [
        { id: 1, title: 'TNGOV', url: 'https://tn.gov.in/cm', hostName: 'tn.gov.in', date: null, official: true, pageRead: false, score: 0.5 },
        { id: 4, title: 'TNGOV (tool)', url: 'https://tn.gov.in/cm?ref=tool', hostName: 'tn.gov.in', date: 'May 10, 2026', official: false, pageRead: true, score: 0.1 },
      ],
      'The CM is X [1].',
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].id).toBe(1) // stable citation id wins
    expect(merged[0].pageRead).toBe(true) // merged intelligence
    expect(merged[0].date).toBe('May 10, 2026')
    expect(merged[0].cited).toBe(true)
  })

  test('orders cited sources first, then official/pageRead, ids stable', () => {
    const ordered = buildDisplaySources(
      [
        { id: 1, title: 'blog', url: 'https://blog.io/a', hostName: 'blog.io', date: null, official: false, pageRead: false, score: 0.9 },
        { id: 2, title: 'gov', url: 'https://gov.in/b', hostName: 'gov.in', date: null, official: true, pageRead: false, score: 0.5 },
        { id: 3, title: 'news', url: 'https://news.com/c', hostName: 'news.com', date: null, official: false, pageRead: true, score: 0.7 },
      ],
      'Claim one [2] and claim two.',
    )
    expect(ordered.map((s) => s.id)).toEqual([2, 3, 1])
    expect(ordered[0].cited).toBe(true)
    expect(ordered[1].cited).toBe(false)
  })

  test('URL-style citations mark sources cited too', () => {
    const out = buildDisplaySources(
      [{ id: 1, title: 't', url: 'https://a.com/x', hostName: 'a.com', date: null, official: false, pageRead: false }],
      'See https://a.com/x for details.',
    )
    expect(out[0].cited).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. Citation markers: dangling strip + linkify + copy text
// ---------------------------------------------------------------------------

describe('citation marker handling', () => {
  test('stripInvalidCitationMarkers removes dangling markers and trims mixed groups', () => {
    const valid = new Set([1, 2])
    const out = stripInvalidCitationMarkers('A [1] B [5] C [2,7] D', valid)
    expect(out.text).toContain('A [1]')
    expect(out.text).toContain('C [2]')
    expect(out.text).not.toContain('[5]')
    expect(out.text).not.toContain('[7]')
    expect(out.removedIds.sort()).toEqual([5, 7])
    expect(stripInvalidCitationMarkers('All dangling [3][4] here', new Set<number>()).text).toBe('All dangling here')
  })

  test('markdown links are never treated as citation markers', () => {
    const out = stripInvalidCitationMarkers('See [2](https://a.com) for the data', new Set<number>())
    expect(out.text).toBe('See [2](https://a.com) for the data')
    expect(out.removedIds).toHaveLength(0)
  })

  test('renderNamedCitations: source names replace numeric markers, dead ids are stripped', () => {
    const sources = [
      { id: 1, title: 'Who is the CM of Tamil Nadu? - BBC News', hostName: 'bbc.com' },
      { id: 3, title: 'Council of Ministers', hostName: 'tn.gov.in' },
    ]
    const out = renderNamedCitations('A [1] and [3,9] pair', sources)
    expect(out).toContain('([BBC News](#bean-src-1))')
    expect(out).toContain('([Council of Ministers](#bean-src-3))')
    expect(out).not.toContain('[9]')
    expect(out).not.toContain('#bean-src-9')
    // A group where NO id resolves is removed entirely — never rendered raw.
    expect(renderNamedCitations('Dangling [7] stays out', sources)).toBe('Dangling stays out')
  })

  test('renderNamedCitations: no sources strips every numeric marker', () => {
    expect(renderNamedCitations('Elections happened [3][4][5] recently', [])).toBe('Elections happened recently')
    expect(renderNamedCitations('plain [1] text')).toBe('plain text')
  })

  test('renderNamedCitations: adjacent marker runs merge into ONE parenthesized group', () => {
    const sources = [
      { id: 1, title: 'Council of Ministers', hostName: 'tn.gov.in' },
      { id: 3, title: 'Sworn In Today - Variety', hostName: 'variety.com' },
      { id: 5, title: 'Election Results - BBC News', hostName: 'bbc.com' },
    ]
    const out = renderNamedCitations('Won the elections [3][5]. Led by [1].', sources)
    expect(out).toContain('([Variety](#bean-src-3), [BBC News](#bean-src-5))')
    expect(out).not.toContain(')(')
    expect(out).not.toContain('[3]')
    expect(out).not.toContain('[5]')
    // comma groups and spacing variants merge too
    const out2 = renderNamedCitations('Claim [1] [3,5] here', sources)
    expect(out2).toContain('([Council of Ministers](#bean-src-1), [Variety](#bean-src-3), [BBC News](#bean-src-5)) here')
  })

  test('renderNamedCitations: code spans and fences are never touched', () => {
    const sources = [{ id: 1, title: 'Docs', hostName: 'docs.example' }]
    expect(renderNamedCitations('Use `arr[1]` here [1]', sources)).toBe('Use `arr[1]` here ([Docs](#bean-src-1))')
    const fenced = renderNamedCitations('Text [1].\n```js\nconst x = a[1];\n```\nMore [1].', sources)
    expect(fenced).toContain('const x = a[1];')
    expect(fenced).toContain('([Docs](#bean-src-1))')
  })

  test('compactSourceName: publisher suffix wins, generic tails are skipped, long titles truncate', () => {
    expect(compactSourceName({ title: 'Who is the CM of Tamil Nadu? - BBC News', hostName: 'bbc.com' })).toBe('BBC News')
    expect(compactSourceName({ title: 'Government of Tamil Nadu - Official Site', hostName: 'tn.gov.in' })).not.toBe('Official Site')
    expect(compactSourceName({ title: 'Council of Ministers', hostName: 'tn.gov.in' })).toBe('Council of Ministers')
    const long = compactSourceName({ title: 'The Chief Minister of Tamil Nadu and the council of ministers full list', hostName: 'x.com' })
    expect(long.length).toBeLessThanOrEqual(35)
    expect(long.endsWith('…')).toBe(true)
  })

  test('stripCitationMarkers produces clean copy text', () => {
    expect(stripCitationMarkers('Stalin is the CM [2,3]. Next line [4] stays clean.')).toBe('Stalin is the CM. Next line stays clean.')
    expect(stripCitationMarkers('Keep [markdown links](https://a.com) intact')).toBe('Keep [markdown links](https://a.com) intact')
    expect(stripCitationMarkers('Space[1]tight[2]')).toBe('Spacetight')
    // code is never corrupted by copy-stripping
    expect(stripCitationMarkers('`arr[1]` stays')).toBe('`arr[1]` stays')
  })
})

// ---------------------------------------------------------------------------
// 6. Orchestrator wiring — real orchestrator, stubbed network
// ---------------------------------------------------------------------------

function stubAdapter(responses: string[], calls: { count: number; prompts: ChatTurn[][] }): TaskAdapter {
  const health: HealthReport = { healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'stub' }
  let i = 0
  const next = (): string => {
    calls.count += 1
    i += 1
    return responses[Math.min(i - 1, responses.length - 1)]
  }
  return {
    backendId: 'stub',
    health: async () => health,
    chat: async (req: ChatRequest): Promise<ChatResult> => {
      calls.prompts.push(req.messages)
      return { content: next(), tokensInEst: 1, tokensOutEst: 1, durationMs: 1 }
    },
    chatStream: async function* (req: ChatRequest): AsyncGenerator<string, void, unknown> {
      calls.prompts.push(req.messages)
      const content = next()
      yield content.slice(0, Math.ceil(content.length / 2))
      yield content.slice(Math.ceil(content.length / 2))
    },
  }
}

function packOf(sources: EvidencePack['sources']): EvidencePack {
  return { sources, queries: ['q'], degraded: [], staleness: null, durationMs: 1 }
}

const caps = { maxPromptChars: 100_000, maxHistoryMessages: 10 }

describe('orchestrator claim-grounding wiring (stubs, no network)', () => {
  test('a contradicted draft is regenerated once and the grounded rewrite is served', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const draft = 'Joseph Vijay is the current Chief Minister of Tamil Nadu and won the 2026 election after the DMK victory [1].'
    const corrected = 'M.K. Stalin is the current Chief Minister of Tamil Nadu [1].'
    const adapter = stubAdapter([draft, corrected], calls)
    let checkPass = 0
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['general', 'research'],
      searchMode: 'auto',
      hooks: {
        runResearch: async () =>
          packOf([
            {
              id: 1, url: 'https://www.tn.gov.in/council', title: 'Council of Ministers',
              snippet: 'The Chief Minister of Tamil Nadu is M.K. Stalin, in office since 2021.',
              hostName: 'tn.gov.in', date: 'May 10, 2026', freshness: 0.5, year: 2026,
              authority: 1, official: true, score: 0.9, pageRead: true, excerpt: 'The Chief Minister of Tamil Nadu is M.K. Stalin, in office since 2021.',
            },
          ]),
        checkClaims: async () => {
          checkPass += 1
          if (checkPass === 1) {
            return JSON.stringify({
              claims: [
                { text: 'Joseph Vijay is the current Chief Minister', changing: true, verdict: 'contradicted', evidenceIds: [1], note: 'evidence states M.K. Stalin holds the office' },
                { text: 'Vijay won the 2026 election after the DMK victory', changing: true, verdict: 'unsupported', evidenceIds: [] },
              ],
            })
          }
          return JSON.stringify({
            claims: [{ text: 'M.K. Stalin is the current Chief Minister', changing: true, verdict: 'supported', evidenceIds: [1] }],
          })
        },
      },
    })
    expect(calls.count).toBe(2) // draft + grounded regeneration
    expect(result.content).toBe(corrected)
    expect(result.metadata.grounding).toMatchObject({ checked: true, regenerated: true, passed: true })
    expect(result.metadata.states).toContain('VERIFIED_FROM_SOURCES')
    const groundingEntries = result.metadata.verification.filter((v) => v.check === 'claim grounding')
    expect(groundingEntries).toHaveLength(1)
    expect(groundingEntries[0].status).toBe('passed')
    expect(result.metadata.sources[0]?.cited).toBe(true)
    expect(result.metadata.searchMode).toBe('auto')
  })

  test('material problems after the bounded regeneration block VERIFIED_FROM_SOURCES', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const adapter = stubAdapter(
      [
        'Draft claiming X is the current Chief Minister of Tamil Nadu, sworn in during 2026 [1].',
        'Still claiming X is the current Chief Minister of Tamil Nadu without support [1].',
      ],
      calls,
    )
    let checkPass = 0
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      searchMode: 'on',
      hooks: {
        runResearch: async () =>
          packOf([
            {
              id: 1, url: 'https://tn.gov.in/cm', title: 'CM list', snippet: 'M.K. Stalin is the Chief Minister.',
              hostName: 'tn.gov.in', date: null, freshness: null, year: null, authority: 1, official: true,
              score: 0.8, pageRead: false, excerpt: 'M.K. Stalin is the Chief Minister.',
            },
          ]),
        checkClaims: async () =>
          JSON.stringify({
            claims: [{ text: 'X is the Chief Minister', changing: true, verdict: 'contradicted', evidenceIds: [1], note: 'evidence states Stalin' }],
          }),
      },
    })
    expect(calls.count).toBe(2) // exactly ONE regeneration (bounded)
    expect(result.metadata.states).not.toContain('VERIFIED_FROM_SOURCES')
    expect(result.metadata.states).toContain('PARTIALLY_VERIFIED')
    const failed = result.metadata.verification.filter((v) => v.check === 'claim grounding' && v.status === 'failed')
    expect(failed.length).toBeGreaterThanOrEqual(1)
    expect(result.metadata.grounding).toMatchObject({ checked: true, regenerated: true, passed: false, contradicted: 1 })
  })

  test('dangling [n] markers are stripped when no evidence exists (the measured Auto failure)', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const adapter = stubAdapter(['Joseph Vijay became Chief Minister after the DMK won the election [3][4][5].'], calls)
    const result = await orchestrateTurn({
      userMessage: 'Tell me about the modern history of paper currency.',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['general', 'research'],
      searchMode: 'auto',
      hooks: {
        routeSemantics: async () => JSON.stringify({ needsCurrent: false, reason: 'stable historical topic' }),
      },
    })
    expect(result.content).not.toContain('[3]')
    expect(result.content).not.toContain('[5]')
    expect(result.metadata.degraded.join(' ')).toContain('citation marker')
    expect(result.metadata.states).toContain('UNVERIFIED')
    expect(result.metadata.sources).toHaveLength(0)
  })
})
