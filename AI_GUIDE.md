# BEAN AI — Universal Guide (Master Entry Point)

**BEAN Intelligence's own AI ecosystem: what every system is, where it lives, what it can really do, and what it cannot do yet.**

This document is the front door to BEAN's AI documentation. Every BEAN AI system
has a dedicated guide under [`docs/ai/systems/`](docs/ai/systems/), written
against the actual source code of this repository — each guide states
implemented capabilities, partial capabilities and clearly-separated planned
capabilities. Nothing in these documents is aspirational marketing: BEAN must
never pretend.

---

## The one-paragraph map

BEAN runs **one orchestration core (RIISHE)**, **one governed execution loop**,
**one provider registry/gateway**, **one durable job queue**, **one Trust
Engine** and **one capability registry**. The specialist products (CODE GIFTZ,
LAXII, JAZMII, GANGZII, KNOWLEDGE, QUALITY) are real execution surfaces that
RIISHE delegates to through those shared substrates — never parallel stacks.
**BEAN AUTOBOTS** (M49.1) is the user-facing workforce layer on top: personas
users configure, executed through the SAME orchestration and delegation
contracts; **BEAN AUTOBOT TEAMS** (M49.2) compose those agents into teams on
the same mission machinery. **BEAN AI STUDIO** (M50) is architecture-
specified as of M50.1 (contracts frozen in
docs/agents/M50.1-AI-STUDIO-ARCHITECTURE.md) but has NO execution path in
this codebase today; **NIIKI** (M51) remains fully planned.

```
                         ┌──────────────────────────────┐
                         │   BEAN product shell (UI)    │
                         │  RIISHE · AUTOBOTS · studios │
                         └──────────────┬───────────────┘
                                        │ authenticated, owner-scoped APIs
                         ┌──────────────▼───────────────┐
                         │      RIISHE orchestrator     │  src/lib/riishe/
                         │  research · tools · verify   │
                         └───┬──────────┬──────────┬────┘
              capability plan│          │          │delegation (same gates)
             ┌───────────────▼──┐  ┌────▼────┐  ┌──▼──────────────┐
             │ hosted inference │  │  tools  │  │ durable job queue│
             │ gateway/registry │  │(bounded)│  │  src/lib/jobs/   │
             └──────────────────┘  └─────────┘  └──┬───────────────┘
                       │                           │
             ┌─────────▼─────────┐      ┌──────────▼──────────────┐
             │  Trust Engine     │      │ specialist workers:     │
             │ receipts/approvals│      │ CODE GIFTZ · LAXII ·    │
             └───────────────────┘      │ JAZMII · GANGZII        │
                                        └─────────────────────────┘
```

## The systems

| System | Guide | Status | One-line truth |
|---|---|---|---|
| RIISHE | [docs/ai/systems/RIISHE.md](docs/ai/systems/RIISHE.md) | Implemented | Central intelligence: orchestration, research, tools, verification, delegation |
| CODE GIFTZ | [docs/ai/systems/CODE-GIFTZ.md](docs/ai/systems/CODE-GIFTZ.md) | Implemented | Engineering: real coding jobs, versioned projects, restricted sandbox |
| LAXII | [docs/ai/systems/LAXII.md](docs/ai/systems/LAXII.md) | Implemented (backend-dependent) | Image creation/analysis through durable jobs |
| JAZMII | [docs/ai/systems/JAZMII.md](docs/ai/systems/JAZMII.md) | Implemented (backend-dependent) | Video production through durable jobs + director composition |
| GANGZII | [docs/ai/systems/GANGZII.md](docs/ai/systems/GANGZII.md) | Implemented | Audio: TTS, narration, music/song production, transcription |
| KNOWLEDGE | [docs/ai/systems/KNOWLEDGE.md](docs/ai/systems/KNOWLEDGE.md) | Implemented | Research & retrieval lanes + Knowledge Atlas |
| QUALITY | [docs/ai/systems/QUALITY.md](docs/ai/systems/QUALITY.md) | Implemented (mission gate) | Deterministic output verification |
| BEAN AUTOBOTS | [docs/ai/systems/AUTOBOTS.md](docs/ai/systems/AUTOBOTS.md) | Implemented (M49.1) | User-facing AI workforce: agent personas on real capabilities |
| BEAN AUTOBOT TEAMS | [docs/ai/systems/AUTOBOT-TEAMS.md](docs/ai/systems/AUTOBOT-TEAMS.md) | Implemented (M49.2) | User-configured agent teams executed through the existing M41 mission engine |
| BEAN AI STUDIO | [docs/ai/systems/AI-STUDIO.md](docs/ai/systems/AI-STUDIO.md) | **Architecture specified (M50.1) — no implementation** | Visual node-based AI workflow creation; contracts frozen in [docs/agents/M50.1-AI-STUDIO-ARCHITECTURE.md](docs/agents/M50.1-AI-STUDIO-ARCHITECTURE.md) |
| NIIKI | [docs/ai/systems/NIIKI.md](docs/ai/systems/NIIKI.md) | **Planned (M51)** — no implementation | 3D/animation/motion/VFX creative production |
| Capability registry | [docs/ai/systems/CAPABILITY-REGISTRY.md](docs/ai/systems/CAPABILITY-REGISTRY.md) | Implemented | The single source of product/task/backend truth and health |

