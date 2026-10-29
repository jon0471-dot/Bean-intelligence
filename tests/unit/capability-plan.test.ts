/**
 * Unit tests for the per-turn capability planner: with the composer toggles
 * removed, the server decides code-execution need from the message/task and
 * documents — deterministically and auditably.
 */
import { describe, test, expect } from 'bun:test'
import { planCapabilities } from '../../src/lib/riishe/capability-plan'
import { selectTools, orchestrateTurn } from '../../src/lib/riishe/orchestrator'
import type { TaskAdapter } from '../../src/lib/adapters/types'

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

describe('selectTools (image attachments activate the vision tool)', () => {
  test('image attachments add analyze_image', () => {
    const tools = selectTools({
      searchMode: 'auto',
      searchNeeded: false,
      task: 'general',
      hasDocuments: true,
      hasImages: true,
      allowCodeExecution: false,
    })
    expect(tools).toContain('analyze_image')
    expect(tools).toContain('read_document')
  })

  test('no images → no vision tool', () => {
    const tools = selectTools({
      searchMode: 'auto',
      searchNeeded: false,
      task: 'general',
      hasDocuments: true,
      hasImages: false,
      allowCodeExecution: false,
    })
    expect(tools).not.toContain('analyze_image')
  })
})

describe('attachment-scoped retrieval (regression: image questions must not web-search)', () => {
  const caps = { maxPromptChars: 100_000, maxHistoryMessages: 10 }
  function stubAdapter(content: string): TaskAdapter {
    return {
      backendId: 'stub',
      health: async () => ({ ok: true, detail: '' }) as never,
      chat: async () => ({ content, tokensInEst: 1, tokensOutEst: 1, durationMs: 1 }),
      chatStream: async function* () {
        yield content
      },
    }
  }
  const imageDoc = {
    id: 'img1',
    name: 'chart.png',
    text: '',
    truncated: false,
    kind: 'image',
    summary: 'A chart titled "BEAN Q3 REPORT" with revenue 4.2 million USD.',
  }

  test('a file-scoped question does NOT run web retrieval (files are the evidence)', async () => {
    let researchRan = false
    const result = await orchestrateTurn({
      userMessage: 'Look at the attached chart image: what is the exact revenue number written on it?',
      history: [],
      caps,
      adapter: stubAdapter('The revenue on the chart is 4.2 million USD.'),
      backendCapabilities: ['general', 'research', 'document'],
      searchMode: 'auto',
      documents: [imageDoc],
      hooks: {
        runResearch: async () => {
          researchRan = true
          return { sources: [], queries: [], degraded: [], staleness: null, durationMs: 1 }
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
      searchMode: 'auto',
      documents: [imageDoc],
      hooks: {
        runResearch: async () => ({
          sources: [
            {
              id: 1, url: 'https://example.com/bean-revenue', title: 'BEAN revenue report',
              snippet: 'BEAN revenue was 4.1 million USD.', hostName: 'example.com', date: '2026-10-01',
              freshness: 0.1, year: 2026, authority: 1, official: false, score: 0.9, pageRead: false,
              excerpt: 'BEAN revenue was 4.1 million USD.',
            },
          ],
          queries: ['bean revenue'],
          degraded: [],
          staleness: null,
          durationMs: 1,
        }),
      },
    })
    expect(result.searchRan).toBe(true)
  })
})
