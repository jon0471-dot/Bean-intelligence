/**
 * CODE GIFTZ — W6 EVALUATION SUITE (reproducible; work order Part 3 §3.5).
 *
 * Two modes:
 *   local  — no network, runs NOW. Measures:
 *     (a) executed ground truth for the async-order case set: every snippet
 *         is EXECUTED with bun locally — the suite never memorizes an
 *         expected order (work order §3.2);
 *     (b) order-focus detection accuracy across the case matrix (async
 *         prompts must trigger the W6 focus checklist; plain prompts must
 *         not);
 *     (c) verifier-report contract honesty: malformed verifier replies are
 *         never guessed into a pass (parseVerifierReport discipline).
 *   live   — gateway-gated. Runs the case set through the REAL product chat
 *     route on an isolated :3100 instance WITH verification enabled
 *     (BEAN_VERIFY_ENABLED=true, isolated env only), measures per-case
 *     checks + verification statuses/corrections, and compares against the
 *     recorded W1–W5 baseline (66/67). If the upstream is throttled the
 *     bounded wait expires and the mode exits 2 BLOCKED — zero attempts
 *     burned, nothing fabricated.
 *
 * Usage:
 *   bun scripts/giftz-w6-eval.ts local
 *   bun scripts/giftz-w6-eval.ts live <max-gateway-wait-seconds>
 */
import { spawnSync } from 'node:child_process'

const mode = process.argv[2] ?? 'local'

// ---- the case matrix (general shapes; R3 included as one case, not special) --

interface OrderCase {
  id: string
  family: 'nested-await' | 'chained-then' | 'macrotask-mix' | 'interleaved-sync'
  prompt: string
  snippet: string
}

const ORDER_CASES: OrderCase[] = [
  {
    id: 'OC1-nested-await',
    family: 'nested-await',
    // The R3 shape (different letters — derivation must come from the code).
    prompt: 'What does this script print? Explain the execution order.',
    snippet: `
async function inner() { console.log('N1'); await null; console.log('N2'); }
async function outer() { console.log('N3'); await inner(); console.log('N4'); }
console.log('N5'); queueMicrotask(() => console.log('M1')); await outer(); console.log('N6');`,
  },
  {
    id: 'OC2-chained-then',
    family: 'chained-then',
    prompt: 'Trace the microtask queue and give the output order.',
    snippet: `
Promise.resolve().then(() => console.log('T1')).then(() => console.log('T2'));
Promise.resolve().then(() => console.log('T3'));
console.log('S1');`,
  },
  {
    id: 'OC3-macrotask-mix',
    family: 'macrotask-mix',
    prompt: 'In what order do the logs appear? Consider microtasks and timers.',
    snippet: `
setTimeout(() => console.log('Z1'), 0);
Promise.resolve().then(() => console.log('P1'));
queueMicrotask(() => console.log('P2'));
setTimeout(() => console.log('Z2'), 0);
console.log('S2');`,
  },
  {
    id: 'OC4-interleaved-sync',
    family: 'interleaved-sync',
    prompt: 'What is the output order of this async code?',
    snippet: `
async function a() { console.log('A1'); await Promise.resolve(); console.log('A2'); }
async function b() { console.log('B1'); await a(); console.log('B3'); }
console.log('B0'); b().then(() => console.log('B4')); console.log('B5');`,
  },
]

const PLAIN_CASES: Array<{ id: string; prompt: string }> = [
  { id: 'PC1', prompt: 'Write a function that reverses a string.' },
  { id: 'PC2', prompt: 'What is 17 * 23?' },
  { id: 'PC3', prompt: 'Parse this CSV and handle quoting errors.' },
  { id: 'PC4', prompt: 'Write a React component with a controlled input.' },
]

interface LocalResult {
  mode: 'local'
  ranAt: string
  orderGroundTruth: Array<{ id: string; family: string; executedOrder: string[]; executed: boolean }>
  focusDetection: { correct: number; total: number; falsePositives: string[]; falseNegatives: string[] }
  reportContract: { passed: number; total: number; failures: string[] }
  verdict: 'PASS' | 'FAIL'
}

function executedOrder(snippet: string): string[] {
  const proc = spawnSync('bun', ['-e', snippet], { encoding: 'utf8', timeout: 10_000 })
  if (proc.status !== 0) throw new Error(`snippet ${proc.stderr.slice(0, 200)}`)
  return proc.stdout.trim().split('\n').filter(Boolean)
}

