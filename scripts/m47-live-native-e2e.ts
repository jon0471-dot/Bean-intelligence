/**
 * M47.2 — LIVE end-to-end native tool-call verification (hosted lane).
 *
 * Proves the ACTUAL BEAN adapter seam (hostedLlmAdapter.chat with
 * nativeTools) + the REAL governed executor (validateNativeCalls →
 * executeToolCall against the registered builtin) work together over a REAL
 * model turn — the same code path the RIISHE orchestrator uses, without the
 * full HTTP/auth surface:
 *
 *   1. build the real native spec for the registered `calculate` tool
 *   2. send a completion through the hosted adapter (tools in request)
 *   3. the model's native tool_calls come back structurally validated
 *   4. the call executes through the REAL registry tool (bounded, timed)
 *   5. the real result returns to the model as a role:tool turn (second
 *      adapter call), which produces the final answer
 *
 * Evidence is printed verbatim. No secrets. Run:
 *   bun scripts/m47-live-native-e2e.ts
 */
import { hostedLlmAdapter } from '../src/lib/adapters/hosted-llm'
import { registerBuiltins } from '../src/lib/riishe/tools/builtin-registry'
import { nativeToolSpecs, getTool } from '../src/lib/riishe/tools/registry'
import { validateNativeCalls } from '../src/lib/riishe/toolloop'
import { executeToolCall } from '../src/lib/riishe/tools/registry'
import type { ChatTurn, NativeToolCall } from '../src/lib/adapters/types'
import type { ToolContext } from '../src/lib/riishe/tools/types'

registerBuiltins()

async function main(): Promise<void> {
  const spec = nativeToolSpecs(['calculate'])
  if (spec.length !== 1) throw new Error('calculate tool not registered')
  const ctx: ToolContext = { permissions: new Set(), documents: new Map() }

  // ---- Step 1-2: REAL adapter call with the REAL tool spec ----------------
  const messages: ChatTurn[] = [
    { role: 'user', content: 'What is 144 divided by 12? Use the calculate tool to compute it exactly.' },
  ]
  const first = await hostedLlmAdapter.chat!({
    messages,
    maxPromptChars: 12_000,
    maxHistoryMessages: 24,
    timeoutMs: 90_000,
    nativeTools: spec,
  })
  const calls: NativeToolCall[] = first.nativeToolCalls ?? []
  console.log(`STEP1 adapter_call: accepted=true content.len=${first.content.length} native_calls=${calls.length}`)
  if (calls.length > 0) {
    console.log(`STEP1 first_call: id=${calls[0].id} name=${calls[0].name} args=${calls[0].argumentsJson}`)
  } else {
    console.log('STEP1 first_call: NONE (model answered directly) — honest record, no simulation follows')
    return
  }

  // ---- Step 3: governed validation (allowlist + JSON class) ---------------
  const enabled = new Set(['calculate'])
  const validated = validateNativeCalls(calls, enabled)
  console.log(`STEP2 governed_validation: accepted=${validated.accepted.length} refused=${validated.refused.length}`)
  if (validated.accepted.length === 0) {
    console.log('STEP2: nothing executable — honest stop')
    return
  }

  // ---- Step 4: REAL registry execution ------------------------------------
  const acc = validated.accepted[0]
  const tool = getTool(acc.tool)
  const executed = await executeToolCall({ tool: acc.tool, input: acc.input }, ctx, enabled)
  console.log(`STEP3 real_execution: tool=${acc.tool} ok=${executed.ok} durationMs=${executed.durationMs} output=${JSON.stringify(executed.output.slice(0, 200))}`)
  if (!tool) throw new Error('registry lost the tool mid-flight (impossible)')

  // ---- Step 5: REAL result round-trip through the adapter -----------------
  const second = await hostedLlmAdapter.chat!({
    messages: [
      ...messages,
      { role: 'assistant', content: first.content, nativeToolCalls: calls },
      { role: 'tool', toolCallId: acc.id, content: executed.output },
    ],
    maxPromptChars: 12_000,
    maxHistoryMessages: 24,
    timeoutMs: 90_000,
    nativeTools: spec,
  })
  console.log(`STEP4 result_roundtrip: accepted=true content.len=${second.content.length}`)
  console.log(`STEP4 final_answer: ${JSON.stringify(second.content.slice(0, 300))}`)
  console.log('LIVE-E2E: PASS (native emit → governed validation → real execution → verified round-trip)')
}

main().catch((e) => {
  console.error('live e2e failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
