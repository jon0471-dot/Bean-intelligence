/**
 * Decisive edit-shape probes (≤2 real calls; 400s are free rejections).
 * Signal so far: `images` must be a STRING (array → "must provide images";
 * string URL → past that check, generic 1210). Remaining candidates:
 *   A. images: "<raw base64>"
 *   B. images: "data:image/jpeg;base64,<b64>"
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import ZAI from 'z-ai-web-dev-sdk'

const OUT = 'scripts/probe-image-edit-out'
mkdirSync(OUT, { recursive: true })
const log: unknown[] = []
const rec = (x: unknown) => { log.push(x); writeFileSync(`${OUT}/contract-probe3.json`, JSON.stringify(log, null, 1)) }

const zai = await ZAI.create()
const SRC = 'scripts/golive-out/laxii/t2i-cmw2bmzbl002css9fl5ru71os.jpg'
const b64 = readFileSync(SRC).toString('base64')
const prompt = 'Replace the background with a clear starry night sky while keeping the subject unchanged'

async function tryShape(label: string, body: Record<string, unknown>) {
  const t0 = Date.now()
  try {
    const res = await zai.images.generations.edit(body as never)
    const item = res.data?.[0]?.base64
    const bytes = item ? Buffer.from(item, 'base64') : null
    const magic = !!bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8
    if (bytes && magic) writeFileSync(`${OUT}/edit-${label}.jpg`, bytes)
    rec({ label, ok: true, latencyMs: Date.now() - t0, bytes: bytes?.length ?? 0, jpegMagic: magic })
    return true
  } catch (e) {
    rec({ label, ok: false, latencyMs: Date.now() - t0, error: (e instanceof Error ? e.message : String(e)).slice(0, 400) })
    return false
  }
}

const a = await tryShape('images-string-b64', { prompt, images: b64 })
if (!a) {
  await new Promise((r) => setTimeout(r, 15_000))
  await tryShape('images-string-dataurl', { prompt, images: `data:image/jpeg;base64,${b64}` })
}
console.log(JSON.stringify(log, null, 1))
