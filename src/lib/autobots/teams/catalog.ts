/**
 * BEAN Intelligence — M49.2 BEAN AUTOBOT TEAMS catalogue (PURE, shared).
 *
 * The single source of truth for the team-composition product surface:
 * team templates (compositions of EXISTING Autobot agent templates), the
 * fixed task-kind → team-capability requirement map, workflow preferences
 * and the bounded team limits. Imported by BOTH the server (validation +
 * assignment) and the client (catalogue rendering) — one module, so what
 * the UI advertises is exactly what the server can authorize.
 *
 * HONESTY CONTRACT (M49.2):
 *  - A team template lists agent-template members that exist in the M49.1
 *    catalogue (src/lib/autobots/catalog.ts). Nothing here invents an agent
 *    or a capability.
 *  - A team is a user-configured COMPOSITION, never a new execution worker.
 *    Every team mission rides the EXISTING M41 mission planner / DAG kernel /
 *    executor / durable job queue / Trust Engine. There is no agent-to-agent
 *    chat and no team-authored execution plan.
 *  - 'advisory' and 'review' members are conversation-capable personas; in
 *    M49.2 missions they receive NO task assignments (no M41 task kind maps
 *    to them) and they are NEVER the verification gate — verification is the
 *    platform's independent QUALITY gate and cannot be delegated to a member.
 *  - Template copy states capability requirements truthfully; a team lacking
 *    a required capability is refused at plan/run time with an exact,
 *    honest message (never a silent substitute).
 *
 * PURE module — no database, no I/O, no server imports.
 */

import type { MissionTaskKind } from '@/lib/riishe/mission/types'
import { getTemplate as getAgentTemplate, type AutobotCapability } from '../catalog'

// ---------------------------------------------------------------------------
// Fixed vocabulary: which TEAM capability (an M49.1 agent capabilityKey) can
// be assigned each M41 task kind. 'quality-gate' is NOT a member capability —
// it names the platform's fixed verify-deliverable execution path, which no
// team configuration can change, disable or capture.
// ---------------------------------------------------------------------------

export type TeamCapabilityRequirement = AutobotCapability | 'quality-gate'

export const TASK_KIND_TEAM_CAPABILITY: Record<MissionTaskKind, TeamCapabilityRequirement> = {
  research: 'research',
  knowledge: 'research',
  'code-build': 'engineering',
  'document-draft': 'engineering',
  'image-asset': 'visual',
  'video-asset': 'motion',
  'audio-asset': 'voice',
  'verify-deliverable': 'quality-gate',
}

export const QUALITY_GATE_CAPABILITY: TeamCapabilityRequirement = 'quality-gate'

/** The capabilities a member can actually be assigned in M49.2 missions. */
export const ASSIGNABLE_TEAM_CAPABILITIES: readonly AutobotCapability[] = [
  'research',
  'engineering',
  'visual',
  'motion',
  'voice',
]

export const QUALITY_GATE_LABEL = 'Platform verification gate (QUALITY) — always the platform, never a team member'

// ---------------------------------------------------------------------------
// Workflow preferences — DESCRIPTIVE ONLY. They never alter the deterministic
// M41 planner, the DAG kernel's scheduling, the authorization scopes or the
// verification criteria. Recorded on the team and shown as coordination copy.
// ---------------------------------------------------------------------------

export const TEAM_WORKFLOW_PREFERENCES = ['auto', 'research-first', 'build-first', 'review-heavy'] as const

export type TeamWorkflowPreference = (typeof TEAM_WORKFLOW_PREFERENCES)[number]

export const WORKFLOW_PREFERENCE_LABELS: Record<TeamWorkflowPreference, string> = {
  auto: 'Auto — let the mission planner decide the task order',
  'research-first': 'Research first — plan evidence-gathering before building (where the objective supports it)',
  'build-first': 'Build first — prioritize producing the deliverable early (where the objective supports it)',
  'review-heavy': 'Review heavy — expect extra scrutiny of outputs in the team\u2019s working style',
}

// ---------------------------------------------------------------------------
// Assignment preference — the ONLY deterministic multi-member selection rule.
// Both modes are pure orderings over the SAVED team configuration; neither
// consults member names, descriptions, responsibility text or instructions.
// ---------------------------------------------------------------------------

