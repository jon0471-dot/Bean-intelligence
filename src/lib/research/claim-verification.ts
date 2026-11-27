/**
 * BEAN Intelligence — M43 multi-source claim-level fact verification (Phase 2).
 *
 * Genuine claim-level verification over the shared evidence representation:
 * identify the individual factual claims, weigh the supporting evidence,
 * specifically weigh contradicting evidence, compare dates and versions,
 * prefer primary sources, and produce an EXPLAINABLE verdict that never
 * forces a PASS when evidence is insufficient.
 *
 * Decision law (encoded in `verifyClaim`):
 *  - authority beats count: many weak/user-generated sources can never
 *    outweigh one authoritative primary source;
 *  - corroboration counts DISTINCT independence groups (copies never inflate);
 *  - a contradiction from an equal-or-stronger authority blocks any
 *    "verified" outcome and is either resolved (explicitly newer/primary
 *    evidence supersedes) or recorded as unresolved disagreement;
 *  - impossible dates invalidate a record as support; absent dates degrade;
 *  - version-sensitive claims whose evidence speaks of a different version
 *    are flagged, never silently accepted;
 *  - user-generated content is experience evidence — it can never verify a
 *    factual claim on its own.
 *
 * Outcomes: verified | strongly-supported | partially-supported |
 * contradicted | outdated | insufficient-evidence | unverifiable |
 * source-unavailable — the M43 §2 vocabulary, nothing forced.
 */

import { classifyClaimKind, assessEvidenceAuthority, summarizeEvidenceWeight, type ClaimKind } from './source-trust'
import {
  buildEvidenceRecords,
  independentGroupCount,
  canonicalSourceKey,
  type RoleTaggedEvidenceRecord,
} from './evidence'
import type { SpecialistEvidencePack } from './agent-evidence'

// ---------------------------------------------------------------------------
// Claim extraction — deterministic, bounded
// ---------------------------------------------------------------------------

export interface ExtractedClaim {
  text: string
  index: number
  /** Why this sentence was selected as a checkable claim. */
  signals: string[]
}

const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9"'(])/
const MAX_CLAIMS = 8
const MIN_CLAIM_CHARS = 24

interface SignalRule {
  name: string
  re: RegExp
}

const CLAIM_SIGNALS: SignalRule[] = [
  { name: 'number', re: /\b\d+(?:[.,]\d+)?\s*(?:%|percent|million|billion|trillion|thousand|crore|lakh|kg|km|mb|gb|years?|days?|hours?|users|people|deaths|cases)\b/i },
  { name: 'date', re: /\b(?:19|20)\d{2}\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i },
  { name: 'version', re: /\b(?:v?\d+\.\d+(?:\.\d+)?|version \d+)\b/i },
  { name: 'comparative-superlative', re: /\b(largest|smallest|fastest|slowest|first|last|only|most|least|more than|less than|higher than|lower than|exceeds?|outperforms?)\b/i },
  { name: 'causal', re: /\b(because|due to|caused by|leads? to|results? in|prevents?|enables?|requires?)\b/i },
  { name: 'absolute', re: /\b(always|never|all|none|every|impossible|guaranteed|proven|officially)\b/i },
  { name: 'attribution', re: /\b(according to|per the|as stated by|reported by|researchers|study|survey)\b/i },
  { name: 'assertion-verb', re: /\b(is|are|was|were|has|have|will|can|supports?|supports|released|launched|announced|banned|approved|mandates?|covers?)\b/i },
]

export function extractFactualClaims(text: string, max = MAX_CLAIMS): ExtractedClaim[] {
  const sentences = text.replace(/\s+/g, ' ').split(SENTENCE_SPLIT_RE).map((s) => s.trim())
  const claims: ExtractedClaim[] = []
  for (const s of sentences) {
    if (claims.length >= Math.max(1, max)) break
    if (s.length < MIN_CLAIM_CHARS || s.length > 600) continue
    const signals = CLAIM_SIGNALS.filter((r) => r.re.test(s)).map((r) => r.name)
    // A checkable claim needs a factual signal beyond a bare assertion verb.
    if (signals.length === 0) continue
    if (signals.length === 1 && signals[0] === 'assertion-verb') continue
    claims.push({ text: s, index: claims.length, signals })
  }
  return claims
}

