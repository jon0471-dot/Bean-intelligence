# RIISHE — Central Intelligence & Coordination

**Status: implemented and live. RIISHE is BEAN's one conversational intelligence core.**

## 1. Purpose and responsibilities

RIISHE is the single orchestration core every BEAN conversation rides — the
RIISHE product view, BEAN AUTOBOTS agent turns and the M41 mission planner all
execute through it. Responsibilities: turn classification, automatic research,
grounded answering, deterministic verification, honest limitation reporting,
bounded tool execution and specialist delegation.

## 2. Actual architecture

One orchestrator, one governed execution loop:

- **Orchestrator** — `src/lib/riishe/orchestrator.ts` (`orchestrateTurn`):
  composes the evidence pack, the system prompt (`src/lib/riishe/prompts.ts`),
  the tool plan and the verification pipeline; emits SSE events.
- **Research pipeline** — `src/lib/research/pipeline.ts`: automatic multi-query
  retrieval with ranking (`rank.ts`), freshness (`freshness.ts`), claim
  verification (`claim-verification.ts`) and contradiction reasoning; feeds a
  cited evidence pack, never free-floating search text.
- **Tool loop** — `src/lib/riishe/toolloop.ts` over the registry in
  `src/lib/riishe/tools/` (registration: `builtin-registry.ts`). Native tool
  protocol lanes exist (M47.2); text-protocol lanes remain.
- **Capability planner** — `src/lib/riishe/capability-plan.ts`: the server
  decides per turn which gated tools (code execution, delegation) are even
  offered. Two-key authorization: the route's permission set AND the per-turn
  plan must both agree.
- **Completion policy** — `src/lib/riishe/completion-policy.ts`: terminal
  states are assigned from REAL execution facts (never by the model).
- **Workflow detection** — `src/lib/riishe/workflow.ts` composes multi-domain
  turns into staged plans.
- **Continuation/retry** — `src/lib/riishe/continuation.ts`, `retry.ts`,
  `stream-config.ts` bound every long-running phase.

## 3. Source-code locations

| Concern | Path |
|---|---|
| Orchestrator | `src/lib/riishe/orchestrator.ts` |
| Prompts & persona blocks | `src/lib/riishe/prompts.ts` |
| Tool contracts/registry | `src/lib/riishe/tools/{types,registry,builtin-registry}.ts` |
| SSE wire | `src/lib/riishe/sse.ts` (server), `src/lib/riishe/sse-client.ts` (client) |
| Chat API (product) | `src/app/api/riishe/chat/route.ts` |
| Autobots turn API | `src/app/api/autobots/agents/[id]/run/route.ts` |
| Specialist delegation | `src/lib/riishe/specialists.ts` |
| Mission framework (M41) | `src/lib/riishe/mission/` |

## 4. Model and provider integration

Inference runs through the provider registry/gateway
(`src/lib/registry/backends.ts`, `src/lib/registry/models.ts`,
`src/lib/upstream/gateway.ts`, adapters in `src/lib/adapters/hosted-llm.ts`)
selected by `src/lib/router/router.ts` preflight. Every turn is gated by
availability, rate limits, durable daily quotas, provider budget guards and a
concurrency slot (`preflight` + `assertChatRequest`). There is no hidden
provider fallback and no Ollama.

## 5. Input/output contracts

- Input: `{ conversationId?, message ≤12,000 chars, documentIds? ≤3, retry? }`
  (zod-validated).
- Output: streamed SSE frames (`conversationId`, `delta`, `reset`, `stage`,
  `research`, `tool`, `task`, `done` with honest `meta`) or a JSON turn
  (`content`, `metadata`, `durationMs`). `metadata` carries cited sources,
  assigned response states, verification checks and timings.
- Agent turns (M49.1) add the `personaBlock` input — a bounded, pre-built,
  untrusted-framed string (see [AUTOBOTS](AUTOBOTS.md)); absent for every
  existing caller.

## 6. Tools and permissions

Registered tools: `web_search`, `read_url`, `calculate`, `run_code`,
`read_document`, `analyze_image`, `search_document`, `search_atlas`,
`read_atlas_doc`, `generate_image`, `create_video`, `synthesize_speech`,
`delegate_coding`, `check_coding_job`, `delegate_mission`, `check_mission`,
`cancel_mission`, `execution_decision`. Delegation tools are
`permission: 'explicit'` with server-side permission keys
(`allowImageGeneration`, `allowVideoCreation`, `allowSpeechSynthesis`,
`allowCodingDelegation`, `allowMissionDelegation`,
`allowExecutionGovernance`) — the client can never set them.

## 7. Data and memory handling

Conversations/messages persist owner-scoped (`Conversation`/`Message`);
overflowing history is digest-condensed (`summarize.ts`). User memory is the
consented, owner-scoped RiisheMemory store with explainable recall (M33) and
sensitive filtering. Autobots workspaces keep separate transcripts
(`AutobotConversation`/`AutobotMessage`) so agent context never mixes with
RIISHE assistant context.

## 8. Execution workflow

classify → plan capabilities → (research pipeline) → (tool loop) → solve →
deterministic verification (arithmetic re-evaluation, citation audit,
injection guard) → completion-policy state assignment → persist → receipt.

## 9. Existing tests and verification

`tests/unit/riishe*.test.ts` (~30 suites: streaming, continuation,
delegation, missions, memory, toolloop, retrieval lanes, identity), plus
`tests/unit/injection-guard.test.ts`, `capability-plan.test.ts`,
`p0-completion-policy.test.ts`, `chat-recovery-quota.test.ts`,
`m49-autobots-*.test.ts`. Regression census is re-run per milestone.

## 10. Failure handling and fallback behavior

Upstream failures are classified honestly (`BACKEND_TIMEOUT`,
`UPSTREAM_RATE_LIMITED`, `UPSTREAM_AUTH`, …) — never fabricated into answers.
Research failures degrade the turn (empty evidence pack + degraded notes);
consented browser-local recovery exists behind explicit consent
(`src/lib/riishe/local-fallback.ts`). The client reconciles dead-wire
disconnects against the persisted transcript with a bounded schedule.

## 11. Current implemented capabilities

Grounded multi-source research with citations; document upload/reading incl.
images (pixel re-consultation); deterministic math; restricted-sandbox code
execution on explicit request; specialist delegation (image/video/audio/
engineering/missions); governed execution decisions (M45); multilingual
answering; memory commands; honest task-stage reporting.

## 12. Partial capabilities and known limitations

Semantic auto-routing is hermetic-mocked in unit tests and measured separately
(`auto-grounding.test.ts`); pinned local embedding/MiniLM lanes require the
runtime assets to be installed (honest unavailable fallback otherwise); local
model fallback requires WebGPU + explicit user consent (honest unavailable
when absent).

## 13. Planned capabilities (NOT implemented)

Deeper agentic planning inside plain chat (beyond M41 missions); long-horizon
memory across conversations; additional specialist delegation surfaces as
those products expand (e.g. future NIIKI lanes). These are roadmap items —
nothing in the current code claims them.
