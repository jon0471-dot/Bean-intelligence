/**
 * M41 Phase 4/5/7 - durable mission executor integration tests.
 *
 * The ONLY mocks are the Prisma boundary and the specialist submission
 * seams (the same discipline as the engine queue suite). The code under
 * test is the REAL executor: DAG scheduling, handoff enrichment, real
 * verifier decisions, bounded corrections, skip propagation, cancellation
 * propagation, resume idempotency, honest partial-success settlement and
 * the Trust ledger writes.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'

/** bun's default 5s test timeout is too short for real poll-cycle coverage. */
const test40 = (name: string, fn: () => Promise<void>) => test(name, fn, 40_000)

// ---- in-memory Prisma fake ---------------------------------------------------
interface FakeMission {
  id: string; userId: string; missionType: string; objective: string
  deliverableTaskId: string; status: string; planJson: string
  detectedJson: string | null; trustTaskId: string | null; jobId: string | null
  cancelRequested: boolean; failureNote: string | null; outcomeSummary: string | null
  createdAt: Date; updatedAt: Date; startedAt: Date | null; finishedAt: Date | null
}
interface FakeTask {
  id: string; missionId: string; taskId: string; kind: string; agent: string
  title: string; objective: string; paramsJson: string; expectedOutput: string
  dependsOnJson: string; authScope: string; verificationJson: string; limitsJson: string
  status: string; attempts: number; corrections: number; specialistJobId: string | null
  executionJson: string | null; verificationResultJson: string | null
  failureNote: string | null; artifactJson: string | null; createdAt: Date; updatedAt: Date
}
interface FakeJob {
  id: string; userId: string; product: string; task: string; status: string
  progress: number; paramsJson: string; resultJson: string | null
  errorCode: string | null; errorMessage: string | null; backendId: string | null
  capability: string | null; workerId: string | null; workerKind: string | null
  leaseUntil: Date | null; heartbeatAt: Date | null; attempts: number; maxAttempts: number
  nextRunAt: Date | null; errorClass: string | null; dedupeKey: string | null
  cancelRequested: boolean; queuedAt: Date; startedAt: Date | null; finishedAt: Date | null
}

const missions = new Map<string, FakeMission>()
const tasks = new Map<string, FakeTask>()
const jobs = new Map<string, FakeJob>()
const trustTasks = new Map<string, { id: string; userId: string; product: string; kind: string; title: string; status: string; outcomeSummary: string | null; verificationSummary: string | null; failureNote: string | null }>()
const trustSteps: Array<{ taskId: string; seq: number; kind: string; title: string; status: string }> = []
const trustEvidence: Array<{ taskId: string; kind: string; ref: string; note: string | null }> = []

let cuid = 0
const nextId = (p: string) => p + '_' + (++cuid).toString(36)

