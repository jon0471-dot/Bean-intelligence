/**
 * BEAN Intelligence — M50.2 BEAN AI STUDIO server-authoritative node registry
 * (pure static metadata).
 *
 * The ONLY node catalogue BEAN AI STUDIO recognizes. Registered contracts
 * describe REAL execution paths inspected in this repository (M50.1 §5);
 * every executable contract maps to exactly ONE existing M41
 * `MissionTaskKind` — its agent and authorization scope are derived by the
 * existing `buildTaskSpec` (KIND_AGENT / KIND_AUTH_SCOPE), never supplied by
 * a graph. Structural contracts (`input.text`, `output.deliverable`) are
 * non-executable and carry no task kind at all.
 *
 * SAFE TO IMPORT as static metadata (client-safe constants only — no
 * provider identities, no backend ids), but the SERVER remains
 * authoritative: a browser-supplied node description, task kind, permission,
 * capability or contract is never trusted; validation and compilation
 * resolve contracts ONLY from this registry.
 *
 * Proposed/forbidden node types are recorded SEPARATELY (PROPOSED_NODE_TYPES)
 * with their exact structural reasons — they are NOT contracts, carry no
 * task kind, and any graph that references them fails validation.
 *
 * PURE module — static data + lookup helpers. No DB, no I/O, no env reads.
 */

import { GANGZII_VOICES, JAZMII_VIDEO_SIZES, LAXII_SIZES } from '@/lib/registry/products'
import { NODE_CONTRACT_VERSION, STUDIO_CONFIG_BOUNDS, WORKFLOW_LIMITS } from './limits'
import type {
  ProposedNodeRecord,
  StudioNodeContract,
  StudioPortSpec,
} from './types'

// ---------------------------------------------------------------------------
// Port helpers (concise, bounded, honest)
// ---------------------------------------------------------------------------

function out(id: string, type: StudioPortSpec['type'], note?: string): StudioPortSpec {
  return { id, type, required: false, cardinality: 'single', ...(note ? { note } : {}) }
}

function inp(
  id: string,
  type: StudioPortSpec['type'],
  opts: { required: boolean; cardinality?: StudioPortSpec['cardinality']; note?: string } = { required: false },
): StudioPortSpec {
  return {
    id,
    type,
    required: opts.required,
    cardinality: opts.cardinality ?? 'single',
    ...(opts.note ? { note: opts.note } : {}),
  }
}

const LAXII_SIZE_VALUES = LAXII_SIZES.map((s) => s.value)
const JAZMII_SIZE_VALUES: readonly string[] = JAZMII_VIDEO_SIZES
const GANGZII_VOICE_VALUES: readonly string[] = GANGZII_VOICES.map((v) => v.value)

// ---------------------------------------------------------------------------
// The first-release registry (M50.1 §5 — exactly these ten; nothing else)
// ---------------------------------------------------------------------------

