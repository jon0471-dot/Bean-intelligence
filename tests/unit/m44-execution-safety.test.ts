/**
 * M44 Phases 3-6 — authorization gate, execution lifecycle, independent
 * verification, recovery & learning (pure units).
 *
 * Covers: least-privilege gate decisions, approval binding (modified/stale/
 * wrong-action rejections), delegation escalation refusal, non-owner
 * approval decisions refused, cancellation voiding, the structural
 * no-EXECUTING→SUCCEEDED rule, verdict-driven verification edges,
 * independent postcondition evaluation (including inconclusive-does-not-
 * pass), failure classification, safe-retry rules, duplicate-side-effect
 * prevention, compensation plans, recovery escalation, the safety-policy
 * self-modification guard, and knowledge-guard-shaped lessons.
 */
import { describe, test, expect } from 'bun:test'

import {
  AUTHORIZATION_GATE_ACTIONS,
  approvalDigest,
  authorizeAction,
  buildApprovalPayload,
  checkDelegation,
  validateApprovalBinding,
  validateApprovalDecision,
  type ApprovalRecordView,
} from '../../src/lib/riishe/mission/authorization'
import {
  ACTION_TERMINAL_STATES,
  ActionStateError,
  applyActionTransition,
  canTransitionAction,
  createExecutionRecord,
  isHonestSuccessPath,
  recordClaimsVerifiedSuccess,
  stateAfterVerification,
  verificationOutcomePatch,
  type ActionExecutionRecord,
} from '../../src/lib/riishe/mission/action-lifecycle'
import {
  POSTCONDITION_EVALUATOR_KINDS,
  evaluatePostcondition,
  verificationMethodFor,
  verifyPostconditions,
  type ObservationSet,
} from '../../src/lib/riishe/mission/outcome-verification'
import {
  FAILURE_CLASSES,
  assertNoPolicySelfModification,
  classifyFailure,
  compensatingActionFor,
  lessonForKnowledge,
  needsHumanEscalation,
  planRetry,
} from '../../src/lib/riishe/mission/recovery'
import { buildActionContract, buildActionPlan } from '../../src/lib/riishe/mission/action-contract'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function humanContract() {
  return buildActionContract({
    id: 'push-branch',
    actionType: 'repo-push',
    title: 'Push the reviewed branch',
    description: 'Publish the reviewed migration branch to the remote',
    params: { sha: 'abc123def456', remote: 'origin', branch: 'feat/x' },
    authScope: 'project-write',
    idempotencyKey: 'push:feat-x:v1',
    postconditions: [
      { kind: 'remote-ref-equals', params: { sha: 'abc123def456', remote: 'origin' }, description: 'the remote ref matches the pushed commit', requireIndependentMethod: true },
    ],
  })
}

function writeContract() {
  return buildActionContract({
    id: 'write-config',
    actionType: 'file-write',
    title: 'Write the deployment config',
    description: 'Persist the reviewed deployment config into the user project',
    params: { path: 'deploy/config.yaml' },
    authScope: 'project-write',
    idempotencyKey: 'write:deploy-config:v1',
    postconditions: [
      { kind: 'file-exists', params: { path: 'deploy/config.yaml' }, description: 'the config file exists', requireIndependentMethod: true },
      { kind: 'file-contains', params: { path: 'deploy/config.yaml', text: 'region: eu-central' }, description: 'the config pins the approved region', requireIndependentMethod: true },
    ],
  })
}

function grantedApproval(contract = humanContract(), digestOverride?: string): ApprovalRecordView {
  const plan = buildActionPlan('Publish the migration', [contract])
  const payload = buildApprovalPayload(plan.contracts[0], plan)
  return {
    actionDigest: digestOverride ?? approvalDigest(payload),
    actionJson: JSON.stringify(payload),
    status: 'granted',
  }
}

function approvalFor(contract = humanContract()): { plan: ReturnType<typeof buildActionPlan>; approval: ApprovalRecordView } {
  const plan = buildActionPlan('Publish the migration', [contract])
  const payload = buildApprovalPayload(plan.contracts[0], plan)
  return {
    plan,
    approval: { actionDigest: approvalDigest(payload), actionJson: JSON.stringify(payload), status: 'granted' },
  }
}

