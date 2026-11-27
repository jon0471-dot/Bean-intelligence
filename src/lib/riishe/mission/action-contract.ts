/**
 * BEAN Intelligence — M44 Phase 2: typed action contracts (pure).
 *
 * The action-planning layer BETWEEN the M41 mission planner and execution.
 * It does NOT replace the mission engine: an action contract is the auditable
 * executable wrapper around ONE concrete action (including the actions the
 * mission planner already emits), carrying exactly what execution, approval
 * and verification need:
 *
 *   - typed preconditions and postconditions (deterministic descriptors —
 *     the Phase-5 verifier evaluates them against real state, never against
 *     the executor's own claim);
 *   - risk class + reversibility (the Phase-3 authorization gate reads them;
 *     the requirement they imply is DERIVED here and cannot be lowered);
 *   - idempotency key (duplicate side effects are structurally prevented);
 *   - bounded retry policy, timeout, cancellation support;
 *   - checkpoint and recovery hooks (Phase 6 consumes them);
 *   - a canonical plan digest so an approval binds to the EXACT plan
 *     (reuses the Trust Engine's canonical hashing — one digest discipline).
 *
 * Honesty rule: the contract vocabulary DESCRIBES every risk class —
 * including irreversible/external/financial/sensitive — because the
 * authorization layer must recognize and gate them. Execution paths, however,
 * exist only for what BEAN can really do through its existing approved tools;
 * an action type with no real execution path is refused honestly, never
 * simulated.
 *
 * PURE module — no database, no I/O. SERVER-ONLY consumers.
 */

import { canonicalJson, sha256Hex } from '@/lib/trust/digest'
import type { DecisionRiskClass, Reversibility } from './decision'
import type { MissionTaskSpec } from './types'

// ---------------------------------------------------------------------------
// Action types — the concrete, real execution/verification vocabulary.
// ---------------------------------------------------------------------------

export const ACTION_TYPES = [
  /** Read-only file inspection inside an authorized workspace. */
  'file-read',
  /** Create/overwrite a file inside ONE user-owned project (versioned). */
  'file-write',
  /** A CODE GIFTZ engineering job (build/fix with real file changes). */
  'code-build',
  /** A media production job (image/video/audio through the real specialists). */
  'media-produce',
  /** Live retrieval through the guarded research lanes (read-only). */
  'research-fetch',
  /** A repository commit on a NON-protected branch the user owns. */
  'repo-commit',
  /** A push of an existing user-owned branch to its remote (never force). */
  'repo-push',
  /** Serving/verifying a generated website artifact. */
  'website-publish-verify',
  /** A deployment-style release of the user's own project (approval-gated). */
  'deployment-release',
  /** Any external communication/publication (approval-gated; no hidden path). */
  'external-communicate',
] as const

export type ActionType = (typeof ACTION_TYPES)[number]

/** Fixed type→risk routing. The planner cannot widen a risk class. */
export const TYPE_RISK: Record<ActionType, DecisionRiskClass> = {
  'file-read': 'read-only',
  'file-write': 'reversible',
  'code-build': 'reversible',
  'media-produce': 'reversible',
  'research-fetch': 'read-only',
  'repo-commit': 'reversible',
  'repo-push': 'irreversible',
  'website-publish-verify': 'reversible',
  'deployment-release': 'irreversible',
  'external-communicate': 'external-communication',
}

/** Fixed type→reversibility routing (audit copy; the contract carries both). */
export const TYPE_REVERSIBILITY: Record<ActionType, Reversibility> = {
  'file-read': 'reversible',
  'file-write': 'reversible',
  'code-build': 'reversible',
  'media-produce': 'reversible',
  'research-fetch': 'reversible',
  'repo-commit': 'compensable', // a commit can be reverted by a compensating commit
  'repo-push': 'irreversible', // publication cannot be reliably undone
  'website-publish-verify': 'compensable',
  'deployment-release': 'irreversible',
  'external-communicate': 'irreversible',
}

// ---------------------------------------------------------------------------
// Authorization requirement — derived, never caller-lowered.
// ---------------------------------------------------------------------------

export type ApprovalRequirement = 'none' | 'self' | 'human'

const RISK_REQUIREMENT: Record<DecisionRiskClass, ApprovalRequirement> = {
  'read-only': 'none',
  reversible: 'self',
  irreversible: 'human',
  'external-communication': 'human',
  financial: 'human',
  'sensitive-data': 'human',
}

export function requirementForRisk(risk: DecisionRiskClass): ApprovalRequirement {
  return RISK_REQUIREMENT[risk] ?? 'human'
}

// ---------------------------------------------------------------------------
// Postcondition / precondition descriptors — deterministic and typed.
// ---------------------------------------------------------------------------

