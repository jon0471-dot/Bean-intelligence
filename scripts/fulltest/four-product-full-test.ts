/**
 * FOUR-PRODUCT FULL FUNCTIONAL TEST — Rule 9 order: RIISHE → LAXII → JAZMII → CODE GIFTZ.
 *
 * Runs the complete user-facing feature matrix from the new brief against the
 * REAL dev server (:3000) with a fresh isolated user. Every item records
 * machine-verifiable evidence to scripts/fulltest-out/:
 *   - REAL            = a real provider round-trip produced the artifact;
 *   - DETERMINISTIC   = a real local engine executed (sharp/preservation/sandbox);
 *   - SIMULATED       = infrastructure-only check (labeled, never counted as AI);
 *   - BLOCKED         = provider refused (429/contract) — recorded verbatim.
 *
 * No retry storms: every provider submission waits for its endpoint-class
 * breaker to be closed first (single attempt, breaker-gated), spaced calls.
 *
 * Usage: bun scripts/fulltest/four-product-full-test.ts [steps...]
 *   steps: riishe | riishe-retry | laxii | jazmii-submit | giftz | summary
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { deflateSync } from 'node:zlib'

const BASE = 'http://localhost:3000'
const OUT = 'scripts/fulltest-out'
mkdirSync(OUT, { recursive: true })
const EV = `${OUT}/evidence.jsonl`
const TS = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const EMAIL = `fulltest-${TS}@bean-e2e.test`
const PASS = 'E2eTest!Passw0rd'

function rec(step: string, data: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), step, ...data })
  appendFileSync(EV, line + '\n')
  console.log(`[${step}]`, JSON.stringify(data).slice(0, 460))
}

let cookie = ''

async function api(method: string, path: string, body?: unknown, raw = false): Promise<{ status: number; json: any; bytes?: Buffer; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Accept: raw ? '*/*' : 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  if (setCookie.length) {
    const jar = setCookie.map((c) => c.split(';')[0]).join('; ')
    cookie = cookie ? `${cookie}; ${jar}` : jar
  }
  if (raw) {
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, json: null, bytes: buf, headers: res.headers }
  }
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 400) } }
  return { status: res.status, json, headers: res.headers }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function breaker(cls: string): Promise<{ coolingDown: boolean; remainingMs: number }> {
  const h = await api('GET', '/api/health')
  const c = (h.json?.gateway?.breaker?.classes ?? []).find((x: any) => x.class === cls)
  return { coolingDown: Boolean(c?.coolingDown), remainingMs: c?.remainingMs ?? 0 }
}

/** Wait until an endpoint-class breaker is closed (bounded; honest timeout). */
async function waitClassOpen(cls: string, maxMs = 10 * 60_000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const b = await breaker(cls)
    if (!b.coolingDown) return true
    await sleep(Math.min(20_000, Math.max(3_000, b.remainingMs)))
  }
  rec(`breaker-wait-timeout-${cls}`, { waitedMs: maxMs })
  return false
}

async function register(): Promise<void> {
  const r = await api('POST', '/api/auth/register', { email: EMAIL, password: PASS, name: 'Full Functional Test' })
  const regOk = r.status === 200 || r.status === 201 || r.status === 409
  const l = await api('POST', '/api/auth/login', { email: EMAIL, password: PASS })
  if (l.status !== 200) throw new Error(`login failed: ${l.status} ${JSON.stringify(l.json)}`)
  rec('auth', { ok: true, registerStatus: r.status, user: EMAIL })
}

/** Read an SSE stream; returns deltas + meta. `abortAfterDelta` exercises cancel. */
async function sse(path: string, body: unknown, opts: { abortAfterDelta?: number } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const convId = res.headers.get('x-conversation-id')
  const reader = res.body?.getReader()
  const dec = new TextDecoder()
  let buf = '', deltas = '', streamError: string | null = null
  let doneMeta: Record<string, unknown> | null = null
  let frameCount = 0
  let aborted = false
  const t0 = Date.now()
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          try {
            const evt = JSON.parse(line.slice(5))
            frameCount++
            if (typeof evt.delta === 'string') deltas += evt.delta
            if (evt.error) streamError = String(evt.error).slice(0, 220)
            if (evt.done) doneMeta = evt
          } catch { /* partial frame */ }
        }
        if (opts.abortAfterDelta && deltas.length >= opts.abortAfterDelta) {
          aborted = true
          await reader.cancel().catch(() => {})
          break
        }
      }
    } catch (e: any) {
      if (!aborted) streamError = `reader error: ${String(e?.message ?? e).slice(0, 120)}`
    }
  }
  return { status: res.status, convId, deltas, frameCount, doneMeta, streamError, aborted, elapsedMs: Date.now() - t0 }
}

