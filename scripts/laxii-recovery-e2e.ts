/**
 * URGENT HOTFIX (LAXII CAPABILITY RECOVERY, 2026-11-11) — REAL capability
 * E2E against the dev server. Every LAXII capability is exercised with a
 * REAL submission and its output validated at the BYTE level; nothing is
 * treated as success without decoded proof, and any failure is recorded
 * honestly (never retried into a fake success).
 *
 * Capabilities tested independently:
 *  1. TEXT-TO-IMAGE        — real generation, JPEG/PNG magic + decoded
 *                            dimensions + artifact storage + history row.
 *  2. CONVERSATIONAL EDIT  — real hosted edit of an uploaded image, PNG
 *                            artifact decoded + dimensions + history row.
 *  3. BACKGROUND REMOVAL   — real two-stage pipeline, output PNG decoded,
 *                            REAL transparency measured (alpha < 255 pixels).
 *
 * Health verification: /api/health before + after — the three capability
 * rows must end operational from the FRESH real successes, and unrelated
 * products (riishe/jazmii/code-giftz) must be byte-identical in their
 * status derivation inputs before vs after.
 *
 * E2E discipline: single in-flight job, 5s polling (no retry storms), all
 * outcomes recorded as measured.
 *
 * Run: bun scripts/laxii-recovery-e2e.ts   (dev server on :3000)
 * Output: docs/evidence/laxii-capability-recovery-e2e.txt
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import sharp from 'sharp'

const BASE = 'http://localhost:3000'
const OUT = 'docs/evidence/laxii-capability-recovery-e2e.txt'
mkdirSync('docs/evidence', { recursive: true })
mkdirSync('scripts/laxii-recovery-out', { recursive: true })
writeFileSync(OUT, `LAXII CAPABILITY RECOVERY — REAL E2E EVIDENCE\nstarted ${new Date().toISOString()}\n\n`)

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
  gateway: { breaker: { classes: Array<{ class: string; coolingDown: boolean; last429At: string | null; remainingCooldownMs?: number | null }> } }
}

async function health(j: ReturnType<typeof jar>): Promise<HealthShape> {
  const res = await j.call('/api/health')
  const body = (await res.json()) as HealthShape
  return body
}

function caps(h: HealthShape, product: string): Record<string, CapRow> {
  const out: Record<string, CapRow> = {}
  for (const c of h.products[product]?.capabilities ?? []) out[c.id] = c
  return out
}

/** Unrelated-product fingerprint: the fields the brief requires to stay untouched. */
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
  return `${label}: ${c.state} (statusAffecting=${c.statusAffecting}, source=${ev.source}, checkedAt=${ev.checkedAt}, http=${ev.httpStatus ?? '-'}), note="${(ev.note ?? '').slice(0, 110)}"`
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
    result = body.job?.result ?? null
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
  body: JSON.stringify({ email: `recovery-${stamp}@bean.local`, password: 'Bean-Recover-2026!', name: 'Recovery E2E' }),
})
const login = await j.call('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `recovery-${stamp}@bean.local`, password: 'Bean-Recover-2026!' }),
})
log(`auth: register=${reg.status} login=${login.status}`)

const before = await health(j)
log(`\n== HEALTH BEFORE (${before.time}) ==`)
const bc = caps(before, 'laxii')
log(capLine('text-to-image       ', bc['text-to-image']))
log(capLine('conversational-edit', bc['conversational-editing']))
log(capLine('background-removal  ', bc['background-removal']))
log(capLine('deterministic-enh   ', bc['image-enhancement']))
log(capLine('diffusers-worker    ', bc['generative-worker']))
log(`breaker classes: ${JSON.stringify(before.gateway.breaker.classes)}`)
const fingerprintBefore = unrelatedFingerprint(before)
log(`unrelated before: ${JSON.stringify(fingerprintBefore)}`)

// ================================================================ 1. T2I
log('\n== 1. TEXT-TO-IMAGE (real generation) ==')
{
  const gen = await j.call('/api/laxii/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'A matte black smartwatch with a champagne-gold rim on dark slate, studio light', size: '1024x1024' }),
  })
  const g = (await gen.json().catch(() => ({}))) as { job?: { id?: string }; error?: unknown }
  log(`submit: HTTP ${gen.status} job=${g.job?.id ?? '-'} ${g.error ? `error=${JSON.stringify(g.error).slice(0, 160)}` : ''}`)
  if (g.job?.id) {
    const r = await pollJob(j, g.job.id, 12 * 60_000)
    log(`final: ${r.status}`)
    if (r.status === 'completed' && r.result?.imageUrl) {
      const img = await j.call(r.result.imageUrl as string)
      const buf = Buffer.from(await img.arrayBuffer())
      const meta = await sharp(buf).metadata()
      log(`artifact: HTTP ${img.status}, ${buf.length} bytes, magic=${buf[0] === 0xff && buf[1] === 0xd8 ? 'JPEG' : buf[0] === 0x89 ? 'PNG' : 'UNKNOWN'}, decoded=${meta.width}x${meta.height}, format=${meta.format}`)
      log(`T2I VERDICT: ${img.status === 200 && buf.length > 10_000 && (meta.width ?? 0) === 1024 && (meta.height ?? 0) === 1024 ? 'PASS — real image, bytes + dimensions verified' : 'FAIL'}`)
    } else {
      log(`T2I VERDICT: FAIL — job ended "${r.status}" error=${JSON.stringify(r.error).slice(0, 200)}`)
    }
  }
}

// ==================================================== 2+3. edit + bg removal
// A REAL photo-like subject: dark product silhouette on a light backdrop.
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

log('\n== 2. CONVERSATIONAL EDITING (real hosted edit) ==')
{
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
      const r = await pollJob(j, s.job.id, 12 * 60_000)
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
        log(`EDIT VERDICT: FAIL — job ended "${r.status}" error=${JSON.stringify(r.error).slice(0, 200)}`)
      }
    }
  }
}

log('\n== 3. BACKGROUND REMOVAL (real two-stage pipeline) ==')
{
  const assetId = await uploadAsset(`bgrem-src-${stamp}.png`)
  if (assetId) {
    const sub = await j.call('/api/laxii/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'background-removal', assetId }),
    })
    const s = (await sub.json().catch(() => ({}))) as { job?: { id?: string }; error?: unknown }
    log(`submit: HTTP ${sub.status} job=${s.job?.id ?? '-'} ${s.error ? `error=${JSON.stringify(s.error).slice(0, 160)}` : ''}`)
    if (s.job?.id) {
      const r = await pollJob(j, s.job.id, 12 * 60_000)
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
        log(`BG-REMOVAL VERDICT: FAIL — job ended "${r.status}" error=${JSON.stringify(r.error).slice(0, 200)}`)
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
log(`breaker classes: ${JSON.stringify(after.gateway.breaker.classes)}`)
const fingerprintAfter = unrelatedFingerprint(after)
const unrelatedSame = JSON.stringify(fingerprintBefore) === JSON.stringify(fingerprintAfter)
log(`unrelated after:  ${JSON.stringify(fingerprintAfter)}`)
log(`UNRELATED PRODUCTS UNCHANGED (status+caps): ${unrelatedSame ? 'YES' : 'NO — DIFFERENCES PRESENT'}`)
log(`\nfinished ${new Date().toISOString()}`)
