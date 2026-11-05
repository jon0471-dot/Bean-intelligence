/**
 * FOUR-PRODUCT GO-LIVE — real live acceptance evidence collector.
 *
 * Runs against the REAL dev server (:3000) with a fresh isolated user.
 * Every check records machine-verifiable evidence to scripts/golive-out/.
 * No mock, no fake output, no simulated status: each acceptance item either
 * produced a real provider artifact or its failure is recorded as BLOCKED.
 *
 * Usage: bun scripts/golive-live-acceptance.ts [steps...]
 *   steps: jazmii-submit | riishe | giftz | laxii | jazmii-collect | summary
 */
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'

const BASE = 'http://localhost:3000'
const OUT = 'scripts/golive-out'
mkdirSync(OUT, { recursive: true })
const EV = `${OUT}/evidence.jsonl`
const EMAIL = process.env.GOLIVE_EMAIL ?? 'golive-acc@bean-e2e.test'
const PASS = 'E2eTest!Passw0rd'

function rec(step: string, data: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), step, ...data })
  appendFileSync(EV, line + '\n')
  console.log(`[${step}]`, JSON.stringify(data).slice(0, 400))
}

let cookie = ''

async function api(method: string, path: string, body?: unknown, raw = false): Promise<{ status: number; json: any; bytes?: Buffer }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Accept: raw ? '*/*' : 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  if (setCookie.length) {
    const jar = setCookie.map((c) => c.split(';')[0]).join('; ')
    cookie = cookie ? `${cookie}; ${jar}` : jar
  }
  if (raw) {
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, json: null, bytes: buf }
  }
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 400) } }
  return { status: res.status, json }
}

async function register(): Promise<void> {
  const r = await api('POST', '/api/auth/register', { email: EMAIL, password: PASS, name: 'GoLive Acceptance' })
  if (r.status !== 200 && r.status !== 409 && !(r.status === 400 && /already exists/.test(String(r.json?.error?.message)))) {
    throw new Error(`register failed: ${r.status} ${JSON.stringify(r.json)}`)
  }
  const l = await api('POST', '/api/auth/login', { email: EMAIL, password: PASS })
  if (l.status !== 200) throw new Error(`login failed: ${l.status}`)
  rec('auth', { ok: true, user: EMAIL })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wait until a specific endpoint-class breaker is closed (bounded). */
async function waitForClassOpen(cls: string, maxMs = 14 * 60_000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const h = await api('GET', '/api/health')
    const c = (h.json?.gateway?.breaker?.classes ?? []).find((x: any) => x.class === cls)
    if (!c || !c.coolingDown) return true
    await sleep(20_000)
  }
  rec(`breaker-wait-timeout-${cls}`, { waitedMs: maxMs })
  return false
}

/** Wait until the chat-class breaker is closed (bounded; honest timeout). */
async function waitForChatOpen(maxMs = 12 * 60_000): Promise<boolean> {
  return waitForClassOpen('chat', maxMs)
}

// ---- JAZMII submit ----------------------------------------------------------
async function jazmiiSubmit(kind: 't2v' | 'i2v', imageUrl?: string): Promise<string> {
  const body = kind === 't2v'
    ? { prompt: 'A slow cinematic drone shot rising over a golden desert canyon at dawn, warm light, dust motes in the air', size: '1280x720', durationSec: 5, quality: 'quality', withAudio: false }
    : { prompt: 'The camera slowly pushes in while the lighting shifts to sunset tones', imageUrl, size: '1280x720', durationSec: 5, quality: 'speed' }
  const r = await api('POST', '/api/jazmii/generate', body)
  const jobId = r.json?.job?.id ?? null
  rec(`jazmii-submit-${kind}`, { status: r.status, jobId, code: r.json?.code ?? null, message: r.json?.message ?? null })
  if (!jobId) throw new Error(`jazmii submit rejected: ${JSON.stringify(r.json).slice(0, 200)}`)
  return jobId as string
}

