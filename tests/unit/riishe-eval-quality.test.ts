/**
 * BEAN Intelligence — RIISHE Q1-15 evaluation-quality regression tests.
 * Run: bun test tests/unit/riishe-eval-quality.test.ts
 *
 * Pins the GENERAL mechanism fixes for the measured manual-eval failures
 * (2026-11-02) — none of these tests hardcode any answer to an eval
 * question; they pin the retrieval triggers, query construction, freshness
 * follow-up, page-read scheduling, date-grounding audit and prompt rules
 * that the failures exposed:
 *  - Q13 "the movie Scene"  -> search triggers + exact-title query;
 *  - Q14 "latest developments from NVIDIA" -> official-announcement query +
 *    primary-announcement-host classification;
 *  - Q11 "latest stable version of Next.js" -> official-release-notes query
 *    + 21-day version freshness follow-up;
 *  - Q12 oath date -> oath query variant + date-grounding audit (event date
 *    vs article publication date);
 *  - Q2/Q4/Q8/Q10/Q15 reasoning rules present in the system prompt.
 * All pure — no network.
 */
import { describe, test, expect } from 'bun:test'
import { shouldSearch } from '../../src/lib/research/policy'
import {
  buildDeterministicQuerySet,
  needsFreshnessFollowUp,
  officialFirstReads,
} from '../../src/lib/research/pipeline'
import { authorityScore, isPrimaryHost, type RankedSource } from '../../src/lib/research/rank'
import { auditClaimSupport, extractCalendarDates } from '../../src/lib/riishe/claims'
import { buildSystemPrompt } from '../../src/lib/riishe/prompts'
import { planRegenerate } from '../../src/lib/riishe/retry'

// ---- retrieval triggers (Q13 / Q14) ----------------------------------------

describe('retrieval triggers for entity questions', () => {
  test('a titled-work question triggers search (Q13 class)', () => {
    const d = shouldSearch('Tell me about the movie Scene: release date, hero and villain.')
    expect(d.search).toBe(true)
    const d2 = shouldSearch('When is the movie Scene releasing, and who are its hero and villain?')
    expect(d2.search).toBe(true)
    const d3 = shouldSearch('Which movie is titled Saindhav?')
    expect(d3.search).toBe(true)
  })

  test("an entity's latest developments trigger search (Q14 class)", () => {
    const d = shouldSearch('What are the latest developments from NVIDIA?')
    expect(d.search).toBe(true)
  })

  test('ordinary stable-knowledge questions still skip search', () => {
    expect(shouldSearch('Is there any material that can behave like both a liquid and a solid?').search).toBe(false)
    expect(shouldSearch('Explain the difference between correlation and causation.').search).toBe(false)
  })
})

// ---- deterministic query additions -----------------------------------------

describe('buildDeterministicQuerySet', () => {
  test('adds an exact-title query for a titled work plus a villain-targeted query (Q13 class)', () => {
    const { queries, added } = buildDeterministicQuerySet(
      'Tell me about the movie Scene: release date, hero and villain.',
      ['Tell me about the movie Scene: release date, hero and villain.'],
    )
    expect(added.length).toBe(2)
    expect(queries.some((q) => q.includes('"Scene"'))).toBe(true)
    expect(queries.some((q) => /movie/i.test(q))).toBe(true)
    expect(queries.some((q) => /villain antagonist character/i.test(q))).toBe(true)
  })

  test('adds an official-announcement query for entity developments (Q14 class)', () => {
    const { queries, added } = buildDeterministicQuerySet(
      'What are the latest developments from NVIDIA?',
      ['latest developments NVIDIA'],
    )
    expect(added.length).toBe(1)
    expect(queries.some((q) => /NVIDIA official announcement newsroom/i.test(q))).toBe(true)
  })

  test('adds an official release-notes query and a GitHub releases query for version questions (Q11 class)', () => {
    const { queries, added } = buildDeterministicQuerySet(
      'What is the latest stable version of Next.js? Give its release date.',
      ['Next.js latest stable version'],
    )
    expect(added.length).toBe(2)
    expect(queries.some((q) => /Next\.js official release notes changelog/i.test(q))).toBe(true)
    expect(queries.some((q) => /Next\.js GitHub releases latest version/i.test(q))).toBe(true)
  })

  test('adds an oath-date query for officeholder appointment questions (Q12 class)', () => {
    const message = 'Who is the current Chief Minister of Tamil Nadu, and when did they take office?'
    const { queries, added } = buildDeterministicQuerySet(message, ['current Chief Minister of Tamil Nadu'])
    expect(added.length).toBe(1)
    expect(queries.some((q) => /oath sworn/i.test(q))).toBe(true)
  })

  test('adds nothing for ordinary explanations and stays bounded', () => {
    const ordinary = buildDeterministicQuerySet('Why is the sky blue during the day?', ['why is the sky blue'])
    expect(ordinary.added).toEqual([])
    const many = buildDeterministicQuerySet(
      'Tell me about the movie Scene and the latest developments from NVIDIA and the version of Next.js',
      ['a', 'b', 'c', 'd', 'e'],
    )
    expect(many.queries.length).toBeLessThanOrEqual(5)
  })
})

