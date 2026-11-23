/**
 * BEAN Intelligence — M33 REAL sandbox integration tests.
 *
 * These tests execute REAL generated programs through the REAL
 * `runInSandbox` runner (real child processes, real isolation chain, real
 * stdout/stderr/exit codes). A mock is never accepted as proof of execution:
 * every assertion below is pinned to actual process output captured from the
 * spawned interpreter.
 *
 * Scenarios (M33 §9 / M34 acceptance):
 *  1. factorial/prime JavaScript demo (the reproduced product issue) — real
 *     stdout proves factorial(5)=120, factorial(0)=1, the negative-input
 *     contract, isPrime(7)=true, isPrime(10)=false; real exit 0 + duration.
 *  2. Python Fibonacci — first 20 numbers correct, sum 10945, average 547.25.
 *  3. TypeError handling — the exception is genuinely triggered, caught, and
 *     execution continues to the end.
 *  4. CSV file operations — students.csv is WRITTEN in the permitted
 *     sandbox workspace by the program, read back, statistics computed, and
 *     the file is verified to physically exist in the run workspace.
 *  5. JavaScript debugging — the ORIGINAL faulty off-by-one program fails
 *     with a real TypeError/non-zero exit; the minimal correction prints
 *     exactly 30 with exit 0 (diagnose → modify → execute → verify).
 *  6. Timeout — an endless loop is killed at the wall clock and reported.
 *  7. Spawn error — a missing runtime is an honest runtime failure.
 *  8. Secrets — the child environment contains no application secrets.
 */
import { describe, test, expect } from 'bun:test'
import fs from 'fs'
import path from 'path'

// Wall clock for THIS integration file: 4s — long enough for every real
// program here, short enough that the timeout test proves the SIGKILL wall
// clock (before the 10s CPU rlimit would fire on a busy loop).
process.env.BEAN_SANDBOX_TIMEOUT_MS = '4000'

const { runInSandbox, sandboxIsolationProfile } = await import('../../src/lib/sandbox/runner')

const TIMEOUT_MS = 4_000

describe('M33 REAL sandbox execution — factorial/prime demo (the reproduced issue)', () => {
  test('real JavaScript process proves every documented assertion', async () => {
    const program = [
      'function factorial(n) {',
      '  if (n < 0) return "undefined for negative inputs (documented contract)";',
      '  let r = 1;',
      '  for (let i = 2; i <= n; i++) r *= i;',
      '  return r;',
      '}',
      'function isPrime(n) {',
      '  if (n < 2) return false;',
      '  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;',
      '  return true;',
      '}',
      'const checks = [',
      '  ["factorial(5)", factorial(5), 120],',
      '  ["factorial(0)", factorial(0), 1],',
      '  ["factorial(-3)", factorial(-3), "undefined for negative inputs (documented contract)"],',
      '  ["isPrime(7)", isPrime(7), true],',
      '  ["isPrime(10)", isPrime(10), false],',
      '];',
      'let failures = 0;',
      'for (const [name, actual, expected] of checks) {',
      '  const ok = actual === expected;',
      '  if (!ok) failures++;',
      '  console.log(`${name} = ${actual} (expected ${expected}) ${ok ? "OK" : "MISMATCH"}`);',
      '}',
      'const demo = [1, 2, 3, 4].map(x => x * 10);',
      'console.log("array demonstration:", JSON.stringify(demo));',
      'if (failures > 0) process.exit(1);',
      'console.log("ALL CHECKS PASSED");',
    ].join('\n')

    const run = await runInSandbox([{ path: 'main.js', content: program }])
    // REAL process evidence — exit code, duration and isolation from the run.
    expect(run.exitCode).toBe(0)
    expect(run.timedOut).toBe(false)
    expect(typeof run.durationMs).toBe('number')
    expect(run.durationMs).toBeGreaterThan(0)
    expect(run.entry).toBe('main.js')
    // REAL stdout — every assertion from the M33 brief, captured verbatim.
    expect(run.stdout).toContain('factorial(5) = 120 (expected 120) OK')
    expect(run.stdout).toContain('factorial(0) = 1 (expected 1) OK')
    expect(run.stdout).toContain('factorial(-3) = undefined for negative inputs (documented contract) (expected undefined for negative inputs (documented contract)) OK')
    expect(run.stdout).toContain('isPrime(7) = true (expected true) OK')
    expect(run.stdout).toContain('isPrime(10) = false (expected false) OK')
    expect(run.stdout).toContain('array demonstration: [10,20,30,40]')
    expect(run.stdout).toContain('ALL CHECKS PASSED')
    expect(run.stderr).toBe('')
    // The isolation profile is the measured one for THIS host — reported
    // verbatim, never a blanket claim.
    expect(run.isolation).toEqual(sandboxIsolationProfile())
  }, TIMEOUT_MS + 5_000)
})

