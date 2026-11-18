/**
 * M26.2 — LAXII & JAZMII full-capability acceptance run against the REAL
 * dev server. Every capability claim is exercised through the actual HTTP
 * routes, durable queue, worker pools and storage — REAL model inference,
 * REAL media artifacts. Failures are recorded honestly, never retried into
 * fake success.
 *
 * Run: bun scripts/m262/acceptance.ts   (dev server on :3000 required)
 * Out:  scripts/m262-out/acceptance.json
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { Database } from 'bun:sqlite'

const BASE = 'http://localhost:3000'
const OUT_DIR = 'scripts/m262-out'
mkdirSync(OUT_DIR, { recursive: true })

/** Read-only DB access for persisted result payloads (evidence extraction). */
function jobRowFromDb(jobId: string): { status: string; resultJson: string | null; errorMessage: string | null; errorCode: string | null } | null {
  // The deployment's DATABASE_URL wins (process env overrides .env) — resolve
  // the SQLite file path from it, exactly like the running server does.
  const raw = process.env.DATABASE_URL ?? ''
  const file = raw.startsWith('file:') ? raw.slice(5) : raw
  if (!file) throw new Error('DATABASE_URL is not set — cannot read persisted job evidence')
  const dbPath = path.isAbsolute(file) ? file : path.join(process.cwd(), file)
  const db = new Database(dbPath, { readonly: true })
  try {
    const row = db.query('SELECT status, resultJson, errorMessage, errorCode FROM GenerationJob WHERE id = ?').get(jobId) as
      | { status: string; resultJson: string | null; errorMessage: string | null; errorCode: string | null }
      | undefined
    return row ?? null
  } finally {
    db.close()
  }
}

interface Step {
  step: string
  ok: boolean
  status: number | null
  detail: string
  evidence?: unknown
  at: string
}
const steps: Step[] = []
function record(step: string, ok: boolean, status: number | null, detail: string, evidence?: unknown) {
  const s = { step, ok, status, detail, at: new Date().toISOString(), ...(evidence !== undefined ? { evidence } : {}) }
  steps.push(s)
  console.log(`${ok ? 'PASS' : 'NOTE'} ${step} :: ${detail}${status != null ? ` [HTTP ${status}]` : ''}`)
}

function jar() {
  let cookie = ''
  return {
    async call(pathname: string, init: RequestInit = {}): Promise<Response> {
      const res = await fetch(`${BASE}${pathname}`, {
        ...init,
        headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
      })
      const setCookie = res.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      return res
    },
  }
}

