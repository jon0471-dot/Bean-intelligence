/**
 * BEAN Intelligence — M39 supplementary GANGZII audio-chain probe.
 *
 * Focused completion evidence for the audio lanes after the sandbox's
 * dev-mode server hit its RAM ceiling during full-matrix runs (kernel OOM
 * recorded in dmesg; dev-mode keeps every ONNX/ffmpeg lane's memory in one
 * process). This probe runs ONLY the GANGZII chain against the real dev
 * server: local Kokoro TTS → hosted ASR on that real speech → ffmpeg MP3
 * conversion → ffmpeg production chain (trim + fade-in).
 *
 * Honest outcomes: ok:true only on validated output, ok:null honest
 * unavailability, ok:false genuine failure.
 *
 * Run: BASE=http://localhost:3000 bun scripts/m39-acceptance/audio-probe.ts
 * Out: scripts/m39-acceptance/out/audio-probe.json
 */
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BEAN_ACCEPT_BASE ?? 'http://localhost:3000'
const OUT_DIR = 'scripts/m39-acceptance/out'
mkdirSync(OUT_DIR, { recursive: true })

interface Step {
  capability: string
  ok: boolean | null
  status: number | null
  detail: string
  at: string
}
const steps: Step[] = []
function record(capability: string, ok: boolean | null, status: number | null, detail: string) {
  steps.push({ capability, ok, status, detail, at: new Date().toISOString() })
  const tag = ok === true ? 'PASS' : ok === false ? 'FAIL' : 'NOTE'
  console.log(`${tag} ${capability} :: ${detail}${status != null ? ` [HTTP ${status}]` : ''}`)
}

function jar() {
  let cookie = ''
  return {
    async call(path: string, init: RequestInit = {}): Promise<Response> {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
      })
      const setCookie = res.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      return res
    },
  }
}

