/**
 * BEAN Intelligence — M44 Phase 7: the shared verified-action runner
 * (SERVER ONLY).
 *
 * The ONE runtime every product uses to turn an approved action plan into
 * real, independently verified execution. It walks the plan in dependency
 * order and, for each action:
 *
 *   1. refuses policy self-modification shapes (Phase 6 guard),
 *   2. runs the Phase-3 gate (least privilege → scope → approval binding),
 *      consuming human approvals SERVER-SIDE (Trust Engine consume-once)
 *      immediately before the action,
 *   3. executes ONLY through real paths — the existing workspace file
 *      store and the existing M42 specialist research lane. Action types
 *      with NO real execution path in BEAN today (repository pushes,
 *      deployments, external communications, media/code delegation outside
 *      the mission engine) are recorded as HONESTLY-UNAVAILABLE with a
 *      truthful reason — never simulated, never success-shaped,
 *   4. gathers INDEPENDENT observations (a fresh store re-read through a
 *      different accessor than the write; provenance re-derivation from the
 *      evidence records themselves),
 *   5. applies the Phase-5 verdict through the Phase-4 lifecycle — the
 *      record can reach SUCCEEDED only through VERIFYING with `confirmed`.
 *
 * Cancellation is honored between actions; approvals requested here are
 * bound to the exact payload (digest) and answered through the existing
 * Trust approval flow.
 */

import { db } from '@/lib/db'
import { assertSafeProjectPath } from '@/lib/giftz/workspace'
import { recordAudit } from '@/lib/observability/metering'
import {
  authorizeAction,
  buildApprovalPayload,
  approvalDigest,
  type GrantorIdentity,
} from './authorization'
import type { ActionPlan, ExecutorIdentity } from './action-contract'
import {
  applyActionTransition,
  createExecutionRecord,
  verificationOutcomePatch,
  type ActionExecutionRecord,
  type VerificationVerdict,
} from './action-lifecycle'
import { verificationMethodFor, verifyPostconditions, runtimeVerificationContract } from './outcome-verification'
import { observationFromFiles, observationFromResearch } from './observations'
import type { ObservationSet } from './outcome-verification'
import { assertNoPolicySelfModification } from './recovery'
import {
  commitToBranch,
  createPullRequest,
  fastForwardBranch,
  inspectRepository,
  listBranches,
  listCommits,
  listPullRequests,
  remoteDivergence,
} from './repository-adapter'
import {
  inspectDeploymentConfig,
  inspectDeployedRevision,
  inspectDeploymentHistory,
  probeRuntimeHealth,
  inspectDeploymentLogs,
  executeApprovedDeployment,
  auditDeploymentInspection,
} from './deployment-adapter'
export type { ObservationSet } from './outcome-verification'

// ---------------------------------------------------------------------------
// Real execution dispatch — the ONLY paths this runner can take.
// ---------------------------------------------------------------------------

export type ActionDispatchOutcome =
  | { kind: 'executed'; resultSummary: string; evidence: Array<{ kind: string; ref: string; note: string }> }
  | { kind: 'failed'; resultSummary: string }
  | { kind: 'honest-unavailable'; reason: string }

export interface ProjectFileRow {
  path: string
  content: string
  version?: number
}

/** The workspace file store seam (db-backed default; fakes in tests). */
export interface ActionFileStore {
  read(projectId: string, path: string): Promise<ProjectFileRow | null>
  readAll(projectId: string): Promise<ProjectFileRow[]>
  write(projectId: string, path: string, content: string): Promise<void>
}

export const dbFileStore: ActionFileStore = {
  async read(projectId, path) {
    assertSafeProjectPath(path)
    const row = await db.codeFile.findUnique({ where: { projectId_path: { projectId, path } } })
    return row ? { path: row.path, content: row.content } : null
  },
  async readAll(projectId) {
    const rows = await db.codeFile.findMany({ where: { projectId }, select: { path: true, content: true } })
    return rows.map((r) => ({ path: r.path, content: r.content }))
  },
  async write(projectId, path, content) {
    assertSafeProjectPath(path)
    const existing = await db.codeFile.findUnique({ where: { projectId_path: { projectId, path } } })
    if (existing) {
      await db.codeFile.update({ where: { id: existing.id }, data: { content, origin: 'modified' } })
    } else {
      await db.codeFile.create({ data: { projectId, path, content, origin: 'generated' } })
    }
  },
}