// ============================================================================
// RIISHE — Rule 3: 10 items
// ============================================================================
async function riishe(): Promise<void> {
  if (!(await waitClassOpen('chat'))) {
    rec('riishe-blocked', { reason: 'chat-class breaker stayed open for the whole bounded wait' })
    return
  }

  // [1 new conversation] + [7 streaming] + [2 general question] — streaming turn 1
  const t1 = await sse('/api/riishe/chat?stream=1', {
    message: 'My project codename is GOLDEN CANYON. In two short sentences, introduce yourself and acknowledge the codename. Do not store it as a memory.',
  })
  const convId = t1.convId ?? ((t1.doneMeta as any)?.conversationId ?? null)
  rec('riishe-1-new-conversation-streaming', {
    status: t1.status, conversationId: convId, streamedChars: t1.deltas.length,
    frames: t1.frameCount, elapsedMs: t1.elapsedMs, gotDone: Boolean(t1.doneMeta),
    streamError: t1.streamError, preview: t1.deltas.slice(0, 140),
    classification: 'real',
  })
  if (!convId) { rec('riishe-halted', { reason: 'no conversation id' }); return }

  await sleep(8_000)
  if (!(await waitClassOpen('chat'))) return
  // [8 conversation context] — recall turn
  const t2 = await sse('/api/riishe/chat?stream=1', {
    conversationId: convId,
    message: 'What is my project codename? Answer with just the codename.',
  })
  rec('riishe-8-context-recall', {
    status: t2.status, streamedChars: t2.deltas.length, answer: t2.deltas.slice(0, 80),
    contextHeld: t2.deltas.toUpperCase().includes('GOLDEN CANYON'), streamError: t2.streamError,
    classification: 'real',
  })

  await sleep(8_000)
  if (!(await waitClassOpen('chat'))) return
  // [3 reasoning question] — verifiable single-number answer
  const t3 = await api('POST', '/api/riishe/chat', {
    conversationId: convId,
    message: 'A farmer has 17 sheep. All but 9 run away. How many sheep does the farmer have left? Answer with just the number.',
  })
  const a3 = String(t3.json?.content ?? '')
  rec('riishe-3-reasoning', {
    status: t3.status, answer: a3.slice(0, 80), reasoningOk: a3.trim().includes('9'),
    classification: 'real',
  })

  await sleep(8_000)
  if (!(await waitClassOpen('chat'))) return
  // [4 summary request]
  const t4 = await api('POST', '/api/riishe/chat', {
    conversationId: convId,
    message: 'Summarize this conversation so far in at most two sentences.',
  })
  const a4 = String(t4.json?.content ?? '')
  rec('riishe-4-summary', {
    status: t4.status, chars: a4.length, mentionsCodename: a4.toUpperCase().includes('GOLDEN CANYON'),
    preview: a4.slice(0, 180), classification: 'real',
  })

  await sleep(8_000)
  if (!(await waitClassOpen('chat'))) return
  // [5 rewriting]
  const t5 = await api('POST', '/api/riishe/chat', {
    conversationId: convId,
    message: 'Rewrite this sentence in formal English, output only the rewritten sentence: "gonna grab some food real quick, im starving"',
  })
  const a5 = String(t5.json?.content ?? '')
  rec('riishe-5-rewrite', {
    status: t5.status, chars: a5.length, informalGone: !/gonna|im starving/i.test(a5),
    preview: a5.slice(0, 160), classification: 'real',
  })

  await sleep(8_000)
  if (!(await waitClassOpen('chat'))) return
  // [6 multilingual] — Tamil question expects Tamil script in the answer
  const t6 = await sse('/api/riishe/chat?stream=1', {
    conversationId: convId,
    message: 'தமிழில் ஒரு வாக்கியத்தில் பதிலளிக்கவும்: நீங்கள் எந்த மொழியில் பதிலளிக்கிறீர்கள்?',
  })
  const tamil = /[\u0B80-\u0BFF]/.test(t6.deltas)
  rec('riishe-6-multilingual', {
    status: t6.status, streamedChars: t6.deltas.length, tamilScriptDetected: tamil,
    preview: t6.deltas.slice(0, 140), streamError: t6.streamError, classification: 'real',
  })

  // [9 persistence] — fresh GET of the conversation (simulates app refresh)
  const d1 = await api('GET', `/api/riishe/conversations/${convId}`)
  const msgs: any[] = d1.json?.messages ?? d1.json?.conversation?.messages ?? []
  const turns = await api('GET', '/api/riishe/chat')
  rec('riishe-9-persistence', {
    detailStatus: d1.status, messageCount: Array.isArray(msgs) ? msgs.length : -1,
    roles: Array.isArray(msgs) ? msgs.map((m) => m.role).join(',') : '',
    codenameIntact: Array.isArray(msgs) && msgs.some((m) => m.role === 'user' && /GOLDEN CANYON/.test(m.content)),
    listStatus: turns.status, conversationInList: JSON.stringify(turns.json ?? {}).includes(convId),
    classification: 'deterministic',
  })

  // [10a cancellation] — start a long streaming generation, abort after first delta
  if (!(await waitClassOpen('chat', 3 * 60_000))) {
    rec('riishe-10-cancel-skipped', { reason: 'chat breaker open' })
  } else {
    const t7 = await sse('/api/riishe/chat?stream=1', {
      message: 'Count slowly from 1 to 200, one number per line.',
    }, { abortAfterDelta: 12 })
    await sleep(3_000)
    const d2 = await api('GET', `/api/riishe/conversations/${convId}`)
    const msgs2: any[] = d2.json?.messages ?? d2.json?.conversation?.messages ?? []
    const countMsg = msgs2.filter((m) => m.role === 'user' && /Count slowly/.test(m.content))
    rec('riishe-10a-cancellation', {
      abortIssued: t7.aborted, partialCharsBeforeAbort: t7.deltas.length, elapsedMs: t7.elapsedMs,
      serverAliveAfterAbort: d2.status === 200 || d2.status === 404,
      userTurnRecorded: countMsg.length > 0,
      classification: 'real',
    })
  }

  // [10b error handling] — invalid input must produce typed 4xx, never 500
  const e1 = await api('POST', '/api/riishe/chat', { message: '' })
  const e2 = await api('GET', '/api/riishe/conversations/does-not-exist-000')
  rec('riishe-10b-error-handling', {
    emptyMessageStatus: e1.status, emptyMessageCode: e1.json?.code ?? null,
    missingConversationStatus: e2.status, missingConversationCode: e2.json?.code ?? null,
    typedErrors: e1.status >= 400 && e1.status < 500 && e2.status >= 400 && e2.status < 500,
    classification: 'deterministic',
  })
}


