/**
 * M24 — shared live-validation helpers.
 *
 * Honesty rules carried over from the M21 eval runner:
 *  - every provider answer consumed here is generated LIVE (no mocks);
 *  - results are recorded as measured, never edited to force a pass;
 *  - credential values are never printed, logged or persisted.
 */

export const BASE_URL = (process.env.M24_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '')

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

export async function api(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.cookie ? { cookie: init.cookie } : {}),
  }
  if (init.headers) Object.assign(headers, init.headers)
  return fetch(`${BASE_URL}${path}`, { ...init, headers })
}

/** Register a dedicated validation account through the normal public API. */
export async function registerAccount(label: string): Promise<string> {
  const email = `giftz-m24-${label}-${Date.now()}@bean-eval.dev`
  const password = 'M24Validation2026x'
  const register = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name: 'CODE GIFTZ M24 Validation' }),
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

export interface SseTerminal extends Record<string, unknown> {
  done?: boolean
  error?: unknown
  code?: string
  message?: string
  changes?: Array<{ path: string; change: string; diff?: string }>
  versionSeq?: number
  fileOp?: {
    status: string
    kind?: string
    opId?: string
    planHash?: string
    source?: string[]
    destination?: string
    affectedFiles?: string[]
    conflicts?: string[]
    referenceImpact?: Array<{ file: string; kind: string; count?: number }>
    question?: string
    reason?: string
    consequence?: string
    result?: {
      opId: string
      kind: string
      applied: Array<{ path?: string; from?: string; to?: string; action: string }>
      failed: Array<{ path?: string; error?: string }>
      versionSeq: number | null
      verification?: { contentsPreserved: boolean; remainingReferences: number; detail: string }
      replayed?: boolean
      repairOffered?: { opId: string; planHash: string; affectedFiles: unknown[]; consequence: string } | null
    }
    versionSeq?: number
  }
  verification?: Record<string, unknown> | null
  projectId?: string
}

export interface TurnResult {
  deltas: string[]
  text: string
  terminal: SseTerminal | null
  projectId: string | null
  stages: string[]
  firstTokenMs: number | null
  durationMs: number
}

/** Consume one CODE GIFTZ SSE turn exactly like the product UI. */
export async function streamTurn(
  cookie: string,
  message: string,
  opts: { projectId?: string } = {},
): Promise<TurnResult> {
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
  const result: TurnResult = {
    deltas: [],
    text: '',
    terminal: null,
    projectId: opts.projectId ?? null,
    stages: [],
    firstTokenMs: null,
    durationMs: 0,
  }
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
      try {
        evt = JSON.parse(line.slice(6)) as Record<string, unknown>
      } catch {
        continue
      }
      if (typeof evt.delta === 'string') {
        if (result.firstTokenMs === null) result.firstTokenMs = Date.now() - t0
        result.deltas.push(evt.delta)
        result.text += evt.delta
      }
      if (typeof evt.stage === 'string') result.stages.push(evt.stage)
      if (typeof evt.projectId === 'string') result.projectId = evt.projectId
      if (evt.done || evt.error) {
        result.terminal = evt as SseTerminal
        done = true
      }
    }
  }
  result.durationMs = Date.now() - t0
  return result
}

export interface ProjectFile {
  path: string
  content: string
  origin: string
  updatedAt: string
}

export interface ProjectDetail {
  project: {
    id: string
    title: string
    status: string
    currentVersion: number
    lastOpenedAt: string | null
    files: ProjectFile[]
    messages: Array<{ id: string; role: string; content: string; metaJson: string | null; createdAt: string }>
  }
}

export async function getProject(cookie: string, id: string): Promise<ProjectDetail> {
  const res = await api(`/api/code-giftz/projects/${id}`, { cookie })
  if (!res.ok) throw new Error(`project fetch failed: HTTP ${res.status}`)
  return (await res.json()) as ProjectDetail
}

/** path → sha256(content) map of the live workspace. */
export function fileMapOf(project: ProjectDetail): Map<string, string> {
  return new Map(project.project.files.map((f) => [f.path, sha256(f.content)]))
}

/** Paths whose content differs between two hash maps. */
export function changedPaths(before: Map<string, string>, after: Map<string, string>): {
  modified: string[]
  added: string[]
  removed: string[]
} {
  const modified: string[] = []
  const added: string[] = []
  const removed: string[] = []
  for (const [p, h] of after) {
    if (!before.has(p)) added.push(p)
    else if (before.get(p) !== h) modified.push(p)
  }
  for (const p of before.keys()) if (!after.has(p)) removed.push(p)
  return { modified, added, removed }
}

export async function listVersions(cookie: string, id: string): Promise<{
  project?: { id: string; title: string; currentVersion: number }
  versions: Array<{
    seq: number
    kind: string
    summary: string | null
    fileCount: number
    contentHash: string
    changedFiles: Array<{ path: string; change: string }>
    createdAt: string
  }>
}> {
  const res = await api(`/api/code-giftz/projects/${id}/versions`, { cookie })
  if (!res.ok) throw new Error(`versions fetch failed: HTTP ${res.status}`)
  return (await res.json()) as never
}

/** Version detail carries the full file list (path+blobHash) and live integrity. */
export async function versionDetail(cookie: string, id: string, seq: number): Promise<{
  version: {
    seq: number
    kind: string
    fileCount: number
    integrity: { ok: boolean; detail: string }
    files: Array<{ path: string; blobHash: string; change: string }>
  }
}> {
  const res = await api(`/api/code-giftz/projects/${id}/versions/${seq}`, { cookie })
  if (!res.ok) throw new Error(`version detail fetch failed: HTTP ${res.status}`)
  return (await res.json()) as never
}

/** Non-throwing variant: null when the version does not exist (honest skip). */
export async function tryVersionDetail(cookie: string, id: string, seq: number): Promise<Awaited<ReturnType<typeof versionDetail>> | null> {
  try {
    return await versionDetail(cookie, id, seq)
  } catch {
    return null
  }
}

/** One historical file's exact content at a version. */
export async function versionFileContent(cookie: string, id: string, seq: number, path: string): Promise<string> {
  const res = await api(`/api/code-giftz/projects/${id}/versions/${seq}?file=${encodeURIComponent(path)}`, { cookie })
  if (!res.ok) throw new Error(`version file fetch failed: HTTP ${res.status}`)
  const data = (await res.json()) as { file: { content: string } }
  return data.file.content
}

export function check(name: string, passed: boolean, detail?: string): Check {
  return { name, passed, detail }
}

export function stepStatus(checks: Check[]): StepReport['status'] {
  return checks.length > 0 && checks.every((c) => c.passed) ? 'LIVE_VERIFIED' : 'FAILED'
}

export async function saveReport(name: string, payload: unknown): Promise<string> {
  const dir = new URL('../reports/', import.meta.url).pathname
  await Bun.$`mkdir -p ${dir}`.quiet()
  const file = `${dir}${name}.json`
  await Bun.write(file, JSON.stringify(payload, null, 2))
  return file
}
