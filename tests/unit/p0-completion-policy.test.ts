/**
 * P0 RIISHE ALWAYS-RESPOND — completion-semantics + chat-noise tests (R1).
 *
 * Owner-rejected experience being fixed:
 *  - ordinary chat answers were badged "Completed with limitations";
 *  - the research-source availability strip listed optional integrations
 *    ("GitHub: Login required", …) permanently in the conversation view;
 *  - a normal policy decision ("search not warranted") was recorded as a
 *    degradation.
 *
 * What these tests pin (all hermetic — scripted adapter, no network):
 *  A. the customer-facing completion policy separates CONVERSATION DELIVERY
 *     (did the answer get produced?) from EVIDENCE VERIFICATION (were
 *     material claims independently checked?) from OPERATIONAL EXECUTION
 *     (did an actual action run?);
 *  B. ordinary conversational delivery records NO terminal badge;
 *  C. tool-backed calculations map real tool executions to computation
 *     evidence and record 'completed' — never a false limitation;
 *  D. material failures keep their honest limitation badges;
 *  E. "search not warranted" never appears as a degradation;
 *  F. approval-waiting turns end on the in-flight stage, not a completion.
 *
 * The internal Trust mapping (mapRiisheStatesToOutcome) is deliberately
 * UNCHANGED — its honesty contract is pinned by the trust suites; this file
 * pins the SEPARATE customer-facing policy.
 */
import { describe, test, expect, mock } from 'bun:test'
import type { TaskAdapter } from '../../src/lib/adapters/types'
import type { ToolContext } from '../../src/lib/riishe/tools/types'

// Semantic-router seam echo (same discipline as the other orchestrator suites).
mock.module('@/lib/research/semantic-router', () => ({
  resolveAutoSearchDecision: async (
    _message: string,
    deterministic: { search: boolean; risk: string; reason: string },
  ) => ({ decision: deterministic, semantic: null, semanticRan: false }),
}))

// P0-F harness: in-memory Prisma fake (same idiom as riishe-code-delegation.test.ts)
// so the REAL check_coding_job tool can report a REAL waiting-for-approval job.
const jobRows: Array<Record<string, unknown>> = []
const trustRows: Array<Record<string, unknown>> = []
const auditRows: Array<Record<string, unknown>> = []
mock.module('@/lib/db', () => ({
  db: {
    generationJob: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: `job-${jobRows.length + 1}` }
        jobRows.push(row)
        return row
      },
      count: async () => 0,
      findFirst: async ({ where }: { where: { id?: string; userId?: string } }) =>
        jobRows.find((r) => (!where.id || r.id === where.id) && (!where.userId || r.userId === where.userId)) ?? null,
    },
    codeProject: { create: async ({ data }: { data: Record<string, unknown> }) => data, findUnique: async () => null, findFirst: async () => null },
    codeMessage: { create: async ({ data }: { data: Record<string, unknown> }) => data, findFirst: async () => null },
    trustTask: { findFirst: async () => trustRows[trustRows.length - 1] ?? null },
    usageRecord: { count: async () => 0, create: async ({ data }: { data: Record<string, unknown> }) => data },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { auditRows.push(data); return data } },
    systemSetting: { findUnique: async () => null },
  },
}))
mock.module('@/lib/observability/metering', () => ({
  recordAudit: async (entry: Record<string, unknown>) => {
    auditRows.push(entry)
  },
}))
mock.module('@/lib/jobs/queue', () => ({ enqueueJob: () => undefined }))

import { customerTerminalStage } from '../../src/lib/riishe/completion-policy'
import { orchestrateTurn, type OrchestrationEvent } from '../../src/lib/riishe/orchestrator'

const CAPS = { maxPromptChars: 100_000, maxHistoryMessages: 12 }
const CTX: ToolContext = { permissions: new Set(['allowCodeExecution']), documents: new Map() }

function scriptedAdapter(replies: string[]): TaskAdapter {
  let i = 0
  return {
    backendId: 'stub-scripted',
    async health() {
      return { healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'stub' }
    },
    async chat(init: { messages: Array<{ role: string; content: string }> }) {
      void init
      return { content: replies[Math.min(i++, replies.length - 1)], tokensInEst: 10, tokensOutEst: 5, durationMs: 1 }
    },
    async *chatStream() {
      yield ''
    },
  } as unknown as TaskAdapter
}

