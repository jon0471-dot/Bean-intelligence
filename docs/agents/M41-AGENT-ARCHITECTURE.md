# M41 — Agent Architecture

> Branch: `feat/m41-autonomous-multi-agent-intelligence` · Milestone: M41 · Status: implemented as described; capability states are classified per §6 (implemented / verified / unavailable) — nothing on this page is claimed beyond its evidence.

## 1. One framework, seven roles

M41 turns BEAN into a reliable autonomous multi-agent system WITHOUT introducing a second agent framework. There is exactly one planning surface, one execution substrate and one provenance ledger:

| Layer | Module | Role |
|---|---|---|
| Planning | `src/lib/riishe/mission/planner.ts` (deterministic, pure) | Understands a multi-part objective, identifies deliverables, decomposes into tasks, derives dependencies, assigns specialists |
| Graph kernel | `src/lib/riishe/mission/graph.ts` (pure) | Structural validation (cycles, bounds), topological order, ready-set scheduling, skip propagation, deliverable-chain outcome decision |
| Contracts | `src/lib/riishe/mission/types.ts` (pure) | The full task contract: objective, inputs, expected output, dependencies, authorization scope, status, verification criteria, bounded resource limits |
| Verification | `src/lib/riishe/mission/verifiers.ts` (pure) | The quality specialist's execution path: deterministic inspection of REAL worker payloads before any task may settle done |
| Handoff | `src/lib/riishe/mission/handoff.ts` (pure) | Bounded, sanitized, deterministic digests that turn one agent's verified output into another agent's input (data, never chat) |
| Safety | `src/lib/riishe/mission/safety.ts` (pure) | Secret redaction at the ledger boundary, handoff DATA-block framing, structural vocabulary safety assertion |
| Ledger | `src/lib/riishe/mission/store.ts` (server) | `AgentMission` / `AgentMissionTask` rows, CAS transitions, owner-scoped reads, duplicate prevention, Trust task provenance |
| Executor | `src/lib/riishe/mission/executor.ts` (server) | The durable `mission-run` driver: schedules the DAG, delegates through the real specialist paths, polls the REAL durable jobs, verifies, corrects (bounded), recovers, settles honestly |

## 2. The specialist roster (all REAL execution paths)

| Agent | Execution path | Tasks |
|---|---|---|
| **RIISHE** (central) | planning kernel + mission runner + the existing chat orchestrator | plan, route, coordinate, review, deliver |
| **CODE GIFTZ** | `submitCodingDelegation` → real `coding-task` jobs (plan/diff/version/self-verify/sandbox) | `code-build`, `document-draft` |
| **LAXII** | `submitSpecialistJob` → real image-generation jobs | `image-asset` |
| **JAZMII** | `submitSpecialistJob` → real text-to-video jobs (ffprobe stream gate) | `video-asset` |
| **GANGZII** | `submitSpecialistJob` → real speech-synthesis jobs (validated WAV) | `audio-asset` |
| **Knowledge/research** | the real retrieval lanes: `web_search`/`read_url` gateway tools + the Knowledge Atlas tools | `research`, `knowledge` |
| **Quality/verification** | `verifiers.ts` + the aggregate deliverable gate + the specialists' own self-verification (hosted verifier) | `verify-deliverable` + per-task verification criteria |

Every specialist task is a real product job or a real tool execution under the SAME gates as the product surfaces — preflight availability, rate limits, quota, budget guards, duplicate refusal, per-user active caps. No specialist is claimed operational beyond what its underlying tools and models can execute.

## 3. Chat-surface integration (the only UI)

RIISHE offers missions through the EXISTING conversation with the same two-key permission discipline as every M36/M37 delegation:

- `capability-plan.ts` gains `missionDelegation`, whose single source of truth IS the deterministic planner (`planMission(text).ok`) — a mission is offered exactly when the planner accepts the objective.
- `delegate_mission` (explicit, `allowMissionDelegation` + plan agreement), `check_mission` (standard, owner-scoped, customer-safe states), `cancel_mission` (explicit, owner-scoped).
- Progress flows through the existing task-stage chips and job-event mechanisms; `check_mission` returns honest per-task states the model relays verbatim. No new UI, no redesign, no backend identities exposed.

REST surfaces (owner-scoped, for progress surfaces and tooling): `POST/GET /api/riishe/missions`, `GET /api/riishe/missions/[id]`, `POST /api/riishe/missions/[id]/cancel`.

## 4. Lifecycle

Mission: `planned → running → completed | completed_partial | failed | cancelled` (CAS; terminals immutable; failed/cancelled require a truthful note).
Task: `pending → running → done | failed | skipped | cancelled`, with the `failed → running` seam strictly budgeted (attempts or verification-driven corrections).

Outcome honesty (`decideMissionOutcome`): the deliverable chain (deliverable task + transitive inputs) decides the mission — chain failure ⇒ `failed`; verified deliverable + side failures ⇒ `completed_partial`; pending/running is `incomplete` (never a premature verdict); a plan is never a completion.

## 5. Workflows (contracts in M41-WORKFLOW-CONTRACTS.md)

Deterministic decompositions for the four canonical multi-agent workflows (A website-build, B media-production, C research→document, D debug-app), each ending in a `verify-deliverable` integrity gate. Refusals are honest: questions, single-domain requests and unrecognizable objectives are refused with reasons instead of being forced into missions.

## 6. Capability state (honest classification)

- **Implemented + unit-verified**: planning kernel, DAG scheduler, verifiers, handoffs, safety layer, store CAS/isolation/dedupe, executor lifecycle (97 mission tests, `bun test tests/unit/riishe-mission-*`).
- **Implemented + live-verified (M41 acceptance window)**: mission REST surfaces, cross-user isolation, duplicate refusal, cancellation propagation, media-production workflow (`completed_partial` with a REAL verified hosted video + live parallel-lane observations), research retrieval lane (6 real gateway sources), Knowledge Atlas lane (4 real references), verifier verdicts on done tasks.
- **Blocked in the acceptance window (honest)**: the document/website build tasks were blocked by the hosted self-verifier's strict audit (2 FAIL rows, root cause: the audit runs over the file-fenced coding reply and flagged content requirements; needs a mission-aware verifier focus — follow-up, NOT claimed) and one build was provider-truncated (honest-unavailable). The mission machinery recorded these honestly — no false completions.
- **Owner-hardware / operations territory**: live server-restart resume drill (the resume machinery is unit-pinned and rides the engine lease recovery accepted in M26/M40).
