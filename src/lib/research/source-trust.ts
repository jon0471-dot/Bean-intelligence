/**
 * BEAN Intelligence — M43 domain-sensitive source authority & trust (Phase 3).
 *
 * Authority depends on the CLAIM being investigated: a government source is
 * authoritative for a regulation but not necessarily for an unrelated
 * scientific claim; official product documentation is authoritative for
 * technical behavior; original advisories for vulnerabilities; original
 * datasets for statistics. Community discussion is experience evidence —
 * labeled user-generated and NEVER automatically authoritative truth.
 *
 * Manipulation immunity (by construction): authority is a pure function of
 * (host class × claim-kind match × lane-supplied flags). Popularity,
 * repetition, SEO ranking or coordinated copies can never raise it — copies
 * collapse into one independence group upstream (`canonicalSourceKey`) and
 * frequency never enters this module.
 *
 * The M42 low-authority treatment of user-generated content is preserved:
 * UGC never outranks an authoritative primary source for the same claim.
 */

import { isOfficialHost, isPrimaryHost } from './rank'

// ---------------------------------------------------------------------------
// Claim kinds — what KIND of statement is being verified?
// ---------------------------------------------------------------------------

export type ClaimKind =
  | 'regulatory'
  | 'technical-behavior'
  | 'research-finding'
  | 'security-vulnerability'
  | 'statistical'
  | 'eyewitness'
  | 'current-events'
  | 'community-experience'
  | 'general'

export const CLAIM_KINDS: readonly ClaimKind[] = [
  'regulatory', 'technical-behavior', 'research-finding', 'security-vulnerability',
  'statistical', 'eyewitness', 'current-events', 'community-experience', 'general',
]

const KIND_RE: Array<[ClaimKind, RegExp]> = [
  ['security-vulnerability', /\b(?:CVE-\d{4}-\d{4,}|GHSA-[\w-]+|vulnerabilit(?:y|es)|security advisory|zero[- ]day|exploit|RCE|remote code execution|SQL injection|prototype pollution|malware|data breach|patch(?:ed|ing)? (?:version|release))\b/i],
  ['regulatory', /\b(?:law|laws|legal|regulation|regulations|regulator|statute|directive|legislation|compliance|GDPR|CCPA|jurisdiction|court|ruling|act of parliament|tax|visa|customs|import (?:rules|ban)|export (?:rules|ban)|licen[cs]e requirement|effective date|statutory)\b/i],
  ['research-finding', /\b(?:study|studies|researchers|peer[- ]review(?:ed)?|meta[- ]analysis|randomized|clinical trial|preprint|journal|proceedings|doi|hypothes[ie]s|in vitro|in vivo|epidemiolog)\b/i],
  ['technical-behavior', /\b(?:API|SDK|library|framework|compiler|runtime|endpoint|CLI|command[- ]line|npm|PyPI|package|dependency|semver|release notes|changelog|deprecat(?:ed|ion)|breaking change|config(?:uration)? flag|default (?:value|behavior)|browser support|type definition)\b/i],
  ['statistical', /\b(?:percent|%|percentage|statistics|statistically|dataset|survey|census|per capita|median|mean value|year[- ]over[- ]year|quarterly (?:figures|results)|unemployment rate|inflation rate|population of)\b/i],
  ['eyewitness', /\b(?:eyewitness|witness(?:ed|es)?|on the scene|residents (?:said|report)|according to (?:bystanders|those present)|first[- ]hand account)\b/i],
  ['community-experience', /\b(?:reddit|stack overflow|hacker news|forum|in my experience|users (?:report|say)|community report|workaround)\b/i],
  ['current-events', /\b(?:announced|reported|today|yesterday|this (?:week|month)|breaking|ongoing|summit|election|election results|launched (?:today|this week)|scheduled for)\b/i],
]

/** Deterministic, I/O-free claim-kind classification (first match wins). */
export function classifyClaimKind(claim: string): ClaimKind {
  const text = claim.slice(0, 1200)
  for (const [kind, re] of KIND_RE) {
    if (re.test(text)) return kind
  }
  return 'general'
}

// ---------------------------------------------------------------------------
// The authority matrix — host class × claim-kind match
// ---------------------------------------------------------------------------

export interface SourceTrustInput {
  host: string
  sourceType: string // ranker class: official | reference | news | social | other (+ direct-lane labels)
  official: boolean
  social: boolean
  /** Lane-declared direct provenance (academic/registry/advisory adapters). */
  engine?: string | null
}

export interface SourceTrustAssessment {
  authorityClass: 'authoritative' | 'strong' | 'corroborating' | 'weak' | 'user-generated'
  /** True when this source class is a PRIMARY authority for this claim kind. */
  isPrimaryForClaim: boolean
  /** Explainable one-line basis (why this class for this claim). */
  basis: string
}

