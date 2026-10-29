/**
 * BEAN Intelligence — CODE GIFTZ project-file planning (pure, deterministic).
 *
 * A conversational coding turn produces model output that may contain
 * `path=`-tagged fenced code blocks. This module decides, deterministically,
 * how the extracted blocks map onto the session's persisted project files:
 *
 *   - a path that did not exist            -> status "generated" (new file)
 *   - a path whose content changed         -> status "modified" (previous
 *                                             content kept for the diff view)
 *   - a path whose content is identical    -> untouched (no write, no churn)
 *
 * The model NEVER mutates the project implicitly: every change here originates
 * from a code block the model actually emitted this turn, and every status the
 * workspace displays is derived from this real comparison — never invented.
 */
import { extractFiles, assertSafeRelativePath } from '@/lib/sandbox/runner'

export interface PlannedFileChange {
  path: string
  content: string
  previousContent: string | null
  status: 'generated' | 'modified'
  version: number
}

export interface FilePlan {
  changes: PlannedFileChange[]
  /** Paths the model emitted that were rejected and why (reported honestly). */
  rejected: { path: string; reason: string }[]
}

/** Per-file and per-turn content budgets (bounded context, bounded writes). */
export const MAX_FILE_CHARS = 24_000
export const MAX_TURN_FILES = 12
/** Hard cap on distinct files in one session's project. */
export const MAX_SESSION_FILES = 25

/**
 * Map model-extracted files onto the current project state.
 * `current` is the persisted file set BEFORE this turn.
 */
export function planFileUpdates(
  current: { path: string; content: string; version: number }[],
  modelOutput: string,
): FilePlan {
  const changes: PlannedFileChange[] = []
  const rejected: { path: string; reason: string }[] = []
  const byPath = new Map(current.map((f) => [f.path, f]))
  const seen = new Set<string>()

  const blocks = extractFiles(modelOutput)
  for (const block of blocks) {
    if (changes.length + rejected.length >= MAX_TURN_FILES) {
      rejected.push({ path: block.path, reason: `Turn produced more than ${MAX_TURN_FILES} files; extra blocks were ignored.` })
      continue
    }
    if (seen.has(block.path)) {
      rejected.push({ path: block.path, reason: 'Duplicate path in one response — the last occurrence wins.' })
      // The last occurrence should win: drop the earlier planned change.
      const idx = changes.findIndex((c) => c.path === block.path)
      if (idx >= 0) changes.splice(idx, 1)
    }
    seen.add(block.path)

    try {
      assertSafeRelativePath(block.path)
    } catch (e) {
      rejected.push({ path: block.path, reason: (e as Error).message })
      continue
    }
    if (block.content.length > MAX_FILE_CHARS) {
      rejected.push({ path: block.path, reason: `File exceeds the ${MAX_FILE_CHARS}-character per-file limit.` })
      continue
    }

    const existing = byPath.get(block.path)
    if (!existing) {
      changes.push({ path: block.path, content: block.content, previousContent: null, status: 'generated', version: 1 })
    } else if (existing.content !== block.content) {
      changes.push({ path: block.path, content: block.content, previousContent: existing.content, status: 'modified', version: existing.version + 1 })
    }
    // identical content -> no-op: no churn, no false "modified" badge
  }
  return { changes, rejected }
}

/** Bounded serialisation of the project for the model context. */
export const MAX_CONTEXT_TOTAL_CHARS = 60_000

export interface ProjectContextResult {
  text: string
  /** Paths whose content was truncated or fully omitted in the context. */
  truncated: string[]
}

/**
 * Render the current project files as a fenced, path-tagged block for the
 * model. Smallest files are included first so the project stays coherent;
 * when the budget runs out, larger files are truncated or omitted and the
 * omissions are reported so the model (and the user) know the context is
 * partial.
 */
export function buildProjectContext(files: { path: string; content: string }[]): ProjectContextResult {
  if (files.length === 0) return { text: '', truncated: [] }
  const truncated: string[] = []
  let budget = MAX_CONTEXT_TOTAL_CHARS

  const ordered = [...files].sort((a, b) => a.content.length - b.content.length)
  const parts: string[] = []
  for (const f of ordered) {
    if (budget <= 200) {
      truncated.push(f.path)
      continue
    }
    let content = f.content
    if (content.length > MAX_FILE_CHARS) content = content.slice(0, MAX_FILE_CHARS)
    if (content.length > budget - 100) {
      content = content.slice(0, Math.max(0, budget - 100))
    }
    // Any loss against the original content is an honest, reported omission.
    if (content.length < f.content.length) truncated.push(f.path)
    budget -= content.length + f.path.length + 40
    const lang = fenceLangFor(f.path)
    const marker = content.length < f.content.length ? '\n... [truncated]' : ''
    parts.push('```' + lang + ' path=' + f.path + '\n' + content + marker + '\n```')
  }
  const text = 'Current project files:\n\n' + parts.join('\n\n')
  return { text, truncated }
}

function fenceLangFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx',
    py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown', sh: 'bash', yml: 'yaml', yaml: 'yaml',
  }
  return map[ext] ?? ''
}
