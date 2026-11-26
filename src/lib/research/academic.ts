/**
 * BEAN Intelligence — M42 universal web research: official scholarly and
 * package-registry adapters (direct lane).
 *
 * ONE decision record per adapter (spec §13 M42.3): fixed allowlisted hosts,
 * official public APIs, no credentials, bounded timeouts/bytes, honest
 * degradation. Fields are passed through EXACTLY as the API supplies them —
 * missing dates/authors/DOIs stay null (never invented). Preprints are
 * labeled as preprints (arXiv), never as peer-reviewed publications.
 *
 * Adapters:
 *  - Crossref  — DOI metadata (title/author/issued/container/DOI URL).     (api.crossref.org)
 *  - OpenAlex  — scholarly work discovery (title/authors/year/doi/landing).(api.openalex.org)
 *  - arXiv     — preprint metadata (title/authors/published/abs URL).      (export.arxiv.org)
 *  - DOAJ      — open-access article metadata (title/authors/date/doi).    (doaj.org)
 *  - npm       — package manifest (latest version/license/homepage).       (registry.npmjs.org)
 *  - PyPI      — package metadata (version/license/homepage).              (pypi.org)
 *
 * All adapters are SERVER-ONLY and reuse the shared `directFetch` boundary
 * (SSRF guard, redirect re-validation, timeouts, UA policy). A failure is
 * honest: typed errors surface as degraded notes in the calling lane.
 */

import { directFetch } from './direct'
import { ResearchToolError } from './provider'
import type { RankedSource } from './rank'

/** Fixed host allowlist — a redirect to any other host invalidates the item. */
export const ACADEMIC_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'api.crossref.org',
  'api.openalex.org',
  'export.arxiv.org',
  'doaj.org',
  'registry.npmjs.org',
  'pypi.org',
])

const ACADEMIC_UA = 'BEAN-Research/1.0 (universal reference access; respectful pooled use)'

interface AcademicItem {
  url: string
  title: string
  snippet: string
  hostName: string
  rank: number
  date: string | null
  author: string | null
  /** Honesty marker carried into provenance notes by the calling lane. */
  preprint: boolean
}

function boundedText(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null
}

async function academicFetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const guard = await assertHostAllowed(url)
  const res = await directFetch(guard, timeoutMs, {
    'user-agent': ACADEMIC_UA,
    accept: 'application/json',
  })
  if (!res.text || res.text.length === 0) {
    throw new ResearchToolError('direct_fetch', `empty response from ${hostOf(guard)}`)
  }
  try {
    return JSON.parse(res.text)
  } catch {
    throw new ResearchToolError('direct_fetch', `unparseable JSON from ${hostOf(guard)}`)
  }
}

/**
 * THE runtime host guard every adapter call passes through before any
 * network I/O (exported for direct structural tests — the pure set test
 * alone cannot catch a broken reference here, as measured in the field).
 */
export async function assertAcademicHostAllowed(url: string): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new ResearchToolError('direct_fetch', `invalid academic API URL: ${url.slice(0, 80)}`)
  }
  if (parsed.protocol !== 'https:' || !ACADEMIC_ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new ResearchToolError('direct_fetch', `academic adapter host not allowlisted: ${parsed.hostname}`)
  }
  return parsed.toString()
}

const assertHostAllowed = assertAcademicHostAllowed

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'unknown'
  }
}

function toDate(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length >= 4) return v.trim().slice(0, 25)
  // Crossref "issued" date-parts: [[2024, 3, 12]]
  if (Array.isArray(v) && Array.isArray(v[0]) && typeof v[0][0] === 'number') {
    const parts = v[0] as number[]
    return parts.length > 0 ? `${parts[0]}${parts[1] ? `-${String(parts[1]).padStart(2, '0')}` : ''}${parts[2] ? `-${String(parts[2]).padStart(2, '0')}` : ''}` : null
  }
  return null
}

// ---------------------------------------------------------------------------
// Crossref — DOI metadata (official public API; polite pool via UA contact)
// ---------------------------------------------------------------------------