async function jazmiiCollect(jobId: string, maxMs = 14 * 60_000): Promise<void> {
  const t0 = Date.now()
  let last = ''
  while (Date.now() - t0 < maxMs) {
    const r = await api('GET', `/api/jazmii/jobs/${jobId}`)
    const j = r.json?.job ?? {}
    last = JSON.stringify(j)
    if (j.status === 'completed') {
      const media = await api('GET', String(j.videoUrl).replace('/api', '/api'), undefined, true)
      const isMp4 = media.bytes && media.bytes.length > 12 && media.bytes.toString('ascii', 4, 8) === 'ftyp'
      const isWebm = media.bytes && media.bytes[0] === 0x1a && media.bytes[1] === 0x45
      mkdirSync(`${OUT}/jazmii`, { recursive: true })
      writeFileSync(`${OUT}/jazmii/${jobId}.${isWebm ? 'webm' : 'mp4'}`, media.bytes!)
      rec('jazmii-complete', {
        jobId, status: j.status, bytes: j.bytes, format: j.format,
        mediaStatus: media.status, mediaBytes: media.bytes?.length,
        containerVerified: isMp4 || isWebm,
        artifact: `scripts/golive-out/jazmii/${jobId}.${isWebm ? 'webm' : 'mp4'}`,
      })
      return
    }
    if (j.status === 'failed') {
      rec('jazmii-failed', { jobId, errorCode: j.errorCode, errorMessage: j.errorMessage })
      return
    }
    await sleep(10_000)
  }
  rec('jazmii-timeout', { jobId, last: last.slice(0, 300) })
}

// ---- RIISHE -----------------------------------------------------------------
async function riishe(): Promise<void> {
  const chatOpen = await waitForChatOpen()
  if (!chatOpen) {
    rec('riishe-blocked', { reason: 'chat-class breaker stayed open for the whole bounded wait' })
    return
  }
  // Turn 1 — streaming SSE with a REAL generation (no memory command:
  // the prompt must not start with remember/save/list keywords).
  const t1 = await fetch(`${BASE}/api/riishe/chat?stream=1`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'My project codename is GOLDEN CANYON. Acknowledge it in one short sentence and do not store it as a memory.' }),
  })
  const convId = t1.headers.get('x-conversation-id') ?? null
  const reader = t1.body?.getReader()
  let deltas = ''
  let doneMeta: Record<string, unknown> | null = null
  let streamError: string | null = null
  if (reader) {
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        try {
          const evt = JSON.parse(line.slice(5))
          if (typeof evt.delta === 'string') deltas += evt.delta
          if (evt.error) streamError = String(evt.error).slice(0, 200)
          if (evt.done) doneMeta = evt
        } catch { /* partial frame */ }
      }
    }
  }
  const conv = convId ?? (doneMeta as any)?.conversationId ?? null
  rec('riishe-turn1-stream', {
    status: t1.status, contentType: t1.headers.get('content-type'),
    streamedChars: deltas.length, conversationId: conv,
    preview: deltas.slice(0, 160), gotDone: Boolean(doneMeta), streamError,
  })
  if (!conv) {
    rec('riishe-turn1-failed', { streamError: streamError ?? 'no conversation id in stream' })
    return
  }

  // Turn 2 — multi-turn context via JSON mode (class-gated).
  if (!(await waitForClassOpen('chat'))) return
  const t2 = await api('POST', '/api/riishe/chat', { conversationId: conv, message: 'What is my project codename? Answer with just the codename.' })
  const answer2 = String(t2.json?.content ?? '')
  rec('riishe-turn2-context', {
    status: t2.status, answer: answer2.slice(0, 120),
    contextHeld: answer2.toUpperCase().includes('GOLDEN CANYON'),
  })

  // Turn 3 — research tool (functions class, gated).
  if (!(await waitForClassOpen('functions'))) {
    rec('riishe-turn3-skipped', { reason: 'functions breaker stayed open' })
  } else {
    const t3 = await api('POST', '/api/riishe/chat', { conversationId: conv, message: 'Search the web for the current head of government of Japan and cite a source link.' })
    const meta3 = t3.json?.metadata ?? {}
    const content3 = String(t3.json?.content ?? '')
    rec('riishe-turn3-research', {
      status: t3.status, contentPreview: content3.slice(0, 140),
      hasSourceLink: /https?:\/\//.test(content3),
      metaKeys: Object.keys(meta3).slice(0, 8),
      toolEvidence: Boolean(meta3.sources?.length || meta3.toolCalls?.length || meta3.grounding),
    })
  }

  // Persistence: conversation detail after a fresh "reload" (new API client
  // state; the server is the only store). No list route exists by design —
  // the sidebar search endpoint backs the UI.
  const detail = conv ? await api('GET', `/api/riishe/conversations/${conv}`) : { json: null }
  const msgs = detail.json?.messages ?? detail.json?.conversation?.messages ?? []
  rec('riishe-persistence', {
    status: detail.status,
    messageCount: Array.isArray(msgs) ? msgs.length : -1,
    roles: Array.isArray(msgs) ? msgs.map((m: any) => m.role).join(',') : '',
    firstUserTurn: Array.isArray(msgs) ? (msgs.find((m: any) => m.role === 'user')?.content ?? '').slice(0, 60) : '',
    contextIntact: Array.isArray(msgs) && msgs.some((m: any) => m.role === 'user' && /GOLDEN CANYON/.test(m.content)),
  })
}

