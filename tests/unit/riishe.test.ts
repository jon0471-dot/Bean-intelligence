/**
 * BEAN Intelligence — unit tests for RIISHE upgrade primitives.
 * Run: bun test tests/unit/riishe.test.ts
 *
 * Covers: search policy, ranking/dedup/freshness, citation integrity,
 * safe arithmetic evaluation, task classification. All pure — no network.
 */
import { describe, test, expect } from 'bun:test'
import { shouldSearch, isDocumentLike } from '../../src/lib/research/policy'
import {
  rankSources,
  dedupByUrl,
  parseSourceDate,
  freshnessScore,
  authorityScore,
  stalenessWarning,
  isOfficialHost,
} from '../../src/lib/research/rank'
import type { WebSearchResult } from '../../src/lib/research/provider'
import {
  evaluateExpression,
  parseSelfCheck,
  verifyComputations,
  numericEqual,
} from '../../src/lib/verify/exprcheck'
import {
  extractCitationIds,
  extractUrls,
  auditCitations,
  stripFabricatedUrls,
} from '../../src/lib/verify/citations'
import { classifyTask } from '../../src/lib/riishe/classify'
import { buildSystemPrompt, buildUserTurn } from '../../src/lib/riishe/prompts'
import { liftSelfCheck } from '../../src/lib/riishe/orchestrator'
import type { EvidenceSource } from '../../src/lib/research/pipeline'

function src(partial: Partial<WebSearchResult> & { url: string }): WebSearchResult {
  return {
    title: partial.title ?? 'Title',
    snippet: partial.snippet ?? 'snippet text',
    hostName: partial.hostName ?? new URL(partial.url).hostname,
    rank: partial.rank ?? 1,
    date: partial.date ?? null,
    ...partial,
  }
}

describe('search policy', () => {
  test('searches for current officeholders and prices', () => {
    expect(shouldSearch('Who is the current CEO of NVIDIA?').search).toBe(true)
    expect(shouldSearch('Who is the current president of Brazil?').search).toBe(true)
    expect(shouldSearch('What is the share price of Apple today?').search).toBe(true)
    expect(shouldSearch('Who won the match yesterday?').search).toBe(true)
  })

  test('skips math, creative tasks, greetings and code', () => {
    expect(shouldSearch('Calculate 17 * 23 - 45').search).toBe(false)
    expect(shouldSearch('Solve x^2 + 2x + 1 = 0').search).toBe(false)
    expect(shouldSearch('Write a haiku about autumn').search).toBe(false)
    expect(shouldSearch('hi there').search).toBe(false)
    expect(shouldSearch('My python function throws a KeyError, how do I fix it?').search).toBe(false)
  })

  test('recency window scales with risk', () => {
    expect(shouldSearch('Who is the current prime minister of Japan?').recencyDays).toBe(180)
    expect(shouldSearch('What are the visa requirements for Japan?').recencyDays).toBe(365)
  })

  test('document-like long inputs do not auto-search (guard)', () => {
    const long = 'document '.repeat(600) + 'latest version'
    expect(isDocumentLike(long)).toBe(true)
    expect(isDocumentLike('short latest version')).toBe(false)
  })
})

