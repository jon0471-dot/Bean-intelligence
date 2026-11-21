/**
 * M21 sandbox-workflow check — executes the GENERATED sample-data module of
 * project B through the REAL sandbox runner (runInSandbox), together with a
 * small validator harness entry. Proves the generated code actually runs in
 * the existing sandbox workflow (network namespace + rlimits + wall clock).
 * The React UI itself is outside the sandbox's single-entry contract — that
 * limitation is recorded in the M21 report, not hidden.
 */
import fs from 'fs'
import path from 'path'
import { runInSandbox } from '../../src/lib/sandbox/runner'

const projB = path.join(process.cwd(), 'validation', 'm21', 'projects', 'project-b-dashboard')
const sampleTs = fs.readFileSync(path.join(projB, 'data', 'sample.ts'), 'utf8')

// Validator harness entry (NOT part of the deliverable): imports the generated
// module verbatim and asserts its invariants at runtime.
const harness = `// M21 sandbox harness entry — imports the GENERATED data module verbatim.
import { DATE_RANGES, rowsForRange, kpisForRange, SAMPLE_ROWS, SAMPLE_TREND } from './data/sample'

let failures = 0
const check = (name: string, ok: boolean) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
  if (!ok) failures += 1
}

check('sample rows: 8 regions', SAMPLE_ROWS.length === 8)
check('date ranges: 3 windows', DATE_RANGES.length === 3)
for (const r of DATE_RANGES) {
  const rows = rowsForRange(r.id)
  check('rowsForRange(' + r.id + ') scales all 8 rows', rows.length === 8 && rows.every((x) => x.requests > 0))
  const kpis = kpisForRange(r.id)
  check('kpisForRange(' + r.id + ') yields 4 KPIs', kpis.length === 4 && kpis.every((k) => k.value.length > 0))
}
check('trend: 12 weeks, all positive', SAMPLE_TREND.length === 12 && SAMPLE_TREND.every((t) => t.requestsM > 0))
const statuses = new Set(SAMPLE_ROWS.map((r) => r.status))
check('statuses within enum', [...statuses].every((s) => ['healthy', 'degraded', 'incident'].includes(s)))

console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECKS FAILED')
if (failures > 0) process.exit(1)
`

const result = await runInSandbox([
  { path: 'data/sample.ts', content: sampleTs },
  { path: 'main.ts', content: harness },
])

console.log(JSON.stringify({
  runId: result.runId,
  exitCode: result.exitCode,
  timedOut: result.timedOut,
  durationMs: result.durationMs,
  isolation: result.isolation,
  stdout: result.stdout.split('\n'),
  stderr: result.stderr.slice(0, 400),
}, null, 2))
if (result.exitCode !== 0 || !result.stdout.includes('ALL CHECKS PASSED')) {
  console.error('SANDBOX CHECK FAILED')
  process.exit(1)
}
console.log('SANDBOX CHECK PASSED')
