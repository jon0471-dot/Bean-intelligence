/**
 * M28 — GANGZII speech evaluation CLI.
 *
 * Generates REAL speech samples for the selected voices across the corpus,
 * measures every technical property from the produced bytes, writes the run
 * artifacts (run.json + review-sheet.md + WAVs) under
 * storage/evals/gangzii-speech/<runId>/ and prints a summary.
 *
 * Usage:
 *   bun scripts/m28-speech-eval.ts [--voices af_heart,bf_emma]
 *                                  [--categories short,numbers-currency]
 *                                  [--items N] [--speed 1] [--label my-label]
 *
 * Defaults: 4 representative English voices (2 US, 2 UK) × 1 item per
 * category — a fast but real pass. Use --items 0 for the full corpus.
 */
import fs from 'fs'
import path from 'path'
import { runSpeechEvaluation, type SpeechCorpus } from '../evals/gangzii-speech/run'

const CORPUS_PATH = path.join(process.cwd(), 'evals', 'gangzii-speech', 'corpus.json')
const DEFAULT_VOICES = ['af_heart', 'am_michael', 'bf_emma', 'bm_george']

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--voices') out.voices = argv[++i]
    else if (argv[i] === '--categories') out.categories = argv[++i]
    else if (argv[i] === '--items') out.items = argv[++i]
    else if (argv[i] === '--speed') out.speed = argv[++i]
    else if (argv[i] === '--label') out.label = argv[++i]
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8')) as SpeechCorpus
  const voices = args.voices ? args.voices.split(',').map((v) => v.trim()).filter(Boolean) : DEFAULT_VOICES
  const items = args.items !== undefined ? (args.items === '0' ? null : Number(args.items)) : 1
  const speed = args.speed ? Number(args.speed) : 1
  const runId = args.label ? `run-${args.label}-${new Date().toISOString().replace(/[:.]/g, '-')}` : undefined

  console.log(`[m28-eval] corpus v${corpus.version}, voices: ${voices.join(', ')}, items/category: ${items ?? 'all'}`)
  const run = await runSpeechEvaluation({
    corpus,
    voices,
    itemsPerCategoryLimit: items,
    categories: args.categories ? args.categories.split(',').map((c) => c.trim()) : null,
    speed,
    runId,
  })

  const outDir = path.join(process.cwd(), 'storage', 'evals', 'gangzii-speech', run.runId)
  console.log(`[m28-eval] run ${run.runId} written to ${outDir}`)
  for (const v of run.voiceSummaries) {
    console.log(
      `[m28-eval] ${v.voice} (${v.language}): generated ${v.samplesGenerated}/${v.samplesGenerated + v.samplesFailed}, mean RTF ${v.meanRtf ?? 'n/a'}, mean LUFS ${v.meanIntegratedLufs ?? 'n/a'}, max TP ${v.maxTruePeakDbtp ?? 'n/a'} dBTP, clipping ${v.clippingSuspectedCount}`,
    )
  }
  console.log(`[m28-eval] model integrity state at run time: ${run.environment.modelIntegrityState} (source: ${run.environment.modelChecksumSource ?? 'none'})`)
  console.log('[m28-eval] review sheet: storage/evals/gangzii-speech/' + run.runId + '/review-sheet.md — listening review is the OWNER\'s step')
  if (run.samples.some((s) => s.error)) process.exit(2)
}

main().catch((e) => {
  console.error('[m28-eval] FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