// ---------------------------------------------------------------------------
// Version awareness — "compare dates and versions" (§2.5)
// ---------------------------------------------------------------------------

const VERSION_RE = /\b(?:v)?(\d{1,3}\.\d{1,3}(?:\.\d{1,3})?)\b/g

export function extractVersions(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(VERSION_RE)) out.add(m[1])
  return [...out].slice(0, 6)
}

function firstMajorMinor(versions: string[]): string | null {
  for (const v of versions) {
    const parts = v.split('.')
    if (parts.length >= 2) return `${parts[0]}.${parts[1]}`
  }
  return null
}

// ---------------------------------------------------------------------------
// Verification — the explainable decision table
// ---------------------------------------------------------------------------

export type ClaimOutcome =
  | 'verified'
  | 'strongly-supported'
  | 'partially-supported'
  | 'contradicted'
  | 'outdated'
  | 'insufficient-evidence'
  | 'unverifiable'
  | 'source-unavailable'

export const CLAIM_OUTCOMES: readonly ClaimOutcome[] = [
  'verified', 'strongly-supported', 'partially-supported', 'contradicted',
  'outdated', 'insufficient-evidence', 'unverifiable', 'source-unavailable',
]

const CLASS_RANK = { authoritative: 4, strong: 3, corroborating: 2, weak: 1, 'user-generated': 0.5 } as const
type AuthorityClass = keyof typeof CLASS_RANK

export interface ClaimCheck {
  claim: string
  claimKind: ClaimKind
  outcome: ClaimOutcome
  /** Explainable decision trail — every factor that produced the outcome. */
  basis: string[]
  supportingEvidenceIds: string[]
  contradictingEvidenceIds: string[]
  independentSupportGroups: number
  independentContradictingGroups: number
  /** Strongest single supporting authority class (never a sum over copies). */
  decisiveClass: AuthorityClass | null
  /** True when at least one supporting group is a primary authority for this claim kind. */
  hasPrimarySupport: boolean
  /** Recorded disagreement the evidence could not resolve (honest uncertainty). */
  unresolved: string | null
  /** Version mismatch note when claim and evidence speak of different versions. */
  versionNote: string | null
  /** 'outdated' outcome reason when freshness evidence forces it. */
  outdatedReason: string | null
}

export interface VerifyClaimInput {
  claim: string
  /** Records FOR the claim (already classified for this claim kind). */
  supporting: RoleTaggedEvidenceRecord[]
  /** Records AGAINST the claim. */
  contradicting?: RoleTaggedEvidenceRecord[]
  /** Now, for date math (defaults to the real clock in production). */
  now?: Date
  /** Domain recency window in days for the outdated rule (undefined disables it). */
  staleAfterDays?: number
}

