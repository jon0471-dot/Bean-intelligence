/**
 * Unit tests for the INDEPENDENT retrieval lane (src/lib/research/direct.ts).
 *
 * Pure-logic coverage: no network. Network-facing behavior (Wikipedia API,
 * official fetches, gateway-down fallback) is covered live by
 * scripts/riishe-gateway-down-acceptance.test.ts and the real acceptance run.
 */
import { describe, test, expect } from 'bun:test'
import {
  cleanWikiFieldValue,
  extractInfoboxFields,
  latestStableNodeRelease,
  officialDirectCandidates,
  isUsablePageText,
  PAGE_MIN_USEFUL_CHARS,
} from '../../src/lib/research/direct'
import { ResearchToolError } from '../../src/lib/research/provider'

describe('wikipedia infobox parsing', () => {
  test('cleanWikiFieldValue strips links, templates and markup without inventing content', () => {
    expect(cleanWikiFieldValue('[[C. Joseph Vijay]]')).toBe('C. Joseph Vijay')
    expect(cleanWikiFieldValue('[[Narendra Modi|Modi]]')).toBe('Modi')
    expect(cleanWikiFieldValue("'''[[Donald Trump]]''' {{small|(since 2025)}}")).toBe('Donald Trump')
    expect(cleanWikiFieldValue('X<ref>some citation</ref>Y')).toBe('XY')
  })

  test('extractInfoboxFields pulls ONLY the requested keys from section-0 wikitext', () => {
    const wikitext = [
      '{{Infobox office',
      '| incumbent = [[C. Joseph Vijay]]',
      '| term_start = 10 May 2026',
      '| flag = something',
      '| body = noise',
    ].join('\n')
    const facts = extractInfoboxFields(wikitext, ['incumbent', 'term_start'])
    expect(facts.incumbent).toBe('C. Joseph Vijay')
    expect(facts.term_start).toBe('10 May 2026')
    expect(facts.flag).toBeUndefined()
    expect(facts.body).toBeUndefined()
  })

  test('extractInfoboxFields returns nothing when the key is absent (no guessing)', () => {
    const facts = extractInfoboxFields('| leader = X\n', ['incumbent', 'took_office'])
    expect(Object.keys(facts)).toHaveLength(0)
  })
})

describe('official Node.js release feed parsing', () => {
  test('latestStableNodeRelease skips pre-release lines and returns the newest stable', () => {
    const feed = [
      { version: 'v27.0.0-alpha.0.0.0', date: '2026-10-29', lts: false },
      { version: 'v26.13.0', date: '2026-10-28', lts: 'Lithium' },
      { version: 'v26.12.1', date: '2026-10-21', lts: false },
    ]
    const stable = latestStableNodeRelease(feed)
    expect(stable?.version).toBe('v26.13.0')
    expect(stable?.date).toBe('2026-10-28')
    expect(stable?.lts).toBe('Lithium')
  })

  test('latestStableNodeRelease tolerates malformed entries and empty feeds', () => {
    expect(latestStableNodeRelease([])).toBeNull()
    expect(latestStableNodeRelease([{ version: 42 }, { version: 'bad' }, { version: 'v1.2.3-rc.1' }])).toBeNull()
  })
})

describe('official-source candidate mapping', () => {
  test('Node.js version question maps to the official release feed', () => {
    const c = officialDirectCandidates('What is the latest stable Node.js version?')
    expect(c.some((x) => x.kind === 'node-feed' && x.url === 'https://nodejs.org/dist/index.json')).toBe(true)
  })

  test('US president / PM of India / TN CM questions map to official government pages', () => {
    expect(officialDirectCandidates('Who is the current President of the United States?').some((c) => c.url.includes('whitehouse.gov'))).toBe(true)
    expect(officialDirectCandidates('Who is the current Prime Minister of India?').some((c) => c.url.includes('pmindia.gov.in'))).toBe(true)
    expect(officialDirectCandidates('Who is the CM of Tamil Nadu?').some((c) => c.url.includes('tn.gov.in'))).toBe(true)
  })

  test('unrelated questions map to no candidates (bounded, no shotgun fetching)', () => {
    expect(officialDirectCandidates('What is the capital of France?')).toHaveLength(0)
    expect(officialDirectCandidates('Explain how transformers work')).toHaveLength(0)
  })
})

describe('direct page-content validation', () => {
  test('error/blocked pages are rejected as unusable', () => {
    expect(isUsablePageText('404 Not Found')).toBe(false)
    expect(isUsablePageText('Please enable JavaScript and cookies to continue')).toBe(false)
    expect(isUsablePageText('Just a moment...')).toBe(false)
    expect(isUsablePageText('short')).toBe(false)
  })

  test('substantial real article text passes', () => {
    const article = `The chief minister of Tamil Nadu is the head of government of the Indian state of Tamil Nadu. `.repeat(6)
    expect(article.length).toBeGreaterThan(PAGE_MIN_USEFUL_CHARS)
    expect(isUsablePageText(article)).toBe(true)
  })
})

describe('direct fetch boundary', () => {
  test('rejects non-http(s) URLs and invalid URLs with typed errors (no network)', async () => {
    const { directFetch } = await import('../../src/lib/research/direct')
    await expect(directFetch('ftp://example.com/x')).rejects.toBeInstanceOf(ResearchToolError)
    await expect(directFetch('not a url')).rejects.toBeInstanceOf(ResearchToolError)
  })
})

describe('aggregator redirect-wrapper detection', () => {
  test('google goto/news wrappers are detected (resolution itself is live-network)', async () => {
    const { isRedirectWrapperUrl } = await import('../../src/lib/research/direct')
    expect(isRedirectWrapperUrl('https://www.google.com/goto?url=CAESabc')).toBe(true)
    expect(isRedirectWrapperUrl('https://news.google.com/rss/articles/CBMi?oc=5')).toBe(false) // /rss not wrapped
    expect(isRedirectWrapperUrl('https://www.tn.gov.in/minister_list.php')).toBe(false)
    expect(isRedirectWrapperUrl('https://en.wikipedia.org/wiki/Node.js')).toBe(false)
    expect(isRedirectWrapperUrl('not a url')).toBe(false)
  })

  test('resolveRedirectUrl leaves non-wrapper URLs untouched (no network)', async () => {
    const { resolveRedirectUrl } = await import('../../src/lib/research/direct')
    const url = 'https://www.tn.gov.in/minister_list.php'
    expect(await resolveRedirectUrl(url)).toBe(url)
  })
})
