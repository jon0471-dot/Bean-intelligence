/**
 * BEAN Intelligence — CODE GIFTZ restricted execution sandbox.
 *
 * Isolation model (documented honestly in docs/security/SECURITY.md):
 *  - Generated code NEVER runs inside the Next.js server process.
 *  - Each run gets an ephemeral workspace under sandbox-runs/<id>/ .
 *  - Child process spawns with a minimal environment (no secrets, no
 *    DATABASE_URL, no cookies), cwd locked to the workspace.
 *  - Hard wall-clock timeout with SIGKILL; stdout/stderr capped.
 *  - Execution happens ONLY after explicit user approval per task
 *    ("Run in sandbox" action) — never automatically on generation.
 *
 * Known limitation (recorded, not hidden): process-level isolation does not
 * provide kernel-level filesystem/network confinement. Production should
 * run this step in a container/gVisor-style sandbox. The capability claim
 * in the UI says "restricted sandbox", never "fully isolated VM".
 */
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { HealthReport } from '@/lib/adapters/types'

const SANDBOX_ROOT = path.join(process.cwd(), 'sandbox-runs')
const TIMEOUT_MS = 15_000
const MAX_OUTPUT_BYTES = 64_000

export interface SandboxFile {
  path: string
  content: string
}

export interface SandboxRunResult {
  runId: string
  files: SandboxFile[]
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
}

/** Only safe relative paths inside the workspace are allowed. */
export function assertSafeRelativePath(p: string): void {
  if (p.includes('..') || path.isAbsolute(p) || p.startsWith('/')) {
    throw new Error(`Unsafe file path rejected: ${p}`)
  }
  if (p.length > 200 || /[^\w.\-/]/.test(p)) {
    throw new Error(`File path contains disallowed characters: ${p}`)
  }
}

/**
 * Extract files from a model response. Expected format (prompted for):
 *   ```lang path=filename.ext
 *   ...code...
 *   ```
 * Fallback: a single unlabeled code block becomes main.<lang>.
 */