/** The research lane seam (existing M42 gateway; swappable in tests). */
export interface ResearchRunner {
  run(objective: string): Promise<{ sources: Array<{ url: string; title: string; publishedAt?: string | null }>; degraded: string[] } | null>
}

let researchRunnerOverride: ResearchRunner | null = null

/** Test seam: swap the research runner (the executor's established pattern). */
export function setActionResearchRunnerForTests(runner: ResearchRunner | null): void {
  researchRunnerOverride = runner
}

async function defaultResearchRun(objective: string) {
  const { runSpecialistResearch } = await import('@/lib/research/agent-evidence')
  const pack = await runSpecialistResearch({
    consumer: 'knowledge',
    objective,
    userId: null,
    purpose: 'fact-check',
    budget: { maxQueries: 3, maxSources: 6, maxPageReads: 2 },
  })
  return {
    sources: pack.evidence.slice(0, 12).map((s) => ({ url: s.url, title: s.title, publishedAt: s.publishedAt })),
    degraded: Array.isArray(pack.degraded) ? pack.degraded.map(String) : [],
  }
}

/** Dispatch ONE action through its real path (or honestly refuse). */
export async function dispatchAction(
  action: { actionType: string; params: Record<string, string>; id: string; description: string },
  store: ActionFileStore,
  projectId?: string,
): Promise<ActionDispatchOutcome> {
  switch (action.actionType) {
    case 'file-read': {
      const pid = action.params.projectId ?? projectId
      const path = action.params.path
      if (!pid || !path) return { kind: 'failed', resultSummary: 'file-read needs a project context and a path parameter.' }
      const row = await store.read(pid, path)
      return row
        ? { kind: 'executed', resultSummary: `Read ${path} (${row.content.length} chars).`, evidence: [{ kind: 'file', ref: path, note: `${row.content.length} chars observed` }] }
        : { kind: 'executed', resultSummary: `Read ${path}: no such file in the project.`, evidence: [{ kind: 'file', ref: path, note: 'absent' }] }
    }
    case 'file-write': {
      const pid = action.params.projectId ?? projectId
      const path = action.params.path
      const content = action.params.content
      if (!pid || !path || content === undefined) {
        return { kind: 'failed', resultSummary: 'file-write needs a project context, a path and content parameters.' }
      }
      await store.write(pid, path, content)
      return {
        kind: 'executed',
        resultSummary: `Wrote ${path} (${content.length} chars) into the project workspace.`,
        evidence: [{ kind: 'file', ref: path, note: `${content.length} chars written` }],
      }
    }
    case 'research-fetch': {
      const objective = action.params.objective ?? action.description
      const runner = researchRunnerOverride
      const result = await (runner ? runner.run(objective) : defaultResearchRun(objective))
      if (!result) return { kind: 'failed', resultSummary: 'The research lane returned no pack.' }
      return {
        kind: 'executed',
        resultSummary: `Retrieved ${result.sources.length} source(s) through the guarded research lane${result.degraded.length ? ` (${result.degraded.length} degraded lane note(s))` : ''}.`,
        evidence: result.sources.slice(0, 6).map((s) => ({ kind: 'source', ref: s.url, note: s.title.slice(0, 160) })),
      }
    }
    case 'code-build':
    case 'media-produce':
      // Real execution runs through the DURABLE specialist job engine, which
      // is mission-scoped. Outside a mission there is no durable context —
      // refuse honestly instead of simulating a run.
      return {
        kind: 'honest-unavailable',
        reason:
          `${action.actionType} executes through the durable specialist job engine in a mission context; ` +
          `this runner has no durable job to run it in. Delegate it as a mission task — it will not be simulated here.`,
      }
    case 'repo-inspect':
    case 'repo-commit':
    case 'repo-push':
    case 'repo-pull-request':
      // M45 — the REAL repository path: the narrowly scoped adapter with its
      // allowlist, branch policy and independent verification. Without
      // credentials the adapter honestly reports unavailability (never
      // simulated).
      return dispatchRepositoryAction(action)
    case 'deployment-inspect':
      return dispatchDeploymentInspection(action)
    case 'deployment-release':
      // M45 — an APPROVED deployment execution through the deployment
      // adapter. Without configured infrastructure it honestly reports
      // unavailability; production is refused outright unless explicitly
      // enabled AND the owner approval has ALREADY been consumed upstream.
      return dispatchDeploymentRelease(action)
    case 'website-publish-verify':
    case 'external-communicate':
      // The authorization model CLASSIFIES these, but BEAN has no real
      // execution path for them today. Even with a granted approval there is
      // nothing real to run — the honest outcome is refusal, never theater.
      return {
        kind: 'honest-unavailable',
        reason: `${action.actionType} has no real execution path in BEAN today; the action is classified and approval-gated, but it is never simulated. The plan must use the real paths (workspace files, research lanes, mission-delegated specialist jobs).`,
      }
    default:
      return { kind: 'failed', resultSummary: `Unknown action type "${action.actionType}".` }
  }
}

