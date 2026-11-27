/**
 * BEAN Intelligence — M45 Phase 1: conversation binding (pure).
 *
 * Every per-turn decision, plan, approval request and execution record is
 * bound to the exact context it was created in: the authenticated user, the
 * conversation, the turn and (when present) the mission's Trust task. The
 * binding digest is the canonical hash over that context — any record whose
 * stored digest no longer re-derives is treated as tampered and refused
 * before any other check runs.
 *
 * What the guards prevent (each maps to an acceptance scenario):
 *   - cross-user access: a different user id never validates;
 *   - cross-conversation execution: a plan bound to one conversation cannot
 *     be executed from another;
 *   - turn replay of one-shot operations: "authorize"/"execute" shaped
 *     requests must carry a fresh turn id when the operation consumes state
 *     (the Trust approval itself is consume-once upstream — this is the
 *     second layer, not a substitute);
 *   - action substitution: M44's digest-bound approvals remain the binding
 *     between an approval and the EXACT action — this module binds records
 *     to conversations, it does not replace that digest discipline.
 *
 * PURE module — no database, no I/O. SERVER-ONLY consumers.
 */

import { canonicalJson, sha256Hex } from '@/lib/trust/digest'

// ---------------------------------------------------------------------------
// The binding.
// ---------------------------------------------------------------------------

export interface ConversationBinding {
  /** Authenticated owner of the record (never a model-supplied value). */
  userId: string
  /** Conversation the record belongs to. */
  conversationId: string
  /** Turn inside the conversation (fresh per user message). */
  turnId: string
  /** Mission Trust task when the record rides a mission (else null). */
  missionTrustTaskId: string | null
}

export interface BoundRecord {
  /** The binding the record was created under. */
  binding: ConversationBinding
  /** Canonical digest over the binding — re-derived on every validation. */
  bindingDigest: string
}

export class ConversationBindingError extends Error {}

const MAX_ID = 128

function cleanId(value: string, label: string): string {
  const v = (value ?? '').trim()
  if (!v) throw new ConversationBindingError(`${label} is required for a conversation binding.`)
  if (v.length > MAX_ID) throw new ConversationBindingError(`${label} exceeds its ${MAX_ID}-character bound.`)
  return v
}

/** Build + digest a binding. Server-supplied ids only — never model text. */
export function buildConversationBinding(input: {
  userId: string
  conversationId: string
  turnId: string
  missionTrustTaskId?: string | null
}): BoundRecord {
  const binding: ConversationBinding = {
    userId: cleanId(input.userId, 'userId'),
    conversationId: cleanId(input.conversationId, 'conversationId'),
    turnId: cleanId(input.turnId, 'turnId'),
    missionTrustTaskId: input.missionTrustTaskId ? cleanId(input.missionTrustTaskId, 'missionTrustTaskId') : null,
  }
  return { binding, bindingDigest: bindingDigestOf(binding) }
}

/** The canonical binding digest (one hash discipline — the Trust Engine's). */
export function bindingDigestOf(binding: ConversationBinding): string {
  return sha256Hex(
    canonicalJson({
      userId: binding.userId,
      conversationId: binding.conversationId,
      turnId: binding.turnId,
      missionTrustTaskId: binding.missionTrustTaskId,
    }),
  )
}

// ---------------------------------------------------------------------------
// Validation — the guard every owner-scoped operation runs first.
// ---------------------------------------------------------------------------

export type BindingRejection =
  | 'binding-tampered' // the stored digest no longer re-derives from the stored binding
  | 'user-mismatch' // a different user tried to use the record
  | 'conversation-mismatch' // the record was used from a different conversation
  | 'mission-mismatch' // the record is bound to a different mission
  | 'turn-replay' // a one-shot operation re-used an already-spent turn binding

export interface BindingValidation {
  ok: boolean
  reason: BindingRejection | null
}

export interface BindingCheckContext {
  userId: string
  conversationId: string
  turnId: string
  missionTrustTaskId?: string | null
}

/**
 * Validate a stored record against the requesting context. Order matters:
 * tampering first (a forged binding must fail even when the other fields
 * would match), then user, then conversation, then mission.
 */
export function validateBinding(record: BoundRecord, ctx: BindingCheckContext): BindingValidation {
  if (bindingDigestOf(record.binding) !== record.bindingDigest) {
    return { ok: false, reason: 'binding-tampered' }
  }
  if (record.binding.userId !== (ctx.userId ?? '').trim()) return { ok: false, reason: 'user-mismatch' }
  if (record.binding.conversationId !== (ctx.conversationId ?? '').trim()) {
    return { ok: false, reason: 'conversation-mismatch' }
  }
  const recordMission = record.binding.missionTrustTaskId
  const ctxMission = ctx.missionTrustTaskId ? ctx.missionTrustTaskId.trim() : null
  if ((recordMission ?? null) !== (ctxMission ?? null)) return { ok: false, reason: 'mission-mismatch' }
  return { ok: true, reason: null }
}

// ---------------------------------------------------------------------------
// One-shot turn ledgers — replay protection for state-consuming operations.
// ---------------------------------------------------------------------------

/**
 * A bounded in-memory ledger of turn ids that already carried a given
 * one-shot operation in this process. The Trust approval's consume-once is
 * the durable layer; this catches same-process duplicate submits (double
 * tool calls inside one turn) before any Trust write happens.
 */
const MAX_LEDGER_ENTRIES = 2048

export class TurnOperationLedger {
  private readonly spent = new Map<string, string>() // key -> operation

  constructor(private readonly maxEntries: number = MAX_LEDGER_ENTRIES) {}

  private key(binding: ConversationBinding, operation: string): string {
    return `${bindingDigestOf(binding)}:${operation}`
  }

  /** True when this (binding, operation) pair was already used. */
  isSpent(binding: ConversationBinding, operation: string): boolean {
    return this.spent.has(this.key(binding, operation))
  }

  /**
   * Mark a (binding, operation) pair as used. Returns false (and marks
   * nothing) when the pair was already spent — the caller must refuse.
   */
  spend(binding: ConversationBinding, operation: string): boolean {
    const k = this.key(binding, operation)
    if (this.spent.has(k)) return false
    if (this.spent.size >= this.maxEntries) {
      // Bounded: drop the OLDEST entry (insertion order of a Map is stable).
      const oldest = this.spent.keys().next().value
      if (oldest !== undefined) this.spent.delete(oldest)
    }
    this.spent.set(k, operation)
    return true
  }
}

/** Process-wide ledger (one per server process; tests may build their own). */
export const globalTurnLedger = new TurnOperationLedger()

/** Test/ops seam: the rejection vocabulary in registration order. */
export const BINDING_REJECTION_KINDS = [
  'binding-tampered',
  'user-mismatch',
  'conversation-mismatch',
  'mission-mismatch',
  'turn-replay',
] as const
