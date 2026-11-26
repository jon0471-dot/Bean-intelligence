/**
 * BEAN Intelligence — M41 mission executor (SERVER-ONLY, durable).
 *
 * The durable multi-agent runner. Claimed from the EXISTING engine pool as a
 * 'mission-run' job (claim → lease → heartbeat → crash recovery), it drives
 * the mission task graph to a terminal outcome:
 *
 *  - dependency order is enforced by the DAG kernel (ready set only);
 *  - independent tasks run concurrently (bounded lanes);
 *  - every specialist task delegates through the REAL product paths
 *    (CODE GIFTZ engineering jobs, LAXII/JAZMII/GANGZII specialist jobs)
 *    with all their preflight/dedupe/quota gates intact;
 *  - research/knowledge tasks execute the REAL retrieval tools;
 *  - every output is verified by the deterministic verifiers before the
 *    task may settle done — with a bounded correction round;
 *  - cancellation propagates to active specialist jobs and all dependent
 *    subtasks;
 *  - interruption is survivable: task state is persisted, specialist jobs
 *    are durable on their own, and a re-claim resumes exactly where the
 *    ledger says (verified tasks are never re-executed);
 *  - outcomes are honest: side failures → completed_partial, deliverable
 *    chain failure → failed, and every settle carries a verification
 *    summary built from ACTUAL execution evidence.
 */
import { db } from '@/lib/db'
import { appendJobEventSafe } from '@/lib/ai-engine/events'
import { finishCompleted, finishFailed, requestCancel } from '@/lib/ai-engine/queue'
import type { ClaimedJob } from '@/lib/ai-engine/types'
import { submitCodingDelegation } from '@/lib/riishe/code-delegation'
import { submitSpecialistJob } from '@/lib/riishe/specialists'
import { webSearchTool, readUrlTool } from '@/lib/riishe/tools/builtin'
import { buildVerificationContext, handoffSourceRefs, type MissionVerificationContext, type MissionSourceRef } from './verify-context'
import type { PersistedDeliverableEvidence } from './verifiers'
import { searchAtlasTool } from '@/lib/riishe/tools/atlas'
import type { ToolContext, ToolSource } from '@/lib/riishe/tools/types'
import { addTrustEvidence, cancelTrustTask, failTrustTask, finalizeTrustTask, planTrustSteps, updateTrustStepStatus } from '@/lib/trust/tasks'
import { MISSION_LIMITS, type MissionArtifact, type MissionStatus, type MissionTaskKind, type MissionTaskSpec, type MissionTaskStatus, type VerificationCriteria } from './types'
import { decideMissionOutcome, deliverableChain, readyTaskIds, skippedDownstream, takeParallelBatch } from './graph'
import { correctionHandoff, enrichObjective, researchPackHandoff, type HandoffBlock } from './handoff'
import { verifyDeliverable, verifyTaskOutput, parsePayload, type CodingJobPayload, type ResearchPayload } from './verifiers'
import { attachSpecialistJob, beginMissionTrust, transitionMission, transitionTask, updateRunningTask, retryTask, TrustStateMissionError } from './store'

// ---------------------------------------------------------------------------
// Small local helpers
// ---------------------------------------------------------------------------

function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

interface MissionRow {
  id: string
  userId: string
  missionType: string
  objective: string
  deliverableTaskId: string
  status: string
  trustTaskId: string | null
  jobId: string | null
  cancelRequested: boolean
  outcomeSummary: string | null
  failureNote: string | null
  tasks: TaskRow[]
}

interface TaskRow {
  id: string
  missionId: string
  taskId: string
  kind: string
  agent: string
  title: string
  objective: string
  paramsJson: string
  expectedOutput: string
  dependsOnJson: string
  authScope: string
  verificationJson: string
  limitsJson: string
  status: string
  attempts: number
  corrections: number
  specialistJobId: string | null
  executionJson: string | null
  verificationResultJson: string | null
  failureNote: string | null
  artifactJson: string | null
}

interface TaskLimits {
  executionTimeoutMs: number
  maxAttempts: number
  maxCorrections: number
}

function parseLimits(raw: string): TaskLimits {
  try {
    const l = JSON.parse(raw) as Partial<TaskLimits>
    return {
      executionTimeoutMs: typeof l.executionTimeoutMs === 'number' ? l.executionTimeoutMs : 10 * 60_000,
      maxAttempts: typeof l.maxAttempts === 'number' ? l.maxAttempts : 1,
      maxCorrections: typeof l.maxCorrections === 'number' ? l.maxCorrections : 1,
    }
  } catch {
    return { executionTimeoutMs: 10 * 60_000, maxAttempts: 1, maxCorrections: 1 }
  }
}