async function waitJob(j: ReturnType<typeof jar>, jobId: string, timeoutMs = 180_000, pollMs = 2_000): Promise<{ status: string; result: Record<string, unknown> | null; errorMessage: string | null } | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const res = await j.call(`/api/ai/jobs/${jobId}`)
    if (res.ok) {
      const json = (await res.json()) as { job: { status: string; result: Record<string, unknown> | null; errorMessage: string | null } }
      if (['completed', 'failed', 'cancelled'].includes(json.job.status)) return json.job
    }
    if (Date.now() > deadline) return null
    await new Promise((r) => setTimeout(r, pollMs))
  }
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const email = `m39-audio-${stamp}@bean-test.local`
  const j = jar()
  await j.call('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Bean-Accept-2026!', name: 'M39 Audio Probe' }),
  })
  const login = await j.call('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Bean-Accept-2026!' }),
  })
  if (login.status !== 200) {
    record('auth', false, login.status, 'login failed')
    return
  }

  // 1. LOCAL Kokoro synthesis (engine install idempotent).
  const inst = await j.call('/api/gangzii/tts-engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'install' }) })
  const instOk = inst.ok
  if (!instOk) {
    record('gangzii.engine-install', false, inst.status, 'Kokoro engine install failed')
    return
  }
  const r = await j.call('/api/gangzii/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Bean Intelligence runs speech synthesis on your device.', voice: 'af_heart', speed: 1.0, source: 'studio' }),
  })
  const rb = (await r.json().catch(() => ({}))) as { job?: { id: string }; error?: { message?: string } }
  let wav: Uint8Array | null = null
  if (r.status === 202 && rb.job?.id) {
    const job = await waitJob(j, rb.job.id)
    const audioUrl = (job?.result as { audioUrl?: string } | null)?.audioUrl
    if (job?.status === 'completed' && audioUrl) {
      const audio = await j.call(audioUrl)
      wav = new Uint8Array(await audio.arrayBuffer())
      const isWav = wav[0] === 0x52 && wav[1] === 0x49 && wav[2] === 0x46 && wav[3] === 0x46
      record('gangzii.speech-synthesis-local', isWav && wav.length > 20_000, audio.status, `REAL local Kokoro synthesis ${wav.length} bytes (RIFF ${isWav})`)
    } else {
      record('gangzii.speech-synthesis-local', false, null, job ? `job ended ${job.status}: ${job.errorMessage}` : 'wait timeout')
      return
    }
  } else {
    record('gangzii.speech-synthesis-local', false, r.status, rb.error?.message ?? 'submit rejected')
    return
  }

  // 2. HOSTED ASR on that real speech.
  {
    const form = new FormData()
    form.append('file', new Blob([wav as unknown as BlobPart], { type: 'audio/wav' }), 'probe-tts.wav')
    const tr = await j.call('/api/gangzii/transcribe', { method: 'POST', body: form })
    const tb = (await tr.json().catch(() => ({}))) as { job?: { id: string }; error?: { message?: string } }
    if (tr.status === 202 && tb.job?.id) {
      const job = await waitJob(j, tb.job.id)
      const text = String((job?.result as { transcript?: string } | null)?.transcript ?? '')
      record('gangzii.audio-transcription', text.length > 0, 200, `REAL ASR output: "${text.slice(0, 140)}"`)
    } else {
      record('gangzii.audio-transcription', false, tr.status, tb.error?.message ?? 'transcribe rejected')
    }
  }

  // 3. LOCAL ffmpeg conversion (WAV → MP3).
  {
    const form = new FormData()
    form.append('file', new Blob([wav as unknown as BlobPart], { type: 'audio/wav' }), 'probe-tts.wav')
    form.append('target', 'mp3')
    const cr = await j.call('/api/gangzii/convert', { method: 'POST', body: form })
    const cb = (await cr.json().catch(() => ({}))) as { job?: { id: string }; error?: { message?: string } }
    if (cr.status === 202 && cb.job?.id) {
      const job = await waitJob(j, cb.job.id)
      const audioUrl = ((job?.result ?? {}) as { audioUrl?: string; artifactUrl?: string }).audioUrl ?? ((job?.result ?? {}) as { artifactUrl?: string }).artifactUrl
      if (job?.status === 'completed' && audioUrl) {
        const audio = await j.call(audioUrl)
        const buf = new Uint8Array(await audio.arrayBuffer())
        const isMp3 = (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
        record('gangzii.audio-conversion', isMp3 && buf.length > 10_000, audio.status, `REAL ffmpeg transcode ${buf.length} bytes (MP3 ${isMp3})`)
      } else {
        record('gangzii.audio-conversion', false, null, job ? `job ended ${job.status}: ${job.errorMessage}` : 'wait timeout')
      }
    } else {
      record('gangzii.audio-conversion', false, cr.status, cb.error?.message ?? 'convert rejected')
    }
  }

  // 4. LOCAL ffmpeg production chain (trim + fade-in, validated output).
  {
    const form = new FormData()
    form.append('file', new Blob([wav as unknown as BlobPart], { type: 'audio/wav' }), 'probe-tts.wav')
    const up = await j.call('/api/gangzii/assets', { method: 'POST', body: form })
    const ub = (await up.json().catch(() => ({}))) as { asset?: { id?: string }; error?: { message?: string } }
    const assetId = ub.asset?.id
    if (!assetId) {
      record('gangzii.audio-production', false, up.status, `asset upload failed: ${ub.error?.message ?? 'unknown'}`)
      return
    }
    const pr = await j.call('/api/gangzii/produce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceAssetId: assetId, operations: [{ op: 'trim', params: { startSec: 0.2 } }, { op: 'fade-in', params: { durationSec: 0.3 } }], output: { format: 'wav' } }),
    })
    const pb = (await pr.json().catch(() => ({}))) as { jobId?: string; rejected?: boolean; error?: { message?: string } }
    if (pr.status === 202 && pb.jobId) {
      const deadline = Date.now() + 120_000
      let gj: { status?: string; result?: Record<string, unknown> | null; errorMessage?: string } = {}
      for (;;) {
        const jr = await j.call(`/api/gangzii/jobs/${pb.jobId}`)
        const jb = (await jr.json().catch(() => ({}))) as { job?: { status?: string; result?: Record<string, unknown> | null; errorMessage?: string }; error?: { message?: string } }
        gj = jb.job ?? {}
        if (['completed', 'failed', 'cancelled'].includes(gj.status ?? '') || Date.now() > deadline) break
        await new Promise((r) => setTimeout(r, 2_000))
      }
      const result = gj.result ?? null
      const audioUrl = ((result ?? {}) as { audioUrl?: string; artifactUrl?: string; url?: string }).audioUrl ?? ((result ?? {}) as { artifactUrl?: string; url?: string }).artifactUrl ?? ((result ?? {}) as { url?: string }).url
      if (gj.status === 'completed' && audioUrl) {
        const audio = await j.call(audioUrl)
        const buf = new Uint8Array(await audio.arrayBuffer())
        const isWav = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        record('gangzii.audio-production', isWav && buf.length > 10_000, audio.status, `REAL ffmpeg production chain (trim + fade-in) output ${buf.length} bytes (RIFF ${isWav})`)
      } else {
        record('gangzii.audio-production', false, null, `job ended ${gj.status ?? '?'}: ${gj.errorMessage ?? 'no result url'}`)
      }
    } else {
      record('gangzii.audio-production', false, pr.status, pb.error?.message ?? (pb.rejected ? `produce rejected: ${pb.rejected}` : 'produce rejected'))
    }
  }

  const pass = steps.filter((s) => s.ok === true).length
  const fail = steps.filter((s) => s.ok === false).length
  writeFileSync(`${OUT_DIR}/audio-probe.json`, JSON.stringify({ summary: { pass, fail, total: steps.length, at: new Date().toISOString() }, steps }, null, 2))
  console.log(`\nAUDIO PROBE: ${pass} PASS / ${fail} FAIL`)
  if (fail > 0) process.exitCode = 1
}

await main()
