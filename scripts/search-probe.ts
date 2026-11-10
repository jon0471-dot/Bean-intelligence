/**
 * Probe: does zai.functions.invoke('web_search') work while chat completions
 * are 429'd? Measures latency and result shape. Header-only, no LLM call.
 */
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const zai = await ZAI.create()
  const t0 = Date.now()
  try {
    const res = await zai.functions.invoke('web_search', {
      query: 'current prime minister of Japan 2026',
      num: 4,
    })
    console.log(JSON.stringify({ ok: true, latencyMs: Date.now() - t0, count: Array.isArray(res) ? res.length : null }, null, 2))
  } catch (e) {
    console.log(JSON.stringify({ ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }, null, 2))
  }
  const t1 = Date.now()
  try {
    const res = await zai.functions.invoke('page_reader', { url: 'https://www.wikipedia.org/wiki/Japan' })
    const html = (res as { data?: { html?: string } })?.data?.html
    console.log(JSON.stringify({ pageReader: true, latencyMs: Date.now() - t1, htmlChars: html?.length ?? 0 }, null, 2))
  } catch (e) {
    console.log(JSON.stringify({ pageReader: false, latencyMs: Date.now() - t1, error: e instanceof Error ? e.message : String(e) }, null, 2))
  }
}

void main()
