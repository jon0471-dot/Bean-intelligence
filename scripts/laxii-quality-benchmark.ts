/**
 * LAXII VISUAL BENCHMARK (Part B §6) — ten controlled image tests.
 *
 * Cases A–J exactly as briefed. Each case: submit ONE generation job →
 * poll until completed/failed (bounded) → download the artifact → ffprobe
 * decode check → read the persisted intel/verification/correction reports.
 * Sequential, single-attempt (no retries into throttles, no repeated
 * submissions). Evidence JSON → scripts/laxii-benchmark-out/benchmark.json,
 * images → scripts/laxii-benchmark-out/artifacts/<case>.<ext>.
 */
import { db } from '../src/lib/db'

const BASE = 'http://localhost:3000'
const OUT_DIR = 'scripts/laxii-benchmark-out'
const ART_DIR = `${OUT_DIR}/artifacts`
const stamp = Date.now()
const EMAIL = `laxii-benchmark-${stamp}@bean.local`

interface CaseResult {
  id: string
  label: string
  prompt: string
  jobId: string | null
  status: string
  submitMs: number
  genMs: number
  pollCount: number
  width: number | null
  height: number | null
  format: string | null
  bytes: number | null
  ffprobe: string | null
  intel: { mode?: string; knowledgeComponents?: string[]; sceneSpec?: Record<string, unknown>; degraded?: string[]; conditioningChars?: number } | null
  verification: Record<string, unknown> | null
  defectCount: number
  correction: Record<string, unknown> | null
  sha256: string | null
  error: string | null
}

const CASES: Array<{ id: string; label: string; prompt: string; size: string }> = [
  { id: 'A', label: 'Photorealistic human portrait and hands', prompt: 'Photorealistic close-up portrait of a craftsman, his hands clearly visible holding a chisel over a workbench, natural window light, sharp focus on fingers', size: '864x1152' },
  { id: 'B', label: 'Bengal tiger anatomy, natural wildlife photography', prompt: 'A Bengal tiger walking through tall grass, natural wildlife photography, morning light', size: '1344x768' },
  { id: 'C', label: 'Eagle in mid-flight with anatomically correct wings', prompt: 'A bald eagle in mid-flight, wings fully spread with separated flight feathers, talons tucked, sky background', size: '1344x768' },
  { id: 'D', label: 'Glass falling and making contact with a hard surface', prompt: 'A wine glass falling and shattering as it hits a concrete floor, shards scattering, frozen at the moment of impact', size: '1024x1024' },
  { id: 'E', label: 'Water pouring into a transparent glass', prompt: 'Water pouring from a steel jug into a transparent glass on a marble counter, splash at the surface, bright kitchen light', size: '1024x1024' },
  { id: 'F', label: 'Cloth blowing in strong wind', prompt: 'Long red silk cloth blowing in strong wind on a coastal cliff, fabric stretched and rippling, dramatic sky', size: '1344x768' },
  { id: 'G', label: 'Realistic car collision scene', prompt: 'Two cars in a low-speed parking collision, crumpled front bumpers in contact, small debris on the asphalt, daylight street', size: '1344x768' },
  { id: 'H', label: 'Human walking through rain at night', prompt: 'A woman walking through heavy rain at night on a city street, umbrella, neon reflections on the wet asphalt', size: '864x1152' },
  { id: 'I', label: 'Complex architectural interior with accurate perspective', prompt: 'Grand museum interior with marble columns and a glass ceiling, one-point perspective down the central hall, accurate vanishing lines, daylight', size: '864x1152' },
  { id: 'J', label: 'Macro photograph of a transparent object with realistic refraction', prompt: 'Macro photograph of a solid glass sphere on a wooden table, realistic refraction of the background through the sphere, caustic light spot, shallow depth of field', size: '1024x1024' },
]

// ---------------------------------------------------------------- auth
let cookie = ''
async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  return res
}

