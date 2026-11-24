/**
 * BEAN Intelligence — RIISHE → CODE GIFTZ delegation tools (M37 §3, SERVER ONLY).
 *
 * RIISHE is the universal agent: when a conversation asks for real
 * implementation work, it delegates to the EXISTING CODE GIFTZ engineering
 * workflow — it never rebuilds a coding agent inside RIISHE (brief §4: use
 * the current orchestrator, durable queue, tools and Trust Engine; do not
 * introduce a competing architecture).
 *
 * Delegation properties (all shared with the product's own background
 * submission route, src/app/api/ai/jobs submitGiftz):
 *  - the SAME router preflight gates run (product availability, rate limit,
 *    daily quota, budget guard) — delegation cannot bypass any limit;
 *  - the SAME duplicate-submission guard (an identical active job is refused);
 *  - the SAME per-user active-job cap for the product;
 *  - the SAME durable GenerationJob row + `coding-task` worker executes the
 *    work (runGiftzTurnCore: real diffs, version snapshots, self-verification,
 *    optional restricted-sandbox run) with the SAME Trust receipt recorder;
 *  - file operations stay EXACTLY where they are today: generated files are
 *    applied by the coding turn itself (upsert with real diffs + version
 *    history + rollback), destructive rename/move/delete flows exist ONLY in
 *    the CODE GIFTZ product surface behind their own confirmation gates — a
 *    delegated job can never delete or move project files;
 *  - results are REAL job rows: until the worker finishes, the honest status
 *    is "queued/running" — never a claimed artifact.
 *
 * Approval model: `delegate_coding` is 'explicit' — the server-side
 * permission key (route authority) AND the per-turn capability plan
 * (deterministic detection of an actual implementation request) must BOTH
 * agree before the model may submit anything. `check_coding_job` is a
 * read-only, owner-scoped status probe.
 */

import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { preflight } from '@/lib/router/router'
import { dedupeKeyFor, hasActiveDuplicate } from '@/lib/ai-engine/queue'
import { engineConfig } from '@/lib/ai-engine/config'
import { ACTIVE_STATES } from '@/lib/ai-engine/types'
import { shouldCollapseDuplicateUserMessage } from '@/lib/giftz/retry'
import { recordAudit } from '@/lib/observability/metering'
import type { ToolContext, ToolDescriptor, ToolResult } from './tools/types'

// ⚠️ IMPORT-CYCLE GUARD (same pattern as M36 specialists.ts): `@/lib/jobs/queue`
// must stay a DYNAMIC import. Its static chain is jobs/queue → ai-engine/
// handlers → riishe-chat-handler → orchestrator → tools/builtin-registry →
// THIS module — a static import here re-enters builtin-registry mid-body.
// The dynamic import resolves only when a delegation actually submits.
async function enqueueCodingJob(jobId: string): Promise<void> {
  const { enqueueJob } = await import('@/lib/jobs/queue')
  enqueueJob(jobId)
}

// ---------------------------------------------------------------------------
// delegate_coding — submit a REAL background coding job to CODE GIFTZ
// ---------------------------------------------------------------------------

export interface DelegateCodingInput {
  /** The implementation objective, stated as a complete instruction. */
  objective: string
  /** Optional EXISTING project id (must already belong to the user). */
  projectId?: string
  /** Optional EXISTING project title to reuse (exact, owner-scoped match). */
  projectName?: string
}

const OBJECTIVE_MAX = 8000

export function validateDelegateCodingInput(input: unknown): DelegateCodingInput {
  const rec = (input ?? {}) as Record<string, unknown>
  const objective = typeof rec.objective === 'string' ? rec.objective.trim() : ''
  if (objective.length < 10) {
    throw new Error('State the implementation objective in full (at least 10 characters).')
  }
  if (objective.length > OBJECTIVE_MAX) {
    throw new Error(`The objective must be at most ${OBJECTIVE_MAX} characters.`)
  }
  const out: DelegateCodingInput = { objective }
  if (typeof rec.projectId === 'string' && rec.projectId.length > 0) {
    if (rec.projectId.length > 64) throw new Error('The project id is invalid.')
    out.projectId = rec.projectId
  }
  if (typeof rec.projectName === 'string' && rec.projectName.trim().length > 0) {
    if (rec.projectName.length > 80) throw new Error('The project name must be at most 80 characters.')
    out.projectName = rec.projectName.trim()
  }
  return out
}