export const STUDIO_NODE_CONTRACTS: readonly StudioNodeContract[] = [
  // --- Structural: deterministic input shaping (NOT an M41 task) ----------
  {
    execution: 'structural',
    nodeType: 'input.text',
    contractVersion: NODE_CONTRACT_VERSION,
    displayName: 'Text / JSON input',
    category: 'input',
    description:
      'Provides bounded text (or JSON text) that the compiler shapes into the connected task\u2019s bounded ' +
      'objective/params. Purely declarative: it cannot fetch, compute, transform or execute anything.',
    inputs: [],
    outputs: [
      out('text', 'text', 'The configured text value.'),
      out('json', 'json', 'The configured value when it is valid JSON text.'),
    ],
    config: [
      {
        id: 'text',
        label: 'Text value',
        type: 'text',
        required: false,
        description: 'Plain text handed to the connected task (bounded).',
        maxLength: WORKFLOW_LIMITS.configTextMaxChars,
      },
      {
        id: 'jsonValue',
        label: 'JSON value',
        type: 'text',
        required: false,
        description: 'JSON text handed to json-typed connections (validated when connected).',
        maxLength: 4_000,
      },
    ],
    capabilitySurface: 'platform',
    trustRequirement: 'standard-gates',
    limitations: [
      'Declarative only — no fetch, compute or transformation.',
      'Values ride the existing bounded M41 param shaping; oversized values are rejected at validation, never clipped.',
      'No first-release node consumes the json output port (kept for schema fidelity; connections to it are rejected).',
    ],
    status: 'implemented-substrate',
  },

  // --- Executable: retrieval ----------------------------------------------

  {
    execution: 'executable',
    nodeType: 'research.web',
    contractVersion: NODE_CONTRACT_VERSION,
    displayName: 'Web research (KNOWLEDGE)',
    category: 'research',
    description:
      'Live retrieval through the existing web_search/read_url lanes; produces a real research pack of ' +
      'title + URL + snippet digests handed off to consumers by the mission executor.',
    taskKind: 'research',
    inputs: [inp('topic', 'text', { required: true, note: 'The research topic (config topic or a text edge).' })],
    outputs: [out('pack', 'research-pack', 'Cited source digests (title + URL + bounded excerpt).')],
    config: [
      {
        id: 'topic',
        label: 'Topic',
        type: 'text',
        required: true,
        satisfiableByTextEdge: true,
        description: 'What to research (at least 8 characters).',
        minLength: 8,
        maxLength: STUDIO_CONFIG_BOUNDS.topicMaxChars,
      },
    ],
    capabilitySurface: 'riishe',
    trustRequirement: 'standard-gates',
    verification: { minSources: 3 },
    limits: { executionTimeoutMs: 5 * 60_000, maxAttempts: 1, maxCorrections: 1 },
    limitations: [
      'Sources are title + URL + bounded snippet digests — never full-page text.',
      'Verification requires at least three real sources (existing research verifier).',
      'Depends on the live retrieval lanes being configured; availability is reported, never assumed.',
    ],
    status: 'implemented-substrate',
  },
  {
    execution: 'executable',
    nodeType: 'knowledge.atlas',
    contractVersion: NODE_CONTRACT_VERSION,
    displayName: 'Knowledge Atlas (KNOWLEDGE)',
    category: 'research',
    description:
      'Consults the curated Knowledge Atlas for established background references. Deterministic atlas ' +
      'consultation through the existing mission lane.',
    taskKind: 'knowledge',
    inputs: [inp('topic', 'text', { required: true, note: 'The atlas topic (config topic or a text edge).' })],
    outputs: [out('pack', 'research-pack', 'Atlas references (real consultation output).')],
    config: [
      {
        id: 'topic',
        label: 'Topic',
        type: 'text',
        required: true,
        satisfiableByTextEdge: true,
        description: 'The atlas consultation topic (at least 8 characters).',
        minLength: 8,
        maxLength: STUDIO_CONFIG_BOUNDS.topicMaxChars,
      },
    ],
    capabilitySurface: 'riishe',
    trustRequirement: 'standard-gates',
    verification: { minSources: 1 },
    limits: { executionTimeoutMs: 60_000, maxAttempts: 1, maxCorrections: 0 },
    limitations: [
      'Curated atlas references only — not a live web lane.',
      'Best used as side context; its failure makes a mission partial, never fatal to the deliverable chain.',
    ],
    status: 'implemented-substrate',
  },

  // --- Executable: engineering -------------------------------------------

  {
    execution: 'executable',
    nodeType: 'code.build',
    contractVersion: NODE_CONTRACT_VERSION,
    displayName: 'Build code (CODE GIFTZ)',
    category: 'engineering',
    description:
      'A real CODE GIFTZ delegated coding job: architects and builds working project files in a new ' +
      'user-owned engineering project with real diffs and a passing self-verification.',
    taskKind: 'code-build',
    inputs: [
      inp('objective', 'text', { required: true, note: 'Build instruction (config instruction or a text edge).' }),
      inp('research', 'research-pack', { required: false, cardinality: 'many', note: 'Optional verified sources (several lanes may feed one build).' }),
    ],
    outputs: [out('project', 'code-project', 'The persisted engineering project (real files).')],
    config: [
      {
        id: 'instruction',
        label: 'Build instruction',
        type: 'text',
        required: true,
        satisfiableByTextEdge: true,
        description: 'What to build.',
        minLength: 3,
        maxLength: 3_600,
      },
      {
        id: 'projectName',
        label: 'Project name',
        type: 'text',
        required: false,
        description: 'Optional project name (up to 60 characters).',
        maxLength: 60,
      },
    ],
    capabilitySurface: 'code-giftz',
    trustRequirement: 'standard-gates',
    verification: { requireSelfVerification: true, minFileChanges: 1 },
    limits: { executionTimeoutMs: 20 * 60_000, maxAttempts: 1, maxCorrections: 1 },
    limitations: [
      'Writes only inside ONE user-owned engineering project (project-write scope; no rename/move/delete of existing files).',
      'Hosted verification strictness is real: documents/builds must pass the existing auditors.',
      'A connected research pack is handed off through the existing citation semantics — never concatenated into the prompt.',
    ],
    status: 'implemented-substrate',
  },
  {
    execution: 'executable',
    nodeType: 'document.draft',
    contractVersion: NODE_CONTRACT_VERSION,
    displayName: 'Draft document (CODE GIFTZ)',
    category: 'engineering',
    description:
      'A real CODE GIFTZ document job producing a cited markdown deliverable file inside a user-owned ' +
      'engineering project. With a connected research pack, a Sources section is REQUIRED by the verifier.',
    taskKind: 'document-draft',
    inputs: [
      inp('instruction', 'text', { required: true, note: 'Writing instruction (config or a text edge).' }),
      inp('research', 'research-pack', { required: false, cardinality: 'many', note: 'Optional verified sources for citations (research + atlas may both feed it).' }),
    ],
    outputs: [out('document', 'code-project', 'The persisted project containing the deliverable file.')],
    config: [
      {
        id: 'instruction',
        label: 'Writing instruction',
        type: 'text',
        required: true,
        satisfiableByTextEdge: true,
        description: 'What the document must cover.',
        minLength: 3,
        maxLength: 3_200,
      },
      {
        id: 'deliverablePath',
        label: 'Deliverable file',
        type: 'text',
        required: false,
        description: 'Project-relative markdown file name (e.g. report.md).',
        maxLength: 200,
        pattern: STUDIO_CONFIG_BOUNDS.documentPathPattern,
      },
    ],
    capabilitySurface: 'code-giftz',
    trustRequirement: 'standard-gates',
    verification: {
      requireSelfVerification: true,
      minFileChanges: 1,
      deliverableKind: 'document',
    },
    limits: { executionTimeoutMs: 15 * 60_000, maxAttempts: 2, maxCorrections: 1 },
    limitations: [
      'The deliverable is a markdown file in a CODE GIFTZ project — not a downloaded binary.',
      'With research connected the verifier REQUIRES a Sources section and source citations.',
      'Two bounded attempts exist only because hosted audits are strict; they never bypass verification.',
    ],
    status: 'implemented-substrate',
  },

  // --- Executable: media ---------------------------------------------------

  {
    execution: 'executable',
    nodeType: 'image.create',
    contractVersion: NODE_CONTRACT_VERSION,
    displayName: 'Create image (LAXII)',
    category: 'media',
    description:
      'A real LAXII image-creation job producing a servable image asset, verified by the existing ' +
      'artifact verifier.',
    taskKind: 'image-asset',
    inputs: [inp('prompt', 'text', { required: true, note: 'Image description (config prompt or a text edge).' })],
    outputs: [out('image', 'image-asset', 'The generated image asset reference.')],
    config: [
      {
        id: 'prompt',
        label: 'Image prompt',
        type: 'text',
        required: true,
        satisfiableByTextEdge: true,
        description: 'Describe the image (3-2000 characters).',
        minLength: 3,
        maxLength: STUDIO_CONFIG_BOUNDS.mediaPromptMaxChars,
      },
      {
        id: 'size',
        label: 'Size',
        type: 'enum',
        required: false,
        description: 'Output size (the registry\u2019s supported presets).',
        enumValues: LAXII_SIZE_VALUES,
      },
    ],
    capabilitySurface: 'laxii',
    trustRequirement: 'standard-gates',
    verification: { requireArtifact: true },
    limits: { executionTimeoutMs: 10 * 60_000, maxAttempts: 1, maxCorrections: 1 },
    limitations: [
      'Sizes are exactly the existing LAXII registry presets.',
      'Backend-dependent availability — honestly refused when unconfigured; a validation pass is not a generation promise.',
    ],
    status: 'implemented-substrate',
  },
  {
    execution: 'executable',
    nodeType: 'video.create',
    contractVersion: NODE_CONTRACT_VERSION,
    displayName: 'Create video (JAZMII)',
    category: 'media',
    description:
      'A real JAZMII text-to-video job producing a servable video asset with an ffprobe stream gate. ' +
      'TEXT-TO-VIDEO only: connected images/audio are delivered as a verified set, never spliced into the clip.',
    taskKind: 'video-asset',
    inputs: [inp('prompt', 'text', { required: true, note: 'Video description (config prompt or a text edge).' })],
    outputs: [out('video', 'video-asset', 'The generated video asset reference.')],
    config: [
      {
        id: 'prompt',
        label: 'Video prompt',
        type: 'text',
        required: true,
        satisfiableByTextEdge: true,
        description: 'Describe the video (3-2000 characters).',
        minLength: 3,
        maxLength: STUDIO_CONFIG_BOUNDS.mediaPromptMaxChars,
      },
      {
        id: 'size',
        label: 'Size',
        type: 'enum',
        required: false,
        description: 'Output size (the specialist\u2019s supported presets).',
        enumValues: JAZMII_SIZE_VALUES,
      },
    ],
    capabilitySurface: 'jazmii',
    trustRequirement: 'standard-gates',
    verification: { requireArtifact: true },
    limits: { executionTimeoutMs: 20 * 60_000, maxAttempts: 1, maxCorrections: 1 },
    limitations: [
      'Text-to-video only (the inspected delegation path); a connected image-asset is a delivered reference set, not a render input.',
      'Requires a deployed JAZMII backend; honestly unavailable when unconfigured.',
    ],
    status: 'implemented-substrate',
  },
  {
    execution: 'executable',
    nodeType: 'audio.speech',
    contractVersion: NODE_CONTRACT_VERSION,
    displayName: 'Spoken audio (GANGZII)',
    category: 'media',
    description:
      'A real GANGZII speech-synthesis job producing a RIFF-validated WAV asset. The narration text must ' +
      'be explicit user content — the Studio never fabricates narration.',
    taskKind: 'audio-asset',
    inputs: [inp('narration', 'text', { required: true, note: 'Exact narration text (config text or a text edge).' })],
    outputs: [out('audio', 'audio-asset', 'The validated WAV audio asset reference.')],
    config: [
      {
        id: 'text',
        label: 'Narration text',
        type: 'text',
        required: true,
        satisfiableByTextEdge: true,
        description: 'The exact text to speak (up to 1000 characters).',
        maxLength: STUDIO_CONFIG_BOUNDS.speechTextMaxChars,
      },
      {
        id: 'voice',
        label: 'Voice',
        type: 'enum',
        required: false,
        description: 'A preset voice id (unknown voices are refused, never substituted).',
        enumValues: GANGZII_VOICE_VALUES,
      },
    ],
    capabilitySurface: 'gangzii',
    trustRequirement: 'standard-gates',
    verification: { requireArtifact: true, requireAudioValidation: true },
    limits: { executionTimeoutMs: 10 * 60_000, maxAttempts: 1, maxCorrections: 1 },
    limitations: [
      'At most 1000 characters of narration text per task (the real engine cap).',
      'Narration must be explicit supplied text; the planner and the Studio never invent narration.',
      'Voice ids are the registry presets; an unavailable voice is refused, never silently substituted.',
    ],
    status: 'implemented-substrate',
  },

  // --- Executable: platform verification gate ----------------------------

  {
    execution: 'executable',
    nodeType: 'quality.verify',
    contractVersion: NODE_CONTRACT_VERSION,
    displayName: 'Verify deliverables (QUALITY)',
    category: 'verification',
    description:
      'The platform QUALITY gate: deterministic integrity inspection of the workflow\u2019s real artifacts. ' +
      'Platform-owned — it can never be disabled, weakened or replaced, and the compiler always emits it.',
    taskKind: 'verify-deliverable',
    inputs: [
      inp('project', 'code-project', { required: false, cardinality: 'many' }),
      inp('image', 'image-asset', { required: false, cardinality: 'many' }),
      inp('video', 'video-asset', { required: false, cardinality: 'many' }),
      inp('audio', 'audio-asset', { required: false, cardinality: 'many' }),
      inp('research', 'research-pack', { required: false, cardinality: 'many' }),
    ],
    outputs: [out('result', 'verification-result', 'The deterministic verification outcome reference.')],
    config: [],
    capabilitySurface: 'platform',
    trustRequirement: 'standard-gates',
    verification: {},
    limits: { executionTimeoutMs: 60_000, maxAttempts: 1, maxCorrections: 0 },
    limitations: [
      'Platform-controlled: users may place it, but its contract (agent, scope, criteria, limits) is fixed by the platform.',
      'No user configuration exists — any config key is rejected.',
      'The compiler wires it to every artifact-producing task regardless of user edges.',
    ],
    status: 'implemented-substrate',
  },

  // --- Structural: deliverable designation (NOT an M41 task) -------------

  {
    execution: 'structural',
    nodeType: 'output.deliverable',
    contractVersion: NODE_CONTRACT_VERSION,
    displayName: 'Deliverable',
    category: 'output',
    description:
      'Marks which verified output is the workflow\u2019s deliverable. Produces nothing itself; exactly one ' +
      'marker per workflow, fed by exactly one artifact-producing task.',
    inputs: [
      inp('project', 'code-project', { required: false, note: 'A code/document project as the deliverable.' }),
      inp('image', 'image-asset', { required: false }),
      inp('video', 'video-asset', { required: false }),
      inp('audio', 'audio-asset', { required: false }),
    ],
    outputs: [],
    config: [],
    capabilitySurface: 'platform',
    trustRequirement: 'standard-gates',
    limitations: [
      'Exactly one marker per workflow; exactly one fed port.',
      'Must point at an artifact-producing task — never at the verification gate.',
      'Research packs cannot be designated deliverables (they are evidence, not deliverables).',
    ],
    status: 'implemented-substrate',
  },
]

