/**
 * BEAN Intelligence — M46.1 + M47.1: tool-invocation reliability, honesty
 * and the provider-native tool-calling capability registry
 * (SERVER ONLY, pure — no I/O on the hot path).
 *
 * M45 wired the `execution_decision` tool into the conversational universe,
 * but the recorded production walkthrough answered two governance-shaped
 * requests advice-first WITHOUT emitting a tool call. Root cause (from the
 * M46.0 audit): every BEAN chat lane ran the RIISHE TEXT tool protocol
 * (`TOOL_CALL: {json}` lines) — so a governed tool was invoked only when the
 * model actually emitted protocol syntax. That behavior was previously
 * invisible: nothing measured "tools were available but the model never
 * called one".
 *
 * M46.1 made invocation BEHAVIOR observable and honest, without moving any
 * security decision.
 *
 * M47.1 supersedes M46's "no lane exposes native function calling" with
 * MEASUREMENT: a real probe through the authorized hosted gateway
 * (scripts/m47-native-tool-probe.ts, 2026-11-28) emitted a genuine
 * provider-native tool call (`finish_reason=tool_calls`, OpenAI-shaped
 * `tool_calls` array with preserved `call_…` identifiers), accepted a
 * `role:'tool'` result round-trip, and showed that STREAMING with tools
 * produces no usable deltas. The registry below records exactly what was
 * measured, per lane, and drives RUNTIME capability selection: a lane only
 * uses native tool calls when its record says `native`; everything else
 * keeps the proven text protocol; nothing is ever advertised beyond its
 * evidence.
 *
 * Security invariants (unchanged by any of this):
 *   - the two-key gate, server-derived intent gate, digest-bound approvals
 *     and owner-only grants all stay exactly where M44/M45 put them;
 *   - a native tool call is UNTRUSTED MODEL INPUT: it still passes the tool
 *     registry allowlist, validation, permission checks and the M44 Trust
 *     Engine before anything executes;
 *   - a lane with no usable protocol gets the existing safe fallback (plain
 *     chat, tools never offered) with an honest degraded note — never a
 *     fabricated execution, never weakened auth.
 */

// ---------------------------------------------------------------------------
// Protocol kinds.
// ---------------------------------------------------------------------------

/**
 * How a chat lane can receive tool requests:
 *  - 'text'   — the RIISHE bounded text protocol (TOOL_CALL lines parsed and
 *               executed server-side). Works over plain chat completions;
 *               invocation depends on model protocol compliance (measured,
 *               never assumed).
 *  - 'native' — provider-native function calling: the tools travel in the
 *               provider request (`tools`), the model responds with
 *               structured tool-call objects, and results return through the
 *               provider's own tool-result message shape. Selected ONLY when
 *               the capability registry records MEASURED support for the
 *               lane (and never for streaming where streaming is broken).
 *  - 'none'   — this lane cannot carry tool requests at all. The orchestrator
 *               must not open the tool loop; it answers plainly and says so.
 */
export type ToolProtocolKind = 'text' | 'native' | 'none'

export interface ToolProtocolDescriptor {
  kind: ToolProtocolKind
  /** Honest, admin-visible explanation (never a capability claim). */
  note: string
}

// ---------------------------------------------------------------------------
// M47.1 — provider-native tool-calling capability states.
// ---------------------------------------------------------------------------

/**
 * The MEASURED (or honestly unmeasured) native tool-calling state of a
 * provider/model combination. These are evidence states, not wishes:
 *  - 'native'                 — a real probe/response demonstrated native
 *                               tool calling for this lane's configured model.
 *  - 'text-protocol'          — the lane carries tools through the RIISHE
 *                               text protocol (the shipped M45/M46 behavior).
 *  - 'unsupported'            — MEASURED to not support native tool calling
 *                               (probe rejected, or responses never carry
 *                               structured calls).
 *  - 'unknown'                — no measurement exists yet. The lane never
 *                               advertises native support from this state.
 *  - 'temporarily-unavailable'- the lane measured/declared native support at
 *                               some point but is not usable right now
 *                               (dormant credential, breaker open, provider
 *                               outage) — a runtime condition, re-evaluated
 *                               per turn, never folded into 'unsupported'.
 */
export type NativeToolCallingState =
  | 'native'
  | 'text-protocol'
  | 'unsupported'
  | 'unknown'
  | 'temporarily-unavailable'

