/**
 * LAXII & JAZMII capability restoration — LIVE EXECUTION HARNESS (2026-11-14).
 *
 * Runs REAL jobs end-to-end against the deployment on BASE (default
 * http://127.0.0.1:3100) and records measured evidence under
 * scripts/laxii-jazmii-restore-out/. Every job is a genuine GenerationJob
 * row executed by the real embedded engine — nothing here fabricates a
 * result: a job that fails is recorded as failed with its error.
 *
 * Stages (run separately, each bounded):
 *   auth    — register + login a dedicated evidence user, persist cookie
 *   laxii   — upload fixtures; submit t2i, conversational-edit,
 *             background-removal, enhancement; poll all to terminal state
 *   jazmii  — submit t2v, i2v (validated reference), a cancel probe;
 *             poll to terminal state
 *   analyze — validate bg-removal alpha, ffprobe both videos, summarize
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:3100'
const OUT = 'scripts/laxii-jazmii-restore-out'
const COOKIE_FILE = `${OUT}/cookie.txt`
const STATE_FILE = `${OUT}/state.json`
const stage = process.argv[2] ?? ''

function loadState(): Record<string, unknown> {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}
}
function saveState(s: Record<string, unknown>): void {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))
}

function cookieHeader(): string {
  return existsSync(COOKIE_FILE) ? readFileSync(COOKIE_FILE, 'utf8').trim() : ''
}

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) }
  const c = cookieHeader()
  if (c) headers.cookie = c
  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie && stage === 'auth') writeFileSync(COOKIE_FILE, setCookie.split(';')[0])
  let body: any = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

async function pollJob(kind: 'laxii' | 'jazmii', id: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const t0 = Date.now()
  let last: Record<string, unknown> = {}
  while (Date.now() - t0 < timeoutMs) {
    const { status, body } = await api(`/api/${kind}/jobs/${id}`)
    last = body?.job ?? { httpStatus: status }
    const s = String(last.status)
    if (['completed', 'failed', 'cancelled', 'rejected', 'unsupported'].includes(s)) return last
    await new Promise((r) => setTimeout(r, 4000))
  }
  return { ...last, pollTimeout: true }
}

// ---------------------------------------------------------------- stages ----

if (stage === 'auth') {
  const email = `laxii-jazmii-restore-${Date.now()}@bean-evidence.local`
  const reg = await api('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Restore-Evidence-2026!', name: 'Restoration Evidence' }),
  })
  if (reg.status !== 201 && reg.status !== 200) {
    console.error('register failed', reg.status, JSON.stringify(reg.body))
    process.exit(1)
  }
  const login = await api('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Restore-Evidence-2026!' }),
  })
  if (login.status !== 200) {
    console.error('login failed', login.status, JSON.stringify(login.body))
    process.exit(1)
  }
  const s = loadState()
  s.userEmail = email
  saveState(s)
  console.log('AUTH OK — user', email)
  process.exit(0)
}

if (stage === 'laxii') {
  const ev: Record<string, unknown> = {}
  const upload = async (file: string, kind: string): Promise<string> => {
    const buf = readFileSync(`${OUT}/${file}`)
    const form = new FormData()
    form.append('file', new File([new Uint8Array(buf)], file, { type: file.endsWith('.jpg') ? 'image/jpeg' : 'image/png' }))
    form.append('kind', kind)
    const { status, body } = await api('/api/laxii/assets', { method: 'POST', body: form })
    if (status !== 201) throw new Error(`upload ${file} failed: ${status} ${JSON.stringify(body)}`)
    return (body as { asset: { id: string } }).asset.id
  }

  const editAsset = await upload('fixture-edit.png', 'original')
  const bgAsset = await upload('fixture-bgrem.png', 'original')
  const enhAsset = await upload('fixture-enhance.png', 'original')
  ev.assets = { editAsset, bgAsset, enhAsset }
  console.log('assets uploaded', ev.assets)

  // 1) text-to-image
  const t2i = await api('/api/laxii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'A single crisp red apple on a matte slate surface, soft studio lighting, photorealistic',
      size: '1024x1024',
    }),
  })
  ev.t2iSubmit = { status: t2i.status, body: t2i.body }
  console.log('t2i submit', t2i.status)

  // 2) conversational edit
  const edit = await api('/api/laxii/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mode: 'conversational-edit',
      assetId: editAsset,
      prompt: 'Replace the background with a warm sunset beach scene while keeping the red circular subject unchanged',
      size: '1024x1024',
    }),
  })
  ev.editSubmit = { status: edit.status, body: edit.body }
  console.log('edit submit', edit.status)

  // 3) background removal
  const bgr = await api('/api/laxii/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'background-removal', assetId: bgAsset }),
  })
  ev.bgrSubmit = { status: bgr.status, body: bgr.body }
  console.log('bg-removal submit', bgr.status)

  // 4) deterministic enhancement (full-frame global enhancement)
  const enh = await api('/api/laxii/enhance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      assetId: enhAsset,
      options: { denoise: true, exposureWhiteBalance: true, grade: true, localContrast: true, upscaleFactor: 2 },
      globalColor: true,
    }),
  })
  ev.enhSubmit = { status: enh.status, body: enh.body }
  console.log('enhance submit', enh.status)

  const submitted = ev as {
    t2iSubmit: { body?: { job?: { id?: string } } }
    editSubmit: { body?: { job?: { id?: string } } }
    bgrSubmit: { body?: { job?: { id?: string } } }
    enhSubmit: { body?: { job?: { id?: string } } }
  }
  const ids = {
    t2i: submitted.t2iSubmit.body?.job?.id ?? null,
    edit: submitted.editSubmit.body?.job?.id ?? null,
    bgr: submitted.bgrSubmit.body?.job?.id ?? null,
    enh: submitted.enhSubmit.body?.job?.id ?? null,
  }
  ev.jobIds = ids
  saveState({ ...loadState(), laxii: ev })

  const results: Record<string, unknown> = {}
  for (const [name, id] of Object.entries(ids)) {
    if (!id) continue
    results[name] = await pollJob('laxii', id, 12 * 60_000)
    console.log(`laxii ${name} →`, JSON.stringify(results[name]).slice(0, 400))
  }
  ev.results = results
  const st = loadState()
  st.laxii = ev
  saveState(st)
  process.exit(0)
}

if (stage === 'jazmii') {
  const ev: Record<string, unknown> = {}
  const i2vBytes = readFileSync(`${OUT}/fixture-i2v.jpg`)
  const i2vDataUrl = `data:image/jpeg;base64,${i2vBytes.toString('base64')}`

  // 1) text-to-video
  const t2v = await api('/api/jazmii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Slow aerial drone shot flying over misty green mountains at sunrise, cinematic',
      durationSec: 5,
      quality: 'quality',
    }),
  })
  ev.t2vSubmit = { status: t2v.status, body: t2v.body }
  console.log('t2v submit', t2v.status)

  // 2) image-to-video through the NEW server-side validation path
  const i2v = await api('/api/jazmii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'The camera slowly pushes toward the mountain peaks while clouds drift past the sun',
      imageUrl: i2vDataUrl,
      durationSec: 5,
      quality: 'quality',
    }),
  })
  ev.i2vSubmit = { status: i2v.status, body: i2v.body }
  console.log('i2v submit', i2v.status)

  // 3) invalid-reference rejection probe (defect D3 contract, live)
  const bad = await api('/api/jazmii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'This submission must be rejected before any job row exists',
      imageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    }),
  })
  ev.badRefProbe = { status: bad.status, body: bad.body }
  console.log('bad-ref probe', bad.status, JSON.stringify(bad.body).slice(0, 200))

  const submitted = ev as {
    t2vSubmit: { body?: { job?: { id?: string } } }
    i2vSubmit: { body?: { job?: { id?: string } } }
  }
  const ids = {
    t2v: submitted.t2vSubmit.body?.job?.id ?? null,
    i2v: submitted.i2vSubmit.body?.job?.id ?? null,
  }
  ev.jobIds = ids
  const st0 = loadState()
  st0.jazmii = ev
  saveState(st0)

  const results: Record<string, unknown> = {}
  for (const [name, id] of Object.entries(ids)) {
    if (!id) continue
    results[name] = await pollJob('jazmii', id, 15 * 60_000)
    console.log(`jazmii ${name} →`, JSON.stringify(results[name]).slice(0, 400))
  }
  ev.results = results

  // 4) durable cancellation probe (defect D4 contract, live): submit a t2v
  // job and cancel it right after acceptance; the row must carry
  // cancelRequested=true and settle CANCELLED.
  const cancelProbe = await api('/api/jazmii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Ocean waves crashing on rocks in slow motion at dusk', durationSec: 5 }),
  })
  const cancelId = (cancelProbe.body as { job?: { id?: string } })?.job?.id ?? null
  ev.cancelProbe = { submitStatus: cancelProbe.status, jobId: cancelId }
  if (cancelId) {
    await new Promise((r) => setTimeout(r, 1500))
    const del = await api(`/api/jazmii/jobs/${cancelId}`, { method: 'DELETE' })
    ev.cancelProbe.deleteStatus = del.status
    await new Promise((r) => setTimeout(r, 2500))
    const after = await api(`/api/jazmii/jobs/${cancelId}`)
    ev.cancelProbe.afterDelete = after.body
    console.log('cancel probe →', del.status, JSON.stringify(after.body).slice(0, 300))
  }

  const st = loadState()
  st.jazmii = ev
  saveState(st)
  process.exit(0)
}

if (stage === 'bgrem-only') {
  // Re-run ONLY background removal (e.g. after a pipeline improvement) using
  // the fixture asset recorded in state.
  const st = loadState() as { laxii?: { assets?: { bgAsset?: string } } }
  const bgAsset = st.laxii?.assets?.bgAsset
  if (!bgAsset) {
    console.error('no bgAsset in state — run the laxii stage first')
    process.exit(1)
  }
  const bgr = await api('/api/laxii/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'background-removal', assetId: bgAsset }),
  })
  const id = (bgr.body as { job?: { id?: string } })?.job?.id ?? null
  console.log('bg-removal re-submit', bgr.status, id)
  if (!id) process.exit(1)
  const result = await pollJob('laxii', id, 12 * 60_000)
  console.log('bg-removal rerun →', JSON.stringify(result).slice(0, 500))
  const st2 = loadState()
  st2.bgrRerun = { jobId: id, result }
  saveState(st2)
  process.exit(0)
}

if (stage === 'cancel-durable') {
  // Standalone check of the durable cancel flag in the DB (defect D4).
  const st = loadState() as { jazmii?: { cancelProbe?: { jobId?: string } } }
  const id = st.jazmii?.cancelProbe?.jobId
  if (!id) {
    console.error('no cancel probe job id')
    process.exit(1)
  }
  const { status, body } = await api(`/api/jazmii/jobs/${id}`)
  console.log(status, JSON.stringify(body))
  process.exit(0)
}

if (stage === 'analyze') {
  const sharp = (await import('sharp')).default
  const { execFileSync } = await import('node:child_process')
  const st = loadState() as {
    laxii?: { jobIds?: Record<string, string | null>; results?: Record<string, Record<string, unknown>> }
    jazmii?: { jobIds?: Record<string, string | null>; results?: Record<string, Record<string, unknown>>; cancelProbe?: Record<string, unknown> }
  }
  const out: Record<string, unknown> = {}

  const fetchBytes = async (url: string): Promise<Buffer | null> => {
    const res = await fetch(`${BASE}${url}`, { headers: { cookie: cookieHeader() } })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  }

  // bg-removal: transparent PNG + alpha validation + dimension preservation
  const bgr = st.laxii?.results?.bgr as { videoUrl?: string; assetUrl?: string; imageUrl?: string } | undefined
  const bgrUrl = bgr?.assetUrl ?? bgr?.imageUrl ?? bgr?.videoUrl
  if (bgrUrl) {
    const bytes = await fetchBytes(bgrUrl)
    if (bytes) {
      writeFileSync(`${OUT}/bgrem-result.png`, bytes)
      const meta = await sharp(bytes).metadata()
      const raw = await sharp(bytes).ensureAlpha().raw().toBuffer()
      let transparent = 0
      let opaque = 0
      const px = meta.width! * meta.height!
      for (let i = 3; i < raw.length; i += 4) {
        if (raw[i] === 0) transparent += 1
        else if (raw[i] === 255) opaque += 1
      }
      out.bgrem = {
        format: meta.format,
        width: meta.width,
        height: meta.height,
        bytes: bytes.length,
        transparentFraction: Number((transparent / px).toFixed(4)),
        opaqueFraction: Number((opaque / px).toFixed(4)),
        hasAlphaChannel: meta.hasAlpha === true,
      }
    }
  }

  // videos: ffprobe both outputs
  for (const key of ['t2v', 'i2v'] as const) {
    const job = st.jazmii?.results?.[key] as { videoUrl?: string } | undefined
    if (job?.videoUrl) {
      const bytes = await fetchBytes(job.videoUrl)
      if (bytes) {
        writeFileSync(`${OUT}/${key}-result.mp4`, bytes)
        const tmp = `${OUT}/${key}-probe.mp4`
        try {
          const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', tmp], { timeout: 20_000 }).toString())
          const v = (j.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === 'video')
          out[key] = {
            bytes: bytes.length,
            codec: v?.codec_name,
            width: v?.width,
            height: v?.height,
            durationSec: Number(v?.duration ?? j.format?.duration),
            frames: v?.nb_frames,
          }
        } catch (e) {
          out[key] = { ffprobeError: String(e).slice(0, 200) }
        }
      }
    }
  }

  out.cancelProbe = st.jazmii?.cancelProbe ?? null
  writeFileSync(`${OUT}/analysis.json`, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  process.exit(0)
}

console.error('unknown stage:', stage)
process.exit(2)
