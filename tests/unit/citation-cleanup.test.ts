/**
 * Unit tests for the citation-cleanup and verification-status work:
 *  - duplicate-sentence removal (deterministic, code-safe)
 *  - the false-"Partially verified" fix (final-content citation integrity)
 *  - honest incomplete verification (visible, never dropped)
 *  - date-conflict grounding (material, triggers bounded regeneration)
 *  - per-source "supports" derivation from the actual claim check
 *
 * Run: bun test tests/unit/citation-cleanup.test.ts
 */
import {mock, describe, test, expect } from 'bun:test'
import { removeDuplicateSentences } from '../../src/lib/riishe/dedupe'
import { orchestrateTurn } from '../../src/lib/riishe/orchestrator'
import { buildSourceSupports, unverifiedBackgroundClaims } from '../../src/lib/verify/claims'
import type { TaskAdapter, ChatRequest, ChatResult, ChatTurn, HealthReport } from '../../src/lib/adapters/types'
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


// ---------------------------------------------------------------------------
// 1. Duplicate-sentence removal
// ---------------------------------------------------------------------------

describe('removeDuplicateSentences', () => {
  test('removes an exact repeated sentence, keeping the first', () => {
    const in_ = 'M.K. Stalin is the Chief Minister. He leads the DMK. M.K. Stalin is the Chief Minister.'
    const out = removeDuplicateSentences(in_)
    expect(out.removed).toBe(1)
    expect(out.text).toBe('M.K. Stalin is the Chief Minister. He leads the DMK.')
  })

  test('normalization: case, list markers, quotes and trailing punctuation match', () => {
    const in_ = '- Stalin is the Chief Minister\nHe was sworn in on May 7, 2021.\n"Stalin is the Chief Minister."'
    const out = removeDuplicateSentences(in_)
    expect(out.removed).toBe(1)
    expect(out.text).not.toContain('"Stalin')
  })

  test('fenced code blocks are never touched', () => {
    const in_ = 'Answer below.\n```js\nconst a = 1; const a = 1;\n```\nDone.'
    const out = removeDuplicateSentences(in_)
    expect(out.text).toContain('const a = 1; const a = 1;')
    expect(out.removed).toBe(0)
  })

  test('short fragments and list numbering are never corrupted', () => {
    const in_ = '1. First step\n2. First step\n3. Second step'
    const out = removeDuplicateSentences(in_)
    expect(out.text).toBe('1. First step\n2. First step\n3. Second step')
    expect(out.removed).toBe(0)
  })

  test('an answer with no duplicates passes through unchanged', () => {
    const in_ = 'One fact. Another fact. A third fact.'
    const out = removeDuplicateSentences(in_)
    expect(out.removed).toBe(0)
    expect(out.text).toBe(in_)
  })
})

// ---------------------------------------------------------------------------
// 2. Orchestrator wiring (real orchestrator, stubbed network)
// ---------------------------------------------------------------------------

function stubAdapter(responses: string[], calls: { count: number; prompts: ChatTurn[][] }): TaskAdapter {
  const health: HealthReport = { healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'stub' }
  let i = 0
  const next = (): string => {
    calls.count += 1
    i += 1
    return responses[Math.min(i - 1, responses.length - 1)]
  }
  return {
    backendId: 'stub',
    health: async () => health,
    chat: async (req: ChatRequest): Promise<ChatResult> => {
      calls.prompts.push(req.messages)
      return { content: next(), tokensInEst: 1, tokensOutEst: 1, durationMs: 1 }
    },
    chatStream: async function* (req: ChatRequest): AsyncGenerator<string, void, unknown> {
      calls.prompts.push(req.messages)
      const content = next()
      yield content.slice(0, Math.ceil(content.length / 2))
      yield content.slice(Math.ceil(content.length / 2))
    },
  }
}

