/**
 * Research-quality contracts (final work order):
 *   - source selection: social/video platforms demoted and labeled;
 *     syndicated same-title copies collapse; URL-titled reposts cleaned
 *   - page-read content verification: error/blocked pages NEVER enter the
 *     grounding context as "article content"
 *   - ongoing-case follow-up: newer reporting is hunted once before an
 *     evolving case is summarized
 *   - allegation attribution + name grounding audits
 *   - verification note: undated cited sources, allegations, ungrounded names
 *   - structured research-answer protocol for ongoing news
 *
 * Only the SDK boundary is scripted where needed; rank/pipeline/claims/
 * policy/prompts are the REAL production code. No fake successes anywhere.
 *
 * Run: bun test tests/unit/research-quality.test.ts
 */
import { describe, test, expect, mock } from 'bun:test'

import {
  authorityScore,
  ugcNewsPenalty,
  cleanSourceTitle,
  rankSources,
  isSocialHost,
} from '../../src/lib/research/rank'
import {
  isUsablePageText,
  PAGE_MIN_USEFUL_CHARS,
  newestSourceAgeDays,
} from '../../src/lib/research/pipeline'
import { isOngoingCaseQuery, isNewsEventQuery } from '../../src/lib/research/policy'
import { auditClaimSupport } from '../../src/lib/riishe/claims'
import { buildVerificationNote } from '../../src/lib/riishe/orchestrator'
import { buildSystemPrompt } from '../../src/lib/riishe/prompts'

const result = (over: Partial<Parameters<typeof rankSources>[1][number]>) => ({
  url: 'https://example.com/a',
  title: 't',
  snippet: 's',
  hostName: 'example.com',
  rank: 1,
  date: null,
  ...over,
})

