# M25 — Intelligent Multi-File Refactoring: Architecture Audit

Milestone: CODE GIFTZ — M25 · Branch: `main`
Baseline before work: `49b04055f2c41fff0b5160afcd7d4e3059f51afd`
Verification: local HEAD and `origin/main` both matched `49b0405…` via `git ls-remote`
before any change; working tree clean.

This audit inspects the ACTUAL repository at the baseline and decides what M25 reuses,
extends, and deliberately does NOT build. Rule: no second storage layer, gateway, queue,
sandbox, patch engine or version system.

---

## 1. Baseline verification

| Item | Result |
|---|---|
| Required baseline | `49b04055f2c41fff0b5160afcd7d4e3059f51afd` |
| Local HEAD at audit time | `49b04055f2c41fff0b5160afcd7d4e3059f51afd` (match) |
| `origin/main` (git ls-remote) | `49b04055f2c41fff0b5160afcd7d4e3059f51afd` (match) |
| Working tree | clean, no unrelated modifications |
| Milestone chain | `6a84481` (M21-era) → `ee0c91a` (M21) → `b34eeda` (M22) → `e6fe3a5` (M23) → `49b0405` (M24, current) |

All predecessor milestones are present in the baseline (docs, code, tests, validation evidence):
M21 fixtures under `validation/m21/`, M22 persistence + versioning + export, M23 file
operations, M24 live-provider workflow with real-provider evidence under `validation/m24/`.

## 2. Existing architecture inventory (verified by reading the code)

### 2.1 M22 — persistent project storage, targeted editing, versioning

- **Storage**: Prisma `CodeProject` / `CodeFile` (unique `projectId+path`, `origin` column) /
  `CodeMessage` (`metaJson` carries honest change lists). No filesystem storage anywhere.
- **Content write path**: `applyFiles()` in `src/lib/giftz/workspace.ts` — path-safe
  (`assertSafeProjectPath` rejects traversal, absolute, drive-letter paths), upsert-only,
  returns honest added/modified diffs. This is THE single content-write path used by the
  live SSE route, the background worker, and M23 repairs.
- **Versioning**: `src/lib/code/versioning.ts` — content-addressed `CodeBlob` (SHA-256 dedup
  per project), `CodeVersion` maps paths→blob hashes with a real change list
  (`computeChangedFiles` with rename detection), integrity hash over sorted (path, hash)
  pairs, `validateVersionIntegrity`, `rollbackToVersion` **creates a new version**
  (append-only history), duplicate-version protection, 200-version cap.
- **Targeted editing**: `buildTargetedEditBrief()` injects the "re-emit only changed files,
  never the whole project" contract when the project has files; the turn core
  (`src/lib/giftz/turn.ts`) applies extracted fences through `applyFiles` and snapshots
  version kind `turn`.
- **Export**: `src/lib/code/export.ts` builds the ZIP and verifies integrity (regression
  target for M25).

### 2.2 M23 — deterministic file operations (the approval model)

- **Ledger**: `CodeFileOperation` rows (`kind`, `status` lifecycle
  `awaiting_confirmation → executed | cancelled | failed | stale`, `planJson`, `planHash`).
  The confirmation is cryptographically bound to the exact canonical plan JSON
  (`planHashOf`, sha-256 over canonical JSON).
- **Detection**: `src/lib/code/file-ops/detect.ts` — deterministic NL resolution against the
  REAL file list; ambiguous requests become focused clarifications; prose-shaped messages
  fall through to the model turn.
- **Planning**: `buildFileOpPlan()` — per-file mutations, case-aware conflicts, protected
  paths, `MAX_BATCH_MUTATIONS = 25`, reference impact scan.
- **Execution**: `executeOperation()` — plan-hash integrity re-check, replay-safe
  (executed → recorded result verbatim, `replayed: true`), staleness re-validation, ONE
  transaction per structural op (`db.$transaction`), content preservation verified by
  hashes, version snapshot AFTER verified mutation (kind `file-op`/`repair`), failed ops
  snapshot nothing, separately-reviewable reference repairs (`references.ts`
  `buildRepairEdits` rewrites only actually-resolved specifiers; `applyRepairEdits` is
  exact-text replacement with staleness reporting).
