/**
 * BEAN INTEL — LIVE ACCEPTANCE (world-knowledge work order Part 14).
 *
 * Phase 1 (in-process, real network): multilingual understanding x9,
 * cross-language retrieval via the search chain (gateway -> self-hosted
 * SearXNG), GIFTZ docs retrieval, Crawl4AI page extraction, grounding
 * compilation.
 *
 * Phase 2 (REAL dev server :3000, breaker-gated single attempts): RIISHE
 * grounded chat (English + Tamil), CODE GIFTZ docs-grounded coding turn,
 * LAXII grounded image job, JAZMII grounded video job — with DB-level
 * verification of persisted grounding metadata (read-only).
 *
 * Honesty contract: every record states what ACTUALLY happened
 * (REAL / DEGRADED / BLOCKED + the real error). A 429 is recorded as
 * BLOCKED — never retried into a storm, never faked.
 *
 * Usage: bun scripts/intel/live-acceptance.ts [phase1|phase2|all]
 */
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const BASE = 'http://localhost:3000'
const OUT = 'scripts/intel/out'
mkdirSync(OUT, { recursive: true })
const TS = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
const EV = `${OUT}/live-acceptance-${TS}.jsonl`
const SUMMARY: Array<Record<string, unknown>> = []

function rec(step: string, data: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), step, ...data })
  appendFileSync(EV, line + '\n')
  SUMMARY.push({ step, ...data })
  console.log(`[${step}]`, JSON.stringify(data).slice(0, 500))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------------ */
/* SearXNG lane (setsid-detached; adopt if already up)                 */
/* ------------------------------------------------------------------ */

async function ensureSearxng(): Promise<boolean> {
  const probe = async (): Promise<boolean> => {
    try {
      const res = await fetch('http://127.0.0.1:8888/search?q=ping&format=json', { signal: AbortSignal.timeout(4_000) })
      return res.ok
    } catch {
      return false
    }
  }
  if (await probe()) {
    rec('searxng-lane', { status: 'ADOPTED', url: 'http://127.0.0.1:8888' })
    return true
  }
  const home = '/tmp/searxng'
  const settings = `${home}/settings-test.yml`
  try {
    const { accessSync } = await import('node:fs')
    accessSync(`${home}/searx/__init__.py`)
    accessSync(settings)
  } catch {
    rec('searxng-lane', { status: 'UNAVAILABLE', detail: `${home} (source checkout + settings) not present on this host; chain falls back to gateway` })
    return false
  }
  const child = spawn(
    process.env.BEAN_SEARXNG_PYTHON || 'python3',
    ['-c', 'from searx.webapp import app; app.run(host="127.0.0.1", port=8888, threaded=True, use_reloader=False)'],
    { cwd: home, env: { ...process.env, SEARXNG_SETTINGS_PATH: settings }, detached: true, stdio: 'ignore' },
  )
  child.unref()
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    if (await probe()) {
      rec('searxng-lane', { status: 'STARTED', pid: child.pid, bootWaitMs: (i + 1) * 500 })
      return true
    }
  }
  rec('searxng-lane', { status: 'FAILED_TO_START', pid: child.pid })
  return false
}

/* ------------------------------------------------------------------ */
/* PHASE 1 — intel layer in-process (real network where applicable)    */
/* ------------------------------------------------------------------ */

