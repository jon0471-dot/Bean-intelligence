/**
 * Research-quality merge tests — the pieces ported/adapted in the final
 * research-quality fix:
 *  - provider publication-date extraction (HTML metadata + text datelines)
 *  - host classification (official / news / social / reference / other)
 *  - sensitive-case deterministic query set (newest-coverage + official)
 *  - cross-pipeline source dedupe with citation-id remapping
 *  - repeated-uncertainty audit (synthesis protocol: a limitation appears ONCE)
 * All pure/deterministic — no SDK, no gateway.
 */
import { describe, test, expect } from 'bun:test'

import { extractPublishedTime, extractDatelineFromText } from '../../src/lib/research/provider'
import { classifyHost, authorityScore, rankSources, type RankedSource } from '../../src/lib/research/rank'
import { buildSensitiveQuerySet } from '../../src/lib/research/pipeline'
import { dedupeSourcesWithMap, remapCitationIds } from '../../src/lib/verify/citations'
import { auditClaimSupport, HEDGE_REPEAT_THRESHOLD } from '../../src/lib/riishe/claims'
import { buildSystemPrompt } from '../../src/lib/riishe/prompts'

// ---- publication-date extraction -------------------------------------------

describe('publication-date extraction (requirement: verify dates, never guess)', () => {
  test('JSON-LD datePublished is extracted', () => {
    const html =
      '<html><head><script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-22T09:00:00+05:30"}</script></head><body>x</body></html>'
    expect(extractPublishedTime(html)).toBe('2026-10-22T09:00:00+05:30')
  })

  test('article:published_time meta and <time datetime> are extracted', () => {
    expect(
      extractPublishedTime('<meta property="article:published_time" content="2026-10-23T08:00:00Z">'),
    ).toBe('2026-10-23T08:00:00Z')
    expect(extractPublishedTime('<article><time datetime="2026-10-24">Oct 24</time></article>')).toBe('2026-10-24')
  })

  test('null when the page carries no date metadata (never guesses)', () => {
    expect(extractPublishedTime('<html><body>no dates at all</body></html>')).toBeNull()
    // a bare year in body copy is NOT a publication date
    expect(extractPublishedTime('<html><body>Since 2026 the program has grown</body></html>')).toBeNull()
  })

  test('text dateline is the last-resort source ("Published: 22 Oct 2026")', () => {
    expect(extractDatelineFromText('Gingee update\nPublished: 22 Oct 2026 8:15 am\nThe search continued.')).toMatch(
      /22 Oct 2026/,
    )
    expect(extractDatelineFromText('CHENNAI: Updated on October 23, 2026.\nBody text follows.')).toMatch(
      /October 23, 2026/,
    )
    expect(extractDatelineFromText('Posted on 2026.10.24 by the desk.')).toBe('2026.10.24')
  })

  test('text dateline rejects body-copy year mentions and needs an explicit keyword', () => {
    expect(extractDatelineFromText('The girl went missing on October 11 and the case grew in 2026.')).toBeNull()
    expect(extractDatelineFromText('plain body text without any date phrase')).toBeNull()
  })
})

// ---- host classification -----------------------------------------------------

