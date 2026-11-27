/**
 * BEAN Intelligence — M46.1: tool-invocation reliability & honesty
 * (SERVER ONLY, pure — no I/O on the hot path).
 *
 * M45 wired the `execution_decision` tool into the conversational universe,
 * but the recorded production walkthrough answered two governance-shaped
 * requests advice-first WITHOUT emitting a tool call. Root cause (from the
 * M46.0 audit): every BEAN chat lane runs the RIISHE TEXT tool protocol
 * (`TOOL_CALL: {json}` lines) — none of the adapters exposes native
 * function calling — so a governed tool is invoked only when the model
 * actually emits protocol syntax. That behavior was previously invisible:
 * nothing measured "tools were available but the model never called one".
 *
 * This module makes invocation BEHAVIOR observable and honest, without
 * moving any security decision:
 *   - the two-key gate, server-derived intent gate, digest-bound approvals
 *     and owner-only grants all stay exactly where M44/M45 put them;
 *   - this module only classifies + records what the model DID with the
 *     tool universe it was given (invocation behavior ≠ task completion);
 *   - a lane whose descriptor declares no tool protocol gets the existing
 *     safe fallback (plain chat, tools never offered) with an honest
 *     degraded note — never a fabricated execution, never weakened auth.
 *
 * Provider honesty: the protocol table is DERIVED from the backend
 * registry facts (all current chat lanes are text-protocol through the
 * RIISHE loop; none exposes native function calling today). Unknown
 * backends DEFAULT to the text protocol rather than a per-model refusal,
 * so a future provider is never silently broken by a stale table —
 * capability claims stay with the registry, measurement stays here.
 */

// ---------------------------------------------------------------------------
// Protocol kinds.
// ---------------------------------------------------------------------------

/**
 * How a chat lane can receive tool requests:
 *  - 'text'  — the RIISHE bounded text protocol (TOOL_CALL lines parsed and
 *              executed server-side). Works over plain chat completions;
 *              invocation depends on model protocol compliance (measured,
 *              never assumed).
 *  - 'none'  — this lane cannot carry tool requests at all. The orchestrator
 *              must not open the tool loop; it answers plainly and says so.
 * ('native' is deliberately absent: no BEAN adapter exposes provider-native
 * function calling today. When one lands, the registry declares it here —
 * inventing the verb now would advertise a capability nothing uses.)
 */
export type ToolProtocolKind = 'text' | 'none'

export interface ToolProtocolDescriptor {
  kind: ToolProtocolKind
  /** Honest, admin-visible explanation (never a capability claim). */
  note: string
}

/**
 * Protocol per chat backend, keyed by the REAL backend ids from
 * `src/lib/registry/backends.ts`. Facts, not policy: today every chat lane
 * reaches the model as plain chat completions, so all three run the text
 * protocol. Unlisted backends default to 'text' (see
 * `resolveToolProtocol`) so future lanes are not silently refused.
 */
const TOOL_PROTOCOL_BY_BACKEND: Record<string, ToolProtocolDescriptor> = {
  'bean-llm-hosted-primary': {
    kind: 'text',
    note: 'Authorized hosted gateway via plain chat completions; RIISHE text tool protocol (TOOL_CALL lines). Model compliance varies — measured per turn, not assumed.',
  },
  'bean-llm-openai-compatible': {
    kind: 'text',
    note: 'OpenAI-compatible adapter used WITHOUT the native tools parameter; RIISHE text tool protocol. No per-provider reliability measurement exists yet.',
  },
  'bean-chat-local-llamacpp': {
    kind: 'text',
    note: 'Local llama.cpp lane via plain chat completions; RIISHE text tool protocol. Small-model protocol compliance is expected to be weaker — measured, never assumed.',
  },
}

/** Resolve a backend's tool protocol. Unknown ids default to 'text'. */
export function resolveToolProtocol(backendId: string | null | undefined): ToolProtocolDescriptor {
  const key = (backendId ?? '').trim()
  if (!key) {
    return { kind: 'text', note: 'Backend id unavailable to this turn; the default text protocol applies.' }
  }
  return TOOL_PROTOCOL_BY_BACKEND[key] ?? {
    kind: 'text',
    note: `Backend "${key.slice(0, 64)}" has no explicit protocol record; the default text protocol applies.`,
  }
}

// ---------------------------------------------------------------------------
// Invocation policy — whether the tool loop may open at all.
// ---------------------------------------------------------------------------

export type ToolLoopMode = 'loop' | 'plain-fallback'