const ACADEMIC_HOST_RE = /(?:^|\.)(?:arxiv\.org|nature\.com|science\.org|doi\.org|crossref\.org|openalex\.org|doaj\.org|plos\.org|springer\.com|sciencedirect\.com|ieee\.org|acm\.org|pubmed\.ncbi\.nlm\.nih\.gov|biorxiv\.org|medrxiv\.org)$/i
const ADVISORY_HOST_RE = /(?:^|\.)(?:osv\.dev|nvd\.nist\.gov|cve\.org|mitre\.org|github\.com|gov\.uk|cert\.org|us-cert\.gov|cisa\.gov)$/i
const DATA_HOST_RE = /(?:^|\.)(?:data\.gov|data\.gov\.in|data\.europa\.eu|stats?(?:\.gov|\.org)|census\.gov|worldbank\.org|imf\.org|oecd\.org|un\.org|who\.int|ecdc\.europa\.eu|ourworldindata\.org|eurostat\.ec\.europa\.eu)$/i
const DOC_HOST_RE = /(?:^|\.)(?:developer\.mozilla\.org|nodejs\.org|nextjs\.org|reactjs\.org|vuejs\.org|angular\.io|python\.org|docs\.(?:python|golang|rust-lang)\.org|npmjs\.com|pypi\.org|ruby-lang\.org|php\.net|go\.dev|learn\.microsoft\.com|docs\.microsoft\.com|developer\.apple\.com|developer\.android\.com|cloud\.google\.com|docs\.aws\.amazon\.com|learn\.aws\.amazon\.com)$/i
const REPUTABLE_NEWS_HINT_RE = /^(?:bbc|reuters|apnews|nytimes|theguardian|wsj|bloomberg|ft|economist|dw|aljazeera|npr|pbs|cnn|hindu|timesofindia|indianexpress|ndtv)\./i

function hostClass(src: SourceTrustInput): 'government' | 'academic' | 'advisory' | 'standards-docs' | 'data' | 'reference' | 'news' | 'social' | 'vendor' | 'other' {
  const h = src.host.toLowerCase()
  if (src.social) return 'social'
  if (ADVISORY_HOST_RE.test(h)) return 'advisory' // specific advisory hosts (incl. .gov security agencies) classify BEFORE the generic government suffix
  if (isOfficialHost(h) && (h.endsWith('.gov') || /\.(?:gov|nic\.in|gc\.ca|gov\.uk|gov\.au|govt\.nz)(?:[:/]|$)/.test(h))) return 'government'
  if (ACADEMIC_HOST_RE.test(h)) return 'academic'
  if (DATA_HOST_RE.test(h)) return 'data'
  if (DOC_HOST_RE.test(h)) return 'standards-docs'
  if (src.official) return 'government' // institutional (.edu/.ac.uk/.europa.eu/.un.org/.who.int)
  if (src.sourceType === 'reference') return 'reference'
  if (src.sourceType === 'news' || REPUTABLE_NEWS_HINT_RE.test(h)) return 'news'
  if (isPrimaryHost(h)) return 'vendor'
  return 'other'
}

/** Which host classes are PRIMARY authorities for a given claim kind. */
const PRIMARY_FOR: Record<ClaimKind, ReadonlySet<string>> = {
  regulatory: new Set(['government']),
  'technical-behavior': new Set(['standards-docs', 'vendor']),
  'research-finding': new Set(['academic']),
  'security-vulnerability': new Set(['advisory']),
  statistical: new Set(['data', 'government']),
  eyewitness: new Set([]), // first-hand accounts: no host class is automatically primary
  'current-events': new Set(['news', 'government']),
  'community-experience': new Set(['social']), // experience evidence: UGC IS the first-hand class
  general: new Set([]),
}

/** Classes considered strong secondary support for a claim kind. */
const STRONG_FOR: Record<ClaimKind, ReadonlySet<string>> = {
  regulatory: new Set(['news']),
  'technical-behavior': new Set(['advisory', 'data']),
  'research-finding': new Set(['news', 'data']),
  'security-vulnerability': new Set(['standards-docs', 'vendor', 'government', 'news']),
  statistical: new Set(['academic', 'news']),
  eyewitness: new Set(['news']),
  'current-events': new Set(['news', 'data']),
  'community-experience': new Set([]),
  general: new Set(['reference', 'news']),
}

/**
 * Assess one source's authority FOR THIS CLAIM KIND. Pure and deterministic —
 * frequency/popularity can never enter (they are not inputs).
 */