/** The honest submit outcome (customer-safe; no backend identities). */
export interface CodingDelegationOutcome {
  ok: boolean
  jobId: string | null
  projectId: string | null
  projectName: string | null
  created: boolean
  reason: string | null
}

export async function submitCodingDelegation(
  userId: string,
  input: DelegateCodingInput,
): Promise<CodingDelegationOutcome> {
  // Same gates as the product route: availability, rate limit, quota, budget.
  // The concurrency slot is released immediately — the background worker
  // holds its own slot, exactly like every product-submitted job.
  const { backend, release } = await preflight(userId, 'code-giftz', 'coding-task')
  release()
  try {
    // Project resolution — owner-scoped. An id or name that does not resolve
    // to the CALLER's own project is an honest refusal (never a 404 leak or a
    // foreign-project write).
    let projectId: string | null = null
    let projectName: string | null = null
    let created = false
    if (input.projectId) {
      const project = await db.codeProject.findUnique({ where: { id: input.projectId } })
      if (!project || project.userId !== userId) {
        return { ok: false, jobId: null, projectId: null, projectName: null, created: false, reason: 'The specified project does not exist (or is not yours).' }
      }
      projectId = project.id
      projectName = project.title
    } else if (input.projectName) {
      const project = await db.codeProject.findFirst({ where: { userId, title: input.projectName } })
      if (project) {
        projectId = project.id
        projectName = project.title
      }
    }
    if (!projectId) {
      const project = await db.codeProject.create({
        data: { userId, title: input.objective.slice(0, 60) },
      })
      projectId = project.id
      projectName = project.title
      created = true
    }

    // Same duplicate guard as the product route: an identical ACTIVE job is
    // refused (double submissions would double-charge the shared account).
    const dedupeKey = dedupeKeyFor(userId, 'code-giftz', 'coding-task', {
      projectId: input.projectId ?? '__new__',
      message: input.objective,
    })
    if (await hasActiveDuplicate(dedupeKey)) {
      return {
        ok: false,
        jobId: null,
        projectId,
        projectName,
        created,
        reason: 'An identical coding job is already queued or running — wait for it to finish before submitting the same objective again.',
      }
    }

    // Same per-user active-job cap as the product route.
    const active = await db.generationJob.count({
      where: { userId, product: 'code-giftz', status: { in: [...ACTIVE_STATES] } },
    })
    if (active >= engineConfig().perUserActiveLimit) {
      return {
        ok: false,
        jobId: null,
        projectId,
        projectName,
        created,
        reason: 'The coding workspace already has the maximum number of jobs in progress. Wait for one to finish before submitting another.',
      }
    }

    // Persist the user's request as a project message with the SAME retry
    // idempotency as the product route (a trailing identical unanswered user
    // row is collapsed, never duplicated).
    const lastMessage = await db.codeMessage.findFirst({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    })
    const collapse = shouldCollapseDuplicateUserMessage(lastMessage, input.objective)
    const userMessage = collapse
      ? null
      : await db.codeMessage.create({
          data: { projectId, role: 'user', content: input.objective },
        })

    const job = await db.generationJob.create({
      data: {
        userId,
        product: 'code-giftz',
        task: 'coding-task',
        capability: 'coding-task',
        status: 'queued',
        backendId: backend.id,
        dedupeKey,
        paramsJson: JSON.stringify({
          message: input.objective,
          projectId,
          userMessageId: userMessage?.id ?? null,
          fileIds: [],
        }),
      },
    })
    await recordAudit({
      actorId: userId,
      action: 'riishe.coding_delegate',
      target: job.id,
      meta: { projectId, created, via: 'riishe-delegation' },
    })
    await enqueueCodingJob(job.id)
    return { ok: true, jobId: job.id, projectId, projectName, created, reason: null }
  } catch (e) {
    // Typed product errors become honest refusals — the model must relay the
    // limitation, never claim the work happened.
    if (e instanceof BeanApiError) {
      return { ok: false, jobId: null, projectId: null, projectName: null, created: false, reason: e.message }
    }
    throw e
  }
}

