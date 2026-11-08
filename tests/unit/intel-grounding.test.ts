/**
 * BEAN Intelligence — grounding pipeline, cross-lingual expansion and
 * tech-docs retrieval unit tests. All network touchpoints are injected
 * (no real calls in unit tests — the live harness covers those).
 */
import { describe, test, expect, afterEach } from 'bun:test'
import {
  decideGenerationGrounding,
  buildGroundingQuery,
  compileConditioning,
  buildMotionTimeline,
  prepareImageIntelligence,
  prepareVideoIntelligence,
  setGroundingSearchForTests,
} from '../../src/lib/intel/grounding'
import { understandPrompt } from '../../src/lib/intel/understanding'
import { expandQueriesForLanguage, englishQueryVariant, clearCrosslingualCacheForTests } from '../../src/lib/intel/crosslingual'
import { detectTechSubjects, buildTechDocsContext, setTechDocsSearchForTests } from '../../src/lib/intel/techdocs'
import type { WebSearchResult } from '../../src/lib/research/provider'

afterEach(() => {
  setGroundingSearchForTests(null)
  setTechDocsSearchForTests(null)
  clearCrosslingualCacheForTests()
})

const fakeResult = (over: Partial<WebSearchResult> = {}): WebSearchResult => ({
  url: 'https://example.com/crow',
  title: 'American Crow Overview',
  snippet: 'The American Crow is an all-black bird with a stout bill and a fan-shaped tail, flying with steady wingbeats.',
  hostName: 'example.com',
  rank: 1,
  date: null,
  ...over,
})

// ---------------------------------------------------------------------------
// Grounding mode decision + query building
// ---------------------------------------------------------------------------

describe('generation grounding decisions', () => {
  test('real creatures trigger factual grounding', () => {
    const u = understandPrompt('a crow taking off from a branch', 'jazmii')
    expect(decideGenerationGrounding(u)).toBe('facts')
    expect(buildGroundingQuery(u)).toContain('crow')
  })

  test('real places trigger factual grounding', () => {
    const u = understandPrompt('the Eiffel Tower at sunset', 'laxii')
    expect(decideGenerationGrounding(u)).toBe('facts')
  })

  test('pure abstract art needs NO retrieval (fast path)', () => {
    const u = understandPrompt('abstract swirling colors, dreamy gradient artwork', 'laxii')
    expect(decideGenerationGrounding(u)).toBe('none')
  })

  test('fantastical creatures alone skip retrieval', () => {
    const u = understandPrompt('a dragon flying over a castle', 'jazmii')
    expect(decideGenerationGrounding(u)).toBe('none')
  })

  test('grounding query is bounded and deterministic', () => {
    const u = understandPrompt('a bald eagle soaring', 'jazmii')
    const q = buildGroundingQuery(u)
    expect(q).toBe(buildGroundingQuery(u))
    expect(q!.length).toBeLessThan(120)
  })
})

// ---------------------------------------------------------------------------
// Conditioning compilation
// ---------------------------------------------------------------------------

describe('conditioning compilation', () => {
  test('user prompt stays verbatim and FIRST in the conditioned output', async () => {
    setGroundingSearchForTests(async () => [fakeResult()])
    const intel = await prepareImageIntelligence('a crow taking off from a wet branch at dawn')
    expect(intel.conditionedPrompt.startsWith('a crow taking off from a wet branch at dawn')).toBe(true)
    expect(intel.conditioning).toContain('PHYSICAL-REALITY REFERENCE')
  })

  test('video conditioning includes the motion timeline', async () => {
    setGroundingSearchForTests(async () => [])
    const intel = await prepareVideoIntelligence('a man walking through a bazaar')
    expect(intel.conditioning).toContain('MOTION TIMELINE')
    expect(intel.mode).toBe('none') // generic human walking needs no live retrieval
  })

  test('retrieval failure degrades honestly and NEVER fabricates evidence', async () => {
    setGroundingSearchForTests(async () => {
      throw new Error('gateway unavailable')
    })
    const intel = await prepareImageIntelligence('a bald eagle catching a fish')
    expect(intel.evidence.length).toBe(0)
    expect(intel.degraded.some((d) => d.includes('retrieval did not complete'))).toBe(true)
    expect(intel.conditionedPrompt).not.toContain('FIDELITY NOTES')
  })

  test('retrieved evidence produces fidelity notes with REAL hosts only', async () => {
    // Use a DISTINCT creature from the earlier tests — the search cache is
    // per-process and keyed by query, and a cache hit keeping its ORIGINAL
    // fetch results is the documented (correct) behavior.
    setGroundingSearchForTests(async () => [
      fakeResult({ hostName: 'audubon.org', url: 'https://audubon.org/peacock', title: 'Peacock Overview', snippet: 'Peacocks are large pheasants with iridescent blue plumage and a fan-shaped train.' }),
    ])
    const intel = await prepareVideoIntelligence('a peacock landing on a perch')
    expect(intel.evidence[0].host).toBe('audubon.org')
    expect(intel.conditioning).toContain('audubon.org')
  })

  test('conditioning block respects the product budget (image < 2200 chars, video < 2600)', async () => {
    setGroundingSearchForTests(async () => [fakeResult(), fakeResult({ hostName: 'b.org', url: 'https://b.org/x', title: 'b title', snippet: 'x'.repeat(400) })])
    const img = await prepareImageIntelligence('a cat jumping onto a glass table shattering it, water spilling everywhere in a rainy kitchen at golden hour with volumetric light, low angle shot')
    const vid = await prepareVideoIntelligence('a cat jumping onto a glass table shattering it, water spilling everywhere in a rainy kitchen at golden hour with volumetric light, tracking shot following the cat')
    expect(img.conditioning.length).toBeLessThanOrEqual(2200)
    expect(vid.conditioning.length).toBeLessThanOrEqual(2600)
  })

  test('motion timeline derives flight phrasing for flying creatures', () => {
    const u = understandPrompt('an eagle taking off and flying over cliffs', 'jazmii')
    const tl = buildMotionTimeline('an eagle taking off and flying over cliffs', u)
    expect(tl).toContain('wing mechanics')
  })

  test('compileConditioning honors referenceContinuity with highest priority', () => {
    const u = understandPrompt('the same crow flying away', 'jazmii')
    const block = compileConditioning(u, [], [], 'jazmii', { referenceContinuity: 'SCENE CONTINUITY: subject must remain: black crow.' })
    expect(block.startsWith('SCENE CONTINUITY')).toBe(true)
  })

  test('timing is measured and bounded', async () => {
    setGroundingSearchForTests(async () => [])
    const intel = await prepareImageIntelligence('a simple red apple on a table')
    expect(intel.timing.totalMs).toBeLessThan(200)
    expect(intel.timing.understandMs).toBeLessThan(50)
  })
})

