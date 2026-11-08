/**
 * BEAN Intelligence — world-knowledge & multilingual evaluation harness.
 *
 * REAL evaluation across languages, retrieval, grounding, conditioning,
 * vision verification and (optionally) a real video job — per the brief's
 * evaluation section. Runs with the real authorized gateway; every network
 * case makes AT MOST ONE attempt (the research layer's documented single
 * retry is the only permitted re-attempt) and every failure/skip is reported
 * honestly. NO retry storms, NO fabricated evidence.
 *
 * Usage:
 *   bun scripts/world-eval/run.ts                 # all sections, no fresh video job
 *   bun scripts/world-eval/run.ts --with-video    # + ONE real JAZMII T2V attempt (bounded poll)
 *
 * Output: scripts/world-eval/out/evidence.jsonl + console summary.
 * Exit code 0 unless a PURE (deterministic) assertion fails.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { detectLanguage, LANGUAGE_NAMES } from '../../src/lib/intel/language'
import { understandPrompt } from '../../src/lib/intel/understanding'
import { assembleWorldKnowledge, renderWorldKnowledgeBlock } from '../../src/lib/intel/world'
import { extractCinematography, renderCinematographyBlock } from '../../src/lib/intel/cinema'
import {
  prepareImageIntelligence,
  prepareVideoIntelligence,
} from '../../src/lib/intel/grounding'
import { expandQueriesForLanguage } from '../../src/lib/intel/crosslingual'
import { buildTechDocsContext } from '../../src/lib/intel/techdocs'
import { verifyGeneratedImage, verifyVideoContinuity, extractSceneState, imageBufferToDataUrl } from '../../src/lib/intel/continuity'
import { analyzeImageOnce } from '../../src/lib/intel/vision'
import { runResearch } from '../../src/lib/research/pipeline'
import { shouldSearch } from '../../src/lib/research/policy'
import { hostedImageAdapter } from '../../src/lib/adapters/hosted-image'
import { submitVideoJob, queryVideoJob, downloadVideo } from '../../src/lib/adapters/hosted-video'
import { upstreamCoolingDown } from '../../src/lib/upstream/gateway'

const execFileP = promisify(execFile)
const OUT_DIR = path.join(process.cwd(), 'scripts', 'world-eval', 'out')
mkdirSync(OUT_DIR, { recursive: true })
const EVIDENCE = path.join(OUT_DIR, 'evidence.jsonl')
writeFileSync(EVIDENCE, '')

const WITH_VIDEO = process.argv.includes('--with-video')

interface CaseResult {
  section: string
  name: string
  status: 'pass' | 'fail' | 'skipped' | 'degraded'
  latencyMs: number
  detail: string
  data?: Record<string, unknown>
}

function record(r: CaseResult): void {
  appendFileSync(EVIDENCE, JSON.stringify({ at: new Date().toISOString(), ...r }) + '\n')
  const icon = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : r.status === 'skipped' ? 'SKIP' : 'DEGR'
  console.log(`[${icon}] ${r.section}/${r.name} (${r.latencyMs}ms) ${r.detail.slice(0, 160)}`)
}

async function timed(name: string, section: string, fn: () => Promise<Omit<CaseResult, 'section' | 'name' | 'latencyMs'>>): Promise<void> {
  const t0 = Date.now()
  try {
    const r = await fn()
    record({ section, name, latencyMs: Date.now() - t0, ...r })
  } catch (e) {
    record({
      section,
      name,
      status: 'fail',
      latencyMs: Date.now() - t0,
      detail: `threw: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
    })
  }
}

// ---------------------------------------------------------------------------
// Section 1: multilingual understanding (pure — always runs)
// ---------------------------------------------------------------------------

const LANG_CASES: Array<{ name: string; text: string; expect: string }> = [
  { name: 'english', text: 'What is the tallest mountain in the world?', expect: 'en' },
  { name: 'tamil', text: 'தமிழ்நாட்டின் தலைநகர் எது? எனக்கு சொல்லுங்கள்', expect: 'ta' },
  { name: 'hindi', text: 'भारत की राजधानी क्या है और यह कब स्थापित हुई?', expect: 'hi' },
  { name: 'malayalam', text: 'കേരളത്തിലെ തലസ്ഥാനം ഏതാണ്? എനിക്ക് പറയൂ', expect: 'ml' },
  { name: 'arabic', text: 'ما هي عاصمة مصر وما هو عدد سكانها؟', expect: 'ar' },
  { name: 'spanish', text: '¿Cuál es la capital de Argentina y por qué es importante?', expect: 'es' },
  { name: 'chinese', text: '中国的首都是哪里？请告诉我它的历史', expect: 'zh' },
  { name: 'japanese', text: '日本の首都はどこですか？教えてください', expect: 'ja' },
  { name: 'mixed-tamil-english', text: 'தமிழ்நாடு பற்றி tell me the history of its temples', expect: 'ta' },
]

async function sectionLanguage(): Promise<void> {
  for (const c of LANG_CASES) {
    await timed(c.name, 'language', async () => {
      const p = detectLanguage(c.text)
      if (p.primary !== c.expect) {
        return { status: 'fail', detail: `expected ${c.expect}, detected ${p.primary} (confidence ${p.confidence.toFixed(2)})` }
      }
      return {
        status: 'pass',
        detail: `${LANGUAGE_NAMES[p.primary]} @ confidence ${p.confidence.toFixed(2)}${p.mixed ? ' (mixed)' : ''}${p.transliterated ? ' (transliterated)' : ''}`,
        data: { primary: p.primary, confidence: p.confidence, mixed: p.mixed, transliterated: p.transliterated },
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Section 2: retrieval policy + real research (RIISHE path, bounded)
// ---------------------------------------------------------------------------

async function sectionRetrieval(): Promise<void> {
  // 2a. Deterministic policy sanity (pure).
  await timed('policy-officeholder', 'retrieval', async () => {
    const d = shouldSearch('Who is the chief minister of Tamil Nadu?')
    return d.search ? { status: 'pass', detail: `search triggered: ${d.reason}` } : { status: 'fail', detail: 'officeholder question did not trigger search' }
  })

  // 2b. Cross-language expansion with the REAL gateway (one bounded call).
  await timed('crosslingual-tamil-expansion', 'retrieval', async () => {
    if (upstreamCoolingDown('chat')) {
      return { status: 'skipped', detail: 'chat endpoint class cooling down (measured 429 breaker open) — no network call made' }
    }
    const r = await expandQueriesForLanguage('தமிழ்நாட்டின் தலைநகர் எது?', ['தமிழ்நாட்டின் தலைநகர் எது?'])
    if (r.added.length === 0) {
      return { status: 'degraded', detail: r.note ?? 'expansion returned no variant (gateway may be unavailable)', data: r }
    }
    return { status: 'pass', detail: `added English variant: "${r.added[0].slice(0, 80)}"`, data: r }
  })

  // 2c. Real research pipeline on a Tamil current-facts question (exactly the
  // RIISHE grounded path: policy → queries (incl. English variant) → search
  // → rank). ONE pipeline run; its internals follow the shipped bounded policy.
  await timed('research-tamil-live', 'retrieval', async () => {
    if (upstreamCoolingDown('functions')) {
      return { status: 'skipped', detail: 'functions endpoint class cooling down (429 breaker open) — no network call made' }
    }
    const message = 'தமிழ்நாட்டின் முதல்வர் யார்?'
    const decision = shouldSearch(message)
    const pack = await runResearch(message, decision)
    if (pack.sources.length === 0) {
      return { status: 'degraded', detail: `no sources (degraded: ${pack.degraded.slice(0, 2).join(' | ')})`, data: pack }
    }
    const hosts = pack.sources.map((s) => s.hostName).slice(0, 4)
    return {
      status: 'pass',
      detail: `${pack.sources.length} sources in ${pack.durationMs}ms; queries=${pack.queries.length}; hosts=${hosts.join(', ')}`,
      data: { queries: pack.queries, hosts, degraded: pack.degraded, durationMs: pack.durationMs, searchMs: pack.searchMs },
    }
  })
}

// ---------------------------------------------------------------------------
// Section 3: generation grounding (real retrieval where mode=facts)
// ---------------------------------------------------------------------------

const GROUNDING_CASES: Array<{ name: string; prompt: string; product: 'laxii' | 'jazmii'; expectMode: 'none' | 'facts'; expectKnowledge?: string }> = [
  { name: 'crow-takeoff-video', prompt: 'a crow taking off from a branch and flying across the field', product: 'jazmii', expectMode: 'facts', expectKnowledge: 'bird-flight' },
  { name: 'human-walk-video', prompt: 'a person walking through a busy market street', product: 'jazmii', expectMode: 'none', expectKnowledge: 'human-walk-run' },
  { name: 'waterfall-fire-image', prompt: 'a waterfall pouring into a river beside a campfire with smoke rising at golden hour', product: 'laxii', expectMode: 'none', expectKnowledge: 'fire-smoke' },
  { name: 'glass-shatter-image', prompt: 'a glass window shattering after a cricket ball strike', product: 'laxii', expectMode: 'none', expectKnowledge: 'glass-brittle' },
]

async function sectionGrounding(): Promise<void> {
  for (const c of GROUNDING_CASES) {
    await timed(c.name, 'grounding', async () => {
      const intel =
        c.product === 'laxii'
          ? await prepareImageIntelligence(c.prompt)
          : await prepareVideoIntelligence(c.prompt)
      const checks: string[] = []
      if (intel.mode !== c.expectMode) checks.push(`mode ${intel.mode} != expected ${c.expectMode}`)
      if (c.expectKnowledge && !intel.knowledgeKeys.includes(c.expectKnowledge)) {
        checks.push(`missing knowledge component ${c.expectKnowledge} (got ${intel.knowledgeKeys.join(',')})`)
      }
      if (!intel.conditionedPrompt.startsWith(c.prompt)) checks.push('user prompt not preserved verbatim/first')
      if (checks.length > 0) {
        return { status: 'fail', detail: checks.join('; '), data: { ...intel.timing, mode: intel.mode, knowledge: intel.knowledgeKeys } }
      }
      return {
        status: intel.degraded.length > 0 ? 'degraded' : 'pass',
        detail:
          `mode=${intel.mode}; knowledge=[${intel.knowledgeKeys.join(',')}]; ` +
          `evidence=${intel.evidence.length}${intel.degraded.length > 0 ? `; degraded: ${intel.degraded[0].slice(0, 80)}` : ''}; ` +
          `timing ${JSON.stringify(intel.timing)}`,
        data: {
          mode: intel.mode,
          knowledgeKeys: intel.knowledgeKeys,
          evidence: intel.evidence.map((e) => ({ host: e.host, url: e.url })),
          degraded: intel.degraded,
          timing: intel.timing,
          promptLanguage: intel.promptLanguage,
        },
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Section 4: conditioning snapshots (pure)
// ---------------------------------------------------------------------------

async function sectionConditioning(): Promise<void> {
  await timed('cinema-directives', 'conditioning', async () => {
    const d = extractCinematography('close-up of a blacksmith hammering glowing steel, golden hour, shallow depth of field, tracking shot')
    const okShot = d.shotType === 'close-up'
    const okLight = d.lighting.some((l) => l.includes('golden-hour'))
    const okLens = (d.lens ?? '').includes('shallow')
    const okMove = (d.cameraMove ?? '').includes('tracking')
    const block = renderCinematographyBlock(d, 'jazmii')
    if (okShot && okLight && okLens && okMove && block.includes('CAMERA & LIGHT')) {
      return { status: 'pass', detail: `shot=${d.shotType}; light=${d.lighting[0]}; lens=${d.lens}; move=${d.cameraMove}` }
    }
    return { status: 'fail', detail: `shot=${d.shotType} light=${d.lighting.join('|')} lens=${d.lens} move=${d.cameraMove}` }
  })

  await timed('world-block-scope-honesty', 'conditioning', async () => {
    const u = understandPrompt('an eagle soaring over mountains in a storm', 'jazmii')
    const block = renderWorldKnowledgeBlock(assembleWorldKnowledge(u))
    const honest = block.includes('not a physics simulation')
    const relevant = block.includes('Eagles') || block.includes('Bird flight') || block.includes('storms')
    return honest && relevant && block.length < 4000
      ? { status: 'pass', detail: `${block.length} chars, scope line present` }
      : { status: 'fail', detail: `honest=${honest} relevant=${relevant} len=${block.length}` }
  })
}

// ---------------------------------------------------------------------------
// Section 5: tech-docs retrieval (GIFTZ path, real, bounded)
// ---------------------------------------------------------------------------

async function sectionTechDocs(): Promise<void> {
  const cases = [
    { name: 'react-version-docs', message: 'How do I write a proper cleanup for useEffect in React 19?' },
    { name: 'nextjs-docs', message: 'Show me how to do server-side rendering with Next.js app router' },
  ]
  for (const c of cases) {
    await timed(c.name, 'techdocs', async () => {
      if (upstreamCoolingDown('functions')) {
        return { status: 'skipped', detail: 'functions endpoint class cooling down — no network call made' }
      }
      const ctx = await buildTechDocsContext(c.message)
      if (!ctx) return { status: 'fail', detail: 'no tech subject detected for a library-specific question' }
      if (ctx.block === '') {
        return { status: 'degraded', detail: `subjects=[${ctx.subjects.map((s) => s.name).join(',')}] but no usable docs (degraded: ${ctx.degraded[0] ?? 'none'})`, data: ctx }
      }
      return {
        status: 'pass',
        detail: `subjects=[${ctx.subjects.map((s) => s.name + (s.version ? `@${s.version}` : '')).join(',')}]; sources=${ctx.sources.map((s) => s.host).join(',')}; ${ctx.durationMs}ms`,
        data: ctx,
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Section 6: vision lane (bounded, honest skip on breaker)
// ---------------------------------------------------------------------------

async function makeTestPng(): Promise<Buffer> {
  const dir = await execFileP('mktemp', ['-d'])
  const file = path.join(dir.stdout.trim(), 'probe.png')
  await execFileP('ffmpeg', ['-f', 'lavfi', '-i', 'color=c=blue:s=128x128:d=0.1', '-frames:v', '1', '-y', file], { timeout: 20_000 })
  const buf = await import('node:fs/promises').then((m) => m.readFile(file))
  return buf
}

async function sectionVision(): Promise<void> {
  await timed('vision-lane-probe', 'vision', async () => {
    if (upstreamCoolingDown('chat')) {
      return { status: 'skipped', detail: 'chat endpoint class cooling down — vision probe not attempted' }
    }
    const buf = await makeTestPng()
    const dataUrl = await imageBufferToDataUrl(buf, 'image/png')
    const outcome = await analyzeImageOnce(dataUrl, 'What solid color fills this image? Answer with the color name only.')
    if (!outcome.text) return { status: 'degraded', detail: outcome.reason ?? 'no text returned', data: outcome }
    const said = outcome.text.toLowerCase()
    const ok = said.includes('blue')
    return ok
      ? { status: 'pass', detail: `vision answered correctly in ${outcome.durationMs}ms: "${outcome.text.slice(0, 60)}"` }
      : { status: 'fail', detail: `unexpected answer: ${outcome.text.slice(0, 100)}` }
  })
}

// ---------------------------------------------------------------------------
// Section 7: real LAXII generation with conditioning + vision verification
// ---------------------------------------------------------------------------

async function sectionGeneration(): Promise<void> {
  await timed('laxii-conditioned-t2i', 'generation', async () => {
    if (upstreamCoolingDown('images')) {
      return { status: 'skipped', detail: 'images endpoint class cooling down — single-attempt policy forbids burning a probe into the throttle' }
    }
    const prompt = 'a crow taking off from a wet branch at dawn, wings spreading, rain droplets in the air'
    const intel = await prepareImageIntelligence(prompt)
    let result: Awaited<ReturnType<NonNullable<typeof hostedImageAdapter.generateImage>>>
    try {
      result = await hostedImageAdapter.generateImage!({
        prompt: intel.conditionedPrompt,
        size: '1024x1024',
        timeoutMs: 120_000,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/429|rate.?limit/i.test(msg)) {
        return {
          status: 'degraded',
          detail: `single real attempt refused by the provider throttle (HTTP 429) — per policy NO retry was made; conditioning was still exercised: mode=${intel.mode}, knowledge=[${intel.knowledgeKeys.join(',')}]`,
          data: { intel: { mode: intel.mode, knowledge: intel.knowledgeKeys, timing: intel.timing }, error: msg.slice(0, 200) },
        }
      }
      throw e
    }
    const artifact = path.join(OUT_DIR, 'laxii-conditioned-crow.jpg')
    writeFileSync(artifact, result.bytes)

    // Real vision verification of the REAL artifact (single bounded call).
    const dataUrl = await imageBufferToDataUrl(result.bytes, result.format === 'png' ? 'image/png' : 'image/jpeg')
    const report = await verifyGeneratedImage(dataUrl, prompt)

    return {
      status: report.checked ? 'pass' : 'degraded',
      detail:
        `${result.width}x${result.height} ${(result.bytes.length / 1024).toFixed(0)}KB intel=${intel.mode}/[${intel.knowledgeKeys.join(',')}] ` +
        `verify=${report.method}${report.checked ? ` defects=${report.defects.length}` : ` (${report.reason ?? 'no report'})`}`,
      data: {
        artifact,
        intel: { mode: intel.mode, knowledge: intel.knowledgeKeys, timing: intel.timing, evidence: intel.evidence.map((e) => e.url) },
        verification: report,
      },
    }
  })

  // ---- Real JAZMII continuity analysis on the REAL artifact from the
  // committed acceptance evidence (no fresh generation burned by default).
  const realVideo = findRealVideoArtifact()
  if (realVideo) {
    await timed('jazmii-continuity-real-artifact', 'generation', async () => {
      const report = await verifyVideoContinuity(realVideo, {
        requestSummary: 'previously completed real JAZMII video job (acceptance evidence artifact)',
      })
      if (!report.checked) {
        return { status: 'degraded', detail: `continuity check unavailable: ${report.reason}`, data: report }
      }
      return {
        status: 'pass',
        detail: `vision frame analysis ${report.durationMs}ms; defects=${report.defects.length}${report.defects.length ? `: ${report.defects.slice(0, 2).join(' | ')}` : ''}`,
        data: report,
      }
    })
  } else {
    record({ section: 'generation', name: 'jazmii-continuity-real-artifact', status: 'skipped', latencyMs: 0, detail: 'no real video artifact found under storage/jazmii' })
  }

  // ---- Optional: ONE real fresh T2V job (explicit opt-in; bounded poll).
  if (WITH_VIDEO) {
    await timed('jazmii-fresh-t2v', 'generation', async () => {
      if (upstreamCoolingDown('video')) {
        return { status: 'skipped', detail: 'video endpoint class cooling down — single-attempt policy forbids submission into the throttle' }
      }
      const prompt = 'a crow taking off from a branch and flying away, slow motion, natural morning light'
      const intel = await prepareVideoIntelligence(prompt)
      const handle = await submitVideoJob({ prompt: intel.conditionedPrompt, quality: 'speed', durationSec: 5 })
      const deadline = Date.now() + 12 * 60_000
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10_000))
        const status = await queryVideoJob(handle.taskId)
        if (status.state === 'fail') {
          return { status: 'fail', detail: `provider reported FAIL: ${status.providerMessage ?? 'no message'}` }
        }
        if (status.state === 'success' && status.videoUrl) {
          const dl = await downloadVideo(status.videoUrl)
          const artifact = path.join(OUT_DIR, 'jazmii-conditioned-crow.mp4')
          writeFileSync(artifact, dl.bytes)
          const report = await verifyVideoContinuity(artifact, { requestSummary: prompt })
          return {
            status: report.checked ? 'pass' : 'degraded',
            detail: `${(dl.bytesLength / 1024 / 1024).toFixed(2)}MB video; continuity=${report.method} defects=${report.defects.length}`,
            data: { artifact, continuity: report },
          }
        }
      }
      return { status: 'degraded', detail: 'bounded 12-minute tracking window elapsed before completion (job left honestly unfinished, no retry)' }
    })
  }
}

function findRealVideoArtifact(): string | null {
  const root = path.join(process.cwd(), 'storage', 'jazmii')
  if (!existsSync(root)) return null
  for (const user of readdirSync(root)) {
    const dir = path.join(root, user)
    if (!statSync(dir).isDirectory()) continue
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.mp4')) {
        const p = path.join(dir, f)
        if (statSync(p).size > 100_000) return p
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Section 8: reference-image scene state (I2V continuity input, real vision)
// ---------------------------------------------------------------------------

async function sectionReferenceScene(): Promise<void> {
  await timed('reference-scene-state', 'continuity', async () => {
    const img = findRealImageAsset()
    if (!img) return { status: 'skipped', detail: 'no real image asset found under storage/laxii' }
    if (upstreamCoolingDown('chat')) {
      return { status: 'skipped', detail: 'chat endpoint class cooling down — scene-state analysis not attempted' }
    }
    const buf = (await import('node:fs/promises')).readFile(img)
    const dataUrl = await imageBufferToDataUrl(await buf, 'image/jpeg')
    const state = await extractSceneState(dataUrl)
    if (state.method !== 'vision-analysis') {
      return { status: 'degraded', detail: state.reason ?? 'scene state unavailable', data: state }
    }
    return {
      status: 'pass',
      detail: `subject="${(state.subject ?? 'unclear').slice(0, 60)}"; light=${(state.lightingDirection ?? 'unclear').slice(0, 40)}; directives=${(state.continuityDirectives ?? '').length} chars`,
      data: state,
    }
  })
}

function findRealImageAsset(): string | null {
  const root = path.join(process.cwd(), 'storage', 'laxii', 'assets')
  if (!existsSync(root)) return null
  for (const user of readdirSync(root)) {
    const dir = path.join(root, user)
    if (!statSync(dir).isDirectory()) continue
    for (const f of readdirSync(dir)) {
      if (/\.(jpe?g|png)$/i.test(f)) {
        const p = path.join(dir, f)
        if (statSync(p).size > 20_000) return p
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`BEAN Intelligence evaluation — ${new Date().toISOString()}${WITH_VIDEO ? ' (with fresh video job)' : ''}`)
  console.log('Contract: at most ONE network attempt per case; breaker-open cases SKIP honestly; failures are reported, never hidden.\n')
  await sectionLanguage()
  await sectionRetrieval()
  await sectionGrounding()
  await sectionConditioning()
  await sectionTechDocs()
  await sectionVision()
  await sectionReferenceScene()
  await sectionGeneration()

  const lines = (await import('node:fs')).readFileSync(EVIDENCE, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as CaseResult)
  const counts = {
    pass: lines.filter((l) => l.status === 'pass').length,
    degraded: lines.filter((l) => l.status === 'degraded').length,
    skipped: lines.filter((l) => l.status === 'skipped').length,
    fail: lines.filter((l) => l.status === 'fail').length,
  }
  console.log(`\nTOTAL: ${counts.pass} pass / ${counts.degraded} degraded / ${counts.skipped} skipped / ${counts.fail} fail`)
  console.log(`Evidence: ${EVIDENCE}`)
  // Deterministic-logic failures fail the run; network degradations do NOT
  // (they are honest outcomes, not bugs).
  process.exit(counts.fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('harness crashed:', e)
  process.exit(2)
})
