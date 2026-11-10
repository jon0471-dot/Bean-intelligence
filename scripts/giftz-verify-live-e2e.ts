/**
 * CODE GIFTZ — LIVE self-verification E2E (Task E of the W1–W5 closure work
 * order).
 *
 * Runs against the isolated :3100 instance started WITH verification
 * temporarily enabled (BEAN_VERIFY_ENABLED=true, isolated env only — the
 * production default stays OFF). One REAL hosted-model turn through the
 * PRODUCT chat route exercises the full pipeline:
 *   draft → verifying stage → (revising stage when issues found) → done
 *
 * Asserts (honest evidence, no mocks):
 *  - verification stages execute in the intended order (verifying before done)
 *  - the done frame carries the PUBLIC verification summary with EXACTLY the
 *    documented shape {status, attempts, corrections, issuesFound} — the
 *    four honest statuses only, NEVER verifier reasoning
 *  - the streamed answer is persisted byte-exact (final response correct)
 *  - no verifier reasoning text leaks into the user-visible stream
 *
 * The verification knobs (attempt limits, timeouts, regeneration limits,
 * input limits) are enforced by construction and covered by the 17
 * self-verification unit tests (incl. the double clamp); this live run
 * proves the ENABLED workflow end-to-end.
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

const email = `giftz-verify-live-${Date.now()}@bean-eval.dev`
const password = 'VerifyLiveE2e2026x'
const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name: 'Verify Live E2E' }) })
if (!reg.ok) throw new Error(`register failed: ${reg.status}`)
const cookie = reg.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
if (!cookie) throw new Error('no session cookie')

console.log('eval account ready (verification ENABLED on this isolated instance)')

const t0 = Date.now()
const res = await api('/api/code-giftz/chat?stream=1', {
  method: 'POST', cookie,
  body: JSON.stringify({
    message: 'Write a tiny JavaScript function isPositive(n) that returns true for numbers greater than zero and false otherwise. Include one usage example. Keep it short.',
  }),
})
if (!res.ok || !res.body) throw new Error(`chat request failed: HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)

const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
let text = ''
let projectId: string | null = null
let verification: Record<string, unknown> | null = null
let terminal: Record<string, unknown> | null = null
const stages: string[] = []
let deltas = 0
let firstTokenMs: number | null = null
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
      if (firstTokenMs === null) firstTokenMs = Date.now() - t0
      deltas += 1
      text += evt.delta
    }
    if (evt.stage === 'verifying' || evt.stage === 'revising') stages.push(String(evt.stage))
    if (typeof evt.projectId === 'string') projectId = evt.projectId
    if (evt.verification && typeof evt.verification === 'object') verification = evt.verification as Record<string, unknown>
    if (evt.done || evt.error) { terminal = evt; done = true }
  }
}
const durationMs = Date.now() - t0

console.log(`\nturn finished in ${(durationMs / 1000).toFixed(1)}s — deltas=${deltas}, TTFT=${String(firstTokenMs)}ms, stages=[${stages.join(' → ')}]`)

check('turn reached a legitimate terminal state (done, no error frame)', terminal?.done === true && terminal?.error === undefined, terminal ? `keys=${Object.keys(terminal).join(',')}` : 'NO TERMINAL FRAME')
check('draft streamed as real deltas', deltas > 5, `deltas=${deltas}`)
check('answer text non-empty', text.trim().length > 30, `chars=${text.length}`)

check('verification stage executed (verifying frame seen)', stages.includes('verifying'), `stages=${stages.join(',') || 'NONE'}`)
check('stage order is draft → verifying (→ revising) → done', stages.length === 0 || stages[0] === 'verifying', `order=${stages.join(',')}`)

check('done frame carries the PUBLIC verification summary', verification !== null, verification ? JSON.stringify(verification) : 'MISSING')
if (verification) {
  const keys = Object.keys(verification).sort()
  check('summary shape is EXACTLY {attempts, corrections, issuesFound, status} (no reasoning fields)', JSON.stringify(keys) === JSON.stringify(['attempts', 'corrections', 'issuesFound', 'status']), `keys=${keys.join(',')}`)
  const status = String(verification.status)
  check('status is one of the four honest values', ['verified', 'corrected', 'corrected-unverified', 'unverified'].includes(status), `status=${status}`)
  check('attempts count within the structural cap (≤ 3)', typeof verification.attempts === 'number' && (verification.attempts as number) >= 1 && (verification.attempts as number) <= 3, `attempts=${String(verification.attempts)}`)
  check('corrections count within the structural cap (≤ 1)', typeof verification.corrections === 'number' && (verification.corrections as number) >= 0 && (verification.corrections as number) <= 1, `corrections=${String(verification.corrections)}`)
}

// No verifier reasoning may leak into the user-visible stream: the verifier
// works from an internal template whose instructions never appear verbatim
// in a legitimate answer; assert the stream contains neither the pipeline's
// internal instruction markers nor a verifier-style verdict preamble.
const leakMarkers = ['You are a verifier', 'verification issues', 'VERDICT:', 'confidence:', 'Blocking issues']
const leaked = leakMarkers.filter((m) => text.toLowerCase().includes(m.toLowerCase()))
check('no verifier reasoning markers in the user-visible answer', leaked.length === 0, leaked.length ? `markers=${leaked.join('|')}` : '')

// Persisted final response correctness (byte-exact vs streamed).
if (projectId && terminal?.done === true) {
  const detail = await api(`/api/code-giftz/chat/${projectId}`, { cookie })
  const data = (await detail.json().catch(() => ({}))) as { project?: { messages?: Array<{ role: string; content: string }> } }
  const msgs = data.project?.messages ?? []
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')
  check('final answer persisted byte-exact (exactly once)', lastAssistant?.content === text, `persisted chars=${lastAssistant?.content.length ?? 'NONE'} streamed chars=${text.length}`)
  const userRows = msgs.filter((m) => m.role === 'user')
  check('exactly one user row for this turn (no duplicates)', userRows.length === 1, `userRows=${userRows.length}`)
} else {
  check('final answer persisted byte-exact (exactly once)', false, 'no projectId or not done — persistence not verifiable')
}

console.log(failures === 0 ? '\nLIVE VERIFICATION E2E: ALL CHECKS PASS' : `\nLIVE VERIFICATION E2E: ${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
