/**
 * BEAN Intelligence — RIISHE server-side tool contract.
 *
 * Tools are executed by the BACKEND only. The model can REQUEST a tool, but
 * it can never fabricate a result: the orchestrator validates the request,
 * executes the registered implementation with a timeout, and feeds the ACTUAL
 * result back into the reasoning loop.
 *
 * Permission model:
 *  - 'standard' tools are available whenever the tool loop is active.
 *  - 'explicit' tools additionally require a per-request opt-in from the
 *    user (e.g. allowCodeExecution) — the same consent principle CODE GIFTZ
 *    applies to its sandbox. Without the opt-in the tool returns an honest
 *    permission-denied result; it is never silently substituted.
 */

export type ToolPermission = 'standard' | 'explicit'

export interface ToolContext {
  /** Per-request user opt-ins (explicit-permission tools check these). */
  permissions: ReadonlySet<string>
  /** Documents attached to THIS request (id -> extracted text), already
   *  ownership-validated by the route before the orchestrator runs. */
  documents: ReadonlyMap<string, { name: string; text: string; truncated: boolean }>
  /** Evidence-pack sources already numbered in the prompt (tool outputs
   *  continue numbering from here so citations stay unambiguous). */
  sourceIdOffset?: number
}

export interface ToolSource {
  url: string
  title: string
  hostName: string
  date: string | null
  /** Citation id for this source (continues the evidence numbering). */
  id?: number
  /** True when the full page was read (not just a snippet). */
  pageRead?: boolean
}

export interface ToolResult {
  ok: boolean
  /** Result payload for the model (already customer-safe: no secrets, no
   *  stack traces, no internal paths). */
  output: string
  /** For retrieval tools: the REAL sources behind the output, so the
   *  orchestrator can admit them into the citation universe. */
  sources?: ToolSource[]
}

export interface ToolDescriptor<I> {
  name: string
  description: string
  permission: ToolPermission
  /** Which context permission key gates this tool when permission='explicit'. */
  permissionKey?: string
  /** Zod-style validation is done by the tool itself via this guard. */
  validate(input: unknown): I
  /** Real execution. Implementations must be bounded in time and output. */
  execute(input: I, ctx: ToolContext): Promise<ToolResult>
  /** Per-call timeout (ms). The loop enforces it. */
  timeoutMs: number
}

/** Shape the model is asked to emit: TOOL_CALL: {"tool": name, "input": {...}} */
export interface ToolCallRequest {
  tool: string
  input: unknown
}

export function formatToolResult(name: string, result: ToolResult): string {
  const head = result.ok ? 'TOOL_RESULT' : 'TOOL_ERROR'
  const body = result.output.length > 12_000 ? `${result.output.slice(0, 12_000)}\n[output truncated]` : result.output
  return `${head} (${name}):\n${body}`
}
