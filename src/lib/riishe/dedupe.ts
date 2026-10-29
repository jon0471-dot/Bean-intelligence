/**
 * BEAN Intelligence — answer hygiene (pure, deterministic).
 *
 * Work-order evidence: a verification rewrite once repeated the same claim
 * several times in one answer. Duplicated contradictory-looking prose is a
 * reading defect even when each copy is individually grounded, so the
 * orchestrator removes EXACT duplicate sentences (normalized case and
 * punctuation) before verification and persistence.
 *
 * Scope guards: fenced code blocks, inline code, headings, table rows and
 * list bullets keep their structure — only their prose sentences dedupe.
 */

/** Protect code so transforms never corrupt it. */
export function splitProtected(content: string): Array<{ text: string; code: boolean }> {
  const parts: Array<{ text: string; code: boolean }> = []
  const re = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push({ text: content.slice(last, m.index), code: false })
    parts.push({ text: m[0], code: true })
    last = m.index + m[0].length
  }
  if (last < content.length) parts.push({ text: content.slice(last), code: false })
  return parts
}

function normalizeSentence(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[\d{1,2}(?:\s*,\s*\d{1,2})*\]/g, '') // citation markers don't distinguish copies
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Numbered list items ("1. ", "2) ") keep their line structure — deduped as
 * WHOLE LINES only. They must never flow through the prose splitter:
 * "2. First step" split as prose yields the fragments "2." + "First step",
 * and removing the duplicated fragment corrupts the numbering (measured
 * defect). Numbering is sequential semantics, so even an item whose text
 * repeats an earlier item stays (the repeat may be intentional restatement
 * under a new step).
 */
const NUMBERED_ITEM_RE = /^\s*\d{1,3}[.)]\s/

/**
 * Headings, quotes and table rows: structural, deduped as whole lines.
 */
function isStructuralLine(line: string): boolean {
  return /^\s*(#|>|\|)/.test(line)
}

/**
 * Sentence splitter shared by the audits: split after ., !, ? but NOT after
 * an abbreviation chain ("M.K. Stalin", "C. Joseph Vijay", "the U.S. government").
 *
 * Implementation: split on every sentence-ender, then MERGE fragments that
 * consist ONLY of single-capital initials ("M.", "K.", "U.S." -> "M.", "K.")
 * with the fragment that follows them. A lookbehind alone cannot express
 * this: `(?<![A-Z]\.)` correctly protects "M.K." but also wrongly glues
 * sentences ending in an acronym ("...leads the DMK. M.K. Stalin..." never
 * split, measured defect), while a "word-initial capital" guard is
 * ambiguous for exactly the initials this splitter exists to protect.
 */
export function splitIntoSentences(text: string): string[] {
  const pieces = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const out: string[] = []
  for (const piece of pieces) {
    const prev = out[out.length - 1]
    // A fragment that begins after an abbreviation boundary is a CONTINUATION,
    // not a new sentence. Two shapes are re-joined:
    //  - prev is purely an initial chain ("M.K." + "Stalin is ...");
    //  - prev ends with an abbreviation token ("The U.S." + "government ...",
    //    "See e.g." + "reports ...") — single letters/groups separated by
    //    periods cannot end a sentence. An acronym like "DMK." is a real
    //    final word (D,M,K before the period) and still ends the sentence.
    if (
      prev !== undefined &&
      /(?:^|\s)(?:[A-Za-z]\.)+$/.test(prev)
    ) {
      out[out.length - 1] = `${prev} ${piece}`
      continue
    }
    out.push(piece)
  }
  return out
}

/**
 * Remove exact duplicate sentences (whitespace/case/punctuation-insensitive)
 * and exact duplicate list items. First occurrence wins; later copies are
 * dropped. Returns the cleaned text and how many duplicates were removed.
 */
export function removeDuplicateSentences(content: string): { text: string; removed: number } {
  const seenSentences = new Set<string>()
  const seenLines = new Set<string>()
  let removed = 0

  const out = splitProtected(content)
    .map(({ text, code }) => {
      if (code) return text
      return text
        .split('\n')
        .map((line) => {
          if (line.trim().length === 0) return line
          if (isStructuralLine(line) || NUMBERED_ITEM_RE.test(line)) {
            // Structural lines and numbered items dedupe as whole lines
            // (exact repeats only) — never at fragment granularity.
            const key = normalizeSentence(line)
            if (key.length === 0) return line
            if (seenLines.has(key)) {
              removed += 1
              return null
            }
            seenLines.add(key)
            return line
          }
          // Bulleted items ("- point") keep their marker, but their CONTENT
          // joins the same sentence-dedupe space as prose: a bullet and a
          // later prose sentence repeating the same claim are duplicates.
          // Numbered items never reach this branch (see NUMBERED_ITEM_RE).
          const bullet = /^\s*[-*+]\s+/.exec(line)
          const body = bullet ? line.slice(bullet[0].length) : line
          const prefix = bullet ? bullet[0] : ''
          const sentences = splitIntoSentences(body)
          const kept: string[] = []
          for (const s of sentences) {
            const key = normalizeSentence(s)
            if (key.length === 0) continue
            if (seenSentences.has(key)) {
              removed += 1
              continue
            }
            seenSentences.add(key)
            kept.push(s)
          }
          if (kept.length === 0) {
            // Whole line was duplicates (or a bare citation marker left
            // after its duplicate was removed) — no content, drop it.
            return null
          }
          return prefix + kept.join(' ')
        })
        .filter((l) => l !== null)
        .join('\n')
    })
    .join('')

  if (removed === 0) return { text: content, removed: 0 }
  return { text: out.replace(/\n{3,}/g, '\n\n').trimEnd(), removed }
}

/**
 * Internal date-consistency audit: flags prose sentences that say the SAME
 * thing but give DIFFERENT dates/years (measured defect: "took office in May
 * 2026" and "took office in May 2021" in one answer). Detection is exact
 * year-stripped normalization — near-duplicates with differing years only.
 * Returns short display fragments for the verification note.
 */
export function findInternalDateConflicts(content: string): string[] {
  const groups = new Map<string, { years: Set<string>; example: string }>()
  for (const { text, code } of splitProtected(content)) {
    if (code) continue
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      if (line.length === 0 || isStructuralLine(line)) continue
      for (const sentence of splitIntoSentences(line)) {
        const years = sentence.match(/\b(?:19|20)\d{2}\b/g) ?? []
        if (years.length === 0) continue
        const skeleton = normalizeSentence(sentence).replace(/\b(?:19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim()
        if (skeleton.length < 15) continue
        const g = groups.get(skeleton) ?? { years: new Set<string>(), example: sentence }
        for (const y of years) g.years.add(y)
        groups.set(skeleton, g)
      }
    }
  }
  const conflicts: string[] = []
  for (const g of groups.values()) {
    if (g.years.size > 1) {
      const years = [...g.years].sort().join(', ')
      conflicts.push(`"${trim(g.example)}" appears with different dates (${years})`)
    }
  }
  return conflicts.slice(0, 2)
}

function trim(s: string): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > 100 ? `${clean.slice(0, 97).trimEnd()}...` : clean
}
