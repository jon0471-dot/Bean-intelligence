/**
 * BEAN Intelligence — M43 contradiction & uncertainty reasoning (Phase 4).
 *
 * EXTENDS the existing M37 cross-source detector (`riishe/contradictions.ts`)
 * — the numeric/date measure engine is REUSED, never duplicated — and adds
 * the claim-level layer the evidence engine needs:
 *
 *  - contradiction KINDS beyond raw numbers: outdated-vs-current,
 *    conflicting regional requirements, conflicting technical specs, and
 *    claims that EXCEED their cited evidence (quantifier escalation,
 *    borrowed causality);
 *  - RESOLUTION is only ever explicit: a NEWER primary-authority source may
 *    supersede an explicitly older contradicting one (both contexts preserved
 *    and the basis stated) — everything else stays unresolved;
 *  - uncertainty statements render what REMAINS uncertain in bounded, honest
 *    language. The system never silently selects whichever answer it prefers.
 *
 * PURE module — regex + string shaping only. No DB, no I/O, no model calls.
 */

import { detectSourceContradictions, describeContradiction, type ContradictionSource, type SourceContradiction } from '../riishe/contradictions'
import type { RoleTaggedEvidenceRecord } from './evidence'

export type ContradictionKind =
  | 'conflicting-numerical-values'
  | 'conflicting-dates'
  | 'conflicting-technical-specs'
  | 'outdated-vs-current'
  | 'conflicting-scientific-conclusions'
  | 'conflicting-product-info'
  | 'inconsistent-legal-regulatory'
  | 'conflicting-regional-requirements'
  | 'unsupported-causal'
  | 'claim-exceeds-evidence'

export const CONTRADICTION_KINDS: readonly ContradictionKind[] = [
  'conflicting-numerical-values', 'conflicting-dates', 'conflicting-technical-specs',
  'outdated-vs-current', 'conflicting-scientific-conclusions', 'conflicting-product-info',
  'inconsistent-legal-regulatory', 'conflicting-regional-requirements',
  'unsupported-causal', 'claim-exceeds-evidence',
]

export interface ClaimContradiction {
  kind: ContradictionKind
  /** What the disagreement is about (measure/subject/context). */
  subject: string
  /** Evidence ids on each side — context PRESERVED, never collapsed. */
  evidenceIdA: string
  evidenceIdB: string
  valueA: string
  valueB: string
  /** Explainable note (dates/authority/regions involved). */
  note: string
  /** 'resolvable' ONLY with an explicit newer-primary-supersedes basis. */
  resolution: 'resolvable' | 'unresolved'
  resolutionBasis: string | null
}

const MAX_FINDINGS = 8
const KIND_BY_MEASURE: Record<string, ContradictionKind> = {
  date: 'conflicting-dates',
  years_old: 'conflicting-numerical-values',
}

// ---------------------------------------------------------------------------
// Numeric/date contradictions — REUSE the M37 engine over evidence records
// ---------------------------------------------------------------------------

function toContradictionSources(records: RoleTaggedEvidenceRecord[]): ContradictionSource[] {
  return records.slice(0, 24).map((r, i) => ({
    id: i + 1,
    title: r.title,
    snippet: r.passage ?? '',
    excerpt: r.pageRead ? r.passage : null,
  }))
}

function evidenceIdAt(records: RoleTaggedEvidenceRecord[], n: number): string {
  return records[n - 1]?.evidenceId ?? `[E${n}]`
}

// ---------------------------------------------------------------------------
// New claim-level detectors
// ---------------------------------------------------------------------------

const REGION_MARKERS: Array<[RegExp, string]> = [
  [/\b(india|indian|bharat)\b/i, 'India'],
  [/\b(eu|european union|europa)\b/i, 'EU'],
  [/\b(us|united states|usa|america|federal)\b/i, 'US'],
  [/\b(uk|britain|united kingdom|england|scotland|wales)\b/i, 'UK'],
  [/\b(europe)\b/i, 'Europe'],
  [/\b(china|chinese)\b/i, 'China'],
  [/\b(japan|japanese)\b/i, 'Japan'],
  [/\b(australia|australian)\b/i, 'Australia'],
  [/\b(canada|canadian)\b/i, 'Canada'],
  [/\b(germany|german)\b/i, 'Germany'],
  [/\b(brazil|brazilian)\b/i, 'Brazil'],
  [/\b(state of|california|texas|new york)\b/i, 'US-state'],
]

