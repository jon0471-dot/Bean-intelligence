/**
 * BEAN Intelligence — M43 shared evidence representation (Phase 1).
 *
 * ONE common claim-scoped evidence record for every BEAN specialist, built
 * FROM the existing M42 research contract (`SpecialistEvidencePack`) — never
 * a second research engine, crawler or citation stack. The record preserves
 * source attribution end to end (identity, dates as supplied, provenance,
 * authority class) and distinguishes INDEPENDENT corroboration from multiple
 * copies of the same original article (canonical source key grouping).
 *
 * Honesty rules encoded here:
 *  - publication dates are EXACTLY as supplied upstream — null when absent,
 *    never invented; a date that cannot be parsed stays `dateValid: null`
 *    (unknown), a future or impossible date is `dateValid: false`;
 *  - a source's opinion or user-generated report is carried as such (label),
 *    never silently promoted to established fact;
 *  - corroboration counting happens over DISTINCT independence groups only —
 *    syndicated copies of one article can never fabricate agreement.
 */

import type { SpecialistEvidencePack, SpecialistEvidence } from './agent-evidence'

// ---------------------------------------------------------------------------
// Source identity — who originally published this, preserved through handoffs
// ---------------------------------------------------------------------------

export interface SourceIdentity {
  /** Canonical source URL (the original article/resource location). */
  url: string
  /** Serving host. */
  host: string
  /** Publisher display name derived ONLY from the host itself; null otherwise. */
  publisher: string | null
  /** Author exactly as supplied by the originating lane; null when absent. */
  author: string | null
  /** Publication date EXACTLY as supplied (ISO or raw); null when absent. */
  publishedAt: string | null
  /** Last-updated date as supplied when a lane declares one; null otherwise. */
  updatedAt: string | null
  /** ISO instant this evidence was retrieved by the research gateway. */
  retrievedAt: string
}

export type EvidenceRole = 'supporting' | 'contradicting' | 'context'

/** Authority classification supplied by the M43 source-trust module. */
export type AuthorityClass =
  | 'authoritative'
  | 'strong'
  | 'corroborating'
  | 'weak'
  | 'user-generated'

export interface EvidenceRecord {
  /** Stable within this evidence set: [E1], [E2] … */
  evidenceId: string
  /** Citation ref into the originating pack ([S1] …) — preserved for handoffs. */
  sourceId: string
  identity: SourceIdentity
  title: string
  /** Relevant extracted passage (bounded excerpt), null when none was captured. */
  passage: string | null
  /** True when the page itself was read (not just the search snippet). */
  pageRead: boolean
  /** Coarse class from the shared ranker / supplying lane. */
  sourceType: string
  /** M43 trust assessment for the CURRENT claim context. */
  authorityClass: AuthorityClass
  /** Why this class was assigned (host class × claim-kind match — explainable). */
  authorityBasis: string
  official: boolean
  social: boolean
  provenance: { channel: string | null; engine: string }
  /**
   * Canonical grouping key: records from the SAME original article (syndicated
   * or mirrored copies) share one group. Independent corroboration is counted
   * as the number of DISTINCT groups, never raw rows.
   */
  independenceGroup: string
  /** Date validation: true = parses to a real past date; false = impossible
   *  (future/beyond bounds); null = absent or unparseable (unknown, honest). */
  dateValid: boolean | null
}

// ---------------------------------------------------------------------------
// Canonical source keys — one original article, many copies, ONE group
// ---------------------------------------------------------------------------

/** Query params that never identify the original resource (tracking junk). */
const TRACKING_PARAMS = /^(?:utm_[a-z_]*|fbclid|gclid|ref(?:_src)?|cmpid|ocid|spm|scid|mc_[a-z_]*|igshid|si)$/i

/** Strip tracking params, fragments, userinfo, www. and trailing slashes. */
export function canonicalSourceKey(rawUrl: string, fallbackTitle = ''): string {
  let url = rawUrl.trim()
  if (!url) return `t:${fallbackTitle.toLowerCase().replace(/\s+/g, ' ').trim()}`
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return `t:${fallbackTitle.toLowerCase().replace(/\s+/g, ' ').trim()}`
    }
    u.hash = ''
    u.username = ''
    u.password = ''
    u.protocol = 'https:'
    u.hostname = u.hostname.replace(/^www\./i, '').toLowerCase()
    const kept: [string, string][] = []
    for (const [k, v] of u.searchParams.entries()) {
      if (!TRACKING_PARAMS.test(k)) kept.push([k, v])
    }
    kept.sort((a, b) => (a[0] + '=' + a[1]).localeCompare(b[0] + '=' + b[1]))
    const qs = kept.length > 0 ? '?' + kept.map(([k, v]) => `${k}=${v}`).join('&') : ''
    let path = u.pathname.replace(/\/+$/, '')
    // AMP/print mirrors are the same article.
    path = path.replace(/\/(?:amp|amp\.html|print)(?=\/?$)/i, '')
    return `u:${u.hostname}${path}${qs}`.toLowerCase()
  } catch {
    return `t:${fallbackTitle.toLowerCase().replace(/\s+/g, ' ').trim()}`
  }
}