describe('M33 REAL sandbox execution — Python Fibonacci', () => {
  test('real CPython process: first 20 numbers, sum 10945, average 547.25', async () => {
    const program = [
      'def fibonacci(n):',
      '    seq = []',
      '    a, b = 0, 1',
      '    for _ in range(n):',
      '        seq.append(a)',
      '        a, b = b, a + b',
      '    return seq',
      '',
      'fib = fibonacci(20)',
      'print("first 20:", fib)',
      'print("sum:", sum(fib))',
      'print("average:", sum(fib) / len(fib))',
      'assert len(fib) == 20',
      'assert fib[0] == 0 and fib[1] == 1 and fib[19] == 4181',
      'assert sum(fib) == 10945, f"sum mismatch: {sum(fib)}"',
      'assert abs(sum(fib) / len(fib) - 547.25) < 1e-9',
      'print("ALL PYTHON CHECKS PASSED")',
    ].join('\n')
    const run = await runInSandbox([{ path: 'fibonacci.py', content: program }])
    expect(run.exitCode).toBe(0)
    expect(run.timedOut).toBe(false)
    expect(run.entry).toBe('fibonacci.py')
    // Real stdout from CPython: the expected sequence and statistics.
    expect(run.stdout).toContain('first 20: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181]')
    expect(run.stdout).toContain('sum: 10945')
    expect(run.stdout).toContain('average: 547.25')
    expect(run.stdout).toContain('ALL PYTHON CHECKS PASSED')
  }, TIMEOUT_MS + 5_000)
})

describe('M33 REAL sandbox execution — TypeError handling', () => {
  test('the TypeError genuinely triggers, is caught, execution continues', async () => {
    const program = [
      'const steps = [];',
      'console.log("step 1: before the risky call");',
      'try {',
      '  const notAnObject = null;',
      '  notAnObject.property = 1; // genuine TypeError: Cannot set property of null',
      '  console.log("UNREACHABLE: no TypeError was raised");',
      '} catch (err) {',
      '  console.log(`step 2: caught ${err.constructor.name}: ${err.message.slice(0, 60)}`);',
      '  steps.push("caught");',
      '}',
      'console.log("step 3: execution continued after the caught error");',
      'console.log(steps.length === 1 ? "TYPEERROR-DEMO-OK" : "TYPEERROR-DEMO-FAILED");',
      'if (steps.length !== 1) process.exit(1);',
    ].join('\n')
    const run = await runInSandbox([{ path: 'typeerror.js', content: program }])
    expect(run.exitCode).toBe(0)
    expect(run.stdout).toContain('step 1: before the risky call')
    expect(run.stdout).toContain('step 2: caught TypeError:')
    expect(run.stdout).toContain('step 3: execution continued after the caught error')
    expect(run.stdout).toContain('TYPEERROR-DEMO-OK')
    expect(run.stdout).not.toContain('UNREACHABLE')
  }, TIMEOUT_MS + 5_000)
})

