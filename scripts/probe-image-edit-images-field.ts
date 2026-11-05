/**
 * Single-probe contract probe for the gateway image EDIT endpoint.
 *
 * Background (2026-11-04 GO-LIVE evidence, scripts/golive-out/evidence.jsonl):
 * the hosted edit path sent `image: <b64>` and the provider answered
 * HTTP 400 {"code":"1210","message":"...image_to_image task must provide images"}.
 * The SDK typings declare `image?: string` but the runtime server rejects it —
 * typings are out of sync with the real contract.
 *
 * This script makes AT MOST TWO spaced real calls to the edit endpoint to
 * learn the accepted field shape, recording everything verbatim. It uses the
 * real artifact produced by LAXII earlier today (a 1024x1024 JPEG). No
 * fan-out, no retries beyond the two documented attempts.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import ZAI from 'z-ai-web-dev-sdk'

const OUT = 'scripts/probe-image-edit-out'
mkdirSync(OUT, { recursive: true })
const SRC = 'scripts/golive-out/laxii/t2i-cmw2bmzbl002css9fl5ru71os.jpg'

const b64 = readFileSync(SRC).toString('base64')
const results: unknown[] = []

async function attempt(label: string, body: Record<string, unknown>) {
  const t0 = Date.now()
  try {
    const zai = await ZAI.create()
    const res = await zai.images.generations.edit(body as never)
    const item = res.data?.[0]?.base64
    const bytes = item ? Buffer.from(item, 'base64') : null
    const magic = bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8
    if (bytes && magic) writeFileSync(`${OUT}/edit-${label}.jpg`, bytes)
    const r = {
      label, ok: true, latencyMs: Date.now() - t0,
      bytes: bytes?.length ?? 0, jpegMagic: !!magic,
      artifact: magic ? `${OUT}/edit-${label}.jpg` : null,
      created: res.created ?? null,
    }
    results.push(r)
    console.log(JSON.stringify(r))
  } catch (e) {
    const r = {
      label, ok: false, latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    }
    results.push(r)
    console.log(JSON.stringify(r).slice(0, 600))
  }
  writeFileSync(`${OUT}/probe-results.json`, JSON.stringify(results, null, 1))
  // Space the calls: the shared account throttles on bursts.
  await new Promise((r) => setTimeout(r, 20_000))
}

// Attempt 1: `images` as an ARRAY of raw base64 strings (server said "must provide images").
await attempt('images-array-b64', {
  prompt: 'Replace the background with a clear starry night sky while keeping the subject unchanged',
  images: [b64],
  size: '1024x1024',
})

// Attempt 2 (only if attempt 1 failed): `images` as an array of data URLs.
const all = results as Array<{ ok: boolean }>
if (!all[0]?.ok) {
  await attempt('images-array-dataurl', {
    prompt: 'Replace the background with a clear starry night sky while keeping the subject unchanged',
    images: [`data:image/jpeg;base64,${b64}`],
    size: '1024x1024',
  })
}

const anyOk = (results as Array<{ ok: boolean }>).some((r) => r.ok)
console.log('VERDICT:', anyOk ? 'edit contract identified — see probe-results.json' : 'both documented shapes rejected — needs operator/provider docs')
process.exit(0)