// ---- version freshness follow-up (Q11) --------------------------------------

function rankedWithAge(days: number | null): RankedSource[] {
  return [
    {
      id: 1,
      url: 'https://example.com/a',
      title: 'A',
      snippet: 'snippet',
      hostName: 'example.com',
      date: days === null ? null : new Date(Date.now() - days * 86_400_000).toISOString(),
      freshness: null,
      year: days === null ? null : new Date().getUTCFullYear(),
      authority: 0.4,
      official: false,
      social: false,
      sourceType: 'other',
      score: 1,
    },
  ]
}

describe('needsFreshnessFollowUp threshold', () => {
  test('default threshold is 45 days', () => {
    expect(needsFreshnessFollowUp(rankedWithAge(39))).toBe(false)
    expect(needsFreshnessFollowUp(rankedWithAge(46))).toBe(true)
  })
  test('version questions use the tighter 21-day window (Q11: 39-day-old evidence)', () => {
    expect(needsFreshnessFollowUp(rankedWithAge(39), 21)).toBe(true)
    expect(needsFreshnessFollowUp(rankedWithAge(10), 21)).toBe(false)
    expect(needsFreshnessFollowUp(rankedWithAge(null), 21)).toBe(true)
  })
})

// ---- primary announcement hosts + read scheduling (Q14 / Q11) ---------------

describe('primary announcement hosts and official-first page reads', () => {
  test("a company's own announcement host is primary", () => {
    expect(isPrimaryHost('nvidianews.nvidia.com')).toBe(true)
    expect(isPrimaryHost('www.nvidia.com')).toBe(true)
    expect(isPrimaryHost('nextjs.org')).toBe(true)
    expect(isPrimaryHost('medium.com')).toBe(false)
  })

  test('authority: primary hosts outrank generic hosts', () => {
    expect(authorityScore('nvidianews.nvidia.com')).toBe(0.9)
    expect(authorityScore('nextjs.org')).toBe(0.9)
    expect(authorityScore('someblog.dev')).toBe(0.4)
  })

  test('officialFirstReads reads the primary host before third-party pages', () => {
    const sources = [
      { hostName: 'medium.com', official: false, url: 'u1' },
      { hostName: 'www.facebook.com', official: false, url: 'u2' },
      { hostName: 'nextjs.org', official: false, url: 'u3' },
      { hostName: 'reuters.com', official: false, url: 'u4' },
    ]
    const plan = officialFirstReads(sources, 2)
    expect(plan.map((s) => s.hostName)).toEqual(['nextjs.org', 'medium.com'])
  })

  test('officialFirstReads keeps a single-source or zero budget intact', () => {
    const one = [{ hostName: 'medium.com', official: false, url: 'u1' }]
    expect(officialFirstReads(one, 2).length).toBe(1)
    expect(officialFirstReads(one, 0)).toEqual([])
  })
})

// ---- date-grounding audit (Q12: event date vs publication date) -------------

