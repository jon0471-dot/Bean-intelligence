# BEAN AI STUDIO — Visual Node-Based AI Workflows

**Status: ARCHITECTURE SPECIFIED (M50.1, 2026-11-28). The runtime product is NOT implemented — no Studio UI, no API, no Prisma models, no workflow execution path exists in this repository today.**

M50.1 froze the complete architecture and contracts in
[`docs/agents/M50.1-AI-STUDIO-ARCHITECTURE.md`](../../agents/M50.1-AI-STUDIO-ARCHITECTURE.md)
(verified against source at baseline `f702cb2`). That document is the single
authority for the Studio design; this page records the system-guide summary
and keeps the implementation status truthful. BEAN must never pretend.

## 1. Planned purpose and responsibilities

A visual, node-based environment where users compose AI workflows (nodes,
typed connections, reusable graphs) and execute them through BEAN's existing
governed infrastructure. M50.1 specified the product surface (canvas, node
library, inspector, manager, versions, validation panel, run controls,
debugger, history, reusable workflows — architecture doc §3), the versioned
node contract and port type system (§4), the first-release node catalogue
built only from proven capabilities (§5), the deterministic graph validator
and compiler that compiles validated graphs onto the EXISTING M41 mission
machinery (§6), the security/Trust/ownership invariants (§7), the proposed
persistence and API contracts (§8, nothing created), the honest failure
states (§9), the UI architecture including the honest mobile strategy (§10)
and the M50.2–M50.7 implementation roadmap (§11).

## 2. Actual architecture (M50.1 — the frozen design, in one paragraph)

A user-authored visual graph is stored as an immutable, schema-versioned
`WorkflowVersion`. Execution is a PURE, deterministic compiler
(`compileWorkflowToPlan`) that maps every supported node to exactly ONE
existing M41 task kind (`buildTaskSpec`-constructed, `KIND_AGENT`/
`KIND_AUTH_SCOPE`-derived), always appends the platform QUALITY
`verify-deliverable` gate, and hands the resulting plan to the EXISTING
`createMissionFromPlan` — ONE durable `mission-run` GenerationJob, the ONE
Trust ledger, the ONE specialist delegation paths with every preflight gate,
verifier and honest outcome rule unchanged. No second queue, no workflow
engine, no duplicate specialists, no arbitrary-code nodes, no NIIKI nodes.
Proposed persistence is three additive tables (`WorkflowDefinition`,
`WorkflowVersion`, `WorkflowRun` — a thin run-to-version/mission reference);
per-node run state remains the `AgentMissionTask` ledger. Nothing above is
implemented: it is the contracted design M50.2–M50.7 must build.

## 3. Source-code locations

None yet (M50.1 is documentation-only). The proposed layout is in the
architecture doc §8.3/§11 (new `src/lib/ai-studio/` pure modules, additive
Prisma tables, `src/app/api/ai-studio/**`, `src/components/bean/aistudio/**`).
When implementation milestones land, this section will point at the real
modules only.

## 4–8. Model/provider integration, contracts, tools, data, workflow

Specified in the architecture doc (§4 node contract/type system; §5 node
catalogue with per-node real backends; §6 validation/compilation; §7 security;
§8 persistence/API). Standing constraints apply unchanged: no parallel
inference path (the gateway/registry remains the only model access), no
arbitrary-code execution nodes, every node's access server-validated and
Trust-gated, owner-scoped storage.

## 9. Tests and verification

To be written with each implementation milestone (the roadmap's per-milestone
test columns). M50.1 itself executed documentation-only checks (architecture
doc §13): link/path existence, JSON example validity, docs-only diff proof
and cross-document status consistency.

## 10. Failure handling

Specified (architecture doc §9): run/node lifecycles inherit the M41 honest
states; a planned node is never a completed node; a queued submission is
never a completed execution; a generated artifact is not a verified
deliverable until the existing verification contract confirms it; partial
completion, cancellation propagation and crash recovery are inherited from
the mission substrate.

## 11. Current implemented capabilities

**None.** AI STUDIO does not exist in the product yet. The closest real
surfaces today remain RIISHE's workflow detection (`src/lib/riishe/workflow.ts`)
inside chat and the M41 mission planner
(`src/lib/riishe/mission/planner.ts`) — both fixed deterministic planners,
NOT a user-facing node editor.

## 12. Partial capabilities and known limitations

Not applicable — nothing is partially built. The architecture itself records
structural gaps that keep planned ideas honest: no mid-run approval gate
(no mission-task approval-wait state exists), no inline conversational-model
node (would create a new model-call path), no agent/team nodes in M50,
JAZMII delegation remains text-to-video only (architecture doc §5, §12).

## 13. Planned capabilities (explicitly separated)

Everything in §2 is specified-but-not-built. Implementation sequence:
M50.2 (schema + registry + pure validation/compile) → M50.3 (persistence +
CRUD APIs + versioning) → M50.4 (canvas UI) → M50.5 (governed execution
adapter) → M50.6 (run visibility/debugging/history) → M50.7 (security/
recovery/regression close-out) — architecture doc §11. The roadmap record
with standing constraints lives in
[`docs/ai/BEAN-AI-ECOSYSTEM-EXPANSION.md`](../BEAN-AI-ECOSYSTEM-EXPANSION.md).
NIIKI remains M51 PLANNED; the M52 unified-ecosystem direction is unchanged.