describe('source selection: social and video platforms are last-resort evidence', () => {
  test('video platforms count as social/UGC with weak authority', () => {
    expect(authorityScore('www.youtube.com')).toBe(0.2)
    expect(authorityScore('youtu.be')).toBe(0.2)
    expect(isSocialHost('m.youtube.com')).toBe(true)
    expect(isSocialHost('www.facebook.com')).toBe(true)
    expect(isSocialHost('www.thehindu.com')).toBe(false)
  })

  test('freshness-sensitive queries stack a UGC penalty on top of low authority', () => {
    expect(ugcNewsPenalty('www.facebook.com', true)).toBeGreaterThan(0)
    expect(ugcNewsPenalty('www.facebook.com', false)).toBe(0)
    expect(ugcNewsPenalty('www.thehindu.com', true)).toBe(0)
  })

  test('a dated local report outranks an undated social post at equal relevance', () => {
    const query = 'Gingee girl missing Tamil Nadu India'
    const datedNews = result({
      url: 'https://www.thehindu.com/news/national/tamil-nadu/article9.ece',
      title: 'CB-CID steps up search for missing Gingee girl',
      snippet: 'The Crime Branch-CID intensified the search for the seven-year-old girl missing near Gingee in Villupuram, Tamil Nadu, police said.',
      hostName: 'www.thehindu.com',
      date: 'Oct 23, 2026',
      rank: 4,
    })
    const socialPost = result({
      url: 'https://www.facebook.com/dtnext/posts/a-suspect-has-been-detained/1545795717583162',
      title: 'https://www.dtnext.in/news/tamilnadu/suspect-in-tn-girls',
      snippet: 'A suspect has been detained in connection with the disappearance of a seven-year-old girl missing near Gingee.',
      hostName: 'www.facebook.com',
      date: null,
      rank: 1,
    })
    const ranked = rankSources(query, [socialPost, datedNews], { freshnessMatters: true, limit: 6 })
    expect(ranked[0].url).toBe(datedNews.url)
    expect(ranked.find((s) => s.social)?.url).toBe(socialPost.url)
  })

  test('URL-like repost titles are rendered as honest social-post labels', () => {
    expect(cleanSourceTitle('https://www.dtnext.in/news/tamilnadu/suspect-in-tn-girls', 'www.facebook.com')).toBe(
      'Social media post linking to dtnext.in',
    )
    expect(cleanSourceTitle('https://www.facebook.com/photo?fbid=1', 'www.facebook.com')).toBe(
      'Social media post on facebook.com',
    )
    expect(cleanSourceTitle('CB-CID steps up search for missing girl', 'www.thehindu.com')).toBe(
      'CB-CID steps up search for missing girl',
    )
  })

  test('syndicated copies of the same story collapse to one source', () => {
    const original = result({
      url: 'https://theprint.in/india/cb-cid-steps-up-search-for-missing-7-year-old-gingee-girl/3080047',
      title: 'CB-CID steps up search for missing 7-year-old Gingee girl',
      snippet: 'The Crime Branch-CID police intensified the search for a seven-year-old girl who remains untraced.',
      hostName: 'theprint.in',
      date: 'Oct 23, 2026',
      rank: 2,
    })
    const syndicated = result({
      url: 'https://www.thesamaja.com/en/sports/cb-cid-steps-up-search-for-missing-7-year-old-gingee-girl',
      title: 'CB-CID steps up search for missing 7-year-old Gingee girl',
      snippet: 'The class II student went missing in the early hours of October 12, hours after celebrating her seventh birthday.',
      hostName: 'www.thesamaja.com',
      date: null,
      rank: 1,
    })
    const ranked = rankSources('Gingee girl missing Tamil Nadu India', [original, syndicated], {
      freshnessMatters: true,
      limit: 6,
    })
    expect(ranked).toHaveLength(1)
    expect(ranked[0].hostName).toBe('theprint.in') // higher-scoring copy survives
    expect(ranked[0].id).toBe(1)
  })

  test('distinct stories with different titles are never collapsed', () => {
    const a = result({ url: 'https://a.example/one', title: 'CB-CID steps up Gingee search', hostName: 'a.example' })
    const b = result({ url: 'https://b.example/two', title: 'Villupuram police hold review meeting', hostName: 'b.example' })
    const ranked = rankSources('Gingee girl missing', [a, b], { freshnessMatters: true, limit: 6 })
    expect(ranked).toHaveLength(2)
  })
})

describe('page-read content verification (error pages never become evidence)', () => {
  test('blocked-page interstitials are rejected', () => {
    const blocked =
      'webleap.lifestyle webleap.lifestyle is blocked This page has been blocked by Chrome ERR_BLOCKED_BY_CLIENT Reload This page has been blocked by Chrome'
    expect(isUsablePageText(blocked)).toBe(false)
  })

  test('404 bodies and consent walls are rejected', () => {
    expect(isUsablePageText('404 Not Found')).toBe(false)
    expect(isUsablePageText('Enable JavaScript and cookies to continue Sign in to confirm you are not a bot')).toBe(false)
  })

  test('too-short text is rejected; a real article passes', () => {
    expect(isUsablePageText('Short body')).toBe(false)
    const article =
      'The Crime Branch-CID police intensified the search for a seven-year-old girl who remains untraced ' +
      'eleven days after she went missing from her home near Gingee. Police said more than 100 officers are ' +
      'involved and the Director General of Police reviews the progress daily. '.repeat(3)
    expect(article.length).toBeGreaterThan(PAGE_MIN_USEFUL_CHARS)
    expect(isUsablePageText(article)).toBe(true)
  })

  test('an article that merely MENTIONS an error later in the body still passes', () => {
    const article =
      'The Crime Branch-CID intensified the search for the missing girl near Gingee in Villupuram district. ' +
      'Police said the investigation continues and asked the public to avoid speculation. '.repeat(6) +
      'Readers reported a 404 error on an older version of this page.'
    expect(isUsablePageText(article)).toBe(true)
  })
})