describe('ranking and dedup', () => {
  test('dedups by URL ignoring query/hash and trailing slash', () => {
    const out = dedupByUrl([
      src({ url: 'https://example.com/a?x=1', title: 'A1' }),
      src({ url: 'https://example.com/a', title: 'A2' }),
      src({ url: 'https://example.com/a/', title: 'A3' }),
      src({ url: 'https://other.com/a', title: 'B' }),
    ])
    expect(out).toHaveLength(2)
  })

  test('authority: official > primary > reputable > generic', () => {
    expect(authorityScore('nasa.gov')).toBe(1)
    expect(authorityScore('www.who.int')).toBe(1)
    expect(authorityScore('docs.python.org')).toBe(0.9)
    expect(authorityScore('reuters.com')).toBe(0.75)
    expect(authorityScore('random-blog.io')).toBe(0.4)
    expect(isOfficialHost('gov.uk')).toBe(true) // the bare registrable domain is official
    expect(isOfficialHost('sub.gov.uk')).toBe(true)
    expect(isOfficialHost('not-gov.uk')).toBe(false) // dot-boundary must hold
    expect(isOfficialHost('example.com')).toBe(false)
  })

  test('freshness decays with age; unknown parses safely', () => {
    expect(freshnessScore(3)).toBe(1)
    expect(freshnessScore(300)).toBe(0.5)
    expect(freshnessScore(400)).toBe(0.3)
    expect(freshnessScore(null)).toBeNull()
    expect(parseSourceDate('2026-09-15')).toEqual({ year: 2026, ageDays: expect.any(Number) })
    expect(parseSourceDate('nonsense')).toEqual({ year: null, ageDays: null })
  })

  test('rankSources orders by combined score and assigns citation ids 1..n', () => {
    const results = [
      src({ url: 'https://random.io/a', rank: 5 }),
      src({ url: 'https://nasa.gov/announcement', rank: 2, date: new Date(Date.now() - 86400000 * 3).toISOString() }),
      src({ url: 'https://random.io/dup', rank: 1 }),
    ]
    const ranked = rankSources('nasa announcement', results, { freshnessMatters: true, limit: 3 })
    expect(ranked[0].id).toBe(1)
    expect(ranked[0].official).toBe(true)
    expect(ranked.map((r) => r.id)).toEqual([1, 2, 3])
  })

  test('staleness warning fires when dated evidence is older than this year', () => {
    const old = [{ id: 1, year: 2023, freshness: 0.1, url: '', title: '', snippet: '', hostName: '', date: '2023-01-01', authority: 0.4, official: false, score: 1 }]
    expect(stalenessWarning(old)).toContain('2023')
    expect(stalenessWarning([])).toBeNull()
  })
})

describe('citation integrity', () => {
  const sources: EvidenceSource[] = [1, 2, 3].map((i) => ({
    id: i,
    url: `https://src${i}.example.com/page`,
    title: `Source ${i}`,
    snippet: 's',
    hostName: `src${i}.example.com`,
    date: null,
    freshness: null,
    year: null,
    authority: 0.5,
    official: false,
    score: 0.5,
    pageRead: false,
    excerpt: null,
  }))

  test('extracts [n] markers including grouped form', () => {
    expect(extractCitationIds('a [1] b [2,3] c [99]')).toEqual([1, 2, 3, 99])
  })

  test('flags references outside the evidence set and fabricated URLs', () => {
    const audit = auditCitations('Claim one [1]. Claim two [99]. See https://evil.example/x', sources)
    expect(audit.invalidIds).toEqual([99])
    expect(audit.fabricatedUrls).toEqual(['https://evil.example/x'])
    expect(audit.usedSources.map((s) => s.id)).toEqual([1])
  })

  test('accepts markdown links to retrieved sources', () => {
    const audit = auditCitations('Per [the source](https://src2.example.com/page) it holds [2].', sources)
    expect(audit.fabricatedUrls).toHaveLength(0)
    expect(audit.usedSources.map((s) => s.id)).toEqual([2])
  })

  test('strips fabricated URLs and keeps real ones', () => {
    const { text, removed } = stripFabricatedUrls(
      'Real: https://src1.example.com/page Fake: https://fake.example/z',
      sources,
    )
    expect(removed).toEqual(['https://fake.example/z'])
    expect(text).toContain('src1.example.com')
    expect(text).not.toContain('fake.example')
  })

  test('extractUrls captures bare and markdown targets', () => {
    const urls = extractUrls('go to https://a.com/x and [text](https://b.com/y)')
    expect(urls).toContain('https://a.com/x')
    expect(urls).toContain('https://b.com/y')
  })
})

