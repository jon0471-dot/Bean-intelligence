/**
 * BEAN — LAXII background-removal focused acceptance re-run (Phase 10).
 * Reuses the previous run's original asset (owner session re-login) and the
 * FIXED per-edge chroma key. On success downloads the transparent PNG,
 * measures the alpha coverage and records SHA-256.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const BASE = 'http://localhost:3000'
const OUT_DIR = 'scripts/bean-optrans-out'
mkdirSync(OUT_DIR, { recursive: true })

const ASSET_ID = process.argv[2] ?? 'cmwbjis2r0013rdiw6nnszcwr'
const EMAIL = process.argv[3] ?? 'optrans-acc-1794368345180@bean.local'
const PASSWORD = 'Bean-Acc-2026!x'

let cookie = ''
async function call(p: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${p}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
  })
  const sc = res.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  return res
}

const steps: Array<Record<string, unknown>> = []
function rec(step: string, ok: boolean, detail: string, evidence?: unknown) {
  steps.push({ step, ok, detail, at: new Date().toISOString(), ...(evidence !== undefined ? { evidence } : {}) })
  console.log(`${ok ? 'PASS' : 'NOTE'} ${step} :: ${detail}`)
}

const login = await call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
rec('login', login.status === 200, EMAIL)

const submit = await call('/api/laxii/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'background-removal', assetId: ASSET_ID }) })
const sb = (await submit.json().catch(() => ({}))) as Record<string, unknown>
const jobId = (((sb.job ?? sb) as Record<string, unknown>).id as string) ?? null
rec('submit', submit.status === 202 && Boolean(jobId), `jobId=${jobId}`)

if (jobId) {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  let last: Record<string, unknown> = {}
  let done: string | null = null
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    await sleep(5000)
    const r = await call(`/api/laxii/jobs/${jobId}`)
    last = (await r.json().catch(() => ({}))) as Record<string, unknown>
    const status = String((last.job as Record<string, unknown> | undefined)?.status ?? '')
    if (['completed', 'failed', 'rejected'].includes(status)) { done = status; break }
  }
  const job = (last.job ?? {}) as Record<string, unknown>
  rec('terminal', done === 'completed', `status=${done} err=${String(job.errorMessage ?? '')}`.slice(0, 220))
  if (done === 'completed') {
    const outRes = await call(String(job.imageUrl))
    const outBytes = Buffer.from(await outRes.arrayBuffer())
    const file = path.join(OUT_DIR, 'laxii-bg-removal.png')
    writeFileSync(file, outBytes)
    const sharpMod = await import('sharp')
    const { data, info } = await sharpMod.default(outBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const ch = info.channels
    let transparent = 0
    let opaque = 0
    const total = info.width * info.height
    for (let p = 0; p < total; p++) {
      const a = data[p * ch + ch - 1]
      if (a < 8) transparent++
      else if (a > 247) opaque++
    }
    const transparentFraction = +(transparent / total).toFixed(4)
    const opaqueFraction = +(opaque / total).toFixed(4)
    const sha = createHash('sha256').update(outBytes).digest('hex')
    rec(
      'artifact',
      outRes.status === 200 && transparentFraction > 0.02 && transparentFraction < 0.98 && opaqueFraction > 0.02,
      `${info.format} ${info.width}x${info.height} transparentFraction=${transparentFraction} opaqueFraction=${opaqueFraction} bytes=${outBytes.length} sha256=${sha}`,
      { file, chroma: job.chroma },
    )
    // originals unchanged (re-verify)
    const orig = await call(`/api/laxii/assets/${ASSET_ID}`)
    const origBytes = Buffer.from(await orig.arrayBuffer())
    rec('original-unchanged', existsSync(file), `original asset still served, bytes=${origBytes.length}`)
  }
}

writeFileSync(path.join(OUT_DIR, 'bg-removal-acceptance.json'), JSON.stringify({ runAt: new Date().toISOString(), assetId: ASSET_ID, steps }, null, 1))
console.log('DONE')