// ---------------------------------------------------------------------------
// Phase 3 — authorization
// ---------------------------------------------------------------------------

describe('m44 authorization: the gate', () => {
  test('gate vocabulary is registered', () => {
    expect([...AUTHORIZATION_GATE_ACTIONS]).toEqual(['proceed', 'awaiting-approval', 'blocked'])
  })

  test('read-only actions proceed without approval inside any identity', () => {
    const read = buildActionContract({
      id: 'read-manifest', actionType: 'file-read', title: 'Read the project manifest',
      description: 'Inspect the persisted project manifest before acting', authScope: 'project-write',
    })
    const plan = buildActionPlan('Inspect before acting', [])
    const stamped = plan.contracts.find((c) => c.id === 'read-manifest') ?? { ...read, planVersion: plan.planVersion }
    const decision = authorizeAction({
      contract: stamped, plan, identity: { identity: 'agent', scopes: [] }, grantor: null,
      approval: null, cancelRequested: false,
    })
    expect(decision.action).toBe('proceed')
  })

  test('reversible actions proceed only inside the granted scope', () => {
    const contract = writeContract()
    const plan = buildActionPlan('Persist the config', [contract])
    const stamped = plan.contracts[0]
    const ok = authorizeAction({
      contract: stamped, plan, identity: { identity: 'agent', scopes: ['project-write'] }, grantor: null,
      approval: null, cancelRequested: false,
    })
    expect(ok.action).toBe('proceed')
    expect(ok.action === 'proceed' && ok.selfAuthorized).toBe(true)
    const denied = authorizeAction({
      contract: stamped, plan, identity: { identity: 'agent', scopes: [] }, grantor: null,
      approval: null, cancelRequested: false,
    })
    expect(denied.action).toBe('blocked')
  })

  test('human-class actions wait without a valid approval and proceed with one', () => {
    const contract = humanContract()
    const { plan, approval } = approvalFor(contract)
    const stamped = plan.contracts[0]
    const waiting = authorizeAction({
      contract: stamped, plan, identity: { identity: 'agent', scopes: ['project-write'] }, grantor: null,
      approval: null, cancelRequested: false,
    })
    expect(waiting.action).toBe('awaiting-approval')
    const proceeding = authorizeAction({
      contract: stamped, plan, identity: { identity: 'agent', scopes: ['project-write'] }, grantor: null,
      approval, cancelRequested: false,
    })
    expect(proceeding.action).toBe('proceed')
  })

  test('cancellation voids every gate state', () => {
    const contract = humanContract()
    const { plan, approval } = approvalFor(contract)
    const decision = authorizeAction({
      contract: plan.contracts[0], plan, identity: { identity: 'agent', scopes: ['project-write'] }, grantor: null,
      approval, cancelRequested: true,
    })
    expect(decision.action).toBe('blocked')
    expect(decision.action === 'blocked' && decision.reason).toMatch(/Cancellation/)
  })

  test('pending-plan-digest contracts are blocked', () => {
    const contract = writeContract() // planVersion = pending-plan-digest
    const plan = buildActionPlan('Persist the config', [contract])
    const decision = authorizeAction({
      contract: { ...contract, planVersion: 'pending-plan-digest' }, plan: { ...plan, contracts: [{ ...plan.contracts[0], planVersion: 'pending-plan-digest' }] },
      identity: { identity: 'agent', scopes: ['project-write'] }, grantor: null, approval: null, cancelRequested: false,
    })
    expect(decision.action).toBe('blocked')
  })
})