describe('safe arithmetic evaluation', () => {
  test('evaluates exact integer and float expressions', () => {
    expect(evaluateExpression('2**10')).toBe('1024')
    expect(evaluateExpression('(3+4)*5/2')).toBe('17.5')
    expect(evaluateExpression('factorial(10)')).toBe('3628800')
    expect(evaluateExpression('factorial(20)')).toBe('2432902008176640000') // exact beyond 2^53
    expect(evaluateExpression('gcd(48, 180)')).toBe('12')
    expect(evaluateExpression('comb(5,2)')).toBe('10')
    expect(evaluateExpression('sqrt(144)')).toBe('12')
    expect(evaluateExpression('7//2')).toBe('3')
    expect(evaluateExpression('-7//2')).toBe('-4') // floor semantics
    expect(evaluateExpression('2*pi')).toBe('6.2831853072')
    expect(evaluateExpression('2^10')).toBe('1024') // caret alias
    expect(evaluateExpression('3 × 4 − 1')).toBe('11') // unicode ops normalized
  })

  test('rejects injection, unknown identifiers and overflow', () => {
    for (const bad of [
      'process.exit(1)',
      'fs.readFileSync("/etc/passwd")',
      '__import__("os")',
      'constructor',
      '9**9**9',
      '(10**100)**(10**100)',
      'factorial(10000)',
      '1; 2',
      '9' + '*9'.repeat(200),
      'a + b',
    ]) {
      expect(() => evaluateExpression(bad)).toThrow()
    }
  })

  test('numeric comparison tolerates formatting and float rounding', () => {
    expect(numericEqual('1,024', '1024')).toBe(true)
    expect(numericEqual('17.50', '17.5')).toBe(true)
    expect(numericEqual('0.3333333333', String(1 / 3))).toBe(true)
    expect(numericEqual('1024', '2048')).toBe(false)
    expect(numericEqual('abc', '12')).toBe(false)
  })

  test('verifyComputations reports honest pass/fail and never fakes success', async () => {
    const ok = await verifyComputations([
      { expr: '6*7', claimed: '42' },
      { expr: '2**10', claimed: '1,024' },
    ])
    expect(ok.ran).toBe(true)
    expect(ok.passed).toBe(true)

    const bad = await verifyComputations([{ expr: '2**10', claimed: '2048' }])
    expect(bad.ran).toBe(true)
    expect(bad.passed).toBe(false)

    const none = await verifyComputations([])
    expect(none.ran).toBe(false)
    expect(none.passed).toBe(false)
  })

  test('parseSelfCheck extracts CHECK lines', () => {
    const items = parseSelfCheck('Answer.\n\nSELF_CHECK:\nCHECK: 6*7 = 42\nCHECK: sqrt(16) = 4\n')
    expect(items).toEqual([
      { expr: '6*7', claimed: '42' },
      { expr: 'sqrt(16)', claimed: '4' },
    ])
  })
})

describe('task classification and prompts', () => {
  test('classifies math with verification, code with thinking, research lite', () => {
    expect(classifyTask('Solve the integral of x^2').task).toBe('math')
    expect(classifyTask('Solve the integral of x^2').verifyMath).toBe(true)
    expect(classifyTask('Fix this TypeError in my react component').task).toBe('coding')
    expect(classifyTask('What is the capital of France?').task).toBe('research')
    expect(classifyTask('What is the capital of France?').thinkingEnabled).toBe(false)
    expect(classifyTask('hello!').task).toBe('general')
  })

  test('prompt includes evidence protocol only when evidence exists', () => {
    const withEvidence = buildSystemPrompt({ evidenceBlock: '[1] X', task: 'research', staleness: null })
    expect(withEvidence).toContain('Evidence protocol')
    expect(withEvidence).toContain('[1] or [2]')
    const without = buildSystemPrompt({ evidenceBlock: null, task: 'general', staleness: null })
    expect(without).not.toContain('Evidence protocol')
    const math = buildSystemPrompt({ evidenceBlock: null, task: 'math', staleness: null })
    expect(math).toContain('SELF_CHECK')
  })

  test('user turn embeds evidence and the injection guard', () => {
    const turn = buildUserTurn('Who is the CEO?', {
      evidenceBlock: '[1] Someone',
      task: 'research',
      staleness: null,
    })
    expect(turn).toContain('[1] Someone')
    expect(turn).toContain('untrusted data')
  })

  test('liftSelfCheck removes the internal check block', () => {
    const cleaned = liftSelfCheck('The answer is 42.\n\nSELF_CHECK:\nCHECK: 6*7 = 42\n')
    expect(cleaned).not.toContain('SELF_CHECK')
    expect(cleaned).toContain('The answer is 42')
  })
})
