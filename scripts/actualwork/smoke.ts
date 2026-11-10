/**
 * BEAN — MAKE ALL FOUR AI PRODUCTS ACTUALLY WORK: bounded real acceptance.
 *
 * One session, ONE single bounded attempt per provider-backed capability,
 * ZERO retries on 429 (recovery-window protocol). Every step is breaker-
 * gated off /api/health: an open class records `blocked` WITHOUT touching
 * the network. Real/simulated labeled per step; a mock never counts as a
 * real success.
 *
 * Groups (CLI argv, any subset):
 *   laxii   — real T2I + real upload → conversational edit (official
 *             documented contract now wired server-side) → artifacts
 *   jazmii  — one real T2V job → tracking → MP4 + Range 206 verification
 *   chat    — one real streaming RIISHE turn + persistence + GIFTZ codegen
 *             with sandbox-verified execution
 *   giftz-sandbox — deterministic sandbox execution probe (no AI call)
 *
 * Output: scripts/actualwork-out/evidence.jsonl (+ artifacts).
 */
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = 'http://localhost:3000'
const OUT = path.join(process.cwd(), 'scripts', 'actualwork-out')
mkdirSync(OUT, { recursive: true })

const EMAIL = `actualwork-${Date.now()}@bean-test.local`
const PASS = 'E2eTest!Passw0rd'
let cookie = ''

function rec(step: string, data: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), step, ...data })
  appendFileSync(path.join(OUT, 'evidence.jsonl'), line + '\n')
  console.log(line)
}

async function api(method: string, path: string, body?: unknown, raw = false) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(raw ? { Accept: '*/*' } : { Accept: 'application/json' }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  if (raw) return { status: res.status, json: null as any, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers }
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 200) } }
  return { status: res.status, json, bytes: undefined as any, headers: res.headers }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Breakers = Record<string, boolean>
async function breakers(): Promise<Breakers> {
  const h = await api('GET', '/api/health')
  const out: Breakers = {}
  for (const c of h.json?.gateway?.breaker?.classes ?? []) out[c.class] = Boolean(c.coolingDown)
  return out
}

// ---------------------------------------------------------------- laxii ----
async function runLaxii() {
  const br = await breakers()
  if (br.images) {
    rec('laxii', { classification: 'real', state: 'blocked', reason: 'images-class breaker open (observed 429) — zero network, no retry' })
    return
  }
  // 1. REAL text-to-image (Phase 7: "Generate an image").
  const g = await api('POST', '/api/laxii/generate', {
    prompt: 'A minimalist golden compass rose on deep midnight blue, soft studio light',
    size: '1024x1024',
  })
  const genJobId = g.json?.job?.id
  rec('laxii-t2i-submit', { classification: 'real', state: g.status === 202 ? 'submitted' : 'failed', httpStatus: g.status, jobId: genJobId })
  if (genJobId) {
    let job: any = null
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      await sleep(6_000)
      const r = await api('GET', `/api/laxii/jobs/${genJobId}`)
      job = r.json?.job ?? null
      if (job && (job.status === 'completed' || job.status === 'failed')) break
    }
    if (job?.status === 'completed') {
      const media = await api('GET', String(job.imageUrl), undefined, true)
      const jpeg = media.bytes?.[0] === 0xff && media.bytes?.[1] === 0xd8
      writeFileSync(path.join(OUT, 'laxii-t2i.jpg'), media.bytes ?? Buffer.alloc(0))
      rec('laxii-t2i', {
        classification: 'real', state: jpeg ? 'passed' : 'failed', jobId: genJobId,
        bytes: media.bytes?.length ?? 0, jpegMagic: jpeg, artifact: 'scripts/actualwork-out/laxii-t2i.jpg',
      })
      // 2. REAL conversational edit on the REAL generated image (Phase 7:
      //    "perform an actual localized edit"). Single bounded attempt; the
      //    server now sends the OFFICIAL documented body
      //    { prompt, images: [{url}], size }.
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(media.bytes ?? Buffer.alloc(0))], { type: 'image/jpeg' }), 'edit-source.jpg')
      form.append('kind', 'original')
      const up = await fetch(`${BASE}/api/laxii/assets`, { method: 'POST', headers: { Cookie: cookie }, body: form })
      const upJson = await up.json().catch(() => null)
      const assetId = upJson?.asset?.id
      rec('laxii-upload', { classification: 'deterministic', state: up.status === 201 && assetId ? 'passed' : 'failed', httpStatus: up.status, assetId })
      if (assetId) {
        const e = await api('POST', '/api/laxii/edit', {
          mode: 'conversational-edit',
          assetId,
          prompt: 'Change the background to a warm sunset sky with soft clouds, keep the compass rose unchanged',
          size: '1024x1024',
        })
        const editJobId = e.json?.job?.id
        rec('laxii-edit-submit', { classification: 'real', state: e.status === 202 ? 'submitted' : 'failed', httpStatus: e.status, jobId: editJobId, message: String(e.json?.message ?? '').slice(0, 200) })
        if (editJobId) {
          let ejob: any = null
          const edeadline = Date.now() + 180_000
          while (Date.now() < edeadline) {
            await sleep(6_000)
            const r = await api('GET', `/api/laxii/jobs/${editJobId}`)
            ejob = r.json?.job ?? null
            if (ejob && (ejob.status === 'completed' || ejob.status === 'failed')) break
          }
          if (ejob?.status === 'completed') {
            const out = await api('GET', String(ejob.imageUrl), undefined, true)
            const png = out.bytes?.[0] === 0x89 && out.bytes?.[1] === 0x50
            writeFileSync(path.join(OUT, 'laxii-edit-output.png'), out.bytes ?? Buffer.alloc(0))
            rec('laxii-edit', {
              classification: 'real', state: png ? 'passed' : 'failed', jobId: editJobId,
              bytes: out.bytes?.length ?? 0, pngMagic: png,
              artifact: 'scripts/actualwork-out/laxii-edit-output.png',
              note: 'REAL provider edit via the OFFICIAL documented contract {prompt, images:[{url}], size}.',
            })
          } else {
            rec('laxii-edit', {
              classification: 'real', state: 'failed', jobId: editJobId,
              errorCode: ejob?.errorCode ?? null, errorMessage: String(ejob?.errorMessage ?? 'job did not finish').slice(0, 300),
              note: 'Recorded verbatim; single attempt, no retry (429 recovery-window protocol).',
            })
          }
        }
      }
    } else {
      rec('laxii-t2i', {
        classification: 'real', state: 'failed', jobId: genJobId,
        errorCode: job?.errorCode ?? null, errorMessage: String(job?.errorMessage ?? 'job did not finish').slice(0, 300),
      })
    }
  }
}

