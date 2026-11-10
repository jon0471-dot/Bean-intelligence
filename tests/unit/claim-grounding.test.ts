/**
 * Claim-to-source grounding regression tests (final verification-quality fix).
 *
 * Work-order requirement: "A verification warning should identify an actual
 * unsupported or conflicting claim, not merely fail because the source
 * phrases the same fact differently." Each test maps 1:1 to the eight
 * required regression cases:
 *   1. a claim directly supported by an official source
 *   2. equivalent wording between a source and an answer
 *   3. a genuinely unsupported claim
 *   4. contradictory dates or names
 *   5. a software query receiving an unrelated missing-person warning
 *   6. multiple sources supporting different parts of an answer
 *   7. a sensitive allegation that requires explicit attribution
 *   8. a stale answer conflicting with newer dated reporting
 * All pure/deterministic — no SDK, no gateway.
 */
import { describe, test, expect } from 'bun:test'

import { auditClaimSupport, findInternalNameConflicts, staleCurrencyConflict, undatedAsOfClaims } from '../../src/lib/riishe/claims'
import { computeGeoWarning } from '../../src/lib/research/pipeline'
import { detectSensitiveCase } from '../../src/lib/research/sensitive'
import { findInternalDateConflicts } from '../../src/lib/riishe/dedupe'
import { geoTermsOf, textMentionsTerm } from '../../src/lib/research/geo'

const OFFICIAL = new Map<number, string>([
  // Lok Bhavan-style official record: names the officeholder, no acronym.
  [
    1,
    'Chief Minister of Tamil Nadu - Official Site https://lokbhavan.tn.gov.in/cm '
      + 'Honourable Chief Minister Joseph Vijay assumed office on 10 May 2026. '
      + 'The Chief Minister leads the Council of Ministers of Tamil Nadu.',
  ],
])

describe('regression 1: a claim directly supported by an official source', () => {
  test('a cited claim backed by the official source produces NO warning flags', () => {
    const answer = 'C. Joseph Vijay is the current Chief Minister of Tamil Nadu [1].'
    const audit = auditClaimSupport(answer, new Set([1]), OFFICIAL)
    expect(audit.materialCount).toBe(1)
    expect(audit.supportedCount).toBe(1)
    expect(audit.coverage).toBe(1)
    expect(audit.unsupported).toHaveLength(0)
    expect(audit.uncitedSupported).toHaveLength(0)
    expect(audit.ungroundedNames).toHaveLength(0)
    expect(audit.unattributedAllegations).toHaveLength(0)
    expect(audit.nameConflicts).toHaveLength(0)
    expect(audit.uncovered).toHaveLength(0)
  })

  test('the same claim WITHOUT a marker is supported-but-uncited, never "not covered by the sources"', () => {
    // Measured false-warning class: the official source plainly supports the
    // claim; the old wording asserted the opposite ("not covered by the
    // retrieved sources").
    const answer = 'C. Joseph Vijay is the current Chief Minister of Tamil Nadu.'
    const audit = auditClaimSupport(
      answer,
      new Set([1]),
      OFFICIAL,
      { sensitiveCase: false, fullCorpus: [...OFFICIAL.values()].join(' ') },
    )
    expect(audit.materialCount).toBe(1)
    expect(audit.supportedCount).toBe(0)
    expect(audit.uncitedSupportedTotal).toBe(1)
    expect(audit.unsupportedTotal).toBe(0)
    expect(audit.uncovered).toHaveLength(1) // still queued for the repair pass
  })
})