async function pollJob(
  j: ReturnType<typeof jar>,
  jobId: string,
  product: 'laxii' | 'jazmii',
  timeoutMs = 240_000,
): Promise<{ status: string; result: Record<string, unknown>; errorMessage: string | null; errorCode: string | null }> {
  const t0 = Date.now()
  for (;;) {
    let body: Record<string, unknown> = {}
    try {
      const res = await j.call(`/api/${product}/jobs/${jobId}`)
      body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    } catch (e) {
      // Transient dev-server recompile/crash during polling — retry a few
      // times before giving up (the job state lives in the durable row).
      const msg = e instanceof Error ? e.message : String(e)
      if (Date.now() - t0 > timeoutMs) {
        return { status: 'poll-error', result: {}, errorMessage: msg.slice(0, 160), errorCode: 'POLL_ERROR' }
      }
      await new Promise((r) => setTimeout(r, 3000))
      continue
    }
    const job = (body.job ?? body) as Record<string, unknown>
    const status = String(job.status ?? 'unknown')
    if (['completed', 'failed', 'cancelled', 'rejected'].includes(status)) {
      // Persisted payload from the durable row (resultJson) — the routes
      // return serialized views; the row carries the full measured evidence.
      const row = jobRowFromDb(jobId)
      let result: Record<string, unknown> = {}
      if (row?.resultJson) {
        try { result = JSON.parse(row.resultJson) as Record<string, unknown> } catch { /* keep {} */ }
      }
      return {
        status,
        result,
        errorMessage: row?.errorMessage ?? (job.errorMessage as string) ?? null,
        errorCode: row?.errorCode ?? (job.errorCode as string) ?? null,
      }
    }
    if (Date.now() - t0 > timeoutMs) {
      return { status: 'poll-timeout', result: {}, errorMessage: `poll exceeded ${timeoutMs}ms (last status ${status})`, errorCode: 'POLL_TIMEOUT' }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
}

// ---- REAL media fixtures (free-license photographs, committed under scripts/m262/fixtures) ----
// Real photographs are required so the matting/saliency models behave as they
// do on genuine user media (synthetic flat images produce unreliable maps).
// Provenance and licenses: scripts/m262/fixtures/PROVENANCE.md (Pexels License).
const FIXTURE_DIR = 'scripts/m262/fixtures'

async function makePortraitFixture(file: string): Promise<Buffer> {
  const jpg = await sharp(path.join(FIXTURE_DIR, 'portrait.jpg')).rotate().jpeg({ quality: 92 }).toBuffer()
  writeFileSync(file, jpg)
  return jpg
}

async function makeStudioPortraitFixture(file: string): Promise<Buffer> {
  const jpg = await sharp(path.join(FIXTURE_DIR, 'portrait-studio.jpg')).rotate().jpeg({ quality: 92 }).toBuffer()
  writeFileSync(file, jpg)
  return jpg
}

async function makeSceneFixture(file: string): Promise<Buffer> {
  const jpg = await sharp(path.join(FIXTURE_DIR, 'scene.jpg')).rotate().jpeg({ quality: 92 }).toBuffer()
  writeFileSync(file, jpg)
  return jpg
}

async function uploadAsset(j: ReturnType<typeof jar>, bytes: Buffer, filename: string, mime = 'image/png', kind: 'reference' | 'original' | 'mask' = 'original'): Promise<{ id: string } | null> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), filename)
  form.append('kind', kind)
  const res = await j.call('/api/laxii/assets', { method: 'POST', body: form })
  if (res.status !== 200 && res.status !== 201) return null
  const body = (await res.json().catch(() => ({}))) as { asset?: { id?: string } }
  return body.asset?.id ? { id: body.asset.id } : null
}

async function downloadAsset(j: ReturnType<typeof jar>, url: string): Promise<Buffer | null> {
  const res = await j.call(url)
  if (res.status !== 200) return null
  return Buffer.from(await res.arrayBuffer())
}

// ==============================================================================
console.log('== M26.2 acceptance — real inference through the real pipeline ==')
const stamp = Date.now()

// ---- 0. auth -----------------------------------------------------------------
const admin = jar()
await admin.call('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `m262-admin-${stamp}@bean.local`, password: 'Bean-Accept-2026!', name: 'M262 Admin' }),
})
const login = await admin.call('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `m262-admin-${stamp}@bean.local`, password: 'Bean-Accept-2026!' }),
})
record('auth: acceptance session', login.status === 200, login.status, 'first registered account (admin) logged in')

// ---- 1. model states (real on-disk, hash-verified) ----------------------------
{
  const res = await admin.call('/api/laxii/local-models')
  const body = (await res.json().catch(() => ({}))) as { models?: Array<{ id: string; state: string; sha256Ok: boolean | null }> }
  const models = body.models ?? []
  const allReady = models.length === 4 && models.every((m) => m.state === 'ready' && m.sha256Ok === true)
  record('models: all four local models ready (SHA-256 verified)', allReady, res.status, models.map((m) => `${m.id}:${m.state}`).join(' '), models)
}