export const NATIVE_TOOL_CALLING_STATES: readonly NativeToolCallingState[] = [
  'native',
  'text-protocol',
  'unsupported',
  'unknown',
  'temporarily-unavailable',
]

/**
 * Full tool-calling descriptor for one backend lane (optionally narrowed to
 * a specific provider-side model). Every field is evidence-backed:
 *  - `null` means "not measured" — never conflated with false.
 *  - `multiCallPerResponse` unmeasured is SAFE: the executor always handles
 *    any number of calls (bounded), so an unmeasured capability can never
 *    break the loop.
 *  - `streamingToolCalls=false` is a HARD runtime constraint: the native
 *    path must not be opened on a streaming pass when this is false.
 */
export interface ToolCallingDescriptor extends ToolProtocolDescriptor {
  /** What the runtime USES for this lane (the resolved protocol). */
  kind: ToolProtocolKind
  /** What the provider/model genuinely supports (evidence state). */
  nativeState: NativeToolCallingState
  /** Provider request carries the tool list (openai `tools` / anthropic `tools`). */
  requestCarriesTools: boolean
  /** How calls appear in responses (null = unmeasured/not applicable). */
  responseCallShape: 'openai-tool_calls' | 'anthropic-tool_use' | null
  /** Tool-result message shape required by the provider (null = unmeasured). */
  toolResultShape: 'openai-role-tool' | 'anthropic-tool_result' | null
  /** Identifier handling measured on this lane (null = unmeasured). */
  toolCallIdStyle: 'openai-call-id' | null
  /** Multiple tool calls in ONE response measured? (null = unmeasured; safe either way). */
  multiCallPerResponse: boolean | null
  /** Streaming with tools measured usable? (null = unmeasured; false = measured broken). */
  streamingToolCalls: boolean | null
  /** Argument encoding as the provider returns it ('json-string' = OpenAI style). */
  argumentEncoding: 'json-string' | null
  /** When the underlying measurement was taken (ISO date, null = unmeasured). */
  measuredAt: string | null
  /** The concrete evidence artifact (probe script / recorded run). */
  evidence: string | null
}

/**
 * The M47.1 registry, keyed by the REAL backend ids from
 * `src/lib/registry/backends.ts`.
 *
 * Facts, not policy — every non-null field below traces to a measurement or
 * to the provider's documented wire contract PLUS an explicit honesty note
 * that the per-model check is pending. Dormant lanes (no configured
 * credential in this deployment) are `unknown`, never `native`: an
 * unconfigured lane cannot be measured, and the registry is authoritative
 * for runtime selection.
 *
 * Per-model narrowing: `MODEL_NATIVE_OVERRIDES` may pin a different state
 * for a specific provider-side model (`<backendId>::<providerModel>`).
 * Backend-level records apply where no override exists. The hosted lane's
 * model identity is provider-managed (checkpoint not disclosed), so its
 * measurement is recorded at lane level with the measurement date — a
 * provider-side checkpoint change is exactly what `measuredAt` makes
 * auditable, and the committed probe script re-verifies on demand.
 */
const TOOL_CALLING_BY_BACKEND: Record<string, ToolCallingDescriptor> = {
  'bean-llm-hosted-primary': {
    kind: 'native',
    note: 'Authorized hosted gateway. MEASURED 2026-11-28: native tool calls emitted in non-streaming completions (structured tool_calls with preserved call_ ids, schema-shaped arguments); role:tool result round-trip accepted; STREAMING with tools produced no usable deltas — native tool turns MUST be buffered.',
    nativeState: 'native',
    requestCarriesTools: true,
    responseCallShape: 'openai-tool_calls',
    toolResultShape: 'openai-role-tool',
    toolCallIdStyle: 'openai-call-id',
    multiCallPerResponse: null,
    streamingToolCalls: false,
    argumentEncoding: 'json-string',
    measuredAt: '2026-11-28',
    evidence: 'scripts/m47-native-tool-probe.ts (4 live gateway calls: emit / control / round-trip / stream)',
  },
  'bean-llm-openai-compatible': {
    kind: 'text',
    note: 'OpenAI-compatible adapter: the wire protocol defines a native tools parameter, but no provider is configured in this deployment, so no per-model measurement exists. The lane runs the proven text protocol; native is never advertised from an unmeasured state.',
    nativeState: 'unknown',
    requestCarriesTools: true,
    responseCallShape: null,
    toolResultShape: null,
    toolCallIdStyle: null,
    multiCallPerResponse: null,
    streamingToolCalls: null,
    argumentEncoding: null,
    measuredAt: null,
    evidence: null,
  },
  'bean-llm-anthropic': {
    kind: 'text',
    note: 'Anthropic Messages slot: the API defines native tool use (tools/input_schema, tool_use blocks, tool_result), but no provider is configured in this deployment and no per-model measurement exists. The lane runs the text protocol; native stays unadvertised until measured.',
    nativeState: 'unknown',
    requestCarriesTools: true,
    responseCallShape: null,
    toolResultShape: null,
    toolCallIdStyle: null,
    multiCallPerResponse: null,
    streamingToolCalls: null,
    argumentEncoding: null,
    measuredAt: null,
    evidence: null,
  },
  'bean-chat-local-llamacpp': {
    kind: 'text',
    note: 'Local llama.cpp lane via plain chat completions; RIISHE text tool protocol. Tool-calling behavior of llama-server varies by build and the loaded GGUF — with no measurement, the text protocol stays and native is never claimed. Small-model protocol compliance is expected to be weaker — measured per turn, never assumed.',
    nativeState: 'unknown',
    requestCarriesTools: true,
    responseCallShape: null,
    toolResultShape: null,
    toolCallIdStyle: null,
    multiCallPerResponse: null,
    streamingToolCalls: null,
    argumentEncoding: null,
    measuredAt: null,
    evidence: null,
  },
}

