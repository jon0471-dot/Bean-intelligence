/**
 * M26.2 — visual probes for the fixed LaMa and RIFE invocations (post CHW fix).
 * Saves PNG previews + prints measured stats so a human can confirm the model
 * output is REAL synthesis (not layout garbage).
 */
import sharp from 'sharp'
import { decodeRaw } from '../../src/lib/laxii/segmentation'
import { lamaInpaint } from '../../src/lib/laxii/inpaint-local'
import { generateLocalI2VFrames, parseMotionProgram } from '../../src/lib/jazmii/i2v-local'
import fs from 'node:fs'

// ---- 1. LaMa object removal on the real scene photo -------------------------
{
  const bytes = await sharp('scripts/m262/fixtures/scene.jpg').rotate().jpeg({ quality: 92 }).toBuffer()
  const raw = await decodeRaw(bytes)
  const W = raw.width, H = raw.height
  const scale = Math.min(1, 512 / Math.max(W, H))
  const gw = Math.max(64, Math.round((W * scale) / 8) * 8)
  const gh = Math.max(64, Math.round((H * scale) / 8) * 8)
  const genImage = await sharp(raw.data, { raw: { width: W, height: H, channels: 3 } }).resize(gw, gh, { fit: 'fill' }).raw().toBuffer()
  const mask = Buffer.alloc(gw * gh)
  // mask the same corner region as the acceptance (scaled)
  const x0 = Math.round(560 * (gw / W)), y0 = Math.round(20 * (gh / H))
  const x1 = Math.round(740 * (gw / W)), y1 = Math.round(140 * (gh / H))
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * gw + x] = 255
  const r = await lamaInpaint({ data: genImage, width: gw, height: gh }, { data: mask, width: gw, height: gh })
  console.log('lama:', JSON.stringify(r.stats))
  await sharp(r.rgb, { raw: { width: r.width, height: r.height, channels: 3 } }).png().toFile('scripts/m262-out/probe-lama.png')
  await sharp(genImage, { raw: { width: gw, height: gh, channels: 3 } }).png().toFile('scripts/m262-out/probe-lama-src.png')
}

// ---- 2. RIFE midpoint between two real crops --------------------------------
{
  const bytes = fs.readFileSync('scripts/m262/fixtures/cand-c.jpg')
  const motion = parseMotionProgram('slow zoom in').program
  const gen = await generateLocalI2VFrames({
    width: 416, height: 320, durationSec: 2, fps: 8, program: motion,
    sourceBytes: bytes,
  })
  console.log('i2v frames:', gen.frameCount, 'rifeCalls:', gen.rifeCalls, 'dims:', gen.width + 'x' + gen.height)
  // save frame 0, a mid frame, and the last frame
  for (const idx of [0, Math.floor(gen.frameCount / 2), gen.frameCount - 1]) {
    await sharp(gen.frames[idx], { raw: { width: gen.width, height: gen.height, channels: 3 } })
      .png().toFile(`scripts/m262-out/probe-rife-${idx}.png`)
  }
}
console.log('probes saved to scripts/m262-out/')
