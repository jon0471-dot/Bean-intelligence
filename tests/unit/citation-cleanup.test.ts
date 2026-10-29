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
import { describe, test, expect } from 'bun:test'
import { removeDuplicateSentences } from '../../src/lib/riishe/dedupe'
import { orchestrateTurn } from '../../src/lib/riishe/orchestrator'
import { buildSourceSupports, unverifiedBackgroundClaims } from '../../src/lib/verify/claims'
import type { TaskAdapter, ChatRequest, ChatResult, ChatTurn, HealthReport } from '../../src/lib/adapters/types'
import type { EvidencePack } from '../../src/lib/research/pipeline'

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
  return { sources, queries: ['q'], degraded: [], staleness: null, durationMs: 1 }
}

const caps = { maxPromptChars: 100_000, maxHistoryMessages: 10 }
const TN_SOURCE = {
  id: 1, url: 'https://www.tn.gov.in/council', title: 'Council of Ministers',
  snippet: 'The Chief Minister of Tamil Nadu is M.K. Stalin, in office since May 7, 2021.',
  hostName: 'tn.gov.in', date: 'May 10, 2026', freshness: 0.5, year: 2026,
  authority: 1, official: true, score: 0.9, pageRead: true,
  excerpt: 'The Chief Minister of Tamil Nadu is M.K. Stalin, in office since May 7, 2021.',
} as EvidencePack['sources'][number]

