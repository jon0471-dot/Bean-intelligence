# BEAN AI STUDIO — Visual Node-Based AI Workflows

**Status: M50.1 ARCHITECTURE SPECIFIED + M50.2 PURE GRAPH CORE IMPLEMENTED (2026-11-28). The user-facing Studio runtime is NOT implemented — no persistence, no APIs, no canvas UI, no workflow execution path exists yet. What exists today is the server-authoritative technical core: a versioned workflow-graph schema, the first-release node registry, deterministic graph validation, and a deterministic compiler that turns validated graphs into M41 mission task specifications. It executes nothing.**

M50.1 froze the complete architecture and contracts in
[`docs/agents/M50.1-AI-STUDIO-ARCHITECTURE.md`](../../agents/M50.1-AI-STUDIO-ARCHITECTURE.md)
(verified against source at baseline `f702cb2`; its §14 addendum records the
M50.2 implementation). That document is the single authority for the Studio
design; this page records the system-guide summary and keeps the
implementation status truthful. BEAN must never pretend.

## 1. Purpose and responsibilities

A visual, node-based environment where users compose AI workflows (nodes,
typed connections, reusable graphs) and execute them through BEAN's existing
governed infrastructure. M50.1 specified the full product surface, the
versioned node contract and port type system, the first-release node
catalogue built only from proven capabilities, the deterministic graph
validator and compiler, the security/Trust/ownership invariants, the proposed
persistence and API contracts, the honest failure states, the UI/mobile
strategy and the M50.2–M50.7 implementation roadmap.

## 2. Actual state (M50.2 — implemented core, in one paragraph)

A user-authored workflow graph is a versioned, schema-checked DATA document
(`schemaVersion 1`; bounded nodes/edges/config; data-only — a graph cannot
carry task kinds, agents, scopes, permissions or verification overrides).
The server-side registry (`src/lib/ai-studio/registry.ts`) holds EXACTLY the
ten first-release nodes: eight executable contracts, each mapping to ONE real
M41 task kind whose agent and authorization scope are derived by the existing
`buildTaskSpec`, and two structural contracts (`input.text`,
`output.deliverable`) that carry no task kind at all. Pure validation
(`schema.ts` + `validate.ts`) enforces strict schema discipline, exact typed
port compatibility, cycle freedom, required inputs, per-node config bounds,
the REAL M41 caps (projected task count, gate dependency cap, critical-path
wall clock) and honest snapshot-only availability diagnostics. The pure
compiler (`compile.ts`) turns a validated graph into a `CompiledWorkflowPlan`
— `buildTaskSpec`-constructed tasks, deterministic ids and ordering, the
UNCAPTURABLE platform `verify-deliverable` gate (auto-appended exactly once,
never overridable), and the deliverable designation pointing at the real
producer. The plan is ready for the M50.5 governed-run adapter; nothing
executes in M50.2.

## 3. Source-code locations (real modules, M50.2)

- `src/lib/ai-studio/types.ts` — versioned graph + discriminated node contracts + diagnostics + compiled-plan types
- `src/lib/ai-studio/limits.ts` — `WORKFLOW_LIMITS` (maxNodes 9, maxEdgesPerNode 6, graphJsonMaxChars 65 536, configTextMaxChars 4 000) and specialist-mirrored config bounds
- `src/lib/ai-studio/registry.ts` — the ten-node first-release catalogue, proposed-node exclusion records, lookup helpers
- `src/lib/ai-studio/diagnostics.ts` — bounded customer-safe diagnostic constructor
- `src/lib/ai-studio/schema.ts` — strict parsing (schema/version/size + registry resolution)
- `src/lib/ai-studio/validate.ts` — validation stages 3–10 (ports, cycles, required inputs, config, bounds, availability, status, deliverable)
- `src/lib/ai-studio/compile.ts` — the deterministic compiler (the ONE pure adapter)
- Tests: `tests/unit/m50-2-graph-schema.test.ts`, `m50-2-node-registry.test.ts`, `m50-2-ports.test.ts`, `m50-2-graph-validation.test.ts`, `m50-2-compiler.test.ts` (helper: `tests/helpers/m50-2-graphs.ts`)

