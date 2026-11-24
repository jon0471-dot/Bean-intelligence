/**
 * M37 §1/§2/§4 — workflow detection, cross-source contradictions, strict
 * document grounding, prompt-protocol wiring and task-stage metadata.
 *
 * REAL orchestrator where integration is pinned (scripted adapter + the
 * research seam, hermetic — no network); PURE modules where the contract is
 * deterministic (contradiction scan, workflow detection).
 */
import { describe, test, expect, mock } from 'bun:test'
import type { TaskAdapter } from '../../src/lib/adapters/types'

// Semantic router echo (same seam discipline as the research-quality suite).
mock.module('@/lib/research/semantic-router', () => ({
  resolveAutoSearchDecision: async (
    _message: string,
    deterministic: { search: boolean; risk: string; reason: string },
  ) => ({ decision: deterministic, semantic: null, semanticRan: false }),
}))

import { detectSourceContradictions, describeContradiction } from '../../src/lib/riishe/contradictions'
import { detectWorkflow } from '../../src/lib/riishe/workflow'
import { planCapabilities } from '../../src/lib/riishe/capability-plan'
import { buildSystemPrompt } from '../../src/lib/riishe/prompts'
import { selectTools } from '../../src/lib/riishe/orchestrator'

const CAPS = { maxPromptChars: 100_000, maxHistoryMessages: 12 }

function scriptedAdapter(replies: string[]): TaskAdapter & { prompts: string[] } {
  const prompts: string[] = []
  let i = 0
  return {
    prompts,
    backendId: 'stub-scripted',
    async health() {
      return { healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'stub' }
    },
    async chat(init: { messages: Array<{ role: string; content: string }> }) {
      prompts.push(init.messages.map((m) => m.content).join('\n---\n'))
      return { content: replies[Math.min(i++, replies.length - 1)], tokensInEst: 10, tokensOutEst: 5, durationMs: 1 }
    },
    async *chatStream() {
      yield ''
    },
  } as unknown as TaskAdapter & { prompts: string[] }
}

describe('M37 §1 — cross-source contradiction detection (pure, conservative)', () => {
  const conflict = [
    { id: 1, title: 'Reliefweb situation report', snippet: 'The Kapueras floods killed 24 people according to early assessments.', excerpt: null },
    { id: 2, title: 'National disaster agency bulletin', snippet: 'Officials said the Kapueras floods killed 31 people in the affected districts.', excerpt: null },
  ]
  const agreeing = [
    { id: 1, title: 'Report A', snippet: 'The Riverside floods killed 24 people.', excerpt: null },
    { id: 2, title: 'Report B', snippet: 'Officials said 24 people died in the Riverside floods.', excerpt: null },
  ]
  const unrelatedEntities = [
    { id: 1, title: 'Report A', snippet: 'The Harbour collapse killed 24 people.', excerpt: null },
    { id: 2, title: 'Report B', snippet: 'The Mine incident killed 31 people yesterday.', excerpt: null },
  ]

  test('two sources with different figures for the same entity are flagged', () => {
    const found = detectSourceContradictions(conflict)
    expect(found.length).toBe(1)
    expect(found[0].measure).toBe('dead')
    expect(found[0].sourceIdA).toBe(1)
    expect(found[0].sourceIdB).toBe(2)
    expect(describeContradiction(found[0])).toMatch(/24/)
    expect(describeContradiction(found[0])).toMatch(/31/)
  })

  test('sources that AGREE are never flagged (no manufactured controversy)', () => {
    expect(detectSourceContradictions(agreeing)).toHaveLength(0)
  })

  test('different entities with different numbers are NOT flagged', () => {
    expect(detectSourceContradictions(unrelatedEntities)).toHaveLength(0)
  })

  test('conflicts within ONE source are not cross-source contradictions', () => {
    const single = [
      { id: 1, title: 'Report', snippet: 'First 12 people died, later reports said 20 people died.', excerpt: null },
    ]
    expect(detectSourceContradictions(single)).toHaveLength(0)
  })

  test('scale words are canonicalized: $5 million vs $5,000,000 is NOT a conflict', () => {
    const same = [
      { id: 1, title: 'Wire report', snippet: 'Damage reached $5 million across the Delta towns.', excerpt: null },
      { id: 2, title: 'Agency ledger', snippet: 'Total damage: $5,000,000 in the Delta towns.', excerpt: null },
    ]
    expect(detectSourceContradictions(same)).toHaveLength(0)
  })

  test('a real money conflict IS flagged', () => {
    const conflictMoney = [
      { id: 1, title: 'Wire report', snippet: 'Reconstruction costs reached $5 million across the Delta towns.', excerpt: null },
      { id: 2, title: 'Audit board', snippet: 'Reconstruction costs for the Delta towns reached $9 million.', excerpt: null },
    ]
    const found = detectSourceContradictions(conflictMoney)
    expect(found.length).toBe(1)
    expect(found[0].measure).toBe('money')
  })

  test('a date conflict for the same event is flagged with both dates', () => {
    const dates = [
      { id: 1, title: 'Election coverage', snippet: 'The Haruna verdict was issued on 2026-03-04 by the tribunal.', excerpt: null },
      { id: 2, title: 'Court filing coverage', snippet: 'The Haruna tribunal verdict was issued on March 11, 2026.', excerpt: null },
    ]
    const found = detectSourceContradictions(dates)
    expect(found.length).toBe(1)
    expect(found[0].measure).toBe('date')
  })

  test('cap: at most five contradictions are reported (bounded output)', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      title: `Report ${i + 1}`,
      snippet: `The Kapueras floods killed ${10 + i} people.`,
      excerpt: null,
    }))
    expect(detectSourceContradictions(many).length).toBeLessThanOrEqual(5)
  })

  test('snippet-only and full-page sources both feed the scan', () => {
    const withExcerpt = [
      { id: 1, title: 'Snippet only', snippet: 'The Deltaquake displaced 2000 people.', excerpt: null },
      { id: 2, title: 'Full page', snippet: 'Brief', excerpt: 'The Deltaquake displaced 5400 people across three districts.' },
    ]
    expect(detectSourceContradictions(withExcerpt).length).toBe(1)
  })
})

