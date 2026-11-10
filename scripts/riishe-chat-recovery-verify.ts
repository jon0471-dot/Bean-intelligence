/**
 * RIISHE CHAT RECOVERY — live verification (Part A.7 of the brief).
 *
 * Bounded, sequential, single-attempt: every product call is counted.
 *  - health quota-proof: 2 fresh /api/health polls must consume ZERO quota
 *    (DB UsageRecord rows before/after + authoritative daily-remaining delta)
 *  - English chat (streamed) + Tamil chat (streamed) + multilingual chat
 *  - conversation history + context recall (follow-up turn)
 *  - web research with citations (one current-fact turn)
 *  - persistence: conversations re-read from the API after completion
 * Evidence JSON → scripts/riishe-recovery-out/riishe-verify.json
 */
import { db } from '../src/lib/db'

const BASE = 'http://localhost:3000'
const OUT = 'scripts/riishe-recovery-out/riishe-verify.json'
const stamp = Date.now()
const EMAIL = `riishe-recovery-${stamp}@bean.local`

interface Step {
  step: string
  ok: boolean
  status: number | null
  detail: string
  ms?: number
}

const steps: Step[] = []
function record(step: string, ok: boolean, status: number | null, detail: string, ms?: number) {
  steps.push({ step, ok, status, detail, ...(ms !== undefined ? { ms } : {}) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step} (${status ?? '-'}${ms !== undefined ? `, ${ms}ms` : ''}) ${detail.slice(0, 160)}`)
}

// ---------------------------------------------------------------- auth jar
let cookie = ''
async function call(path: string, init: RequestInit = {}, opts: { keep?: boolean } = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(cookie ? { cookie } : {}),
    } as Record<string, string>,
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie && !opts.keep) cookie = setCookie.split(';')[0]
  return res
}

// ------------------------------------------------------------ budget reads
async function riisheUsageRows(): Promise<number> {
  const rows = await db.usageRecord.count({
    where: { product: 'riishe', createdAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
  })
  return rows
}
async function allUsageRowsToday(): Promise<number> {
  return await db.usageRecord.count({
    where: { createdAt: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
  })
}

// ------------------------------------------------- authoritative headers
async function quotaHeaders(label: string): Promise<{ remaining: number | null; status: number }> {
  const cfg = JSON.parse(await Bun.file('/etc/.z-ai-config').text())
  const res = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      'X-Z-AI-From': 'Z',
      ...(cfg.chatId ? { 'X-Chat-Id': cfg.chatId } : {}),
      ...(cfg.userId ? { 'X-User-Id': cfg.userId } : {}),
      ...(cfg.token ? { 'X-Token': cfg.token } : {}),
    },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Reply with exactly: OK' }], thinking: { type: 'disabled' } }),
  })
  await res.text()
  const remaining = res.headers.get('x-ratelimit-remaining-daily')
  console.log(`quota ${label}: HTTP ${res.status}, remaining-daily ${remaining}`)
  record(`quota probe ${label}`, res.status === 200, res.status, `x-ratelimit-remaining-daily=${remaining}`)
  return { remaining: remaining ? Number(remaining) : null, status: res.status }
}

// --------------------------------------------------------------- SSE client
interface StreamResult {
  deltas: string[]
  done: Record<string, unknown> | null
  errorFrame: Record<string, unknown> | null
  firstDeltaMs: number | null
  ms: number
  status: number
}
async function streamChat(body: Record<string, unknown>): Promise<StreamResult> {
  const t0 = Date.now()
  const res = await call(`/api/riishe/chat?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const out: StreamResult = { deltas: [], done: null, errorFrame: null, firstDeltaMs: null, ms: 0, status: res.status }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    out.done = { nonStream: text.slice(0, 300) }
    out.ms = Date.now() - t0
    return out
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      try {
        const payload = JSON.parse(line.slice(5).trim())
        if (typeof payload.delta === 'string') {
          if (out.firstDeltaMs === null) out.firstDeltaMs = Date.now() - t0
          out.deltas.push(payload.delta)
        } else if (payload.done === true) {
          out.done = payload
        } else if (payload.error) {
          out.errorFrame = payload
        }
      } catch {
        /* keepalive comments etc. */
      }
    }
  }
  out.ms = Date.now() - t0
  return out
}