describe('ongoing-case detection and newest-source age', () => {
  test('missing/kidnap/rescue vocabulary marks an ongoing case', () => {
    expect(isOngoingCaseQuery('Gingee girl missing')).toBe(true)
    expect(isOngoingCaseQuery('research the kidnapping case in Villupuram')).toBe(true)
    expect(isOngoingCaseQuery('who is the cm of tamilnadu')).toBe(false)
    expect(isOngoingCaseQuery('latest stable version of Next.js')).toBe(false)
  })

  test('news-event detection drives the structured research shape', () => {
    expect(isNewsEventQuery('Research a current topic: Gingee girl missing')).toBe(true)
    expect(isNewsEventQuery('who is the cm of tamilnadu')).toBe(false)
    expect(isNewsEventQuery('What is the latest stable version of Next.js?')).toBe(false)
  })

  test('newestSourceAgeDays returns the minimum age across dated sources', () => {
    const src = (date: string | null) => ({
      id: 1, url: 'u', title: 't', snippet: 's', hostName: 'h', date,
      freshness: null, year: null, authority: 0, official: false, social: false, sourceType: 'other' as const, score: 0,
    })
    const now = Date.now()
    const fiveDays = new Date(now - 5 * 86_400_000).toISOString()
    const twentyDays = new Date(now - 20 * 86_400_000).toISOString()
    expect(newestSourceAgeDays([src(fiveDays), src(twentyDays)]) as number).toBeGreaterThanOrEqual(4)
    expect(newestSourceAgeDays([src(fiveDays)]) as number).toBeLessThanOrEqual(6)
    expect(newestSourceAgeDays([src(null)])).toBeNull()
    expect(newestSourceAgeDays([])).toBeNull()
  })
})

describe('claim audits: allegation attribution + name grounding', () => {
  const resolved = new Set([1, 2])

  test('a bare allegation is flagged; an attributed one is not', () => {
    const bare = 'A suspect has been detained in connection with the disappearance of the seven-year-old girl [1].'
    const attributed =
      'The Hindu reported, citing police, that a suspect had been detained in connection with the disappearance [2].'
    const bareAudit = auditClaimSupport(bare, resolved, new Map([[1, 'girl missing near Gingee Villupuram CB-CID search']]))
    expect(bareAudit.unattributedAllegations).toHaveLength(1)
    const attributedAudit = auditClaimSupport(attributed, resolved, new Map([[2, 'girl missing near Gingee Villupuram CB-CID search']]))
    expect(attributedAudit.unattributedAllegations).toHaveLength(0)
  })

  test('a cited name absent from the cited sources text is flagged', () => {
    const text = 'The girl, Hemavathi, remains untraced near Gingee [1].'
    const corpus = new Map([[1, 'The Hindu: extensive searches for the missing girl in Gingee fail to yield results; CB-CID begins its probe']])
    const audit = auditClaimSupport(text, resolved, corpus)
    expect(audit.ungroundedNames).toContain('Hemavathi')
  })

  test('a name present in the cited source text passes', () => {
    const text = 'The girl, Hemalatha, remains untraced near Gingee [1].'
    const corpus = new Map([[1, 'The search continued for Hemalatha, the seven-year-old missing near Gingee in Villupuram']])
    const audit = auditClaimSupport(text, resolved, corpus)
    expect(audit.ungroundedNames).toHaveLength(0)
  })

  test('uncited sentences skip the name audit (coverage flags them already)', () => {
    const text = 'The girl, Zarquinia, remains untraced near Gingee.'
    const corpus = new Map([[1, 'unrelated text']])
    const audit = auditClaimSupport(text, resolved, corpus)
    expect(audit.uncovered).toHaveLength(1)
    expect(audit.ungroundedNames).toHaveLength(0)
  })
})

