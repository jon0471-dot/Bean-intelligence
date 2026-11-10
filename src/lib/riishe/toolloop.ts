/**
 * BEAN Intelligence — RIISHE bounded tool loop.
 *
 * The gateway adapter exposes plain chat completions (no native function
 * calling), so tool use runs over an explicit text protocol:
 *
 *   the model may end a pass with one or more lines of
 *     TOOL_CALL: {"tool": "<name>", "input": {...}}
 *
 * The backend — never the model — executes those calls against the registry
 * and feeds the ACTUAL results back as a TOOL_RESULTS turn. The loop repeats
 * at most MAX_TOOL_ROUNDS times; the first pass that ends without a tool
 * call is the answer. Everything the model "knows" about tool outcomes thus
 * comes from real executions, and every execution is timed, validated,
 * permission-checked and logged.
 *
 * Streaming: when the loop is active the caller BUFFERS passes and emits the
 * final content as one delta (the same pattern the injection gate uses), so
 * TOOL_CALL syntax and gated text never reach the wire. Turns without tools
 * stream directly as before.
 */
import type { ChatTurn } from '@/lib/adapters/types'
import { executeToolCall, type ExecutedToolCall } from './tools/registry'
import { formatToolResult } from './tools/types'
import type { ToolContext } from './tools/types'

export const MAX_TOOL_ROUNDS = 3

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
  return calls.slice(0, 5)
}

export interface ToolRoundResult {
  /** Final model answer (tool-call syntax stripped). */
  content: string
  /** Every tool call actually executed, for the verification summary. */
  executions: ExecutedToolCall[]
  /** Honest degradation notes (round cap, denied permissions). */
  degraded: string[]
  rounds: number
}

/**
 * Run the solve pass + bounded tool rounds. `solve` receives the current
 * message list and returns the model's next pass (the caller owns streaming
 * and buffering decisions).
 */
export async function runToolLoop(opts: {
  baseMessages: ChatTurn[]
  toolNames: readonly string[]
  toolCtx: ToolContext
  solve: (messages: ChatTurn[]) => Promise<string>
  onToolEvent?: (e: { name: string; status: 'started' | 'done' | 'failed' }) => void
}): Promise<ToolRoundResult> {
  const { baseMessages, toolNames, toolCtx, solve, onToolEvent } = opts
  const enabled = new Set(toolNames)
  const executions: ExecutedToolCall[] = []
  const degraded: string[] = []
  const messages: ChatTurn[] = [...baseMessages]

  for (let round = 0; ; round++) {
    const output = await solve(messages)
    const calls = parseToolCalls(output)

    // Loop exit: no (parseable) tool requests, or the round cap was hit.
    if (calls.length === 0 || round >= MAX_TOOL_ROUNDS) {
      if (calls.length > 0) {
        degraded.push(`tool loop stopped at its ${MAX_TOOL_ROUNDS}-round cap; further tool requests were not executed`)
      }
      return { content: stripToolCallSyntax(output), executions, degraded, rounds: round + 1 }
    }

    // Retain the assistant turn WITHOUT its tool-request syntax.
    const assistantTurn = output.replace(/^\s*TOOL_CALL:.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim()

    const results: string[] = []
    for (const call of calls) {
      onToolEvent?.({ name: call.tool, status: 'started' })
      const executed = await executeToolCall(call, toolCtx, enabled)
      executions.push(executed)
      results.push(formatToolResult(call.tool, { ok: executed.ok, output: executed.output }))
      onToolEvent?.({ name: call.tool, status: executed.ok ? 'done' : 'failed' })
    }

    messages.push({ role: 'assistant', content: assistantTurn || '(requested tools)' })
    messages.push({
      role: 'user',
      content:
        'TOOL_RESULTS (real execution output from BEAN; these are the only real results — do not invent others):\n\n' +
        results.join('\n\n') +
        '\n\nContinue. If you have everything you need, answer the user now; request further tools only if truly required.',
    })

    if (round === MAX_TOOL_ROUNDS - 1) {
      messages.push({
        role: 'user',
        content: 'No further tool calls will be executed. Answer NOW from what you already have, stating any gaps.',
      })
    }
  }
}
