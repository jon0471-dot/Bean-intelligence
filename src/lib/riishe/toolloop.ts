/**
 * BEAN Intelligence — RIISHE bounded tool loop (text + native protocols).
 *
 * TWO tool protocols share ONE executor and ONE loop (M47.2 — no second
 * executor, no second agent framework):
 *
 * 1. TEXT (the M45/M46 default): the model ends a pass with lines of
 *      TOOL_CALL: {"tool": "<name>", "input": {...}}
 *    parsed server-side and executed against the registry.
 *
 * 2. NATIVE (M47.2, lanes whose tool-calling registry record says 'native'):
 *    the tools travel in the provider request (`tools`), the model responds
 *    with structured tool-call objects, and results return as role:'tool'
 *    turns bound to the provider's call ids. Measured live on the hosted
 *    lane (scripts/m47-native-tool-probe.ts, 2026-11-28): native calls emit
 *    in NON-STREAMING completions, ids are preserved, role:tool results are
 *    accepted, and STREAMING with tools produces no usable deltas — so the
 *    native loop ALWAYS runs on buffered (non-streaming) passes. The caller
 *    enforces this via the registry's streamingToolCalls=false constraint.
 *
 * The backend — never the model — executes every call (either protocol)
 * against the registry and feeds the ACTUAL results back. The loop repeats
 * at most MAX_TOOL_ROUNDS times; the first pass without a tool call is the
 * answer. Everything the model "knows" about tool outcomes comes from real
 * executions, and every execution is timed, validated, permission-checked
 * and logged. A native tool call is UNTRUSTED INPUT: registry allowlist +
 * argument validation + permission checks run exactly as for text calls —
 * the channel changed, the governance did not.
 *
 * Streaming: when the loop is active the caller BUFFERS passes and emits
 * the final content as one delta (the same pattern the injection gate uses),
 * so tool-call syntax and gated text never reach the wire. Turns without
 * tools stream directly as before.
 */
import type { ChatTurn, NativeToolCall } from '@/lib/adapters/types'
import { executeToolCall, type ExecutedToolCall } from './tools/registry'
import { formatToolResult } from './tools/types'
import type { ToolContext } from './tools/types'

export const MAX_TOOL_ROUNDS = 3
/** Upper bound on tool calls accepted from ONE pass (text or native). */
const MAX_CALLS_PER_PASS = 5

const TOOL_CALL_RE = /^\s*TOOL_CALL:\s*(\{[\s\S]*?\})\s*$/gm

/** Remove any TOOL_CALL syntax from visible content (defense in depth). */
export function stripToolCallSyntax(output: string): string {
  return output
    .replace(/^\s*TOOL_CALL:[\s\S]*?(?:\n\s*\n|$)/gm, (m) => (m.includes('}') ? '' : m))
    .replace(/^\s*TOOL_CALL:.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

export interface ParsedToolCall {
  tool: string
  input: unknown
  raw: string
}

/** Extract TOOL_CALL requests from a model pass. Malformed lines are ignored. */
export function parseToolCalls(output: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = []
  let match: RegExpExecArray | null
  TOOL_CALL_RE.lastIndex = 0
  while ((match = TOOL_CALL_RE.exec(output)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as { tool?: unknown; input?: unknown }
      if (typeof parsed.tool === 'string' && parsed.tool.length <= 64) {
        calls.push({ tool: parsed.tool, input: parsed.input ?? {}, raw: match[0] })
      }
    } catch {
      // a broken JSON blob is not a tool call; the pass is treated as final
    }
  }
  return calls.slice(0, MAX_CALLS_PER_PASS)
}

// ---------------------------------------------------------------------------
// M47.2 — native tool-call handling.
// ---------------------------------------------------------------------------

/** The result of ONE native solve pass (content + structured tool calls). */
export interface NativeSolvePassResult {
  content: string
  nativeToolCalls?: NativeToolCall[]
}

export type ToolLoopProtocol = 'text' | 'native'

/** How a native call's arguments parsed (honest classification, observability). */
export type NativeArgumentClass = 'valid-json' | 'malformed-json' | 'missing'

export interface ValidatedNativeCall {
  /** The provider call id (preserved for the role:tool result binding). */
  id: string
  tool: string
  input: unknown
  argumentClass: NativeArgumentClass
}

/**
 * Validate native tool calls against the ENABLED registry allowlist BEFORE
 * execution (defense in depth — executeToolCall re-checks). Structural
 * problems become honest classified records, never silent drops: every call
 * id the provider emitted gets a result turn, or the provider conversation
 * cannot continue.
 */
export function validateNativeCalls(
  calls: readonly NativeToolCall[],
  enabled: ReadonlySet<string>,
): { accepted: ValidatedNativeCall[]; refused: Array<{ id: string; tool: string; reason: string }> } {
  const accepted: ValidatedNativeCall[] = []
  const refused: Array<{ id: string; tool: string; reason: string }> = []
  for (const c of calls.slice(0, MAX_CALLS_PER_PASS)) {
    const id = typeof c.id === 'string' ? c.id.slice(0, 128) : ''
    const name = typeof c.name === 'string' ? c.name.slice(0, 64) : ''
    if (!id || !name) {
      refused.push({ id: id || '(none)', tool: name || '(none)', reason: 'missing-call-identity' })
      continue
    }
    if (!enabled.has(name)) {
      refused.push({ id, tool: name, reason: 'tool-not-enabled' })
      continue
    }
    let input: unknown = {}
    let argumentClass: NativeArgumentClass = 'missing'
    const raw = typeof c.argumentsJson === 'string' ? c.argumentsJson : ''
    if (raw.length > 0) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          input = parsed
          argumentClass = 'valid-json'
        } else {
          argumentClass = 'malformed-json'
        }
      } catch {
        argumentClass = 'malformed-json'
      }
    }
    if (argumentClass === 'malformed-json') {
      refused.push({ id, tool: name, reason: 'malformed-arguments' })
      continue
    }
    accepted.push({ id, tool: name, input, argumentClass })
  }
  return { accepted, refused }
}