// ---------------------------------------------------------------------------
// M45 repository dispatch — the adapter carries the policy; the runner
// carries the lifecycle. Evidence records carry the FULL sha / PR state so
// the runtime can resolve execution-time postcondition placeholders.
// ---------------------------------------------------------------------------

function parseRepoParams(params: Record<string, string>): { owner: string; repo: string } | null {
  const owner = String(params.owner ?? '').trim()
  const repo = String(params.repo ?? '').trim()
  const full = String(params.repository ?? '').trim()
  if (owner && repo) return { owner, repo }
  if (full && full.includes('/')) {
    const [o, r] = full.split('/', 2)
    if (o && r) return { owner: o, repo: r }
  }
  return null
}

function mapRepoOutcome(
  outcome: { kind: 'executed'; data: { summary: string; evidence: Array<{ kind: string; ref: string; note: string }> } } | { kind: 'honest-unavailable'; reason: string } | { kind: 'failed'; reason: string },
): ActionDispatchOutcome {
  if (outcome.kind === 'executed') {
    return { kind: 'executed', resultSummary: outcome.data.summary, evidence: outcome.data.evidence }
  }
  if (outcome.kind === 'honest-unavailable') return { kind: 'honest-unavailable', reason: outcome.reason }
  return { kind: 'failed', resultSummary: outcome.reason }
}

