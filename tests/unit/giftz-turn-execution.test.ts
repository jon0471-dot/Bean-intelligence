/**
 * BEAN Intelligence — M33 turn-core execution wiring tests.
 *
 * Proves the conversational turn connects generation → persistence → REAL
 * sandbox execution exactly when the user explicitly requested a run:
 *   - "write a function and run it in the sandbox" invokes the runner ONCE
 *     with the latest persisted files and the reply ends with the REAL
 *     result receipt;
 *   - "write a JavaScript function" / "explain this code" never execute;
 *   - an HTML-only project yields the honest unavailable note (never a fake
     success);
 *   - a generation/persistence failure means the runner is never invoked
 *     (no false success is possible).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type { TaskAdapter } from '../../src/lib/adapters/types'

// ---- controlled boundaries ---------------------------------------------------
interface FileRow { id: string; projectId: string; path: string; content: string }
let fileRows: FileRow[] = []
let fileSeq = 0

mock.module('@/lib/db', () => ({
  db: {
    codeFile: {
      findMany: async ({ where }: { where: { projectId: string } }) =>
        fileRows.filter((r) => r.projectId === where.projectId).map((r) => ({ ...r })),
      findUnique: async ({ where }: { where: { id: string } }) => fileRows.find((r) => r.id === where.id) ?? null,
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
    codeProject: { findUnique: async () => ({ id: 'p1', userId: 'user-1' }) },
    codeMessage: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: 'msg-1', ...data }) },
  },
}))

mock.module('@/lib/code/versioning', () => ({
  snapshotProjectVersion: async () => ({ version: { seq: 1 } }),
}))

// The runner is a CONTROLLED SPY here: it records the files it was handed and
// returns a real-shaped result. The runner's own REAL behavior is proven by
// tests/integration/giftz-sandbox-execution.test.ts — this file pins the
// WIRING (who calls it, with what, how often).
const runnerCalls: Array<Array<{ path: string; content: string }>> = []
let runnerResult: Record<string, unknown> = {
  runId: 'run-wire-1',
  files: [],
  entry: 'main.js',
  stdout: 'REAL-STDOUT-MARKER\n',
  stderr: '',
  exitCode: 0,
  timedOut: false,
  durationMs: 33,
  isolation: { networkNamespace: true, rlimits: true, processSeparation: true },
}
mock.module('@/lib/sandbox/runner', () => ({
  runInSandbox: async (files: Array<{ path: string; content: string }>) => {
    runnerCalls.push(files.map((f) => ({ ...f })))
    return { ...runnerResult, files: files.map((f) => ({ ...f })) }
  },
  isPythonEntry: (p: string) => p.endsWith('.py'),
  extractFiles: (out: string) => [],
}))

const { runGiftzTurnCore } = await import('../../src/lib/giftz/turn')

function stubAdapter(content: string): TaskAdapter {
  return {
    backendId: 'stub',
    health: async () => ({ healthy: true, checkedAt: new Date().toISOString(), latencyMs: 1, detail: 'stub' }),
    chat: async () => ({ content, tokensInEst: 1, tokensOutEst: 1, durationMs: 1 }),
    codeTask: async () => ({ content, tokensInEst: 1, tokensOutEst: 1, durationMs: 1 }),
    chatStream: async function* () {
      yield content
    },
  } as TaskAdapter
}

const FENCED = 'Here you go.\n```js path=main.js\nconsole.log("persisted marker");\n```\nDone.'
const verifyCfg = { enabled: false, verificationModel: null, maxInputChars: 1000 } as never

beforeEach(() => {
  fileRows = []
  fileSeq = 0
  runnerCalls.length = 0
  runnerResult = {
    runId: 'run-wire-1',
    files: [],
    entry: 'main.js',
    stdout: 'REAL-STDOUT-MARKER\n',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    durationMs: 33,
    isolation: { networkNamespace: true, rlimits: true, processSeparation: true },
  }
})

async function runTurn(requestText: string) {
  return runGiftzTurnCore({
    requestText,
    userContent: requestText,
    buildTurnMessages: () => [{ role: 'user', content: requestText }],
    adapter: stubAdapter(FENCED),
    backendRequestMs: 1000,
    maxPromptChars: 10_000,
    projectId: 'p1',
    verifyCfg,
  })
}

describe('M33 turn-core execution wiring', () => {
  test('explicit run request: the sandbox runner is invoked ONCE with the persisted files, and the reply ends with the REAL result', async () => {
    const result = await runTurn('Write a JavaScript function and run it in the sandbox.')
    expect(runnerCalls).toHaveLength(1) // exactly one execution — never duplicated
    // Fence extraction keeps the trailing newline (the real persistence contract).
    expect(runnerCalls[0]).toEqual([{ path: 'main.js', content: 'console.log("persisted marker");\n' }])
    expect(result.execution).toBeDefined()
    expect(result.execution!.status).toBe('passed')
    expect(result.execution!.stdout).toContain('REAL-STDOUT-MARKER')
    // The reply carries the system-authored REAL-result receipt (fixes the
    // historical "when you run this you should see…" behavior).
    expect(result.content).toContain('REAL SANDBOX RESULT')
    expect(result.content).toContain('REAL-STDOUT-MARKER')
    expect(result.content).toContain('PASSED')
  })

  test('plain writing request: nothing executes, no execution fields', async () => {
    const result = await runTurn('Write a JavaScript function.')
    expect(runnerCalls).toHaveLength(0)
    expect(result.execution).toBeUndefined()
    expect(result.executionUnavailable).toBeUndefined()
    expect(result.content).not.toContain('REAL SANDBOX RESULT')
  })

  test('explanation request: nothing executes', async () => {
    const result = await runTurn('Explain this code.')
    expect(runnerCalls).toHaveLength(0)
    expect(result.execution).toBeUndefined()
  })

  test('how-do-I questions never execute', async () => {
    const result = await runTurn('How do I run this code locally?')
    expect(runnerCalls).toHaveLength(0)
    expect(result.execution).toBeUndefined()
  })

  test('HTML-only project + explicit run: the honest unavailable reason rides the reply (never a fake success)', async () => {
    // Replace the generated JS with an HTML file so the project has no
    // executable entries.
    const htmlTurn = runGiftzTurnCore({
      requestText: 'Create a small page and run it in the sandbox.',
      userContent: 'page',
      buildTurnMessages: () => [{ role: 'user', content: 'page' }],
      adapter: stubAdapter('Page below.\n```html path=index.html\n<p>hi</p>\n```\nDone.'),
      backendRequestMs: 1000,
      maxPromptChars: 10_000,
      projectId: 'p1',
      verifyCfg,
    })
    const result = await htmlTurn
    expect(runnerCalls).toHaveLength(0) // nothing executable — the runner is never invoked
    expect(result.execution).toBeUndefined()
    expect(result.executionUnavailable).toContain('No JavaScript/TypeScript/Python files')
    expect(result.content).toContain('EXECUTION NOT RUN')
    expect(result.content).toContain('No JavaScript/TypeScript/Python files')
  })

  test('a failed execution is reported verbatim: FAILED status, real stderr, never passed', async () => {
    runnerResult = {
      runId: 'run-wire-2',
      files: [],
      entry: 'main.js',
      stdout: '',
      stderr: 'ReferenceError: boom\n',
      exitCode: 1,
      timedOut: false,
      durationMs: 12,
      isolation: { networkNamespace: false, rlimits: false, processSeparation: true },
    }
    const result = await runTurn('Run this code in the sandbox.')
    expect(result.execution!.status).toBe('failed')
    expect(result.execution!.exitCode).toBe(1)
    expect(result.content).toContain('FAILED')
    expect(result.content).toContain('ReferenceError: boom')
    expect(result.content).not.toContain('PASSED')
  })

  test('a timed-out run is reported as TIMED OUT (never passed)', async () => {
    runnerResult = {
      runId: 'run-wire-3',
      files: [],
      entry: 'main.js',
      stdout: 'partial',
      stderr: '',
      exitCode: null,
      timedOut: true,
      durationMs: 15_000,
      isolation: { networkNamespace: true, rlimits: true, processSeparation: true },
    }
    const result = await runTurn('Run this in the sandbox.')
    expect(result.execution!.status).toBe('timeout')
    expect(result.execution!.timedOut).toBe(true)
    expect(result.content).toContain('TIMED OUT')
    expect(result.content).not.toContain('PASSED')
  })

  test('a spawn failure is reported as a runtime failure (never passed)', async () => {
    runnerResult = {
      runId: 'run-wire-4',
      files: [],
      entry: 'main.js',
      stdout: '',
      stderr: '\n[sandbox] spawn error: runtime missing',
      exitCode: null,
      timedOut: false,
      durationMs: 3,
      isolation: { networkNamespace: false, rlimits: false, processSeparation: true },
    }
    const result = await runTurn('Run it in the sandbox.')
    expect(result.execution!.status).toBe('spawn-error')
    expect(result.content).toContain('RUNTIME FAILURE')
    expect(result.content).not.toContain('PASSED')
  })

  test('generation failure → the runner is never invoked (no false success possible)', async () => {
    let threw = false
    try {
      await runGiftzTurnCore({
        requestText: 'Write a function and run it in the sandbox.',
        userContent: 'x',
        buildTurnMessages: () => [{ role: 'user', content: 'x' }],
        adapter: stubAdapter(''),
        backendRequestMs: 1000,
        maxPromptChars: 10_000,
        projectId: 'p1',
        verifyCfg,
      })
    } catch {
      threw = true // the empty backend response throws BACKEND_FAILURE
    }
    expect(threw).toBe(true)
    expect(runnerCalls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// M33: the SSE wire lifecycle carries the execution story — the 'executing'
// stage frame DURING the run and the REAL execution result on the done frame.
// ---------------------------------------------------------------------------
describe('M33 SSE wire lifecycle — executing stage + real execution on done', () => {
  test('done frame carries execution; executing stage frame is sent while the run is in flight', async () => {
    const { createGiftzChatStream } = await import('../../src/lib/giftz/chat-stream')
    const stream = createGiftzChatStream({
      projectId: 'p1',
      runTurn: async (onEvent) => {
        // REAL streaming order via the shared core: thinking → generation
        // deltas → executing stage (the sandbox run) → the system-authored
        // receipt delta → the result.
        return runGiftzTurnCore({
          requestText: 'Write a JavaScript function and run it in the sandbox.',
          userContent: 'Write a JavaScript function and run it in the sandbox.',
          buildTurnMessages: () => [{ role: 'user' as const, content: 'Write a JavaScript function and run it in the sandbox.' }],
          adapter: stubAdapter(FENCED),
          backendRequestMs: 1000,
          maxPromptChars: 10_000,
          projectId: 'p1',
          verifyCfg,
          onEvent,
        })
      },
      persistAssistant: async (result) => {
        expect(result.execution).toBeDefined()
        expect(result.content).toContain('REAL SANDBOX RESULT')
        return { messageId: 'wire-1' }
      },
      failurePayload: (e) => ({ error: String(e), code: 'BACKEND_FAILURE', partial: true }),
      release: () => {},
      heartbeatMs: 0,
    })

    const reader = (stream as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let raw = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      raw += decoder.decode(value, { stream: true })
    }
    const frames = raw.split('\n\n').filter((f) => f.startsWith('data: ')).map((f) => JSON.parse(f.slice(6)))
    const stages = frames.filter((f) => typeof f.stage === 'string').map((f) => f.stage)
    expect(stages[0]).toBe('thinking')
    expect(stages).toContain('executing') // the REAL run phase is visible to the UI
    // The receipt delta reached the client's streamed buffer too (the chat
    // bubble shows the REAL result, not a prediction).
    const receiptDelta = frames.find((f) => typeof f.delta === 'string' && f.delta.includes('REAL SANDBOX RESULT'))
    expect(receiptDelta).toBeDefined()
    const done = frames.find((f) => f.done === true)
    expect(done).toBeDefined()
    expect(done.execution).toBeDefined()
    expect(done.execution.status).toBe('passed')
    expect(done.execution.stdout).toContain('REAL-STDOUT-MARKER')
    expect(done.messageId).toBe('wire-1')
    // No duplicate-execution risk on the wire: exactly ONE executing stage frame.
    expect(stages.filter((s) => s === 'executing')).toHaveLength(1)
  })
})