export const TEAM_ASSIGNMENT_PREFERENCES = ['team-order', 'leader-first'] as const

export type TeamAssignmentPreference = (typeof TEAM_ASSIGNMENT_PREFERENCES)[number]

// ---------------------------------------------------------------------------
// Bounded limits (enforced by the service layer; mirrored client-side)
// ---------------------------------------------------------------------------

export const TEAM_LIMITS = {
  nameChars: 80,
  descriptionChars: 600,
  responsibilityChars: 300,
  /** A team must contain at least two active agents to be saved or run. */
  minMembers: 2,
  /** M49.2 default team-size bound (spec: start at 8 unless measurements
   *  justify another limit — 8 comfortably exceeds the mission planner's
   *  10-task/3-lane shapes, so no measurement pressure exists to raise it). */
  maxMembers: 8,
  maxTeamsPerUser: 30,
  /** Per-user burst limit for team CRUD (window 60s). */
  crudBurstLimit: 30,
  /** Per-task persona preference block bound carried into mission tasks. */
  personaPreferenceChars: 1200,
  /** Hard bound for the serialized team execution snapshot. */
  snapshotMaxChars: 24_000,
} as const

// ---------------------------------------------------------------------------
// Team templates — compositions of EXISTING M49.1 agent templates.
//
// Every template instantiates through the SAME validation as a custom team:
// agents are created (or reused if the user already has an active agent from
// that template) and the team passes the min/max member + ownership checks.
// ---------------------------------------------------------------------------

export interface TeamMemberSpec {
  /** An existing M49.1 agent template key (verified collection). */
  agentTemplateKey: string
  /** Descriptive responsibility (USER DATA — never authorization). */
  responsibility: string
}