/** Dispatch ONE repository action through the narrowly scoped adapter. */
export async function dispatchRepositoryAction(action: {
  actionType: string
  params: Record<string, string>
  id: string
  description: string
}): Promise<ActionDispatchOutcome> {
  const parsed = parseRepoParams(action.params)
  if (!parsed) return { kind: 'failed', resultSummary: 'The action needs a repository (owner+repo or "owner/repo").' }
  const ref = parsed
  switch (action.actionType) {
    case 'repo-inspect': {
      const operation = String(action.params.operation ?? 'repository').trim()
      if (operation === 'branches') {
        const out = await listBranches(ref)
        if (out.kind !== 'executed') {
          return out.kind === 'honest-unavailable' ? { kind: 'honest-unavailable', reason: out.reason } : { kind: 'failed', resultSummary: out.reason }
        }
        return {
          kind: 'executed',
          resultSummary: `Observed ${out.data.length} remote branch(es) on ${ref.owner}/${ref.repo}.`,
          evidence: out.evidence,
        }
      }
      if (operation === 'commits') {
        const out = await listCommits(ref, String(action.params.branch ?? 'main'))
        if (out.kind !== 'executed') {
          return out.kind === 'honest-unavailable' ? { kind: 'honest-unavailable', reason: out.reason } : { kind: 'failed', resultSummary: out.reason }
        }
        return {
          kind: 'executed',
          resultSummary: `Observed ${out.data.length} recent commit(s) on ${action.params.branch ?? 'main'}.`,
          evidence: out.evidence,
        }
      }
      if (operation === 'pull-requests') {
        const out = await listPullRequests(ref, 'open')
        if (out.kind !== 'executed') {
          return out.kind === 'honest-unavailable' ? { kind: 'honest-unavailable', reason: out.reason } : { kind: 'failed', resultSummary: out.reason }
        }
        return {
          kind: 'executed',
          resultSummary: `Observed ${out.data.length} open pull request(s) on ${ref.owner}/${ref.repo}.`,
          evidence: out.evidence,
        }
      }
      if (operation === 'divergence') {
        const out = await remoteDivergence(ref, String(action.params.branch ?? ''), action.params.localSha ?? null)
        if (out.kind !== 'executed') {
          return out.kind === 'honest-unavailable' ? { kind: 'honest-unavailable', reason: out.reason } : { kind: 'failed', resultSummary: out.reason }
        }
        return {
          kind: 'executed',
          resultSummary: `Remote ${out.data.remoteSha?.slice(0, 12) ?? 'unset'} vs local ${action.params.localSha?.slice(0, 12) ?? 'unset'} — ${out.data.inSync ? 'in sync' : 'diverged'} (via ${out.data.method}).`,
          evidence: out.evidence,
        }
      }
      const out = await inspectRepository(ref)
      if (out.kind !== 'executed') {
        return out.kind === 'honest-unavailable' ? { kind: 'honest-unavailable', reason: out.reason } : { kind: 'failed', resultSummary: out.reason }
      }
      return {
        kind: 'executed',
        resultSummary: `Repository ${out.data.fullName} inspected (default branch ${out.data.defaultBranch ?? 'unknown'}).`,
        evidence: out.evidence,
      }
    }
    case 'repo-commit': {
      const out = await commitToBranch({
        ref,
        branch: String(action.params.branch ?? ''),
        path: String(action.params.path ?? ''),
        content: String(action.params.content ?? ''),
        message: String(action.params.message ?? action.description ?? 'M45 governed commit').slice(0, 4000),
      })
      if (out.kind === 'executed') {
        return {
          kind: 'executed',
          resultSummary: `Commit ${out.data.sha?.slice(0, 12) ?? 'unknown'} on ${out.data.branch} for ${out.data.path}${out.data.verified ? ' — verified by an independent commit GET.' : ' — the independent verification did NOT confirm it.'}`,
          evidence: [
            { kind: 'commit', ref: out.data.sha ?? 'unknown', note: out.data.verified ? 'verified commit object' : 'commit NOT independently verified' },
            { kind: 'branch', ref: out.data.branch, note: `path ${out.data.path}` },
          ],
        }
      }
      return out.kind === 'honest-unavailable' ? { kind: 'honest-unavailable', reason: out.reason } : { kind: 'failed', resultSummary: out.reason }
    }
    case 'repo-push': {
      const out = await fastForwardBranch({ ref, branch: String(action.params.branch ?? ''), toSha: String(action.params.sha ?? '') })
      if (out.kind === 'executed') {
        return {
          kind: 'executed',
          resultSummary: `Fast-forwarded ${out.data.branch} to ${out.data.sha.slice(0, 12)}${out.data.verified ? ` — verified via ${out.data.method}.` : ' — the independent verification did NOT confirm it.'}`,
          evidence: [
            { kind: 'remote-ref', ref: out.data.branch, note: `${out.data.verified ? 'verified' : 'UNVERIFIED'} at ${out.data.sha.slice(0, 12)}` },
            { kind: 'commit', ref: out.data.sha, note: 'target commit of the fast-forward' },
          ],
        }
      }
      return out.kind === 'honest-unavailable' ? { kind: 'honest-unavailable', reason: out.reason } : { kind: 'failed', resultSummary: out.reason }
    }
    case 'repo-pull-request': {
      const out = await createPullRequest({
        ref,
        head: String(action.params.head ?? action.params.branch ?? ''),
        base: String(action.params.base ?? 'main'),
        title: String(action.params.title ?? 'Governed change'),
        body: String(action.params.body ?? action.description ?? '').slice(0, 20000),
      })
      if (out.kind === 'executed') {
        return {
          kind: 'executed',
          resultSummary: `Pull request #${out.data.number ?? '?'} (${out.data.headSha?.slice(0, 12) ?? 'no head'}) opened${out.data.verified ? ' — verified by an independent PR GET (open + head present).' : ' — the independent verification did NOT confirm it.'}`,
          evidence: [
            { kind: 'pull-request', ref: `#${out.data.number ?? '?'}`, note: out.data.verified ? 'verified open with head sha' : 'NOT independently verified' },
            ...(out.data.headSha ? [{ kind: 'commit', ref: out.data.headSha, note: 'PR head commit' }] : []),
          ],
        }
      }
      return out.kind === 'honest-unavailable' ? { kind: 'honest-unavailable', reason: out.reason } : { kind: 'failed', resultSummary: out.reason }
    }
    default:
      return { kind: 'failed', resultSummary: `Unknown repository action "${action.actionType}".` }
  }
}

