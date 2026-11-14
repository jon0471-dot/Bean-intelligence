/**
 * Reach gateway — planning, normalization and execution (hermetic: the
 * adapter is mocked; no processes, no network).
 *
 * Regression contract (Phases 1–3):
 *   - planning is deterministic and channel-relevance gated (no plan for
 *     unrelated messages; ≤3 invocations; platform channels only on signal);
 *   - normalization is null-preserving (no title → hostname fallback, no
 *     invented dates, unsafe URLs dropped with honest degraded notes);
 *   - execution is failure-isolated (one channel's failure never affects
 *     others) and audited;
 *   - runtime unavailability degrades the WHOLE lane honestly without
 *     spawning anything.
 */

import { describe, expect, test, mock } from 'bun:test'

const invocationLog: Array<{ channel: string; action: string }> = []
const cannedOutcomes: Array<Record<string, unknown>> = []

mock.module('../../src/lib/research/reach/adapter', () => ({
  probeReachRuntime: async () => ({ available: true, version: '1.6.1', reason: null, checkedAt: new Date().toISOString() }),
  fetchReachDoctor: async () => ({
    ok: true,
    channels: [
      { channel: 'github', status: 'ready', level: 'default', regressed: false, problems: [], login: null },
      { channel: 'web', status: 'ready', level: 'default', regressed: false, problems: [], login: null },
    ],
    checkedAt: new Date().toISOString(),
  }),
  runReachInvocation: async (invocation: { channel: string; action: string }) => {
    invocationLog.push({ channel: invocation.channel, action: invocation.action })
    const canned = cannedOutcomes.shift()
    if (canned) return canned
    return { ok: true, items: [], backend: null, elapsedMs: 1, attempts: [], error: null }
  },
  auditReachInvocation: () => {},
  clearReachHealthCacheForTests: () => {},
}))

const {
  planReachInvocations,
  normalizeReachItem,
  runReachRetrieval,
} = await import('../../src/lib/research/reach/gateway')

describe('planReachInvocations (deterministic, gated)', () => {
  test('a plain conversational message plans NOTHING', () => {
    expect(planReachInvocations('Hey there, good to see you again my friend')).toEqual([])
  })

  test('a research question plans exactly one web search', () => {
    const plan = planReachInvocations('What is the current stable Node.js release version?')
    expect(plan).toHaveLength(1)
    expect(plan[0].channel).toBe('web')
    expect(plan[0].action).toBe('search')
  })

  test('a GitHub link plans an exact repository read', () => {
    const plan = planReachInvocations('How does https://github.com/yt-dlp/yt-dlp handle rate limits?')
    const github = plan.find((p) => p.channel === 'github')
    expect(github?.action).toBe('read')
    expect(github?.params.target).toBe('yt-dlp/yt-dlp')
  })

  test('a GitHub issue link targets the issue', () => {
    const plan = planReachInvocations('Check github.com/yt-dlp/yt-dlp/issues/9999 for me')
    const github = plan.find((p) => p.channel === 'github')
    expect(github?.params.target).toBe('yt-dlp/yt-dlp/issues/9999')
  })

  test('platform channels appear ONLY when the platform is referenced', () => {
    const plan = planReachInvocations('Search reddit for the best zsh setup and youtube for a demo')
    const channels = plan.map((p) => p.channel)
    expect(channels).toContain('reddit')
    expect(channels).toContain('youtube')
    expect(channels).not.toContain('bilibili')
    expect(channels).not.toContain('v2ex')
  })

  test('the plan is hard-capped at 3 invocations', () => {
    const plan = planReachInvocations(
      'github.com/a/b repo — reddit thread — youtube video — bilibili clip — v2ex.com/t/123',
    )
    expect(plan.length).toBeLessThanOrEqual(3)
  })

  test('V2EX topic links plan an exact read', () => {
    const plan = planReachInvocations('Summarize https://www.v2ex.com/t/1234567')
    const v2ex = plan.find((p) => p.channel === 'v2ex')
    expect(v2ex?.action).toBe('read')
    expect(v2ex?.params.target).toContain('/t/1234567')
  })
})

