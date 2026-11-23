/**
 * M33 — Explainable memory recall tests.
 *
 * Proves the truthful memory-context record end-to-end through the REAL
 * orchestrator (stub adapter + research seam, same idiom as
 * tests/unit/capability-plan.test.ts): zero / one / bounded-max / overflow
 * memories, recent-first selection, exact IDs, honest policy text, legacy
 * input behavior — plus a static wiring contract that ALL THREE chat paths
 * (interactive SSE route, non-streaming route, background worker handler)
 * supply the explainable-recall inputs, and a receipt-privacy unit for the
 * memory-management Trust recorder.
 */
import { describe, test, expect, mock } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { orchestrateTurn } from '../../src/lib/riishe/orchestrator'
import { CHAT_BACKEND_CAPABILITIES } from '../../src/lib/riishe/classify'
import type { TaskAdapter } from '../../src/lib/adapters/types'
import type { EvidencePack } from '../../src/lib/research/pipeline'
import { MEMORY_LIMITS, MEMORY_POLICY_DESCRIPTION } from '../../src/lib/riishe/memory'

// The semantic Auto-routing seam is mocked so nothing real is resolved here
// (same hermeticity contract as the other orchestrator suites).
mock.module('@/lib/research/semantic-router', () => ({
  resolveAutoSearchDecision: async (
    _message: string,
    deterministic: { search: boolean; risk: string; reason: string },
  ) => ({ decision: deterministic, semantic: null, semanticRan: false }),
}))

const caps = { maxPromptChars: 100_000, maxHistoryMessages: 10 }

function stubAdapter(): { adapter: TaskAdapter; systemPrompt: () => string } {
  let system = ''
  const adapter: TaskAdapter = {
    backendId: 'stub',
    health: async () => ({ healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'stub' }),
    chat: async (args) => {
      system = args.messages[0]?.content ?? ''
      return { content: 'Understood — noted your preferences.', tokensInEst: 1, tokensOutEst: 1, durationMs: 1 }
    },
    chatStream: async function* (args) {
      system = args.messages[0]?.content ?? ''
      yield 'Understood — noted your preferences.'
    },
  }
  return { adapter, systemPrompt: () => system }
}

const records = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `mem-${i + 1}`, content: `fact number ${i + 1} for this user` }))

/** Empty evidence pack for the hermetic research seam (same shape as the
 *  capability-plan suite's pack — the memory path is independent of
 *  retrieval, so any classification that warrants search must stay hermetic
 *  and must never reach the real pipeline). */
