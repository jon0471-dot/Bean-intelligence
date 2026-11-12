/**
 * URGENT HOTFIX (LAXII CAPABILITY RECOVERY, 2026-11-11) — PHASE 2B.
 * Runs ONLY the two remaining real capability tests (the T2I canary already
 * ran in phase 2 and its outcome is recorded in the same evidence file):
 *   1. CONVERSATIONAL EDIT   — real hosted edit, PNG decoded + materially
 *      different from the input.
 *   2. BACKGROUND REMOVAL    — real two-stage pipeline, PNG decoded + REAL
 *      transparency measured (alpha==0 pixels) + job-reported fraction.
 * Sequential, single in-flight, 5 s polling, honest outcomes only. If a job
 * parks in retry_wait (genuine 429), the poll window elapses and the job's
 * bounded chain continues server-side — monitored via the DB afterwards.
 *
 * Run: bun scripts/laxii-recovery-phase2b.ts   (dev server on :3000)
 */
import { appendFileSync } from 'node:fs'
import sharp from 'sharp'

const BASE = 'http://localhost:3000'
const OUT = 'docs/evidence/laxii-capability-recovery-e2e-phase2.txt'

function log(line: string) {
  console.log(line)
  appendFileSync(OUT, line + '\n')
}

function jar() {
  let cookie = ''
  return {
    async call(path: string, init: RequestInit = {}): Promise<Response> {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
      })
      const setCookie = res.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      return res
    },
  }
}

async function pollJob(j: ReturnType<typeof jar>, jobId: string, maxMs: number): Promise<{ status: string; result: Record<string, unknown> | null; error: unknown }> {
  const t0 = Date.now()
  let status = ''
  let result: Record<string, unknown> | null = null
  let error: unknown = null
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 5000))
    const res = await j.call(`/api/laxii/jobs/${jobId}`)
    const body = (await res.json().catch(() => ({}))) as { job?: { status?: string; result?: Record<string, unknown>; error?: unknown } }
    status = body.job?.status ?? ''
    // The API nests imageUrl as a SIBLING of status inside job (job.result is
    // the raw resultJson only in the DB) — read the whole job object.
    result = (body.job ?? null) as unknown as Record<string, unknown> | null
    error = body.job?.error ?? null
    if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'rejected') break
    log(`  poll ${Math.round((Date.now() - t0) / 1000)}s: ${status}`)
  }
  return { status, result, error }
}

const stamp = Date.now()
const j = jar()
const reg = await j.call('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `recovery2b-${stamp}@bean.local`, password: 'Bean-Recover-2026!', name: 'Recovery E2E P2B' }),
})
const login = await j.call('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `recovery2b-${stamp}@bean.local`, password: 'Bean-Recover-2026!' }),
})
log(`\n[phase2b ${new Date().toISOString()}] auth: register=${reg.status} login=${login.status}`)

const subjectPng = await sharp(
  Buffer.from(
    `<svg width="640" height="640">
      <rect width="640" height="640" fill="#d8d4cc"/>
      <rect x="0" y="520" width="640" height="120" fill="#b8b2a6"/>
      <ellipse cx="320" cy="330" rx="150" ry="210" fill="#1c1a17"/>
      <rect x="300" y="120" width="40" height="60" rx="8" fill="#1c1a17"/>
      <circle cx="320" cy="240" r="36" fill="#c9a227"/>
    </svg>`,
  ),
)
  .png()
  .toBuffer()

async function uploadAsset(name: string): Promise<string | null> {
  const form = new FormData()
  form.append('file', new Blob([subjectPng], { type: 'image/png' }), name)
  const up = await j.call('/api/laxii/assets', { method: 'POST', body: form })
  const b = (await up.json().catch(() => ({}))) as { asset?: { id?: string } }
  log(`upload ${name}: HTTP ${up.status} asset=${b.asset?.id ?? '-'}`)
  return b.asset?.id ?? null
}