export interface TeamTemplate {
  key: string
  name: string
  description: string
  category: string
  /** The team members this template composes (empty = custom start). */
  memberSpecs: TeamMemberSpec[]
  /** Descriptive coordination style (never changes authorization). */
  workflowPreference: TeamWorkflowPreference
  /** Honest statement of what this team still cannot do. */
  limitations: string
}

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    key: 'startup-launch-team',
    name: 'Startup Launch Team',
    description: 'A launch squad: market evidence, positioning, brand visuals, a working landing website and honest write-ups — coordinated across research, visual and engineering capabilities.',
    category: 'business',
    memberSpecs: [
      { agentTemplateKey: 'business-strategist', responsibility: 'Team lead — owns positioning and the go-to-market framing' },
      { agentTemplateKey: 'market-researcher', responsibility: 'Gathers cited market and competitor evidence' },
      { agentTemplateKey: 'brand-visualist', responsibility: 'Produces brand concept visuals (LAXII image jobs)' },
      { agentTemplateKey: 'software-engineer', responsibility: 'Builds the landing website and document deliverables (CODE GIFTZ jobs)' },
      { agentTemplateKey: 'business-writer', responsibility: 'Drafts launch copy and announcements in conversation' },
    ],
    workflowPreference: 'research-first',
    limitations: 'Mission verification is the platform\u2019s independent QUALITY gate. The writer and strategist shape copy in conversation but file, deploy and publish nothing. Not licensed financial, legal or tax advice.',
  },
  {
    key: 'business-growth-team',
    name: 'Business Growth Team',
    description: 'An analysis-heavy team for growth questions: strategy, marketing, operations, data interpretation and delivery planning — strongest at researched strategies, briefs and plans.',
    category: 'business',
    memberSpecs: [
      { agentTemplateKey: 'business-strategist', responsibility: 'Team lead — owns the growth recommendation' },
      { agentTemplateKey: 'marketing-strategist', responsibility: 'Campaign and audience framing with honest validation notes' },
      { agentTemplateKey: 'operations-manager', responsibility: 'Turns plans into concrete step-by-step execution sequences' },
      { agentTemplateKey: 'data-analyst', responsibility: 'Computes and interprets the numbers the user supplies' },
      { agentTemplateKey: 'project-manager', responsibility: 'Milestones, dependencies and risk registers' },
    ],
    workflowPreference: 'review-heavy',
    limitations: 'This composition is conversation-first: its members carry research and conversational capabilities, so file deliverables (reports, websites) need an engineering-capable member added. Metrics advice is planning support, not reporting.',
  },
  {
    key: 'marketing-team',
    name: 'Marketing Team',
    description: 'A campaign production team: strategy, brand visuals, copy, narration and video clips — covers researched campaign briefs, real image/video/audio assets and written deliverables.',
    category: 'business',
    memberSpecs: [
      { agentTemplateKey: 'marketing-strategist', responsibility: 'Team lead — owns the campaign strategy' },
      { agentTemplateKey: 'brand-visualist', responsibility: 'Campaign concept visuals (LAXII image jobs)' },
      { agentTemplateKey: 'business-writer', responsibility: 'Copy and messaging drafts in conversation' },
      { agentTemplateKey: 'voice-narrator', responsibility: 'Spoken-audio production (GANGZII speech jobs)' },
      { agentTemplateKey: 'video-producer', responsibility: 'Video clip production (JAZMII video jobs)' },
    ],
    workflowPreference: 'build-first',
    limitations: 'Cannot run ads, send campaigns or access analytics accounts. Video and audio need their backends configured; refusals stay honest. File-based brief deliverables need an engineering-capable member added.',
  },
  {
    key: 'software-engineering-team',
    name: 'Software Engineering Team',
    description: 'A product build team: engineering execution through real CODE GIFTZ jobs, review discipline, design visuals and delivery planning for software objectives.',
    category: 'technology',
    memberSpecs: [
      { agentTemplateKey: 'software-engineer', responsibility: 'Team lead — architects and builds (CODE GIFTZ jobs)' },
      { agentTemplateKey: 'code-reviewer', responsibility: 'Structured review findings on code the team and user discuss' },
      { agentTemplateKey: 'ui-ux-designer', responsibility: 'Product design direction and concept visuals (LAXII jobs)' },
      { agentTemplateKey: 'data-analyst', responsibility: 'Interprets datasets the user supplies for product decisions' },
      { agentTemplateKey: 'project-manager', responsibility: 'Scope breakdown and delivery sequencing' },
    ],
    workflowPreference: 'build-first',
    limitations: 'Engineering jobs run as background CODE GIFTZ work with its own gates — nothing deploys or merges. The reviewer critiques conversationally; formal verification is the platform\u2019s QUALITY gate. No live research member — add a research-capable member for market-facing builds.',
  },
  {
    key: 'website-production-team',
    name: 'Website Production Team',
    description: 'A website squad: design direction, brand visuals, real site builds through CODE GIFTZ and written content — for landing sites and small product sites.',
    category: 'technology',
    memberSpecs: [
      { agentTemplateKey: 'software-engineer', responsibility: 'Team lead — builds the website (CODE GIFTZ website jobs)' },
      { agentTemplateKey: 'ui-ux-designer', responsibility: 'Flows, layout critique and accessibility direction' },
      { agentTemplateKey: 'brand-visualist', responsibility: 'Hero and brand imagery (LAXII image jobs)' },
      { agentTemplateKey: 'business-writer', responsibility: 'Site copy drafts in conversation' },
    ],
    workflowPreference: 'build-first',
    limitations: 'Generated sites are real project files in the engineering workspace — hosting, domains and deployment are out of scope. No live research member; market claims need a research-capable member to be sourced.',
  },
  {
    key: 'research-team',
    name: 'Research Team',
    description: 'An evidence team: live multi-source research, methods discipline and a sourced document deliverable built through a real engineering job — for reports, briefs and studies.',
    category: 'research',
    memberSpecs: [
      { agentTemplateKey: 'knowledge-librarian', responsibility: 'Team lead — runs cited multi-source research' },
      { agentTemplateKey: 'research-tutor', responsibility: 'Source evaluation and methods discipline' },
      { agentTemplateKey: 'software-engineer', responsibility: 'Builds the sourced document deliverable (CODE GIFTZ document jobs)' },
      { agentTemplateKey: 'business-writer', responsibility: 'Plain-language summaries in conversation' },
    ],
    workflowPreference: 'research-first',
    limitations: 'Public web sources only — no paywalled papers or private databases. When live search lanes are unconfigured the refusal is stated honestly. Findings are research support, not legal or investment advice.',
  },
  {
    key: 'video-production-team',
    name: 'Video Production Team',
    description: 'A media crew: video clips (JAZMII), narration (GANGZII), supporting visuals (LAXII) and scripting — for short produced videos with honest queued-job statuses.',
    category: 'creative',
    memberSpecs: [
      { agentTemplateKey: 'video-producer', responsibility: 'Team lead — shot lists and video jobs (JAZMII)' },
      { agentTemplateKey: 'voice-narrator', responsibility: 'Narration production (GANGZII speech jobs)' },
      { agentTemplateKey: 'brand-visualist', responsibility: 'Supporting imagery (LAXII image jobs)' },
      { agentTemplateKey: 'business-writer', responsibility: 'Scripts and captions in conversation' },
    ],
    workflowPreference: 'build-first',
    limitations: 'Video generation needs the video backend configured; produced clips are single generated takes, not full edits. Speech is capped at 1000 characters per job with preset voices.',
  },
  {
    key: 'creative-studio-team',
    name: 'Creative Studio Team',
    description: 'A visual-first studio: design direction, brand concepts, motion and audio — for identity concepts, campaign art and short creative pieces.',
    category: 'creative',
    memberSpecs: [
      { agentTemplateKey: 'brand-visualist', responsibility: 'Team lead — visual identity concepts (LAXII jobs)' },
      { agentTemplateKey: 'ui-ux-designer', responsibility: 'Design critique and layout direction' },
      { agentTemplateKey: 'video-producer', responsibility: 'Motion pieces (JAZMII video jobs)' },
      { agentTemplateKey: 'voice-narrator', responsibility: 'Audio pieces (GANGZII speech jobs)' },
    ],
    workflowPreference: 'build-first',
    limitations: 'Concept generation only — no vector/logo file production, trademark clearance or licensing advice. No engineering member: file deliverables (sites, documents) are outside this composition.',
  },
  {
    key: 'education-team',
    name: 'Education Team',
    description: 'A learning team: step-by-step teaching, research methods, cited evidence and written study material — for course plans, explained topics and sourced study guides.',
    category: 'education',
    memberSpecs: [
      { agentTemplateKey: 'study-coach', responsibility: 'Team lead — sequences the learning plan' },
      { agentTemplateKey: 'research-tutor', responsibility: 'Research methods and source evaluation' },
      { agentTemplateKey: 'knowledge-librarian', responsibility: 'Cited evidence gathering' },
      { agentTemplateKey: 'business-writer', responsibility: 'Study materials in conversation' },
    ],
    workflowPreference: 'research-first',
    limitations: 'A study aid, not an accredited provider — no certificates or formal assessment. Written study-guide FILES need an engineering-capable member; this composition is conversation-first.',
  },
  {
    key: 'custom-team',
    name: 'Custom Team',
    description: 'Start from an empty roster and pick your own members from My Agents — every team is validated server-side and missions always run through the real M41 execution paths.',
    category: 'technology',
    memberSpecs: [],
    workflowPreference: 'auto',
    limitations: 'A team needs at least two active agents before it can be saved. Only the capabilities your members really carry can receive mission tasks — everything else is refused with an exact, honest message.',
  },
]

export function getTeamTemplate(key: string): TeamTemplate | undefined {
  return TEAM_TEMPLATES.find((t) => t.key === key)
}

/** Test/ops seam: the verified team template count. */
export const TEAM_TEMPLATE_COUNT = TEAM_TEMPLATES.length

/** Test/ops seam: every member spec must reference a REAL agent template key. */
export const TEAM_TEMPLATE_MEMBER_KEYS: readonly string[] = TEAM_TEMPLATES.flatMap((t) =>
  t.memberSpecs.map((m) => m.agentTemplateKey),
)

/** The distinct capability keys a template composition really carries
 *  (derived from the referenced agent templates — the same derivation the
 *  server performs when instantiating). */
export function templateRequiredCapabilities(t: TeamTemplate): AutobotCapability[] {
  const caps: AutobotCapability[] = []
  for (const s of t.memberSpecs) {
    const at = getAgentTemplate(s.agentTemplateKey)
    if (at && !caps.includes(at.capabilityKey)) caps.push(at.capabilityKey)
  }
  return caps
}