// ---- 2. LAXII conversational edit (local engine, real pixel ops) --------------
let historyAssetId: string | null = null
{
  const portrait = await makePortraitFixture('/tmp/m262-portrait.png')
  const up = await uploadAsset(admin, portrait, 'portrait.png')
  if (!up) {
    record('laxii-edit: fixture upload', false, null, 'asset upload failed')
  } else {
    historyAssetId = up.id
    // 2a. destructive approval gate — refuse WITHOUT approval
    const refused = await admin.call('/api/laxii/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'conversational-edit', assetId: up.id, prompt: 'rotate right', engine: 'local' }),
    })
    record('laxii-edit: destructive op refused without approval', refused.status === 400, refused.status, 'rotate/flip requires explicit approval before any job is queued')

    // 2b. generative refusal — honest unsupported
    const unsupported = await admin.call('/api/laxii/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'conversational-edit', assetId: up.id, prompt: 'add a golden crown on the head', engine: 'local' }),
    })
    record('laxii-edit: generative synthesis refused honestly', unsupported.status === 422 || unsupported.status === 400, unsupported.status, 'add-content instruction is refused with the precise reason (CAPABILITY_UNSUPPORTED family)')

    // 2c. REAL tone/look edit with approval
    const submit = await admin.call('/api/laxii/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'conversational-edit', assetId: up.id, prompt: 'brighten and make it warmer', engine: 'local' }),
    })
    const submitBody = (await submit.json().catch(() => ({}))) as { job?: { id?: string } }
    if (submit.status !== 202 || !submitBody.job?.id) {
      record('laxii-edit: real edit submit', false, submit.status, JSON.stringify(submitBody).slice(0, 160))
    } else {
      const done = await pollJob(admin, submitBody.job.id, 'laxii')
      const executedOps = (done.result.executedOps as Array<{ type: string }>) ?? []
      const ok = done.status === 'completed' && executedOps.length > 0
      record('laxii-edit: REAL local edit completed', ok, submit.status, done.status === 'completed' ? `executed ops: ${executedOps.map((o) => o.type).join('+')}` : `honest failure: ${done.errorMessage}`, { executedOps, imageUrl: done.result.imageUrl ?? null })
      if (ok && typeof done.result.imageUrl === 'string') {
        const bytes = await downloadAsset(admin, done.result.imageUrl)
        if (bytes) {
          const meta = await sharp(bytes).metadata()
          const origMeta = await sharp(portrait).metadata()
          const dimsOk = meta.width === origMeta.width && meta.height === origMeta.height
          const origRaw = await sharp(portrait).removeAlpha().raw().toBuffer()
          const newRaw = await sharp(bytes).removeAlpha().raw().toBuffer()
          let changed = 0
          for (let i = 0; i < Math.min(origRaw.length, newRaw.length); i++) if (Math.abs(origRaw[i] - newRaw[i]) > 8) changed++
          record('laxii-edit: result is a REAL edited image', changed > origRaw.length * 0.02 && dimsOk, null, `${changed} pixels changed (${((changed / origRaw.length) * 100).toFixed(1)}%), dims ${meta.width}x${meta.height} (source ${origMeta.width}x${origMeta.height})`)
        }
      }
    }
  }
}

