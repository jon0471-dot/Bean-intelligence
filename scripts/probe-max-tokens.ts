/**
 * Live probe: does the authorized gateway honor `max_tokens`?
 * Evidence for the RIISHE_MAX_OUTPUT_TOKENS config — one small completion
 * with max_tokens: 40 vs one without. Real gateway, two calls total.
 */
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const zai = await ZAI.create()
  const base = { messages: [{ role: 'user' as const, content: 'List the first 20 prime numbers with a one-line explanation of what a prime number is.' }], thinking: { type: 'disabled' as const } }

  const without = (await zai.chat.completions.create({ ...base })) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  }
  const c1 = without.choices?.[0]
  console.log('[without max_tokens] finish_reason=', c1?.finish_reason, 'chars=', (c1?.message?.content ?? '').length)

  const withCap = (await zai.chat.completions.create({ ...base, max_tokens: 40 })) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>
  }
  const c2 = withCap.choices?.[0]
  console.log('[max_tokens=40] finish_reason=', c2?.finish_reason, 'chars=', (c2?.message?.content ?? '').length)
  console.log('[max_tokens=40] content=', JSON.stringify((c2?.message?.content ?? '').slice(0, 120)))
}

main().catch((e) => {
  console.error('PROBE FAILED:', e instanceof Error ? e.message.slice(0, 300) : e)
  process.exit(1)
})
