/**
 * M26.3 — live ratio matrix: submit generations through the real composer
 * path at 1024x1024 (square preset) and 1440x720 (wide 2:1), then measure
 * the STORED bytes and the honest quality-report fields.
 */
import { Database } from 'bun:sqlite'
import path from 'node:path'
import sharp from 'sharp'
import fs from 'node:fs'

const BASE = 'http://localhost:3000'
const stamp = Date.now()
let cookie = ''
async function call(pathname: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
  })
  const sc = res.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  return res
}

await call('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `m263-ratio-${stamp}@bean.local`, password: 'Bean-Ratio-2026!', name: 'M263 Ratio' }),
})
await call('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `m263-ratio-${stamp}@bean.local`, password: 'Bean-Ratio-2026!' }),
})

async function run(label: string, w: number, h: number): Promise<void> {
  const submit = await call('/api/laxii/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: 'a serene japanese zen garden with maple leaves, cinematic, photorealistic',
      sizeOverride: { width: w, height: h },
    }),
  })
  const body = (await submit.json()) as { messages: Array<{ job?: { id?: string } }> }
  const jobId = body.messages?.find((m) => m.job)?.job?.id
  if (!jobId) {
    console.log(`${label}: NO JOB (submit ${submit.status})`)
    return
  }
  const t0 = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000))
    const j = await (await call(`/api/laxii/jobs/${jobId}`)).json() as { job?: { status?: string } }
    const status = j.job?.status ?? 'unknown'
    if (['completed', 'failed', 'cancelled'].includes(status)) {
      const raw = process.env.DATABASE_URL ?? ''
      const file = raw.startsWith('file:') ? raw.slice(5) : raw
      const dbPath = path.isAbsolute(file) ? file : path.join(process.cwd(), file)
      const db = new Database(dbPath, { readonly: true })
      const row = db.query('SELECT resultJson FROM GenerationJob WHERE id = ?').get(jobId) as { resultJson: string } | null
      if (!row) { console.log(`${label}: no row`); return }
      const r = JSON.parse(row.resultJson) as Record<string, unknown>
      console.log(`${label}: status=${status} final=${r.width}x${r.height} aspect=${r.aspectRatio} strategy=${(r.generation as Record<string, unknown>)?.strategy} bytes=${r.bytes} artifactChecked=${(r.artifact as Record<string, unknown>)?.checked} unwanted=${(r.artifact as Record<string, unknown>)?.unwantedTextDetected}`)
      if (typeof r.imageUrl === 'string') {
        const assetId = ((r.assetUrl as string) ?? (r.imageUrl as string)).split('/').pop() as string
        let found = ''
        const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (e.name.startsWith(assetId)) found = p } }
        walk('.next/standalone/storage/laxii')
        if (found) {
          const meta = await sharp(found).metadata()
          console.log(`  stored bytes measured: ${meta.width}x${meta.height} ${meta.format}`)
          await sharp(found).resize(360).png().toFile(`scripts/m263-out/ratio-${label}.png`)
        }
      }
      return
    }
    if (Date.now() - t0 > 220_000) { console.log(`${label}: TIMEOUT at ${status}`); return }
  }
}

await run('square-1024', 1024, 1024)
await run('wide-1440x720', 1440, 720)
await run('hd-1920x1080', 1920, 1080)