describe('orchestrator: verification-status honesty (stubs, no network)', () => {
  test('a stripped dangling marker no longer forces PARTIALLY_VERIFIED (the proven false-partial)', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    // The draft cites [1] (real) AND [9] (dangling). Old logic permanently
    // marked citationsValid=false after stripping -> false "Partially verified".
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
      searchMode: 'on',
      hooks: {
        runResearch: async () => packOf([TN_SOURCE]),
        checkClaims: async () =>
          JSON.stringify({
            claims: [{ text: 'M.K. Stalin is the current Chief Minister of Tamil Nadu', changing: true, verdict: 'supported', evidenceIds: [1], dateConflict: false }],
          }),
      },
    })
    expect(result.content).not.toContain('[9]')
    expect(result.content).toContain('[1]')
    expect(result.metadata.degraded.join(' ')).toContain('citation marker')
    expect(result.metadata.states).toContain('VERIFIED_FROM_SOURCES')
    expect(result.metadata.states).not.toContain('PARTIALLY_VERIFIED')
  })

  test('verification incomplete (claim check degraded) is a visible PARTIAL with the exact gap', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const draft = 'M.K. Stalin is the current Chief Minister of Tamil Nadu [1], and the DMK governs the state [1].'
    const adapter = stubAdapter([draft], calls)
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      searchMode: 'on',
      hooks: {
        runResearch: async () => packOf([TN_SOURCE]),
        checkClaims: async () => {
          throw new Error('gateway 429')
        },
      },
    })
    expect(result.metadata.states).toContain('PARTIALLY_VERIFIED')
    expect(result.metadata.states).not.toContain('VERIFIED_FROM_SOURCES')
    const incomplete = result.metadata.verification.filter((v) => v.status === 'incomplete')
    expect(incomplete.length).toBeGreaterThanOrEqual(1)
    expect(incomplete[0].detail).toContain('could not be independently re-checked')
    expect(result.metadata.grounding).toMatchObject({ checked: false, passed: false })
  })

  test('a date conflict triggers the bounded regeneration and the corrected answer is served', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const draft =
      'M.K. Stalin is the Chief Minister of Tamil Nadu [1]. He took office in May 2026 [1], leading the DMK government.'
    const corrected =
      'M.K. Stalin is the Chief Minister of Tamil Nadu [1]. He took office in May 2021 and leads the DMK government.'
    const adapter = stubAdapter([draft, corrected], calls)
    let checkPass = 0
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu and when did he take office?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      searchMode: 'on',
      hooks: {
        runResearch: async () => packOf([TN_SOURCE]),
        checkClaims: async () => {
          checkPass += 1
          if (checkPass === 1) {
            return JSON.stringify({
              claims: [
                { text: 'Stalin is the Chief Minister', changing: true, verdict: 'supported', evidenceIds: [1], dateConflict: false },
                { text: 'He took office in May 2026', changing: true, verdict: 'supported', evidenceIds: [1], dateConflict: true, note: 'evidence says May 7, 2021' },
              ],
            })
          }
          return JSON.stringify({
            claims: [{ text: 'He took office in May 2021', changing: true, verdict: 'supported', evidenceIds: [1], dateConflict: false }],
          })
        },
      },
    })
    expect(calls.count).toBe(2) // exactly ONE bounded regeneration
    expect(result.content).toContain('May 2021')
    expect(result.metadata.grounding).toMatchObject({ checked: true, regenerated: true, passed: true })
    expect(result.metadata.states).toContain('VERIFIED_FROM_SOURCES')
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
      searchMode: 'on',
      hooks: {
        runResearch: async () => packOf([TN_SOURCE]),
        checkClaims: async () =>
          JSON.stringify({
            claims: [{ text: 'Stalin is the Chief Minister', changing: true, verdict: 'supported', evidenceIds: [1], dateConflict: false }],
          }),
      },
    })
    expect(result.metadata.degraded.join(' ')).toContain('duplicate sentence')
    expect(result.content.match(/M\.K\. Stalin is the Chief Minister of Tamil Nadu/g)).toHaveLength(1)
    expect(result.metadata.states).toContain('VERIFIED_FROM_SOURCES')
  })

  test('sources carry the verified claim they support (from the actual claim check)', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const draft = 'M.K. Stalin is the current Chief Minister of Tamil Nadu [1], leading the DMK government since 2021 [1].'
    const adapter = stubAdapter([draft], calls)
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      searchMode: 'on',
      hooks: {
        runResearch: async () => packOf([TN_SOURCE]),
        checkClaims: async () =>
          JSON.stringify({
            claims: [{ text: 'M.K. Stalin is the current Chief Minister', changing: true, verdict: 'supported', evidenceIds: [1], dateConflict: false }],
          }),
      },
    })
    expect(result.metadata.sources[0]?.supports).toBe('M.K. Stalin is the current Chief Minister')
    expect(result.metadata.sources[0]?.cited).toBe(true)
  })

  test('a contradictory draft that stays contradicted after regeneration is never verified', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const adapter = stubAdapter(
      [
        'Draft claiming X is the current Chief Minister of Tamil Nadu, sworn in during 2026 [1]. The DMK governs [1].',
        'Still claiming X is the current Chief Minister of Tamil Nadu without support [1]. The DMK governs [1].',
      ],
      calls,
    )
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      searchMode: 'on',
      hooks: {
        runResearch: async () => packOf([TN_SOURCE]),
        checkClaims: async () =>
          JSON.stringify({
            claims: [{ text: 'X is the Chief Minister', changing: true, verdict: 'contradicted', evidenceIds: [1], note: 'evidence states Stalin' }],
          }),
      },
    })
    expect(calls.count).toBe(2)
    expect(result.metadata.states).not.toContain('VERIFIED_FROM_SOURCES')
    expect(result.metadata.states).toContain('PARTIALLY_VERIFIED')
    const failed = result.metadata.verification.filter((v) => v.check === 'claim grounding' && v.status === 'failed')
    expect(failed.length).toBeGreaterThanOrEqual(1)
  })

  test('buffered re-emission after a verification rewrite sends reset before the corrected delta', async () => {
    const calls = { count: 0, prompts: [] as ChatTurn[][] }
    const draft = 'Draft claiming X is the current Chief Minister of Tamil Nadu, sworn in during 2026 [1]. The DMK governs [1].'
    const corrected = 'M.K. Stalin is the current Chief Minister of Tamil Nadu [1]. The DMK governs the state [1].'
    const adapter = stubAdapter([draft, corrected], calls)
    const events: Array<{ type: string; delta?: string }> = []
    const result = await orchestrateTurn({
      userMessage: 'Who is the Chief Minister of Tamil Nadu?',
      history: [],
      caps,
      adapter,
      backendCapabilities: ['research'],
      searchMode: 'on',
      onEvent: (e) => events.push(e as { type: string; delta?: string }),
      hooks: {
        runResearch: async () => packOf([TN_SOURCE]),
        checkClaims: async () => {
          // First check: draft is contradicted; after regeneration: clean.
          return calls.count === 1
            ? JSON.stringify({ claims: [{ text: 'X is the Chief Minister', changing: true, verdict: 'contradicted', evidenceIds: [1] }] })
            : JSON.stringify({ claims: [{ text: 'Stalin is the Chief Minister', changing: true, verdict: 'supported', evidenceIds: [1] }] })
        },
      },
    })
    const deltas = events.filter((e) => e.type === 'delta')
    const resets = events.filter((e) => e.type === 'reset')
    expect(deltas.length).toBe(2)
    expect(resets.length).toBe(1)
    // The reset must come BETWEEN the draft delta and the corrected delta.
    const draftIdx = events.findIndex((e) => e.type === 'delta' && e.delta === draft)
    const resetIdx = events.findIndex((e) => e.type === 'reset')
    const correctedIdx = events.findIndex((e) => e.type === 'delta' && e.delta === corrected)
    expect(draftIdx).toBeGreaterThanOrEqual(0)
    expect(correctedIdx).toBeGreaterThan(resetIdx)
    expect(resetIdx).toBeGreaterThan(draftIdx)
    expect(result.content).toBe(corrected)
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