export const POSTCONDITION_KINDS = [
  'file-exists', // params.path exists in the workspace
  'file-contains', // params.path contains params.text
  'file-absent', // params.path does NOT exist
  'artifact-exists', // a servable artifact ref exists (media/code outputs)
  'artifact-min-bytes', // artifact bytes ≥ params.minBytes
  'commit-present', // a commit with params.sha exists on params.branch
  'remote-ref-equals', // remote params.remote ref equals params.sha
  'url-status', // params.url responds with params.status
  'health-ok', // params.url health endpoint reports healthy
  'sources-min', // research output carries ≥ params.minSources real sources
  'value-equals', // observed params.observed equals params.expected
  'no-duplicate-effect', // the idempotency ledger shows exactly params.maxRuns runs
] as const

export type PostconditionKind = (typeof POSTCONDITION_KINDS)[number]

export interface PostconditionSpec {
  kind: PostconditionKind
  /** Bounded descriptor params (strings only; validated below). */
  params: Record<string, string>
  /** Customer-safe description of what this check proves. */
  description: string
  /** Whether verification MUST use a method independent of the executor. */
  requireIndependentMethod: boolean
}

// ---------------------------------------------------------------------------
// The action contract.
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Bounded attempts INCLUDING the first (1–3). */
  maxAttempts: number
  /** Base backoff between attempts (ms, bounded). */
  backoffMs: number
  /** Retries are allowed ONLY for failures classified transient (Phase 6). */
  retryOnlyTransient: true
}

export interface ActionContract {
  id: string
  actionType: ActionType
  title: string
  /** Complete execution instruction for the real path (bounded). */
  description: string
  params: Record<string, string>
  /** Must ALL hold before execution starts (else the action is BLOCKED). */
  preconditions: PostconditionSpec[]
  /** Must ALL hold after execution (Phase-5 verdict decides success). */
  postconditions: PostconditionSpec[]
  riskClass: DecisionRiskClass
  reversibility: Reversibility
  /** Derived from riskClass — never caller-lowered. */
  requiresApproval: ApprovalRequirement
  /** The authorization scope this action consumes (M41 scope vocabulary). */
  authScope: string
  /** Stable key making duplicate side effects detectable (required for
   *  every non-read-only action). */
  idempotencyKey: string
  retry: RetryPolicy
  timeoutMs: number
  /** Whether mid-execution cancellation is supported by the real path. */
  cancellation: 'supported' | 'not-supported-after-commit-point'
  /** Write a recovery checkpoint after this action completes. */
  checkpointAfter: boolean
  /** The plan version this contract belongs to (digest-bound). A contract
   *  built outside a plan carries the 'pending-plan-digest' sentinel and can
   *  never be approved in that state (Phase 3 rejects it). */
  planVersion: string
  /** Actions that must complete first (dependency-aware planning). */
  dependsOn: string[]
}

export class ActionContractError extends Error {}

// ---------------------------------------------------------------------------
// Bounds — every contract is bounded before it exists.
// ---------------------------------------------------------------------------

export const ACTION_LIMITS = {
  titleChars: 120,
  descriptionChars: 4000,
  paramValueChars: 2000,
  maxParams: 12,
  maxPreconditions: 6,
  maxPostconditions: 6,
  maxDependencies: 6,
  idempotencyKeyChars: 96,
  minTimeoutMs: 10_000,
  maxTimeoutMs: 20 * 60_000,
  maxAttempts: 3,
  maxBackoffMs: 30_000,
} as const

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const KEY_RE = /^[a-z0-9][a-z0-9:_.-]{0,95}$/
const VERSION_RE = /^[a-f0-9]{8,64}$/

function cleanPostconditions(list: PostconditionSpec[] | undefined, max: number): PostconditionSpec[] {
  const bounded = (list ?? []).slice(0, max)
  for (const p of bounded) {
    if (!POSTCONDITION_KINDS.includes(p.kind)) {
      throw new ActionContractError(`Unknown postcondition kind "${String(p.kind).slice(0, 32)}".`)
    }
    for (const [k, v] of Object.entries(p.params ?? {})) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(k) || typeof v !== 'string' || v.length > 300) {
        throw new ActionContractError(`Postcondition "${p.kind}" has an invalid param "${String(k).slice(0, 32)}".`)
      }
    }
    const desc = (p.description ?? '').trim()
    if (desc.length < 3 || desc.length > 300) {
      throw new ActionContractError(`Postcondition "${p.kind}" needs a 3-300 character description.`)
    }
  }
  return bounded
}

/**
 * The ONLY way to obtain an ActionContract. Derives riskClass/reversibility/
 * approval requirement from the action type (a caller can neither widen the
 * risk class nor lower the approval requirement), validates bounds, and
 * enforces the idempotency rule: every side-effectful action carries a key.
 */