function packOf(sources: EvidencePack['sources']): EvidencePack {
  return {
    sources,
    queries: ['q'],
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
}

const caps = { maxPromptChars: 100_000, maxHistoryMessages: 10 }
const TN_SOURCE = {
  id: 1, url: 'https://www.tn.gov.in/council', title: 'Council of Ministers',
  snippet: 'The Chief Minister of Tamil Nadu is M.K. Stalin, in office since May 7, 2021.',
  hostName: 'tn.gov.in', date: 'May 10, 2026', freshness: 0.5, year: 2026,
  authority: 1, official: true, score: 0.9, social: false, sourceType: 'other',
  pageRead: true,
  excerpt: 'The Chief Minister of Tamil Nadu is M.K. Stalin, in office since May 7, 2021.',
} as EvidencePack['sources'][number]

/**
 * MEASURED CONTRACT (2026-10-29): the orchestrator's verification is the
 * DETERMINISTIC audit stack (citation integrity, uncited-statement support,
 * duplicate-sentence hygiene, name grounding) — there is no LLM claim-check
 * call wired into the turn path (verify/claims.ts exports the transport-side
 * helpers, but orchestrateTurn never invokes them). These tests pin the real
 * deterministic behavior with research injected through the hooks.runResearch
 * seam — hermetic, no network, matching what production serves.
 */
describe('orchestrator: verification-status honesty (deterministic, hermetic via hooks)', () => {
  test('a dangling citation marker is stripped and visibly degrades verification', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    // The draft cites [1] (real) AND [9] (dangling). The served answer keeps
    // only the resolvable marker, and the deterministic audit says exactly
    // what happened: unresolved references were removed and the turn is NOT
    // fully verified (the model hallucinated a citation).
    const draft =
      'M.K. Stalin is the current Chief Minister of Tamil Nadu [1], taking office in May 2021 [9]. ' +
      'The DMK leads the state government [1].'
    const adapter = stubAdapter([draft], calls)
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      hooks: { runResearch: async () => packOf([TN_SOURCE]) },
    })
    expect(result.content).not.toContain('[9]')
    expect(result.content).toContain('[1]')
    const integrity = result.metadata.verification.find((v) => v.check === 'citation integrity')
    expect(integrity?.status).toBe('failed')
    expect(result.metadata.states).toContain('PARTIALLY_VERIFIED')
    expect(result.metadata.states).not.toContain('VERIFIED_FROM_SOURCES')
  })

  test('duplicate sentences in a draft are removed before verification and persistence', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const draft =
      'M.K. Stalin is the Chief Minister of Tamil Nadu [1]. The DMK governs the state [1]. ' +
      'M.K. Stalin is the Chief Minister of Tamil Nadu [1].'
    const adapter = stubAdapter([draft], calls)
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      hooks: { runResearch: async () => packOf([TN_SOURCE]) },
    })
    expect(result.metadata.degraded.join(' ')).toContain('duplicate sentence')
    expect(result.content.match(/M\.K\. Stalin is the Chief Minister of Tamil Nadu/g)).toHaveLength(1)
    expect(result.metadata.states).toContain('VERIFIED_FROM_SOURCES')
  })

  test('an uncited material statement is flagged, never silently verified', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const draft = 'M.K. Stalin is the Chief Minister of Tamil Nadu [1]. The DMK won 2021 elections.'
    const adapter = stubAdapter([draft], calls)
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      hooks: { runResearch: async () => packOf([TN_SOURCE]) },
    })
    expect(result.metadata.states).toContain('PARTIALLY_VERIFIED')
    expect(result.metadata.states).not.toContain('VERIFIED_FROM_SOURCES')
    expect(result.metadata.verificationNote ?? '').toContain('not supported by the retrieved sources')
  })

  test('a clean draft makes exactly ONE solve call (no repair pass, no extra model load)', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const draft = 'Joseph Vijay is the Chief Minister of Tamil Nadu [1].'
    const adapter = stubAdapter([draft], calls)
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      hooks: { runResearch: async () => packOf([TN_SOURCE]) },
    })
    expect(calls.count).toBe(1)
    expect(result.metadata.states).toContain('VERIFIED_FROM_SOURCES')
  })

  test('material grounding problems trigger exactly ONE bounded repair pass', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const draft = 'M.K. Stalin is the Chief Minister of Tamil Nadu [1]. The DMK won 2021 elections.'
    const adapter = stubAdapter([draft], calls)
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      hooks: { runResearch: async () => packOf([TN_SOURCE]) },
    })
    // 1 solve + at most 1 repair — never an unbounded loop.
    expect(calls.count).toBe(2)
    expect(result.metadata.degraded.join(' ')).toContain('claim-repair pass')
  })

  test('source metadata carries the real measured evidence fields only', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const draft = 'M.K. Stalin is the current Chief Minister of Tamil Nadu [1], leading the DMK government since 2021 [1].'
    const adapter = stubAdapter([draft], calls)
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      hooks: { runResearch: async () => packOf([TN_SOURCE]) },
    })
    const s = result.metadata.sources[0]
    expect(s).toMatchObject({
      id: 1,
      url: 'https://www.tn.gov.in/council',
      hostName: 'tn.gov.in',
      official: true,
      pageRead: true,
    })
  })

  test('a streamed turn with a repair pass re-emits the final answer after a reset', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const draft = 'M.K. Stalin is the Chief Minister of Tamil Nadu [1]. The DMK won 2021 elections.'
    const adapter = stubAdapter([draft], calls)
    const events: Array<{ type: string; delta?: string }> = []
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      onEvent: (e) => events.push(e as { type: string; delta?: string }),
      hooks: { runResearch: async () => packOf([TN_SOURCE]) },
    })
    const deltas = events.filter((e) => e.type === 'delta')
    const resets = events.filter((e) => e.type === 'reset')
    // The draft streamed first, the repair pass ran, and the wire protocol
    // holds: a reset ALWAYS precedes the re-emitted content, and the last
    // emission is exactly the served answer (never a mix of draft + repair).
    expect(deltas.length).toBeGreaterThanOrEqual(2)
    expect(resets.length).toBeGreaterThanOrEqual(1)
    const lastReset = events.map((e) => e.type).lastIndexOf('reset')
    const afterReset = events.slice(lastReset + 1).filter((e) => e.type === 'delta')
    expect(afterReset.map((e) => e.delta ?? '').join('')).toBe(result.content)
  })
})

