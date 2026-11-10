/**
 * Unit tests for the RIISHE server-side tool layer.
 *
 * Covers: registry invariants (no model-defined tools, duplicate rejection),
 * the permission gate (run_code requires the explicit per-request opt-in),
 * honest failure results, the real calculate tool (deterministic evaluator),
 * the real sandbox tool (actual execution — no fabricated output) and
 * read_document paging.
 */
import { describe, test, expect } from 'bun:test'
import { registerTool, getTool, executeToolCall, describeTools } from '../../src/lib/riishe/tools/registry'
import { calculateTool, runCodeTool, readDocumentTool } from '../../src/lib/riishe/tools/builtin'
import { registerBuiltins } from '../../src/lib/riishe/tools/builtin-registry'
import { z } from 'zod'
import type { ToolContext, ToolDescriptor } from '../../src/lib/riishe/tools/types'

registerBuiltins()

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    permissions: new Set(),
    documents: new Map(),
    ...over,
  }
}

describe('tool registry', () => {
  test('builtin tools are registered and catalogued', () => {
    for (const name of ['web_search', 'read_url', 'calculate', 'run_code', 'read_document']) {
      expect(getTool(name)).not.toBeNull()
    }
    const catalog = describeTools(['calculate', 'run_code'])
    expect(catalog).toContain('calculate')
    expect(catalog).toContain('run_code')
    expect(catalog).toContain('requires user approval')
  })

  test('duplicate registration is rejected (the model cannot redefine tools)', () => {
    expect(() => registerTool(calculateTool)).toThrow(/Duplicate/)
  })

  test('explicit-permission tools must declare a permissionKey', () => {
    const bad = {
      name: 'bad_tool',
      description: 'x',
      permission: 'explicit',
      timeoutMs: 100,
      validate: (i: unknown) => i,
      execute: async () => ({ ok: true, output: 'x' }),
    } as unknown as ToolDescriptor<unknown>
    expect(() => registerTool(bad)).toThrow(/permissionKey/)
  })

  test('unknown tool returns an honest error, not a fabricated result', async () => {
    const r = await executeToolCall({ tool: 'does_not_exist', input: {} }, ctx(), new Set(['calculate']))
    expect(r.ok).toBe(false)
    expect(r.output).toContain('Unknown tool')
  })

  test('registered but not-enabled tool is refused', async () => {
    const r = await executeToolCall({ tool: 'calculate', input: { expression: '1+1' } }, ctx(), new Set())
    expect(r.ok).toBe(false)
    expect(r.output).toContain('not enabled')
  })

  test('run_code is permission-gated: denied without the explicit opt-in', async () => {
    const r = await executeToolCall(
      { tool: 'run_code', input: { code: 'console.log(1)' } },
      ctx(),
      new Set(['run_code']),
    )
    expect(r.ok).toBe(false)
    expect(r.output).toContain('Permission denied')
  })

  test('malformed input is a structured error, never a throw', async () => {
    const r = await executeToolCall(
      { tool: 'calculate', input: { nonsense: true } },
      ctx(),
      new Set(['calculate']),
    )
    expect(r.ok).toBe(false)
    expect(r.output).toContain('Invalid input')
  })
})

describe('calculate tool (deterministic evaluator)', () => {
  test('evaluates real arithmetic exactly', async () => {
    const r = await executeToolCall(
      { tool: 'calculate', input: { expression: '(17*23)+sqrt(144)' } },
      ctx(),
      new Set(['calculate']),
    )
    expect(r.ok).toBe(true)
    expect(r.output).toContain('= 403')
  })

  test('rejects injection and unknown identifiers honestly', async () => {
    const r = await executeToolCall(
      { tool: 'calculate', input: { expression: 'process.env.DATABASE_URL' } },
      ctx(),
      new Set(['calculate']),
    )
    expect(r.ok).toBe(false)
    expect(r.output).not.toContain('file:')
    expect(r.output).not.toMatch(/postgres|sqlite/i)
  })
})

describe('run_code tool (REAL restricted sandbox)', () => {
  test('with the explicit opt-in, executes for real and returns actual stdout', async () => {
    const r = await executeToolCall(
      { tool: 'run_code', input: { code: 'console.log(21*2)' } },
      ctx({ permissions: new Set(['allowCodeExecution']) }),
      new Set(['run_code']),
    )
    expect(r.ok).toBe(true)
    expect(r.output).toContain('exit code: 0')
    expect(r.output).toContain('42')
  }, 30_000)

  test('nonzero exit codes and stderr are reported as they happened', async () => {
    const r = await executeToolCall(
      { tool: 'run_code', input: { code: 'console.error("boom"); process.exit(3)' } },
      ctx({ permissions: new Set(['allowCodeExecution']) }),
      new Set(['run_code']),
    )
    expect(r.ok).toBe(false)
    expect(r.output).toContain('exit code: 3')
    expect(r.output).toContain('boom')
  }, 30_000)
})

describe('read_document tool', () => {
  const long = 'A'.repeat(9000) + 'B'.repeat(3000)
  const docs = new Map([['doc1', { name: 'report.txt', text: long, truncated: false }]])

  test('pages through the actual document text with offsets', async () => {
    const first = await executeToolCall(
      { tool: 'read_document', input: { documentId: 'doc1' } },
      ctx({ documents: docs }),
      new Set(['read_document']),
    )
    expect(first.ok).toBe(true)
    expect(first.output).toContain('report.txt')
    expect(first.output).toContain('[more text remains')

    const second = await executeToolCall(
      { tool: 'read_document', input: { documentId: 'doc1', offset: 9000 } },
      ctx({ documents: docs }),
      new Set(['read_document']),
    )
    expect(second.ok).toBe(true)
    expect(second.output).toContain('B')
  })

  test('unknown document id is an honest error listing what exists', async () => {
    const r = await executeToolCall(
      { tool: 'read_document', input: { documentId: 'nope' } },
      ctx({ documents: docs }),
      new Set(['read_document']),
    )
    expect(r.ok).toBe(false)
    expect(r.output).toContain('No attached document')
  })

  test('offset past the end says so instead of inventing text', async () => {
    const r = await executeToolCall(
      { tool: 'read_document', input: { documentId: 'doc1', offset: 999_999 } },
      ctx({ documents: docs }),
      new Set(['read_document']),
    )
    expect(r.ok).toBe(true)
    expect(r.output).toContain('past the end')
  })
})

describe('per-call timeout', () => {
  test('a hung tool is killed at its timeout and reported honestly', async () => {
    const slow: ToolDescriptor<unknown> = {
      name: 'slow_tool',
      description: 'hangs',
      permission: 'standard',
      timeoutMs: 120,
      validate: (i: unknown) => i,
      execute: () => new Promise(() => {}),
    }
    registerTool(slow)
    const r = await executeToolCall({ tool: 'slow_tool', input: {} }, ctx(), new Set(['slow_tool']))
    expect(r.ok).toBe(false)
    expect(r.output).toContain('timed out')
    expect(r.durationMs).toBeLessThan(5_000)
  })
})

// keep zod import used (schema typing sanity)
void z