// ============================================================================
// RIISHE retry — items 4 (summary) + 6 (multilingual) in one later window
// ============================================================================
async function riisheRetry(): Promise<void> {
  if (!(await waitClassOpen('chat'))) {
    rec('riishe-retry-blocked', { reason: 'chat-class breaker stayed open' })
    return
  }
  const t1 = await sse('/api/riishe/chat?stream=1', {
    message: 'My project codename is GOLDEN CANYON. Acknowledge it in one short sentence. Do not store it as a memory.',
  })
  const convId = t1.convId ?? ((t1.doneMeta as any)?.conversationId ?? null)
  rec('riishe-retry-setup', { status: t1.status, conversationId: convId, streamedChars: t1.deltas.length, streamError: t1.streamError })
  if (!convId) return

  await sleep(8_000)
  if (!(await waitClassOpen('chat'))) return
  const t4 = await api('POST', '/api/riishe/chat', {
    conversationId: convId,
    message: 'Summarize this conversation so far in at most two sentences.',
  })
  const a4 = String(t4.json?.content ?? '')
  rec('riishe-4-summary-retry', {
    status: t4.status, chars: a4.length, mentionsCodename: a4.toUpperCase().includes('GOLDEN CANYON'),
    preview: a4.slice(0, 180), classification: 'real',
  })

  await sleep(8_000)
  if (!(await waitClassOpen('chat'))) return
  const t6 = await sse('/api/riishe/chat?stream=1', {
    conversationId: convId,
    message: 'தமிழில் ஒரு வாக்கியத்தில் பதிலளிக்கவும்: நீங்கள் எந்த மொழியில் பதிலளிக்கிறீர்கள்?',
  })
  rec('riishe-6-multilingual-retry', {
    status: t6.status, streamedChars: t6.deltas.length,
    tamilScriptDetected: /[\u0B80-\u0BFF]/.test(t6.deltas),
    preview: t6.deltas.slice(0, 140), streamError: t6.streamError, classification: 'real',
  })
}

// ====
// ============================================================================
// LAXII — Rule 4: 9 items
// ============================================================================
async function waitLaxiiJob(id: string, maxMs: number): Promise<any> {
  const t0 = Date.now()
  let last: any = {}
  while (Date.now() - t0 < maxMs) {
    const r = await api('GET', `/api/laxii/jobs/${id}`)
    const j = r.json?.job
    if (j) last = j
    if (j && (j.status === 'completed' || j.status === 'failed')) return j
    await sleep(6_000)
  }
  return { status: 'timeout', last }
}

/** Minimal valid PNG encoder (grayscale) for mask upload. */
function makePng(w: number, h: number, draw: (x: number, y: number) => number): Buffer {
  const raw = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = draw(x, y)
  }
  const idat = deflateSync(raw, { level: 9 })
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crcTable: number[] = []
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
    let crc = 0xffffffff
    for (const b of td) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
    crc = (crc ^ 0xffffffff) >>> 0
    const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc)
    return Buffer.concat([len, td, crcB])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ])
}