Still proposed (NOT created): the additive Prisma tables
(`WorkflowDefinition`/`WorkflowVersion`/`WorkflowRun`), `src/app/api/ai-studio/**`,
`src/components/bean/aistudio/**`, the M50.5 `'workflow'` mission-type
extension and the governed-run bridge (architecture doc §8/§11).

## 4–8. Model/provider integration, contracts, tools, data, workflow

The implemented core rides ONLY existing substrate: node contracts carry the
real specialist vocabularies (LAXII registry sizes, JAZMII text-to-video
sizes, GANGZII preset voices, the 1000-character speech cap) and the M41
verification-criteria/limit semantics via `buildTaskSpec` (whose internal
`normalizeVerificationCriteria`/`normalizeLimits` normalization stays
authoritative). Standing constraints apply unchanged: no parallel inference
path (the gateway/registry remains the only model access), no arbitrary-code
execution nodes, every future run owner-scoped and Trust-gated. The
persistence/API design remains §8 of the architecture doc (PROPOSED —
nothing created in M50.2).

## 9. Tests and verification

M50.2 ships 121 hermetic cases in five suites: strict schema parsing
(versions, unknown executable-authority fields, hostile/prototype-shaped
input, bounds), registry integrity (exactly ten nodes, real M41 kinds, no
fabricated kinds, real specialist vocabularies, caps), the FULL port-type
compatibility matrix (exact identity — no implicit conversion — plus
cardinality/direction/required-input rules), the ten validation stages
(cycles, deliverable designation, real M41 bounds, availability severity
semantics, deterministic diagnostic order), and the compiler (per-kind
mapping, determinism, gate auto-append/preservation/non-overridability,
deliverable designation, adversarial injection, and a source-scan pin that
the pure modules never import execution/storage/time/randomness surfaces).
M41 mission regressions and M49 suites re-run green; TypeScript, ESLint and
the production build are clean. No runtime execution is claimed (M50.2 has
no execution surface by design).

## 10. Failure handling

Validation failures are structured, customer-safe, deterministic diagnostics
(the architecture §6.2 vocabulary) — an invalid graph is refused with
reasons, never silently "fixed". The honest-state model for RUNS (planned →
running → completed | completed_partial | failed | cancelled; queued ≠
executed; artifact ≠ verified deliverable; no synthetic history) remains the
architecture §9 design and arrives with M50.5/M50.6 on the EXISTING mission
ledger.

## 11. Current implemented capabilities

**The M50.2 pure graph core (above) — nothing user-facing.** A workflow
cannot be stored, listed, published, run or observed yet. The closest real
execution surfaces remain RIISHE's workflow detection
(`src/lib/riishe/workflow.ts`) inside chat and the M41 mission planner
(`src/lib/riishe/mission/planner.ts`) — both fixed deterministic planners,
NOT a user-facing node editor.

## 12. Partial capabilities and known limitations

The implemented core is honest about its boundaries: availability
diagnostics come only from an explicit snapshot (the pure core never probes
health; execution-time preflight stays authoritative and a validation pass
is never a promise); `input.text`'s `json` output has no first-release
consumer (connections to it are refused); research packs cannot be
designated deliverables; workflows whose critical path exceeds the real
45-minute mission cap are refused; no mid-run approval gate, no inline
conversational-model node, no agent/team nodes (proposed with structural
reasons in `PROPOSED_NODE_TYPES`), JAZMII delegation remains text-to-video
only, GANGZII narration requires explicit text.

## 13. Planned capabilities (explicitly separated)

Everything user-facing is specified-but-not-built. Implementation sequence:
~~M50.2 (schema + registry + pure validation/compile)~~ **DONE** → M50.3
(persistence + CRUD APIs + versioning) → M50.4 (canvas UI) → M50.5
(governed execution adapter + the approved `'workflow'` mission-type
extension) → M50.6 (run visibility/debugging/history) → M50.7
(security/recovery/regression close-out) — architecture doc §11 + §14
addendum. The roadmap record with standing constraints lives in
[`docs/ai/BEAN-AI-ECOSYSTEM-EXPANSION.md`](../BEAN-AI-ECOSYSTEM-EXPANSION.md).
NIIKI remains M51 PLANNED; the M52 unified-ecosystem direction is unchanged.
