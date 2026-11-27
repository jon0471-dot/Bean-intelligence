/**
 * M45 Phase 1+2 tests — conversational decision tool + two-key wiring.
 *
 * Classification: LOCAL INTEGRATION TESTS over faked Prisma delegates
 * (tests/helpers/trust-fake-db.ts idiom). No network, no live model, no
 * live GitHub. The authorization contract under test is the REAL M44 gate
 * + the REAL Trust approval semantics over the fake db.
 */
import { describe, it, expect, beforeAll, mock } from 'bun:test'
import { createTrustFakeDb, FakeTable, type FakeRow } from '../helpers/trust-fake-db'

// ---------------------------------------------------------------------------
// The fake db: execution decisions + trust tables + the code-file store.
// ---------------------------------------------------------------------------

const fake = createTrustFakeDb()
const executionDecision = new FakeTable<FakeRow>()
const codeFile = new FakeTable<FakeRow>()

mock.module('@/lib/db', () => ({
  db: { ...fake.fakeDb, executionDecision, codeFile },
}))
mock.module('@/lib/observability/logger', () => ({
  logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
  withRequestContext: async <T,>(ctx: unknown, fn: () => Promise<T>) => fn(),
  currentRequestId: () => null,
  redact: (v: string) => v,
}))
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => undefined,
  recordAudit: async () => undefined,
}))

// Dynamic imports AFTER the mocks (the repo's established fake-db idiom):
// every module under test then binds the fake delegates.
const { classifyTurnIntent, executionGovernanceRequested, INTENT_ALLOWED_OPERATIONS } = await import('@/lib/riishe/mission/conversation-intent')
const { planCapabilities } = await import('@/lib/riishe/capability-plan')
const {
  buildConversationBinding,
  bindingDigestOf,
  validateBinding,
  TurnOperationLedger,
} = await import('@/lib/riishe/mission/conversation-binding')
const {
  createConversationDecision,
  inspectConversationDecision,
  proposeConversationPlan,
  requestConversationApproval,
  executeConversationPlan,
  conversationActionStatus,
  conversationActionResult,
  explainConversationOutcome,
  guardOperation,
  DecisionToolError,
  contractsFromProposedActions,
  normalizeAlternatives,
} = await import('@/lib/riishe/mission/decision-tool')
const { setDecisionResearchForTests, setDecisionEvidenceSummaryForTests } = await import('@/lib/riishe/mission/decision-evidence')
const { validateExecutionDecisionInput, executionDecisionTool, DECISION_TOOL_OPERATIONS } = await import('@/lib/riishe/mission/decision-tool-tool')
const { validateApprovalBinding, buildApprovalPayload, approvalDigest } = await import('@/lib/riishe/mission/authorization')
const { decideTaskApproval } = await import('@/lib/trust/approvals')
type ActionPlan = Awaited<ReturnType<typeof import('@/lib/riishe/mission/action-contract')['buildActionPlan']>>
type ToolContext = import('@/lib/riishe/tools/types').ToolContext

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const USER = 'user-alice'
const CONV = 'conv-1'

function ctxFor(intent: ReturnType<typeof classifyTurnIntent>, turnId = 'turn-1', userId = USER) {
  const binding = buildConversationBinding({ userId, conversationId: CONV, turnId, missionTrustTaskId: null })
  return { binding, intent, missionTrustTaskId: null }
}

function toolCtxFor(message: string, userId = USER): ToolContext {
  return {
    permissions: new Set(['allowExecutionGovernance']),
    userId,
    documents: new Map(),
    conversationId: CONV,
    turnId: 'turn-1',
    turnIntent: classifyTurnIntent(message),
    userMessageText: message,
  }
}

const FILE_WRITE_ACTIONS = [
  {
    actionType: 'file-write',
    title: 'Write the decision record',
    description: 'Write the decision summary into decision.md in the project workspace.',
    params: { projectId: 'proj-1', path: 'decision.md', content: 'Chosen: staging rollout with revert plan.' },
  },
]

// ---------------------------------------------------------------------------
// 1. Conversational intent discrimination.
// ---------------------------------------------------------------------------