async function phase1() {
  const { analyzeLanguage, buildQueryVariants, languagePromptNote } = await import('../../src/lib/intel/language')
  const { analyzeScene } = await import('../../src/lib/intel/world/analyze')
  const { compileGroundedImagePrompt, compileGroundedVideoPrompt } = await import('../../src/lib/intel/world/compile')
  const { searchViaChain } = await import('../../src/lib/intel/search-chain')
  const { retrieveEvidence, shouldSearchDocs, extractTechTargets } = await import('../../src/lib/intel/retrieval')
  const { crawl4aiExtract } = await import('../../src/lib/intel/providers/extract')
  const { frameUntrustedSources } = await import('../../src/lib/intel/untrusted')

  const searxngUp = await ensureSearxng()

  // -- 1. Multilingual understanding (the nine work-order languages) ------
  const samples: Array<[string, string, string]> = [
    ['en', 'Who is the current chief minister of Tamil Nadu and the latest news about him?', 'English'],
    ['ta', 'தமிழ்நாட்டின் முதல்வர் யார்? சமீபத்திய செய்தி என்ன?', 'Tamil'],
    ['hi', 'भारत के प्रधानमंत्री कौन हैं और आज का मौसम कैसा है?', 'Hindi'],
    ['ml', 'കേരളത്തിലെ മുഖ്യമന്ത്രി ആരാണ്? ഇന്നത്തെ വാർത്ത എന്താണ്?', 'Malayalam'],
    ['ar', 'من هو رئيس الوزراء الحالي في الهند؟ ما هو الطقس اليوم؟', 'Arabic'],
    ['es', 'Hola, ¿quién es el presidente de India y cómo está el clima hoy?', 'Spanish'],
    ['zh', '印度总理是谁？今天的天气怎么样？', 'Chinese'],
    ['ja', 'インドの総理大臣は誰ですか？今日の天気は？', 'Japanese'],
    // Mixed Tamil+English: decisive Tamil script evidence keeps TAMIL primary
    // with mixed=true — the SAME contract tests/intel/language.test.ts pins
    // ("mixed-language: Tamil + English keeps Tamil primary and flags mixed").
    ['ta-mixed-ta-en', 'இந்தியாவின் prime minister யார்? Tell me the latest news', 'Mixed Tamil+English'],
  ]
  let langPass = 0
  for (const [expected, text, label] of samples) {
    const want = expected.split('-')[0]
    const a = analyzeLanguage(text)
    const variants = buildQueryVariants(text, a)
    const note = languagePromptNote(a)
    const ok = a.primary === want && variants.length >= 1 && variants[0].length > 0
    if (ok) langPass += 1
    rec('lang-detect', {
      label,
      expected: want,
      detected: a.primary,
      script: a.script,
      confidence: a.confidence,
      mixed: a.mixed,
      transliterated: a.transliterated,
      variants: variants.length,
      promptNoteChars: note?.length ?? 0,
      status: ok ? 'REAL_PASS' : 'FAIL',
    })
  }
  rec('lang-detect-summary', { pass: langPass, total: samples.length })

  // -- 2. Cross-language retrieval through the chain (REAL network) --------
  const retrievalQueries: Array<[string, string]> = [
    ['current chief minister of Tamil Nadu', 'en'],
    ['தமிழ்நாட்டின் முதல்வர் யார்', 'ta'],
    ['印度总理是谁', 'zh'],
  ]
  for (const [q, lang] of retrievalQueries) {
    const t0 = Date.now()
    try {
      const outcome = await searchViaChain(q, { num: 5 })
      rec('chain-search', {
        lang,
        query: q,
        via: outcome.via,
        results: outcome.results.length,
        attempts: outcome.attempts,
        topTitles: outcome.results.slice(0, 3).map((r) => r.title.slice(0, 60)),
        durationMs: Date.now() - t0,
        error: outcome.error,
        status: outcome.results.length > 0 ? 'REAL' : 'DEGRADED',
      })
    } catch (e) {
      rec('chain-search', { lang, query: q, status: 'DEGRADED', error: e instanceof Error ? e.message.slice(0, 200) : String(e) })
    }
  }

  // -- 3. GIFTZ docs retrieval (REAL) ---------------------------------------
  const docsQ = 'How does Prisma findUnique work in TypeScript and which version introduced extendedWhereUnique?'
  const decision = shouldSearchDocs(docsQ)
  const targets = extractTechTargets(docsQ)
  const ev = await retrieveEvidence({ mode: 'grounded', message: docsQ, docsMode: true })
  rec('giftz-docs-retrieval', {
    policyTriggered: decision.search,
    reason: decision.reason,
    techTargets: targets,
    queries: ev.queries,
    sources: ev.sources.slice(0, 4).map((s) => ({ host: s.hostName, title: s.title.slice(0, 70) })),
    degraded: ev.degraded,
    durationMs: ev.durationMs,
    status: ev.sources.length > 0 ? 'REAL' : 'DEGRADED',
  })
  const framed = frameUntrustedSources('DOCUMENTATION', ev.sources.slice(0, 2).map((s, i) => ({ id: i + 1, url: s.url, title: s.title, text: s.excerpt ?? s.snippet })))
  rec('giftz-untrusted-framing', { embeddedChars: framed.embeddedChars, sources: framed.sources.length, blockHead: framed.block.slice(0, 120) })

  // -- 4. Crawl4AI extraction (REAL) ----------------------------------------
  const tCrawl = Date.now()
  try {
    const page = await crawl4aiExtract('https://en.wikipedia.org/wiki/Peregrine_falcon', 1200)
    rec('crawl4ai-extract', {
      url: page.url,
      title: page.title.slice(0, 60),
      chars: page.text.length,
      excerpt: page.text.slice(0, 160).replace(/\n/g, ' '),
      durationMs: Date.now() - tCrawl,
      status: page.text.length > 400 ? 'REAL' : 'DEGRADED',
    })
  } catch (e) {
    rec('crawl4ai-extract', { status: 'DEGRADED', error: e instanceof Error ? e.message.slice(0, 220) : String(e), durationMs: Date.now() - tCrawl })
  }

  // -- 5. Grounding compilation (deterministic) -----------------------------
  const imgPrompt = 'a peregrine falcon diving over ocean waves at sunset, close-up'
  const scene = analyzeScene(imgPrompt)
  const grounded = compileGroundedImagePrompt(scene)
  rec('laxii-grounding', {
    prompt: imgPrompt,
    subjects: grounded.plan.subjects,
    modules: grounded.plan.modules,
    constraints: grounded.appliedConstraints.length,
    entityFacts: grounded.finalPrompt.includes('Reference facts'),
    finalPromptChars: grounded.finalPrompt.length,
    userWordsPreserved: grounded.finalPrompt.startsWith(imgPrompt),
    status: 'DETERMINISTIC',
  })
  const vidPrompt = 'a cat jumping off a table and landing on the floor'
  const vidScene = analyzeScene(vidPrompt)
  const vidGrounded = compileGroundedVideoPrompt(vidScene, 5)
  rec('jazmii-grounding', {
    prompt: vidPrompt,
    beats: vidGrounded.timeline.beats.map((b) => `${Math.round(b.tStart * 100)}-${Math.round(b.tEnd * 100)}%`),
    physics: vidGrounded.timeline.beats.flatMap((b) => b.physics).slice(0, 3),
    startState: vidGrounded.timeline.startState.slice(0, 80),
    endState: vidGrounded.timeline.endState.slice(0, 80),
    cameraContinuity: vidGrounded.timeline.cameraContinuity.slice(0, 80),
    status: 'DETERMINISTIC',
  })
  rec('searxng-config', { searxngUp, searchOrder: process.env.BEAN_INTEL_SEARCH_ORDER ?? 'gateway,searxng (default)' })
}

