/**
 * BEAN Intelligence — research-quality fix tests.
 * Run: bun test tests/unit/research-quality.test.ts
 *
 * Covers the final research-quality requirements:
 *  - the exact acceptance query ("Research a current topic: ...") triggers
 *    live search and is treated as a sensitive ongoing case,
 *  - source selection: official/gov.in domains, social-host demotion,
 *  - publication-date extraction from page HTML metadata,
 *  - staleness warnings for undated/old evidence on time-sensitive questions,
 *  - cross-pipeline source deduplication with citation-id remapping,
 *  - unattributed-allegation scanning for sensitive cases,
 *  - research synthesis + sensitive-case prompt protocols.
 * All pure — no network.
 */
import { describe, test, expect } from 'bun:test'
import { shouldSearch } from '../../src/lib/research/policy'
import { detectSensitiveCase, coreTopic, scanForUnattributedAllegations } from '../../src/lib/research/sensitive'
import { rankSources, stalenessWarning, isOfficialHost, isSocialHost, classifyHost, type RankedSource } from '../../src/lib/research/rank'
import { extractPublishedTime } from '../../src/lib/research/provider'
import { buildQuerySet, formatEvidenceBlock, type EvidenceSource } from '../../src/lib/research/pipeline'
import { dedupeSourcesByUrl, remapCitationIds, auditCitations } from '../../src/lib/verify/citations'
import { buildSystemPrompt } from '../../src/lib/riishe/prompts'
import type { WebSearchResult } from '../../src/lib/research/provider'

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

function ranked(partial: Partial<RankedSource> & { id: number }): RankedSource {
  return {
    url: partial.url ?? 'https://example.com/a',
    title: partial.title ?? 'T',
    snippet: partial.snippet ?? 's',
    hostName: partial.hostName ?? 'example.com',
    date: partial.date ?? null,
    freshness: partial.freshness ?? null,
    year: partial.year ?? null,
    authority: partial.authority ?? 0.5,
    official: partial.official ?? false,
    social: partial.social ?? false,
    sourceType: partial.sourceType ?? 'other',
    score: partial.score ?? 0.5,
    ...partial,
  }
}

describe('acceptance query: Research a current topic: Gingee girl missing', () => {
  const QUERY = 'Research a current topic: Gingee girl missing'

  test('triggers live search (root cause: it previously did NOT search)', () => {
    const d = shouldSearch(QUERY)
    expect(d.search).toBe(true)
    // ongoing incident => high risk with a bounded recency window
    expect(d.risk).toBe('high')
    expect(d.recencyDays).toBeGreaterThan(0)
  })

  test('is detected as a sensitive ongoing case', () => {
    const s = detectSensitiveCase(QUERY)
    expect(s.sensitive).toBe(true)
    expect(s.kind).toBe('missing_person')
  })

  test('core topic extraction strips the wrapper for freshness queries', () => {
    expect(coreTopic(QUERY)).toBe('Gingee girl missing')
  })

  test('buildQuerySet adds a deterministic newest-coverage query for incidents', () => {
    const out = buildQuerySet(QUERY, ['Gingee girl missing case'], false)
    expect(out.addedFreshnessQuery).toBe('Gingee girl missing latest update')
    expect(out.queries).toContain('Gingee girl missing latest update')
  })

  test('incident search still yields to math/creative/greeting exclusions', () => {
    expect(shouldSearch('Calculate 17 * 23').search).toBe(false)
    expect(shouldSearch('Write a haiku about autumn').search).toBe(false)
    expect(shouldSearch('hi there').search).toBe(false)
  })

  test('coding messages about "missing" symbols are not incident searches', () => {
    const d = shouldSearch('My python function is missing a semicolon, how do I fix it?')
    expect(d.search).toBe(false)
    expect(detectSensitiveCase('My python function is missing a semicolon').sensitive).toBe(false)
  })
})

describe('sensitive-case detection', () => {
  test('detects missing persons, crime cases and disasters', () => {
    expect(detectSensitiveCase('A 7-year-old girl went missing in Gingee').sensitive).toBe(true)
    expect(detectSensitiveCase('missing person case in Villupuram').sensitive).toBe(true)
    expect(detectSensitiveCase('the murder case probe continues').sensitive).toBe(true)
    expect(detectSensitiveCase('building collapse death toll rises').sensitive).toBe(true)
  })

  test('ordinary topics are not sensitive', () => {
    expect(detectSensitiveCase('Tell me about the Eiffel Tower').sensitive).toBe(false)
    expect(detectSensitiveCase('I miss my hometown').sensitive).toBe(false)
    expect(detectSensitiveCase('What is the capital of France?').sensitive).toBe(false)
  })
})

