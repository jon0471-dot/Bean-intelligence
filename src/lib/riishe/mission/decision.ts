/**
 * BEAN Intelligence — M44 Phase 1: the decision engine (pure).
 *
 * One reusable decision surface that turns an objective + evidence into an
 * explainable choice among real alternatives. It consumes the M43 evidence
 * layer's honest outputs (claim outcomes, uncertainty statements, freshness,
 * attribution) and the M41 mission vocabulary — it introduces neither a new
 * orchestration framework nor a new research path.
 *
 * Honesty rules encoded HERE (not left to callers):
 *   1. A decision is never stronger than its evidence: confidence is computed
 *      deterministically from the M43 claim outcomes; unsupported critical
 *      claims lower it; a contradicted claim states itself in the rationale.
 *   2. Insufficient evidence refuses to manufacture certainty — the result
 *      kind says `insufficient-evidence` and the engine names what is missing.
 *   3. Alternatives are genuinely compared (bounded deterministic scoring
 *      matrix); the rationale explains why the selected approach won.
 *   4. Decisions that exceed the configured confidence threshold or the
 *      authorization boundary (risk class / reversibility) are ESCALATED —
 *      the engine never auto-advances beyond what it is allowed to decide.
 *   5. Between comparable alternatives, reversibility wins: an irreversible
 *      path must be strictly better to displace a reversible one, and the
 *      tie is explained.
 *
 * PURE module — no database, no I/O, no model calls. SERVER-ONLY consumers.
 */

import type { ResearchEvidenceSummary } from './evidence-summary'

// ---------------------------------------------------------------------------
// Evidence classification — M43 outcomes sorted into decision inputs.
// ---------------------------------------------------------------------------

/** The M43 claim-ladder outcomes a decision can stand on. */
export type DecisionFactStrength =
  | 'verified' // Verified / Strongly supported (primary or independent corroboration)
  | 'partial' // Partially supported — usable with a stated caveat
  | 'unsupported' // Insufficient evidence / Unverifiable / Source unavailable
  | 'contradicted' // Sources disagree — never silently resolved
  | 'outdated' // Expired freshness for the domain policy

export interface DecisionFact {
  /** The claim/fact text (bounded by the evidence layer already). */
  text: string
  strength: DecisionFactStrength
  /** Why this classification holds (bounded, from the M43 basis note). */
  basis: string
  /** Canonical source attribution carried through from M43 (bounded). */
  attribution: string
}

export interface EvidenceClassification {
  verifiedFacts: DecisionFact[]
  assumptions: DecisionFact[]
  uncertainties: DecisionFact[]
  missingInformation: string[]
  /** Stated when sources disagree — preserved context, never silently resolved. */
  contradictionNote: string | null
  /** Weakest freshness status across the evidence set. */
  freshnessStatus: 'fresh' | 'aging' | 'expired' | 'unknown'
}

const MAX_FACTS_PER_CLASS = 8
const MAX_MISSING = 6

/** Map one M43 claim outcome to a decision fact strength. */
export function strengthForOutcome(outcome: string): DecisionFactStrength {
  switch (outcome) {
    case 'verified':
    case 'strongly-supported':
      return 'verified'
    case 'partially-supported':
      return 'partial'
    case 'contradicted':
      return 'contradicted'
    case 'outdated':
      return 'outdated'
    default:
      // insufficient-evidence | unverifiable | source-unavailable — honest gaps.
      return 'unsupported'
  }
}

/**
 * Classify the M43 evidence summary into the decision inputs. The summary is
 * the ALREADY-VERIFIED evidence the mission actually retrieved — this function
 * invents nothing and never fetches.
 */
export function classifyEvidence(summary: ResearchEvidenceSummary | null, missingInformation: string[] = []): EvidenceClassification {
  const classification: EvidenceClassification = {
    verifiedFacts: [],
    assumptions: [],
    uncertainties: [],
    missingInformation: missingInformation.slice(0, MAX_MISSING),
    contradictionNote: summary?.uncertainty ?? null,
    freshnessStatus: summary?.freshnessStatus ?? 'unknown',
  }
  if (!summary) return classification
  for (const claim of summary.claims.slice(0, 12)) {
    const fact: DecisionFact = {
      text: claim.claim,
      strength: strengthForOutcome(claim.outcome),
      basis: claim.note.slice(0, 200),
      attribution: summary.evidenceAttribution[0]?.url?.slice(0, 200) ?? '',
    }
    const bucket =
      fact.strength === 'verified' || fact.strength === 'outdated'
        ? fact.strength === 'outdated'
          ? 'uncertainties'
          : 'verifiedFacts'
        : fact.strength === 'partial'
          ? 'assumptions'
          : fact.strength === 'contradicted'
            ? 'uncertainties'
            : 'missingInformation'
    if (bucket === 'missingInformation') {
      if (classification.missingInformation.length < MAX_MISSING) {
        classification.missingInformation.push(`no adequate evidence: ${fact.text.slice(0, 140)}`)
      }
      continue
    }
    const target = classification[bucket as 'verifiedFacts' | 'assumptions' | 'uncertainties']
    if (target.length < MAX_FACTS_PER_CLASS) target.push(fact)
  }
  return classification
}

