/**
 * Claim-repair pass + in-flight search dedup tests.
 *
 * Work-order contract (flagship): "When an answer contains an unsupported
 * central claim, correct it before presenting the answer as verified." The
 * orchestrator must run ONE bounded repair pass that ties uncovered material
 * claims to the retrieved evidence (or qualifies them), re-run the identical
 * audits, adopt the repair only when grounding improves, and stay honest
 * when it cannot. Only the SDK boundary and the model adapter are stubbed —
 * the orchestrator, pipeline, ranking and audits are the REAL production
 * code. Every search result the mock returns is a plausible, well-shaped
 * record; nothing fabricates success states.
 *
 * Run: bun test tests/unit/claim-repair.test.ts
 */
import { describe, test, expect, mock } from 'bun:test'
import type { TaskAdapter } from '../../src/lib/adapters/types'
import type { OrchestrationEvent } from '../../src/lib/riishe/orchestrator'

// ---- scripted SDK: healthy search, no page reads needed -------------------
const searchCalls: string[] = []
const scriptedZai = {
  functions: {
    invoke: async (tool: string, args: { query: string }) => {
      if (tool !== 'web_search') throw new Error(`unexpected tool: ${tool}`)
      searchCalls.push(args.query)
      return [
        {
          url: 'https://www.tn.gov.in/council-of-ministers',
          name: 'Council of Ministers — Tamil Nadu Government',
          // Substantial snippet (>260 chars) so snippet-sufficiency skips page reads.
          snippet:
            'The official Council of Ministers listing records Joseph Vijay as the incumbent Chief Minister of Tamil Nadu, sworn in on 10 May 2026. The page lists the cabinet portfolio assignments and the oath of office administered at Raj Bhavan. '.repeat(2),
          host_name: 'www.tn.gov.in',
          rank: 1,
          date: '2026-05-10',
        },
      ]
    },
  },
  chat: {
    completions: {
      create: async () => {
        throw new Error('query refinement must not run for straightforward questions')
      },
    },
  },
}

mock.module('z-ai-web-dev-sdk', () => ({ default: { create: async () => scriptedZai } }))

mock.module('../../src/lib/research/direct', () => ({

  // The independent lane is a REAL network path (Wikipedia API, official
  // sources). These tests exercise gateway retry/repair semantics, so the
  // lane is neutralized at its module boundary; its live behavior is covered
  // by scripts/riishe-gateway-down-acceptance.test.ts (real network).
  runDirectRetrieval: async () => ({ results: [], pages: [], notes: [] }),
  directFetchPage: async () => {
    throw new Error('direct fetch disabled in this test')
  },
  isUsablePageText: (text: string) => text.trim().length >= 200,
  PAGE_MIN_USEFUL_CHARS: 200,
  // MEASURED FIX (2026-11-10): pipeline.ts statically binds these two
  // helpers; a partial mock record fails ESM linking ("Export named
  // 'resolveRedirectUrl' not found"). Under these tests' premise they are
  // never reached, so honest pure stubs suffice.
  isRedirectWrapperUrl: (url: string) => /google\.[^/]+\/goto|news\.google\.com/i.test(url ?? ''),
  resolveRedirectUrl: async (url: string) => url,
}))

const { orchestrateTurn } = await import('../../src/lib/riishe/orchestrator')
const { runSharedSearch } = await import('../../src/lib/research/pipeline')

/** Adapter whose replies are scripted per solve call (counted, streaming). */
function scriptedAdapter(replies: string[]): TaskAdapter & { calls: number } {
  let n = 0
  return {
    get calls() {
      return n
    },
    backendId: 'stub-scripted',
    async health() {
      return { healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'stub' }
    },
    async *chatStream() {
      const reply = replies[Math.min(n, replies.length - 1)]
      n += 1
      for (const chunk of reply.match(/[\s\S]{1,12}/g) ?? []) yield chunk
    },
  }
}

const BASE = {
  history: [],
  caps: { maxPromptChars: 12_000, maxHistoryMessages: 20 },
}

const CM_QUESTION = 'who is the cm of tamilnadu'


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

