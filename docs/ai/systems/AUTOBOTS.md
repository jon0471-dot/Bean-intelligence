# BEAN AUTOBOTS — User-Facing AI Workforce

**Status: implemented (M49.1, November 28, 2026; teams delivered M49.2). The user-facing workforce layer on BEAN's existing execution systems.**

## 1. Purpose and responsibilities

BEAN AUTOBOTS lets users create, configure, manage and work with AI agents
representing professional and personal roles. An Autobot is a **persona**
(identity, profession, instructions, capability selection, memory mode) —
never a new execution worker: every turn rides RIISHE orchestration and every
delegated action rides the existing durable job queue and Trust contracts.

## 2. Actual architecture

Three layers, one authority chain:

1. **Catalogue (pure, shared)** — `src/lib/autobots/catalog.ts`: the fixed
   category/capability vocabularies, the server-authoritative permission
   derivation (`deriveAgentPermissions`) and the verified template
   collection (19 templates across 8 categories). Imported by BOTH the UI
   and the server, so the UI can never advertise a capability the server
   does not enforce.
2. **Service (server)** — `src/lib/autobots/agent-service.ts`: bounded
   field normalization (the only client-JSON→storage path), owner-scoped
   CRUD with rate limiting, per-account cap (50) and audit records.
3. **Run bridge (server)** — `src/lib/autobots/agent-run.ts`: permission
   derivation from `capabilityKey` ONLY, bounded persona block composition
   (untrusted framing), owner-scoped conversation resolution and history
   loading.

UI: `src/components/bean/autobots/index.tsx` (Discover / My Agents / Create)
+ `workspace.tsx` (workspace chat + details). M49.2 adds the TEAMS surface
inside the same product (`teams.tsx`, the Agents⇄Teams switch in
`index.tsx`) — see [AUTOBOT-TEAMS.md](AUTOBOT-TEAMS.md) for the full team
architecture. Navigation: `ViewId 'autobots'` in
`src/components/bean/shell.tsx`, mounted in `src/app/page.tsx`.

## 3. Source-code locations

| Concern | Path |
|---|---|
| Catalogue + permissions | `src/lib/autobots/catalog.ts` |
| Service/CRUD | `src/lib/autobots/agent-service.ts` |
| Run bridge | `src/lib/autobots/agent-run.ts` |
| Catalogue API | `src/app/api/autobots/catalog/route.ts` |
| Agents CRUD API | `src/app/api/autobots/agents/route.ts`, `.../[id]/route.ts`, `.../[id]/duplicate/route.ts` |
| Run API (SSE) | `src/app/api/autobots/agents/[id]/run/route.ts` |
| History API | `src/app/api/autobots/agents/[id]/history/route.ts` |
| UI | `src/components/bean/autobots/` |
| Persona prompt block | `buildAgentPersonaBlock` in `src/lib/riishe/prompts.ts` |
| Persistence | Prisma `AutobotAgent`, `AutobotConversation`, `AutobotMessage` |

## 4. Model and provider integration

Agent turns run through `preflight(userId, 'riishe', 'chat')` — the SAME
chat product gates as RIISHE (availability, 20/min burst, 300/day durable
quota, provider budget guard, concurrency slot, `assertChatRequest` caps) —
then the ONE orchestrator. Delegation-capable agents submit jobs through
`src/lib/riishe/specialists.ts` (the same gates, dedupe and durable rows as
product submissions).

## 5. Input/output contracts

- Create/update: bounded fields (name 60, role 60, industry 80,
  description 1000, personality 1000, instructions 4000, language 60);
  `capabilityKey` ∈ fixed vocabulary; `memoryMode` ∈ {disabled,
  conversation}; unknown values are honest 422s.
- Run: `{ message ≤12000, conversationId? }` → the standard BEAN SSE frames
  (`conversationId` first, then delta/reset/stage/research/tool/task/done)
  or JSON. Persona/instructions are injected ONLY via the pre-built,
  bounded, untrusted-framed `personaBlock` (see §6).
- History: oldest-first transcript with the honest orchestration metadata.

## 6. Tools and permissions — the security boundary

