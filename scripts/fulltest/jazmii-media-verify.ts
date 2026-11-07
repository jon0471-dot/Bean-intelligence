/** Local-only media/persistence verification for a completed JAZMII job (no provider calls). */
const BASE = 'http://localhost:3000'
const EMAIL = process.argv[2]; const PASS = 'E2eTest!Passw0rd'; const JOB = process.argv[3]
let cookie = ''
async function api(method: string, path: string, body?: unknown, raw = false) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), Accept: raw ? '*/*' : 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const sc = res.headers.getSetCookie?.() ?? []
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ')
  if (raw) return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers }
  const t = await res.text()
  try { return { status: res.status, json: JSON.parse(t), headers: res.headers } } catch { return { status: res.status, json: { raw: t.slice(0, 200) }, headers: res.headers } }
}
await api('POST', '/api/auth/login', { email: EMAIL, password: PASS })
const d1 = await api('GET', `/api/jazmii/jobs/${JOB}`)
const j = d1.json?.job ?? {}
console.log('job:', j.status, j.bytes, j.format, j.videoUrl)
if (j.videoUrl) {
  const full = await api('GET', String(j.videoUrl), undefined, true)
  console.log('full download:', full.status, full.bytes?.length, 'bytesExact:', full.bytes?.length === j.bytes, 'mp4Magic:', full.bytes?.toString('ascii', 4, 8) === 'ftyp')
  const rangeRes = await fetch(`${BASE}${j.videoUrl}`, { headers: { Cookie: cookie, Range: 'bytes=0-1023' } })
  const rb = Buffer.from(await rangeRes.arrayBuffer())
  console.log('range:', rangeRes.status, rb.length, 'contentRange:', rangeRes.headers.get('content-range'))
  const d2 = await api('GET', `/api/jazmii/jobs/${JOB}`)
  console.log('persistence refetch:', d2.status, d2.json?.job?.status, 'bytesStable:', d2.json?.job?.bytes === j.bytes)
}
