/** End-to-end verification that brush-mask preservation ACTUALLY preserves. */
const BASE = 'http://localhost:3000'
const EMAIL = 'fulltest-20261107020818@bean-e2e.test'
const PASS = 'E2eTest!Passw0rd'
const SOURCE = 'cmw5rlonc000zr9vixg29qje1' // the uploaded original (red convertible)
const MASK = 'cmw5rlu7b001br9viaw4glj2d'   // brush blob over the car area
let cookie = ''
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const sc = res.headers.getSetCookie?.() ?? []
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ')
  const t = await res.text()
  try { return { status: res.status, json: JSON.parse(t) } } catch { return { status: res.status, json: { raw: t.slice(0, 150) } } }
}
const { appendFileSync } = await import('node:fs')
const rec = (step: string, data: object) => { appendFileSync('scripts/fulltest-out/evidence.jsonl', JSON.stringify({ at: new Date().toISOString(), step, ...data }) + '\n'); console.log(`[${step}]`, JSON.stringify(data).slice(0, 420)) }
await api('POST', '/api/auth/login', { email: EMAIL, password: PASS })
const e = await api('POST', '/api/laxii/edit', {
  mode: 'strict-preserve',
  assetId: SOURCE,
  maskStrokes: [{ assetId: MASK, kind: 'edit' }],
  options: { denoise: true, exposureWhiteBalance: true, localContrast: true },
})
const jobId = e.json?.job?.id
rec('preserve-fix-submit', { status: e.status, jobId, classification: 'deterministic' })
if (!jobId) process.exit(0)
let job: any = null
const t0 = Date.now()
while (Date.now() - t0 < 120_000) {
  await new Promise((r) => setTimeout(r, 5000))
  const r = await api('GET', `/api/laxii/jobs/${jobId}`)
  job = r.json?.job
  if (job && (job.status === 'completed' || job.status === 'failed')) break
}
if (job?.status !== 'completed') { rec('preserve-fix-incomplete', { status: job?.status, err: job?.errorMessage }); process.exit(0) }
// pull the full preservation report from the worker logs via a fresh task fetch:
// the job detail exposes the image; the report numbers live in resultJson — verify via direct DB read.
const { execSync } = await import('node:child_process')
const out = execSync(`python3 - <<'PY'
import sqlite3, json
c = sqlite3.connect('db/custom.db')
row = c.execute("SELECT resultJson FROM GenerationJob WHERE id='${jobId}'").fetchone()
r = json.loads(row[0])
rep = r.get('report', {})
print(json.dumps({k: rep.get(k) for k in ['exactPreservedPct','blendedPct','changedPct','editablePct','generativeUsed']}, default=str))
PY`, { encoding: 'utf8' })
const rep = JSON.parse(out.trim())
const preserved = rep.exactPreservedPct > 80 && rep.changedPct < 20 && rep.generativeUsed === false
rec('preserve-fix-report', {
  jobId, ...rep,
  preservationVerified: preserved,
  expectation: 'with a ~7.8%-area brush stroke, >80% of pixels must stay bit-exact',
  classification: 'deterministic',
})