describe('regression 2: equivalent wording between a source and an answer', () => {
  test('an answer acronym is grounded when the cited source spells the name out', () => {
    const corpus = new Map<number, string>([
      [1, 'TVK founder takes oath: Joseph Vijay, founder of the Tamilaga Vettri Kazhagam, was sworn in today.'],
    ])
    const answer = 'He is the founder of the Tamilaga Vettri Kazhagam party [1].'
    const audit = auditClaimSupport(answer, new Set([1]), corpus)
    expect(audit.ungroundedNames).toHaveLength(0)
  })

  test('an answer expansion is grounded when the cited source uses only the acronym', () => {
    const corpus = new Map<number, string>([
      [1, 'The DMK government announced the scheme; party sources confirmed the rollout.'],
    ])
    const answer = 'The Dravida Munnetra Kazhagam government announced the scheme [1].'
    const audit = auditClaimSupport(answer, new Set([1]), corpus)
    expect(audit.ungroundedNames).toHaveLength(0)
  })

  test('punctuation variants of the same name match ("CB-CID" vs "CB CID")', () => {
    const corpus = new Map<number, string>([
      [1, 'The CB CID took over the investigation on October 22.'],
    ])
    const answer = 'The CB-CID began its probe into the case [1].'
    const audit = auditClaimSupport(answer, new Set([1]), corpus)
    expect(audit.ungroundedNames).toHaveLength(0)
  })

  test('normalized mention matching treats "Next.js" and "nextjs" as the same term', () => {
    expect(textMentionsTerm('Next.js 16.4 release notes', 'nextjs')).toBe(true)
    expect(textMentionsTerm('npm package next', 'nextjs')).toBe(false)
    expect(geoTermsOf('What is the latest stable version of Next.js?')).toContain('nextjs')
  })

  test('an organization acronym is grounded when ANY retrieved source uses it (snippet-only corpus)', () => {
    // Measured: the cited source's page read failed (429) and its snippet
    // lacked "CB-CID" that other retrieved sources plainly use.
    const cited = new Map<number, string>([[3, 'Police probing all angles, says Minister Nirmal Kumar']])
    const full = 'Girl missing in Gingee: CB-CID begins probe. CB-CID steps up search for missing 7-year-old girl.'
    const answer = 'The CB-CID continues to lead the investigation [3].'
    const audit = auditClaimSupport(answer, new Set([3]), cited, { fullCorpus: full })
    expect(audit.ungroundedNames).toHaveLength(0)
  })

  test('a person name is still held to the CITED sources only', () => {
    const cited = new Map<number, string>([[3, 'Police probing all angles, says Minister Nirmal Kumar']])
    const full = 'extensive searches for the missing girl Hemavathi fail to yield results'
    const answer = 'Officials said Hemavathi remains untraced [3].'
    const audit = auditClaimSupport(answer, new Set([3]), cited, { fullCorpus: full })
    expect(audit.ungroundedNames).toContain('Hemavathi')
  })
})

describe('regression 3: a genuinely unsupported claim', () => {
  test('content absent from every retrieved source is flagged as unsupported', () => {
    const fullCorpus = [...OFFICIAL.values()].join(' ')
    const answer = 'Joseph Vijay previously served as the Mayor of Chennai for two terms.'
    const audit = auditClaimSupport(answer, new Set([1]), OFFICIAL, { fullCorpus })
    expect(audit.materialCount).toBe(1)
    expect(audit.unsupportedTotal).toBe(1)
    expect(audit.uncitedSupportedTotal).toBe(0)
    expect(audit.unsupported[0]).toContain('Mayor of Chennai')
  })

  test('the verification note says "not supported by the retrieved sources" for such claims', () => {
    // covered indirectly here via the split totals consumed by the note
    const audit = auditClaimSupport(
      'Joseph Vijay previously served as the Mayor of Chennai for two terms.',
      new Set([1]),
      OFFICIAL,
      { fullCorpus: [...OFFICIAL.values()].join(' ') },
    )
    expect(audit.unsupportedTotal).toBeGreaterThan(0)
  })
})

describe('regression 4: contradictory dates or names', () => {
  test('the same fact with different dates in one answer is flagged', () => {
    const answer =
      'Joseph Vijay took office on May 10, 2026 after the election. '
        + 'Joseph Vijay took office on May 10, 2021 after the election.'
    expect(findInternalDateConflicts(answer)).toHaveLength(1)
  })

  test('two different person names for the same role are flagged as a name conflict', () => {
    // Measured Gingee defect: "seven-year-old Hemalatha" [3] vs
    // "7-year-old V Hemavathi" [4] presented as one girl with no disagreement.
    const answer =
      'Intensive search operations continue for seven-year-old Hemalatha near Gingee [1]. '
        + 'No clues were found regarding the missing girl, identified as 7-year-old V Hemavathi [2].'
    const conflicts = findInternalNameConflicts(answer)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toContain('Hemalatha')
    expect(conflicts[0]).toContain('Hemavathi')
  })

  test('one consistent name never produces a name conflict', () => {
    const answer =
      'The search for seven-year-old Hemalatha continued for a second day [1]. '
        + 'Hemalatha went missing from her home near Gingee [2].'
    expect(findInternalNameConflicts(answer)).toHaveLength(0)
  })

  test('publishers and agencies are not mistaken for person names', () => {
    const answer =
      'The Hindu and The New Indian Express reported that the CB-CID has begun questioning the girl\'s mother, but the girl remains missing [1].'
    expect(findInternalNameConflicts(answer)).toHaveLength(0)
  })
})

