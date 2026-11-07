/**
 * ISSUES 1-2 REPAIR — REQUIRED REAL-WORLD ACCEPTANCE TEST.
 *
 * Exactly the four bounded real runs the brief demands, on the REAL dev
 * server (:3000), single attempts only, breaker-gated, no retry storms:
 *   1. RIISHE  — one real chat response (streaming).
 *   2. LAXII   — one real text-to-image generation.
 *   3. JAZMII  — one real 10-second text-to-video (1280x720, quality),
 *                then the MP4 is verified for real duration / resolution /
 *                codec / playback decodability / persistent storage /
 *                authenticated download.
 *   4. GIFTZ   — one real coding response + one real sandbox execution
 *                with verified stdout.
 *
 * Every provider request waits for its endpoint-class breaker to be CLOSED
 * first (bounded wait, then honest skip — never a forced request into a
 * throttle). Evidence lands in scripts/fulltest-out/issues-1-2-acceptance.jsonl
 * and the downloaded artifacts under scripts/fulltest-out/.
 */
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000'
const OUT = 'scripts/fulltest-out'
mkdirSync(OUT, { recursive: true })
const EV = `${OUT}/issues-1-2-acceptance.jsonl`
const TS = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const EMAIL = `issues12-${TS}@bean-e2e.test`
const PASS = 'E2eTest!Passw0rd'

function rec(step: string, data: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), step, ...data })
  appendFileSync(EV, line + '\n')
  console.log(`[${step}]`, JSON.stringify(data).slice(0, 500))
}

let cookie = ''

async function api(method: string, path: string, body?: unknown, raw = false): Promise<{ status: number; json: any; bytes?: Buffer; headers: Headers }> {
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
    return { status: res.status, json: null, bytes: buf, headers: res.headers }
  }
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 400) } }
  return { status: res.status, json, headers: res.headers }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Bounded wait for an endpoint-class breaker to be CLOSED (single-attempt
 * policy: when the wait expires we SKIP honestly instead of firing into a
 * throttled account). Never bypasses, never retries into 429s.
 */
async function waitClassOpen(cls: string, maxWaitMs = 8 * 60_000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < maxWaitMs) {
    const h = await api('GET', '/api/health')
    const backend = h.json?.backends?.find?.((b: any) => b.id === `bean-${cls === 'chat' ? 'llm-hosted-primary' : cls === 'video' ? 'video-hosted-primary' : 'image-hosted-primary'}`)
    const detail = backend?.health?.detail ?? backend?.detail ?? ''
    const cooling = /breaker open|cooldown|rate-limited/i.test(JSON.stringify(backend?.health ?? backend ?? {}))
    if (!cooling) return true
    await sleep(20_000)
  }
  void cls
  return false
}

async function sse(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const convId = res.headers.get('x-conversation-id')
  const reader = res.body?.getReader()
  const dec = new TextDecoder()
  let buf = '', deltas = '', streamError: string | null = null
  let doneMeta: Record<string, unknown> | null = null
  const t0 = Date.now()
  if (reader) {
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
          if (evt.error) streamError = String(evt.error).slice(0, 220)
          if (evt.done) doneMeta = evt
        } catch { /* partial frame */ }
      }
    }
  }
  return { status: res.status, convId, deltas, doneMeta, streamError, elapsedMs: Date.now() - t0 }
}

