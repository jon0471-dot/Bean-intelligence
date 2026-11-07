/** One bounded T2V attempt in a fresh window (single submission, no retries). */
const BASE = 'http://localhost:3000'
const EMAIL = process.argv[2] ?? `t2v-retry-${Date.now().toString(36)}@bean-e2e.test`
const PASS = 'E2eTest!Passw0rd'
let cookie = ''
async function api(method: string, path: string, body?: unknown, raw = false) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), Accept: raw ? '*/*' : 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const sc = res.headers.getSetCookie?.() ?? []
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ')
  if (raw) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) }
  const t = await res.text()
  try { return { status: res.status, json: JSON.parse(t) } } catch { return { status: res.status, json: { raw: t.slice(0, 150) } } }
}
const { appendFileSync } = await import('node:fs')
const rec = (step: string, data: object) => { appendFileSync('scripts/fulltest-out/evidence.jsonl', JSON.stringify({ at: new Date().toISOString(), step, ...data }) + '\n'); console.log(`[${step}]`, JSON.stringify(data).slice(0, 300)) }
await api('POST', '/api/auth/register', { email: EMAIL, password: PASS, name: 'T2V Retry' })
await api('POST', '/api/auth/login', { email: EMAIL, password: PASS })
const g = await api('POST', '/api/jazmii/generate', { prompt: 'A slow cinematic drone shot rising over a golden desert canyon at dawn, warm light, dust motes in the air', size: '1280x720', durationSec: 5, quality: 'speed', withAudio: false })
const jobId = g.json?.job?.id ?? null
rec('jazmii-t2v-retry-submit', { status: g.status, jobId, code: g.json?.code ?? null, classification: 'real' })
if (!jobId) process.exit(0)
const t0 = Date.now()
while (Date.now() - t0 < 12 * 60_000) {
  await new Promise((r) => setTimeout(r, 10_000))
  const r = await api('GET', `/api/jazmii/jobs/${jobId}`)
  const j = r.json?.job ?? {}
  if (j.status === 'completed') {
    const m = await api('GET', String(j.videoUrl), undefined, true)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`scripts/fulltest-out/jazmii-t2v-${jobId}.mp4`, m.bytes ?? Buffer.alloc(0))
    let ff = null
    try { const { execFileSync } = await import('node:child_process'); ff = execFileSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,duration','-of','json',`scripts/fulltest-out/jazmii-t2v-${jobId}.mp4`], { encoding: 'utf8' }) } catch {}
    rec('jazmii-t2v-retry-completed', { jobId, bytes: j.bytes, format: j.format, mediaBytes: m.bytes?.length, mp4Magic: m.bytes?.toString('ascii',4,8) === 'ftyp', ffprobe: ff ? ff.replace(/\s+/g,' ').slice(0,180) : null, artifact: `scripts/fulltest-out/jazmii-t2v-${jobId}.mp4`, classification: 'real' })
    process.exit(0)
  }
  if (j.status === 'failed') { rec('jazmii-t2v-retry-failed', { jobId, errorCode: j.errorCode, errorMessage: j.errorMessage, classification: 'blocked' }); process.exit(0) }
}
rec('jazmii-t2v-retry-timeout', { jobId, classification: 'blocked' })
