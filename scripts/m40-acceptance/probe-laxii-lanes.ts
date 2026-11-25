/**
 * M40 probe: reproduce the M39 matrix enhance + LaMa lanes EXACTLY (same
 * fixture construction via node:zlib deflateSync, same payloads incl.
 * maskStrokes) and capture the real output bytes for pixel-level inspection —
 * ground truth for the 493/492-byte size-floor rejections in matrix run 5.
 * Run: BASE=http://localhost:3000 bun scripts/m40-acceptance/probe-laxii-lanes.ts
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.BEAN_ACCEPT_BASE ?? 'http://localhost:3000'
const OUT = 'scripts/m40-acceptance/out'

let cookie = ''
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  return res
}

let CRC_TABLE: number[] | null = null
function crc32(buf: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}
function makeColorPng(width: number, height: number, colorType: 0 | 2, pixel: (x: number, y: number) => number[]): Uint8Array {
  const bpp = colorType === 0 ? 1 : 3
  const raw = new Uint8Array(height * (1 + width * bpp))
  let p = 0
  for (let y = 0; y < height; y++) {
    raw[p++] = 0
    for (let x = 0; x < width; x++) {
      const [a, b, c] = pixel(x, y)
      if (bpp === 1) raw[p++] = a
      else { raw[p++] = a; raw[p++] = b; raw[p++] = c }
    }
  }
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width); dv.setUint32(4, height)
  ihdr[8] = 8; ihdr[9] = colorType
  const idat = deflateSync(raw)
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const parts = [sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', new Uint8Array(idat)), pngChunk('IEND', new Uint8Array(0))]
  const len = parts.reduce((s, x) => s + x.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const part of parts) { out.set(part, o); o += part.length }
  return out
}
function makePng(width = 96, height = 96): Uint8Array {
  return makeColorPng(width, height, 2, (x, y) => {
    const bean = Math.hypot(x - width / 2, y - height / 2) < width / 3
    return bean ? [92, 52, 24] : [210, 200, 190]
  })
}
function makeMaskPng(width = 96, height = 96): Uint8Array {
  return makeColorPng(width, height, 0, (x, y) => {
    const inRect = x >= width * 0.35 && x <= width * 0.6 && y >= height * 0.35 && y <= height * 0.6
    const v = inRect ? 255 : 0
    return [v, v, v]
  })
}

async function waitJob(jobId: string, timeoutMs: number): Promise<{ status: string; result?: Record<string, unknown>; errorMessage?: string } | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500))
    const res = await call(`/api/ai/jobs/${jobId}`)
    if (!res.ok) continue
    const j = (await res.json()) as { job?: { status: string; result?: Record<string, unknown>; errorMessage?: string } }
    if (j.job && ['completed', 'failed', 'cancelled'].includes(j.job.status)) return j.job
  }
  return null
}

async function inspectPng(path: string): Promise<string> {
  const sharp = (await import('sharp')).default
  const img = sharp(path)
  const meta = await img.metadata()
  const stats = await img.stats()
  return `${meta.width}x${meta.height} ch=${meta.channels} format=${meta.format} channel-means=[${stats.channels.map((c) => c.mean.toFixed(1)).join(',')}] stdev=[${stats.channels.map((c) => c.stdev.toFixed(1)).join(',')}]`
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const png = makePng()
  const mask = makeMaskPng()
  console.log('fixture bytes: source', png.length, '| mask', mask.length)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const email = `m40-laxii2-${stamp}@bean-test.local`
  const pw = 'Bean-Accept-2026!'
  await call('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, name: 'M40 Laxii Probe 2' }) })
  const login = await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })
  console.log('login:', login.status)

  const form = new FormData()
  form.append('file', new Blob([png as unknown as BlobPart], { type: 'image/png' }), 'matrix-source.png')
  form.append('kind', 'original')
  const up = await call('/api/laxii/assets', { method: 'POST', body: form })
  const upJson = (await up.json().catch(() => ({}))) as { asset?: { id?: string; width?: number; height?: number }; error?: { message?: string } }
  const assetId = upJson.asset?.id
  console.log('asset upload:', up.status, assetId ?? upJson.error?.message, `${upJson.asset?.width}x${upJson.asset?.height}`)
  if (!assetId) return
  const maskForm = new FormData()
  maskForm.append('file', new Blob([mask as unknown as BlobPart], { type: 'image/png' }), 'matrix-mask.png')
  maskForm.append('kind', 'mask')
  const maskUp = await call('/api/laxii/assets', { method: 'POST', body: maskForm })
  const maskJson = (await maskUp.json().catch(() => ({}))) as { asset?: { id?: string }; error?: { message?: string } }
  const maskId = maskJson.asset?.id
  console.log('mask upload:', maskUp.status, maskId ?? maskJson.error?.message)

  async function downloadInspect(url: string, file: string): Promise<number> {
    const img = await call(url)
    const buf = new Uint8Array(await img.arrayBuffer())
    writeFileSync(`${OUT}/${file}`, buf)
    const head = Array.from(buf.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join(' ')
    const desc = await inspectPng(`${OUT}/${file}`).catch((e) => `inspect-failed: ${(e as Error).message.slice(0, 80)}`)
    console.log(`  output: HTTP ${img.status}, ${buf.length} bytes, head=${head}, ${desc}`)
    return buf.length
  }

  // ---- enhance (m39 payload verbatim) ----
  {
    const r = await call('/api/laxii/enhance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId, options: { denoise: true, exposureWhiteBalance: true, localContrast: true } }) })
    const body = (await r.json().catch(() => ({}))) as { job?: { id: string }; error?: { message?: string } }
    console.log('enhance submit:', r.status, body.job?.id ?? body.error?.message ?? '')
    if (r.status === 202 && body.job?.id) {
      const job = await waitJob(body.job.id, 120_000)
      const res = (job?.result ?? {}) as { imageUrl?: string; assetUrl?: string }
      const url = res.imageUrl ?? res.assetUrl
      console.log('enhance job:', job?.status, job?.errorMessage ?? '')
      if (job?.status === 'completed' && url) await downloadInspect(url, 'probe-enhance-output.png')
    }
  }

  // ---- lama (m39 payload verbatim) ----
  {
    const r = await call('/api/laxii/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'object-removal', assetId, maskStrokes: [{ assetId: maskId, kind: 'edit' }] }) })
    const body = (await r.json().catch(() => ({}))) as { job?: { id: string }; error?: { message?: string } }
    console.log('lama submit:', r.status, body.job?.id ?? body.error?.message ?? '')
    if (r.status === 202 && body.job?.id) {
      const job = await waitJob(body.job.id, 240_000)
      const res = (job?.result ?? {}) as { imageUrl?: string; assetUrl?: string; backendId?: string }
      const url = res.imageUrl ?? res.assetUrl
      console.log('lama job:', job?.status, job?.errorMessage ?? '', res.backendId ? `backend=${res.backendId}` : '')
      if (job?.status === 'completed' && url) await downloadInspect(url, 'probe-lama-output.png')
    }
  }
}
main()
