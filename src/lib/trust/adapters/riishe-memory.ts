/**
 * BEAN Intelligence — RIISHE memory-management Trust receipts.
 *
 * M33: explicit memory management actions (edit, export, delete,
 * user-confirmed replacement, potential-conflict presentation) become real,
 * inspectable TrustTask receipts in the EXISTING ledger — same task model,
 * same lifecycle, same honesty rules (src/lib/trust/tasks.ts). This is NOT a
 * second audit architecture: one small helper over createTrustTask /
 * planTrustSteps / addTrustEvidence / finalizeTrustTask, mirroring how the
 * chat recorder rides on the same primitives.
 *
 * PRIVACY CONTRACT (M33 §6/§7): TrustEvidence NEVER carries memory content.
 * References are the memory row IDs only; notes state the action, the
 * bounded size (character count) and the truthful outcome. A user's memory
 * text can therefore never leak into the receipt ledger through this path.
 *
 * Best-effort by contract: recording failures are logged and never break the
 * user's operation (the memory API stays authoritative).
 *
 * SERVER-ONLY.
 */

import { logger } from '@/lib/observability/logger'
import { TRUST_LIMITS, type TrustStepKind } from '@/lib/trust/types'
import {
  addTrustEvidence,
  createTrustTask,
  finalizeTrustTask,
  planTrustSteps,
  startTrustTask,
  updateTrustStepStatus,
} from '@/lib/trust/tasks'

/** The explicit management operations that warrant a receipt. */
export type MemoryManagementOp =
  | 'create'
  | 'edit'
  | 'export'
  | 'delete'
  | 'delete-all'
  | 'user-confirmed-replacement'
  | 'potential-conflicts-presented'

const OP_TITLES: Record<MemoryManagementOp, string> = {
  create: 'Memory created',
  edit: 'Memory edited',
  export: 'Memory exported',
  delete: 'Memory deleted',
  'delete-all': 'All memories deleted',
  'user-confirmed-replacement': 'Memory replaced at your request',
  'potential-conflicts-presented': 'Potential memory conflicts presented',
}

export interface MemoryManagementReceiptInput {
  userId: string
  op: MemoryManagementOp
  /** Bounded references: the affected memory row IDs (never content). */
  memoryIds?: ReadonlyArray<string>
  /** How many rows the operation stored / changed / exported / deleted. */
  itemCount?: number
  /** Truthful, customer-displayable outcome statement (no content). */
  verification: string
  /** Honest limitation notes when the outcome was partial/refused. */
  limitations?: ReadonlyArray<string>
  /** Completed without any row changing (refusals, conflict presented)? */
  withLimitations?: boolean
}

/** Cap the per-receipt evidence rows so a bulk delete cannot flood the ledger. */
const MAX_EVIDENCE_REFS = 10

/**
 * Record one memory-management receipt. Best-effort: resolves silently even
 * when the ledger write fails (logged) — the user's memory operation itself
 * must never fail because of receipt bookkeeping.
 */
export async function recordMemoryManagementReceipt(input: MemoryManagementReceiptInput): Promise<void> {
  try {
    const taskId = await createStartedTask(input)
    if (!taskId) return
    const refs = (input.memoryIds ?? []).slice(0, MAX_EVIDENCE_REFS)
    for (const id of refs) {
      await addTrustEvidence(taskId, {
        kind: 'artifact',
        // Bounded reference: the memory row ID. Content is deliberately
        // excluded from every receipt field.
        ref: `riishe-memory:${id}`.slice(0, TRUST_LIMITS.refChars),
        title: OP_TITLES[input.op].slice(0, TRUST_LIMITS.summaryField),
        note: `memory row affected by ${input.op}; no memory content is stored in receipts`,
        origin: 'extracted',
      })
    }
    await finalizeTrustTask(taskId, {
      outcome: input.withLimitations ? 'completed_with_limitations' : 'completed',
      outcomeSummary: OP_TITLES[input.op],
      verificationSummary: input.verification.slice(0, TRUST_LIMITS.summaryField),
      limitations: (input.limitations ?? []).map((l) => l.slice(0, TRUST_LIMITS.limitationChars)),
    })
  } catch (err) {
    logger.warn('trust.memory_receipt_failed', {
      op: input.op,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Create + start the task with its single planned step. Returns the id. */
async function createStartedTask(input: MemoryManagementReceiptInput): Promise<string | null> {
  const task = await createTrustTask({
    userId: input.userId,
    product: 'riishe',
    kind: 'memory-management',
    title: OP_TITLES[input.op],
    requestChars: typeof input.itemCount === 'number' ? input.itemCount : undefined,
  })
  await startTrustTask(task.id)
  await planTrustSteps(task.id, [
    { kind: 'tool' as TrustStepKind, title: 'Memory store operation (owner-scoped)' },
  ])
  await updateTrustStepStatus(task.id, 1, 'done')
  return task.id
}