describe('unattributed allegation scan', () => {
  test('flags accusatory sentences with no citation and no attribution', () => {
    const flags = scanForUnattributedAllegations('Ravi Kumar abducted the girl from the school. The search continues.')
    expect(flags.length).toBe(1)
    expect(flags[0].sentence).toContain('abducted')
  })

  test('cited or attributed accusations pass', () => {
    expect(scanForUnattributedAllegations('Ravi Kumar abducted the girl, according to police [2].').length).toBe(0)
    expect(scanForUnattributedAllegations('Police said the girl was allegedly taken by a neighbour [3].').length).toBe(0)
    expect(scanForUnattributedAllegations('A man was arrested on suspicion of abduction [1].').length).toBe(0)
  })

  test('neutral sentences never flag', () => {
    expect(scanForUnattributedAllegations('The girl was reported missing on October 12 [1]. Search teams continue [2].').length).toBe(0)
  })
})

describe('source selection', () => {
  test('gov.in / nic.in hosts are official', () => {
    expect(isOfficialHost('tnpolice.gov.in')).toBe(true)
    expect(isOfficialHost('viluppuram.nic.in')).toBe(true)
    expect(isOfficialHost('www.pib.gov.in')).toBe(true)
    expect(isOfficialHost('tn.gov.in')).toBe(true)
  })

  test('social hosts are classified and demoted', () => {
    expect(isSocialHost('x.com')).toBe(true)
    expect(isSocialHost('www.facebook.com')).toBe(true)
    expect(classifyHost('twitter.com')).toMatchObject({ social: true, sourceType: 'social' })
    expect(classifyHost('timesofindia.indiatimes.com')).toMatchObject({ official: false, social: false, sourceType: 'news' })
    expect(classifyHost('en.wikipedia.org')).toMatchObject({ sourceType: 'reference' })

    const results = [
      src({ url: 'https://x.com/user/status/123', title: 'Twitter thread claims', rank: 1 }),
      src({ url: 'https://www.thehindu.com/news/national/tamil-nadu/gingee', title: 'The Hindu report', rank: 2, date: new Date().toISOString() }),
    ]
    const rankedOut = rankSources('gingee girl', results, { freshnessMatters: true, limit: 2 })
    expect(rankedOut[0].sourceType).toBe('news')
    expect(rankedOut[0].social).toBe(false)
    expect(rankedOut.find((r) => r.sourceType === 'social')).toBeTruthy()
  })

  test('social source is labeled in the evidence block for the solver', () => {
    const pack = {
      sources: [
        {
          id: 1,
          url: 'https://x.com/u/status/1',
          title: 'A post',
          snippet: 'claims',
          hostName: 'x.com',
          date: null,
          freshness: null,
          year: null,
          authority: 0.2,
          official: false,
          social: true,
          sourceType: 'social' as const,
          score: 0.3,
          pageRead: false,
          excerpt: null,
        } satisfies EvidenceSource,
      ],
      queries: ['q'],
      degraded: [],
      staleness: null,
      durationMs: 1,
    }
    const block = formatEvidenceBlock(pack)
    expect(block).toContain('SOCIAL MEDIA')
    expect(block).toContain('no publication date found')
  })
})

describe('publication-date extraction from HTML', () => {
  test('reads JSON-LD datePublished', () => {
    const html = '<html><head><script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-10-12T08:30:00+05:30","headline":"x"}</script></head><body>hi</body></html>'
    expect(extractPublishedTime(html)).toBe('2026-10-12T08:30:00+05:30')
  })

  test('reads article:published_time meta and <time datetime>', () => {
    const meta = '<meta property="article:published_time" content="2026-10-12T00:00:00Z">'
    expect(extractPublishedTime(meta)).toBe('2026-10-12T00:00:00Z')
    const time = '<article><time datetime="2026-10-12">Oct 12</time></article>'
    expect(extractPublishedTime(time)).toBe('2026-10-12')
  })

  test('returns null when no date metadata exists (never guesses)', () => {
    expect(extractPublishedTime('<html><body>plain text</body></html>')).toBeNull()
    expect(extractPublishedTime('<meta name="author" content="someone 2026">')).toBeNull()
  })
})

