/**
 * M44 Phase 1/2 — decision engine + typed action contracts (pure units).
 *
 * Covers: evidence-grounded multi-alternative decisions, honest
 * insufficient-evidence outcomes, confidence-boundary escalation,
 * authorization-boundary escalation, reversibility preference,
 * contradiction preservation, contract derivation (risk/approval cannot be
 * caller-lowered), idempotency enforcement, plan digests and deviation
 * detection, capability checks, and the M41 mission-task bridge.
 */
import { describe, test, expect } from 'bun:test'

import {
  classifyEvidence,
  decide,
  computeConfidence,
  evaluateAlternatives,
  normalizeBoundary,
  strengthForOutcome,
  type DecisionAlternative,
} from '../../src/lib/riishe/mission/decision'
import type { ResearchEvidenceSummary } from '../../src/lib/riishe/mission/evidence-summary'
import {
  ACTION_ROUTING_SEAM,
  ActionContractError,
  buildActionContract,
  buildActionPlan,
  checkCapabilities,
  contractForTaskSpec,
  planChanged,
  requirementForRisk,
} from '../../src/lib/riishe/mission/action-contract'
import { buildTaskSpec } from '../../src/lib/riishe/mission/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function evidenceSummary(overrides: Partial<ResearchEvidenceSummary> = {}): ResearchEvidenceSummary {
  return {
    claims: [
      { claim: 'Postgres 16 supports parallel bulk loads', outcome: 'verified', note: 'primary docs state it' },
      { claim: 'Copy mode preserves constraint order', outcome: 'verified', note: 'primary docs state it' },
      { claim: 'Tool X costs nothing at scale', outcome: 'partially-supported', note: 'only a vendor blog asserts it' },
    ],
    uncertainty: null,
    evidenceAttribution: [{ url: 'https://www.postgresql.org/docs/16/populate.html', title: 'Populating a Database' } as never],
    domain: 'software-docs',
    freshnessStatus: 'fresh',
    freshnessReason: 'current documentation',
    ...overrides,
  }
}

function alt(partial: Partial<DecisionAlternative> & { id: string }): DecisionAlternative {
  return {
    label: partial.id,
    description: `${partial.id} approach`,
    benefit: 2,
    cost: 1,
    risk: 1,
    reversibility: 'reversible',
    riskClass: 'reversible',
    dependencies: [],
    prerequisites: [],
    evidenceBasis: ['Postgres 16 supports parallel bulk loads'],
    ...partial,
  }
}

// ---------------------------------------------------------------------------
// Phase 1 — decision engine
// ---------------------------------------------------------------------------

describe('m44 decision: evidence-grounded choice among alternatives', () => {
  const result = decide({
    objective: 'Choose a bulk-loading approach for the analytics warehouse migration',
    constraints: ['must finish inside the maintenance window'],
    desiredOutcome: 'a verified, reversible plan',
    alternatives: [
      alt({ id: 'parallel-copy', benefit: 3, cost: 1, risk: 1, reversibility: 'reversible', riskClass: 'reversible' }),
      alt({ id: 'direct-rewrite', benefit: 3, cost: 2, risk: 2, reversibility: 'irreversible', riskClass: 'irreversible' }),
    ],
    evidence: evidenceSummary(),
  })

  test('selects the higher-scoring alternative and explains the win', () => {
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('decided')
    expect(result.selectedAlternativeId).toBe('parallel-copy')
    const selection = result.rationale.find((r) => r.step === 'selection')
    expect(selection?.detail).toContain('parallel-copy')
    // The boundary-excluded alternative still appears in the comparison trail.
    const comparison = result.rationale.find((r) => r.step === 'comparison')
    expect(comparison?.detail).toContain('direct-rewrite')
  })

  test('carries the evaluated matrix best-first with explainable terms', () => {
    expect(result.evaluation[0].alternative.id).toBe('parallel-copy')
    expect(result.evaluation[0].terms.join(' ')).toMatch(/benefit/)
    expect(result.evaluation[0].score).toBeGreaterThan(result.evaluation[1].score)
  })

  test('confidence is computed from evidence, with a printable trail', () => {
    expect(result.confidence).toBeGreaterThanOrEqual(0.6)
    expect(result.confidenceTrail.join(' ')).toContain('verified facts')
  })

  test('rationale is traceable end-to-end', () => {
    const steps = result.rationale.map((r) => r.step)
    expect(steps).toContain('objective')
    expect(steps).toContain('evidence')
    expect(steps).toContain('comparison')
    expect(steps).toContain('selection')
  })
})