export function verifyClaim(input: VerifyClaimInput): ClaimCheck {
  const kind = classifyClaimKind(input.claim)
  const basis: string[] = []
  const supporting = input.supporting
  const contradicting = input.contradicting ?? []
  const now = input.now ?? new Date()

  const validSupport = supporting.filter((r) => {
    if (r.dateValid === false) {
      basis.push(`${r.evidenceId} excluded: publication date is impossible (${String(r.identity.publishedAt)})`)
      return false
    }
    return true
  })
  const validContra = contradicting.filter((r) => {
    if (r.dateValid === false) {
      basis.push(`${r.evidenceId} excluded from contradiction: publication date is impossible`)
      return false
    }
    return true
  })

  const common = {
    claim: input.claim,
    claimKind: kind,
    independentSupportGroups: independentGroupCount(validSupport),
    independentContradictingGroups: independentGroupCount(validContra, 'contradicting'),
  }

  // Everything became unfetchable → honest source-unavailable.
  if ((input.supporting.length > 0 || contradicting.length > 0) && validSupport.length === 0 && validContra.length === 0) {
    return {
      ...common,
      outcome: 'source-unavailable',
      basis: [...basis, 'all retrieved records were unusable (impossible dates or unavailable sources)'],
      supportingEvidenceIds: [],
      contradictingEvidenceIds: [],
      decisiveClass: null,
      hasPrimarySupport: false,
      unresolved: null,
      versionNote: null,
      outdatedReason: null,
    }
  }

  const weight = summarizeEvidenceWeight(
    validSupport.map((r) => ({ authorityClass: r.authorityClass as AuthorityClass, isPrimaryForClaim: CLASS_RANK[r.authorityClass as AuthorityClass] === 4, independenceGroup: r.independenceGroup })),
    validContra.map((r) => ({ authorityClass: r.authorityClass as AuthorityClass, independenceGroup: r.independenceGroup })),
  )
  const decisiveClass = weight.decisiveClass
  const contraWeight = summarizeEvidenceWeight(
    validContra.map((r) => ({ authorityClass: r.authorityClass as AuthorityClass, isPrimaryForClaim: CLASS_RANK[r.authorityClass as AuthorityClass] === 4, independenceGroup: r.independenceGroup })),
  )

  // Version mismatch detection (claim versions vs evidence versions).
  let versionNote: string | null = null
  const claimVersions = extractVersions(input.claim)
  const claimMM = firstMajorMinor(claimVersions)
  if (claimMM) {
    const evidenceWithVersions = validSupport.filter((r) => {
      const evMM = firstMajorMinor(extractVersions(`${r.title} ${r.passage ?? ''}`))
      return evMM !== null && evMM !== claimMM
    })
    const independentMismatches = new Set(evidenceWithVersions.map((r) => r.independenceGroup)).size
    if (independentMismatches > 0 && evidenceWithVersions.length === validSupport.length) {
      versionNote = `the claim references version ${claimMM} but every supporting source speaks of a different version — the evidence may not describe this version's behavior`
      basis.push(versionNote)
    } else if (independentMismatches > 0) {
      versionNote = `some supporting sources describe a version other than ${claimMM} — version-sensitive parts are flagged`
      basis.push(versionNote)
    }
  }

  // Outdated rule: freshness-sensitive claims whose (only) support is older
  // than the caller's window. The claim must itself be time-sensitive.
  let outdatedReason: string | null = null
  if (input.staleAfterDays !== undefined && (kind === 'current-events' || kind === 'statistical' || kind === 'security-vulnerability')) {
    const ages = validSupport
      .map((r) => {
        const t = r.identity.publishedAt ? Date.parse(r.identity.publishedAt) : NaN
        return Number.isNaN(t) ? null : (now.getTime() - t) / 86400000
      })
      .filter((a): a is number => a !== null)
    if (ages.length > 0 && ages.every((a) => a > input.staleAfterDays!)) {
      outdatedReason = `every dated supporting source is older than ${input.staleAfterDays} days (newest ${Math.round(Math.min(...ages))} days) — the claim may no longer hold`
      basis.push(outdatedReason)
    }
  }

  // CONTRADICTION FIRST — an equal-or-stronger contradicting group blocks any
  // positive verdict. Resolution is only allowed when a NEWER authoritative
  // source supersedes an explicitly older contradicting one.
  const contraBest = contraWeight.bestClass
  const contraRank = contraBest ? CLASS_RANK[contraBest] : 0
  const supportRank = decisiveClass ? CLASS_RANK[decisiveClass] : 0
  if (common.independentContradictingGroups > 0) {
    if (contraRank > supportRank) {
      basis.push(`contradicting evidence (${contraBest}) is stronger than the best support (${decisiveClass ?? 'none'})`)
      return {
        ...common,
        outcome: 'contradicted',
        basis,
        supportingEvidenceIds: validSupport.map((r) => r.evidenceId),
        contradictingEvidenceIds: validContra.map((r) => r.evidenceId),
        decisiveClass,
        hasPrimarySupport: weight.hasPrimary,
        unresolved: null,
        versionNote,
        outdatedReason,
      }
    }
    if (contraRank === supportRank && contraRank >= 3) {
      // Equal-strength disagreement — record it, never silently pick a side.
      const unresolved = `independent sources of equal strength (${contraBest}) disagree about this claim — the disagreement remains unresolved`
      basis.push(unresolved)
      return {
        ...common,
        outcome: 'partially-supported',
        basis,
        supportingEvidenceIds: validSupport.map((r) => r.evidenceId),
        contradictingEvidenceIds: validContra.map((r) => r.evidenceId),
        decisiveClass,
        hasPrimarySupport: weight.hasPrimary,
        unresolved,
        versionNote,
        outdatedReason,
      }
    }
    // Weaker contradiction: noted, does not block.
    basis.push(`contradicting evidence exists but is weaker (${contraBest ?? 'unknown'}) than the best support (${decisiveClass ?? 'none'}) — noted, not decisive`)
  }

  // Positive ladder — primary-first, group-counted, UGC-capped. The outdated
  // override applies to EVERY positive outcome: time-sensitive claims whose
  // entire dated support is beyond the window are 'outdated', never fresh-PASS.
  const withOutcome = (
    positive: ClaimOutcome,
    extra: Partial<ClaimCheck>,
  ): ClaimCheck => ({
    ...common,
    outcome: outdatedReason && positive !== 'insufficient-evidence' ? 'outdated' : positive,
    basis,
    supportingEvidenceIds: ids(validSupport),
    contradictingEvidenceIds: ids(validContra),
    versionNote,
    outdatedReason,
    ...extra,
  })
  if (decisiveClass === 'authoritative') {
    if (common.independentSupportGroups >= 2) {
      basis.push(`primary-authority support corroborated by ${common.independentSupportGroups} distinct independent group(s)`)
      return withOutcome('verified', { decisiveClass, hasPrimarySupport: true, unresolved: null })
    }
    basis.push('single primary-authority group supports the claim (no independent corroboration yet)')
    return withOutcome('strongly-supported', { decisiveClass, hasPrimarySupport: true, unresolved: null })
  }
  if (decisiveClass === 'strong') {
    const positive = common.independentSupportGroups >= 2 ? 'strongly-supported' : 'partially-supported'
    basis.push(`best support is strong (${common.independentSupportGroups} distinct group(s)); no primary authority for this ${kind} claim`)
    return withOutcome(positive, { decisiveClass, hasPrimarySupport: false, unresolved: null })
  }
  if (decisiveClass === 'corroborating') {
    const positive = common.independentSupportGroups >= 2 ? 'partially-supported' : 'insufficient-evidence'
    basis.push(`best support is corroborating-only for this ${kind} claim (${common.independentSupportGroups} distinct group(s))`)
    return withOutcome(positive, { decisiveClass, hasPrimarySupport: false, unresolved: null })
  }
  if (decisiveClass === 'weak' || decisiveClass === 'user-generated') {
    basis.push('only weak/user-generated experience evidence — it can never verify a factual claim alone')
    return withOutcome('insufficient-evidence', { decisiveClass, hasPrimarySupport: false, unresolved: null })
  }

  // Nothing usable at all.
  if (input.supporting.length === 0 && contradicting.length === 0) {
    basis.push('no evidence was retrieved for this claim')
    return { ...common, outcome: 'insufficient-evidence', basis, supportingEvidenceIds: [], contradictingEvidenceIds: [], decisiveClass: null, hasPrimarySupport: false, unresolved: null, versionNote, outdatedReason }
  }
  basis.push('evidence exists but none of it is usable support for this claim')
  return { ...common, outcome: 'unverifiable', basis, supportingEvidenceIds: [], contradictingEvidenceIds: ids(validContra), decisiveClass: null, hasPrimarySupport: false, unresolved: null, versionNote, outdatedReason }
}