describe('m44 authorization: approval binding', () => {
  test('a valid binding passes and any modification is rejected', () => {
    const contract = humanContract()
    const { plan, approval } = approvalFor(contract)
    expect(validateApprovalBinding(approval, plan.contracts[0], plan).ok).toBe(true)

    const modifiedPayload = JSON.parse(approval.actionJson)
    modifiedPayload.params.sha = 'evil000000000'
    const modified: ApprovalRecordView = {
      actionDigest: approvalDigest(modifiedPayload),
      actionJson: JSON.stringify(modifiedPayload),
      status: 'granted',
    }
    expect(validateApprovalBinding(modified, plan.contracts[0], plan)).toEqual({ ok: false, reason: 'digest-mismatch' })

    const tamperedDigest: ApprovalRecordView = { ...approval, actionDigest: '0'.repeat(64) }
    expect(validateApprovalBinding(tamperedDigest, plan.contracts[0], plan).reason).toBe('digest-mismatch')
  })

  test('a re-planned action invalidates the old approval (plan-stale)', () => {
    const contract = humanContract()
    const { plan, approval } = approvalFor(contract)
    const rePlan = buildActionPlan('Publish the migration (revised scope)', [contract])
    expect(validateApprovalBinding(approval, rePlan.contracts[0], rePlan)).toEqual({ ok: false, reason: 'plan-stale' })
  })

  test('wrong-action and non-granted approvals are rejected', () => {
    const contract = humanContract()
    const { plan, approval } = approvalFor(contract)
    expect(validateApprovalBinding(approval, { ...plan.contracts[0], id: 'other-action' }, plan).reason).toBe('wrong-action')
    expect(validateApprovalBinding({ ...approval, status: 'requested' }, plan.contracts[0], plan).reason).toBe('not-granted')
    expect(validateApprovalBinding({ ...approval, status: 'consumed' }, plan.contracts[0], plan).reason).toBe('not-granted')
    expect(validateApprovalBinding({ ...approval, actionJson: 'not-json' }, plan.contracts[0], plan).reason).toBe('invalid-payload')
  })
})

describe('m44 authorization: delegation and approver rules', () => {
  test('delegated scopes must be a subset of the grantor (no escalation)', () => {
    const ok = checkDelegation({ identity: 'sub', scopes: ['project-write'], delegatedFrom: 'owner-1' }, { identity: 'owner-1', scopes: ['project-write', 'asset-create'] })
    expect(ok.ok).toBe(true)
    const escalated = checkDelegation({ identity: 'sub', scopes: ['project-write', 'asset-create'], delegatedFrom: 'owner-1' }, { identity: 'owner-1', scopes: ['project-write'] })
    expect(escalated).toEqual({ ok: false, reason: 'scope-escalation', added: ['asset-create'] })
    const unknownGrantor = checkDelegation({ identity: 'sub', scopes: ['project-write'], delegatedFrom: 'ghost' }, { identity: 'owner-1', scopes: ['project-write'] })
    expect(unknownGrantor.ok).toBe(false)
    const selfDelegation = checkDelegation({ identity: 'x', scopes: [], delegatedFrom: 'x' }, { identity: 'x', scopes: [] })
    expect(selfDelegation).toEqual({ ok: false, reason: 'self-delegation' })
  })

  test('only owner-user decisions count; executor self-approval is refused', () => {
    expect(validateApprovalDecision({ approverKind: 'owner-user', approverId: 'user-1' }, 'agent-1').ok).toBe(true)
    expect(validateApprovalDecision({ approverKind: 'delegated-agent', approverId: 'sub' }, 'agent-1')).toEqual({ ok: false, reason: 'non-owner-decision' })
    expect(validateApprovalDecision({ approverKind: 'system', approverId: 'planner' }, 'agent-1')).toEqual({ ok: false, reason: 'non-owner-decision' })
    expect(validateApprovalDecision({ approverKind: 'owner-user', approverId: 'agent-1' }, 'agent-1')).toEqual({ ok: false, reason: 'self-approval-by-executor' })
  })

  test('grantedApproval fixture helper stays consistent', () => {
    expect(grantedApproval().status).toBe('granted')
  })
})

// ---------------------------------------------------------------------------
// Phase 4 — lifecycle
// ---------------------------------------------------------------------------

