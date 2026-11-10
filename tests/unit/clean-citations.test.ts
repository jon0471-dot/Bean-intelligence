/**
 * Clean-citations + verification-UX contracts (work orders):
 *   - cleanAnswerForCopy: copy text carries no citation IDs or UI metadata
 *   - stripUnresolvedMarkers: persisted answers never keep orphaned markers
 *   - mapSourceClaims: Sources section "supports" lines derive from markers
 *   - removeDuplicateSentences / findInternalDateConflicts: answer hygiene
 *   - auditClaimSupport: material claims vs retrieved evidence coverage
 *   - buildVerificationNote: honest note composition, no badge noise
 */
import { describe, test, expect } from 'bun:test'

import {
  linkifyCitations,
  cleanAnswerForCopy,
  stripUnresolvedMarkers,
  mapSourceClaims,
} from '../../src/lib/riishe/citation-view'
import {
  removeDuplicateSentences,
  findInternalDateConflicts,
} from '../../src/lib/riishe/dedupe'
import { auditClaimSupport } from '../../src/lib/riishe/claims'
import { buildVerificationNote } from '../../src/lib/riishe/orchestrator'
import {
  placeKeysOf,
  regionContextFor,
  fastPathQueryVariants,
  geoTermsOf,
} from '../../src/lib/research/geo'
import {
  authorityScore,
  geoMismatchPenalty,
  staleNewsPenalty,
  rankSources,
} from '../../src/lib/research/rank'
import { needsFreshnessFollowUp, buildFollowUpQuery } from '../../src/lib/research/pipeline'
import { dedupeSourcesByUrl } from '../../src/lib/verify/citations'

const SOURCES = [
  { id: 1, hostName: 'www.thehindu.com' },
  { id: 2, hostName: 'theprint.in' },
  { id: 3, hostName: 'www.tn.gov.in' },
]

describe('cleanAnswerForCopy (copy excludes citation IDs and UI metadata)', () => {
  test('strips numeric markers but keeps natural prose', () => {
    const text = 'She remains untraced [1]. CB-CID began its probe [2, 3].'
    expect(cleanAnswerForCopy(text)).toBe('She remains untraced. CB-CID began its probe.')
  })

  test('unwraps internal source-name anchors to plain text, keeps external links', () => {
    const text =
      'The government lists him [Tamil Nadu Government](#bean-src-3) and the [BBC](https://bbc.com/news) reported it [1].'
    const out = cleanAnswerForCopy(text)
    expect(out).toContain('The government lists him Tamil Nadu Government')
    expect(out).toContain('[BBC](https://bbc.com/news)')
    expect(out).not.toContain('#bean-src')
    expect(out).not.toContain('[1]')
  })

  test('code blocks survive copy cleaning', () => {
    const text = 'Answer [1].\n\n```js\nconst x = arr[1]\n```'
    const out = cleanAnswerForCopy(text)
    expect(out).toContain('const x = arr[1]')
    expect(out).not.toContain('[1].')
  })
})

describe('stripUnresolvedMarkers (persisted text is clean server-side)', () => {
  test('keeps resolved markers raw for the client to linkify', () => {
    const out = stripUnresolvedMarkers('Claim [1] and [9].', new Set([1, 2, 3]))
    expect(out).toBe('Claim [1] and .')
  })

  test('partial groups with dangling ids are removed entirely', () => {
    const out = stripUnresolvedMarkers('Mixed [1, 99] group.', new Set([1, 2, 3]))
    expect(out).toBe('Mixed  group.')
  })

  test('code is untouched', () => {
    const out = stripUnresolvedMarkers('`arr[7]` stays', new Set([1]))
    expect(out).toBe('`arr[7]` stays')
  })
})

describe('mapSourceClaims (Sources section supports-lines)', () => {
  test('maps each cited source to the sentence it supports (markers stripped)', () => {
    const content =
      'The CB-CID began its probe [1]. The search is ongoing [2]. Unrelated closing sentence.'
    const claims = mapSourceClaims(content, SOURCES)
    expect(claims.get(1)).toBe('The CB-CID began its probe.')
    expect(claims.get(2)).toBe('The search is ongoing.')
    expect(claims.has(3)).toBe(false)
  })

  test('long sentences are trimmed for display', () => {
    const long = `${'word '.repeat(60)}trim [1].`
    const claims = mapSourceClaims(long, SOURCES)
    expect((claims.get(1) ?? '').length).toBeLessThanOrEqual(130)
    expect(claims.get(1)).toMatch(/\.\.\.$/)
  })
})

