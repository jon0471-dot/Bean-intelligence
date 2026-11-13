/**
 * PLATFORM-WIDE RECOVERY (2026-11-12) — RIISHE streaming completion verify
 * (Part 2 #5): a REAL SSE conversational request; asserts the stream OPENS
 * (text/event-stream), carries incremental deltas, and TERMINATES cleanly
 * with a completion event. Honest recording of whatever happens.
 */
const BASE = 'http://localhost:3000'
const stamp = Date.now()
let cookie = ''
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
  })
  const sc = res.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  return res
}
const reg = await call('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `stream-${stamp}@bean.local`, password: 'Bean-Stream-2026!', name: 'Stream Verify' }) })
const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `stream-${stamp}@bean.local`, password: 'Bean-Stream-2026!' }) })
console.log(`auth: register=${reg.status} login=${login.status}`)
const t0 = Date.now()
const res = await call('/api/riishe/chat?stream=1', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'Reply with exactly one short sentence about why streaming matters for chat UX.' }),
})
console.log(`stream: HTTP ${res.status} content-type=${res.headers.get('content-type')}`)
if (!res.body) { console.log('NO BODY'); process.exit(1) }
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buf = ''
let events = 0
let deltas = 0
let chars = 0
let sawDone = false
let sawError: string | null = null
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  for (const block of buf.split('\n\n')) {
    if (!block.trim()) continue
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') { if (payload === '[DONE]') sawDone = true; continue }
      try {
        const j = JSON.parse(payload) as { type?: string; delta?: string; content?: string; error?: string }
        events++
        if (j.type === 'delta' || (j.delta !== undefined && j.delta !== '')) { deltas++; chars += (j.delta ?? '').length }
        if (j.type === 'done' || (j as { done?: boolean }).done === true || j.type === 'completion' || j.type === 'end') sawDone = true
        if (j.type === 'error' || j.error) sawError = String(j.error ?? j.type)
      } catch { /* non-JSON keepalive */ }
    }
  }
  buf = ''
}
console.log(`stream finished in ${Date.now() - t0}ms: events=${events} deltas=${deltas} chars=${chars} sawDone=${sawDone} error=${sawError ?? 'none'}`)
console.log(`STREAM VERDICT: ${res.status === 200 && deltas > 0 && chars > 20 && sawDone && !sawError ? 'PASS — real incremental SSE stream completed' : 'FAIL'}`)