/** Per-model overrides keyed `<backendId>::<providerModel>`. Empty until a
 *  per-model measurement exists; backend records apply otherwise. */
const MODEL_NATIVE_OVERRIDES: Record<string, NativeToolCallingState> = {}

/** Resolve a lane's full tool-calling descriptor. Unknown backend ids get an
 *  honestly-unmeasured record with the default text protocol (a future lane
 *  is never silently broken by a stale table — capability claims stay with
 *  the registry). */
export function resolveToolCallingDescriptor(
  backendId: string | null | undefined,
  providerModel?: string | null,
): ToolCallingDescriptor {
  const key = (backendId ?? '').trim()
  const base: ToolCallingDescriptor = TOOL_CALLING_BY_BACKEND[key] ?? {
    kind: 'text',
    note: `Backend "${key.slice(0, 64) || '(unavailable)'}" has no tool-calling record; the default text protocol applies and native support is unmeasured.`,
    nativeState: 'unknown',
    requestCarriesTools: false,
    responseCallShape: null,
    toolResultShape: null,
    toolCallIdStyle: null,
    multiCallPerResponse: null,
    streamingToolCalls: null,
    argumentEncoding: null,
    measuredAt: null,
    evidence: null,
  }
  const modelKey = providerModel ? `${key}::${providerModel.trim()}` : null
  const override = modelKey ? MODEL_NATIVE_OVERRIDES[modelKey] : undefined
  if (!override || override === base.nativeState) return base
  // A per-model override narrows the descriptor honestly: the evidence fields
  // stay the lane's; the state change is explicit and the note says so.
  return {
    ...base,
    nativeState: override,
    note: `${base.note} Per-model override for "${providerModel!.slice(0, 64)}": ${override}.`,
  }
}

/** Back-compat: the M46 protocol resolver, now derived from the full registry. */
export function resolveToolProtocol(backendId: string | null | undefined): ToolProtocolDescriptor {
  const d = resolveToolCallingDescriptor(backendId)
  return { kind: d.kind, note: d.note }
}

/**
 * Operator-facing diagnostics: tool-calling availability per configured
 * chat lane (no secrets, no provider internals beyond the disclosed
 * registry facts). Consumed by the admin models overview; values are pure
 * projections of this registry — never computed at request time.
 */
export function toolCallingDiagnostics(): Array<{
  backendId: string
  protocol: ToolProtocolKind
  nativeState: NativeToolCallingState
  streamingToolCalls: boolean | null
  multiCallPerResponse: boolean | null
  measuredAt: string | null
  evidence: string | null
  note: string
}> {
  return Object.entries(TOOL_CALLING_BY_BACKEND).map(([backendId, d]) => ({
    backendId,
    protocol: d.kind,
    nativeState: d.nativeState,
    streamingToolCalls: d.streamingToolCalls,
    multiCallPerResponse: d.multiCallPerResponse,
    measuredAt: d.measuredAt,
    evidence: d.evidence,
    note: d.note,
  }))
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
  /** The resolved protocol for this turn (M47.1: 'native' | 'text' | 'none'). */
  protocol: ToolProtocolKind
  /** The lane's evidence-backed native state (M47.1 diagnostics/observability). */
  nativeState: NativeToolCallingState
  /** HARD constraint from measurement: native calls must never be attempted
   *  on a streaming pass when false (null = unmeasured). Text protocol is
   *  unaffected. */
  streamingToolCalls: boolean | null
}

