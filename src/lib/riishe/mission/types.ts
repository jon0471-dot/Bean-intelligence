/**
 * BEAN Intelligence — M41 autonomous multi-agent MISSION contracts (pure).
 *
 * A MISSION is RIISHE's durable, structured decomposition of ONE complex
 * multi-part user objective into a dependency-ordered task graph (DAG) of
 * specialist tasks. RIISHE plans the mission, executes its tasks through the
 * EXISTING specialist execution paths (CODE GIFTZ engineering workflow,
 * LAXII/JAZMII/GANGZII durable specialist jobs, the real retrieval tools,
 * the Knowledge Atlas), verifies every real output, recovers from supported
 * failures and delivers one coherent result.
 *
 * NOT a second agent framework:
 *  - there is exactly ONE planning surface (this module's deterministic
 *    planner — no second model call, no uncontrolled agent-to-agent chat);
 *  - there is exactly ONE execution substrate (the existing durable
 *    GenerationJob engine + the existing delegation submit paths);
 *  - there is exactly ONE provenance ledger (the existing Trust Engine).
 *
 * Every task carries an explicit objective, inputs, expected output,
 * dependencies, authorization scope, execution status, verification
 * criteria and resource limits — enforced HERE, not by caller discipline.
 *
 * PURE module — no database, no I/O. SERVER-ONLY consumers.
 */

// ---------------------------------------------------------------------------
// Specialist agents (fixed vocabulary — the existing BEAN products)
// ---------------------------------------------------------------------------

export type SpecialistAgent =
  | 'riishe' // central intelligence: planning, routing, verification, delivery
  | 'code-giftz' // engineering specialist (real coding jobs)
  | 'laxii' // visual specialist (real image jobs)
  | 'jazmii' // video/motion specialist (real video jobs)
  | 'gangzii' // audio specialist (real speech/audio jobs)
  | 'knowledge' // retrieval specialist: live research tools + Knowledge Atlas
  | 'quality' // verification specialist: deterministic output inspection

// ---------------------------------------------------------------------------
// Task kinds — each maps to exactly ONE real execution path. There is NO
// kind that writes outside the user's own resources, publishes, deploys,
// or communicates externally: destructive and irreversible actions are
// structurally absent from the vocabulary, so a mission can never grow one.
// ---------------------------------------------------------------------------

export const MISSION_TASK_KINDS = [
  /** CODE GIFTZ engineering job: architect, build, fix, verify project files. */
  'code-build',
  /** CODE GIFTZ engineering job producing a document deliverable (with a
   *  research handoff appended to the objective when sources exist). */
  'document-draft',
  /** LAXII image-creation job (validated visual asset). */
  'image-asset',
  /** JAZMII text-to-video job (real video asset). */
  'video-asset',
  /** GANGZII speech-synthesis job (validated audio asset). */
  'audio-asset',
  /** Real live retrieval through the existing web_search/read_url lanes. */
  'research',
  /** Knowledge Atlas consultation (existing atlas tools). */
  'knowledge',
  /** Quality gate: deterministic integrity inspection of the final
   *  deliverable chain (the verification specialist's execution path). */
  'verify-deliverable',
] as const

export type MissionTaskKind = (typeof MISSION_TASK_KINDS)[number]

/** Fixed kind→agent routing. Deterministic; the planner cannot invent pairs. */
export const KIND_AGENT: Record<MissionTaskKind, SpecialistAgent> = {
  'code-build': 'code-giftz',
  'document-draft': 'code-giftz',
  'image-asset': 'laxii',
  'video-asset': 'jazmii',
  'audio-asset': 'gangzii',
  research: 'knowledge',
  knowledge: 'knowledge',
  'verify-deliverable': 'quality',
}

// ---------------------------------------------------------------------------
// Authorization scopes — bounded. Each scope names the ONLY resources a task
// may touch; the executor enforces the mapping (M41 §5). There is
// deliberately NO scope for deletion, publishing, deployment or external
// communication.
// ---------------------------------------------------------------------------

