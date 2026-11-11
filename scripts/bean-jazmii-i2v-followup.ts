/**
 * BEAN — JAZMII I2V completion follow-up (Phase 5/10).
 *
 * The Phase-5 live run left the image-to-video job throttle-parked in
 * retry_wait (account-wide 429 window). This harness logs back in as the
 * same acceptance user (fixed password, deterministic email), waits for the
 * parked job's bounded retries to land, and on completion downloads the
 * artifact, validates it with ffprobe and records SHA-256 + stream facts.
 * A terminal failure is recorded honestly.
 *
 * Usage: bun scripts/bean-jazmii-i2v-followup.ts <jobId> <email>
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const BASE = 'http://localhost:3000'
const OUT_DIR = 'scripts/bean-optrans-out'
mkdirSync(OUT_DIR, { recursive: true })

const jobId = process.argv[2] ?? 'cmwbh554h001drdvroepc6fwe'
const email = process.argv[3] ?? 'jazmii-acc-1794362021597@bean.local'
const PASSWORD = 'Bean-Acc-2026!x'

interface Step {
  step: string
  ok: boolean
  httpStatus: number | null
  detail: string
  at: string
  evidence?: unknown
}
const steps: Step[] = []
function rec(step: string, ok: boolean, httpStatus: number | null, detail: string, evidence?: unknown) {
  steps.push({ step, ok, httpStatus, detail, at: new Date().toISOString(), ...(evidence !== undefined ? { evidence } : {}) })
  console.log(`${ok ? 'PASS' : 'NOTE'} ${step} :: ${detail}${httpStatus != null ? ` [HTTP ${httpStatus}]` : ''}`)
}

function jar() {
  let cookie = ''
  return {
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

const j = jar()
const login = await j.call('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: PASSWORD }),
})
rec('auth: re-login acceptance user', login.status === 200, login.status, email)
if (login.status !== 200) process.exit(1)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const deadline = Date.now() + 35 * 60_000
let last: Record<string, unknown> = {}
let done: string | null = null
const t0 = Date.now()
while (Date.now() < deadline) {
  await sleep(15_000)
  const r = await j.call(`/api/jazmii/jobs/${jobId}`)
  last = (await r.json().catch(() => ({}))) as Record<string, unknown>
  const status = String((last as { job?: { status?: string } }).job?.status ?? '')
  if (['completed', 'failed', 'rejected', 'cancelled'].includes(status)) { done = status; break }
  process.stdout.write(`. ${status}@${new Date().toISOString()}\n`)
}
const elapsedSec = Math.round((Date.now() - t0) / 100) / 10
rec('i2v: terminal state', done === 'completed', null, `status=${done ?? 'timeout'} elapsed=${elapsedSec}s`, { job: last, elapsedSec })

if (done === 'completed') {
  const media = await j.call(`/api/jazmii/jobs/${jobId}/media`)
  const buf = Buffer.from(await media.arrayBuffer())
  const file = path.join(OUT_DIR, `jazmii-i2v-${jobId}.mp4`)
  if (media.status === 200 && buf.length > 0) writeFileSync(file, buf)
  let facts: Record<string, unknown> | null = null
  if (existsSync(file)) {
    const out = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', timeout: 30_000 })
    const parsed = JSON.parse(out) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> }
    const v = (parsed.streams ?? []).find((s) => s.codec_type === 'video') ?? {}
    facts = {
      codec: v.codec_name ?? null,
      width: v.width ?? null,
      height: v.height ?? null,
      durationSec: Number(v.duration ?? parsed.format?.duration ?? 0),
      nb_frames: v.nb_frames ?? null,
      formatName: parsed.format?.format_name ?? null,
      sizeBytes: parsed.format?.size ?? null,
    }
  }
  const sha = existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null
  rec(
    'i2v: artifact ffprobe validation',
    Boolean(facts && facts.codec && Number(facts.durationSec) >= 0.5),
    media.status,
    facts ? JSON.stringify(facts) : 'no artifact',
    { file, sha256: sha, bytes: buf.length },
  )
}

const health = await fetch(`${BASE}/api/health`).then((r) => r.json() as Promise<Record<string, unknown>>)
const jazmii = (health.products as Record<string, Record<string, unknown>>)?.jazmii
rec('final: jazmii health snapshot', true, 200, 'capabilities recorded', { jazmii })

writeFileSync(path.join(OUT_DIR, 'jazmii-i2v-followup.json'), JSON.stringify({ runAt: new Date().toISOString(), jobId, steps }, null, 1))
console.log('DONE')