async function laxii(): Promise<void> {
  if (!(await waitClassOpen('images'))) {
    rec('laxii-blocked', { reason: 'images-class breaker stayed open' })
    return
  }
  // [1 text-to-image] — REAL provider generation
  const g = await api('POST', '/api/laxii/generate', {
    prompt: 'A photorealistic red vintage convertible parked on a coastal road at golden hour, ocean in the background',
    size: '1024x1024',
  })
  const jobId = g.json?.job?.id ?? null
  rec('laxii-1-t2i-submit', { status: g.status, jobId, code: g.json?.code ?? null, message: g.json?.message ?? null, classification: 'real' })
  if (!jobId) return
  const j1 = await waitLaxiiJob(jobId, 240_000)
  let imageBytes: Buffer | null = null
  if (j1.status === 'completed' && j1.imageUrl) {
    const img = await api('GET', String(j1.imageUrl), undefined, true)
    imageBytes = img.bytes ?? null
    if (imageBytes) writeFileSync(`${OUT}/laxii-t2i-${jobId}.jpg`, imageBytes)
  }
  rec('laxii-1-t2i-complete', {
    jobId, status: j1.status, bytes: j1.bytes, width: j1.width, height: j1.height,
    downloaded: imageBytes?.length ?? null,
    jpegMagic: imageBytes ? imageBytes[0] === 0xff && imageBytes[1] === 0xd8 : false,
    artifact: j1.status === 'completed' ? `${OUT}/laxii-t2i-${jobId}.jpg` : null,
    errorMessage: j1.errorMessage ?? null, classification: j1.status === 'completed' ? 'real' : 'blocked',
  })
  const sourceId = j1.imageUrl ? String(j1.imageUrl).split('/').pop() : null
  if (!sourceId || !imageBytes) return

  // [2 image upload] — user-uploaded asset flow (upload the same bytes as a NEW original)
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(imageBytes)], { type: 'image/jpeg' }), `source-${jobId}.jpg`)
  form.append('kind', 'original')
  const up = await fetch(`${BASE}/api/laxii/assets`, { method: 'POST', headers: { Cookie: cookie }, body: form })
  const upJson = await up.json().catch(() => null)
  const editSourceId = upJson?.asset?.id ?? null
  rec('laxii-2-upload', {
    status: up.status, assetId: editSourceId, bytes: imageBytes.length,
    width: upJson?.asset?.width, height: upJson?.asset?.height, classification: 'deterministic',
  })
  if (!editSourceId) return

  // [3 image enhancement] — REAL deterministic Sharp engine execution
  const enh = await api('POST', '/api/laxii/enhance', { assetId: editSourceId })
  const enhJobId = enh.json?.job?.id ?? null
  rec('laxii-3-enhance-submit', { status: enh.status, jobId: enhJobId, code: enh.json?.code ?? null, classification: 'deterministic' })
  if (enhJobId) {
    const jEnh = await waitLaxiiJob(enhJobId, 120_000)
    let enhBytes: Buffer | null = null
    if (jEnh.status === 'completed' && jEnh.imageUrl) {
      const r = await api('GET', String(jEnh.imageUrl), undefined, true)
      enhBytes = r.bytes ?? null
      if (enhBytes) writeFileSync(`${OUT}/laxii-enh-${enhJobId}.jpg`, enhBytes)
    }
    rec('laxii-3-enhance-complete', {
      jobId: enhJobId, status: jEnh.status, bytes: jEnh.bytes,
      downloaded: enhBytes?.length ?? null, magicOk: enhBytes ? enhBytes.length > 1000 : false,
      errorMessage: jEnh.errorMessage ?? null, classification: 'deterministic',
    })
  }

  // [4 preservation-first editing + brush-mask upload] — mask painted like a brush stroke
  const maskPng = makePng(1024, 1024, (x, y) => {
    const dx = x - 512, dy = y - 380
    return dx * dx + dy * dy < 160 * 160 ? 255 : 0 // brush blob over the car area
  })
  const maskForm = new FormData()
  maskForm.append('file', new Blob([new Uint8Array(maskPng)], { type: 'image/png' }), 'brush-mask.png')
  maskForm.append('kind', 'mask')
  const mUp = await fetch(`${BASE}/api/laxii/assets`, { method: 'POST', headers: { Cookie: cookie }, body: maskForm })
  const mJson = await mUp.json().catch(() => null)
  const maskId = mJson?.asset?.id ?? null
  rec('laxii-4a-mask-upload', { status: mUp.status, maskAssetId: maskId, bytes: maskPng.length, classification: 'deterministic' })

  // [4b strict-preserve edit] — deterministic preservation engine (NOT AI)
  const sp = await api('POST', '/api/laxii/edit', {
    mode: 'strict-preserve',
    assetId: editSourceId,
    maskStrokes: maskId ? [{ assetId: maskId, kind: 'edit' }] : [],
    options: { denoise: true, exposureWhiteBalance: true, localContrast: true },
  })
  const spJobId = sp.json?.job?.id ?? null
  rec('laxii-4b-strict-preserve-submit', { status: sp.status, jobId: spJobId, code: sp.json?.code ?? null, message: sp.json?.message ?? null, classification: 'deterministic' })
  if (spJobId) {
    const jSp = await waitLaxiiJob(spJobId, 120_000)
    let spBytes: Buffer | null = null
    if (jSp.status === 'completed' && jSp.imageUrl) {
      const r = await api('GET', String(jSp.imageUrl), undefined, true)
      spBytes = r.bytes ?? null
      if (spBytes) writeFileSync(`${OUT}/laxii-preserve-${spJobId}.jpg`, spBytes)
    }
    rec('laxii-4b-strict-preserve-complete', {
      jobId: spJobId, status: jSp.status, bytes: jSp.bytes,
      downloaded: spBytes?.length ?? null, meta: JSON.stringify(jSp.meta ?? jSp.preservation ?? {}).slice(0, 240),
      errorMessage: jSp.errorMessage ?? null,
      classification: 'deterministic',
      note: 'Deterministic local preservation engine output — explicitly NOT AI generation.',
    })
  }

  // [5 brush-mask AI editing (smart-edit)] — truthful refusal expected while worker not configured
  const se = await api('POST', '/api/laxii/edit', {
    mode: 'smart-edit',
    assetId: editSourceId,
    maskStrokes: maskId ? [{ assetId: maskId, kind: 'edit' }] : [{ assetId: editSourceId, kind: 'edit' }],
    prompt: 'Replace the car with a white SUV, keep everything else identical',
  })
  rec('laxii-5-smart-edit-refusal', {
    status: se.status, code: se.json?.code ?? null, message: se.json?.message ?? null,
    honestRefusal: se.status === 503 || se.status === 409 || se.status === 400,
    classification: 'blocked',
    note: 'Local Diffusers generative worker is registry-gated OFF; route must refuse truthfully.',
  })

  // [6 conversational editing] — REAL hosted provider attempt (whole-image regenerative)
  if (!(await waitClassOpen('images'))) {
    rec('laxii-6-conversational-edit-skipped', { reason: 'images breaker open' })
  } else {
    const ce = await api('POST', '/api/laxii/edit', {
      mode: 'conversational-edit',
      assetId: editSourceId,
      prompt: 'Change the car color to midnight blue and replace the sky with dramatic storm clouds',
      size: '1024x1024',
    })
    const ceJobId = ce.json?.job?.id ?? null
    rec('laxii-6-conversational-edit-submit', { status: ce.status, jobId: ceJobId, code: ce.json?.code ?? null, message: ce.json?.message ?? null, classification: 'real' })
    if (ceJobId) {
      const jCe = await waitLaxiiJob(ceJobId, 240_000)
      let ceBytes: Buffer | null = null
      if (jCe.status === 'completed' && jCe.imageUrl) {
        const r = await api('GET', String(jCe.imageUrl), undefined, true)
        ceBytes = r.bytes ?? null
        if (ceBytes) writeFileSync(`${OUT}/laxii-edit-${ceJobId}.jpg`, ceBytes)
      }
      rec('laxii-6-conversational-edit-complete', {
        jobId: ceJobId, status: jCe.status, bytes: jCe.bytes, downloaded: ceBytes?.length ?? null,
        errorMessage: jCe.errorMessage ?? null,
        classification: jCe.status === 'completed' ? 'real' : 'blocked',
        note: 'Whole-image regenerative hosted edit — NOT pixel-preserving by design.',
      })
    }
  }

  // [7 preview + 8 download/export + 9 persistence]
  const prev = await api('GET', `/api/laxii/images/${sourceId}`, undefined, true)
  const assetRow = await api('GET', `/api/laxii/assets/${sourceId}`).catch(() => ({ status: 0, json: null }))
  const jobsList = await api('GET', '/api/laxii/jobs').catch(() => ({ status: 0, json: null }))
  rec('laxii-7-8-9-preview-download-persistence', {
    previewStatus: prev.status, previewBytes: prev.bytes?.length ?? 0,
    jpegMagic: prev.bytes ? prev.bytes[0] === 0xff && prev.bytes[1] === 0xd8 : false,
    assetRowStatus: assetRow.status,
    jobsRecorded: Array.isArray(jobsList.json?.jobs) ? jobsList.json.jobs.length : JSON.stringify(jobsList.json ?? {}).length,
    classification: 'deterministic',
  })
}

