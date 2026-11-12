/**
 * BEAN Intelligence — RIISHE independent-lane diagnostics persistence tests
 * (2026-11-12 approved minimal live-research reliability fix).
 *
 * Pins the metadata contract: the research pack's `independent` notes (the
 * key-free fallback lane) and the real call counts persist in
 * Message.metadata ALONGSIDE `degraded`, and survive the JSON round-trip
 * through Prisma's Json column — i.e. they are still present after a
 * conversation reload. The payload carries tool outcomes only: no
 * credentials, no request payloads, no personal data.
 */
import { describe, test, expect } from 'bun:test'

import { metadataToJson } from '../../src/lib/riishe/states'
import type { MessageMetadata } from '../../src/lib/riishe/states'

function metadataWithLane(): MessageMetadata {
  return {
    states: [],
    sources: [],
    verification: [],
    stages: [{ stage: 'researching', durationMs: 26_679 }],
    degraded: [
      'search "new AI model launch 2026-11-05.." failed: web_search failed: Function invoke failed with status 500: …42900',
      'search "latest AI model releases" returned no results (authoritative provider response — not an outage)',
    ],
    independent: [
      'independent search failed: wikipedia MediaWiki API unreachable',
      'independent search (Wikipedia MediaWiki API): 3 result(s) for "Grok chatbot"',
    ],
    independentMs: 3_412,
    searchCalls: 5,
    pageReadCalls: 2,
    retrievedAt: '2026-11-12T04:10:27.756Z',
    timings: { totalMs: 28_752, understandMs: 120, researchMs: 26_679, solveTtftMs: 900, solveMs: 1_800, verifyMs: 3, solvePasses: 1 },
  }
}

describe('independent-lane diagnostics survive metadata persistence and reload', () => {
  test('metadataToJson round-trips independent notes beside degraded', () => {
    const json = metadataToJson(metadataWithLane())
    const reloaded = JSON.parse(JSON.stringify(json)) as MessageMetadata
    expect(Array.isArray(reloaded.independent)).toBe(true)
    expect(reloaded.independent).toHaveLength(2)
    expect(reloaded.independent?.[0]).toContain('independent search failed')
    expect(reloaded.degraded).toHaveLength(2)
    expect(reloaded.degraded.some((d) => d.includes('not an outage'))).toBe(true)
  })

  test('call counts and lane wall-time persist for post-hoc diagnosis', () => {
    const reloaded = JSON.parse(JSON.stringify(metadataToJson(metadataWithLane()))) as MessageMetadata
    expect(reloaded.searchCalls).toBe(5)
    expect(reloaded.pageReadCalls).toBe(2)
    expect(reloaded.independentMs).toBe(3_412)
  })

  test('the diagnostics payload contains no credentials or personal data', () => {
    const json = metadataToJson(metadataWithLane())
    const serialized = JSON.stringify(json).toLowerCase()
    for (const forbidden of ['apikey', 'api_key', 'authorization', 'bearer', 'cookie', 'password', 'token=']) {
      expect(serialized.includes(forbidden)).toBe(false)
    }
  })

  test('metadata WITHOUT the lane (turns where research never ran) serializes unchanged', () => {
    const minimal: MessageMetadata = {
      states: [],
      sources: [],
      verification: [],
      stages: [],
      degraded: [],
    }
    const reloaded = JSON.parse(JSON.stringify(metadataToJson(minimal))) as MessageMetadata
    expect(reloaded.independent).toBeUndefined()
    expect(reloaded.searchCalls).toBeUndefined()
    expect(reloaded.degraded).toEqual([])
  })
})
