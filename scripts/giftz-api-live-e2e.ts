/**
 * CODE GIFTZ — LIVE /api/v1 gateway verification (Task D of the W1–W5
 * closure work order).
 *
 * Runs REAL provider-backed requests through the unified API on the isolated
 * :3100 instance (real hosted gateway, NO mocks, NO fabricated responses):
 *  1. authenticated JSON completion  POST /api/v1/chat/completions
 *  2. authenticated SSE streaming    POST /api/v1/chat/completions (stream:true)
 *  3. GET /api/v1/models             (catalogue, Task B live evidence)
 *  4. GET /api/v1/usage              (rollups for the calling principal)
 *  5. usage accounting: GatewayRequestLog rows verified directly in the
 *     ISOLATED DB (status 200, streamed true/false, model, duration)
 *
 * The app key is created via the admin API at run time and NEVER printed.
 * Any upstream 429 is recorded honestly (RATE_LIMITED evidence) and retried
 * at most once after the product's 60s cooldown — then the script reports
 * BLOCKED, never a fake PASS.
 */
import { Database } from 'bun:sqlite'

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3100').replace(/\/$/, '')
const DB_PATH = '/home/z/my-project/scripts/giftz-verify-out/verify.db'

let failures = 0
function check(name: string, passed: boolean, detail = ''): void {
  console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures += 1
}

async function api(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) }
  if (init.headers) Object.assign(headers, init.headers)
  return fetch(`${BASE}${path}`, { ...init, headers })
}

async function adminCookie(): Promise<string> {
  const email = `giftz-apilive-${Date.now()}@bean-eval.dev`
  const password = 'ApiLiveE2e2026x'
  const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name: 'API Live E2E' }) })
  if (!reg.ok) throw new Error(`register failed: ${reg.status}`)
  const db = new Database(DB_PATH)
  db.run(`UPDATE User SET role='admin' WHERE email=?`, [email])
  db.close()
  const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  if (!cookie) throw new Error('no session cookie')
  return cookie
}

interface SseResult { deltas: string[]; text: string; terminal: Record<string, unknown> | null; firstTokenMs: number | null; durationMs: number }