export const MISSION_AUTH_SCOPES = [
  /** Write files inside ONE user-owned engineering project (real diffs,
   *  versioned, rollback available; no rename/move/delete of existing files). */
  'project-write',
  /** Create new media assets under the user's own account. */
  'asset-create',
  /** Read-only live retrieval (authorized gateway lanes) + Knowledge Atlas. */
  'retrieval-read',
  /** Read-only integrity inspection of artifacts this mission produced. */
  'mission-inspect',
] as const

export type MissionAuthScope = (typeof MISSION_AUTH_SCOPES)[number]

/** Fixed kind→scope mapping. The planner cannot assign a wider scope. */
export const KIND_AUTH_SCOPE: Record<MissionTaskKind, MissionAuthScope> = {
  'code-build': 'project-write',
  'document-draft': 'project-write',
  'image-asset': 'asset-create',
  'video-asset': 'asset-create',
  'audio-asset': 'asset-create',
  research: 'retrieval-read',
  knowledge: 'retrieval-read',
  'verify-deliverable': 'mission-inspect',
}

// ---------------------------------------------------------------------------
// Verification criteria — the honest contract a task output must satisfy
// before the executor may mark it done. Deterministic; verifiers (pure)
// decide from the REAL execution payloads, never from model claims.
// ---------------------------------------------------------------------------

/** M41.7: what KIND of deliverable a coding task produces — decides which
 *  persisted-deliverable verifier inspects the real files. Absent on legacy
 *  rows (parsed as the kind-derived default: document-draft → document,
 *  code-build → code). */
export type MissionDeliverableKind = 'document' | 'website' | 'code'

export interface VerificationCriteria {
  /** Specialist job self-verification must report success (coding jobs). */
  requireSelfVerification?: boolean
  /** Restricted-sandbox run must have exited 0 (coding jobs). */
  requireSandboxPass?: boolean
  /** At least N real file changes must exist (coding/document jobs). */
  minFileChanges?: number
  /** At least N REAL sources must stand behind a research output. */
  minSources?: number
  /** A servable artifact (image/video/audio) must exist in the job result. */
  requireArtifact?: boolean
  /** Audio must carry the worker's deterministic validation flag. */
  requireAudioValidation?: boolean
  /** The deliverable must cite at least one handed-off source. */
  requireSourceCitation?: boolean
  /** The named deliverable file path (document/code deliverables). */
  deliverablePath?: string
  /** M41.7: the deliverable category — dispatches the persisted-file
   *  verifier ('website' gains the static-structure audit, 'document' the
   *  document + citation audit). Derived from the task kind when absent. */
  deliverableKind?: MissionDeliverableKind
  /** M41.7: project files that MUST exist in the persisted workspace
   *  (website entry points). Bounded set; validated paths. */
  requiredPaths?: string[]
  /** M41.7: section headings that MUST appear in a document deliverable
   *  (e.g. 'Sources' when citations are required). Matched case-insensitively
   *  as markdown headings. */
  requiredSections?: string[]
}

// ---------------------------------------------------------------------------
// Resource limits — every task is bounded before it exists.
// ---------------------------------------------------------------------------

export interface TaskResourceLimits {
  /** Hard per-execution wait bound for the delegated specialist job (ms). */
  executionTimeoutMs: number
  /** Bounded retries of the specialist submission itself (0-2). */
  maxAttempts: number
  /** Bounded correction rounds after a needs_correction verification (0-1). */
  maxCorrections: number
}

export const TASK_LIMIT_CAPS: TaskResourceLimits = {
  executionTimeoutMs: 20 * 60_000,
  maxAttempts: 2,
  maxCorrections: 1,
}

export const TASK_LIMIT_DEFAULTS: TaskResourceLimits = {
  executionTimeoutMs: 10 * 60_000,
  maxAttempts: 1,
  maxCorrections: 1,
}