// ---------------------------------------------------------------------------
// Alternatives — bounded, comparable, risk/reversibility-aware.
// ---------------------------------------------------------------------------

export type Reversibility = 'reversible' | 'compensable' | 'irreversible'

/** Authorization-boundary risk vocabulary (shared with Phase 2/3 contracts). */
export type DecisionRiskClass =
  | 'read-only'
  | 'reversible'
  | 'irreversible'
  | 'external-communication'
  | 'financial'
  | 'sensitive-data'

export interface DecisionAlternative {
  id: string
  /** Customer-safe label. */
  label: string
  description: string
  /** Expected benefit, 0–3 (documented scale). */
  benefit: number
  /** Expected cost/effort, 0–3 (documented scale). */
  cost: number
  /** Risk if it goes wrong, 0–3 (documented scale). */
  risk: number
  reversibility: Reversibility
  riskClass: DecisionRiskClass
  /** Alternative ids this one depends on or presupposes. */
  dependencies: string[]
  prerequisites: string[]
  /** Which evidence facts stand behind this alternative (ids/claim texts). */
  evidenceBasis: string[]
}

const REVERSIBILITY_PENALTY: Record<Reversibility, number> = { reversible: 0, compensable: 0.3, irreversible: 0.8 }

/** Deterministic comparison score (higher wins; every term explainable). */
export function scoreAlternative(a: DecisionAlternative): number {
  const benefit = Math.min(3, Math.max(0, a.benefit))
  const cost = Math.min(3, Math.max(0, a.cost))
  const risk = Math.min(3, Math.max(0, a.risk))
  return benefit - 0.5 * cost - 0.6 * risk - REVERSIBILITY_PENALTY[a.reversibility] + Math.min(a.evidenceBasis.length, 3) * 0.05
}

export interface AlternativeEvaluation {
  alternative: DecisionAlternative
  score: number
  /** Explainable terms of the score (rationale trail). */
  terms: string[]
  /** Prerequisites not satisfiable inside the current decision context. */
  unmetPrerequisites: string[]
}

/** Evaluate every alternative deterministically; unmet prerequisites surface. */
export function evaluateAlternatives(alternatives: DecisionAlternative[], satisfiedPrerequisites: string[] = []): AlternativeEvaluation[] {
  const satisfied = new Set(satisfiedPrerequisites)
  return alternatives.map((a) => {
    const score = scoreAlternative(a)
    const terms = [
      `benefit ${a.benefit}/3`,
      `cost −${(0.5 * a.cost).toFixed(1)}`,
      `risk −${(0.6 * a.risk).toFixed(1)}`,
      `reversibility(${a.reversibility}) −${REVERSIBILITY_PENALTY[a.reversibility].toFixed(1)}`,
      `evidence basis ×${Math.min(a.evidenceBasis.length, 3)}`,
    ]
    const unmet = a.prerequisites.filter((p) => !satisfied.has(p))
    return { alternative: a, score, terms, unmetPrerequisites: unmet }
  })
}

// ---------------------------------------------------------------------------
// Authorization boundary + confidence thresholds (escalation policy).
// ---------------------------------------------------------------------------

export interface AuthorizationBoundary {
  /** Highest risk class this decision may select without human approval. */
  maxRiskClass: DecisionRiskClass
  /** Lowest reversibility this decision may accept without human approval. */
  minReversibility: Reversibility
  /** Confidence at or above which the engine may decide by itself (0–1). */
  minConfidence: number
}

export const DECISION_BOUNDARY_DEFAULTS: AuthorizationBoundary = {
  maxRiskClass: 'reversible',
  minReversibility: 'compensable',
  minConfidence: 0.6,
}

const RISK_CLASS_ORDER: Record<DecisionRiskClass, number> = {
  'read-only': 0,
  reversible: 1,
  irreversible: 2,
  'external-communication': 3,
  financial: 4,
  'sensitive-data': 5,
}