export interface ToolInvocationPolicy {
  mode: ToolLoopMode
  /** Why this policy was chosen (goes to the honest degraded trail). */
  reason: string
  /** Customer-safe degraded note for mode 'plain-fallback' (empty otherwise). */
  degradedNote: string | null
}

/**
 * Decide whether this turn may run the bounded tool loop at all. This is a
 * CAPABILITY check (can this lane carry tool requests?), NOT an
 * authorization decision — permissions, capability planning and intent
 * gates are unchanged and still run server-side afterwards.
 */
export function resolveToolInvocationPolicy(input: {
  backendId?: string | null
  toolNames: readonly string[]
}): ToolInvocationPolicy {
  if (input.toolNames.length === 0) {
    return { mode: 'loop', reason: 'no-tools-active', degradedNote: null }
  }
  const protocol = resolveToolProtocol(input.backendId)
  if (protocol.kind === 'none') {
    return {
      mode: 'plain-fallback',
      reason: `backend ${String(input.backendId).slice(0, 64)} declares no tool protocol`,
      degradedNote:
        'The active model lane cannot carry tool requests; this turn was answered WITHOUT tool access. Nothing was executed, and nothing is reported as executed.',
    }
  }
  return { mode: 'loop', reason: `backend ${String(input.backendId ?? '').slice(0, 64) || '(default)'} uses the text tool protocol`, degradedNote: null }
}

// ---------------------------------------------------------------------------
// Invocation-outcome classification — invocation behavior ≠ task completion.
// ---------------------------------------------------------------------------

/**
 * What the model actually DID with the offered tool universe:
 *  - 'tool-call-emitted'       — at least one REAL tool execution happened.
 *  - 'model-declined-tool-call'— tools were offered, the loop closed with
 *                                zero executions (the M45 walkthrough gap —
 *                                now measured instead of invisible).
 *  - 'no-tools-offered'        — the turn never opened a tool universe.
 */
export type InvocationOutcome = 'tool-call-emitted' | 'model-declined-tool-call' | 'no-tools-offered'

export const INVOCATION_OUTCOMES: readonly InvocationOutcome[] = [
  'tool-call-emitted',
  'model-declined-tool-call',
  'no-tools-offered',
]

export function classifyInvocationOutcome(input: {
  toolsOffered: boolean
  executionCount: number
}): InvocationOutcome {
  if (!input.toolsOffered) return 'no-tools-offered'
  return input.executionCount > 0 ? 'tool-call-emitted' : 'model-declined-tool-call'
}

/**
 * The honest degraded trail note for a declined governance universe — the
 * answer still stands on its own, but the record says the tool step never
 * happened (never folded into "success").
 */
export function declinedGovernanceNote(): string {
  return (
    'Governed-execution tools were available this turn but the model answered without invoking them; ' +
    'the reply is advice/planning content only and NO governed action was created, approved or executed.'
  )
}

// ---------------------------------------------------------------------------
// Bounded in-process invocation ledger — observability, NOT authorization.
// ---------------------------------------------------------------------------

export interface GovernanceInvocationRecord {
  outcome: InvocationOutcome
  /** Server-derived turn intent when known ('none' when the universe never opened). */
  intent: string
  backendId: string
  at: number
}

const MAX_LEDGER_ENTRIES = 512

/**
 * Process-wide ledger of recent governance-shaped tool-universe outcomes.
 * Purely observational (ops/diagnostics seam): nothing in the authorization
 * path reads it. Bounded like the M45 turn ledger — oldest entries dropped.
 */
class InvocationLedger {
  private readonly entries: GovernanceInvocationRecord[] = []
  private readonly counts = new Map<InvocationOutcome, number>()

  record(entry: GovernanceInvocationRecord): void {
    this.entries.push(entry)
    if (this.entries.length > MAX_LEDGER_ENTRIES) this.entries.shift()
    this.counts.set(entry.outcome, (this.counts.get(entry.outcome) ?? 0) + 1)
  }

  snapshot(): { recent: GovernanceInvocationRecord[]; totals: Record<InvocationOutcome, number> } {
    return {
      recent: [...this.entries],
      totals: {
        'tool-call-emitted': this.counts.get('tool-call-emitted') ?? 0,
        'model-declined-tool-call': this.counts.get('model-declined-tool-call') ?? 0,
        'no-tools-offered': this.counts.get('no-tools-offered') ?? 0,
      },
    }
  }

  /** Test seam. */
  reset(): void {
    this.entries.length = 0
    this.counts.clear()
  }
}

/** Test/ops seam: swap the process ledger (tests build isolated ones). */
export function createInvocationLedger(): InvocationLedger {
  return new InvocationLedger()
}

export const globalInvocationLedger = createInvocationLedger()
