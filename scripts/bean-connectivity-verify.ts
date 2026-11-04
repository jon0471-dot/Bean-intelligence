/**
 * BEAN Intelligence — four-product connectivity verification (2026-11-04 audit,
 * Phase 5). Runs LIVE against the local dev server and records honest evidence:
 *
 *  RIISHE     — auth wall, ONE controlled chat attempt (429 discipline)
 *  LAXII      — ONE real image generation, ONE real deterministic enhancement,
 *               generative-edit honesty (smart-edit refusal)
 *  JAZMII     — NO_BACKEND honesty (submission rejected + job row recorded +
 *               job status polling)
 *  CODE GIFTZ — auth wall, model catalogue, ONE controlled streaming attempt
 *               (429 discipline; W1–W5 blockers preserved, nothing faked)
 *
 * Plus: cross-product isolation evidence from /api/health and a credential-
 * leak scan over every captured response (no secrets may reach the client).
 * Evidence is written to scripts/bean-connectivity-out/evidence.json.
 *
 * 429 discipline: at most ONE controlled chat-class attempt per product. A
 * 429 is recorded with status + timestamp + evidence and reported BLOCKED —
 * never retried into the throttle, never faked into a pass.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync, statSync } from 'node:fs'

const BASE = 'http://localhost:3000'
const OUT_DIR = '/home/z/my-project/scripts/bean-connectivity-out'
mkdirSync(OUT_DIR, { recursive: true })

interface Evidence {
  startedAt: string
  base: string
  finishedAt?: string
  products: Record<string, Record<string, unknown>>
  isolation: Record<string, unknown>
  credentialLeakScan: Record<string, { scannedBytes: number; hits: string[] }>
}

const evidence: Evidence = {
  startedAt: new Date().toISOString(),
  base: BASE,
  products: {},
  isolation: {},
  credentialLeakScan: {},
}

let cookie = ''
let csrfOk = true

interface Res {
  status: number
  body: unknown
  text: string
  ms: number
}

async function req(
  method: string,
  path: string,
  opts: { json?: unknown; form?: FormData; raw?: boolean } = {},
): Promise<Res> {
  const t0 = Date.now()
  const headers: Record<string, string> = { cookie }
  if (opts.json !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : (opts.form as unknown as BodyInit),
    redirect: 'manual',
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) {
    const pair = setCookie.split(';')[0]
    if (pair.includes('=')) cookie = pair
  }
  const text = await res.text()
  let body: unknown = text
  if (!opts.raw) {
    try {
      body = JSON.parse(text)
    } catch {
      /* not json */
    }
  }
  return { status: res.status, body, text, ms: Date.now() - t0 }
}

