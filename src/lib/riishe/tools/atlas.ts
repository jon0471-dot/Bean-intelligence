/**
 * BEAN Intelligence — RIISHE world-knowledge atlas tools (M38 §E).
 *
 * Connects the curated, license-registered Markdown library under
 * `docs/knowledge-atlas/` to the EXISTING RIISHE tool loop. This is NOT a
 * second retrieval architecture: no vector database, no competing RAG
 * pipeline — the library is read directly, paged exactly like
 * `read_document`, and its sections enter the SAME citation universe as web
 * sources so answers can attribute atlas material precisely.
 *
 * Honesty rules:
 *  - the index is derived from the ACTUAL files at load time (cached per
 *    process) — it can never drift from reality;
 *  - when the library is unavailable (deployment without the docs tree) the
 *    tools say so honestly; nothing is synthesized;
 *  - search is deterministic (term overlap scoring) and reports real scores;
 *  - section citations use the atlas format `ATLAS-<id> §<n>` with the file
 *    path as locator.
 */
import { z } from 'zod'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import type { ToolDescriptor, ToolResult, ToolSource } from './types'

const MAX_SECTION_RESULTS = 4
const MAX_READ_CHARS = 4000
const MAX_OUTPUT_CHARS = 12_000

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[truncated at ${max} characters]` : text
}

// ---- library loading (live scan, cached per process) ------------------------

interface AtlasSection {
  n: number
  title: string
  /** Numbered heading text like "3. Object interaction". */
  heading: string
  body: string
}

export interface AtlasDoc {
  atlasId: string
  file: string
  title: string
  reviewDate: string | null
  sections: AtlasSection[]
}

interface AtlasLibrary {
  docs: AtlasDoc[]
  /** Non-null when the library directory exists but yielded no usable docs. */
  emptyReason: string | null
}

let cache: AtlasLibrary | null | undefined

/** Test hook — resets the per-process cache. */
export function resetAtlasCacheForTests(): void {
  cache = undefined
}

function atlasDir(): string {
  const override = process.env.BEAN_ATLAS_DIR
  return override ? resolveSafe(override) : join(process.cwd(), 'docs', 'knowledge-atlas')
}

function resolveSafe(p: string): string {
  return join(p)
}

function parseAtlasDoc(file: string, raw: string): AtlasDoc | null {
  const idMatch = raw.match(/Atlas ID:\s*(ATLAS-[A-Za-z0-9]+)/)
  if (!idMatch) return null
  const titleMatch = raw.match(/^# (.+)$/m)
  const reviewMatch = raw.match(/Review date:\s*(\d{4}-\d{2}-\d{2})/)
  const sections: AtlasSection[] = []
  const lines = raw.split('\n')
  let current: { n: number; title: string; heading: string; body: string[] } | null = null
  for (const line of lines) {
    const m = line.match(/^## (\d+)\. (.*)$/)
    if (m) {
      if (current) sections.push({ n: current.n, title: current.title, heading: current.heading, body: current.body.join('\n') })
      current = { n: Number(m[1]), title: m[2], heading: `${m[1]}. ${m[2]}`, body: [] }
    } else if (current) {
      current.body.push(line)
    }
  }
  if (current) sections.push({ n: current.n, title: current.title, heading: current.heading, body: current.body.join('\n') })
  if (!titleMatch) return null
  return {
    atlasId: idMatch[1],
    file,
    title: titleMatch[1].trim(),
    reviewDate: reviewMatch ? reviewMatch[1] : null,
    sections,
  }
}

export function loadAtlasLibrary(): AtlasLibrary | null {
  if (cache !== undefined) return cache
  const dir = atlasDir()
  if (!existsSync(dir)) {
    cache = null
    return cache
  }
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  } catch {
    cache = null
    return cache
  }
  const docs: AtlasDoc[] = []
  for (const f of files) {
    try {
      const parsed = parseAtlasDoc(f, readFileSync(join(dir, f), 'utf8'))
      if (parsed) docs.push(parsed)
    } catch {
      // unreadable file: skip it, never fabricate content for it
    }
  }
  cache = { docs, emptyReason: docs.length === 0 ? 'the atlas directory contains no parseable atlas documents' : null }
  return cache
}

function findDoc(library: AtlasLibrary, idOrFile: string): AtlasDoc | null {
  const needle = idOrFile.trim().toLowerCase()
  return (
    library.docs.find((d) => d.atlasId.toLowerCase() === needle) ??
    library.docs.find((d) => d.file.toLowerCase() === needle) ??
    library.docs.find((d) => basename(d.file).toLowerCase() === needle) ??
    null
  )
}

// ---- search_atlas ------------------------------------------------------------

const searchAtlasInput = z.object({
  query: z.string().min(2).max(300),
})

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'how', 'what', 'when', 'which', 'does', 'did', 'can', 'could', 'into', 'about', 'their', 'there', 'these', 'those', 'have', 'has', 'had', 'not', 'but', 'all', 'any', 'each', 'why', 'who', 'whom', 'its', 'his', 'her', 'our', 'your', 'you', 'they', 'them', 'than', 'then', 'more', 'most', 'some', 'such', 'only', 'also', 'very', 'just', 'like', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'being', 'been', 'because', 'while', 'where', 'between', 'both', 'over', 'under', 'after', 'before', 'use', 'using', 'used',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

interface SectionHit {
  doc: AtlasDoc
  section: AtlasSection | null
  score: number
}

/**
 * Deterministic scoring: title matches weigh most, then heading matches, then
 * body matches. Pure — no embeddings, no external service.
 */
export function scoreAtlasSections(library: AtlasLibrary, query: string): SectionHit[] {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  const hits: SectionHit[] = []
  for (const doc of library.docs) {
    const titleTokens = new Set(tokenize(doc.title))
    let titleScore = 0
    for (const t of tokens) if (titleTokens.has(t)) titleScore += 4
    if (doc.atlasId.toLowerCase() === query.trim().toLowerCase()) titleScore += 50
    for (const section of doc.sections) {
      const headingTokens = new Set(tokenize(section.heading))
      let headingScore = 0
      for (const t of tokens) if (headingTokens.has(t)) headingScore += 3
      const bodyText = section.body.toLowerCase()
      let bodyScore = 0
      for (const t of tokens) {
        // count word-boundary occurrences, capped per token to avoid long-section domination
        const matches = bodyText.match(new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*`, 'g'))
        bodyScore += Math.min(matches ? matches.length : 0, 5)
      }
      const score = titleScore + headingScore + bodyScore
      if (score > 0) hits.push({ doc, section, score })
    }
    if (titleScore > 0 && doc.sections.length === 0) {
      hits.push({ doc, section: null, score: titleScore })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, MAX_SECTION_RESULTS)
}

