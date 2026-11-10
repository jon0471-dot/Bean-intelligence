/**
 * REAL-backend E2E for the 2026-10-27 false-Unavailable incident.
 *
 * Every product is exercised against its REAL configured backend through the
 * public API on the running server (no mocks). Auth via a fresh account.
 * Evidence lines are printed as structured facts for the incident report.
 *
 *  RIISHE     — real conversation + real chat turn (streaming off)
 *  CODE GIFTZ — real code-generation task
 *  LAXII      — real image-generation job (polled to completion)
 *  JAZMII     — real generate request (expects truthful NO_BACKEND)
 *  GANGZII    — real TTS job (polled), + availability endpoint
 */
const BASE = 'http://localhost:3000'
const COOKIE_JAR = '/tmp/bean-incident-cookies.txt'

interface ApiError {
  code: string
  message: string
  detail?: string
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data?: T; error?: ApiError }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: ApiError } & Record<string, unknown>
  if (res.ok && json.ok !== false) return { status: res.status, data: json as unknown as T }
  return { status: res.status, error: (json.error as ApiError) ?? { code: `HTTP_${res.status}`, message: JSON.stringify(json).slice(0, 200) } }
}

async function main() {
  const uniq = Date.now()
  const email = `incident-${uniq}@bean.test`

  // ---- auth -----------------------------------------------------------------
  const reg = await api<{ user: { id: string; email: string; role: string } }>('POST', '/api/auth/register', {
    email,
    password: `Ix9!${uniq}aB`,
    displayName: 'Incident Verifier',
  })
  console.log(`AUTH register: ${reg.status} role=${reg.data?.user?.role ?? reg.error?.code}`)

  // ---- RIISHE ----------------------------------------------------------------
  const conv = await api<{ conversation: { id: string } }>('POST', '/api/riishe/conversations', {
    title: 'Incident verification',
  })
  console.log(`RIISHE create conversation: ${conv.status} id=${conv.data?.conversation?.id ?? conv.error?.code}`)

  if (conv.data?.conversation?.id) {
    const chat = await api<Record<string, unknown>>('POST', '/api/riishe/chat', {
      conversationId: conv.data.conversation.id,
      content: 'Reply with exactly: OK',
      stream: false,
    })
    if (chat.data) {
      const content = (chat.data.content ?? chat.data.message ?? '') as string
      console.log(`RIISHE real chat: ${chat.status} content=${JSON.stringify(String(content).slice(0, 60))}`)
    } else {
      console.log(`RIISHE real chat: ${chat.status} error=${chat.error?.code} msg=${(chat.error?.message ?? '').slice(0, 140)}`)
    }
  }

  // ---- CODE GIFTZ --------------------------------------------------------------
  const code = await api<{ job?: { id: string; status: string }; task?: Record<string, unknown> }>(
    'POST',
    '/api/code-giftz/tasks',
    { mode: 'generate', prompt: 'Write a JavaScript function that returns the sum of two numbers. Reply with code only.' },
  )
  if (code.data) {
    const t = code.data.task as { id?: string; status?: string; result?: { content?: string } } | undefined
    const j = code.data.job as { id?: string; status?: string } | undefined
    const resultContent = t?.result ? String((t.result as { content?: string }).content ?? '') : ''
    const statusShown = t?.status ?? j?.status ?? '?'
    const shown = resultContent.slice(0, 80) || JSON.stringify(t ?? j ?? {}).slice(0, 120)
    console.log(`CODE GIFTZ real generation: ${code.status} taskStatus=${statusShown} code=${shown}`)
  } else {
    console.log(`CODE GIFTZ real generation: ${code.status} error=${code.error?.code} msg=${(code.error?.message ?? '').slice(0, 140)}`)
  }

  // ---- LAXII -------------------------------------------------------------------
  const img = await api<{ job: { id: string; status: string } }>('POST', '/api/laxii/generate', {
    prompt: 'a single small gold coin on black velvet, minimal',
    size: '1024x1024',
  })
  if (img.data?.job?.id) {
    const jobId = img.data.job.id
    console.log(`LAXII real image job accepted: ${img.status} jobId=${jobId} status=${img.data.job.status}`)
    let final = ''
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000))
      const job = await api<{ job: { status: string; errorCode?: string; errorMessage?: string; imageId?: string } }>(
        'GET',
        `/api/laxii/jobs/${jobId}`,
      )
      final = job.data?.job.status ?? 'unknown'
      if (final === 'completed' || final === 'failed') {
        console.log(
          `LAXII job final: ${final} imageId=${job.data?.job.imageId ?? '-'} error=${job.data?.job.errorCode ?? '-'} ${(job.data?.job.errorMessage ?? '').slice(0, 100)}`,
        )
        break
      }
    }
    if (final !== 'completed' && final !== 'failed') console.log(`LAXII job final: still ${final} after polling window`)
  } else {
    console.log(`LAXII real image: ${img.status} error=${img.error?.code} msg=${(img.error?.message ?? '').slice(0, 140)}`)
  }

  // ---- JAZMII --------------------------------------------------------------------
  const vid = await api<Record<string, unknown>>('POST', '/api/jazmii/generate', {
    prompt: 'a gold coin spinning on black velvet, 3 seconds',
  })
  console.log(
    `JAZMII real generate: ${vid.status} error=${vid.error?.code} msg=${(vid.error?.message ?? '').slice(0, 140)}`,
  )

  // ---- GANGZII ---------------------------------------------------------------------
  const tts = await api<{ job: { id: string; status: string } }>('POST', '/api/gangzii/tts', {
    text: 'BEAN status check.',
    voice: 'tongtong',
    speed: 1.0,
    source: 'studio',
  })
  if (tts.data?.job?.id) {
    const jobId = tts.data.job.id
    console.log(`GANGZII real TTS job accepted: ${tts.status} jobId=${jobId}`)
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const job = await api<{ job: { status: string; errorCode?: string; errorMessage?: string } }>(
        'GET',
        `/api/gangzii/jobs/${jobId}`,
      )
      const st = job.data?.job.status ?? 'unknown'
      if (st === 'completed' || st === 'failed') {
        console.log(
          `GANGZII TTS final: ${st} error=${job.data?.job.errorCode ?? '-'} ${(job.data?.job.errorMessage ?? '').slice(0, 110)}`,
        )
        break
      }
    }
  } else {
    console.log(`GANGZII real TTS: ${tts.status} error=${tts.error?.code} msg=${(tts.error?.message ?? '').slice(0, 140)}`)
  }

  const avail = await api<{ available: boolean; partial: boolean; capabilities: Record<string, { available: boolean; detail: string }> }>(
    'GET',
    '/api/gangzii/availability',
  )
  if (avail.data) {
    const caps = Object.entries(avail.data.capabilities)
      .map(([k, v]) => `${k}=${v.available ? 'OK' : 'NO'}`)
      .join(' ')
    console.log(`GANGZII availability: available=${avail.data.available} partial=${avail.data.partial} [${caps}]`)
  } else {
    console.log(`GANGZII availability: ${avail.status} error=${avail.error?.code}`)
  }
}

main().catch((e) => {
  console.error('E2E harness failure:', e)
  process.exit(1)
})