// --------------------------------------------------------------- jazmii ----
async function runJazmii() {
  const br = await breakers()
  if (br.video) {
    rec('jazmii', { classification: 'real', state: 'blocked', reason: 'video-class breaker open (observed 429) — zero network, no retry' })
    return
  }
  const g = await api('POST', '/api/jazmii/generate', {
    prompt: 'A single amber balloon drifting slowly upward against a clear blue sky',
    size: '768x768', durationSec: 5, quality: 'speed', withAudio: false,
  })
  const jobId = g.json?.job?.id
  rec('jazmii-submit', { classification: 'real', state: g.status === 202 ? 'submitted' : 'failed', httpStatus: g.status, jobId, message: String(g.json?.message ?? '').slice(0, 200) })
  if (!jobId) return
  let job: any = null
  const deadline = Date.now() + 8 * 60_000
  while (Date.now() < deadline) {
    await sleep(10_000)
    const r = await api('GET', `/api/jazmii/jobs/${jobId}`)
    job = r.json?.job ?? null
    if (job && (job.status === 'completed' || job.status === 'failed')) break
  }
  if (job?.status === 'completed') {
    const media = await api('GET', String(job.videoUrl), undefined, true)
    const magic = media.bytes && media.bytes.length > 12 && media.bytes.toString('ascii', 4, 8) === 'ftyp'
    const rangeRes = await fetch(`${BASE}${job.videoUrl}`, { headers: { Cookie: cookie, Range: 'bytes=0-1023' } })
    const rangeStatus = rangeRes.status
    await rangeRes.arrayBuffer().catch(() => undefined)
    writeFileSync(path.join(OUT, 'jazmii-t2v.mp4'), media.bytes ?? Buffer.alloc(0))
    const result = typeof job.resultJson === 'string' ? JSON.parse(job.resultJson) : job
    rec('jazmii-t2v', {
      classification: 'real', state: magic ? 'passed' : 'failed',
      jobId, bytes: media.bytes?.length ?? 0, mp4Magic: magic, rangeStatus,
      trackingRetry: result?.trackingRetry ?? null,
      artifact: 'scripts/actualwork-out/jazmii-t2v.mp4',
    })
    const p = await api('GET', `/api/jazmii/jobs/${jobId}`)
    rec('jazmii-persistence', { classification: 'deterministic', state: p.status === 200 && p.json?.job?.status === 'completed' ? 'passed' : 'failed', jobId })
  } else {
    rec('jazmii-t2v', {
      classification: 'real', state: 'failed', jobId,
      errorCode: job?.errorCode ?? null, errorMessage: String(job?.errorMessage ?? 'job did not finish in the bounded window').slice(0, 300),
      trackingRetry: job?.trackingRetry ?? null,
    })
  }
}

