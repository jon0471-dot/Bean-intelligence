/**
 * BEAN — JAZMII live acceptance (OPERATIONAL-TRANSFORMATION Phase 5/10).
 *
 * Real text-to-video AND image-to-video generations through the real app
 * path (auth → /api/jazmii/generate → worker → provider → ffprobe gate →
 * storage → media route). Every step records what actually happened; a
 * failure is recorded as such and never retried into a fake success.
 *
 * Output: scripts/bean-optrans-out/jazmii-acceptance.json (+ artifacts
 * copied + SHA-256). Evidence txt: docs/evidence/bean-optrans-jazmii.txt
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const BASE = 'http://localhost:3000'
const OUT_DIR = 'scripts/bean-optrans-out'
mkdirSync(OUT_DIR, { recursive: true })

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

const stamp = Date.now()
const email = `jazmii-acc-${stamp}@bean.local`
const j = jar()
const reg = await j.call('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'Bean-Acc-2026!x', name: 'Jazmii Acceptance' }),
})
const login = await j.call('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'Bean-Acc-2026!x' }),
})
rec('auth: register+login', reg.status === 200 || reg.status === 409 ? login.status === 200 : false, login.status, `user ${email}`)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runVideoJob(kind: 't2v' | 'i2v', payload: Record<string, unknown>, maxPollMs: number) {
  const t0 = Date.now()
  const res = await j.call('/api/jazmii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  const jobObj = (body.job ?? body) as Record<string, unknown>
  const jobId = (jobObj.id as string) ?? (body.jobId as string) ?? null
  const rl: Record<string, string> = {}
  for (const [k, v] of res.headers.entries()) if (/ratelimit|retry-after/i.test(k)) rl[k] = v
  rec(
    `${kind}: submit`,
    res.status === 202 && typeof jobId === 'string',
    res.status,
    typeof jobId === 'string' ? `jobId=${jobId}` : JSON.stringify(body).slice(0, 300),
    { jobId, rateLimitHeaders: rl },
  )
  if (typeof jobId !== 'string') return null

  const deadline = Date.now() + maxPollMs
  let last: Record<string, unknown> = {}
  let done: 'completed' | 'failed' | null = null
  while (Date.now() < deadline) {
    await sleep(10_000)
    const r = await j.call(`/api/jazmii/jobs/${jobId}`)
    last = (await r.json().catch(() => ({}))) as Record<string, unknown>
    const status = String((last as { job?: { status?: string } }).job?.status ?? '')
    if (status === 'completed') { done = 'completed'; break }
    if (status === 'failed' || status === 'rejected' || status === 'cancelled') { done = 'failed'; break }
  }
  const elapsedSec = Math.round((Date.now() - t0) / 100) / 10
  rec(`${kind}: terminal state`, done === 'completed', null, `status=${done ?? 'timeout'} elapsed=${elapsedSec}s`, { job: last, elapsedSec })
  if (done !== 'completed') return null
  return { jobId, elapsedSec, job: last }
}

function ffprobeFacts(file: string): Record<string, unknown> {
  const out = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8', timeout: 30_000 })
  const parsed = JSON.parse(out) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> }
  const v = (parsed.streams ?? []).find((s) => s.codec_type === 'video') ?? {}
  const a = (parsed.streams ?? []).find((s) => s.codec_type === 'audio') ?? null
  return {
    codec: v.codec_name ?? null,
    width: v.width ?? null,
    height: v.height ?? null,
    durationSec: Number(v.duration ?? parsed.format?.duration ?? 0),
    nb_frames: v.nb_frames ?? null,
    avg_frame_rate: v.avg_frame_rate ?? null,
    audioCodec: a ? a.codec_name : null,
    sizeBytes: parsed.format?.size ?? null,
    formatName: parsed.format?.format_name ?? null,
  }
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// ---------------------------------------------------------------- T2V
console.log('\n== T2V (text-to-video) ==')
const t2v = await runVideoJob(
  't2v',
  { prompt: 'A calm golden retriever puppy sleeping on a sunny windowsill, soft light, slow gentle camera push-in.', durationSec: 5, quality: 'speed' },
  12 * 60_000,
)

if (t2v) {
  const media = await j.call(`/api/jazmii/jobs/${t2v.jobId}/media`)
  const buf = Buffer.from(await media.arrayBuffer())
  const file = path.join(OUT_DIR, `jazmii-t2v-${t2v.jobId}.mp4`)
  if (media.status === 200 && buf.length > 0) writeFileSync(file, buf)
  const facts = media.status === 200 && existsSync(file) ? ffprobeFacts(file) : null
  rec(
    't2v: artifact ffprobe validation',
    Boolean(facts && (facts.nb_frames === undefined || Number(facts.nb_frames) >= 8) && Number(facts?.durationSec ?? 0) >= 0.5 && facts?.codec),
    media.status,
    facts ? JSON.stringify(facts) : 'no artifact',
    { file, sha256: existsSync(file) ? sha256(file) : null, bytes: buf.length, contentType: media.headers.get('content-type') },
  )
}

// ---------------------------------------------------------------- I2V
console.log('\n== I2V (image-to-video) ==')
const refPath = 'scripts/post-quota-acceptance-out/artifacts/laxii-t2i.jpeg'
if (!existsSync(refPath)) {
  rec('i2v: reference image', false, null, `missing reference artifact ${refPath}`)
} else {
  const b64 = readFileSync(refPath).toString('base64')
  const i2v = await runVideoJob(
    'i2v',
    { prompt: 'Gentle breeze moves through the scene, subtle parallax, cinematic motion.', imageUrl: `data:image/jpeg;base64,${b64}`, durationSec: 5, quality: 'speed' },
    12 * 60_000,
  )
  if (i2v) {
    const media = await j.call(`/api/jazmii/jobs/${i2v.jobId}/media`)
    const buf = Buffer.from(await media.arrayBuffer())
    const file = path.join(OUT_DIR, `jazmii-i2v-${i2v.jobId}.mp4`)
    if (media.status === 200 && buf.length > 0) writeFileSync(file, buf)
    const facts = media.status === 200 && existsSync(file) ? ffprobeFacts(file) : null
    rec(
      'i2v: artifact ffprobe validation',
      Boolean(facts && (facts.nb_frames === undefined || Number(facts.nb_frames) >= 8) && Number(facts?.durationSec ?? 0) >= 0.5 && facts?.codec),
      media.status,
      facts ? JSON.stringify(facts) : 'no artifact',
      { file, sha256: existsSync(file) ? sha256(file) : null, bytes: buf.length },
    )
  }
}

// ------------------------------------------------- final health snapshot
const health = await fetch(`${BASE}/api/health`).then((r) => r.json() as Promise<Record<string, unknown>>)
const jazmii = (health.products as Record<string, Record<string, unknown>>)?.jazmii
rec('final: jazmii health snapshot', true, 200, JSON.stringify((jazmii?.capabilities as unknown[]) ?? []).slice(0, 500), { jazmii })

const summary = {
  runAt: new Date().toISOString(),
  pass: steps.filter((s) => s.ok).length,
  note: steps.filter((s) => !s.ok).length,
  steps,
}
writeFileSync(path.join(OUT_DIR, 'jazmii-acceptance.json'), JSON.stringify(summary, null, 1))
writeFileSync('docs/evidence/bean-optrans-jazmii.txt', JSON.stringify(summary, null, 1))
console.log(`\nDONE pass=${summary.pass} note=${summary.note}`)
