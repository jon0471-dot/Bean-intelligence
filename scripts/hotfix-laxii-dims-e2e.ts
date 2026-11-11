/**
 * LAXII CUSTOM DIMENSIONS + POSTER HOTFIX — live E2E (2026-11-11).
 *
 * Exercises the REAL public API of the RUNNING server (no mocks):
 *   A. server-side validation rejections (0 provider cost);
 *   B. custom-dimension matrix — every completed artifact is downloaded and
 *      its DECODED dimensions must equal the request exactly; provenance
 *      (generation resolution + strategy) is checked against the plan;
 *   C. the original BEAN INTELLIGENCE poster prompt (preset size) + real
 *      OCR (tesseract) on the stored artifact for the exact required text;
 *   D. LAXII regression: photorealistic portrait, luxury product, Chennai
 *      aerial, background removal, conversational edit, deterministic
 *      enhancement.
 * Every failure is reported as measured; nothing is retried into a throttle.
 */
const BASE = 'http://localhost:3000'

interface ApiError { code: string; message: string }
let cookie = ''
async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data?: T; error?: ApiError }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok && json.ok !== false) return { status: res.status, data: json as T }
  return { status: res.status, error: (json.error as ApiError) ?? { code: `HTTP_${res.status}`, message: JSON.stringify(json).slice(0, 220) } }
}

async function downloadImage(url: string): Promise<Uint8Array> {
  const res = await fetch(BASE + url, { headers: { cookie } })
  if (!res.ok) throw new Error(`artifact download failed HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

function decodedDimensions(b: Uint8Array): { width: number; height: number; format: string } {
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], format: 'jpeg' }
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3])
    }
    throw new Error('JPEG SOF not found')
  }
  if (b[0] === 0x89 && b[1] === 0x50) {
    return { width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23], format: 'png' }
  }
  throw new Error(`unknown image magic ${b[0]},${b[1]}`)
}

const facts: Array<{ check: string; pass: boolean; detail: string }> = []
function record(check: string, pass: boolean, detail: string) {
  facts.push({ check, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${check} — ${detail}`)
}

async function submitAndPoll(params: Record<string, unknown>, label: string, timeoutMs = 240_000): Promise<Record<string, unknown> | null> {
  const submit = await api<{ job: { id: string } }>('POST', '/api/laxii/generate', params)
  if (submit.status !== 202 || !submit.data?.job?.id) {
    record(`${label}: submit`, false, `${submit.status} ${JSON.stringify(submit.error)}`)
    return null
  }
  const id = submit.data.job.id
  const deadline = Date.now() + timeoutMs
  let job: Record<string, unknown> | null = null
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000))
    const poll = await api<{ job: Record<string, unknown> }>('GET', `/api/laxii/jobs/${id}`)
    if (poll.data?.job) job = poll.data.job
    const st = job?.status
    if (st === 'completed' || st === 'failed' || st === 'cancelled') break
  }
  return job
}