describe('m44 decision: honest uncertainty outcomes', () => {
  test('no verified or partial support → insufficient-evidence, never a guess', () => {
    const result = decide({
      objective: 'Pick the vendor for the unannounced hardware refresh next year',
      constraints: [],
      desiredOutcome: '',
      alternatives: [alt({ id: 'vendor-a', evidenceBasis: [] })],
      evidence: evidenceSummary({ claims: [{ claim: 'the vendor lineup is unknown', outcome: 'insufficient-evidence', note: 'no source' }] }),
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('insufficient-evidence')
    expect(result.selectedAlternativeId).toBeNull()
    expect(result.statement).toMatch(/manufacture certainty|No verified/i)
  })

  test('low confidence escalates instead of deciding', () => {
    const result = decide({
      objective: 'Decide the launch price for the new subscription tier next quarter',
      constraints: [],
      desiredOutcome: '',
      alternatives: [alt({ id: 'price-a' })],
      evidence: evidenceSummary({
        claims: [{ claim: 'a competitor price exists but is unconfirmed', outcome: 'partially-supported', note: 'single unverified mention' }],
        freshnessStatus: 'unknown',
      }),
      boundary: { minConfidence: 0.6 },
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('escalated')
    expect(result.statement).toMatch(/below the 0.60 boundary/)
    expect(result.escalationReason).toMatch(/Confidence 0\.\d\d < required 0\.60/)
  })

  test('contradicted evidence is stated, never silently resolved', () => {
    const classification = classifyEvidence(
      evidenceSummary({
        claims: [
          { claim: 'X holds', outcome: 'contradicted', note: 'two sources disagree' },
          { claim: 'Y holds', outcome: 'verified', note: 'primary source' },
        ],
        uncertainty: 'sources disagree on X',
      }),
    )
    expect(classification.uncertainties.some((u) => u.strength === 'contradicted')).toBe(true)
    expect(classification.contradictionNote).toBe('sources disagree on X')
    const decided = decide({
      objective: 'Choose between the two claimed specifications for component X',
      constraints: [],
      desiredOutcome: '',
      alternatives: [alt({ id: 'spec-one' }), alt({ id: 'spec-two' })],
      evidence: evidenceSummary({
        claims: [
          { claim: 'spec one holds', outcome: 'contradicted', note: 'conflict' },
          { claim: 'spec two holds', outcome: 'verified', note: 'primary' },
        ],
        uncertainty: 'sources disagree between the two specifications',
      }),
    })
    if (decided.kind === 'decided') {
      expect(decided.contradictionNote).toContain('disagree')
      expect(decided.statement).toMatch(/disagreement is stated/)
    } else {
      expect(['escalated', 'insufficient-evidence']).toContain(decided.kind)
    }
  })

  test('missing information is named, never invented', () => {
    const result = decide({
      objective: 'Choose the deployment region for the new service',
      constraints: [],
      desiredOutcome: '',
      alternatives: [alt({ id: 'region-a' })],
      evidence: evidenceSummary({ claims: [{ claim: 'regional pricing unknown', outcome: 'insufficient-evidence', note: 'no data' }] }),
    })
    expect(result.ok).toBe(false)
    expect(result.missingInformation.length).toBeGreaterThan(0)
  })
})

describe('m44 decision: boundary and reversibility rules', () => {
  test('all alternatives beyond the authorization boundary → escalated', () => {
    const result = decide({
      objective: 'Publish the release announcement to the customer mailing list today',
      constraints: [],
      desiredOutcome: '',
      alternatives: [
        alt({ id: 'send-now', riskClass: 'external-communication', reversibility: 'irreversible' }),
        alt({ id: 'schedule', riskClass: 'external-communication', reversibility: 'irreversible' }),
      ],
      evidence: evidenceSummary(),
      boundary: { maxRiskClass: 'reversible' },
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('escalated')
    expect(result.escalationReason).toMatch(/exceed the boundary/)
  })

  test('boundary cannot be loosened by the caller — only tightened', () => {
    const loosened = normalizeBoundary({ maxRiskClass: 'financial', minReversibility: 'irreversible', minConfidence: 0.1 })
    expect(loosened.maxRiskClass).toBe('reversible')
    expect(loosened.minReversibility).toBe('compensable')
    expect(loosened.minConfidence).toBeGreaterThanOrEqual(0.5)
  })

  test('an irreversible alternative must be strictly better to displace a reversible one', () => {
    const evaluation = evaluateAlternatives([
      alt({ id: 'safe', benefit: 2, risk: 1, reversibility: 'reversible' }),
      alt({ id: 'risky', benefit: 2, risk: 1, reversibility: 'irreversible' }),
    ])
    expect(evaluation[0].alternative.id).toBe('safe')
  })

  test('unmet prerequisites block selection honestly', () => {
    const result = decide({
      objective: 'Migrate the analytics warehouse to the new cluster version',
      constraints: [],
      desiredOutcome: '',
      alternatives: [alt({ id: 'migrate', prerequisites: ['maintenance window granted'] })],
      evidence: evidenceSummary(),
      satisfiedPrerequisites: [],
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('escalated')
    expect(result.escalationReason).toMatch(/prerequisites/i)
  })
})

describe('m44 decision: confidence computation', () => {
  test('monotone in verified facts, penalized by gaps and contradictions', () => {
    const strong = computeConfidence(classifyEvidence(evidenceSummary()))
    const gapped = computeConfidence(classifyEvidence(evidenceSummary(), ['missing pricing', 'missing region map', 'missing quota limits']))
    const contradicted = computeConfidence(
      classifyEvidence(
        evidenceSummary({
          claims: [{ claim: 'conflicting spec', outcome: 'contradicted', note: 'dispute' }],
          uncertainty: 'dispute',
        }),
      ),
    )
    expect(strong).toBeGreaterThan(gapped)
    expect(contradicted).toBeLessThan(strong)
  })

  test('outcome mapping covers the M43 ladder honestly', () => {
    expect(strengthForOutcome('verified')).toBe('verified')
    expect(strengthForOutcome('strongly-supported')).toBe('verified')
    expect(strengthForOutcome('partially-supported')).toBe('partial')
    expect(strengthForOutcome('contradicted')).toBe('contradicted')
    expect(strengthForOutcome('outdated')).toBe('outdated')
    expect(strengthForOutcome('insufficient-evidence')).toBe('unsupported')
    expect(strengthForOutcome('unverifiable')).toBe('unsupported')
    expect(strengthForOutcome('source-unavailable')).toBe('unsupported')
    expect(requirementForRisk('read-only')).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// Phase 2 — action contracts
// ---------------------------------------------------------------------------

describe('m44 action contracts: derivation cannot be caller-lowered', () => {
  test('the fixed routing table is honest about approvals', () => {
    for (const row of ACTION_ROUTING_SEAM) {
      if (row.riskClass === 'irreversible' || row.riskClass === 'external-communication') {
        expect(row.requiresApproval).toBe('human')
      } else if (row.riskClass === 'reversible') {
        expect(row.requiresApproval).toBe('self')
      } else {
        expect(row.requiresApproval).toBe('none')
      }
    }
    expect(ACTION_ROUTING_SEAM.find((r) => r.actionType === 'repo-push')?.requiresApproval).toBe('human')
    expect(ACTION_ROUTING_SEAM.find((r) => r.actionType === 'external-communicate')?.requiresApproval).toBe('human')
    expect(ACTION_ROUTING_SEAM.find((r) => r.actionType === 'research-fetch')?.requiresApproval).toBe('none')
  })

  test('side-effectful actions require an idempotency key', () => {
    expect(() =>
      buildActionContract({
        id: 'write-file',
        actionType: 'file-write',
        title: 'Write the config file',
        description: 'Create the deployment config inside the user project',
        authScope: 'project-write',
        planVersion: 'a'.repeat(32),
      }),
    ).toThrow(ActionContractError)
    const ok = buildActionContract({
      id: 'write-file',
      actionType: 'file-write',
      title: 'Write the config file',
      description: 'Create the deployment config inside the user project',
      authScope: 'project-write',
      idempotencyKey: 'write:deploy-config:v1',
      planVersion: 'a'.repeat(32),
    })
    expect(ok.idempotencyKey).toBe('write:deploy-config:v1')
    expect(ok.requiresApproval).toBe('self')
    expect(ok.retry.retryOnlyTransient).toBe(true)
  })

  test('read-only actions approve themselves but still bound everything', () => {
    const c = buildActionContract({
      id: 'read-file',
      actionType: 'file-read',
      title: 'Read the manifest',
      description: 'Inspect the persisted project manifest before acting',
      authScope: 'project-write',
      planVersion: 'b'.repeat(32),
    })
    expect(c.riskClass).toBe('read-only')
    expect(c.requiresApproval).toBe('none')
    expect(c.timeoutMs).toBeLessThanOrEqual(20 * 60_000)
  })

  test('bounds are enforced (attempts, timeout, version format, param keys)', () => {
    expect(() =>
      buildActionContract({
        id: 'x', actionType: 'file-write' as const, title: 'T', description: 'D',
        authScope: 's', idempotencyKey: 'k', planVersion: 'zzz', retry: { maxAttempts: 9 },
      }),
    ).toThrow(ActionContractError)
    expect(() =>
      buildActionContract({
        id: 'x', actionType: 'file-write' as const, title: 'Write the thing', description: 'Do the thing safely',
        authScope: 's', idempotencyKey: 'k', planVersion: 'NOT-HEX',
      }),
    ).toThrow(ActionContractError)
    const capped = buildActionContract({
      id: 'x', actionType: 'repo-push' as const, title: 'Push the branch', description: 'Publish the reviewed branch',
      authScope: 's', idempotencyKey: 'k', planVersion: 'c'.repeat(40), retry: { maxAttempts: 99 }, timeoutMs: 999_999_999,
    })
    expect(capped.retry.maxAttempts).toBe(3)
    expect(capped.timeoutMs).toBe(20 * 60_000)
    expect(capped.requiresApproval).toBe('human')
    expect(capped.cancellation).toBe('supported')
  })
})

describe('m44 action plans: digests bind approvals to the exact plan', () => {
  const contract = (id: string) =>
    buildActionContract({
      id,
      actionType: 'file-write',
      title: `Action ${id}`,
      description: 'Deterministic write inside the user project',
      authScope: 'project-write',
      idempotencyKey: `k:${id}`,
    })

  test('plan digest is canonical and stable', () => {
    const plan = buildActionPlan('Migrate the warehouse', [contract('b-step'), contract('a-step')])
    const again = buildActionPlan('Migrate the warehouse', [contract('a-step'), contract('b-step')])
    expect(plan.digest).toBe(again.digest)
    expect(plan.contracts[0].id).toBe('a-step')
  })

  test('any modification changes the digest (stale approvals detected)', () => {
    const plan = buildActionPlan('Migrate the warehouse', [contract('step')])
    const tampered = buildActionPlan('Migrate the warehouse', [contract('step-2')])
    expect(planChanged(tampered, plan.digest)).toBe(true)
    expect(planChanged(plan, plan.digest)).toBe(false)
  })

  test('unknown dependencies are rejected', () => {
    expect(() =>
      buildActionPlan('obj', [
        buildActionContract({
          id: 'only',
          actionType: 'file-write',
          title: 'Action only',
          description: 'Deterministic write inside the user project',
          authScope: 'project-write',
          idempotencyKey: 'k:only',
          planVersion: 'f'.repeat(32),
          dependsOn: ['ghost'],
        }),
      ]),
    ).toThrow(/unknown action/)
  })
})

describe('m44 capabilities and the M41 bridge', () => {
  const write = buildActionContract({
    id: 'write',
    actionType: 'file-write',
    title: 'Write the report file',
    description: 'Persist the verified report into the user project',
    authScope: 'project-write',
    idempotencyKey: 'k:write',
    planVersion: 'd'.repeat(32),
  })

  test('read-only identity passes without scopes; writes need their scope', () => {
    expect(checkCapabilities(write, { identity: 'agent-1', scopes: [] }).ok).toBe(false)
    expect(checkCapabilities(write, { identity: 'agent-1', scopes: ['project-write'] }).ok).toBe(true)
    const read = buildActionContract({
      id: 'read', actionType: 'file-read', title: 'Read the project files', description: 'Inspect the persisted files',
      authScope: 'project-write', planVersion: 'e'.repeat(32),
    })
    expect(checkCapabilities(read, { identity: 'agent-1', scopes: [] }).ok).toBe(true)
  })

  test('contractForTaskSpec wraps a mission task with derived postconditions', () => {
    const spec = buildTaskSpec({
      id: 'research',
      kind: 'research',
      title: 'Gather cited evidence',
      objective: 'Research the topic with live retrieval and collect real attributable sources for the migration plan.',
      expectedOutput: 'A research pack of at least three real sources.',
      verification: { minSources: 3 },
    })
    const plan = buildActionPlan('Research and report', [])
    const contract = contractForTaskSpec(spec, plan.planVersion)
    expect(contract.actionType).toBe('research-fetch')
    expect(contract.requiresApproval).toBe('none')
    expect(contract.postconditions[0].kind).toBe('sources-min')
    expect(contract.postconditions[0].requireIndependentMethod).toBe(true)
    expect(contract.idempotencyKey).toContain('mission:')
  })

  test('delegated identities are recorded for the Phase-3 escalation check', () => {
    const identity = { identity: 'sub-agent', scopes: ['project-write'], delegatedFrom: 'user-42' }
    expect(checkCapabilities(write, identity).ok).toBe(true)
    expect(identity.delegatedFrom).toBe('user-42')
  })
})