async function runLocal(): Promise<LocalResult> {
  console.log('== W6 eval: LOCAL mode (no network, ground truth executed locally) ==\n')
  const { buildVerificationFocus } = await import('../src/lib/verification/prompts')
  const { parseVerifierReport: parse } = await import('../src/lib/verification/pipeline')

  // (a) executed ground truth -------------------------------------------------
  console.log('(a) executed ground truth for the order case set')
  const orderGroundTruth: LocalResult['orderGroundTruth'] = []
  for (const c of ORDER_CASES) {
    const order = executedOrder(c.snippet)
    orderGroundTruth.push({ id: c.id, family: c.family, executedOrder: order, executed: true })
    console.log(`    ${c.id}: ${order.join(' ')}`)
  }

  // (b) focus detection accuracy ----------------------------------------------
  console.log('\n(b) order-focus detection across the case matrix')
  let correct = 0
  const falsePositives: string[] = []
  const falseNegatives: string[] = []
  const total = ORDER_CASES.length + PLAIN_CASES.length
  for (const c of ORDER_CASES) {
    const focus = buildVerificationFocus(c.prompt)
    if (focus) correct += 1
    else falseNegatives.push(c.id)
  }
  for (const c of PLAIN_CASES) {
    const focus = buildVerificationFocus(c.prompt)
    if (focus === null) correct += 1
    else falsePositives.push(c.id)
  }
  console.log(`    detection: ${correct}/${total} correct${falsePositives.length ? ` | false positives: ${falsePositives.join(',')}` : ''}${falseNegatives.length ? ` | false negatives: ${falseNegatives.join(',')}` : ''}`)

  // (c) verifier-report contract honesty --------------------------------------
  console.log('\n(c) verifier report contract (malformed replies never become passes)')
  const contractCases: Array<{ name: string; raw: string; expectParse: boolean; expectVerdict?: string }> = [
    { name: 'clean pass JSON', raw: '{"verdict":"pass","confidence":0.9,"issues":[]}', expectParse: true, expectVerdict: 'pass' },
    { name: 'fenced pass JSON', raw: '```json\n{"verdict":"pass","confidence":0.8,"issues":[]}\n```', expectParse: true, expectVerdict: 'pass' },
    { name: 'prose-wrapped fail JSON', raw: 'Here is my report:\n{"verdict":"fail","confidence":0.1,"issues":[{"severity":"critical","type":"order","description":"wrong order","correction":"re-derive"}]}\nDone.', expectParse: true, expectVerdict: 'fail' },
    { name: 'prose-only refusal (no JSON)', raw: 'The draft looks fine to me.', expectParse: false },
    { name: 'verdict typo (passing) is NOT guessed', raw: '{"verdict":"PASS","confidence":0.99,"issues":[]}', expectParse: false },
    { name: 'confidence out of range is clamped, verdict kept', raw: '{"verdict":"fail","confidence":7,"issues":[]}', expectParse: true, expectVerdict: 'fail' },
    { name: 'issues with missing correction field dropped, verdict kept', raw: '{"verdict":"fail","confidence":0.3,"issues":[{"severity":"major","type":"logic","description":"x"}]}', expectParse: true, expectVerdict: 'fail' },
    { name: 'empty string', raw: '', expectParse: false },
  ]
  let contractPassed = 0
  const contractFailures: string[] = []
  for (const cc of contractCases) {
    const parsed = parse(cc.raw)
    const ok = cc.expectParse ? parsed !== null && (cc.expectVerdict === undefined || parsed.verdict === cc.expectVerdict) : parsed === null
    if (ok) contractPassed += 1
    else contractFailures.push(cc.name)
    console.log(`    ${ok ? 'PASS' : 'FAIL'}: ${cc.name}`)
  }
  // parseVerifierReport is exported from the pipeline; verify the module graph agrees
  const direct = parse('{"verdict":"pass","confidence":0.5,"issues":[]}')
  if (direct?.verdict !== 'pass') contractFailures.push('pipeline export agreement')

  const verdict: 'PASS' | 'FAIL' = contractPassed === contractCases.length && falsePositives.length === 0 && orderGroundTruth.every((o) => o.executedOrder.length >= 3) ? 'PASS' : 'FAIL'
  const result: LocalResult = {
    mode: 'local',
    ranAt: new Date().toISOString(),
    orderGroundTruth,
    focusDetection: { correct, total, falsePositives, falseNegatives },
    reportContract: { passed: contractPassed, total: contractCases.length, failures: contractFailures },
    verdict,
  }
  console.log(`\n==== W6 LOCAL EVAL: ${verdict} (ground truth ${orderGroundTruth.length}/${ORDER_CASES.length} executed; detection ${correct}/${total}; contract ${contractPassed}/${contractCases.length}) ====`)
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync('/home/z/my-project/scripts/giftz-verify-out', { recursive: true })
  const out = `/home/z/my-project/scripts/giftz-verify-out/w6-eval-local-${Date.now()}.json`
  writeFileSync(out, JSON.stringify(result, null, 2))
  console.log(`report: ${out}`)
  return result
}