describe('M37 §4 — workflow detection (pure)', () => {
  const basePlan = planCapabilities('plain message', 'general', false)

  test('a single-domain turn is NOT a workflow', () => {
    expect(detectWorkflow({ searchNeeded: true, task: 'research', hasDocuments: false, plan: basePlan }).active).toBe(false)
    expect(detectWorkflow({ searchNeeded: false, task: 'document', hasDocuments: true, plan: basePlan }).parts).toEqual(['documents'])
  })

  test('research + documents activates the workflow', () => {
    const wf = detectWorkflow({ searchNeeded: true, task: 'research', hasDocuments: true, plan: basePlan })
    expect(wf.active).toBe(true)
    expect(wf.parts).toContain('research')
    expect(wf.parts).toContain('documents')
  })

  test('research + coding delegation activates the workflow (the multi-step case)', () => {
    const plan = planCapabilities('Research the market and build a landing page for it', 'research', false)
    expect(plan.codingDelegation).toBe(true)
    const wf = detectWorkflow({ searchNeeded: true, task: 'research', hasDocuments: false, plan })
    expect(wf.active).toBe(true)
    expect(wf.parts).toContain('coding')
  })
})

describe('M37 §2 — prompt protocol wiring', () => {
  test('multi-document turns include the comparison protocol', () => {
    const prompt = buildSystemPrompt({
      evidenceBlock: null,
      task: 'document',
      staleness: null,
      multiDoc: true,
    })
    expect(prompt).toContain('Multi-document comparison protocol')
    expect(prompt).toContain('Address each document BY NAME')
  })

  test('strict grounding turns include the documents-only contract', () => {
    const prompt = buildSystemPrompt({
      evidenceBlock: null,
      task: 'document',
      staleness: null,
      docGrounded: true,
    })
    expect(prompt).toContain('Strict document-grounding contract')
    expect(prompt).toContain('never silently substitute outside knowledge')
  })

  test('document protocol carries page-marker honesty and summary traceability', () => {
    const prompt = buildSystemPrompt({ evidenceBlock: null, task: 'document', staleness: null })
    expect(prompt).toContain('cite a [page N] marker ONLY when the extraction actually carries it')
    expect(prompt).toContain('never invent or guess a page number')
    expect(prompt).toContain('summary')
  })

  test('workflow turns include the coordination protocol', () => {
    const prompt = buildSystemPrompt({
      evidenceBlock: null,
      task: 'research',
      staleness: null,
      workflow: { parts: ['research', 'coding'] },
    })
    expect(prompt).toContain('Multi-step workflow protocol')
    expect(prompt).toContain('Unfinished work')
    expect(prompt).toContain('CHECK the job status before claiming anything')
  })

  test('ordinary turns gain NO workflow protocol (no badge noise)', () => {
    const prompt = buildSystemPrompt({ evidenceBlock: null, task: 'general', staleness: null })
    expect(prompt).not.toContain('Multi-step workflow protocol')
  })
})

