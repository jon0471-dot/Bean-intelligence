/**
 * M40 probe: the documents route INSIDE the dev server (bundled context).
 * Verifies (1) the tesseract worker spawns through the new runtime resolver
 * in the BUNDLED server (the fix for the measured /ROOT MODULE_NOT_FOUND),
 * (2) reports the vision+OCR route latency honestly.
 * Run: BASE=http://localhost:3000 bun scripts/m40-acceptance/probe-doc-route.ts
 */
const BASE = process.env.BEAN_ACCEPT_BASE ?? 'http://localhost:3000'

let cookie = ''
async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  return res
}

async function main() {
  const sharp = (await import('sharp')).default
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><rect width="100%" height="100%" fill="white"/>' +
    '<text x="60" y="150" font-family="DejaVu Sans" font-size="42" fill="black">Probe RGX-77042 approved</text></svg>'
  const png = await sharp(Buffer.from(svg)).png().toBuffer()

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const email = `m40-probe-${stamp}@bean-test.local`
  const pw = 'Bean-Accept-2026!'
  await call('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw, name: 'M40 Probe' }) })
  const login = await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pw }) })
  console.log('login:', login.status)
  if (login.status !== 200) process.exit(1)

  const form = new FormData()
  form.append('file', new Blob([png as unknown as BlobPart], { type: 'image/png' }), 'm40-probe.png')
  const t0 = Date.now()
  const up = await call('/api/riishe/documents', { method: 'POST', body: form })
  const ms = Date.now() - t0
  const j = (await up.json().catch(() => ({}))) as { document?: { id?: string; status?: string; note?: string; characters?: number }; error?: { message?: string } }
  console.log(`documents route: HTTP ${up.status} in ${(ms / 1000).toFixed(1)}s`)
  console.log('status:', j.document?.status, '| chars:', j.document?.characters)
  console.log('note:', j.document?.note ?? j.error?.message ?? '(none)')
  const note = j.document?.note ?? ''
  console.log(note.includes('OCR text extracted locally') ? 'OCR-IN-DEV: PASS (local OCR recorded)' : 'OCR-IN-DEV: NOT RECORDED (check note above)')
}
main()