const researchPack = (opts: { sources: number; degraded?: string[] }) => ({
  sources: Array.from({ length: opts.sources }, (_, k) => ({
    id: k + 1,
    url: `https://example.com/src-${k + 1}`,
    title: `Source ${k + 1}`,
    hostName: 'example.com',
    date: '2026-11-01',
    official: false,
    social: false,
    pageRead: true,
    snippet: 'The measured value is 42 according to the report.',
    excerpt: 'The measured value is 42 according to the report.',
    queries: ['topic'],
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
    freshness: 0.9,
    year: 2026,
    authority: 0.5,
    sourceType: 'other' as const,
    score: 1,
  })),
  queries: ['topic'],
  degraded: opts.degraded ?? [],
  staleness: null,
  geoWarning: null,
  durationMs: 5,
  searchMs: 5,
  pageReadMs: 0,
  searchCalls: 1,
  pageReadCalls: 0,
  cacheHits: 0,
  fetchedAt: new Date().toISOString(),
})

function stagesOf(result: { metadata: { taskStages?: Array<{ stage: string }> } }): string[] {
  return (result.metadata.taskStages ?? []).map((s) => s.stage)
}

// ---------------------------------------------------------------------------
// A. Pure policy contract
// ---------------------------------------------------------------------------
describe('P0-A — customerTerminalStage separates delivery / verification / execution', () => {
  test('R6: ordinary conversational delivery → NO terminal stage', () => {
    expect(
      customerTerminalStage({ producedAnswer: true, states: ['UNVERIFIED'], searchNeeded: false, researchRan: false, operationalRun: false }),
    ).toBeNull()
  })

  test('R6: fully verified research answer with no operational execution → NO terminal badge (calm; sources carry the evidence)', () => {
    expect(
      customerTerminalStage({ producedAnswer: true, states: ['VERIFIED_FROM_SOURCES'], searchNeeded: true, researchRan: true, operationalRun: false }),
    ).toBeNull()
  })

  test('R1: no answer produced → failed', () => {
    expect(
      customerTerminalStage({ producedAnswer: false, states: ['UNVERIFIED'], searchNeeded: false, researchRan: false, operationalRun: false }),
    ).toBe('failed')
  })

  test('R2: required tool failed (TOOL_UNAVAILABLE) → completed-with-limitations', () => {
    expect(
      customerTerminalStage({ producedAnswer: true, states: ['TOOL_UNAVAILABLE'], searchNeeded: true, researchRan: true, operationalRun: false }),
    ).toBe('completed-with-limitations')
  })

  test('R3: partial verification → completed-with-limitations (material, even when tools ran)', () => {
    expect(
      customerTerminalStage({ producedAnswer: true, states: ['PARTIALLY_VERIFIED'], searchNeeded: true, researchRan: true, operationalRun: true }),
    ).toBe('completed-with-limitations')
  })

  test('R4: unverified BUT verification was warranted → completed-with-limitations', () => {
    expect(
      customerTerminalStage({ producedAnswer: true, states: ['UNVERIFIED'], searchNeeded: true, researchRan: false, operationalRun: false }),
    ).toBe('completed-with-limitations')
    expect(
      customerTerminalStage({ producedAnswer: true, states: ['UNVERIFIED'], searchNeeded: false, researchRan: true, operationalRun: false }),
    ).toBe('completed-with-limitations')
  })

  test('R5: real operational execution → completed', () => {
    expect(
      customerTerminalStage({ producedAnswer: true, states: ['COMPUTATION_VERIFIED'], searchNeeded: false, researchRan: false, operationalRun: true }),
    ).toBe('completed')
    expect(
      customerTerminalStage({ producedAnswer: true, states: ['UNVERIFIED'], searchNeeded: false, researchRan: false, operationalRun: true }),
    ).toBe('completed')
  })

  test('priority: failure beats limitations beats completion', () => {
    expect(
      customerTerminalStage({ producedAnswer: false, states: ['TOOL_UNAVAILABLE'], searchNeeded: true, researchRan: true, operationalRun: true }),
    ).toBe('failed')
  })
})

