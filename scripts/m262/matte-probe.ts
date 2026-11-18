import sharp from 'sharp'
import { decodeRaw, runPortraitMatte } from '../../src/lib/laxii/segmentation'
const bytes = await sharp('scripts/m262/fixtures/portrait-studio.jpg').rotate().jpeg({ quality: 92 }).toBuffer()
const raw = await decodeRaw(bytes)
const m = await runPortraitMatte(raw)
const a = m.alpha
let ge95 = 0, ge90 = 0, le05 = 0, hi = 0
for (const v of a) { if (v >= 0.95) ge95++; if (v >= 0.9) ge90++; if (v <= 0.05) le05++; if (v > 0.5) hi++ }
console.log(JSON.stringify(m.stats), 'usable=', m.usable)
console.log('>0.5:', (hi / a.length).toFixed(3), '>=0.90:', (ge90 / a.length).toFixed(3), '>=0.95:', (ge95 / a.length).toFixed(3), '<=0.05:', (le05 / a.length).toFixed(3))
const W = m.width, H = m.height
const u8 = Buffer.alloc(W * H)
for (let i = 0; i < W * H; i++) u8[i] = Math.round(a[i] * 255)
await sharp(u8, { raw: { width: W, height: H, channels: 1 } }).resize(300).png().toFile('scripts/m262-out/matte-served.png')