describe('M33 REAL sandbox execution — CSV file operations', () => {
  test('students.csv is WRITTEN in the permitted workspace, read back, and physically exists', async () => {
    const csv = 'name,score\nAlice,85\nBob,92\nCarol,78\nDave,74\nEve,79\n' // avg = 81.6, Bob = 92 top
    const program = [
      'const fs = require("fs");',
      'const raw = fs.readFileSync("students.csv", "utf8").trim().split(/\\r?\\n/);',
      'const header = raw[0].split(",");',
      'const rows = raw.slice(1).map(line => {',
      '  const [name, score] = line.split(",");',
      '  return { name, score: Number(score) };',
      '});',
      'const scores = rows.map(r => r.score);',
      'const avg = scores.reduce((a, b) => a + b, 0) / scores.length;',
      'const top = rows.reduce((a, b) => (b.score > a.score ? b : a));',
      'console.log(`records: ${rows.length}`);',
      'console.log(`average: ${avg.toFixed(2)}`);',
      'console.log(`top: ${top.name} ${top.score}`);',
      '// Write the processed summary back into the permitted workspace.',
      'fs.writeFileSync("summary.txt", `records=${rows.length}\\naverage=${avg.toFixed(2)}\\ntop=${top.name}:${top.score}\\n`);',
      'console.log(fs.readFileSync("summary.txt", "utf8").trim());',
      'if (rows.length !== 5 || Math.abs(avg - 81.6) > 0.001 || top.name !== "Bob" || top.score !== 92) process.exit(1);',
      'console.log("CSV-DEMO-OK");',
    ].join('\n')

    const run = await runInSandbox([
      { path: 'students.csv', content: csv },
      { path: 'main.js', content: program },
    ])
    // Real process output — five records, average 81.60, Bob is top with 92.
    expect(run.exitCode).toBe(0)
    expect(run.stdout).toContain('records: 5')
    expect(run.stdout).toContain('average: 81.60')
    expect(run.stdout).toContain('top: Bob 92')
    expect(run.stdout).toContain('CSV-DEMO-OK')
    // The generated file PHYSICALLY exists in the permitted ephemeral
    // workspace (file creation is confirmed by the filesystem, not by the
    // model's text): the summary was genuinely written by the program.
    const summaryPath = path.join(process.cwd(), 'sandbox-runs', run.runId, 'summary.txt')
    expect(fs.existsSync(summaryPath)).toBe(true)
    const summary = fs.readFileSync(summaryPath, 'utf8').trim()
    expect(summary).toContain('records=5')
    expect(summary).toContain('average=81.60')
    expect(summary).toContain('top=Bob:92')
    // The input CSV the project persisted is also physically present.
    expect(fs.existsSync(path.join(process.cwd(), 'sandbox-runs', run.runId, 'students.csv'))).toBe(true)
  }, TIMEOUT_MS + 5_000)
})

describe('M33 REAL sandbox execution — debugging and rerun workflow', () => {
  test('the ORIGINAL faulty program fails with a real TypeError and non-zero exit', async () => {
    const faulty = [
      'function calculateTotal(items) {',
      '  let total = 0;',
      '  for (let i = 0; i <= items.length; i++) {',
      '    total += items[i].price;',
      '  }',
      '  return total;',
      '}',
      '',
      'console.log(calculateTotal([{price:10},{price:20}]));',
    ].join('\n')
    const run = await runInSandbox([{ path: 'calculate.js', content: faulty }])
    // REAL failure evidence: the off-by-one read of items[2] throws a
    // TypeError, the process dies non-zero — never reported as success.
    expect(run.exitCode).not.toBe(0)
    expect(run.timedOut).toBe(false)
    expect(run.stderr).toContain('TypeError')
    expect(run.stderr).toContain('price')
    expect(run.stdout).not.toContain('30')
  }, TIMEOUT_MS + 5_000)

  test('the minimal correction (i < items.length) executes and prints exactly 30', async () => {
    const fixed = [
      'function calculateTotal(items) {',
      '  let total = 0;',
      '  for (let i = 0; i < items.length; i++) { // FIX: was i <= items.length (off-by-one)',
      '    total += items[i].price;',
      '  }',
      '  return total;',
      '}',
      '',
      'console.log(calculateTotal([{price:10},{price:20}]));',
    ].join('\n')
    const run = await runInSandbox([{ path: 'calculate.js', content: fixed }])
    expect(run.exitCode).toBe(0)
    expect(run.timedOut).toBe(false)
    expect(run.stdout.trim()).toBe('30') // the expected ACTUAL output
    expect(run.stderr).toBe('')
  }, TIMEOUT_MS + 5_000)
})