// ---- 3. LAXII background removal (REAL matting, transparent PNG) --------------
{
  // The transparent-PNG claim is exercised on the REAL studio portrait: the
  // portrait matte (MODNet) yields a true subject/background separation, so
  // the exported PNG must contain BOTH real transparent pixels (background)
  // and real opaque pixels (subject). The scene photo is exercised by object
  // removal (step 4) and the honest-unsupported step uses a pure gradient.
  const studio = await makeStudioPortraitFixture('/tmp/m262-bgrem.png')
  const up = await uploadAsset(admin, studio, 'bgrem-source.png')
  if (!up) {
    record('laxii-bgrem: fixture upload', false, null, 'asset upload failed')
  } else {
    const submit = await admin.call('/api/laxii/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'background-removal', assetId: up.id, engine: 'local', output: 'png' }),
    })
    const submitBody = (await submit.json().catch(() => ({}))) as { job?: { id?: string } }
    if (submit.status !== 202 || !submitBody.job?.id) {
      record('laxii-bgrem: submit', false, submit.status, JSON.stringify(submitBody).slice(0, 160))
    } else {
      const done = await pollJob(admin, submitBody.job.id, 'laxii')
      const matte = (done.result.matte as Record<string, unknown>) ?? {}
      const ok = done.status === 'completed' && done.result.transparent === true
      record('laxii-bgrem: REAL matting completed', ok, submit.status, done.status === 'completed' ? `matte=${matte.model} subjectFraction=${matte.subjectFraction} ${done.result.width}x${done.result.height}` : `honest failure: ${done.errorMessage}`, matte)
      if (ok && typeof done.result.imageUrl === 'string') {
        const bytes = await downloadAsset(admin, done.result.imageUrl)
        if (bytes) {
          const img = sharp(bytes)
          const meta = await img.metadata()
          const rgba = await img.ensureAlpha().raw().toBuffer()
          let transparent = 0
          let opaque = 0
          for (let i = 3; i < rgba.length; i += 4) { if (rgba[i] === 0) transparent++; else if (rgba[i] === 255) opaque++ }
          const alphaPresent = meta.channels === 4
          // source-preservation is claimed against the FIXTURE's own dims
          // (dynamic — the fixture is a real photograph, not a synthetic size)
          const srcMeta = await sharp(studio).metadata()
          const dimsOk = meta.width === srcMeta.width && meta.height === srcMeta.height
          record('laxii-bgrem: transparent PNG verified', alphaPresent && transparent > rgba.length / 4 * 0.05 && opaque > rgba.length / 4 * 0.05 && dimsOk, null, `channels=${meta.channels} transparentFraction=${(transparent / (rgba.length / 4)).toFixed(3)} opaqueFraction=${(opaque / (rgba.length / 4)).toFixed(3)} dims=${meta.width}x${meta.height} (source preserved: ${dimsOk})`)
        }
      }
      // 3b. JPEG with explicit background
      const submit2 = await admin.call('/api/laxii/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'background-removal', assetId: up.id, engine: 'local', output: 'jpeg', backgroundColor: '#ffffff' }),
      })
      const submit2Body = (await submit2.json().catch(() => ({}))) as { job?: { id?: string } }
      if (submit2.status === 202 && submit2Body.job?.id) {
        const done2 = await pollJob(admin, submit2Body.job.id, 'laxii')
        record('laxii-bgrem: JPEG-with-background export', done2.status === 'completed' && done2.result.format === 'jpeg', submit2.status, done2.status === 'completed' ? `format=${done2.result.format} bg=${done2.result.provenance ? JSON.stringify((done2.result.provenance as Record<string, unknown>).flattenedBackgroundColor) : '?'}` : done2.errorMessage ?? 'failed')
      }
    }
  }
}