// ---------------------------------------------------------------------------
// B/C/D/E. REAL orchestrator — the eight owner-mandated conversation shapes
// ---------------------------------------------------------------------------
describe('P0-B — ordinary conversation shapes record NO limitation badge', () => {
  const plain = async (message: string): Promise<ReturnType<typeof orchestrateTurn>> => {
    const adapter = scriptedAdapter(['Hello! How can I help you today?'])
    return orchestrateTurn({
      userMessage: message,
      history: [],
      caps: CAPS,
      adapter,
      nonStreaming: true,
      toolContext: { permissions: new Set(), userId: 'user-1', documents: new Map() },
    })
  }

  test('greeting: no terminal stage, no false limitation', async () => {
    const result = await plain('Hello there')
    expect(result.content.trim().length).toBeGreaterThan(0)
    const stages = stagesOf(result)
    expect(stages).not.toContain('completed-with-limitations')
    expect(stages).not.toContain('failed')
    // P0-E: a policy decision is not a degradation.
    expect(result.metadata.degraded.some((d) => d.includes('search not warranted'))).toBe(false)
  })

  test('advice-only request: no research, no terminal limitation', async () => {
    const result = await plain('Should I study a little every day instead of cramming?')
    const stages = stagesOf(result)
    expect(stages).not.toContain('completed-with-limitations')
    expect(result.metadata.states).toEqual(['UNVERIFIED'])
    expect(result.metadata.degraded.some((d) => d.includes('search not warranted'))).toBe(false)
  })

  test('general conversation: no terminal limitation', async () => {
    const result = await plain('Tell me about gravity')
    const stages = stagesOf(result)
    expect(stages).not.toContain('completed-with-limitations')
    expect(stages).not.toContain('completed')
  })
})

describe('P0-C — tool-backed calculation maps real execution to computation evidence', () => {
  test('calculate tool run → COMPUTATION_VERIFIED + completed badge, never a limitation', async () => {
    const adapter = scriptedAdapter([
      'Working it out.\nTOOL_CALL: {"tool":"calculate","input":{"expression":"17*23-45"}}',
      'The result is 346.',
    ])
    const result = await orchestrateTurn({
      userMessage: 'Calculate 17 * 23 - 45',
      history: [],
      caps: CAPS,
      adapter,
      nonStreaming: true,
      toolContext: CTX,
    })
    // The governed tool ACTUALLY executed (server-side record).
    expect(result.metadata.toolRuns?.some((t) => t.tool === 'calculate' && t.ok)).toBe(true)
    // Its output is now mapped to the computation evidence state.
    expect(result.metadata.states).toContain('COMPUTATION_VERIFIED')
    const stages = stagesOf(result)
    expect(stages).toContain('completed')
    expect(stages).not.toContain('completed-with-limitations')
    expect(result.content).toContain('346')
  })
})

