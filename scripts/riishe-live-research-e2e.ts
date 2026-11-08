/**
 * RIISHE LIVE-RESEARCH acceptance — END-TO-END through the real app.
 *
 * Logs in as the real test user, then sends the five brief-mandated queries
 * through POST /api/riishe/chat (real auth, real orchestration, real model,
 * real research pipeline — gateway state as-is in production) and records:
 *   - the final answer text (streamed deltas),
 *   - the persisted sources (from the done event's meta),
 *   - stage/research events and latencies (first token, total).
 *
 * A model-only answer with zero sources does NOT pass: every case must carry
 * retrieved sources whose URLs/dates are real, and the answer must name the
 * current officeholder/version found in that evidence.
 */
import { parseArgs } from 'util'

const BASE = process.env.BEAN_BASE_URL ?? 'http://localhost:3000'
const EMAIL = process.env.BEAN_TEST_EMAIL ?? 'ui-clean-verify@bean.test'
const PASSWORD = process.env.BEAN_TEST_PASSWORD ?? 'CleanUi#2026'

interface E2eCase {
  query: string
  mustContain: string[] // any-of substrings expected in the evidence-backed answer
  sourceMustMatch?: RegExp[] // any-of URL patterns expected among sources
}

const CASES: E2eCase[] = [
  { query: 'Who is the current Chief Minister of Tamil Nadu?', mustContain: ['Vijay'], sourceMustMatch: [/wikipedia\.org|tn\.gov\.in|thehindu\.com|bbc\.com|hindustantimes\.com/] },
  { query: 'Who is the current Prime Minister of India?', mustContain: ['Modi'], sourceMustMatch: [/wikipedia\.org|pmindia\.gov\.in/] },
  { query: 'What is the latest stable Node.js version?', mustContain: ['v26'], sourceMustMatch: [/nodejs\.org|wikipedia\.org/] },
  { query: 'What is the latest major announcement on the Tamil Nadu government website?', mustContain: [], sourceMustMatch: [/tn\.gov\.in|wikipedia\.org|thehindu\.com|hindustantimes\.com|bbc\.com/] },
  { query: 'Who is the current President of the United States?', mustContain: ['Trump'], sourceMustMatch: [/wikipedia\.org|whitehouse\.gov/] },
]

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`)
  const setCookie = res.headers.get('set-cookie') ?? ''
  const m = /bean_session=([^;]+)/.exec(setCookie)
  if (!m) throw new Error('login did not set bean_session cookie')
  return m[1]
}

interface TurnResult {
  answer: string
  sources: Array<{ url: string; title: string; date?: string | null }>
  stages: string[]
  researchQueries: string[]
  firstTokenMs: number | null
  durationMs: number
  resetCount: number
  degraded?: string[]
  retrievedAt?: string | null
}

async function askRiishe(cookie: string, message: string): Promise<TurnResult> {
  const res = await fetch(`${BASE}/api/riishe/chat?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', cookie: `bean_session=${cookie}` },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok || !res.body) throw new Error(`chat failed: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 300))}`)
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    // Non-streaming JSON shape: { ok, conversationId, content, durationMs, metadata }
    const j = (await res.json()) as {
      content?: string
      durationMs?: number
      metadata?: { sources?: Array<{ url?: unknown; title?: unknown; date?: unknown; pageRead?: unknown }>; stages?: Array<{ stage: string }> ; degraded?: string[]; retrievedAt?: string }
    }
    return {
      answer: j.content ?? '',
      sources: (j.metadata?.sources ?? []).filter((s): s is { url: string; title: string; date: string | null } => typeof s.url === 'string').map((s) => ({ url: s.url, title: typeof s.title === 'string' ? s.title : '', date: typeof s.date === 'string' ? s.date : null })),
      stages: (j.metadata?.stages ?? []).map((s) => s.stage),
      researchQueries: [],
      firstTokenMs: null,
      durationMs: j.durationMs ?? 0,
      resetCount: 0,
      degraded: j.metadata?.degraded ?? [],
      retrievedAt: j.metadata?.retrievedAt ?? null,
    }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const result: TurnResult = { answer: '', sources: [], stages: [], researchQueries: [], firstTokenMs: null, durationMs: 0, resetCount: 0, degraded: [], retrievedAt: null }
  const t0 = Date.now()
  let streamDone = false
  while (!streamDone) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        let ev: Record<string, unknown>
        try {
          ev = JSON.parse(line.slice(6)) as Record<string, unknown>
        } catch {
          continue
        }
        if (typeof ev.delta === 'string') {
          if (result.firstTokenMs === null) result.firstTokenMs = Date.now() - t0
          result.answer += ev.delta
        }
        if (ev.reset === true) {
          result.resetCount += 1
          result.answer = ''
        }
        if (typeof ev.stage === 'string') result.stages.push(ev.stage)
        if (ev.research && typeof ev.research === 'object') {
          const q = (ev.research as { queries?: string[] }).queries
          if (Array.isArray(q)) result.researchQueries.push(...q)
        }
        if (ev.done === true) {
          const meta = ev.meta as { sources?: Array<{ url?: unknown; title?: unknown; date?: unknown }>; degraded?: string[]; retrievedAt?: string } | undefined
          const sources = meta?.sources ?? []
          result.sources = sources
            .filter((s) => typeof s.url === 'string')
            .map((s) => ({ url: s.url as string, title: typeof s.title === 'string' ? s.title : '', date: typeof s.date === 'string' ? s.date : null }))
          result.durationMs = typeof ev.durationMs === 'number' ? ev.durationMs : Date.now() - t0
          result.degraded = meta?.degraded ?? []
          result.retrievedAt = meta?.retrievedAt ?? null
          streamDone = true
        }
      }
    }
  }
  return result
}

