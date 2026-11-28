/**
 * BEAN Intelligence — M50.2 BEAN AI STUDIO bounded workflow limits (pure).
 *
 * The hard size bounds for ONE user-authored workflow graph, proposed by the
 * M50.1 architecture (§5, §6.2) and now enforced. Every bound exists so a
 * compiled workflow — INCLUDING the mandatory platform QUALITY gate — always
 * fits the REAL M41 mission caps (MISSION_LIMITS / TASK_LIMIT_CAPS in
 * src/lib/riishe/mission/types.ts), which remain the authoritative execution
 * bounds and are re-enforced by the validator/compiler projections.
 *
 * Derived-fit note (source-verified arithmetic):
 *  - maxNodes 9 with one mandatory verify-deliverable task ⇒ at most 10
 *    mission tasks (MISSION_LIMITS.maxTasks = 10);
 *  - the QUALITY gate depends on every artifact-producing task, so a valid
 *    workflow has at most MISSION_LIMITS.maxDependenciesPerTask = 6
 *    artifact producers (the validator rejects overflow — never trims).
 *
 * PURE module — constants only. No DB, no I/O, no server imports.
 */

export const WORKFLOW_GRAPH_SCHEMA_VERSION = 1

export const WORKFLOW_LIMITS = {
  /** The only supported workflow-graph schema version (M50.1 §6.1). */
  schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
  /** Maximum nodes per workflow graph (executable + structural). */
  maxNodes: 9,
  /** Maximum edges attached to ONE node (incoming + outgoing). */
  maxEdgesPerNode: 6,
  /** Maximum edges in the whole graph (derived: maxNodes × maxEdgesPerNode). */
  maxEdgesTotal: 54,
  /** Maximum serialized graph size (characters). */
  graphJsonMaxChars: 65_536,
  /** Maximum characters per bounded text configuration value. */
  configTextMaxChars: 4_000,
  /** Node/edge identifier bounds (client-generated display ids). */
  nodeIdMaxChars: 32,
  edgeIdMaxChars: 32,
  /** Port identifier bound. */
  portIdMaxChars: 32,
  /** Configuration object key bound (mirrors the M41 param-key rule). */
  configKeyMaxChars: 32,
  /** Presentation-only position bound for each coordinate. */
  positionMaxAbs: 1_000_000,
} as const

/** The only supported node-contract version in M50.2 (per contract). */
export const NODE_CONTRACT_VERSION = 1

/**
 * Minimum honest bounds mirrored from the real specialist submit paths
 * (src/lib/riishe/specialists.ts — the mission path is the consumer of every
 * compiled task, so Studio config bounds are set so values are NEVER silently
 * clipped by the mission-side shaping).
 */
export const STUDIO_CONFIG_BOUNDS = {
  /** image.create / video.create prompt cap (mission param bound; the LAXII
   *  product route allows 4000 but missions shape params.prompt to 2000). */
  mediaPromptMaxChars: 2_000,
  /** audio.speech narration cap (SPEECH_MAX_CHARS = 1000 in specialists.ts). */
  speechTextMaxChars: 1_000,
  /** research.web / knowledge.atlas topic cap (planner shapes topic to 300). */
  topicMaxChars: 300,
  /** document.draft deliverable file path pattern (safe project-relative
   *  path ending in .md — mirrors the M41 criteria path discipline). */
  documentPathPattern: '^[\\w][\\w.\\-/ ]{0,198}\\.md$',
} as const
