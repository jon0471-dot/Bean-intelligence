/**
 * Edit-contract resolution probe (bounded: ≤4 read-only metadata GETs + ≤1 real edit call).
 * 1. Read the tenant gateway config (baseUrl) — local file, no network.
 * 2. GET a few conventional documentation routes (openapi.json/docs) — metadata only.
 * 3. ONE real edit attempt with `images: [<public https URL>]` (the shape used by
 *    the published GLM-Image Edit contract on third-party hosts).
 * Everything recorded verbatim; no retries, no fan-out.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import ZAI from 'z-ai-web-dev-sdk'

const OUT = 'scripts/probe-image-edit-out'
mkdirSync(OUT, { recursive: true })
const log: unknown[] = []
const rec = (x: unknown) => { log.push(x); writeFileSync(`${OUT}/contract-probe.json`, JSON.stringify(log, null, 1)) }

const zai = await ZAI.create()
const cfg = (zai as unknown as { config?: { baseUrl?: string; apiKey?: string } }).config
const baseUrl = (cfg?.baseUrl ?? '').replace(/\/+$/, '')
const apiKey = cfg?.apiKey ?? ''

// 1. Metadata routes (read-only; never logged with credentials)
for (const path of ['/openapi.json', '/docs', '/api-docs', '/v1/models']) {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    })
    const text = await res.text()
    rec({ step: 'metadata', path, status: res.status, len: text.length, preview: text.slice(0, 300) })
  } catch (e) {
    rec({ step: 'metadata', path, error: e instanceof Error ? e.message : String(e) })
  }
}

// 2. Single real edit attempt with a public URL (WaveSpeed GLM-Image-Edit example image).
const PUBLIC_IMG = 'https://interactive-examples.mdn.mozilla.net/media/cc0-images/painted-hand-298-332.jpg'
const t0 = Date.now()
try {
  const res = await zai.images.generations.edit({
    prompt: 'Replace the background with a clear starry night sky while keeping the subject unchanged',
    images: [PUBLIC_IMG],
  } as never)
  const item = res.data?.[0]?.base64
  const bytes = item ? Buffer.from(item, 'base64') : null
  const magic = !!bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8
  if (bytes && magic) writeFileSync(`${OUT}/edit-public-url.jpg`, bytes)
  rec({ step: 'edit-public-url', ok: true, latencyMs: Date.now() - t0, bytes: bytes?.length ?? 0, jpegMagic: magic })
} catch (e) {
  rec({ step: 'edit-public-url', ok: false, latencyMs: Date.now() - t0, error: (e instanceof Error ? e.message : String(e)).slice(0, 500) })
}
console.log(JSON.stringify(log, null, 1))