export interface ToolRoundResult {
  /** Final model answer (tool-call syntax stripped). */
  content: string
  /** Every tool call actually executed, for the verification summary. */
  executions: ExecutedToolCall[]
  /** Honest degradation notes (round cap, denied permissions, refusals). */
  degraded: string[]
  rounds: number
  /** M47.2 — the protocol this loop actually ran under. */
  protocol: ToolLoopProtocol
  /** M47.2 — native calls refused BEFORE execution, with honest reasons. */
  nativeRefusals: Array<{ id: string; tool: string; reason: string }>
  /** M47.3 — governed decision operations that actually executed, in order
   *  (authorization-relevant observability; extracted from the call INPUTS
   *  the loop itself dispatched — never from model text). */
  decisionOps: string[]
  /** M47.3 — structured native calls the model emitted (before validation). */
  nativeCallsEmitted: number
}

/**
 * Run the solve pass + bounded tool rounds under the given protocol.
 *  - `solve` (text protocol) receives the current message list and returns
 *    the model's next pass as text.
 *  - `solveNative` (native protocol) returns the pass WITH structured tool
 *    calls. REQUIRED when protocol='native' (a native loop without a native
 *    solver is a caller bug and fails loudly — silently switching protocols
 *    would misreport what actually happened).
 */