const REVERSIBILITY_ORDER: Record<Reversibility, number> = { reversible: 2, compensable: 1, irreversible: 0 }

export function withinBoundary(a: DecisionAlternative, boundary: AuthorizationBoundary): boolean {
  return (
    RISK_CLASS_ORDER[a.riskClass] <= RISK_CLASS_ORDER[boundary.maxRiskClass] &&
    REVERSIBILITY_ORDER[a.reversibility] >= REVERSIBILITY_ORDER[boundary.minReversibility]
  )
}

// ---------------------------------------------------------------------------
// Confidence — computed ONLY from the evidence classification.
// ---------------------------------------------------------------------------

export function computeConfidence(c: EvidenceClassification): number {
  let confidence = 0.4
  confidence += Math.min(c.verifiedFacts.length, 4) * 0.1
  confidence += Math.min(c.assumptions.length, 3) * 0.04
  confidence -= Math.min(c.missingInformation.length, 4) * 0.08
  if (c.uncertainties.some((u) => u.strength === 'contradicted')) confidence -= 0.2
  if (c.freshnessStatus === 'expired') confidence -= 0.1
  if (c.freshnessStatus === 'unknown') confidence -= 0.05
  return Math.min(1, Math.max(0, Math.round(confidence * 100) / 100))
}

/** Explainable confidence trail (every term printable). */
export function confidenceTrail(c: EvidenceClassification): string[] {
  const trail = [
    `base 0.4`,
    `verified facts ×${Math.min(c.verifiedFacts.length, 4)} (+${(Math.min(c.verifiedFacts.length, 4) * 0.1).toFixed(2)})`,
    `assumptions ×${Math.min(c.assumptions.length, 3)} (+${(Math.min(c.assumptions.length, 3) * 0.04).toFixed(2)})`,
    `information gaps ×${Math.min(c.missingInformation.length, 4)} (−${(Math.min(c.missingInformation.length, 4) * 0.08).toFixed(2)})`,
  ]
  if (c.uncertainties.some((u) => u.strength === 'contradicted')) trail.push('contradicted evidence present (−0.20)')
  if (c.freshnessStatus === 'expired') trail.push('evidence expired for its domain policy (−0.10)')
  if (c.freshnessStatus === 'unknown') trail.push('evidence freshness unknown (−0.05)')
  return trail
}

// ---------------------------------------------------------------------------
// The decision result — honest kinds, traceable rationale.
// ---------------------------------------------------------------------------

export type DecisionKind = 'decided' | 'insufficient-evidence' | 'escalated'

export interface DecisionRationaleStep {
  step: string
  detail: string
}

export interface DecisionOutcome {
  ok: boolean
  kind: DecisionKind
  /** Honest, customer-safe statement of what was decided and why. */
  statement: string
  selectedAlternativeId: string | null
  /** The full evaluated matrix, best-first (traceability). */
  evaluation: AlternativeEvaluation[]
  confidence: number
  /** Every confidence term, printable. */
  confidenceTrail: string[]
  rationale: DecisionRationaleStep[]
  /** Present when kind !== 'decided': what a human must provide or decide. */
  escalationReason: string | null
  /** What is genuinely missing (insufficient-evidence kind). */
  missingInformation: string[]
  contradictionNote: string | null
}

export interface DecisionInput {
  objective: string
  constraints: string[]
  desiredOutcome: string
  alternatives: DecisionAlternative[]
  evidence: ResearchEvidenceSummary | null
  /** Names of prerequisites already known satisfied (context seams). */
  satisfiedPrerequisites?: string[]
  boundary?: Partial<AuthorizationBoundary>
}

const MIN_ALTERNATIVES = 1
const MAX_ALTERNATIVES = 6
const MIN_OBJECTIVE = 12
const MAX_OBJECTIVE = 4000

/** Normalize a caller-supplied boundary; callers can only TIGHTEN defaults. */
export function normalizeBoundary(b?: Partial<AuthorizationBoundary>): AuthorizationBoundary {
  const d = DECISION_BOUNDARY_DEFAULTS
  const maxRisk = b?.maxRiskClass && RISK_CLASS_ORDER[b.maxRiskClass] <= RISK_CLASS_ORDER[d.maxRiskClass] ? b.maxRiskClass : d.maxRiskClass
  const minRev = b?.minReversibility && REVERSIBILITY_ORDER[b.minReversibility] >= REVERSIBILITY_ORDER[d.minReversibility] ? b.minReversibility : d.minReversibility
  const minConf = typeof b?.minConfidence === 'number' ? Math.min(1, Math.max(0, b.minConfidence)) : d.minConfidence
  // A tighter risk ceiling implies the reversibility floor cannot loosen.
  return { maxRiskClass: maxRisk, minReversibility: minRev, minConfidence: Math.max(minConf, 0.5) }
}

