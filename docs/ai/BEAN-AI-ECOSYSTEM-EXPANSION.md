# BEAN AI Ecosystem Expansion — Owner Direction Record

**Recorded: November 28, 2026 (owner-approved direction; delivered M49.1).**
**Relation to prior planning: expands the February 2027 plan's narrower agent roadmap — it does not rewrite it.**

## 1. The owner-approved ecosystem

| System | Role | Status (2026-11-28) |
|---|---|---|
| **RIISHE** | Central intelligence and coordination | Implemented (one orchestrator for chat, agents, missions) |
| **BEAN AUTOBOTS** | Customizable professional and personal AI workforce | Implemented (M49.1) — catalogue, custom agents, owner-scoped persistence, real execution |
| **BEAN AI STUDIO** | Visual node-based AI workflow creation and execution | Planned — M50 (no implementation; see [systems/AI-STUDIO.md](systems/AI-STUDIO.md)) |
| **NIIKI** | 3D, animation, motion graphics, VFX, creative production | Planned — M51 (no implementation; see [systems/NIIKI.md](systems/NIIKI.md)) |
| **CODE GIFTZ** | Engineering | Implemented |
| **LAXII** | Image and visual intelligence | Implemented (backend-dependent availability) |
| **JAZMII** | Video and media production | Implemented (backend-dependent availability) |
| **GANGZII** | Audio and speech | Implemented |
| **KNOWLEDGE** | Research and retrieval | Implemented |
| **QUALITY** | Output verification | Implemented (deterministic; mission gate + turn verification) |

Master documentation entry point: [`AI_GUIDE.md`](../../AI_GUIDE.md).

## 2. What M49.1 actually delivered
- **BEAN AUTOBOTS as a first-class product**: navigation item, Discover
  catalogue (19 verified templates, 8 categories), My Agents
  (edit/duplicate/archive/delete), Create Agent (bounded validated form),
  Agent Workspace (real RIISHE-backed conversational execution with honest
  status chips) and Agent Details (capabilities, limits, execution history).
- **The persona/execution separation**: agents are personas; execution stays
  on the existing specialists. Capability mapping (e.g. business strategist →
  research lanes; software engineer → CODE GIFTZ delegation; video producer →
  JAZMII delegation) is server vocabulary, never prompt fiction.
- **The security boundary**: tool permissions derive from the agent's fixed
  `capabilityKey` only; persona/instructions are untrusted configuration data
  with explicit untrusted framing and a platform-authority guard; Trust
  Engine approval contracts are untouched and mandatory.
- **Persistence**: additive Prisma models (`AutobotAgent`,
  `AutobotConversation`, `AutobotMessage`), owner-scoped, cascade-contained.
- **Universal BEAN AI documentation**: this docs tree + root
  [`AI_GUIDE.md`](../../AI_GUIDE.md).

## 2.b What M49.2 actually delivered (2026-11-28, same-day follow-on)

- **MY TEAMS inside BEAN AUTOBOTS** (one product, one navigation item — the
  Agents⇄Teams surface switch): Discover Teams (10 verified templates),
  My Teams (open/edit/duplicate/archive/restore/delete with real derived
  mission stats), Create Team (bounded roster builder, responsibilities,
  leader, saved order, deterministic assignment rule, inline agent creation)
  and the Team Workspace (read-only plan preview → confirmed run → real
  mission progress with verification outcomes and deliverable follow-up
  links into existing product surfaces).
- **Real team collaboration on the EXISTING M41 machinery**: the plan is
  ALWAYS the deterministic M41 planner's output; the assignment engine maps
  task kinds to members by REAL capability only; handoffs remain the M41
  verified-artifact contracts; verification is ALWAYS the platform QUALITY
  gate. No agent-to-agent chat; no second job queue; no team-authored
  execution plans (plan preview is strictly read-only — pinned by tests).
- **The immutable execution snapshot** (team identity, membership, agent
  identities, capability keys, roles, bounded persona preferences, task
  assignments) written once at mission start; later team/agent edits can
  never change a running mission's context.
- **The one bounded persona seam**: delegated engineering/document
  objectives only; ≤700 chars; untrusted-framed with a never-truncated
  security framing; idempotent across correction/retry re-entry. Media,
  retrieval and verification lanes carry truthful attribution WITHOUT
  persona injection (documented limitation, not a faked influence path).
- Docs: [systems/AUTOBOT-TEAMS.md](systems/AUTOBOT-TEAMS.md),
  [agents/M49.2-TEAM-EXECUTION-CONTRACT.md](../agents/M49.2-TEAM-EXECUTION-CONTRACT.md),
  [agents/M49.2-TEAM-ACCEPTANCE.md](../agents/M49.2-TEAM-ACCEPTANCE.md).