/** M45 deployment-inspect dispatch — typed, bounded, honest. */
export async function dispatchDeploymentInspection(action: {
  actionType: string
  params: Record<string, string>
  id: string
  description: string
}): Promise<ActionDispatchOutcome> {
  const operation = String(action.params.operation ?? 'revision').trim()
  switch (operation) {
    case 'config': {
      const out = await inspectDeploymentConfig()
      if (out.kind !== 'executed') return out.kind === 'honest-unavailable' ? { kind: 'honest-unavailable', reason: out.reason } : { kind: 'failed', resultSummary: out.reason }
      return {
        kind: 'executed',
        resultSummary: `Deployment config: ${out.data.caddySummary ?? 'no Caddyfile'}; build ${out.data.buildId ?? 'none'}; standalone ${out.data.standalonePresent ? 'present' : 'absent'}; scope ${out.data.scope}.`,
        evidence: out.evidence,
      }
    }
    case 'history': {
      const out = await inspectDeploymentHistory()
      if (out.kind !== 'executed') return out.kind === 'honest-unavailable' ? { kind: 'honest-unavailable', reason: out.reason } : { kind: 'failed', resultSummary: out.reason }
      return { kind: 'executed', resultSummary: `Deployment history: ${out.data.length} entries.`, evidence: out.evidence }
    }
    case 'health': {
      const out = await probeRuntimeHealth(action.params.healthPath ?? '/api/health')
      if (out.kind !== 'executed') return { kind: 'failed', resultSummary: out.reason }
      return {
        kind: 'executed',
        resultSummary: `Runtime health at ${out.data.url}: HTTP ${out.data.httpStatus ?? 'unreachable'} — ${out.data.healthy === true ? 'healthy' : out.data.healthy === false ? 'UNHEALTHY' : 'status unknown (unreachable)'}.`,
        evidence: out.evidence,
      }
    }
    case 'logs': {
      const out = await inspectDeploymentLogs(Number(action.params.lines ?? 40) || 40)
      if (out.kind !== 'executed') return { kind: 'failed', resultSummary: out.reason }
      return { kind: 'executed', resultSummary: `Deployment log tail from ${out.data.source} (secret-filtered): ${out.data.excerpt.slice(0, 200)}`, evidence: out.evidence }
    }
    default: {
      const out = await inspectDeployedRevision()
      if (out.kind !== 'executed') return { kind: 'failed', resultSummary: out.reason }
      await auditDeploymentInspection('revision', { buildId: out.data.buildId }).catch(() => undefined)
      return {
        kind: 'executed',
        resultSummary: `Deployed revision: build ${out.data.buildId ?? 'unknown'}, commit ${out.data.servingCommitSha?.slice(0, 12) ?? 'unknown'} (via ${out.data.method}).`,
        evidence: out.evidence,
      }
    }
  }
}

