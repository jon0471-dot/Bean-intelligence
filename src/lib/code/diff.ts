/**
 * BEAN Intelligence — minimal line diff for the CODE GIFTZ workspace.
 *
 * Produces a unified-diff-shaped structure (context / added / removed rows)
 * used by the workspace "Diff" view for modified files. Pure function, no
 * dependencies — an LCS-based alignment is fine at workspace file sizes
 * (capped at 24k chars per file upstream).
 */

export interface DiffRow {
  type: 'context' | 'add' | 'del'
  text: string
  /** 1-based line numbers in the old/new file where applicable. */
  oldLine?: number
  newLine?: number
}

/**
 * Collapse long runs of unchanged lines: keep up to `context` rows around
 * each change block, replacing the rest with a gap marker.
 */
export interface HunkGap {
  type: 'gap'
  count: number
}
export type DiffChunk = DiffRow | HunkGap

const MAX_DIFF_LINES = 2_000

/** Full row-level diff between two file versions (newline-split). */
export function diffLines(before: string, after: string): DiffRow[] {
  const a = before.split('\n')
  const b = after.split('\n')
  // Guard against pathological sizes (files are capped upstream; this is a
  // second, cheap tripwire).
  if (a.length * b.length > 4_000_000) {
    return [
      { type: 'del', text: `(previous version: ${a.length} lines)` },
      { type: 'add', text: `(new version: ${b.length} lines)` },
    ]
  }

  // LCS table (dynamic programming).
  const m = a.length
  const n = b.length
  const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  let oldLine = 1
  let newLine = 1
  while (i < m && j < n && rows.length < MAX_DIFF_LINES) {
    if (a[i] === b[j]) {
      rows.push({ type: 'context', text: a[i], oldLine: oldLine++, newLine: newLine++ })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: a[i], oldLine: oldLine++ })
      i++
    } else {
      rows.push({ type: 'add', text: b[j], newLine: newLine++ })
      j++
    }
  }
  while (i < m && rows.length < MAX_DIFF_LINES) rows.push({ type: 'del', text: a[i++], oldLine: oldLine++ })
  while (j < n && rows.length < MAX_DIFF_LINES) rows.push({ type: 'add', text: b[j++], newLine: newLine++ })
  return rows
}

/** Diff with unchanged middle runs collapsed to gap markers. */
export function compactDiff(before: string, after: string, context = 3): DiffChunk[] {
  const rows = diffLines(before, after)
  if (rows.length <= 24) return rows

  const changed = rows.map((r) => r.type !== 'context')
  const keep = new Array(rows.length).fill(false)
  let last = -1
  for (let k = 0; k < rows.length; k++) {
    if (!changed[k]) continue
    const start = last < 0 ? 0 : Math.max(0, last + 1)
    for (let t = Math.max(start, k - context); t <= Math.min(rows.length - 1, k + context); t++) keep[t] = true
    last = k
  }
  // keep a tail anchor so a trailing addition reads naturally
  if (last >= 0) {
    for (let t = last + 1; t <= Math.min(rows.length - 1, last + context); t++) keep[t] = true
  }

  const out: DiffChunk[] = []
  let gap = 0
  for (let k = 0; k < rows.length; k++) {
    if (keep[k]) {
      if (gap > 0) {
        out.push({ type: 'gap', count: gap })
        gap = 0
      }
      out.push(rows[k])
    } else {
      gap++
    }
  }
  if (gap > 0) out.push({ type: 'gap', count: gap })
  return out
}

/** Real change stats — derived from the diff, never guessed. */
export function diffStats(before: string, after: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of diffLines(before, after)) {
    if (row.type === 'add') added++
    else if (row.type === 'del') removed++
  }
  return { added, removed }
}