export function buildActionContract(input: {
  id: string
  actionType: ActionType
  title: string
  description: string
  params?: Record<string, string>
  preconditions?: PostconditionSpec[]
  postconditions?: PostconditionSpec[]
  authScope: string
  idempotencyKey?: string
  retry?: Partial<Pick<RetryPolicy, 'maxAttempts' | 'backoffMs'>>
  timeoutMs?: number
  cancellation?: ActionContract['cancellation']
  checkpointAfter?: boolean
  planVersion?: string
  dependsOn?: string[]
}): ActionContract {
  const id = input.id.trim()
  if (!ID_RE.test(id)) throw new ActionContractError(`Action id "${id.slice(0, 32)}" must be a short slug (a-z0-9).`)
  const title = input.title.trim()
  if (title.length < 3 || title.length > ACTION_LIMITS.titleChars) {
    throw new ActionContractError(`Action title must be 3-${ACTION_LIMITS.titleChars} characters.`)
  }
  const description = input.description.trim()
  if (description.length < 3 || description.length > ACTION_LIMITS.descriptionChars) {
    throw new ActionContractError(`Action description must be 3-${ACTION_LIMITS.descriptionChars} characters.`)
  }
  if (input.planVersion !== undefined && input.planVersion !== 'pending-plan-digest' && !VERSION_RE.test(input.planVersion)) {
    throw new ActionContractError('planVersion must be the plan digest (8-64 hex characters) or omitted for plan-bound contracts.')
  }
  const params: Record<string, string> = {}
  for (const [k, v] of Object.entries(input.params ?? {}).slice(0, ACTION_LIMITS.maxParams)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(k)) throw new ActionContractError(`Param key "${k.slice(0, 32)}" is not a safe identifier.`)
    if (typeof v !== 'string' || v.length > ACTION_LIMITS.paramValueChars) {
      throw new ActionContractError(`Param "${k}" exceeds its ${ACTION_LIMITS.paramValueChars}-character bound.`)
    }
    params[k] = v
  }
  const riskClass = TYPE_RISK[input.actionType]
  const reversibility = TYPE_REVERSIBILITY[input.actionType]
  const key = (input.idempotencyKey ?? '').trim()
  if (riskClass !== 'read-only' && key.length === 0) {
    throw new ActionContractError(`A "${riskClass}" action requires an idempotencyKey — duplicate side effects must be detectable.`)
  }
  if (key.length > 0 && !KEY_RE.test(key)) {
    throw new ActionContractError('idempotencyKey must be a bounded slug (a-z0-9:_.-).')
  }
  const dependsOn = [...new Set(input.dependsOn ?? [])]
  if (dependsOn.length > ACTION_LIMITS.maxDependencies) {
    throw new ActionContractError(`Action "${id}" exceeds ${ACTION_LIMITS.maxDependencies} dependencies.`)
  }
  if (dependsOn.includes(id)) throw new ActionContractError(`Action "${id}" cannot depend on itself.`)
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 10 * 60_000, ACTION_LIMITS.minTimeoutMs), ACTION_LIMITS.maxTimeoutMs)
  return {
    id,
    actionType: input.actionType,
    title,
    description,
    params,
    preconditions: cleanPostconditions(input.preconditions, ACTION_LIMITS.maxPreconditions),
    postconditions: cleanPostconditions(input.postconditions, ACTION_LIMITS.maxPostconditions),
    riskClass,
    reversibility,
    requiresApproval: requirementForRisk(riskClass),
    authScope: input.authScope,
    idempotencyKey: key,
    retry: {
      maxAttempts: Math.min(Math.max(input.retry?.maxAttempts ?? 1, 1), ACTION_LIMITS.maxAttempts),
      backoffMs: Math.min(Math.max(input.retry?.backoffMs ?? 1_000, 0), ACTION_LIMITS.maxBackoffMs),
      retryOnlyTransient: true,
    },
    timeoutMs,
    cancellation: input.cancellation ?? 'supported',
    checkpointAfter: input.checkpointAfter ?? reversibility !== 'irreversible',
    planVersion: input.planVersion ?? 'pending-plan-digest',
    dependsOn,
  }
}

// ---------------------------------------------------------------------------
// Plans — inspectable, digest-bound, approval-ready.
// ---------------------------------------------------------------------------

export interface ActionPlan {
  planVersion: string
  objective: string
  contracts: ActionContract[]
  /** Canonical digest over the plan content — approvals bind to this. */
  digest: string
}

/** Canonical, dependency-ordered plan construction with a content digest.
 *  The digest covers the plan CONTENT (contracts without their planVersion
 *  field — it is derived FROM the digest), and every contract copy is then
 *  stamped with it, binding contracts to the exact plan they belong to. */