export const delegateCodingTool: ToolDescriptor<DelegateCodingInput> = {
  name: 'delegate_coding',
  description:
    'Delegate implementation work to the BEAN engineering workspace (CODE GIFTZ): submits a real background ' +
    'coding job that plans, writes and verifies project files with real diffs. Use when the user asks you to ' +
    'build, fix or implement actual code (a page, app, script, feature or repair) as part of the task. ' +
    'Returns the queued job id and project name — the finished files appear in the engineering workspace when ' +
    'the job completes; check progress with check_coding_job and never claim the code is ready before that.',
  permission: 'explicit',
  permissionKey: 'allowCodingDelegation',
  validate: validateDelegateCodingInput,
  timeoutMs: 20_000,
  async execute(input: DelegateCodingInput, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.permissions.has('allowCodingDelegation')) {
      return { ok: false, output: 'Permission denied: coding delegation was not approved for this request.' }
    }
    const userId = ctx.userId
    if (!userId) return { ok: false, output: 'Coding delegation requires an authenticated session.' }
    const outcome = await submitCodingDelegation(userId, input)
    if (!outcome.ok) {
      return { ok: false, output: `The coding job was not submitted: ${outcome.reason}` }
    }
    const where = outcome.created
      ? `A new project "${outcome.projectName}" was created for it`
      : `It runs in your existing project "${outcome.projectName}"`
    return {
      ok: true,
      output:
        `Coding job submitted successfully (job id ${outcome.jobId}, status: queued). ${where}. ` +
        'The engineering workspace is now implementing it in the background: it will prepare the code, apply the ' +
        'file changes with real diffs (versioned, rollback available) and run its configured verification. ' +
        'Poll the status with check_coding_job before telling the user anything about results, and do NOT claim ' +
        'the code is written or tested until the job status says completed.',
    }
  },
}

// ---------------------------------------------------------------------------
// check_coding_job — owner-scoped REAL status probe (read-only)
// ---------------------------------------------------------------------------

export interface CheckCodingJobInput {
  jobId: string
}

export function validateCheckCodingJobInput(input: unknown): CheckCodingJobInput {
  const rec = (input ?? {}) as Record<string, unknown>
  const jobId = typeof rec.jobId === 'string' ? rec.jobId.trim() : ''
  if (jobId.length === 0 || jobId.length > 64) {
    throw new Error('Provide the coding job id returned by delegate_coding.')
  }
  return { jobId }
}

interface CodingJobResultJson {
  projectId?: string
  messageId?: string
  changes?: Array<{ path: string; change: string }>
  contentChars?: number
  versionSeq?: number
  verification?: { status: string; attempts: number; corrections: number; issuesFound: number } | null
  execution?: { status: string; exitCode: number | null; timedOut: boolean; durationMs: number } | null
  executionUnavailable?: string
  durationMs?: number
}

const IN_PROGRESS = new Set(['queued', 'starting', 'running', 'streaming', 'finalizing'])

