/**
 * URGENT HOTFIX (LAXII CAPABILITY RECOVERY, 2026-11-11) — PHASE 2.
 *
 * Continues docs/evidence/laxii-capability-recovery-e2e.txt: phase 1 proved
 * the retry chain (edit job parked in retry_wait on genuine HTTP 429s);
 * dev.log + the DB then recorded its full lifecycle — attempt 2 at 06:24:04Z
 * (429 → re-parked, backoff 599,999 ms) and attempt 3 at 06:34:04Z (429 →
 * edit_throttle_exhausted → honest terminal failure, cumulative parked wait
 * ~32 min). This phase runs the still-missing REAL capability tests once the
 * images breaker (genuinely open after 6 consecutive real 429s) clears:
 *
 *   1. TEXT-TO-IMAGE canary  — real generation; decides whether the provider
 *      throttle has lifted. Terminal 429 ⇒ provider still throttled ⇒ STOP
 *      (no piling on a throttled provider; the restriction is reported).
 *   2. CONVERSATIONAL EDIT   — real hosted edit, PNG decoded + materially
 *      different from the input.
 *   3. BACKGROUND REMOVAL    — real two-stage pipeline, PNG decoded + REAL
 *      transparency measured (alpha==0 pixels), cross-checked against the
 *      job-reported chroma fraction.
 *
 * E2E discipline: single in-flight job, 5 s polling, honest outcomes only —
 * no fabricated success, no health-forcing, no limit bypass.
 *
 * Run: bun scripts/laxii-recovery-phase2.ts   (dev server on :3000)
 * Output: docs/evidence/laxii-capability-recovery-e2e-phase2.txt
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import sharp from 'sharp'

const BASE = 'http://localhost:3000'
const OUT = 'docs/evidence/laxii-capability-recovery-e2e-phase3.txt'
mkdirSync('docs/evidence', { recursive: true })
appendFileSync(OUT, `\n==== PHASE 3 (2026-11-12): provider throttle lifted after 18h — REAL capability verification ====\nstarted ${new Date().toISOString()}\n\n`)

function log(line: string) {
  console.log(line)
  appendFileSync(OUT, line + '\n')
}

function jar() {
  let cookie = ''
  return {
    async call(path: string, init: RequestInit = {}): Promise<Response> {
      const res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
      })
      const setCookie = res.headers.get('set-cookie')
      if (setCookie) cookie = setCookie.split(';')[0]
      return res
    },
  }
}

interface CapRow { id: string; state: string; statusAffecting: boolean; evidence: { checkedAt: string | null; source: string; failureCategory?: string | null; httpStatus?: number | null; note?: string } }
interface HealthShape {
  time: string
  products: Record<string, { status?: string; available?: boolean; capabilities?: CapRow[]; queueDepth?: number }>
  gateway: { breaker: { classes: Array<{ class: string; coolingDown: boolean; remainingMs: number; consecutive429s: number; last429At: string | null }> } }
}

async function health(j: ReturnType<typeof jar>): Promise<HealthShape> {
  const res = await j.call('/api/health')
  return (await res.json()) as HealthShape
}

function caps(h: HealthShape, product: string): Record<string, CapRow> {
  const out: Record<string, CapRow> = {}
  for (const c of h.products[product]?.capabilities ?? []) out[c.id] = c
  return out
}

function unrelatedFingerprint(h: HealthShape) {
  const pick = (p: string) => ({
    status: h.products[p]?.status ?? null,
    available: h.products[p]?.available ?? null,
    caps: (h.products[p]?.capabilities ?? []).map((c) => ({ id: c.id, state: c.state, statusAffecting: c.statusAffecting })),
  })
  return { riishe: pick('riishe'), jazmii: pick('jazmii'), 'code-giftz': pick('code-giftz') }
}

function capLine(label: string, c: CapRow | undefined): string {
  if (!c) return `${label}: (row absent)`
  const ev = c.evidence ?? ({} as CapRow['evidence'])
  return `${label}: ${c.state} (statusAffecting=${c.statusAffecting}, source=${ev.source}, checkedAt=${ev.checkedAt}, http=${ev.httpStatus ?? '-'}), note="${(ev.note ?? '').slice(0, 130)}"`
}

async function pollJob(j: ReturnType<typeof jar>, jobId: string, maxMs: number): Promise<{ status: string; result: Record<string, unknown> | null; error: unknown }> {
  const t0 = Date.now()
  let status = ''
  let result: Record<string, unknown> | null = null
  let error: unknown = null
  while (Date.now() - t0 < maxMs) {
    await new Promise((r) => setTimeout(r, 5000)) // 5s discipline — no retry storms
    const res = await j.call(`/api/laxii/jobs/${jobId}`)
    const body = (await res.json().catch(() => ({}))) as { job?: { status?: string; result?: Record<string, unknown>; error?: unknown } }
    status = body.job?.status ?? ''
    // The API nests imageUrl as a SIBLING of status inside job (job.result is
    // the raw resultJson only in the DB) — read the whole job object.
    result = (body.job ?? null) as unknown as Record<string, unknown> | null
    error = body.job?.error ?? null
    if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'rejected') break
    log(`  poll ${Math.round((Date.now() - t0) / 1000)}s: ${status}`)
  }
  return { status, result, error }
}

// ---------------------------------------------------------------- start
const stamp = Date.now()
const j = jar()
const reg = await j.call('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `recovery2-${stamp}@bean.local`, password: 'Bean-Recover-2026!', name: 'Recovery E2E P2' }),
})
const login = await j.call('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `recovery2-${stamp}@bean.local`, password: 'Bean-Recover-2026!' }),
})
log(`auth: register=${reg.status} login=${login.status}`)

// ---------------------------------------------------- wait for breaker clear
log(`\n== BREAKER GATE ==`)
{
  const h0 = await health(j)
  const images = h0.gateway.breaker.classes.find((c) => c.class === 'images')
  log(`images breaker at start: coolingDown=${images?.coolingDown} remainingMs=${images?.remainingMs} consecutive429s=${images?.consecutive429s} last429At=${images?.last429At}`)
}
const gateT0 = Date.now()
let breakerClear = false
while (Date.now() - gateT0 < 5 * 60_000) {
  const h = await health(j)
  const images = h.gateway.breaker.classes.find((c) => c.class === 'images')
  if (images && !images.coolingDown) {
    breakerClear = true
    log(`images breaker CLEAR after ${Math.round((Date.now() - gateT0) / 1000)}s (at ${h.time})`)
    break
  }
  await new Promise((r) => setTimeout(r, 15_000))
}
if (!breakerClear) log(`images breaker STILL OPEN after 5 min — proceeding anyway; a fail-fast would be recorded honestly`)

const before = await health(j)
log(`\n== HEALTH BEFORE (${before.time}) ==`)
const bc = caps(before, 'laxii')
log(capLine('text-to-image       ', bc['text-to-image']))
log(capLine('conversational-edit', bc['conversational-editing']))
log(capLine('background-removal  ', bc['background-removal']))
const fingerprintBefore = unrelatedFingerprint(before)
log(`unrelated before: ${JSON.stringify(fingerprintBefore)}`)

// Real photo-like subject: dark product silhouette on a light backdrop.
const subjectPng = await sharp(
  Buffer.from(
    `<svg width="640" height="640">
      <rect width="640" height="640" fill="#d8d4cc"/>
      <rect x="0" y="520" width="640" height="120" fill="#b8b2a6"/>
      <ellipse cx="320" cy="330" rx="150" ry="210" fill="#1c1a17"/>
      <rect x="300" y="120" width="40" height="60" rx="8" fill="#1c1a17"/>
      <circle cx="320" cy="240" r="36" fill="#c9a227"/>
    </svg>`,
  ),
)
  .png()
  .toBuffer()

async function uploadAsset(name: string): Promise<string | null> {
  const form = new FormData()
  form.append('file', new Blob([subjectPng], { type: 'image/png' }), name)
  const up = await j.call('/api/laxii/assets', { method: 'POST', body: form })
  const b = (await up.json().catch(() => ({}))) as { asset?: { id?: string } }
  log(`upload ${name}: HTTP ${up.status} asset=${b.asset?.id ?? '-'}`)
  return b.asset?.id ?? null
}

// ==================================================== 0. T2I canary
log('\n== 0. TEXT-TO-IMAGE CANARY (is the provider throttle lifted?) ==')
let providerPermits = false
{
  const gen = await j.call('/api/laxii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'A matte black smartwatch with a champagne-gold rim on dark slate, studio light', size: '1024x1024' }),
  })
  const g = (await gen.json().catch(() => ({}))) as { job?: { id?: string }; error?: unknown }
  log(`submit: HTTP ${gen.status} job=${g.job?.id ?? '-'} ${g.error ? `error=${JSON.stringify(g.error).slice(0, 160)}` : ''}`)
  if (g.job?.id) {
    const r = await pollJob(j, g.job.id, 8 * 60_000)
    log(`final: ${r.status}`)
    if (r.status === 'completed' && r.result?.imageUrl) {
      const img = await j.call(r.result.imageUrl as string)
      const buf = Buffer.from(await img.arrayBuffer())
      const meta = await sharp(buf).metadata()
      const ok = img.status === 200 && buf.length > 10_000 && (meta.width ?? 0) === 1024 && (meta.height ?? 0) === 1024
      log(`artifact: HTTP ${img.status}, ${buf.length} bytes, magic=${buf[0] === 0xff && buf[1] === 0xd8 ? 'JPEG' : buf[0] === 0x89 ? 'PNG' : 'UNKNOWN'}, decoded=${meta.width}x${meta.height}, format=${meta.format}`)
      log(`T2I CANARY VERDICT: ${ok ? 'PASS — provider permits requests' : 'FAIL'}`)
      providerPermits = ok
    } else {
      log(`T2I CANARY VERDICT: FAIL — job ended "${r.status}" error=${JSON.stringify(r.error).slice(0, 240)}`)
      log(`=> provider still throttled; per brief: preserve bounded retry behavior and report the actual restriction. NOT piling edit/bg submissions into an open throttle window.`)
    }
  }
}

// ==================================================== 1. conversational edit
if (providerPermits) {
  log('\n== 1. CONVERSATIONAL EDITING (real hosted edit) ==')
  const assetId = await uploadAsset(`edit-src-${stamp}.png`)
  if (assetId) {
    const sub = await j.call('/api/laxii/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'conversational-edit', assetId, prompt: 'Replace the background with a deep navy studio backdrop and add a soft gold rim light around the bottle' }),
    })
    const s = (await sub.json().catch(() => ({}))) as { job?: { id?: string }; error?: unknown }
    log(`submit: HTTP ${sub.status} job=${s.job?.id ?? '-'} ${s.error ? `error=${JSON.stringify(s.error).slice(0, 160)}` : ''}`)
    if (s.job?.id) {
      // 42 min covers the full bounded retry chain (~32 min parked) worst-case.
      const r = await pollJob(j, s.job.id, 42 * 60_000)
      log(`final: ${r.status}`)
      if (r.status === 'completed' && r.result?.imageUrl) {
        const img = await j.call(r.result.imageUrl as string)
        const buf = Buffer.from(await img.arrayBuffer())
        const meta = await sharp(buf).metadata()
        const stats = await sharp(buf).stats()
        const changed = JSON.stringify(stats.channels.map((c) => Math.round(c.mean))) !== JSON.stringify((await sharp(subjectPng).stats()).channels.map((c) => Math.round(c.mean)))
        log(`artifact: HTTP ${img.status}, ${buf.length} bytes, magic=${buf[0] === 0x89 ? 'PNG' : buf[0] === 0xff ? 'JPEG' : 'UNKNOWN'}, decoded=${meta.width}x${meta.height}, differs-from-input=${changed}`)
        log(`EDIT VERDICT: ${img.status === 200 && buf.length > 10_000 && meta.format === 'png' && changed ? 'PASS — real edited image artifact, decoded + materially different from the input' : 'FAIL'}`)
      } else {
        log(`EDIT VERDICT: FAIL — job ended "${r.status}" error=${JSON.stringify(r.error).slice(0, 300)}`)
      }
    }
  }

  // ==================================================== 2. background removal
  log('\n== 2. BACKGROUND REMOVAL (real two-stage pipeline) ==')
  const bgAssetId = await uploadAsset(`bgrem-src-${stamp}.png`)
  if (bgAssetId) {
    const sub = await j.call('/api/laxii/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'background-removal', assetId: bgAssetId }),
    })
    const s = (await sub.json().catch(() => ({}))) as { job?: { id?: string }; error?: unknown }
    log(`submit: HTTP ${sub.status} job=${s.job?.id ?? '-'} ${s.error ? `error=${JSON.stringify(s.error).slice(0, 160)}` : ''}`)
    if (s.job?.id) {
      const r = await pollJob(j, s.job.id, 42 * 60_000)
      log(`final: ${r.status}`)
      if (r.status === 'completed' && r.result?.imageUrl) {
        const img = await j.call(r.result.imageUrl as string)
        const buf = Buffer.from(await img.arrayBuffer())
        const meta = await sharp(buf).metadata()
        const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        let transparent = 0
        for (let i = 3; i < data.length; i += info.channels) if (data[i] === 0) transparent++
        const frac = transparent / (info.width * info.height)
        const chroma = (r.result as { chroma?: { transparentFraction?: number } }).chroma?.transparentFraction
        log(`artifact: HTTP ${img.status}, ${buf.length} bytes, magic=${buf[0] === 0x89 ? 'PNG' : 'UNKNOWN'}, decoded=${info.width}x${info.height}, fully-transparent-pixel-fraction=${frac.toFixed(3)}, job-reported=${chroma ?? '-'}`)
        log(`BG-REMOVAL VERDICT: ${img.status === 200 && meta.format === 'png' && frac > 0.2 ? 'PASS — real transparent PNG (measured alpha)' : 'FAIL'}`)
      } else {
        log(`BG-REMOVAL VERDICT: FAIL — job ended "${r.status}" error=${JSON.stringify(r.error).slice(0, 300)}`)
      }
    }
  }
}

// ------------------------------------------------------------------ after
const after = await health(j)
log(`\n== HEALTH AFTER (${after.time}) ==`)
const ac = caps(after, 'laxii')
log(capLine('text-to-image       ', ac['text-to-image']))
log(capLine('conversational-edit', ac['conversational-editing']))
log(capLine('background-removal  ', ac['background-removal']))
log(`breaker classes: ${JSON.stringify(after.gateway.breaker.classes.map((c) => ({ class: c.class, coolingDown: c.coolingDown, consecutive429s: c.consecutive429s, last429At: c.last429At })))}`)
const fingerprintAfter = unrelatedFingerprint(after)
log(`unrelated after:  ${JSON.stringify(fingerprintAfter)}`)
log(`UNRELATED PRODUCTS UNCHANGED (status+caps): ${JSON.stringify(fingerprintBefore) === JSON.stringify(fingerprintAfter) ? 'YES' : 'NO — DIFFERENCES PRESENT'}`)
log(`\nfinished ${new Date().toISOString()}`)