function regionsOf(text: string): string[] {
  const found = new Set<string>()
  for (const [re, name] of REGION_MARKERS) {
    if (re.test(text)) found.add(name)
  }
  return [...found]
}

const SPEC_RE = /\b(?:v?\d+\.\d+(?:\.\d+)?|up to|at least|maximum|minimum|limit(?:ed)? to|cap(?:ped)? (?:at|to))\s*\d*\s*(?:%|percent|mb|gb|kb|requests?|users?|chars?|characters?|years?|days?|hours?|items?|records?)?/gi

/** Different technical/product numbers of the same KIND from different groups. */
function detectSpecConflicts(records: RoleTaggedEvidenceRecord[]): ClaimContradiction[] {
  const findings: ClaimContradiction[] = []
  const seen = new Set<string>()
  for (let i = 0; i < records.length && findings.length < MAX_FINDINGS; i++) {
    for (let j = i + 1; j < records.length && findings.length < MAX_FINDINGS; j++) {
      const a = records[i]
      const b = records[j]
      if (a.independenceGroup === b.independenceGroup) continue
      const textA = `${a.title} ${a.passage ?? ''}`
      const textB = `${b.title} ${b.passage ?? ''}`
      const specsA = (textA.match(SPEC_RE) ?? []).map((s) => s.trim().toLowerCase())
      const specsB = (textB.match(SPEC_RE) ?? []).map((s) => s.trim().toLowerCase())
      if (specsA.length === 0 || specsB.length === 0) continue
      // Same unit family, different value → spec conflict.
      const unitA = specsA.map((s) => (s.match(/%|percent|mb|gb|kb|requests?|users?|chars?|characters?|years?|days?|hours?|items?|records?/i)?.[0] ?? '')).filter(Boolean)
      const unitB = specsB.map((s) => (s.match(/%|percent|mb|gb|kb|requests?|users?|chars?|characters?|years?|days?|hours?|items?|records?/i)?.[0] ?? '')).filter(Boolean)
      const sharedUnit = unitA.find((u) => unitB.includes(u))
      if (!sharedUnit) continue
      const numA = specsA.find((s) => s.includes(sharedUnit))
      const numB = specsB.find((s) => s.includes(sharedUnit))
      if (numA === undefined || numB === undefined || numA === numB) continue
      const key = `${a.evidenceId}|${b.evidenceId}|${sharedUnit}`
      if (seen.has(key)) continue
      seen.add(key)
      findings.push({
        kind: 'conflicting-technical-specs',
        subject: `technical spec (${sharedUnit})`,
        evidenceIdA: a.evidenceId,
        evidenceIdB: b.evidenceId,
        valueA: numA,
        valueB: numB,
        note: `${a.evidenceId} states "${numA}" while ${b.evidenceId} states "${numB}" for the same spec family`,
        resolution: 'unresolved',
        resolutionBasis: null,
      })
    }
  }
  return findings
}

/** Same requirement, different regions stated as if universal. */
const UNIVERSAL_JURISDICTION_RE = /\b(?:every|all|any|each|worldwide|globally|in all (?:countries|jurisdictions|regions)|across (?:all )?jurisdictions|major jurisdictions?)\b/i

