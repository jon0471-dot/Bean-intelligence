/**
 * BEAN Intelligence — M45 Phase 6: customer-safe action status views.
 *
 * The eleven lifecycle states a governed action can be in, rendered as
 * customer-safe labels WITHOUT provider internals or confusing backend
 * jargon. The conversational decision tool uses these in its outputs so the
 * existing RIISHE chat experience distinguishes every state through the
 * UNCHANGED message flow — no new dashboard, no redesign.
 */

import type { ActionExecutionState } from './action-lifecycle'
import type { DecisionRowStatus } from './decision-tool'

export const ACTION_STATUS_VIEW: Record<ActionExecutionState, { label: string; customerExplanation: string; tone: 'progress' | 'good' | 'warn' | 'bad' }> = {
  PLANNED: { label: 'Proposed', customerExplanation: 'Planned and inspectable — nothing has run yet.', tone: 'progress' },
  AWAITING_APPROVAL: { label: 'Awaiting approval', customerExplanation: 'Waiting for the owner to approve this exact action in the approval flow.', tone: 'warn' },
  APPROVED: { label: 'Approved', customerExplanation: 'Approved and about to run.', tone: 'progress' },
  EXECUTING: { label: 'Executing', customerExplanation: 'Running now.', tone: 'progress' },
  VERIFYING: { label: 'Verifying', customerExplanation: 'Finished running; the result is being independently verified.', tone: 'progress' },
  SUCCEEDED: { label: 'Succeeded', customerExplanation: 'Completed AND independently verified.', tone: 'good' },
  PARTIALLY_SUCCEEDED: { label: 'Partially succeeded', customerExplanation: 'Some parts verified, others need recovery.', tone: 'warn' },
  FAILED: { label: 'Failed', customerExplanation: 'Did not complete or failed verification — reported honestly.', tone: 'bad' },
  BLOCKED: { label: 'Blocked', customerExplanation: 'Refused before running (authorization, policy or a missing prerequisite).', tone: 'bad' },
  CANCELLED: { label: 'Cancelled', customerExplanation: 'Cancelled; the audit trail records exactly what ran.', tone: 'warn' },
  RECOVERY_REQUIRED: { label: 'Recovery required', customerExplanation: 'The result could not be confirmed — it needs recovery and is not counted as a success.', tone: 'warn' },
}

/** Customer-safe label for a decision row status (tool outputs). */
export function decisionStatusLabel(status: DecisionRowStatus | string): string {
  const map: Record<string, string> = {
    created: 'Proposed',
    planned: 'Proposed (plan ready)',
    'awaiting-approval': 'Awaiting approval',
    executing: 'Executing',
    succeeded: 'Succeeded (verified)',
    'partially-succeeded': 'Partially succeeded',
    failed: 'Failed',
    blocked: 'Blocked',
    cancelled: 'Cancelled',
    'recovery-required': 'Recovery required',
  }
  return map[status] ?? status
}

/** Render a record line for chat output: state label + honest detail. */
export function formatRecordForChat(record: {
  actionId: string
  state: ActionExecutionState
  resultSummary: string | null
  verificationVerdict: string | null
}): string {
  const view = ACTION_STATUS_VIEW[record.state] ?? { label: record.state, customerExplanation: '', tone: 'progress' as const }
  const detail = record.resultSummary?.slice(0, 200) ?? ''
  return `[${view.label}] ${record.actionId}${detail ? ` — ${detail}` : ''}${record.verificationVerdict ? ` (verification: ${record.verificationVerdict})` : ''}${view.customerExplanation ? ` — ${view.customerExplanation}` : ''}`
}

/** Test/ops seam: every state must carry a customer-safe label. */
export const ACTION_STATUS_VIEW_COMPLETE = (Object.keys(ACTION_STATUS_VIEW) as ActionExecutionState[]).every((s) => ACTION_STATUS_VIEW[s].label.length > 0)