// ---- CODE GIFTZ -------------------------------------------------------------
async function giftz(): Promise<void> {
  if (!(await waitForClassOpen('chat'))) {
    rec('giftz-blocked', { reason: 'chat-class breaker stayed open' })
    return
  }
  const t1 = await fetch(`${BASE}/api/code-giftz/chat`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: undefined,
      message: 'Write a JavaScript function debounce(fn, wait) that returns a debounced wrapper, plus a tiny usage example. Keep it short.',
    }),
  })
  const ct = t1.headers.get('content-type') ?? ''
  let answer = ''
  let projectId: string | null = null
  let streamError: string | null = null
  if (ct.includes('text/event-stream') && t1.body && typeof (t1.body as ReadableStream).getReader === 'function') {
    const dec = new TextDecoder()
    const reader = (t1.body as ReadableStream).getReader()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        try {
          const evt = JSON.parse(line.slice(5))
          if (typeof evt.delta === 'string') answer += evt.delta
          if (evt.error) streamError = String(evt.error).slice(0, 200)
          if (evt.projectId) projectId = evt.projectId
          if (evt.conversationId && !projectId) projectId = evt.conversationId
        } catch { /* partial */ }
      }
    }
  } else {
    const j = await t1.json().catch(() => ({}))
    answer = String(j.content ?? j.raw ?? '')
    projectId = j.projectId ?? null
  }
  const hasCode = /function\s+debounce|const\s+debounce/.test(answer)
  rec('giftz-live-answer', {
    status: t1.status, contentType: ct, chars: answer.length,
    hasDebounceCode: hasCode, projectId, preview: answer.slice(0, 140), streamError,
  })

  // Sandbox execution of generated code: the CORRECT flow (route contract)
  // is POST /api/code-giftz/tasks {mode:'generate',...} → the task row
  // carries resultJson.files → POST /api/code-giftz/run {taskId, approval}.
  // (The earlier draft queried GET /tasks?projectId= which lists only
  // task-mode jobs — chat turns correctly create none.)
  {
    // Space the second chat-class call: the shared account throttles bursts.
    await sleep(15_000)
    if (!(await waitForClassOpen('chat', 6 * 60_000))) {
      rec('giftz-task-create', { code: 'RATE_LIMITED', detail: 'chat-class breaker reopened between calls' })
    } else {
    const t = await api('POST', '/api/code-giftz/tasks', {
      mode: 'generate',
      prompt: 'Write a JavaScript function isPalindrome(s) that ignores case and non-alphanumeric characters, plus a tiny usage example.',
      language: 'javascript',
    })
    const taskId = t.json?.task?.id ?? null
    const fileCount = Array.isArray(t.json?.task?.files) ? t.json.task.files.length : 0
    rec('giftz-task-create', { status: t.status, taskId, fileCount, code: t.json?.code ?? null })
    if (taskId && fileCount > 0) {
      const run = await api('POST', '/api/code-giftz/run', { taskId, approval: true })
      const r = run.json?.result ?? {}
      rec('giftz-sandbox-run', {
        status: run.status, ok: run.json?.ok ?? null,
        exitCode: r.exitCode ?? null, timedOut: r.timedOut ?? null,
        stdoutPreview: String(r.stdout ?? '').slice(0, 200),
        stderrPreview: String(r.stderr ?? '').slice(0, 200),
        outputPreview: run.status !== 200 ? JSON.stringify(run.json).slice(0, 300) : undefined,
      })
    }
    }
  }

  // Persistence of the coding conversation.
  if (projectId) {
    const detail = await api('GET', `/api/code-giftz/projects/${projectId}`).catch(() => ({ json: null, status: 0 }))
    rec('giftz-persistence', { status: detail.status, restored: Boolean(detail.json) })
  }
}