// ---- 4. LAXII masked object removal (REAL LaMa inpaint) ------------------------
{
  const scene = await makeSceneFixture('/tmp/m262-removal-src.jpg')
  const up = await uploadAsset(admin, scene, 'removal-source.jpg')
  if (up) {
    // Mask a real 180x120 background corner of the 800x600 scene photo —
    // LaMa fills it from the surrounding real content.
    const maskSvg = `<svg width="800" height="600"><rect x="560" y="20" width="180" height="120" fill="white"/></svg>`
    const maskPng = await sharp(Buffer.from(maskSvg)).png().toBuffer()
    const maskUp = await uploadAsset(admin, maskPng, 'mask.png', 'image/png', 'mask')
    if (maskUp) {
      const submit = await admin.call('/api/laxii/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'object-removal', assetId: up.id, maskStrokes: [{ assetId: maskUp.id, kind: 'edit' }] }),
      })
      const submitBody = (await submit.json().catch(() => ({}))) as { job?: { id?: string } }
      if (submit.status !== 202 || !submitBody.job?.id) {
        record('laxii-removal: submit (local LaMa)', false, submit.status, JSON.stringify(submitBody).slice(0, 160))
      } else {
        const done = await pollJob(admin, submitBody.job.id, 'laxii')
        const prov = (done.result.provenance as Record<string, unknown>) ?? {}
        record('laxii-removal: REAL LaMa object removal', done.status === 'completed' && prov.engine === 'lama-object-removal', submit.status, done.status === 'completed' ? `engine=${prov.engine} (masked-region inpaint)` : `honest failure: ${done.errorMessage}`, prov)
        if (done.status === 'completed' && typeof done.result.imageUrl === 'string') {
          const bytes = await downloadAsset(admin, done.result.imageUrl)
          if (bytes) {
            // Outside the SHAPED edit band, pixels must be EXACTLY the
            // original. The job's mask is dilated (expandPx 4) and feathered
            // (gaussian sigma 8, 3-sigma kernel = 24px) by design, so
            // alpha>0 up to 28px beyond the brush rect — that rim band is
            // legitimately blended. The claim covers everything beyond it:
            // pixels whose Chebyshev distance to the brush rect exceeds 30
            // (dilateMask is a separable square kernel → Chebyshev geometry).
            const origRaw = await sharp(scene).removeAlpha().raw().toBuffer()
            const newRaw = await sharp(bytes).removeAlpha().raw().toBuffer()
            const W = 800, H = 600
            const D = 30 // > 4 + 24 shaped band
            let outsideDiff = 0
            let outsideTotal = 0
            for (let y = 0; y < H; y++) {
              for (let x = 0; x < W; x++) {
                const dx = Math.max(560 - x, x - 739, 0)
                const dy = Math.max(20 - y, y - 139, 0)
                if (Math.max(dx, dy) > D) {
                  outsideTotal++
                  const p = y * W + x
                  for (let c = 0; c < 3; c++) if (origRaw[p * 3 + c] !== newRaw[p * 3 + c]) { outsideDiff++; break }
                }
              }
            }
            record('laxii-removal: outside-mask pixels EXACT', outsideDiff === 0, null, `${outsideDiff}/${outsideTotal} pixels beyond the shaped edit band differ from the original (0 = preservation holds)`)
          }
        }
      }
    }
  }
}

