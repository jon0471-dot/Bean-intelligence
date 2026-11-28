/**
 * M47 Phase 0/1 — LIVE provider-native tool-calling probe (hosted lane).
 *
 * Sends a REAL chat completion through the authorized gateway SDK
 * (z-ai-web-dev-sdk) with an OpenAI-style `tools` parameter and reports —
 * verbatim, without invention — what the gateway actually returns:
 *   - request accepted or rejected (HTTP-ish error surface),
 *   - whether the response message carries a native `tool_calls` array,
 *   - whether the model emitted the expected call (read-only echo probe
 *     tool: get_probe_time — the obvious, safe choice for a capability probe).
 *
 * This is the measurement M47.1's registry honesty stands on: the SDK's
 * typed body carries an index signature ([key: string]: any) so the tools
 * key PASSES THROUGH the adapter, but pass-through is not support. Only the
 * observed response decides the capability state (native / text-protocol /
 * unknown / unsupported).
 *
 * Server-only. No secrets printed (the SDK manages its own credentials).
 * Run: bun scripts/m47-native-tool-probe.ts
 */
import ZAI from 'z-ai-web-dev-sdk'

const PROBE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_probe_time',
      description: 'Returns the current server probe time. Use this to answer questions about the current time.',
      parameters: {
        type: 'object',
        properties: {
          unit: { type: 'string', enum: ['iso'], description: 'Time format; only iso is supported.' },
        },
        required: [],
      },
    },
  },
]

function describe(msg: unknown): string {
  const m = (msg ?? {}) as Record<string, unknown>
  const keys = Object.keys(m)
  const toolCalls = m.tool_calls
  const lines: string[] = [`message.keys=[${keys.join(',')}]`]
  const content = typeof m.content === 'string' ? m.content : ''
  lines.push(`content.len=${content.length} content.head=${JSON.stringify(content.slice(0, 120))}`)
  if (toolCalls !== undefined) {
    lines.push(`tool_calls=${JSON.stringify(toolCalls).slice(0, 600)}`)
  } else {
    lines.push('tool_calls=ABSENT')
  }
  return lines.join(' ')
}