function leakScan(label: string, text: string): { hits: string[] } {
  // (scan body below)
  const patterns = [
    /sk-[A-Za-z0-9]{8,}/,
    /Bearer\s+[A-Za-z0-9._-]{16,}/,
    /ZAI_GATEWAY_CREDENTIALS"/,
    /"apiKey"/,
    /"api_key"/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /master[_-]?key"\s*:/,
    /password"\s*:\s*"[^"]+"/,
  ]
  const hits: string[] = []
  for (const p of patterns) {
    const m = p.exec(text)
    if (m) hits.push(m[0].slice(0, 24))
  }
  evidence.credentialLeakScan[label] = { scannedBytes: text.length, hits }
  return { hits }
}

// ---------------------------------------------------------------------------
// 0. Session: register a fresh verify user (isolated test identity)
// ---------------------------------------------------------------------------
const EMAIL = `bean-conn-verify-${Date.now()}@verify.local`
const reg = await req('POST', '/api/auth/register', {
  json: { email: EMAIL, password: 'Verify-Conn-2026!', name: 'Connectivity Verifier' },
})
console.log(`register: HTTP ${reg.status} (${reg.ms}ms)`)
if (reg.status >= 400) {
  console.error('Could not create verify session — aborting.')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. Fresh health snapshot (also the isolation evidence)
// ---------------------------------------------------------------------------
const health = await req('GET', '/api/health')
const healthBody = health.body as {
  products: Record<string, { status?: string; available?: boolean; probe?: Record<string, unknown> }>
} | null
console.log(`health: HTTP ${health.status} (${health.ms}ms)`)
if (healthBody) {
  for (const [id, v] of Object.entries(healthBody.products)) {
    const p = v.probe ?? {}
    evidence.products[id] = {
      status: v.status,
      available: v.available,
      latencyMs: p.latencyMs,
      httpStatus: p.httpStatus,
      failureCategory: p.failureCategory,
      detail: typeof p.detail === 'string' ? (p.detail as string).slice(0, 240) : p.detail,
      lastHealthyAt: (v as Record<string, unknown>).lastHealthyAt ?? null,
    }
  }
}
leakScan('health', health.text)

// ---------------------------------------------------------------------------
// 2. RIISHE
// ---------------------------------------------------------------------------
const riishe: Record<string, unknown> = {}

const riisheUnauth = await fetch(`${BASE}/api/riishe/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'hello' }),
})
riishe.unauthWall = { status: riisheUnauth.status, expected: 401, pass: riisheUnauth.status === 401 }
await riisheUnauth.text()

// ONE controlled live attempt (429 discipline: record, never retry).
const riisheChat = await req('POST', '/api/riishe/chat', { json: { message: 'Reply with exactly: OK' } })
riishe.liveAttempt = {
  at: new Date().toISOString(),
  status: riisheChat.status,
  ms: riisheChat.ms,
  bodyExcerpt: riisheChat.text.slice(0, 300),
}
leakScan('riishe-chat', riisheChat.text)
evidence.products.riishe = { ...(evidence.products.riishe as object), live: riishe }
console.log('riishe:', JSON.stringify(riishe))

// ---------------------------------------------------------------------------
// 3. LAXII — real generation, real enhancement, honest edit refusal
// ---------------------------------------------------------------------------
const laxii: Record<string, unknown> = {}

const gen = await req('POST', '/api/laxii/generate', {
  json: { prompt: 'A single golden coffee bean on a white background, studio light', size: '1024x1024' },
})
const genBody = gen.body as { job?: { id?: string }; ok?: boolean; error?: unknown }
laxii.generateSubmit = { status: gen.status, ms: gen.ms, jobId: genBody?.job?.id ?? null, error: genBody?.error ?? null }
leakScan('laxii-generate', gen.text)

if (genBody?.job?.id) {
  // Poll the async job to completion (generation measured ~60s at deploy).
  const deadline = Date.now() + 180_000
  let job: Record<string, unknown> = {}
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000))
    const j = await req('GET', `/api/laxii/jobs/${genBody.job.id}`)
    const jb = j.body as { job?: Record<string, unknown> }
    job = jb?.job ?? {}
    const status = String(job.status ?? '')
    if (['completed', 'failed', 'unsupported'].includes(status)) {
      laxii.generateResult = { status: j.status, jobStatus: status, progress: job.progress, error: job.errorMessage ?? null, ms: j.ms }
      break
    }
  }
  if (!laxii.generateResult) laxii.generateResult = { jobStatus: String(job.status ?? 'unknown'), note: 'still running at 180s deadline' }

  // Verify the output asset exists on disk with real image bytes.
  const result = job.resultJson as { assetId?: string } | null
  const assetId = result?.assetId
  if (assetId) {
    const assetResp = await req('GET', `/api/laxii/assets/${assetId}`, { raw: true })
    laxii.generateAsset = {
      assetId,
      fetchStatus: assetResp.status,
      bytes: assetResp.text.length,
      jpegMagic: assetResp.text.charCodeAt(0) === 0xff && assetResp.text.charCodeAt(1) === 0xd8,
    }
  }
}

// Deterministic enhancement: upload a small real PNG, enhance it.
const pngPath = '/home/z/my-project/scripts/e2e-files/test-chart.png'
if (existsSync(pngPath)) {
  const form = new FormData()
  form.append('file', new Blob([readFileSync(pngPath)], { type: 'image/png' }), 'test-chart.png')
  form.append('kind', 'original')
  const up = await req('POST', '/api/laxii/assets', { form })
  const upBody = up.body as { asset?: { id?: string } }
  laxii.assetUpload = { status: up.status, ms: up.ms, assetId: upBody?.asset?.id ?? null }
  leakScan('laxii-upload', up.text)
  if (upBody?.asset?.id) {
    const enh = await req('POST', '/api/laxii/enhance', {
      json: {
        assetId: upBody.asset.id,
        options: { denoise: true, grade: true, exposureWhiteBalance: true },
        globalColor: true,
      },
    })
    const enhBody = enh.body as { job?: { id?: string } }
    laxii.enhanceSubmit = { status: enh.status, ms: enh.ms, jobId: enhBody?.job?.id ?? null, error: enh.body ? (enh.body as Record<string, unknown>).error ?? null : null }
    leakScan('laxii-enhance', enh.text)
    if (enhBody?.job?.id) {
      const deadline = Date.now() + 60_000
      let job: Record<string, unknown> = {}
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000))
        const j = await req('GET', `/api/laxii/jobs/${enhBody.job.id}`)
        const jb = j.body as { job?: Record<string, unknown> }
        job = jb?.job ?? {}
        const status = String(job.status ?? '')
        if (['completed', 'failed'].includes(status)) {
          laxii.enhanceResult = { jobStatus: status, error: job.errorMessage ?? null }
          break
        }
      }
      if (!laxii.enhanceResult) laxii.enhanceResult = { jobStatus: String(job.status ?? 'unknown'), note: 'deadline reached' }
    }
  }
}

// Generative editing honesty: smart-edit must refuse while no Diffusers
// worker is deployed (never a fake success).
if ((laxii.assetUpload as { assetId?: string } | undefined)?.assetId) {
  const assetId = (laxii.assetUpload as { assetId?: string }).assetId as string
  const edit = await req('POST', '/api/laxii/edit', {
    json: {
      mode: 'smart-edit',
      assetId,
      maskStrokes: [{ assetId, kind: 'edit' }],
      prompt: 'make the background blue',
    },
  })
  laxii.smartEditRefusal = {
    status: edit.status,
    code: (edit.body as { error?: { code?: string } })?.error?.code ?? null,
    message: ((edit.body as { error?: { message?: string } })?.error?.message ?? '').slice(0, 200),
  }
  leakScan('laxii-edit', edit.text)
}

evidence.products.laxii = { ...(evidence.products.laxii as object), live: laxii }
console.log('laxii:', JSON.stringify(laxii))

// ---------------------------------------------------------------------------
// 4. JAZMII — NO_BACKEND honesty
// ---------------------------------------------------------------------------
const jazmii: Record<string, unknown> = {}
const jgen = await req('POST', '/api/jazmii/generate', { json: { prompt: 'A five second clip of a coffee cup' } })
const jBody = jgen.body as { rejected?: boolean; code?: string; message?: string }
jazmii.submit = { status: jgen.status, rejected: jBody?.rejected ?? null, code: jBody?.code ?? null, message: (jBody?.message ?? '').slice(0, 160), ms: jgen.ms }
leakScan('jazmii-generate', jgen.text)

// The truthful rejection is recorded as an auditable job row (the API does
// not return the job id, so read the latest row for THIS user read-only).
const jlist = await req('GET', '/api/jazmii/jobs')
const jlistBody = jlist.body as { jobs?: Array<{ id?: string; status?: string; errorCode?: string | null }> }
let rejectedJob = jlistBody?.jobs?.[0]
if (!rejectedJob?.id) {
  // Find the verify user's id, then the latest jazmii job row (READ-ONLY).
  const sess = await req('GET', '/api/auth/session')
  const userId = (sess.body as { user?: { id?: string } })?.user?.id
  if (userId) {
    try {
      const { PrismaClient } = await import('@prisma/client')
      const prisma = new PrismaClient()
      const row = await prisma.generationJob.findFirst({
        where: { userId, product: 'jazmii' },
        orderBy: { queuedAt: 'desc' },
        select: { id: true, status: true, errorCode: true },
      })
      await prisma.$disconnect()
      if (row) rejectedJob = { id: row.id, status: row.status, errorCode: row.errorCode }
    } catch {
      /* prisma unavailable from this runtime — record the gap honestly below */
    }
  }
}
jazmii.jobRecord = rejectedJob ? { id: rejectedJob.id, status: rejectedJob.status, errorCode: rejectedJob.errorCode } : null
if (rejectedJob?.id) {
  const jone = await req('GET', `/api/jazmii/jobs/${rejectedJob.id}`)
  jazmii.jobPoll = { status: jone.status, jobStatus: (jone.body as { job?: { status?: string } })?.job?.status ?? null }
}
evidence.products.jazmii = { ...(evidence.products.jazmii as object), live: jazmii }
console.log('jazmii:', JSON.stringify(jazmii))

// ---------------------------------------------------------------------------
// 5. CODE GIFTZ — auth wall, catalogue, ONE controlled streaming attempt
// ---------------------------------------------------------------------------
const giftz: Record<string, unknown> = {}
const gUnauth = await fetch(`${BASE}/api/code-giftz/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ message: 'hello' }),
})
giftz.unauthWall = { status: gUnauth.status, expected: 401, pass: gUnauth.status === 401 }
await gUnauth.text()