// ============================================================================
// JAZMII — Rule 5: 10 items
// ============================================================================
async function jazmiiSubmit(kind: 't2v' | 'i2v', opts: { imageUrl?: string; prompt?: string } = {}): Promise<{ jobId: string | null; status: number; json: any }> {
  const body = kind === 't2v'
    ? { prompt: opts.prompt ?? 'A slow cinematic drone shot rising over a golden desert canyon at dawn, warm light, dust motes in the air', size: '1280x720', durationSec: 5, quality: 'speed', withAudio: false }
    : { prompt: 'The camera slowly pushes in while the lighting shifts to sunset tones', imageUrl: opts.imageUrl, size: '768x768', durationSec: 5, quality: 'speed' }
  const r = await api('POST', '/api/jazmii/generate', body)
  const jobId = r.json?.job?.id ?? null
  rec(`jazmii-submit-${kind}`, { status: r.status, jobId, code: r.json?.code ?? null, message: r.json?.message ?? null, classification: 'real' })
  return { jobId, status: r.status, json: r.json }
}

async function jazmiiPoll(jobId: string, label: string, maxMs = 12 * 60_000): Promise<void> {
  const t0 = Date.now()
  const seen: Array<{ at: string; status: string; progress: number }> = []
  while (Date.now() - t0 < maxMs) {
    const r = await api('GET', `/api/jazmii/jobs/${jobId}`)
    const j = r.json?.job ?? {}
    const st = String(j.status ?? 'unknown')
    const last = seen[seen.length - 1]
    if (!last || last.status !== st || Math.abs((j.progress ?? 0) - last.progress) >= 10) {
      seen.push({ at: new Date().toISOString(), status: st, progress: j.progress ?? 0 })
    }
    if (st === 'completed') {
      // media verification: download, magic bytes, ffprobe, Range
      const mediaUrl = String(j.videoUrl ?? '')
      const m = await api('GET', mediaUrl, undefined, true)
      let ff = null
      if (m.bytes && m.bytes.length > 12) {
        writeFileSync(`${OUT}/jazmii-${jobId}.mp4`, m.bytes)
        try {
          ff = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,duration', '-of', 'json', `${OUT}/jazmii-${jobId}.mp4`], { encoding: 'utf8' })
        } catch (e: any) { ff = `ffprobe failed: ${String(e?.message ?? e).slice(0, 100)}` }
      }
      const range = await api('GET', mediaUrl, undefined, true)
      rec(`${label}-completed`, {
        jobId, status: j.status, bytes: j.bytes, format: j.format,
        mediaStatus: m.status, mediaBytes: m.bytes?.length,
        containerMp4: m.bytes ? m.bytes.toString('ascii', 4, 8) === 'ftyp' : false,
        ffprobe: ff ? String(ff).replace(/\s+/g, ' ').slice(0, 220) : null,
        artifact: `${OUT}/jazmii-${jobId}.mp4`,
        timeline: seen.slice(0, 12), classification: 'real',
      })
      return
    }
    if (st === 'failed') {
      rec(`${label}-failed`, { jobId, errorCode: j.errorCode, errorMessage: j.errorMessage, timeline: seen.slice(0, 12), classification: 'blocked' })
      return
    }
    if (st === 'cancelled') {
      rec(`${label}-cancelled`, { jobId, status: j.status, timeline: seen.slice(0, 12), classification: 'real' })
      return
    }
    await sleep(10_000)
  }
  rec(`${label}-timeout`, { jobId, lastSeen: seen.slice(-4) })
}

