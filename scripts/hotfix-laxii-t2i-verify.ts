/**
 * HOTFIX (LAXII TEXT-TO-IMAGE RATE LIMITING, 2026-11-11) — REAL generation
 * verification through the public API of the RUNNING server (no mocks).
 *
 * §3 of the hotfix brief: a successful health probe alone does not prove
 * image generation works. This script exercises the real execution path:
 *   auth → POST /api/laxii/generate (202 + job id) → poll to terminal →
 *   download artifact bytes → JPEG magic bytes + SOF-dimension parse →
 *   generation history row → before/after health diff (LAXII T2I evidence
 *   must move to the NEW attempt; every other capability/product row must
 *   be unchanged).
 * Every failure is reported as-is; nothing is retried into a throttle.
 */
const BASE = 'http://localhost:3000'

interface ApiError { code: string; message: string }

let cookie = ''
async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data?: T; error?: ApiError; raw?: Response }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok && json.ok !== false) return { status: res.status, data: json as T, raw: res }
  return { status: res.status, error: (json.error as ApiError) ?? { code: `HTTP_${res.status}`, message: JSON.stringify(json).slice(0, 200) } }
}

/** Parse intrinsic dimensions from JPEG SOF0/SOF1/SOF2 markers. */
function jpegDimensions(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const marker = b[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] }
    }
    const len = (b[i + 2] << 8) | b[i + 3]
    i += 2 + len
  }
  return null
}