function ids(records: RoleTaggedEvidenceRecord[]): string[] {
  return records.map((r) => r.evidenceId)
}

// ---------------------------------------------------------------------------
// Pack → claim-level verification (one bounded pass over real retrieval)
// ---------------------------------------------------------------------------

export interface ClaimVerificationOptions {
  /** Injected retrieval (production passes the real specialist contract). */
  retrieve?: (query: string) => Promise<SpecialistEvidencePack>
  /** A second targeted hunt for contradicting evidence (bounded, §2.4). */
  huntContradictions?: boolean
  maxClaims?: number
  /** Recency window for time-sensitive claims (days). */
  staleAfterDays?: number
  now?: Date
}

export interface ClaimVerificationReport {
  claims: ClaimCheck[]
  /** Distinct source URLs across all packs actually retrieved. */
  sourcesUsed: number
  packsRetrieved: number
  degraded: string[]
  /** Honest overall statement (what is known / uncertain / unsupported). */
  summary: string
}

const CONTRADICTION_HUNT_SUFFIX = ' dispute OR contradiction OR correction OR retraction OR "in fact"'

export async function verifyClaims(
  objective: string,
  opts: ClaimVerificationOptions = {},
): Promise<ClaimVerificationReport> {
  const degraded: string[] = []
  const packs: SpecialistEvidencePack[] = []
  const retrieve = opts.retrieve
  const claims = extractFactualClaims(objective, opts.maxClaims ?? MAX_CLAIMS)

  if (!retrieve || claims.length === 0) {
    return {
      claims: [],
      sourcesUsed: 0,
      packsRetrieved: 0,
      degraded: retrieve ? [] : ['claim verification ran without retrieval (no evidence collected)'],
      summary: claims.length === 0 ? 'no checkable factual claims were identified' : 'claim verification unavailable without retrieval',
    }
  }

  try {
    packs.push(await retrieve(objective))
  } catch (e) {
    degraded.push(`evidence retrieval failed: ${e instanceof Error ? e.message.slice(0, 140) : 'unavailable'}`)
  }

  // Targeted contradiction hunt for the FIRST checkable claim only (budget).
  if (opts.huntContradictions && claims.length > 0 && packs.length > 0) {
    try {
      const huntQuery = `${claims[0].text.slice(0, 220)}${CONTRADICTION_HUNT_SUFFIX}`
      packs.push(await retrieve(huntQuery))
    } catch (e) {
      degraded.push(`contradiction hunt failed: ${e instanceof Error ? e.message.slice(0, 140) : 'unavailable'}`)
    }
  }

  if (packs.length === 0) {
    return {
      claims: [],
      sourcesUsed: 0,
      packsRetrieved: 0,
      degraded,
      summary: 'claim verification could not retrieve evidence',
    }
  }

  // Primary pack = supporting evidence; additional pack (contradiction hunt)
  // contributes contradicting candidates for the hunted claim.
  const primary = packs[0]
  const supportRecords = buildEvidenceRecords(primary, {
    assessAuthority: (s) => assessEvidenceAuthority(s, 'general'),
  })
  const huntPack = packs.length > 1 ? packs[1] : null
  const huntRecords = huntPack
    ? buildEvidenceRecords(huntPack, { assessAuthority: (s) => assessEvidenceAuthority(s, 'general'), role: 'contradicting' })
    : []

  const checks: ClaimCheck[] = claims.map((c, i) => {
    const kind = classifyClaimKind(c.text)
    const classified = supportRecords.map((r) => ({ ...r, authorityClass: kindAssessed(r, primary, kind).authorityClass, authorityBasis: kindAssessed(r, primary, kind).basis }))
    const supporting = classified
    // For the hunted claim, hunt-pack records that DISAGREE on measured values
    // become contradicting candidates; otherwise they are neutral context.
    const contradicting = i === 0 && huntRecords.length > 0
      ? huntRecords.filter((r) => r.independenceGroup !== '' && disagreeWithContext(supporting, r))
      : []
    return verifyClaim({
      claim: c.text,
      supporting,
      contradicting,
      staleAfterDays: opts.staleAfterDays,
      now: opts.now,
    })
  })

  const urlSet = new Set<string>()
  for (const p of packs) for (const s of p.evidence) urlSet.add(canonicalSourceKey(s.url, s.title))

  return {
    claims: checks,
    sourcesUsed: urlSet.size,
    packsRetrieved: packs.length,
    degraded,
    summary: summarizeClaimVerification(checks),
  }
}