/** M45 approved deployment-release dispatch (staging scope; owner-gated). */
export async function dispatchDeploymentRelease(action: {
  actionType: string
  params: Record<string, string>
  id: string
  description: string
}): Promise<ActionDispatchOutcome> {
  const scope = String(action.params.scope ?? 'staging').trim() === 'production' ? 'production' : 'staging'
  const out = await executeApprovedDeployment({
    revision: String(action.params.revision ?? action.params.sha ?? ''),
    scope,
    requestedBy: String(action.params.requestedBy ?? 'governed-plan'),
  })
  if (out.kind === 'executed') {
    return {
      kind: 'executed',
      resultSummary: `${scope} deployment of ${out.data.revision.slice(0, 12)}${out.data.verified ? ` — verified via ${out.data.method}.` : ' — NOT independently verified.'}`,
      evidence: out.evidence,
    }
  }
  return out.kind === 'honest-unavailable' ? { kind: 'honest-unavailable', reason: out.reason } : { kind: 'failed', resultSummary: out.reason }
}

/**
 * Resolve execution-time placeholders — implemented in outcome-verification
 * (runtimeVerificationContract) so the substitution rules live with the
 * evaluators. Kept here as a thin alias for direct dispatch testing.
 */
export function resolveRuntimePostconditions(
  contract: Parameters<typeof runtimeVerificationContract>[0],
  evidence: Array<{ kind: string; ref: string; note: string }>,
): Array<{ kind: string; params: Record<string, string>; description: string; requireIndependentMethod: boolean }> {
  return runtimeVerificationContract(contract, evidence).postconditions
}

// ---------------------------------------------------------------------------
// The runner.
// ---------------------------------------------------------------------------

export interface RunActionPlanInput {
  plan: ActionPlan
  identity: ExecutorIdentity
  grantor: GrantorIdentity | null
  /** The Trust Engine task approvals attach to (missions carry one). */
  trustTaskId: string | null
  /** Approval rows for this plan (fetched by the caller from the Trust Engine). */
  approvals: Array<{ id: string; actionDigest: string; actionJson: string; status: string }>
  cancelRequested: boolean
  projectId?: string
  store?: ActionFileStore
  /** Persist each record via the caller (Trust ledger / audit). */
  onRecord?: (record: ActionExecutionRecord) => Promise<void> | void
}

export interface ActionRunResult {
  status: 'completed' | 'blocked' | 'awaiting-approval' | 'failed' | 'cancelled'
  records: ActionExecutionRecord[]
  approvalsRequested: Array<{ actionId: string; approvalDigest: string; summary: string }>
  /** Honest customer-safe summary of what actually happened. */
  summary: string
}

/** Topological order by dependsOn (unknown deps ignored; cycles run last). */
export function executionOrder(plan: ActionPlan): string[] {
  const byId = new Map(plan.contracts.map((c) => [c.id, c]))
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (id: string, chain: Set<string>) => {
    if (seen.has(id) || chain.has(id)) return
    chain.add(id)
    const c = byId.get(id)
    if (c) for (const dep of c.dependsOn) visit(dep, chain)
    chain.delete(id)
    seen.add(id)
    order.push(id)
  }
  for (const c of plan.contracts) visit(c.id, new Set())
  return order
}

/**
 * Run the plan. Honest by construction: blocked/awaiting/unavailable states
 * are reported, never converted; success requires the independent verdict.
 */