- **Routes/UI**: `POST /api/code-giftz/projects/[id]/file-ops/execute` and `/cancel` (both
  owner-checked, audit-recorded); `FileOpCard` in `src/components/bean/code-giftz.tsx`.

### 2.3 M24 — live provider workflow

- Provider access: `hostedLlmAdapter` (`src/lib/adapters/hosted-llm.ts`) over the platform
  credential mechanism (`/etc/.z-ai-config` presence verified at audit time — values never
  read). The M24 report records LIVE provider turns through the real product API; the same
  gateway serves M25's AI-assisted plan drafting.
- SSE lifecycle: `createGiftzChatStream` (guarded disconnect handling, exactly one terminal
  frame, release-once), `generateTurnWithContinuation` (controlled continuation on
  truncation), typed upstream failure classes mapped to honest codes.
- Validation harness pattern: `validation/m24/harness/*` drives the real HTTP API with
  real accounts; `scripts/m23/acceptance.ts` pattern exercises real modules against an
  isolated throwaway SQLite DB (`DATABASE_URL=file:…` + `prisma db push --skip-generate`),
  M21 fixtures loaded read-only and hash-verified untouched afterwards.

### 2.4 Analysis / validation infrastructure available for reuse

- `src/lib/code/dependency-analysis.ts` — package-level static analysis:
  `extractModuleSpecifiers` (import/require/dynamic-import/export-from regexes),
  `resolveRelativePath` / `relativeCandidates` (extension-aware resolution),
  `analyzeDependencies` (missing imports, unused deps, version sanity, build-script checks).
- `src/lib/code/file-ops/references.ts` — path-level reference scanning (JS/TS specifiers,
  HTML src/href, CSS url()), alias (`@/`) and root-relative forms, concrete resolution,
  bounded repair edits.
- `src/lib/code/preview-audit.ts` + `preview-check` route — missing-asset/broken-link audit
  used by the preview workflow.
- `build` route — sandboxed build attempt through `runInSandbox` with explicit approval;
  results recorded verbatim (honest failures preserved).
- Sandbox runner, run route, tasks/job queue — untouched by M25.

## 3. Gap analysis — what M25 must add (and what it must NOT)

Gaps identified (all gaps are ADDITIVE; none require touching storage schemas destructively):