describe('regression 5: a software query must not receive a missing-person warning', () => {
  const nextjsResults = [
    { title: 'Next.js 16.4', snippet: 'Next.js 16.4 was released on Oct 6, 2026 with Cache Components improvements.', excerpt: null },
    { title: 'next - npm', snippet: 'next v16.4.3: The React Framework for the Web.', excerpt: null },
  ]
  const unrelatedResults = [
    { title: 'Missing hiker found in the Alps', snippet: 'A tourist was rescued after two days in the mountains.', excerpt: null },
  ]

  test('the Next.js version query never triggers the place/case warning', () => {
    const q = 'What is the latest stable version of Next.js?'
    // even when NO source contains the literal token "nextjs" (they all write "Next.js")
    expect(computeGeoWarning(q, nextjsResults)).toBeNull()
    // and even when the results are entirely unrelated, a non-place,
    // non-case query is out of the warning's domain
    expect(computeGeoWarning(q, unrelatedResults)).toBeNull()
  })

  test('a genuinely place-anchored query with unrelated results still warns', () => {
    const q = 'Research a current topic: Gingee girl missing'
    expect(computeGeoWarning(q, unrelatedResults)).toMatch(/gingee/i)
  })

  test('the software query is not classified as a sensitive case', () => {
    expect(detectSensitiveCase('What is the latest stable version of Next.js?').sensitive).toBe(false)
    expect(detectSensitiveCase('Research a current topic: Gingee girl missing').sensitive).toBe(true)
  })
})

describe('regression 6: multiple sources supporting different parts of an answer', () => {
  const sources = new Map<number, string>([
    [1, 'Chief Minister Joseph Vijay assumed office on 10 May 2026, official records state.'],
    [2, 'BBC News: The film star was elected in Tamil Nadu after days of political uncertainty.'],
  ])

  test('each part is supported by its own source; coverage is complete', () => {
    const answer =
      'Joseph Vijay assumed office on May 10, 2026 [1]. '
        + 'He was elected in Tamil Nadu after days of political uncertainty [2].'
    const audit = auditClaimSupport(answer, new Set([1, 2]), sources)
    expect(audit.materialCount).toBe(2)
    expect(audit.supportedCount).toBe(2)
    expect(audit.coverage).toBe(1)
    expect(audit.uncovered).toHaveLength(0)
    expect(audit.ungroundedNames).toHaveLength(0)
  })
})

describe('regression 7: a sensitive allegation requires explicit attribution', () => {
  const caseSources = new Map<number, string>([
    [1, 'The Hindu: police said a suspect was detained for questioning in the Gingee case.'],
  ])

  test('a bare detention allegation is flagged', () => {
    const answer = 'A suspect has been detained in connection with the disappearance.'
    const audit = auditClaimSupport(answer, new Set([1]), caseSources, { sensitiveCase: true })
    expect(audit.unattributedAllegations.length).toBeGreaterThan(0)
  })

  test('the attributed allegation passes', () => {
    const answer = 'Police said a suspect was detained for questioning in the case [1].'
    const audit = auditClaimSupport(answer, new Set([1]), caseSources, { sensitiveCase: true })
    expect(audit.unattributedAllegations).toHaveLength(0)
  })

  test('detention for questioning is never upgraded: the audit only demands attribution, cited wording stays honest', () => {
    const answer = 'The Hindu reported, citing police, that a man was detained for questioning [1].'
    const audit = auditClaimSupport(answer, new Set([1]), caseSources, { sensitiveCase: true })
    expect(audit.unattributedAllegations).toHaveLength(0)
    expect(audit.unsupportedTotal).toBe(0)
  })

  test('an unattributed "90% chance" outcome claim is flagged; the attributed form passes', () => {
    const bare = 'There is a 90% chance the girl is still alive.'
    const flagged = auditClaimSupport(bare, new Set([1]), caseSources, { sensitiveCase: true })
    expect(flagged.unattributedProbabilistic.length).toBeGreaterThan(0)

    const attributed = 'The Hindu reported, citing investigators, that there is a 90% chance the girl is still alive [1].'
    const clean = auditClaimSupport(attributed, new Set([1]), caseSources, { sensitiveCase: true })
    expect(clean.unattributedProbabilistic).toHaveLength(0)
  })

  test('probabilistic attribution is scoped to sensitive cases', () => {
    const nonSensitive = 'Roughly 90 percent of developers say build times improved, and the found bugs were fixed.'
    const audit = auditClaimSupport(nonSensitive, new Set([1]), new Map([[1, 'survey results']]), { sensitiveCase: false })
    expect(audit.unattributedProbabilistic).toHaveLength(0)
  })
})