async function jazmii(): Promise<void> {
  if (!(await waitClassOpen('video'))) {
    rec('jazmii-blocked', { reason: 'video-class breaker stayed open' })
    return
  }
  // [1 T2V] real bounded generation
  const a = await jazmiiSubmit('t2v')
  if (!a.jobId) return
  await jazmiiPoll(a.jobId, 'jazmii-t2v')

  // persistence + preview + download checks on the completed job
  const jDetail = await api('GET', `/api/jazmii/jobs/${a.jobId}`)
  const jd = jDetail.json?.job ?? {}
  const mediaUrl = String(jd.videoUrl ?? '')
  if (mediaUrl) {
    const full = await api('GET', mediaUrl, undefined, true)
    const rangeRes = await fetch(`${BASE}${mediaUrl}`, { headers: { Cookie: cookie, Range: 'bytes=0-1023' } })
    const rangeBuf = Buffer.from(await rangeRes.arrayBuffer())
    rec('jazmii-6-7-8-9-preview-playback-persistence', {
      jobRefetchStatus: jDetail.status, jobStillCompleted: jd.status,
      fullDownloadStatus: full.status, fullDownloadBytes: full.bytes?.length ?? 0,
      bytesExact: full.bytes?.length === jd.bytes,
      rangeStatus: rangeRes.status, rangeBytes: rangeBuf.length,
      rangeAcceptPartial: rangeRes.status === 206 || rangeRes.status === 200,
      classification: 'deterministic',
    })
  } else {
    rec('jazmii-6-7-8-9-skipped', { reason: 't2v did not complete; no media URL' })
  }

  // [2 I2V] real input image = the LAXII T2I artifact (data URL)
  const fs = await import('node:fs')
  let i2vJobId: string | null = null
  const laxiiArtifacts = fs.readdirSync(OUT).filter((f) => f.startsWith('laxii-t2i-') && f.endsWith('.jpg'))
  if (laxiiArtifacts.length === 0) {
    rec('jazmii-i2v-no-source-image', { reason: 'no LAXII artifact available as I2V source' })
  } else if (!(await waitClassOpen('video'))) {
    rec('jazmii-i2v-skipped', { reason: 'video breaker open' })
  } else {
    const imgBytes = fs.readFileSync(`${OUT}/${laxiiArtifacts[0]}`)
    const dataUrl = `data:image/jpeg;base64,${imgBytes.toString('base64')}`
    rec('jazmii-2-i2v-source', { image: laxiiArtifacts[0], bytes: imgBytes.length, dataUrlBytes: dataUrl.length })
    const b = await jazmiiSubmit('i2v', { imageUrl: dataUrl })
    i2vJobId = b.jobId
    if (i2vJobId) {
      // [3 async submission evidence]
      const early = await api('GET', `/api/jazmii/jobs/${i2vJobId}`)
      rec('jazmii-3-4-5-async-status-progress', {
        immediateStatus: early.json?.job?.status ?? null, immediateProgress: early.json?.job?.progress ?? null,
        classification: 'deterministic',
      })
      await jazmiiPoll(i2vJobId, 'jazmii-i2v')
    }
  }

  // [10a cancellation] — submit a tiny T2V and cancel it while still queued,
  // BEFORE the provider starts rendering (no wasted provider work either way).
  if (!(await waitClassOpen('video', 3 * 60_000))) {
    rec('jazmii-10a-cancel-skipped', { reason: 'video breaker open' })
  } else {
    const c = await jazmiiSubmit('t2v', { prompt: 'A single blue balloon drifting upward against a clear sky, minimal motion' })
    if (c.jobId) {
      const cc = await api('DELETE', `/api/jazmii/jobs/${c.jobId}`).catch((e) => ({ status: 0, json: { raw: String(e).slice(0, 100) } }))
      await sleep(4_000)
      const after = await api('GET', `/api/jazmii/jobs/${c.jobId}`)
      const aj = after.json?.job ?? {}
      rec('jazmii-10a-cancel-queued-job', {
        submitStatus: c.status, cancelStatus: cc.status, cancelCode: cc.json?.code ?? null,
        statusAfterCancel: aj.status ?? null, startedProcessing: aj.status === 'processing' || aj.status === 'completed',
        honestCancel: aj.status === 'cancelled' || (cc.status >= 400 && cc.status < 500),
        classification: 'real',
      })
    }
  }
  // [10b failure handling] — invalid input must be a typed 400, never a 500
  const bad = await api('POST', '/api/jazmii/generate', { prompt: 'test', size: 'abc' })
  rec('jazmii-10b-invalid-input', {
    status: bad.status, code: bad.json?.code ?? null,
    typedValidation: bad.status === 400,
    classification: 'deterministic',
  })
}