describe('host classification (requirement: official statements and credible local news first)', () => {
  test('official / social / reference / news / other classes', () => {
    expect(classifyHost('tnpolice.gov.in')).toEqual({ official: true, social: false, sourceType: 'official' })
    expect(classifyHost('lokabhavan.tn.gov.in').sourceType).toBe('official')
    expect(classifyHost('www.facebook.com').sourceType).toBe('social')
    expect(classifyHost('x.com').sourceType).toBe('social')
    expect(classifyHost('en.wikipedia.org').sourceType).toBe('reference')
    expect(classifyHost('www.thehindu.com').sourceType).toBe('news')
    expect(classifyHost('thefederal.com').sourceType).toBe('news')
    expect(classifyHost('dinamalar.com').sourceType).toBe('news')
    expect(classifyHost('random-aggregator.example').sourceType).toBe('other')
  })

  test('authority tiers follow the classes', () => {
    expect(authorityScore('pib.gov.in')).toBe(1)
    expect(authorityScore('www.ndtv.com')).toBe(0.75)
    expect(authorityScore('tiktok.com')).toBe(0.2)
  })

  test('rankSources carries sourceType through to the evidence set', () => {
    const out = rankSources(
      'Gingee girl missing',
      [
        {
          url: 'https://x.com/user/status/1',
          title: 'post',
          snippet: 'claims',
          hostName: 'x.com',
          rank: 1,
          date: null,
        },
        {
          url: 'https://www.thehindu.com/news/gingee',
          title: 'Gingee girl missing: search continues',
          snippet: 'Police continued the search for the girl missing near Gingee.',
          hostName: 'www.thehindu.com',
          rank: 2,
          date: 'Oct 22, 2026',
        },
      ],
      { freshnessMatters: true, limit: 5 },
    )
    const hindu = out.find((s) => s.hostName === 'www.thehindu.com')
    const social = out.find((s) => s.hostName === 'x.com')
    expect(hindu?.sourceType).toBe('news')
    expect(hindu?.official).toBe(false)
    expect(social?.sourceType).toBe('social')
    expect(social?.social).toBe(true)
    // the credible local report outranks the social post
    if (hindu && social) expect(hindu.score).toBeGreaterThan(social.score)
  })
})

// ---- sensitive-case deterministic query set ----------------------------------

describe('sensitive-case query set (requirement: search newer reporting + official statements)', () => {
  test('adds the newest-coverage and official-statement queries for an ongoing case', () => {
    const { queries, addedFreshnessQuery, addedOfficialQuery } = buildSensitiveQuerySet(
      'Research a current topic: Gingee girl missing',
      ['Gingee girl missing'],
    )
    expect(addedFreshnessQuery).toContain('latest update')
    expect(addedOfficialQuery).toContain('police official statement')
    expect(queries.some((q) => q.includes('latest update'))).toBe(true)
    expect(queries.some((q) => q.includes('police official statement'))).toBe(true)
    // the core topic anchors the set
    expect(queries[0].toLowerCase()).toContain('gingee')
  })

  test('skips an extra when an existing query already targets that intent', () => {
    const { addedFreshnessQuery, addedOfficialQuery } = buildSensitiveQuerySet(
      'Research a current topic: Gingee girl missing',
      ['"Gingee girl missing" latest update today', '"Gingee girl missing" police statement'],
    )
    expect(addedFreshnessQuery).toBeNull()
    expect(addedOfficialQuery).toBeNull()
  })

  test('re-anchors drifted LLM queries to the core topic', () => {
    const { queries } = buildSensitiveQuerySet('Research a current topic: Gingee girl missing', [
      'missing children national trends',
    ])
    expect(queries[0].toLowerCase()).toContain('gingee')
  })

  test('non-sensitive questions are returned untouched', () => {
    const q = ['Next.js latest version']
    const out = buildSensitiveQuerySet('What is the latest Next.js version?', q)
    expect(out.queries).toEqual(q)
    expect(out.addedFreshnessQuery).toBeNull()
    expect(out.addedOfficialQuery).toBeNull()
  })
})

// ---- cross-pipeline dedupe + citation remap ----------------------------------

describe('cross-pipeline dedupe with id remap (requirement: deduplicate sources and citations)', () => {
  test('same URL from pipeline and tool rounds collapses to the FIRST id', () => {
    const { kept, idMap, duplicatesRemoved } = dedupeSourcesWithMap([
      { id: 3, url: 'https://theprint.in/india/story' },
      { id: 7, url: 'https://theprint.in/india/story?utm=share' },
      { id: 1, url: 'https://www.thehindu.com/article1.ece' },
      { id: 8, url: 'https://www.thehindu.com/article1.ece' },
      { id: 9, url: 'https://x.com/user/status/999' },
    ])
    expect(kept.map((s) => s.id)).toEqual([1, 3, 9]) // sorted by original id, dups dropped
    expect(duplicatesRemoved).toBe(2)
    expect(idMap.get(7)).toBe(3) // tool dup -> canonical pipeline id
    expect(idMap.get(8)).toBe(1)
    expect(idMap.get(1)).toBe(1)
    expect(idMap.get(9)).toBe(9)
  })

  test('remapCitationIds rewrites markers through the map and leaves unknown ids alone', () => {
    const remapped = remapCitationIds('A [7] and [1,8] here; code `arr[0]` untouched.', new Map([[7, 3], [8, 1]]))
    expect(remapped).toContain('[3]')
    expect(remapped).toContain('[1,1]')
    expect(remapped).toContain('`arr[0]`')
    // an id with no mapping stays as-is (the audit flags it later)
    expect(remapCitationIds('mystery [9]', new Map([[7, 3]]))).toBe('mystery [9]')
  })
})

