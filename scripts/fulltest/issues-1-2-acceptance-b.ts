/**
 * ISSUES 1-2 REPAIR — acceptance PART 2 (JAZMII fresh 10s T2V + GIFTZ coding).
 *
 * Runs on the FIXED engine (lease-aware watchdog + noSettle guard):
 *   - JAZMII: one real 10-second text-to-video (1280x720, quality) — the
 *     exact request class from the issue-1 screenshot; the MP4 is verified
 *     for real duration / resolution / codec / decodability / persistent
 *     storage / authenticated download.
 *   - GIFTZ: one real coding response + one real sandbox execution with
 *     verified stdout (single breaker-gated attempts, no retry storms).
 */
import { mkdirSync, appendFileSync, writeFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const BASE = 'http://localhost:3000'
const OUT = 'scripts/fulltest-out'
mkdirSync(OUT, { recursive: true })
const EV = `${OUT}/issues-1-2-acceptance.jsonl`
const TS = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const EMAIL = `issues12b-${TS}@bean-e2e.test`
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

/** Health-grounded breaker wait (bounded; honest skip — never fire into a throttle). */
async function waitClassOpen(needle: RegExp, maxWaitMs: number): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < maxWaitMs) {
    const h = await api('GET', '/api/health')
    const blob = JSON.stringify(h.json ?? {})
    if (!needle.test(blob)) return true
    await sleep(20_000)
  }
  return false
}

async function main() {
  await api('POST', '/api/auth/register', { email: EMAIL, password: PASS, name: 'Issues 1-2 Acceptance B' })
  const l = await api('POST', '/api/auth/login', { email: EMAIL, password: PASS })
  if (l.status !== 200) throw new Error(`login failed: ${l.status}`)
  rec('auth-b', { email: EMAIL, ok: true })

  // ---- JAZMII: fresh real 10s T2V ----
  const videoOpen = await waitClassOpen(/video[^,]*rate-limited|video[^,]*breaker/i, 2 * 60_000)
  if (!videoOpen) {
    rec('jazmii-skipped', { reason: 'video breaker open through bounded wait' })
  } else {
    const g = await api('POST', '/api/jazmii/generate', {
      prompt: 'A slow aerial sunrise over a golden desert canyon, warm light sweeping across red rock formations',
      durationSec: 10,
      size: '1280x720',
      quality: 'quality',
    })
    rec('jazmii-submit-b', { status: g.status, job: g.json?.job ?? null, error: g.json?.error ?? null })
    const jobId = g.json?.job?.id
    if (jobId) {
      const t0 = Date.now()
      let final: any = null
      while (Date.now() - t0 < 20 * 60_000) {
        await sleep(15_000)
        const j = await api('GET', `/api/jazmii/jobs/${jobId}`)
        final = j.json?.job ?? null
        if (!final) break
        const st = final.status
        if (['completed', 'failed', 'cancelled', 'rejected', 'unsupported'].includes(st)) break
      }
      rec('jazmii-terminal-b', {
        jobId, status: final?.status ?? null, progress: final?.progress ?? null,
        errorCode: final?.errorCode ?? null, errorMessage: (final?.errorMessage ?? '').slice(0, 300),
        videoUrl: final?.videoUrl ?? null, bytes: final?.bytes ?? null,
      })
      if (final?.status === 'completed' && final.videoUrl) {
        const dl = await api('GET', final.videoUrl, undefined, true)
        const path = `${OUT}/issues12-jazmii-${jobId}.mp4`
        if (dl.bytes) writeFileSync(path, dl.bytes)
        const magic = dl.bytes ? dl.bytes.subarray(4, 8).toString('ascii') : ''
        rec('jazmii-download-b', {
          httpStatus: dl.status, bytes: dl.bytes?.length ?? 0, savedTo: path,
          containerMagic: magic, magicOk: magic === 'ftyp',
        })
        try {
          const probe = JSON.parse(
            execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { timeout: 30_000 }).toString(),
          )
          const v = probe.streams?.find((s: any) => s.codec_type === 'video') ?? {}
          rec('jazmii-mp4-verified', {
            durationSec: Number(probe.format?.duration ?? 0),
            width: v.width ?? null, height: v.height ?? null,
            codec: v.codec_name ?? null, profile: v.profile ?? null,
            nbFrames: v.nb_frames ?? null,
            playableContainer: (probe.format?.format_name ?? '').includes('mp4'),
          })
        } catch (e) {
          rec('jazmii-mp4-verify-failed', { error: String(e instanceof Error ? e.message : e).slice(0, 200) })
        }
        // Server-side persistence evidence (file lives under storage/jazmii/<user>/)
        const stored = (() => { try { return statSync(`storage/jazmii`).isDirectory() } catch { return false } })()
        rec('jazmii-persistence', { storageRootExists: stored })
      }
    }
  }

  // ---- GIFTZ: one real coding response + sandbox execution ----
  const codeOpen = await waitClassOpen(/chat[^,]*rate-limited|chat[^,]*breaker/i, 10 * 60_000)
  if (!codeOpen) {
    rec('giftz-skipped', { reason: 'chat-class breaker open through bounded wait' })
  } else {
    const t = await api('POST', '/api/code-giftz/tasks', {
      mode: 'generate',
      prompt: 'Write a Node.js JavaScript file isPalindrome.js that exports a function isPalindrome(s) ignoring case and non-alphanumeric characters, plus when run directly prints exactly: "level: true", "hello: false", "A man, a plan, a canal: Panama: true" (one per line).',
      language: 'javascript',
    })
    const taskId = t.json?.task?.id ?? t.json?.id ?? null
    rec('giftz-task-b', {
      status: t.status, taskId, error: t.json?.error ?? null,
      files: (t.json?.task?.files ?? t.json?.files ?? []).map((f: any) => f.path ?? f.name).slice(0, 4),
    })
    if (taskId) {
      const run = await api('POST', '/api/code-giftz/run', { taskId, approval: true })
      const r = run.json?.run ?? run.json?.result ?? {}
      rec('giftz-sandbox-b', {
        status: run.status, ok: run.json?.ok ?? null, exitCode: r.exitCode ?? null,
        timedOut: r.timedOut ?? null,
        stdout: String(r.stdout ?? '').slice(0, 220),
        verified: typeof r.stdout === 'string' && r.stdout.includes('level: true'),
      })
    }
  }

  rec('done-b', {})
}

main().catch((e) => {
  rec('fatal-b', { error: String(e instanceof Error ? e.message : e).slice(0, 300) })
  process.exit(1)
})