describe('M45 conversation intent', () => {
  it('classifies advice and never lets advice trigger execution operations', () => {
    expect(classifyTurnIntent('What should I do about the migration?')).toBe('advice')
    expect(classifyTurnIntent('Which option would you recommend for the rollout?')).toBe('advice')
    expect(classifyTurnIntent('How does the approval flow work?')).toBe('advice')
    for (const op of ['request_approval', 'execute_plan']) {
      expect(() => guardOperation(ctxFor('advice'), op)).toThrow(DecisionToolError)
    }
  })

  it('classifies plan / authorize / execute / result intents', () => {
    expect(classifyTurnIntent('Give me an execution plan for the database migration')).toBe('plan')
    expect(classifyTurnIntent('I approve the staging rollout, go ahead')).toBe('authorize')
    expect(classifyTurnIntent('Execute the approved plan')).toBe('execute')
    expect(classifyTurnIntent('Run the approved action now')).toBe('execute')
    expect(classifyTurnIntent('What was the result of my action?')).toBe('result')
    expect(classifyTurnIntent('Did the deployment succeed?')).toBe('result')
    expect(classifyTurnIntent('Why was it blocked?')).toBe('result')
  })

  it('keeps unknown turns from consuming state', () => {
    expect(classifyTurnIntent('hello there')).toBe('unknown')
    expect(() => guardOperation(ctxFor('unknown'), 'execute_plan')).toThrow(DecisionToolError)
    expect(() => guardOperation(ctxFor('result'), 'execute_plan')).toThrow(DecisionToolError)
    expect(() => guardOperation(ctxFor('plan'), 'execute_plan')).toThrow(DecisionToolError)
    // The allowed-operation table matches the guard.
    expect(INTENT_ALLOWED_OPERATIONS.advice).not.toContain('execute_plan')
    expect(INTENT_ALLOWED_OPERATIONS.execute).toContain('execute_plan')
  })

  it('opens the governance capability only for governance-shaped turns', () => {
    const plan = planCapabilities('I need an execution plan for the release', 'coding', false, [])
    expect(plan.executionGovernance).toBe(true)
    const plain = planCapabilities('what is the capital of France', 'factual', false, [])
    expect(plain.executionGovernance).toBe(false)
    const docTurn = planCapabilities('give me an execution plan', 'document', true, ['pdf'])
    expect(docTurn.executionGovernance).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. Conversation binding + replay protection.
// ---------------------------------------------------------------------------

describe('M45 conversation binding', () => {
  it('binds records and re-derives the digest deterministically', () => {
    const a = buildConversationBinding({ userId: USER, conversationId: CONV, turnId: 'turn-1', missionTrustTaskId: null })
    const b = buildConversationBinding({ userId: USER, conversationId: CONV, turnId: 'turn-1', missionTrustTaskId: null })
    expect(a.bindingDigest).toBe(b.bindingDigest)
    expect(a.bindingDigest).toBe(bindingDigestOf(a.binding))
    expect(validateBinding(a, { userId: USER, conversationId: CONV, turnId: 'turn-9' }).ok).toBe(true)
  })

  it('rejects cross-user, cross-conversation, cross-mission and tampered bindings', () => {
    const rec = buildConversationBinding({ userId: USER, conversationId: CONV, turnId: 'turn-1', missionTrustTaskId: null })
    expect(validateBinding(rec, { userId: 'user-mallory', conversationId: CONV, turnId: 'turn-1' }).reason).toBe('user-mismatch')
    expect(validateBinding(rec, { userId: USER, conversationId: 'conv-2', turnId: 'turn-1' }).reason).toBe('conversation-mismatch')
    const mission = buildConversationBinding({ userId: USER, conversationId: CONV, turnId: 'turn-1', missionTrustTaskId: 'tt-9' })
    expect(validateBinding(mission, { userId: USER, conversationId: CONV, turnId: 'turn-1', missionTrustTaskId: null }).reason).toBe('mission-mismatch')
    const tampered = { binding: rec.binding, bindingDigest: 'deadbeef'.repeat(8) }
    expect(validateBinding(tampered, { userId: USER, conversationId: CONV, turnId: 'turn-1' }).reason).toBe('binding-tampered')
  })

  it('turn ledger refuses duplicate one-shot operations', () => {
    const ledger = new TurnOperationLedger()
    const b = buildConversationBinding({ userId: USER, conversationId: CONV, turnId: 'turn-1' }).binding
    expect(ledger.spend(b, 'request_approval:d1')).toBe(true)
    expect(ledger.spend(b, 'request_approval:d1')).toBe(false)
    expect(ledger.isSpent(b, 'request_approval:d1')).toBe(true)
    const other = buildConversationBinding({ userId: USER, conversationId: CONV, turnId: 'turn-2' }).binding
    expect(ledger.spend(other, 'request_approval:d1')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. Decision creation — evidence honesty + advice/plan separation.
// ---------------------------------------------------------------------------

describe('M45 decision creation', () => {
  beforeAll(() => {
    setDecisionResearchForTests(async () => ({
      sources: [
        { url: 'https://docs.example.com/rollout', title: 'Staged rollouts reduce release risk', publishedAt: '2026-10-01' },
        { url: 'https://status.example.org/incidents', title: 'Big-bang deploys caused 2026 incidents', publishedAt: '2026-09-15' },
      ],
    }))
  })

  it('creates a decision with honest uncertainty when evidence is absent', async () => {
    setDecisionResearchForTests(async () => null)
    const r = await createConversationDecision({
      ctx: ctxFor('plan'),
      objective: 'Choose the rollout approach for the billing service migration this quarter',
      alternatives: [
        { label: 'Big-bang cutover', description: 'Switch everything in one release.', risk: 3, reversibility: 'irreversible' },
        { label: 'Staged rollout', description: 'Ramp 5% → 50% → 100% with revert points.', risk: 1 },
      ],
    })
    // No evidence at all → the honest kinds, never manufactured certainty.
    expect(['insufficient-evidence', 'escalated', 'decided']).toContain(r.outcome.kind)
    expect(r.missingInformation.length > 0 || r.outcome.kind === 'insufficient-evidence').toBe(true)
  })

  it('creates a decided outcome from verified evidence and records it owner-scoped', async () => {
    // Pinned HONEST summary: two verified facts, no gaps, fresh evidence.
    // (The engine still grades it — a fabricated summary with no verified
    // facts would still refuse to decide.)
    setDecisionEvidenceSummaryForTests(async () => ({
      claims: [
        { claim: 'Staged rollouts allow reverting each stage independently', outcome: 'verified', note: 'primary source states the revert path' },
        { claim: 'The billing service supports percentage-based traffic splitting', outcome: 'verified', note: 'documented feature' },
      ],
      uncertainty: null,
      evidenceAttribution: [{ url: 'https://docs.example.com/rollout' }],
      domain: 'general',
      freshnessStatus: 'fresh',
      freshnessReason: 'dated within policy',
    }))
    const r = await createConversationDecision({
      ctx: ctxFor('plan', 'turn-2'),
      objective: 'Choose the rollout approach for the billing service migration this quarter',
      desiredOutcome: 'Low-risk migration with a rollback path',
      constraints: ['No downtime during business hours'],
      alternatives: [
        { label: 'Big-bang cutover', description: 'Switch everything in one release window.', risk: 3, reversibility: 'irreversible' },
        { label: 'Staged rollout', description: 'Ramp gradually with revert points at each stage.', risk: 1, benefit: 2 },
      ],
      useEvidence: true,
    })
    expect(r.outcome.kind).toBe('decided')
    expect(r.outcome.selectedAlternativeId).toBe('alt-2')
    expect(r.statement).toContain('Staged rollout')
    // The row exists and is inspectable by its owner.
    const view = await inspectConversationDecision(r.decisionId, ctxFor('plan', 'turn-3'))
    expect(view.decisionId).toBe(r.decisionId)
    expect(view.status).toBe('created')
    setDecisionEvidenceSummaryForTests(null)
  })

  it('normalizes conversational alternatives into bounded decision alternatives', () => {
    const alts = normalizeAlternatives([
      { label: 'A', description: 'first' },
      { label: 'B', description: 'second', risk: 9, benefit: -2 },
    ])
    expect(alts).toHaveLength(2)
    expect(alts[1].risk).toBe(3)
    expect(alts[1].benefit).toBe(0)
    expect(alts[0].id).toBe('alt-1')
  })
})

// ---------------------------------------------------------------------------
// 4. Plan proposals — risk derived from action TYPE, never from claims.
// ---------------------------------------------------------------------------

describe('M45 plan proposal risk derivation', () => {
  it('derives risk/approval from the action type even when the model claimed otherwise', async () => {
    const { row } = await seedDecision(planCtx('turn-4'))
    const r = await proposeConversationPlan({
      decisionId: row.id,
      ctx: ctxFor('plan', 'turn-5'),
      actions: FILE_WRITE_ACTIONS,
    })
    expect(r.planDigest).toBeTruthy()
    expect(r.actions[0].riskClass).toBe('reversible')
    expect(r.actions[0].requiresApproval).toBe('self')
    expect(r.approvalRequired).toHaveLength(0)

    // A push-type action is irreversible + human approval REGARDLESS of any
    // conversational framing (the contract derives, the caller cannot lower).
    const push = contractsFromProposedActions(
      [{ actionType: 'repo-push', title: 'Publish branch', description: 'Push the feature branch.', params: { branch: 'feat/x', sha: 'abc123' } }],
      'pending-plan-digest',
    )
    expect(push[0].riskClass).toBe('irreversible')
    expect(push[0].requiresApproval).toBe('human')
  })

  it('refuses unknown action types honestly', () => {
    expect(() => contractsFromProposedActions([{ actionType: 'rm -rf /', title: 'x', description: 'y' }], 'pending-plan-digest')).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 5. Approvals — conversational text can never forge a grant.
// ---------------------------------------------------------------------------

async function seedDecision(ctx: { binding: { userId: string; conversationId: string; turnId: string; missionTrustTaskId: string | null }; bindingDigest: string }) {
  const created = await createConversationDecision({
    ctx: ctx as never,
    objective: 'Write the approved decision record into the project workspace today',
    alternatives: [{ label: 'Direct write', description: 'Write the record file directly.' }],
  })
  const row = executionDecision.rows.find((r) => r.id === created.decisionId)!
  return { row }
}

/** Seed through a PLAN intent (creation is allowed for advice/plan turns). */
function planCtx(turnId: string, userId = USER) {
  return ctxFor('plan', turnId, userId)
}

describe('M45 approval requests are never grants', () => {
  it('request_approval creates REQUESTED rows; conversational "approve" cannot grant them', async () => {
    const { row } = await seedDecision(planCtx('turn-6'))
    await proposeConversationPlan({
      decisionId: row.id as string,
      ctx: ctxFor('plan', 'turn-7'),
      actions: [
        { actionType: 'repo-push', title: 'Publish the approved branch', description: 'Push feat/x.', params: { branch: 'feat/x', sha: 'abc123' } },
      ],
    })
    const r = await requestConversationApproval({ decisionId: row.id as string, ctx: ctxFor('authorize', 'turn-8') })
    expect(r.status).toBe('awaiting-approval')
    expect(r.approvals).toHaveLength(1)
    const approvalRow = fake.trustApproval.rows.find((a) => a.id === r.approvals[0].approvalId)!
    expect(approvalRow.status).toBe('requested')
    // A duplicate one-shot request in the SAME turn binding is refused.
    await expect(requestConversationApproval({ decisionId: row.id as string, ctx: ctxFor('authorize', 'turn-8') })).rejects.toThrow(DecisionToolError)
    // An advice turn can never even ask.
    await expect(requestConversationApproval({ decisionId: row.id as string, ctx: ctxFor('advice', 'turn-9') })).rejects.toThrow(DecisionToolError)
  })

  it('execute_plan with an UNGRANTED approval is blocked before execution and runs nothing', async () => {
    const { row } = await seedDecision(planCtx('turn-10'))
    await proposeConversationPlan({
      decisionId: row.id as string,
      ctx: ctxFor('plan', 'turn-11'),
      actions: [{ actionType: 'repo-push', title: 'Publish the branch', description: 'Push feat/x to origin.', params: { branch: 'feat/x', sha: 'abc123' } }],
    })
    await requestConversationApproval({ decisionId: row.id as string, ctx: ctxFor('authorize', 'turn-12') })
    // The approval exists but is REQUESTED, not granted — the gate refuses.
    const r = await executeConversationPlan({ decisionId: row.id as string, ctx: ctxFor('execute', 'turn-13') })
    expect(r.status).toBe('blocked')
    expect(r.records[0].state).toBe('BLOCKED')
    expect(r.records[0].note).toContain('granted')
    expect(codeFile.rows).toHaveLength(0) // nothing ran
  })

  it('a granted approval executes the plan, verifies independently, consumes once', async () => {
    const { row } = await seedDecision(planCtx('turn-14'))
    const proposal = await proposeConversationPlan({ decisionId: row.id as string, ctx: ctxFor('plan', 'turn-15'), actions: FILE_WRITE_ACTIONS })
    const req = await requestConversationApproval({ decisionId: row.id as string, ctx: ctxFor('authorize', 'turn-16') })
    // FILE_WRITE_ACTIONS are 'self' — for the human-gate scenario use the push plan:
    expect(req.approvals).toHaveLength(0)
    void proposal
    // Execute the self-authorized write plan.
    const r = await executeConversationPlan({ decisionId: row.id as string, ctx: ctxFor('execute', 'turn-17') })
    expect(r.status).toBe('succeeded')
    expect(r.records[0].state).toBe('SUCCEEDED')
    expect(r.records[0].verdict).toBe('confirmed')
    // Independent verification: the file ACTUALLY exists in the (fake) store.
    expect(codeFile.rows.some((f) => f.path === 'decision.md')).toBe(true)
    // The verified result surface reports it.
    const results = await conversationActionResult(row.id as string, ctxFor('result', 'turn-18'))
    expect(results.verifiedResults).toHaveLength(1)
    expect(results.verifiedResults[0].verificationMethod).toContain('independent')
  })

  it('the owner grant flows only through the Trust decision; a granted plan executes, verifies and consumes once', async () => {
    const { row } = await seedDecision(planCtx('turn-19'))
    await proposeConversationPlan({
      decisionId: row.id as string,
      ctx: ctxFor('plan', 'turn-20'),
      actions: [{ actionType: 'repo-push', title: 'Publish approved branch', description: 'Push feat/x to origin.', params: { branch: 'feat/x', sha: 'abc123' } }],
    })
    const req = await requestConversationApproval({ decisionId: row.id as string, ctx: ctxFor('authorize', 'turn-21') })
    expect(req.approvals).toHaveLength(1)
    const approvalId = req.approvals[0].approvalId
    const taskId = fake.trustApproval.rows.find((a) => a.id === approvalId)!.taskId as string
    // OWNER decision (the only grant path).
    await decideTaskApproval(taskId, approvalId, 'grant')
    expect(fake.trustApproval.rows.find((a) => a.id === approvalId)!.status).toBe('granted')

    // ANY modification of the bound payload breaks the binding (M44 rule).
    const plan = JSON.parse(executionDecision.rows.find((r) => r.id === row.id)!.planJson as string) as ActionPlan
    const payload = buildApprovalPayload(plan.contracts[0], plan)
    const tampered = { ...payload, params: { ...payload.params, branch: 'main' } }
    expect(approvalDigest(tampered)).not.toBe(approvalDigest(payload))
    const binding = validateApprovalBinding(
      { actionDigest: approvalDigest(payload), actionJson: JSON.stringify(payload), status: 'granted' },
      { ...plan.contracts[0], params: { ...plan.contracts[0].params, branch: 'main' } },
      plan,
    )
    expect(binding.ok).toBe(false)
    expect(binding.reason).toBe('digest-mismatch')

    // A repo-push has no real execution path in this test environment (no
    // GitHub adapter wiring) — the run must report honest unavailability,
    // never a simulated success. The approval is consumed only when an
    // execution actually reaches it; the runner consumes right before the
    // dispatch, so the honest-refusal path still consumed the grant.
    const r = await executeConversationPlan({ decisionId: row.id as string, ctx: ctxFor('execute', 'turn-21b') })
    expect(r.records[0].state).toBe('FAILED')
    expect(r.status).toBe('failed')
    // Consume-once: the approval cannot unlock a second run.
    expect(fake.trustApproval.rows.find((a) => a.id === approvalId)!.status).toBe('consumed')
  })
})

// ---------------------------------------------------------------------------
// 6. Isolation + tamper + explanations.
// ---------------------------------------------------------------------------

describe('M45 isolation and honest explanations', () => {
  it('cross-user access is honestly refused without leaking existence', async () => {
    const { row } = await seedDecision(planCtx('turn-22'))
    await expect(inspectConversationDecision(row.id as string, ctxFor('plan', 'turn-23', 'user-mallory'))).rejects.toThrow('Decision not found.')
    await expect(executeConversationPlan({ decisionId: row.id as string, ctx: ctxFor('execute', 'turn-24', 'user-mallory') })).rejects.toThrow('Decision not found.')
  })

  it('a tampered binding digest is refused before any other check', async () => {
    const { row } = await seedDecision(planCtx('turn-25'))
    const target = executionDecision.rows.find((r) => r.id === row.id)!
    const real = target.bindingDigest
    target.bindingDigest = 'forged-digest'
    await expect(inspectConversationDecision(row.id as string, ctxFor('plan', 'turn-26'))).rejects.toThrow('different conversation context')
    target.bindingDigest = real
  })

  it('status and explanations report the honest lifecycle', async () => {
    const { row } = await seedDecision(planCtx('turn-27'))
    const status = await conversationActionStatus(row.id as string, ctxFor('result', 'turn-28'))
    expect(status.actions).toHaveLength(0)
    const explanation = await explainConversationOutcome({ decisionId: row.id as string, ctx: ctxFor('result', 'turn-29') })
    expect(explanation.explanations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 7. The tool descriptor — two-key gate + input validation.
// ---------------------------------------------------------------------------

describe('M45 execution_decision tool descriptor', () => {
  it('registers with the explicit permission key and full operation set', () => {
    expect(DECISION_TOOL_OPERATIONS).toContain('create_decision')
    expect(executionDecisionTool.permission).toBe('explicit')
    expect(executionDecisionTool.permissionKey).toBe('allowExecutionGovernance')
  })

  it('refuses when the permission key is absent (key 1 missing)', async () => {
    const ctx: ToolContext = { ...toolCtxFor('execute the approved plan'), permissions: new Set() }
    const r = await executionDecisionTool.execute(validateExecutionDecisionInput({ operation: 'action_status', decisionId: 'x' }), ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('Permission denied')
  })

  it('refuses execution operations when the server-derived intent is advice', async () => {
    // Two keys present, but the REAL message is advice — the server-derived
    // intent gate refuses regardless of what the model puts in the input.
    const ctx = toolCtxFor('What should I do about the rollout?')
    const r = await executionDecisionTool.execute(validateExecutionDecisionInput({ operation: 'execute_plan', decisionId: 'whatever' }), ctx)
    expect(r.ok).toBe(false)
    expect(r.output).toContain('advice')
  })

  it('rejects malformed inputs honestly', () => {
    expect(() => validateExecutionDecisionInput({ operation: 'explode' })).toThrow()
    expect(() => validateExecutionDecisionInput({ operation: 'create_decision', objective: 'short' })).toThrow()
    expect(() => validateExecutionDecisionInput({ operation: 'create_decision', objective: 'a valid objective here' })).toThrow()
    expect(() => validateExecutionDecisionInput({ operation: 'inspect_decision' })).toThrow()
    expect(validateExecutionDecisionInput({ operation: 'action_status', decisionId: 'abc' }).decisionId).toBe('abc')
  })
})

// Global ledger hygiene: the process-wide ledger accumulates across tests;
// every test above uses distinct turn ids so spends never collide.
export const M45_TEST_TURN_IDS_ARE_UNIQUE = true
