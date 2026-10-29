/**
 * Regression tests for the measured retrieval failures from the work orders:
 *  - "who is the cm of tamilnadu" answered from stale memory with zero
 *    sources (officeholder questions must trigger retrieval WITHOUT the word
 *    "current");
 *  - "Research a current topic: Gingee girl missing" asked the user for
 *    clarification instead of searching (explicit research requests, bare
 *    "current" and missing-person/news words must trigger retrieval);
 *  - the fast path must send the search provider the SUBJECT of the request,
 *    not the directive scaffolding wrapped around it.
 * The policy is pure production code — no mocks.
 */
import { describe, test, expect } from 'bun:test'
import { shouldSearch } from '../../src/lib/research/policy'
import { toSearchQuery, isStraightforwardQuestion } from '../../src/lib/research/pipeline'
import { buildSystemPrompt } from '../../src/lib/riishe/prompts'

describe('work-order regression: officeholder questions trigger retrieval', () => {
  test('the exact failing prompt "who is the cm of tamilnadu"', () => {
    const d = shouldSearch('who is the cm of tamilnadu')
    expect(d.search).toBe(true)
    expect(d.risk).toBe('high')
    expect(d.recencyDays).toBe(180)
  })

  test('chief minister without any freshness adverb', () => {
    expect(shouldSearch('Who is the Chief Minister of Tamil Nadu?').search).toBe(true)
    expect(shouldSearch('Who is the prime minister of Japan?').search).toBe(true)
    expect(shouldSearch("who is india's president").search).toBe(true)
  })

  test('office abbreviations and other titles', () => {
    expect(shouldSearch('who is the MLA of my constituency?').search).toBe(true)
    expect(shouldSearch('who is the CEO of Apple').search).toBe(true)
    expect(shouldSearch('cm of bihar name?').search).toBe(true)
  })

  test('unit false positive stays excluded (cm as a length)', () => {
    expect(shouldSearch('how many inches is 18 cm of rope').search).toBe(false)
  })

  test('greeting + real question still searches; pure small talk does not', () => {
    expect(shouldSearch('hi, who is the cm of tamilnadu').search).toBe(true)
    expect(shouldSearch('Hello!').search).toBe(false)
    expect(shouldSearch('hi there').search).toBe(false)
    expect(shouldSearch('hey, thanks!').search).toBe(false)
  })
})

describe('work-order regression: explicit research + news signals trigger retrieval', () => {
  test('the exact failing prompt "Research a current topic: Gingee girl missing"', () => {
    const d = shouldSearch('Research a current topic: Gingee girl missing')
    expect(d.search).toBe(true)
    expect(d.risk).toBe('high')
    expect(d.recencyDays).toBe(180)
  })

  test('missing-person / disaster / arrest vocabulary is news-type high risk', () => {
    expect(shouldSearch('missing girl case near Gingee fort — what happened?').search).toBe(true)
    expect(shouldSearch('was anyone arrested in the Coimbatore jewelry heist?').search).toBe(true)
    expect(shouldSearch('death toll from the Wayanad landslide').search).toBe(true)
  })

  test('bare "current" triggers per the work order (accepting the documented bias)', () => {
    expect(shouldSearch('What is the current status of the Mars mission?').search).toBe(true)
  })

  test('high freshness dominates explicit lookup classification', () => {
    const d = shouldSearch('Research the latest version of Node.js')
    expect(d.search).toBe(true)
    expect(d.risk).toBe('high')
    expect(d.recencyDays).toBe(180)
  })
})

describe('work-order regression: no-search behavior preserved', () => {
  test('stable knowledge, math, creative and coding questions stay search-free', () => {
    expect(shouldSearch('What is 17 multiplied by 23?').search).toBe(false)
    expect(shouldSearch('Write a haiku about autumn').search).toBe(false)
    expect(shouldSearch('My python function throws a KeyError, how do I fix it?').search).toBe(false)
    expect(shouldSearch('Explain how a hash map works').search).toBe(false)
  })
})

describe('fast-path query cleanup (provider receives the subject)', () => {
  test('strips directive scaffolding from the exact work-order prompt', () => {
    expect(toSearchQuery('Research a current topic: Gingee girl missing')).toBe('Gingee girl missing')
  })

  test('strips lookup verbs and trailing time scaffolding', () => {
    expect(toSearchQuery('please look up the capital of France')).toBe('the capital of France')
    expect(toSearchQuery('search the web for GST rate changes 2026')).toBe('GST rate changes 2026')
    expect(toSearchQuery('What is the latest stable version of Next.js right now?')).toBe(
      'What is the latest stable version of Next.js',
    )
  })

  test('leaves ordinary questions untouched and never empties the query', () => {
    expect(toSearchQuery('Who is the Chief Minister of Tamil Nadu?')).toBe('Who is the Chief Minister of Tamil Nadu?')
    expect(toSearchQuery('research')).toBe('research') // strip would empty -> fallback to raw
    expect(isStraightforwardQuestion('Research a current topic: Gingee girl missing')).toBe(true)
  })
})

describe('solver protocol covers news-event answers', () => {
  test('citation protocol instructs case identification and confirmed/alleged separation', () => {
    const prompt = buildSystemPrompt({ evidenceBlock: '[1] Evidence', task: 'research', staleness: null })
    expect(prompt).toContain('identify the specific event or case')
    expect(prompt).toContain('confirmed facts from allegations')
    expect(prompt).toContain('Ask a clarifying question ONLY when the retrieved evidence still leaves several distinct plausible subjects')
  })
})
