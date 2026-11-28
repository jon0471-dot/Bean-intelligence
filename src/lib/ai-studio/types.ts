/**
 * BEAN Intelligence — M50.2 BEAN AI STUDIO versioned graph + node contracts
 * (pure, shared types).
 *
 * THE M50.2 TYPE-MODEL REFINEMENT (documented in the M50.1 addendum):
 * M50.1's `StudioNodeContract` sketch carried a single `taskKind` field. The
 * first-release catalogue also contains STRUCTURAL nodes (`input.text`,
 * `output.deliverable`) that are deterministic data-shaping/marker nodes —
 * NOT M41 tasks. Inventing a `MissionTaskKind` for them would fabricate
 * execution vocabulary, so the contract is a DISCRIMINATED UNION:
 *
 *  - executable contracts carry EXACTLY ONE real `MissionTaskKind`
 *    (`src/lib/riishe/mission/types.ts` — the fixed vocabulary) and their
 *    agent + authorization scope are derived by `buildTaskSpec` (KIND_AGENT /
 *    KIND_AUTH_SCOPE), never supplied by a graph;
 *  - structural contracts have NO task kind at all (the field cannot even be
 *    expressed) and can never become mission tasks.
 *
 * Everything crossing the compile boundary stays DATA: a graph cannot carry
 * task kinds, agents, scopes, permissions, providers or verification
 * overrides — those live only in the server-side registry and the M41
 * builder.
 *
 * PURE module — types + small pure helpers. No DB, no I/O, no env reads.
 */

import type { BeanProductId } from '@/lib/registry/products'
import type {
  MissionTaskKind,
  MissionTaskSpec,
  TaskResourceLimits,
  VerificationCriteria,
} from '@/lib/riishe/mission/types'
import { WORKFLOW_GRAPH_SCHEMA_VERSION } from './limits'

// ---------------------------------------------------------------------------
// Port system (M50.1 §4.2 — grounded in the real BEAN artifact vocabulary)
// ---------------------------------------------------------------------------

/** The eight approved first-release port types. */
export const STUDIO_PORT_TYPES = [
  'text',
  'json',
  'research-pack',
  'code-project',
  'image-asset',
  'video-asset',
  'audio-asset',
  'verification-result',
] as const

export type StudioPortType = (typeof STUDIO_PORT_TYPES)[number]

/** PROPOSED port types — never executable, never registered on a port. */
export const PROPOSED_PORT_TYPES = ['approval-ref'] as const

export type ProposedPortType = (typeof PROPOSED_PORT_TYPES)[number]

/** Input-port cardinality: exactly one producer, or several (fan-in). */
export type StudioPortCardinality = 'single' | 'many'

export interface StudioPortSpec {
  /** Stable port id within the node (input ids and output ids are separate
   *  namespaces; both are slug-safe and bounded). */
  id: string
  type: StudioPortType
  /** Input ports: whether the node refuses to compile without this input
   *  (fed by an edge or an allowed config value). Always false for outputs. */
  required: boolean
  /** Input ports only: how many producers may feed this port. */
  cardinality: StudioPortCardinality
  /** Honest, customer-safe note shown by the UI. */
  note?: string
}

// ---------------------------------------------------------------------------
// Node configuration schema (bounded, data-only)
// ---------------------------------------------------------------------------

export interface StudioConfigField {
  id: string
  label: string
  /** 'text' — bounded string; 'enum' — one of a fixed value list. */
  type: 'text' | 'enum'
  /** Whether the consumer task can compile without it (some fields are
   *  satisfiable by a connected text edge instead — e.g. research.web's
   *  topic). The exact rule lives on the node contract. */
  required: boolean
  description: string
  maxLength?: number
  minLength?: number
  /** Safe project-relative path pattern (document.draft). */
  pattern?: string
  /** Fixed value vocabulary for 'enum' fields. */
  enumValues?: readonly string[]
  /** Field ids that a connected text edge may satisfy instead of this
   *  config value (data-only substitution the compiler resolves). */
  satisfiableByTextEdge?: boolean
}

// ---------------------------------------------------------------------------
// Node contracts — the discriminated structural/executable model
// ---------------------------------------------------------------------------

export type StudioNodeCategory = 'input' | 'research' | 'engineering' | 'media' | 'verification' | 'output'

/** Whose real capability surface this node rides (availability gates it). */
export type StudioCapabilitySurface = BeanProductId | 'platform'

export type StudioTrustRequirement = 'standard-gates' | 'proposed-approval-gate'

export type StudioNodeStatus = 'implemented-substrate' | 'proposed'

/** Fields shared by every contract version. */
interface StudioNodeContractBase {
  /** Stable, unique, slug-cased node type. Never reused across versions. */
  nodeType: string
  contractVersion: number
  displayName: string
  category: StudioNodeCategory
  /** Honest description, including what the node CANNOT do. */
  description: string
  inputs: StudioPortSpec[]
  outputs: StudioPortSpec[]
  config: StudioConfigField[]
  capabilitySurface: StudioCapabilitySurface
  trustRequirement: StudioTrustRequirement
  /** Honest limitations pinned from the real substrate. */
  limitations: string[]
  status: StudioNodeStatus
}

/** An executable node: exactly ONE real M41 task kind. Never structural. */
export interface StudioExecutableNodeContract extends StudioNodeContractBase {
  execution: 'executable'
  taskKind: MissionTaskKind
  /** Deterministic verification-criteria TEMPLATE — flows through
   *  buildTaskSpec (whose internal normalization stays authoritative). */
  verification: VerificationCriteria
  /** Normalized through the existing TASK_LIMIT_CAPS. */
  limits?: Partial<TaskResourceLimits>
}

/** A structural node: data shaping / deliverable designation. NO task kind
 *  exists on this shape — it cannot be fabricated or supplied. */
