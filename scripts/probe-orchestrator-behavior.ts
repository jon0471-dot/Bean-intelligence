/**
 * Probe: actual orchestrator deterministic behavior with hooks.runResearch.
 * Used to pin citation-cleanup orchestrator tests to REAL behavior.
 */
import type { TaskAdapter, ChatRequest, ChatResult, ChatTurn, HealthReport } from '../src/lib/adapters/types'
import type { EvidencePack, EvidenceSource } from '../src/lib/research/pipeline'

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

function packOf(sources: EvidenceSource[]): EvidencePack {
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
  authority: 1, official: true, score: 0.9, social: false, sourceType: 'web',
  pageRead: true,
  excerpt: 'The Chief Minister of Tamil Nadu is M.K. Stalin, in office since May 7, 2021.',
} as unknown as EvidenceSource

const { orchestrateTurn } = await import('../src/lib/riishe/orchestrator')

async function run(name: string, opts: Record<string, unknown>) {
  const calls = { count: 0, prompts: [] as ChatTurn[][] }
  const events: Array<{ type: string; delta?: string }> = []
  const result = await orchestrateTurn({
    userMessage: 'Who is the Chief Minister of Tamil Nadu?',
    history: [],
    caps,
    adapter: stubAdapter((opts.responses ?? ['draft']) as string[], calls),
    backendCapabilities: ['research'],
    hooks: { runResearch: async () => packOf([TN_SOURCE]) },
    onEvent: (e) => events.push(e as { type: string; delta?: string }),
    ...opts,
  } as never)
  console.log(`\n===== ${name} =====`)
  console.log('content:', JSON.stringify(result.content))
  console.log('calls:', calls.count)
  console.log('states:', result.metadata.states)
  console.log('degraded:', JSON.stringify(result.metadata.degraded))
  console.log('verification:', JSON.stringify(result.metadata.verification))
  console.log('sources:', JSON.stringify(result.metadata.sources))
  console.log('verificationNote:', result.metadata.verificationNote ?? null)
  console.log('events:', JSON.stringify(events.map((e) => ({ t: e.type, d: e.delta?.slice(0, 30) }))))
  return result
}

// 1. dangling marker
await run('dangling [9] stripped, [1] valid', {
  responses: ['M.K. Stalin is the current Chief Minister of Tamil Nadu [1], taking office in May 2021 [9]. The DMK leads the state government [1].'],
})

// 2. duplicate sentences
await run('duplicate sentences removed', {
  responses: ['M.K. Stalin is the Chief Minister of Tamil Nadu [1]. The DMK governs the state [1]. M.K. Stalin is the Chief Minister of Tamil Nadu [1].'],
})

// 3. date conflict -> regeneration?
await run('date conflict (draft says May 2026, evidence May 2021)', {
  userMessage: 'Who is the Chief Minister of Tamil Nadu and when did he take office?',
  responses: [
    'M.K. Stalin is the Chief Minister of Tamil Nadu [1]. He took office in May 2026 [1], leading the DMK government.',
    'M.K. Stalin is the Chief Minister of Tamil Nadu [1]. He took office in May 2021 and leads the DMK government.',
  ],
})

// 4. contradictory claim (deterministic audit)
await run('draft contradicts evidence name (deterministic audit)', {
  responses: ['Draft claiming X is the current Chief Minister of Tamil Nadu, sworn in during 2026 [1]. The DMK governs [1].'],
})

// 5. plain supported draft
await run('clean supported draft', {
  responses: ['M.K. Stalin is the current Chief Minister of Tamil Nadu [1], leading the DMK government since 2021 [1].'],
})

// 6. buffered reset protocol on streaming with tool draft
await run('math turn with TOOL_CALL draft', {
  userMessage: 'What is 346 divided by 2?',
  responses: ['TOOL_CALL calculate {"expression":"173*2"}', 'The result is 346.'],
})