export async function readCodingJobStatus(
  userId: string,
  jobId: string,
): Promise<ToolResult> {
  const job = await db.generationJob.findFirst({
    where: { id: jobId, userId, product: 'code-giftz', task: 'coding-task' },
  })
  if (!job) {
    return { ok: false, output: 'No coding job with that id exists for this account — check the job id returned by delegate_coding.' }
  }
  if (IN_PROGRESS.has(job.status)) {
    // Trust Engine honesty: when the coding turn is paused in
    // waiting_for_approval (its ledger state), the probe reports that too.
    const trust = await db.trustTask.findFirst({
      where: { jobId: job.id, userId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    })
    const approvalNote = trust?.status === 'waiting_for_approval'
      ? ' The job\u2019s execution receipt shows it is WAITING FOR APPROVAL — a required confirmation has not been given yet.'
      : ''
    return {
      ok: true,
      output:
        `Coding job ${job.id} is still in progress (status: ${job.status}). ` +
        `Do NOT report it as complete.${approvalNote} ` +
        'Tell the user the work is underway and the files will appear in the engineering workspace when it finishes.',
    }
  }
  if (job.status === 'failed') {
    const reason = job.errorMessage?.trim() || job.errorCode || 'unclassified failure'
    return {
      ok: false,
      output: `Coding job ${job.id} FAILED: ${reason.slice(0, 300)}. Report this honestly — no code was delivered.`,
    }
  }
  if (job.status === 'cancelled') {
    return {
      ok: false,
      output: `Coding job ${job.id} was CANCELLED. Report this honestly — no code was delivered.`,
    }
  }
  if (job.status !== 'completed') {
    return {
      ok: false,
      output: `Coding job ${job.id} is in an unexpected state (${job.status}). Report the status honestly instead of assuming success or failure.`,
    }
  }
  let result: CodingJobResultJson = {}
  try {
    result = job.resultJson ? (JSON.parse(job.resultJson) as CodingJobResultJson) : {}
  } catch {
    result = {}
  }
  const project = result.projectId
    ? await db.codeProject.findFirst({ where: { id: result.projectId, userId }, select: { title: true } })
    : null
  const changes = (result.changes ?? []).map((c) => `${c.change} ${c.path}`)
  const verification = result.verification
    ? `self-verification ${result.verification.status} (issues found: ${result.verification.issuesFound}, corrections applied: ${result.verification.corrections})`
    : 'self-verification did not produce a summary for this run'
  const execution = result.execution
    ? ` sandbox run ${result.execution.status} (exit code ${result.execution.exitCode ?? 'n/a'}, ${result.execution.durationMs}ms${result.execution.timedOut ? ', timed out' : ''})`
    : result.executionUnavailable
      ? ` sandbox run did not happen (${result.executionUnavailable.slice(0, 200)})`
      : ' no sandbox run was requested'
  const lines = [
    `Coding job ${job.id} COMPLETED in ${project ? `project "${project.title}"` : 'the engineering workspace'}.`,
    changes.length > 0
      ? `Real file changes: ${changes.join(', ')}. The full diffs and version history are in the project.`
      : 'No files were changed (the turn produced an answer without file changes).',
    `Verification: ${verification}.${execution}`,
    'Report exactly this: the delivered files, the verification evidence above, and where the user can open the project. Do not add results you were not shown.',
  ]
  return { ok: true, output: lines.join(' ') }
}

export const checkCodingJobTool: ToolDescriptor<CheckCodingJobInput> = {
  name: 'check_coding_job',
  description:
    'Check the REAL status of a delegated coding job (read-only, your own jobs only). ' +
    'Input: {"jobId": string}. Returns the actual job state: in progress (or waiting for approval), ' +
    'failed/cancelled with the reason, or completed with the real file changes, verification and sandbox-run ' +
    'evidence. Use after delegate_coding before telling the user anything about results.',
  permission: 'standard',
  validate: validateCheckCodingJobInput,
  timeoutMs: 10_000,
  async execute(input: CheckCodingJobInput, ctx: ToolContext): Promise<ToolResult> {
    const userId = ctx.userId
    if (!userId) return { ok: false, output: 'Coding job status requires an authenticated session.' }
    return readCodingJobStatus(userId, input.jobId)
  },
}

/** Test/ops seam: names of the coding-delegation tools in registration order. */
export const CODING_TOOL_NAMES = ['delegate_coding', 'check_coding_job'] as const