// ==================================================== 1. conversational edit
log('== 1. CONVERSATIONAL EDITING (real hosted edit) ==')
const assetId = await uploadAsset(`edit-src-${stamp}.png`)
if (assetId) {
  const sub = await j.call('/api/laxii/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'conversational-edit', assetId, prompt: 'Replace the background with a deep navy studio backdrop and add a soft gold rim light around the bottle' }),
  })
  const s = (await sub.json().catch(() => ({}))) as { job?: { id?: string }; error?: unknown }
  log(`submit: HTTP ${sub.status} job=${s.job?.id ?? '-'} ${s.error ? `error=${JSON.stringify(s.error).slice(0, 160)}` : ''}`)
  if (s.job?.id) {
    const r = await pollJob(j, s.job.id, 8 * 60_000)
    log(`final: ${r.status}`)
    if (r.status === 'completed' && r.result?.imageUrl) {
      const img = await j.call(r.result.imageUrl as string)
      const buf = Buffer.from(await img.arrayBuffer())
      const meta = await sharp(buf).metadata()
      const stats = await sharp(buf).stats()
      const changed = JSON.stringify(stats.channels.map((c) => Math.round(c.mean))) !== JSON.stringify((await sharp(subjectPng).stats()).channels.map((c) => Math.round(c.mean)))
      log(`artifact: HTTP ${img.status}, ${buf.length} bytes, magic=${buf[0] === 0x89 ? 'PNG' : buf[0] === 0xff ? 'JPEG' : 'UNKNOWN'}, decoded=${meta.width}x${meta.height}, differs-from-input=${changed}`)
      log(`EDIT VERDICT: ${img.status === 200 && buf.length > 10_000 && meta.format === 'png' && changed ? 'PASS — real edited image artifact, decoded + materially different from the input' : 'FAIL'}`)
    } else {
      log(`EDIT VERDICT: FAIL — job ended "${r.status}" error=${JSON.stringify(r.error).slice(0, 300)}`)
    }
  }
}

// ==================================================== 2. background removal
log('== 2. BACKGROUND REMOVAL (real two-stage pipeline) ==')
const bgAssetId = await uploadAsset(`bgrem-src-${stamp}.png`)
if (bgAssetId) {
  const sub = await j.call('/api/laxii/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'background-removal', assetId: bgAssetId }),
  })
  const s = (await sub.json().catch(() => ({}))) as { job?: { id?: string }; error?: unknown }
  log(`submit: HTTP ${sub.status} job=${s.job?.id ?? '-'} ${s.error ? `error=${JSON.stringify(s.error).slice(0, 160)}` : ''}`)
  if (s.job?.id) {
    const r = await pollJob(j, s.job.id, 8 * 60_000)
    log(`final: ${r.status}`)
    if (r.status === 'completed' && r.result?.imageUrl) {
      const img = await j.call(r.result.imageUrl as string)
      const buf = Buffer.from(await img.arrayBuffer())
      const meta = await sharp(buf).metadata()
      const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let transparent = 0
      for (let i = 3; i < data.length; i += info.channels) if (data[i] === 0) transparent++
      const frac = transparent / (info.width * info.height)
      const chroma = (r.result as { chroma?: { transparentFraction?: number } }).chroma?.transparentFraction
      log(`artifact: HTTP ${img.status}, ${buf.length} bytes, magic=${buf[0] === 0x89 ? 'PNG' : 'UNKNOWN'}, decoded=${info.width}x${info.height}, fully-transparent-pixel-fraction=${frac.toFixed(3)}, job-reported=${chroma ?? '-'}`)
      log(`BG-REMOVAL VERDICT: ${img.status === 200 && meta.format === 'png' && frac > 0.2 ? 'PASS — real transparent PNG (measured alpha)' : 'FAIL'}`)
    } else {
      log(`BG-REMOVAL VERDICT: FAIL — job ended "${r.status}" error=${JSON.stringify(r.error).slice(0, 300)}`)
    }
  }
}

log(`[phase2b] in-call testing finished ${new Date().toISOString()} (parked jobs, if any, continue their bounded chains server-side)`)