/** Group records by canonical key; returns the map + a readable reason each. */
export function groupIndependentSources(
  records: Array<Pick<EvidenceRecord, 'identity' | 'title' | 'independenceGroup'>>,
): Map<string, number> {
  const groups = new Map<string, number>()
  for (const r of records) {
    groups.set(r.independenceGroup, (groups.get(r.independenceGroup) ?? 0) + 1)
  }
  return groups
}

/** Distinct independence groups among records playing the given role. */
export function independentGroupCount(
  records: RoleTaggedEvidenceRecord[],
  role: EvidenceRole = 'supporting',
): number {
  const seen = new Set<string>()
  for (const r of records) {
    if (r.role === role) seen.add(r.independenceGroup)
  }
  return seen.size
}

// ---------------------------------------------------------------------------
// Publication-date validation (Phase 10 §6) — never invent, never accept junk
// ---------------------------------------------------------------------------

const MAX_PAST_YEARS = 60
const FUTURE_TOLERANCE_MS = 36 * 60 * 60 * 1000 // 36h clock-skew tolerance

export function validatePublicationDate(raw: string | null, now = new Date()): boolean | null {
  if (!raw) return null
  const t = Date.parse(raw)
  if (Number.isNaN(t)) {
    // Bare year "2024" as supplied by some lanes.
    const y = /^(\d{4})(?:-\d{2}){0,2}$/.exec(raw.trim())
    if (!y) return null
    const year = Number(y[1])
    const nowYear = now.getUTCFullYear()
    if (year > nowYear) return false
    if (year < nowYear - MAX_PAST_YEARS) return false
    return true
  }
  if (t > now.getTime() + FUTURE_TOLERANCE_MS) return false
  if (t < now.getTime() - MAX_PAST_YEARS * 365.25 * 24 * 3600 * 1000) return false
  return true
}

// ---------------------------------------------------------------------------
// Pack → records (the M42 contract stays the ONLY retrieval surface)
// ---------------------------------------------------------------------------

const MAX_RECORDS = 32

export interface BuildEvidenceOptions {
  /** Trust assessor from `source-trust.ts` (injected to avoid an import cycle). */
  assessAuthority?: (src: SpecialistEvidence) => { authorityClass: AuthorityClass; basis: string }
  /** Role assigned to every record built from this pack (default supporting). */
  role?: EvidenceRole
  maxRecords?: number
}

/** Extend the record with its evidence-set role (kept off the core interface
 *  so verifiers can treat records as plain immutable values). */
export interface RoleTaggedEvidenceRecord extends EvidenceRecord {
  role: EvidenceRole
}

export function buildEvidenceRecords(
  pack: SpecialistEvidencePack,
  opts: BuildEvidenceOptions = {},
): RoleTaggedEvidenceRecord[] {
  const role = opts.role ?? 'supporting'
  const max = Math.min(opts.maxRecords ?? MAX_RECORDS, MAX_RECORDS)
  const records: RoleTaggedEvidenceRecord[] = []
  for (const s of pack.evidence.slice(0, max)) {
    const identity: SourceIdentity = {
      url: s.url,
      host: s.host,
      publisher: publisherFromHost(s.host),
      author: s.author ?? null,
      publishedAt: s.publishedAt ?? null,
      updatedAt: null, // no upstream lane supplies an updated-at yet — never invented
      retrievedAt: s.retrievedAt,
    }
    const trust = opts.assessAuthority?.(s) ?? {
      authorityClass: (s.sourceType === 'social' ? 'user-generated' : s.official ? 'authoritative' : 'corroborating') as AuthorityClass,
      basis: 'default class from the shared ranker (no claim context supplied)',
    }
    records.push({
      evidenceId: `[E${records.length + 1}]`,
      sourceId: s.sourceId,
      identity,
      title: s.title,
      passage: s.excerpt,
      pageRead: s.pageRead,
      sourceType: s.sourceType,
      authorityClass: trust.authorityClass,
      authorityBasis: trust.basis,
      official: s.official,
      social: s.sourceType === 'social',
      provenance: s.provenance,
      independenceGroup: canonicalSourceKey(s.url, s.title),
      dateValid: validatePublicationDate(s.publishedAt),
      role,
    })
  }
  collapseSyndicatedCopies(records)
  return records
}