/** Normalize user/planner-supplied limits into the hard caps. */
export function normalizeLimits(limits?: Partial<TaskResourceLimits>): TaskResourceLimits {
  const d = TASK_LIMIT_DEFAULTS
  return {
    executionTimeoutMs: Math.min(
      Math.max(limits?.executionTimeoutMs ?? d.executionTimeoutMs, 10_000),
      TASK_LIMIT_CAPS.executionTimeoutMs,
    ),
    maxAttempts: Math.min(Math.max(limits?.maxAttempts ?? d.maxAttempts, 1), TASK_LIMIT_CAPS.maxAttempts),
    maxCorrections: Math.min(Math.max(limits?.maxCorrections ?? d.maxCorrections, 0), TASK_LIMIT_CAPS.maxCorrections),
  }
}

// ---------------------------------------------------------------------------
// Mission type — the canonical multi-agent workflows (M41 §3).
// ---------------------------------------------------------------------------

export const MISSION_TYPES = ['website-build', 'media-production', 'research-document', 'debug-app'] as const

export type MissionType = (typeof MISSION_TYPES)[number]

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const MISSION_STATUSES = ['planned', 'running', 'completed', 'completed_partial', 'failed', 'cancelled'] as const

export type MissionStatus = (typeof MISSION_STATUSES)[number]

const MISSION_TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  planned: ['running', 'cancelled', 'failed'],
  running: ['completed', 'completed_partial', 'failed', 'cancelled'],
  completed: [],
  completed_partial: [],
  failed: [],
  cancelled: [],
}

export function canTransitionMission(from: MissionStatus, to: MissionStatus): boolean {
  return MISSION_TRANSITIONS[from]?.includes(to) ?? false
}

export function isTerminalMission(status: string): boolean {
  return ['completed', 'completed_partial', 'failed', 'cancelled'].includes(status)
}

export const MISSION_TASK_STATUSES = [
  'pending', // dependencies not yet satisfied
  'ready', // dependencies done — schedulable
  'running', // delegated or executing right now
  'done', // executed AND verified against its criteria
  'failed', // honest failure with a real reason
  'skipped', // an upstream dependency failed/was skipped — never executed
  'cancelled', // cancellation propagated before execution
] as const

export type MissionTaskStatus = (typeof MISSION_TASK_STATUSES)[number]

const TASK_TRANSITIONS: Record<MissionTaskStatus, readonly MissionTaskStatus[]> = {
  // pending → running is the scheduler's direct execution edge (readiness is
  // decided by the DAG kernel, not by a separate ready write).
  pending: ['ready', 'running', 'skipped', 'cancelled'],
  ready: ['running', 'skipped', 'cancelled'],
  running: ['done', 'failed', 'skipped', 'cancelled'],
  done: [],
  failed: ['running'], // bounded correction retry re-enters execution
  skipped: [],
  cancelled: [],
}

export function canTransitionTask(from: MissionTaskStatus, to: MissionTaskStatus): boolean {
  return TASK_TRANSITIONS[from]?.includes(to) ?? false
}

/** A failed task may re-enter execution only within its attempt budget. */
export function canRetryTask(status: MissionTaskStatus, attempts: number, limits: TaskResourceLimits): boolean {
  return status === 'failed' && attempts < limits.maxAttempts
}

// ---------------------------------------------------------------------------
// Task spec — the complete executable contract.
// ---------------------------------------------------------------------------

export interface MissionTaskSpec {
  /** Stable id inside the mission ('t1'…). Referenced by dependsOn. */
  id: string
  kind: MissionTaskKind
  /** Derives deterministically from kind (KIND_AGENT). Kept explicit on the
   *  spec for auditability; buildTaskSpec() enforces the fixed mapping. */
  agent: SpecialistAgent
  /** Short customer-safe title (bounded). */
  title: string
  /** Complete execution instruction for the specialist (bounded). */
  objective: string
  /** Task-local parameters (prompt, query, size…), validated per kind. */
  params: Record<string, string>
  /** What a correct result looks like — the verifier's contract. */
  expectedOutput: string
  /** Ids of tasks whose verified outputs this task consumes. */
  dependsOn: string[]
  /** Derives deterministically from kind (KIND_AUTH_SCOPE). */
  authScope: MissionAuthScope
  verification: VerificationCriteria
  limits: TaskResourceLimits
}