describe('M37 §4 — strict grounding suppresses web retrieval (REAL orchestrator)', () => {
  test('a "based only on the documents" turn runs NO research and records docGrounded', async () => {
    const { orchestrateTurn } = await import('../../src/lib/riishe/orchestrator')
    let researchCalls = 0
    const adapter = scriptedAdapter(['The documents state the market grew 12% year over year [doc].'])
    const events: Array<Record<string, unknown>> = []
    const result = await orchestrateTurn({
      userMessage: 'Based only on the attached documents, what does the market report conclude about growth?',
      history: [],
      caps: CAPS,
      adapter,
      nonStreaming: true,
      documents: [
        { id: 'doc-1', name: 'market-report.pdf', text: 'The market grew 12% year over year in the measured segment.', truncated: false, kind: 'pdf' },
      ],
      hooks: {
        runResearch: async () => {
          researchCalls += 1
          return { sources: [], queries: [], degraded: ['must not run'], staleness: null, geoWarning: null, durationMs: 0, searchMs: 0, pageReadMs: 0, searchCalls: 0, pageReadCalls: 0, cacheHits: 0, fetchedAt: new Date().toISOString() }
        },
      },
      toolContext: { permissions: new Set(['allowCodeExecution', 'allowCodingDelegation']), userId: 'user-1', documents: new Map() },
      onEvent: (e) => events.push(e as Record<string, unknown>),
    })
    expect(researchCalls).toBe(0)
    expect(result.metadata.docGrounded).toBe(true)
    expect(result.task).toBe('document')
    // Terminal task stage recorded from the real response states.
    const stages = (result.metadata.taskStages ?? []).map((s) => s.stage)
    expect(stages).toContain('completed-with-limitations')
    expect(stages).not.toContain('researching')
  })

  test('a multi-domain workflow turn records planning + terminal stages and workflow provenance', async () => {
    const { orchestrateTurn } = await import('../../src/lib/riishe/orchestrator')
    const adapter = scriptedAdapter([
      'Plan:\n1. Research the topic.\n2. Delegate the landing page build.\nFindings: [1] market size grew.\nUnfinished work: the coding job was submitted and is queued.\nVerification: job state checked.',
    ])
    const result = await orchestrateTurn({
      userMessage: 'Research the market for solar chargers and then build a landing page for my store',
      history: [],
      caps: CAPS,
      adapter,
      nonStreaming: true,
      hooks: {
        runResearch: async () => ({
          sources: [
            { id: 1, url: 'https://example.com/solar', title: 'Solar charger market', hostName: 'example.com', date: '2026-11-01', official: false, social: false, pageRead: true, snippet: 'The solar charger market grew steadily.', excerpt: 'The solar charger market grew steadily in 2026.', queries: ['solar'], degraded: [], staleness: null, geoWarning: null, durationMs: 5, searchMs: 5, pageReadMs: 0, searchCalls: 1, pageReadCalls: 0, cacheHits: 0, fetchedAt: new Date().toISOString() },
          ],
          queries: ['solar'],
          degraded: [],
          staleness: null,
          geoWarning: null,
          durationMs: 5,
          searchMs: 5,
          pageReadMs: 0,
          searchCalls: 1,
          pageReadCalls: 0,
          cacheHits: 0,
          fetchedAt: new Date().toISOString(),
        }),
      },
      toolContext: { permissions: new Set(['allowCodingDelegation']), userId: 'user-1', documents: new Map() },
    })
    expect(result.metadata.workflow).toBeDefined()
    expect(result.metadata.workflow!.parts).toContain('coding')
    const stages = (result.metadata.taskStages ?? []).map((s) => s.stage)
    expect(stages[0]).toBe('planning')
    expect(stages).toContain('researching')
    // The terminal stage is whatever the REAL response states map to (this
    // scripted turn verifies against its evidence pack → completed).
    expect(['completed', 'completed-with-limitations']).toContain(stages[stages.length - 1])
    // The workflow protocol reached the composer's system prompt.
    expect(adapter.prompts.join('\n')).toContain('Multi-step workflow protocol')
  })

  test('an ordinary single-domain turn gains NO workflow metadata (no badge noise)', async () => {
    const { orchestrateTurn } = await import('../../src/lib/riishe/orchestrator')
    const adapter = scriptedAdapter(['Hello! How can I help you today?'])
    const result = await orchestrateTurn({
      userMessage: 'Hello there',
      history: [],
      caps: CAPS,
      adapter,
      nonStreaming: true,
      toolContext: { permissions: new Set(), userId: 'user-1', documents: new Map() },
    })
    expect(result.metadata.workflow).toBeUndefined()
    expect(result.metadata.docGrounded).toBeUndefined()
    const stages = (result.metadata.taskStages ?? []).map((s) => s.stage)
    expect(stages).not.toContain('planning')
    expect(stages).toContain('completed-with-limitations')
  })
})

describe('M37 §3 — delegation tools excluded from single-domain non-delegation turns', () => {
  test('without the coding plan, selectTools never offers delegation (regression guard)', () => {
    const tools = selectTools({
      searchNeeded: true,
      task: 'research' as 'math',
      hasDocuments: false,
      allowCodeExecution: false,
      researchFailed: false,
      deepResearch: true,
    })
    expect(tools).not.toContain('delegate_coding')
    expect(tools).toContain('web_search')
  })
})
