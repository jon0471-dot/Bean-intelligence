/**
 * BEAN Intelligence — M45 Phase 1: the per-turn conversational decision tool
 * (SERVER ONLY).
 *
 * Connects the M44 decision engine + verified-action runner to RIISHE's
 * actual conversation flow. One tool surface with explicit operations:
 *
 *   create_decision     — evidence-grounded decision from the user's objective
 *   inspect_decision    — owner-scoped retrieval of a stored decision
 *   propose_plan        — structured execution proposal (typed, digest-bound)
 *   request_approval    — approval REQUEST bound to the exact plan digest
 *   execute_plan        — runs ONLY an already-approved, unmodified plan
 *   action_status       — lifecycle status of the bound actions
 *   action_result       — independently verified results (or their absence)
 *   explain_outcome     — why an action was blocked/rejected/failed/completed
 *
 * Conversational safety rules enforced HERE (structurally, not by prompting):
 *   1. Intent gating: every state-consuming operation checks the SERVER-DERIVED
 *      turn intent (conversation-intent.ts — classified from the real user
 *      message, never from model-supplied fields). An advice turn cannot
 *      request approval or execution even if the model tries.
 *   2. A natural-language approval is never a grant: request_approval only
 *      CREATES a requested (ungranted) approval row bound to the exact
 *      ApprovalPayload digest. The grant flows exclusively through the
 *      existing owner-only Trust approval decision route, and consumption
 *      stays server-side consume-once (M44).
 *   3. Execution binds to the conversation: plan creation and execution must
 *      share user + conversation (+ mission when bound); the binding digest
 *      is re-derived and checked on every operation (conversation-binding.ts).
 *   4. No new orchestration framework: decisions ride the M44 engine, plans
 *      ride the M44 contract/plan builders, execution rides the M44 runner,
 *      approvals ride the Trust Engine, audit rides the Trust ledger.
 *
 * Risk honesty: alternatives may carry model-proposed risk labels for
 * REASONING, but the PLAN layer re-derives every contract's real risk class
 * from its ACTION TYPE (buildActionContract — never caller-lowered), so a
 * mislabeled alternative can never smuggle an unsafe action past the gate.
 */

import { db } from '@/lib/db'
import { addTrustEvidence, createTrustTask, type TrustTask } from '@/lib/trust/tasks'
import { requestTaskApproval } from '@/lib/trust/approvals'
import { logger } from '@/lib/observability/logger'
import { decide, type DecisionAlternative, type DecisionOutcome } from './decision'
import { buildResearchEvidenceSummary, type SummarySource } from './evidence-summary'
import { buildActionContract, buildActionPlan, type ActionPlan, type ExecutorIdentity } from './action-contract'
import type { ActionExecutionRecord } from './action-lifecycle'
import { runActionPlan, type ActionFileStore } from './action-runner'
import { runSpecialistResearchForDecision, evidenceSummaryForDecision } from './decision-evidence'
import {
  buildConversationBinding,
  validateBinding,
  globalTurnLedger,
  type BindingCheckContext,
  type BoundRecord,
} from './conversation-binding'
import { INTENT_ALLOWED_OPERATIONS, type TurnIntent } from './conversation-intent'

// ---------------------------------------------------------------------------
// Bounds — every conversational artifact is bounded before it is stored.
// ---------------------------------------------------------------------------

export const DECISION_TOOL_LIMITS = {
  objectiveChars: 4000,
  constraintChars: 200,
  maxConstraints: 6,
  maxAlternatives: 6,
  decisionJsonChars: 24000,
  planJsonChars: 24000,
  recordsJsonChars: 24000,
  maxActionsPerPlan: 6,
  researchMaxSources: 6,
} as const

export type DecisionRowStatus =
  | 'created'
  | 'planned'
  | 'awaiting-approval'
  | 'executing'
  | 'succeeded'
  | 'partially-succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'recovery-required'

/** The ExecutionDecision row shape this module owns (Prisma model). */
export interface ExecutionDecisionRow {
  id: string
  userId: string
  conversationId: string
  turnId: string
  objective: string
  status: string
  decisionKind: string
  decisionJson: string
  planDigest: string | null
  planJson: string | null
  recordsJson: string | null
  trustTaskId: string | null
  bindingDigest: string
  createdAt: Date
  updatedAt: Date
}