function parseDeps(raw: string): string[] {
  try {
    const d = JSON.parse(raw) as unknown
    return Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function parseParams(raw: string): Record<string, string> {
  try {
    const p = JSON.parse(raw) as unknown
    if (!p || typeof p !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function specOf(t: TaskRow): MissionTaskSpec {
  return {
    id: t.taskId,
    kind: t.kind as MissionTaskKind,
    agent: t.agent as MissionTaskSpec['agent'],
    title: t.title,
    objective: t.objective,
    params: parseParams(t.paramsJson),
    expectedOutput: t.expectedOutput,
    dependsOn: parseDeps(t.dependsOnJson),
    authScope: t.authScope as MissionTaskSpec['authScope'],
    verification: (() => {
      try {
        return JSON.parse(t.verificationJson) as VerificationCriteria
      } catch {
        return {}
      }
    })(),
    limits: parseLimits(t.limitsJson) as MissionTaskSpec['limits'],
  }
}

async function loadMission(missionId: string): Promise<MissionRow | null> {
  const m = await db.agentMission.findUnique({
    where: { id: missionId },
    include: { tasks: { orderBy: { createdAt: 'asc' } } },
  })
  return (m as unknown as MissionRow) ?? null
}

async function settleJobCompleted(jobId: string, workerId: string, result: Record<string, unknown>): Promise<void> {
  await finishCompleted(jobId, workerId, result)
}

// ---------------------------------------------------------------------------
// Trust ledger mapping
// ---------------------------------------------------------------------------

const STEP_KIND_FOR: Record<string, 'retrieval' | 'generation' | 'verification'> = {
  research: 'retrieval',
  knowledge: 'retrieval',
  'code-build': 'generation',
  'document-draft': 'generation',
  'image-asset': 'generation',
  'video-asset': 'generation',
  'audio-asset': 'generation',
  'verify-deliverable': 'verification',
}

async function trustPlanSteps(mission: MissionRow): Promise<void> {
  if (!mission.trustTaskId) return
  try {
    await planTrustSteps(
      mission.trustTaskId,
      mission.tasks.map((t) => ({
        kind: STEP_KIND_FOR[t.kind] ?? 'tool',
        title: clip(`${t.taskId}: ${t.title}`, 120),
        detailJson: JSON.stringify({ kind: t.kind, agent: t.agent, dependsOn: parseDeps(t.dependsOnJson) }).slice(0, 4000),
      })),
    )
  } catch {
    // Trust ledger bounds (stepsPerTask) — the mission proceeds; evidence
    // rows keep the provenance.
  }
}

const TRUST_SEQ: Record<string, number> = {}

function trustSeq(missionId: string): number {
  TRUST_SEQ[missionId] = (TRUST_SEQ[missionId] ?? 0) + 1
  return TRUST_SEQ[missionId]
}

async function trustStep(task: TaskRow, status: 'running' | 'done' | 'failed' | 'skipped', mission: MissionRow, note?: string): Promise<void> {
  if (!mission.trustTaskId) return
  try {
    await updateTrustStepStatus(mission.trustTaskId, trustSeq(mission.id), status, note ? { errorNote: clip(note, 400) } : undefined)
  } catch {
    /* ledger bounds are not execution failures */
  }
}

async function trustEvidenceArtifact(mission: MissionRow, artifact: MissionArtifact): Promise<void> {
  if (!mission.trustTaskId) return
  try {
    await addTrustEvidence(mission.trustTaskId, {
      kind: 'artifact',
      ref: clip(artifact.ref, 2048),
      title: clip(`${artifact.artifact}: ${artifact.label}`, 120),
      origin: 'extracted',
      note: clip(`produced by task ${artifact.taskId}`, 400),
    })
  } catch {
    /* ledger bounds */
  }
}

async function trustEvidenceLimitation(mission: MissionRow, note: string): Promise<void> {
  if (!mission.trustTaskId) return
  try {
    await addTrustEvidence(mission.trustTaskId, { kind: 'limitation', ref: clip(`mission:${mission.id}`, 2048), note: clip(note, 400), origin: 'extracted' })
  } catch {
    /* ledger bounds */
  }
}

// ---------------------------------------------------------------------------
// Retrieval execution (the knowledge specialist's real lanes)
// ---------------------------------------------------------------------------

function missionToolContext(mission: MissionRow): ToolContext {
  return {
    permissions: new Set<string>(),
    userId: mission.userId,
    conversationKey: `mission-${mission.id}`,
    documents: new Map(),
  }
}

async function runResearchTask(mission: MissionRow, spec: MissionTaskSpec): Promise<{ payload: ResearchPayload | null; honestError: string | null }> {
  const topic = spec.params.topic ?? spec.objective
  const queries: string[] = []
  const sources: ResearchPayload['sources'] = []
  const degraded: string[] = []
  try {
    const executed = await webSearchTool.execute({ query: clip(topic, 300) }, missionToolContext(mission))
    queries.push(topic)
    if (executed.ok && executed.sources) {
      for (const s of executed.sources as ToolSource[]) {
        sources.push({ url: s.url, title: s.title || s.hostName, snippet: '', pageRead: s.pageRead })
      }
    } else if (!executed.ok) {
      degraded.push(executed.output.slice(0, 200))
    }
  } catch (e) {
    degraded.push(e instanceof Error ? e.message.slice(0, 200) : 'search failed')
  }
  const payload: ResearchPayload = { sources, queries, degraded: degraded.length ? degraded : undefined }
  return { payload, honestError: degraded.length > 0 && sources.length === 0 ? degraded[0] : null }
}

async function runKnowledgeTask(mission: MissionRow, spec: MissionTaskSpec): Promise<{ payload: ResearchPayload | null; honestError: string | null }> {
  const topic = spec.params.topic ?? spec.objective
  const sources: ResearchPayload['sources'] = []
  const degraded: string[] = []
  try {
    const executed = await searchAtlasTool.execute({ query: clip(topic, 300) }, missionToolContext(mission))
    if (executed.ok && executed.sources) {
      for (const s of executed.sources as ToolSource[]) {
        sources.push({ url: s.url, title: s.title || s.hostName, snippet: '', ref: s.url })
      }
    } else if (!executed.ok) {
      degraded.push(executed.output.slice(0, 200))
    }
  } catch (e) {
    degraded.push(e instanceof Error ? e.message.slice(0, 200) : 'atlas search failed')
  }
  const payload: ResearchPayload = { sources, queries: [topic], degraded: degraded.length ? degraded : undefined }
  return { payload, honestError: degraded.length > 0 && sources.length === 0 ? degraded[0] : null }
}

// ---------------------------------------------------------------------------
// Specialist delegation (the REAL product paths — every gate preserved)
// ---------------------------------------------------------------------------

interface DelegationOutcome {
  ok: boolean
  jobId: string | null
  reason: string | null
}

async function delegateCoding(mission: MissionRow, objective: string, projectName?: string, verificationContext?: MissionVerificationContext): Promise<DelegationOutcome> {
  try {
    const outcome = await submitCodingDelegation(
      mission.userId,
      {
        objective: clip(objective, 8000),
        ...(projectName ? { projectName } : {}),
      },
      verificationContext,
    )
    return { ok: outcome.ok, jobId: outcome.jobId, reason: outcome.reason }
  } catch (e) {
    return { ok: false, jobId: null, reason: e instanceof Error ? e.message.slice(0, 200) : 'coding delegation failed' }
  }
}

// ---------------------------------------------------------------------------
// M41.7 — persisted-deliverable evidence (the project workspace snapshot the
// deterministic verifier audits). Project-scoped by the specialist job's OWN
// project id (from the job result payload — the project the delegation
// created/resolved); a mission can never audit another user's files because
// the delegation path is owner-scoped end to end.
// ---------------------------------------------------------------------------

const PERSISTED_SNAPSHOT_MAX_FILES = 16
const PERSISTED_SNAPSHOT_PER_FILE_CHARS = 60_000
const PERSISTED_DELIVERABLE_CHARS = 160_000

async function loadPersistedDeliverable(
  spec: MissionTaskSpec,
  payload: CodingJobPayload | null,
): Promise<PersistedDeliverableEvidence | undefined> {
  // Only deliverable-shaped coding tasks get a persisted audit; debug/plain
  // code builds keep the job-payload gates.
  const kind = spec.verification.deliverableKind ?? (spec.kind === 'document-draft' ? 'document' : 'code')
  if (kind === 'code') return undefined
  const projectId = payload?.projectId ?? null
  if (!projectId) return undefined
  const files = await db.codeFile.findMany({
    where: { projectId },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  })
  const deliverablePath = spec.verification.deliverablePath ?? null
  const deliverableRow = deliverablePath ? files.find((f) => f.path === deliverablePath) : undefined
  return {
    projectId,
    manifest: files.slice(0, 100).map((f) => ({ path: f.path, chars: f.content.length })),
    deliverableContent: deliverableRow ? deliverableRow.content.slice(0, PERSISTED_DELIVERABLE_CHARS) : null,
    contents:
      kind === 'website'
        ? files.slice(0, PERSISTED_SNAPSHOT_MAX_FILES).map((f) => ({ path: f.path, content: f.content.slice(0, PERSISTED_SNAPSHOT_PER_FILE_CHARS) }))
        : [],
  }
}

async function delegateMedia(
  mission: MissionRow,
  kind: MissionTaskKind,
  params: Record<string, string>,
): Promise<DelegationOutcome> {
  try {
    if (kind === 'image-asset') {
      const submission = await submitSpecialistJob(mission.userId, {
        product: 'laxii',
        task: 'image-generation',
        params: { prompt: params.prompt ?? params.objective ?? 'mission visual asset', size: '1024x1024' },
        dedupe: { prompt: params.prompt ?? params.objective ?? 'mission visual asset', size: '1024x1024' } as Record<string, unknown>,
      })
      return { ok: submission.ok, jobId: submission.jobId, reason: submission.reason }
    }
    if (kind === 'video-asset') {
      const prompt = params.prompt ?? params.objective ?? 'mission video clip'
      const submission = await submitSpecialistJob(mission.userId, {
        product: 'jazmii',
        task: 'video-generation',
        params: { prompt },
        dedupe: { prompt, imageUrl: null, quality: null, withAudio: null, size: null, durationSec: null, fps: null },
      })
      return { ok: submission.ok, jobId: submission.jobId, reason: submission.reason }
    }
    // audio-asset
    const text = params.text ?? ''
    const submission = await submitSpecialistJob(mission.userId, {
      product: 'gangzii',
      task: 'speech-synthesis',
      params: { text, speed: 1.0, source: 'studio' },
      dedupe: { text, speed: 1.0, source: 'studio' },
    })
    return { ok: submission.ok, jobId: submission.jobId, reason: submission.reason }
  } catch (e) {
    return { ok: false, jobId: null, reason: e instanceof Error ? e.message.slice(0, 200) : 'media delegation failed' }
  }
}

// ---------------------------------------------------------------------------
// Handoff reconstruction (from persisted, verified execution payloads)
// ---------------------------------------------------------------------------

async function researchPackFor(mission: MissionRow, depTaskIds: readonly string[]): Promise<{ artifacts: MissionArtifact[]; sources: Array<{ url: string; title: string; snippet: string }> }> {
  const artifacts: MissionArtifact[] = []
  const sources: Array<{ url: string; title: string; snippet: string }> = []
  for (const depId of depTaskIds) {
    const row = mission.tasks.find((t) => t.taskId === depId)
    // ONLY retrieval lanes carry research packs — media/coding payloads are
    // different shapes and must never be parsed as source lists.
    if (!row || !row.executionJson || (row.kind !== 'research' && row.kind !== 'knowledge')) continue
    const payload = parsePayload<ResearchPayload>(row.executionJson)
    if (!payload || !Array.isArray(payload.sources)) continue
    for (const s of payload.sources.slice(0, 12)) {
      sources.push({ url: s.url, title: s.title, snippet: s.snippet ?? '' })
      artifacts.push({ artifact: 'research-pack', taskId: depId, ref: s.url, label: (s.title ?? '').slice(0, 120) })
    }
  }
  return { artifacts, sources }
}

function artifactsOf(row: TaskRow): MissionArtifact[] {
  if (!row.artifactJson) return []
  try {
    const parsed = JSON.parse(row.artifactJson) as MissionArtifact[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Task starts
// ---------------------------------------------------------------------------

async function startTask(mission: MissionRow, row: TaskRow, spec: MissionTaskSpec): Promise<void> {
  const deps = parseDeps(row.dependsOnJson)
  const limits = parseLimits(row.limitsJson)
  void deps
  if (row.status === 'running') {
    // Re-entered task (scheduler retry seam): refresh the attempt counter
    // without a lifecycle transition.
    await updateRunningTask(mission.id, row.taskId, { attempts: row.attempts + 1 })
    row = { ...row, attempts: row.attempts + 1 }
  } else {
    await transitionTask(mission.id, row.taskId, row.status as MissionTaskStatus, 'running', { attempts: row.attempts + 1 })
    await trustStep(row, 'running', mission)
  }

  // --- inline lanes (execute + verify synchronously) -----------------------
  if (spec.kind === 'research' || spec.kind === 'knowledge') {
    const run = spec.kind === 'research' ? await runResearchTask(mission, spec) : await runKnowledgeTask(mission, spec)
    const outcome = verifyTaskOutput(spec.kind, spec.verification, run.payload)
    const executionJson = JSON.stringify(run.payload)
    if (outcome.status === 'verified') {
      await transitionTask(mission.id, row.taskId, 'running', 'done', {
        executionJson,
        verificationResultJson: JSON.stringify(outcome),
        artifactJson: JSON.stringify(outcome.artifacts.slice(0, 12)),
        failureNote: null,
      })
      await trustStep(row, 'done', mission)
      for (const a of outcome.artifacts.slice(0, 4)) await trustEvidenceArtifact(mission, { ...a, taskId: row.taskId })
    } else if (outcome.status === 'needs_correction' && row.corrections < limits.maxCorrections) {
      // Bounded second retrieval attempt (same honest lanes).
      await transitionTask(mission.id, row.taskId, 'running', 'failed', {
        executionJson,
        verificationResultJson: JSON.stringify(outcome),
        failureNote: outcome.reasons[0] ?? 'research contract unmet',
      })
      await trustStep(row, 'failed', mission, outcome.reasons[0])
    } else {
      await transitionTask(mission.id, row.taskId, 'running', 'failed', {
        executionJson,
        verificationResultJson: JSON.stringify(outcome),
        failureNote: outcome.reasons[0] ?? 'research contract unmet',
      })
      await trustStep(row, 'failed', mission, outcome.reasons[0])
    }
    return
  }

  if (spec.kind === 'verify-deliverable') {
    const inputs = deps.map((depId) => {
      const dep = mission.tasks.find((t) => t.taskId === depId)
      const ver = dep?.verificationResultJson ? (JSON.parse(dep.verificationResultJson) as { status?: string }) : null
      return {
        taskId: depId,
        kind: (dep?.kind ?? 'unknown') as MissionTaskKind,
        verified: ver?.status === 'verified',
        artifactCount: dep ? artifactsOf(dep).length : 0,
        summary: dep?.failureNote ?? (ver?.status === 'verified' ? 'verified' : 'not verified'),
      }
    })
    const outcome = verifyDeliverable(inputs)
    const json = JSON.stringify({ status: outcome.status, reasons: outcome.reasons.slice(0, 4) })
    if (outcome.status === 'verified') {
      await transitionTask(mission.id, row.taskId, 'running', 'done', {
        executionJson: json,
        verificationResultJson: json,
        failureNote: null,
      })
      await trustStep(row, 'done', mission)
    } else {
      await transitionTask(mission.id, row.taskId, 'running', 'failed', {
        executionJson: json,
        verificationResultJson: json,
        failureNote: outcome.reasons[0] ?? 'deliverable integrity failed',
      })
      await trustStep(row, 'failed', mission, outcome.reasons[0])
    }
    return
  }

  // --- delegated lanes (durable specialist jobs) ----------------------------
  let objective = spec.objective
  const handoffBlocks: HandoffBlock[] = []
  let handedOffRefs: MissionSourceRef[] = []
  if (deps.length > 0) {
    const { artifacts, sources } = await researchPackFor(mission, deps)
    if (sources.length > 0 && (spec.kind === 'document-draft' || spec.kind === 'code-build')) {
      handoffBlocks.push(researchPackHandoff(artifacts, sources))
      // M41.7: the numbered refs the consumer ACTUALLY received — the same
      // list rides in the verification context so citation correspondence
      // is checked against exactly what was handed off.
      handedOffRefs = handoffSourceRefs(sources)
    }
  }
  if (handoffBlocks.length > 0) objective = enrichObjective(objective, handoffBlocks)

  const verificationContext =
    spec.kind === 'code-build' || spec.kind === 'document-draft'
      ? buildVerificationContext({
          missionId: mission.id,
          taskId: row.taskId,
          taskKind: spec.kind,
          criteria: spec.verification,
          sources: handedOffRefs,
        })
      : undefined

  const outcome =
    spec.kind === 'code-build' || spec.kind === 'document-draft'
      ? await delegateCoding(mission, objective, spec.params.projectName, verificationContext)
      : await delegateMedia(mission, spec.kind, spec.params)

  if (!outcome.ok || !outcome.jobId) {
    const note = `submission refused: ${outcome.reason ?? 'the specialist declined the request'}`
    // Submission refusals (availability/quota/dedupe) are honest failures;
    // the scheduler re-enters them while the attempt budget allows.
    await transitionTask(mission.id, row.taskId, 'running', 'failed', {
      attempts: row.attempts,
      failureNote: clip(note, 400),
    })
    await trustStep(row, 'failed', mission, note)
    return
  }
  await attachSpecialistJob(mission.id, row.taskId, outcome.jobId)
  await appendJobEventSafe(mission.jobId ?? mission.id, 'notice', {
    task: row.taskId,
    delegated: spec.kind,
    specialistJobId: outcome.jobId,
  }).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// Specialist-job refresh + verification
// ---------------------------------------------------------------------------

const TRANSIENT_CLASSES = new Set(['rate_limited', 'network', 'timeout', 'worker_lost'])

async function refreshDelegatedTask(mission: MissionRow, row: TaskRow, spec: MissionTaskSpec): Promise<boolean> {
  // Returns true when the task reached a terminal state this pass.
  if (!row.specialistJobId) {
    // A delegated task marked running WITHOUT a job id: a crash between
    // 'running' and submission. Leave it running — the scheduler re-enters
    // it (startTask) within the attempt budget on this same pass.
    return false
  }
  const job = await db.generationJob.findUnique({ where: { id: row.specialistJobId }, select: { id: true, userId: true, status: true, resultJson: true, errorClass: true, errorMessage: true, errorCode: true } })
  if (!job || job.userId !== mission.userId) {
    await transitionTask(mission.id, row.taskId, 'running', 'failed', { failureNote: 'The specialist job could not be found.' })
    await trustStep(row, 'failed', mission, 'specialist job missing')
    return true
  }
  const limits = parseLimits(row.limitsJson)

  if (job.status === 'completed') {
    const payload = parsePayload<CodingJobPayload>(job.resultJson)
    const deps = parseDeps(row.dependsOnJson)
    const handedOffPack = await researchPackFor(mission, deps)
    const handedOff = handedOffPack.sources.length
    // M41.7: the mission-aware verification context — the EXACT handed-off
    // source list plus the ACTUAL persisted workspace snapshot, loaded
    // project-scoped from the specialist job's own project.
    const sourceRefs = handedOff > 0 ? handoffSourceRefs(handedOffPack.sources) : []
    const persisted = await loadPersistedDeliverable(spec, payload)
    const outcome = verifyTaskOutput(spec.kind, spec.verification, payload, { handedOffSources: handedOff, sourceRefs, persisted })
    if (outcome.status === 'verified') {
      await transitionTask(mission.id, row.taskId, 'running', 'done', {
        executionJson: clip(job.resultJson ?? '{}', 6000),
        verificationResultJson: JSON.stringify(outcome),
        artifactJson: JSON.stringify(outcome.artifacts.map((a) => ({ ...a, taskId: row.taskId })).slice(0, 12)),
        failureNote: null,
      })
      await trustStep(row, 'done', mission)
      for (const a of outcome.artifacts.slice(0, 6)) await trustEvidenceArtifact(mission, { ...a, taskId: row.taskId })
      return true
    }
    if (outcome.status === 'needs_correction' && row.corrections < limits.maxCorrections) {
      // Bounded correction round: resubmit with the concrete failure digest.
      const blocks = [correctionHandoff(outcome.reasons)]
      const { artifacts, sources } = await researchPackFor(mission, deps)
      if (sources.length > 0) blocks.push(researchPackHandoff(artifacts, sources))
      const corrected = enrichObjective(spec.objective, blocks)
      const verificationContext =
        spec.kind === 'code-build' || spec.kind === 'document-draft'
          ? buildVerificationContext({
              missionId: mission.id,
              taskId: row.taskId,
              taskKind: spec.kind,
              criteria: spec.verification,
              sources: handoffSourceRefs(sources),
            })
          : undefined
      const resubmission =
        spec.kind === 'code-build' || spec.kind === 'document-draft'
          ? await delegateCoding(mission, corrected, spec.params.projectName, verificationContext)
          : await delegateMedia(mission, spec.kind, spec.params)
      if (resubmission.ok && resubmission.jobId) {
        await updateRunningTask(mission.id, row.taskId, {
          attempts: row.attempts + 1,
          corrections: row.corrections + 1,
          specialistJobId: resubmission.jobId,
          objective: clip(corrected, 6000),
          failureNote: clip(outcome.reasons[0] ?? 'correction round', 400),
        })
        return false
      }
      await transitionTask(mission.id, row.taskId, 'running', 'failed', {
        verificationResultJson: JSON.stringify(outcome),
        failureNote: clip(`correction round refused: ${resubmission.reason ?? 'unknown'}`, 400),
      })
      await trustStep(row, 'failed', mission, 'correction refused')
      return true
    }
    await transitionTask(mission.id, row.taskId, 'running', 'failed', {
      verificationResultJson: JSON.stringify(outcome),
      failureNote: clip(outcome.reasons[0] ?? 'verification failed', 400),
    })
    await trustStep(row, 'failed', mission, outcome.reasons[0])
    return true
  }

  if (job.status === 'failed') {
    const note = job.errorMessage?.trim() || job.errorCode || 'specialist job failed'
    const transient = job.errorClass ? TRANSIENT_CLASSES.has(job.errorClass) : false
    if (transient && row.attempts < limits.maxAttempts) {
      const resubmission =
        spec.kind === 'code-build' || spec.kind === 'document-draft'
          ? await delegateCoding(mission, spec.objective, spec.params.projectName)
          : await delegateMedia(mission, spec.kind, spec.params)
      if (resubmission.ok && resubmission.jobId) {
        await updateRunningTask(mission.id, row.taskId, {
          attempts: row.attempts + 1,
          specialistJobId: resubmission.jobId,
          failureNote: clip(`transient failure, resubmitted: ${note}`, 400),
        })
        return false
      }
    }
    await transitionTask(mission.id, row.taskId, 'running', 'failed', { failureNote: clip(note, 400) })
    await trustStep(row, 'failed', mission, note)
    await trustEvidenceLimitation(mission, `task ${row.taskId} failed: ${note}`)
    return true
  }

  if (job.status === 'cancelled' || job.status === 'rejected') {
    await transitionTask(mission.id, row.taskId, 'running', 'cancelled', { failureNote: clip(job.errorMessage?.trim() || 'specialist job cancelled', 400) })
    await trustStep(row, 'skipped', mission, 'specialist job cancelled')
    return true
  }
  return false // still in progress
}

// ---------------------------------------------------------------------------
// Cancellation propagation
// ---------------------------------------------------------------------------

async function propagateCancellation(mission: MissionRow): Promise<void> {
  for (const row of mission.tasks) {
    const status = row.status as MissionTaskStatus
    if (['done', 'failed', 'skipped', 'cancelled'].includes(status)) continue
    if (status === 'running' && row.specialistJobId) {
      await requestCancel(row.specialistJobId, mission.userId).catch(() => undefined)
    }
    try {
      await transitionTask(mission.id, row.taskId, status, 'cancelled', {
        failureNote: 'Cancelled by the owner; the cancellation propagated to this task.',
      })
      await trustStep(row, 'skipped', mission, 'cancelled')
    } catch {
      /* settled concurrently — leave the honest terminal state */
    }
  }
}

// ---------------------------------------------------------------------------
// The durable run loop
// ---------------------------------------------------------------------------

export async function runMissionJob(claimed: ClaimedJob): Promise<void> {
  let params: { missionId?: string } = {}
  try {
    params = JSON.parse(claimed.paramsJson) as { missionId?: string }
  } catch {
    params = {}
  }
  const mission = params.missionId ? await loadMission(params.missionId) : null
  if (!mission) {
    await finishFailed(claimed.id, claimed.workerId, {
      errorClass: 'permanent',
      errorCode: 'MISSION_NOT_FOUND',
      errorMessage: 'No mission exists for this run.',
    })
    return
  }

  // Terminal mission re-claim (resume after a crash past the settle): the
  // mission's honest outcome is already recorded — settle the driver job.
  if (['completed', 'completed_partial', 'failed', 'cancelled'].includes(mission.status)) {
    await settleJobCompleted(claimed.id, claimed.workerId, {
      missionId: mission.id,
      outcome: mission.status,
      summary: mission.outcomeSummary ?? mission.failureNote ?? 'mission already settled',
    })
    return
  }

  await beginMissionTrust(mission.trustTaskId)
  let missionStatus = mission.status as MissionStatus
  if (missionStatus === 'planned') {
    try {
      await transitionMission(mission.id, 'planned', 'running')
      missionStatus = 'running'
    } catch {
      // Another executor moved it — resume from the ledger's truth.
      const fresh = await loadMission(mission.id)
      if (!fresh || ['completed', 'completed_partial', 'failed', 'cancelled'].includes(fresh.status)) {
        await settleJobCompleted(claimed.id, claimed.workerId, { missionId: mission.id, outcome: fresh?.status ?? 'unknown' })
        return
      }
      missionStatus = fresh.status as MissionStatus
    }
  }

  await trustPlanSteps(mission)

  const deadline = Date.now() + MISSION_LIMITS.missionTimeoutMs

  try {
    for (let round = 0; round < MISSION_LIMITS.maxPollRounds; round++) {
      const current = await loadMission(mission.id)
      if (!current) break
      mission.tasks = current.tasks
      const limitsOf = new Map(mission.tasks.map((t) => [t.taskId, parseLimits(t.limitsJson)]))

      // Cancellation: owner flag (polled every round) propagates everywhere.
      if (current.cancelRequested) {
        await propagateCancellation(current)
        await transitionMission(mission.id, missionStatus, 'cancelled', {
          failureNote: 'Cancelled at your request; active specialist work was signalled to stop.',
        })
        if (mission.trustTaskId) await cancelTrustTask(mission.trustTaskId, 'Cancelled at your request.').catch(() => undefined)
        await settleJobCompleted(claimed.id, claimed.workerId, { missionId: mission.id, outcome: 'cancelled' })
        return
      }

      // Refresh delegated tasks from their REAL durable job rows.
      let changed = false
      for (const row of current.tasks) {
        if (row.status !== 'running') continue
        const spec = specOf(row)
        const delegated = spec.kind !== 'research' && spec.kind !== 'knowledge' && spec.kind !== 'verify-deliverable'
        if (!delegated) continue // inline lanes never persist a running state
        const settled = await refreshDelegatedTask(current, row, spec)
        changed = changed || settled
      }
      if (changed) {
        const fresh = await loadMission(mission.id)
        if (fresh) mission.tasks = fresh.tasks
      }

      // Re-entry: failed tasks whose attempt/correction budgets allow another
      // execution pass go back to running and are (re)started below. This runs
      // BEFORE outcome/skip decisions so a retryable failure is never settled
      // or propagated while it can still honestly recover.
      const liveStates0 = new Map(mission.tasks.map((t) => [t.taskId, t.status as MissionTaskStatus]))
      const reenterable = new Set<string>()
      for (const row of mission.tasks) {
        if (row.status !== 'failed') continue
        const lim = limitsOf.get(row.taskId)!
        // Attempt budget: another full execution pass.
        if (row.attempts < lim.maxAttempts) {
          reenterable.add(row.taskId)
          continue
        }
        // Correction budget: ONLY verification-driven failures get a further
        // correction round (a needs_correction verdict with evidence). A
        // permanent specialist failure with no verification evidence is
        // terminal — retrying it forever would be dishonest noise.
        if (row.verificationResultJson && row.corrections < lim.maxCorrections) {
          try {
            const v = JSON.parse(row.verificationResultJson) as { status?: string }
            if (v.status === 'needs_correction') reenterable.add(row.taskId)
          } catch {
            /* unparseable evidence is terminal */
          }
        }
      }
      const reenterableWas = new Set(reenterable)
      for (const taskId of reenterable) {
        const row = mission.tasks.find((t) => t.taskId === taskId)
        if (!row) continue
        await retryTask(mission.id, taskId, {
          specialistJobId: null,
          failureNote: row.failureNote,
        })
      }
      if (reenterable.size > 0) {
        const fresh = await loadMission(mission.id)
        if (fresh) mission.tasks = fresh.tasks
      }

      // Skip propagation: only failures that CANNOT recover any more skip
      // their downstream (a retryable failure blocks nothing yet).
      const skipStates = new Map(mission.tasks.map((t) => [t.taskId, t.status as MissionTaskStatus]))
      for (const taskId of reenterable) skipStates.set(taskId, 'running')
      for (const skipId of skippedDownstream(mission.tasks.map(specOf), skipStates)) {
        const row = mission.tasks.find((t) => t.taskId === skipId)
        if (!row) continue
        try {
          await transitionTask(mission.id, skipId, row.status as MissionTaskStatus, 'skipped', {
            failureNote: 'An upstream dependency did not complete, so this task never executed.',
          })
        } catch {
          /* settled concurrently */
        }
      }
      const afterSkip = await loadMission(mission.id)
      if (afterSkip) mission.tasks = afterSkip.tasks

      // Outcome decision (pure, from ACTUAL states; retryable failures are
      // treated as still-running so a recoverable mission is never settled
      // prematurely).
      const outcomeStates = new Map(mission.tasks.map((t) => [t.taskId, t.status as MissionTaskStatus]))
      for (const taskId of reenterable) outcomeStates.set(taskId, 'running')
      const decision = decideMissionOutcome(mission.tasks.map(specOf), outcomeStates, mission.deliverableTaskId)
      if (decision.outcome !== 'incomplete') {
        await settleMission(mission, missionStatus, decision.outcome, decision.reason)
        await settleJobCompleted(claimed.id, claimed.workerId, { missionId: mission.id, outcome: decision.outcome })
        return
      }

      // Deadline: stop starting new work; settle what remains honestly.
      if (Date.now() > deadline) {
        for (const row of mission.tasks) {
          const status = row.status as MissionTaskStatus
          if (status === 'running') {
            if (row.specialistJobId) await requestCancel(row.specialistJobId, mission.userId).catch(() => undefined)
            try {
              await transitionTask(mission.id, row.taskId, 'running', 'failed', { failureNote: 'The mission deadline expired while this task was running.' })
            } catch {
              /* settled concurrently */
            }
          } else if (status === 'pending' || status === 'ready' || status === 'failed') {
            try {
              await transitionTask(mission.id, row.taskId, status, 'cancelled', { failureNote: 'The mission ran out of its time budget before this task could finish.' })
            } catch {
              /* settled concurrently */
            }
          }
        }
        const fresh = await loadMission(mission.id)
        const timedOutStates = new Map((fresh?.tasks ?? mission.tasks).map((t) => [t.taskId, t.status as MissionTaskStatus]))
        const timedOutDecision = decideMissionOutcome(mission.tasks.map(specOf), timedOutStates, mission.deliverableTaskId)
        const outcome = timedOutDecision.outcome === 'completed' ? 'completed_partial' : timedOutDecision.outcome === 'incomplete' ? 'failed' : timedOutDecision.outcome
        await settleMission(mission, missionStatus, outcome as MissionStatus, `The mission hit its ${Math.round(MISSION_LIMITS.missionTimeoutMs / 60000)}-minute budget. ${timedOutDecision.reason}`)
        await settleJobCompleted(claimed.id, claimed.workerId, { missionId: mission.id, outcome })
        return
      }

      // Schedule: bounded parallel lanes over the re-entered + ready set.
      const liveStates = new Map(mission.tasks.map((t) => [t.taskId, t.status as MissionTaskStatus]))
      const ready = readyTaskIds(mission.tasks.map(specOf), liveStates)
      // Re-entered tasks are running WITHOUT an active specialist job — they
      // must be (re)started now or they would stall forever.
      const reenteredRunning = mission.tasks
        .filter((t) => t.status === 'running' && reenterableWas.has(t.taskId))
        .map((t) => t.taskId)
      const active = [...liveStates.values()].filter((s) => s === 'running').length - reenteredRunning.length
      const batch = takeParallelBatch([...reenteredRunning, ...ready], Math.max(MISSION_LIMITS.maxParallelTasks - Math.max(active, 0), 0))
      for (const taskId of batch) {
        const row = mission.tasks.find((t) => t.taskId === taskId)
        if (!row) continue
        await startTask(mission, row, specOf(row))
      }

      if (batch.length === 0) {
        const anyActive = mission.tasks.some((t) => t.status === 'running')
        if (!anyActive) {
          // Nothing active and nothing ready — settle from the real states.
          const fresh = await loadMission(mission.id)
          const settleStates = new Map((fresh?.tasks ?? mission.tasks).map((t) => [t.taskId, t.status as MissionTaskStatus]))
          const settleDecision = decideMissionOutcome(mission.tasks.map(specOf), settleStates, mission.deliverableTaskId)
          if (settleDecision.outcome === 'incomplete') {
            // Unreachable work — settle honestly failed, never silently.
            await settleMission(mission, missionStatus, 'failed', settleDecision.reason)
          } else {
            await settleMission(mission, missionStatus, settleDecision.outcome, settleDecision.reason)
          }
          await settleJobCompleted(claimed.id, claimed.workerId, { missionId: mission.id, outcome: settleDecision.outcome })
          return
        }
        await new Promise((r) => setTimeout(r, MISSION_LIMITS.pollIntervalMs))
      }
    }

    // Round cap: honest timeout settlement.
    const fresh = await loadMission(mission.id)
    const capStates = new Map((fresh?.tasks ?? mission.tasks).map((t) => [t.taskId, t.status as MissionTaskStatus]))
    await settleMission(mission, missionStatus, 'failed', 'The mission runner reached its scheduling round cap; remaining work was not executed.')
    void capStates
    await settleJobCompleted(claimed.id, claimed.workerId, { missionId: mission.id, outcome: 'failed' })
  } catch (e) {
    // Crash-style exit: leave the mission running — engine lease recovery
    // re-claims the driver job and this executor resumes from the ledger.
    const message = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)
    await finishFailed(claimed.id, claimed.workerId, {
      errorClass: 'unknown',
      errorCode: 'MISSION_RUNNER_ERROR',
      errorMessage: message,
    }).catch(() => undefined)
    throw e
  }
}

/** Settle the mission row + Trust ledger from ACTUAL evidence. */
async function settleMission(
  mission: MissionRow,
  from: MissionStatus,
  outcome: MissionStatus,
  reason: string,
): Promise<void> {
  const verifiedTasks = mission.tasks.filter((t) => t.verificationResultJson?.includes('"verified"')).length
  const totalTasks = mission.tasks.length
  const summary =
    outcome === 'completed'
      ? clip(`All ${totalTasks} tasks completed and verified. ${reason}`, 600)
      : outcome === 'completed_partial'
        ? clip(`The deliverable is complete and verified; ${totalTasks - verifiedTasks} of ${totalTasks} supporting task(s) did not finish. ${reason}`, 600)
        : outcome === 'cancelled'
          ? clip(reason, 600)
          : clip(`The mission did not complete: ${reason}`, 600)
  try {
    await transitionMission(mission.id, from, outcome, {
      ...(outcome === 'failed' || outcome === 'cancelled' ? { failureNote: summary } : { outcomeSummary: summary }),
    })
  } catch (e) {
    if (e instanceof TrustStateMissionError && from !== 'running') {
      // planned → terminal direct settle (never ran a task)
      await transitionMission(mission.id, 'planned', outcome, {
        ...(outcome === 'failed' || outcome === 'cancelled' ? { failureNote: summary } : { outcomeSummary: summary }),
      })
    } else {
      throw e
    }
  }
  if (!mission.trustTaskId) return
  const verification =
    `task ledger: ${verifiedTasks}/${totalTasks} verified; ` +
    mission.tasks.map((t) => `${t.taskId}=${t.status}`).join(', ')
  try {
    if (outcome === 'completed' || outcome === 'completed_partial') {
      await finalizeTrustTask(mission.trustTaskId, {
        outcome: outcome === 'completed' ? 'completed' : 'partially_completed',
        outcomeSummary: summary,
        verificationSummary: clip(verification, 600),
        limitations: outcome === 'completed_partial' ? [clip(reason, 300)] : [],
      })
    } else if (outcome === 'failed') {
      await failTrustTask(mission.trustTaskId, {
        failureNote: clip(summary, 600),
        verificationSummary: clip(verification, 600),
      })
    } else if (outcome === 'cancelled') {
      await cancelTrustTask(mission.trustTaskId, clip(summary, 600))
    }
  } catch {
    /* the Trust ledger is append-only and bounds-checked; the mission row
       already carries the honest outcome */
  }
}

/** Test/ops seam: which mission task kinds execute inline vs delegated. */
export const INLINE_TASK_KINDS: readonly MissionTaskKind[] = ['research', 'knowledge', 'verify-deliverable']
export const DELEGATED_TASK_KINDS: readonly MissionTaskKind[] = ['code-build', 'document-draft', 'image-asset', 'video-asset', 'audio-asset']
