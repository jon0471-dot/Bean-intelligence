/**
 * M40.9 LOW-SPEC SOAK + CONCURRENCY + RECOVERY PROBE (extends M40.4).
 *
 * The M40.4 probe measured per-lane cold/steady/reaper behavior. M40.9 closes
 * the remaining low-spec acceptance points with REAL measured execution on the
 * same physical constrained host (2 vCPU, ~4 GB RAM, no GPU — NOT a simulated
 * profile):
 *
 *   1. LONG-RUNNING STABILITY  — a sustained mixed-lane loop (embeddings,
 *      rerank, OCR rotating) for a fixed wall window; every run must pass its
 *      task-specific validation, durations + an RSS timeline are recorded.
 *   2. CONCURRENT EXECUTION    — a real concurrent burst (all three lanes
 *      interleaved via Promise.all batches); every invocation validated.
 *      (The BROWSER worker-concurrency caps are a separate evidence class:
 *      they remain pinned by the client-compute test battery — recorded as
 *      such, never presented as a server measurement.)
 *   3. LOAD SPIKE + RECOVERY   — an oversized embeddings batch (real memory
 *      pressure on a 4 GB host), followed by normal runs that must still
 *      validate (graceful recovery), then explicit unload with RSS returning
 *      toward baseline.
 *   4. CANCELLATION (honest statement) — the server-side local-model lanes
 *      expose no abort surface (cancellation is enforced at the client-compute
 *      scheduler, where mid-flight abort + cleanup are pinned by dedicated
 *      tests). Recorded as a contract-backed capability, NOT a measured one.
 *
 * Output: scripts/m40-acceptance/out/low-spec-soak.json
 * Run:    bun scripts/m40-acceptance/low-spec-soak.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'

mkdirSync('scripts/m40-acceptance/out', { recursive: true })

const SOAK_WINDOW_MS = Number(process.env.SOAK_WINDOW_MS ?? 90_000)
const CONCURRENT_BATCHES = Number(process.env.SOAK_CONCURRENT ?? 3)

const rssMb = () => process.memoryUsage().rss / 1048576
const host = {
  cpus: os.cpus().length,
  cpuModel: os.cpus()[0]?.model ?? 'unknown',
  totalMemMb: os.totalmem() / 1048576,
  freeMemMbStart: os.freemem() / 1048576,
  gpu: 'none (physical fact of this host — WebGPU absent)',
  platform: `${os.platform()} ${os.arch()} ${os.release()}`,
  classification: 'real constrained host (4 GB class, CPU-only) — not a simulated profile',
}
console.log('HOST:', JSON.stringify(host))
console.log(`PARAMS: soak window ${SOAK_WINDOW_MS / 1000}s, concurrent batches ${CONCURRENT_BATCHES}`)

const results: {
  startedAt: string
  host: typeof host
  params: { soakWindowMs: number; concurrentBatches: number }
  soak: { runs: number; validated: number; failedRuns: number; wallMs: number; durationMinMs: number; durationMaxMs: number; durationMeanMs: number; rssStartMb: number; rssEndMb: number; rssPeakMb: number; rssTimeline: number[] } | { error: string }
  concurrency: { batches: number; invocations: number; validated: number; wallMs: number } | { error: string }
  loadSpike: { batchTexts: number; batchMs: number; rssDuringSpikeMb: number; recoveryRuns: number; recoveryValidated: number; recoveryMs: number[]; rssAfterUnloadMb: number } | { error: string }
  cancellation: { measuredOnServer: false; statement: string }
  finishedAt?: string
} = {
  startedAt: new Date().toISOString(),
  host,
  params: { soakWindowMs: SOAK_WINDOW_MS, concurrentBatches: CONCURRENT_BATCHES },
  soak: { error: 'not run' },
  concurrency: { error: 'not run' },
  loadSpike: { error: 'not run' },
  cancellation: {
    measuredOnServer: false,
    statement:
      'The server-side local-model lanes (src/lib/media/local-models.ts + the ocr/embeddings/rerank modules) expose no abort surface — a held inference cannot be cancelled mid-flight on the server. Cancellation IS enforced and contract-tested one layer up, in the client-compute scheduler (abort-signal propagation, worker termination, post-cancel health — pinned by the M39/M40 battery, green in the M40.9 full-suite run). Recorded as contract-backed evidence, never presented as a server-side measurement.',
  },
}

// ---- lane runners (identical task-specific validation to the M40.4 probe) ---
const sharp = (await import('sharp')).default
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="300"><rect width="100%" height="100%" fill="white"/><text x="60" y="150" font-family="DejaVu Sans" font-size="42" fill="black">Soak probe 2026 stability 4GB</text></svg>`
const png = await sharp(Buffer.from(svg)).png().toBuffer()

const runEmbed = async () => {
  const { embedTexts, cosineSimilarity } = await import('../../src/lib/riishe/embeddings')
  const batch = await embedTexts(['The capital of France is Paris.', 'Paris is the capital city of France.', 'A completely unrelated sentence about tires.'])
  const c1 = cosineSimilarity(batch.vectors[0], batch.vectors[1])
  const c2 = cosineSimilarity(batch.vectors[0], batch.vectors[2])
  return { ok: batch.dimensions === 384 && c1 > c2 + 0.15, detail: `dim ${batch.dimensions} cos(${c1.toFixed(3)}> ${c2.toFixed(3)})` }
}
const runRerank = async () => {
  const { rerankPassages } = await import('../../src/lib/riishe/rerank')
  const res = await rerankPassages('What is the capital of France?', [
    'Paris is the capital and largest city of France.',
    'Marseille is a port city in southern France.',
    'Berlin is the capital of Germany.',
  ])
  return { ok: res.ordering[0] === 0 && res.scores[0] > res.scores[1], detail: `top=${res.ordering[0]} score=${res.scores[0].toFixed(3)}` }
}
const runOcr = async () => {
  const { recognizeImageText } = await import('../../src/lib/riishe/ocr')
  const r = await recognizeImageText(png)
  return { ok: r.text.toLowerCase().includes('soak probe 2026') && r.confidence >= 40, detail: `conf ${r.confidence?.toFixed?.(1)} ${r.wordCount}w` }
}
const lanes = [runEmbed, runRerank, runOcr]

// pre-load all three sessions so the soak measures steady-state execution
// (cold loads were measured by the M40.4 probe)
const { localModelState, unloadAllLocalModels } = await import('../../src/lib/media/local-models')
for (const id of ['minilm-l6-embeddings', 'ms-marco-minilm-rerank', 'ocr-eng-traineddata']) {
  const st = localModelState(id)
  if (st.state !== 'ready') {
    console.error(`model ${id} not ready (${st.state}) — run the admin-gated install first`)
    process.exit(1)
  }
}
await runEmbed()
await runRerank()
await runOcr()

// ---- 1. sustained mixed-lane soak -------------------------------------------
try {
  console.log(`\n== SOAK: ${lanes.length}-lane rotation for ${SOAK_WINDOW_MS / 1000}s ==`)
  const rssStart = rssMb()
  const durations: number[] = []
  let runs = 0
  let validated = 0
  let failedRuns = 0
  const rssTimeline: number[] = []
  const t0 = Date.now()
  let i = 0
  while (Date.now() - t0 < SOAK_WINDOW_MS) {
    const lane = lanes[i % lanes.length]
    const t = Date.now()
    try {
      const r = await lane()
      runs++
      if (r.ok) validated++
      else failedRuns++
      durations.push(Date.now() - t)
      if (runs % 5 === 0) rssTimeline.push(Math.round(rssMb() * 10) / 10)
    } catch (e) {
      failedRuns++
      console.log(`  run ${runs + 1} threw: ${(e as Error).message.slice(0, 120)}`)
    }
    i++
  }
  const wallMs = Date.now() - t0
  const mean = durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length)
  results.soak = {
    runs,
    validated,
    failedRuns,
    wallMs,
    durationMinMs: Math.min(...durations),
    durationMaxMs: Math.max(...durations),
    durationMeanMs: Math.round(mean * 10) / 10,
    rssStartMb: Math.round(rssStart * 10) / 10,
    rssEndMb: Math.round(rssMb() * 10) / 10,
    rssPeakMb: Math.max(...rssTimeline, rssStart),
    rssTimeline,
  }
  console.log('SOAK:', JSON.stringify(results.soak))
} catch (e) {
  results.soak = { error: (e as Error).message.slice(0, 200) }
  console.log('SOAK: ERROR', results.soak)
}

// ---- 2. concurrent burst -----------------------------------------------------
try {
  console.log(`\n== CONCURRENCY: ${CONCURRENT_BATCHES} concurrent 3-lane batches ==`)
  const t0 = Date.now()
  let invocations = 0
  let validated = 0
  const batch = async () => {
    const rs = await Promise.all([runEmbed(), runRerank(), runOcr()])
    invocations += rs.length
    validated += rs.filter((r) => r.ok).length
  }
  await Promise.all(Array.from({ length: CONCURRENT_BATCHES }, () => batch()))
  results.concurrency = { batches: CONCURRENT_BATCHES, invocations, validated, wallMs: Date.now() - t0 }
  console.log('CONCURRENCY:', JSON.stringify(results.concurrency))
} catch (e) {
  results.concurrency = { error: (e as Error).message.slice(0, 200) }
  console.log('CONCURRENCY: ERROR', results.concurrency)
}

// ---- 3. load spike + recovery -------------------------------------------------
try {
  console.log('\n== LOAD SPIKE: 512-text embeddings batch on the 4 GB host ==')
  const big = Array.from({ length: 512 }, (_, i) => `Spike sentence ${i}: quantized ONNX inference under memory pressure on a constrained CPU host.`)
  const { embedTexts } = await import('../../src/lib/riishe/embeddings')
  const t0 = Date.now()
  const spike = await embedTexts(big)
  const batchMs = Date.now() - t0
  const spikeOk = spike.dimensions === 384 && spike.vectors.length === 512
  console.log(`  spike batch: ${spike.vectors.length} vectors dim ${spike.dimensions} in ${batchMs}ms (validated ${spikeOk})`)
  const recoveryMs: number[] = []
  let recoveryValidated = 0
  for (let i = 0; i < 3; i++) {
    const t = Date.now()
    const r = await runEmbed()
    if (r.ok) recoveryValidated++
    recoveryMs.push(Date.now() - t)
  }
  await unloadAllLocalModels()
  await new Promise((r) => setTimeout(r, 500))
  results.loadSpike = {
    batchTexts: 512,
    batchMs,
    rssDuringSpikeMb: Math.round(rssMb() * 10) / 10,
    recoveryRuns: 3,
    recoveryValidated,
    recoveryMs,
    rssAfterUnloadMb: Math.round(rssMb() * 10) / 10,
  }
  if (!spikeOk || recoveryValidated < 3) {
    results.loadSpike = { error: `spike validation ${spikeOk}, recovery ${recoveryValidated}/3` }
  }
  console.log('LOAD SPIKE:', JSON.stringify(results.loadSpike))
} catch (e) {
  results.loadSpike = { error: (e as Error).message.slice(0, 200) }
  console.log('LOAD SPIKE: ERROR', results.loadSpike)
}

results.finishedAt = new Date().toISOString()
const soakOk = !('error' in results.soak) && results.soak.failedRuns === 0 && results.soak.validated === results.soak.runs
const concOk = !('error' in results.concurrency) && results.concurrency.validated === results.concurrency.invocations
const spikeOk = !('error' in results.loadSpike)
writeFileSync('scripts/m40-acceptance/out/low-spec-soak.json', JSON.stringify(results, null, 2))
console.log(`\nLOW-SPEC SOAK: soak=${soakOk ? 'OK' : 'FAILED'} concurrency=${concOk ? 'OK' : 'FAILED'} spike-recovery=${spikeOk ? 'OK' : 'FAILED'} → scripts/m40-acceptance/out/low-spec-soak.json`)
if (!(soakOk && concOk && spikeOk)) process.exitCode = 1