export function assessSourceAuthority(src: SourceTrustInput, claimKind: ClaimKind): SourceTrustAssessment {
  const cls = hostClass(src)
  const primary = PRIMARY_FOR[claimKind].has(cls)
  const strong = STRONG_FOR[claimKind].has(cls)

  if (cls === 'social') {
    // M42 rule preserved: user-generated content stays labeled and low.
    return {
      authorityClass: 'user-generated',
      isPrimaryForClaim: claimKind === 'community-experience',
      basis: `user-generated content on ${src.host} — experience/discovery evidence only, never automatic authoritative truth for ${claimKind} claims`,
    }
  }
  if (primary) {
    return {
      authorityClass: 'authoritative',
      isPrimaryForClaim: true,
      basis: `${cls} source is a primary authority for ${claimKind} claims (${src.host})`,
    }
  }
  if (strong) {
    return {
      authorityClass: 'strong',
      isPrimaryForClaim: false,
      basis: `${cls} source is strong secondary support for ${claimKind} claims (${src.host})`,
    }
  }
  if (cls === 'reference' || cls === 'news' || cls === 'data' || cls === 'academic' || cls === 'vendor' || cls === 'standards-docs' || cls === 'government' || cls === 'advisory') {
    return {
      authorityClass: 'corroborating',
      isPrimaryForClaim: false,
      basis: `${cls} source outside its primary domain for ${claimKind} claims — corroborating only (${src.host})`,
    }
  }
  return {
    authorityClass: 'weak',
    isPrimaryForClaim: false,
    basis: `unclassified host ${src.host} — weak for ${claimKind} claims`,
  }
}

/** Convenience adapter from the M42 evidence shape. */
export function assessEvidenceAuthority(
  s: { host: string; sourceType: string; official: boolean; provenance: { engine: string } },
  claimKind: ClaimKind,
): SourceTrustAssessment {
  return assessSourceAuthority(
    { host: s.host, sourceType: s.sourceType, official: s.official, social: s.sourceType === 'social', engine: s.provenance?.engine ?? null },
    claimKind,
  )
}

// ---------------------------------------------------------------------------
// Aggregation — evidence weight is CLASS-driven, never COUNT-driven
// ---------------------------------------------------------------------------

const CLASS_RANK: Record<SourceTrustAssessment['authorityClass'], number> = {
  authoritative: 4,
  strong: 3,
  corroborating: 2,
  weak: 1,
  'user-generated': 0.5,
}

export interface EvidenceWeightSummary {
  /** Highest authority class present among supporting independence groups. */
  bestClass: SourceTrustAssessment['authorityClass'] | null
  /** Whether at least one independence group is a primary authority here. */
  hasPrimary: boolean
  /** Distinct supporting independence groups (copies never inflate this). */
  independentSupportGroups: number
  /** Distinct contradicting independence groups. */
  independentContradictingGroups: number
  /**
   * The class of the strongest SINGLE group — a large number of weak sources
   * can never outweigh one authoritative primary source automatically.
   */
  decisiveClass: SourceTrustAssessment['authorityClass'] | null
  basis: string
}

export function summarizeEvidenceWeight(
  supporting: Array<{ authorityClass: SourceTrustAssessment['authorityClass']; isPrimaryForClaim: boolean; independenceGroup: string }>,
  contradicting: Array<{ authorityClass: SourceTrustAssessment['authorityClass']; independenceGroup: string }> = [],
): EvidenceWeightSummary {
  const supportGroups = new Map<string, SourceTrustAssessment['authorityClass']>()
  for (const s of supporting) {
    const prev = supportGroups.get(s.independenceGroup)
    // A group's class is the BEST class among its copies (same article).
    if (prev === undefined || CLASS_RANK[s.authorityClass] > CLASS_RANK[prev]) supportGroups.set(s.independenceGroup, s.authorityClass)
  }
  const contraGroups = new Set(contradicting.map((c) => c.independenceGroup))
  const classes = [...supportGroups.values()]
  let bestClass: SourceTrustAssessment['authorityClass'] | null = null
  for (const c of classes) {
    if (bestClass === null || CLASS_RANK[c] > CLASS_RANK[bestClass]) bestClass = c
  }
  const hasPrimary = supporting.some((s) => s.isPrimaryForClaim)
  const decisiveClass = bestClass
  const basis = hasPrimary
    ? `at least one primary-authority independence group (${supportGroups.size} distinct group(s))`
    : bestClass
      ? `best available support is ${bestClass} across ${supportGroups.size} distinct group(s); no primary authority for this claim kind`
      : 'no supporting evidence groups'
  return {
    bestClass,
    hasPrimary,
    independentSupportGroups: supportGroups.size,
    independentContradictingGroups: contraGroups.size,
    decisiveClass,
    basis,
  }
}
