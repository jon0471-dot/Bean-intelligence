/**
 * BEAN Intelligence — CODE GIFTZ line diff (LCS-based, dependency-free).
 *
 * Produces honest, reviewable diffs between the previous and next content of
 * a file. Used when a follow-up chat request modifies existing project
 * files: the workspace shows WHAT changed, not just the new content.
 */

export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
  /** 1-based line number in the OLD file (del/ctx only). */
  oldLine?: number
  /** 1-based line number in the NEW file (add/ctx only). */
  newLine?: number
}

export interface DiffResult {
  lines: DiffLine[]
  added: number
  removed: number
}

const MAX_DIFF_INPUT_LINES = 4_000

/**
 * LCS line diff. For very large files the diff degrades gracefully to a
 * replace summary (whole-file remove + add) rather than hanging the turn —
 * the result stays honest (it describes the real change shape).
 */
export function diffLines(oldText: string, newText: string): DiffResult {
  // Empty-file edge cases: an empty old file is a pure addition (its
  // split('\n') artifact [''] is not a real line), and vice versa.
  if (oldText === '' && newText === '') return { lines: [], added: 0, removed: 0 }
  if (oldText === '') {
    const b = newText.split('\n')
    return {
      lines: b.map((text, i): DiffLine => ({ type: 'add', text, newLine: i + 1 })),
      added: b.length,
      removed: 0,
    }
  }
  if (newText === '') {
    const a = oldText.split('\n')
    return {
      lines: a.map((text, i): DiffLine => ({ type: 'del', text, oldLine: i + 1 })),
      added: 0,
      removed: a.length,
    }
  }
  const a = oldText.split('\n')
  const b = newText.split('\n')
  if (a.length > MAX_DIFF_INPUT_LINES || b.length > MAX_DIFF_INPUT_LINES) {
    return {
      lines: [
        ...a.map((text, i): DiffLine => ({ type: 'del', text, oldLine: i + 1 })),
        ...b.map((text, i): DiffLine => ({ type: 'add', text, newLine: i + 1 })),
      ],
      added: b.length,
      removed: a.length,
    }
  }

  // LCS dynamic programming table (trimmed: skip common prefix/suffix first).
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let sufA = a.length
  let sufB = b.length
  while (sufA > pre && sufB > pre && a[sufA - 1] === b[sufB - 1]) {
    sufA--
    sufB--
  }
  const midA = a.slice(pre, sufA)
  const midB = b.slice(pre, sufB)

  const m = midA.length
  const n = midB.length
  // (m+1)*(n+1) table of numbers; fine up to a few thousand lines.
  const dp: Uint32Array = new Uint32Array((m + 1) * (n + 1))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i * (n + 1) + j] =
        midA[i] === midB[j]
          ? dp[(i + 1) * (n + 1) + j + 1] + 1
          : Math.max(dp[(i + 1) * (n + 1) + j], dp[i * (n + 1) + j + 1])
    }
  }

  const lines: DiffLine[] = []
  for (let i = 0; i < pre; i++) lines.push({ type: 'ctx', text: a[i], oldLine: i + 1, newLine: i + 1 })
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (midA[i] === midB[j]) {
      lines.push({ type: 'ctx', text: midA[i], oldLine: pre + i + 1, newLine: pre + j + 1 })
      i++
      j++
    } else if (dp[(i + 1) * (n + 1) + j] >= dp[i * (n + 1) + j + 1]) {
      lines.push({ type: 'del', text: midA[i], oldLine: pre + i + 1 })
      i++
    } else {
      lines.push({ type: 'add', text: midB[j], newLine: pre + j + 1 })
      j++
    }
  }
  while (i < m) {
    lines.push({ type: 'del', text: midA[i], oldLine: pre + i + 1 })
    i++
  }
  while (j < n) {
    lines.push({ type: 'add', text: midB[j], newLine: pre + j + 1 })
    j++
  }
  for (let k = 0; k < a.length - sufA; k++) {
    lines.push({
      type: 'ctx',
      text: a[sufA + k],
      oldLine: sufA + k + 1,
      newLine: sufB + k + 1,
    })
  }

  const added = lines.filter((l) => l.type === 'add').length
  const removed = lines.filter((l) => l.type === 'del').length
  return { lines, added, removed }
}

/** Cap the stored diff size for very large changes (honest truncation flag). */
export function compactDiff(diff: DiffResult, maxLines = 400): DiffResult & { truncated?: boolean } {
  if (diff.lines.length <= maxLines) return diff
  return {
    lines: diff.lines.slice(0, maxLines),
    added: diff.added,
    removed: diff.removed,
    truncated: true,
  }
}