/* ------------------------------------------------------------------ */
/* PHASE 2 — four products through the REAL dev server                 */
/* ------------------------------------------------------------------ */

let cookie = ''

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  if (setCookie.length) {
    const jar = setCookie.map((c) => c.split(';')[0]).join('; ')
    cookie = cookie ? `${cookie}; ${jar}` : jar
  }
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 300) } }
  return { status: res.status, json }
}

async function breaker(cls: string): Promise<{ coolingDown: boolean; remainingMs: number }> {
  const h = await api('GET', '/api/health')
  const c = (h.json?.gateway?.breaker?.classes ?? []).find((x: any) => x.class === cls)
  return { coolingDown: Boolean(c?.coolingDown), remainingMs: c?.remainingMs ?? 0 }
}

async function waitClassOpen(cls: string, maxMs = 8 * 60_000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < maxMs) {
    const b = await breaker(cls)
    if (!b.coolingDown) return true
    await sleep(Math.min(20_000, Math.max(3_000, b.remainingMs)))
  }
  return false
}

async function registerAndLogin(): Promise<void> {
  const EMAIL = `intel-live-${TS}@bean-e2e.test`
  const PASS = 'IntelLive!Passw0rd'
  await api('POST', '/api/auth/register', { email: EMAIL, password: PASS, name: 'Intel Live Acceptance' })
  const l = await api('POST', '/api/auth/login', { email: EMAIL, password: PASS })
  if (l.status !== 200) throw new Error(`login failed: ${l.status}`)
  rec('auth', { status: 'REAL', email: EMAIL })
}