// ---- LAXII ------------------------------------------------------------------
async function waitJob(path: string, id: string, maxMs: number): Promise<any> {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const r = await api('GET', `${path}/${id}`)
    const j = r.json?.job
    if (j && (j.status === 'completed' || j.status === 'failed')) return j
    await sleep(6_000)
  }
  return { status: 'timeout' }
}

async function laxii(): Promise<void> {
  if (!(await waitForClassOpen('images'))) {
    rec('laxii-blocked', { reason: 'images-class breaker stayed open' })
    return
  }
  // 1. Real text-to-image.
  const g = await api('POST', '/api/laxii/generate', { prompt: 'A photorealistic red vintage convertible parked on a coastal road at golden hour, ocean in the background', size: '1024x1024' })
  const jobId = g.json?.job?.id ?? null
  rec('laxii-t2i-submit', { status: g.status, jobId })
  if (!jobId) return
  const j1 = await waitJob('/api/laxii/jobs', jobId, 200_000)
  let imageBytes: Buffer | null = null
  if (j1.status === 'completed' && j1.imageUrl) {
    const img = await api('GET', String(j1.imageUrl).replace(/^\/api/, '/api'), undefined, true)
    imageBytes = img.bytes ?? null
    mkdirSync(`${OUT}/laxii`, { recursive: true })
    writeFileSync(`${OUT}/laxii/t2i-${jobId}.jpg`, imageBytes!)
  }
  rec('laxii-t2i-complete', {
    jobId, status: j1.status, bytes: j1.bytes, width: j1.width, height: j1.height,
    imageStatus: imageBytes ? 200 : null,
    jpegMagic: imageBytes ? imageBytes[0] === 0xff && imageBytes[1] === 0xd8 : false,
    artifact: j1.status === 'completed' ? `scripts/golive-out/laxii/t2i-${jobId}.jpg` : null,
    errorMessage: j1.errorMessage ?? null,
  })
  const resultAssetId = j1.imageUrl ? String(j1.imageUrl).split('/').pop() : null
  if (!resultAssetId || !imageBytes) return

  // The generated image becomes the EDIT SOURCE through the normal user
  // flow: download the artifact, upload it as an owned asset, then run the
  // conversational edit on it.
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(imageBytes)], { type: 'image/jpeg' }), `t2i-${jobId}.jpg`)
  form.append('kind', 'original')
  const upRes = await fetch(`${BASE}/api/laxii/assets`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  })
  const upJson = await upRes.json().catch(() => null)
  const editSourceId = upJson?.asset?.id ?? null
  rec('laxii-edit-source-upload', {
    status: upRes.status, assetId: editSourceId,
    responsePreview: JSON.stringify(upJson).slice(0, 120),
  })
  if (!editSourceId) return

  // 2. Real conversational edit on the generated image (reference-image edit).
  if (!(await waitForClassOpen('images'))) {
    rec('laxii-edit-skipped', { reason: 'images breaker reopened' })
    return
  }
  const e1 = await api('POST', '/api/laxii/edit', { mode: 'conversational-edit', assetId: editSourceId, prompt: 'Change the car color to midnight blue and replace the sky with dramatic storm clouds', size: '1024x1024' })
  const e1Id = e1.json?.job?.id ?? null
  rec('laxii-edit-submit', { status: e1.status, jobId: e1Id, mode: 'conversational-edit' })
  if (!e1Id) return
  const j2 = await waitJob('/api/laxii/jobs', e1Id, 200_000)
  let editBytes: Buffer | null = null
  if (j2.status === 'completed' && j2.imageUrl) {
    const img = await api('GET', String(j2.imageUrl), undefined, true)
    editBytes = img.bytes ?? null
    writeFileSync(`${OUT}/laxii/edit1-${e1Id}.png`, editBytes!)
  }
  rec('laxii-edit-complete', {
    jobId: e1Id, status: j2.status, bytes: j2.bytes,
    pngMagic: editBytes ? editBytes.toString('ascii', 1, 4) === 'PNG' : false,
    artifact: j2.status === 'completed' ? `scripts/golive-out/laxii/edit1-${e1Id}.png` : null,
    errorMessage: j2.errorMessage ?? null,
  })
  const editAssetId = j2.imageUrl ? String(j2.imageUrl).split('/').pop() : null

  // 3. Follow-up edit in the same chain (conversational refinement).
  if (editAssetId) {
    if (!(await waitForClassOpen('images'))) {
      rec('laxii-edit2-skipped', { reason: 'images breaker reopened' })
      return
    }
    const e2 = await api('POST', '/api/laxii/edit', { mode: 'conversational-edit', assetId: editAssetId, prompt: 'Add warm streetlights along the road and light fog near the ocean', size: '1024x1024' })
    const e2Id = e2.json?.job?.id ?? null
    rec('laxii-edit2-submit', { status: e2.status, jobId: e2Id })
    if (e2Id) {
      const j3 = await waitJob('/api/laxii/jobs', e2Id, 200_000)
      let f2Bytes: Buffer | null = null
      if (j3.status === 'completed' && j3.imageUrl) {
        const img = await api('GET', String(j3.imageUrl), undefined, true)
        f2Bytes = img.bytes ?? null
        writeFileSync(`${OUT}/laxii/edit2-${e2Id}.png`, f2Bytes!)
      }
      rec('laxii-edit2-complete', {
        jobId: e2Id, status: j3.status, bytes: j3.bytes,
        pngMagic: f2Bytes ? f2Bytes.toString('ascii', 1, 4) === 'PNG' : false,
        artifact: j3.status === 'completed' ? `scripts/golive-out/laxii/edit2-${e2Id}.png` : null,
        errorMessage: j3.errorMessage ?? null,
      })
    }
  }
}