/** Minimal db surface the tool uses (the real Prisma delegate or a fake). */
export interface DecisionDb {
  executionDecision: {
    create(args: { data: Record<string, unknown> }): Promise<ExecutionDecisionRow>
    findFirst(args: { where: Record<string, unknown> }): Promise<ExecutionDecisionRow | null>
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ExecutionDecisionRow>
  }
  trustTask?: unknown
}

const realDb = db as unknown as DecisionDb

// ---------------------------------------------------------------------------
// Alternatives from conversation — bounded, decision-engine shaped.
// ---------------------------------------------------------------------------

export interface ConversationAlternative {
  label: string
  description: string
  benefit?: number
  cost?: number
  risk?: number
  reversibility?: 'reversible' | 'compensable' | 'irreversible'
}

const clamp03 = (v: number | undefined, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(3, Math.max(0, Math.round(v))) : fallback

/** Normalize conversational alternatives into M44 decision alternatives. */
export function normalizeAlternatives(list: ConversationAlternative[]): DecisionAlternative[] {
  return list.slice(0, DECISION_TOOL_LIMITS.maxAlternatives).map((a, i) => {
    const label = String(a.label ?? '').trim().slice(0, 80) || `alternative-${i + 1}`
    const description = String(a.description ?? '').trim().slice(0, 600)
    return {
      id: `alt-${i + 1}`,
      label,
      description: description || label,
      benefit: clamp03(a.benefit, 1),
      cost: clamp03(a.cost, 1),
      risk: clamp03(a.risk, 1),
      reversibility: a.reversibility ?? 'reversible',
      riskClass: a.reversibility === 'irreversible' ? ('irreversible' as const) : ('reversible' as const),
      dependencies: [],
      prerequisites: [],
      evidenceBasis: [],
    }
  })
}

// ---------------------------------------------------------------------------
// Typed plan actions from conversation — the model composes, M44 derives.
// ---------------------------------------------------------------------------

export interface ProposedPlanAction {
  actionType: string
  title: string
  description: string
  params?: Record<string, string>
  dependsOn?: string[]
}

const PLAN_ACTION_TYPE_RE = /^[a-z][a-z-]{2,40}$/

/**
 * Convert model-proposed actions into typed M44 contracts. Every risk class
 * and approval requirement is DERIVED from the action type here — the caller
 * cannot widen risk or lower the approval requirement. Unknown action types
 * are refused (an honest error, not a guessed contract).
 */
export function contractsFromProposedActions(
  actions: ProposedPlanAction[],
  planVersion: string,
): ReturnType<typeof buildActionPlan>['contracts'] {
  const contracts = actions.slice(0, DECISION_TOOL_LIMITS.maxActionsPerPlan).map((a, i) => {
    const actionType = String(a.actionType ?? '').trim()
    if (!PLAN_ACTION_TYPE_RE.test(actionType)) {
      throw new DecisionToolError(`Plan action ${i + 1} has an invalid actionType.`)
    }
    const id = `step-${i + 1}`
    return buildActionContract({
      id,
      actionType: actionType as never,
      title: String(a.title ?? '').trim().slice(0, 120) || `Step ${i + 1}`,
      description: String(a.description ?? '').trim().slice(0, 4000) || 'Conversational execution step.',
      params: Object.fromEntries(
        Object.entries(a.params ?? {})
          .slice(0, 12)
          .map(([k, v]) => [k.slice(0, 32), String(v).slice(0, 2000)]),
      ),
      authScope: planActionScope(actionType),
      idempotencyKey: `decision:${planVersion.slice(0, 16)}:${id}`,
      dependsOn: (a.dependsOn ?? []).slice(0, 6),
      planVersion,
    })
  })
  return contracts
}

/** Server-side scope policy for conversational plan actions (fixed table). */
const PLAN_ACTION_SCOPES: Record<string, string> = {
  'file-read': 'retrieval-read',
  'research-fetch': 'retrieval-read',
  'repo-inspect': 'repo-read',
  'deployment-inspect': 'deployment-inspect',
  'file-write': 'project-write',
  'code-build': 'project-write',
  'media-produce': 'asset-create',
  'repo-commit': 'repo-write',
  'repo-push': 'repo-write',
  'repo-pull-request': 'repo-write',
  'website-publish-verify': 'project-write',
  'deployment-release': 'deployment-release',
  'external-communicate': 'external-communicate',
}

export function planActionScope(actionType: string): string {
  return PLAN_ACTION_SCOPES[actionType] ?? 'project-write'
}

export class DecisionToolError extends Error {}

// ---------------------------------------------------------------------------
// The operations.
// ---------------------------------------------------------------------------

export interface DecisionToolContext {
  /** Server-derived binding (authenticated user + conversation + turn). */
  binding: BoundRecord
  /** Server-derived turn intent (classifyTurnIntent over the real message). */
  intent: TurnIntent
  /** Optional mission Trust task the decision is bound to. */
  missionTrustTaskId?: string | null
}

export interface DecisionCreatedResult {
  decisionId: string
  status: DecisionRowStatus
  outcome: DecisionOutcome
  statement: string
  confidence: number
  confidenceTrail: string[]
  missingInformation: string[]
  escalationReason: string | null
}

/** Build the evidence summary for a decision through the guarded research lane. */
export async function evidenceForObjective(objective: string): Promise<{
  summary: ReturnType<typeof buildResearchEvidenceSummary>
  sources: Array<{ url: string; title: string; publishedAt?: string | null }>
}> {
  const pack = await runSpecialistResearchForDecision(objective)
  const sources = (pack?.sources ?? []).slice(0, DECISION_TOOL_LIMITS.researchMaxSources)
  const summarySources: SummarySource[] = sources.map((s) => ({
    title: s.title,
    url: s.url,
    hostName: safeHost(s.url),
    date: s.publishedAt ?? null,
  }))
  const summary = summarySources.length > 0 ? buildResearchEvidenceSummary(objective, summarySources) : null
  return { summary, sources }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host.slice(0, 80)
  } catch {
    return 'unknown-host'
  }
}