/** RIISHE grounded chat via the SSE streaming path (what real users ride;
 *  buffered JSON carries a 90s turn cap that a cold local lane can exceed).
 *  Single breaker-gated attempt; terminal frame or honest error recorded. */
async function riisheChat(label: string, message: string) {
  const open = await waitClassOpen('chat')
  if (!open) {
    rec(`riishe-${label}`, { status: 'BLOCKED', detail: 'chat breaker open across the bounded wait (account-wide throttle window); single gated attempt not made' })
    return
  }
  const t0 = Date.now()
  try {
    const res = await fetch(`${BASE}/api/riishe/chat?stream=1`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ message }),
    })
    if (res.status !== 200 || !res.body) {
      const text = await res.text().catch(() => '')
      rec(`riishe-${label}`, { status: `HTTP_${res.status}`, error: text.slice(0, 220), durationMs: Date.now() - t0 })
      return
    }
    // Consume the SSE stream to its terminal frame.
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let answerChars = 0
    let finalMeta: any = null
    let servedBy: string | null = null
    const stages: string[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt = JSON.parse(line.slice(6))
          if (typeof evt.delta === 'string') answerChars += evt.delta.length
          if (typeof evt.stage === 'string') stages.push(evt.stage)
          if (evt.done) {
            finalMeta = evt.meta ?? null
            servedBy = evt.servedBy ?? finalMeta?.servedBy ?? servedBy
          }
          if (evt.error) finalMeta = { ...(finalMeta ?? {}), error: String(evt.error).slice(0, 220) }
        } catch { /* non-JSON SSE line (heartbeat/comment) */ }
      }
    }
    const states: string[] = finalMeta?.states ?? []
    const sources: Array<{ hostName?: string }> = finalMeta?.sources ?? []
    rec(`riishe-${label}`, {
      status: finalMeta?.error ? 'DEGRADED' : 'REAL',
      servedBy,
      answerChars,
      stages,
      states,
      sourceCount: sources.length,
      sourceHosts: sources.slice(0, 3).map((s) => s.hostName),
      searchProviders: finalMeta?.searchProviders ?? null,
      degradedCount: Array.isArray(finalMeta?.degraded) ? finalMeta.degraded.length : null,
      durationMs: Date.now() - t0,
      error: finalMeta?.error ?? null,
    })
  } catch (e) {
    rec(`riishe-${label}`, { status: 'FAIL', error: e instanceof Error ? e.message.slice(0, 200) : String(e), durationMs: Date.now() - t0 })
  }
}

