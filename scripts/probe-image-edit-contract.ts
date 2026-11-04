/**
 * Probe the gateway images.edit parameter contract (bounded: two attempts).
 * Variant A: image = data URL (data:image/jpeg;base64,...)
 * Variant B: image = bare base64 + images = [dataUrl]
 */
import ZAI from 'z-ai-web-dev-sdk'
import { writeFileSync } from 'node:fs'
import sharp from 'sharp'

async function main() {
  const zai = await ZAI.create()
  const img = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 180, g: 60, b: 20 } } })
    .jpeg({ quality: 85 })
    .toBuffer()
  const b64 = img.toString('base64')
  const dataUrl = `data:image/jpeg;base64,${b64}`

  // Variant A: data URL in `image`
  try {
    const res = (await zai.images.generations.edit({
      prompt: 'make the image brighter',
      image: dataUrl,
      size: '1024x1024',
    } as never)) as { data?: Array<{ base64?: string }> }
    const okA = Boolean(res.data?.[0]?.base64)
    console.log('VARIANT_A data-url:', okA ? 'SUCCESS' : 'no payload', JSON.stringify(res).slice(0, 120))
    if (okA) writeFileSync('scripts/golive-out/edit-probe-a.jpg', Buffer.from(res.data![0].base64, 'base64'))
  } catch (e) {
    console.log('VARIANT_A data-url: FAIL', (e instanceof Error ? e.message : String(e)).slice(0, 220))
  }

  await new Promise((r) => setTimeout(r, 8000))

  // Variant C: image = [dataUrl] (array)
  // Variant D: images = dataUrl (string)
  // Variant E: image_url = [dataUrl]
  const variants: Array<[string, Record<string, unknown>]> = [
    ['F images-array-only', { prompt: 'make the image brighter', images: [dataUrl], size: '1024x1024' }],
    ['G images-multi', { prompt: 'make the image brighter', images: [dataUrl, dataUrl], size: '1024x1024' }],
    ['H image-bare-b64', { prompt: 'make the image brighter', images: [b64], size: '1024x1024' }],
  ]
  for (const [name, body] of variants) {
    try {
      const editFn = zai.images.generations.edit as unknown as (b: unknown) => Promise<{ data?: Array<{ base64?: string }> }>
      const res = await editFn(body)
      const ok = Boolean(res.data?.[0]?.base64)
      console.log(`VARIANT_${name}:`, ok ? 'SUCCESS' : 'no payload', JSON.stringify(res).slice(0, 100))
      if (ok) {
        writeFileSync(`scripts/golive-out/edit-probe-${name[0]}.jpg`, Buffer.from(res.data![0].base64, 'base64'))
        break
      }
    } catch (e) {
      console.log(`VARIANT_${name}: FAIL`, (e instanceof Error ? e.message : String(e)).slice(0, 200))
    }
    await new Promise((r) => setTimeout(r, 8000))
  }
}

main().catch((e) => { console.error('fatal', e); process.exit(1) })