describe('staleness warnings for time-sensitive questions', () => {
  test('undated evidence on a time-sensitive question warns', () => {
    const sources = [ranked({ id: 1, date: null, year: null })]
    expect(stalenessWarning(sources, { timeSensitive: true })).toContain('No retrieved source states a publication date')
  })

  test('time-sensitive question with only month-old sources warns about newer coverage', () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000).toISOString()
    const sources = [ranked({ id: 1, date: fortyDaysAgo, year: new Date().getFullYear() })]
    const w = stalenessWarning(sources, { timeSensitive: true })
    expect(w).toContain('days old')
    expect(w).toContain('may have changed')
  })

  test('recent sources produce no warning', () => {
    const now = new Date().toISOString()
    const sources = [ranked({ id: 1, date: now, year: new Date().getFullYear() })]
    expect(stalenessWarning(sources, { timeSensitive: true })).toBeNull()
  })
})

describe('cross-pipeline source dedup with citation remapping', () => {
  test('keeps first occurrence, renumbers, maps duplicates to the canonical id', () => {
    const input = [
      { id: 1, url: 'https://a.example/x', title: 'A1' },
      { id: 2, url: 'https://b.example/y', title: 'B' },
      { id: 3, url: 'https://a.example/x?utm=1', title: 'A dup' }, // same page as id 1
      { id: 4, url: 'https://c.example/z', title: 'C' },
    ]
    const { kept, idMap, duplicatesRemoved } = dedupeSourcesByUrl(input)
    expect(duplicatesRemoved).toBe(1)
    expect(kept.map((s) => [s.id, s.url])).toEqual([
      [1, 'https://a.example/x'],
      [2, 'https://b.example/y'],
      [3, 'https://c.example/z'],
    ])
    expect(idMap.get(1)).toBe(1)
    expect(idMap.get(2)).toBe(2)
    expect(idMap.get(3)).toBe(1) // duplicate -> canonical id
    expect(idMap.get(4)).toBe(3)
  })

  test('remapCitationIds rewrites answer markers through the map', () => {
    const { idMap } = dedupeSourcesByUrl([
      { id: 1, url: 'https://a.example/x' },
      { id: 2, url: 'https://b.example/y' },
      { id: 3, url: 'https://a.example/x?utm=1' },
    ])
    expect(idMap.get(3)).toBe(1)
    expect(remapCitationIds('Dup [3] and pair [2,3] stay valid; [9] untouched.', idMap)).toBe(
      'Dup [1] and pair [2,1] stay valid; [9] untouched.',
    )
  })

  test('audited citations resolve after remapping a duplicate-heavy answer', () => {
    const sources = [
      { id: 1, url: 'https://a.example/x' },
      { id: 2, url: 'https://b.example/y' },
      { id: 3, url: 'https://a.example/x?utm=1' },
    ]
    const { idMap } = dedupeSourcesByUrl(sources)
    const answer = 'Claim one [3]. Claim two [2].'
    const remapped = remapCitationIds(answer, idMap)
    const audit = auditCitations(remapped, dedupeSourcesByUrl(sources).kept)
    expect(audit.invalidIds).toEqual([])
    expect(audit.usedSources.map((s) => s.id).sort()).toEqual([1, 2])
  })
})

describe('prompt protocols', () => {
  test('sensitive researched turn includes synthesis + sensitive protocols', () => {
    const p = buildSystemPrompt({ evidenceBlock: 'EV', task: 'research', staleness: null, sensitiveCase: true })
    expect(p).toContain('Current-topic synthesis protocol')
    expect(p).toContain('Sensitive ongoing-case protocol')
    expect(p).toContain('SOCIAL MEDIA')
    expect(p).toContain('PUBLISHED, not when the events happened')
  })

  test('plain researched turn gets synthesis but not the sensitive protocol', () => {
    const p = buildSystemPrompt({ evidenceBlock: 'EV', task: 'research', staleness: null })
    expect(p).toContain('Current-topic synthesis protocol')
    expect(p).not.toContain('Sensitive ongoing-case protocol')
  })

  test('ordinary conversation stays clean', () => {
    const p = buildSystemPrompt({ evidenceBlock: null, task: 'general', staleness: null })
    expect(p).not.toContain('Current-topic synthesis protocol')
    expect(p).not.toContain('Sensitive ongoing-case protocol')
  })
})