describe('normalizeReachItem (null-preserving)', () => {
  test('missing title falls back to the hostname (never invented content)', () => {
    const e = normalizeReachItem(
      { title: null, url: 'https://nodejs.org/en/about', author: null, publishedAt: null, text: 'About Node.js' },
      'web',
      'exa',
      1,
    )
    expect(e).not.toBeNull()
    expect(e!.title).toBe('nodejs.org')
    expect(e!.hostName).toBe('nodejs.org')
    expect(e!.date).toBeNull()
    expect(e!.provenance).toEqual({ channel: 'web', backend: 'exa', engine: 'agent-reach' })
  })

  test('unparseable dates stay null (never guessed)', () => {
    const e = normalizeReachItem(
      { title: 't', url: 'https://example.com/a', author: null, publishedAt: 'not a date', text: null },
      'web',
      null,
      2,
    )
    expect(e!.date).toBeNull()
    expect(e!.snippet).toBe('')
  })

  test('private/internal URLs are DROPPED (SSRF guard at normalization)', () => {
    const dropped = normalizeReachItem(
      { title: 'x', url: 'http://169.254.169.254/latest/meta-data/', author: null, publishedAt: null, text: null },
      'web',
      null,
      1,
    )
    expect(dropped).toBeNull()
    const local = normalizeReachItem(
      { title: 'x', url: 'http://localhost:3000/admin', author: null, publishedAt: null, text: null },
      'web',
      null,
      1,
    )
    expect(local).toBeNull()
  })
})

describe('runReachRetrieval (isolated execution)', () => {
  test('merges successful channels and isolates per-channel failures', async () => {
    invocationLog.length = 0
    cannedOutcomes.length = 0
    cannedOutcomes.push({
      ok: true,
      items: [
        { title: 'yt-dlp/yt-dlp', url: 'https://github.com/yt-dlp/yt-dlp', author: 'yt-dlp', published_at: '2010-01-01T00:00:00Z', text: 'A youtube-dl fork with extra features', raw: null },
      ],
      backend: 'github-api',
      elapsedMs: 12,
      attempts: [],
      error: null,
    })
    cannedOutcomes.push({
      ok: false,
      items: [],
      backend: null,
      elapsedMs: 5,
      attempts: [],
      error: { kind: 'needs-login', code: 'NEED_LOGIN', message: 'login required' },
    })
    const outcome = await runReachRetrieval(
      [
        { channel: 'github', action: 'read', params: { target: 'yt-dlp/yt-dlp' }, reason: 'test' },
        { channel: 'reddit', action: 'search', params: { query: 'x' }, reason: 'test' },
      ],
      { userId: 'user-1' },
    )
    expect(invocationLog).toHaveLength(2)
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0].url).toBe('https://github.com/yt-dlp/yt-dlp')
    expect(outcome.results[0].provenance.channel).toBe('github')
    expect(outcome.channelsUsed).toEqual(['github'])
    expect(outcome.degraded.some((d) => d.includes('reddit.search'))).toBeTrue()
    expect(outcome.degraded.some((d) => d.includes('needs-login'))).toBeTrue()
    expect(outcome.invocations).toBe(2)
  })

  test('runtime unavailability degrades the whole lane honestly (no spawns)', async () => {
    invocationLog.length = 0
    // Simulate a dead runtime through the availability override.
    const outcome = await runReachRetrieval(
      [{ channel: 'web', action: 'search', params: { query: 'x' }, reason: 'test' }],
      {
        userId: 'user-1',
        availability: {
          runtime: { available: false, version: null, reason: 'runtime not installed', checkedAt: new Date().toISOString() },
          doctor: { ok: false, channels: [], checkedAt: '' },
        },
      },
    )
    expect(outcome.results).toHaveLength(0)
    expect(outcome.invocations).toBe(0)
    expect(outcome.degraded[0]).toContain('agent reach unavailable')
    expect(invocationLog).toHaveLength(0)
  })

  test('an empty plan executes nothing', async () => {
    invocationLog.length = 0
    const outcome = await runReachRetrieval([], { userId: 'user-1' })
    expect(outcome.invocations).toBe(0)
    expect(invocationLog).toHaveLength(0)
  })
})