/** Operation: create a decision from the conversational objective. */
export async function createConversationDecision(input: {
  ctx: DecisionToolContext
  objective: string
  desiredOutcome?: string
  constraints?: string[]
  alternatives?: ConversationAlternative[]
  useEvidence?: boolean
  decisionText?: string
}): Promise<DecisionCreatedResult> {
  guardOperation(input.ctx, 'create_decision')
  const objective = String(input.objective ?? '').trim()
  const alternatives = normalizeAlternatives(input.alternatives ?? [])

  let evidence: ReturnType<typeof buildResearchEvidenceSummary> = null
  if (input.useEvidence) {
    // Test seam first (pinned honest summaries); the real path gathers
    // sources through the guarded research lane and builds the summary from
    // what was actually retrieved — never from model knowledge.
    const injected = await evidenceSummaryForDecision(objective)
    if (injected) {
      evidence = injected as ReturnType<typeof buildResearchEvidenceSummary>
    } else {
      const gathered = await evidenceForObjective(objective)
      evidence = gathered.summary
    }
  }

  const outcome = decide({
    objective,
    constraints: (input.constraints ?? []).slice(0, DECISION_TOOL_LIMITS.maxConstraints).map((c) => String(c).slice(0, DECISION_TOOL_LIMITS.constraintChars)),
    desiredOutcome: String(input.desiredOutcome ?? '').slice(0, 400),
    alternatives,
    evidence,
  })

  const row = await realDb.executionDecision.create({
    data: {
      userId: input.ctx.binding.binding.userId,
      conversationId: input.ctx.binding.binding.conversationId,
      turnId: input.ctx.binding.binding.turnId,
      objective: objective.slice(0, DECISION_TOOL_LIMITS.objectiveChars),
      status: 'created',
      decisionKind: outcome.kind,
      decisionJson: boundedJson(outcome, DECISION_TOOL_LIMITS.decisionJsonChars),
      planDigest: null,
      planJson: null,
      recordsJson: null,
      trustTaskId: null,
      bindingDigest: input.ctx.binding.bindingDigest,
    },
  })

  return {
    decisionId: row.id,
    status: 'created',
    outcome,
    statement: outcome.statement,
    confidence: outcome.confidence,
    confidenceTrail: outcome.confidenceTrail,
    missingInformation: outcome.missingInformation,
    escalationReason: outcome.escalationReason,
  }
}

