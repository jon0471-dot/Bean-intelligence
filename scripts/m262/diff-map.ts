import { Database } from 'bun:sqlite'
import path from 'node:path'
import sharp from 'sharp'
import fs from 'node:fs'

const raw = process.env.DATABASE_URL ?? ''
const file = raw.startsWith('file:') ? raw.slice(5) : raw
const dbPath = path.isAbsolute(file) ? file : path.join(process.cwd(), file)
const db = new Database(dbPath, { readonly: true })
const row = db.query("SELECT id, resultJson FROM GenerationJob WHERE task='image-editing' AND status='completed' AND paramsJson LIKE '%object-removal%' ORDER BY queuedAt DESC LIMIT 1").get() as { id: string; resultJson: string } | null
if (!row) { console.log('no object-removal job found'); process.exit(0) }
const result = JSON.parse(row.resultJson) as { imageUrl: string; originalUrl: string }
console.log('job', row.id, 'result', result.imageUrl, 'orig', result.originalUrl)
function assetPath(url: string): string {
  const id = url.split('/').pop() as string
  // storage layout: storage/laxii/<userId>/... — find it
  const candidates: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.startsWith(id)) candidates.push(p)
    }
  }
  walk('storage/laxii')
  return candidates[0]
}
const resP = assetPath(result.imageUrl)
const origP = assetPath(result.originalUrl)
console.log('files:', resP, origP)
const newRaw = await sharp(resP).removeAlpha().raw().toBuffer()
const origRaw = await sharp(origP).removeAlpha().raw().toBuffer()
console.log('dims', (await sharp(resP).metadata()).width, 'x', (await sharp(resP).metadata()).height)
const W = 800, H = 600
const maskSvg = `<svg width="800" height="600"><rect x="560" y="20" width="180" height="120" fill="white"/></svg>`
const maskPng = await sharp(Buffer.from(maskSvg)).png().toBuffer()
const maskU8 = await sharp(maskPng).resize(W, H, { fit: 'fill' }).extractChannel(0).raw().toBuffer()
// dilate+feather approximation of the shaped mask band (28px)
const R = 30
const eroded = Buffer.alloc(W * H)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let allMasked = 1
    for (let dy = -R; dy <= R && allMasked; dy++) {
      const yy = Math.min(H - 1, Math.max(0, y + dy))
      for (let dx = -R; dx <= R; dx++) {
        const xx = Math.min(W - 1, Math.max(0, x + dx))
        if (maskU8[yy * W + xx] < 128) { allMasked = 0; break }
      }
    }
    eroded[y * W + x] = allMasked ? 255 : 0
  }
}
// diff visualization: red channel = differing pixels
const vis = Buffer.alloc(W * H * 3)
let diffOut = 0
const diffLocs: Array<[number, number]> = []
for (let p = 0; p < W * H; p++) {
  const differs = origRaw[p * 3] !== newRaw[p * 3] || origRaw[p * 3 + 1] !== newRaw[p * 3 + 1] || origRaw[p * 3 + 2] !== newRaw[p * 3 + 2]
  const g = origRaw[p * 3]
  vis[p * 3] = differs ? 255 : g / 3
  vis[p * 3 + 1] = differs ? 0 : g / 3
  vis[p * 3 + 2] = differs ? 0 : g / 3
  if (differs && eroded[p] < 128) { diffOut++; diffLocs.push([p % W, Math.floor(p / W)]) }
}
console.log('differ outside eroded core:', diffOut)
// bounding box of outside diffs
if (diffLocs.length) {
  const xs = diffLocs.map((l) => l[0]); const ys = diffLocs.map((l) => l[1])
  console.log('diff bbox x', Math.min(...xs), '-', Math.max(...xs), ' y', Math.min(...ys), '-', Math.max(...ys))
}
await sharp(vis, { raw: { width: W, height: H, channels: 3 } }).resize(640).png().toFile('scripts/m262-out/removal-diff-map.png')