## 2.c What M50.1 actually delivered (2026-11-28, same-day follow-on)

- **BEAN AI STUDIO architecture + contracts — documentation only, no
  implementation.** The complete design is frozen in
  [agents/M50.1-AI-STUDIO-ARCHITECTURE.md](../agents/M50.1-AI-STUDIO-ARCHITECTURE.md)
  and summarized in [systems/AI-STUDIO.md](systems/AI-STUDIO.md) (status:
  architecture specified; runtime NOT implemented).
- **The central decision, grounded in inspected source**: a user-authored
  visual graph compiles onto the EXISTING M41 mission machinery through ONE
  pure deterministic compiler (`compileWorkflowToPlan`) — every supported
  node maps to exactly one M41 task kind (`buildTaskSpec`-constructed;
  fixed `KIND_AGENT`/`KIND_AUTH_SCOPE`), the platform QUALITY
  `verify-deliverable` gate is ALWAYS emitted, and the plan is submitted
  through the EXISTING `createMissionFromPlan` (ONE durable `mission-run`
  GenerationJob, ONE Trust task, every preflight/verifier/outcome rule
  unchanged). No second queue, no workflow engine, no duplicate specialists.
- **Honest catalogue discipline**: first-release nodes only from proven
  capabilities (research/atlas lanes, CODE GIFTZ coding+document jobs, LAXII
  images, JAZMII text-to-video, GANGZII speech, the QUALITY gate);
  approval-gate, agent-turn, team, inline-LLM, NIIKI, external-provider and
  arbitrary-code nodes are documented as PROPOSED/FORBIDDEN with their exact
  structural gaps — never advertised.
- Boundaries preserved: no Studio UI, API, Prisma change, migration,
  dependency, or runtime behavior in M50.1; NIIKI remains M51 PLANNED;
  no main merge.

## 3. Relation to the February 2027 plan (historical record preserved)

The February 2027 launch documentation (`docs/feb2027/`) planned a narrower
agent roadmap: RIISHE + the specialist products with the Trust Engine as the
signature advantage, at a ₹0/month infrastructure budget. **That record is
preserved verbatim and remains historically accurate for what it planned.**

The owner's **November 28, 2026 direction expands that roadmap**: beyond the
launch scope, BEAN's AI ecosystem now explicitly includes the AUTOBOTS
workforce (user-configurable agents), AI STUDIO (visual workflows), NIIKI
(creative production) and M49.2 AUTOBOT TEAMS — all built ON the same one-
orchestrator/one-queue/one-trust architecture the Feb 2027 plan established,
not beside it. The expansion adds product surface; it changes none of the
launch plan's standing constraints (see §5).

Nothing in the Feb 2027 documents has been rewritten to match this
expansion; the expansion is recorded here and cross-linked.

## 4. Milestone sequence (technical direction)

- **M49.1 — AUTOBOTS foundation + universal AI docs.** Done.
- **M49.2 — AUTOBOT TEAMS**: user-configured teams over the EXISTING M41
  task graph and mission executor. **Done (2026-11-28).**
- **M50 — BEAN AI STUDIO**: visual node editor, node contracts, typed ports,
  graph validation, execution engine, reusable workflows, debugging and
  execution history. The workflow engine must reuse the existing job
  infrastructure, capability registry and Trust Engine. No arbitrary-code
  execution system. **M50.1 (2026-11-28): architecture + contracts
  SPECIFIED** (see [agents/M50.1-AI-STUDIO-ARCHITECTURE.md](../agents/M50.1-AI-STUDIO-ARCHITECTURE.md));
  implementation remains M50.2–M50.7 (schema/registry/validation →
  persistence/APIs → canvas UI → governed execution → run visibility →
  security/regression close-out).
- **M51 — NIIKI**: creative production (3D scenes, geometry, materials,
  lighting, animation, motion graphics, particles, VFX, compositing,
  editable project export). Evaluate real, appropriately licensed models and
  tools; use deterministic procedural and local rendering where genuinely
  supported; never claim full generative 3D/VFX without real implementation
  and acceptance evidence.
- **M52 — UNIFIED ECOSYSTEM**: connect Autobots, AI Studio, NIIKI and the
  existing specialists through RIISHE — one coordination fabric.

## 5. Standing constraints (binding for every milestone above)

- Zero recurring infrastructure budget as the default target.
- No Ollama.
- No mandatory paid API or GPU dependency.
- No hidden paid-provider fallback.
- No fabricated model or capability availability — statuses are measured;
  planned capabilities are documented as planned and excluded from product
  claims (the AUTOBOTS catalogue and capability registry enforce this by
  omission).
- Existing Trust, security, privacy and verification contracts remain
  mandatory in every new system.
- Credentials never enter prompts, logs, tool descriptions or browser code.
