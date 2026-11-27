/**
 * BEAN Intelligence — M43 continuous knowledge freshness (Phase 5).
 *
 * NOT all knowledge changes at the same rate. One domain-sensitive freshness
 * policy per knowledge domain:
 *   - security vulnerabilities: frequent checks;
 *   - software documentation: recheck when versions change;
 *   - prices and availability: verify near the time of use;
 *   - laws and regulations: verify current jurisdiction and effective dates;
 *   - scientific fundamentals: slower revalidation;
 *   - historical facts: preserve stable source provenance (no expiry);
 *   - current events: short window, frequent revalidation.
 *
 * Honest guarantees encoded here:
 *  - a record WITHOUT a usable publication date is `unknown` — never silently
 *    fresh, never silently expired;
 *  - expired evidence is IDENTIFIED (status + reason), never silently used;
 *  - supersession NEVER destroys history: the previous evidence chain is
 *    preserved on the merged record;
 *  - disappeared sources are marked unavailable with the reason — the record
 *    and its provenance survive;
 *  - the policy NEVER triggers polling loops: it computes due-ness for the
 *    existing scheduled/demand-triggered revalidation infrastructure, it does
 *    not perform network calls itself.
 *
 * PURE module — regex + date math only. No I/O, no timers, no model calls.
 */

import type { RoleTaggedEvidenceRecord } from './evidence'
import type { ClaimKind } from './source-trust'

export type KnowledgeDomain =
  | 'security-vulnerability'
  | 'software-docs'
  | 'price-availability'
  | 'legal-regulatory'
  | 'science-fundamentals'
  | 'historical'
  | 'current-events'

export const KNOWLEDGE_DOMAINS: readonly KnowledgeDomain[] = [
  'security-vulnerability', 'software-docs', 'price-availability',
  'legal-regulatory', 'science-fundamentals', 'historical', 'current-events',
]

export interface FreshnessPolicy {
  /** Age beyond which evidence is EXPIRED for this domain; null = never expires. */
  maxAgeDays: number | null
  /** Age beyond which evidence is merely AGING (recheck recommended). */
  agingAfterDays: number | null
  /** How revalidation happens for this domain (feeds existing schedulers). */
  revalidation: 'scheduled' | 'on-use' | 'version-change' | 'none'
  /** Human-readable policy rule. */
  rule: string
}

export const FRESHNESS_POLICIES: Record<KnowledgeDomain, FreshnessPolicy> = {
  'security-vulnerability': {
    maxAgeDays: 30, agingAfterDays: 7, revalidation: 'scheduled',
    rule: 'security advisories change frequently — check often; affected-version ranges move as patches land',
  },
  'software-docs': {
    maxAgeDays: 180, agingAfterDays: 90, revalidation: 'version-change',
    rule: 'documentation is rechecked when the relevant software version changes — version mismatch flags supersession',
  },
  'price-availability': {
    maxAgeDays: 7, agingAfterDays: 2, revalidation: 'on-use',
    rule: 'prices and availability are verified near the time of use — older figures are never presented as current',
  },
  'legal-regulatory': {
    maxAgeDays: 90, agingAfterDays: 30, revalidation: 'on-use',
    rule: 'verify the current jurisdiction and effective dates at use time — amendments supersede older texts',
  },
  'science-fundamentals': {
    maxAgeDays: 1825, agingAfterDays: 730, revalidation: 'scheduled',
    rule: 'foundational science revalidates slowly — replicate vs overturn, never silent flips',
  },
  historical: {
    maxAgeDays: null, agingAfterDays: null, revalidation: 'none',
    rule: 'historical facts do not expire — provenance and retrieval dates are preserved permanently',
  },
  'current-events': {
    maxAgeDays: 14, agingAfterDays: 3, revalidation: 'scheduled',
    rule: 'current events age in days — recheck before reuse and date-stamp every statement',
  },
}

// ---------------------------------------------------------------------------
// Domain classification — deterministic from claim/record text
// ---------------------------------------------------------------------------

const DOMAIN_RULES: Array<[KnowledgeDomain, RegExp]> = [
  ['security-vulnerability', /\b(?:CVE-|GHSA-|vulnerabilit|security advisory|zero[- ]day|exploit|patch|breach|malware)\b/i],
  ['price-availability', /\b(?:price|pricing|costs?|fee|subscription|availability|in stock|out of stock|discount|offer|rate card|tariff)\b/i],
  ['legal-regulatory', /\b(?:law|regulation|statute|directive|compliance|jurisdiction|court|act|amendment|effective date|notified|gazette)\b/i],
  ['software-docs', /\b(?:API|SDK|library|framework|docs|documentation|release notes|changelog|deprecat|semver|version \d|Node\.js|npm|PyPI|compiler|runtime|endpoint)\b/i],
  ['current-events', /\b(?:announced|reported|today|yesterday|this week|this month|breaking|ongoing|election|summit|launched)\b/i],
  ['science-fundamentals', /\b(?:theory|law of|constant|element|periodic|gravit|evolution|photosynthesis|thermodynamic|mathematic|theorem|fundamental)\b/i],
  ['historical', /\b(?:in \d{3,4}|century|dynasty|empire|ancient|medieval|histor(?:y|ical)|founded in|established in|world war|independence)\b/i],
]

export function classifyKnowledgeDomain(text: string): KnowledgeDomain {
  const t = text.slice(0, 1500)
  for (const [domain, re] of DOMAIN_RULES) {
    if (re.test(t)) return domain
  }
  return 'current-events' // unclassifiable text is treated as time-sensitive (the conservative default)
}