const emptyPack: EvidencePack = {
  sources: [],
  queries: [],
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

async function runTurn(input: Record<string, unknown>) {
  const { adapter } = stubAdapter()
  return orchestrateTurn({
    userMessage: 'Quick note about my setup, no need to search.',
    history: [],
    caps,
    adapter,
    backendCapabilities: CHAT_BACKEND_CAPABILITIES,
    // Hermeticity seam: even if the classifier warrants search, the turn
    // must not touch the real research pipeline in tests.
    hooks: { runResearch: async () => emptyPack },
    ...input,
  })
}

describe('M33 explainable recall — orchestrator metadata (real orchestrateTurn)', () => {
  test('zero memories: honest nothing-included record, no memory block injected', async () => {
    const { adapter, systemPrompt } = stubAdapter()
    const result = await orchestrateTurn({
      userMessage: 'Hello there, quick question.',
      history: [],
      caps,
      adapter,
      backendCapabilities: CHAT_BACKEND_CAPABILITIES,
      memoryRecords: [],
      memoryTotalCount: 0,
    })
    const ctx = result.metadata.memoryContext
    expect(ctx).toBeDefined()
    expect(ctx!.includedMemoryIds).toEqual([])
    expect(ctx!.injectedCount).toBe(0)
    expect(ctx!.totalMemoriesAtSelection).toBe(0)
    expect(ctx!.policy).toBe('recent-first-bounded')
    expect(Number.isNaN(Date.parse(ctx!.selectedAt))).toBe(false)
    expect(systemPrompt()).not.toContain('USER-APPROVED MEMORY')
  })

  test('one memory: included, exact ID recorded, honest counts', async () => {
    const result = await runTurn({
      memoryRecords: [{ id: 'only-one', content: 'my timezone is IST' }],
      memoryTotalCount: 1,
    })
    const ctx = result.metadata.memoryContext!
    expect(ctx.includedMemoryIds).toEqual(['only-one'])
    expect(ctx.injectedCount).toBe(1)
    expect(ctx.totalMemoriesAtSelection).toBe(1)
  })

  test('one memory: prompt carries the memory block (inclusion is real)', async () => {
    const { adapter, systemPrompt } = stubAdapter()
    await orchestrateTurn({
      userMessage: 'Hello there.',
      history: [],
      caps,
      adapter,
      backendCapabilities: CHAT_BACKEND_CAPABILITIES,
      memoryRecords: [{ id: 'only-one', content: 'my timezone is IST' }],
      memoryTotalCount: 1,
    })
    expect(systemPrompt()).toContain('USER-APPROVED MEMORY')
    expect(systemPrompt()).toContain('my timezone is IST')
  })

  test('maximum bound: exactly 12 entries injected when 13+ records arrive', async () => {
    const result = await runTurn({ memoryRecords: records(15), memoryTotalCount: 15 })
    const ctx = result.metadata.memoryContext!
    expect(ctx.includedMemoryIds).toHaveLength(MEMORY_LIMITS.injectionCount)
    expect(ctx.injectedCount).toBe(MEMORY_LIMITS.injectionCount)
    expect(ctx.includedMemoryIds).not.toContain('mem-13') // bounded at 12
    expect(ctx.totalMemoriesAtSelection).toBe(15)
  })

  test('more than 12 stored: the explanation states the bounded selection truth', async () => {
    const result = await runTurn({ memoryRecords: records(12), memoryTotalCount: 30 })
    const ctx = result.metadata.memoryContext!
    expect(ctx.injectedCount).toBe(12)
    expect(ctx.totalMemoriesAtSelection).toBe(30)
    expect(ctx.policyDescription).toContain('most recently created')
    expect(ctx.policyDescription).toContain('recency is the only selection criterion')
  })

  test('recent-first: the injected order is the selection order (most recent first)', async () => {
    const { adapter, systemPrompt } = stubAdapter()
    await orchestrateTurn({
      userMessage: 'Hello there.',
      history: [],
      caps,
      adapter,
      backendCapabilities: CHAT_BACKEND_CAPABILITIES,
      memoryRecords: [
        { id: 'newest', content: 'newest fact' },
        { id: 'older', content: 'older fact' },
      ],
      memoryTotalCount: 2,
    })
    const prompt = systemPrompt()
    expect(prompt.indexOf('newest fact')).toBeLessThan(prompt.indexOf('older fact'))
  })

  test('clipped long memories still count as included entries', async () => {
    const longContent = 'x'.repeat(400)
    const result = await runTurn({ memoryRecords: [{ id: 'long-one', content: longContent }], memoryTotalCount: 1 })
    const ctx = result.metadata.memoryContext!
    expect(ctx.injectedCount).toBe(1)
    expect(ctx.includedMemoryIds).toEqual(['long-one'])
  })

  test('NO false semantic relevance claims: policy text states recency-only selection', async () => {
    const result = await runTurn({ memoryRecords: records(3), memoryTotalCount: 3 })
    const ctx = result.metadata.memoryContext!
    expect(ctx.policyDescription).toBe(MEMORY_POLICY_DESCRIPTION)
    // The truthful disclaimer is REQUIRED; no ranking CLAIM may appear.
    expect(ctx.policyDescription).toContain('does not rank memories by relevance')
    expect(ctx.policyDescription).toContain('recency is the only selection criterion')
    expect(ctx.policyDescription.toLowerCase()).not.toContain('semantic')
    expect(ctx.policyDescription.toLowerCase()).not.toContain('ranked as relevant')
    expect(ctx.policyDescription.toLowerCase()).not.toContain('matched by relevance')
    expect(ctx.policyDescription.toLowerCase()).not.toContain('ranked by relevance to the question')
  })

  test('legacy `memories` strings (no IDs) produce NO memoryContext — nothing is fabricated', async () => {
    const result = await runTurn({ memories: ['my timezone is IST'] })
    expect(result.metadata.memoryContext).toBeUndefined()
  })

  test('no memory input at all produces NO memoryContext (legacy callers unchanged)', async () => {
    const result = await runTurn({})
    expect(result.metadata.memoryContext).toBeUndefined()
  })
})

describe('M33 explainable recall — all three chat paths supply the inputs', () => {
  const root = join(import.meta.dir, '..', '..')
  const read = (p: string) => readFileSync(join(root, p), 'utf8')

  test('interactive route (SSE + non-streaming share one fetch) passes memoryRecords', () => {
    const route = read('src/app/api/riishe/chat/route.ts')
    expect(route).toContain('memoryTotalCount = await memoryStore.count')
    expect(route).toContain('select: { id: true, content: true }')
    // Both orchestrateTurn call sites forward the records:
    const callSites = route.split('await orchestrateTurn(').length - 1
    expect(callSites).toBe(2)
    expect(route.match(/memoryRecords,\n\s*memoryTotalCount,/g)?.length).toBe(2)
  })

  test('background worker handler passes memoryRecords too', () => {
    const handler = read('src/lib/ai-engine/riishe-chat-handler.ts')
    expect(handler).toContain('memoryTotalCount = await memoryStore.count')
    expect(handler).toContain('memoryRecords,')
    expect(handler).toContain('memoryTotalCount,')
  })

  test('metadata (with memoryContext) is persisted on both persisted-message paths', () => {
    const route = read('src/app/api/riishe/chat/route.ts')
    const handler = read('src/lib/ai-engine/riishe-chat-handler.ts')
    expect(route.match(/metadata: metadataToJson\(result\.metadata\)/g)?.length).toBe(2) // JSON + SSE paths
    expect(handler).toContain('metadata: metadataToJson(result.metadata)')
    // The SSE wire contract keeps carrying the final metadata additively.
    expect(route).toContain('...(finalMetadata ? { meta: finalMetadata } : {})')
  })
})

// ---- Trust receipt recorder against the fake ledger tables ------------------
// Static fake-db + mock FIRST, then the adapter import binds the fake tables.
import { createTrustFakeDb } from '../helpers/trust-fake-db'
const { fakeDb, reset } = createTrustFakeDb()
mock.module('@/lib/db', () => ({ db: fakeDb }))
const { recordMemoryManagementReceipt } = await import('../../src/lib/trust/adapters/riishe-memory')

describe('M33 memory-management Trust receipts (privacy + honesty)', () => {
  test('a completed edit receipt: one task, truthful verification, ID-only evidence', async () => {
    reset()
    await recordMemoryManagementReceipt({
      userId: 'user-alice',
      op: 'edit',
      memoryIds: ['mem-42'],
      itemCount: 1,
      verification: 'Owner-scoped memory edit applied under the optimistic-concurrency guard.',
    })
    const task = fakeDb.trustTask.rows[0]
    expect(task.status).toBe('completed')
    expect(task.product).toBe('riishe')
    expect(task.kind).toBe('memory-management')
    expect(String(task.verificationSummary)).toContain('optimistic-concurrency')
    const evidence = fakeDb.trustEvidence.rows
    expect(evidence).toHaveLength(1)
    expect(evidence[0].ref).toBe('riishe-memory:mem-42') // ID only — never content
    expect(JSON.stringify(evidence)).not.toContain('timezone')
  })

  test('conflict-presentation receipt settles honestly with limitations', async () => {
    reset()
    await recordMemoryManagementReceipt({
      userId: 'user-alice',
      op: 'potential-conflicts-presented',
      memoryIds: ['mem-1', 'mem-2'],
      itemCount: 2,
      withLimitations: true,
      verification: 'No row was created, changed or deleted — the decision was left to the user.',
      limitations: ['No memory was stored yet: a potential conflict requires an explicit user decision.'],
    })
    const task = fakeDb.trustTask.rows[0]
    expect(task.status).toBe('completed_with_limitations')
    expect(String(task.limitationsJson)).toContain('explicit user decision')
    expect(fakeDb.trustEvidence.rows).toHaveLength(2)
  })
})