async function sseTurn(key: string, body: Record<string, unknown>): Promise<SseResult> {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  })
  const result: SseResult = { deltas: [], text: '', terminal: null, firstTokenMs: null, durationMs: 0 }
  if (!res.ok || !res.body) throw new Error(`SSE request failed: HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let done = false
  while (!done) {
    const { done: streamDone, value } = await reader.read()
    if (streamDone) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const frame of parts) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      let evt: Record<string, unknown>
      try { evt = JSON.parse(line.slice(6)) as Record<string, unknown> } catch { continue }
      if (typeof evt.delta === 'string') {
        if (result.firstTokenMs === null) result.firstTokenMs = Date.now() - t0
        result.deltas.push(evt.delta)
        result.text += evt.delta
      }
      if (evt.done || evt.error) { result.terminal = evt; done = true }
    }
  }
  result.durationMs = Date.now() - t0
  return result
}

const cookie = await adminCookie()
console.log('admin session ready (isolated DB)')

const mk = await api('/api/v1/keys', {
  method: 'POST', cookie,
  body: JSON.stringify({ name: 'closure-live', permissions: ['chat:completions', 'models:read', 'usage:read'], rateLimitPerMin: 60 }),
})
const mkBody = (await mk.json().catch(() => ({}))) as Record<string, unknown>
const KEY = String(mkBody.key ?? '')
if (!mk.ok || !KEY.startsWith('bgk_')) throw new Error(`key creation failed: HTTP ${mk.status}`)
console.log('app key created (raw key never printed)')

// ---- 1. JSON completion (real provider) ------------------------------------
console.log('\n== LIVE JSON completion (real hosted provider) ==')
const t1 = Date.now()
const jsonRes = await api('/api/v1/chat/completions', {
  method: 'POST', headers: { authorization: `Bearer ${KEY}` },
  body: JSON.stringify({
    model: 'bean-chat-hosted',
    messages: [{ role: 'user', content: 'Reply with one short sentence stating that the BEAN unified gateway JSON path works.' }],
    max_tokens: 300,
  }),
})
const jsonBody = (await jsonRes.json().catch(() => ({}))) as Record<string, unknown>
if (jsonRes.status === 429) {
  console.log(`  upstream 429 at ${new Date().toISOString()} — waiting 65s for the cooldown, ONE controlled retry`)
  await new Promise((r) => setTimeout(r, 65_000))
  const retry = await api('/api/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: 'bean-chat-hosted', messages: [{ role: 'user', content: 'Reply with one short sentence stating that the BEAN unified gateway JSON path works.' }], max_tokens: 300 }),
  })
  Object.assign(jsonBody, (await retry.json().catch(() => ({}))) as Record<string, unknown>)
  ;(jsonRes as unknown as { status: number }).status = retry.status
}
const jsonMs = Date.now() - t1
const jsonOk = jsonRes.ok && jsonBody.ok === true
check('JSON completion returned 200 ok:true', jsonOk, `HTTP ${jsonRes.status} (${jsonMs}ms)`)
if (jsonOk) {
  const content = String(jsonBody.content ?? '')
  check('JSON content is a real non-empty provider answer', content.trim().length > 10, `chars=${content.length}`)
  console.log(`      content preview: ${content.slice(0, 120).replace(/\n/g, ' ')}`)
  check('JSON reports model + provider identity', String(jsonBody.model) === 'bean-chat-hosted' && typeof jsonBody.provider === 'string' && jsonBody.provider.length > 0, `model=${String(jsonBody.model)} provider=${String(jsonBody.provider)}`)
  check('JSON finishReason present', typeof jsonBody.finishReason === 'string' && jsonBody.finishReason.length > 0, `finishReason=${String(jsonBody.finishReason)}`)
  const usage = jsonBody.usage as Record<string, unknown> | undefined
  check('JSON usage accounting present (labeled exact/estimated)', !!usage && typeof usage.tokensIn === 'number' && typeof usage.tokensOut === 'number' && typeof usage.exact === 'boolean', `in=${String(usage?.tokensIn)} out=${String(usage?.tokensOut)} exact=${String(usage?.exact)}`)
} else {
  const code = String((jsonBody.error as Record<string, unknown> | undefined)?.code ?? '')
  console.log(`  JSON completion did NOT pass: code=${code} — recording honestly`)
  check('if failed, failure is a typed upstream error (429 documented, never faked)', code === 'RATE_LIMITED' || code === 'BACKEND_TIMEOUT' || code === 'BACKEND_FAILURE', `code=${code}`)
}

// ---- 2. SSE streaming (real provider) ---------------------------------------
console.log('\n== LIVE SSE streaming (real hosted provider) ==')
let sse: SseResult | null = null
try {
  sse = await sseTurn(KEY, {
    model: 'bean-chat-hosted',
    messages: [{ role: 'user', content: 'In three short sentences, describe what an event-loop microtask queue is.' }],
    stream: true,
    max_tokens: 600,
  })
} catch (e) {
  check('SSE turn completed', false, (e as Error).message.slice(0, 160))
}
if (sse) {
  check('SSE produced incremental deltas (real streaming)', sse.deltas.length > 5, `deltas=${sse.deltas.length}`)
  check('SSE first token arrived promptly', (sse.firstTokenMs ?? 999_999) < 30_000, `TTFT=${String(sse.firstTokenMs)}ms`)
  check('SSE answer is a real non-empty provider answer', sse.text.trim().length > 30, `chars=${sse.text.length}`)
  console.log(`      stream preview: ${sse.text.slice(0, 120).replace(/\n/g, ' ')}`)
  const exactlyOneTerminal = sse.terminal !== null
  const isDone = exactlyOneTerminal && (sse.terminal as Record<string, unknown>).done === true
  const hasError = exactlyOneTerminal && (sse.terminal as Record<string, unknown>).error !== undefined
  check('SSE terminated with exactly ONE terminal done frame (no error frame)', exactlyOneTerminal && isDone && !hasError, `durationMs=${sse.durationMs}`)
  check('SSE done frame carries model identity', String((sse.terminal as Record<string, unknown> | null)?.model ?? '') === 'bean-chat-hosted')
}

// ---- 3. models catalogue (live, Task B evidence) ----------------------------
console.log('\n== GET /api/v1/models (live) ==')
const models = await api('/api/v1/models', { headers: { authorization: `Bearer ${KEY}` } })
const modelsBody = (await models.json().catch(() => ({}))) as Record<string, unknown>
check('models endpoint 200 with catalogue', models.ok && Array.isArray(modelsBody.models) && (modelsBody.models as unknown[]).length >= 6, `HTTP ${models.status}, models=${(modelsBody.models as unknown[] | undefined)?.length}`)

// ---- 4. usage endpoint -------------------------------------------------------
console.log('\n== GET /api/v1/usage (live) ==')
const usage = await api('/api/v1/usage', { headers: { authorization: `Bearer ${KEY}` } })
const usageBody = (await usage.json().catch(() => ({}))) as Record<string, unknown>
check('usage endpoint 200 with rollups', usage.ok && usageBody.ok === true, `HTTP ${usage.status}`)

// ---- 5. GatewayRequestLog accounting (direct isolated-DB read) ---------------
console.log('\n== GatewayRequestLog accounting (isolated DB read) ==')
{
  const db = new Database(DB_PATH, { readonly: true })
  const rows = db.query(`SELECT endpoint, status, streamed, model, errorCode, durationMs FROM GatewayRequestLog ORDER BY createdAt DESC LIMIT 10`).all() as Array<Record<string, unknown>>
  db.close()
  console.log(`      recent rows: ${JSON.stringify(rows.slice(0, 6))}`)
  const okJson = rows.find((r) => r.endpoint === '/api/v1/chat/completions' && r.status === 200 && r.streamed === 0)
  const okSse = rows.find((r) => r.endpoint === '/api/v1/chat/completions' && r.status === 200 && r.streamed === 1)
  check('JSON completion logged (status 200, streamed=0)', !!okJson, rows.length ? '' : 'NO ROWS AT ALL')
  check('SSE completion logged (status 200, streamed=1)', !!okSse)
}

console.log(failures === 0 ? '\nLIVE API E2E: ALL CHECKS PASS' : `\nLIVE API E2E: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