/** Claim-kind → default domain when the text itself is ambiguous. */
const KIND_TO_DOMAIN: Partial<Record<ClaimKind, KnowledgeDomain>> = {
  'security-vulnerability': 'security-vulnerability',
  'technical-behavior': 'software-docs',
  regulatory: 'legal-regulatory',
  'research-finding': 'science-fundamentals',
  statistical: 'current-events',
  'current-events': 'current-events',
  'community-experience': 'current-events',
}

export function domainForClaim(claim: string, claimKind: ClaimKind): KnowledgeDomain {
  const fromText = classifyKnowledgeDomain(claim)
  if (fromText !== 'current-events') return fromText
  return KIND_TO_DOMAIN[claimKind] ?? 'current-events'
}

// ---------------------------------------------------------------------------
// Freshness assessment per record
// ---------------------------------------------------------------------------

export type FreshnessStatus = 'fresh' | 'aging' | 'expired' | 'unknown'

export interface FreshnessAssessment {
  status: FreshnessStatus
  domain: KnowledgeDomain
  policy: FreshnessPolicy
  ageDays: number | null
  /** Human-readable reason (stated, never guessed). */
  reason: string
  /** True when this record should be revalidated before reuse. */
  revalidationDue: boolean
  /** True when a newer version of the referenced software makes this superseded. */
  versionSuperseded: boolean | null
}

function ageDaysOf(record: RoleTaggedEvidenceRecord, now: Date): number | null {
  const raw = record.identity.publishedAt
  if (!raw) return null
  const t = Date.parse(raw)
  if (Number.isNaN(t)) return null
  return Math.max(0, (now.getTime() - t) / 86400000)
}

const VERSION_NUM_RE = /\b(?:v)?(\d{1,3})\./g

/** Highest major version mentioned in text (null when none). */
export function highestMajorVersion(text: string): number | null {
  let max: number | null = null
  for (const m of text.matchAll(VERSION_NUM_RE)) {
    const n = Number(m[1])
    if (Number.isFinite(n) && (max === null || n > max)) max = n
  }
  return max
}

export function assessFreshness(
  record: RoleTaggedEvidenceRecord,
  domain: KnowledgeDomain,
  now = new Date(),
): FreshnessAssessment {
  const policy = FRESHNESS_POLICIES[domain]
  const ageDays = ageDaysOf(record, now)

  // Version-aware supersession (software-docs): the record talks about an
  // OLDER major version than the record's own claim context mentions.
  let versionSuperseded: boolean | null = null
  if (domain === 'software-docs') {
    const recordVersions = highestMajorVersion(`${record.title} ${record.passage ?? ''}`)
    versionSuperseded = recordVersions !== null ? recordVersions : null
  }

  if (ageDays === null) {
    return {
      status: 'unknown',
      domain,
      policy,
      ageDays: null,
      reason: 'no usable publication date — freshness cannot be established (stated as unknown, never guessed)',
      revalidationDue: policy.revalidation !== 'none',
      versionSuperseded,
    }
  }
  if (policy.maxAgeDays !== null && ageDays > policy.maxAgeDays) {
    return {
      status: 'expired',
      domain,
      policy,
      ageDays,
      reason: `${Math.round(ageDays)} days old — beyond the ${policy.maxAgeDays}-day window for ${domain} (${policy.rule})`,
      revalidationDue: true,
      versionSuperseded,
    }
  }
  if (policy.agingAfterDays !== null && ageDays > policy.agingAfterDays) {
    return {
      status: 'aging',
      domain,
      policy,
      ageDays,
      reason: `${Math.round(ageDays)} days old — recheck recommended for ${domain} (${policy.rule})`,
      revalidationDue: true,
      versionSuperseded,
    }
  }
  return {
    status: 'fresh',
    domain,
    policy,
    ageDays,
    reason: `${Math.round(ageDays)} days old — within the ${policy.maxAgeDays ?? 'unlimited'}-day window for ${domain}`,
    revalidationDue: false,
    versionSuperseded,
  }
}

// ---------------------------------------------------------------------------
// Supersession chains — never silently update; history is preserved
// ---------------------------------------------------------------------------

export interface SupersessionChain<T> {
  current: T
  /** The full prior evidence chain, OLDEST first. */
  previous: T[]
  reason: string
}

/**
 * Merge a revalidated record over its predecessor. The CURRENT pointer moves,
 * but every prior record stays reachable in `previous` — a previously
 * verified claim's evidence and provenance are never destroyed.
 */
export function supersedeRecord<T extends { identity: { publishedAt: string | null; retrievedAt: string }; evidenceId: string }>(
  previousChain: SupersessionChain<T> | null,
  next: T,
  reason: string,
): SupersessionChain<T> {
  const previous = [...(previousChain?.previous ?? []), ...(previousChain ? [previousChain.current] : [])]
  return {
    current: next,
    previous,
    reason,
  }
}

// ---------------------------------------------------------------------------
// Source disappearance — mark, keep, never delete
// ---------------------------------------------------------------------------

export type SourceAvailability = 'available' | 'unavailable' | 'gone'

export interface AvailabilityMark {
  availability: SourceAvailability
  reason: string
  markedAt: string
}

export function markSourceUnavailable(recordId: string, httpStatus: number | null, now = new Date()): AvailabilityMark {
  const availability: SourceAvailability = httpStatus === 404 || httpStatus === 410 ? 'gone' : 'unavailable'
  const reason =
    availability === 'gone'
      ? `source ${recordId} no longer exists (HTTP ${httpStatus}) — the record and its provenance are retained; the claim must not rely on it alone`
      : `source ${recordId} could not be retrieved (HTTP ${httpStatus ?? 'network error'}) — marked unavailable, not deleted; revalidation may restore it`
  return { availability, reason, markedAt: now.toISOString() }
}