## How the systems relate

1. **RIISHE is the only conversational intelligence.** The RIISHE chat route
   (`src/app/api/riishe/chat/route.ts`) and the BEAN AUTOBOTS run route
   (`src/app/api/autobots/agents/[id]/run/route.ts`) both call the ONE
   orchestrator (`src/lib/riishe/orchestrator.ts`). There is no second chat
   brain and no disconnected chatbot.
2. **Specialists are durable job surfaces, not chat personalities.** Media and
   engineering work goes through the GenerationJob queue
   (`src/lib/jobs/queue.ts`) with per-product workers and adapters; RIISHE and
   AUTOBOTS delegate through `src/lib/riishe/specialists.ts` — the same
   preflight gates (availability, rate limits, quotas, budget, dedupe) apply
   every time.
3. **The Trust Engine receipts every real action.** Conversation turns, agent
   turns, missions, memory commands and specialist jobs all record through
   `src/lib/trust/` adapters — one provenance ledger, no parallel books.
4. **The capability registry is the only availability truth.** Products,
   tasks, backends and per-capability health live in `src/lib/registry/` and
   surface through `/api/products` and `/api/health`. The UI may render that
   truth; it may never invent it.
5. **AUTOBOTS personas are data, not authority.** Agent instructions shape
   tone and focus only; tool access is derived server-side from the agent's
   fixed capability vocabulary (`src/lib/autobots/catalog.ts`) and re-checked
   per turn by the capability planner. The same discipline governs AUTOBOT
   TEAMS (M49.2): a team is a composition of the user's own agents executed
   through the EXISTING M41 mission machinery — task→member assignment is a
   pure function of the saved roster's capabilities, the verification gate
   is always the platform's QUALITY specialist, and member persona text is
   bounded, untrusted-framed user data that never widens authorization.

## Standing constraints (owner-approved, binding)

- Zero recurring infrastructure budget as the default target.
- No Ollama. No mandatory paid API or GPU dependency.
- No hidden paid-provider fallback.
- No fabricated model or capability availability — honest statuses everywhere.
- Existing Trust, security, privacy and verification contracts are mandatory
  in every system, including new ones.
- Credentials never enter prompts, logs, tool descriptions or browser code.

## Documentation rules

Every system guide documents: purpose; actual architecture; source locations;
model/provider integration; input/output contracts; tools and permissions;
data and memory handling; execution workflow; tests and verification; failure
handling and fallback behavior; implemented capabilities; partial capabilities
and known limitations; and planned capabilities marked as planned. When code
and documentation disagree, code wins and the document is corrected — never
the reverse.

## The wider AI documentation corpus

`docs/ai/` also carries the milestone-level engineering records written as the
ecosystem was built (model registry and provider matrix, retrieval/source
policy, local model lanes, device compute, worker operations, research
integration, acceptance reports M36–M48, and more). The per-system guides
above are the stable entry points; the milestone records remain the detailed
history and measurement evidence. Notable deep-dive documents:

- [`docs/ai/MODEL-REGISTRY.md`](docs/ai/MODEL-REGISTRY.md) — provider slots,
  protocol contracts, credential requirements, honest availability.
- [`docs/ai/BEAN-RETRIEVAL-AND-SOURCE-POLICY.md`](docs/ai/BEAN-RETRIEVAL-AND-SOURCE-POLICY.md) —
  retrieval, citation and freshness policy.
- [`docs/ai/LOCAL-MODEL-LANES.md`](docs/ai/LOCAL-MODEL-LANES.md) — the
  consented, honest local-inference lanes.
- [`docs/ai/WORKER-OPERATIONS.md`](docs/ai/WORKER-OPERATIONS.md) — running
  the durable job workers locally.
- [`docs/ai/BACKGROUND-AI-ARCHITECTURE.md`](docs/ai/BACKGROUND-AI-ARCHITECTURE.md) —
  the durable job/worker substrate in depth.

## Roadmap record

The owner's November 28, 2026 ecosystem-expansion direction (AUTOBOTS, AI
STUDIO, NIIKI, teams) is recorded with its relationship to the preserved
February 2027 plan in
[`docs/ai/BEAN-AI-ECOSYSTEM-EXPANSION.md`](docs/ai/BEAN-AI-ECOSYSTEM-EXPANSION.md).