async function main() {
  const uniq = Date.now()
  // auth
  const email = `laxii-dims-${uniq}@bean.test`
  await api('POST', '/api/auth/register', { email, password: `Ix9!${uniq}aB`, displayName: 'Dimensions Verifier' })
  const login = await api('POST', '/api/auth/login', { email, password: `Ix9!${uniq}aB` })
  record('auth register+login', login.status === 200 && !!cookie, `login=${login.status}`)

  // ---- A. server-side validation rejections (no provider cost) ----
  const rejections: Array<[string, Record<string, unknown>, RegExp]> = [
    ['zero width', { prompt: 'test image of a lake at dawn', width: 0, height: 1080 }, /positive pixel value/],
    ['negative height', { prompt: 'test image of a lake at dawn', width: 1920, height: -192 }, /positive pixel value/],
    ['decimal width', { prompt: 'test image of a lake at dawn', width: 1024.5, height: 1024 }, /whole number of pixels/],
    ['excessive dimensions', { prompt: 'test image of a lake at dawn', width: 8000, height: 8000 }, /4096px maximum/],
    ['sub-minimum', { prompt: 'test image of a lake at dawn', width: 100, height: 100 }, /at least 256px/],
  ]
  for (const [label, body, expectMsg] of rejections) {
    const r = await api<{ job: { id: string } }>('POST', '/api/laxii/generate', body)
    const rejected = r.status === 400 && !!r.error && expectMsg.test(r.error.message)
    record(`reject: ${label}`, rejected, `${r.status} ${r.error?.code}: "${r.error?.message?.slice(0, 90)}"`)
  }

  // ---- B. custom-dimension matrix ----
  const matrix: Array<[number, number, string]> = [
    [1920, 1080, 'cover-crop'],
    [1080, 1920, 'cover-crop'],
    [2048, 2048, 'resize'],
    [1500, 1000, 'cover-crop'],
    [1024, 1024, 'native'],
  ]
  for (const [w, h, expectStrategy] of matrix) {
    const job = await submitAndPoll({ prompt: `Custom size verification ${uniq}: a serene mountain lake at golden hour, photorealistic`, width: w, height: h }, `custom ${w}x${h}`)
    if (!job) continue
    const status = job.status as string
    if (status !== 'completed') {
      record(`custom ${w}x${h}: completed`, false, `status=${status} err=${JSON.stringify(job.errorCode)} ${JSON.stringify(job.errorMessage)}`)
      continue
    }
    const bytes = await downloadImage(job.imageUrl as string)
    const dims = decodedDimensions(bytes)
    const exact = dims.width === w && dims.height === h
    const gen = job.generation as Record<string, unknown> | null
    const metaOk = (job.width as number) === w && (job.height as number) === h
    const strategyOk = !gen || gen.strategy === expectStrategy
    record(`custom ${w}x${h}: decoded EXACT + provenance`, exact && metaOk && strategyOk,
      `decoded=${dims.width}x${dims.height} (${dims.format}, ${bytes.length}B) meta=${job.width}x${job.height} strategy=${gen?.strategy} generated=${gen?.generated}`)
  }

  // ---- C. the original BEAN INTELLIGENCE poster prompt ----
  const POSTER_PROMPT =
    "Create a premium technology advertisement poster for a brand called BEAN INTELLIGENCE. Display the exact headline 'INTELLIGENCE WITHOUT LIMITS' and the exact subtitle 'FOUR PRODUCTS. ONE INTELLIGENCE.' Use a sophisticated black and champagne-gold visual identity, realistic metallic typography, elegant futuristic composition, cinematic lighting, clean hierarchy, professional advertising design. All text must be spelled exactly as supplied. No additional words, no gibberish, no watermark."
  const poster = await submitAndPoll({ prompt: POSTER_PROMPT, size: '1024x1024' }, 'poster')
  if (poster) {
    const ok = poster.status === 'completed'
    record('poster: job completed (was BACKEND_FAILURE)', ok,
      ok ? `format=${poster.format} ${poster.width}x${poster.height} ${poster.bytes}B durationMs=${poster.durationMs}` : `status=${poster.status} err=${poster.errorCode} msg="${poster.errorMessage?.slice(0, 160)}"`)
    if (ok) {
      const bytes = await downloadImage(poster.imageUrl as string)
      record('poster: artifact decoded', decodedDimensions(bytes).width === 1024, `decoded=${decodedDimensions(bytes).width}x${decodedDimensions(bytes).height}`)
      // real OCR on the artifact
      const p = `/tmp/poster-${uniq}.jpg`
      await Bun.write(p, bytes)
      const proc = Bun.spawnSync(['tesseract', p, 'stdout', '--psm', '11'])
      const text = (proc.stdout?.toString() ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
      const headline = text.includes('intelligencewithoutlimits')
      const subtitle = text.includes('fourproducts') && text.includes('oneintelligence')
      record('poster OCR: exact headline present', headline, `ocr sample="${(proc.stdout?.toString() ?? '').replace(/\s+/g, ' ').slice(0, 140)}"`)
      record('poster OCR: exact subtitle present', subtitle, `normalized="${text.slice(0, 160)}"`)
    }
  }

  // ---- D. regression: generation presets + preservation features ----
  const regressions: Array<[string, Record<string, unknown>]> = [
    ['photorealistic portrait', { prompt: `Regression portrait ${uniq}: photorealistic close-up portrait of an elderly fisherman, weathered skin, natural light`, size: '1024x1024' }],
    ['luxury product photography', { prompt: `Regression product ${uniq}: luxury champagne-gold wristwatch on black silk, studio lighting, macro product photography`, size: '1344x768' }],
    ['Chennai aerial photography', { prompt: `Regression aerial ${uniq}: aerial view of Chennai Marina Bay coastline at sunset, drone photography`, size: '864x1152' }],
  ]
  let portraitUrl: string | null = null
  for (const [label, params] of regressions) {
    const job = await submitAndPoll(params, `regression: ${label}`)
    const ok = !!job && job.status === 'completed'
    record(`regression generation: ${label}`, ok,
      ok ? `${job!.width}x${job!.height} ${job!.format} ${job!.bytes}B` : `status=${job?.status} err=${job?.errorCode} "${job?.errorMessage?.slice(0, 110)}"`)
    if (ok && !portraitUrl) portraitUrl = job!.imageUrl as string
  }

  if (portraitUrl) {
    // asset for the preservation features
    const imgRes = await fetch(BASE + portraitUrl, { headers: { cookie } })
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer())
    const form = new FormData()
    form.append('file', new File([imgBytes], 'source.jpg', { type: 'image/jpeg' }))
    form.append('kind', 'original')
    const up = await fetch(BASE + '/api/laxii/assets', { method: 'POST', headers: { cookie }, body: form })
    const upJson = (await up.json()) as { asset?: { id: string; width: number; height: number } }
    const assetId = upJson.asset?.id
    record('asset upload for preservation tests', !!assetId, upJson.asset ? `id=${assetId?.slice(0, 10)} ${upJson.asset.width}x${upJson.asset.height}` : `HTTP ${up.status}`)

    if (assetId) {
      // background removal (hosted chroma + deterministic cutout)
      const bgJob = await new Promise<Record<string, unknown> | null>((resolve) => {
        void (async () => {
          const sub = await api<{ job?: { id: string } }>('POST', '/api/laxii/edit', { mode: 'background-removal', assetId })
          if (sub.status !== 202 || !sub.data?.job) { record('regression: background removal submit', false, `${sub.status} ${JSON.stringify(sub.error)}`); return resolve(null) }
          const deadline = Date.now() + 240_000
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 5_000))
            const poll = await api<{ job: Record<string, unknown> }>('GET', `/api/laxii/jobs/${(sub.data!.job as { id: string }).id}`)
            if (poll.data?.job && ['completed', 'failed', 'cancelled'].includes(poll.data.job.status as string)) return resolve(poll.data.job)
          }
          resolve(null)
        })()
      })
      const bgOk = !!bgJob && bgJob.status === 'completed'
      let bgAlpha = false
      if (bgOk) {
        const bgBytes = await downloadImage(bgJob.imageUrl as string)
        bgAlpha = bgBytes[0] === 0x89 && (bgBytes[25] === 6 || bgBytes[25] === 4)
      }
      record('regression: background removal (transparent PNG)', bgOk && bgAlpha,
        bgOk ? `format=${bgJob!.format} pngAlphaColorType=${bgAlpha ? 'yes' : 'no'} report=${JSON.stringify((bgJob as { report?: { summary?: string } })?.report?.summary)?.slice(0, 80)}` : `status=${bgJob?.status} "${bgJob?.errorMessage?.slice(0, 110)}"`)

      // conversational editing (hosted, whole-image)
      const editJob = await new Promise<Record<string, unknown> | null>((resolve) => {
        void (async () => {
          const sub = await api<{ job?: { id: string } }>('POST', '/api/laxii/edit', { mode: 'conversational-edit', assetId, prompt: 'Change the background to a deep navy studio backdrop with soft rim lighting', size: '1024x1024' })
          if (sub.status !== 202 || !sub.data?.job) { record('regression: conversational edit submit', false, `${sub.status} ${JSON.stringify(sub.error)}`); return resolve(null) }
          const deadline = Date.now() + 240_000
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 5_000))
            const poll = await api<{ job: Record<string, unknown> }>('GET', `/api/laxii/jobs/${(sub.data!.job as { id: string }).id}`)
            if (poll.data?.job && ['completed', 'failed', 'cancelled'].includes(poll.data.job.status as string)) return resolve(poll.data.job)
          }
          resolve(null)
        })()
      })
      const editOk = !!editJob && editJob.status === 'completed'
      let editChanged = false
      if (editOk) {
        const editBytes = await downloadImage(editJob.imageUrl as string)
        editChanged = editBytes.length !== imgBytes.length
      }
      record('regression: conversational editing (real modified artifact)', editOk && editChanged,
        editOk ? `${editJob!.width}x${editJob!.height} ${editJob!.bytes}B (source ${imgBytes.length}B — differs: ${editChanged})` : `status=${editJob?.status} "${editJob?.errorMessage?.slice(0, 110)}"`)

      // deterministic enhancement (local Sharp engine)
      const enh = await api<{ job?: { id: string } }>('POST', '/api/laxii/enhance', { assetId, options: { denoise: true, exposureWhiteBalance: true, grade: true, localContrast: true, upscaleFactor: 1 }, globalColor: true, shaping: { expandPx: 0, featherPx: 4 } })
      if (enh.status === 202 && enh.data?.job) {
        const deadline = Date.now() + 180_000
        let enhJob: Record<string, unknown> | null = null
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 4_000))
          const poll = await api<{ job: Record<string, unknown> }>('GET', `/api/laxii/jobs/${(enh.data!.job as { id: string }).id}`)
          if (poll.data?.job && ['completed', 'failed', 'cancelled'].includes(poll.data.job.status as string)) { enhJob = poll.data.job; break }
        }
        record('regression: deterministic enhancement (local engine)', enhJob?.status === 'completed', `status=${enhJob?.status} "${enhJob?.errorMessage?.slice(0, 90)}"`)
      } else {
        record('regression: deterministic enhancement (local engine)', false, `${enh.status} ${JSON.stringify(enh.error)}`)
      }
    }
  }

  const failed = facts.filter((f) => !f.pass)
  console.log(`\n== RESULT: ${facts.length - failed.length}/${facts.length} checks passed ==`)
  if (failed.length > 0) process.exitCode = 1
}

main()
