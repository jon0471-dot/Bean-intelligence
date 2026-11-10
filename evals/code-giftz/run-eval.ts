/**
 * BEAN Intelligence — CODE GIFTZ live evaluation runner.
 *
 * Sends the benchmark (Q1–Q6) + event-loop regression (R1–R4) questions — or
 * the long-answer streaming E2E (--stream-e2e) — through the REAL running
 * CODE GIFTZ API (dev server or public preview URL), consumes the SSE turn
 * exactly like the product UI, and records per-question content checks.
 *
 * Honesty rules:
 *  - every answer is generated LIVE by the configured provider (no mocks);
 *  - regression ground truth is computed by EXECUTING the snippet locally;
 *  - the E2E verifies the streamed text equals the PERSISTED text byte-exact;
 *  - the runner never edits answers or checks to force a pass.
 *
 * Upstream throttling (2026-11-03): the gateway rate-limits globally (HTTP
 * 429) and the product holds a 60s cooldown circuit breaker after one
 * (UPSTREAM_429_COOLDOWN_MS), so a question unlucky enough to hit a 429
 * window is retried after the cooldown expires — still generated LIVE by
 * the provider, never faked. Max 2 retries per question; exhausted retries
 * are recorded as the honest UPSTREAM_RATE_LIMITED failure they are.
 *
 * Usage:
 *   bun evals/code-giftz/run-eval.ts [--stream-e2e] [--base-url http://127.0.0.1:3000]
 * Results: evals/code-giftz/results/<mode>-<timestamp>.json
 */
import { QUESTIONS, LONG_STREAM_PROMPT, answerContainsGroundTruth, type EvalQuestion } from './questions'
import { mkdirSync, writeFileSync } from 'node:fs'

// Helpers are exported so targeted probes (e.g. scripts/giftz-r3-probe.ts)
// can reuse the exact same live-turn + 429-retry machinery. main() only runs
// when this file is invoked directly (import.meta.main), never on import.

const args = process.argv.slice(2)
const STREAM_E2E = args.includes('--stream-e2e')
const baseUrlIdx = args.indexOf('--base-url')
const BASE_URL = (baseUrlIdx >= 0 ? args[baseUrlIdx + 1] : process.env.GIFTZ_EVAL_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')

const RESULTS_DIR = new URL('./results/', import.meta.url).pathname

export interface TurnResult {
  deltas: string[]
  text: string
  terminal: Record<string, unknown> | null
  projectId: string | null
  stageFrames: number
  /** Stage names seen (thinking / verifying / revising — verification only
   *  frames appear when the operator enabled the self-verification pipeline). */
  stages: string[]
  /** Public verification summary from the done frame (null when disabled). */
  verification: Record<string, unknown> | null
  firstTokenMs: number | null
  durationMs: number
}

export async function api(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) }
  if (init.headers) Object.assign(headers, init.headers)
  return fetch(`${BASE_URL}${path}`, { ...init, headers })
}

/** Register a dedicated eval account (normal public API — no auth changes). */
export async function authenticate(): Promise<string> {
  const email = `giftz-eval-${Date.now()}@bean-eval.dev`
  const password = 'EvalOnly2026x'
  const register = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name: 'CODE GIFTZ Eval' }),
  })
  if (register.ok) {
    const cookie = register.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    if (cookie) return cookie
    throw new Error('register succeeded but no session cookie was set')
  }
  // Account may already exist (rerun) — fall back to login.
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (login.ok) {
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    if (cookie) return cookie
  }
  throw new Error(`auth failed: register ${register.status}, login ${login.status}: ${await login.text().catch(() => '')}`)
}