/**
 * Decide whether this turn may run the bounded tool loop at all, and under
 * which protocol. This is a CAPABILITY check (can this lane carry tool
 * requests, and how?), NOT an authorization decision — permissions,
 * capability planning and intent gates are unchanged and still run
 * server-side afterwards.
 *
 * M47.1 selection rules (registry-authoritative):
 *  - native lane + tools active        → loop under the NATIVE protocol;
 *  - native lane measured broken for streaming → the constraint rides the
 *    policy (`streamingToolCalls=false`); the caller must use the buffered
 *    pass for tool rounds (text lanes ignore this field);
 *  - text lane                         → loop under the text protocol (the
 *    shipped M45/M46 behavior, unchanged);
 *  - lane with no protocol             → plain-fallback (tools never offered).
 */
export function resolveToolInvocationPolicy(input: {
  backendId?: string | null
  toolNames: readonly string[]
  providerModel?: string | null
}): ToolInvocationPolicy {
  const descriptor = resolveToolCallingDescriptor(input.backendId, input.providerModel)
  const laneLabel = String(input.backendId ?? '').slice(0, 64) || '(default)'
  if (input.toolNames.length === 0) {
    return { mode: 'loop', reason: 'no-tools-active', degradedNote: null, protocol: descriptor.kind, nativeState: descriptor.nativeState, streamingToolCalls: descriptor.streamingToolCalls }
  }
  if (descriptor.kind === 'none') {
    return {
      mode: 'plain-fallback',
      reason: `backend ${laneLabel} declares no tool protocol`,
      degradedNote:
        'The active model lane cannot carry tool requests; this turn was answered WITHOUT tool access. Nothing was executed, and nothing is reported as executed.',
      protocol: 'none',
      nativeState: descriptor.nativeState,
      streamingToolCalls: descriptor.streamingToolCalls,
    }
  }
  if (descriptor.kind === 'native') {
    return {
      mode: 'loop',
      reason: `backend ${laneLabel} uses provider-native tool calling (measured ${descriptor.measuredAt ?? 'unmeasured'})`,
      degradedNote: null,
      protocol: 'native',
      nativeState: descriptor.nativeState,
      streamingToolCalls: descriptor.streamingToolCalls,
    }
  }
  return {
    mode: 'loop',
    reason: `backend ${laneLabel} uses the text tool protocol`,
    degradedNote: null,
    protocol: 'text',
    nativeState: descriptor.nativeState,
    streamingToolCalls: descriptor.streamingToolCalls,
  }
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
  // ---- M47.3 per-turn observability fields (additive; all server-derived,
  // ---- no secrets, no user message content — identities and counts only).
  /** Fresh per-turn id (the orchestrator's randomTurnId). */
  turnId?: string
  /** Conversation scope id (server-derived binding context). */
  conversationId?: string
  /** Authenticated principal (id only — never a token or email). */
  userId?: string
  /** The protocol the registry selected for this turn ('text' | 'native' | 'none'). */
  protocol?: ToolProtocolKind
  /** The lane's evidence-backed native capability state at turn time. */
  nativeState?: NativeToolCallingState
  /** The protocol the loop ACTUALLY ran under (may differ from the selected
   *  one only when no tools were active — plain turns never open a loop). */
  protocolUsed?: 'text' | 'native' | 'none'
  /** How many tools the turn's universe offered (registry state). */
  toolsOfferedCount?: number
  /** Native tool calls the model emitted in structured form. */
  nativeCallsEmitted?: number
  /** Emitted calls that passed pre-execution validation. */
  nativeCallsValidated?: number
  /** Emitted calls refused BEFORE execution (allowlist/arguments/identity). */
  nativeCallsRefused?: number
  /** Governed decision operations the turn actually executed (e.g.
   *  'create_decision', 'request_approval' — authorization-relevant observability). */
  decisionOps?: string[]
  /** Every executed tool call (tool + ok) in order. */
  executions?: Array<{ tool: string; ok: boolean }>
  /** Honest end state of the TURN's tool involvement. */
  finalState?: 'completed' | 'plain-fallback' | 'no-tools-active'
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
