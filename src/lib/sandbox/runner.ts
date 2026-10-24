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
import path from 'path'

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
    files.find((f) => /\.(ts|js)$/.test(f.path)) ??
    files[0]

  const t0 = Date.now()
  const result = await new Promise<Omit<SandboxRunResult, 'runId' | 'files'>>((resolve) => {
    const child = spawn(pickRuntime(), ['run', entry.path], {
      cwd: workspace,
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: workspace,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
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