export function buildActionPlan(objective: string, contracts: ActionContract[]): ActionPlan {
  const ids = new Set(contracts.map((c) => c.id))
  for (const c of contracts) {
    for (const dep of c.dependsOn) {
      if (!ids.has(dep)) throw new ActionContractError(`Action "${c.id}" depends on unknown action "${dep}".`)
    }
  }
  const ordered = [...contracts].sort((a, b) => (a.id < b.id ? -1 : 1))
  const digest = sha256Hex(canonicalJson({ contracts: ordered.map(({ planVersion: _pv, ...rest }) => rest), objective }))
  const planVersion = digest.slice(0, 32)
  return {
    planVersion,
    objective: objective.slice(0, 4000),
    contracts: ordered.map((c) => ({ ...c, planVersion })),
    digest,
  }
}

/** Detect ANY deviation between an approval-bound plan and a live plan. */
export function planChanged(plan: ActionPlan, digestAtApproval: string): boolean {
  return plan.digest !== digestAtApproval
}

// ---------------------------------------------------------------------------
// Capability checks — an identity may only act inside its granted scopes.
// ---------------------------------------------------------------------------

export interface ExecutorIdentity {
  /** Opaque execution identity (userId / agent id) — recorded on every run. */
  identity: string
  /** Granted authorization scopes (M41 scope vocabulary). */
  scopes: readonly string[]
  /** Delegated agents carry their grantor id; escalation is checked in Phase 3. */
  delegatedFrom?: string
}

export interface CapabilityCheck {
  ok: boolean
  missingScopes: string[]
}

/** A read-only action always passes; everything else needs its scope granted. */
export function checkCapabilities(contract: ActionContract, identity: ExecutorIdentity): CapabilityCheck {
  if (contract.riskClass === 'read-only') return { ok: true, missingScopes: [] }
  const missing = contract.authScope && !identity.scopes.includes(contract.authScope) ? [contract.authScope] : []
  return { ok: missing.length === 0, missingScopes: missing }
}

// ---------------------------------------------------------------------------
// M41 bridge — derive an M44 action contract for an EXISTING mission task.
// The mission planner stays the only planner; this adapter wraps its specs.
// ---------------------------------------------------------------------------

const KIND_ACTION_TYPE: Record<string, ActionType> = {
  'code-build': 'code-build',
  'document-draft': 'code-build',
  'image-asset': 'media-produce',
  'video-asset': 'media-produce',
  'audio-asset': 'media-produce',
  research: 'research-fetch',
  knowledge: 'research-fetch',
  'verify-deliverable': 'file-read',
}

const KIND_SCOPE: Record<string, string> = {
  'code-build': 'project-write',
  'document-draft': 'project-write',
  'image-asset': 'asset-create',
  'video-asset': 'asset-create',
  'audio-asset': 'asset-create',
  research: 'retrieval-read',
  knowledge: 'retrieval-read',
  'verify-deliverable': 'mission-inspect',
}

/**
 * Wrap a mission task spec into an auditable M44 action contract. The post
 * condition is derived from the task's OWN verification criteria so Phase 5
 * checks what the mission verifier would check — one honesty standard.
 */
export function contractForTaskSpec(spec: MissionTaskSpec, planVersion?: string): ActionContract {
  const actionType = KIND_ACTION_TYPE[spec.kind]
  if (!actionType) throw new ActionContractError(`Mission task kind "${spec.kind}" has no M44 action mapping.`)
  const version = planVersion ?? 'pending-plan-digest'
  const postconditions: PostconditionSpec[] = [
    {
      kind: spec.verification.minSources ? 'sources-min' : 'artifact-exists',
      params: spec.verification.minSources ? { minSources: String(spec.verification.minSources) } : { ref: spec.id },
      description: spec.expectedOutput.slice(0, 300),
      requireIndependentMethod: true,
    },
  ]
  return buildActionContract({
    id: `m-${spec.id}`,
    actionType,
    title: spec.title,
    description: spec.objective,
    params: spec.params,
    postconditions,
    authScope: KIND_SCOPE[spec.kind] ?? spec.authScope,
    idempotencyKey: `mission:${version.slice(0, 16)}:${spec.id}`,
    retry: { maxAttempts: spec.limits.maxAttempts, backoffMs: 1_000 },
    timeoutMs: spec.limits.executionTimeoutMs,
    planVersion: version,
    dependsOn: spec.dependsOn.map((d) => `m-${d}`),
  })
}

/** Test/ops seam: the fixed type→risk/reversibility routing in registration order. */
export const ACTION_ROUTING_SEAM = ACTION_TYPES.map((t) => ({
  actionType: t,
  riskClass: TYPE_RISK[t],
  reversibility: TYPE_REVERSIBILITY[t],
  requiresApproval: requirementForRisk(TYPE_RISK[t]),
}))
