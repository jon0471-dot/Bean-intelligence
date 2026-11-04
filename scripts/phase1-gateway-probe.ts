/**
 * PHASE 1 — Gateway 429 recovery probe (single, spaced, no fan-out).
 *
 * Measures the CURRENT state of each endpoint class of the authorized
 * upstream gateway, one real request per class, with generous spacing:
 *   - chat       : 1 non-streaming completion ("Reply with exactly: OK")
 *   - functions  : 1 web_search invocation (minimal query)
 *   - image-meta : 1 GET {baseUrl}/models (read-only metadata, no POST)
 *
 * Evidence rules:
 *  - every probe records status / latency / honest failure class;
 *  - NO retry on failure (a throttle must not be deepened);
 *  - NO video or image generation is submitted here (cost + long latency);
 *    the video/images endpoints are assessed only via the read-only metadata
 *    route and via the typed SDK surface.
 *
 * Output: JSON to stdout (also written to scripts/phase1-gateway-out/probe.json).
 */
import ZAI from 'z-ai-web-dev-sdk'
import { mkdirSync, writeFileSync } from 'node:fs'

interface ProbeRecord {
  endpointClass: string
  attempted: boolean
  ok: boolean
  status: number | null
  latencyMs: number | null
  failureKind: string | null
  evidence: string
  at: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function classify(e: unknown): { kind: string; status: number | null } {
  const message = e instanceof Error ? e.message : String(e)
  const m = /(?:\bstatus\s+(\d{3})|\bHTTP\s+(\d{3}))/.exec(message)
  const status = m ? Number(m[1] ?? m[2]) : null
  if (status === 429) return { kind: 'rate_limited', status }
  if (status === 401 || status === 403) return { kind: 'auth', status }
  if (status === 402) return { kind: 'billing', status }
  if (/\btimed out\b/i.test(message)) return { kind: 'timeout', status: null }
  if (/\bfetch failed\b|ECONNRESET|ECONNREFUSED|socket hang up|network error/i.test(message))
    return { kind: 'network', status: null }
  return { kind: 'other', status }
}

async function main(): Promise<void> {
  const records: ProbeRecord[] = []
  const zai = await ZAI.create()
  const cfg = (zai as unknown as { config?: { baseUrl?: string; apiKey?: string } }).config
  const baseUrl = cfg?.baseUrl ?? null
  // Never print the key; only its presence and length class.
  const keyPresent = typeof cfg?.apiKey === 'string' && cfg.apiKey.length > 0
  console.error(
    `[probe] gateway baseUrl=${baseUrl ?? 'MISSING'} apiKeyPresent=${keyPresent}`,
  )

  // ---- probe 1: chat -------------------------------------------------------
  {
    const t0 = Date.now()
    try {
      const res = (await zai.chat.completions.create({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        thinking: { type: 'disabled' },
      })) as { choices?: Array<{ message?: { content?: string } }> }
      const content = res.choices?.[0]?.message?.content ?? ''
      records.push({
        endpointClass: 'chat',
        attempted: true,
        ok: content.trim().length > 0,
        status: 200,
        latencyMs: Date.now() - t0,
        failureKind: content.trim().length > 0 ? null : 'empty-response',
        evidence: `completion content length=${content.length}, preview=${JSON.stringify(content.slice(0, 40))}`,
        at: new Date().toISOString(),
      })
    } catch (e) {
      const c = classify(e)
      records.push({
        endpointClass: 'chat',
        attempted: true,
        ok: false,
        status: c.status,
        latencyMs: Date.now() - t0,
        failureKind: c.kind,
        evidence: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        at: new Date().toISOString(),
      })
    }
  }

  await sleep(8000) // spacing between classes — never fan out into a throttle

  // ---- probe 2: functions (web_search) ------------------------------------
  {
    const t0 = Date.now()
    try {
      const res = await zai.functions.invoke('web_search', {
        query: 'BEAN Intelligence probe',
        num: 1,
      })
      const n = Array.isArray(res) ? res.length : -1
      records.push({
        endpointClass: 'functions',
        attempted: true,
        ok: n >= 0,
        status: 200,
        latencyMs: Date.now() - t0,
        failureKind: n >= 0 ? null : 'unexpected-shape',
        evidence: `web_search returned ${n} result(s)`,
        at: new Date().toISOString(),
      })
    } catch (e) {
      const c = classify(e)
      records.push({
        endpointClass: 'functions',
        attempted: true,
        ok: false,
        status: c.status,
        latencyMs: Date.now() - t0,
        failureKind: c.kind,
        evidence: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        at: new Date().toISOString(),
      })
    }
  }

  await sleep(8000)

  // ---- probe 3: image-metadata route (read-only GET) -----------------------
  {
    const t0 = Date.now()
    if (!baseUrl || !keyPresent) {
      records.push({
        endpointClass: 'image-meta',
        attempted: false,
        ok: false,
        status: null,
        latencyMs: null,
        failureKind: 'misconfigured',
        evidence: 'baseUrl/apiKey not resolvable from SDK config — GET not attempted',
        at: new Date().toISOString(),
      })
    } else {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 8000)
        const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${cfg!.apiKey}` },
          signal: controller.signal,
          redirect: 'manual',
        })
        clearTimeout(timer)
        await res.arrayBuffer().catch(() => undefined)
        const redirected = res.status >= 300 && res.status < 400
        records.push({
          endpointClass: 'image-meta',
          attempted: true,
          ok: res.status < 300 || res.status === 404,
          status: res.status,
          latencyMs: Date.now() - t0,
          failureKind: redirected ? 'redirected' : res.status >= 500 ? 'backend-error' : null,
          evidence: `GET /models -> HTTP ${res.status}${redirected ? ' (redirect — never followed)' : ''}`,
          at: new Date().toISOString(),
        })
      } catch (e) {
        const aborted = e instanceof Error && e.name === 'AbortError'
        records.push({
          endpointClass: 'image-meta',
          attempted: true,
          ok: false,
          status: null,
          latencyMs: Date.now() - t0,
          failureKind: aborted ? 'timeout' : 'network',
          evidence: (e instanceof Error ? e.message : String(e)).slice(0, 300),
          at: new Date().toISOString(),
        })
      }
    }
  }

  // ---- summary -------------------------------------------------------------
  const summary = {
    at: new Date().toISOString(),
    baseUrlRecorded: baseUrl !== null,
    apiKeyPresent: keyPresent,
    probes: records,
    verdict: {
      chat: records.find((r) => r.endpointClass === 'chat')?.ok === true ? 'OPERATIONAL' : 'NOT-OPERATIONAL',
      functions: records.find((r) => r.endpointClass === 'functions')?.ok === true ? 'OPERATIONAL' : 'NOT-OPERATIONAL',
      imageMeta: records.find((r) => r.endpointClass === 'image-meta')?.ok === true ? 'REACHABLE' : 'NOT-REACHABLE',
    },
  }
  mkdirSync('scripts/phase1-gateway-out', { recursive: true })
  writeFileSync('scripts/phase1-gateway-out/probe.json', JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((e) => {
  console.error('[probe] fatal:', e instanceof Error ? e.message : e)
  process.exit(1)
})