describe('m44 lifecycle: the honest state machine', () => {
  test('EXECUTING can never transition directly to SUCCEEDED', () => {
    expect(canTransitionAction('EXECUTING', 'SUCCEEDED')).toBe(false)
    expect(canTransitionAction('EXECUTING', 'VERIFYING')).toBe(true)
    expect(canTransitionAction('VERIFYING', 'SUCCEEDED')).toBe(true)
    expect(isHonestSuccessPath(['PLANNED', 'APPROVED', 'EXECUTING', 'VERIFYING', 'SUCCEEDED'])).toBe(true)
    expect(isHonestSuccessPath(['PLANNED', 'APPROVED', 'EXECUTING', 'SUCCEEDED'])).toBe(false)
  })

  test('the full happy path with approval applies cleanly', () => {
    let record: ActionExecutionRecord = createExecutionRecord(humanContract(), 'mission-runner')
    expect(record.state).toBe('AWAITING_APPROVAL')
    record = applyActionTransition(record, { state: 'APPROVED' })
    record = applyActionTransition(record, { state: 'EXECUTING', startedAt: new Date().toISOString(), attempts: 1, resultSummary: 'push accepted by remote' })
    // The tool said ok — but the record is in VERIFYING, never SUCCEEDED.
    record = applyActionTransition(record, { state: 'VERIFYING' })
    const patch = verificationOutcomePatch('confirmed', 'independent remote ref fetch comparison')
    record = applyActionTransition(record, patch)
    expect(record.state).toBe('SUCCEEDED')
    expect(record.verificationVerdict).toBe('confirmed')
    expect(recordClaimsVerifiedSuccess(record)).toBe(true)
    expect(record.completedAt).not.toBeNull()
  })

  test('a success-shaped tool response with failing postconditions ends FAILED', () => {
    let record = createExecutionRecord(humanContract(), 'mission-runner')
    record = applyActionTransition(record, { state: 'APPROVED' })
    record = applyActionTransition(record, { state: 'EXECUTING', startedAt: new Date().toISOString(), attempts: 1, resultSummary: 'push accepted by remote' })
    record = applyActionTransition(record, { state: 'VERIFYING' })
    record = applyActionTransition(record, verificationOutcomePatch('failed', 'independent remote ref fetch comparison'))
    expect(record.state).toBe('FAILED')
    expect(recordClaimsVerifiedSuccess(record)).toBe(false)
  })

  test('illegal transitions throw and terminal states are closed', () => {
    const record = createExecutionRecord(writeContract(), 'runner')
    expect(() => applyActionTransition(record, { state: 'SUCCEEDED' })).toThrow(ActionStateError)
    expect(() => applyActionTransition(record, { state: 'VERIFYING' })).toThrow(ActionStateError)
    for (const terminal of ACTION_TERMINAL_STATES) {
      expect(canTransitionAction(terminal, 'EXECUTING')).toBe(false)
    }
    expect(canTransitionAction('REJECTED', 'APPROVED')).toBe(false)
  })

  test('verification verdicts map honestly (inconclusive → RECOVERY_REQUIRED)', () => {
    expect(stateAfterVerification('confirmed')).toBe('SUCCEEDED')
    expect(stateAfterVerification('failed')).toBe('FAILED')
    expect(stateAfterVerification('inconclusive')).toBe('RECOVERY_REQUIRED')
  })
})

// ---------------------------------------------------------------------------
// Phase 5 — independent verification
// ---------------------------------------------------------------------------

