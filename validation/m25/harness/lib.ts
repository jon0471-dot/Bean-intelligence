/**
 * M25 — shared live-validation helpers (same honesty rules as M24's harness):
 *  - every provider answer consumed here is generated LIVE (no mocks);
 *  - results are recorded as measured, never edited to force a pass;
 *  - credential values are never printed, logged or persisted.
 */
export const BASE_URL = (process.env.M25_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')

export type Check = { name: string; passed: boolean; detail?: string }

export type StepReport = {
  id: string
  title: string
  status: 'LIVE_VERIFIED' | 'OFFLINE_VERIFIED' | 'BLOCKED' | 'FAILED' | 'NOT_TESTED'
  startedAt: string
  finishedAt?: string
  durationMs?: number
  checks: Check[]
  data: Record<string, unknown>
}

export function sha256(text: string): string {
  return new Bun.CryptoHasher('sha256').update(text).digest('hex')
}

export function newStep(id: string, title: string): StepReport {
  return { id, title, status: 'NOT_TESTED', startedAt: new Date().toISOString(), checks: [], data: {} }
}

export function check(name: string, passed: boolean, detail?: string): Check {
  return { name, passed, detail }
}

export function finish(step: StepReport): StepReport {
  step.finishedAt = new Date().toISOString()
  step.durationMs = Date.parse(step.finishedAt) - Date.parse(step.startedAt)
  step.status = step.checks.length > 0 && step.checks.every((c) => c.passed) ? 'LIVE_VERIFIED' : step.checks.length > 0 ? 'FAILED' : 'NOT_TESTED'
  return step
}

export function stepStatus(checks: Check[]): StepReport['status'] {
  if (checks.length === 0) return 'NOT_TESTED'
  return checks.every((c) => c.passed) ? 'LIVE_VERIFIED' : 'FAILED'
}

export async function api(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.cookie ? { cookie: init.cookie } : {}),
  }
  if (init.headers) Object.assign(headers, init.headers)
  return fetch(`${BASE_URL}${path}`, { ...init, headers })
}

/** Register a dedicated validation account through the normal public API. */
export async function registerAccount(label: string): Promise<string> {
  const email = `giftz-m25-${label}-${Date.now()}@bean-eval.dev`
  const password = 'M25Validation2026x'
  const register = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name: 'CODE GIFTZ M25 Validation' }),
  })
  if (register.ok) {
    const cookie = register.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    if (cookie) return cookie
    throw new Error('register succeeded but no session cookie was set')
  }
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (login.ok) {
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    if (cookie) return cookie
  }
  throw new Error(`auth failed: register ${register.status}, login ${login.status}`)
}

export async function createProject(cookie: string, title: string): Promise<string> {
  const res = await api('/api/code-giftz/projects', { method: 'POST', cookie, body: JSON.stringify({ title }) })
  const d = (await res.json()) as { ok?: boolean; project?: { id: string }; error?: { message: string } }
  if (!res.ok || !d.project?.id) throw new Error(`create project failed: ${res.status} ${JSON.stringify(d).slice(0, 200)}`)
  return d.project.id
}