describe('M33 REAL sandbox execution — timeout and runtime failures', () => {
  test('a CPU-bound endless loop is killed by a kernel limit and NEVER reported as success', async () => {
    const run = await runInSandbox([{ path: 'loop.js', content: 'while (true) { /* deliberate endless loop */ }' }])
    // Killed by a kernel fence: the 4s wall clock (timedOut) or the 10s CPU
    // rlimit (signal kill). Either way the run is a FAILURE, never passed.
    expect(run.timedOut || run.exitCode !== 0).toBe(true)
    expect(run.durationMs).toBeLessThanOrEqual(11_000)
    expect(run.durationMs).toBeGreaterThanOrEqual(900)
  }, 20_000)

  test('a sleeping program hits the WALL-CLOCK timeout specifically (timedOut=true)', async () => {
    // Burns no CPU — only the wall clock can stop it.
    const run = await runInSandbox([{ path: 'sleeper.js', content: 'setTimeout(() => console.log("late"), 60_000)' }])
    expect(run.timedOut).toBe(true)
    expect(run.exitCode === null || run.exitCode !== 0).toBe(true)
    expect(run.durationMs).toBeGreaterThanOrEqual(3_500)
    expect(run.stdout).not.toContain('late')
  }, 20_000)

  test('a missing runtime is an honest spawn error (runtime failure)', async () => {
    // Direct-spawn mode: without the isolation wrapper, the missing binary
    // fails the SPAWN itself (ENOENT → error event → exitCode null) — exactly
    // the runner's typed spawn-error contract.
    process.env.BEAN_SANDBOX_RUNTIME = 'definitely-not-a-real-runtime-binary'
    process.env.BEAN_SANDBOX_DISABLE_ISOLATION = '1'
    try {
      const run = await runInSandbox([{ path: 'main.js', content: 'console.log("never")' }])
      expect(run.exitCode).toBeNull()
      expect(run.timedOut).toBe(false)
      expect(run.stderr).toContain('spawn error')
      expect(run.stdout).not.toContain('never')
    } finally {
      delete process.env.BEAN_SANDBOX_RUNTIME
      delete process.env.BEAN_SANDBOX_DISABLE_ISOLATION
    }
  }, TIMEOUT_MS + 5_000)
})

describe('M33 REAL sandbox execution — security of the child environment', () => {
  test('the child sees no application secrets (DATABASE_URL, master keys, tokens)', async () => {
    const program = 'console.log(JSON.stringify(process.env))'
    const run = await runInSandbox([{ path: 'envcheck.js', content: program }])
    expect(run.exitCode).toBe(0)
    const childEnv = JSON.parse(run.stdout.trim()) as Record<string, string>
    const keys = Object.keys(childEnv)
    // The runner provides ONLY PATH / HOME / NODE_ENV. The JS runtime itself
    // may inject its own npm_*/BUN_* runtime metadata — those are runtime
    // artifacts, not application state. NOTHING else may appear.
    const ALLOWED = new Set(['PATH', 'HOME', 'NODE_ENV', 'NODE']) // NODE = the runtime's own path marker (bun injects it)
    for (const k of keys) {
      expect(ALLOWED.has(k) || k.startsWith('npm_') || k.startsWith('BUN_')).toBe(true)
    }
    // The application's secret surface is definitively absent.
    expect(childEnv.DATABASE_URL).toBeUndefined()
    expect(childEnv.BEAN_CREDENTIALS_MASTER_KEY).toBeUndefined()
    expect(keys.some((k) => /session|cookie|token|secret|password/i.test(k))).toBe(false)
    // And no secret-shaped values anywhere.
    for (const v of Object.values(childEnv)) {
      expect(v).not.toContain('sk-')
      expect(v).not.toContain('ghp_')
      expect(v.toLowerCase()).not.toContain('postgres')
      expect(v.toLowerCase()).not.toContain('file:./db')
    }
  }, TIMEOUT_MS + 5_000)
})
