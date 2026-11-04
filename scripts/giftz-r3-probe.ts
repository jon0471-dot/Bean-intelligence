/**
 * CODE GIFTZ — R3 (nested-awaits) targeted live probe.
 *
 * Runs ONLY the R3 regression question N times through the REAL CODE GIFTZ
 * SSE chat API (isolated :3100 verification instance), scoring each answer
 * with the exact benchmark checks from evals/code-giftz/questions.ts —
 * ground truth is computed by EXECUTING the snippet locally, never assumed.
 *
 * Purpose: distinguish a deterministic defect from model sampling variance
 * by measuring the pass rate over repeated legitimate runs. No mocks, no
 * answer editing; failures keep their full traces for diagnosis.
 *
 * Usage: bun scripts/giftz-r3-probe.ts <runs> <base-url>
 */
import { QUESTIONS, answerContainsGroundTruth } from '../evals/code-giftz/questions'
import { authenticate, streamTurnWith429Retry } from '../evals/code-giftz/run-eval'
import { mkdirSync, writeFileSync } from 'node:fs'

const RUNS = Number(process.argv[2] ?? 6)
const BASE_URL = (process.argv[3] ?? 'http://127.0.0.1:3100').replace(/\/$/, '')

const R3 = QUESTIONS.find((q) => q.id === 'R3-nested-awaits')
if (!R3 || !R3.snippet) {
  throw new Error('R3-nested-awaits question with snippet not found')
}
const R3_SNIPPET: string = R3.snippet
const R3_PROMPT: string = R3.prompt

interface ProbeResult {
  ranAt: string
  baseUrl: string
  runs: number
  passedRuns: number
  groundTruth: string[]
  results: Array<{ run: number; orderCheckPassed: boolean; terminalOk: boolean; durationMs: number; claimedOrderLines: string[]; answer: string }>
}

/** Pull capital-letter order lines the same way the benchmark check does. */
function claimedOrderLines(answer: string): string[] {
  return answer
    .split(/\r?\n/)
    .map((line) => {
      const letters = line.match(/\b[A-Z]\b/g)
      return letters ? letters.join(' ') : null
    })
    .filter((s): s is string => s !== null && /^[A-Z]( [A-Z])*$/.test(s))
}

async function main(): Promise<void> {
  console.log(`R3 targeted live probe → ${BASE_URL} (${RUNS} fresh runs)`)
  const cookie = await authenticate()
  console.log('authenticated (dedicated eval account)\n')

  const groundTruth = (() => {
    const proc = Bun.spawnSync(['bun', '-e', R3_SNIPPET])
    return proc.stdout.toString().trim().split('\n').filter(Boolean)
  })()
  console.log(`ground truth (executed): ${groundTruth.join(' ')}\n`)

  const results: ProbeResult['results'] = []
  const outDir = '/home/z/my-project/scripts/giftz-verify-out'
  mkdirSync(outDir, { recursive: true })
  const outFile = `${outDir}/r3-probe-${Date.now()}.json`
  // Incremental save: partial results survive timeouts/interruptions — every
  // completed run is recorded the moment it completes (honest evidence).
  const save = (passedRuns: number) =>
    writeFileSync(outFile, JSON.stringify({ ranAt: new Date().toISOString(), baseUrl: BASE_URL, runs: RUNS, passedRuns, groundTruth, results }, null, 2))
  for (let i = 1; i <= RUNS; i++) {
    process.stdout.write(`run ${i}/${RUNS} … `)
    const turn = await streamTurnWith429Retry(cookie, R3_PROMPT)
    const orderCheckPassed = answerContainsGroundTruth(turn.text, groundTruth)
    const terminalOk = turn.terminal !== null && turn.terminal.done === true
    results.push({
      run: i,
      orderCheckPassed,
      terminalOk,
      durationMs: turn.durationMs,
      claimedOrderLines: claimedOrderLines(turn.text),
      answer: turn.text,
    })
    console.log(`${orderCheckPassed ? 'PASS' : 'FAIL'} (order check) — terminal ${terminalOk ? 'done' : 'ERROR'} — ${(turn.durationMs / 1000).toFixed(1)}s`)
    const passedRuns = results.filter((r) => r.orderCheckPassed).length
    save(passedRuns)
    if (!orderCheckPassed) {
      const expected = groundTruth.join(' ')
      const claimed = claimedOrderLines(turn.text)
        .filter((s) => s.replace(/ /g, '').length >= 6)
        .slice(0, 3)
      console.log(`    expected [${expected}] — claimed like: ${claimed.join(' | ') || '(no long order line)'}`)
    }
    // same pacing discipline as the benchmark runner
    await new Promise((resolve) => setTimeout(resolve, 8_000))
  }

  const passedRuns = results.filter((r) => r.orderCheckPassed).length
  save(passedRuns)
  console.log(`\n==== R3 PROBE: ${passedRuns}/${RUNS} runs matched executed ground truth ====`)
  console.log(`report: ${outFile}`)
}

await main()