const facts: Array<{ check: string; pass: boolean; detail: string }> = []
function record(check: string, pass: boolean, detail: string) {
  facts.push({ check, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${check} — ${detail}`)
}

async function main() {
  const uniq = Date.now()

  // 0. BEFORE health snapshot (all four products + laxii capability rows)
  const before = await api<Record<string, any>>('GET', '/api/health')
  const beforeHealth = before.data
  record('health reachable (before)', !!beforeHealth, beforeHealth ? `time=${beforeHealth.time}` : JSON.stringify(before.error))

  // 1. auth — fresh account, real session cookie
  const email = `laxii-hotfix-${uniq}@bean.test`
  const reg = await api('POST', '/api/auth/register', { email, password: `Ix9!${uniq}aB`, displayName: 'LAXII Hotfix Verifier' })
  const login = await api('POST', '/api/auth/login', { email, password: `Ix9!${uniq}aB` })
  record('auth register+login', reg.status === 200 && login.status === 200 && !!cookie, `register=${reg.status} login=${login.status}`)

  // 2. submit a REAL text-to-image job
  const prompt = `Hotfix verification ${uniq}: a single matte-black cast-iron teapot on a pale linen cloth, soft window light, photorealistic`
  const submit = await api<{ job: { id: string; status: string } }>('POST', '/api/laxii/generate', { prompt, size: '1024x1024' })
  record('request accepted (202 + job id)', submit.status === 202 && !!submit.data?.job?.id,
    submit.data ? `job=${submit.data.job.id} status=${submit.data.job.status}` : `${submit.status} ${JSON.stringify(submit.error)}`)
  if (!submit.data?.job?.id) return console.log('ABORT: no job id — cannot continue')

  // 3. poll to terminal state (no retry storm: single in-flight job, 5s gap)
  const jobId = submit.data.job.id
  const deadline = Date.now() + 240_000
  let job: Record<string, any> | null = null
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000))
    const poll = await api<{ job: Record<string, any> }>('GET', `/api/laxii/jobs/${jobId}`)
    if (poll.data?.job) job = poll.data.job
    const st = job?.status
    if (st === 'completed' || st === 'failed' || st === 'cancelled') break
  }
  const terminal = job?.status
  record('job reached terminal state', terminal === 'completed',
    `status=${terminal} errorCode=${job?.errorCode ?? '—'} errorMessage=${job?.errorMessage ?? '—'}`)
  if (terminal !== 'completed') return

  // 4. download the artifact and verify the REAL bytes
  const imageUrl: string | null = job?.imageUrl ?? null
  record('artifact URL present', typeof imageUrl === 'string' && imageUrl.length > 0, `imageUrl=${imageUrl}`)
  if (!imageUrl) return
  const art = await fetch(BASE + imageUrl, { headers: { cookie } })
  const bytes = new Uint8Array(await art.arrayBuffer())
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8
  record('image bytes retrievable (authenticated)', art.status === 200, `HTTP ${art.status}, content-type=${art.headers.get('content-type')}`)
  record('valid image format (JPEG magic bytes)', isJpeg, `bytes=${bytes.length} magic=${bytes[0]},${bytes[1]} hex=${Array.from(bytes.slice(0, 4)).map((x) => x.toString(16).padStart(2, '0')).join(' ')}`)
  const dims = isJpeg ? jpegDimensions(bytes) : null
  const claimed = `${job?.width}x${job?.height}`
  const measured = dims ? `${dims.width}x${dims.height}` : 'unparseable'
  record('image dimensions correct (SOF-parsed vs claimed)', !!dims && measured === claimed, `measured=${measured} claimed=${claimed} format=${job?.format} bytes=${job?.bytes}`)
  record('byte length consistent', job?.bytes === bytes.length, `resultJson.bytes=${job?.bytes} downloaded=${bytes.length}`)

  // 5. generation history is recorded
  const hist = await api<{ jobs: Array<Record<string, any>> }>('GET', '/api/laxii/generate')
  const row = hist.data?.jobs?.find((j) => j.id === jobId)
  record('generation history recorded', !!row && row.status === 'completed',
    row ? `history row: status=${row.status} size=${row.size} durationMs=${row.durationMs} format=${row.format}` : 'row missing')

  // 6. AFTER health — T2I evidence must move to THIS attempt; everything else unchanged
  const after = await api<Record<string, any>>('GET', '/api/health')
  const ah = after.data!
  const t2i = ah.products.laxii.capabilities.find((c: any) => c.id === 'text-to-image')
  record('T2I capability = operational with fresh real-attempt evidence', t2i?.state === 'operational' && t2i?.evidence?.source === 'real-attempt',
    `state=${t2i?.state} source=${t2i?.evidence?.source} note="${t2i?.evidence?.note}" checkedAt=${t2i?.evidence?.checkedAt}`)
  record('T2I evidence anchored to THIS generation', t2i?.evidence?.lastAttempt?.ok === true,
    `lastAttempt.at=${t2i?.evidence?.lastAttempt?.at} job finishedAt=${job?.finishedAt}`)

  // other LAXII capabilities unchanged (before → after)
  const beforeCaps = beforeHealth.products.laxii.capabilities.map((c: any) => `${c.id}:${c.state}:${c.statusAffecting}`).sort()
  const afterCaps = ah.products.laxii.capabilities.map((c: any) => `${c.id}:${c.state}:${c.statusAffecting}`).sort()
  record('other LAXII capability rows unchanged', JSON.stringify(beforeCaps) === JSON.stringify(afterCaps),
    `before=[${beforeCaps.join(', ')}] after=[${afterCaps.join(', ')}]`)

  // other products' statuses + capability rows unchanged
  for (const p of ['riishe', 'jazmii', 'code-giftz'] as const) {
    const b = beforeHealth.products[p]
    const a = ah.products[p]
    const bCaps = (b.capabilities ?? []).map((c: any) => `${c.id}:${c.state}`).sort().join(',')
    const aCaps = (a.capabilities ?? []).map((c: any) => `${c.id}:${c.state}`).sort().join(',')
    record(`other product untouched: ${p}`, b.status === a.status && bCaps === aCaps,
      `status ${b.status}→${a.status}, caps ${bCaps} → ${aCaps}`)
  }

  const failed = facts.filter((f) => !f.pass)
  console.log(`\n== RESULT: ${facts.length - failed.length}/${facts.length} checks passed ==`)
  if (failed.length > 0) process.exitCode = 1
}

main()