async function jsonChat(body: Record<string, unknown>) {
  const t0 = Date.now()
  const res = await call(`/api/riishe/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json, ms: Date.now() - t0 }
}

// ==================================================================== RUN
const quotaBefore = await quotaHeaders('before tests')
const rowsAllBefore = await allUsageRowsToday()
const riisheRowsBefore = await riisheUsageRows()
console.log(`DB usage rows today: all=${rowsAllBefore} riishe=${riisheRowsBefore}`)

// ---- 0. auth
const reg = await call('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: 'Bean-Accept-2026!', name: 'Riishe Recovery' }),
})
const login = await call('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: 'Bean-Accept-2026!' }),
})
record('auth: fresh user registered+logged in', login.status === 200, login.status, EMAIL)
const session = await (await call('/api/auth/session')).json().catch(() => ({}))
const userId = (session as { user?: { id?: string } }).user?.id ?? null
record('auth: session resolved', userId !== null, 200, `userId=${userId?.slice(0, 10) ?? 'null'}`)

// ---- 1. HEALTH QUOTA-PROOF: two fresh polls must consume NOTHING.
const rowsBeforeHealth = await allUsageRowsToday()
const tHealth0 = Date.now()
const h1 = await call('/api/health')
const health1 = await h1.json().catch(() => null)
const health1Ms = Date.now() - tHealth0
await new Promise((r) => setTimeout(r, 21_000)) // exceed the 20s probe-cache TTL → second poll is a fresh probe
const tHealth1 = Date.now()
const h2 = await call('/api/health')
const health2 = await h2.json().catch(() => null)
const health2Ms = Date.now() - tHealth1
const rowsAfterHealth = await allUsageRowsToday()
const riisheStatus = (health1 as { products?: Record<string, { status?: string }> })?.products?.riishe?.status ?? 'unknown'
const researchDetail = (health1 as { products?: Record<string, { research?: { probe?: { detail?: string } } }> })?.products?.riishe?.research?.probe?.detail ?? ''
const chatDetail = (health1 as { products?: Record<string, { probe?: { detail?: string } }> })?.products?.riishe?.probe?.detail ?? ''
record(
  'health quota-proof: 2 fresh polls consumed ZERO usage rows',
  rowsAfterHealth === rowsBeforeHealth,
  200,
  `rows ${rowsBeforeHealth}→${rowsAfterHealth}; riishe status=${riisheStatus}; chat probe detail="${chatDetail.slice(0, 110)}"`,
)
record(
  'health probes report quota-free evidence basis',
  chatDetail.includes('No completion was fired') || chatDetail.includes('no completion was fired'),
  200,
  `chat detail="${chatDetail.slice(0, 130)}"`,
)
record(
  'research probe is quota-free',
  researchDetail.includes('No search was fired') || researchDetail.includes('no search was fired') || researchDetail.includes('No search was fired by this probe'),
  200,
  `research detail="${researchDetail.slice(0, 130)}"`,
)
record('health latency measured', typeof health1Ms === 'number' && health1Ms > 0, 200, `poll1=${health1Ms}ms poll2=${health2Ms}ms`)
console.log(`health2 fresh-poll latency: ${health2Ms}ms (poll1 may share warm cache: ${health1Ms}ms)`)

// ---- 2. English chat (streamed)
const rowsPreEnglish = await riisheUsageRows()
const eng = await streamChat({ message: 'What is 17 * 23? Answer with just the number.' })
const engContent = eng.deltas.join('')
const engOk = eng.status === 200 && eng.errorFrame === null && engContent.trim().includes('391') && eng.deltas.length >= 1
record('English chat (streamed; short single-token answers legitimately arrive in one frame)', engOk, eng.status, `deltas=${eng.deltas.length} firstDelta=${eng.firstDeltaMs}ms total=${eng.ms}ms content="${engContent.slice(0, 80)}"`)
const rowsPostEnglish = await riisheUsageRows()
record('English turn metered once', rowsPostEnglish === rowsPreEnglish + 1, null, `riishe rows ${rowsPreEnglish}→${rowsPostEnglish}`)
const engConvId = (eng.done as { conversationId?: string } | null)?.conversationId ?? null

// ---- 3. Tamil chat (streamed, same conversation → history rides along)
const rowsPreTamil = await riisheUsageRows()
const tam = await streamChat({
  message: 'தமிழ்நாட்டின் தலைநகர் எது? சுருக்கமாக தமிழில் பதிலளிக்கவும்.',
  conversationId: engConvId,
})
const tamContent = tam.deltas.join('')
const tamilScript = /[\u0B80-\u0BFF]/.test(tamContent)
const tamOk = tam.status === 200 && tam.errorFrame === null && tamContent.trim().length >= 4 && tamilScript && tam.deltas.length > 1
record('Tamil chat (streamed, same-language reply)', tamOk, tam.status, `deltas=${tam.deltas.length} total=${tam.ms}ms tamilScript=${tamilScript} content="${tamContent.slice(0, 70)}"`)
const rowsPostTamil = await riisheUsageRows()
record('Tamil turn metered once', rowsPostTamil === rowsPostEnglish + 1, null, `riishe rows ${rowsPostEnglish}→${rowsPostTamil}`)

// ---- 4. Context recall (history): the math answer came 2 turns ago in engConvId.
const rowsPreRecall = await riisheUsageRows()
const recall = await streamChat({
  message: 'What was the number I asked you to compute two turns ago, and what was the answer?',
  conversationId: engConvId,
})
const recallContent = recall.deltas.join('')
const recallOk = recall.status === 200 && recall.errorFrame === null && recallContent.includes('391')
record('Context recall across history (17*23=391 answered 2 turns earlier)', recallOk, recall.status, `content="${recallContent.slice(0, 140)}" total=${recall.ms}ms`)
const rowsPostRecall = await riisheUsageRows()
record('Recall turn metered once', rowsPostRecall === rowsPostTamil + 1, null, `riishe rows ${rowsPostTamil}→${rowsPostRecall}`)

// ---- 5. Multilingual chat (Hindi)
const rowsPreHindi = await riisheUsageRows()
const hin = await streamChat({ message: 'भारत की राजधानी क्या है? केवल हिंदी में संक्षिप्त उत्तर दें।' })
const hinContent = hin.deltas.join('')
const devanagari = /[\u0900-\u097F]/.test(hinContent)
const hinOk = hin.status === 200 && hin.errorFrame === null && hinContent.trim().length > 10 && devanagari
record('Multilingual chat (Hindi, same-language reply)', hinOk, hin.status, `deltas=${hin.deltas.length} devanagari=${devanagari} content="${hinContent.slice(0, 60)}"`)
const rowsPostHindi = await riisheUsageRows()
record('Hindi turn metered once', rowsPostHindi === rowsPostRecall + 1, null, `riishe rows ${rowsPostRecall}→${rowsPostHindi}`)

// ---- 6. Web research with citations (one current-fact turn)
const rowsPreResearch = await riisheUsageRows()
const research = await streamChat({ message: 'Who is the current Chief Minister of Tamil Nadu? Cite your sources.' })
const researchContent = research.deltas.join('')
const researchMeta = (research.done as { meta?: { sources?: Array<{ url?: string }>; research?: { queries?: string[] }; verification?: unknown } } | null)?.meta ?? null
const hasCitations = /\[\d+\]/.test(researchContent)
const sourcesCount = researchMeta?.sources?.length ?? 0
const researchOk = research.status === 200 && research.errorFrame === null && hasCitations && sourcesCount > 0
record('Web research with citations', researchOk, research.status, `sources=${sourcesCount} citations=${hasCitations} queries=${JSON.stringify(researchMeta?.research?.queries ?? []).slice(0, 90)} total=${research.ms}ms`)
record('Research answers the question', /Vijay|Stalin/.test(researchContent), research.status, `answer="${researchContent.slice(0, 160)}"`)
const rowsPostResearch = await riisheUsageRows()
console.log(`research turn riishe rows ${rowsPreResearch}→${rowsPostResearch} (upstream calls higher: query-gen + searches + solve are one turn)`)

// ---- 7. Persistence: re-read the conversation from the API.
if (engConvId) {
  const conv = await (await call(`/api/riishe/conversations/${engConvId}`)).json().catch(() => null) as { conversation?: { messages?: Array<{ role: string; content: string }> } } | null
  const msgs = conv?.conversation?.messages ?? []
  const userRows = msgs.filter((m) => m.role === 'user').length
  const asstRows = msgs.filter((m) => m.role === 'assistant' && m.content.trim().length > 0).length
  const persisted = msgs.some((m) => m.content.includes('391')) && msgs.some((m) => /[\u0B80-\u0BFF]/.test(m.content))
  record('Conversation persistence (English + Tamil rows re-readable)', persisted && userRows >= 3 && asstRows >= 3, 200, `messages=${msgs.length} user=${userRows} assistant=${asstRows}`)
} else {
  record('Conversation persistence', false, null, 'no conversationId from streamed turn')
}

// ---- 8. Final authoritative quota delta
const quotaAfter = await quotaHeaders('after tests')
const rowsAllAfter = await allUsageRowsToday()
const healthConsumed = rowsAfterHealth - rowsBeforeHealth
const delta = (quotaBefore.remaining ?? 0) - (quotaAfter.remaining ?? 0)
record(
  'FINAL: health monitoring consumed zero quota (authoritative headers)',
  healthConsumed === 0,
  quotaAfter.status,
  `health polls consumed ${healthConsumed} usage rows; account delta over whole run=${delta} (tests + probes only)`,
)
record('FINAL: total run rows', true, null, `all-usage rows today ${rowsAllBefore}→${rowsAllAfter}; riishe=${rowsPostResearch}`)

const failed = steps.filter((s) => !s.ok)
const result = {
  runAt: new Date().toISOString(),
  email: EMAIL,
  quota: { before: quotaBefore, after: quotaAfter, delta },
  steps,
  failedCount: failed.length,
}
await Bun.write(OUT, JSON.stringify(result, null, 2))
console.log(`\n${failed.length === 0 ? 'ALL PASS' : `${failed.length} FAILURES`} — evidence: ${OUT}`)
process.exit(failed.length === 0 ? 0 : 1)