function detectRegionalConflicts(claim: string, records: RoleTaggedEvidenceRecord[]): ClaimContradiction[] {
  const claimRegions = regionsOf(claim)
  const universal = UNIVERSAL_JURISDICTION_RE.test(claim)
  if (claimRegions.length === 0 && !universal) return []
  const findings: ClaimContradiction[] = []
  const byRegion = new Map<string, RoleTaggedEvidenceRecord>()
  for (const r of records) {
    const regs = regionsOf(`${r.title} ${r.passage ?? ''}`)
    if (regs.length !== 1) continue
    const reg = regs[0]
    if (!byRegion.has(reg)) byRegion.set(reg, r)
  }
  const claimRegionSet = new Set(claimRegions)
  // Explicit claim regions conflicting with evidence for other regions:
  const pairs: Array<[string, string]> = []
  for (const claimRegion of claimRegions) {
    const others = [...byRegion.keys()].filter((k) => k !== claimRegion)
    const other = others[0]
    if (other !== undefined) pairs.push([claimRegion, other])
  }
  // Universal claim ("every jurisdiction") vs evidence pinned to >= 2 regions:
  if (pairs.length === 0 && universal) {
    const regions = [...byRegion.keys()].slice(0, 2)
    if (regions.length >= 2) pairs.push([regions[0], regions[1]])
  }
  for (const [ra, rb] of pairs) {
    const a = byRegion.get(ra)
    const b = byRegion.get(rb)
    if (!a || !b) continue
    findings.push({
      kind: 'conflicting-regional-requirements',
      subject: `${ra} vs ${rb} requirement`,
      evidenceIdA: a.evidenceId,
      evidenceIdB: b.evidenceId,
      valueA: `rule stated for ${ra}`,
      valueB: `rule stated for ${rb}`,
      note: `the claim generalizes across jurisdictions, but ${a.evidenceId} describes ${ra} and ${b.evidenceId} describes ${rb} — requirements may differ per jurisdiction`,
      resolution: 'unresolved',
      resolutionBasis: null,
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Claim-exceeds-evidence — the claim asserts MORE than its sources show
// ---------------------------------------------------------------------------

const ESCALATIONS: Array<[RegExp, RegExp, string]> = [
  [/\b(?:all|every|always|never|no)\b/i, /\b(?:some|several|many|most|a few|certain|particular)\b/i, 'universal quantifier'],
  [/\b(?:proves?|proven|guaranteed|ensures?|causes?|will)\b/i, /\b(?:suggests?|may|might|could|associated with|correlates?|linked to|appears to)\b/i, 'causal/certainty escalation'],
  [/\b(?:exactly|precisely)\b/i, /\b(?:up to|at least|about|approximately|around|roughly|over)\b/i, 'precision escalation'],
]

/**
 * Flag when the claim asserts stronger forms of what the (best) supporting
 * evidence actually states. Returns one finding per escalation type, capped.
 */
export function detectClaimExceedsEvidence(
  claim: string,
  supportingPassages: string[],
): ClaimContradiction[] {
  const findings: ClaimContradiction[] = []
  const evidence = supportingPassages.join(' ').toLowerCase()
  if (!evidence.trim()) return [{
    kind: 'claim-exceeds-evidence',
    subject: 'entire claim',
    evidenceIdA: '[claim]',
    evidenceIdB: '[no-evidence]',
    valueA: claim.slice(0, 160),
    valueB: 'no supporting passage',
    note: 'the claim is asserted with no supporting passage at all — its content exceeds the available evidence',
    resolution: 'unresolved',
    resolutionBasis: null,
  }]
  for (const [strongRe, weakRe, label] of ESCALATIONS) {
    if (strongRe.test(claim) && !strongRe.test(evidence) && weakRe.test(evidence)) {
      findings.push({
        kind: 'claim-exceeds-evidence',
        subject: label,
        evidenceIdA: '[claim]',
        evidenceIdB: '[evidence]',
        valueA: (claim.match(strongRe)?.[0] ?? '').toLowerCase(),
        valueB: (evidence.match(weakRe)?.[0] ?? '').toLowerCase(),
        note: `the claim uses ${label} ("${(claim.match(strongRe)?.[0] ?? '').toLowerCase()}") while the evidence only supports the weaker form ("${(evidence.match(weakRe)?.[0] ?? '').toLowerCase()}")`,
        resolution: 'unresolved',
        resolutionBasis: null,
      })
      if (findings.length >= 3) break
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// Resolution — ONLY explicit newer-primary-supersedes, context preserved
// ---------------------------------------------------------------------------

function parseTs(raw: string | null): number | null {
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : t
}

/**
 * A numeric/date/spec disagreement is resolvable ONLY when one side is a
 * NEWER primary-authority source vs an explicitly OLDER other side — the
 * basis is recorded and BOTH values remain in the finding (supersession,
 * not deletion).
 */
export function resolveContradictions(
  findings: ClaimContradiction[],
  records: RoleTaggedEvidenceRecord[],
  now = new Date(),
): ClaimContradiction[] {
  const byId = new Map(records.map((r) => [r.evidenceId, r]))
  const out: ClaimContradiction[] = []
  for (const f of findings) {
    if (f.evidenceIdA.startsWith('[') && f.evidenceIdB.startsWith('[') && (f.evidenceIdA === '[claim]' || f.evidenceIdB === '[claim]')) {
      out.push(f) // claim-exceeds findings are never "resolvable" — the claim itself must change
      continue
    }
    const a = byId.get(f.evidenceIdA)
    const b = byId.get(f.evidenceIdB)
    if (!a || !b) { out.push(f); continue }
    const ta = parseTs(a.identity.publishedAt)
    const tb = parseTs(b.identity.publishedAt)
    if (ta === null || tb === null) { out.push(f); continue }
    const newer = ta > tb ? a : b
    const older = newer === a ? b : a
    const newerIsPrimary = newer.authorityClass === 'authoritative'
    const gapDays = Math.abs(ta - tb) / 86400000
    if (newerIsPrimary && gapDays >= 30) {
      out.push({
        ...f,
        resolution: 'resolvable',
        resolutionBasis: `${newer.evidenceId} (${newer.authorityClass}, ${newer.identity.publishedAt?.slice(0, 10)}) supersedes ${older.evidenceId} (${older.authorityClass}, ${older.identity.publishedAt?.slice(0, 10)}) — ${Math.round(gapDays)} days newer primary evidence; both values preserved above`,
      })
      continue
    }
    out.push(f)
  }
  return out.slice(0, MAX_FINDINGS)
}

// ---------------------------------------------------------------------------
// The claim-level detection pass (composes M37 numeric/date + new kinds)
// ---------------------------------------------------------------------------

export interface ContradictionReport {
  findings: ClaimContradiction[]
  /** M37 engine results, mapped to evidence ids (numeric/date core reused). */
  measureFindings: number
  unresolvedCount: number
  resolvableCount: number
}

export function detectClaimContradictions(
  claim: string,
  supporting: RoleTaggedEvidenceRecord[],
  contradicting: RoleTaggedEvidenceRecord[] = [],
): ContradictionReport {
  const all = [...supporting, ...contradicting]
  if (all.length < 2) return { findings: [], measureFindings: 0, unresolvedCount: 0, resolvableCount: 0 }

  const findings: ClaimContradiction[] = []

  // 1) Numeric + date measures via the EXISTING M37 engine.
  const sources = toContradictionSources(all)
  const measureHits = detectSourceContradictions(sources)
  for (const m of measureHits.slice(0, 4)) {
    findings.push({
      kind: KIND_BY_MEASURE[m.measure] ?? 'conflicting-numerical-values',
      subject: `${m.subject}: ${m.measure}`,
      evidenceIdA: evidenceIdAt(all, m.sourceIdA),
      evidenceIdB: evidenceIdAt(all, m.sourceIdB),
      valueA: m.valueA,
      valueB: m.valueB,
      note: describeContradiction(m),
      resolution: 'unresolved',
      resolutionBasis: null,
    })
  }

  // 2) New kinds.
  findings.push(...detectSpecConflicts(all).slice(0, 3))
  findings.push(...detectRegionalConflicts(claim, all).slice(0, 2))
  findings.push(...detectClaimExceedsEvidence(claim, supporting.map((r) => r.passage ?? '')).slice(0, 3))

  const resolved = resolveContradictions(findings, all)
  return {
    findings: resolved,
    measureFindings: measureHits.length,
    unresolvedCount: resolved.filter((f) => f.resolution === 'unresolved').length,
    resolvableCount: resolved.filter((f) => f.resolution === 'resolvable').length,
  }
}

// ---------------------------------------------------------------------------
// Uncertainty statements — what remains uncertain, bounded and honest
// ---------------------------------------------------------------------------

export function uncertaintyStatement(
  contradictions: ContradictionReport,
  unresolvedClaims: Array<{ claim: string; unresolved: string | null }> = [],
  maxChars = 480,
): string {
  const parts: string[] = []
  const unresolved = contradictions.findings.filter((f) => f.resolution === 'unresolved')
  if (unresolved.length > 0) {
    const f = unresolved[0]
    parts.push(`sources disagree on ${f.subject} (${f.valueA} vs ${f.valueB} — ${f.evidenceIdA} vs ${f.evidenceIdB}) and the evidence does not resolve which is correct`)
  }
  if (contradictions.unresolvedCount > 1) {
    parts.push(`${contradictions.unresolvedCount - 1} further disagreement(s) also remain open`)
  }
  for (const c of unresolvedClaims.slice(0, 2)) {
    if (c.unresolved) parts.push(c.unresolved.slice(0, 180))
  }
  if (parts.length === 0) return ''
  let s = `What remains uncertain: ${parts.join('; ')}.`
  return s.length > maxChars ? s.slice(0, maxChars - 1) + '…' : s
}

export { describeContradiction }
export type { SourceContradiction, ContradictionSource }