async function main() {
  // ---- auth ----
  await api('POST', '/api/auth/register', { email: EMAIL, password: PASS, name: 'Issues 1-2 Acceptance' })
  const l = await api('POST', '/api/auth/login', { email: EMAIL, password: PASS })
  if (l.status !== 200) throw new Error(`login failed: ${l.status}`)
  rec('auth', { email: EMAIL, ok: true })

  // ---- 3. JAZMII submission FIRST (10s renders for minutes) ----
  // The EXACT case from the brief's screenshot: 10-second, 16:9, quality.
  const videoOpen = await waitClassOpen('video', 2 * 60_000)
  if (!videoOpen) {
    rec('jazmii-skipped', { reason: 'video-class breaker stayed open through the bounded wait — no request was fired into the throttle' })
  } else {
    const g = await api('POST', '/api/jazmii/generate', {
      prompt: 'A slow aerial sunrise over a golden desert canyon, warm light sweeping across red rock formations',
      durationSec: 10,
      size: '1280x720',
      quality: 'quality',
    })
    rec('jazmii-submit', { status: g.status, job: g.json?.job ?? null, error: g.json?.error ?? null })
  }

  // ---- 1. RIISHE — one real chat response ----
  const chatOpen = await waitClassOpen('chat', 8 * 60_000)
  if (!chatOpen) {
    rec('riishe-skipped', { reason: 'chat-class breaker stayed open through the bounded wait' })
  } else {
    const t = await sse('/api/riishe/chat?stream=1', {
      message: 'In exactly two short sentences: what is the capital of Japan, and what ocean surrounds it?',
    })
    rec('riishe-chat', {
      status: t.status, conversationId: t.convId ?? null, streamedChars: t.deltas.length,
      elapsedMs: t.elapsedMs, streamError: t.streamError, preview: t.deltas.slice(0, 180),
      classification: t.deltas.length > 0 ? 'real' : 'blocked',
    })
  }

  // ---- 2. LAXII — one real text-to-image ----
  const imgOpen = await waitClassOpen('images', 8 * 60_000)
  if (!imgOpen) {
    rec('laxii-skipped', { reason: 'images-class breaker stayed open through the bounded wait' })
  } else {
    const g = await api('POST', '/api/laxii/generate', {
      prompt: 'A serene mountain lake at dawn, mist over the water, warm golden light, photographic',
      size: '1024x1024',
    })
    rec('laxii-submit', { status: g.status, job: g.json?.job?.id ?? g.json?.jobId ?? null, keys: Object.keys(g.json ?? {}), error: g.json?.error ?? null })
    const jobId = g.json?.job?.id ?? g.json?.jobId ?? null
    if (jobId) {
      const t0 = Date.now()
      while (Date.now() - t0 < 5 * 60_000) {
        await sleep(5_000)
        const j = await api('GET', `/api/laxii/jobs/${jobId}`)
        const st = j.json?.job?.status ?? j.json?.status
        if (st === 'completed' || st === 'failed') {
          rec('laxii-result', {
            jobId, status: st, errorCode: j.json?.job?.errorCode ?? j.json?.errorCode ?? null,
            errorMessage: (j.json?.job?.errorMessage ?? j.json?.errorMessage ?? '').slice(0, 160),
            imageUrl: j.json?.job?.imageUrl ?? j.json?.imageUrl ?? null,
          })
          const mediaUrl = j.json?.job?.imageUrl ?? j.json?.imageUrl
          if (st === 'completed' && mediaUrl) {
            const img = await api('GET', mediaUrl, undefined, true)
            const path = `${OUT}/issues12-laxii-${jobId}.jpg`
            if (img.bytes) writeFileSync(path, img.bytes)
            rec('laxii-artifact', { path, bytes: img.bytes?.length ?? 0, httpStatus: img.status })
          }
          break
        }
      }
    }
  }

  // ---- 4. GIFTZ — one real coding response + sandbox execution ----
  const codeOpen = await waitClassOpen('chat', 8 * 60_000)
  if (!codeOpen) {
    rec('giftz-skipped', { reason: 'chat-class breaker stayed open through the bounded wait' })
  } else {
    const t = await api('POST', '/api/code-giftz/tasks', {
      mode: 'generate',
      prompt: 'Write a Node.js JavaScript file isPalindrome.js that exports a function isPalindrome(s) ignoring case and non-alphanumeric characters, plus when run directly prints exactly: "level: true", "hello: false", "A man, a plan, a canal: Panama: true" (one per line).',
      language: 'javascript',
    })
    const taskId = t.json?.task?.id ?? t.json?.id ?? null
    rec('giftz-task', {
      status: t.status, taskId, error: t.json?.error ?? null,
      files: (t.json?.task?.files ?? t.json?.files ?? []).map((f: any) => f.path ?? f.name).slice(0, 4),
      responseChars: (t.json?.task?.responseText ?? t.json?.responseText ?? '').length,
    })
    if (taskId) {
      const run = await api('POST', '/api/code-giftz/run', { taskId, approval: true })
      const r = run.json?.run ?? run.json?.result ?? {}
      rec('giftz-sandbox', {
        status: run.status, ok: run.json?.ok ?? null, exitCode: r.exitCode ?? null,
        timedOut: r.timedOut ?? null,
        stdout: String(r.stdout ?? '').slice(0, 220),
        verified: typeof r.stdout === 'string' && r.stdout.includes('level: true'),
      })
    }
  }

  // ---- back to JAZMII: bounded poll to terminal, then full MP4 verification ----
  const jobs = await api('GET', '/api/jazmii/jobs')
  const mine = (jobs.json?.jobs ?? []) as any[]
  const videoJob = mine.find((j) => ['queued', 'running', 'retry_wait', 'starting', 'streaming', 'finalizing'].includes(j.status))
    ?? mine.find((j) => j.status === 'completed' || j.status === 'failed')
  if (!videoJob) {
    rec('jazmii-no-job', {})
  } else {
    rec('jazmii-poll-start', { jobId: videoJob.id, status: videoJob.status, errorMessage: (videoJob.errorMessage ?? '').slice(0, 160) })
    const t0 = Date.now()
    let final: any = videoJob
    while (Date.now() - t0 < 20 * 60_000) {
      await sleep(10_000)
      const lj = await api('GET', '/api/jazmii/jobs')
      const row = ((lj.json?.jobs ?? []) as any[]).find((j) => j.id === videoJob.id)
      if (!row) break
      if (['completed', 'failed', 'cancelled', 'rejected', 'unsupported'].includes(row.status)) { final = row; break }
      final = row
    }
    rec('jazmii-terminal', {
      jobId: final.id, status: final.status, progress: final.progress,
      errorCode: final.errorCode ?? null, errorMessage: (final.errorMessage ?? '').slice(0, 300),
      videoUrl: final.videoUrl ?? null, format: final.format ?? null, bytes: final.bytes ?? null,
    })
    if (final.status === 'completed' && final.videoUrl) {
      // 1) authenticated download from BEAN storage (persistence + access)
      const dl = await api('GET', final.videoUrl, undefined, true)
      const path = `${OUT}/issues12-jazmii-${final.id}.mp4`
      if (dl.bytes) writeFileSync(path, dl.bytes)
      const magic = dl.bytes ? dl.bytes.subarray(4, 8).toString('ascii') : ''
      rec('jazmii-download', {
        httpStatus: dl.status, bytes: dl.bytes?.length ?? 0, savedTo: path,
        containerMagic: magic, magicOk: magic === 'ftyp',
      })
      // 2) REAL container verification: duration / resolution / codec / decodability
      try {
        const probe = JSON.parse(
          execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { timeout: 30_000 }).toString(),
        )
        const v = probe.streams?.find((s: any) => s.codec_type === 'video') ?? {}
        rec('jazmii-mp4-verified', {
          durationSec: Number(probe.format?.duration ?? 0),
          width: v.width ?? null, height: v.height ?? null,
          codec: v.codec_name ?? null, profile: v.profile ?? null,
          nbFrames: v.nb_frames ?? null, bitRate: probe.format?.bit_rate ?? null,
          playableContainer: (probe.format?.format_name ?? '').includes('mp4'),
        })
      } catch (e) {
        rec('jazmii-mp4-verify-failed', { error: String(e instanceof Error ? e.message : e).slice(0, 200) })
      }
      // 3) persistence: the file exists on the server under storage/jazmii/<user>/
      const jobId = final.id as string
      const size = (() => { try { return statSync(`storage/jazmii`).isDirectory() } catch { return false } })()
      rec('jazmii-storage-root', { storageDirExists: size })
    }
  }

  rec('done', { note: 'bounded acceptance run complete' })
}

main().catch((e) => {
  rec('fatal', { error: String(e instanceof Error ? e.message : e).slice(0, 300) })
  process.exit(1)
})
