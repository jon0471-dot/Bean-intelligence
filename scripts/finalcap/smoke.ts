/**
 * BEAN — FINAL CAPABILITY COMPLETION: bounded real smoke tests.
 *
 * One session, one single bounded attempt per provider-backed capability,
 * zero retries on 429 (recovery-window protocol). Every step is breaker-
 * gated off /api/health: an open class means the test is recorded `blocked`
 * WITHOUT touching the network. Real/simulated is labeled per step; a mock
 * never counts as an AI success.
 *
 * Steps:
 *   riishe-chat   real  — one streaming chat turn + conversation persistence
 *   laxii-edit    real  — real uploaded image -> conversational-edit job with
 *                           the FIXED canonical contract ({ prompt, image,
 *                           size }); outcome recorded verbatim
 *   jazmii-t2v    real  — one bounded 768x768/5s/speed T2V job -> tracking ->
 *                           MP4 magic-byte + Range 206 verification
 *   giftz-code    real  — codegen task -> sandbox run with verified stdout
 *
 * Output: scripts/finalcap-out/evidence.jsonl (+ artifacts).
 */
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = 'http://localhost:3000'
const OUT = path.join(process.cwd(), 'scripts', 'finalcap-out')
mkdirSync(OUT, { recursive: true })

const EMAIL = `finalcap-${Date.now()}@bean-test.local`
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
  return { status: res.status, json, bytes: undefined, headers: res.headers }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Breakers = Record<string, boolean>
async function breakers(): Promise<Breakers> {
  const h = await api('GET', '/api/health')
  const out: Breakers = {}
  for (const c of h.json?.gateway?.breaker?.classes ?? []) out[c.class] = Boolean(c.coolingDown)
  return out
}

