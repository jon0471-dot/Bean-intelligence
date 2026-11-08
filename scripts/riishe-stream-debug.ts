/**
 * Debug: single RIISHE turn raw-stream dump.
 */
const BASE = 'http://localhost:3000'
const EMAIL = 'ui-clean-verify@bean.test'
const PASSWORD = 'CleanUi#2026'

const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
})
const setCookie = loginRes.headers.get('set-cookie') ?? ''
const value = /bean_session=([^;]+)/.exec(setCookie)?.[1] ?? ''
console.log('login:', loginRes.status, 'cookie value len:', value.length)

const res = await fetch(`${BASE}/api/riishe/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `bean_session=${value}` },
  body: JSON.stringify({ message: process.argv[2] ?? 'Who is the current Chief Minister of Tamil Nadu?' }),
})
console.log('chat status:', res.status, res.headers.get('content-type'))
if (!res.ok || !res.body) {
  console.log('body:', (await res.text()).slice(0, 400))
  process.exit(1)
}
const reader = res.body.getReader()
const decoder = new TextDecoder()
let raw = ''
for (;;) {
  const { done, value: v } = await reader.read()
  if (done) break
  raw += decoder.decode(v, { stream: true })
  if (raw.length > 4000) break
}
console.log('--- first 4000 chars of raw stream ---')
console.log(raw.slice(0, 4000))
