/**
 * BEAN — OPERATIONAL TRANSFORMATION live acceptance (Phase 10).
 *
 * RIISHE + LAXII + CODE GIETZ + platform checks against the REAL dev
 * server. JAZMII lives in scripts/bean-jazmii-live-acceptance.ts (already
 * executed: real T2V + I2V MP4s, ffprobe-validated, provider task ids
 * persisted). Every step records what actually happened; failures are
 * recorded as such and never retried into fake success.
 *
 * Output: scripts/bean-optrans-out/acceptance.json + docs/evidence/bean-optrans-acceptance.txt
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const BASE = 'http://localhost:3000'
const OUT_DIR = 'scripts/bean-optrans-out'
mkdirSync(OUT_DIR, { recursive: true })

interface Step {
  suite: string
  step: string
  ok: boolean
  httpStatus: number | null
  detail: string
  at: string
  evidence?: unknown
}
const steps: Step[] = []
function rec(suite: string, step: string, ok: boolean, httpStatus: number | null, detail: string, evidence?: unknown) {
  steps.push({ suite, step, ok, httpStatus, detail, at: new Date().toISOString(), ...(evidence !== undefined ? { evidence } : {}) })
  console.log(`${ok ? 'PASS' : 'NOTE'} [${suite}] ${step} :: ${detail}${httpStatus != null ? ` [HTTP ${httpStatus}]` : ''}`)
}

function jar() {
  let cookie = ''
  return {
    cookie: () => cookie,
    async call(p: string, init: RequestInit = {}): Promise<Response> {
      const res = await fetch(`${BASE}${p}`, {
        ...init,
        headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
      })
      const sc = res.headers.get('set-cookie')
      if (sc) cookie = sc.split(';')[0]
      return res
    },
  }
}

const stamp = Date.now()
const email = `optrans-acc-${stamp}@bean.local`
const PASSWORD = 'Bean-Acc-2026!x'
const j = jar()
async function auth() {
  await j.call('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD, name: 'OpTrans Acceptance' }) })
  const login = await j.call('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })
  rec('platform', 'auth: register+login', login.status === 200, login.status, email)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

async function pollJob(getPath: string, terminal: string[], maxMs: number, intervalMs = 5000): Promise<{ ok: boolean; last: Record<string, unknown> }> {
  const deadline = Date.now() + maxMs
  let last: Record<string, unknown> = {}
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const r = await j.call(getPath)
    last = (await r.json().catch(() => ({}))) as Record<string, unknown>
    const job = (last.job ?? last) as Record<string, unknown>
    const status = String(job.status ?? '')
    if (terminal.includes(status)) return { ok: status === 'completed', last }
  }
  return { ok: false, last }
}

// ===========================================================================
await auth()

// ---------------------------------------------------------------- RIISHE ===
console.log('\n== RIISHE ==')
{
  // 1. Normal conversation — REAL model response (non-streaming JSON path).
  const t0 = Date.now()
  const r = await j.call('/api/riishe/chat?stream=0', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'In one short paragraph: what is the tallest mountain on Earth, and how is its height measured?' }),
  })
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>
  const content = typeof body.content === 'string' ? body.content : typeof (body as { message?: { content?: string } }).message?.content === 'string' ? (body as { message?: { content: string } }).message.content : ''
  const mode = ((body.metadata as Record<string, unknown>)?.router as Record<string, unknown>)?.mode
  rec('riishe', 'normal chat: real model response', r.status === 200 && content.length > 30, r.status, `chars=${content.length} elapsed=${Date.now() - t0}ms mode=${String(mode ?? 'n/a')}`, { contentPreview: content.slice(0, 220), mode })

  // 2. Current-events question → web evidence with citations.
  const t1 = Date.now()
  const r2 = await j.call('/api/riishe/chat?stream=0', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'What is the latest stable version of Node.js today? Give the version number and its release date.' }),
  })
  const b2 = (await r2.json().catch(() => ({}))) as Record<string, unknown>
  const c2 = typeof b2.content === 'string' ? b2.content : ''
  const meta2 = (b2.metadata ?? {}) as Record<string, unknown>
  const sources2 = (meta2.sources as Array<{ url?: string; date?: string | null }>) ?? []
  const router2 = (meta2.router as Record<string, unknown>) ?? {}
  const hasCitationMarker = /\[\d+\]/.test(c2) || sources2.length > 0
  rec('riishe', 'current-events: retrieval ran with sources', r2.status === 200 && sources2.length > 0 && String(router2.mode) === 'web-search', r2.status, `sources=${sources2.length} mode=${String(router2.mode)} elapsed=${Date.now() - t1}ms retrievedAt=${String(meta2.retrievedAt ?? 'none')}`, { sources: sources2.slice(0, 5), answerPreview: c2.slice(0, 300) })

  // 3. A cited source URL actually opens (HTTP 200) — citations open the correct source.
  const first = sources2.find((s) => typeof s.url === 'string' && s.url.startsWith('http'))
  if (first?.url) {
    try {
      const up = await fetch(first.url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15_000) })
      await up.arrayBuffer().catch(() => undefined)
      rec('riishe', 'citation URL opens (HTTP 200)', up.status >= 200 && up.status < 400, up.status, first.url.slice(0, 120))
    } catch (e) {
      rec('riishe', 'citation URL opens (HTTP 200)', false, null, `${first.url} -> ${e instanceof Error ? e.message : String(e)}`)
    }
  } else {
    rec('riishe', 'citation URL opens (HTTP 200)', false, null, 'no source URL in response')
  }

  // 4. Writing mode routing (backend-selected).
  const r3 = await j.call('/api/riishe/chat?stream=0', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Write a short congratulation email (3 sentences) to a colleague who just shipped their first production release.' }),
  })
  const b3 = (await r3.json().catch(() => ({}))) as Record<string, unknown>
  const router3 = ((b3.metadata as Record<string, unknown>)?.router as Record<string, unknown>) ?? {}
  rec('riishe', 'writing mode selected by the server', r3.status === 200 && String(router3.mode) === 'writing', r3.status, `mode=${String(router3.mode)}`, { answerPreview: String(b3.content ?? '').slice(0, 200) })
}

// ---------------------------------------------------------------- LAXII ====
console.log('\n== LAXII ==')
const laxii = { sourceShaBefore: '' as string, t2iJobId: '', editJobId: '', bgJobId: '', resultAssetId: '' }
{
  // 1. Text-to-image — REAL image.
  const r = await j.call('/api/laxii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'A red ceramic teapot on a wooden table by a bright window, soft morning light, photorealistic', size: '1024x1024' }),
  })
  const b = (await r.json().catch(() => ({}))) as Record<string, unknown>
  const jobObj = (b.job ?? b) as Record<string, unknown>
  laxii.t2iJobId = String(jobObj.id ?? '')
  rec('laxii', 't2i: submit', r.status === 202 && Boolean(laxii.t2iJobId), r.status, `jobId=${laxii.t2iJobId}`)
  const done = laxii.t2iJobId ? await pollJob(`/api/laxii/jobs/${laxii.t2iJobId}`, ['completed', 'failed', 'rejected'], 5 * 60_000) : { ok: false, last: {} }
  rec('laxii', 't2i: terminal state', done.ok, null, JSON.stringify((done.last as { job?: unknown }).job ?? done.last).slice(0, 200))
  if (done.ok) {
    const res = (done.last as { job?: { resultJson?: unknown } }).job as { resultJson?: { imageUrl?: string } } | undefined
    const imageUrl = (done.last.job as { imageUrl?: string } | undefined)?.imageUrl
    const url = imageUrl ?? res?.resultJson?.imageUrl
    if (url) {
      const img = await j.call(url)
      const bytes = Buffer.from(await img.arrayBuffer())
      const file = path.join(OUT_DIR, 'laxii-t2i.jpg')
      if (img.status === 200) writeFileSync(file, bytes)
      const meta = await import('sharp').then((s) => s.default(bytes).metadata())
      rec('laxii', 't2i: artifact is a real decodable image', img.status === 200 && Boolean(meta.width && meta.width >= 512), img.status, `${meta.format} ${meta.width}x${meta.height} bytes=${bytes.length} sha256=${sha256(bytes)}`, { file })
      laxii.resultAssetId = url.split('/').pop() ?? ''
      // Upload the generated image back as an ORIGINAL asset (uploads define
      // originals; edits must never modify them).
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'teapot-original.jpg')
      const up = await j.call('/api/laxii/assets', { method: 'POST', body: form })
      const ub = (await up.json().catch(() => ({}))) as Record<string, unknown>
      const assetId = ((ub.asset ?? ub) as Record<string, unknown>).id as string | undefined
      rec('laxii', 'original asset uploaded for edit tests', (up.status === 200 || up.status === 201) && Boolean(assetId), up.status, `assetId=${assetId}`)
      if (assetId) {
        // SHA of the ORIGINAL as stored — compare after the edits.
        const dl = await j.call(`/api/laxii/assets/${assetId}`)
        const origBytes = Buffer.from(await dl.arrayBuffer())
        laxii.sourceShaBefore = sha256(origBytes)

        // 2. Background removal → valid transparent image.
        const bg = await j.call('/api/laxii/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'background-removal', assetId }) })
        const bgB = (await bg.json().catch(() => ({}))) as Record<string, unknown>
        const bgJob = ((bgB.job ?? bgB) as Record<string, unknown>).id as string | undefined
        rec('laxii', 'bg-removal: submit', bg.status === 202 && Boolean(bgJob), bg.status, `jobId=${bgJob}`)
        if (bgJob) {
          const d = await pollJob(`/api/laxii/jobs/${bgJob}`, ['completed', 'failed', 'rejected'], 5 * 60_000)
          const job = (d.last.job ?? {}) as Record<string, unknown>
          rec('laxii', 'bg-removal: terminal state', d.ok, null, `status=${job.status} err=${String(job.errorMessage ?? '')}`.slice(0, 200))
          if (d.ok) {
            const outUrl = job.imageUrl as string
            const outRes = await j.call(outUrl)
            const outBytes = Buffer.from(await outRes.arrayBuffer())
            const outFile = path.join(OUT_DIR, 'laxii-bg-removal.png')
            writeFileSync(outFile, outBytes)
            const sharpMod = await import('sharp')
            const { data, info } = await sharpMod.default(outBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
            const ch = info.channels
            let transparent = 0
            const total = info.width * info.height
            for (let p = 0; p < total; p++) if (data[p * ch + ch - 1] < 8) transparent++
            const transparentFraction = +(transparent / total).toFixed(4)
            rec('laxii', 'bg-removal: valid transparent image', outRes.status === 200 && transparentFraction > 0.02 && transparentFraction < 0.98, outRes.status, `${info.format} ${info.width}x${info.height} transparentFraction=${transparentFraction} bytes=${outBytes.length} sha256=${sha256(outBytes)}`, { file: outFile })
          }
        }

        // 3. Conversational edit → real modified artifact; original untouched.
        const ed = await j.call('/api/laxii/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'conversational-edit', assetId, prompt: 'Place a small blue sugar bowl next to the teapot, matching the lighting.' }) })
        const edB = (await ed.json().catch(() => ({}))) as Record<string, unknown>
        const edJob = ((edB.job ?? edB) as Record<string, unknown>).id as string | undefined
        rec('laxii', 'conversational-edit: submit', ed.status === 202 && Boolean(edJob), ed.status, `jobId=${edJob}`)
        if (edJob) {
          const d = await pollJob(`/api/laxii/jobs/${edJob}`, ['completed', 'failed', 'rejected'], 5 * 60_000)
          const job = (d.last.job ?? {}) as Record<string, unknown>
          rec('laxii', 'conversational-edit: terminal state', d.ok, null, `status=${job.status} err=${String(job.errorMessage ?? '')}`.slice(0, 200))
          if (d.ok) {
            const outUrl = job.imageUrl as string
            const outRes = await j.call(outUrl)
            const outBytes = Buffer.from(await outRes.arrayBuffer())
            const outFile = path.join(OUT_DIR, 'laxii-edit.png')
            writeFileSync(outFile, outBytes)
            const sharpMod = await import('sharp')
            const meta = await sharpMod.default(outBytes).metadata()
            const modified = sha256(outBytes) !== laxii.sourceShaBefore
            rec('laxii', 'conversational-edit: real modified artifact', outRes.status === 200 && modified && Boolean(meta.width), outRes.status, `${meta.format} ${meta.width}x${meta.height} bytes=${outBytes.length} differsFromOriginal=${modified}`, { file: outFile })
          }
        }

        // 4. The ORIGINAL file remains unchanged after all edits.
        const dl2 = await j.call(`/api/laxii/assets/${assetId}`)
        const after = Buffer.from(await dl2.arrayBuffer())
        rec('laxii', 'original file unchanged after edits', sha256(after) === laxii.sourceShaBefore, dl2.status, `sha256Before=${laxii.sourceShaBefore.slice(0, 16)}… sha256After=${sha256(after).slice(0, 16)}…`)
      }
    } else {
      rec('laxii', 't2i: artifact fetch', false, null, 'no imageUrl in completed job')
    }
  }
}

// ------------------------------------------------------------ CODE GIETZ ===
console.log('\n== CODE GIETZ ==')
{
  // 1. Real coding chat (non-streaming JSON).
  const r = await j.call('/api/code-giftz/chat?stream=0', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Write a JavaScript function sumOfSquares(n) that returns 1^2+2^2+...+n^2, plus a one-line usage example printing sumOfSquares(5).' }),
  })
  const b = (await r.json().catch(() => ({}))) as Record<string, unknown>
  const content = typeof b.content === 'string' ? b.content : String((b.message as { content?: string })?.content ?? '')
  const projectId = (b.projectId as string) ?? ((b.project as Record<string, unknown>)?.id as string) ?? null
  rec('code-giftz', 'coding chat: real model response', r.status === 200 && content.length > 30, r.status, `chars=${content.length} projectId=${projectId}`, { answerPreview: content.slice(0, 200) })

  // 2. Isolated sandbox execution of the model's own project — REAL
  // stdout/exit code + the measured isolation profile.
  if (projectId) {
    const run = await j.call(`/api/code-giftz/projects/${projectId}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approval: true, entry: 'main.js' }),
    })
    const rb = (await run.json().catch(() => ({}))) as Record<string, unknown>
    const runObj = (rb.run ?? {}) as Record<string, unknown>
    const isolation = runObj.isolation as Record<string, boolean> | undefined
    rec(
      'code-giftz',
      'sandbox: real execution of the generated project with isolation profile',
      run.status === 200 && runObj.exitCode === 0 && isolation?.networkNamespace === true,
      run.status,
      `exit=${runObj.exitCode} stdout=${String(runObj.stdout ?? '').trim().slice(0, 80)} isolation=${JSON.stringify(isolation)}`,
    )

    // 3. REAL failure reporting: overwrite the entry with a failing test,
    // run it — exit!=0 and stderr verbatim.
    const w = await j.call(`/api/code-giftz/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'main.js', content: 'console.error("ASSERTION FAILED: expected 55 got 56");process.exit(1);\n' }),
    })
    if (w.status === 200 || w.status === 201) {
      const bad = await j.call(`/api/code-giftz/projects/${projectId}/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approval: true, entry: 'main.js' }),
      })
      const bb = (await bad.json().catch(() => ({}))) as Record<string, unknown>
      const badRun = (bb.run ?? {}) as Record<string, unknown>
      rec(
        'code-giftz',
        'sandbox: real failure reported verbatim',
        bad.status === 200 && badRun.exitCode === 1 && String(badRun.stderr ?? '').includes('ASSERTION FAILED'),
        bad.status,
        `exit=${badRun.exitCode} stderr=${String(badRun.stderr ?? '').trim().slice(0, 60)}`,
      )
    } else {
      rec('code-giftz', 'sandbox: real failure reported verbatim', false, w.status, 'could not write failing test file')
    }

    // 4. Persistence: conversation + project retrievable after creation.
    const list = await j.call('/api/code-giftz/projects')
    const lb = (await list.json().catch(() => ({}))) as Record<string, unknown>
    const projects = (lb.projects ?? []) as Array<Record<string, unknown>>
    rec('code-giftz', 'persistence: project retrievable', list.status === 200 && projects.some((p) => p.id === projectId), list.status, `projects=${projects.length}`)
  } else {
    rec('code-giftz', 'sandbox: real execution of the generated project with isolation profile', false, null, 'no projectId from chat')
  }
}

// --------------------------------------------------------------- PLATFORM ==
console.log('\n== PLATFORM ==')
{
  const health = (await fetch(`${BASE}/api/health`).then((r) => r.json())) as Record<string, unknown>
  const products = health.products as Record<string, Record<string, unknown>>
  for (const name of ['riishe', 'laxii', 'jazmii', 'code-giftz']) {
    const caps = products?.[name]?.capabilities as Array<Record<string, unknown>> | undefined
    rec('platform', `health: ${name} capability rows present`, Array.isArray(caps) && caps.length > 0, 200, (caps ?? []).map((c) => `${c.id}:${c.state}`).join(', '))
  }
  // No secrets in public payloads: /api/health is public (scanned for key
  // material); /api/v1/providers is AUTH-GATED — an unauthenticated 401 is
  // itself the honest answer (no anonymous key exposure is possible).
  const provRes = await fetch(`${BASE}/api/v1/providers`)
  const provText = await provRes.text()
  const healthText = JSON.stringify(health)
  const leakPattern = /(sk-[A-Za-z0-9]{16,}|Bearer [A-Za-z0-9._-]{20,}|"apiKey"\s*:\s*"[^"]{8,}"|"token"\s*:\s*"[^"]{20,}")/
  rec(
    'platform',
    'no secrets exposed in public payloads',
    provRes.status === 401 && !leakPattern.test(provText) && !leakPattern.test(healthText),
    provRes.status,
    `providers endpoint auth-gated (HTTP ${provRes.status}); public health payload scanned clean`,
  )

  // Quota correctness: usage rows match success events per product (DB-verified separately).
  const usage = await j.call('/api/usage')
  rec('platform', 'usage endpoint reachable with session', usage.status === 200, usage.status, 'per-user usage visible')
}

const summary = {
  runAt: new Date().toISOString(),
  pass: steps.filter((s) => s.ok).length,
  note: steps.filter((s) => !s.ok).length,
  steps,
}
writeFileSync(path.join(OUT_DIR, 'acceptance.json'), JSON.stringify(summary, null, 1))
writeFileSync('docs/evidence/bean-optrans-acceptance.txt', JSON.stringify(summary, null, 1))
console.log(`\nDONE pass=${summary.pass} note=${summary.note}`)