describe('removeDuplicateSentences (work order: same claim repeated)', () => {
  test('removes exact repeated sentences, keeps first occurrence', () => {
    const text =
      'He took office in May 2026 [1]. The assembly was sworn in [2]. He took office in May 2026 [1].'
    const out = removeDuplicateSentences(text)
    expect(out.text).toBe('He took office in May 2026 [1]. The assembly was sworn in [2].')
    expect(out.removed).toBe(1)
  })

  test('normalization ignores case, punctuation and citation markers', () => {
    const text = 'The probe continues [1].\n\nTHE PROBE CONTINUES! [1]'
    const out = removeDuplicateSentences(text)
    expect(out.removed).toBe(1)
    expect(out.text).toBe('The probe continues [1].')
  })

  test('code blocks and distinct sentences are untouched', () => {
    const text = '```js\nfoo();\nfoo();\n```\n\nOne fact [1]. Another fact [2].'
    const out = removeDuplicateSentences(text)
    expect(out.removed).toBe(0)
    expect(out.text).toBe(text)
  })

  test('person initials ("C. Joseph Vijay") do not split sentences', () => {
    const text = 'The Chief Minister of Tamil Nadu is C. Joseph Vijay. He took office [1].'
    const out = removeDuplicateSentences(text)
    expect(out.removed).toBe(0)
    // The full sentence stays one unit — it can be recognized as a duplicate.
    const again = removeDuplicateSentences(`${text} The Chief Minister of Tamil Nadu is C. Joseph Vijay.`)
    expect(again.removed).toBe(1)
  })
})

describe('findInternalDateConflicts (inconsistent dates in one answer)', () => {
  test('flags the same claim stated with two different years', () => {
    const text =
      'He took office in May 2026. Some context sentence without dates. He took office in May 2021.'
    const conflicts = findInternalDateConflicts(text)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toContain('2021, 2026')
  })

  test('distinct statements with different dates are not flagged', () => {
    const text = 'The search began on October 16, 2026. The probe started October 22, 2026.'
    expect(findInternalDateConflicts(text)).toHaveLength(0)
  })
})

describe('auditClaimSupport (material claims vs retrieved evidence)', () => {
  const resolved = new Set([1, 2, 3])

  test('fully cited material sentences give coverage 1', () => {
    const text =
      'The 7-year-old girl remains missing near Gingee [1]. The CB-CID began its probe on October 22, 2026 [2].'
    const audit = auditClaimSupport(text, resolved)
    expect(audit.materialCount).toBe(2)
    expect(audit.supportedCount).toBe(2)
    expect(audit.coverage).toBe(1)
    expect(audit.uncovered).toHaveLength(0)
  })

  test('uncited material claims are reported with examples', () => {
    const text =
      'The 7-year-old girl remains missing near Gingee [1]. Officials said the CB-CID recovered ransom money.'
    const audit = auditClaimSupport(text, resolved)
    expect(audit.materialCount).toBe(2)
    expect(audit.supportedCount).toBe(1)
    expect(audit.coverage).toBe(0.5)
    expect(audit.uncovered[0]).toContain('ransom')
  })

  test('connective sentences without factual signals are not material', () => {
    const text = 'That is the situation so far. It remains an ongoing case.'
    const audit = auditClaimSupport(text, resolved)
    expect(audit.materialCount).toBe(0)
    expect(audit.coverage).toBe(1)
  })

  test('code content is excluded from the audit', () => {
    const text = 'Use this snippet:\n\n```js\nconst version = 16;\n```'
    const audit = auditClaimSupport(text, resolved)
    expect(audit.materialCount).toBe(0)
  })
})

describe('buildVerificationNote (only when something material is unconfirmed)', () => {
  const base = {
    researchRan: true,
    hasSources: true,
    citationsValid: true as const,
    invalidMarkerCount: 0,
    uncitedEvidence: false,
    support: null,
    staleness: null,
    geoWarning: null,
    dateConflicts: [] as string[],
    undatedCitedCount: 0,
  }

  test('no note when the answer is fully covered', () => {
    expect(buildVerificationNote(base)).toBeNull()
  })

  test('uncovered claims are named with an example', () => {
    const note = buildVerificationNote({
      ...base,
      support: {
        materialCount: 4,
        supportedCount: 3,
        coverage: 0.75,
        unsupported: ['Officials denied the report.'],
        uncitedSupported: [],
        unsupportedTotal: 1,
        uncitedSupportedTotal: 0,
        uncovered: ['Officials denied the report.'],
        unattributedAllegations: [],
        ungroundedNames: [],
        repeatedHedges: [],
        unattributedProbabilistic: [],
        ungroundedDates: [],
      nameConflicts: [],
      },
    })
    expect(note).toContain('not supported by the retrieved sources')
    expect(note).toContain('Officials denied the report.')
  })

  test('no research or no sources -> never a note', () => {
    expect(buildVerificationNote({ ...base, researchRan: false })).toBeNull()
    expect(buildVerificationNote({ ...base, hasSources: false })).toBeNull()
  })

  test('staleness and geo warnings surface in the note', () => {
    const note = buildVerificationNote({
      ...base,
      staleness: 'Newest retrieved source is dated 2024; the question is time-sensitive.',
      geoWarning: 'none of the retrieved reports mention Gingee',
    })
    expect(note).toContain('retrieved source is dated 2024')
    expect(note).toContain('Gingee')
    expect(note).not.toContain('..')
  })

  test('uncited evidence produces the tie-your-claims note', () => {
    const note = buildVerificationNote({
      ...base,
      citationsValid: false,
      uncitedEvidence: true,
    })
    expect(note).toContain('does not tie its claims')
  })
})