// ---- 5. Edit history + undo ----------------------------------------------------
{
  if (historyAssetId) {
    const list = await admin.call(`/api/laxii/history?assetId=${historyAssetId}`)
    const body = (await list.json().catch(() => ({}))) as { entries?: Array<{ id: string; engine: string; undoneAt: string | null }> }
    const entries = body.entries ?? []
    record('laxii-history: lineage recorded', entries.length > 0, list.status, `${entries.length} entr(ies): ${entries.map((e) => e.engine).join(', ')}`)
    const realEdit = entries.find((e) => e.engine !== 'restore' && !e.undoneAt)
    if (realEdit) {
      const undo = await admin.call('/api/laxii/history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ historyId: realEdit.id }) })
      const undoBody = (await undo.json().catch(() => ({}))) as { restore?: { engine: string; ops?: Array<Record<string, unknown>> } }
      record('laxii-history: REAL undo/restore', undo.status === 200 && undoBody.restore?.engine === 'restore', undo.status, undoBody.restore ? 'restore row appended; pre-edit pixels copied to a fresh asset' : 'undo failed')
    }
  } else {
    record('laxii-history: lineage recorded', false, null, 'no asset available from earlier steps')
  }
}

// ---- 6. JAZMII REAL image-to-video (local motion lane) -------------------------
{
  const scene = await makeSceneFixture('/tmp/m262-i2v-src.jpg')
  const dataUrl = `data:image/jpeg;base64,${scene.toString('base64')}`
  // 6a. unsupported subject motion refused honestly
  const bad = await admin.call('/api/jazmii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'make the object walk around the scene', imageUrl: dataUrl, engine: 'local-motion', size: '480x480', durationSec: 3 }),
  })
  record('jazmii-i2v: subject-motion request refused honestly', bad.status >= 400 && bad.status < 500, bad.status, 'the local motion lane cannot perform subject motion — precise reason returned before any job')

  // 6b. REAL generation
  const submit = await admin.call('/api/jazmii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'slow zoom in, cinematic', imageUrl: dataUrl, engine: 'local-motion', size: '416x416', durationSec: 3, fps: 12 }),
  })
  const submitBody = (await submit.json().catch(() => ({}))) as { job?: { id?: string; engine?: string } }
  if (submit.status !== 202 || !submitBody.job?.id) {
    record('jazmii-i2v: submit', false, submit.status, JSON.stringify(submitBody).slice(0, 160))
  } else {
    record('jazmii-i2v: accepted on local-motion lane', submitBody.job.engine === 'local-motion', submit.status, `job ${submitBody.job.id} resolved to lane ${submitBody.job.engine}`)
    const done = await pollJob(admin, submitBody.job.id, 'jazmii', 420_000)
    const stream = (done.result.stream as Record<string, unknown>) ?? {}
    const prov = (done.result.provenance as Record<string, unknown>) ?? null
    const lane = prov === null ? (done.result as Record<string, unknown>) : prov
    const ok = done.status === 'completed' && typeof done.result.videoUrl === 'string'
    record('jazmii-i2v: REAL video generated', ok, submit.status, done.status === 'completed' ? `stream=${JSON.stringify(stream)} lane-engine recorded` : `honest failure: ${done.errorMessage}`, { engineField: (done.result as Record<string, unknown>).provenance ?? null })
    if (ok && typeof done.result.videoUrl === 'string') {
      const video = await downloadAsset(admin, done.result.videoUrl)
      if (video) {
        const isMp4 = video.length > 4 && video[4] === 0x66 && video[5] === 0x74 && video[6] === 0x79 && video[7] === 0x70
        const frames = Number(stream.frames ?? 0)
        record('jazmii-i2v: real playable artifact (owner-served)', isMp4 && frames > 10 && video.length > 20_000, null, `${video.length} bytes mp4 magic=${isMp4} ffprobe frames=${frames} codec=${stream.codec} ${stream.width}x${stream.height}@${stream.fps} duration=${stream.durationSec}s`)
        // The lane class disclosure must be present in the job record.
        const resultStr = JSON.stringify(done.result)
        record('jazmii-i2v: lane class disclosed (not diffusion)', resultStr.includes('local-motion') || resultStr.includes('local motion'), null, 'provenance/result states the motion-animation lane class honestly')
      }
      // 6c. ownership: a second user must NOT access the video
      const intruder = jar()
      await intruder.call('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `m262-intruder-${stamp}@bean.local`, password: 'Bean-Accept-2026!', name: 'M262 Intruder' }),
      })
      await intruder.call('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `m262-intruder-${stamp}@bean.local`, password: 'Bean-Accept-2026!' }),
      })
      const stolen = await intruder.call(done.result.videoUrl as string)
      record('jazmii-i2v: media ownership enforced', stolen.status === 404 || stolen.status === 401 || stolen.status === 403, stolen.status, `intruder access attempt answered ${stolen.status}`)
    }
  }
}

