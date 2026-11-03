/**
 * BEAN Intelligence — RIISHE regenerate/retry planning (pure, unit-testable).
 *
 * Extracted from the chat runtime so the request-shaping contract for
 * Regenerate is pinned by tests (work order PART 4: "retry/regenerate uses
 * the wrong message" / "responses are associated with the wrong user
 * message").
 *
 * Measured defect fixed here (2026-11-02): the previous inline decision sent
 * `retry:false` when regenerating the TRAILING assistant message merely
 * because it had a persisted server id — the server then treated the
 * regeneration as a brand-new turn: the old question+answer stayed in
 * history AND a duplicate question row was appended, so the model's next
 * turns saw the same question twice (a real request-construction defect,
 * not a model-intelligence one).
 */

export type RegenerateMode =
  /** Classic retry: the trailing exchange is re-answered in place. */
  | 'trailing'
  /** An earlier exchange is truncated (with everything after it) and re-answered. */
  | 'from-message'

export interface RegeneratePlan {
  mode: RegenerateMode
  /** Wire fields for POST /api/riishe/chat. */
  retry: boolean
  retryFromMessageId?: string
}

/**
 * Plan a Regenerate for the assistant message at `isTrailing` position with
 * the given persisted server id (null when the turn was never persisted —
 * e.g. a failed or user-stopped stream).
 *
 * Rules:
 *  - Trailing: ALWAYS `retry:true` (the server deletes the trailing assistant
 *    row, if any, and the dangling-collapse removes the original question row
 *    before the re-sent one is recorded) — whether or not the previous answer
 *    was persisted.
 *  - Earlier message: requires a persisted server id (otherwise server-side
 *    history cannot be truncated honestly — refuse rather than duplicate).
 */
export function planRegenerate(args: {
  isTrailing: boolean
  serverId: string | null | undefined
}): RegeneratePlan | null {
  if (args.isTrailing) return { mode: 'trailing', retry: true }
  if (!args.serverId) return null
  return { mode: 'from-message', retry: false, retryFromMessageId: args.serverId }
}

/**
 * Pure recovery-match predicate for the client's dead-wire reconciliation:
 * when a stream died but the server completed and persisted the turn, the
 * client may adopt the persisted answer. Adoption is honest ONLY when the
 * persisted content clearly corresponds to THIS turn's partial text:
 *  - nothing streamed (partial empty) -> adopt the completed turn;
 *  - otherwise the partial's normalized head must appear in the persisted
 *    content (the verification rewrite may reword the tail, but the opening
 *    survives; a reset+complete-rewrite shares the head in practice, and
 *    when it does not, we refuse rather than show the wrong turn's answer).
 */
export function persistedAnswerMatchesTurn(persisted: string, partial: string): boolean {
  const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
  const p = norm(partial)
  const full = norm(persisted)
  if (full.length === 0) return false
  if (p.length === 0) return true
  const head = (s: string): string => s.slice(0, 80)
  return full.startsWith(head(p)) || full.includes(head(p))
}
