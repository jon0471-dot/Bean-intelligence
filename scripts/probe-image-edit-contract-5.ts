/**
 * Highest-value remaining edit-contract hypothesis:
 * `images` (string) = a URL previously ISSUED BY THE GATEWAY's own CDN.
 *
 * Method: replicate the SDK's exact T2I POST manually to capture the raw
 * `data[0].url` (the SDK normally converts it to base64 and discards it),
 * then call /images/generations/edit with `images: <that url>` (string —
 * arrays are rejected by a typeof-string validator, measured).
 * Bounded: 1 real generation + 1 edit attempt. Everything recorded verbatim.
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import ZAI from 'z-ai-web-dev-sdk'

const OUT = 'scripts/probe-image-edit-out'
mkdirSync(OUT, { recursive: true })
const log: unknown[] = []
const rec = (x: unknown) => { log.push(x); writeFileSync(`${OUT}/contract-probe4.json`, JSON.stringify(log, null, 1)) }

const zai = await ZAI.create()
const cfg = (zai as unknown as { config?: { baseUrl?: string; apiKey?: string; chatId?: string; userId?: string; token?: string } }).config
const baseUrl = (cfg?.baseUrl ?? '').replace(/\/+$/, '')
const apiKey = cfg?.apiKey ?? ''
if (!baseUrl || !apiKey) { console.error('no gateway config'); process.exit(1) }

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${apiKey}`,
  'X-Z-AI-From': 'Z',
}
if (cfg?.chatId) headers['X-Chat-Id'] = cfg.chatId
if (cfg?.userId) headers['X-User-Id'] = cfg.userId
if (cfg?.token) headers['X-Token'] = cfg.token

// Step 1: real T2I, capturing the RAW response (url field).
let genUrl: string | null = null
try {
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: 'A single red apple on a plain white table, studio light', size: '1024x1024' }),
    signal: AbortSignal.timeout(180_000),
  })
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* keep raw */ }
  genUrl = body?.data?.[0]?.url ?? null
  const b64 = body?.data?.[0]?.base64 ?? null
  if (b64) writeFileSync(`${OUT}/contract-t2i-raw-b64.jpg`, Buffer.from(b64, 'base64'))
  rec({
    step: 't2i-raw', status: res.status, hasUrl: !!genUrl, urlHost: genUrl ? new URL(genUrl).host : null,
    hasB64: !!b64, bodyKeys: body ? Object.keys(body) : null, rawPreview: text.slice(0, 200),
  })
} catch (e) {
  rec({ step: 't2i-raw', error: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
}

if (!genUrl) {
  rec({ step: 'verdict', result: 'T2I produced no URL — gateway returns base64 only; URL-based edit hypothesis untestable this way' })
  console.log(JSON.stringify(log, null, 1))
  process.exit(0)
}

// Step 2: edit with the gateway-issued URL as `images` string.
await new Promise((r) => setTimeout(r, 10_000))
try {
  const res = await fetch(`${baseUrl}/images/generations/edit`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: 'Replace the background with a clear starry night sky while keeping the apple unchanged',
      images: genUrl,
    }),
    signal: AbortSignal.timeout(180_000),
  })
  const text = await res.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* keep raw */ }
  const b64 = body?.data?.[0]?.base64 ?? null
  const outUrl = body?.data?.[0]?.url ?? null
  let magic = false
  if (b64) {
    const bytes = Buffer.from(b64, 'base64')
    magic = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8
    if (magic) writeFileSync(`${OUT}/edit-gateway-url.jpg`, bytes)
  } else if (outUrl) {
    const dl = await fetch(outUrl, { signal: AbortSignal.timeout(60_000) })
    const bytes = Buffer.from(await dl.arrayBuffer())
    magic = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8
    if (magic) writeFileSync(`${OUT}/edit-gateway-url.jpg`, bytes)
    rec({ step: 'edit-download', status: dl.status, bytes: bytes.length })
  }
  rec({ step: 'edit-gateway-url', status: res.status, ok: magic, bytes: b64 ? Buffer.from(b64, 'base64').length : null, rawPreview: text.slice(0, 300) })
} catch (e) {
  rec({ step: 'edit-gateway-url', error: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
}
console.log(JSON.stringify(log, null, 1))
