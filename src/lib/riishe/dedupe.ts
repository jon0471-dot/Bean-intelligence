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

/** Headings, quotes, tables and list bullets keep their line structure. */
function isStructuralLine(line: string): boolean {
  return /^\s*(#|>|\|)/.test(line)
}

/**
 * Sentence splitter shared by the audits: split after ., !, ? but NOT after
 * a person-initial ("C. Joseph Vijay") — a single capital letter + period is
 * an abbreviation, not a sentence end.
 */
export function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])(?<![A-Z]\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
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
          if (isStructuralLine(line)) {
            // Structural lines dedupe as whole lines (exact repeats only).
            const key = normalizeSentence(line)
            if (key.length === 0) return line
            if (seenLines.has(key)) {
              removed += 1
              return null
            }
            seenLines.add(key)
            return line
          }
          // Prose line: dedupe at sentence granularity. Fragments with no
          // letters/digits at all (e.g. a bare citation marker left after a
          // duplicate was removed) carry no content and are dropped.
          const sentences = splitIntoSentences(line)
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
          if (kept.length === 0) return null // whole line was duplicates
          return kept.join(' ')
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