async function main(): Promise<void> {
  const zai = await ZAI.create()
  const userPrompt =
    'What time is it right now? Use the get_probe_time tool to answer.'

  // ---- Probe 1: non-streaming with tools ----
  try {
    const completion = (await zai.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a capability probe. When a tool is available that can answer the question, call it.' },
        { role: 'user', content: userPrompt },
      ],
      tools: PROBE_TOOLS,
      tool_choice: 'auto',
      thinking: { type: 'disabled' },
    })) as Record<string, unknown>

    const choices = (completion.choices ?? []) as Array<Record<string, unknown>>
    const choice = choices[0] ?? {}
    console.log('PROBE1(nonstream+tools): accepted=true')
    console.log('PROBE1 finish_reason=' + String(choice.finish_reason ?? 'absent'))
    console.log('PROBE1 ' + describe(choice.message))
    console.log('PROBE1 response.top_keys=[' + Object.keys(completion).join(',') + ']')
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    console.log('PROBE1(nonstream+tools): accepted=false error=' + msg.slice(0, 300).replace(/\s+/g, ' '))
  }

  // ---- Probe 2: non-streaming WITHOUT tools (control — protocol honesty) ----
  try {
    const completion = (await zai.chat.completions.create({
      messages: [{ role: 'user', content: userPrompt }],
      thinking: { type: 'disabled' },
    })) as Record<string, unknown>
    const choices = (completion.choices ?? []) as Array<Record<string, unknown>>
    const content = String((choices[0]?.message as Record<string, unknown> | undefined)?.content ?? '')
    const emittedProtocol = /TOOL_CALL\s*:/.test(content)
    console.log(`PROBE2(control, no tools param): finish=${String(choices[0]?.finish_reason ?? 'absent')} content.len=${content.length} text_protocol_emit=${emittedProtocol}`)
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    console.log('PROBE2(control): error=' + msg.slice(0, 200).replace(/\s+/g, ' '))
  }
  // ---- Probe 3: tool RESULT round-trip (multi-turn continuation) ----
  try {
    const first = (await zai.chat.completions.create({
      messages: [{ role: 'user', content: userPrompt }],
      tools: PROBE_TOOLS,
      tool_choice: 'auto',
      thinking: { type: 'disabled' },
    })) as Record<string, unknown>
    const choice0 = ((first.choices ?? []) as Array<Record<string, unknown>>)[0] ?? {}
    const msg0 = (choice0.message ?? {}) as Record<string, unknown>
    const calls0 = (msg0.tool_calls ?? []) as Array<Record<string, unknown>>
    if (!Array.isArray(calls0) || calls0.length === 0) {
      console.log('PROBE3(roundtrip): first call did not emit tool_calls; round-trip untested this run')
    } else {
      const call = calls0[0] as { id?: string; function?: { name?: string; arguments?: string } }
      const toolMsg = {
        role: 'tool',
        tool_call_id: call.id ?? '',
        content: JSON.stringify({ iso: new Date().toISOString() }),
      }
      // The SDK's typed ChatMessage union predates native tool calling (its
      // body carries an index signature; message items are stricter). The
      // wire contract MEASURED in probes 1-3 accepts these shapes; the casts
      // exist only to satisfy the stale local types — the gateway does the
      // real validation.
      const assistantWithCalls = {
        role: 'assistant',
        content: String(msg0.content ?? ''),
        tool_calls: calls0,
      } as unknown as { role: 'assistant'; content: string }
      const second = (await zai.chat.completions.create({
        messages: [
          { role: 'user', content: userPrompt },
          assistantWithCalls,
          toolMsg,
        ] as unknown as [{ role: 'user'; content: string }, { role: 'assistant'; content: string }, { role: 'user'; content: string }],
        tools: PROBE_TOOLS,
        tool_choice: 'auto',
        thinking: { type: 'disabled' },
      })) as Record<string, unknown>
      const choice1 = ((second.choices ?? []) as Array<Record<string, unknown>>)[0] ?? {}
      const msg1 = (choice1.message ?? {}) as Record<string, unknown>
      const again = (msg1.tool_calls ?? undefined) !== undefined
      console.log(`PROBE3(roundtrip): accepted=true finish=${String(choice1.finish_reason ?? 'absent')} tool_result_accepted=true followup_tool_calls=${again ? 'yes' : 'no'}`)
      console.log('PROBE3 ' + describe(msg1))
    }
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    console.log('PROBE3(roundtrip): accepted=false error=' + msg.slice(0, 300).replace(/\s+/g, ' '))
  }

  // ---- Probe 4: streaming with tools (delta shape honesty) ----
  try {
    const stream = (await zai.chat.completions.create({
      messages: [{ role: 'user', content: userPrompt }],
      tools: PROBE_TOOLS,
      tool_choice: 'auto',
      stream: true,
      thinking: { type: 'disabled' },
    })) as AsyncIterable<unknown>
    let sawToolDelta = false
    let sawTextDelta = false
    let finish = 'absent'
    let sample = ''
    for await (const ev of stream) {
      const e = ev as Record<string, unknown>
      const ch = ((e.choices ?? []) as Array<Record<string, unknown>>)[0] ?? {}
      const delta = (ch.delta ?? {}) as Record<string, unknown>
      if (delta.tool_calls !== undefined) {
        sawToolDelta = true
        if (!sample) sample = JSON.stringify(delta.tool_calls).slice(0, 400)
      }
      if (typeof delta.content === 'string' && delta.content.length > 0) sawTextDelta = true
      if (ch.finish_reason) finish = String(ch.finish_reason)
    }
    console.log(`PROBE4(stream+tools): accepted=true finish=${finish} tool_deltas=${sawToolDelta} text_deltas=${sawTextDelta}`)
    if (sawToolDelta) console.log('PROBE4 first_tool_delta=' + sample)
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    console.log('PROBE4(stream+tools): accepted=false error=' + msg.slice(0, 300).replace(/\s+/g, ' '))
  }
}

main().catch((e) => {
  console.error('probe failed:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