describe('m44 verification: independent postcondition evaluation', () => {
  test('evaluator kinds registered', () => {
    expect(POSTCONDITION_EVALUATOR_KINDS.length).toBe(12)
  })

  test('a false tool success with a failing real state is detected', () => {
    const contract = humanContract()
    // The executor claimed success; the INDEPENDENT remote fetch disagrees.
    const obs: ObservationSet = { git: { commits: ['abc123def456'], remoteRef: '000000000000' } }
    const verdict = verifyPostconditions(contract, obs)
    expect(verdict.verdict).toBe('failed')
    expect(verdict.reasons.join(' ')).toMatch(/FAIL/)
  })

  test('confirmed postconditions with matching independent observations pass', () => {
    const contract = writeContract()
    const obs: ObservationSet = {
      fileSystem: { 'deploy/config.yaml': { exists: true, bytes: 240, text: 'region: eu-central\nreplicas: 2' } },
    }
    const verdict = verifyPostconditions(contract, obs)
    expect(verdict.verdict).toBe('confirmed')
    expect(verdict.reasons[0]).toMatch(/independently confirmed/)
  })

  test('a missing observation slice is INCONCLUSIVE — never silently true', () => {
    const contract = writeContract()
    const verdict = verifyPostconditions(contract, {})
    expect(verdict.verdict).toBe('inconclusive')
    expect(verdict.reasons.join(' ')).toMatch(/INCONCLUSIVE/)
  })

  test('duplicate-side-effect checks read the idempotency ledger', () => {
    const result = evaluatePostcondition(
      { kind: 'no-duplicate-effect', params: { key: 'push:feat-x:v1', maxRuns: '1' }, description: 'single run', requireIndependentMethod: true },
      { idempotency: { 'push:feat-x:v1': { runCount: 2 } } },
    )
    expect(result.pass).toBe(false)
    const ok = evaluatePostcondition(
      { kind: 'no-duplicate-effect', params: { key: 'push:feat-x:v1', maxRuns: '1' }, description: 'single run', requireIndependentMethod: true },
      { idempotency: { 'push:feat-x:v1': { runCount: 1 } } },
    )
    expect(ok.pass).toBe(true)
  })

  test('fallback postconditions exist for undeclared action types', () => {
    const bare = buildActionContract({
      id: 'bare-push', actionType: 'repo-push', title: 'Push the branch',
      description: 'Publish the reviewed branch', params: { sha: 'abc' }, authScope: 'project-write', idempotencyKey: 'k:bare',
    })
    const verdict = verifyPostconditions(bare, { git: { remoteRef: 'abc' } })
    expect(verdict.verdict).toBe('confirmed')
    expect(verificationMethodFor(bare)).toMatch(/remote ref fetch/)
  })

  test('research provenance verification counts DISTINCT sources', () => {
    const result = evaluatePostcondition(
      { kind: 'sources-min', params: { minSources: '3' }, description: 'three distinct sources', requireIndependentMethod: true },
      { research: { sources: [{ url: 'https://a', title: 'A' }, { url: 'https://a', title: 'A-copy' }, { url: 'https://b', title: 'B' }] } },
    )
    expect(result.pass).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Phase 6 — recovery & learning
// ---------------------------------------------------------------------------

describe('m44 recovery: classification and safe retry', () => {
  test('failure classes registered', () => {
    expect([...FAILURE_CLASSES]).toEqual(['transient', 'permanent', 'authorization', 'verification'])
  })

  test('classification routes honestly', () => {
    expect(classifyFailure({ source: 'execution', message: 'gateway timeout after 4000ms', timeout: true })).toBe('transient')
    expect(classifyFailure({ source: 'execution', message: 'upstream unavailable, try again later', statusCode: 503 })).toBe('transient')
    expect(classifyFailure({ source: 'execution', message: 'scope project-write not granted' })).toBe('authorization')
    expect(classifyFailure({ source: 'verification', message: 'postcondition failed', verdict: 'failed' })).toBe('verification')
    expect(classifyFailure({ source: 'execution', message: 'invalid config key: replicas=x' })).toBe('permanent')
    expect(classifyFailure({ source: 'execution', message: 'HTTP 403 from api', statusCode: 403 })).toBe('authorization')
  })

  test('transient failures retry within budget, with idempotency protection', () => {
    const contract = humanContract()
    const first = planRetry({ contract, failureClass: 'transient', attemptsSoFar: 0, cancelRequested: false, observedRuns: 0 })
    expect(first.retry).toBe(true)
    expect(first.attempt).toBe(1)
    const overBudget = planRetry({ contract, failureClass: 'transient', attemptsSoFar: 3, cancelRequested: false, observedRuns: 0 })
    expect(overBudget.retry).toBe(false)
    const duplicateRisk = planRetry({ contract, failureClass: 'transient', attemptsSoFar: 0, cancelRequested: false, observedRuns: 3 })
    expect(duplicateRisk.retry).toBe(false)
    expect(duplicateRisk.reason).toMatch(/duplicate the side effect/)
    const cancelled = planRetry({ contract, failureClass: 'transient', attemptsSoFar: 0, cancelRequested: true, observedRuns: 0 })
    expect(cancelled.retry).toBe(false)
  })

  test('authorization and verification failures never blind-retry', () => {
    const contract = humanContract()
    expect(planRetry({ contract, failureClass: 'authorization', attemptsSoFar: 0, cancelRequested: false, observedRuns: 0 }).retry).toBe(false)
    expect(planRetry({ contract, failureClass: 'verification', attemptsSoFar: 0, cancelRequested: false, observedRuns: 0 }).retry).toBe(false)
    expect(planRetry({ contract, failureClass: 'permanent', attemptsSoFar: 0, cancelRequested: false, observedRuns: 0 }).reason).toMatch(/not retryable/)
  })
})

describe('m44 recovery: compensation and escalation', () => {
  test('compensations match reversibility (irreversible → none/escalate)', () => {
    expect(compensatingActionFor(humanContract()).kind).toBe('none')
    const write = writeContract()
    expect(compensatingActionFor(write).kind).toBe('auto')
    expect(compensatingActionFor(write).description).toMatch(/Restore|version history/)
  })

  test('escalation fires for irreversible, uncompensable, checkpoint-invalid and authorization cases', () => {
    const contract = humanContract()
    expect(needsHumanEscalation({ failureClass: 'transient', contract, attemptsExhausted: false, checkpointInvalid: false }).escalate).toBe(true)
    const write = writeContract()
    expect(needsHumanEscalation({ failureClass: 'transient', contract: write, attemptsExhausted: false, checkpointInvalid: false }).escalate).toBe(false)
    expect(needsHumanEscalation({ failureClass: 'transient', contract: write, attemptsExhausted: true, checkpointInvalid: false }).escalate).toBe(true)
    expect(needsHumanEscalation({ failureClass: 'transient', contract: write, attemptsExhausted: false, checkpointInvalid: true }).escalate).toBe(true)
    expect(needsHumanEscalation({ failureClass: 'authorization', contract: write, attemptsExhausted: false, checkpointInvalid: false }).reason).toMatch(/human/)
  })
})

describe('m44 recovery: policy self-modification and lessons', () => {
  test('permission-granting shapes are refused inside parameters', () => {
    const evil = buildActionContract({
      id: 'sneaky-write', actionType: 'file-write', title: 'Write the settings file',
      description: 'Persist the workspace settings',
      params: { path: 'settings.json', content: 'allowMissionDelegation=true' },
      authScope: 'project-write', idempotencyKey: 'k:sneaky',
    })
    const verdict = assertNoPolicySelfModification(evil)
    expect(verdict.ok).toBe(false)
    const benign = writeContract()
    expect(assertNoPolicySelfModification(benign).ok).toBe(true)
  })

  test('unverified lessons stay unverified notes with the guard note', () => {
    const unverified = lessonForKnowledge({
      claim: 'The push lane accepts force pushes', domain: 'general', verificationConfirmed: false,
      verificationMethod: null, provenance: [{ kind: 'execution', ref: 'run-1' }], missionId: 'm1', actionId: 'push',
    })
    expect(unverified.knowledgeClass).toBe('unverified-research-note')
    expect(unverified.verificationOutcome).toBeNull()
    expect(unverified.guardNote).toMatch(/never back trusted knowledge/)

    const verified = lessonForKnowledge({
      claim: 'The migration branch pushed cleanly', domain: 'software-docs', verificationConfirmed: true,
      verificationMethod: 'independent remote ref fetch comparison', provenance: [{ kind: 'verification', ref: 'remote-ref=abc' }],
      missionId: 'm1', actionId: 'push',
    })
    expect(verified.knowledgeClass).toBe('project-specific')
    expect(verified.verificationOutcome).toBe('verified')
    expect(verified.guardNote).toBeNull()
  })
})