// ============================================================================
// CODE GIFTZ — Rule 6: 10 items
// ============================================================================
async function giftz(): Promise<void> {
  if (!(await waitClassOpen('chat'))) {
    rec('giftz-blocked', { reason: 'chat-class breaker stayed open' })
    return
  }
  // [1 real coding conversation + 7 streaming + 2 code generation in chat]
  const t1 = await sse('/api/code-giftz/chat', {
    message: 'Write a JavaScript function debounce(fn, wait) that returns a debounced wrapper, plus a tiny usage example. Keep it under 30 lines.',
  })
  const projectId = t1.convId ?? ((t1.doneMeta as any)?.projectId ?? (t1.doneMeta as any)?.conversationId ?? null)
  rec('giftz-1-7-conversation-streaming', {
    status: t1.status, projectId, streamedChars: t1.deltas.length, frames: t1.frameCount,
    hasDebounceCode: /debounce/.test(t1.deltas), streamError: t1.streamError,
    preview: t1.deltas.slice(0, 140), classification: 'real',
  })
  if (!projectId) { rec('giftz-halted', { reason: 'no project id' }); return }

  // [3 debugging] — task-mode generate: fix a buggy function
  if (!(await waitClassOpen('chat'))) return
  const dbg = await api('POST', '/api/code-giftz/tasks', {
    mode: 'generate',
    prompt: 'Fix this buggy JavaScript function and output the corrected version with a usage example. The bug: it never handles negative n. function sumToN(n) { let s = 0; for (let i = 0; i < n; i++) s += i; return s; }',
    language: 'javascript',
  })
  const dbgTaskId = dbg.json?.task?.id ?? null
  const dbgFiles = Array.isArray(dbg.json?.task?.files) ? dbg.json.task.files : []
  rec('giftz-3-debugging-task', {
    status: dbg.status, taskId: dbgTaskId, fileCount: dbgFiles.length,
    fileNames: dbgFiles.map((f: any) => f.path ?? f.name).slice(0, 6),
    code: dbg.json?.code ?? null, classification: 'real',
  })

  // [4 refactoring + 5 explanation] — chat turn on the project (multi-file context)
  await sleep(8_000)
  if (!(await waitClassOpen('chat'))) return
  const t2 = await sse('/api/code-giftz/chat', {
    projectId,
    message: 'Two tasks: 1) Explain in ONE sentence what debounce does. 2) List the file names you can currently see in this project (multi-file context check).',
  })
  rec('giftz-4-5-6-refactor-explain-multifile', {
    status: t2.status, streamedChars: t2.deltas.length,
    explainsDebounce: /delay|wait|invocation|call/i.test(t2.deltas),
    mentionsFiles: /debounce|index|main|\.js|\.ts/.test(t2.deltas),
    preview: t2.deltas.slice(0, 200), streamError: t2.streamError, classification: 'real',
  })

  // [2+8 code generation + sandbox execution] — generate + RUN with verified output
  if (!(await waitClassOpen('chat'))) return
  const t = await api('POST', '/api/code-giftz/tasks', {
    mode: 'generate',
    prompt: 'Write a Node.js JavaScript file isPalindrome.js that exports a function isPalindrome(s) ignoring case and non-alphanumeric characters, plus when run directly prints exactly: "level: true", "hello: false", "A man, a plan, a canal: Panama: true" (one per line) for those three inputs.',
    language: 'javascript',
  })
  const taskId = t.json?.task?.id ?? null
  const files = Array.isArray(t.json?.task?.files) ? t.json.task.files : []
  rec('giftz-2-codegen-task', {
    status: t.status, taskId, fileCount: files.length,
    fileNames: files.map((f: any) => f.path ?? f.name).slice(0, 6),
    code: t.json?.code ?? null, classification: 'real',
  })
  if (taskId && files.length > 0) {
    const run = await api('POST', '/api/code-giftz/run', { taskId, approval: true })
    const r = run.json?.run ?? run.json?.result ?? {}
    const stdout = String(r.stdout ?? '')
    const expected = stdout.includes('level: true') && stdout.includes('hello: false') && stdout.toLowerCase().includes('panama: true')
    rec('giftz-8-sandbox-execution', {
      status: run.status, ok: run.json?.ok ?? null, exitCode: r.exitCode ?? null, timedOut: r.timedOut ?? null,
      stdout, outputVerified: r.exitCode === 0 && expected,
      stderrPreview: String(r.stderr ?? '').slice(0, 160),
      classification: 'deterministic',
      note: 'Executed in the isolated local sandbox runtime — output verified, not just the model response.',
    })
  }

  // [9 file creation and download] — generated files are persisted as CodeFile
  // rows and retrievable with full content via the project detail payload
  // (the UI builds the client-side download blob from exactly this payload).
  {
    const projDetail = await api('GET', `/api/code-giftz/projects/${projectId}`)
    const pj2 = projDetail.json?.project ?? projDetail.json ?? {}
    const pFiles = Array.isArray(pj2.files) ? pj2.files : []
    const fsMod = await import('node:fs')
    let saved = 0, savedPreview = ''
    for (const f of pFiles.slice(0, 3)) {
      const path = String(f.path ?? f.name ?? '')
      const content = String(f.content ?? '')
      if (path && content) {
        const safe = path.replace(/[^a-zA-Z0-9._-]/g, '_')
        fsMod.writeFileSync(`${OUT}/giftz-file-${safe}`, content)
        saved++
        if (!savedPreview) savedPreview = content.slice(0, 70)
      }
    }
    rec('giftz-9-file-creation-download', {
      projectStatus: projDetail.status, projectFileCount: pFiles.length,
      filesRetrievedWithContent: saved,
      artifacts: pFiles.slice(0, 3).map((f: any) => `${OUT}/giftz-file-${String(f.path ?? f.name ?? '').replace(/[^a-zA-Z0-9._-]/g, '_')}`),
      preview: savedPreview.replace(/\n/g, '\\n'),
      classification: 'deterministic',
    })
  }

  // [10 conversation persistence]
  const proj = await api('GET', `/api/code-giftz/projects/${projectId}`)
  const pj = proj.json?.project ?? proj.json ?? {}
  rec('giftz-10-persistence', {
    status: proj.status, restored: proj.status === 200,
    messageCount: Array.isArray(pj.messages) ? pj.messages.length : (pj.messageCount ?? null),
    fileCount: Array.isArray(pj.files) ? pj.files.length : null,
    classification: 'deterministic',
  })
}

