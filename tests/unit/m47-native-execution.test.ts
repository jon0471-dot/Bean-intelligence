/**
 * M47.2 tests — native provider tool-calling execution protocol.
 *
 * Classification: LOCAL-INTEGRATION — the REAL tool loop, REAL registry
 * validators and REAL builtin tools (calculate) over recorded in-process
 * solve stubs. No network, no model call. The hosted adapter's wire parsing
 * is additionally covered with a mocked SDK module (MOCKED classification —
 * the live emit was measured separately by scripts/m47-native-tool-probe.ts
 * and is recorded in the M47 acceptance matrix, never simulated here).
 *
 * What this pins:
 *  - native tool calls flow through the SAME governed executor as text
 *    calls: allowlist → validate → permission check → execute → real result;
 *  - tool-call ids are PRESERVED end-to-end (assistant replay + role:tool
 *    result binding);
 *  - unknown tool names / malformed arguments are REFUSED BEFORE execution
 *    with honest classifications, and every refused id still gets a result
 *    turn (the provider conversation stays well-formed);
 *  - the native loop never needs a text TOOL_CALL line (and vice versa the
 *    text loop is byte-identical to its M45/M46 behavior);
 *  - native mode without a native solver is a caller bug that fails loudly;
 *  - multi-call passes execute every accepted call (bounded);
 *  - nativeToolSpecs exposes registry tools with explicit or minimal object
 *    schemas (model guidance only — validate() stays the binding check).
 */
import { describe, test, expect } from 'bun:test'
import {
  runToolLoop,
  validateNativeCalls,
  MAX_TOOL_ROUNDS,
  type NativeSolvePassResult,
} from '../../src/lib/riishe/toolloop'
import { nativeToolSpecs, listToolNames } from '../../src/lib/riishe/tools/registry'
import { registerBuiltins } from '../../src/lib/riishe/tools/builtin-registry'
import type { NativeToolCall } from '../../src/lib/adapters/types'
import type { ToolContext } from '../../src/lib/riishe/tools/types'

registerBuiltins()

const ctx: ToolContext = { permissions: new Set(), documents: new Map() }
const enabled = ['calculate'] as const

function call(id: string, name: string, args: unknown): NativeToolCall {
  return { id, name, argumentsJson: typeof args === 'string' ? args : JSON.stringify(args) }
}

describe('M47.2 validateNativeCalls (pre-execution refusal classes)', () => {
  test('a well-formed call for an enabled tool is accepted with parsed arguments', () => {
    const v = validateNativeCalls([call('call_1', 'calculate', { expression: '2+2' })], new Set(enabled))
    expect(v.refused).toHaveLength(0)
    expect(v.accepted).toHaveLength(1)
    expect(v.accepted[0]).toMatchObject({ id: 'call_1', tool: 'calculate', argumentClass: 'valid-json' })
    expect(v.accepted[0].input).toEqual({ expression: '2+2' })
  })

  test('unknown tool names are refused BEFORE execution (allowlist enforcement)', () => {
    const v = validateNativeCalls([call('call_2', 'delete_everything', {})], new Set(enabled))
    expect(v.accepted).toHaveLength(0)
    expect(v.refused).toEqual([{ id: 'call_2', tool: 'delete_everything', reason: 'tool-not-enabled' }])
  })

  test('malformed JSON arguments are refused with the honest class (never executed on a guess)', () => {
    const v = validateNativeCalls([call('call_3', 'calculate', 'not-json{')], new Set(enabled))
    expect(v.accepted).toHaveLength(0)
    expect(v.refused[0].reason).toBe('malformed-arguments')
  })

  test('non-object JSON arguments (array/number/string) are refused as malformed', () => {
    for (const bad of ['[1,2]', '42', '"hello"', 'null']) {
      const v = validateNativeCalls([call('call_x', 'calculate', bad)], new Set(enabled))
      expect(v.accepted).toHaveLength(0)
      expect(v.refused[0].reason).toBe('malformed-arguments')
    }
  })

  test('missing arguments default to an empty object (missing class, accepted)', () => {
    const v = validateNativeCalls([call('call_4', 'calculate', '')], new Set(enabled))
    expect(v.accepted).toHaveLength(1)
    expect(v.accepted[0].argumentClass).toBe('missing')
    expect(v.accepted[0].input).toEqual({})
  })

  test('calls without usable identity are refused (no execution on a guess)', () => {
    const v = validateNativeCalls(
      [
        { id: '', name: 'calculate', argumentsJson: '{}' },
        { id: 'call_5', name: '', argumentsJson: '{}' },
      ],
      new Set(enabled),
    )
    expect(v.accepted).toHaveLength(0)
    expect(v.refused.every((r) => r.reason === 'missing-call-identity')).toBe(true)
  })

  test('more than five calls in one pass are bounded', () => {
    const many = Array.from({ length: 9 }, (_, i) => call(`call_${i}`, 'calculate', { expression: '1' }))
    const v = validateNativeCalls(many, new Set(enabled))
    expect(v.accepted.length + v.refused.length).toBeLessThanOrEqual(5)
  })
})

