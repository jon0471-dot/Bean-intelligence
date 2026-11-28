# CODE GIFTZ — Engineering

**Status: implemented. BEAN's engineering specialist: real coding jobs, versioned project files, restricted-sandbox verification.**

## 1. Purpose and responsibilities

CODE GIFTZ is BEAN's engineering execution surface: conversational engineering
with REAL project persistence (files, versions, diffs, rollback), durable
coding jobs, an explicit-consent restricted sandbox for code execution, and a
delegation lane other systems (RIISHE, AUTOBOTS, missions) submit through.

## 2. Actual architecture

- **Product view** — `src/components/bean/code-giftz.tsx` (+ `code-giftz-sidebar.tsx`): project workspace UI.
- **Chat/execution route** — `src/app/api/code-giftz/chat/route.ts` (+ `[id]`): conversational turns that can produce REAL file changes in the user's project.
- **Projects/files/versions** — `src/app/api/code-giftz/projects/...`: owner-scoped CRUD, file reads, version history, compare and rollback (`src/lib/code/versioning.ts`, `src/lib/code/diff.ts`).
- **File operations** — `src/lib/code/file-ops/` + `src/app/api/code-giftz/projects/[id]/file-ops/`: bounded rename/move/delete/create/repair contracts with cancel support.
- **Durable coding jobs** — `src/lib/ai-engine/giftz-coding-handler.ts` + `src/lib/jobs/queue.ts`: the delegation lane RIISHE/missions use; every job is a durable GenerationJob row.
- **Sandbox** — explicit-consent code execution (`allowCodeExecution`) with the per-turn capability planner narrowing actual need; results are recorded honestly (`execution` payload on the turn).

## 3. Source-code locations

| Concern | Path |
|---|---|
| Chat + workflow | `src/app/api/code-giftz/chat/`, `src/lib/ai-engine/giftz-coding-handler.ts` |
| Projects & persistence | `src/app/api/code-giftz/projects/`, Prisma `CodeProject`/`CodeBlob`/`CodeVersion`/`CodeVersionFile`/`CodeMessage`/`CodeFile` |
| Versioning/diffs | `src/lib/code/versioning.ts`, `src/lib/code/diff.ts` |
| Refactoring | `src/lib/code/refactoring/` |
| Dependency analysis | `src/lib/code/dependency-analysis.ts` |
| Delegation tool | `src/lib/riishe/tools/` (`delegate_coding`, `check_coding_job`) |
| Trust adapter | `src/lib/trust/adapters/code-giftz.ts` |

## 4. Model and provider integration

Engineering turns ride the same hosted inference gateway as all BEAN chat
(router preflight, quotas, budget guards). Coding jobs execute through the
durable queue and the restricted sandbox — never arbitrary shells, never
unbounded processes.

## 5. Input/output contracts

Chat turns: zod-validated `{ projectId?, message }` with owner-checked project
ids; responses stream the standard BEAN SSE frames plus structured
`changes`/`files` payloads (real file diffs) and the frontend-intelligence /
refactoring / execution payloads when those lanes actually ran.

## 6. Tools and permissions

Code execution requires the explicit `allowCodeExecution` permission AND the
per-turn capability plan (`planCapabilities`) agreeing — plain conversation
never gets the sandbox. File writes are versioned and rollbackable; no
deployment, publishing or external communication exists anywhere in the
surface.

## 7. Data and memory handling

All project state is owner-scoped in Prisma (`CodeProject` …); blobs are
stored as content-addressed rows; versions are append-only with explicit
rollback; conversations are per-project.

## 8. Execution workflow

user turn → preflight gates → planning → (optional sandbox run on explicit
execution requests) → file mutations with diffs + version row → verification
(sandbox exit code / self-verification) → honest receipts → Trust ledger.

## 9. Existing tests and verification

`tests/unit/code-*.test.ts` (versioning, export, file-ops security, projects
security, refactor plan/execute/security/graph, preview audit/inline,
dependency analysis, workspace) — the M47/M48 record carries the full census.

## 10. Failure handling and fallback behavior

Failed turns keep history honest (dangling-retry collapse); sandbox failures
report the real exit/error; file-op failures are cancellable and never
half-applied without a recorded state.

## 11. Current implemented capabilities

Conversational engineering with persisted multi-file projects; versioned
edits with compare + rollback; bounded refactoring plans; file operations with
audit; dependency analysis; static frontend generation with curated libraries
(licensed, installed server-side); sandboxed execution on explicit consent;
delegation lane for RIISHE/missions/AUTOBOTS.

## 12. Partial capabilities and known limitations

No repository access to external forges (no GitHub write from the app — the
governed repository adapter is a separate owner-configured integration);
no multi-language test-run matrix beyond the sandbox's runtime; frontend
generation is static/React artifacts, not full app deployments.

## 13. Planned capabilities (NOT implemented)

Deeper CI-style verification loops; richer package management inside
projects. Roadmap items only — not claimed anywhere in the product.