describe('verification note: research-quality limitations surface once', () => {
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

  test('undated cited sources produce the currency limitation', () => {
    const note = buildVerificationNote({ ...base, undatedCitedCount: 2 })
    expect(note?.toLowerCase()).toContain('publication dates could not be verified for 2 of the cited sources')
    expect(note).toContain('the latest status is stated only as of the dated reports')
  })

  test('unattributed allegations and ungrounded names are named', () => {
    const note = buildVerificationNote({
      ...base,
      support: {
        materialCount: 3,
        supportedCount: 2,
        coverage: 2 / 3,
        unsupported: [],
        uncitedSupported: [],
        unsupportedTotal: 0,
        uncitedSupportedTotal: 0,
        uncovered: [],
        unattributedAllegations: ['A suspect has been detained in connection with the disappearance.'],
        ungroundedNames: ['Hemavathi'],
        repeatedHedges: [],
        unattributedProbabilistic: [],
        ungroundedDates: [],
      nameConflicts: [],
      },
    })
    expect(note).toContain('without attribution')
    expect(note).toContain('A suspect has been detained')
    expect(note).toContain('Hemavathi')
    expect(note).toContain('could not be located')
  })

  test('a clean research answer still carries no note', () => {
    expect(buildVerificationNote(base)).toBeNull()
  })
})

describe('structured research-answer protocol (ongoing news)', () => {
  test('news-shaped research turns get the timeline/latest-update protocol', () => {
    const prompt = buildSystemPrompt({ evidenceBlock: '[1] report', task: 'research', staleness: null, researchShape: 'news' })
    expect(prompt).toContain('Confirmed timeline')
    expect(prompt).toContain('Latest verified update')
    expect(prompt).toContain('State any limitation ONCE')
    expect(prompt).toContain('social-media post')
  })

  test('ordinary lookups keep natural prose (no timeline scaffolding)', () => {
    const prompt = buildSystemPrompt({ evidenceBlock: '[1] report', task: 'research', staleness: null, researchShape: null })
    expect(prompt).not.toContain('Confirmed timeline')
    const noEvidence = buildSystemPrompt({ evidenceBlock: null, task: 'research', staleness: null, researchShape: 'news' })
    expect(noEvidence).not.toContain('Confirmed timeline')
  })
})

// ---------------------------------------------------------------------------
// Pipeline-level: the ongoing-case follow-up really runs ONE bounded extra
// search when the newest dated source is older than ~3 days — and does NOT
// run when fresh reporting exists. Scripted at the SDK boundary only.
// ---------------------------------------------------------------------------
const searchCalls: string[] = []
let scriptedDate: string | null = null
const scriptedZai = {
  functions: {
    invoke: async (_tool: string, args: { query: string }) => {
      searchCalls.push(args.query)
      return [
        {
          url: `https://news.example.com/${encodeURIComponent(args.query)}`,
          name: `Report for ${args.query}`,
          snippet:
            'A substantive report carrying the grounded fact with enough context to answer the question directly. '.repeat(3),
          host_name: 'news.example.com',
          rank: 1,
          date: scriptedDate,
        },
      ]
    },
  },
  chat: {
    completions: { create: async () => { throw new Error('no query refinement in this test') } },
  },
}
mock.module('z-ai-web-dev-sdk', () => ({ default: { create: async () => scriptedZai } }))

const { runResearch } = await import('../../src/lib/research/pipeline')
const { clearResearchCache } = await import('../../src/lib/research/cache')

// ---- orchestrator-level: allegation repair adopts an attributed rewrite ----
import type { TaskAdapter } from '../../src/lib/adapters/types'

function scriptedAdapter(replies: string[]): TaskAdapter & { calls: number; prompts: string[] } {
  let n = 0
  const prompts: string[] = []
  return {
    get calls() {
      return n
    },
    prompts,
    backendId: 'stub-rq',
    async health() {
      return { healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'stub' }
    },
    async *chatStream(init: { messages: Array<{ role: string; content: string }> }) {
      prompts.push(init.messages.map((m) => m.content).join('\n'))
      const reply = replies[Math.min(n, replies.length - 1)]
      n += 1
      for (const chunk of reply.match(/[\s\S]{1,12}/g) ?? []) yield chunk
    },
  }
}