export async function crossrefSearch(query: string, timeoutMs = 8_000, rows = 4): Promise<AcademicItem[]> {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(query.slice(0, 220))}&rows=${Math.min(Math.max(rows, 1), 5)}&select=DOI,title,author,issued,container-title,URL`
  const data = (await academicFetchJson(url, timeoutMs)) as { message?: { items?: Array<Record<string, unknown>> } }
  const items = data.message?.items ?? []
  return items.map((it, i) => {
    const title = boundedText(Array.isArray(it.title) ? it.title[0] : it.title, 260) ?? 'Untitled work'
    const doi = boundedText(it.DOI, 160)
    const authors = Array.isArray(it.author)
      ? (it.author as Array<Record<string, unknown>>)
          .map((a) => boundedText(a.family ?? a.name, 60))
          .filter((v): v is string => !!v)
          .slice(0, 3)
          .join(', ') || null
      : null
    return {
      url: doi ? `https://doi.org/${doi}` : boundedText(it.URL, 300) ?? `https://api.crossref.org/works?query=${encodeURIComponent(query.slice(0, 40))}`,
      title,
      snippet: boundedText(Array.isArray(it['container-title']) ? (it['container-title'] as string[])[0] : null, 140)
        ? `published in ${boundedText(Array.isArray(it['container-title']) ? (it['container-title'] as string[])[0] : null, 140)}`
        : 'Crossref DOI metadata record',
      hostName: 'doi.org',
      rank: i + 1,
      date: toDate(it.issued),
      author: authors,
      preprint: false,
    }
  })
}

// ---------------------------------------------------------------------------
// OpenAlex — scholarly work discovery (official public API)
// ---------------------------------------------------------------------------

export async function openalexSearch(query: string, timeoutMs = 8_000, rows = 4): Promise<AcademicItem[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query.slice(0, 220))}&per-page=${Math.min(Math.max(rows, 1), 5)}&select=id,display_name,publication_year,doi,authorships,primary_location`
  const data = (await academicFetchJson(url, timeoutMs)) as { results?: Array<Record<string, unknown>> }
  const items = data.results ?? []
  return items.map((it, i) => {
    const title = boundedText(it.display_name, 260) ?? 'Untitled work'
    const authors = Array.isArray(it.authorships)
      ? (it.authorships as Array<Record<string, unknown>>)
          .map((a) => boundedText(a.author && typeof a.author === 'object' ? (a.author as Record<string, unknown>).display_name : null, 60))
          .filter((v): v is string => !!v)
          .slice(0, 3)
          .join(', ') || null
      : null
    const doi = boundedText(it.doi, 200)
    const primary = (it.primary_location && typeof it.primary_location === 'object' ? (it.primary_location as Record<string, unknown>).landing_page_url : null) as string | null
    return {
      url: doi ? `https://doi.org/${doi.replace(/^https?:\/\/doi\.org\//, '')}` : boundedText(primary, 300) ?? `https://api.openalex.org/works?search=${encodeURIComponent(query.slice(0, 40))}`,
      title,
      snippet: `OpenAlex scholarly record${typeof it.publication_year === 'number' ? ` (${it.publication_year})` : ''}`,
      hostName: 'openalex.org',
      rank: i + 1,
      date: typeof it.publication_year === 'number' ? String(it.publication_year) : null,
      author: authors,
      preprint: false,
    }
  })
}

// ---------------------------------------------------------------------------
// arXiv — preprint metadata (official Atom API; preprints, NOT peer-reviewed)
// ---------------------------------------------------------------------------

