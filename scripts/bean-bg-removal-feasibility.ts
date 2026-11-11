/**
 * BEAN — background-removal feasibility probe (Phase 4).
 * ONE bounded hosted-edit request asking for a transparent-background cutout.
 * Measures what the provider actually returns: format magic bytes, alpha
 * channel presence, transparent-pixel fraction. No secrets printed.
 */
import ZAI from 'z-ai-web-dev-sdk'
import sharp from 'sharp'
import { readFileSync, writeFileSync } from 'node:fs'

async function main(): Promise<void> {
  const imageBytes = readFileSync('tests/fixtures/laxii/product-watch.png')
  const b64 = imageBytes.toString('base64')
  const zai = await ZAI.create()
  const t0 = Date.now()
  const res = (await zai.images.generations.edit({
    prompt:
      'Replace the entire background with a completely uniform, solid, flat pure green chroma-key background (exact color #00FF00 everywhere behind the subject, no gradients, no shadows on the background). Keep the main subject exactly as it is, with clean edges. The subject must not be green.',
    images: [{ url: `data:image/png;base64,${b64}` }],
  } as never)) as { data?: Array<{ base64?: string }> }
  const b64out = res.data?.[0]?.base64
  if (!b64out) throw new Error('no output payload')
  const bytes = Buffer.from(b64out, 'base64')
  writeFileSync('scripts/bean-optrans-out/bg-removal-probe.bin', bytes)
  const magic =
    bytes[0] === 0xff && bytes[1] === 0xd8
      ? 'jpeg'
      : bytes[0] === 0x89 && bytes[1] === 0x50
        ? 'png'
        : `unknown(${bytes.subarray(0, 4).toString('hex')})`
  const meta = await sharp(bytes).metadata().catch(() => null)
  let alphaStats: { hasAlpha: boolean; transparentFraction: number; opaqueFraction: number } | null = null
  if (meta && meta.width && meta.height) {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    let transparent = 0
    let opaque = 0
    const total = info.width * info.height
    for (let p = 0; p < total; p++) {
      const a = data[p * ch + (ch - 1)]
      if (a < 8) transparent++
      else if (a > 247) opaque++
    }
    alphaStats = { hasAlpha: true, transparentFraction: +(transparent / total).toFixed(4), opaqueFraction: +(opaque / total).toFixed(4) }
  }
  console.log(
    JSON.stringify(
      {
        elapsedMs: Date.now() - t0,
        bytes: bytes.length,
        magic,
        format: meta?.format ?? null,
        width: meta?.width ?? null,
        height: meta?.height ?? null,
        hasAlphaChannel: meta?.hasAlpha ?? null,
        alphaStats,
      },
      null,
      1,
    ),
  )
}

main().catch((e: unknown) => {
  console.log(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }))
  process.exit(1)
})