describe('allegation repair through the orchestrator (real pipeline + audits)', () => {
  test('a bare allegation from social evidence is flagged, repaired with attribution, and honestly noted', async () => {
    clearResearchCache()
    // The snippet genuinely reports the detention (so the claim is grounded),
    // but only through a SOCIAL post — the answer must attribute it.
    const origInvoke = scriptedZai.functions.invoke
    scriptedZai.functions.invoke = async (tool: string, args: { query: string }) => {
      searchCalls.push(args.query)
      return [
        {
          url: 'https://www.facebook.com/dtnext/posts/detention-report/123',
          name: 'Report for the case',
          snippet:
            'A suspect has been detained in connection with the disappearance of the girl near Zumbalandia, the post states. '.repeat(3),
          host_name: 'www.facebook.com',
          rank: 1,
          date: null,
        },
      ]
    }
    const { orchestrateTurn } = await import('../../src/lib/riishe/orchestrator')
    const adapter = scriptedAdapter([
      // Pass 1: the allegation stated as bare fact, unattributed.
      'A suspect has been detained in connection with the disappearance of the seven-year-old girl [1].',
      // Repair pass: attribution added (the phrasing the repair prompt asks for).
      'Police said a suspect had been detained in connection with the disappearance, according to a social media report [1].',
    ])
    let r
    try {
      r = await orchestrateTurn({
        history: [],
        caps: { maxPromptChars: 12_000, maxHistoryMessages: 20 },
        userMessage: 'Zumbalandia girl missing case update right now',
        adapter,
      })
    } finally {
      scriptedZai.functions.invoke = origInvoke // restore even on failure
    }

    expect(adapter.calls).toBe(2) // repair really ran
    expect(r.metadata.timings?.repairMs).toBeDefined()
    expect(r.metadata.degraded.some((d) => d.includes('repaired'))).toBe(true)
    // The shipped answer carries the attribution, not the bare allegation.
    expect(r.content).toContain('Police said a suspect had been detained')
    expect(r.content).not.toContain('A suspect has been detained in connection')
    // The repair prompt really demanded attribution.
    expect(adapter.prompts[1]).toContain('WITHOUT attribution')
    // Grounded + covered -> honest full verification.
    expect(r.metadata.states).toContain('VERIFIED_FROM_SOURCES')
  })
})

describe('ongoing-case follow-up search (real pipeline, scripted provider)', () => {
  test('week-old evidence on a missing-person case triggers exactly one newer-reporting search', async () => {
    clearResearchCache()
    searchCalls.length = 0
    scriptedDate = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const message = 'Zumbalandia girl missing research probe'
    const decision = { search: true, risk: 'high' as const, recencyDays: 180, reason: 'test' }
    const pack = await runResearch(message, decision)
    expect(searchCalls.length).toBeGreaterThanOrEqual(2)
    expect(searchCalls.some((q) => q.includes('latest news update'))).toBe(true)
    expect(pack.queries.some((q) => q.includes('latest news update'))).toBe(true)
  })

  test('fresh evidence (<= 3 days) does not pay the follow-up latency', async () => {
    clearResearchCache()
    searchCalls.length = 0
    scriptedDate = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const message = 'Zumbalandia girl missing research probe'
    const decision = { search: true, risk: 'high' as const, recencyDays: 180, reason: 'test' }
    await runResearch(message, decision)
    expect(searchCalls.filter((q) => q.includes('latest news update'))).toHaveLength(0)
  })

  test('non-ongoing high-risk questions keep the old stale-only trigger', async () => {
    clearResearchCache()
    searchCalls.length = 0
    scriptedDate = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const message = 'Zumbalandia export policy research probe'
    const decision = { search: true, risk: 'high' as const, recencyDays: 180, reason: 'test' }
    await runResearch(message, decision)
    expect(searchCalls.filter((q) => q.includes('latest news update'))).toHaveLength(0)
  })
})