// ---------------------------------------------------------------------------
// 3. Supports / background-gap helpers
// ---------------------------------------------------------------------------

describe('claim-support helpers', () => {
  test('buildSourceSupports maps each evidence id to the first supported claim', () => {
    const map = buildSourceSupports({
      ran: true,
      claims: [
        { text: 'Claim A', changing: true, verdict: 'supported', evidenceIds: [2, 1] },
        { text: 'Claim B', changing: false, verdict: 'supported', evidenceIds: [1] },
        { text: 'Claim C', changing: true, verdict: 'contradicted', evidenceIds: [3] },
      ],
      degraded: [],
    })
    expect(map.get(2)).toBe('Claim A')
    expect(map.get(1)).toBe('Claim A') // first supported claim wins
    expect(map.has(3)).toBe(false)
    expect(buildSourceSupports(null).size).toBe(0)
  })

  test('unverifiedBackgroundClaims: stable unsupported claims only (not changing, not date-conflicts)', () => {
    const bg = unverifiedBackgroundClaims({
      ran: true,
      claims: [
        { text: 'Chennai is a large city', changing: false, verdict: 'unsupported', evidenceIds: [] },
        { text: 'X won the election', changing: true, verdict: 'unsupported', evidenceIds: [] },
        { text: 'Dated background', changing: false, verdict: 'unsupported', evidenceIds: [], dateConflict: true },
        { text: 'Supported fact', changing: false, verdict: 'supported', evidenceIds: [1] },
      ],
      degraded: [],
    })
    expect(bg).toHaveLength(1)
    expect(bg[0].text).toBe('Chennai is a large city')
  })
})