// ---- main -------------------------------------------------------------------
const steps = process.argv.slice(2)
const run = steps.length ? steps : ['all']

async function main() {
  if (run.includes('all') || run.includes('auth')) await register()
  if (run.includes('jazmii-submit')) await jazmiiSubmit('t2v')
  if (run.includes('riishe')) await riishe()
  if (run.includes('giftz')) await giftz()
  if (run.includes('laxii')) await laxii()
  if (run.includes('jazmii-collect')) {
    const jobs = await api('GET', '/api/jazmii/generate')
    const pending = (jobs.json?.jobs ?? []).filter((j: any) => j.status === 'queued' || j.status === 'running')
    for (const j of pending) await jazmiiCollect(j.id)
  }
  if (run.includes('i2v')) {
    // image-to-video driven by the FIRST real LAXII T2I artifact
    const src = `${OUT}/laxii`
    if (!existsSync(src)) throw new Error('no laxii artifact dir — run laxii first')
    const file = readFileSync(`${src}/${readdirSync(src).find((f: string) => f.startsWith('t2i-'))}`)
    const dataUrl = `data:image/jpeg;base64,${file.toString('base64')}`
    await jazmiiSubmit('i2v', dataUrl)
  }
  if (run.includes('summary')) {
    const lines = readFileSync(EV, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    const byStep: Record<string, any> = {}
    for (const l of lines) byStep[l.step] = l
    console.log(JSON.stringify(byStep, null, 2))
  }
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