/** Consume one CODE GIFTZ SSE turn the way the product UI does. */
async function streamTurn(cookie: string, message: string, opts: { signal?: AbortSignal } = {}): Promise<TurnResult> {
  const t0 = Date.now()
  const res = await api(`/api/code-giftz/chat?stream=1`, {
    method: 'POST',
    body: JSON.stringify({ message }),
    cookie,
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`chat request failed: HTTP ${res.status}: ${detail.slice(0, 300)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const result: TurnResult = { deltas: [], text: '', terminal: null, projectId: null, stageFrames: 0, stages: [], verification: null, firstTokenMs: null, durationMs: 0 }
  let done = false
  while (!done) {
    const { done: streamDone, value } = await reader.read()
    if (streamDone) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const frame of parts) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue // keepalive comment or empty
      let evt: Record<string, unknown>
      try {
        evt = JSON.parse(line.slice(6)) as Record<string, unknown>
      } catch {
        continue // malformed frame — the product client skips it too
      }
      if (typeof evt.delta === 'string') {
        if (result.firstTokenMs === null) result.firstTokenMs = Date.now() - t0
        result.deltas.push(evt.delta)
        result.text += evt.delta
      }
      if (evt.stage) {
        result.stageFrames += 1
        result.stages.push(String(evt.stage))
        // 'revising' = the corrected answer REPLACES the streamed draft (the
        // same reset semantics the product client implements). Without the
        // reset the accumulated text would be draft+revision while the
        // persisted answer is the revision only.
        if (evt.stage === 'revising') result.text = ''
      }
      if (typeof evt.projectId === 'string') result.projectId = evt.projectId
      if (evt.verification && typeof evt.verification === 'object') {
        result.verification = evt.verification as Record<string, unknown>
      }
      if (evt.done || evt.error) {
        result.terminal = evt
        done = true // stop consuming at the terminal frame, like the UI
      }
    }
  }
  result.durationMs = Date.now() - t0
  return result
}

/** Fetch the persisted project and return the last assistant message content. */
async function persistedAssistant(cookie: string, projectId: string): Promise<{ content: string; id: string } | null> {
  const res = await api(`/api/code-giftz/chat/${projectId}`, { cookie })
  if (!res.ok) return null
  const data = (await res.json()) as { project?: { messages?: Array<{ id: string; role: string; content: string }> } }
  const msgs = data.project?.messages ?? []
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')
  return lastAssistant ? { content: lastAssistant.content, id: lastAssistant.id } : null
}

/** The app's own post-429 circuit breaker holds calls for this long. */
const UPSTREAM_429_COOLDOWN_MS = 60_000
const RATE_LIMIT_RETRIES = 2

const isRateLimitedTurn = (t: TurnResult): boolean =>
  t.terminal !== null &&
  t.terminal.error !== undefined &&
  String(t.terminal.code ?? '').toUpperCase().includes('RATE_LIMITED')

/** Stream one turn, retrying ONLY the upstream-throttle failure class: wait
 *  out the product's 60s 429 cooldown, then regenerate live. Any other
 *  failure (or exhausted retries) is returned as-is and recorded honestly. */
export async function streamTurnWith429Retry(cookie: string, message: string): Promise<TurnResult> {
  let turn = await streamTurn(cookie, message)
  for (let attempt = 1; attempt <= RATE_LIMIT_RETRIES && isRateLimitedTurn(turn); attempt++) {
    console.log(`    upstream 429 — waiting ${Math.round(UPSTREAM_429_COOLDOWN_MS / 1000) + 5}s for the cooldown to clear, then retrying (${attempt}/${RATE_LIMIT_RETRIES})`)
    await new Promise((resolve) => setTimeout(resolve, UPSTREAM_429_COOLDOWN_MS + 5_000))
    turn = await streamTurn(cookie, message)
  }
  return turn
}

/** Execute a snippet locally to compute ground-truth output lines. */
function groundTruth(snippet: string): string[] {
  const proc = Bun.spawnSync(['bun', '-e', snippet])
  return proc.stdout.toString().trim().split('\n').filter(Boolean)
}

async function runQuestion(cookie: string, q: EvalQuestion): Promise<Record<string, unknown>> {
  const turn = await streamTurnWith429Retry(cookie, q.prompt)
  const checks: Array<{ name: string; passed: boolean }> = q.checks.map((c) => ({ name: c.name, passed: c.test(turn.text) }))

  let truth: string[] | null = null
  if (q.snippet) {
    truth = groundTruth(q.snippet)
    checks.push({
      name: `claimed order matches EXECUTED ground truth [${truth.join(' ')}]`,
      passed: answerContainsGroundTruth(turn.text, truth),
    })
  }

  const terminalOk = turn.terminal !== null && turn.terminal.done === true
  checks.push({ name: 'turn reached a legitimate terminal state (done)', passed: terminalOk })
  if (!terminalOk && turn.terminal) {
    checks.push({ name: `terminal error frame: ${String(turn.terminal.code ?? 'unknown')}`, passed: false })
  }

  // Persistence: the streamed text must be persisted byte-exact.
  if (turn.projectId && terminalOk) {
    const persisted = await persistedAssistant(cookie, turn.projectId)
    checks.push({ name: 'streamed answer persisted byte-exact', passed: persisted?.content === turn.text })
  }

  const passed = checks.filter((c) => c.passed).length
  return {
    id: q.id,
    kind: q.kind,
    answerChars: turn.text.length,
    deltas: turn.deltas.length,
    firstTokenMs: turn.firstTokenMs,
    durationMs: turn.durationMs,
    passed,
    total: checks.length,
    allPassed: passed === checks.length,
    checks,
    answer: turn.text,
    groundTruth: truth,
  }
}

async function runStreamE2E(cookie: string): Promise<Record<string, unknown>> {
  const turn = await streamTurnWith429Retry(cookie, LONG_STREAM_PROMPT)
  const checks: Array<{ name: string; passed: boolean }> = []
  checks.push({ name: 'turn reached a legitimate terminal state (done, no error frame)', passed: turn.terminal?.done === true })
  checks.push({ name: 'answer is a LONG answer (> 6,000 chars streamed)', passed: turn.text.length > 6_000 })
  checks.push({ name: 'content arrived incrementally (> 50 deltas — real streaming)', passed: turn.deltas.length > 50 })
  checks.push({ name: 'first token arrived promptly (< 30s — thinking phase bounded)', passed: (turn.firstTokenMs ?? 999_999) < 30_000 })
  const persisted = turn.projectId ? await persistedAssistant(cookie, turn.projectId) : null
  checks.push({ name: 'streamed answer persisted byte-exact (no truncation, no duplication)', passed: persisted?.content === turn.text })
  const changes = (turn.terminal?.changes as Array<{ path: string }> | undefined) ?? []
  checks.push({ name: 'project files were created from the answer (>= 1)', passed: changes.length >= 1 })
  return {
    id: 'STREAM-E2E-long-coding-answer',
    kind: 'e2e',
    answerChars: turn.text.length,
    deltas: turn.deltas.length,
    firstTokenMs: turn.firstTokenMs,
    durationMs: turn.durationMs,
    passed: checks.filter((c) => c.passed).length,
    total: checks.length,
    allPassed: checks.every((c) => c.passed),
    checks,
    files: changes.map((c) => c.path),
    answerPreview: turn.text.slice(0, 600),
  }
}

async function main(): Promise<void> {
  console.log(`CODE GIFTZ live eval → ${BASE_URL} (${STREAM_E2E ? 'stream E2E' : 'benchmark + regression pack'})`)
  const cookie = await authenticate()
  console.log('authenticated (dedicated eval account)\n')

  const results: Array<Record<string, unknown>> = []
  if (STREAM_E2E) {
    const r = await runStreamE2E(cookie)
    results.push(r)
  } else {
    for (const q of QUESTIONS) {
      process.stdout.write(`running ${q.id} … `)
      const r = await runQuestion(cookie, q)
      results.push(r)
      console.log(`${r.passed}/${r.total} checks passed`)
      // Pace turns: keeps the run well under the per-minute product limit and
      // avoids provoking the upstream gateway's global throttle.
      await new Promise((resolve) => setTimeout(resolve, 8_000))
    }
  }

  const totalPassed = results.reduce((n, r) => n + Number(r.passed), 0)
  const totalChecks = results.reduce((n, r) => n + Number(r.total), 0)
  const summary = {
    ranAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    mode: STREAM_E2E ? 'stream-e2e' : 'benchmark-regression',
    totalChecks,
    passed: totalPassed,
    allPassed: totalPassed === totalChecks,
    questions: results.map(({ answer, answerPreview, ...rest }) => (STREAM_E2E ? rest : { ...rest, answer })),
  }
  mkdirSync(RESULTS_DIR, { recursive: true })
  const outFile = `${RESULTS_DIR}${summary.mode}-${Date.now()}.json`
  writeFileSync(outFile, JSON.stringify(summary, null, 2))

  console.log(`\n==== RESULTS (${totalPassed}/${totalChecks} checks) — ${summary.allPassed ? 'ALL PASS' : 'FAILURES PRESENT'} ====`)
  for (const r of results) {
    console.log(`\n${r.id}: ${r.passed}/${r.total}`)
    for (const c of (r.checks as Array<{ name: string; passed: boolean }>)) {
      console.log(`  [${c.passed ? 'PASS' : 'FAIL'}] ${c.name}`)
    }
  }
  console.log(`\nreport: ${outFile}`)
  if (!summary.allPassed) process.exit(1)
}

if (import.meta.main) await main()
