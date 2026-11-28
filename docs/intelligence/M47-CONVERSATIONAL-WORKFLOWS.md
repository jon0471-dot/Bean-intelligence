# M47 — CONVERSATIONAL WORKFLOWS (advice / planning / read-only / protected / results)

The M45 conversational governance surface is unchanged in SHAPE; M47 made the tool channel reliable (native where measured), observable (per-turn records) and honest (fallbacks recorded). Everything below is enforced server-side; prompt guidance can never widen it.

## The five supported behaviors

| Behavior | Example turn | What the tool universe may do | Enforcement |
| --- | --- | --- | --- |
| Advice | "What deployment strategy should we use?" | `create_decision`, `inspect_decision` only | `classifyTurnIntent` → advice; `INTENT_ALLOWED_OPERATIONS` |
| Planning | "Give me a rollout plan" | + `propose_plan` (typed, digest-bound; no execution) | plan intent gate |
| Read-only inspection | "Inspect the integration repository's branches" | `inspect_decision` / `action_status` / adapter read ops through the decision tool | result/unknown intent gate + policy-checked read paths |
| Protected operations | "Create the branch and open the PR" | `request_approval` creates an UNGRANTED digest-bound request; `execute_plan` consumes ONLY an owner-granted, unmodified plan | two-key + owner-only Trust route + consume-once |
| Results | "What happened to the deployment?" | `action_status` / `action_result` / `explain_outcome` — the REAL decision + verification records | result intent; fabrication impossible (records come from the store) |

## The conversational approval rule (unchanged and re-pinned)

A natural-language "yes / approved / go ahead" is INTENT, never a grant. `request_approval` only creates the request; the grant flows exclusively through the owner-only Trust approval decision route bound to the exact plan digest; execution consumes the grant once and re-derives the binding digest. M47-A14/A15 re-pin this on the M47 tree; the M44/M45 suites re-ran green.

## Reliability: what changed under the hood

1. **Native channel where measured**: on the hosted lane the model now receives tools through the provider's function-calling interface (measured emitting genuinely) instead of being asked to emit text syntax — the M45/M46 walkthrough gap (advice-first answers with zero tool calls) is addressed at the PROTOCOL level, and any remaining decline is still measured per turn (`riishe.tool_invocation.declined` + the honest degraded note).
2. **Per-turn records**: turn/conversation/user identities (server-derived), protocol selected vs used, nativeState, tools offered, native calls emitted/validated/refused, decisionOps executed, executions, finalState — no secrets, no message content.
3. **Honest fallbacks**: a lane with no protocol answers plainly and SAYS so (finalState plain-fallback recorded); a text lane keeps the proven text protocol; nothing is ever reported as executed when it was not.

## Result-state vocabulary (customer-safe mapping preserved)

PLANNED · AWAITING_APPROVAL · APPROVED · EXECUTING · VERIFYING · SUCCEEDED · PARTIALLY_SUCCEEDED · FAILED · BLOCKED · REJECTED · CANCELLED · RECOVERY_REQUIRED · HONEST_UNAVAILABLE — M46's action-status mapping and UI are unchanged (no UI files touched in M47).

## Workflow evidence pointers

- A (repository investigation) + B (branch + PR): read lane measured LIVE (`git ls-remote`); write lane HONEST-UNAVAILABLE with the full rehearsal green (see M47-REPOSITORY-LIVE-OPERATIONS.md).
- C (staging deployment): LOCAL-LIVE evidence fresh (see M47-STAGING-LIVE-OPERATIONS.md).
- The complete conversational loop with a REAL model (native emit → governed validation → real execution → verified result round-trip) was measured LIVE through the adapter seam (`scripts/m47-live-native-e2e.ts`).