// ---- 6c. cancellation: a queued local I2V job can be cancelled honestly -------
{
  const scene = await makeSceneFixture('/tmp/m262-i2v-src2.jpg')
  const dataUrl = `data:image/jpeg;base64,${scene.toString('base64')}`
  const submit = await admin.call('/api/jazmii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'gentle zoom out', imageUrl: dataUrl, engine: 'local-motion', size: '416x416', durationSec: 10, fps: 24 }),
  })
  const submitBody = (await submit.json().catch(() => ({}))) as { job?: { id?: string } }
  if (submit.status === 202 && submitBody.job?.id) {
    const cancel = await admin.call(`/api/jazmii/jobs/${submitBody.job.id}`, { method: 'DELETE' })
    const cancelBody = (await cancel.json().catch(() => ({}))) as Record<string, unknown>
    // Poll briefly: a cancelled job must settle honestly (not hang, not complete).
    // The legacy vocabulary marks cancelled rows as status 'failed' with the
    // CANCELLED error code (documented at the cancel route) — both spellings
    // are the honest settled state; a COMPLETED row would be the failure.
    const done = await pollJob(admin, submitBody.job.id, 'jazmii', 60_000)
    const settledCancelled =
      done.status === 'cancelled' || (done.status === 'failed' && done.errorCode === 'CANCELLED')
    record(
      'jazmii-i2v: cancellation honored',
      cancel.status === 200 && cancelBody.cancelled === true && settledCancelled && !done.result.videoUrl,
      cancel.status,
      `cancel accepted=${cancelBody.cancelled === true}, settled as '${done.status}/${done.errorCode ?? '-'}' (no artifact stored)`,
    )
  } else {
    record('jazmii-i2v: cancellation honored', false, submit.status, 'could not submit a cancellable job')
  }
}

// ---- 7. LAXII background-removal honest unsupported case -----------------------
{
  // A uniform image has NO separable subject — both matting models measure
  // it honestly (MODNet subject fraction ~0.0003) and the lane must refuse
  // with the measured reason, never a fake cutout. (A linear gradient is NOT
  // a reliable no-subject probe: once the matte pipeline was fixed, MODNet
  // legitimately finds gradient structure in it.)
  const flat = await sharp({ create: { width: 320, height: 320, channels: 3, background: '#808080' } }).png().toBuffer()
  const up = await uploadAsset(admin, flat, 'flat-gray.png')
  if (up) {
    const submit = await admin.call('/api/laxii/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'background-removal', assetId: up.id, engine: 'local' }),
    })
    const submitBody = (await submit.json().catch(() => ({}))) as { job?: { id?: string } }
    if (submit.status === 202 && submitBody.job?.id) {
      const done = await pollJob(admin, submitBody.job.id, 'laxii')
      // The refusal must be the HONEST no-subject gate, never a 429 artifact.
      const honestFail = done.status === 'failed' && /subject|salient|matte/i.test(done.errorMessage ?? '')
      record('laxii-bgrem: no-subject image fails honestly', honestFail, submit.status, done.status === 'failed' ? `honest failure: ${(done.errorMessage ?? '').slice(0, 140)}` : done.status === 'completed' ? 'unexpected success — a subject was found in a pure gradient' : `non-terminal: ${done.status}`)
    } else {
      record('laxii-bgrem: no-subject image fails honestly', submit.status >= 400 && submit.status !== 429, submit.status, 'refused at submit time with a reason (429 would be an unrelated concurrency artifact)')
    }
  }
}

// ---- 8. capability rows (health payload — measured) ----------------------------
{
  const res = await admin.call('/api/health')
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const products = (body.products ?? {}) as Record<string, { capabilities?: Array<{ id: string; state: string }> }>
  const all = [...(products.laxii?.capabilities ?? []), ...(products.jazmii?.capabilities ?? [])]
  const rows = ['conversational-editing', 'background-removal', 'image-to-video'].map((k) => ({
    id: k,
    state: all.find((c) => c.id === k)?.state ?? 'missing',
  }))
  record('health: capability rows measured', rows.every((r) => r.state !== 'missing'), res.status, rows.map((r) => `${r.id}=${r.state}`).join(' '), rows)
}

const okCount = steps.filter((s) => s.ok).length
console.log(`\n== acceptance summary: ${okCount}/${steps.length} steps PASS ==`)
writeFileSync(path.join(OUT_DIR, 'acceptance.json'), JSON.stringify({ at: new Date().toISOString(), passed: okCount, total: steps.length, steps }, null, 2))
console.log(`evidence written to ${OUT_DIR}/acceptance.json`)