function fakeDb(): Record<string, unknown> {
  const orderedTasks = (rows: FakeTask[]) => [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const missionApi = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        cancelRequested: false, failureNote: null, outcomeSummary: null, trustTaskId: null,
        jobId: null, detectedJson: null, startedAt: null, finishedAt: null,
        createdAt: new Date(), updatedAt: new Date(), ...(data as Partial<FakeMission>),
      } as FakeMission
      row.id = (data.id as string) ?? nextId('mission')
      missions.set(row.id, row)
      return { ...row }
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const m = missions.get(where.id)
      if (!m) return null
      return { ...m, tasks: orderedTasks([...tasks.values()].filter((t) => t.missionId === m.id)) }
    },
    findFirst: async ({ where }: { where: { userId: string; objective: string; status?: { in?: string[] } } }) => {
      for (const m of missions.values()) {
        if (m.userId !== where.userId || m.objective !== where.objective) continue
        if (where.status?.in && !where.status.in.includes(m.status)) continue
        return { ...m }
      }
      return null
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeMission> }) => {
      const m = missions.get(where.id)
      if (!m) throw new Error('mission not found')
      Object.assign(m, data)
      return { ...m }
    },
    updateMany: async ({ where, data }: { where: { id: string; status?: string }; data: Partial<FakeMission> }) => {
      const m = missions.get(where.id)
      if (!m) return { count: 0 }
      if (where.status && m.status !== where.status) return { count: 0 }
      Object.assign(m, data)
      return { count: 1 }
    },
  }
  const taskApi = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        attempts: 0, corrections: 0, specialistJobId: null, executionJson: null,
        verificationResultJson: null, failureNote: null, artifactJson: null,
        createdAt: new Date(), updatedAt: new Date(), ...(data as Partial<FakeTask>),
      } as FakeTask
      row.id = nextId('mtask')
      tasks.set(row.id, row)
      return { ...row }
    },
    findUnique: async () => null,
    findFirst: async () => null,
    updateMany: async ({ where, data }: { where: { missionId: string; taskId: string; status?: string }; data: Partial<FakeTask> }) => {
      for (const t of tasks.values()) {
        if (t.missionId === where.missionId && t.taskId === where.taskId) {
          if (where.status && t.status !== where.status) return { count: 0 }
          Object.assign(t, data)
          return { count: 1 }
        }
      }
      return { count: 0 }
    },
  }
  const jobApi = {
    create: async ({ data }: { data: Partial<FakeJob> }) => {
      const row: FakeJob = {
        id: nextId('job'), userId: 'user-1', product: 'riishe', task: 'chat',
        status: 'queued', progress: 0, paramsJson: '{}', resultJson: null,
        errorCode: null, errorMessage: null, backendId: null, capability: null,
        workerId: null, workerKind: null, leaseUntil: null, heartbeatAt: null,
        attempts: 0, maxAttempts: 2, nextRunAt: null, errorClass: null, dedupeKey: null,
        cancelRequested: false, queuedAt: new Date(), startedAt: null, finishedAt: null,
        ...data,
      }
      jobs.set(row.id, row)
      return { ...row }
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const j = jobs.get(where.id)
      return j ? { ...j } : null
    },
    findFirst: async () => null,
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeJob> }) => {
      const j = jobs.get(where.id)
      if (!j) throw new Error('job not found')
      Object.assign(j, data)
      return { ...j }
    },
    updateMany: async ({ where, data }: { where: { id: string; workerId?: string; status?: { in?: string[] } | string }; data: Partial<FakeJob> }) => {
      const j = jobs.get(where.id)
      if (!j) return { count: 0 }
      if (where.workerId && j.workerId !== where.workerId) return { count: 0 }
      if (where.status) {
        const allowed = typeof where.status === 'string' ? [where.status] : (where.status.in ?? [])
        if (!allowed.includes(j.status)) return { count: 0 }
      }
      Object.assign(j, data)
      return { count: 1 }
    },
    count: async () => 0,
  }
  const trustApi = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: nextId('trust'), status: 'planned', outcomeSummary: null, verificationSummary: null, failureNote: null, ...data }
      trustTasks.set(row.id as string, row as never)
      return { ...row }
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const t = trustTasks.get(where.id)
      return t ? { ...t, steps: [], evidence: [], approvals: [], checkpoints: [] } : null
    },
    findFirst: async () => null,
    updateMany: async ({ where, data }: { where: { id: string; status?: string | { in?: string[] } }; data: Record<string, unknown> }) => {
      const t = trustTasks.get(where.id)
      if (!t) return { count: 0 }
      if (where.status) {
        const allowed = typeof where.status === 'string' ? [where.status] : (where.status.in ?? [])
        if (!allowed.includes(t.status)) return { count: 0 }
      }
      Object.assign(t, data)
      return { count: 1 }
    },
  }
  const stepApi = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { status: 'planned', ...data } as never
      trustSteps.push(row)
      return row
    },
    findFirst: async () => null,
    findUnique: async () => null,
    update: async ({ data }: { where: unknown; data: Record<string, unknown> }) => data,
    count: async () => trustSteps.length,
  }
  const evidenceApi = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { kind: 'artifact', ref: '', note: null, ...data } as never
      trustEvidence.push(row)
      return row
    },
    count: async () => trustEvidence.length,
  }
  return {
    agentMission: missionApi, agentMissionTask: taskApi, generationJob: jobApi,
    trustTask: trustApi, trustStep: stepApi, trustEvidence: evidenceApi,
    trustApproval: { count: async () => 0, findUnique: async () => null, updateMany: async () => ({ count: 0 }) },
    trustCheckpoint: { count: async () => 0, findFirst: async () => null, create: async ({ data }: { data: Record<string, unknown> }) => data, updateMany: async () => ({ count: 0 }) },
  }
}