/**
 * The ONE decision surface: objective + evidence + alternatives → an honest,
 * traceable, boundary-respecting outcome. Never throws for honest reasons —
 * it returns `insufficient-evidence` or `escalated` instead of guessing.
 */
export function decide(input: DecisionInput): DecisionOutcome {
  const rationale: DecisionRationaleStep[] = []
  const objective = input.objective.trim()
  if (objective.length < MIN_OBJECTIVE) {
    return noDecision('insufficient-evidence', 'The objective is too short to decide anything meaningful about.', [], rationale, [], null, [])
  }
  if (objective.length > MAX_OBJECTIVE) {
    return noDecision('insufficient-evidence', `The objective exceeds ${MAX_OBJECTIVE} characters; split it into smaller decisions.`, [], rationale, [], null, [])
  }
  rationale.push({ step: 'objective', detail: objective.slice(0, 300) })
  if (input.desiredOutcome.trim()) rationale.push({ step: 'desired-outcome', detail: input.desiredOutcome.trim().slice(0, 200) })
  for (const c of input.constraints.slice(0, 6)) rationale.push({ step: 'constraint', detail: c.slice(0, 200) })

  const boundary = normalizeBoundary(input.boundary)
  rationale.push({
    step: 'authorization-boundary',
    detail: `risk ≤ ${boundary.maxRiskClass}, reversibility ≥ ${boundary.minReversibility}, confidence ≥ ${boundary.minConfidence}`,
  })

  // Evidence classification first — the decision never outruns its evidence.
  const classification = classifyEvidence(input.evidence)
  rationale.push({
    step: 'evidence',
    detail: `${classification.verifiedFacts.length} verified / ${classification.assumptions.length} partial / ${classification.uncertainties.length} uncertain / ${classification.missingInformation.length} gaps`,
  })
  if (classification.contradictionNote) {
    rationale.push({ step: 'contradiction-note', detail: classification.contradictionNote.slice(0, 220) })
  }

  const confidence = computeConfidence(classification)
  const trail = confidenceTrail(classification)

  const alternatives = input.alternatives.slice(0, MAX_ALTERNATIVES)
  if (alternatives.length < MIN_ALTERNATIVES) {
    return noDecision(
      'insufficient-evidence',
      'No real alternative was proposed — there is nothing to choose between.',
      evaluationOf([], input.satisfiedPrerequisites),
      rationale,
      trail,
      null,
      classification.missingInformation,
    )
  }
  rationale.push({ step: 'alternatives', detail: alternatives.map((a) => a.label).join(' | ').slice(0, 300) })

  const evaluation = evaluationOf(alternatives, input.satisfiedPrerequisites)
  rationale.push({
    step: 'comparison',
    detail: evaluation.map((e) => `${e.alternative.label}=${e.score.toFixed(2)}`).join(', '),
  })

  // Rule 1: insufficient evidence refuses to decide (no manufactured certainty).
  const criticalSupport = classification.verifiedFacts.length + classification.assumptions.length
  if (criticalSupport === 0 || classification.missingInformation.length >= 3) {
    return noDecision(
      'insufficient-evidence',
      criticalSupport === 0
        ? 'No verified or partially supported fact stands behind any alternative — deciding now would manufacture certainty the evidence does not contain.'
        : 'Too many information gaps remain for an honest choice — the missing items are named, not guessed.',
      evaluation,
      rationale,
      trail,
      null,
      classification.missingInformation,
    )
  }

  // Rule 2: only boundary-respecting, prerequisite-satisfied alternatives are
  // selectable — a decision that exceeds the authorization boundary belongs
  // to a human no matter how confident the evidence is.
  const selectable = evaluation.filter((e) => e.unmetPrerequisites.length === 0 && withinBoundary(e.alternative, boundary))
  if (selectable.length === 0) {
    const overBoundary = evaluation.filter((e) => !withinBoundary(e.alternative, boundary))
    return noDecision(
      'escalated',
      overBoundary.length > 0
        ? 'Every alternative exceeds the authorization boundary (risk class or reversibility) — this decision belongs to a human.'
        : 'Every alternative has unmet prerequisites — nothing is executable yet.',
      evaluation,
      rationale,
      trail,
      overBoundary.length > 0
        ? `All ${overBoundary.length} alternatives exceed the boundary (max risk ${boundary.maxRiskClass}, min reversibility ${boundary.minReversibility}). Grant a wider boundary explicitly to proceed.`
        : `Unmet prerequisites: ${evaluation.flatMap((e) => e.unmetPrerequisites).slice(0, 3).join('; ')}.`,
      classification.missingInformation,
    )
  }

  // Rule 3: confidence below the boundary → escalate, never fake autonomy.
  if (confidence < boundary.minConfidence) {
    return noDecision(
      'escalated',
      `Computed confidence ${confidence.toFixed(2)} is below the ${boundary.minConfidence.toFixed(2)} boundary — the decision needs a human.`,
      evaluation,
      rationale,
      trail,
      `Confidence ${confidence.toFixed(2)} < required ${boundary.minConfidence.toFixed(2)}. Verified facts: ${classification.verifiedFacts.length}; partial: ${classification.assumptions.length}; gaps: ${classification.missingInformation.length}. Provide the missing information or explicitly lower the requirement.`,
      classification.missingInformation,
    )
  }

  // Rule 4: pick the best-scoring selectable alternative; explain the win.
  const best = selectable.reduce((a, b) => (b.score > a.score ? b : a))
  const runnerUp = selectable.filter((e) => e !== best).sort((a, b) => b.score - a.score)[0]
  rationale.push({
    step: 'selection',
    detail: `"${best.alternative.label}" selected (score ${best.score.toFixed(2)}${
      runnerUp ? `, ahead of "${runnerUp.alternative.label}" at ${runnerUp.score.toFixed(2)}` : ''
    }); terms: ${best.terms.join(', ')}`,
  })
  if (classification.contradictionNote) {
    rationale.push({ step: 'stated-uncertainty', detail: classification.contradictionNote.slice(0, 220) })
  }

  return {
    ok: true,
    kind: 'decided',
    statement:
      `Selected "${best.alternative.label}" for: ${objective.slice(0, 200)}. ` +
      `Confidence ${confidence.toFixed(2)} from ${classification.verifiedFacts.length} verified and ${classification.assumptions.length} partially supported facts` +
      (classification.missingInformation.length > 0 ? `, with ${classification.missingInformation.length} stated gap(s)` : '') +
      (classification.contradictionNote ? '; source disagreement is stated, not hidden' : '') +
      '.',
    selectedAlternativeId: best.alternative.id,
    evaluation,
    confidence,
    confidenceTrail: trail,
    rationale,
    escalationReason: null,
    missingInformation: classification.missingInformation,
    contradictionNote: classification.contradictionNote,
  }
}