1. **No symbol-level project model.** Existing analysis resolves files and specifiers but
   has no index of exported/declared symbols (functions, components, classes, consts) or
   import-binding relationships between files. Rename-across-project ("rename this
   function throughout the project") cannot be done safely without it. → M25 adds
   `src/lib/code/refactoring/graph.ts` (file-kind classification, import edges verified vs
   unresolved, incremental re-analysis) and a static symbol index.
2. **No refactoring intent detection.** M23 detects file-op verbs (rename/move/delete/
   create a PATH); nothing recognizes "extract component", "move all API calls into a
   service layer", "consolidate these repeated elements", "separate business logic from
   presentation", "reorganize into a cleaner structure". → M25 adds deterministic
   refactoring-intent detection that composes with (never hijacks) the existing detectors.
3. **No coordinated multi-file content plan.** M22 targeted edits emit complete files
   turn-by-turn (one version per turn); M23 repairs are exact single-specifier
   replacements. Multi-file refactoring needs ONE plan carrying per-file exact edits +
   path moves + created files, validated and executed atomically as one version. → M25
   adds `RefactorPlan` + validation + atomic executor riding the EXISTING
   `CodeFileOperation` ledger (kind `refactor` — the `kind` column is a free string; the
   status lifecycle, planHash binding and replay semantics are reused as-is).
4. **No AI-assisted plan drafting with server-side validation.** Semantic refactors
   (extraction, consolidation, service-layer split) need provider help, but a model draft
   must never execute directly. → M25 adds a bounded drafting pass (provider emits
   path-tagged fences through the EXISTING adapter contract; the server parses, validates
   path safety, symbol collisions, stale hashes, scope discipline) and turns valid drafts
   into reviewable plans. Provider outage → honest failure, zero file mutation.
5. **VersionKind union lacks `refactor`.** Additive change to `versioning.ts`.

Deliberately NOT built (anti-duplication commitments):
- No new database tables (the refactor ledger rides `CodeFileOperation`).
- No second patch engine — per-file content writes go through `applyFiles`; path moves go
  through the same transaction semantics as M23; specifier repairs reuse
  `buildRepairEdits`/`applyRepairEdits`.
- No new queue/worker — assisted drafting happens inside the existing turn machinery
  (buffered `adapter.codeTask` pass with the existing continuation bound), or through the
  deterministic path with zero provider involvement.
- No separate dashboard — the refactoring card renders inside the existing chat flow,
  mirroring `FileOpCard`.
- No new sandbox — validation/build/preview reuse the existing routes verbatim.

## 4. Design decisions recorded before implementation

1. **Two execution tiers.**
   - *Deterministic* refactors (rename-symbol, move-module with import updates): planned
     and executed entirely server-side from the real file set — zero provider calls,
     available during provider outages (Section 13 requirement).
   - *Provider-assisted* refactors (component extraction, module extraction, service
     layer, consolidation, restructuring): the provider drafts a patch; the server
     validates it into a plan; execution still requires explicit approval and runs through
     the same atomic executor. The provider NEVER regenerates the application and NEVER
     executes anything.
2. **Approval is always required for refactor execution** (multi-file content mutation is
   inherently riskier than a single rename): every refactor plan is stored as
   `awaiting_confirmation` and executes only through the confirmation endpoint bound to
   its planHash — stricter than M23's non-destructive auto-execute, justified by scope.
3. **Staleness binding is content-level**: a refactor plan records the SHA-256 of every
   file it will edit; execution re-validates all of them (stronger than M23's
   path-level check for structural ops) so concurrent chat edits cannot be overwritten.
4. **Honest scope language**: plans distinguish verified relationships (specifier
   resolved to an existing file, binding imported) from inferred ones (identifier match
   inside a verified importer) and list unresolved references separately; dynamic
   imports are only followed when statically resolvable; the plan text never claims
   complete dependency coverage.
5. **Semantic safety checks before approval** (Section 6): stale hashes, conflicting
   edits (two non-identical target contents for one path), symbol collisions (new name
   already declared/exported), export-surface changes (exports lost or renamed),
   circular-dependency detection over verified edges (reported as a risk, never silently
   created), affected-tests listing. Compilation success alone is never claimed as
   behavioral equivalence.

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Provider draft overwrites unrelated files | Server-side validation rejects any touched file outside the declared scope; full-file emission is only accepted for files the plan explicitly creates/modifies, with before/after hashes recorded |
| Rename via arbitrary text match corrupts code | Rename operates on the symbol index + verified import bindings + token-boundary replacements only; inferred matches are reported, never rewritten |
| Partial multi-file application | One transaction; failure rolls back completely; failed ops never snapshot |
| Stale plan execution | Content-hash revalidation per edited file inside the transaction window; mismatch → `STALE`, nothing applied |
| Provider outage blocks refactoring | Deterministic ops (rename/move) need no provider; assisted ops fail honestly; storage/versioning/rollback stay fully available |
| Cost discipline | Assisted drafting is one bounded provider pass (continuations capped by the shared bound); deterministic detection/plan-building is free; acceptance workloads are small and reuse artifacts |

## 6. Verdict

The baseline already provides every substrate M25 needs: persistent storage, an
approval-bound operation ledger with atomic transactional execution and replay safety,
content-addressed versioning with append-only rollback, a path-safe single write path,
specifier-level reference tooling, the live provider gateway, and a validation harness
tradition. M25 is a contained, additive feature layer: project graph + symbol index,
refactoring intent detection, plan assembly with semantic-safety validation, and an
atomic executor riding the existing ledger — plus AI-assisted drafting for the semantic
operations. Implementation proceeds on this basis.
