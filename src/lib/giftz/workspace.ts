/**
 * BEAN Intelligence — CODE GIFTZ chat workspace library (pure functions).
 *
 * parse:  extract project files from a model response (```lang path=… fences).
 * diff:   line-level diff between the previous and new file content — the
 *         UI renders real changes only (never a fake "modified" claim).
 * entry:  sandbox entry-point detection for honest run attempts.
 */
import { diffLines } from 'diff'
import { db } from '@/lib/db'

export interface GiftzFile {
  path: string
  content: string
}

/** Only safe relative paths inside a project workspace are allowed. */
export function assertSafeProjectPath(p: string): void {
  if (!p || p.length > 200) throw new Error('Invalid project file path.')
  if (p.includes('..') || p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) {
    throw new Error(`Unsafe project file path rejected: ${p.slice(0, 80)}`)
  }
  if (/[^\w.\-/ ]/.test(p)) {
    throw new Error(`Project file path contains disallowed characters: ${p.slice(0, 80)}`)
  }
}

/**
 * Extract files from a model response. Expected (prompted) format:
 *   ```lang path=src/app.js
 * Fallback: a single unlabeled fence becomes main.<ext> so simple one-file
 * answers still produce a real, runnable project file.
 *
 * Model robustness (M39): some models place the path directive on the FIRST
 * LINE INSIDE the fence (`path=fizzbuzz.py`) instead of the fence meta. That
 * is an explicit delivery intent — honoring it (directive consumed, code
 * lands at the named path) makes the delivery real instead of leaking the
 * directive into the file body. A `path=` line that is NOT the first line
 * stays ordinary content.
 */
export function parseFiles(modelOutput: string): GiftzFile[] {
  const files: GiftzFile[] = []
  const fence = /```([\w+-]*)[ \t]*([^\n]*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = fence.exec(modelOutput)) !== null) {
    const lang = match[1] || ''
    const meta = (match[2] || '').trim()
    const pathMatch = meta.match(/path=([\w.\-/ ]+)/)
    let path: string | null = pathMatch ? pathMatch[1].trim() : null
    let content = match[3]
    if (!path) {
      const inline = content.match(/^\s*path=([\w.\-/ ]+)[ \t]*\r?\n/)
      if (inline) {
        path = inline[1].trim()
        content = content.slice(inline[0].length)
      }
    }
    if (path) {
      if (path.length > 0 && content.trim().length > 0) files.push({ path, content })
    } else if (files.length === 0 && content.trim().length > 0) {
      const ext =
        { javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', html: 'html', css: 'css', json: 'json' }[
          lang.toLowerCase()
        ] ?? 'js'
      files.push({ path: `main.${ext}`, content })
    }
  }
  // de-duplicate by path (later wins — the last block is the final word)
  const byPath = new Map<string, string>()
  for (const f of files) byPath.set(f.path, f.content)
  return [...byPath.entries()].map(([path, content]) => ({ path, content }))
}

export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
}

/** Line diff between previous and next content (bounded to keep payloads sane). */
export function diffContent(previous: string | null, next: string): DiffLine[] {
  const parts = diffLines(previous ?? '', next)
  const out: DiffLine[] = []
  let count = 0
  const MAX = 800
  for (const part of parts) {
    const type: DiffLine['type'] = part.added ? 'add' : part.removed ? 'del' : 'ctx'
    for (const line of part.value.replace(/\n$/, '').split('\n')) {
      if (count >= MAX) return [...out, { type: 'ctx', text: '… diff truncated (too many changes) …' }]
      out.push({ type, text: line })
      count += 1
    }
  }
  return out
}

/** Pick the sandbox entry file: exact conventions first, then first runnable. */
export function pickEntryFile(paths: string[]): string | null {
  const conventions = ['main.js', 'index.js', 'app.js', 'main.ts', 'index.ts', 'main.py', 'index.html']
  for (const c of conventions) {
    if (paths.includes(c)) return c
  }
  const runnable = paths.find((p) => /\.(js|ts|py)$/.test(p))
  return runnable ?? null
}

/**
 * Apply extracted files to a project; returns the honest change list
 * (added/modified with REAL diffs; an identical file is a no-op that is
 * reported as nothing). Shared by the live SSE route and the background
 * coding worker. (Moved here 2026-11-07 from the chat route.)
 *
 * Application is PER-FILE, not transactional: a mid-loop failure leaves the
 * earlier files of this turn applied. That truth is carried on
 * WorkspaceApplyError so a caller (e.g. the background Trust receipt) can
 * record exactly which mutations happened — never claiming an untouched
 * workspace it cannot prove.
 */
export interface AppliedFileChange {
  path: string
  change: 'added' | 'modified'
  diff: ReturnType<typeof diffContent>
}

export class WorkspaceApplyError extends Error {
  /** Changes actually persisted before the failure (may be empty). */
  readonly appliedSoFar: AppliedFileChange[]
  /** The file whose application failed (null for non-path failures). */
  readonly failedPath: string | null
  constructor(message: string, appliedSoFar: AppliedFileChange[], failedPath: string | null) {
    super(message)
    this.name = 'WorkspaceApplyError'
    this.appliedSoFar = appliedSoFar
    this.failedPath = failedPath
  }
}

export async function applyFiles(
  projectId: string,
  extracted: GiftzFile[],
): Promise<AppliedFileChange[]> {
  const changes: AppliedFileChange[] = []
  let currentPath: string | null = null
  try {
    for (const f of extracted) {
      currentPath = f.path
      assertSafeProjectPath(f.path)
      const existing = await db.codeFile.findUnique({
        where: { projectId_path: { projectId, path: f.path } },
      })
      if (existing && existing.content === f.content) continue // no change — say nothing
      const diff = diffContent(existing?.content ?? null, f.content)
      if (existing) {
        await db.codeFile.update({ where: { id: existing.id }, data: { content: f.content, origin: 'modified' } })
        changes.push({ path: f.path, change: 'modified', diff })
      } else {
        await db.codeFile.create({ data: { projectId, path: f.path, content: f.content, origin: 'generated' } })
        changes.push({ path: f.path, change: 'added', diff })
      }
      currentPath = null
    }
  } catch (e) {
    // Wrap WITHOUT changing the observable behavior for callers that treat
    // this as a plain Error — the applied-so-far truth rides along for the
    // Trust receipt.
    const message = e instanceof Error ? e.message : String(e)
    throw new WorkspaceApplyError(message, changes, currentPath)
  }
  return changes
}
