# M45 — Conversational Decision Tool (docs/intelligence)

## What it is

The per-turn bridge between RIISHE's chat flow and the M44 decision/execution engine. One registered tool — `execution_decision` — with eight explicit operations:

| Operation | What it does | State-consuming? |
| --- | --- | --- |
| `create_decision` | Evidence-grounded decision from the user's objective (M43 evidence via the guarded research lane; honest `insufficient-evidence` / `escalated` when evidence is thin) | no |
| `inspect_decision` | Owner-scoped retrieval of a stored decision | no |
| `propose_plan` | Structured execution proposal: typed M44 contracts, content digest, risk classes DERIVED from action types | no |
| `request_approval` | Creates approval REQUESTS bound to the exact payload digest; never grants | yes (one-shot per turn) |
| `execute_plan` | Runs ONLY an unmodified, approved plan through the M44 runner (consume-once approvals, independent verification) | yes |
| `action_status` | Lifecycle status of the bound actions | no |
| `action_result` | Independently verified results only — unverified work is never reported as success | no |
| `explain_outcome` | Why an action was blocked/rejected/failed/completed | no |

## Conversational intent discrimination

The orchestrator classifies every user message server-side (`conversation-intent.ts`): `advice | plan | authorize | execute | result | unknown`. The classification is stamped into the ToolContext — the model can neither supply nor forge it. The intent gate (`INTENT_ALLOWED_OPERATIONS`) then permits:

- advice → create/inspect only (advice NEVER triggers execution or approvals)
- plan → + propose_plan
- authorize → request_approval, inspect, status
- execute → execute_plan, inspect, status
- result → inspect, status, result, explain

## Binding and isolation

Every decision is bound to `(user, conversation, turn, mission?)` with a canonical binding digest (`conversation-binding.ts`). Validation order: tamper → user → conversation → mission. A different user gets an honest "Decision not found." (no existence leak). A one-shot turn ledger catches duplicate state-consuming operations in the same turn; the Trust approval's consume-once remains the durable layer.

## Storage

Prisma model `ExecutionDecision` (additive; SQLite via Prisma in this deployment). Fields: objective, status, decisionKind, bounded `decisionJson` / `planJson` / `recordsJson`, planDigest, trustTaskId, bindingDigest. Audit rides the existing Trust ledger (`addTrustEvidence`); outcomes finalize through `finalizeTrustTask` with honest statuses.

## What it deliberately does NOT do

- It does not treat conversational "yes" as a grant — grants flow only through the existing owner-only Trust approval decision route.
- It does not create an orchestration framework, a second decision engine, or a second approval system.
- It does not widen any M44 risk class: the plan layer re-derives risk from the action TYPE; a model-mislabeled alternative cannot smuggle an unsafe action past the gate.