describe('geo context (search query understanding)', () => {
  test('gingee maps to its region and the region variant is generated', () => {
    expect(placeKeysOf('Research a current topic: Gingee girl missing')).toContain('gingee')
    expect(regionContextFor('Gingee girl missing')).toBe('Tamil Nadu India')
    const variants = fastPathQueryVariants('Gingee girl missing')
    expect(variants[0]).toBe('Gingee girl missing')
    expect(variants[1]).toBe('Gingee girl missing Tamil Nadu India')
  })

  test('no region variant when the topic already carries its context', () => {
    expect(regionContextFor('missing girl in Tamil Nadu India')).toBeNull()
    expect(fastPathQueryVariants('Chennai floods Tamil Nadu India')).toHaveLength(1)
  })

  test('unfamiliar capitalized places still act as geo terms', () => {
    expect(geoTermsOf('Research a current topic: Zumbalandia bridge collapse')).toContain('zumbalandia')
  })

  test('geo mismatch penalizes results that never mention the place', () => {
    const usArticle = {
      title: 'Missing girl found safe in Ohio',
      snippet: 'Authorities in the United States confirmed the girl was found safe yesterday.',
    }
    expect(geoMismatchPenalty('Gingee girl missing Tamil Nadu India', usArticle, true)).toBe(0.24)
    const tnArticle = {
      title: 'Girl missing near Gingee, Tamil Nadu',
      snippet: 'Police intensified searches near Gingee in Villupuram district, Tamil Nadu, India.',
    }
    expect(geoMismatchPenalty('Gingee girl missing Tamil Nadu India', tnArticle, true)).toBe(0)
  })
})

describe('freshness-aware ranking (stale news retrieval fix)', () => {
  const result = (over: Partial<Parameters<typeof rankSources>[1][number]>) => ({
    url: 'https://example.com/a',
    title: 't',
    snippet: 's',
    hostName: 'example.com',
    rank: 1,
    date: null,
    ...over,
  })

  test('social platforms are weak authority; government domains are official', () => {
    expect(authorityScore('www.facebook.com')).toBe(0.2)
    // Established local news (The Hindu) sits in the reputable tier — the
    // work order prioritizes credible local reporting for incident topics.
    expect(authorityScore('www.thehindu.com')).toBe(0.75)
    expect(authorityScore('www.tn.gov.in')).toBe(1)
    expect(authorityScore('cbcid.gov.in')).toBe(1)
  })

  test('stale high-risk results carry an extra penalty beyond freshness', () => {
    expect(staleNewsPenalty(10, true)).toBe(0)
    expect(staleNewsPenalty(90, true)).toBe(0.1)
    expect(staleNewsPenalty(200, true)).toBe(0.22)
    expect(staleNewsPenalty(200, false)).toBe(0)
  })

  test('a fresh, geographically matching report outranks a stale foreign one', () => {
    const query = 'Gingee girl missing Tamil Nadu India'
    const freshLocal = result({
      url: 'https://www.thehindu.com/news/national/tamil-nadu/article1.ece',
      title: 'Search intensified for girl missing near Gingee',
      snippet: 'Police intensified the search for the seven-year-old girl missing near Gingee in Villupuram, Tamil Nadu.',
      hostName: 'www.thehindu.com',
      date: 'Oct 22, 2026',
      rank: 3,
    })
    const staleForeign = result({
      url: 'https://www.usatoday.com/story/news/nation/2026/07/14/missing-girl/1',
      title: 'Missing girl found three months ago',
      snippet: 'A girl reported missing in another country was found safe; police said the case is closed.',
      hostName: 'www.usatoday.com',
      date: 'Jul 14, 2026',
      rank: 1,
    })
    const ranked = rankSources(query, [staleForeign, freshLocal], { freshnessMatters: true, limit: 6 })
    expect(ranked[0].url).toBe(freshLocal.url)
    expect(ranked[0].id).toBe(1)
  })

  test('freshness follow-up triggers only when everything is stale or undated', () => {
    const stale = { date: 'Jul 14, 2026' } as never
    const fresh = { date: 'Oct 27, 2026' } as never
    const undated = { date: null } as never
    expect(needsFreshnessFollowUp([stale])).toBe(true)
    expect(needsFreshnessFollowUp([undated])).toBe(true)
    expect(needsFreshnessFollowUp([fresh])).toBe(false)
    expect(needsFreshnessFollowUp([fresh, stale])).toBe(false) // newest matters
    expect(needsFreshnessFollowUp([])).toBe(false)
    expect(buildFollowUpQuery('Gingee girl missing')).toBe('Gingee girl missing latest news update')
  })
})

describe('dedupeSourcesByUrl (Sources section canonical dedupe)', () => {
  test('same host+path collapses, ids stay stable', () => {
    const out = dedupeSourcesByUrl([
      { id: 2, url: 'https://www.thehindu.com/article1.ece?ref=trial' },
      { id: 1, url: 'https://thehindu.com/article1.ece' },
      { id: 3, url: 'https://theprint.in/india/story' },
    ])
    expect(out.map((s) => s.id)).toEqual([1, 3])
  })
})