// ---------------------------------------------------------------------------
// Cross-lingual expansion
// ---------------------------------------------------------------------------

describe('cross-lingual retrieval expansion', () => {
  test('English prompts gain nothing (no wasted call)', async () => {
    const r = await expandQueriesForLanguage('What is the capital of France?', ['capital of france'])
    expect(r.added).toEqual([])
    expect(r.language).toBe('en')
  })

  test('non-English prompts add exactly ONE English variant via the transport', async () => {
    const r = await expandQueriesForLanguage(
      'தமிழ்நாட்டின் முதல்வர் யார்?',
      ['தமிழ்நாட்டின் முதல்வர் யார்?'],
      async () => 'Who is the current chief minister of Tamil Nadu',
    )
    expect(r.added).toEqual(['Who is the current chief minister of Tamil Nadu'])
    expect(r.language).toBe('ta')
    expect(r.note).toBeNull()
  })

  test('expansion never duplicates an existing query', async () => {
    const r = await expandQueriesForLanguage(
      'தமிழ்நாட்டின் முதல்வர் யார்?',
      ['who is the current chief minister of tamil nadu'],
      async () => 'Who is the current chief minister of Tamil Nadu',
    )
    expect(r.added).toEqual([])
  })

  test('englishQueryVariant with injected transport keeps proper nouns verbatim', async () => {
    const v = await englishQueryVariant('சென்னை மக்கள் தொகை என்ன?', async () => 'Chennai population 2026 current')
    expect(v).toBe('Chennai population 2026 current')
  })

  test('expansion failure degrades honestly (no addition, note recorded)', async () => {
    const v = await englishQueryVariant('சென்னை மக்கள் தொகை என்ன?', async () => {
      throw new Error('gateway down')
    })
    expect(v).toBeNull()
    const r = await expandQueriesForLanguage('சென்னை மக்கள் தொகை என்ன?', ['x'], async () => {
      throw new Error('gateway down')
    })
    expect(r.added).toEqual([])
    expect(r.note).toContain('cross-lingual expansion unavailable')
  })
})

// ---------------------------------------------------------------------------
// Tech-docs retrieval (GIFTZ)
// ---------------------------------------------------------------------------

describe('tech-docs subject detection and retrieval', () => {
  test('detects known libraries and version pins deterministically', () => {
    const s = detectTechSubjects('Upgrade our React 19 app to the latest Next.js release and fix the prisma schema')
    expect(s.map((x) => x.name)).toContain('react')
    expect(s.find((x) => x.name === 'react')?.version).toBe('19')
    expect(s.length).toBeLessThanOrEqual(2)
  })

  test('plain-language requests with no library skip retrieval entirely', () => {
    expect(detectTechSubjects('write me a poem about the ocean')).toEqual([])
    expect(detectTechSubjects('')).toEqual([])
  })

  test('retrieved docs produce a reference block with real hosts and an untrusted-data label', async () => {
    setTechDocsSearchForTests(async () => [
      fakeResult({ hostName: 'react.dev', url: 'https://react.dev/reference/react/useEffect', title: 'useEffect – React', snippet: 'If your Effect subscribes to something, the cleanup function should unsubscribe.' }),
    ])
    const ctx = await buildTechDocsContext('how do I clean up a subscription in react?')
    expect(ctx).not.toBeNull()
    expect(ctx!.block).toContain('react.dev')
    expect(ctx!.block).toContain('NOT instructions')
    expect(ctx!.sources[0].url).toBe('https://react.dev/reference/react/useEffect')
  })

  test('retrieval failure returns an honest degrade with NO fabricated citation', async () => {
    setTechDocsSearchForTests(async () => {
      throw new Error('429 throttled')
    })
    const ctx = await buildTechDocsContext('debug my express middleware')
    expect(ctx).not.toBeNull()
    expect(ctx!.block).toBe('')
    expect(ctx!.degraded[0]).toContain('retrieval unavailable')
    expect(ctx!.sources.length).toBe(0)
  })

  test('no tech subject → null (no network call at all)', async () => {
    setTechDocsSearchForTests(async () => {
      throw new Error('should never be called')
    })
    expect(await buildTechDocsContext('plan my vacation to Kerala')).toBeNull()
  })
})