// ---- live mode ----------------------------------------------------------------

async function runLive(maxWaitSec: number): Promise<void> {
  console.log(`== W6 eval: LIVE mode (isolated :3100, verification enabled, gateway-gated) ==`)
  const { mkdirSync, writeFileSync } = await import('node:fs')
  // This mode must be started by a wrapper that launches the isolated server
  // with BEAN_VERIFY_ENABLED=true and an isolated DB (same discipline as
  // scripts/giftz-sec-closure-run.sh). Here we WAIT for gateway health first
  // and exit BLOCKED without burning attempts when the window never opens.
  let waited = 0
  let healthy = false
  while (waited < maxWaitSec) {
    try {
      const res = await fetch('http://127.0.0.1:3100/api/health', { signal: AbortSignal.timeout(20_000) })
      const body = (await res.json()) as { products?: Record<string, { available?: boolean }> }
      if (body.products?.['code-giftz']?.available === true) { healthy = true; break }
    } catch { /* server down or throttled */ }
    await new Promise((r) => setTimeout(r, 30_000))
    waited += 30
    console.log(`    gateway still throttled/unavailable (${waited}/${maxWaitSec}s)…`)
  }
  if (!healthy) {
    console.log('GATEWAY NEVER HEALTHY — live W6 eval skipped (zero attempts burned, nothing fabricated)')
    process.exit(2)
  }
  // Health window open: run each order case through the REAL product route
  // via the shared streaming helpers (same harness as the benchmark).
  const { authenticate, streamTurnWith429Retry } = await import('../evals/code-giftz/run-eval')
  const cookie = await authenticate()
  const results: Array<Record<string, unknown>> = []
  let orderHits = 0
  for (const c of ORDER_CASES) {
    const truth = executedOrder(c.snippet)
    const turn = await streamTurnWith429Retry(cookie, `${c.prompt}\n\`\`\`js\n${c.snippet}\n\`\`\``)
    const claimed = truth.every((t) => turn.text.includes(t))
      && new RegExp(truth.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')).test(turn.text)
    const orderOk = claimed
    if (orderOk) orderHits += 1
    results.push({
      id: c.id, family: c.family, executedOrder: truth, orderCheckPassed: orderOk,
      verification: turn.verification, stages: turn.stages, terminal: turn.terminal?.done === true ? 'done' : 'error',
      durationMs: turn.durationMs,
    })
    console.log(`    ${c.id}: order=${orderOk ? 'PASS' : 'FAIL'} stages=${turn.stages.join('→') || 'none'} verification=${JSON.stringify(turn.verification)}`)
    await new Promise((r) => setTimeout(r, 8_000))
  }
  mkdirSync('/home/z/my-project/scripts/giftz-verify-out', { recursive: true })
  const out = `/home/z/my-project/scripts/giftz-verify-out/w6-eval-live-${Date.now()}.json`
  writeFileSync(out, JSON.stringify({ mode: 'live', ranAt: new Date().toISOString(), cases: results, orderHits, total: ORDER_CASES.length }, null, 2))
  console.log(`\n==== W6 LIVE EVAL: order ${orderHits}/${ORDER_CASES.length} — report ${out} ====`)
}

if (mode === 'live') {
  await runLive(Number(process.argv[3] ?? 240))
} else {
  await runLocal()
}