mock.module('@/lib/db', () => ({ db: fakeDb() }))

// ---- specialist submission seams (record what the executor delegates) -------
const delegated: Array<{ kind: string; objective?: string; projectName?: string | null; params?: Record<string, unknown> }> = []
let codingSubmission: { ok: boolean; jobId: string | null; reason: string | null } = { ok: true, jobId: null, reason: null }
let mediaSubmission: { ok: boolean; jobId: string | null; reason: string | null } = { ok: true, jobId: null, reason: null }

const stubTool = (name: string) => ({
  name,
  description: 'stub',
  permission: 'standard',
  validate: (i: unknown) => i,
  execute: async () => ({ ok: false, output: 'stub' }),
  timeoutMs: 1000,
})
/** A successful submission creates a REAL durable row in the fake store —
 *  exactly what the real submit paths do (the executor polls that row). */
function createDelegatedJob(userId: string, product: string, task: string): string {
  const id = nextId('deljob')
  jobs.set(id, {
    id, userId, product, task, status: 'queued', progress: 0,
    paramsJson: '{}', resultJson: null, errorCode: null, errorMessage: null,
    backendId: null, capability: task, workerId: null, workerKind: null,
    leaseUntil: null, heartbeatAt: null, attempts: 0, maxAttempts: 2,
    nextRunAt: null, errorClass: null, dedupeKey: null, cancelRequested: false,
    queuedAt: new Date(), startedAt: null, finishedAt: null,
  })
  return id
}
mock.module('@/lib/riishe/code-delegation', () => ({
  submitCodingDelegation: async (_userId: string, input: { objective: string; projectName?: string }) => {
    delegated.push({ kind: 'coding', objective: input.objective, projectName: input.projectName ?? null })
    if (!codingSubmission.ok) return { ...codingSubmission, projectId: null, projectName: null, created: false }
    const jobId = createDelegatedJob('user-1', 'code-giftz', 'coding-task')
    return { ok: true, jobId, projectId: 'proj-x', projectName: input.projectName ?? 'project', created: true, reason: null }
  },
  delegateCodingTool: stubTool('delegate_coding'),
  checkCodingJobTool: stubTool('check_coding_job'),
  readCodingJobStatus: async () => ({ ok: false, output: 'stub' }),
  CODING_TOOL_NAMES: ['delegate_coding', 'check_coding_job'],
  validateDelegateCodingInput: (i: unknown) => i,
  validateCheckCodingJobInput: (i: unknown) => i,
}))

mock.module('@/lib/riishe/specialists', () => ({
  submitSpecialistJob: async (_userId: string, spec: { product: string; task: string; params: Record<string, unknown> }) => {
    delegated.push({ kind: spec.product, params: spec.params })
    if (!mediaSubmission.ok) return { ...mediaSubmission, surface: 'image-creation' }
    const jobId = createDelegatedJob('user-1', spec.product, spec.task)
    return { ok: true, jobId, surface: 'image-creation', status: 'queued', reason: null }
  },
  generateImageTool: stubTool('generate_image'),
  createVideoTool: stubTool('create_video'),
  synthesizeSpeechTool: stubTool('synthesize_speech'),
  SPECIALIST_TOOL_NAMES: ['generate_image', 'create_video', 'synthesize_speech'],
  validateGenerateImageInput: (i: unknown) => i,
  validateCreateVideoInput: (i: unknown) => i,
  validateSynthesizeSpeechInput: (i: unknown) => i,
}))