/** Owner-scoped fetch + binding validation (every operation's first step). */
async function loadDecisionForContext(
  decisionId: string,
  ctx: DecisionToolContext,
): Promise<{ row: ExecutionDecisionRow; binding: BoundRecord }> {
  const row = await realDb.executionDecision.findFirst({ where: { id: decisionId } })
  if (!row) throw new DecisionToolError('Decision not found.')
  const binding: BoundRecord = {
    binding: {
      userId: row.userId,
      conversationId: row.conversationId,
      turnId: row.turnId,
      missionTrustTaskId: null,
    },
    bindingDigest: row.bindingDigest,
  }
  const ctxBinding: BindingCheckContext = {
    userId: ctx.binding.binding.userId,
    conversationId: ctx.binding.binding.conversationId,
    turnId: ctx.binding.binding.turnId,
    missionTrustTaskId: ctx.missionTrustTaskId ?? null,
  }
  const verdict = validateBinding(binding, ctxBinding)
  if (!verdict.ok) {
    // Honest, customer-safe refusals — never leak another user's data shape.
    throw new DecisionToolError(
      verdict.reason === 'user-mismatch'
        ? 'Decision not found.'
        : `This decision belongs to a different conversation context (${verdict.reason}).`,
    )
  }
  return { row, binding }
}

/** Operation: inspect a stored decision (owner-scoped). */
export async function inspectConversationDecision(decisionId: string, ctx: DecisionToolContext) {
  guardOperation(ctx, 'inspect_decision')
  const { row } = await loadDecisionForContext(decisionId, ctx)
  const outcome = JSON.parse(row.decisionJson) as DecisionOutcome
  return {
    decisionId: row.id,
    objective: row.objective,
    status: row.status,
    decisionKind: row.decisionKind,
    statement: outcome.statement,
    confidence: outcome.confidence,
    confidenceTrail: outcome.confidenceTrail,
    selectedAlternativeId: outcome.selectedAlternativeId,
    missingInformation: outcome.missingInformation,
    contradictionNote: outcome.contradictionNote,
    escalationReason: outcome.escalationReason,
    planDigest: row.planDigest,
    hasPlan: !!row.planJson,
  }
}

/** Operation: produce the structured execution proposal for a decision. */
export async function proposeConversationPlan(input: {
  decisionId: string
  ctx: DecisionToolContext
  actions: ProposedPlanAction[]
}): Promise<{
  decisionId: string
  planVersion: string
  planDigest: string
  status: DecisionRowStatus
  actions: Array<{ id: string; actionType: string; riskClass: string; reversibility: string; requiresApproval: string; title: string }>
  approvalRequired: string[]
}> {
  guardOperation(input.ctx, 'propose_plan')
  const { row } = await loadDecisionForContext(input.decisionId, input.ctx)

  const preContracts = contractsFromProposedActions(input.actions ?? [], 'pending-plan-digest')
  const plan = buildActionPlan(row.objective, preContracts)

  const updated = await realDb.executionDecision.update({
    where: { id: row.id },
    data: {
      status: 'planned',
      planDigest: plan.digest,
      planJson: boundedJson(plan, DECISION_TOOL_LIMITS.planJsonChars),
    },
  })

  const actions = plan.contracts.map((c) => ({
    id: c.id,
    actionType: c.actionType,
    riskClass: c.riskClass,
    reversibility: c.reversibility,
    requiresApproval: c.requiresApproval,
    title: c.title,
  }))
  return {
    decisionId: updated.id,
    planVersion: plan.planVersion,
    planDigest: plan.digest,
    status: 'planned',
    actions,
    approvalRequired: plan.contracts.filter((c) => c.requiresApproval === 'human').map((c) => c.id),
  }
}