describe('M47.2 native tool loop (real governed execution)', () => {
  test('a native call executes through the registry and the result returns as a role:tool turn with the PRESERVED id', async () => {
    const solveCalls: number[][] = []
    const passes: NativeSolvePassResult[] = [
      {
        content: 'I will compute that.',
        nativeToolCalls: [call('call_abc', 'calculate', { expression: '6*7' })],
      },
      { content: 'The result is 42.' },
    ]
    let passIndex = 0
    const loop = await runToolLoop({
      baseMessages: [{ role: 'user', content: 'What is 6*7?' }],
      toolNames: [...enabled],
      toolCtx: ctx,
      solve: () => {
        throw new Error('text solver must not be used in native mode')
      },
      solveNative: async (messages) => {
        solveCalls.push(messages.map((m) => m.role))
        return passes[passIndex++]
      },
      protocol: 'native',
    })
    expect(loop.protocol).toBe('native')
    expect(loop.executions).toHaveLength(1)
    expect(loop.executions[0]).toMatchObject({ tool: 'calculate', ok: true })
    expect(loop.executions[0].output).toContain('42')
    expect(loop.content).toBe('The result is 42.')
    // The second native pass received: user + assistant(with calls) + tool(result) + user(continue)
    expect(solveCalls[1]).toEqual(['user', 'assistant', 'tool', 'user'])
    // The id binding is exact — no invented ids anywhere.
    expect(loop.nativeRefusals).toHaveLength(0)
  })

  test('every refused native call id still receives an honest role:tool result turn', async () => {
    const passes: NativeSolvePassResult[] = [
      {
        content: '',
        nativeToolCalls: [
          call('call_bad', 'not_a_real_tool', {}),
          call('call_ugly', 'calculate', '{broken'),
        ],
      },
      { content: 'Understood — neither call could run.' },
    ]
    let passIndex = 0
    const loop = await runToolLoop({
      baseMessages: [{ role: 'user', content: 'do things' }],
      toolNames: [...enabled],
      toolCtx: ctx,
      solve: () => '',
      solveNative: async () => passes[passIndex++],
      protocol: 'native',
    })
    expect(loop.executions).toHaveLength(0) // NOTHING executed
    expect(loop.nativeRefusals.map((r) => r.reason).sort()).toEqual(['malformed-arguments', 'tool-not-enabled'])
    expect(loop.degraded.some((d) => d.includes('refused before execution'))).toBe(true)
  })

  test('multi-call passes execute every accepted call and return one result per id', async () => {
    const passes: NativeSolvePassResult[] = [
      {
        content: '',
        nativeToolCalls: [
          call('call_m1', 'calculate', { expression: '1+1' }),
          call('call_m2', 'calculate', { expression: '2+2' }),
        ],
      },
      { content: 'Both computed.' },
    ]
    let passIndex = 0
    const loop = await runToolLoop({
      baseMessages: [{ role: 'user', content: 'compute two things' }],
      toolNames: [...enabled],
      toolCtx: ctx,
      solve: () => '',
      solveNative: async () => passes[passIndex++],
      protocol: 'native',
    })
    expect(loop.executions).toHaveLength(2)
    expect(loop.executions.every((e) => e.ok)).toBe(true)
  })

  test('native mode without a native solver fails loudly (never silently switches protocol)', async () => {
    await expect(
      runToolLoop({
        baseMessages: [{ role: 'user', content: 'x' }],
        toolNames: [...enabled],
        toolCtx: ctx,
        solve: () => 'text answer',
        protocol: 'native',
      }),
    ).rejects.toThrow(/native solver/)
  })

  test('the native loop honors the round cap', async () => {
    let passes = 0
    const loop = await runToolLoop({
      baseMessages: [{ role: 'user', content: 'loop forever' }],
      toolNames: [...enabled],
      toolCtx: ctx,
      solve: () => '',
      solveNative: async () => {
        passes += 1
        return { content: '', nativeToolCalls: [call(`call_r${passes}`, 'calculate', { expression: '1' })] }
      },
      protocol: 'native',
    })
    expect(passes).toBe(MAX_TOOL_ROUNDS + 1)
    expect(loop.degraded.some((d) => d.includes('round cap'))).toBe(true)
  })

  test('the TEXT protocol path is byte-identical to its M45/M46 behavior', async () => {
    const roleSequences: string[][] = []
    let passIndex = 0
    const passes = ['Working.\nTOOL_CALL: {"tool":"calculate","input":{"expression":"3*3"}}', 'The result is 9.']
    const loop = await runToolLoop({
      baseMessages: [{ role: 'user', content: 'q' }],
      toolNames: [...enabled],
      toolCtx: ctx,
      solve: async (messages) => {
        roleSequences.push(messages.map((m) => m.role))
        return passes[passIndex++]
      },
      protocol: 'text',
    })
    expect(loop.protocol).toBe('text')
    expect(loop.executions[0].output).toContain('9')
    // The continuation turn is the M45/M46 TOOL_RESULTS user turn (not role:tool).
    expect(roleSequences[1]).toEqual(['user', 'assistant', 'user'])
    expect(loop.content).toBe('The result is 9.')
  })
})

