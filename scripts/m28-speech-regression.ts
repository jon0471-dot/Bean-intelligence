/**
 * M28 — GANGZII speech evaluation REGRESSION comparison.
 *
 * Compares an M28 run.json against the recorded M27 technical baseline
 * (evals/gangzii-speech/m27-baseline.json) and, when provided, against a
 * prior run. Verdict vocabulary: improved / same / regressed / unmeasurable.
 *
 * Honesty rules:
 *  - pronunciation and intelligibility regressions CANNOT be measured by
 *    code: they are reported as "owner listening review required";
 *  - missing-text/ordering checks use structural facts (chunk counts,
 *    duration sanity) as PROXIES and are labelled as such;
 *  - no number is invented: metrics absent on either side are unmeasurable.
 *
 * Usage:
 *   bun scripts/m28-speech-regression.ts --run <runId|path/to/run.json>
 *       [--prior <priorRunId|path>]
 */
import fs from 'fs'
import path from 'path'
import type { EvalRunSummary } from '../evals/gangzii-speech/run'

const BASELINE_PATH = path.join(process.cwd(), 'evals', 'gangzii-speech', 'm27-baseline.json')
const RUNS_ROOT = path.join(process.cwd(), 'storage', 'evals', 'gangzii-speech')

function resolveRun(spec: string): EvalRunSummary {
  const p = spec.endsWith('.json') ? spec : path.join(RUNS_ROOT, spec, 'run.json')
  return JSON.parse(fs.readFileSync(p, 'utf8')) as EvalRunSummary
}

function verdict(label: string, prior: number | null | undefined, current: number | null | undefined, tolerance: number, higherIsBetter = false) {
  if (prior === null || prior === undefined || current === null || current === undefined) return `${label}: UNMEASURABLE (prior ${prior ?? 'n/a'} → current ${current ?? 'n/a'})`
  const delta = Math.round((current - prior) * 1000) / 1000
  const within = Math.abs(delta) <= tolerance
  const worse = higherIsBetter ? delta < -tolerance : delta > tolerance
  const better = higherIsBetter ? delta > tolerance : delta < -tolerance
  const tag = worse ? 'REGRESSED' : better ? 'improved' : within ? 'same' : 'changed-within-tolerance'
  return `${label}: ${tag} (prior ${prior} → current ${current}, Δ ${delta})`
}

