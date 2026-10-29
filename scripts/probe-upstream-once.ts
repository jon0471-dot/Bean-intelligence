/**
 * One controlled upstream probe: single web_search call + single tiny LLM call.
 * Redacts credentials; prints status and a truncated response body.
 * Usage: bun scripts/probe-upstream-once.ts
 */
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const zai = await ZAI.create()
  const cfgMod = await import('node:fs/promises')
  const raw = await cfgMod.readFile('/etc/.z-ai-config', 'utf8').catch(() => null)
  let baseUrl = 'unknown'
  if (raw) {
    try {
      baseUrl = JSON.parse(raw).baseUrl ?? 'unknown'
    } catch {}
  }
  console.log('baseUrl:', baseUrl)

  // Probe 1: web_search (the research gateway function endpoint)
  try {
    const res = (await zai.functions.invoke('web_search', { query: 'Next.js latest stable version', num: 3 })) as unknown[]
    console.log('web_search: OK,', Array.isArray(res) ? res.length : 0, 'results')
    if (Array.isArray(res) && res[0]) {
      const first = res[0] as { url?: string; name?: string; date?: string }
      console.log('  first result:', JSON.stringify({ name: first.name?.slice(0, 60), url: first.url?.slice(0, 80), date: first.date ?? null }))
    }
  } catch (e) {
    console.log('web_search: FAIL ->', e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300))
  }

  // Probe 2: chat completions (the LLM endpoint)
  try {
    const completion = (await zai.chat.completions.create({
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      thinking: { type: 'disabled' },
    })) as { choices?: Array<{ message?: { content?: string } }> }
    const content = completion.choices?.[0]?.message?.content ?? ''
    console.log('chat.completions: OK, content =', JSON.stringify(content.slice(0, 40)))
  } catch (e) {
    console.log('chat.completions: FAIL ->', e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300))
  }
}

void main()