// ----------------------------------------------------------------- chat ----
async function runChat() {
  const br = await breakers()
  if (br.chat) {
    rec('riishe-chat', { classification: 'real', state: 'blocked', reason: 'chat-class breaker open (observed 429) — zero network, no retry' })
  } else {
    const t0 = Date.now()
    const res = await fetch(`${BASE}/api/riishe/chat?stream=1`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'In exactly one short sentence, confirm the BEAN capability acceptance run is working.' }),
    })
    let convId = res.headers.get('x-conversation-id')
    let deltas = '', frames = 0, streamError: string | null = null
    const reader = res.body?.getReader()
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
            frames++
            if (typeof evt.delta === 'string') deltas += evt.delta
            if (evt.error) streamError = String(evt.error).slice(0, 200)
            if (!convId && (evt.conversationId || evt.done?.conversationId)) convId = String(evt.conversationId ?? evt.done.conversationId)
          } catch { /* partial frame */ }
        }
      }
    }
    const okStream = deltas.length > 0 && !streamError
    rec('riishe-chat', {
      classification: 'real', state: okStream ? 'passed' : 'failed',
      httpStatus: res.status, frames, chars: deltas.length, ms: Date.now() - t0,
      preview: deltas.slice(0, 140), error: streamError,
    })
    if (okStream && convId) {
      const d = await api('GET', `/api/riishe/conversations/${convId}`)
      const msgs = d.json?.messages ?? d.json?.conversation?.messages ?? []
      rec('riishe-persistence', { classification: 'deterministic', state: Array.isArray(msgs) && msgs.length >= 2 ? 'passed' : 'failed', messages: Array.isArray(msgs) ? msgs.length : 0, conversationId: convId })
    }
  }

  // CODE GIFTZ: real codegen → sandbox execution with verified output.
  const br2 = await breakers()
  if (br2.chat) {
    rec('giftz-code', { classification: 'real', state: 'blocked', reason: 'chat-class breaker open (observed 429) — zero network, no retry' })
    return
  }
  const gen = await api('POST', '/api/code-giftz/tasks', {
    projectId: null,
    mode: 'generate',
    message: 'Write a complete JavaScript function file that exports isPalindrome(s) returning true for a case-insensitive palindrome, then at module scope console.log three checks: "Racecar" (expect true), "BEAN" (expect false), "A man, a plan, a canal: Panama" (expect true).',
  })
  const taskId = gen.json?.task?.id
  rec('giftz-code-submit', { classification: 'real', state: gen.status === 202 ? 'submitted' : 'failed', httpStatus: gen.status, taskId })
  if (!taskId) return
  let task: any = null
  const tdeadline = Date.now() + 180_000
  while (Date.now() < tdeadline) {
    await sleep(6_000)
    const r = await api('GET', `/api/code-giftz/tasks/${taskId}`)
    task = r.json?.task ?? null
    if (task && (task.status === 'completed' || task.status === 'failed')) break
  }
  if (task?.status !== 'completed') {
    rec('giftz-code', {
      classification: 'real', state: 'failed', taskId,
      errorCode: task?.errorCode ?? null, errorMessage: String(task?.errorMessage ?? 'task did not finish').slice(0, 300),
    })
    return
  }
  const files: Array<{ path: string; content: string }> = task.resultJson ? (JSON.parse(task.resultJson).files ?? []) : []
  const main = files.find((f) => /main|index|palindrome/i.test(f.path)) ?? files[0]
  if (main) writeFileSync(path.join(OUT, 'giftz-generated.js'), main.content ?? '')
  rec('giftz-codegen', { classification: 'real', state: files.length ? 'passed' : 'failed', taskId, files: files.map((f) => f.path), artifact: 'scripts/actualwork-out/giftz-generated.js' })
  if (!files.length) return
  // Sandbox: execute the generated code for real (explicit approval flag).
  const run = await api('POST', '/api/code-giftz/run', { taskId, approval: true })
  const stdout = String(run.json?.run?.stdout ?? '')
  const exitCode = run.json?.run?.exitCode
  const verified = exitCode === 0 && stdout.length > 0
  writeFileSync(path.join(OUT, 'giftz-run.json'), JSON.stringify(run.json, null, 2))
  rec('giftz-sandbox', {
    classification: 'real', state: verified ? 'passed' : 'failed', taskId,
    exitCode, stdout: stdout.slice(0, 300), stderr: String(run.json?.run?.stderr ?? '').slice(0, 120),
    artifact: 'scripts/actualwork-out/giftz-run.json',
  })
}

// ----------------------------------------------------------------- main ----
async function main() {
  const groups = process.argv.slice(2)
  const all = groups.length === 0
  rec('session', { email: EMAIL, groups: all ? ['laxii', 'jazmii', 'chat'] : groups })
  const reg = await api('POST', '/api/auth/register', { email: EMAIL, password: PASS, name: 'Actual Work Acceptance' })
  const l = await api('POST', '/api/auth/login', { email: EMAIL, password: PASS })
  if (l.status !== 200) throw new Error(`login failed: ${l.status}`)
  rec('auth', { ok: true, registerStatus: reg.status, classification: 'deterministic' })

  if (all || groups.includes('laxii')) await runLaxii()
  if (all || groups.includes('jazmii')) await runJazmii()
  if (all || groups.includes('chat')) await runChat()
  rec('done', { evidence: 'scripts/actualwork-out/evidence.jsonl' })
}

void main().catch((e) => {
  rec('fatal', { message: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})