function main() {
  const argv = process.argv.slice(2)
  const runIdx = argv.indexOf('--run')
  const priorIdx = argv.indexOf('--prior')
  if (runIdx === -1) {
    console.error('Usage: bun scripts/m28-speech-regression.ts --run <runId|path> [--prior <runId|path>]')
    process.exit(1)
  }
  const run = resolveRun(argv[runIdx + 1])
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as {
    metrics: { modelLoadMs: { low: number; high: number }; realtimeFactor: { measured: number }; rssMbDuringLoadedInference: { measured: number; toleranceMb: number } }
  }

  const lines: string[] = []
  lines.push(`# M28 speech regression comparison — run ${run.runId}`)
  lines.push('')
  lines.push(`Environment: ${run.environment.platform}, ${run.environment.vcpus ?? '?'} vCPU, ${run.environment.cpuModel ?? 'cpu unknown'}`)
  const envComparable = run.environment.vcpus === 2 && run.environment.totalRamGb !== null && run.environment.totalRamGb <= 4.5
  lines.push(`Hardware comparable to M27 baseline (2 vCPU / 3.9 GB): ${envComparable ? 'YES — direct comparison valid' : 'NO — environmental differences recorded; comparisons are indicative only'}`)
  lines.push('')

  const rtfSamples = run.samples.filter((s) => !s.error && s.rtf !== null).map((s) => s.rtf as number)
  const meanRtf = rtfSamples.length ? Math.round((rtfSamples.reduce((a, b) => a + b, 0) / rtfSamples.length) * 100) / 100 : null
  const rssSamples = run.samples.filter((s) => !s.error && s.peakRssMb !== null).map((s) => s.peakRssMb as number)
  const meanRss = rssSamples.length ? Math.round(rssSamples.reduce((a, b) => a + b, 0) / rssSamples.length) : null

  lines.push('## Performance vs M27 baseline')
  lines.push('')
  lines.push(verdict('Realtime factor (lower is better)', baseline.metrics.realtimeFactor.measured, meanRtf, 0.35))
  lines.push(`Model load: baseline ${baseline.metrics.modelLoadMs.low}–${baseline.metrics.modelLoadMs.high} ms (M27 smoke). This run does not remeasure cold load separately; see run.json generation latencies.`)
  lines.push(verdict('Peak RSS during generation (MB, higher is a resource regression)', baseline.metrics.rssMbDuringLoadedInference.measured, meanRss, baseline.metrics.rssMbDuringLoadedInference.toleranceMb))
  lines.push('')

  lines.push('## Technical quality gates')
  lines.push('')
  const failed = run.samples.filter((s) => s.error)
  lines.push(`Synthesis failures: ${failed.length}/${run.samples.length} ${failed.length === 0 ? '(none)' : '— INVESTIGATE'}`)
  const clip = run.samples.filter((s) => !s.error && s.measurements.clippingSuspected)
  lines.push(`Clipping suspected: ${clip.length}/${run.samples.length} ${clip.length === 0 ? '(none)' : '— REGRESSION SIGNAL: ' + clip.map((s) => `${s.voice}/${s.itemId}`).join(', ')}`)
  const badDuration = run.samples.filter((s) => !s.error && s.audioDurationSec !== null && s.audioDurationSec < 0.2)
  lines.push(`Suspiciously short outputs (missing-text proxy, <0.2 s): ${badDuration.length} ${badDuration.length === 0 ? '(none)' : '— CHECK: ' + badDuration.map((s) => `${s.voice}/${s.itemId}`).join(', ')}`)
  const chunkMismatches = run.samples.filter((s) => !s.error && s.chunks === 0)
  lines.push(`Chunk/segment ordering anomalies (0 chunks reported): ${chunkMismatches.length} ${chunkMismatches.length === 0 ? '(none)' : '— CHECK'}`)
  const lufs = run.samples.filter((s) => !s.error && s.measurements.integratedLufs !== null).map((s) => s.measurements.integratedLufs as number)
  lines.push(`Integrated loudness range across samples: ${lufs.length ? Math.round(Math.min(...lufs) * 10) / 10 : 'n/a'} … ${lufs.length ? Math.round(Math.max(...lufs) * 10) / 10 : 'n/a'} LUFS (24 kHz mono PCM16 everywhere: ${run.samples.every((s) => s.error || (s.measurements.sampleRateHz === 24000 && s.measurements.channels === 1)) ? 'yes' : 'NO'})`)
  lines.push('')

  if (priorIdx !== -1) {
    const prior = resolveRun(argv[priorIdx + 1])
    lines.push('## Run-over-run comparison (this run vs prior run)')
    lines.push('')
    const key = (r: EvalRunSummary) => {
      const ok = r.samples.filter((s) => !s.error)
      const rtf = ok.map((s) => s.rtf).filter((v): v is number => v !== null)
      const lufsAll = ok.map((s) => s.measurements.integratedLufs).filter((v): v is number => v !== null)
      return {
        rtf: rtf.length ? Math.round((rtf.reduce((a, b) => a + b, 0) / rtf.length) * 100) / 100 : null,
        lufs: lufsAll.length ? Math.round((lufsAll.reduce((a, b) => a + b, 0) / lufsAll.length) * 100) / 100 : null,
        failures: r.samples.filter((s) => s.error).length,
      }
    }
    const a = key(prior)
    const b = key(run)
    lines.push(verdict('Mean RTF', a.rtf, b.rtf, 0.35))
    lines.push(verdict('Mean integrated LUFS', a.lufs, b.lufs, 2))
    lines.push(`Synthesis failures: prior ${a.failures} → current ${b.failures} ${b.failures > a.failures ? '— REGRESSED' : 'same/improved'}`)
    lines.push('')
  }

  lines.push('## Cannot be measured automatically (owner listening review required)')
  lines.push('')
  lines.push('- Pronunciation regressions / improvements')
  lines.push('- Intelligibility, naturalness, pacing, pauses, voice consistency, sentence transitions, audio artifacts')
  lines.push('- Overall acceptability of non-English voices (not in this run; still unverified)')
  lines.push('')
  lines.push('Use the run\'s review-sheet.md: listen, fill the subjective columns, sign the verdict block.')
  const report = lines.join('\n')
  console.log(report)
  const outPath = path.join(RUNS_ROOT, run.runId, 'regression-vs-m27.md')
  fs.writeFileSync(outPath, report)
  console.log(`\n[regression] written: ${outPath}`)
}

main()