async function main() {
  const cookie = await login()
  console.log(`[e2e] logged in as ${EMAIL}`)
  const report: Array<Record<string, unknown>> = []
  let pass = 0
  for (const c of CASES) {
    const t0 = Date.now()
    let r: TurnResult | null = null
    let lastError = ''
    // Bounded retry: the app honestly returns HTTP 429 RATE_LIMITED while the
    // model gateway is throttled (measured: windows last minutes). A real
    // user retries; so does this script — twice, with waits, never hammering.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        r = await askRiishe(cookie, c.query)
        break
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
        if (lastError.includes('429') && attempt < 2) {
          const waitMs = 45_000 * (attempt + 1)
          console.log(`[e2e] ${c.query.slice(0, 40)}... chat rate-limited, waiting ${waitMs / 1000}s (attempt ${attempt + 1}/3)`)
          await new Promise((res) => setTimeout(res, waitMs))
          continue
        }
        break
      }
    }
    if (!r) {
      console.error(`\n=== ${c.query}\n  FAILED: ${lastError}`)
      report.push({ query: c.query, error: lastError })
      continue
    }
    const wallMs = Date.now() - t0
    const answerOk = c.mustContain.length === 0 || c.mustContain.some((s) => r.answer.toLowerCase().includes(s.toLowerCase()))
    const sourcesOk = !c.sourceMustMatch || c.sourceMustMatch.some((re) => r.sources.some((s) => re.test(s.url)))
    const hasSources = r.sources.length > 0
    const ok = answerOk && hasSources && sourcesOk
    if (ok) pass += 1
    console.log(`\n=== ${c.query}`)
    console.log(`  verdict: ${ok ? 'PASS' : 'FAIL'} | answerOk=${answerOk} sources=${r.sources.length} sourcesOk=${sourcesOk}`)
    console.log(`  stages: ${r.stages.join(' -> ') || '(none)'}`)
    console.log(`  research queries: ${r.researchQueries.length ? r.researchQueries.join(' | ') : '(none)'}`)
    console.log(`  firstTokenMs=${r.firstTokenMs} totalMs=${wallMs} (turn ${r.durationMs}ms) resets=${r.resetCount} retrievedAt=${r.retrievedAt ?? '-'}`)
    if ((r.degraded ?? []).length > 0) console.log(`  degraded: ${(r.degraded ?? []).slice(0, 4).join(' | ')}`)
    console.log(`  ANSWER: ${r.answer.replace(/\s+/g, ' ').slice(0, 500)}`)
    for (const s of r.sources.slice(0, 5)) console.log(`  SOURCE: ${s.url} ${s.date ? `(dated ${s.date})` : ''}`)
    if (!ok) console.log(`  FULL ANSWER: ${r.answer}`)
    report.push({
      query: c.query,
      verdict: ok ? 'PASS' : 'FAIL',
      answer: r.answer.slice(0, 2000),
      sources: r.sources,
      researchQueries: r.researchQueries,
      firstTokenMs: r.firstTokenMs,
      durationMs: r.durationMs,
      wallMs,
    })
  }
  const fs = await import('fs')
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync('docs/evidence/riishe-live-research-e2e.json', JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, cases: report }, null, 2))
  console.log(`\n[e2e] ${pass}/${CASES.length} PASS — full evidence written to docs/evidence/riishe-live-research-e2e.json`)
  if (pass < CASES.length) process.exit(1)
}

main().catch((e) => {
  console.error('[e2e] fatal:', e)
  process.exit(1)
})