export interface StudioStructuralNodeContract extends StudioNodeContractBase {
  execution: 'structural'
}

export type StudioNodeContract = StudioExecutableNodeContract | StudioStructuralNodeContract

// ---------------------------------------------------------------------------
// Proposed (non-buildable) node metadata — kept SEPARATE from the executable
// registry so planned ideas are documented without fabricating contracts.
// ---------------------------------------------------------------------------

export interface ProposedNodeRecord {
  nodeType: string
  /** The exact structural reason it cannot ship today. */
  reason: string
  status: 'proposed'
}

// ---------------------------------------------------------------------------
// Versioned workflow graph (the data a client submits — always just data)
// ---------------------------------------------------------------------------

export interface StudioGraphNode {
  /** Client-generated display id. NEVER reaches execution — the compiler
   *  assigns M41 task ids and records the nodeId→taskId mapping. */
  nodeId: string
  nodeType: string
  contractVersion: number
  /** Bounded string map. No nested objects, no arrays, no functions. */
  config: Record<string, string>
  /** Presentation-only; never security-relevant. */
  position?: { x: number; y: number }
}

export interface StudioGraphEndpoint {
  nodeId: string
  port: string
}

export interface StudioGraphEdge {
  edgeId: string
  /** Source node's OUTPUT port. */
  from: StudioGraphEndpoint
  /** Target node's INPUT port. */
  to: StudioGraphEndpoint
}

export interface StudioWorkflowGraph {
  schemaVersion: typeof WORKFLOW_GRAPH_SCHEMA_VERSION
  nodes: StudioGraphNode[]
  edges: StudioGraphEdge[]
}

// ---------------------------------------------------------------------------
// Diagnostics (M50.1 §6.2 vocabulary — structured, customer-safe, ordered)
// ---------------------------------------------------------------------------

export const STUDIO_DIAGNOSTIC_CODES = [
  'E_SCHEMA',
  'E_UNKNOWN_NODE',
  'E_PORT_TYPE',
  'E_CYCLE',
  'E_MISSING_INPUT',
  'E_CONFIG',
  'E_BOUNDS',
  'E_CAPABILITY_UNAVAILABLE',
  'E_PERMISSION',
  'E_DELIVERABLE',
] as const

export type StudioDiagnosticCode = (typeof STUDIO_DIAGNOSTIC_CODES)[number]

/**
 * Severity semantics (M50.2 — pinned by tests):
 *  - 'error'   → the graph is INVALID (hard refusal; sets valid=false).
 *                Covers structural unsupportedness, cycles, missing inputs,
 *                config/bounds violations, deliverable defects.
 *  - 'warning' → truthful availability/degraded evidence from the caller's
 *                explicit snapshot; does NOT set valid=false (the pure core
 *                cannot probe health, and execution-time preflight in the
 *                existing router remains authoritative).
 *  - 'info'    → honest context (e.g. a disconnected executable node becomes
 *                a mission side task; transient rate-limit evidence). Never
 *                sets valid=false.
 * A validation pass is NEVER a promise that a backend will succeed later.
 */
export type StudioDiagnosticSeverity = 'error' | 'warning' | 'info'

export interface StudioDiagnostic {
  code: StudioDiagnosticCode
  severity: StudioDiagnosticSeverity
  /** Bounded, customer-safe message. No secrets, no provider internals, no
   *  raw exception text. */
  message: string
  nodeId?: string
  portId?: string
  edgeId?: string
}

export interface WorkflowValidationOutcome {
  valid: boolean
  diagnostics: StudioDiagnostic[]
}

// ---------------------------------------------------------------------------
// Capability availability — an EXPLICIT, IMMUTABLE snapshot supplied by the
// caller. The pure graph core NEVER fetches health, reads the environment or
// infers availability. Semantics mirror the honest registry states
// (src/lib/registry/status.ts): 'unknown'/absent = no evidence, no claim.
// ---------------------------------------------------------------------------

export type StudioAvailabilityState =
  | 'available'
  | 'degraded'
  | 'rate-limited'
  | 'unavailable'
  | 'not-configured'
  | 'unknown'

export type AvailabilitySnapshot = Partial<Record<StudioCapabilitySurface, StudioAvailabilityState>>

// ---------------------------------------------------------------------------
// Compiled output — the M50.2 boundary. NOT a MissionPlan: M50.1 defers the
// `MISSION_TYPES` + 'workflow' vocabulary extension to M50.5, so the compiler
// returns a dedicated type that the M50.5 adapter will wrap.
// ---------------------------------------------------------------------------

export interface CompiledWorkflowPlan {
  ok: true
  schemaVersion: typeof WORKFLOW_GRAPH_SCHEMA_VERSION
  /** buildTaskSpec-constructed, validateTaskGraph-validated task list. */
  tasks: MissionTaskSpec[]
  /** The task producing the designated deliverable — NEVER the verify gate. */
  deliverableTaskId: string
  /** The output.deliverable node that made the designation (when present). */
  deliverableNodeId: string
  /** The platform QUALITY gate's task id (exactly one, always present). */
  gateTaskId: string
  /** True when the compiler appended the gate (the user graph omitted it). */
  gateAutoAppended: boolean
  /** Deterministic nodeId → taskId map (executable nodes only, including
   *  a user-placed quality.verify). Structural nodes map to nothing. */
  nodeTaskMap: Readonly<Record<string, string>>
  /** Honest, customer-safe compilation summary. */
  detected: string[]
}

export interface CompiledWorkflowFailure {
  ok: false
  /** The full deterministic validation diagnostics (errors + warnings). */
  diagnostics: StudioDiagnostic[]
}

export type CompiledWorkflowResult = CompiledWorkflowPlan | CompiledWorkflowFailure