export async function runToolLoop(opts: {
  baseMessages: ChatTurn[]
  toolNames: readonly string[]
  toolCtx: ToolContext
  solve: (messages: ChatTurn[]) => Promise<string>
  solveNative?: (messages: ChatTurn[]) => Promise<NativeSolvePassResult>
  protocol?: ToolLoopProtocol
  onToolEvent?: (e: { name: string; status: 'started' | 'done' | 'failed' }) => void
}): Promise<ToolRoundResult> {
  const { baseMessages, toolNames, toolCtx, solve, onToolEvent } = opts
  const protocol: ToolLoopProtocol = opts.protocol ?? 'text'
  if (protocol === 'native' && !opts.solveNative) {
    throw new Error('native tool loop requested without a native solver')
  }
  const enabled = new Set(toolNames)
  const executions: ExecutedToolCall[] = []
  const nativeRefusals: ToolRoundResult['nativeRefusals'] = []
  const decisionOps: string[] = []
  let nativeCallsEmitted = 0
  const degraded: string[] = []
  const messages: ChatTurn[] = [...baseMessages]

  for (let round = 0; ; round++) {
    // ---- ONE solve pass under the active protocol -------------------------
    let passContent = ''
    let calls: ParsedToolCall[] = []
    let nativeAssistantCalls: NativeToolCall[] = []

    if (protocol === 'native') {
      const pass = await opts.solveNative!(messages)
      passContent = pass.content ?? ''
      nativeCallsEmitted += (pass.nativeToolCalls ?? []).length
      const validated = validateNativeCalls(pass.nativeToolCalls ?? [], enabled)
      nativeRefusals.push(...validated.refused)
      // Every refused call still gets an honest role:tool result so the
      // provider conversation stays well-formed (and the model learns WHY).
      for (const r of validated.refused) {
        const reasonText =
          r.reason === 'tool-not-enabled'
            ? `Refused: "${r.tool}" is not an enabled tool this turn. Enabled tools: ${[...enabled].join(', ') || 'none'}.`
            : r.reason === 'malformed-arguments'
              ? `Refused: the arguments for "${r.tool}" were not a valid JSON object. Nothing was executed.`
              : `Refused: the tool call lacked a usable identity (id/name). Nothing was executed.`
        messages.push({ role: 'tool', toolCallId: r.id, content: `TOOL_ERROR (${r.tool}): ${reasonText}` })
      }
      if (validated.refused.length > 0) {
        degraded.push(
          `${validated.refused.length} model tool call(s) refused before execution (${[...new Set(validated.refused.map((r) => r.reason))].join(', ')})`,
        )
      }
      calls = validated.accepted.map((a) => ({ tool: a.tool, input: a.input, raw: a.id }))
      nativeAssistantCalls = (pass.nativeToolCalls ?? []).slice(0, MAX_CALLS_PER_PASS)
    } else {
      const output = await solve(messages)
      calls = parseToolCalls(output)
      passContent = output
    }

    // Loop exit: no (valid) tool requests, or the round cap was hit.
    const hasPending = protocol === 'native' ? calls.length > 0 : calls.length > 0
    if (!hasPending || round >= MAX_TOOL_ROUNDS) {
      if (hasPending) {
        degraded.push(`tool loop stopped at its ${MAX_TOOL_ROUNDS}-round cap; further tool requests were not executed`)
        // Native: pending-but-unexecuted calls must still be answered (the
        // provider may require result turns) — but this is the FINAL pass, so
        // the conversation ends here; the cap note is the honest record.
      }
      return {
        content: stripToolCallSyntax(passContent),
        executions,
        degraded,
        rounds: round + 1,
        protocol,
        nativeRefusals,
        decisionOps,
        nativeCallsEmitted,
      }
    }

    // ---- Execute EVERY accepted call through the governed registry --------
    const results: Array<{ id: string | null; text: string; ok: boolean }> = []
    for (const call of calls) {
      // M47.3 — the operation discriminator of the governed decision tool is
      // observability-relevant (advice vs approval-creation vs execution);
      // it comes from the VALIDATED input the loop dispatched, not from text.
      if (call.tool === 'execution_decision') {
        const op = (call.input as { operation?: unknown } | null)?.operation
        if (typeof op === 'string' && op.length <= 40) decisionOps.push(op)
      }
      onToolEvent?.({ name: call.tool, status: 'started' })
      const executed = await executeToolCall(call, toolCtx, enabled)
      executions.push(executed)
      const text = formatToolResult(call.tool, { ok: executed.ok, output: executed.output })
      results.push({ id: protocol === 'native' ? call.raw : null, text, ok: executed.ok })
      onToolEvent?.({ name: call.tool, status: executed.ok ? 'done' : 'failed' })
    }

    // ---- Feed the REAL results back in the protocol's required shape ------
    if (protocol === 'native') {
      // Assistant turn replayed WITH its tool_calls (the provider binds
      // results to ids), then one role:tool turn per call id.
      messages.push({
        role: 'assistant',
        content: passContent.trim(),
        ...(nativeAssistantCalls.length > 0 ? { nativeToolCalls: nativeAssistantCalls } : {}),
      })
      for (const r of results) {
        messages.push({
          role: 'tool',
          toolCallId: r.id ?? '',
          content: r.text.length > 12_000 ? `${r.text.slice(0, 12_000)}\n[output truncated]` : r.text,
        })
      }
      messages.push({
        role: 'user',
        content:
          'Continue. The tool results above are the only real execution output — do not invent others. If you have everything you need, answer the user now; request further tools only if truly required.',
      })
    } else {
      // Text protocol: retain the assistant turn WITHOUT its tool-request
      // syntax, results as a user turn (the M45/M46 wire shape, unchanged).
      const assistantTurn = passContent.replace(/^\s*TOOL_CALL:.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim()
      messages.push({ role: 'assistant', content: assistantTurn || '(requested tools)' })
      messages.push({
        role: 'user',
        content:
          'TOOL_RESULTS (real execution output from BEAN; these are the only real results — do not invent others):\n\n' +
          results.map((r) => r.text).join('\n\n') +
          '\n\nContinue. If you have everything you need, answer the user now; request further tools only if truly required.',
      })
    }

    if (round === MAX_TOOL_ROUNDS - 1) {
      messages.push({
        role: 'user',
        content: 'No further tool calls will be executed. Answer NOW from what you already have, stating any gaps.',
      })
    }
  }
}