export async function arxivSearch(query: string, timeoutMs = 8_000, rows = 3): Promise<AcademicItem[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query.slice(0, 180))}&max_results=${Math.min(Math.max(rows, 1), 4)}`
  const guard = await assertHostAllowed(url)
  const res = await directFetch(guard, timeoutMs, { 'user-agent': ACADEMIC_UA, accept: 'application/atom+xml' })
  if (!res.text) throw new ResearchToolError('direct_fetch', 'empty response from arXiv')
  const items: AcademicItem[] = []
  // Bounded XML parsing: the Atom feed is flat — extract <entry> blocks.
  const entries = res.text.split('<entry>').slice(1, 5)
  for (const [i, entry] of entries.entries()) {
    const pick = (tag: string): string | null => {
      const m = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))
      return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300) : null
    }
    const title = pick('title') ?? 'Untitled preprint'
    const idUrl = pick('id') ?? ''
    const published = pick('published')
    const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1].trim().slice(0, 60)).slice(0, 3).join(', ') || null
    if (!idUrl.startsWith('http')) continue
    items.push({
      url: idUrl,
      title,
      snippet: `arXiv preprint — NOT peer-reviewed${pick('summary') ? `: ${pick('summary')!.slice(0, 140)}` : ''}`,
      hostName: 'arxiv.org',
      rank: i + 1,
      date: toDate(published),
      author: authors,
      preprint: true,
    })
  }
  return items
}

// ---------------------------------------------------------------------------
// DOAJ — open-access article metadata (official public API)
// ---------------------------------------------------------------------------

export async function doajSearch(query: string, timeoutMs = 8_000, rows = 3): Promise<AcademicItem[]> {
  const url = `https://doaj.org/api/search/articles/${encodeURIComponent(query.slice(0, 200))}?pageSize=${Math.min(Math.max(rows, 1), 4)}`
  const data = (await academicFetchJson(url, timeoutMs)) as { results?: Array<{ bibjson?: Record<string, unknown> }> }
  const results = data.results ?? []
  return results.map((r, i) => {
    const b = r.bibjson ?? {}
    const title = boundedText(b.title, 260) ?? 'Untitled article'
    const authors = Array.isArray(b.author)
      ? (b.author as Array<Record<string, unknown>>).map((a) => boundedText(a.name, 60)).filter((v): v is string => !!v).slice(0, 3).join(', ') || null
      : null
    const doi = boundedText(b.identifier && Array.isArray(b.identifier) ? (b.identifier as Array<Record<string, unknown>>).find((x) => x.type === 'doi')?.id : null, 160)
    const year = boundedText(b.year, 8)
    return {
      url: doi ? `https://doi.org/${doi}` : `https://doaj.org/search/articles?source=${encodeURIComponent(query.slice(0, 40))}`,
      title,
      snippet: 'DOAJ open-access article record',
      hostName: 'doaj.org',
      rank: i + 1,
      date: year,
      author: authors,
      preprint: false,
    }
  })
}

// ---------------------------------------------------------------------------
// Package registries — npm + PyPI manifests (official endpoints)
// ---------------------------------------------------------------------------

export async function npmPackageInfo(pkg: string, timeoutMs = 8_000): Promise<AcademicItem | null> {
  const name = encodeURIComponent(pkg.trim().replace(/^@/, '%40').slice(0, 120))
  const data = (await academicFetchJson(`https://registry.npmjs.org/${name}/latest`, timeoutMs)) as Record<string, unknown>
  const version = boundedText(data.version, 40)
  if (!version) return null
  const license = typeof data.license === 'string' ? data.license : boundedText((data.license as Record<string, unknown> | undefined)?.type, 40)
  const homepage = boundedText(typeof data.homepage === 'string' ? data.homepage : null, 300)
  return {
    url: homepage ?? `https://www.npmjs.com/package/${pkg.trim()}`,
    title: `${pkg.trim()}@${version} (npm)`,
    snippet: `official npm manifest${license ? ` — license: ${license}` : ' — license: not declared in the manifest'}`,
    hostName: 'registry.npmjs.org',
    rank: 1,
    date: null, // the /latest endpoint carries no dates — never invented
    author: null,
    preprint: false,
  }
}

export async function pypiPackageInfo(pkg: string, timeoutMs = 8_000): Promise<AcademicItem | null> {
  const name = encodeURIComponent(pkg.trim().slice(0, 120))
  const data = (await academicFetchJson(`https://pypi.org/pypi/${name}/json`, timeoutMs)) as Record<string, unknown>
  const info = (data.info && typeof data.info === 'object' ? data.info : null) as Record<string, unknown> | null
  if (!info) return null
  const version = boundedText(info.version, 40)
  if (!version) return null
  const license = boundedText(info.license, 60)
  return {
    url: boundedText(typeof info.home_page === 'string' ? info.home_page : null, 300) ?? `https://pypi.org/project/${pkg.trim()}/`,
    title: `${pkg.trim()} ${version} (PyPI)`,
    snippet: `official PyPI metadata${license ? ` — license: ${license}` : ' — license: not declared in the metadata'}`,
    hostName: 'pypi.org',
    rank: 1,
    date: null,
    author: boundedText(info.author, 80),
    preprint: false,
  }
}