function kindAssessed(
  r: RoleTaggedEvidenceRecord,
  pack: SpecialistEvidencePack,
  kind: ClaimKind,
): { authorityClass: AuthorityClass; basis: string } {
  const idx = Number(r.sourceId.replace(/\[S(\d+)\]/, '$1')) - 1
  const src = pack.evidence[idx]
  if (!src) return { authorityClass: r.authorityClass as AuthorityClass, basis: r.authorityBasis }
  const a = assessEvidenceAuthority(src, kind)
  return { authorityClass: a.authorityClass, basis: a.basis }
}

/** Deterministic disagreement heuristic: both texts carry numbers/versions of
 *  the same unit and they differ, or one asserts negation of the other. */
function disagreeWithContext(support: RoleTaggedEvidenceRecord[], candidate: RoleTaggedEvidenceRecord): boolean {
  const candNums = extractVersions(candidate.passage ?? candidate.title)
  const candText = `${candidate.passage ?? ''} ${candidate.title}`.toLowerCase()
  const negation = /\b(?:not|no|never|fails?|cannot|doesn'?t|denied|false|incorrect|refuted|disputed|retracted)\b/.test(candText)
  if (!negation && candNums.length === 0) return false
  for (const s of support) {
    const supNums = extractVersions(`${s.passage ?? ''} ${s.title}`)
    const overlap = candNums.filter((n) => supNums.includes(n))
    if (negation && overlap.length === 0 && candText.includes(s.identity.host.toLowerCase())) return true
    if (candNums.length > 0 && supNums.length > 0 && overlap.length === 0 && sameMeasureUnit(candText, `${s.passage ?? ''} ${s.title}`.toLowerCase())) return true
  }
  return false
}

const UNIT_RE = /(\d+(?:\.\d+)?)\s*(%|percent|million|billion|kg|km|mb|gb|usd|us\$|inr|₹|\$|€|£|years?|days?|users|people)/gi
function sameMeasureUnit(a: string, b: string): boolean {
  const ua = [...a.matchAll(UNIT_RE)].map((m) => m[2].toLowerCase())
  const ub = [...b.matchAll(UNIT_RE)].map((m) => m[2].toLowerCase())
  return ua.some((u) => ub.includes(u))
}

// ---------------------------------------------------------------------------
// Honest bounded summary (verification notes, receipts, handoffs)
// ---------------------------------------------------------------------------

export function summarizeClaimVerification(checks: ClaimCheck[]): string {
  if (checks.length === 0) return 'no checkable factual claims were identified'
  const byOutcome = new Map<ClaimOutcome, number>()
  for (const c of checks) byOutcome.set(c.outcome, (byOutcome.get(c.outcome) ?? 0) + 1)
  const parts = [...byOutcome.entries()].map(([o, n]) => `${n} ${o}`)
  const unresolved = checks.filter((c) => c.unresolved)
  const contradicted = checks.filter((c) => c.outcome === 'contradicted')
  let s = `claim verification over ${checks.length} checkable claim(s): ${parts.join(', ')}; not all statements above were independently verified`
  if (contradicted.length > 0) s += `; ${contradicted.length} claim(s) contradicted by stronger evidence`
  if (unresolved.length > 0) s += `; ${unresolved.length} disagreement(s) remain unresolved and are stated as uncertain`
  return s.slice(0, 400)
}