// ---------------------------------------------------------------------------
// Syndication collapse — different hosts, same original article → ONE group
// (mirrors the shared ranker's syndication rule at evidence level; substantive
// titles only, so generic titles like "Home" can never merge distinct pages)
// ---------------------------------------------------------------------------

export function normalizeTitleForSyndication(title: string): string {
  let t = title.toLowerCase()
  t = t.replace(/\s*(?:[|·–—-]\s*)?[^|·–—-]*(?:news|times|post|herald|tribune|express|standard|guardian|journal|today|wire|report|monitor|bulletin|sentinel|gazette)[^|·–—-]*$/, '')
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  return t
}

function isSubstantiveTitle(normalized: string): boolean {
  if (normalized.length < 20) return false
  return normalized.split(' ').filter((w) => w.length > 2).length >= 4
}

function collapseSyndicatedCopies(records: RoleTaggedEvidenceRecord[]): void {
  const byTitle = new Map<string, string>()
  for (const r of records) {
    const norm = normalizeTitleForSyndication(r.title)
    if (!isSubstantiveTitle(norm)) continue
    const existing = byTitle.get(norm)
    if (existing !== undefined) {
      r.independenceGroup = existing
    } else {
      byTitle.set(norm, r.independenceGroup)
    }
  }
}

/** Publisher label from host ONLY (a naming heuristic, never a claim of ownership). */
const PUBLISHER_BRANDS: Array<[RegExp, string]> = [
  [/^(?:www\.)?bbc\.(?:co\.uk|com)$/i, 'BBC'],
  [/^(?:www\.)?nytimes\.com$/i, 'The New York Times'],
  [/^(?:www\.)?theguardian\.com$/i, 'The Guardian'],
  [/^(?:www\.)?reuters\.com$/i, 'Reuters'],
  [/^(?:www\.)?apnews\.com$/i, 'Associated Press'],
  [/^(?:www\.)?nature\.com$/i, 'Nature'],
  [/^(?:www\.)?arxiv\.org$/i, 'arXiv'],
  [/^(?:www\.)?npmjs\.com$/i, 'npm'],
  [/^(?:www\.)?pypi\.org$/i, 'PyPI'],
  [/^(?:www\.)?nodejs\.org$/i, 'Node.js'],
  [/^developer\.mozilla\.org$/i, 'MDN Web Docs'],
  [/^(?:www\.)?osv\.dev$/i, 'OSV.dev'],
  [/^(?:www\.)?who\.int$/i, 'World Health Organization'],
  [/^(?:www\.)?europa\.eu$/i, 'European Union'],
]

export function publisherFromHost(host: string): string | null {
  const h = host.toLowerCase().replace(/^www\./i, '')
  for (const [re, brand] of PUBLISHER_BRANDS) {
    if (re.test(h)) return brand
  }
  // Government hosts: the TLD speaks for the jurisdiction, not a brand name.
  if (/\.(?:gov|gov\.uk|gov\.au|govt\.nz|gc\.ca|nic\.in)(:|$)/.test(h) || h.endsWith('.europa.eu')) return null
  return null
}

// ---------------------------------------------------------------------------
// Handoff-safe serialization — attribution survives every agent boundary
// ---------------------------------------------------------------------------

export interface EvidenceAttributionView {
  evidenceId: string
  sourceId: string
  title: string
  url: string
  publisher: string | null
  author: string | null
  publishedAt: string | null
  retrievedAt: string
  independenceGroup: string
  authorityClass: AuthorityClass
}

/** Bounded attribution list for receipts, job params and mission handoffs. */
export function attributionView(records: EvidenceRecord[]): EvidenceAttributionView[] {
  return records.slice(0, 24).map((r) => ({
    evidenceId: r.evidenceId,
    sourceId: r.sourceId,
    title: r.title.slice(0, 160),
    url: r.identity.url.slice(0, 512),
    publisher: r.identity.publisher,
    author: r.identity.author,
    publishedAt: r.identity.publishedAt,
    retrievedAt: r.identity.retrievedAt,
    independenceGroup: r.independenceGroup,
    authorityClass: r.authorityClass,
  }))
}