- `agentPermissionSet(capabilityKey)` derives the turn's permission set from
  the agent's capability ONLY: conversational base
  (`allowCodeExecution`, `allowMissionDelegation`, `allowExecutionGovernance`)
  plus the capability's delegation key (`visual`→`allowImageGeneration`,
  `motion`→`allowVideoCreation`, `voice`→`allowSpeechSynthesis`,
  `engineering`→`allowCodingDelegation`). Persona/instruction text is NEVER
  consulted; unknown keys degrade to the base set.
- The persona block ends with a PLATFORM AUTHORITY guard (the final word in
  the system prompt), and the block itself declares the persona as
  user-configured data that cannot authorize tools/policy changes.
- The per-turn capability planner still narrows every gated tool — a
  capability grants a ceiling, not a per-turn guarantee.
- Approval-required actions ride the existing Trust Engine contracts;
  agents cannot bypass them.

## 7. Data and memory handling

`AutobotAgent` / `AutobotConversation` / `AutobotMessage` are owner-scoped
(rows always matched with the session user; foreign ids are honest 404s).
Agent transcripts are SEPARATE from RIISHE conversations — no context
mixing. Memory modes: `disabled` (default) keeps no cross-session memory;
`conversation` retains this workspace's transcript window. Agent-level
long-term memory is NOT implemented in M49.1 (planned; nothing claims it).

## 8. Execution workflow

open workspace → history load → user turn → preflight (chat gates) →
resolve (agent, conversation) owner-scoped → dangling-retry collapse →
persist user row → orchestrateTurn (persona block + capability-derived
toolContext) → verification pipeline → persist assistant row + metadata →
executionCount/lastExecutedAt updated → usage metering + Trust receipt.

## 9. Existing tests and verification

- `tests/unit/m49-autobots-catalog.test.ts` (18): capability/permission
  contracts, template honesty, licensed-profession guard, no planned-product
  claims.
- `tests/unit/m49-autobots-agent-service.test.ts` (18): normalization, caps,
  owner scoping, duplicate/delete semantics.
- `tests/unit/m49-autobots-run-security.test.ts` (14): persona-cannot-widen
  permissions, untrusted framing + authority guard, owner-scoped resolution,
  orchestrator persona ride (and RIISHE-path absence).

## 10. Failure handling and fallback behavior

Stream failures classify exactly like RIISHE chat; the honest failure text
persists and the bounded dead-wire reconciliation adopts a server-persisted
answer only on a head-match; a failed-before-answer turn leaves the
dangling-retry collapse in place so a retry never duplicates the question.
Archived agents refuse new turns with a 409.

## 11. Current implemented capabilities

- Searchable/filterable catalogue of 19 verified templates in 8 categories.
- Custom agent creation/editing with safe defaults, bounds and validation.
- Owner-scoped persistence (survives logout), duplicate/archive/delete.
- Real conversational execution through RIISHE (research, documents, math,
  sandbox-on-request, governed execution) with honest statuses.
- Capability-exact delegation: image (LAXII), video (JAZMII), speech
  (GANGZII), engineering (CODE GIFTZ jobs) — all queued, gated, receipted.
- Honest details view: capabilities, limits, execution history counts.

## 12. Partial capabilities and known limitations

- No agent-level long-term memory (workspace transcript window only).
- No per-agent memory-store integration (user RiisheMemory is NOT injected
  into agent turns — deliberate privacy scope for M49.1).
- Media/engineering delegation requires the corresponding backends to be
  configured; otherwise the refusal is honest (never simulated).
- Agent-to-agent chat does not exist and will not exist: team collaboration
  (M49.2) is coordinated execution through the M41 kernel with structured
  verified handoffs — see [AUTOBOT-TEAMS.md](AUTOBOT-TEAMS.md).
- The catalogue is a curated verified set — it does not claim every
  profession is implemented.

## 13. Planned capabilities (NOT implemented)

- ~~M49.2 — AUTOBOT TEAMS~~ → **DELIVERED in M49.2**:
  [AUTOBOT-TEAMS.md](AUTOBOT-TEAMS.md) (user-configured teams over the
  existing M41 task graph/mission executor; deterministic capability-based
  assignment; immutable execution snapshots; the platform QUALITY gate
  stays uncapturable).
- Agent-level durable memory (consented, owner-scoped).
- Deeper per-agent tool selection UI (still server-validated).
Nothing else in this list is claimed by the running product today.
