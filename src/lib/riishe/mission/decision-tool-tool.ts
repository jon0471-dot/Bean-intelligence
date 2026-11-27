/**
 * BEAN Intelligence — M45 Phase 1: the conversational decision tool
 * (SERVER ONLY tool descriptor).
 *
 * One registered tool (`execution_decision`) with an explicit operation
 * discriminator, wired through the SAME two-key discipline as every
 * delegation tool (M36/M37/M41): the 'explicit' permission key
 * `allowExecutionGovernance` must be present in the route's permission set
 * AND the per-turn capability plan must agree before the tool enters the
 * model's universe.
 *
 * Server-derived context: the orchestrator stamps the ToolContext with the
 * authenticated user, conversation id, fresh turn id and the turn intent it
 * classified from the REAL user message. The model can neither supply nor
 * forge these fields — the intent gate inside the decision operations reads
 * the server-derived classification, so an advice-shaped turn can never
 * drive request_approval or execute_plan no matter what the tool input says.
 */

import { classifyTurnIntent } from './conversation-intent'
import { buildConversationBinding } from './conversation-binding'
import {
  createConversationDecision,
  executeConversationPlan,
  explainConversationOutcome,
  inspectConversationDecision,
  proposeConversationPlan,
  requestConversationApproval,
  conversationActionStatus,
  conversationActionResult,
  DecisionToolError,
  DECISION_TOOL_LIMITS,
  type ConversationAlternative,
  type ProposedPlanAction,
} from './decision-tool'
import type { ToolContext, ToolDescriptor, ToolResult } from '../tools/types'

const OPERATIONS = [
  'create_decision',
  'inspect_decision',
  'propose_plan',
  'request_approval',
  'execute_plan',
  'action_status',
  'action_result',
  'explain_outcome',
] as const

type Operation = (typeof OPERATIONS)[number]

export interface ExecutionDecisionInput {
  operation: Operation
  decisionId?: string
  objective?: string
  desiredOutcome?: string
  constraints?: string[]
  alternatives?: ConversationAlternative[]
  useEvidence?: boolean
  actions?: ProposedPlanAction[]
  actionId?: string
}

export function validateExecutionDecisionInput(input: unknown): ExecutionDecisionInput {
  const rec = (input ?? {}) as Record<string, unknown>
  const operation = String(rec.operation ?? '').trim()
  if (!OPERATIONS.includes(operation as Operation)) {
    throw new Error(`Unknown operation "${operation.slice(0, 40)}". Use one of: ${OPERATIONS.join(', ')}.`)
  }
  const needsDecision: readonly string[] = ['inspect_decision', 'propose_plan', 'request_approval', 'execute_plan', 'action_status', 'action_result', 'explain_outcome']
  const decisionId = typeof rec.decisionId === 'string' ? rec.decisionId.trim() : ''
  if (needsDecision.includes(operation) && (decisionId.length === 0 || decisionId.length > 64)) {
    throw new Error(`Operation "${operation}" needs the decisionId returned when the decision was created.`)
  }
  if (operation === 'create_decision') {
    const objective = typeof rec.objective === 'string' ? rec.objective.trim() : ''
    if (objective.length < 12) throw new Error('State the objective in full (at least 12 characters).')
    if (objective.length > DECISION_TOOL_LIMITS.objectiveChars) {
      throw new Error(`The objective must be at most ${DECISION_TOOL_LIMITS.objectiveChars} characters.`)
    }
    const alternatives = Array.isArray(rec.alternatives) ? rec.alternatives : []
    if (alternatives.length === 0) {
      throw new Error('Offer at least one concrete alternative to decide between (an empty decision decides nothing).')
    }
  }
  if (operation === 'propose_plan') {
    const actions = Array.isArray(rec.actions) ? rec.actions : []
    if (actions.length === 0) throw new Error('Propose at least one typed plan action (actionType + title + description).')
  }
  return {
    operation: operation as Operation,
    decisionId: decisionId || undefined,
    objective: typeof rec.objective === 'string' ? rec.objective : undefined,
    desiredOutcome: typeof rec.desiredOutcome === 'string' ? rec.desiredOutcome : undefined,
    constraints: Array.isArray(rec.constraints) ? rec.constraints.map(String) : undefined,
    alternatives: Array.isArray(rec.alternatives) ? (rec.alternatives as ConversationAlternative[]) : undefined,
    useEvidence: rec.useEvidence === true,
    actions: Array.isArray(rec.actions) ? (rec.actions as ProposedPlanAction[]) : undefined,
    actionId: typeof rec.actionId === 'string' ? rec.actionId.trim() : undefined,
  }
}

