/** Local-only sandbox re-verification for an existing completed task (no provider calls). */
const BASE = 'http://localhost:3000'
const EMAIL = process.argv[2]
const PASS = 'E2eTest!Passw0rd'
const TASK_ID = process.argv[3]
let cookie = ''
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const sc = res.headers.getSetCookie?.() ?? []
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ')
  const t = await res.text()
  try { return { status: res.status, json: JSON.parse(t) } } catch { return { status: res.status, json: { raw: t.slice(0, 200) } } }
}
await api('POST', '/api/auth/login', { email: EMAIL, password: PASS })
const run = await api('POST', '/api/code-giftz/run', { taskId: TASK_ID, approval: true })
console.log(JSON.stringify(run.json, null, 1).slice(0, 1200))