/** CODE GIFTZ chat with a docs-grounded question; verifies persisted docs meta. */
async function giftzDocsTurn() {
  const open = await waitClassOpen('chat')
  if (!open) {
    rec('giftz-docs-turn', { status: 'BLOCKED', detail: 'chat breaker open across the bounded wait' })
    return
  }
  const t0 = Date.now()
  // stream=0 -> buffered JSON path (docs provenance rides the response).
  const r = await api('POST', '/api/code-giftz/chat?stream=0', {
    message: 'In TypeScript, how does the non-null assertion operator (!) differ from optional chaining (?.)? Cite documentation if you have live sources.',
  })
  const durationMs = Date.now() - t0
  const content = r.json?.content ?? ''
  // Docs provenance: returned on the buffered response AND persisted in the
  // assistant message's metaJson (verify DB copy read-only).
  let docsFromDb: Record<string, unknown> | null = null
  const messageId = r.json?.messageId
  if (messageId) {
    try {
      const { Database } = await import('bun:sqlite')
      const db = new Database('db/custom.db', { readonly: true })
      const row = db.query('SELECT metaJson FROM CodeMessage WHERE id = ?').get(messageId) as { metaJson: string | null } | null
      db.close()
      if (row?.metaJson) docsFromDb = (JSON.parse(row.metaJson) as any).docs ?? null
    } catch { docsFromDb = null }
  }
  rec('giftz-docs-turn', {
    status: r.status === 200 ? 'REAL' : `HTTP_${r.status}`,
    servedBy: r.json?.servedBy ?? null,
    answerChars: content.length,
    docsResponse: r.json?.docs ?? null,
    docsPersisted: docsFromDb,
    durationMs,
    error: r.status !== 200 ? (r.json?.error?.message ?? JSON.stringify(r.json).slice(0, 200)) : null,
  })
}

/** Read-only DB verification of persisted grounding metadata. */
async function verifyGroundingInDb(jobId: string, product: string): Promise<Record<string, unknown> | null> {
  try {
    const { Database } = await import('bun:sqlite')
    const db = new Database('db/custom.db', { readonly: true })
    const row = db.query('SELECT resultJson FROM GenerationJob WHERE id = ?').get(jobId) as { resultJson: string | null } | null
    db.close()
    if (!row?.resultJson) return null
    // The persisted job result carries grounding metadata under this key;
    // typing it here keeps `?? null` from collapsing to {} (TS2322).
    const parsed = JSON.parse(row.resultJson) as { grounding?: Record<string, unknown> | null }
    return parsed.grounding ?? null
  } catch (e) {
    rec(`db-verify-${product}`, { status: 'DEGRADED', error: e instanceof Error ? e.message.slice(0, 160) : String(e) })
    return null
  }
}

async function laxiiGroundedJob() {
  const open = await waitClassOpen('image-generation')
  if (!open) {
    rec('laxii-grounded-job', { status: 'BLOCKED', detail: 'image-generation breaker open across the bounded wait' })
    return
  }
  const prompt = 'a peregrine falcon diving over ocean waves at sunset, close-up'
  const sub = await api('POST', '/api/laxii/generate', { prompt, size: '1024x1024' })
  if (sub.status !== 202) {
    rec('laxii-grounded-job', { status: `HTTP_${sub.status}`, error: sub.json?.error?.message ?? JSON.stringify(sub.json).slice(0, 200) })
    return
  }
  const jobId = sub.json?.job?.id
  rec('laxii-grounded-job', { status: 'SUBMITTED', jobId })
  const t0 = Date.now()
  while (Date.now() - t0 < 4 * 60_000) {
    await sleep(6_000)
    const j = await api('GET', `/api/laxii/jobs/${jobId}`)
    const st = j.json?.job?.status ?? j.json?.status
    if (st === 'completed' || st === 'failed') {
      const grounding = await verifyGroundingInDb(jobId, 'laxii')
      let artifactBytes: number | null = null
      if (st === 'completed') {
        const img = await fetch(`${BASE}/api/laxii/images/${jobId}`, { headers: { Cookie: cookie } })
        artifactBytes = img.ok ? (await img.arrayBuffer()).byteLength : null
      }
      rec('laxii-grounded-job', {
        status: st === 'completed' ? 'REAL_ARTIFACT' : 'BLOCKED',
        jobId,
        finalStatus: st,
        errorCode: j.json?.job?.errorCode ?? j.json?.errorCode ?? null,
        errorMessage: (j.json?.job?.errorMessage ?? j.json?.errorMessage ?? '').slice(0, 200),
        groundingPersisted: Boolean(grounding),
        groundingModules: (grounding as any)?.plan?.modules ?? null,
        groundingConstraints: Array.isArray((grounding as any)?.appliedConstraints) ? (grounding as any).appliedConstraints.length : null,
        artifactBytes,
        durationMs: Date.now() - t0,
      })
      return
    }
  }
  rec('laxii-grounded-job', { status: 'TIMEOUT', jobId, waitedMs: 4 * 60_000 })
}

