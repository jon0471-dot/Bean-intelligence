/**
 * M26.3 — live reproduction of the LAXII 1920x1080 generation flow through
 * the REAL chat route + worker + provider, with byte-level measurement of
 * the stored artifact and its bottom-right corner (watermark evidence).
 */
import { Database } from 'bun:sqlite'
import path from 'node:path'
import sharp from 'sharp'
import fs from 'node:fs'

const BASE = 'http://localhost:3000'
const stamp = Date.now()
let cookie = ''
async function call(pathname: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } as Record<string, string>,
  })
  const sc = res.headers.get('set-cookie')
  if (sc) cookie = sc.split(';')[0]
  return res
}

// 1. session
await call('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `m263-repro-${stamp}@bean.local`, password: 'Bean-Repro-2026!', name: 'M263 Repro' }),
})
await call('/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: `m263-repro-${stamp}@bean.local`, password: 'Bean-Repro-2026!' }),
})
console.log('session ready')

// 2. create a conversation (the composer path goes through /api/laxii/chat)
const convRes = await call('/api/laxii/conversations', { method: 'POST' })
const convBody = (await convRes.json().catch(() => ({}))) as { conversation?: { id?: string } }
const conversationId = convBody.conversation?.id
console.log('conversation:', conversationId)

// 3. submit the EXACT user flow: prompt + custom 1920x1080 override
const submit = await call('/api/laxii/chat', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    conversationId,
    text: 'A lone lighthouse on a rocky cliff at dusk, cinematic, photorealistic',
    sizeOverride: { width: 1920, height: 1080 },
  }),
})
const submitBody = (await submit.json().catch(() => ({}))) as Record<string, unknown>
console.log('submit status', submit.status, 'keys', Object.keys(submitBody))
const messages = (submitBody.messages ?? []) as Array<{ job?: { id?: string } | null }>
const job = (submitBody.job ?? messages.find((m) => m.job)?.job ?? null) as Record<string, unknown> | null
const jobId = (job?.id as string) ?? (submitBody as { jobId?: string }).jobId ?? null
console.log('reported size:', job?.size ?? '-')
console.log('jobId:', jobId, 'engine:', job?.engine ?? (submitBody as Record<string, unknown>).engine ?? '-')

if (!jobId) {
  console.log('no job id — full response:', JSON.stringify(submitBody).slice(0, 800))
  process.exit(1)
}

// 4. poll the job
let final: Record<string, unknown> | null = null
const t0 = Date.now()
for (;;) {
  await new Promise((r) => setTimeout(r, 3000))
  const j = await call(`/api/laxii/jobs/${jobId}`)
  const body = (await j.json().catch(() => ({}))) as Record<string, unknown>
  const jobRow = (body.job ?? body) as Record<string, unknown>
  const status = String(jobRow.status ?? 'unknown')
  if (['completed', 'failed', 'cancelled'].includes(status)) {
    final = jobRow
    break
  }
  if (Date.now() - t0 > 240_000) {
    console.log('TIMEOUT polling; last status', status)
    final = jobRow
    break
  }
}
console.log('final status:', final?.status, 'progress:', final?.progress)
const resultJson = final?.resultJson as string | null
if (resultJson) {
  const result = JSON.parse(resultJson) as Record<string, unknown>
  console.log('RESULT:', JSON.stringify(result, null, 1).slice(0, 1400))
  const imageUrl = result.imageUrl as string | undefined
  if (imageUrl) {
    const bytes = Buffer.from(await (await call(imageUrl)).arrayBuffer())
    const meta = await sharp(bytes).metadata()
    console.log(`STORED ARTIFACT: ${bytes.length} bytes, ${meta.width}x${meta.height} ${meta.format}`)
    // bottom-right corner crop (watermark evidence)
    if (meta.width && meta.height) {
      const cropW = Math.round(meta.width * 0.34)
      const cropH = Math.round(meta.height * 0.18)
      await sharp(bytes)
        .extract({ left: meta.width - cropW, top: meta.height - cropH, width: cropW, height: cropH })
        .png()
        .toFile('scripts/m263-out/repro-corner.png')
      await sharp(bytes).resize(480).png().toFile('scripts/m263-out/repro-full.png')
      console.log('corner crop saved:', `${cropW}x${cropH}`)
    }
  }
} else {
  console.log('no resultJson; errorMessage:', final?.errorMessage)
}

// also dump the raw GenerationJob row (params + result + provenance)
const raw = process.env.DATABASE_URL ?? ''
const file = raw.startsWith('file:') ? raw.slice(5) : raw
const dbPath = path.isAbsolute(file) ? file : path.join(process.cwd(), file)
const db = new Database(dbPath, { readonly: true })
const row = db.query('SELECT paramsJson, resultJson, backendId, status, finishedAt, queuedAt, startedAt FROM GenerationJob WHERE id = ?').get(jobId) as Record<string, string> | undefined
if (row) {
  console.log('JOB ROW params:', row.paramsJson)
  console.log('JOB ROW backend:', row.backendId, 'status:', row.status, 'dur(ms):', row.finishedAt && row.startedAt ? new Date(row.finishedAt).getTime() - new Date(row.startedAt).getTime() : null)
}
