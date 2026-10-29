/**
 * BEAN Intelligence — CODE GIFTZ chat workspace library (pure functions).
 *
 * parse:  extract project files from a model response (```lang path=… fences).
 * diff:   line-level diff between the previous and new file content — the
 *         UI renders real changes only (never a fake "modified" claim).
 * entry:  sandbox entry-point detection for honest run attempts.
 */
import { diffLines } from 'diff'

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
 */
export function parseFiles(modelOutput: string): GiftzFile[] {
  const files: GiftzFile[] = []
  const fence = /```([\w+-]*)[ \t]*([^\n]*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = fence.exec(modelOutput)) !== null) {
    const lang = match[1] || ''
    const meta = (match[2] || '').trim()
    const content = match[3]
    const pathMatch = meta.match(/path=([\w.\-/ ]+)/)
    if (pathMatch) {
      const p = pathMatch[1].trim()
      if (p.length > 0 && content.trim().length > 0) files.push({ path: p, content })
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
