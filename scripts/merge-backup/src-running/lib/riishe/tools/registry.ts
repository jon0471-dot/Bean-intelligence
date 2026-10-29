/**
 * BEAN Intelligence — RIISHE tool registry.
 *
 * A tool exists in the loop ONLY if it is registered here. Unknown tool
 * names, malformed inputs and permission violations are returned to the
 * model as structured TOOL_ERROR results (honest, bounded) instead of
 * throwing away the turn.
 *
 * Security properties:
 *  - Registry is fixed at module load; the model cannot define tools.
 *  - 'explicit' tools require the per-request permission key in the
 *    ToolContext, otherwise they refuse with a clear message.
 *  - Every execution is wrapped by the loop with a hard timeout and output
 *    cap; failures are logged server-side with a safe message only.
 */
import { logger } from '@/lib/observability/logger'
import type { ToolCallRequest, ToolContext, ToolDescriptor, ToolResult, ToolSource } from './types'

const registry = new Map<string, ToolDescriptor<never>>()

export function registerTool<I>(tool: ToolDescriptor<I>): void {
  if (registry.has(tool.name)) {
    throw new Error(`Duplicate tool registration: ${tool.name}`)
  }
  if (tool.permission === 'explicit' && !tool.permissionKey) {
    throw new Error(`Explicit-permission tool ${tool.name} must declare a permissionKey`)
  }
  registry.set(tool.name, tool as unknown as ToolDescriptor<never>)
}

export function getTool(name: string): ToolDescriptor<never> | null {
  return registry.get(name) ?? null
}

export function listToolNames(): string[] {
  return [...registry.keys()]
}

/** Prompt-facing catalog: names + descriptions for the system prompt. */
export function describeTools(names: readonly string[]): string {
  return names
    .map((n) => {
      const t = registry.get(n)
      if (!t) return null
      const gate = t.permission === 'explicit' ? ' (requires user approval)' : ''
      return `- ${t.name}${gate}: ${t.description}`
    })
    .filter((s): s is string => s !== null)
    .join('\n')
}

export interface ExecutedToolCall {
  tool: string
  ok: boolean
  output: string
  durationMs: number
  /** For retrieval tools: the real sources behind the output (with citation ids). */
  sources?: ToolSource[]
}

/**
 * Validate + execute one requested tool call against the registry.
 * Never throws: every failure mode becomes an honest ToolResult.
 */
export async function executeToolCall(
  req: ToolCallRequest,
  ctx: ToolContext,
  enabled: ReadonlySet<string>,
): Promise<ExecutedToolCall> {
  const t0 = Date.now()
  const fail = (ok: boolean, output: string): ExecutedToolCall => ({
    tool: req.tool,
    ok,
    output,
    durationMs: Date.now() - t0,
  })

  const tool = getTool(req.tool)
  if (!tool) return fail(false, `Unknown tool "${req.tool}". Available tools: ${[...enabled].join(', ') || 'none'}.`)
  if (!enabled.has(req.tool)) {
    return fail(false, `Tool "${req.tool}" is not enabled for this request. Enabled tools: ${[...enabled].join(', ') || 'none'}.`)
  }
  if (tool.permission === 'explicit' && !(ctx.permissions.has(tool.permissionKey!))) {
    return fail(
      false,
      `Permission denied: the user has not approved ${req.tool} for this request. ` +
        `Do not retry it; continue answering without it and say what you could not do.`,
    )
  }

  let input: unknown
  try {
    input = tool.validate(req.input)
  } catch (e) {
    return fail(false, `Invalid input for ${req.tool}: ${e instanceof Error ? e.message : 'validation failed'}.`)
  }

  try {
    const result = await withToolTimeout(
      (tool as unknown as ToolDescriptor<unknown>).execute(input, ctx),
      tool.timeoutMs,
      req.tool,
    )
    logger.info('riishe.tool_executed', { tool: req.tool, ok: result.ok, durationMs: Date.now() - t0 })
    return {
      tool: req.tool,
      ok: result.ok,
      output: result.output,
      durationMs: Date.now() - t0,
      ...(result.sources ? { sources: result.sources } : {}),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Server-side log keeps diagnostics; the model sees only a safe reason.
    logger.warn('riishe.tool_failed', { tool: req.tool, error: msg.slice(0, 300) })
    return fail(false, `Tool ${req.tool} failed: ${sanitizeToolError(msg)}`)
  }
}

/** Errors shown to the model must not leak secrets, paths or stack frames. */
function sanitizeToolError(msg: string): string {
  return msg
    .replace(/\/[\w./-]+/g, '<path>')
    .replace(/sk-[\w-]+/g, '<redacted>')
    .replace(/\s+at\s+[\w./<>$]+/g, '')
    .slice(0, 300)
}

async function withToolTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

export type { ToolResult, ToolContext, ToolDescriptor } from './types'