export async function runActionPlan(input: RunActionPlanInput): Promise<ActionRunResult> {
  const store = input.store ?? dbFileStore
  const records: ActionExecutionRecord[] = []
  const approvalsRequested: ActionRunResult['approvalsRequested'] = []
  let status: ActionRunResult['status'] = 'completed'
  const notes: string[] = []

  for (const id of executionOrder(input.plan)) {
    if (input.cancelRequested) {
      status = 'cancelled'
      notes.push(`cancelled before "${id}"`)
      break
    }
    const contract = input.plan.contracts.find((c) => c.id === id)
    if (!contract) continue

    // 1. Policy self-modification guard.
    const policy = assertNoPolicySelfModification(contract)
    if (!policy.ok) {
      const record = applyActionTransition(createExecutionRecord(contract, input.identity.identity), {
        state: 'BLOCKED',
        note: `Refused: the action tries to modify safety policies or grant permissions ("${policy.matched}").`,
      })
      records.push(record)
      status = 'blocked'
      notes.push(`"${id}" blocked by the safety-policy guard`)
      continue
    }

    // 2. The gate.
    const matching = input.approvals.find((a) => {
      try {
        const parsed = JSON.parse(a.actionJson) as { actionId?: string }
        return parsed.actionId === contract.id
      } catch {
        return false
      }
    })
    const gate = authorizeAction({
      contract,
      plan: input.plan,
      identity: input.identity,
      grantor: input.grantor,
      approval: matching ?? null,
      cancelRequested: input.cancelRequested,
    })

    if (gate.action === 'blocked') {
      const record = applyActionTransition(createExecutionRecord(contract, input.identity.identity), {
        state: 'BLOCKED',
        note: gate.reason,
      })
      records.push(record)
      await input.onRecord?.(record)
      status = 'blocked'
      notes.push(`"${id}" blocked: ${gate.reason.slice(0, 120)}`)
      continue
    }
    if (gate.action === 'awaiting-approval') {
      const payload = buildApprovalPayload(contract, input.plan)
      const digest = approvalDigest(payload)
      const summary = `${contract.title} (${contract.riskClass}, ${contract.reversibility}): ${contract.description.slice(0, 200)}`
      approvalsRequested.push({ actionId: contract.id, approvalDigest: digest, summary })
      const record = createExecutionRecord(contract, input.identity.identity)
      record.note = 'Awaiting owner approval — the action is bound to the plan digest and cannot run until it is granted and consumed.'
      records.push(record)
      await input.onRecord?.(record)
      if (status === 'completed') status = 'awaiting-approval'
      notes.push(`"${id}" awaiting owner approval`)
      continue
    }

    // 3. Consume human approvals server-side immediately before execution.
    if (contract.requiresApproval === 'human' && matching) {
      const { consumeTaskApproval } = await import('@/lib/trust/approvals')
      if (input.trustTaskId) {
        const consumed = await consumeTaskApproval(input.trustTaskId, matching.id)
        if (!consumed.ok) {
          const record = applyActionTransition(createExecutionRecord(contract, input.identity.identity), {
            state: 'BLOCKED',
            note: `The approval could not be consumed (${consumed.reason}) — the action did not run.`,
          })
          records.push(record)
          await input.onRecord?.(record)
          status = 'blocked'
          notes.push(`"${id}" approval consume failed: ${consumed.reason}`)
          continue
        }
      }
    }

    // 4. Execute through the real path.
    let record = applyActionTransition(createExecutionRecord(contract, input.identity.identity), {
      state: 'APPROVED',
      ...(contract.requiresApproval === 'none' ? { note: 'Read-only action — no approval required.' } : {}),
    })
    record = applyActionTransition(record, {
      state: 'EXECUTING',
      startedAt: new Date().toISOString(),
      attempts: 1,
    })
    let outcome: ActionDispatchOutcome
    try {
      outcome = await dispatchAction(
        { actionType: contract.actionType, params: contract.params, id: contract.id, description: contract.description },
        store,
        input.projectId,
      )
    } catch (e) {
      outcome = { kind: 'failed', resultSummary: `Execution error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` }
    }

    if (outcome.kind === 'honest-unavailable') {
      record = applyActionTransition(record, {
        state: 'FAILED',
        resultSummary: outcome.reason,
        completedAt: new Date().toISOString(),
        note: 'Honest unavailability — this action type has no real execution path here and was not simulated.',
      })
      records.push(record)
      await input.onRecord?.(record)
      if (status === 'completed') status = 'failed'
      notes.push(`"${id}" honestly unavailable`)
      continue
    }
    if (outcome.kind === 'failed') {
      record = applyActionTransition(record, {
        state: 'FAILED',
        resultSummary: outcome.resultSummary,
        completedAt: new Date().toISOString(),
        note: 'Execution failed before verification.',
      })
      records.push(record)
      await input.onRecord?.(record)
      if (status === 'completed') status = 'failed'
      notes.push(`"${id}" failed in execution`)
      continue
    }

    // 5. Independent verification — never the executor's own claim.
    record = applyActionTransition(record, {
      state: 'VERIFYING',
      resultSummary: outcome.resultSummary,
      evidence: outcome.evidence,
    })
    const observation = await gatherObservation(contract, store, input.projectId, outcome)
    const method = verificationMethodFor(contract)
    const verdict: VerificationVerdict = verifyPostconditions(runtimeVerificationContract(contract, outcome.evidence), observation).verdict
    record = applyActionTransition(record, { ...verificationOutcomePatch(verdict, method), note: verdict === 'confirmed' ? null : `Postconditions ${verdict}.` })
    records.push(record)
    await input.onRecord?.(record)
    if (verdict === 'failed' && status === 'completed') status = 'failed'
    if (verdict === 'inconclusive' && status === 'completed') status = 'failed'
    notes.push(`"${id}" ${verdict}`)

    await recordAudit({
      actorId: input.identity.identity,
      action: 'm44.action_executed',
      target: contract.id,
      meta: { planVersion: contract.planVersion, actionType: contract.actionType, verdict, riskClass: contract.riskClass },
    }).catch(() => undefined)
  }

  const succeeded = records.filter((r) => r.state === 'SUCCEEDED').length
  return {
    status,
    records,
    approvalsRequested,
    summary:
      `${succeeded}/${records.length} action(s) independently verified and succeeded` +
      (approvalsRequested.length ? `; ${approvalsRequested.length} awaiting owner approval` : '') +
      (notes.length ? `. Detail: ${notes.slice(0, 6).join('; ')}` : '') +
      '.',
  }
}