export interface MissionTaskInputRef {
  /** Producing task id (must exist and be a dependency of the consumer). */
  fromTaskId: string
  /** The part of the producer's verified output being handed off. */
  artifact: 'research-pack' | 'code-project' | 'image-asset' | 'video-asset' | 'audio-asset'
}

// ---------------------------------------------------------------------------
// Bounded-size contracts (mirrors the Trust Engine's field discipline).
// ---------------------------------------------------------------------------

export const MISSION_LIMITS = {
  objectiveChars: 4000,
  titleChars: 120,
  taskObjectiveChars: 4000,
  expectedOutputChars: 600,
  paramValueChars: 4000,
  maxTasks: 10,
  maxDependenciesPerTask: 6,
  maxParallelTasks: 3,
  /** Global wall-clock bound for one mission execution (ms). */
  missionTimeoutMs: 45 * 60_000,
  /** Poll window between specialist-job status checks (ms). */
  pollIntervalMs: 3_000,
  /** Max poll rounds before a running specialist task is declared stalled. */
  maxPollRounds: 400,
} as const

// ---------------------------------------------------------------------------
// Planned mission — planner output.
// ---------------------------------------------------------------------------

export interface MissionPlan {
  ok: true
  missionType: MissionType
  /** Customer-safe summary of what was detected (logged; shown honestly). */
  detected: string[]
  /** The deliverable-producing task: mission success stands on THIS task. */
  deliverableTaskId: string
  tasks: MissionTaskSpec[]
}

export interface MissionPlanRefusal {
  ok: false
  /** Truthful, customer-safe reason (e.g. single-domain request). */
  reason: string
}

export type MissionPlanResult = MissionPlan | MissionPlanRefusal

// ---------------------------------------------------------------------------
// Structured builder — the ONLY way to obtain a MissionTaskSpec. It derives
// agent + authScope from the kind (no caller can widen either), validates
// bounds, and normalizes resource limits into the caps.
// ---------------------------------------------------------------------------

export class MissionContractError extends Error {}

export function buildTaskSpec(input: {
  id: string
  kind: MissionTaskKind
  title: string
  objective: string
  params?: Record<string, string>
  expectedOutput: string
  dependsOn?: string[]
  verification?: VerificationCriteria
  limits?: Partial<TaskResourceLimits>
}): MissionTaskSpec {
  const id = input.id.trim()
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) {
    throw new MissionContractError(`Task id "${id.slice(0, 32)}" must be a short slug (a-z0-9).`)
  }
  const title = input.title.trim()
  if (title.length === 0 || title.length > MISSION_LIMITS.titleChars) {
    throw new MissionContractError(`Task title must be 1-${MISSION_LIMITS.titleChars} characters.`)
  }
  const objective = input.objective.trim()
  if (objective.length < 3 || objective.length > MISSION_LIMITS.taskObjectiveChars) {
    throw new MissionContractError(`Task objective must be 3-${MISSION_LIMITS.taskObjectiveChars} characters.`)
  }
  const expectedOutput = input.expectedOutput.trim()
  if (expectedOutput.length < 3 || expectedOutput.length > MISSION_LIMITS.expectedOutputChars) {
    throw new MissionContractError(`Task expectedOutput must be 3-${MISSION_LIMITS.expectedOutputChars} characters.`)
  }
  const params: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.params ?? {})) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(k)) {
      throw new MissionContractError(`Task param key "${k.slice(0, 32)}" is not a safe identifier.`)
    }
    if (typeof v !== 'string' || v.length > MISSION_LIMITS.paramValueChars) {
      throw new MissionContractError(`Task param "${k}" exceeds its ${MISSION_LIMITS.paramValueChars}-character bound.`)
    }
    params[k] = v
  }
  const dependsOn = [...new Set(input.dependsOn ?? [])]
  if (dependsOn.length > MISSION_LIMITS.maxDependenciesPerTask) {
    throw new MissionContractError(`Task "${id}" exceeds ${MISSION_LIMITS.maxDependenciesPerTask} dependencies.`)
  }
  for (const dep of dependsOn) {
    if (dep === id) throw new MissionContractError(`Task "${id}" cannot depend on itself.`)
  }
  return {
    id,
    kind: input.kind,
    agent: KIND_AGENT[input.kind],
    title,
    objective,
    params,
    expectedOutput,
    dependsOn,
    authScope: KIND_AUTH_SCOPE[input.kind],
    verification: normalizeVerificationCriteria(input.kind, input.verification ?? {}),
    limits: normalizeLimits(input.limits),
  }
}