function toolContextError(e: unknown): ToolResult {
  const msg = e instanceof DecisionToolError ? e.message : e instanceof Error ? e.message : 'The operation failed.'
  return { ok: false, output: `${msg.slice(0, 400)} Relay this honestly; do not restate it as a success.` }
}

export const executionDecisionTool: ToolDescriptor<ExecutionDecisionInput> = {
  name: 'execution_decision',
  description:
    'Evidence-grounded governed execution for THIS conversation (M45). Operations: ' +
    '"create_decision" — weigh options for the user\'s objective against verified evidence (honest uncertainty when evidence is thin); ' +
    '"inspect_decision" — retrieve a stored decision; ' +
    '"propose_plan" — turn a decision into a structured, digest-bound execution plan (typed actions; risk classes are derived, not claimed); ' +
    '"request_approval" — create approval REQUESTS for the plan\'s protected actions (a conversational "yes" is never the grant; the owner grants through the approval flow); ' +
    '"execute_plan" — run ONLY an already-approved, unmodified plan; every action is independently verified before success is reported; ' +
    '"action_status" / "action_result" / "explain_outcome" — report real lifecycle state, verified results, and honest explanations. ' +
    'Advice questions must stay advice: never call request_approval or execute_plan unless the user explicitly asked for that step.',
  permission: 'explicit',
  permissionKey: 'allowExecutionGovernance',
  validate: validateExecutionDecisionInput,
  timeoutMs: 60_000,
  async execute(input: ExecutionDecisionInput, ctx: ToolContext): Promise<ToolResult> {
    // Defense-in-depth: the registry already gates explicit tools, but the
    // tool itself re-checks the permission key (the M41 delegation pattern).
    if (!ctx.permissions.has('allowExecutionGovernance')) {
      return { ok: false, output: 'Permission denied: governed execution was not approved for this request. Do not retry it; continue answering without it.' }
    }
    if (!ctx.userId) return { ok: false, output: 'Governed execution requires an authenticated session.' }
    // Server-derived intent: from the REAL user message carried in the tool
    // context (never from the model's tool input).
    const intent = ctx.turnIntent ?? classifyTurnIntent(ctx.userMessageText ?? '')
    if (!ctx.conversationId || !ctx.turnId) {
      return { ok: false, output: 'Governed execution requires a conversation context (conversation id + turn id).' }
    }
    const binding = buildConversationBinding({
      userId: ctx.userId,
      conversationId: ctx.conversationId,
      turnId: ctx.turnId,
      missionTrustTaskId: ctx.missionTrustTaskId ?? null,
    })
    const toolCtx = { binding, intent, missionTrustTaskId: ctx.missionTrustTaskId ?? null }
    try {
      switch (input.operation) {
        case 'create_decision': {
          const r = await createConversationDecision({
            ctx: toolCtx,
            objective: input.objective ?? '',
            desiredOutcome: input.desiredOutcome,
            constraints: input.constraints,
            alternatives: input.alternatives,
            useEvidence: input.useEvidence,
          })
          return {
            ok: true,
            output:
              `Decision ${r.decisionId} recorded (kind: ${r.outcome.kind}, confidence ${r.confidence.toFixed(2)}).\n` +
              `${r.statement}\n` +
              `Confidence trail: ${r.confidenceTrail.join('; ')}.\n` +
              (r.missingInformation.length ? `Missing information: ${r.missingInformation.slice(0, 4).join('; ')}.\n` : '') +
              (r.escalationReason ? `Escalation: ${r.escalationReason}\n` : '') +
              'Present the outcome and its uncertainty honestly. Do NOT execute anything from an advice turn; offer propose_plan only if the user wants a concrete plan.',
          }
        }
        case 'inspect_decision': {
          const r = await inspectConversationDecision(input.decisionId!, toolCtx)
          return {
            ok: true,
            output:
              `Decision ${r.decisionId} (${r.status}, kind ${r.decisionKind}):\n${r.statement}\n` +
              `Confidence ${r.confidence.toFixed(2)}${r.hasPlan ? `, plan ${r.planDigest?.slice(0, 16)} bound` : ', no plan yet'}.\n` +
              (r.escalationReason ? `Escalation: ${r.escalationReason}\n` : '') +
              'Relay exactly this state.',
          }
        }
        case 'propose_plan': {
          const r = await proposeConversationPlan({ decisionId: input.decisionId!, ctx: toolCtx, actions: input.actions ?? [] })
          const lines = r.actions
            .map(
              (a) =>
                `- ${a.id}: ${a.actionType} — "${a.title}" (risk ${a.riskClass}, ${a.reversibility}; ` +
                `${a.requiresApproval === 'human' ? 'needs owner approval' : a.requiresApproval === 'self' ? 'runs inside granted scope' : 'read-only'})`,
            )
            .join('\n')
          return {
            ok: true,
            output:
              `Plan bound to decision ${r.decisionId} (plan ${r.planVersion.slice(0, 16)}, digest ${r.planDigest.slice(0, 16)}).\n` +
              `${lines}\n` +
              (r.approvalRequired.length
                ? `Protected actions awaiting approval: ${r.approvalRequired.join(', ')}. Call request_approval to create the approval requests; the OWNER grants them through the approval flow.\n`
                : 'No human approval is required for this plan; it can be executed on request.\n') +
              'Present the proposal and its risks; do not execute until the user explicitly asks and authorizations validate.',
          }
        }
        case 'request_approval': {
          const r = await requestConversationApproval({ decisionId: input.decisionId!, ctx: toolCtx })
          return {
            ok: true,
            output:
              `${r.note}\n` +
              r.approvals.map((a) => `- ${a.actionId}: approval ${a.approvalId} bound to digest ${a.approvalDigest.slice(0, 16)} (${a.summary})`).join('\n') +
              '\nTell the user the request is awaiting their decision in the approval flow; their conversational reply does not grant it.',
          }
        }
        case 'execute_plan': {
          const r = await executeConversationPlan({ decisionId: input.decisionId!, ctx: toolCtx })
          return {
            ok: true,
            output:
              `Execution finished for decision ${r.decisionId}: ${r.summary}\n` +
              r.records
                .map(
                  (rec) =>
                    `- ${rec.actionId}: ${rec.state}${rec.verdict ? ` (verdict ${rec.verdict})` : ''}${rec.resultSummary ? ` — ${rec.resultSummary.slice(0, 200)}` : ''}${rec.note ? ` — ${rec.note.slice(0, 160)}` : ''}`,
                )
                .join('\n') +
              '\nRelay the verified outcomes exactly; states other than SUCCEEDED are not successes.',
          }
        }
        case 'action_status': {
          const r = await conversationActionStatus(input.decisionId!, toolCtx)
          return {
            ok: true,
            output:
              `Decision ${r.decisionId} is ${r.status}.` +
              (r.actions.length
                ? `\n` + r.actions.map((a) => `- ${a.actionId}: ${a.state}${a.verificationVerdict ? ` (verdict ${a.verificationVerdict}, attempts ${a.attempts})` : ''}`).join('\n')
                : '\nNo action has run yet.') +
              '\nRelay exactly this state.',
          }
        }
        case 'action_result': {
          const r = await conversationActionResult(input.decisionId!, toolCtx)
          return {
            ok: true,
            output:
              `${r.note}\n` +
              (r.verifiedResults.length
                ? r.verifiedResults.map((v) => `- ${v.actionId}: ${v.resultSummary ?? 'completed'} (verified: ${v.verificationMethod})`).join('\n')
                : 'No verified results to report.') +
              (r.unverifiedCount ? `\n${r.unverifiedCount} action(s) are NOT verified — never present them as successes.` : ''),
          }
        }
        case 'explain_outcome': {
          const r = await explainConversationOutcome({ decisionId: input.decisionId!, ctx: toolCtx, actionId: input.actionId })
          return {
            ok: true,
            output:
              `Decision ${r.decisionId} (${r.status}):\n` +
              r.explanations.map((e) => `- ${e.actionId}: ${e.explanation}`).join('\n') +
              '\nExplain the outcome exactly as stated — including blocks, refusals and failures.',
          }
        }
        default:
          return { ok: false, output: `Unknown operation.` }
      }
    } catch (e) {
      return toolContextError(e)
    }
  },
}

/** Test/ops seam: the M45 decision tool name + operation vocabulary. */
export const DECISION_TOOL_NAME = 'execution_decision'
export const DECISION_TOOL_OPERATIONS = OPERATIONS
