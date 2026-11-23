/**
 * BEAN Intelligence — M33 run-route contract tests (manual Run remains the
 * explicit-approval path; chat execution is additive and does not weaken it).
 *
 * Pins: ownership (IDOR → 404), the `approval: true` literal requirement,
 * completed-status gating, and the fact that the routes still return the
 * REAL sandbox result verbatim.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test'

// ---- controlled session ------------------------------------------------------
interface CtlUser { id: string; email: string; name: string | null; role: 'member' | 'admin' }
const ALICE: CtlUser = { id: 'user-alice', email: 'alice@example.test', name: 'Alice', role: 'member' }
const BOB: CtlUser = { id: 'user-bob', email: 'bob@example.test', name: 'Bob', role: 'member' }
let currentUser: CtlUser | null = ALICE
mock.module('@/lib/auth/session', () => ({
  getSessionUser: async () => currentUser,
  requireUser: async () => {
    const user = await currentUser
    if (!user) {
      const { BeanApiError } = await import('@/lib/api/errors')
      throw new BeanApiError('UNAUTHENTICATED', 'Sign in to use BEAN Intelligence.')
    }
    return user
  },
}))

// ---- in-memory Prisma boundary ------------------------------------------------
interface JobRow { id: string; userId: string; product: string; status: string; resultJson: string | null }
let jobRows: JobRow[] = []
interface ProjectRow { id: string; userId: string }
let projectRows: ProjectRow[] = []
interface CodeFileRow { id: string; projectId: string; path: string; content: string }
let codeFileRows: CodeFileRow[] = []

mock.module('@/lib/db', () => ({
  db: {
    generationJob: {
      findUnique: async ({ where }: { where: { id: string } }) => jobRows.find((j) => j.id === where.id) ?? null,
    },
    codeProject: {
      findUnique: async ({ where }: { where: { id: string } }) => projectRows.find((p) => p.id === where.id) ?? null,
    },
    codeFile: {
      findMany: async ({ where }: { where: { projectId: string } }) =>
        codeFileRows.filter((f) => f.projectId === where.projectId),
    },
  },
}))

// REAL runner (same module the routes use — no mock of the runner here so the
// route → runner contract is exercised end-to-end with actual processes).
mock.module('@/lib/observability/metering', () => ({
  recordUsage: async () => {},
  recordAudit: async (input: { action: string }) => {
    audits.push(input.action)
  },
}))
const audits: string[] = []

const { POST: runTask } = await import('../../src/app/api/code-giftz/run/route')
const { POST: runProject } = await import('../../src/app/api/code-giftz/projects/[id]/run/route')

function postTask(body: unknown): Promise<Response> {
  return runTask(new Request('http://localhost/api/code-giftz/run', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
}

function postProject(id: string, body: unknown): Promise<Response> {
  return runProject(new Request(`http://localhost/api/code-giftz/projects/${id}/run`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  currentUser = ALICE
  jobRows = []
  projectRows = []
  codeFileRows = []
  audits.length = 0
})

describe('M33 run routes — manual Run contract preserved', () => {
  test('task run: owner + completed + approval=true executes the task files', async () => {
    jobRows.push({
      id: 'job-1',
      userId: 'user-alice',
      product: 'code-giftz',
      status: 'completed',
      resultJson: JSON.stringify({ files: [{ path: 'main.js', content: 'console.log("task-ok")' }] }),
    })
    const res = await postTask({ taskId: 'job-1', approval: true })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { run: { exitCode: number; stdout: string } }
    expect(data.run.exitCode).toBe(0)
    expect(data.run.stdout).toContain('task-ok') // REAL process output
    expect(audits).toContain('code-giftz.sandbox_run')
  })

  test('approval literal is REQUIRED (no approval → 400, no execution)', async () => {
    jobRows.push({
      id: 'job-1',
      userId: 'user-alice',
      product: 'code-giftz',
      status: 'completed',
      resultJson: JSON.stringify({ files: [{ path: 'main.js', content: 'console.log("x")' }] }),
    })
    const res = await postTask({ taskId: 'job-1' })
    expect(res.status).toBe(400)
  })

  test('cross-user task run is 404 and the foreign task is never executed', async () => {
    jobRows.push({
      id: 'job-bob',
      userId: 'user-bob',
      product: 'code-giftz',
      status: 'completed',
      resultJson: JSON.stringify({ files: [{ path: 'main.js', content: 'console.log("bob-secret")' }] }),
    })
    const res = await postTask({ taskId: 'job-bob', approval: true })
    expect(res.status).toBe(404)
  })

  test('project run: owner executes the latest persisted project files', async () => {
    projectRows.push({ id: 'p1', userId: 'user-alice' })
    codeFileRows.push(
      { id: 'f1', projectId: 'p1', path: 'main.js', content: 'console.log("project-ok")' },
      { id: 'f2', projectId: 'p1', path: 'index.html', content: '<p>x</p>' },
    )
    const res = await postProject('p1', { approval: true })
    expect(res.status).toBe(200)
    const data = (await res.json()) as { run: { exitCode: number; stdout: string } }
    expect(data.run.exitCode).toBe(0)
    expect(data.run.stdout).toContain('project-ok')
  })

  test('cross-user project run is 404 (IDOR-safe)', async () => {
    projectRows.push({ id: 'p-bob', userId: 'user-bob' })
    codeFileRows.push({ id: 'f1', projectId: 'p-bob', path: 'main.js', content: 'console.log("bob")' })
    const res = await postProject('p-bob', { approval: true })
    expect(res.status).toBe(404)
  })

  test('unauthenticated runs are refused', async () => {
    currentUser = null
    const res = await postTask({ taskId: 'x', approval: true })
    expect(res.status).toBe(401)
  })

  test('non-completed tasks cannot be executed', async () => {
    jobRows.push({ id: 'job-2', userId: 'user-alice', product: 'code-giftz', status: 'running', resultJson: null })
    const res = await postTask({ taskId: 'job-2', approval: true })
    expect(res.status).toBe(400)
  })
})