describe('date-grounding audit (ungroundedDates)', () => {
  const sourceTexts = new Map([
    // The cited page's text mentions the event on the 10th — never the 11th.
    [1, 'Vijay Takes Oath as Tamil Nadu CM — Joseph Vijay took oath as Chief Minister on May 10, 2026 at Chennai.'],
  ])

  test('extracts calendar dates in the common answer formats', () => {
    const dates = extractCalendarDates('He took office on May 11, 2026 and resigned on 20 June 2027.')
    const keys = dates.map((d) => `${d.mon}-${d.day}-${d.year}`).sort()
    expect(keys).toEqual(['jun-20-2027', 'may-11-2026'])
  })

  test('flags an event date the cited source text does not contain', () => {
    const audit = auditClaimSupport(
      'Joseph Vijay is the current Chief Minister of Tamil Nadu [1].',
      new Set([1]),
      sourceTexts,
      { fullCorpus: sourceTexts.get(1) ?? '' },
    )
    expect(audit.ungroundedDates).toEqual([])
    const flagged = auditClaimSupport(
      'Joseph Vijay took office on May 11, 2026 [1].',
      new Set([1]),
      sourceTexts,
      { fullCorpus: sourceTexts.get(1) ?? '' },
    )
    expect(flagged.ungroundedDates.length).toBe(1)
    expect(flagged.ungroundedDates[0]).toContain('May 11, 2026')
  })

  test('accepts an event date the cited source text states', () => {
    const ok = auditClaimSupport(
      'Joseph Vijay took oath on May 10, 2026 [1].',
      new Set([1]),
      sourceTexts,
      { fullCorpus: sourceTexts.get(1) ?? '' },
    )
    expect(ok.ungroundedDates).toEqual([])
  })

  test('a publish-date URL slug never grounds a date (URL excluded from the date corpus)', () => {
    const audit = auditClaimSupport(
      'Joseph Vijay took office on May 11, 2026 [1].',
      new Set([1]),
      // dateSourceTexts deliberately omits the URL text
      new Map([[1, 'Vijay Takes Oath as Tamil Nadu CM — the swearing-in ceremony was held in Chennai.']]),
      {
        fullCorpus: 'Vijay Takes Oath as Tamil Nadu CM /2026/05/11/vijay-takes-oath — sworn in',
        dateSourceTexts: new Map([[1, 'Vijay Takes Oath as Tamil Nadu CM — the swearing-in ceremony was held in Chennai.']]),
      },
    )
    expect(audit.ungroundedDates.length).toBe(1)
  })
})

// ---- prompt rules (Q2 / Q4 / Q8 / Q10 / Q15 / Q13) ---------------------------

describe('system prompt reasoning + entity rules', () => {
  const prompt = buildSystemPrompt({ evidenceBlock: null, task: 'general', staleness: null })
  const researchPrompt = buildSystemPrompt({
    evidenceBlock: 'EVIDENCE',
    task: 'research',
    staleness: null,
  })

  test('analogy-accuracy rule present (Q2 class)', () => {
    expect(prompt).toContain('Accuracy outranks simplicity')
    expect(prompt).toContain('where it stops matching reality')
  })
  test('category-vs-behavior rule present (Q4 class)', () => {
    expect(prompt).toContain('Keep categories exact')
  })
  test('pattern-verification rule present (Q8 class)', () => {
    expect(prompt).toContain('test it against EVERY data point')
  })
  test('calendar derivation rule present (Q10 class)', () => {
    expect(prompt).toContain('derive the answer step by step from the given anchor')
  })
  test('multi-part completeness rule present (Q15 class)', () => {
    expect(prompt).toContain('Answer every part of a multi-part question explicitly')
  })
  test('exact-title entity rule present with anti-substitution wording (Q13 class)', () => {
    expect(researchPrompt).toContain('Identify titled entities EXACTLY')
    expect(researchPrompt).toContain('NEVER substitute a different title')
  })
  test('event-date vs publication-date rule present (Q12 class)', () => {
    expect(researchPrompt).toContain('Event date versus publication date')
  })
})

// ---- regenerate planning (PART 4 association) -------------------------------

describe('planRegenerate contract', () => {
  test('trailing regenerate is ALWAYS a wire retry (with or without a server id)', () => {
    expect(planRegenerate({ isTrailing: true, serverId: 'm1' })).toEqual({ mode: 'trailing', retry: true })
    expect(planRegenerate({ isTrailing: true, serverId: null })).toEqual({ mode: 'trailing', retry: true })
  })
  test('earlier-message regenerate requires a persisted server id', () => {
    expect(planRegenerate({ isTrailing: false, serverId: 'm7' })).toEqual({
      mode: 'from-message',
      retry: false,
      retryFromMessageId: 'm7',
    })
    expect(planRegenerate({ isTrailing: false, serverId: null })).toBeNull()
  })
})
