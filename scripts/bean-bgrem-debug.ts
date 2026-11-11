/**
 * Debug the bg-removal stage 1 output: run the SAME chroma prompt the job
 * runs, save the intermediate, and print the measured key + cutout stats.
 */
import ZAI from 'z-ai-web-dev-sdk'
import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'
import { CHROMA_BG_PROMPT, chromaCutout, validateCutout, measureChromaKey } from '../src/lib/laxii/bg-removal'

async function main(): Promise<void> {
  const imageBytes = readFileSync('scripts/bean-optrans-out/laxii-t2i.jpg')
  const prepared = await sharp(imageBytes).rotate().removeAlpha().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
  const zai = await ZAI.create()
  const res = (await zai.images.generations.edit({
    prompt: CHROMA_BG_PROMPT,
    images: [{ url: `data:image/jpeg;base64,${prepared.toString('base64')}` }],
  } as never)) as { data?: Array<{ base64?: string }> }
  const bytes = Buffer.from(res.data?.[0]?.base64 ?? '', 'base64')
  writeFileSync('scripts/bean-optrans-out/bg-chroma-intermediate.bin', bytes)
  const raw = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const img = { data: new Uint8Array(raw.data), width: raw.info.width, height: raw.info.height }
  const mk = measureChromaKey(img)
  const cutout = chromaCutout(img)
  console.log(JSON.stringify({ bytes: bytes.length, width: img.width, height: img.height, key: mk, stats: cutout.stats, rejection: validateCutout(cutout.stats) }, null, 1))
  // Corner samples of the intermediate for inspection.
  const ch = 3
  for (const [x, y] of [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width >> 1, img.height - 1]] as Array<[number, number]>) {
    const i = (y * img.width + x) * ch
    console.log(`px(${x},${y}) =`, img.data[i], img.data[i + 1], img.data[i + 2])
  }
}

main().catch((e: unknown) => {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  process.exit(1)
})