describe('regression 8: a stale answer conflicting with newer dated reporting', () => {
  test('a latest-version claim citing only a months-old blog while newer evidence exists is flagged', () => {
    // Measured: the answer said "latest stable is 16.1 (Dec 18, 2025)" while
    // the evidence also contained the current registry record (Oct 2026).
    const warning = staleCurrencyConflict({
      answer: 'The latest stable version of Next.js is 16.1, released on December 18, 2025 [4].',
      citedNewestAgeDays: 315,
      evidenceNewestAgeDays: 6,
    })
    expect(warning).not.toBeNull()
    expect(warning).toContain('newer retrieved evidence exists')
  })

  test('no flag when the cited sources are as new as the evidence', () => {
    expect(
      staleCurrencyConflict({
        answer: 'The latest stable version of Next.js is 16.4.3 [2].',
        citedNewestAgeDays: 6,
        evidenceNewestAgeDays: 6,
      }),
    ).toBeNull()
    expect(
      staleCurrencyConflict({
        answer: 'The latest stable version of Next.js is 16.4.3 [2].',
        citedNewestAgeDays: 10,
        evidenceNewestAgeDays: 6,
      }),
    ).toBeNull()
  })

  test('no flag without a currency superlative or without dated evidence', () => {
    expect(
      staleCurrencyConflict({
        answer: 'The framework introduced Cache Components in the 16.4 release.',
        citedNewestAgeDays: 315,
        evidenceNewestAgeDays: 6,
      }),
    ).toBeNull()
    expect(
      staleCurrencyConflict({
        answer: 'The latest stable version of Next.js is 16.1.',
        citedNewestAgeDays: null,
        evidenceNewestAgeDays: 6,
      }),
    ).toBeNull()
    expect(
      staleCurrencyConflict({
        answer: 'The latest stable version of Next.js is 16.1.',
        citedNewestAgeDays: 315,
        evidenceNewestAgeDays: null,
      }),
    ).toBeNull()
  })

  test('an "As of <date>" statement grounded only on undated sources is flagged', () => {
    const answer = 'As of October 27, 2026, News18 reported that CCTV footage has been obtained in the case [6].'
    const dates = new Map<number, string | null>([[6, null]])
    const flags = undatedAsOfClaims(answer, dates)
    expect(flags).toHaveLength(1)
    expect(flags[0]).toContain('As of October 27, 2026')
  })

  test('an "As of" statement backed by a dated source is never flagged', () => {
    const answer = 'As of October 26, 2026, The Samaja reported that police are probing all angles [3].'
    const dates = new Map<number, string | null>([[3, '2026-10-26T11:09:44.000Z']])
    expect(undatedAsOfClaims(answer, dates)).toHaveLength(0)
  })

  test('markdown bullets never become person-name candidates (measured "Intensive" false conflict)', () => {
    const answer =
      '- **Oct 16, 2026**: Intensive search operations continue for seven-year-old Hemalatha near Gingee [1].\n'
        + '- **Oct 21, 2026**: No clues regarding the missing girl, identified as 7-year-old V Hemavathi [2].'
    expect(findInternalNameConflicts(answer)).toHaveLength(1)
    expect(findInternalNameConflicts(answer)[0]).toContain('Hemalatha')
    expect(findInternalNameConflicts(answer)[0]).toContain('Hemavathi')
    expect(findInternalNameConflicts(answer)[0]).not.toContain('Intensive')
  })
})