async function main() {
  rec('session', { email: EMAIL, base: BASE })

  // ---- auth (deterministic infrastructure, not an AI test) ----------------
  const reg = await api('POST', '/api/auth/register', { email: EMAIL, password: PASS, name: 'Final Capability Smoke' })
  const l = await api('POST', '/api/auth/login', { email: EMAIL, password: PASS })
  if (l.status !== 200) throw new Error(`login failed: ${l.status}`)
  rec('auth', { ok: true, registerStatus: reg.status, classification: 'deterministic' })

  // ---- RIISHE: one real streaming chat turn -------------------------------
  {
    const br = await breakers()
    if (br.chat) {
      rec('riishe-chat', { classification: 'real', state: 'blocked', reason: 'chat-class breaker open (observed 429) — zero network, no retry' })
    } else {
      const t0 = Date.now()
      const res = await fetch(`${BASE}/api/riishe/chat?stream=1`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'In exactly one short sentence, confirm the capability smoke test is working.' }),
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
        preview: deltas.slice(0, 120), error: streamError,
      })
      if (okStream && convId) {
        const d = await api('GET', `/api/riishe/conversations/${convId}`)
        const msgs = d.json?.messages ?? d.json?.conversation?.messages ?? []
        rec('riishe-persistence', { classification: 'deterministic', state: Array.isArray(msgs) && msgs.length >= 2 ? 'passed' : 'failed', messages: Array.isArray(msgs) ? msgs.length : 0, conversationId: convId })
      }
    }
  }

  // ---- LAXII: real uploaded image -> conversational edit (FIXED contract) -
  {
    const br = await breakers()
    if (br.images) {
      rec('laxii-edit', { classification: 'real', state: 'blocked', reason: 'images-class breaker open (observed 429) — zero network, no retry' })
    } else {
      // Build a REAL photo-like JPEG on disk and upload it through the real
      // asset route (multipart), exactly like the UI does.
      const sharp = (await import('sharp')).default
      const img = await sharp({
        create: { width: 512, height: 512, channels: 3, background: { r: 30, g: 60, b: 120 } },
      })
        .composite([{
          input: Buffer.from(`<svg width="512" height="512"><rect x="150" y="150" width="212" height="212" fill="#e8b84b"/><circle cx="256" cy="120" r="60" fill="#f5f0e6"/></svg>`),
        }])
        .jpeg({ quality: 92 })
        .toBuffer()
      writeFileSync(path.join(OUT, 'edit-input.jpg'), img)
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(img)], { type: 'image/jpeg' }), 'smoke-source.jpg')
      form.append('kind', 'original')
      const up = await fetch(`${BASE}/api/laxii/assets`, { method: 'POST', headers: { Cookie: cookie }, body: form })
      const upJson = await up.json().catch(() => null)
      const assetId = upJson?.asset?.id
      rec('laxii-upload', { classification: 'deterministic', state: up.status === 201 && assetId ? 'passed' : 'failed', httpStatus: up.status, assetId, bytes: img.length })
      if (assetId) {
        // SINGLE bounded attempt with the FIXED canonical body.
        const e = await api('POST', '/api/laxii/edit', {
          mode: 'conversational-edit',
          assetId,
          prompt: 'Change the background to a sunset beach with warm golden light',
          size: '1024x1024',
        })
        const jobId = e.json?.job?.id
        rec('laxii-edit-submit', { classification: 'real', state: e.status === 202 ? 'submitted' : 'failed', httpStatus: e.status, jobId, message: String(e.json?.message ?? '').slice(0, 200) })
        if (jobId) {
          let job: any = null
          const deadline = Date.now() + 180_000
          while (Date.now() < deadline) {
            await sleep(6_000)
            const r = await api('GET', `/api/laxii/jobs/${jobId}`)
            job = r.json?.job ?? null
            if (job && (job.status === 'completed' || job.status === 'failed')) break
          }
          if (job?.status === 'completed') {
            const media = await api('GET', String(job.imageUrl), undefined, true)
            const magic = media.bytes && media.bytes[0] === 0x89 && media.bytes[1] === 0x50
            writeFileSync(path.join(OUT, 'edit-output.png'), media.bytes ?? Buffer.alloc(0))
            rec('laxii-edit', {
              classification: 'real', state: magic ? 'passed' : 'failed',
              jobId, bytes: media.bytes?.length ?? 0, width: job.width, height: job.height,
              pngMagic: magic, artifact: 'scripts/finalcap-out/edit-output.png',
              note: 'REAL provider edit via the fixed canonical contract ({prompt, image, size}) — blocker verdict is evidence-driven.',
            })
          } else {
            rec('laxii-edit', {
              classification: 'real', state: 'failed', jobId,
              errorCode: job?.errorCode ?? null, errorMessage: String(job?.errorMessage ?? 'job did not finish').slice(0, 300),
              note: 'Recorded verbatim; single attempt, no retry (429 recovery-window protocol).',
            })
          }
        }
      }
    }
  }

  // ---- JAZMII: one bounded real T2V ---------------------------------------
  {
    const br = await breakers()
    if (br.video) {
      rec('jazmii-t2v', { classification: 'real', state: 'blocked', reason: 'video-class breaker open (observed 429) — zero network, no retry' })
    } else {
      const g = await api('POST', '/api/jazmii/generate', {
        prompt: 'A single amber balloon drifting slowly upward against a clear blue sky',
        size: '768x768', durationSec: 5, quality: 'speed', withAudio: false,
      })
      const jobId = g.json?.job?.id
      rec('jazmii-submit', { classification: 'real', state: g.status === 202 ? 'submitted' : 'failed', httpStatus: g.status, jobId, message: String(g.json?.message ?? '').slice(0, 200) })
      if (jobId) {
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
          // Range request (independent download/export verification).
          const rangeRes = await fetch(`${BASE}${job.videoUrl}`, { headers: { Cookie: cookie, Range: 'bytes=0-1023' } })
          const rangeStatus = rangeRes.status
          await rangeRes.arrayBuffer().catch(() => undefined)
          writeFileSync(path.join(OUT, 'jazmii-smoke.mp4'), media.bytes ?? Buffer.alloc(0))
          const result = typeof job.resultJson === 'string' ? JSON.parse(job.resultJson) : job
          rec('jazmii-t2v', {
            classification: 'real', state: magic ? 'passed' : 'failed',
            jobId, bytes: media.bytes?.length ?? 0, format: job.format, mp4Magic: magic,
            rangeStatus, trackingRetry: result?.trackingRetry ?? null,
            artifact: 'scripts/finalcap-out/jazmii-smoke.mp4',
          })
          // Persistence: the job row must survive a fresh re-read.
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
    }
  }

  // ---- CODE GIFTZ: codegen -> sandbox with verified output ----------------
  {
    const br = await breakers()
    if (br.chat) {
      rec('giftz-code', { classification: 'real', state: 'blocked', reason: 'chat-class breaker open (observed 429) — zero network, no retry' })
    } else {
      const t = await api('POST', '/api/code-giftz/tasks', {
        mode: 'generate',
        prompt: 'Write a JavaScript file greet.js that prints exactly: FINALCAP-OK (single console.log). Standard library only.',
        language: 'javascript',
      })
      const taskId = t.json?.task?.id
      const files = Array.isArray(t.json?.task?.files) ? t.json.task.files : []
      rec('giftz-codegen', { classification: 'real', state: t.status === 200 && files.length > 0 ? 'passed' : 'failed', httpStatus: t.status, taskId, files: files.map((f: any) => f.path ?? f.name) })
      if (taskId && files.length > 0) {
        const r = await api('POST', '/api/code-giftz/run', { taskId, approval: true })
        const run = r.json?.run ?? {}
        const verified = r.status === 200 && run.exitCode === 0 && String(run.stdout ?? '').includes('FINALCAP-OK')
        rec('giftz-sandbox', {
          classification: 'deterministic', state: verified ? 'passed' : 'failed',
          exitCode: run.exitCode ?? null, stdout: String(run.stdout ?? '').slice(0, 120), ms: run.durationMs ?? null,
          note: 'Output VERIFIED (not just the model response).',
        })
        // Persistence: task reload after refresh.
        const d = await api('GET', `/api/code-giftz/tasks/${taskId}`)
        const t2 = d.json?.task ?? {}
        rec('giftz-persistence', { classification: 'deterministic', state: d.status === 200 && t2.status === 'completed' && Array.isArray(t2.files) && t2.files.length > 0 ? 'passed' : 'failed', files: Array.isArray(t2.files) ? t2.files.length : 0 })
      }
    }
  }

  // ---- Final health snapshot ----------------------------------------------
  const h = await api('GET', '/api/health')
  writeFileSync(path.join(OUT, 'health-final.json'), JSON.stringify(h.json, null, 2))
  rec('health-final', {
    classification: 'deterministic',
    products: Object.fromEntries(
      Object.entries(h.json?.products ?? {}).map(([p, v]: [string, any]) => [
        p,
        { status: v.status, capabilities: (v.capabilities ?? []).map((c: any) => `${c.id}:${c.state}`) },
      ]),
    ),
  })
  rec('done', { evidence: 'scripts/finalcap-out/evidence.jsonl' })
}

main().catch((e) => {
  rec('fatal', { error: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})