/** Operation: REQUEST approval for a plan's human-class actions. */
export async function requestConversationApproval(input: {
  decisionId: string
  ctx: DecisionToolContext
}): Promise<{
  decisionId: string
  status: DecisionRowStatus
  approvals: Array<{ actionId: string; approvalDigest: string; summary: string; approvalId: string }>
  note: string
}> {
  guardOperation(input.ctx, 'request_approval')
  // One-shot per turn: an authorize intent may create a request once.
  if (!globalTurnLedger.spend(input.ctx.binding.binding, `request_approval:${input.decisionId}`)) {
    throw new DecisionToolError('An approval request for this decision was already made in this turn.')
  }
  const { row } = await loadDecisionForContext(input.decisionId, input.ctx)
  if (!row.planJson || !row.planDigest) throw new DecisionToolError('No execution plan exists for this decision yet.')
  const plan = JSON.parse(row.planJson) as ActionPlan

  const trustTaskId = await ensureTrustTask(row, input.ctx)

  const approvals: Array<{ actionId: string; approvalDigest: string; summary: string; approvalId: string }> = []
  const { buildApprovalPayload, approvalDigest } = await import('./authorization')
  for (const contract of plan.contracts.filter((c) => c.requiresApproval === 'human')) {
    const payload = buildApprovalPayload(contract, plan)
    const approval = await requestTaskApproval(trustTaskId, {
      action: payload,
      summary: `${contract.title} (${contract.riskClass}, ${contract.reversibility}): ${contract.description.slice(0, 200)}`,
    })
    approvals.push({
      actionId: contract.id,
      approvalDigest: approvalDigest(payload),
      summary: `${contract.title} (${contract.riskClass}, ${contract.reversibility})`,
      approvalId: approval.id,
    })
  }

  if (approvals.length > 0) {
    await realDb.executionDecision.update({ where: { id: row.id }, data: { status: 'awaiting-approval' } })
    await addTrustEvidence(trustTaskId, {
      kind: 'measurement',
      origin: 'extracted',
      ref: `m45:approval-request:${row.id.slice(0, 24)}`.slice(0, 128),
      note: `approval requested for ${approvals.length} action(s); grants only via the owner decision route`,
    }).catch(() => undefined)
  }

  return {
    decisionId: row.id,
    status: approvals.length > 0 ? 'awaiting-approval' : row.status as DecisionRowStatus,
    approvals,
    note:
      approvals.length > 0
        ? 'Approval requested. The grant must come from the owner through the existing approval decision flow — a conversational statement alone never grants it.'
        : 'No action in this plan requires human approval.',
  }
}

