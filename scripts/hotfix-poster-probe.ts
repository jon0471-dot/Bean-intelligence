/**
 * HOTFIX (LAXII poster BACKEND_FAILURE) — raw provider probe.
 *
 * Reproduces the EXACT request the SDK builds (headers + body contract
 * read from node_modules/z-ai-web-dev-sdk/dist/index.js:237-293) WITHOUT the
 * SDK, so the provider's full response (status + headers + body) is captured
 * instead of being discarded by the SDK's unguarded `result.data.map(...)`.
 * Secrets never printed; response bodies redacted defensively.
 */
import { readFileSync } from 'fs'

const cfg = JSON.parse(readFileSync('/etc/.z-ai-config', 'utf8'))
const BASE = cfg.baseUrl.replace(/\/+$/, '')

const POSTER_PROMPT =
  "Create a premium technology advertisement poster for a brand called BEAN INTELLIGENCE. Display the exact headline 'INTELLIGENCE WITHOUT LIMITS' and the exact subtitle 'FOUR PRODUCTS. ONE INTELLIGENCE.' Use a sophisticated black and champagne-gold visual identity, realistic metallic typography, elegant futuristic composition, cinematic lighting, clean hierarchy, professional advertising design. All text must be spelled exactly as supplied. No additional words, no gibberish, no watermark."
const CONTROL_PROMPT = 'A single red apple on a wooden table, soft window light, photorealistic'

function redact(obj: unknown, depth = 0): unknown {
  if (depth > 4) return '…'
  if (typeof obj === 'string') {
    // Show strings but cap length and scrub anything that smells like a key.
    if (/^(sk-|Bearer\s)/i.test(obj) || obj.length > 220) return `<string len=${obj.length}>`
    return obj
  }
  if (Array.isArray(obj)) return obj.slice(0, 4).map((x) => redact(x, depth + 1))
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = /token|key|secret|authorization/i.test(k) ? '<redacted>' : redact(v, depth + 1)
    }
    return out
  }
  return obj
}

async function probe(name: string, prompt: string, size: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
    'X-Z-AI-From': 'Z',
  }
  if (cfg.chatId) headers['X-Chat-Id'] = cfg.chatId
  if (cfg.userId) headers['X-User-Id'] = cfg.userId
  if (cfg.token) headers['X-Token'] = cfg.token

  const t0 = Date.now()
  const res = await fetch(`${BASE}/images/generations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, size }),
  })
  const latency = Date.now() - t0
  const hdrs: Record<string, string> = {}
  res.headers.forEach((v, k) => {
    if (/ratelimit|retry|content-type|request-id|x-/i.test(k)) hdrs[k] = /token|key/i.test(k) ? '<redacted>' : v
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    /* keep raw text (capped by redact) */
  }
  console.log(`\n===== ${name} =====`)
  console.log(JSON.stringify({ status: res.status, latencyMs: latency, headers: hdrs, body: redact(body) }, null, 1))
  // If it IS a real image response, summarize rather than dump
  if (res.ok && body && typeof body === 'object') {
    const b = body as { data?: Array<Record<string, unknown>> }
    if (Array.isArray(b.data)) {
      console.log(
        `DATA-ARRAY present: ${b.data.length} item(s); item keys: ` +
          b.data.map((it) => Object.keys(it).join('+')).join(' | '),
      )
    } else {
      console.log('!! 2xx WITHOUT a data array — this is the SDK-crash shape (result.data.map on undefined)')
    }
  }
}

const which = process.argv[2] ?? 'both'
if (which === 'control' || which === 'both') await probe('CONTROL (simple prompt)', CONTROL_PROMPT, '1024x1024')
if (which === 'poster' || which === 'both') await probe('POSTER (exact brief prompt)', POSTER_PROMPT, '1024x1024')
