/**
 * BEAN Intelligence — CODE GIFTZ response-format primitives (client-safe).
 *
 * Pure string logic shared by the browser (streaming visibility + editor
 * language hints) and the server. This module MUST stay free of Node-only
 * imports (no fs/child_process) because the chat workspace bundles it.
 */

export interface ParsedFile {
  path: string
  content: string
  lang: string
}

export const FENCE_RE = /```([\w+-]*)[ \t]*([^\n]*)\n([\s\S]*?)```/g

export const FENCE_INFO_PATH_RE = /(^|\s)path=([\w.\-/]+)/

/**
 * Streaming variant: given the ACCUMULATED text so far, return the portion
 * that is safe to show in the chat right now.
 *
 * Withholding rules:
 *  - an unclosed fence whose info line carries `path=` hides its body (the
 *    file streams into the workspace, not the chat);
 *  - a closed path-tagged fence is removed entirely;
 *  - everything else (ordinary prose + explanatory fences) is visible.
 *
 * The function is pure: it recomputes the visible prefix from scratch each
 * call, so partial fence-info lines (e.g. "```ht" not yet known to be a file)
 * are handled by withholding from the fence start — strictly leak-free.
 */
export function visibleChatPrefix(accumulated: string): string {
  // Fast path: no backticks at all.
  if (!accumulated.includes('```')) return accumulated

  let out = ''
  let idx = 0
  while (idx < accumulated.length) {
    const open = accumulated.indexOf('```', idx)
    if (open === -1) {
      out += accumulated.slice(idx)
      break
    }
    // Text before the fence stays visible.
    out += accumulated.slice(idx, open)
    const lineEnd = accumulated.indexOf('\n', open)
    const infoLine = lineEnd === -1 ? accumulated.slice(open + 3) : accumulated.slice(open + 3, lineEnd)
    if (lineEnd === -1) {
      // Info line not terminated yet: withhold the rest (could become a file).
      break
    }
    const isFile = FENCE_INFO_PATH_RE.test(infoLine)
    const close = accumulated.indexOf('\n```', lineEnd)
    if (isFile) {
      if (close === -1) {
        // File fence still streaming: withhold the body entirely.
        break
      }
      // Closed file fence: drop it, continue after the fence (and swallow
      // the single newline that terminated the fence line).
      idx = close + 4
      if (accumulated[idx] === '\n') idx += 1
    } else {
      // Ordinary (explanatory) fence — chat content. The info line is final
      // here, so the body streams as it arrives.
      if (close === -1) {
        out += accumulated.slice(open)
        break
      }
      out += accumulated.slice(open, close + 4)
      idx = close + 4
    }
  }
  return out
}

/** Filename-derived language hint for the syntax highlighter. */
export function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'tsx',
    jsx: 'jsx',
    py: 'python',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    sh: 'bash',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
    txt: 'text',
  }
  return map[ext] ?? 'text'
}

/** Extract a `path=` tag from a fence info line (shared parsing rule). */
export function pathFromFenceInfo(meta: string): string | null {
  const m = (meta ?? '').trim().match(/path=([\w.\-/]+)/)
  return m ? m[1] : null
}