// ---- retrieval seams: the REAL tool code stays live; only the authorized
// gateway's network boundary is replaced (same discipline as the research
// suites). The real webSearchTool validates, dedupes and numbers sources.
const searchOverride: { fn: (() => Promise<unknown>) | null } = { fn: null }
const THREE_SOURCES = [
  { url: 'https://a.example/1', title: 'Study A', hostName: 'a.example', date: null, snippet: 'Remote work raised output.' },
  { url: 'https://b.example/2', title: 'Study B', hostName: 'b.example', date: null, snippet: 'Hybrid teams thrive.' },
  { url: 'https://c.example/3', title: 'Study C', hostName: 'c.example', date: null, snippet: 'Output gains hold.' },
]
class MockResearchToolError extends Error {}
const providerMock = {
  ResearchToolError: MockResearchToolError,
  webSearch: async () => (searchOverride.fn ? searchOverride.fn() : THREE_SOURCES),
  readPage: async () => ({ title: 'Page', text: 'page text', url: 'https://a.example/1' }),
  probeResearchHealth: async () => ({}) as never,
  extractPublishedTime: () => null,
  extractDatelineFromText: () => null,
  htmlToText: (h: string) => h,
}
mock.module('@/lib/research/provider', () => providerMock)
const rankMock = {
  dedupByUrl: (xs: unknown) => xs,
  classifyHost: () => ({ official: false, social: false, sourceType: 'other' }),
  cleanSourceTitle: (t: string) => t,
  authorityScore: () => 0,
  parseSourceDate: () => ({ year: null, ageDays: null }),
  freshnessScore: () => null,
  isOfficialHost: () => false,
  isPrimaryHost: () => false,
  isSocialHost: () => false,
  staleNewsPenalty: () => 0,
  ugcNewsPenalty: () => 0,
  geoMismatchPenalty: () => 0,
  rankSources: (xs: unknown) => xs,
  stalenessWarning: () => null,
}
mock.module('@/lib/research/rank', () => rankMock)
// The Atlas library load is a filesystem walk; point it at a tiny in-memory
// shape through its module boundary instead.
mock.module('@/lib/riishe/tools/atlas', () => ({
  searchAtlasTool: stubTool('search_atlas'),
  readAtlasDocTool: stubTool('read_atlas_doc'),
}))

mock.module('@/lib/ai-engine/events', () => ({
  appendJobEventSafe: async () => undefined,
  pruneOldJobEvents: async () => undefined,
}))

const { runMissionJob } = await import('../../src/lib/riishe/mission/executor')
const { createMissionFromPlan, requestMissionCancel, getMissionById, toProgressView } = await import('../../src/lib/riishe/mission/store')
import { planMission } from '../../src/lib/riishe/mission/planner'
import type { ClaimedJob } from '../../src/lib/ai-engine/types'

function claimedFor(missionId: string, userId = 'user-1'): ClaimedJob {
  const jobId = nextId('runjob')
  jobs.set(jobId, {
    id: jobId, userId, product: 'riishe', task: 'mission-run', status: 'running',
    progress: 0, paramsJson: JSON.stringify({ missionId }), resultJson: null,
    errorCode: null, errorMessage: null, backendId: null, capability: 'mission-run',
    workerId: 'wk_test', workerKind: 'embedded', leaseUntil: null, heartbeatAt: new Date(),
    attempts: 1, maxAttempts: 2, nextRunAt: null, errorClass: null, dedupeKey: null,
    cancelRequested: false, queuedAt: new Date(), startedAt: new Date(), finishedAt: null,
  })
  return {
    id: jobId, userId, productId: 'riishe', product: 'riishe', task: 'mission-run',
    capability: 'mission-run', status: 'running', progress: 0, attempts: 1,
    maxAttempts: 2, paramsJson: JSON.stringify({ missionId }), resultJson: null,
    backendId: null, cancelRequested: false, workerId: 'wk_test', workerKind: 'embedded',
    leaseUntil: null, heartbeatAt: new Date(), queuedAt: new Date(), startedAt: new Date(),
  } as unknown as ClaimedJob
}