export async function saveFile(cookie: string, projectId: string, path: string, content: string): Promise<void> {
  const res = await api(`/api/code-giftz/projects/${projectId}/files`, { method: 'POST', cookie, body: JSON.stringify({ path, content }) })
  if (!res.ok) throw new Error(`save file ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
}

export async function getProject(cookie: string, projectId: string): Promise<{ files: Array<{ path: string; content: string }>; messages: Array<{ id: string; role: string; content: string; refactor?: RefactorPayload }> }> {
  const res = await api(`/api/code-giftz/chat/${projectId}`, { cookie })
  const d = (await res.json()) as { project?: { files: Array<{ path: string; content: string }>; messages: Array<{ id: string; role: string; content: string; refactor?: RefactorPayload }> }; error?: { message: string } }
  if (!res.ok || !d.project) throw new Error(`get project failed: ${res.status}`)
  return d.project
}

export function fileMapOf(files: Array<{ path: string; content: string }>): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.content]))
}

// ---- refactoring payloads ----------------------------------------------------

export interface RefactorPayload {
  status: 'awaiting_confirmation' | 'executed' | 'rejected' | 'clarification' | 'failed'
  kind?: string
  opId?: string
  planHash?: string
  title?: string
  engine?: 'deterministic' | 'provider-assisted'
  reason?: string
  steps?: string[]
  affectedFiles?: string[]
  createdPaths?: string[]
  editsPreview?: Array<{ path: string; changeType: string; addedLines: number; removedLines: number }>
  risks?: string[]
  unresolved?: Array<{ path: string; specifier: string; note: string }>
  question?: string
  consequence?: string
  versionSeq?: number | null
  result?: {
    opId: string
    kind: string
    status: string
    applied: Array<{ path: string; action: string }>
    failed: Array<{ path: string; reason: string }>
    versionSeq: number | null
    verification: { contentsPreserved: boolean; unresolvedImports: number; duplicateExports: Array<{ name: string; paths: string[] }>; integrityDetail: string }
    replayed?: boolean
  }
}

export interface SseTerminal extends Record<string, unknown> {
  done?: boolean
  error?: unknown
  code?: string
  changes?: Array<{ path: string; change: string }>
  versionSeq?: number
  fileOp?: {
    status: string
    kind?: string
    opId?: string
    result?: {
      opId: string
      kind: string
      applied: Array<{ path?: string; from?: string; to?: string; action: string }>
      failed: Array<{ path?: string; reason?: string }>
      versionSeq: number | null
      verification?: { contentsPreserved: boolean; remainingReferences: number; detail: string }
      repairOffered?: { opId: string; planHash: string; affectedFiles: Array<{ path: string; lines: number[]; sample: string }>; consequence: string } | null
    }
  }
  refactor?: RefactorPayload
}

export interface TurnResult {
  deltas: string[]
  text: string
  terminal: SseTerminal | null
  projectId: string | null
  firstTokenMs: number | null
  durationMs: number
}

/** Consume one CODE GIFTZ SSE turn exactly like the product UI. */
export async function streamTurn(cookie: string, message: string, opts: { projectId?: string } = {}): Promise<TurnResult> {
  const t0 = Date.now()
  const res = await api('/api/code-giftz/chat?stream=1', {
    method: 'POST',
    body: JSON.stringify(opts.projectId ? { projectId: opts.projectId, message } : { message }),
    cookie,
  })
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`chat request failed: HTTP ${res.status}: ${detail.slice(0, 300)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const result: TurnResult = { deltas: [], text: '', terminal: null, projectId: opts.projectId ?? null, firstTokenMs: null, durationMs: 0 }
  let done = false
  while (!done) {
    const { done: streamDone, value } = await reader.read()
    if (streamDone) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      try {
        const evt = JSON.parse(line.slice(6)) as Record<string, unknown>
        if (typeof evt.delta === 'string') {
          if (result.firstTokenMs === null) result.firstTokenMs = Date.now() - t0
          result.deltas.push(evt.delta)
          result.text += evt.delta
        }
        if (evt.done) {
          result.terminal = evt as SseTerminal
          if (typeof evt.projectId === 'string') result.projectId = evt.projectId
          done = true
        }
        if (evt.error) {
          result.terminal = evt as SseTerminal
          done = true
        }
      } catch {
        /* keepalive comment or partial frame */
      }
    }
  }
  result.durationMs = Date.now() - t0
  return result
}

/** The app's own post-429 circuit breaker holds calls for this long. */
export const UPSTREAM_429_COOLDOWN_MS = 60_000

export const isRateLimited = (t: { terminal?: { code?: string; error?: unknown } | null }): boolean =>
  String(t.terminal?.code ?? '').toUpperCase().includes('RATE_LIMITED') || String(t.terminal?.error ?? '').toUpperCase().includes('RATE_LIMITED')

/** Stream one live turn, retrying ONLY the upstream-throttle failure class. */
export async function liveTurn(cookie: string, message: string, opts: { projectId?: string } = {}): Promise<TurnResult> {
  let turn = await streamTurn(cookie, message, opts)
  for (let attempt = 1; attempt <= 2 && isRateLimited(turn); attempt++) {
    console.log(`    upstream 429 — waiting ${UPSTREAM_429_COOLDOWN_MS / 1000 + 5}s, then retrying live (${attempt}/2)`)
    await new Promise((r) => setTimeout(r, UPSTREAM_429_COOLDOWN_MS + 5_000))
    turn = await streamTurn(cookie, message, opts)
  }
  return turn
}

/** Execute a refactoring through the shared confirmation endpoint. */
export async function executeRefactor(cookie: string, projectId: string, opId: string): Promise<{ ok: boolean; result?: RefactorPayload['result']; error?: string }> {
  const res = await api(`/api/code-giftz/projects/${projectId}/file-ops/execute`, { method: 'POST', cookie, body: JSON.stringify({ opId }) })
  const d = (await res.json()) as { ok?: boolean; result?: RefactorPayload['result']; error?: { message: string } }
  if (!res.ok || !d.result) return { ok: false, error: d.error?.message ?? `HTTP ${res.status}` }
  return { ok: true, result: d.result }
}

export async function cancelRefactor(cookie: string, projectId: string, opId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await api(`/api/code-giftz/projects/${projectId}/file-ops/cancel`, { method: 'POST', cookie, body: JSON.stringify({ opId }) })
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
  return { ok: true }
}

export async function listVersions(cookie: string, projectId: string): Promise<Array<{ seq: number; kind: string; summary: string | null; contentHash: string; fileCount: number }>> {
  const res = await api(`/api/code-giftz/projects/${projectId}/versions`, { cookie })
  const d = (await res.json()) as { versions?: Array<{ seq: number; kind: string; summary: string | null; contentHash: string; fileCount: number }> }
  return d.versions ?? []
}

export async function rollbackTo(cookie: string, projectId: string, seq: number): Promise<{ ok: boolean; newVersion?: number; error?: string }> {
  const res = await api(`/api/code-giftz/projects/${projectId}/versions/${seq}/rollback`, { method: 'POST', cookie })
  const d = (await res.json()) as { ok?: boolean; rollback?: { newVersion?: { seq: number } | null }; error?: { message: string } }
  if (!res.ok) return { ok: false, error: d.error?.message ?? `HTTP ${res.status}` }
  return { ok: true, newVersion: d.rollback?.newVersion?.seq ?? undefined }
}

export async function exportProject(cookie: string, projectId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const res = await api(`/api/code-giftz/projects/${projectId}/export`, { cookie })
  if (!res.ok) throw new Error(`export failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const filename = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'export.zip'
  return { bytes, filename }
}

export function saveReport(name: string, data: unknown): void {
  const dir = new URL('../reports/', import.meta.url).pathname
  Bun.write(dir + name, JSON.stringify(data, null, 2))
  console.log(`  report saved: validation/m25/reports/${name}`)
}