async function ffprobeDesc(file: string): Promise<string | null> {
  try {
    const p = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', file])
    const out = p.stdout.toString().trim()
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

async function sha256(file: string): Promise<string | null> {
  try {
    const p = Bun.spawnSync(['sha256sum', file])
    return p.stdout.toString().trim().split(/\s+/)[0] || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- run
Bun.spawnSync(['mkdir', '-p', ART_DIR])
const reg = await call('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: 'Bean-Accept-2026!', name: 'Laxii Benchmark' }),
})
const login = await call('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: 'Bean-Accept-2026!' }),
})
console.log(`auth: register=${reg.status} login=${login.status}`)
if (login.status !== 200) process.exit(1)

const results: CaseResult[] = []
for (const c of CASES) {
  const r: CaseResult = {
    id: c.id, label: c.label, prompt: c.prompt, jobId: null, status: 'unsubmitted',
    submitMs: 0, genMs: 0, pollCount: 0, width: null, height: null, format: null,
    bytes: null, ffprobe: null, intel: null, verification: null, defectCount: 0,
    correction: null, sha256: null, error: null,
  }
  const t0 = Date.now()
  try {
    const sub = await call('/api/laxii/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: c.prompt, size: c.size }),
    })
    const subJson = await sub.json().catch(() => ({}))
    r.submitMs = Date.now() - t0
    const job = (subJson as { job?: { id?: string; status?: string } }).job
    r.jobId = job?.id ?? null
    r.status = sub.status === 202 ? 'submitted' : `submit-${sub.status}`
    if (sub.status !== 202 || !job?.id) {
      r.error = JSON.stringify(subJson).slice(0, 200)
      results.push(r)
      console.log(`[${c.id}] SUBMIT FAILED: ${sub.status} ${r.error}`)
      continue
    }
    // Bounded poll (single job at a time; 60 × 3s = 180s cap per case).
    let settled = false
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 3_000))
      r.pollCount++
      const poll = await call(`/api/laxii/jobs/${job.id}`)
      const pj = (await poll.json().catch(() => ({}))) as { job?: { status?: string; progress?: number; errorMessage?: string } }
      const st = pj.job?.status ?? 'unknown'
      if (st === 'completed' || st === 'failed') {
        r.status = st
        r.genMs = Date.now() - t0
        if (st === 'failed') r.error = pj.job?.errorMessage ?? 'failed (no message)'
        settled = true
        break
      }
    }
    if (!settled) {
      r.status = 'poll-timeout'
      r.error = 'job did not settle within 180s'
      results.push(r)
      console.log(`[${c.id}] POLL TIMEOUT`)
      continue
    }
    if (r.status !== 'completed') {
      results.push(r)
      console.log(`[${c.id}] FAILED: ${r.error}`)
      continue
    }
    // Read the FULL persisted row (verification + correction + intel).
    const row = await db.generationJob.findUnique({ where: { id: job.id } })
    const resultJson = row?.resultJson ? (JSON.parse(row.resultJson) as Record<string, unknown>) : null
    r.width = (resultJson?.width as number) ?? null
    r.height = (resultJson?.height as number) ?? null
    r.format = (resultJson?.format as string) ?? null
    r.bytes = (resultJson?.bytes as number) ?? null
    const intel = resultJson?.intel as Record<string, unknown> | undefined
    if (intel) {
      r.intel = {
        mode: intel.mode as string,
        knowledgeComponents: intel.knowledgeComponents as string[],
        sceneSpec: intel.sceneSpec as Record<string, unknown>,
        degraded: intel.degraded as string[],
        conditioningChars: intel.conditioningChars as number,
      }
    }
    const ver = resultJson?.verification as Record<string, unknown> | undefined
    if (ver) {
      r.verification = ver
      r.defectCount = Array.isArray(ver.defects) ? (ver.defects as string[]).length : 0
      r.correction = (ver.correction as Record<string, unknown>) ?? null
    }
    // Download the artifact through the owner-scoped route and ffprobe it.
    const assetId = (resultJson?.assetId as string) ?? null
    const imgRes = await call(assetId ? `/api/laxii/assets/${assetId}` : `/api/laxii/images/${job.id}`)
    if (imgRes.ok) {
      const buf = Buffer.from(await imgRes.arrayBuffer())
      const ext = r.format === 'png' ? 'png' : 'jpg'
      const file = `${ART_DIR}/${c.id}-${c.label.split(' ')[0].toLowerCase()}.${ext}`
      await Bun.write(file, buf)
      r.ffprobe = await ffprobeDesc(file)
      r.sha256 = await sha256(file)
      r.bytes = buf.length
    } else {
      r.error = `artifact download failed: HTTP ${imgRes.status}`
    }
  } catch (e) {
    r.error = e instanceof Error ? e.message.slice(0, 200) : String(e)
  }
  results.push(r)
  console.log(
    `[${c.id}] ${r.status} gen=${r.genMs}ms ${r.width}x${r.height} ${r.format} defects=${r.defectCount}` +
      (r.correction ? ` correction=${(r.correction as { applied?: boolean }).applied ? 'APPLIED' : 'kept-original'}` : '') +
      (r.error ? ` ERROR=${r.error.slice(0, 80)}` : ''),
  )
}

const completed = results.filter((r) => r.status === 'completed')
const summary = {
  runAt: new Date().toISOString(),
  email: EMAIL,
  cases: results,
  summary: {
    total: results.length,
    completed: completed.length,
    failed: results.filter((r) => r.status !== 'completed').length,
    visionChecked: completed.filter((r) => (r.verification as { checked?: boolean } | null)?.checked === true).length,
    visionUnavailable: completed.filter((r) => (r.verification as { checked?: boolean } | null)?.checked === false).length,
    withDefects: completed.filter((r) => r.defectCount > 0).length,
    correctionsAttempted: completed.filter((r) => r.correction !== null).length,
    correctionsApplied: completed.filter((r) => (r.correction as { applied?: boolean } | null)?.applied === true).length,
    sceneSpecAttached: completed.filter((r) => r.intel?.sceneSpec !== undefined).length,
    totalGenMs: completed.reduce((a, r) => a + r.genMs, 0),
  },
}
await Bun.write(`${OUT_DIR}/benchmark.json`, JSON.stringify(summary, null, 2))
console.log('\n== SUMMARY ==')
console.log(JSON.stringify(summary.summary, null, 1))
console.log(`evidence: ${OUT_DIR}/benchmark.json`)
