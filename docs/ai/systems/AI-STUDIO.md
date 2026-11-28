# BEAN AI STUDIO — Visual Node-Based AI Workflows

**Status: PLANNED (M50). There is NO implementation in this repository today.**

This document is the recorded technical direction for the owner-approved M50
milestone. Nothing below is implemented; no UI, API, schema or execution path
exists for AI STUDIO in the current codebase. BEAN must never pretend.

## 1. Planned purpose and responsibilities

A visual, node-based environment where users compose AI workflows (nodes,
typed connections, reusable graphs) and execute them through BEAN's existing
governed infrastructure.

## 2. Planned architecture (technical direction)

- Visual node editor (client) with typed ports and node contracts.
- Graph validation layer: cycle detection, type-checking on edges, bounded
  graph size.
- Execution engine that COMPILES a validated graph onto the EXISTING job
  infrastructure (`src/lib/jobs/queue.ts`), capability registry
  (`src/lib/registry/`) and Trust Engine (`src/lib/trust/`) — reusing the
  durable GenerationJob substrate and receipt contracts.
- Reusable workflow persistence (owner-scoped) with versioned definitions.
- Debugging surface: per-node execution records from REAL runs.

## 3. Source-code locations

None yet. When implemented, this section will point at the real modules.

## 4–8. Model/provider integration, contracts, tools, data, workflow

To be defined at implementation time under the standing constraints: no new
parallel inference path (the gateway/registry remains the only model access),
no arbitrary-code execution nodes, every node's tool access server-validated
and Trust-gated, owner-scoped storage.

## 9. Tests and verification

To be written with the implementation; hermetic suites for graph validation,
compilation to job plans, and honest execution records.

## 10. Failure handling

Planned: per-node honest failure states; a failed node never fabricates a
downstream result; the graph run records the real partial state.

## 11. Current implemented capabilities

**None.** AI STUDIO does not exist in the product yet. The closest real
surfaces today are RIISHE's workflow detection (`src/lib/riishe/workflow.ts`)
inside chat and the M41 mission planner (`src/lib/riishe/mission/planner.ts`)
— both are fixed deterministic planners, NOT a user-facing node editor.

## 12. Partial capabilities and known limitations

Not applicable — nothing is partially built. (Any future "studio-like"
behavior seen in chat is the existing workflow/mission machinery, not AI
STUDIO.)

## 13. Planned capabilities (explicitly separated)

Everything in §2 is planned (M50). The roadmap record with standing
constraints lives in
[`docs/ai/BEAN-AI-ECOSYSTEM-EXPANSION.md`](../BEAN-AI-ECOSYSTEM-EXPANSION.md).