export function extractFiles(modelOutput: string): SandboxFile[] {
  const files: SandboxFile[] = []
  const fence = /```([\w+-]*)[ \t]*([^\n]*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = fence.exec(modelOutput)) !== null) {
    const lang = match[1] || ''
    const meta = (match[2] || '').trim()
    const content = match[3]
    const pathMatch = meta.match(/path=([\w.\-/]+)/)
    if (pathMatch) {
      files.push({ path: pathMatch[1], content })
    } else if (files.length === 0 && content.trim().length > 0) {
      const ext =
        { javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', json: 'json' }[
          lang.toLowerCase()
        ] ?? 'js'
      files.push({ path: `main.${ext}`, content })
    }
  }
  return files
}

function pickRuntime(): string {
  // Prefer node for plain JS/TS; bun is the fallback in this environment.
  return process.env.BEAN_SANDBOX_RUNTIME ?? 'bun'
}

function pickPython(): string {
  // System CPython for .py entries. Override with BEAN_SANDBOX_PYTHON when a
  // deployment wants a different interpreter. No server, no download — the
  // interpreter is already present on the host.
  return process.env.BEAN_SANDBOX_PYTHON ?? 'python3'
}

/** True when the entry file must be executed by the Python interpreter. */
export function isPythonEntry(entryPath: string): boolean {
  return entryPath.endsWith('.py')
}

export async function runInSandbox(files: SandboxFile[]): Promise<SandboxRunResult> {
  if (files.length === 0) throw new Error('No executable files were provided.')
  if (files.length > 10) throw new Error('Too many files for a single sandbox run (max 10).')
  for (const f of files) assertSafeRelativePath(f.path)

  const runId = randomUUID()
  const workspace = path.join(SANDBOX_ROOT, runId)
  fs.mkdirSync(workspace, { recursive: true })
  for (const f of files) {
    const dest = path.join(workspace, f.path)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, f.content)
  }

  const entry =
    files.find((f) => f.path === 'main.ts') ??
    files.find((f) => f.path === 'main.js') ??
    files.find((f) => f.path === 'main.py') ??
    files.find((f) => /\.(ts|js)$/.test(f.path)) ??
    files.find((f) => f.path.endsWith('.py')) ??
    files[0]

  const t0 = Date.now()
  const result = await new Promise<Omit<SandboxRunResult, 'runId' | 'files'>>((resolve) => {
    // Python entries run under the system CPython; everything else keeps the
    // existing JS/TS runtime. Same workspace, same minimal env, same timeout.
    const python = isPythonEntry(entry.path)
    const command = python ? pickPython() : pickRuntime()
    const args = python ? [entry.path] : ['run', entry.path]
    const child = spawn(command, args, {
      cwd: workspace,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: workspace,
        // Deliberate minimal env — no secrets, no DATABASE_URL, no cookies.
        NODE_ENV: process.env.NODE_ENV ?? 'production',
      },
      // Explicit tuple so spawn resolves to the piped-stdout/stderr overload.
      stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, TIMEOUT_MS)

    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += d.toString('utf8')
    })
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += d.toString('utf8')
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        stdout,
        stderr: stderr + `\n[sandbox] spawn error: ${err.message}`,
        exitCode: null,
        timedOut,
        durationMs: Date.now() - t0,
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: code, timedOut, durationMs: Date.now() - t0 })
    })
  })

  return { runId, files, ...result }
}

/**
 * CODE GIFTZ sandbox-capability probe (2026-10-29 product-availability audit).
 *
 * The health endpoint previously marked CODE GIFTZ available/unavailable
 * based ONLY on the hosted LLM probe, so a broken sandbox runtime would
 * still render the product fully "Operational" while its isolated-execution
 * capability (a documented part of the product) failed on every run.
 *
 * This probe measures the REAL runtime with a trivial spawn of the same
 * binary and minimal-env contract runInSandbox uses (no files written, no
 * user code involved):
 *   - healthy   -> runtime spawned, exited 0 and produced the marker output;
 *   - unhealthy -> spawn error, non-zero exit, timeout, or wrong output,
 *                  with the measured reason in the detail.
 */
export async function probeSandboxHealth(): Promise<HealthReport> {
  const t0 = Date.now()
  const checkedAt = new Date().toISOString()
  const PROBE_TIMEOUT_MS = 5_000
  const marker = 'sandbox-ok'

  /** Trivial spawn probe of ONE interpreter using the same minimal-env
   *  contract runInSandbox uses (no files written, no user code involved). */
  const probeOneRuntime = (
    label: string,
    command: string,
    args: string[],
  ): Promise<{ ok: boolean; detail: string }> =>
    new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, args, {
        cwd: os.tmpdir(),
        env: {
          PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
          HOME: os.tmpdir(),
          NODE_ENV: process.env.NODE_ENV ?? 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      resolve({ ok: false, detail: `Sandbox runtime "${label}" could not be spawned: ${e instanceof Error ? e.message : String(e)}` })
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (ok: boolean, detail: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, detail })
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, PROBE_TIMEOUT_MS)

    // stdio is explicitly ['ignore','pipe','pipe'], but the ChildProcess
    // typings make the streams nullable — guard honestly instead of asserting.
    if (!child.stdout || !child.stderr) {
      finish(false, `Sandbox runtime "${label}" produced no capturable output streams.`)
      return
    }

    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += d.toString('utf8')
    })
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += d.toString('utf8')
    })
    child.on('error', (err) => {
      finish(false, `Sandbox runtime "${label}" is not usable: ${err.message}`)
    })
    child.on('close', (code) => {
      if (timedOut) {
        finish(false, `Sandbox probe timed out after ${PROBE_TIMEOUT_MS}ms and was killed.`)
        return
      }
      if (code !== 0) {
        finish(false, `Sandbox runtime "${label}" exited with code ${code}. ${stderr.slice(0, 200)}`.trim())
        return
      }
      if (!stdout.includes(marker)) {
        finish(false, `Sandbox runtime "${label}" ran but produced no marker output (stdout: ${JSON.stringify(stdout.slice(0, 100))}).`)
        return
      }
      finish(true, `Sandbox runtime "${label}" executed a trivial script successfully (${Date.now() - t0}ms).`)
    })
  })

  // Both advertised sandbox languages are probed with the REAL interpreters:
  // JS/TS via the JS runtime, Python via the system CPython dispatch.
  const jsOutcome = await probeOneRuntime(
    pickRuntime(),
    pickRuntime(),
    ['-e', `process.stdout.write('${marker}')`],
  )
  const pyOutcome = await probeOneRuntime(pickPython(), pickPython(), [
    '-c',
    `print('${marker}')`,
  ])
  const outcome = jsOutcome.ok && pyOutcome.ok
    ? { ok: true, detail: `${jsOutcome.detail} Python: ${pyOutcome.detail}` }
    : !jsOutcome.ok
      ? jsOutcome
      : pyOutcome

  return {
    healthy: outcome.ok,
    checkedAt,
    latencyMs: Date.now() - t0,
    // Structured failure class (2026-11-04 connectivity audit): a sandbox
    // probe that was killed at the deadline is a TIMEOUT; a runtime that
    // could not spawn/exited nonzero is a backend error of THIS host.
    httpStatus: null,
    failureCategory: outcome.ok
      ? null
      : outcome.detail.includes('timed out after')
        ? ('timeout' as const)
        : ('backend-error' as const),
    detail: outcome.detail,
  }
}

/** Retention hygiene: delete workspaces older than RETENTION_HOURS (default 24). */
export async function cleanupOldRuns(): Promise<number> {
  const hours = parseInt(process.env.BEAN_SANDBOX_RETENTION_HOURS ?? '24', 10)
  const cutoff = Date.now() - hours * 3600_000
  let removed = 0
  if (!fs.existsSync(SANDBOX_ROOT)) return 0
  for (const dir of fs.readdirSync(SANDBOX_ROOT)) {
    const full = path.join(SANDBOX_ROOT, dir)
    try {
      const stat = fs.statSync(full)
      if (stat.mtimeMs < cutoff) {
        fs.rmSync(full, { recursive: true, force: true })
        removed++
      }
    } catch {
      // ignore unreadable entries
    }
  }
  return removed
}
