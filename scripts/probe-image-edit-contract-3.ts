/**
 * Final bounded edit-shape probes (≤2 real calls, both are 400-rejections = no
 * inference cost). Shapes remaining untested:
 *   A. images: "<url>"          (plural name, singular string)
 *   B. image:  "<url>"          (typings' singular name, URL value)
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import ZAI from 'z-ai-web-dev-sdk'

const OUT = 'scripts/probe-image-edit-out'
mkdirSync(OUT, { recursive: true })
const log: unknown[] = []
const rec = (x: unknown) => { log.push(x); writeFileSync(`${OUT}/contract-probe2.json`, JSON.stringify(log, null, 1)) }

const zai = await ZAI.create()
const PUBLIC_IMG = 'https://interactive-examples.mdn.mozilla.net/media/cc0-images/painted-hand-298-332.jpg'
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

const a = await tryShape('images-singular-string', { prompt, images: PUBLIC_IMG })
if (!a) {
  await new Promise((r) => setTimeout(r, 15_000))
  await tryShape('image-singular-url', { prompt, image: PUBLIC_IMG })
}
console.log(JSON.stringify(log, null, 1))