// ---------------------------------------------------------------------------
// Dispatch — which adapters does this query deserve? (deterministic, bounded)
// ---------------------------------------------------------------------------

const SCHOLARLY_RE = /\b(doi|paper|preprint|peer[- ]reviewed|journal|publication|study|arxiv|pubmed|open[- ]access|citation|et al|proceedings|conference paper|systematic review|meta[- ]analysis)\b/i
const NPM_RE = /\b(npm\s+package|npm\s+module|@[\w-]+\/[\w-]+)\b/i
const PYPI_RE = /\b(pypi|pip install)\b/i

/** Deterministic package-name candidates from the query (bounded). */
function packageCandidates(query: string): { npm: string[]; pypi: string[] } {
  const npm: string[] = []
  const scoped = query.match(/@[\w-]+\/[\w.-]+/g)
  if (scoped) npm.push(...scoped.slice(0, 2))
  const pypi = query.match(/\bpip install\s+([\w.-]+)/i)
  if (pypi) return { npm, pypi: [pypi[1]] }
  return { npm: npm.slice(0, 2), pypi: [] }
}

/**
 * Run the academic/registry lane for a query when its shape deserves it.
 * NEVER throws — per-adapter failures degrade into the notes array.
 * Evidence enters the SAME ranking pool as gateway results (host + date
 * + author preserved; provenance marked `direct`).
 */
export async function runAcademicLane(
  query: string,
  opts: { userId: string | null; budgetMs?: number } = { userId: null },
): Promise<{ results: RankedSource[]; notes: string[]; adaptersUsed: string[] }> {
  const notes: string[] = []
  const adaptersUsed: string[] = []
  const budgetMs = opts.budgetMs ?? 12_000
  const t0 = Date.now()
  const out: RankedSource[] = []

  const attempts: Array<{ name: string; run: () => Promise<AcademicItem[]> }> = []
  if (SCHOLARLY_RE.test(query)) {
    attempts.push({ name: 'crossref', run: () => crossrefSearch(query) })
    attempts.push({ name: 'arxiv', run: () => arxivSearch(query) })
    attempts.push({ name: 'openalex', run: () => openalexSearch(query) })
    attempts.push({ name: 'doaj', run: () => doajSearch(query) })
  }
  const pkgs = packageCandidates(query)
  for (const p of pkgs.npm.slice(0, 1)) {
    attempts.push({ name: 'npm', run: () => npmPackageInfo(p).then((r) => (r ? [r] : [])) })
  }
  for (const p of pkgs.pypi.slice(0, 1)) {
    attempts.push({ name: 'pypi', run: () => pypiPackageInfo(p).then((r) => (r ? [r] : [])) })
  }
  if (attempts.length === 0) return { results: [], notes, adaptersUsed }

  for (const attempt of attempts) {
    if (Date.now() - t0 > budgetMs) {
      notes.push(`academic lane: budget exhausted before ${attempt.name}`)
      continue
    }
    try {
      const items = await attempt.run()
      adaptersUsed.push(attempt.name)
      for (const item of items) {
        out.push({
          id: 0,
          url: item.url,
          title: item.title,
          snippet: item.snippet,
          hostName: item.hostName,
          date: item.date,
          freshness: null,
          year: item.date ? Number(item.date.slice(0, 4)) || null : null,
          authority: 0.75,
          official: true,
          social: false,
          sourceType: 'reference',
          ...(item.author ? { author: item.author } : {}),
          score: 0.6,
        })
      }
      if (items.some((it) => it.preprint)) {
        notes.push('academic lane: arXiv results are PREPRINTS — not peer-reviewed publications')
      }
    } catch (e) {
      notes.push(`academic lane ${attempt.name}: ${e instanceof Error ? e.message.slice(0, 120) : 'unavailable'}`)
    }
  }
  return { results: out, notes, adaptersUsed }
}
