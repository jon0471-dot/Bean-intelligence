/**
 * BEAN Intelligence — auto-grounding unit tests.
 *
 * REWRITTEN 2026-10-29: the previous version of this file could not even
 * load — it imported functions that do not exist in the codebase
 * (isConfidentExclusion, canonicalUrl, buildDisplaySources,
 * stripInvalidCitationMarkers, renderNamedCitations, stripCitationMarkers,
 * compactSourceName, resolveSearchDecisionLive) and asserted an LLM
 * claim-check orchestrator wiring that was never implemented. Every test
 * here now pins the REAL shipped API:
 *  - shouldSearch + the semantic freshness router (search policy),
 *  - the claims.ts pure layer (checkClaims transport contract, material
 *    problems, regeneration feedback, verification entries, summary),
 *  - canonical source dedup + marker remapping (citations.ts),
 *  - citation VIEW transforms (citation-view.ts: linkify, strip, copy),
 *  - the deterministic orchestrator dangling-marker path (hooks seam).
 * No network: every model touchpoint is injected.
 */
import { describe, test, expect } from 'bun:test'
import { shouldSearch, type SearchDecision } from '../../src/lib/research/policy'
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
  dedupeSourcesWithMap,
  remapCitationIds,
} from '../../src/lib/verify/citations'
import {
  linkifyCitations,
  stripUnresolvedMarkers,
  cleanAnswerForCopy,
  mapSourceClaims,
} from '../../src/lib/riishe/citation-view'
import { orchestrateTurn } from '../../src/lib/riishe/orchestrator'
import type { TaskAdapter, ChatRequest, ChatResult, ChatTurn, HealthReport } from '../../src/lib/adapters/types'
import type { EvidencePack } from '../../src/lib/research/pipeline'