describe('P0-D — research-required turns keep HONEST qualifications', () => {
  test('successful research with citations → verified evidence, no limitation badge', async () => {
    const adapter = scriptedAdapter(['The report states the measured value is 42 [1].'])
    const result = await orchestrateTurn({
      userMessage: 'What is the latest measured value in the report?',
      history: [],
      caps: CAPS,
      adapter,
      nonStreaming: true,
      hooks: { runResearch: async () => researchPack({ sources: 1 }) },
      toolContext: { permissions: new Set(), userId: 'user-1', documents: new Map() },
    })
    expect(result.metadata.sources.length).toBeGreaterThan(0)
    expect(result.metadata.states).toContain('VERIFIED_FROM_SOURCES')
    expect(stagesOf(result)).not.toContain('completed-with-limitations')
  })

  test('research required but retrieval failed → honest limitation stays', async () => {
    const adapter = scriptedAdapter(['I could not verify current figures; here is the general context.'])
    const result = await orchestrateTurn({
      userMessage: 'What is the current measured value in the report?',
      history: [],
      caps: CAPS,
      adapter,
      nonStreaming: true,
      hooks: { runResearch: async () => researchPack({ sources: 0, degraded: ['search provider unreachable'] }) },
      toolContext: { permissions: new Set(), userId: 'user-1', documents: new Map() },
    })
    expect(result.metadata.states).toContain('TOOL_UNAVAILABLE')
    expect(stagesOf(result)).toContain('completed-with-limitations')
  })

  test('P0-R4: an exploding research lane degrades the turn honestly — the answer still ships', async () => {
    const adapter = scriptedAdapter(['Here is the general context while live verification was unavailable.'])
    const result = await orchestrateTurn({
      userMessage: 'What is the current measured value in the report?',
      history: [],
      caps: CAPS,
      adapter,
      nonStreaming: true,
      hooks: {
        // Out-of-contract explosion (the real pipeline is never-throwing; the
        // orchestrator must contain even a hook/pipeline bug).
        runResearch: async () => {
          throw new Error('simulated research transport explosion')
        },
      },
      toolContext: { permissions: new Set(), userId: 'user-1', documents: new Map() },
    })
    // Core generation SURVIVED — the turn produced its answer.
    expect(result.content.trim().length).toBeGreaterThan(0)
    // The failure is honest: warranted retrieval that retrieved nothing with
    // a degraded note is TOOL_UNAVAILABLE, never a fabricated success.
    expect(result.metadata.states).toContain('TOOL_UNAVAILABLE')
    expect(result.metadata.degraded.join(' ')).toContain('live research failed unexpectedly')
    expect(stagesOf(result)).toContain('completed-with-limitations')
    // The attempted retrieval time is recorded truthfully (researching ran).
    expect(result.metadata.stages.some((s) => s.stage === 'researching')).toBe(true)
  })

  test('workflow execution → completed terminal stage (operational progress is real)', async () => {
    const adapter = scriptedAdapter([
      'Plan:\n1. Research the topic.\n2. Delegate the landing page build.\nFindings: the market grew [1].\nUnfinished work: the coding job was submitted and is queued.\nVerification: claims tied to sources.',
    ])
    const result = await orchestrateTurn({
      userMessage: 'Research the market for solar chargers and then build a landing page for my store',
      history: [],
      caps: CAPS,
      adapter,
      nonStreaming: true,
      hooks: { runResearch: async () => researchPack({ sources: 1 }) },
      toolContext: { permissions: new Set(['allowCodingDelegation']), userId: 'user-1', documents: new Map() },
    })
    expect(result.metadata.workflow).toBeDefined()
    expect(stagesOf(result)).toContain('completed')
    expect(stagesOf(result)).not.toContain('completed-with-limitations')
  })
})

describe('P0-F — approval-waiting turns end on the in-flight stage', () => {
  test('a delegated job waiting for approval records NO terminal completion', async () => {
    // Seed the REAL check_coding_job probe data: a running job whose trust
    // ledger row is waiting_for_approval (same contract as
    // riishe-code-delegation.test.ts).
    jobRows.push({ id: 'job-approval-1', userId: 'user-1', product: 'code-giftz', task: 'coding-task', status: 'running' })
    trustRows.push({ jobId: 'job-approval-1', status: 'waiting_for_approval' })
    const adapter = scriptedAdapter([
      'Checking the deployment job.\nTOOL_CALL: {"tool":"check_coding_job","input":{"jobId":"job-approval-1"}}',
      'The job is waiting for your approval before it can proceed.',
    ])
    const events: OrchestrationEvent[] = []
    const result = await orchestrateTurn({
      // Build-intent wording so the capability plan actually offers
      // check_coding_job, and the permission key so the two-key gate agrees.
      userMessage: 'Build my landing page and also check coding job job-approval-1 for me',
      history: [],
      caps: CAPS,
      adapter,
      nonStreaming: true,
      toolContext: { permissions: new Set(['allowCodeExecution', 'allowCodingDelegation']), userId: 'user-1', documents: new Map() },
      onEvent: (e) => events.push(e),
    })
    // The in-flight stage is the honest last word — no terminal badge.
    const stages = stagesOf(result)
    expect(stages).toContain('approval-waiting')
    expect(stages).not.toContain('completed')
    expect(stages).not.toContain('completed-with-limitations')
    // Sanity: the approval-waiting detection came from the REAL tool output.
    const taskEvents = events.filter((e) => e.type === 'task')
    expect(taskEvents.some((e) => e.type === 'task' && (e as { stage?: string }).stage === 'approval-waiting')).toBe(true)
  })
})
