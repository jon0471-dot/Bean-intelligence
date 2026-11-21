import sharp from 'sharp'
import { decodeRaw, runBestMatte } from '../../src/lib/laxii/segmentation'
async function probe(label: string, bytes: Buffer) {
  try {
    const raw = await decodeRaw(bytes)
    const m = await runBestMatte(raw)
    console.log(`${label}: usable=${m.usable} stats=${JSON.stringify(m.stats)}`)
  } catch (e) {
    console.log(`${label}: HONEST FAIL — ${(e as Error).message.slice(0, 130)}`)
  }
}
// a. solid mid-gray
await probe('solid-gray', await sharp({ create: { width: 320, height: 320, channels: 3, background: '#808080' } }).png().toBuffer())
// b. random RGB noise
{
  const n = 320 * 320 * 3
  const buf = Buffer.alloc(n)
  let s = 12345
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; buf[i] = (s >> 16) & 0xff }
  await probe('noise', await sharp(buf, { raw: { width: 320, height: 320, channels: 3 } }).png().toBuffer())
}
// c. linear gradient (current fixture behavior)
await probe('gradient', await sharp(Buffer.from(`<svg width="320" height="320"><defs><linearGradient id="g"><stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#abcdef"/></linearGradient></defs><rect width="320" height="320" fill="url(#g)"/></svg>`)).png().toBuffer())
