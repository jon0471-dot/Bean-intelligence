/**
 * Probe which gateway capability is throttled: web_search vs chat completions.
 * Read-only diagnostics for the research-quality E2E.
 */
import ZAI from 'z-ai-web-dev-sdk'

const zai = await ZAI.create()

// 1. web_search probe
try {
  const t0 = Date.now()
  const results = await zai.functions.invoke('web_search', { query: 'Gingee girl missing', num: 4 })
  console.log(`web_search: OK (${results.length} results in ${Date.now() - t0}ms)`)
  for (const r of results.slice(0, 4)) {
    console.log(`   - ${r.name?.slice(0, 70)} | ${r.url?.slice(0, 80)} | date=${r.date ?? '(none)'}`)
  }
} catch (e) {
  console.log('web_search: FAIL ->', e instanceof Error ? e.message.slice(0, 120) : e)
}

// 2. chat completion probe (tiny)
try {
  const t0 = Date.now()
  const c = await zai.chat.completions.create({
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    thinking: { type: 'disabled' },
  })
  console.log(`chat completion: OK in ${Date.now() - t0}ms -> "${c.choices?.[0]?.message?.content?.slice(0, 20)}"`)
} catch (e) {
  console.log('chat completion: FAIL ->', e instanceof Error ? e.message.slice(0, 120) : e)
}
