/**
 * BEAN Intelligence — CODE GIFTZ chat-driven sandbox execution (M33).
 *
 * Connects the conversational turn to the EXISTING restricted sandbox runner:
 * when the user's message explicitly asks for execution, the turn loads the
 * LATEST persisted project files (JS/TS/Python) and runs them through
 * `runInSandbox` — the same runner, isolation chain, minimal env and limits
 * as the manual Run button. Every field of the result comes from the REAL
 * process response; nothing here synthesizes output, exit codes or timings.
 *
 * Approval contract (M33): the user's explicit execution instruction IS the
 * approval for the chat path — detection is deterministic
 * (execution-intent.ts) and the run is audit-logged. The manual Run button's
 * explicit `approval: true` route contract is unchanged.
 *
 * SERVER-ONLY.
 */
import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import { runInSandbox, isPythonEntry, type SandboxRunResult, type SandboxIsolationProfile } from '@/lib/sandbox/runner'

/** Executable extensions the sandbox supports (mirrors the project run route). */
const EXECUTABLE_RE = /\.(js|ts|py)$/
/** Hard cap shared with the runner (it throws beyond this). */
const MAX_RUN_FILES = 10

export type GiftzExecutionStatus = 'passed' | 'failed' | 'timeout' | 'spawn-error'

/**
 * The customer-facing execution record. EVERY field is copied from the real
 * `runInSandbox` result — status is DERIVED from the real exit/timeout data,
 * never from generation success or model predictions.
 */
export interface GiftzExecutionView {
  runId: string
  /** The file the runner executed. */
  entry: string
  runtime: 'javascript' | 'python'
  /** Files actually placed in the ephemeral workspace. */
  files: string[]
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  /** Isolation layers actually active for THIS run (never a blanket claim). */
  isolation: SandboxIsolationProfile
  status: GiftzExecutionStatus
}

/**
 * Derive the honest status from the REAL run result:
 *  - timeout (SIGKILL at the wall clock) → 'timeout';
 *  - exitCode null (spawn failure) → 'spawn-error';
 *  - exit 0 without timeout → 'passed';
 *  - anything else → 'failed' (a non-zero exit is a failure, verbatim).
 */
export function executionStatusFrom(result: Pick<SandboxRunResult, 'exitCode' | 'timedOut'>): GiftzExecutionStatus {
  if (result.timedOut) return 'timeout'
  if (result.exitCode === null) return 'spawn-error'
  return result.exitCode === 0 ? 'passed' : 'failed'
}

/** Convert the raw sandbox result into the customer-facing view. */
export function toExecutionView(run: SandboxRunResult): GiftzExecutionView {
  const entry = run.entry ?? run.files[0]?.path ?? 'unknown'
  return {
    runId: run.runId,
    entry,
    runtime: isPythonEntry(entry) ? 'python' : 'javascript',
    files: run.files.map((f) => f.path),
    stdout: run.stdout,
    stderr: run.stderr,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    isolation: run.isolation,
    status: executionStatusFrom(run),
  }
}

/**
 * Why a chat-requested run could not happen. Returned as data (never thrown)
 * so the conversational response can show the EXACT reason.
 */
export interface ExecutionUnavailable {
  unavailable: string
}

export type ExecutionOutcome = GiftzExecutionView | ExecutionUnavailable

export function isExecutionUnavailable(o: ExecutionOutcome): o is ExecutionUnavailable {
  return (o as ExecutionUnavailable).unavailable !== undefined
}

/**
 * Load the LATEST persisted project files and execute them in the sandbox.
 * Reading from the database (not from the raw model output) guarantees the
 * executed bytes are exactly what persistence confirmed. Empty executable
 * set → honest unavailable reason; runner contract violations (e.g. >10
 * files) → the runner's exact message, surfaced verbatim.
 */
export async function executeProjectFiles(projectId: string): Promise<ExecutionOutcome> {
  const rows = await db.codeFile.findMany({ where: { projectId }, orderBy: { path: 'asc' } })
  const files = rows
    .filter((r) => EXECUTABLE_RE.test(r.path))
    .map((r) => ({ path: r.path, content: r.content }))
  if (files.length === 0) {
    return {
      unavailable:
        'No JavaScript/TypeScript/Python files were found in the project, so there is nothing the sandbox can execute. HTML/CSS output can be opened in the Preview panel instead.',
    }
  }
  if (files.length > MAX_RUN_FILES) {
    return {
      unavailable: `This project has ${files.length} executable files but one sandbox run accepts at most ${MAX_RUN_FILES}. Reduce the executable file count or run a targeted subset first.`,
    }
  }
  const run = await runInSandbox(files)
  logger.info('codegiftz.chat_sandbox_run', {
    projectId,
    runId: run.runId,
    entry: run.entry ?? null,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
  })
  return toExecutionView(run)
}

const STATUS_LABEL: Record<GiftzExecutionStatus, string> = {
  passed: 'PASSED',
  failed: 'FAILED',
  timeout: 'TIMED OUT',
  'spawn-error': 'RUNTIME FAILURE',
}

const ISOLATION_LABEL = (i: SandboxIsolationProfile): string => {
  const layers: string[] = []
  if (i.networkNamespace) layers.push('network namespace')
  if (i.rlimits) layers.push('rlimits')
  layers.push('process separation + minimal env')
  return layers.join(' + ')
}

/**
 * The system-authored execution receipt appended to the assistant reply when
 * a requested run really happened. Clearly labeled as the REAL result so it
 * supersedes any model-predicted output the reply may contain. Every number
 * and line comes from the process — nothing is invented here.
 */
export function buildExecutionReceipt(view: GiftzExecutionView): string {
  const lines: string[] = []
  lines.push('────── REAL SANDBOX RESULT (system-authored, from the actual process) ──────')
  lines.push(
    `${STATUS_LABEL[view.status]} · entry ${view.entry} · runtime ${view.runtime} · exit code ${view.exitCode ?? '—'} · ${view.durationMs}ms${view.timedOut ? ' · killed at the wall clock' : ''}`,
  )
  lines.push(`Isolation: ${ISOLATION_LABEL(view.isolation)}`)
  if (view.stdout.trim().length > 0) {
    lines.push('stdout:')
    lines.push('```text')
    lines.push(view.stdout.replace(/\n+$/, ''))
    lines.push('```')
  }
  if (view.stderr.trim().length > 0) {
    lines.push('stderr:')
    lines.push('```text')
    lines.push(view.stderr.replace(/\n+$/, ''))
    lines.push('```')
  }
  if (view.stdout.trim().length === 0 && view.stderr.trim().length === 0) {
    lines.push('The process produced no output.')
  }
  lines.push('────────────────────────────────────────────────────────────────────────────')
  return lines.join('\n')
}

/** Honest note appended when execution was requested but could not happen. */
export function buildExecutionUnavailableNote(reason: string): string {
  return (
    '────── EXECUTION NOT RUN (system-authored) ──────\n' +
    `Execution was requested, but it could not run: ${reason}\n` +
    '──────────────────────────────────────────────────'
  )
}