// ---------------------------------------------------------------------------
// 1. Deterministic freshness policy
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

  test('searches for weather anchors (measured gap closed 2026-10-29)', () => {
    expect(shouldSearch('What is the weather in Chennai?').search).toBe(true)
    expect(shouldSearch('What is the population of India as of 2025?').search).toBe(true)
  })

  test('past-tense officeholder questions also search (the policy treats was/were as time-sensitive)', () => {
    // MEASURED (2026-10-29): the officeholder pattern includes was|were — the
    // deterministic policy searches even for "who was"; retrieval ranks the
    // historical sources. The old "does not keyword-trigger" expectation was
    // aspirational and never matched the shipped policy.
    const d = shouldSearch('Who was the president of the United States in 1950?')
    expect(d.search).toBe(true)
    expect(d.reason).toContain('office')
  })

  test('absolute exclusions are named as such in the reason (math/creative/greeting/coding)', () => {
    expect(shouldSearch('Calculate 17 * 23 - 45').reason).toContain('mathematical')
    expect(shouldSearch('Write a haiku about autumn').reason).toContain('creative')
    expect(shouldSearch('hi there').reason).toContain('greeting')
    expect(shouldSearch('My python function throws a KeyError, how do I fix it?').search).toBe(false)
    expect(shouldSearch('Who is the current CEO of NVIDIA?').search).toBe(true) // freshness beats coding
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

  test('the shipped resolver is deterministic and never calls a transport (search modes are removed)', async () => {
    // MEASURED CONTRACT (2026-10-29): retrieval is fully automatic — there
    // is no per-turn off/on toggle and no live routing resolver on the
    // orchestrator. resolveSearchDecision(message) is pure.
    const { resolveSearchDecision } = await import('../../src/lib/riishe/orchestrator')
    expect(resolveSearchDecision('Explain recursion').search).toBe(false)
    expect(resolveSearchDecision('Who is the current CEO of NVIDIA?').search).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. Claim-level grounding (pure layer — the transport-side helpers)
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
// 4. Canonical source dedup + marker remapping (citations.ts)
// ---------------------------------------------------------------------------

describe('source dedup (citations.ts)', () => {
  test('dedupeSourcesWithMap merges duplicates reached via different query strings; ids stay stable', () => {
    const { kept, idMap, duplicatesRemoved } = dedupeSourcesWithMap([
      { id: 4, url: 'https://tn.gov.in/cm?ref=tool' },
      { id: 1, url: 'https://www.tn.gov.in/cm' },
    ])
    expect(kept).toHaveLength(1)
    expect(kept[0].id).toBe(1) // lowest id wins (stable anchors)
    expect(duplicatesRemoved).toBe(1)
    expect(idMap.get(1)).toBe(1)
    expect(idMap.get(4)).toBe(1) // duplicate maps to the canonical id
  })

  test('URL variants (www/trailing slash/query/fragment) collapse to one canonical entry', () => {
    const { kept, duplicatesRemoved } = dedupeSourcesWithMap([
      { id: 1, url: 'https://gov.tn/a' },
      { id: 2, url: 'https://www.gov.tn/a/' },
      { id: 3, url: 'https://gov.tn/a?utm=1#x' },
    ])
    expect(kept).toHaveLength(1)
    expect(duplicatesRemoved).toBe(2)
  })

  test('remapCitationIds rewrites markers through the map and leaves unknown ids untouched', () => {
    const idMap = new Map([[4, 1], [1, 1]])
    expect(remapCitationIds('A [4] and [4,1] pair', idMap)).toBe('A [1] and [1,1] pair')
    // Unknown ids pass through so the citation audit flags them (never silently dropped).
    expect(remapCitationIds('Dangling [7] stays', idMap)).toBe('Dangling [7] stays')
  })
})

// ---------------------------------------------------------------------------
// 5. Citation view transforms (citation-view.ts)
// ---------------------------------------------------------------------------

describe('citation marker handling', () => {
  test('stripUnresolvedMarkers removes dangling markers, whole partial groups, and code stays untouched', () => {
    const valid = new Set([1, 2])
    const out = stripUnresolvedMarkers('A [1] B [5] C [2,7] D `arr[7]`', valid)
    expect(out).toContain('A [1]')
    expect(out).not.toContain('[5]')
    // MEASURED: a PARTIALLY resolved group is removed WHOLE (the contract is
    // "unresolved, orphaned or partial groups are stripped" — no silent
    // trimming to the surviving subset).
    expect(out).not.toContain('[2,7]')
    expect(out).not.toContain('[2]')
    expect(out).toContain('`arr[7]`') // inline code is never a citation
  })

  test('linkifyCitations: resolved markers become publisher-named anchors; partial groups die whole', () => {
    const sources = [{ id: 1, hostName: 'bbc.com' }, { id: 3, hostName: 'tn.gov.in' }]
    const out = linkifyCitations('A [1] and [3,9] pair', sources)
    expect(out).toContain('[BBC News](#bean-src-1)')
    // MEASURED: [3,9] contains an unresolved id, so the WHOLE group is
    // stripped — the group never renders partially.
    expect(out).not.toContain('[3]')
    expect(out).not.toContain('[9]')
    expect(out).not.toContain('Tamil Nadu Government')
    // Stripping leaves the surrounding spacing as-is (copy cleanup is a
    // separate transform: cleanAnswerForCopy).
    expect(linkifyCitations('Dangling [7] stays out', sources)).toBe('Dangling  stays out')
  })

  test('linkifyCitations: no sources strips every numeric marker; code spans and fences are never touched', () => {
    expect(linkifyCitations('Elections happened [3][4][5] recently', [])).toBe('Elections happened  recently')
    const sources = [{ id: 1, hostName: 'docs.example' }]
    expect(linkifyCitations('Use `arr[1]` here [1]', sources)).toBe('Use `arr[1]` here [docs.example](#bean-src-1)')
    const fenced = linkifyCitations('Text [1].\n```js\nconst x = a[1];\n```\nMore [1].', sources)
    expect(fenced).toContain('const x = a[1];')
    expect(fenced).toContain('#bean-src-1')
  })

  test('cleanAnswerForCopy produces prose without IDs, anchors or code corruption', () => {
    expect(cleanAnswerForCopy('Stalin is the CM [2,3]. Next line [4] stays clean.')).toBe('Stalin is the CM. Next line stays clean.')
    expect(cleanAnswerForCopy('Keep [markdown links](https://a.com) intact')).toBe('Keep [markdown links](https://a.com) intact')
    expect(cleanAnswerForCopy('`arr[1]` stays')).toBe('`arr[1]` stays')
    expect(cleanAnswerForCopy('Named [Tamil Nadu Government](#bean-src-1) stays readable')).toBe('Named Tamil Nadu Government stays readable')
  })

  test('mapSourceClaims maps each cited source to its first supporting sentence', () => {
    const claims = mapSourceClaims(
      'M.K. Stalin is the Chief Minister [1]. The DMK governs [1,2].',
      [{ id: 1, hostName: 'tn.gov.in' }, { id: 2, hostName: 'bbc.com' }],
    )
    expect(claims.get(1)).toBe('M.K. Stalin is the Chief Minister.')
    expect(claims.get(2)).toBe('The DMK governs.')
    expect(mapSourceClaims('No citations here', [{ id: 1, hostName: 'a.com' }]).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 6. Deterministic orchestrator path (hermetic — hooks.runResearch seam)
// ---------------------------------------------------------------------------

function stubAdapter(responses: string[], calls: { count: number }): TaskAdapter {
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
    chat: async (_req: ChatRequest): Promise<ChatResult> => ({ content: next(), tokensInEst: 1, tokensOutEst: 1, durationMs: 1 }),
    chatStream: async function* (_req: ChatRequest): AsyncGenerator<string, void, unknown> {
      const content = next()
      yield content.slice(0, Math.ceil(content.length / 2))
      yield content.slice(Math.ceil(content.length / 2))
    },
  }
}

function packOf(sources: EvidencePack['sources']): EvidencePack {
  return {
    sources,
    queries: ['q'],
    degraded: [],
    staleness: null,
    geoWarning: null,
    durationMs: 1,
    searchMs: 1,
    pageReadMs: 0,
    searchCalls: 1,
    pageReadCalls: 0,
    cacheHits: 0,
    fetchedAt: new Date().toISOString(),
  }
}

const caps = { maxPromptChars: 100_000, maxHistoryMessages: 10 }

describe('orchestrator deterministic grounding (stubs, no network)', () => {
  test('dangling [n] markers are stripped when no evidence exists (the measured Auto failure)', async () => {
    const calls = { count: 0 }
    const adapter = stubAdapter(['Joseph Vijay became Chief Minister after the DMK won the election [3][4][5].'], calls)
    const result = await orchestrateTurn({
      userMessage: 'Tell me about the modern history of paper currency.',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['general'],
      hooks: { runResearch: async () => packOf([]) },
    })
    expect(result.content).not.toContain('[3]')
    expect(result.content).not.toContain('[5]')
    // MEASURED (2026-10-29): with no evidence at all, orphan markers are
    // stripped silently (nothing to resolve against — there is no citation
    // integrity note), the turn stays honestly UNVERIFIED and the degraded
    // note records that retrieval was not warranted.
    expect(result.metadata.degraded.join(' ')).toContain('search not warranted')
    expect(result.metadata.states).toContain('UNVERIFIED')
    expect(result.metadata.sources).toHaveLength(0)
  })
})
