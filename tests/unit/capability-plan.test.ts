/**
 * Unit tests for the per-turn capability planner: with the composer toggles
 * removed, the server decides code-execution need from the message/task and
 * documents — deterministically and auditably.
 */
import {mock, describe, test, expect } from 'bun:test'
import { planCapabilities } from '../../src/lib/riishe/capability-plan'
import { selectTools, orchestrateTurn } from '../../src/lib/riishe/orchestrator'
import type { TaskAdapter } from '../../src/lib/adapters/types'
import type { EvidencePack } from '../../src/lib/research/pipeline'

// SEMANTIC-ROUTER SEAM (OPERATIONAL-TRANSFORMATION, 2026-11-11): the
// orchestrator now invokes resolveAutoSearchDecision when the deterministic
// policy is not confident. Unit tests must stay hermetic — the semantic
// layer is mocked to echo the deterministic decision (its real behavior is
// covered by auto-grounding.test.ts with an injected transport).
mock.module('@/lib/research/semantic-router', () => ({
  resolveAutoSearchDecision: async (
    _message: string,
    deterministic: { search: boolean; risk: string; reason: string },
  ) => ({ decision: deterministic, semantic: null, semanticRan: false }),
}))


describe('planCapabilities (automatic code execution decision)', () => {
  test('explicit execution requests are granted', () => {
    const plan = planCapabilities('Run this code and tell me the output: console.log(2**40)', 'coding', false)
    expect(plan.codeExecution).toBe(true)
    expect(plan.reasons.join(' ')).toContain('requested')
  })

  test('computational math benefits from the sandbox', () => {
    const plan = planCapabilities('Compute 150! mod 97 for me.', 'math', false)
    expect(plan.codeExecution).toBe(true)
  })

  test('plain conversation does NOT get the sandbox', () => {
    expect(planCapabilities('What is photosynthesis?', 'general', false).codeExecution).toBe(false)
    expect(planCapabilities('2+2', 'math', false).codeExecution).toBe(false) // trivial arithmetic: no sandbox needed
    expect(planCapabilities('Write a haiku about rain', 'general', false).codeExecution).toBe(false)
  })

  test('simulate requests are execution-shaped', () => {
    const plan = planCapabilities('Simulate the Monty Hall problem 10000 times', 'general', false)
    expect(plan.codeExecution).toBe(true)
  })
})

describe('selectTools (attached documents activate document + follow-up web tools)', () => {
  // MEASURED CONTRACT (2026-10-29): there is NO 'analyze_image' tool in the
  // registry — attached images are handled as documents (the document block
  // carries the extracted/summarized text), so the tools are read_document
  // plus web follow-ups. A test asserting a vision tool would pin a
  // capability the product does not have.
  test('attached documents activate read_document plus web follow-up tools', () => {
    const tools = selectTools({
      searchNeeded: false,
      task: 'general',
      hasDocuments: true,
      allowCodeExecution: false,
      researchFailed: false,
    })
    expect(tools).toContain('read_document')
    expect(tools).toContain('web_search')
    expect(tools).toContain('read_url')
  })

  test('no documents and no failed research → no document or web tools', () => {
    const tools = selectTools({
      searchNeeded: false,
      task: 'general',
      hasDocuments: false,
      allowCodeExecution: false,
      researchFailed: false,
    })
    expect(tools).not.toContain('read_document')
    expect(tools).not.toContain('analyze_image') // the vision tool does not exist
    expect(tools).toEqual([])
  })
})

describe('attachment-scoped retrieval (regression: image questions must not web-search)', () => {
  const caps = { maxPromptChars: 100_000, maxHistoryMessages: 10 }
  function stubAdapter(content: string): TaskAdapter {
    return {
      backendId: 'stub',
      health: async () => ({ healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'stub' }),
      chat: async () => ({ content, tokensInEst: 1, tokensOutEst: 1, durationMs: 1 }),
      chatStream: async function* () {
        yield content
      },
    }
  }
  // AttachedDocument shape: { id, name, text, truncated } — an attached image
  // arrives with its extracted/summarized text pre-filled by the route.
  const imageDoc = {
    id: 'img1',
    name: 'chart.png',
    text: '[IMAGE SUMMARY] A chart titled "BEAN Q3 REPORT" with revenue 4.2 million USD.',
    truncated: false,
  }
  const pack: EvidencePack = {
    sources: [
      {
        id: 1, url: 'https://example.com/bean-revenue', title: 'BEAN revenue report',
        snippet: 'BEAN revenue was 4.1 million USD.', hostName: 'example.com', date: '2026-10-01',
        freshness: 0.1, year: 2026, authority: 1, official: false, score: 0.9, pageRead: false,
        excerpt: 'BEAN revenue was 4.1 million USD.', social: false, sourceType: 'other',
      },
    ],
    queries: ['bean revenue'],
    degraded: [],
    staleness: null,
    geoWarning: null,
    durationMs: 1,
    searchMs: 1,
    pageReadMs: 0,
    searchCalls: 1,
    pageReadCalls: 0,
    cacheHits: 0,
    fetchedAt: new Date().toISOString(),
  }

  test('a file-scoped question does NOT run web retrieval (files are the evidence)', async () => {
    let researchRan = false
    const result = await orchestrateTurn({
      userMessage: 'Look at the attached chart image: what is the exact revenue number written on it?',
      history: [],
      caps,
      adapter: stubAdapter('The revenue on the chart is 4.2 million USD.'),
      backendCapabilities: ['general', 'research', 'document'],
      documents: [imageDoc],
      hooks: {
        runResearch: async () => {
          researchRan = true
          return { ...pack, sources: [], queries: [] }
        },
      },
    })
    expect(researchRan).toBe(false)
    expect(result.searchRan).toBe(false)
  })

  test('an EXPLICIT lookup request with attachments still searches', async () => {
    const result = await orchestrateTurn({
      userMessage: 'Search online for the latest BEAN revenue and compare it with the attached chart.',
      history: [],
      caps,
      adapter: stubAdapter('External reports state 4.1 million USD [1].'),
      backendCapabilities: ['general', 'research', 'document'],
      documents: [imageDoc],
      hooks: {
        runResearch: async () => pack,
      },
    })
    expect(result.searchRan).toBe(true)
  })
})