describe('M47.2 nativeToolSpecs (model guidance, validation stays server-side)', () => {
  test('every registered tool gets a spec; explicit schemas pass through, others get the minimal object schema', () => {
    const names = listToolNames().slice(0, 6)
    const specs = nativeToolSpecs(names)
    expect(specs).toHaveLength(names.length)
    for (const s of specs) {
      expect(s.name.length).toBeGreaterThan(0)
      expect(s.parameters.type).toBe('object')
    }
    // The governed decision tool is registered and spec-able.
    const gov = nativeToolSpecs(['execution_decision'])
    expect(gov).toHaveLength(1)
    expect(gov[0].name).toBe('execution_decision')
    expect(String(gov[0].description).length).toBeGreaterThan(20)
  })

  test('unknown names produce no spec (the registry is the only source)', () => {
    expect(nativeToolSpecs(['ghost_tool'])).toHaveLength(0)
  })
})

describe('M47.2 hosted adapter wire parsing (MOCKED transport — live emit recorded separately)', () => {
  test('chat() passes tools through and maps tool_calls to validated NativeToolCall shapes', async () => {
    const capturedBodies: Array<Record<string, unknown>> = []
    mockSdkPerCall((body) => {
      capturedBodies.push(body as Record<string, unknown>)
      return {
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'call_wire1', type: 'function', function: { name: 'calculate', arguments: '{"expression":"9/3"}' } },
                { id: '', function: { name: 'no_identity', arguments: '{}' } }, // dropped honestly
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }
    })
    const { hostedLlmAdapter } = await import('../../src/lib/adapters/hosted-llm')
    const result = await hostedLlmAdapter.chat!({
      messages: [{ role: 'user', content: 'compute 9/3' }],
      maxPromptChars: 12_000,
      maxHistoryMessages: 24,
      timeoutMs: 30_000,
      nativeTools: [{ name: 'calculate', description: 'calc', parameters: { type: 'object', properties: {} } }],
    })
    // tools + tool_choice traveled in the request body — in the MEASURED
    // provider wire envelope (the gateway rejects bare {name,description,
    // parameters} entries with "tools[0].type:type cannot be empty")
    expect(Array.isArray(capturedBodies[0]?.tools)).toBe(true)
    expect(capturedBodies[0]?.tool_choice).toBe('auto')
    const wireTools = capturedBodies[0]?.tools as Array<Record<string, unknown>>
    expect(wireTools[0]).toMatchObject({ type: 'function', function: { name: 'calculate' } })
    // the wire call was parsed; the identity-less call was dropped, not executed
    expect(result.nativeToolCalls).toEqual([
      { id: 'call_wire1', name: 'calculate', argumentsJson: '{"expression":"9/3"}' },
    ])
    // a tool-call pass with empty content is NOT an empty-completion error
    expect(result.content).toBe('')
  })

  test('chat() without nativeTools sends no tools key (text lane behavior unchanged)', async () => {
    const capturedBodies: Array<Record<string, unknown>> = []
    mockSdkPerCall((body) => {
      capturedBodies.push(body as Record<string, unknown>)
      return { choices: [{ message: { content: 'plain answer' }, finish_reason: 'stop' }] }
    })
    const { hostedLlmAdapter } = await import('../../src/lib/adapters/hosted-llm')
    const result = await hostedLlmAdapter.chat!({
      messages: [{ role: 'user', content: 'hi' }],
      maxPromptChars: 12_000,
      maxHistoryMessages: 24,
      timeoutMs: 30_000,
    })
    expect(capturedBodies[0]?.tools).toBeUndefined()
    expect(result.content).toBe('plain answer')
    expect(result.nativeToolCalls).toBeUndefined()
  })

  test('role:tool and assistant-with-calls turns convert to the measured wire shapes', async () => {
    const capturedBodies: Array<Record<string, unknown>> = []
    mockSdkPerCall((body) => {
      capturedBodies.push(body as Record<string, unknown>)
      return { choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }
    })
    const { hostedLlmAdapter } = await import('../../src/lib/adapters/hosted-llm')
    await hostedLlmAdapter.chat!({
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'working', nativeToolCalls: [{ id: 'call_w', name: 'calculate', argumentsJson: '{}' }] },
        { role: 'tool', toolCallId: 'call_w', content: 'TOOL_RESULT (calculate): 4' },
        { role: 'user', content: 'continue' },
      ],
      maxPromptChars: 12_000,
      maxHistoryMessages: 24,
      timeoutMs: 30_000,
    })
    const wire = capturedBodies[0]?.messages as Array<Record<string, unknown>>
    expect(wire[1]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call_w', type: 'function' }] })
    expect(wire[2]).toMatchObject({ role: 'tool', tool_call_id: 'call_w' })
  })
})

// ---------------------------------------------------------------------------
// SDK mock seam — swaps z-ai-web-dev-sdk for the duration of one test and
// restores afterwards (bun:test mock.module is process-global; restore by
// re-mocking with the real module record).
// ---------------------------------------------------------------------------
import { mock } from 'bun:test'

let currentFactory: ((body: unknown) => unknown) | null = null

function mockSdkPerCall(factory: (body: unknown) => unknown): void {
  currentFactory = factory
  mock.module('z-ai-web-dev-sdk', () => {
    const Z = class {
      static async create() {
        return new Z()
      }
      chat = {
        completions: {
          create: async (body: unknown) => currentFactory!(body),
        },
      }
    }
    return { default: Z }
  })
}
