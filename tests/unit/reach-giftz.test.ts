/**
 * CODE GIFTZ × Agent Reach technical research (hermetic: the reach gateway
 * is mocked at the module boundary; the base tech-docs lane uses the
 * existing injectable search seam — no network, no processes).
 *
 * Regression contract (Phase 5):
 *   - GitHub references in a coding request add an EXACT allowlisted read
 *     and merge into the SAME untrusted reference block;
 *   - the base tech-docs lane keeps its contract (subjects/block/sources);
 *   - failures degrade honestly (base context preserved, degraded notes);
 *   - discovery requests plan a bounded repository search;
 *   - no GitHub reference → no reach invocations at all.
 */

import { describe, expect, test, mock } from 'bun:test'
import { setTechDocsSearchForTests } from '../../src/lib/intel/techdocs'
import type { WebSearchResult } from '../../src/lib/research/provider'

let reachPlans: Array<Array<{ channel: string; action: string; params: Record<string, string | number>; reason: string }>> = []
let reachOutcome: {
  results: Array<{ url: string; title: string; snippet: string; hostName: string; rank: number; date: string | null; author: string | null; provenance: { channel: string; backend: string | null; engine: 'agent-reach' } }>
  degraded: string[]
  durationMs: number
  invocations: number
  channelsUsed: string[]
} = { results: [], degraded: [], durationMs: 0, invocations: 0, channelsUsed: [] }

mock.module('@/lib/research/reach/gateway', () => ({
  runReachRetrieval: async (plan: Array<{ channel: string; action: string; params: Record<string, string | number>; reason: string }>) => {
    reachPlans.push(plan)
    return reachOutcome
  },
  planReachInvocations: () => [],
  reachPageReadFallback: async () => null,
  normalizeReachItem: () => null,
  resolveAvailability: async () => ({
    runtime: { available: true, version: '1.6.1', reason: null, checkedAt: '' },
    doctor: { ok: true, channels: [], checkedAt: '' },
  }),
  channelAvailability: () => ({
    disabledByConfig: false, runtimeAvailable: true, doctorStatus: 'ready', regressed: false, loginRequired: false, loggedIn: null,
  }),
  runReachLaneForMessage: async () => ({ ...reachOutcome, plan: [] }),
  MAX_REACH_INVOCATIONS_PER_TURN: 3,
}))

const { buildTechDocsWithReach } = await import('../../src/lib/intel/techdocs-reach')

// Deterministic base-lane results (official docs search via the shared pipeline).
const baseResults: WebSearchResult[] = [
  { url: 'https://react.dev/reference/react/useEffect', title: 'useEffect – React', snippet: 'If your Effect subscribes to something, the cleanup function should unsubscribe.', hostName: 'react.dev', rank: 1, date: null },
]
setTechDocsSearchForTests(async () => baseResults)

describe('buildTechDocsWithReach', () => {
  test('a GitHub link plans an exact read and merges into the same block', async () => {
    reachPlans = []
    reachOutcome = {
      results: [
        {
          url: 'https://github.com/facebook/react',
          title: 'facebook/react',
          snippet: 'The library for web and native user interfaces.',
          hostName: 'github.com',
          rank: 1,
          date: null,
          author: 'facebook',
          provenance: { channel: 'github', backend: 'github-api', engine: 'agent-reach' },
        },
      ],
      degraded: [],
      durationMs: 30,
      invocations: 1,
      channelsUsed: ['github'],
    }
    const { techDocs, research } = await buildTechDocsWithReach(
      'How do I use useEffect like https://github.com/facebook/react does?',
      'user-1',
    )
    expect(reachPlans).toHaveLength(1)
    expect(reachPlans[0][0].channel).toBe('github')
    expect(reachPlans[0][0].action).toBe('read')
    expect(reachPlans[0][0].params.target).toBe('facebook/react')
    expect(techDocs).not.toBeNull()
    expect(techDocs!.block).toContain('OFFICIAL DOCUMENTATION REFERENCE')
    expect(techDocs!.block).toContain('via github-api')
    expect(techDocs!.block).toContain('The library for web and native user interfaces.')
    expect(research.sources.some((s) => s.channel === 'github' && s.url === 'https://github.com/facebook/react')).toBeTrue()
    expect(research.sources.some((s) => s.channel === 'gateway')).toBeTrue()
  })

  test('a discovery request plans a bounded repository search', async () => {
    reachPlans = []
    reachOutcome = { results: [], degraded: [], durationMs: 5, invocations: 1, channelsUsed: [] }
    await buildTechDocsWithReach('Find a good npm library for building CLI tools', 'user-1')
    expect(reachPlans).toHaveLength(1)
    expect(reachPlans[0][0].action).toBe('search')
  })

  test('no GitHub reference → zero reach invocations, base lane passthrough', async () => {
    reachPlans = []
    const { techDocs, research } = await buildTechDocsWithReach('Fix my useEffect cleanup in React 19', 'user-1')
    expect(reachPlans).toHaveLength(0)
    expect(techDocs).not.toBeNull()
    expect(techDocs!.sources[0].host).toBe('react.dev')
    expect(research.sources.every((s) => s.channel === 'gateway')).toBeTrue()
  })

  test('reach failure degrades honestly and the base context survives', async () => {
    reachPlans = []
    reachOutcome = {
      results: [],
      degraded: ['github.read failed (needs-setup): missing executable'],
      durationMs: 10,
      invocations: 1,
      channelsUsed: [],
    }
    const { techDocs, research } = await buildTechDocsWithReach(
      'Check https://github.com/some/repoo for the pattern',
      'user-1',
    )
    // No usable reference emerged: the base lane is null here (no known tech
    // subject) and the reach lane failed — an HONEST null + degraded note,
    // never a fabricated citation.
    expect(techDocs).toBeNull()
    expect(research.degraded.some((d) => d.includes('needs-setup'))).toBeTrue()
  })

  test('no known tech subject + no GitHub reference → null techDocs (honest fast path)', async () => {
    reachPlans = []
    const { techDocs } = await buildTechDocsWithReach('Write me a haiku about autumn rain', 'user-1')
    expect(techDocs).toBeNull()
  })
})