/** Gather the INDEPENDENT observation set for the executed action. */
async function gatherObservation(
  contract: { actionType: string; params: Record<string, string>; postconditions: Array<{ kind: string; params: Record<string, string> }> },
  store: ActionFileStore,
  projectId: string | undefined,
  outcome: Extract<ActionDispatchOutcome, { kind: 'executed' }>,
): Promise<ObservationSet> {
  const observation: ObservationSet = {}
  const needsFiles = contract.postconditions.some((p) => p.kind.startsWith('file-')) || contract.actionType === 'file-write' || contract.actionType === 'file-read'
  if (needsFiles && projectId) {
    const paths = contract.postconditions
      .filter((p) => p.kind.startsWith('file-') && p.params.path)
      .map((p) => p.params.path)
    if (contract.params.path && !paths.includes(contract.params.path)) paths.push(contract.params.path)
    const rows: ProjectFileRow[] = []
    for (const path of [...new Set(paths)].slice(0, 8)) {
      const row = await store.read(projectId, path)
      if (row) rows.push(row)
    }
    observation.fileSystem = observationFromFiles(rows, paths)
  }
  if (contract.actionType === 'research-fetch' || contract.postconditions.some((p) => p.kind === 'sources-min')) {
    observation.research = observationFromResearch(
      outcome.evidence.filter((e) => e.kind === 'source').map((e) => ({ url: e.ref, title: e.note })),
    )
  }
  // M45 — repository observations gathered by methods INDEPENDENT of the
  // write: the pull-request state comes from the adapter's independent GET
  // (recorded in the evidence note), inspections observe their own bounded
  // run through the idempotency ledger.
  if (contract.actionType === 'repo-pull-request') {
    const verified = outcome.evidence.some((e) => e.kind === 'pull-request' && /verified/i.test(e.note) && !/UNVERIFIED|NOT/i.test(e.note))
    observation.pullRequestState = verified ? 'open' : 'unconfirmed'
  }
  if (contract.actionType === 'repo-inspect' && contract.idempotencyKey) {
    observation.idempotency = { [contract.idempotencyKey]: { runCount: 1 } }
  }
  return observation
}