// ---- repeated-uncertainty audit ----------------------------------------------

describe('repeated-uncertainty audit (requirement: state a limitation ONCE)', () => {
  const RESOLVED = new Set([1])
  const corpus = new Map([[1, 'The search for the missing girl continues.']])
  const HEDGE = 'The latest status could not be verified.'

  test('one or two hedge sentences pass silently', () => {
    const one = `Summary of the case [1]. ${HEDGE}`
    expect(auditClaimSupport(one, RESOLVED, corpus).repeatedHedges).toEqual([])
    const two = `Summary of the case [1]. ${HEDGE} A dated update from Oct 26 was reported [1].`
    expect(auditClaimSupport(two, RESOLVED, corpus).repeatedHedges).toEqual([])
  })

  test(`more than ${HEDGE_REPEAT_THRESHOLD} hedge sentences are flagged for consolidation`, () => {
    const three = `Summary of the case [1]. ${HEDGE} The detention remains unconfirmed [1]. No newer reporting was found.`
    const audit = auditClaimSupport(three, RESOLVED, corpus)
    expect(audit.repeatedHedges.length).toBeGreaterThan(0)
  })

  test('no hedges at all -> empty', () => {
    const clean = 'The minister said the probe continues [1]. Police confirmed the timeline [1].'
    expect(auditClaimSupport(clean, RESOLVED, corpus).repeatedHedges).toEqual([])
  })

  test('uncited evidence-gap meta-statements are not counted as uncovered claims', () => {
    const meta =
      'The CB-CID is probing the case [1]. The retrieved reports do not specify why the case was transferred. ' +
      '- Whether any suspects have been identified (this information was not confirmed in any of the provided sources). ' +
      'No information about the girl\'s whereabouts was available in the retrieved reports.'
    const audit = auditClaimSupport(meta, RESOLVED, corpus)
    // the first sentence is the only material claim, and it is cited
    expect(audit.materialCount).toBe(1)
    expect(audit.supportedCount).toBe(1)
    expect(audit.uncovered).toEqual([])
  })

  test('cited sentences are always audited even when they mention evidence gaps', () => {
    const cited =
      'Police sources in Chennai did not confirm the location [1].'
    const audit = auditClaimSupport(cited, RESOLVED, corpus)
    expect(audit.materialCount).toBe(1)
    expect(audit.supportedCount).toBe(1)
  })
})

// ---- prompt composition -------------------------------------------------------

describe('sensitive-case prompt protocol', () => {
  test('sensitive turns add the sensitive-case protocol alongside the evidence protocol', () => {
    const prompt = buildSystemPrompt({
      evidenceBlock: '[1] some source',
      task: 'research',
      staleness: null,
      researchShape: 'news',
      sensitiveCase: true,
    })
    expect(prompt).toContain('Sensitive ongoing-case protocol')
    expect(prompt).toContain('OFFICIALLY CONFIRMED')
    expect(prompt).toContain('Do not infer guilt, motive or involvement from social-media posts')
    expect(prompt).toContain('Research answer structure')
  })

  test('ordinary researched answers do not carry the sensitive protocol', () => {
    const prompt = buildSystemPrompt({
      evidenceBlock: '[1] some source',
      task: 'research',
      staleness: null,
      researchShape: null,
      sensitiveCase: false,
    })
    expect(prompt).not.toContain('Sensitive ongoing-case protocol')
  })
})

// helper re-exported for other suites that build fixtures
export function rankedFixture(over: Partial<RankedSource>): RankedSource {
  return {
    id: 1,
    url: 'https://example.com/',
    title: 't',
    snippet: 's',
    hostName: 'example.com',
    date: null,
    freshness: null,
    year: null,
    authority: 0.4,
    official: false,
    social: false,
    sourceType: 'other',
    score: 0,
    ...over,
  }
}