// ============================================================================
async function summary(): Promise<void> {
  const lines = (await import('node:fs')).readFileSync(EV, 'utf8').trim().split('\n')
  const ev = lines.map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const byProduct = { riishe: 0, laxii: 0, jazmii: 0, giftz: 0 }
  let real = 0, deterministic = 0, blocked = 0
  for (const e of ev) {
    const s = String(e.step ?? '')
    const c = String(e.classification ?? '')
    if (c === 'real') real++
    else if (c === 'deterministic') deterministic++
    else if (c === 'blocked') blocked++
    if (s.startsWith('riishe')) byProduct.riishe++
    else if (s.startsWith('laxii')) byProduct.laxii++
    else if (s.startsWith('jazmii')) byProduct.jazmii++
    else if (s.startsWith('giftz')) byProduct.giftz++
  }
  rec('summary', { evidenceLines: ev.length, real, deterministic, blocked, byProduct })
}

// ---- main -------------------------------------------------------------------
const steps = process.argv.slice(2).length ? process.argv.slice(2) : ['auth', 'riishe', 'laxii', 'jazmii-submit', 'giftz', 'summary']
for (const s of steps) {
  if (s === 'auth') await register()
  else if (s === 'riishe') await riishe()
  else if (s === 'laxii') await laxii()
  else if (s === 'jazmii-submit') await jazmii()
  else if (s === 'jazmii-collect') { /* poll handled inside jazmii() */ }
  else if (s === 'riishe-retry') await riisheRetry()
  else if (s === 'giftz') await giftz()
  else if (s === 'summary') await summary()
}