export const searchAtlasTool: ToolDescriptor<z.infer<typeof searchAtlasInput>> = {
  name: 'search_atlas',
  description:
    'Search BEAN\'s curated world-knowledge atlas (anatomy, biomechanics, human/animal movement, ' +
    'physics, chemistry, earth, astronomy, technology, design, AI/agent knowledge). ' +
    'Input: {"query": string}. Returns the top matching atlas sections with their citation refs. ' +
    'Use for established science and world knowledge; combine with web_search for current facts.',
  permission: 'standard',
  timeoutMs: 5_000,
  validate(input) {
    return searchAtlasInput.parse(input)
  },
  async execute({ query }): Promise<ToolResult> {
    const library = loadAtlasLibrary()
    if (!library || library.docs.length === 0) {
      return {
        ok: false,
        output: 'The knowledge atlas is not available in this deployment — no local knowledge documents can be consulted. Say this plainly and answer from other sources or state the gap.',
      }
    }
    const hits = scoreAtlasSections(library, query)
    if (hits.length === 0) {
      return {
        ok: true,
        output: `No atlas section matches "${query}". The atlas covers: ${library.docs.map((d) => d.atlasId).join(', ')}. The topic may be outside the atlas's coverage — that is a coverage gap, not proof the subject does not exist.`,
      }
    }
    const lines = hits.map((h) => {
      const ref = h.section ? `${h.doc.atlasId} §${h.section.n} — ${h.section.heading}` : `${h.doc.atlasId} — ${h.doc.title}`
      const firstLine = h.section ? h.section.body.split('\n').find((l) => l.trim().length > 0) ?? '' : ''
      return `[${ref}] (${h.doc.file}, score ${h.score}, review date ${h.doc.reviewDate ?? 'unrecorded'})\n   ${firstLine.slice(0, 220)}`
    })
    return {
      ok: true,
      output: clip(
        'BEAN KNOWLEDGE ATLAS — curated local reference (cite sections as ATLAS-<id> §<n>; ' +
          'content is reviewed and source-registered, but not exhaustive):\n\n' +
          lines.join('\n\n') +
          '\n\n(read a full section with read_atlas_doc {"atlasId": "ATLAS-<id>", "section": <n>})',
        MAX_OUTPUT_CHARS,
      ),
      sources: hits.map((h) => ({
        url: `docs/knowledge-atlas/${h.doc.file}`,
        title: h.section ? `${h.doc.atlasId} §${h.section.n} ${h.section.title}` : h.doc.title,
        hostName: 'bean-knowledge-atlas',
        date: h.doc.reviewDate,
        pageRead: true,
      })),
    }
  },
}

