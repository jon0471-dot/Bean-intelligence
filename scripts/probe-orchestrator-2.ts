/** Probe 2: what does the deterministic audit flag reliably? */
import type { TaskAdapter, ChatRequest, ChatResult, ChatTurn, HealthReport } from '../src/lib/adapters/types'
import type { EvidencePack, EvidenceSource } from '../src/lib/research/pipeline'

function stubAdapter(responses: string[], calls: { count: number }) {
  const health: HealthReport = { healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'stub' }
  const at = (n: number) => responses[Math.min(n, responses.length - 1)]
  let i = 0
  return {
    backendId: 'stub',
    health: async () => health,
    chat: async (req: ChatRequest): Promise<ChatResult> => {
      calls.count += 1
      i += 1
      return { content: at(i - 1), tokensInEst: 1, tokensOutEst: 1, durationMs: 1 }
    },
    chatStream: async function* (req: ChatRequest): AsyncGenerator<string, void, unknown> {
      calls.count += 1
      i += 1
      const content = at(i - 1)
      yield content.slice(0, Math.ceil(content.length / 2))
      yield content.slice(Math.ceil(content.length / 2))
    },
  } as TaskAdapter
}

function packOf(sources: EvidenceSource[]): EvidencePack {
  return { sources, queries: ['q'], degraded: [], staleness: null, geoWarning: null, durationMs: 1, searchMs: 1, pageReadMs: 0, searchCalls: 1, pageReadCalls: 0, cacheHits: 0, fetchedAt: new Date().toISOString() }
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

async function run(name: string, responses: string[], userMessage = 'Who is the Chief Minister of Tamil Nadu?') {
  const calls = { count: 0 }
  const result = await orchestrateTurn({
    userMessage,
    history: [],
    caps,
    adapter: stubAdapter(responses, calls),
    backendCapabilities: ['research'],
    hooks: { runResearch: async () => packOf([TN_SOURCE]) },
  } as never)
  console.log(`\n===== ${name} =====`)
  console.log('content:', JSON.stringify(result.content.slice(0, 160)))
  console.log('calls:', calls.count)
  console.log('states:', result.metadata.states)
  console.log('degraded:', JSON.stringify(result.metadata.degraded))
  console.log('verification:', JSON.stringify(result.metadata.verification))
  console.log('note:', result.metadata.verificationNote ?? null)
}

// A: unsupported changing fact, no name overlap with evidence
await run('unsupported: capital of Australia claim', [
  'M.K. Stalin is the Chief Minister of Tamil Nadu [1]. The capital of Australia is Canberra [1].',
])

// B: contradicted proper name (real person not in evidence)
await run('contradicted: Joseph Vijay claimed as CM', [
  'Joseph Vijay is the Chief Minister of Tamil Nadu [1].',
], 'Who is the Chief Minister of Tamil Nadu and when did he take office?')

// C: same but with year conflict vs evidence (2026 vs 2021), repair adoption check
await run('contradicted name + year, repair adoption check', [
  'Joseph Vijay is the Chief Minister of Tamil Nadu [1]. He took office in May 2026 [1].',
  'M.K. Stalin is the Chief Minister of Tamil Nadu [1]. He took office in May 2021 [1].',
], 'Who is the Chief Minister of Tamil Nadu and when did he take office?')

// D: uncited material sentence (no citation markers at all)
await run('uncited claim sentence', [
  'M.K. Stalin is the Chief Minister of Tamil Nadu [1]. The DMK won 2021 elections.',
])