/** Operation: execute the plan — only with a valid, bound, granted approval. */
export async function executeConversationPlan(input: {
  decisionId: string
  ctx: DecisionToolContext
  /** Injected file store (tests); defaults to the db-backed store. */
  store?: ActionFileStore
}): Promise<{
  decisionId: string
  status: DecisionRowStatus | 'awaiting-approval'
  records: Array<{ actionId: string; state: string; resultSummary: string | null; verdict: string | null; note: string | null }>
  summary: string
}> {
  guardOperation(input.ctx, 'execute_plan')
  const { row } = await loadDecisionForContext(input.decisionId, input.ctx)
  if (!row.planJson || !row.planDigest) throw new DecisionToolError('No execution plan exists for this decision yet.')
  const plan = JSON.parse(row.planJson) as ActionPlan

  const trustTaskId = row.trustTaskId ?? (await ensureTrustTask(row, input.ctx))
  await realDb.executionDecision.update({ where: { id: row.id }, data: { status: 'executing', trustTaskId } })

  const { db: trustDb } = await import('@/lib/db')
  const approvalRows = await (trustDb as unknown as {
    trustApproval: { findMany(args: { where: { taskId: string } }): Promise<Array<{ id: string; actionDigest: string; actionJson: string; status: string }>> }
  }).trustApproval.findMany({ where: { taskId: trustTaskId } })

  const identity: ExecutorIdentity = {
    identity: `user:${row.userId}`,
    scopes: [...new Set(plan.contracts.map((c) => c.authScope))],
  }

  // Workspace-scoped actions carry their project context in the params; the
  // runner needs it for the independent post-verification re-reads.
  const projectId = plan.contracts.map((c) => c.params.projectId).find((p) => typeof p === 'string' && p.length > 0)

  const run = await runActionPlan({
    plan,
    identity,
    grantor: null,
    trustTaskId,
    approvals: approvalRows,
    cancelRequested: false,
    projectId: typeof projectId === 'string' ? projectId : undefined,
    store: input.store,
    onRecord: async (record) => {
      await addTrustEvidence(trustTaskId, {
        kind: 'measurement',
        origin: 'extracted',
        ref: `m45:${row.id.slice(0, 20)}:${record.actionId}`.slice(0, 128),
        note: `state=${record.state} verdict=${record.verificationVerdict ?? 'pending'} ${ (record.resultSummary ?? record.note ?? '').slice(0, 160) }`,
      }).catch(() => undefined)
    },
  })

  const status = runStatusToDecisionStatus(run.status)
  const boundedRecords = JSON.stringify(run.records).slice(0, DECISION_TOOL_LIMITS.recordsJsonChars)
  await realDb.executionDecision.update({
    where: { id: row.id },
    data: { status, recordsJson: boundedRecords },
  })
  await finalizeTrustTaskOutcome(trustTaskId, run.summary, status)

  return {
    decisionId: row.id,
    status,
    records: run.records.map((r: ActionExecutionRecord) => ({
      actionId: r.actionId,
      state: r.state,
      resultSummary: r.resultSummary,
      verdict: r.verificationVerdict,
      note: r.note,
    })),
    summary: run.summary,
  }
}

function runStatusToDecisionStatus(status: 'completed' | 'blocked' | 'awaiting-approval' | 'failed' | 'cancelled'): DecisionRowStatus {
  switch (status) {
    case 'completed':
      return 'succeeded'
    case 'blocked':
      return 'blocked'
    case 'awaiting-approval':
      return 'awaiting-approval'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
  }
}

/** Operation: lifecycle status of the decision's actions. */
export async function conversationActionStatus(decisionId: string, ctx: DecisionToolContext) {
  guardOperation(ctx, 'action_status')
  const { row } = await loadDecisionForContext(decisionId, ctx)
  const records = row.recordsJson ? (JSON.parse(row.recordsJson) as ActionExecutionRecord[]) : []
  return {
    decisionId: row.id,
    status: row.status,
    planDigest: row.planDigest,
    actions: records.map((r) => ({
      actionId: r.actionId,
      state: r.state,
      verificationVerdict: r.verificationVerdict,
      attempts: r.attempts,
    })),
  }
}

/** Operation: the independently verified results (or their honest absence). */
export async function conversationActionResult(decisionId: string, ctx: DecisionToolContext) {
  guardOperation(ctx, 'action_result')
  const { row } = await loadDecisionForContext(decisionId, ctx)
  const records = row.recordsJson ? (JSON.parse(row.recordsJson) as ActionExecutionRecord[]) : []
  const verified = records.filter((r) => r.state === 'SUCCEEDED' && r.verificationVerdict === 'confirmed')
  return {
    decisionId: row.id,
    status: row.status,
    verifiedResults: verified.map((r) => ({
      actionId: r.actionId,
      resultSummary: r.resultSummary,
      verificationMethod: r.verificationMethod,
      evidence: r.evidence,
    })),
    unverifiedCount: records.filter((r) => r.state !== 'SUCCEEDED').length,
    note:
      verified.length === 0
        ? 'No independently verified result exists yet — an unverified action is never reported as a success.'
        : `${verified.length} action(s) verified through independent methods.`,
  }
}

/** Operation: explain why an action was blocked/rejected/failed/completed. */
export async function explainConversationOutcome(input: { decisionId: string; ctx: DecisionToolContext; actionId?: string }) {
  guardOperation(input.ctx, 'explain_outcome')
  const { row } = await loadDecisionForContext(input.decisionId, input.ctx)
  const records = row.recordsJson ? (JSON.parse(row.recordsJson) as ActionExecutionRecord[]) : []
  const selected = input.actionId ? records.filter((r) => r.actionId === input.actionId) : records
  return {
    decisionId: row.id,
    status: row.status,
    explanations: selected.map((r) => ({
      actionId: r.actionId,
      state: r.state,
      explanation: outcomeExplanation(r),
    })),
  }
}