async function jazmiiGroundedJob() {
  const open = await waitClassOpen('video-generation')
  if (!open) {
    rec('jazmii-grounded-job', { status: 'BLOCKED', detail: 'video-generation breaker open across the bounded wait' })
    return
  }
  const prompt = 'a cat jumping off a table and landing on the floor'
  const sub = await api('POST', '/api/jazmii/generate', { prompt, durationSec: 5, size: '1280x720', quality: 'speed' })
  if (sub.status !== 202) {
    rec('jazmii-grounded-job', { status: `HTTP_${sub.status}`, error: sub.json?.error?.message ?? JSON.stringify(sub.json).slice(0, 200) })
    return
  }
  const jobId = sub.json?.job?.id
  rec('jazmii-grounded-job', { status: 'SUBMITTED', jobId })
  const t0 = Date.now()
  while (Date.now() - t0 < 6 * 60_000) {
    await sleep(10_000)
    const j = await api('GET', `/api/jazmii/jobs/${jobId}`)
    const st = j.json?.job?.status ?? j.json?.status
    if (st === 'completed' || st === 'failed') {
      const grounding = await verifyGroundingInDb(jobId, 'jazmii')
      rec('jazmii-grounded-job', {
        status: st === 'completed' ? 'REAL_ARTIFACT' : 'BLOCKED',
        jobId,
        finalStatus: st,
        errorCode: j.json?.job?.errorCode ?? j.json?.errorCode ?? null,
        errorMessage: (j.json?.job?.errorMessage ?? j.json?.errorMessage ?? '').slice(0, 200),
        groundingPersisted: Boolean(grounding),
        timelineBeats: Array.isArray((grounding as any)?.timeline?.beats) ? (grounding as any).timeline.beats.length : null,
        durationMs: Date.now() - t0,
      })
      return
    }
  }
  rec('jazmii-grounded-job', { status: 'TIMEOUT', jobId, waitedMs: 6 * 60_000 })
}

async function phase2(steps: string[]) {
  // The SearXNG lane must be up in THIS process window for the search chain
  // to prove its throttle-resilience role during the live product turns.
  await ensureSearxng()
  try {
    await registerAndLogin()
  } catch (e) {
    rec('auth', { status: 'FAIL', error: e instanceof Error ? e.message : String(e) })
    return
  }
  const wants = (s: string) => steps.length === 0 || steps.includes(s)
  // Rule 9 order: RIISHE -> LAXII -> JAZMII -> CODE GIFTZ
  if (wants('riishe') || wants('riishe-en')) {
    await riisheChat('english-grounded', 'What is the latest LTS version of Node.js and when was it released?')
  }
  if (wants('riishe') || wants('riishe-ta')) {
    await riisheChat('tamil-grounded', 'தமிழ்நாட்டின் தற்போதைய முதல்வர் யார்? சமீபத்திய செய்தி என்ன?')
  }
  if (wants('laxii')) await laxiiGroundedJob()
  if (wants('jazmii')) await jazmiiGroundedJob()
  if (wants('giftz')) await giftzDocsTurn()
}

/* ------------------------------------------------------------------ */

const mode = process.argv[2] ?? 'all'
const steps = process.argv.slice(3)
if (mode === 'phase1' || mode === 'all') await phase1()
if (mode === 'phase2' || mode === 'all') await phase2(steps)
writeFileSync(`${OUT}/live-acceptance-${TS}-summary.json`, JSON.stringify(SUMMARY, null, 2))
console.log(`\nEVIDENCE: ${EV}`)
