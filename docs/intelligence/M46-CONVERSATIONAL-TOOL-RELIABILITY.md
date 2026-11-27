# M46 — Conversational Tool Reliability (docs/intelligence)

Milestone: M46.1 (Phase 2) · branch `feat/m46-production-readiness-live-operations` · commit `593ddd7`

## The problem M45 left

M45 wired the `execution_decision` tool into the conversational universe, but the recorded production-model walkthrough answered two governance-shaped requests advice-first **without emitting a tool call** — and nothing in the system could see the difference. Tool invocation ran over the RIISHE text protocol (`TOOL_CALL: {json}` lines in `toolloop.ts`), because every BEAN chat lane exposes plain chat completions; whether the model emitted protocol syntax was invisible.

## The invocation chain, traced end to end

User message → server-derived intent (`conversation-intent.ts`, classifier over the REAL message) → capability planning (`planCapabilities`, `executionGovernanceRequested`) → route permission key `allowExecutionGovernance` (chat route) → two-key AND in the orchestrator (`orchestrator.ts` ~554) → tool registry (`builtin-registry.ts`) → `describeTools` catalog into the system prompt (`prompts.ts buildToolSection`) → model pass (text protocol) → `parseToolCalls` → `executeToolCall` (permission re-check + validation + timeout) → decision engine (`decision-tool.ts`, intent gate `guardOperation`) → authorization (Trust approvals, digest-bound) → execution (M44 runner + M45/M46 adapters) → independent verification (VERIFYING → SUCCEEDED-only edge) → user-facing result (M45 status views + M46 honest degraded notes).

## What M46.1 changed

1. **Protocol capability honesty** — `src/lib/riishe/tool-invocation.ts`: per-backend protocol descriptors derived from the real registry facts (`bean-llm-hosted-primary`, `bean-llm-openai-compatible`, `bean-chat-local-llamacpp` — all `'text'`; none exposes native function calling today, and the `'native'` verb is deliberately not invented). Unknown backends default to `'text'` so a future lane is never silently refused.
2. **Capability check, not authorization shortcut** — `resolveToolInvocationPolicy` gives a `'none'`-protocol lane the existing safe fallback (plain chat, tools never offered) with an honest degraded note. Permissions, capability planning and intent gates are untouched.
3. **Invocation behavior ≠ task completion** — `classifyInvocationOutcome` (`tool-call-emitted` / `model-declined-tool-call` / `no-tools-offered`), a bounded observational ledger, and the structured log event `riishe.tool_invocation.declined`. A declined governance universe now adds the customer-safe degraded note: "Governed-execution tools were available this turn but the model answered without invoking them … NO governed action was created, approved or executed."
4. **Schema delivery** — when `execution_decision` is active, the system prompt carries a bounded governance guide: exact call shapes for `create_decision` / `propose_plan` / status operations, plus the explicit rule that conversational approval is intent, **NOT a grant**. Guidance only — every gate stays server-side.
5. **Classifier precision** — advice now catches "is appropriate / best / suitable / recommended" and plural "recommendations"; the governance universe opens for inspect / inspection / deployed / deployment / revision / repository / branch vocabulary (the M46 read-only matrix).
6. **Security fix (Phase 2 requirement 9)** — `buildActionContract` now **refuses unknown action types outright**. Before the fix, a model-invented type produced a contract with `riskClass`/`reversibility` UNDEFINED and leaked an arbitrary string into the digest-bound plan. The action-type vocabulary is closed.

## Preserved guarantees (re-verified by tests)

Server-derived intent (the model cannot forge `turnIntent`); advice never executes; two-key (route key AND capability plan AND in-tool re-check); owner-only approval; digest-bound approvals; consume-once; cross-user isolation; delegation limits; model-generated parameters cannot expand scope (fixed scope table + closed vocabulary).

## Measured live behavior (this milestone, real deployment)

Production build on 127.0.0.1:3100, real chat turns through the API and the UI:

| Turn | Intent classified | Universe | Model tool call | Honest record |
| --- | --- | --- | --- | --- |
| "What deployment strategy is appropriate for releasing a small change to staging?" | advice | OPEN | none | `riishe.tool_invocation.declined` + degraded note visible in metadata |
| "I approve the plan, go ahead and execute it" | authorize | OPEN | none | reply does NOT treat "I approve" as a grant; decline measured |
| "We need to decide between merging … Create a decision and weigh the options" | unknown | OPEN | none | decline measured |
| UI composer turn (migration rollout question) | advice | OPEN | none | decline measured; reply honest; status "Completed with limitations" |

**Honest conclusion:** the authorized hosted lane's protocol compliance for the governed tool remained unreliable in every sampled window (0 tool calls in 4 live governance-shaped turns). That limitation is now REPORTED per turn, the safe fallback (a plain, honest answer) is used, nothing is pretended to have executed, and authorization was never weakened to force tool usage. Invocation behavior is tracked separately from task completion — the four turns COMPLETED as advice/planning content while recording 0 governed invocations.

## Test coverage

`tests/unit/m46-tool-invocation.test.ts` (28 cases, LOCAL-INT): the full conversational acceptance matrix — advice-only, planning, read-only tool selection, schema delivery, protocol honesty, observability, and adversarial shapes (forged approval, injection, cross-user, missing permission key, delegation, scope expansion).