describe('bounded claim-repair pass', () => {
  test('repairs an uncited headline claim against the retrieved evidence and verifies', async () => {
    // First solve pass: the headline claim carries NO marker (the measured
    // live failure); the second sentence cites [1]. Coverage 0.5 -> repair.
    const adapter = scriptedAdapter([
      'C. Joseph Vijay is the current Chief Minister of Tamil Nadu.\nHe assumed office in May 2026 [1].',
      // Repair pass: the headline claim is now tied to evidence [1].
      'C. Joseph Vijay is the current Chief Minister of Tamil Nadu [1].\nHe assumed office in May 2026 [1].',
    ])
    const events: OrchestrationEvent[] = []
    const r = await orchestrateTurn({
      ...BASE,
      userMessage: CM_QUESTION,
      adapter,
      onEvent: (e) => events.push(e),
    })

    // The repair really ran as a second solve pass and was adopted.
    expect(adapter.calls).toBe(2)
    expect(r.metadata.timings?.repairMs).toBeDefined()
    expect(r.metadata.degraded.some((d) => d.includes('repaired'))).toBe(true)

    // The persisted answer now carries the citation on the headline claim.
    expect(r.content).toContain('Chief Minister of Tamil Nadu [1]')

    // Full coverage -> honest VERIFIED state (evidence genuinely supports it).
    expect(r.metadata.states).toContain('VERIFIED_FROM_SOURCES')
    expect(r.metadata.states).not.toContain('PARTIALLY_VERIFIED')

    // The streamed draft was replaced (reset) exactly once — never appended.
    expect(events.filter((e) => e.type === 'reset')).toHaveLength(1)
  })

  test('does not repair an answer that already ties its claims to evidence', async () => {
    const adapter = scriptedAdapter([
      'C. Joseph Vijay is the current Chief Minister of Tamil Nadu [1].\nHe assumed office in May 2026 [1].',
    ])
    const r = await orchestrateTurn({ ...BASE, userMessage: CM_QUESTION, adapter })

    expect(adapter.calls).toBe(1)
    expect(r.metadata.timings?.repairMs).toBeUndefined()
    expect(r.metadata.states).toContain('VERIFIED_FROM_SOURCES')
  })

  test('keeps the original answer and the honest note when repair does not improve grounding', async () => {
    // Repair reply strips ALL markers — coverage would DROP (1.0 -> 0.5 for
    // the second sentence... strictly: uncovered grows). The orchestrator
    // must keep the original draft, keep the audit results consistent with
    // it, and say the repair failed.
    const original =
      'C. Joseph Vijay is the current Chief Minister of Tamil Nadu.\nHe assumed office in May 2026 [1].'
    const adapter = scriptedAdapter([original, 'Joseph Vijay is the Chief Minister. He took charge in May 2026.'])
    const r = await orchestrateTurn({ ...BASE, userMessage: CM_QUESTION, adapter })

    expect(adapter.calls).toBe(2) // repair ran...
    expect(r.metadata.degraded.some((d) => d.includes('did not improve grounding'))).toBe(true)
    // ...but the ORIGINAL (post-processed) answer is what ships.
    expect(r.content).toBe(original)
    // Coverage still weak -> honest PARTIAL, never upgraded to VERIFIED.
    expect(r.metadata.states).toContain('PARTIALLY_VERIFIED')
    expect(r.metadata.states).not.toContain('VERIFIED_FROM_SOURCES')
    expect(r.metadata.verificationNote).toBeTruthy()
  })

  test('never repairs turns without retrieved evidence (greeting)', async () => {
    const adapter = scriptedAdapter(["Hi! I'm RIISHE, your AI assistant from BEAN Intelligence. How can I help you today?"])
    const r = await orchestrateTurn({ ...BASE, userMessage: 'Hi', adapter })

    expect(adapter.calls).toBe(1)
    expect(r.searchRan).toBe(false)
    expect(r.metadata.timings?.repairMs).toBeUndefined()
    expect(r.metadata.states).toEqual(['UNVERIFIED'])
  })
})

describe('in-flight retrieval dedup', () => {
  test('identical concurrent searches share ONE provider call', async () => {
    searchCalls.length = 0
    const [a, b] = await Promise.all([
      runSharedSearch('shared concurrent query', { num: 6 }),
      runSharedSearch('shared concurrent query', { num: 6 }),
    ])
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
    expect(searchCalls.filter((q) => q === 'shared concurrent query')).toHaveLength(1)

    // After settlement a new call is a real call again (no permanent pinning).
    await runSharedSearch('shared concurrent query', { num: 6 })
    expect(searchCalls.filter((q) => q === 'shared concurrent query')).toHaveLength(2)
  })
})
