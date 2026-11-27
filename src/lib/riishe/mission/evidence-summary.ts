/**
 * BEAN Intelligence — M43 §7: claim-level evidence summaries for mission
 * research/knowledge task payloads.
 *
 * PURE adapter between the mission executor's retrieved sources and the M43
 * evidence engine: builds evidence records, runs the deterministic claim
 * verification + contradiction layers over what was ACTUALLY retrieved (no
 * extra network calls — the mission budget is never multiplied), and produces
 * the bounded additive payload fields the verifiers and receipts carry.
 *
 * Honesty rules inherited from the engine: nothing is forced to PASS;
 * insufficient evidence says insufficient; disagreements stay unresolved and
 * are stated; attribution is bounded and preserved for handoffs.
 * PURE module — no I/O, no model calls.
 */

import { buildEvidenceRecords, attributionView, type EvidenceAttributionView, type RoleTaggedEvidenceRecord } from '@/lib/research/evidence'
import { assessEvidenceAuthority } from '@/lib/research/source-trust'
import { extractFactualClaims, verifyClaim, type ClaimOutcome } from '@/lib/research/claim-verification'
import { detectClaimContradictions, uncertaintyStatement } from '@/lib/research/contradiction-reasoning'
import { domainForClaim, assessFreshness } from '@/lib/research/freshness'
import { classifyHost } from '@/lib/research/rank'

/** The executor-side source shape (ToolSource). */
export interface SummarySource {
  url: string
  title: string
  hostName: string
  date: string | null
  pageRead?: boolean
}

export interface ClaimSummary {
  claim: string
  outcome: ClaimOutcome
  /** First explainable basis line (bounded). */
  note: string
}

export interface ResearchEvidenceSummary {
  claims: ClaimSummary[]
  uncertainty: string | null
  evidenceAttribution: EvidenceAttributionView[]
  domain: string
  freshnessStatus: 'fresh' | 'aging' | 'expired' | 'unknown'
  freshnessReason: string
}

const MAX_SUMMARY_CLAIMS = 5

function buildRecords(sources: SummarySource[], claim: string): RoleTaggedEvidenceRecord[] {
  const now = new Date().toISOString()
  const pack = {
    consumer: 'knowledge' as const,
    purpose: 'fact-check' as const,
    evidence: sources.slice(0, 16).map((s, i) => {
      const cls = classifyHost(s.hostName)
      return {
        sourceId: `[S${i + 1}]`,
        title: s.title || s.hostName,
        url: s.url,
        host: s.hostName,
        sourceType: cls.official ? 'official' : cls.sourceType,
        author: null,
        publishedAt: s.date ?? null,
        retrievedAt: now,
        excerpt: null,
        pageRead: s.pageRead ?? false,
        provenance: { channel: null as string | null, engine: 'gateway' },
        official: cls.official,
      }
    }),
    queries: [],
    cacheHits: 0,
    fetchedAt: now,
    freshnessWarnings: [],
    degraded: [],
    elapsedMs: 0,
    skippedReason: null,
    searchCalls: 0,
    pageReadCalls: 0,
  }
  const domain = domainForClaim(claim, 'general')
  return buildEvidenceRecords(pack, {
    assessAuthority: (s) => assessEvidenceAuthority(s, domain === 'security-vulnerability' ? 'security-vulnerability' : 'general'),
  })
}

/**
 * Claim-level summary over the sources a research task ACTUALLY retrieved.
 * The claim texts come from the task topic (deterministic extraction); each
 * is checked against the retrieved records only — never against fresh
 * retrieval, never against model knowledge.
 */
export function buildResearchEvidenceSummary(topic: string, sources: SummarySource[]): ResearchEvidenceSummary | null {
  const claimable = topic.trim()
  if (claimable.length < 24 || sources.length === 0) return null

  const records = buildRecords(sources, claimable)
  const claims = extractFactualClaims(claimable, MAX_SUMMARY_CLAIMS)

  const summaries: ClaimSummary[] = []
  for (const c of claims) {
    const check = verifyClaim({ claim: c.text, supporting: records })
    summaries.push({
      claim: c.text.slice(0, 300),
      outcome: check.outcome,
      note: (check.unresolved ?? check.basis[0] ?? check.outcome).slice(0, 200),
    })
  }

  // Cross-source contradictions over the full record set (context preserved).
  const contradictions = records.length >= 2
    ? detectClaimContradictions(claims[0]?.text ?? claimable, records)
    : { findings: [], measureFindings: 0, unresolvedCount: 0, resolvableCount: 0 }
  const uncertainty = uncertaintyStatement(
    contradictions,
    summaries.filter((s) => s.outcome === 'partially-supported').map((s) => ({ claim: s.claim, unresolved: s.note })),
  ) || null

  // Freshness of the SET for the topic's domain (weakest record governs the note).
  const domain = domainForClaim(claimable, 'general')
  let freshnessStatus: ResearchEvidenceSummary['freshnessStatus'] = 'unknown'
  let freshnessReason = 'no dated source in the retrieved set'
  let worst: 'fresh' | 'aging' | 'expired' | 'unknown' = 'fresh'
  let anyDated = false
  for (const r of records) {
    const a = assessFreshness(r, domain)
    anyDated = anyDated || a.ageDays !== null
    const rank = { fresh: 0, aging: 1, expired: 2, unknown: 1 }
    if (rank[a.status] > rank[worst]) worst = a.status
    if (a.status === 'expired') freshnessReason = a.reason.slice(0, 200)
  }
  freshnessStatus = anyDated ? worst : 'unknown'

  return {
    claims: summaries,
    uncertainty,
    evidenceAttribution: attributionView(records),
    domain,
    freshnessStatus,
    freshnessReason,
  }
}
