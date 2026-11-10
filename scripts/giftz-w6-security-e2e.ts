/**
 * CODE GIFTZ — W6 SECURITY E2E (HTTP-level, against the LIVE deployment path).
 *
 * Runs the security matrix over real HTTP on the running server (default
 * http://127.0.0.1:3000 — the same process the public preview serves, so
 * middleware, headers, cookies and error shapes are tested AS DEPLOYED).
 *
 * Hygiene (production-DB discipline):
 *  - one dedicated eval admin account `giftz-w6sec-<ts>@bean-eval.dev`,
 *    promoted via a single-row sqlite UPDATE (role only), DELETED with all
 *    its keys/credentials at the end — the production DB is left clean;
 *  - the upstream AI gateway is NEVER contacted: model calls use an invalid
 *    model id (typed 404 pre-upstream) and auth failures happen pre-upstream;
 *    therefore NO 429 window is consumed and no fabricated responses exist;
 *  - no key material is ever printed (raw keys stay in memory only).
 *
 * Usage: bun scripts/giftz-w6-security-e2e.ts [base-url]
 */
import { Database } from 'bun:sqlite'

const BASE = (process.argv[2] ?? 'http://127.0.0.1:3000').replace(/\/$/, '')
const DB_PATH = '/home/z/my-project/db/custom.db'
const STAMP = Date.now()
const EMAIL = `giftz-w6sec-${STAMP}@bean-eval.dev`
const PASSWORD = 'W6SecE2e2026x!'

