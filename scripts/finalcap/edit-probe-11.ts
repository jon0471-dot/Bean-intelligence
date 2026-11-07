/**
 * FINAL CAPABILITY COMPLETION — LAXII edit contract probe #11 (bounded).
 *
 * Matrix state before this probe (all measured, verbatim records in
 * scripts/probe-image-edit-out/):
 *   - `images` string forms (public URL, raw b64, data URL, provider CDN URL): 400 1210
 *   - `images` flat string arrays (b64, data URL): 400 1210 "must provide images"
 *   - SDK 0.0.18 canonical `image` (data URL): 429 no verdict (2026-11-05),
 *     then TODAY (2026-11-07) a definitive 400 1210 "must provide images".
 *
 * The gateway validator insists on a field named `images`; every flat form
 * fails. This gateway's own house convention everywhere else (T2I responses
 * data[].url, vision chat image_url.url, async video video_result[].url) is
 * url-KEYED OBJECTS inside arrays. Probe #11 sends exactly that shape, ONCE.
 * Any outcome is final for this recovery window — no second attempt, no loop.
 */
import ZAI from 'z-ai-web-dev-sdk'
import { writeFileSync } from 'node:fs'

async function main() {
  const sharp = (await import('sharp')).default
  const img = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 40, g: 80, b: 140 } },
  })
    .composite([{ input: Buffer.from(`<svg width="256" height="256"><circle cx="128" cy="128" r="70" fill="#e8b84b"/></svg>`) }])
    .jpeg({ quality: 90 })
    .toBuffer()
  const dataUrl = `data:image/jpeg;base64,${img.toString('base64')}`

  const zai = await ZAI.create()
  const cfg = (zai as unknown as { config?: { baseUrl?: string; apiKey?: string } }).config
  const baseUrl = cfg?.baseUrl
  if (!baseUrl) throw new Error('no gateway config')
  const body = {
    prompt: 'Change the background to a sunset beach with warm golden light',
    images: [{ url: dataUrl }],
    size: '1024x1024',
  }
  const t0 = Date.now()
  try {
    // Send through the SDK's own edit method — it POSTs the body VERBATIM to
    // {baseUrl}/images/generations/edit with the required gateway headers
    // (a raw fetch 403s at the edge before the body is ever validated).
    const res = (await zai.images.generations.edit(body as never)) as {
      data?: Array<{ url?: string; base64?: string }>
    }
    const item = res?.data?.[0]
    const summary: Record<string, unknown> = {
      ok: true,
      ms: Date.now() - t0,
      hasData: Array.isArray(res?.data),
      itemKeys: item ? Object.keys(item) : null,
      hasUrl: typeof item?.url === 'string',
      hasB64: typeof item?.base64 === 'string',
    }
    if (typeof item?.url === 'string') summary.urlHost = new URL(item.url).host
    writeFileSync('scripts/finalcap-out/edit-probe-11.json', JSON.stringify({ at: new Date().toISOString(), shape: 'images:[{url:dataURL}]', ...summary }, null, 2))
    console.log(JSON.stringify(summary))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    writeFileSync('scripts/finalcap-out/edit-probe-11.json', JSON.stringify({ at: new Date().toISOString(), shape: 'images:[{url:dataURL}]', ok: false, error: msg.slice(0, 300) }, null, 2))
    console.log(JSON.stringify({ ok: false, error: msg.slice(0, 300) }))
  }
}
main()