function outcomeExplanation(r: ActionExecutionRecord): string {
  switch (r.state) {
    case 'SUCCEEDED':
      return `Completed and independently verified (${r.verificationMethod ?? 'independent method'}). ${r.resultSummary ?? ''}`
    case 'BLOCKED':
      return `Blocked before execution: ${r.note ?? 'the authorization gate refused the action'}.`
    case 'REJECTED':
      return 'The approval was denied by the owner.'
    case 'FAILED':
      return `Failed: ${r.resultSummary ?? r.note ?? 'execution did not complete'}.`
    case 'CANCELLED':
      return 'Cancelled before completion; the audit trail records what ran and what did not.'
    case 'AWAITING_APPROVAL':
      return 'Waiting for owner approval — bound to the exact plan digest.'
    case 'PARTIALLY_SUCCEEDED':
      return 'Partially succeeded — some postconditions verified, recovery is required for the rest.'
    case 'RECOVERY_REQUIRED':
      return 'Verification was inconclusive — the action needs recovery, it is not reported as a success.'
    default:
      return `State: ${r.state}.`
  }
}

// ---------------------------------------------------------------------------
// Guards + helpers.
// ---------------------------------------------------------------------------

/** The intent gate: a state-consuming operation must match the turn intent. */
export function guardOperation(ctx: DecisionToolContext, operation: string): void {
  const allowed = INTENT_ALLOWED_OPERATIONS[ctx.intent] ?? INTENT_ALLOWED_OPERATIONS.unknown
  if (!allowed.includes(operation)) {
    throw new DecisionToolError(
      `The "${operation}" operation is not available for this turn: the user's message reads as "${ctx.intent}". ` +
        `Advice never triggers execution; ask the user to state the intent explicitly.`,
    )
  }
}

async function ensureTrustTask(row: ExecutionDecisionRow, ctx: DecisionToolContext): Promise<string> {
  if (row.trustTaskId) return row.trustTaskId
  const task: TrustTask = await createTrustTask({
    userId: row.userId,
    product: 'riishe',
    kind: 'execution-governance',
    title: `Execution decision: ${row.objective.slice(0, 60)}`,
    requestPreview: row.objective.slice(0, 200),
    conversationId: row.conversationId,
  })
  await realDb.executionDecision.update({ where: { id: row.id }, data: { trustTaskId: task.id } })
  void ctx
  return task.id
}

async function finalizeTrustTaskOutcome(trustTaskId: string, summary: string, status: DecisionRowStatus): Promise<void> {
  const { finalizeTrustTask } = await import('@/lib/trust/tasks')
  try {
    const honest =
      status === 'succeeded'
        ? ('completed' as const)
        : status === 'partially-succeeded'
          ? ('partially_completed' as const)
          : status === 'failed' || status === 'blocked' || status === 'recovery-required'
            ? ('failed' as const)
            : status === 'cancelled'
              ? ('cancelled' as const)
              : ('completed_with_limitations' as const)
    await finalizeTrustTask(trustTaskId, {
      status: honest,
      outcomeSummary: summary.slice(0, 500),
      verificationSummary:
        status === 'succeeded'
          ? 'Every executed action passed independent postcondition verification before success was declared.'
          : status === 'failed'
            ? 'The run did not verify successfully; no unverified step was reported as a success.'
            : null,
    })
  } catch (e) {
    logger.warn('m45.decision_finalize_failed', { error: (e instanceof Error ? e.message : String(e)).slice(0, 160) })
  }
}

function boundedJson(value: unknown, maxChars: number): string {
  const json = JSON.stringify(value)
  if (json.length <= maxChars) return json
  // Bounded storage: keep the head (the decision core) and mark the cut.
  return `${json.slice(0, maxChars - 24)}…[truncated]`
}

/** Test seam: expose the db selector so fakes can be asserted against. */
export function decisionDb(): DecisionDb {
  return realDb
}