let failures = 0
let checks = 0
function check(name: string, passed: boolean, detail = ''): void {
  checks++
  console.log(`  [${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!passed) failures++
}

async function api(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.cookie ? { cookie: init.cookie } : {}) }
  if (init.headers) Object.assign(headers, init.headers)
  return fetch(`${BASE}${path}`, { ...init, headers })
}

async function main(): Promise<void> {
  console.log(`W6 security E2E → ${BASE}`)

  // ---- setup: eval admin session -------------------------------------------
  const reg = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: 'W6 Sec E2E' }) })
  check('eval account registered', reg.ok || reg.status === 409, `HTTP ${reg.status}`)
  const db = new Database(DB_PATH)
  db.run(`UPDATE User SET role='admin' WHERE email=?`, [EMAIL])
  db.close()
  const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  check('admin session established', Boolean(cookie))
  const setCookieLine = login.headers.get('set-cookie') ?? ''
  check('session cookie is httpOnly', /httponly/i.test(setCookieLine))
  check('session cookie is Secure (SameSite=None requires it)', /secure/i.test(setCookieLine))
  check('session cookie SameSite=None (documented cross-site preview path)', /samesite=None/i.test(setCookieLine))

  // ---- security headers (SEC-W6-02) -----------------------------------------
  console.log('\n== security headers (as deployed) ==')
  for (const path of ['/', '/api/health']) {
    const res = await api(path)
    check(`X-Content-Type-Options: nosniff on ${path}`, res.headers.get('x-content-type-options') === 'nosniff')
    check(`Referrer-Policy on ${path}`, (res.headers.get('referrer-policy') ?? '').includes('strict-origin-when-cross-origin'))
    check(`Permissions-Policy on ${path}`, (res.headers.get('permissions-policy') ?? '').includes('camera=()'))
  }

  // ---- CSRF middleware (cross-site mutation) --------------------------------
  console.log('\n== CSRF origin policy (middleware) ==')
  const csrf = await api('/api/auth/login', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  check('cross-site mutation rejected 403 FORBIDDEN', csrf.status === 403)
  const csrfBody = (await csrf.json().catch(() => ({}))) as Record<string, unknown>
  check('CSRF rejection is typed, no stack trace', (csrfBody as { error?: { code?: string } }).error?.code === 'FORBIDDEN' && !JSON.stringify(csrfBody).includes('at '))

  // ---- key lifecycle for the auth matrix ------------------------------------
  console.log('\n== /api/v1 key lifecycle (admin-session only) ==')
  const mkA = await api('/api/v1/keys', { method: 'POST', cookie, body: JSON.stringify({ name: 'w6sec-A', permissions: ['chat:completions', 'models:read', 'usage:read'], rateLimitPerMin: 60 }) })
  const mkABody = (await mkA.json().catch(() => ({}))) as Record<string, unknown>
  const KEY_A = String(mkABody.key ?? '')
  check('key A created (raw returned once)', mkA.ok && KEY_A.startsWith('bgk_'))
  check('key A creation response contains no hash/secret besides the one-time raw', !JSON.stringify(mkABody).includes('keyHash'))

  const mkB = await api('/api/v1/keys', { method: 'POST', cookie, body: JSON.stringify({ name: 'w6sec-B', permissions: ['models:read'], rateLimitPerMin: 60 }) })
  const KEY_B = String(((await mkB.json().catch(() => ({}))) as Record<string, unknown>).key ?? '')
  check('key B created (models:read only)', mkB.ok && KEY_B.startsWith('bgk_'))

  const mkC = await api('/api/v1/keys', { method: 'POST', cookie, body: JSON.stringify({ name: 'w6sec-C', permissions: ['chat:completions'], rateLimitPerMin: 3 }) })
  const KEY_C = String(((await mkC.json().catch(() => ({}))) as Record<string, unknown>).key ?? '')
  check('key C created (rate limit 3/min)', mkC.ok && KEY_C.startsWith('bgk_'))

  const mkD = await api('/api/v1/keys', { method: 'POST', cookie, body: JSON.stringify({ name: 'w6sec-D', permissions: ['models:read'], expiresAt: new Date(Date.now() + 5_000).toISOString() }) })
  const KEY_D = String(((await mkD.json().catch(() => ({}))) as Record<string, unknown>).key ?? '')
  check('key D created (expires in 5s)', mkD.ok && KEY_D.startsWith('bgk_'))

  const mkR = await api('/api/v1/keys', { method: 'POST', cookie, body: JSON.stringify({ name: 'w6sec-R', permissions: ['models:read'] }) })
  const mkRBody = (await mkR.json().catch(() => ({}))) as Record<string, unknown>
  const KEY_R = String(mkRBody.key ?? '')
  const KEY_R_ID = String(mkRBody.id ?? '')
  check('key R created (for revocation test)', mkR.ok && KEY_R.startsWith('bgk_'))
  const rev = await api(`/api/v1/keys/${KEY_R_ID}`, { method: 'DELETE', cookie })
  check('key R revoked via DELETE', rev.ok)

  // ---- auth matrix ------------------------------------------------------------
  console.log('\n== authentication matrix (/api/v1) ==')
  const noKey = await api('/api/v1/models')
  check('missing key → 401 UNAUTHENTICATED', noKey.status === 401, `HTTP ${noKey.status}`)
  const badKey = await api('/api/v1/models', { headers: { authorization: 'Bearer bgk_totally-invalid-key' } })
  check('invalid key → 401 UNAUTHENTICATED', badKey.status === 401)
  const garbageKey = await api('/api/v1/models', { headers: { authorization: 'Bearer not-even-a-key' } })
  check('garbage bearer → 401', garbageKey.status === 401)
  const revoked = await api('/api/v1/models', { headers: { authorization: `Bearer ${KEY_R}` } })
  check('revoked key → 401', revoked.status === 401)
  const valid = await api('/api/v1/models', { headers: { authorization: `Bearer ${KEY_A}` } })
  check('valid key → 200 with catalogue', valid.ok, `HTTP ${valid.status}`)

  console.log('\n== authorization (scopes) ==')
  const scopeChat = await api('/api/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${KEY_B}` },
    body: JSON.stringify({ model: 'bean-chat-hosted', messages: [{ role: 'user', content: 'hi' }] }),
  })
  check('models:read-only key calling chat → 403 FORBIDDEN', scopeChat.status === 403)
  const usageWithChatOnly = await api('/api/v1/usage', { headers: { authorization: `Bearer ${KEY_C}` } })
  check('chat-only key calling usage → 403', usageWithChatOnly.status === 403)

  console.log('\n== principal separation (API keys can never manage keys/credentials) ==')
  const keyMgmtAsKey = await api('/api/v1/keys', { method: 'POST', headers: { authorization: `Bearer ${KEY_A}` }, body: JSON.stringify({ name: 'x', permissions: ['models:read'] }) })
  check('key-management via API key → 401/403 (admin session required)', keyMgmtAsKey.status === 401 || keyMgmtAsKey.status === 403, `HTTP ${keyMgmtAsKey.status}`)
  const adminNoSession = await api('/api/admin/gateway')
  check('GET /api/admin/gateway without session → 401', adminNoSession.status === 401, `HTTP ${adminNoSession.status}`)
  const adminWithKey = await api('/api/admin/gateway', { headers: { authorization: `Bearer ${KEY_A}` } })
  check('GET /api/admin/gateway with API key (no cookie) → 401', adminWithKey.status === 401)

  console.log('\n== input validation & typed errors (never a 500, never a stack) ==')
  const badModel = await api('/api/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${KEY_A}` },
    body: JSON.stringify({ model: 'bean-does-not-exist', messages: [{ role: 'user', content: 'hi' }] }),
  })
  check('invalid model id → typed 404 NOT_FOUND', badModel.status === 404)
  const badModelBody = (await badModel.json().catch(() => ({}))) as Record<string, unknown>
  check('404 body names the model and points at /api/v1/models', JSON.stringify(badModelBody).includes('bean-does-not-exist') && JSON.stringify(badModelBody).includes('/api/v1/models'))

  const badBody = await api('/api/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${KEY_A}` },
    body: JSON.stringify({ model: 'bean-chat-hosted', messages: [{ role: 'user', content: 'x' }], temperature: 99 }),
  })
  check('out-of-range temperature → 400 VALIDATION_ERROR (typed)', badBody.status === 400, `HTTP ${badBody.status}`)

  const hugeMessages = await api('/api/v1/chat/completions', {
    method: 'POST', headers: { authorization: `Bearer ${KEY_A}` },
    body: JSON.stringify({ model: 'bean-chat-hosted', messages: Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: `m${i}` })) }),
  })
  check('over-limit message count → 400 (request-size validation)', hugeMessages.status === 400, `HTTP ${hugeMessages.status}`)

  const malformed = await api('/api/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${KEY_A}` }, body: '{not json' })
  check('malformed JSON → 400 typed VALIDATION_ERROR', malformed.status === 400)

  const noJson = await api('/api/v1/models', { headers: { authorization: `Bearer ${KEY_A}` } })
  const modelsText = await noJson.text()
  check('error/normal bodies carry no stack traces', !modelsText.includes('"stack"') && !modelsText.includes('  at '))

  console.log('\n== per-key rate limiting (key C: 3/min) ==')
  const statuses: number[] = []
  for (let i = 0; i < 5; i++) {
    const r = await api('/api/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${KEY_C}` },
      body: JSON.stringify({ model: 'bean-does-not-exist', messages: [{ role: 'user', content: 'rate-limit probe' }] }),
    })
    statuses.push(r.status)
  }
  check('burst hit the per-key limiter (429 within 5 requests)', statuses.includes(429), `statuses=${statuses.join(',')}`)
  check('pre-throttle requests were honest typed 404s (no upstream contact)', statuses.filter((s) => s === 404).length >= 2, `statuses=${statuses.join(',')}`)

  console.log('\n== expiry enforcement (key D expired by now) ==')
  await new Promise((r) => setTimeout(r, 6_000))
  const expired = await api('/api/v1/models', { headers: { authorization: `Bearer ${KEY_D}` } })
  check('expired key → 403 FORBIDDEN', expired.status === 403, `HTTP ${expired.status}`)

  // ---- credential SSRF guard over HTTP (SEC-W6-01) ---------------------------
  console.log('\n== credential SSRF guard (create-time, HTTP) ==')
  for (const [label, url] of [
    ['loopback', 'http://127.0.0.1:9999/v1'],
    ['metadata', 'http://169.254.169.254/latest'],
    ['localhost name', 'http://localhost:8000/v1'],
  ] as const) {
    const r = await api('/api/admin/gateway', { method: 'POST', cookie, body: JSON.stringify({ action: 'create-credential', provider: 'openai-compatible', apiKey: 'w6sec-fake-key-123456', label: `ssrf-${label}`, baseUrl: url }) })
    check(`credential with ${label} baseUrl rejected — typed 400 URL guard`, r.status === 400, `HTTP ${r.status}`)
  }

  console.log(`\n==== W6 SECURITY E2E: ${checks - failures}/${checks} checks passed ====`)
  if (failures > 0) console.log(`FAILURES: ${failures}`)
}

// ---- cleanup: remove every trace of the eval account -------------------------
async function cleanup(): Promise<void> {
  try {
    const db = new Database(DB_PATH)
    const user = db.query('SELECT id FROM User WHERE email=?').get(EMAIL) as { id: string } | null
    if (user) {
      db.run('DELETE FROM ApiKey WHERE userId=?', [user.id])
      db.run('DELETE FROM ProviderCredential WHERE createdBy=?', [user.id])
      db.run('DELETE FROM Session WHERE userId=?', [user.id])
      db.run('DELETE FROM User WHERE id=?', [user.id])
    }
    db.close()
    console.log('cleanup: eval admin account + keys/credentials removed from production DB')
  } catch (e) {
    console.log(`cleanup warning: ${(e as Error).message}`)
  }
}

try {
  await main()
} finally {
  await cleanup()
}
process.exit(failures === 0 ? 0 : 1)