// ---- read_atlas_doc ----------------------------------------------------------

const readAtlasDocInput = z.object({
  atlasId: z.string().min(3).max(64),
  section: z.number().int().min(0).max(200).optional(),
  offset: z.number().int().min(0).max(1_000_000).default(0),
})

export const readAtlasDocTool: ToolDescriptor<z.infer<typeof readAtlasDocInput>> = {
  name: 'read_atlas_doc',
  description:
    'Read a portion of a world-knowledge atlas document. ' +
    'Input: {"atlasId": string ("ATLAS-06" or the filename), "section"?: number, "offset"?: number}. ' +
    'Returns ~4000 characters of the actual reviewed content. Cite as ATLAS-<id> §<n>.',
  permission: 'standard',
  timeoutMs: 5_000,
  validate(input) {
    return readAtlasDocInput.parse(input)
  },
  async execute({ atlasId, section, offset }): Promise<ToolResult> {
    const library = loadAtlasLibrary()
    if (!library || library.docs.length === 0) {
      return {
        ok: false,
        output: 'The knowledge atlas is not available in this deployment — no local knowledge documents can be consulted. Say this plainly.',
      }
    }
    const doc = findDoc(library, atlasId)
    if (!doc) {
      return {
        ok: false,
        output: `No atlas document matches "${atlasId}". Available: ${library.docs.map((d) => d.atlasId).join(', ')}.`,
      }
    }
    if (section !== undefined && section > 0) {
      const sec = doc.sections.find((s) => s.n === section)
      if (!sec) {
        return {
          ok: false,
          output: `ATLAS ${doc.atlasId} has no section ${section}. Sections: ${doc.sections.map((s) => s.n).join(', ')}.`,
        }
      }
      const text = `## ${sec.heading}\n${sec.body}`
      const slice = text.slice(offset, offset + MAX_READ_CHARS)
      const nextOffset = offset + slice.length
      const more = nextOffset < text.length ? `\n[more text remains in this section: call again with offset=${nextOffset}]` : '\n[end of section]'
      return {
        ok: true,
        output: clip(`ATLAS ${doc.atlasId} §${sec.n} (${doc.file}, review date ${doc.reviewDate ?? 'unrecorded'})\n\n${slice}${more}`, MAX_OUTPUT_CHARS),
        sources: [{ url: `docs/knowledge-atlas/${doc.file}`, title: `${doc.atlasId} §${sec.n} ${sec.title}`, hostName: 'bean-knowledge-atlas', date: doc.reviewDate, pageRead: true }],
      }
    }
    // whole-document paged read (sections annotated inline)
    const whole = `${doc.title}\nAtlas ID: ${doc.atlasId} · Review date: ${doc.reviewDate ?? 'unrecorded'}\n\n` + doc.sections.map((s) => `## ${s.heading}\n${s.body}`).join('\n\n')
    const slice = whole.slice(offset, offset + MAX_READ_CHARS)
    if (!slice) {
      return { ok: true, output: `Offset ${offset} is past the end of ${doc.atlasId} (${whole.length} characters total).` }
    }
    const nextOffset = offset + slice.length
    const more = nextOffset < whole.length ? `\n[more text remains: call again with offset=${nextOffset}]` : '\n[end of document]'
    return {
      ok: true,
      output: clip(`ATLAS ${doc.atlasId} (${doc.file})\n\n${slice}${more}`, MAX_OUTPUT_CHARS),
      sources: [{ url: `docs/knowledge-atlas/${doc.file}`, title: doc.title, hostName: 'bean-knowledge-atlas', date: doc.reviewDate, pageRead: true }],
    }
  },
}

/** Total atlas documents currently loadable (for diagnostics; null when unavailable). */
export function atlasDocCount(): number | null {
  const library = loadAtlasLibrary()
  return library ? library.docs.length : null
}

// re-export for orchestrator-level diagnostics without leaking internals
export type { ToolSource }
