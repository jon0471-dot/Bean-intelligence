/**
 * BEAN Intelligence — M33 execution view + receipt tests.
 *
 * Pins the honest result contract: status is DERIVED from the real sandbox
 * result (timeout → timeout, null exit → spawn error, 0 → passed, else →
 * failed), the receipt text frames the output as the REAL process result,
 * and project execution reads the LATEST persisted rows with exact reasons
 * when a run cannot happen.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- fake project file table (the persisted project workspace) ---------------
interface FileRow { id: string; projectId: string; path: string; content: string }
let fileRows: FileRow[] = []
let fileSeq = 0
function resetFiles(): void {
  fileRows = []
  fileSeq = 0
}

mock.module('@/lib/db', () => ({
  db: {
    codeFile: {
      findMany: async ({ where }: { where: { projectId: string } }) =>
        fileRows.filter((r) => r.projectId === where.projectId).map((r) => ({ ...r })),
      findUnique: async ({ where }: { where: { id: string } }) =>
        fileRows.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { content: string } }) => {
        const row = fileRows.find((r) => r.id === where.id)!
        row.content = data.content
        return row
      },
      create: async ({ data }: { data: { projectId: string; path: string; content: string } }) => {
        fileSeq += 1
        const row: FileRow = { id: `cf-${fileSeq}`, ...data }
        fileRows.push(row)
        return row
      },
    },
  },
}))

const { toExecutionView, executionStatusFrom, executeProjectFiles, isExecutionUnavailable, buildExecutionReceipt, buildExecutionUnavailableNote } =
  await import('../../src/lib/giftz/execution')

const baseRun = {
  runId: 'run-1',
  files: [{ path: 'main.js', content: 'console.log(1)' }],
  entry: 'main.js',
  stdout: '1\n',
  stderr: '',
  exitCode: 0 as number | null,
  timedOut: false,
  durationMs: 42,
  isolation: { networkNamespace: true, rlimits: true, processSeparation: true },
}

beforeEach(() => resetFiles())

describe('M33 execution status derivation (from the REAL result only)', () => {
  test('exit 0 without timeout = passed', () => {
    expect(executionStatusFrom({ exitCode: 0, timedOut: false })).toBe('passed')
    expect(toExecutionView({ ...baseRun }).status).toBe('passed')
  })

  test('non-zero exit = failed (displayed as failure, verbatim)', () => {
    expect(executionStatusFrom({ exitCode: 1, timedOut: false })).toBe('failed')
    expect(executionStatusFrom({ exitCode: 2, timedOut: false })).toBe('failed')
    const view = toExecutionView({ ...baseRun, exitCode: 1, stderr: 'Error: boom' })
    expect(view.status).toBe('failed')
    expect(view.stderr).toBe('Error: boom')
  })

  test('timeout = timeout (never passed)', () => {
    expect(executionStatusFrom({ exitCode: null, timedOut: true })).toBe('timeout')
    expect(executionStatusFrom({ exitCode: 0, timedOut: true })).toBe('timeout')
  })

  test('spawn error (null exit, no timeout) = runtime failure', () => {
    const view = toExecutionView({ ...baseRun, exitCode: null, stderr: '\n[sandbox] spawn error: runtime missing' })
    expect(view.status).toBe('spawn-error')
    expect(view.exitCode).toBeNull()
  })

  test('view carries the real runtime/entry/files/isolation fields', () => {
    const view = toExecutionView(baseRun)
    expect(view.entry).toBe('main.js')
    expect(view.runtime).toBe('javascript')
    expect(view.files).toEqual(['main.js'])
    expect(view.isolation).toEqual({ networkNamespace: true, rlimits: true, processSeparation: true })
    expect(view.durationMs).toBe(42)
    const py = toExecutionView({ ...baseRun, files: [{ path: 'fib.py', content: 'print(1)' }], entry: 'fib.py' })
    expect(py.runtime).toBe('python')
  })
})

describe('M33 execution receipt (system-authored, real-result framing)', () => {
  test('labels the output as the REAL process result and includes stdout verbatim', () => {
    const receipt = buildExecutionReceipt(toExecutionView({ ...baseRun, stdout: '120\ntrue\nfalse\n' }))
    expect(receipt).toContain('REAL SANDBOX RESULT')
    expect(receipt).toContain('PASSED')
    expect(receipt).toContain('exit code 0')
    expect(receipt).toContain('120')
    expect(receipt).toContain('true')
    expect(receipt).toContain('Isolation:')
    expect(receipt).toContain('network namespace')
  })

  test('failed runs show FAILED with the real stderr; timeouts show TIMED OUT', () => {
    const failed = buildExecutionReceipt(toExecutionView({ ...baseRun, exitCode: 1, stderr: 'ReferenceError: x is not defined' }))
    expect(failed).toContain('FAILED')
    expect(failed).toContain('ReferenceError')
    const timedOut = buildExecutionReceipt(toExecutionView({ ...baseRun, timedOut: true, exitCode: null }))
    expect(timedOut).toContain('TIMED OUT')
    expect(timedOut).toContain('killed at the wall clock')
  })

  test('no output is stated honestly, never invented', () => {
    const receipt = buildExecutionReceipt(toExecutionView({ ...baseRun, stdout: '', stderr: '' }))
    expect(receipt).toContain('The process produced no output.')
  })

  test('the unavailable note shows the exact reason', () => {
    const note = buildExecutionUnavailableNote('No JavaScript/TypeScript/Python files were found.')
    expect(note).toContain('EXECUTION NOT RUN')
    expect(note).toContain('No JavaScript/TypeScript/Python files were found.')
  })
})

describe('M33 project execution (latest persisted files, exact reasons)', () => {
  test('executes the latest persisted executable files', async () => {
    fileRows.push(
      { id: 'f1', projectId: 'p1', path: 'main.js', content: 'console.log("persisted v2")' },
      { id: 'f2', projectId: 'p1', path: 'notes.md', content: '# not executable' },
    )
    const outcome = await executeProjectFiles('p1')
    expect(isExecutionUnavailable(outcome)).toBe(false)
    if (!isExecutionUnavailable(outcome)) {
      expect(outcome.files).toEqual(['main.js'])
      expect(outcome.status).toBe('passed')
    }
  })

  test('HTML/CSS-only projects: exact unavailable reason, no run', async () => {
    fileRows.push(
      { id: 'f1', projectId: 'p1', path: 'index.html', content: '<p>hi</p>' },
      { id: 'f2', projectId: 'p1', path: 'style.css', content: 'p{}' },
    )
    const outcome = await executeProjectFiles('p1')
    expect(isExecutionUnavailable(outcome)).toBe(true)
    if (isExecutionUnavailable(outcome)) {
      expect(outcome.unavailable).toContain('No JavaScript/TypeScript/Python files')
      expect(outcome.unavailable).toContain('Preview')
    }
  })

  test('>10 executable files: the runner cap is surfaced verbatim, no run', async () => {
    for (let i = 0; i < 12; i += 1) {
      fileRows.push({ id: `f${i}`, projectId: 'p1', path: `mod${i}.js`, content: `// ${i}` })
    }
    const outcome = await executeProjectFiles('p1')
    expect(isExecutionUnavailable(outcome)).toBe(true)
    if (isExecutionUnavailable(outcome)) {
      expect(outcome.unavailable).toContain('12 executable files')
      expect(outcome.unavailable).toContain('at most 10')
    }
  })

  test('projects are isolated: another project\'s files never execute', async () => {
    fileRows.push({ id: 'mine', projectId: 'p1', path: 'main.js', content: 'console.log("mine")' })
    fileRows.push({ id: 'theirs', projectId: 'p2', path: 'main.js', content: 'console.log("theirs")' })
    const outcome = await executeProjectFiles('p1')
    if (!isExecutionUnavailable(outcome)) {
      expect(outcome.files).toEqual(['main.js'])
      // The workspace contained ONLY the owner's file — the real stdout proves it.
      expect(outcome.stdout).toContain('mine')
      expect(outcome.stdout).not.toContain('theirs')
    }
  })
})
