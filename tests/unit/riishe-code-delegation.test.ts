/**
 * M37 §3 — RIISHE → CODE GIFTZ delegation tests (mocked Prisma boundary;
 * REAL router preflight, REAL queue gates, REAL tool registry).
 *
 * Pinned contracts:
 *  - an explicit implementation request plans the coding delegation (media
 *    and code-execution flags stay independent);
 *  - questions/explanations never plan it (run_code stays the snippet tool);
 *  - the tools enter the model's universe ONLY when the server-side
 *    permission key AND the plan agree (two-key gate, like every specialist);
 *  - a submission runs the REAL preflight gates, the REAL duplicate guard
 *    and the REAL per-user active cap — delegation cannot bypass any limit;
 *  - the project resolution is owner-scoped (a foreign project id is refused);
 *  - the submission is a REAL queued job row (job id), never a claimed artifact;
 *  - BeanApiError refusals (concurrency/quota/budget) become honest ok:false;
 *  - check_coding_job reports REAL job states (in progress, waiting for
 *    approval, failed, cancelled, completed with real file changes) and
 *    refuses foreign jobs;
 *  - registry identity hygiene: no backend ids in any customer-safe output.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'

// ---- in-memory Prisma fake ---------------------------------------------------
const jobRows: Array<Record<string, unknown>> = []
const projectRows: Array<Record<string, unknown>> = []
const messageRows: Array<Record<string, unknown>> = []
const auditRows: Array<Record<string, unknown>> = []
const trustRows: Array<Record<string, unknown>> = []
let activeDuplicate = false
let activeJobCount = 0

function makeRow(prefix: string, data: Record<string, unknown>): Record<string, unknown> {
  return { ...data, id: `${prefix}-${(jobRows.length + 1)}` }
}

const dbFake = {
  generationJob: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = makeRow('job', data)
      jobRows.push(row)
      return row
    },
    count: async () => activeJobCount,
    findFirst: async ({ where }: { where: { id?: string; userId?: string; product?: string; task?: string } }) => {
      return (
        jobRows.find(
          (r) =>
            (!where.id || r.id === where.id) &&
            (!where.userId || r.userId === where.userId) &&
            (!where.product || r.product === where.product) &&
            (!where.task || r.task === where.task),
        ) ?? null
      )
    },
  },
  codeProject: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = makeRow('proj', data)
      projectRows.push(row)
      return row
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      projectRows.find((r) => r.id === where.id) ?? null,
    findFirst: async ({ where }: { where: { userId?: string; title?: string; id?: string } }) =>
      projectRows.find(
        (r) =>
          (!where.userId || r.userId === where.userId) &&
          (!where.title || r.title === where.title) &&
          (!where.id || r.id === where.id),
      ) ?? null,
  },
  codeMessage: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = makeRow('msg', data)
      messageRows.push(row)
      return row
    },
    findFirst: async () => messageRows[messageRows.length - 1] ?? null,
  },
  trustTask: {
    findFirst: async () => trustRows[trustRows.length - 1] ?? null,
  },
  usageRecord: {
    count: async () => 0,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      jobRows.push({ usage: data })
      return data
    },
  },
  auditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      auditRows.push(data)
      return data
    },
  },
  systemSetting: {
    findUnique: async () => null,
  },
}
mock.module('@/lib/db', () => ({ db: dbFake }))
mock.module('@/lib/observability/metering', () => ({
  recordAudit: async (entry: Record<string, unknown>) => {
    auditRows.push(entry)
  },
}))
mock.module('@/lib/jobs/queue', () => ({
  enqueueJob: (jobId: string) => {
    jobRows.push({ enqueued: jobId })
  },
}))
mock.module('@/lib/ai-engine/queue', () => ({
  dedupeKeyFor: (userId: string, product: string, task: string, params: Record<string, unknown>) =>
    `${userId}:${product}:${task}:${JSON.stringify(params)}`,
  hasActiveDuplicate: async () => activeDuplicate,
}))

import { planCapabilities } from '../../src/lib/riishe/capability-plan'
import { selectTools } from '../../src/lib/riishe/orchestrator'
import { executeToolCall, listToolNames } from '../../src/lib/riishe/tools/registry'
import { registerBuiltins } from '../../src/lib/riishe/tools/builtin-registry'
import {
  validateDelegateCodingInput,
  validateCheckCodingJobInput,
  submitCodingDelegation,
} from '../../src/lib/riishe/code-delegation'
import type { ToolContext } from '../../src/lib/riishe/tools/types'

registerBuiltins()

const fullPermissions = new Set([
  'allowCodeExecution',
  'allowImageGeneration',
  'allowVideoCreation',
  'allowSpeechSynthesis',
  'allowCodingDelegation',
])
const noCodingPermissions = new Set([
  'allowCodeExecution',
  'allowImageGeneration',
  'allowVideoCreation',
  'allowSpeechSynthesis',
])

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    permissions: fullPermissions,
    userId: 'user-1',
    documents: new Map(),
    ...overrides,
  }
}

beforeEach(() => {
  jobRows.length = 0
  projectRows.length = 0
  messageRows.length = 0
  auditRows.length = 0
  trustRows.length = 0
  activeDuplicate = false
  activeJobCount = 0
})

describe('capability planning — coding delegation + strict document grounding', () => {
  test('an explicit implementation request plans coding delegation', () => {
    const plan = planCapabilities('Build a landing page for my coffee shop with a contact form', 'general', false)
    expect(plan.codingDelegation).toBe(true)
    expect(plan.imageGeneration).toBe(false)
    expect(plan.videoCreation).toBe(false)
  })

  test('questions and explanations never plan delegation (run_code stays the snippet tool)', () => {
    expect(planCapabilities('How do I build a REST API with Node?', 'coding', false).codingDelegation).toBe(false)
    expect(planCapabilities('What does this function do?', 'coding', false).codingDelegation).toBe(false)
    expect(planCapabilities('Explain how promises work in JavaScript', 'coding', false).codingDelegation).toBe(false)
  })

  test('a fix/repair request plans delegation', () => {
    expect(planCapabilities('Fix the login bug in my checkout flow', 'coding', false).codingDelegation).toBe(true)
  })

  test('media creation requests do NOT plan coding delegation', () => {
    const plan = planCapabilities('Create an image of a lighthouse', 'general', false)
    expect(plan.codingDelegation).toBe(false)
    expect(plan.imageGeneration).toBe(true)
  })

  test('strict document grounding is detected on the exact contract phrases', () => {
    expect(planCapabilities('Based only on the attached documents, what does the report conclude?', 'document', true).docOnlyGrounding).toBe(true)
    expect(planCapabilities('Answer using only the attached files', 'document', true).docOnlyGrounding).toBe(true)
    expect(planCapabilities('What does the report say?', 'document', true).docOnlyGrounding).toBe(false)
  })
})

describe('tool selection — two-key gating for the coding tools', () => {
  test('plan + permission → delegate_coding AND check_coding_job are selected', () => {
    const tools = selectTools({
      searchNeeded: false,
      task: 'general' as 'math',
      hasDocuments: false,
      allowCodeExecution: false,
      researchFailed: false,
      allowCodingDelegation: true,
    })
    expect(tools).toContain('delegate_coding')
    expect(tools).toContain('check_coding_job')
  })

  test('permission without plan → neither tool is selected', () => {
    const tools = selectTools({
      searchNeeded: false,
      task: 'general' as 'math',
      hasDocuments: false,
      allowCodeExecution: false,
      researchFailed: false,
      allowCodingDelegation: false,
    })
    expect(tools).not.toContain('delegate_coding')
    expect(tools).not.toContain('check_coding_job')
  })

  test('the tools are registered in the fixed registry', () => {
    expect(listToolNames()).toContain('delegate_coding')
    expect(listToolNames()).toContain('check_coding_job')
  })
})

describe('delegate_coding — real submission through the product gates', () => {
  test('a valid objective creates a project, persists the message, queues a REAL job and enqueues it', async () => {
    const executed = await executeToolCall(
      { tool: 'delegate_coding', input: { objective: 'Build a portfolio site with three pages and a contact form' } },
      ctx(),
      new Set(['delegate_coding', 'check_coding_job']),
    )
    expect(executed.ok).toBe(true)
    expect(projectRows).toHaveLength(1)
    expect(messageRows).toHaveLength(1)
    const job = jobRows.find((r) => r.product === 'code-giftz') as Record<string, unknown> | undefined
    expect(job).toBeDefined()
    expect(job!['status']).toBe('queued')
    expect(jobRows.some((r) => r.enqueued === job!['id'])).toBe(true)
    const params = JSON.parse(job!['paramsJson'] as string)
    expect(params.projectId).toBe((projectRows[0] as Record<string, unknown>)['id'])
    expect(params.message).toContain('portfolio site')
    expect(executed.output).toContain('queued')
    expect(executed.output).not.toMatch(/ready|completed|tested/i)
    expect(auditRows.some((a) => a.action === 'riishe.coding_delegate')).toBe(true)
  })

  test('an existing project id is reused (owner-scoped); a FOREIGN id is refused', async () => {
    projectRows.push({ id: 'proj-mine', userId: 'user-1', title: 'My project' })
    projectRows.push({ id: 'proj-other', userId: 'user-2', title: 'Not mine' })

    const mine = await submitCodingDelegation('user-1', { objective: 'Add a pricing table section to the site', projectId: 'proj-mine' })
    expect(mine.ok).toBe(true)
    expect(mine.created).toBe(false)
    expect(mine.projectId).toBe('proj-mine')

    const foreign = await submitCodingDelegation('user-1', { objective: 'Add a pricing table section to the site', projectId: 'proj-other' })
    expect(foreign.ok).toBe(false)
    expect(foreign.reason).toMatch(/not exist|not yours/i)
    expect(foreign.jobId).toBeNull()
  })

  test('an existing project NAME is matched owner-scoped', async () => {
    projectRows.push({ id: 'proj-named', userId: 'user-1', title: 'Coffee shop site' })
    const outcome = await submitCodingDelegation('user-1', { objective: 'Add an online ordering page to the site', projectName: 'Coffee shop site' })
    expect(outcome.ok).toBe(true)
    expect(outcome.projectId).toBe('proj-named')
    expect(outcome.created).toBe(false)
  })

  test('an identical ACTIVE job is refused (duplicate guard)', async () => {
    activeDuplicate = true
    const outcome = await submitCodingDelegation('user-1', { objective: 'Build the same thing twice concurrently' })
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toMatch(/already queued or running/i)
  })

  test('the per-user active-job cap is enforced (honest refusal, no queued row)', async () => {
    activeJobCount = 3 // engineConfig().perUserActiveLimit default
    const outcome = await submitCodingDelegation('user-1', { objective: 'Build a fourth concurrent project' })
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toMatch(/maximum number of jobs/i)
    expect(jobRows.filter((r) => r.product === 'code-giftz')).toHaveLength(0)
  })

  test('missing permission → honest denial (never a silent substitution)', async () => {
    const executed = await executeToolCall(
      { tool: 'delegate_coding', input: { objective: 'Build a site without permission' } },
      ctx({ permissions: noCodingPermissions }),
      new Set(['delegate_coding']),
    )
    expect(executed.ok).toBe(false)
    expect(executed.output).toMatch(/Permission denied/)
    expect(jobRows).toHaveLength(0)
  })

  test('missing userId (unauthenticated context) → honest refusal', async () => {
    const executed = await executeToolCall(
      { tool: 'delegate_coding', input: { objective: 'Build a site anonymously' } },
      ctx({ userId: undefined }),
      new Set(['delegate_coding']),
    )
    expect(executed.ok).toBe(false)
    expect(executed.output).toMatch(/authenticated session/i)
  })

  test('input validation: objective bounds and id length', () => {
    expect(() => validateDelegateCodingInput({ objective: 'short' })).toThrow(/at least 10/)
    expect(() => validateDelegateCodingInput({ objective: 'x'.repeat(8001) })).toThrow(/at most 8000/)
    expect(() => validateDelegateCodingInput({ objective: 'A valid objective here', projectId: 'x'.repeat(65) })).toThrow(/invalid/)
    const ok = validateDelegateCodingInput({ objective: 'A valid objective here', projectName: '  My Site  ' })
    expect(ok.projectName).toBe('My Site')
  })

  test('identity hygiene: no backend identities in the customer-safe output', async () => {
    const executed = await executeToolCall(
      { tool: 'delegate_coding', input: { objective: 'Build a small utility library with tests' } },
      ctx(),
      new Set(['delegate_coding']),
    )
    expect(executed.ok).toBe(true)
    for (const forbidden of ['bean-llm', 'backend', 'gpt', 'claude', 'gemini', 'llm-']) {
      expect(executed.output.toLowerCase()).not.toContain(forbidden)
    }
  })
})

describe('check_coding_job — REAL status probe (owner-scoped)', () => {
  function seedJob(fields: Record<string, unknown>): Record<string, unknown> {
    const row = { id: 'job-status-1', userId: 'user-1', product: 'code-giftz', task: 'coding-task', ...fields }
    jobRows.push(row)
    return row
  }

  test('an in-progress job reports honestly (never completed)', async () => {
    seedJob({ status: 'running' })
    const executed = await executeToolCall(
      { tool: 'check_coding_job', input: { jobId: 'job-status-1' } },
      ctx(),
      new Set(['check_coding_job']),
    )
    expect(executed.ok).toBe(true)
    expect(executed.output).toContain('still in progress')
    expect(executed.output).toMatch(/Do NOT report it as complete/)
  })

  test('a job WAITING FOR APPROVAL (trust ledger state) is surfaced verbatim', async () => {
    seedJob({ status: 'running' })
    trustRows.push({ jobId: 'job-status-1', status: 'waiting_for_approval' })
    const executed = await executeToolCall(
      { tool: 'check_coding_job', input: { jobId: 'job-status-1' } },
      ctx(),
      new Set(['check_coding_job']),
    )
    expect(executed.ok).toBe(true)
    expect(executed.output).toContain('WAITING FOR APPROVAL')
  })

  test('a failed job reports the REAL failure reason', async () => {
    seedJob({ status: 'failed', errorCode: 'BACKEND_FAILURE', errorMessage: 'The coding backend returned an empty response.' })
    const executed = await executeToolCall(
      { tool: 'check_coding_job', input: { jobId: 'job-status-1' } },
      ctx(),
      new Set(['check_coding_job']),
    )
    expect(executed.ok).toBe(false)
    expect(executed.output).toContain('FAILED')
    expect(executed.output).toContain('empty response')
  })

  test('a cancelled job reports cancellation honestly', async () => {
    seedJob({ status: 'cancelled' })
    const executed = await executeToolCall(
      { tool: 'check_coding_job', input: { jobId: 'job-status-1' } },
      ctx(),
      new Set(['check_coding_job']),
    )
    expect(executed.ok).toBe(false)
    expect(executed.output).toContain('CANCELLED')
  })

  test('a completed job returns the REAL file changes, verification and execution evidence', async () => {
    seedJob({
      status: 'completed',
      resultJson: JSON.stringify({
        projectId: 'proj-1',
        changes: [
          { path: 'index.html', change: 'added' },
          { path: 'styles.css', change: 'added' },
        ],
        versionSeq: 1,
        verification: { status: 'verified', attempts: 1, corrections: 0, issuesFound: 0 },
        execution: { status: 'passed', exitCode: 0, timedOut: false, durationMs: 120 },
        durationMs: 4200,
      }),
    })
    projectRows.push({ id: 'proj-1', userId: 'user-1', title: 'Landing page' })
    const executed = await executeToolCall(
      { tool: 'check_coding_job', input: { jobId: 'job-status-1' } },
      ctx(),
      new Set(['check_coding_job']),
    )
    expect(executed.ok).toBe(true)
    expect(executed.output).toContain('COMPLETED')
    expect(executed.output).toContain('added index.html')
    expect(executed.output).toContain('added styles.css')
    expect(executed.output).toContain('self-verification verified')
    expect(executed.output).toContain('sandbox run passed')
    expect(executed.output).toContain('Landing page')
    expect(executed.output).not.toContain('app.js')
  })

  test('a completed job with a failed sandbox run reports the FAILURE, not success', async () => {
    seedJob({
      status: 'completed',
      resultJson: JSON.stringify({
        projectId: 'proj-1',
        changes: [{ path: 'main.js', change: 'added' }],
        execution: { status: 'failed', exitCode: 1, timedOut: false, durationMs: 40 },
      }),
    })
    const executed = await executeToolCall(
      { tool: 'check_coding_job', input: { jobId: 'job-status-1' } },
      ctx(),
      new Set(['check_coding_job']),
    )
    expect(executed.ok).toBe(true)
    expect(executed.output).toContain('sandbox run failed')
  })

  test('a FOREIGN job id (other user / other product) is refused', async () => {
    seedJob({ id: 'job-foreign', userId: 'user-2', status: 'completed', product: 'code-giftz', task: 'coding-task' })
    seedJob({ id: 'job-laxii', userId: 'user-1', status: 'completed', product: 'laxii', task: 'image-generation' })
    const foreign = await executeToolCall(
      { tool: 'check_coding_job', input: { jobId: 'job-foreign' } },
      ctx(),
      new Set(['check_coding_job']),
    )
    expect(foreign.ok).toBe(false)
    const wrongProduct = await executeToolCall(
      { tool: 'check_coding_job', input: { jobId: 'job-laxii' } },
      ctx(),
      new Set(['check_coding_job']),
    )
    expect(wrongProduct.ok).toBe(false)
  })

  test('input validation', () => {
    expect(() => validateCheckCodingJobInput({ jobId: '' })).toThrow(/job id/)
    expect(() => validateCheckCodingJobInput({})).toThrow(/job id/)
    expect(validateCheckCodingJobInput({ jobId: 'job-1' }).jobId).toBe('job-1')
  })
})