// ---------------------------------------------------------------------------
// M41.7 — verification-criteria normalization. Bounded, path-safe, and the
// deliverable kind can never contradict the task kind (a document-draft task
// can never become a 'website' and vice versa). The verifier trusts ONLY
// criteria that passed through here.
// ---------------------------------------------------------------------------

const CRITERIA_PATH_RE = /^[\w][\w.\-/ ]{0,198}\.[a-zA-Z0-9]{1,8}$/

function normalizeVerificationCriteria(kind: MissionTaskKind, criteria: VerificationCriteria): VerificationCriteria {
  const kindDefault: MissionDeliverableKind = kind === 'document-draft' ? 'document' : 'code'
  const requested = criteria.deliverableKind ?? kindDefault
  // A code-build may be a website OR plain code; a document-draft is always
  // a document. Anything else is a contract error, never silently accepted.
  const deliverableKind: MissionDeliverableKind =
    kind === 'document-draft'
      ? requested === 'document' ? 'document' : (() => { throw new MissionContractError('A document-draft task cannot declare a non-document deliverable kind.') })()
      : requested === 'website' || requested === 'code' ? requested : (() => { throw new MissionContractError('A code-build task cannot declare a document deliverable kind.') })()
  const cleanPaths = (list: string[] | undefined, max: number): string[] | undefined => {
    if (!list || list.length === 0) return undefined
    const bounded = list.slice(0, max)
    for (const p of bounded) {
      if (!CRITERIA_PATH_RE.test(p) || p.includes('..')) {
        throw new MissionContractError(`Verification path "${p.slice(0, 60)}" is not a safe project-relative file path.`)
      }
    }
    return bounded
  }
  const cleanSections = (list: string[] | undefined): string[] | undefined => {
    if (!list || list.length === 0) return undefined
    const bounded = list.slice(0, 6).map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 80)
    return bounded.length > 0 ? bounded : undefined
  }
  return {
    ...criteria,
    deliverableKind,
    ...(deliverableKind === 'website' ? { requiredPaths: cleanPaths(criteria.requiredPaths, 6) ?? ['index.html'] } : {}),
    ...(deliverableKind === 'document' ? { requiredSections: cleanSections(criteria.requiredSections) } : {}),
  }
}

// ---------------------------------------------------------------------------
// Execution-side shapes (shared by store/executor/verifiers).
// ---------------------------------------------------------------------------

/** One real artifact reference produced by a verified task. */
export interface MissionArtifact {
  artifact: MissionTaskInputRef['artifact']
  /** Producing task id. */
  taskId: string
  /** Customer-safe ref (project id, asset id, source URL). */
  ref: string
  /** Customer-safe label (project title, file path, source title). */
  label: string
}

export interface TaskVerificationOutcome {
  status: 'verified' | 'failed' | 'needs_correction'
  /** Deterministic reasons derived from the real output. */
  reasons: string[]
  /** Real artifacts admitted by verification. */
  artifacts: MissionArtifact[]
}

/** Test/ops seam: the fixed kind→agent routing (registration order). */
export const MISSION_KIND_AGENT_SEAM: ReadonlyArray<{
  kind: MissionTaskKind
  agent: SpecialistAgent
  scope: MissionAuthScope
}> = MISSION_TASK_KINDS.map((k) => ({ kind: k, agent: KIND_AGENT[k], scope: KIND_AUTH_SCOPE[k] }))