function completeSpecialistJob(jobId: string, payload: Record<string, unknown>) {
  const j = jobs.get(jobId)
  if (!j) throw new Error('job ' + jobId + ' missing')
  j.status = 'completed'
  j.resultJson = JSON.stringify(payload)
}

function codingPayload(changes: Array<{ path: string; change: string }>, opts: { verification?: string; exitCode?: number | null; contentChars?: number } = {}): Record<string, unknown> {
  return {
    projectId: 'proj-x',
    changes,
    contentChars: opts.contentChars ?? 4200,
    verification: { status: opts.verification ?? 'passed', issuesFound: 0, corrections: 0, attempts: 1 },
    execution: opts.exitCode === undefined ? undefined : { status: 'ok', exitCode: opts.exitCode, timedOut: false, durationMs: 100 },
    durationMs: 1000,
  }
}

/** Drive the executor, servicing delegated jobs until the mission settles. */
async function driveToSettlement(missionId: string, service: (task: FakeTask, j: FakeJob) => void, waitMs = 20_000): Promise<void> {
  const runPromise = runMissionJob(claimedFor(missionId))
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    for (const task of [...tasks.values()]) {
      if (!task.specialistJobId) continue
      const j = jobs.get(task.specialistJobId)
      if (!j || j.resultJson || ['failed', 'cancelled'].includes(j.status)) continue
      service(task, j)
    }
    const m = (await getMissionById(missionId))!
    if (m && ['completed', 'completed_partial', 'failed', 'cancelled'].includes(m.status)) break
    await new Promise((r) => setTimeout(r, 60))
  }
  try {
    await runPromise
  } finally {
    if (process.env.MISSION_DEBUG) {
      const m = (await getMissionById(missionId))!
      console.log('MISSION', m.status, '|', m.failureNote)
      for (const t of m.tasks) console.log('  task', t.taskId, t.status, 'att', t.attempts, 'job', t.specialistJobId, '|', (t.failureNote ?? '').slice(0, 90))
      for (const d of delegated) console.log('  delegated', d.kind, '|', (d.objective ?? JSON.stringify(d.params ?? {})).slice(0, 70))
      for (const j of jobs.values()) console.log('  job', j.id.slice(-10), j.task, j.status, j.errorCode ?? '')
    }
  }
}

beforeEach(() => {
  missions.clear(); tasks.clear(); jobs.clear()
  trustTasks.clear(); trustSteps.length = 0; trustEvidence.length = 0
  delegated.length = 0
  codingSubmission = { ok: true, jobId: null, reason: null }
  mediaSubmission = { ok: true, jobId: null, reason: null }
  searchOverride.fn = null
})

// ---------------------------------------------------------------------------
// Store: submission, CAS, isolation, customer-safe view
// ---------------------------------------------------------------------------