const models = await req('GET', '/api/v1/models')
const mBody = models.body as { models?: Array<{ id?: string; displayName?: string; capabilities?: string[]; availability?: { state?: string } }> }
giftz.modelCatalogue = {
  status: models.status,
  count: mBody?.models?.length ?? 0,
  ids: mBody?.models?.map((m) => m.id) ?? [],
  // availability is a flat honest status string (available / unavailable /
  // awaiting-credentials / disabled).
  states: mBody?.models?.map((m) => `${m.id}:${String((m as Record<string, unknown>).availability ?? '?')}`) ?? [],
}
leakScan('v1-models', models.text)

// ONE controlled streaming attempt (SSE). Record exactly what came back.
const gChat = await req('POST', '/api/code-giftz/chat', { json: { message: 'Reply with exactly: OK' } })
giftz.liveAttempt = {
  at: new Date().toISOString(),
  status: gChat.status,
  ms: gChat.ms,
  contentType: gChat.text.startsWith('data:') || gChat.text.includes('event:') ? 'text/event-stream' : 'json',
  bodyExcerpt: gChat.text.slice(0, 300),
}
leakScan('giftz-chat', gChat.text)
evidence.products['code-giftz'] = { ...(evidence.products['code-giftz'] as object), live: giftz }
console.log('giftz:', JSON.stringify(giftz))

// ---------------------------------------------------------------------------
// 6. Isolation evidence: chat-class failure did NOT drag other products down
// ---------------------------------------------------------------------------
if (healthBody) {
  const products = healthBody.products
  evidence.isolation = {
    riisheStatus: products.riishe?.status,
    laxiiStatus: products.laxii?.status,
    jazmiiStatus: products.jazmii?.status,
    giftzStatus: products['code-giftz']?.status,
    note: 'Each product derives its status from its OWN probe; a chat-class 429 must not affect laxii/jazmii states.',
  }
}

evidence.finishedAt = new Date().toISOString()
writeFileSync(`${OUT_DIR}/evidence.json`, JSON.stringify(evidence, null, 2))
console.log(`\nevidence written: ${OUT_DIR}/evidence.json`)