function evaluationOf(alternatives: DecisionAlternative[], satisfied: string[] = []): AlternativeEvaluation[] {
  const evaluation = evaluateAlternatives(alternatives, satisfied)
  return evaluation.sort((a, b) => b.score - a.score)
}

function noDecision(
  kind: DecisionKind,
  statement: string,
  evaluation: AlternativeEvaluation[],
  rationale: DecisionRationaleStep[],
  trail: string[],
  escalationReason: string | null,
  missing: string[],
): DecisionOutcome {
  rationale.push({ step: 'outcome', detail: statement.slice(0, 220) })
  return {
    ok: false,
    kind,
    statement,
    selectedAlternativeId: null,
    evaluation,
    confidence: trail.length > 0 ? computeConfidenceFromTrailContext(rationale) : 0,
    confidenceTrail: trail,
    rationale,
    escalationReason,
    missingInformation: missing,
    contradictionNote: null,
  }
}

/** Re-derive the honest confidence for a non-decided outcome from its trail. */
function computeConfidenceFromTrailContext(rationale: DecisionRationaleStep[]): number {
  const evidenceStep = rationale.find((r) => r.step === 'evidence')
  if (!evidenceStep) return 0
  const m = evidenceStep.detail.match(/(\d+) verified \/ (\d+) partial \/ (\d+) uncertain \/ (\d+) gaps/)
  if (!m) return 0
  return computeConfidence({
    verifiedFacts: new Array(Number(m[1])).fill({ text: '', strength: 'verified', basis: '', attribution: '' }) as DecisionFact[],
    assumptions: new Array(Number(m[2])).fill({ text: '', strength: 'partial', basis: '', attribution: '' }) as DecisionFact[],
    uncertainties: [],
    missingInformation: new Array(Number(m[4])).fill('gap') as string[],
    contradictionNote: null,
    freshnessStatus: 'unknown',
  })
}

/** Test/ops seam: the documented scoring weights (registration order). */
export const DECISION_SCORING_WEIGHTS = { cost: 0.5, risk: 0.6, evidenceBasisCap: 3 } as const