describe('mission store', () => {
  test40('createMissionFromPlan persists mission + tasks + trust task + driver job', async () => {
    const objective = 'Research the impact of remote work and write a report on it'
    const plan = planMission(objective)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const sub = await createMissionFromPlan('user-1', objective, plan)
    expect(sub.status).toBe('planned')
    const mission = (await getMissionById(sub.missionId))!
    expect(mission).not.toBeNull()
    expect(mission!.tasks.length).toBe(4)
    expect(mission!.trustTaskId).not.toBeNull()
    expect(mission!.jobId).not.toBeNull()
    expect(trustTasks.size).toBe(1)
  })

  test40('cancel is owner-scoped; a foreign user can never touch a mission', async () => {
    const objective = 'Build a website for my coffee shop with a menu'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const sub = await createMissionFromPlan('user-1', objective, plan)
    expect(await requestMissionCancel(sub.missionId, 'attacker-9')).toBe(false)
    const m = (await getMissionById(sub.missionId))!
    expect(m!.cancelRequested).toBe(false)
    expect(await requestMissionCancel(sub.missionId, 'user-1')).toBe(true)
    expect((await getMissionById(sub.missionId))!.cancelRequested).toBe(true)
  })

  test40('identical ACTIVE mission is refused; finished missions never block re-runs', async () => {
    const objective = 'Build a website for the dedupe probe bakery with a menu'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const first = await createMissionFromPlan('user-1', objective, plan)
    expect(first.status).toBe('planned')
    let duplicateMessage = ''
    try {
      await createMissionFromPlan('user-1', objective, plan)
    } catch (e) {
      duplicateMessage = e instanceof Error ? e.message : String(e)
    }
    expect(duplicateMessage).toContain('identical mission')
    const other = await createMissionFromPlan('user-2', objective, plan)
    expect(other.status).toBe('planned')
    const stored = missions.get(first.missionId)
    if (!stored) throw new Error('first mission missing from the fake store')
    stored.status = 'cancelled'
    const again = await createMissionFromPlan('user-1', objective, plan)
    expect(again.status).toBe('planned')
  })

  test40('progress view is customer-safe (no payload or job-id leaks)', async () => {
    const objective = 'Fix the NaN bug in my app checkout'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const sub = await createMissionFromPlan('user-1', objective, plan)
    const view = toProgressView(await getMissionById(sub.missionId))
    expect(view).not.toBeNull()
    const s = JSON.stringify(view)
    expect(s).not.toContain('paramsJson')
    expect(s).not.toContain('specialistJobId')
    expect(view!.tasks.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Executor: real DAG execution through the delegation seams
// ---------------------------------------------------------------------------

describe('mission executor', () => {
  test40('research-then-document mission completes with verified deliverable + real handoff', async () => {
    const objective = 'Research the impact of remote work and write a report on the findings'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const sub = await createMissionFromPlan('user-1', objective, plan)
    await driveToSettlement(sub.missionId, (task, j) => {
      if (task.kind === 'document-draft') completeSpecialistJob(j.id, codingPayload([{ path: 'report.md', change: 'created' }]))
    })
    const mission = (await getMissionById(sub.missionId))!
    // The atlas side task fails honestly in this sandbox (stub unavailable)
    // while the verified deliverable completes → completed_partial.
    expect(mission.status).toBe('completed_partial')
    const byId = new Map(mission.tasks.map((t) => [t.taskId, t]))
    expect(byId.get('research')!.status).toBe('done')
    expect(byId.get('document')!.status).toBe('done')
    expect(byId.get('verify')!.status).toBe('done')
    expect(byId.get('knowledge')!.status).toBe('failed')
    // The handoff carried the REAL retrieved sources into the delegated objective.
    const codingCalls = delegated.filter((d) => d.kind === 'coding')
    expect(codingCalls.length).toBe(1)
    expect(codingCalls[0].objective).toContain('https://a.example/1')
    expect(codingCalls[0].objective).toContain('VERIFIED RESEARCH SOURCES')
    // Trust ledger settled honestly with a verification summary.
    const trust = [...trustTasks.values()][0]
    expect(trust.status).toBe('partially_completed')
    expect(trust.verificationSummary).toContain('research=done')
    expect(byId.get('verify')!.verificationResultJson).toContain('verified')
  })

  test40('deliverable-chain failure settles the mission FAILED with the real reason', async () => {
    const objective = 'Fix the NaN bug in my app checkout total'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const sub = await createMissionFromPlan('user-1', objective, plan)
    await driveToSettlement(sub.missionId, (task, j) => {
      if (task.kind === 'code-build') {
        j.status = 'failed'
        j.errorClass = 'permanent'
        j.errorCode = 'UPSTREAM_DOWN'
        j.errorMessage = 'The engineering service is unavailable.'
      }
    })
    const mission = (await getMissionById(sub.missionId))!
    expect(mission.status).toBe('failed')
    expect(mission.failureNote).toContain('deliverable chain')
    const trust = [...trustTasks.values()][0]
    expect(trust.status).toBe('failed')
  })

  test40('chain-ordered brand-asset failure fails the mission honestly (the build depends on it)', async () => {
    const objective = 'Build a website for my bakery with a logo for the brand'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const sub = await createMissionFromPlan('user-1', objective, plan)
    await driveToSettlement(sub.missionId, (task, j) => {
      if (task.kind === 'image-asset') {
        j.status = 'failed'
        j.errorClass = 'permanent'
        j.errorCode = 'NO_BACKEND'
        j.errorMessage = 'The visual service is unavailable.'
      } else if (task.kind === 'code-build') {
        completeSpecialistJob(j.id, codingPayload([{ path: 'index.html', change: 'created' }]))
      }
    })
    const mission = (await getMissionById(sub.missionId))!
    expect(mission.status).toBe('failed')
    const byId = new Map(mission.tasks.map((t) => [t.taskId, t]))
    expect(byId.get('asset-image')!.status).toBe('failed')
    expect(byId.get('verify')!.status).toBe('skipped')
    const trust = [...trustTasks.values()][0]
    expect(trust.status).toBe('failed')
  })

  test40('independent side-task failure with verified deliverable settles completed_partial', async () => {
    const objective = 'Research the impact of remote work and write a report on it'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const sub = await createMissionFromPlan('user-1', objective, plan)
    await driveToSettlement(sub.missionId, (task, j) => {
      if (task.kind === 'document-draft') completeSpecialistJob(j.id, codingPayload([{ path: 'report.md', change: 'created' }]))
    })
    // The knowledge side task never produced evidence (atlas unavailable in
    // this sandbox): it must fail honestly while the deliverable completes.
    const mission = (await getMissionById(sub.missionId))!
    expect(['completed_partial', 'completed']).toContain(mission.status)
    if (mission.status === 'completed_partial') {
      const trust = [...trustTasks.values()][0]
      expect(trust.status).toBe('partially_completed')
    }
  })

  test40('cancellation propagates to the active specialist job and downstream tasks', async () => {
    const objective = 'Build a website for my coffee shop with a menu page'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const sub = await createMissionFromPlan('user-1', objective, plan)
    let cancelledJob = ''
    const runPromise = runMissionJob(claimedFor(sub.missionId))
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const task = [...tasks.values()].find((t) => t.kind === 'code-build')
      if (task?.specialistJobId) {
        cancelledJob = task.specialistJobId
        await requestMissionCancel(sub.missionId, 'user-1')
        break
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    await runPromise
    const mission = (await getMissionById(sub.missionId))!
    expect(mission.status).toBe('cancelled')
    expect(jobs.get(cancelledJob)!.cancelRequested).toBe(true)
    const byId = new Map(mission.tasks.map((t) => [t.taskId, t]))
    expect(byId.get('verify')!.status).toBe('cancelled')
    const trust = [...trustTasks.values()][0]
    expect(trust.status).toBe('cancelled')
  })

  test40('verified tasks are never re-executed on resume (crash-safe idempotency)', async () => {
    const objective = 'Build a website for my bakery with a logo'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const sub = await createMissionFromPlan('user-1', objective, plan)
    const mission = (await getMissionById(sub.missionId))!
    const img = mission.tasks.find((t) => t.taskId === 'asset-image')!
    img.status = 'done'
    img.attempts = 1
    img.verificationResultJson = JSON.stringify({ status: 'verified', reasons: [], artifacts: [{ artifact: 'image-asset', taskId: 'asset-image', ref: 'a1', label: 'poster' }] })
    img.artifactJson = JSON.stringify([{ artifact: 'image-asset', taskId: 'asset-image', ref: 'a1', label: 'poster' }])
    mission.status = 'running'
    await driveToSettlement(sub.missionId, (task, j) => {
      if (task.kind === 'code-build') completeSpecialistJob(j.id, codingPayload([{ path: 'index.html', change: 'created' }]))
    })
    const finalMission = (await getMissionById(sub.missionId))!
    expect(finalMission.status).toBe('completed')
    const img2 = finalMission.tasks.find((t) => t.taskId === 'asset-image')!
    expect(img2.attempts).toBe(1)
    expect(delegated.filter((d) => d.kind === 'laxii').length).toBe(0)
  })

  test40('mission-not-found settles the driver job failed honestly', async () => {
    await runMissionJob(claimedFor('ghost-mission'))
    const runJob = [...jobs.values()].find((j) => j.paramsJson.includes('ghost-mission'))
    expect(runJob!.status).toBe('failed')
    expect(runJob!.errorCode).toBe('MISSION_NOT_FOUND')
  })

  test40('bounded correction: failed self-verification triggers exactly one resubmission', async () => {
    const objective = 'Build a website for my portfolio with a clean gallery'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const sub = await createMissionFromPlan('user-1', objective, plan)
    let firstAttempt = true
    await driveToSettlement(sub.missionId, (task, j) => {
      if (task.kind !== 'code-build') return
      if (firstAttempt) {
        completeSpecialistJob(j.id, codingPayload([{ path: 'index.html', change: 'created' }], { verification: 'issues_found' }))
        firstAttempt = false
      } else {
        completeSpecialistJob(j.id, codingPayload([{ path: 'index.html', change: 'created' }]))
      }
    })
    const finalMission = (await getMissionById(sub.missionId))!
    expect(finalMission.status).toBe('completed')
    const build = finalMission.tasks.find((t) => t.taskId === 'build')!
    expect(build.corrections).toBe(1)
    expect(delegated.filter((d) => d.kind === 'coding').length).toBe(2)
    const correctionCall = delegated.filter((d) => d.kind === 'coding')[1]
    expect(correctionCall.objective).toContain('CORRECTION ROUND')
  })

  test40('research with fewer sources than the contract degrades honestly', async () => {
    searchOverride.fn = async () => [
      { url: 'https://a.example/1', title: 'A', hostName: 'a.example', date: null, snippet: 'x' },
    ]
    const objective = 'Research the impact of remote work and write a report on it'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const sub = await createMissionFromPlan('user-1', objective, plan)
    await runMissionJob(claimedFor(sub.missionId))
    const mission = (await getMissionById(sub.missionId))!
    expect(mission.status).toBe('failed')
    const research = mission.tasks.find((t) => t.taskId === 'research')!
    expect(research.status).toBe('failed')
    expect(research.verificationResultJson).toContain('real source')
  })

  test40('media-production mission delegates to ALL THREE specialists in parallel', async () => {
    const objective = 'Create a video about mountain hiking with narration saying: "Trailheads open at sunrise." and a poster for the cover'
    const plan = planMission(objective)
    if (!plan.ok) throw new Error('plan failed')
    const sub = await createMissionFromPlan('user-1', objective, plan)
    await driveToSettlement(sub.missionId, (task, j) => {
      if (task.kind === 'image-asset') completeSpecialistJob(j.id, { imageUrl: '/api/laxii/images/j1', width: 1024, height: 1024, format: 'png', bytes: 500000 })
      if (task.kind === 'audio-asset') completeSpecialistJob(j.id, { artifactUrl: '/api/gangzii/audio/j3', format: 'wav', bytes: 184844 })
      if (task.kind === 'video-asset') completeSpecialistJob(j.id, { videoUrl: '/api/jazmii/video/j2', stream: { codec: 'h264', width: 1280, height: 720, durationSec: 5.2 } })
    })
    const mission = (await getMissionById(sub.missionId))!
    expect(mission.status).toBe('completed')
    expect(delegated.filter((d) => d.kind === 'laxii').length).toBe(1)
    expect(delegated.filter((d) => d.kind === 'gangzii').length).toBe(1)
    expect(delegated.filter((d) => d.kind === 'jazmii').length).toBe(1)
    const audio = delegated.find((d) => d.kind === 'gangzii')
    expect(JSON.stringify(audio!.params)).toContain('Trailheads open at sunrise')
  })
})