// ---------------------------------------------------------------------------
// Proposed / forbidden node types — documented, NOT registered, never
// executable. Each carries its exact structural reason (M50.1 §5, §12).
// ---------------------------------------------------------------------------

export const PROPOSED_NODE_TYPES: readonly ProposedNodeRecord[] = [
  {
    nodeType: 'approval.gate',
    status: 'proposed',
    reason:
      'The M41 mission task lifecycle has no approval-wait state (pending|ready|running|done|failed|skipped|cancelled); ' +
      'a mid-run approval node needs an owner-approved additive extension of the task state machine and an executor pause/resume seam.',
  },
  {
    nodeType: 'agent.turn',
    status: 'proposed',
    reason:
      'AUTOBOTS agents execute through the chat preflight + SSE orchestrator path, which has no mission-task seam; ' +
      'M49.2 deliberately maps no mission kind to conversational personas.',
  },
  {
    nodeType: 'team.mission',
    status: 'proposed',
    reason:
      'Teams already occupy the one-active-mission lane; nested missions would need re-entrancy semantics the store does not have.',
  },
  {
    nodeType: 'gateway.chat',
    status: 'proposed',
    reason:
      'There is no inline conversational-model mission lane; adding one would create a new execution path for model calls — ' +
      'a parallel inference path is forbidden.',
  },
  {
    nodeType: 'niiki.scene',
    status: 'proposed',
    reason: 'NIIKI is M51 PLANNED with no implementation; scene nodes have no execution substrate.',
  },
  {
    nodeType: 'niiki.vfx',
    status: 'proposed',
    reason: 'NIIKI is M51 PLANNED with no implementation; VFX nodes have no execution substrate.',
  },
  {
    nodeType: 'external.http',
    status: 'proposed',
    reason:
      'External communication/destructive actions are structurally absent from the M41 task vocabulary; ' +
      'arbitrary HTTP nodes would create an ungoverned network path.',
  },
  {
    nodeType: 'code.arbitrary',
    status: 'proposed',
    reason:
      'Arbitrary-code execution nodes are FORBIDDEN. Engineering work exists only as CODE GIFTZ governed coding jobs ' +
      'in user-owned projects.',
  },
]

