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

- **M49.1 (this milestone)** — AUTOBOTS foundation + universal AI docs. Done.
- **M49.2 — AUTOBOT TEAMS**: user-configured teams over the EXISTING M41
  task graph and mission executor (`src/lib/riishe/mission/`); teams compose
  only actual authorized capabilities; no agent-to-agent free chat.
- **M50 — BEAN AI STUDIO**: visual node editor, node contracts, typed ports,
  graph validation, execution engine, reusable workflows, debugging and
  execution history. The workflow engine must reuse the existing job
  infrastructure, capability registry and Trust Engine. No arbitrary-code
  execution system.
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