// ---------------------------------------------------------------------------
// Registry type + lookup helpers (the registry is injectable for tests; the
// default is always this authoritative catalogue)
// ---------------------------------------------------------------------------

export interface StudioNodeRegistry {
  readonly contracts: readonly StudioNodeContract[]
  readonly proposed: readonly ProposedNodeRecord[]
  resolve(nodeType: string, contractVersion: number): StudioNodeContract | null
}

export function createStudioNodeRegistry(
  contracts: readonly StudioNodeContract[] = STUDIO_NODE_CONTRACTS,
  proposed: readonly ProposedNodeRecord[] = PROPOSED_NODE_TYPES,
): StudioNodeRegistry {
  const byType = new Map<string, StudioNodeContract>()
  for (const c of contracts) {
    if (!byType.has(c.nodeType)) byType.set(c.nodeType, c)
  }
  return {
    contracts,
    proposed,
    resolve(nodeType, contractVersion) {
      const c = byType.get(nodeType)
      if (!c || c.contractVersion !== contractVersion) return null
      return c
    },
  }
}

/** The authoritative default registry (server-side truth). */
export const STUDIO_NODE_REGISTRY: StudioNodeRegistry = createStudioNodeRegistry()

export function getStudioNodeContract(nodeType: string): StudioNodeContract | null {
  return STUDIO_NODE_REGISTRY.resolve(nodeType, NODE_CONTRACT_VERSION)
}

export function listStudioNodeContracts(): readonly StudioNodeContract[] {
  return STUDIO_NODE_CONTRACTS
}

/** Executable contracts only (structural nodes are excluded by construction). */
export function listExecutableNodeContracts(): StudioExecutableContractView[] {
  return STUDIO_NODE_CONTRACTS.filter((c): c is Extract<StudioNodeContract, { execution: 'executable' }> => c.execution === 'executable')
}

export type StudioExecutableContractView = Extract<StudioNodeContract, { execution: 'executable' }>

/** True when a graph-referenced node type is a DOCUMENTED proposed node. */
export function findProposedNodeType(nodeType: string): ProposedNodeRecord | null {
  return PROPOSED_NODE_TYPES.find((p) => p.nodeType === nodeType) ?? null
}
