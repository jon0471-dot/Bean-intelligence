# CODE GIFTZ — M23 Chat-Based File Operations & Safe Project Mutation: Mandatory Audit

Repository: `https://github.com/jon0471-dot/Bean-intelligence.git` · Branch: `main`
Audited at commit: **`b34eedad6ef629e80fbf920774fb2f29ed7d73b8`** — the required baseline, verified exactly:
`git ls-remote origin refs/heads/main` = local `HEAD` = `b34eedad…` (remote and local identical, zero drift);
`git status --porcelain` empty → clean working tree. The tip commit is the M22 delivery
(`feat(code-giftz): add persistent projects and intelligent editing`). **No code was modified by this audit.**

Purpose: map everything M23 must preserve and reuse before writing a single line — the M22 persistence
implementation, the storage abstraction, ownership/authorization, versioning, the targeted-edit pipeline,
chat intent routing, path validation, preview/build, and the test architecture. Every statement below was
verified against the committed modules this session.

---

## 1. M22 project persistence implementation (the foundation M23 extends)

- **Storage is SQLite rows, not a filesystem**: `CodeFile { projectId, path, content, origin }` with
  `@@unique([projectId, path])` (`prisma/schema.prisma`). There is **no directory table** — folders are
  implicit (derived from path prefixes). Consumers (preview, sandbox, model context, export) all read the DB.
- **Lifecycle endpoints** (all owner-checked, M22): explicit create (`POST /api/code-giftz/projects`),
  open (`…/open`), duplicate (`…/duplicate`), archive/restore (`…/archive`, `…/restore`), metadata PATCH
  (`…/[id]`), file save/delete (`…/files` POST/DELETE with optimistic concurrency + `file-save`/`file-delete`
  versions), versions (list/detail/compare/rollback), preview + preview-check, dependencies + build, export.
- **Owner-check pattern (verbatim template for every M23 route)**: load project →
  `if (!project || project.userId !== user.id) throw new BeanApiError('NOT_FOUND', 'Project not found.')`
  — no existence leak across users. `requireUser()` (session cookie) guards every route.
- **Schema sync**: `prisma db push` (no migrations directory exists; the repo's `npm run db:push`).
  Additive-only: M23 may add tables/columns; never drop or retype.

## 2. Existing project/file storage abstraction (REUSED — never duplicated)

- **`applyFiles(projectId, extracted)`** (`src/lib/giftz/workspace.ts`) is the SINGLE file-write path for
  content changes: upsert with ownership by `projectId_path`, honest `added`/`modified` classification,
  real `diffContent` per change, identical content = no-op. M23's content-touching operation (reference
  repair) goes THROUGH it; structural operations (rename/move/delete/create-empty) mutate the `path` key /
  delete rows directly via a transaction — they are new verbs over the same `CodeFile` table, not a new
  storage system.
- **Path safety (reused as-is)**: `assertSafeProjectPath(p)` (`src/lib/giftz/workspace.ts`) — rejects `..`,
  absolute/drive paths, disallowed characters (`[^\w.\-/ ]`), length > 200. `assertSafeRelativePath`
  (`src/lib/sandbox/runner.ts`) is the sandbox-side equivalent. `hasUnsafeEntryName` guards ZIP entries.
  M23 adds a path-normalization layer (`normalizeProjectPath`) on top for resolution, and re-validates every
  planned path through the existing validators at execution time.

## 3. Project ownership and authorization

Verified owner checks in: `projects/route.ts`, `projects/[id]/route.ts`, `…/files`, `…/preview`,
`…/run`, `…/versions*`, `…/export`, `…/duplicate`, `…/archive`, `…/restore`, `…/open`, `chat/route.ts`
(POST resolves or auto-creates the project; foreign id → `NOT_FOUND`), `chat/[id]/route.ts`. M23 replicates
the identical pattern on its new routes and on every operation row lookup (operation rows are loaded through
the owner-checked project).

## 4. Version snapshots and blob deduplication (M22, reused for M23)

`src/lib/code/versioning.ts`:
- `snapshotProjectVersion({ projectId, kind, summary, files? })` — content-addressed `CodeBlob` rows
  (SHA-256, per-project `@@unique([projectId, hash])`), a `CodeVersion` with `seq` (`@@unique([projectId,
  seq])`), `changedFilesJson` (real added/modified/renamed/deleted vs the previous version, rename detection
  by content hash), integrity `contentHash` over sorted `(path, blobHash)` pairs, duplicate-version
  protection (`{created:false, skipped:'unchanged'}`), 200-version cap.
- `VersionKind = 'initial' | 'turn' | 'manual' | 'rollback' | 'file-save' | 'file-delete'` — a TypeScript
  union over a SQLite TEXT column. **M23 extends the union additively** (`'file-op'`, `'repair'`); no schema
  change is needed for new kinds.
- `validateVersionIntegrity`, `getVersionDetail`, `getVersionFileContent`, `compareVersions`,
  `rollbackToVersion` (rollback = integrity check → workspace rewrite → NEW `rollback` version; history
  append-only).

## 5. Rollback-as-new-version behavior and integrity verification

- Rollback validates the target's integrity FIRST (missing blobs / hash mismatch → `CORRUPT` refusal),
  rewrites the workspace through the same file-write semantics (upsert + delete), then snapshots a NEW
  version. M23 inherits this: **deleting current files never touches historical versions or deduplicated
  blobs** — a deletion is a row delete; the blob rows and every `CodeVersion` remain, so version-history
  restore keeps working (the M22 rollback path reads blobs, which still exist).
- Integrity validation is available on demand (`validateVersionIntegrity`) and runs inside every version
  detail and rollback. M23 re-runs it in acceptance tests after file operations.

## 6. Targeted-edit pipeline and patch approval

- `runGiftzTurnCore` (`src/lib/giftz/turn.ts`, shared by the live SSE route AND the background coding
  worker): controlled continuation → self-verification → `parseFiles` (path-tagged fences) → `applyFiles` →
  frontend-intel engine (opt-in) → automatic version snapshot when files changed (`kind:'turn'`).
- `buildTargetedEditBrief` (`src/lib/giftz/prompts.ts`) — injected when the project has files; instructs the
  model to re-emit ONLY changed files and **"Do not rename, move or delete files through this channel."**
  This is exactly the contract M23 supersedes at the CHAT level: rename/move/delete requests are now served
  by deterministic server-side operations. The model never sees file-op turns (they are intercepted before
  prompt assembly), so the brief remains correct for the turns that do reach the model.
- Execution approval in the product: sandbox runs require explicit `approval: z.literal(true)`; build
  attempts the same. M23's equivalent: destructive operations (delete; reference repair) require explicit
  confirmation bound to the exact plan.

## 7. CODE GIFTZ chat intent routing (what exists today)

- `POST /api/code-giftz/chat` has **NO intent classification**: every message goes through `preflight`
  (provider routing + rate limits) into `runGiftzTurnCore`. Frontend-intelligence plan resolution
  (`resolveFrontendPlan`) reads the message for DESIGN planning, not for action routing.
- M23 inserts a deterministic **file-operation detector between project resolution and preflight**: a
  detected operation never consumes a provider slot and never reaches the model. Undetected messages flow
  EXACTLY as before (bit-for-bit behavior for existing turns).
- The chat route owns: project resolve/create, history load, retry-dedupe (`shouldCollapseDuplicateUserMessage`),
  attachments, tech-docs research, frontend plan, user message persistence, SSE vs JSON response paths,
  usage metering + audit. The file-op branch reuses: project resolution, message persistence (user +
  truthful assistant summary), audit recording, the SSE done frame (additive `fileOp` field) and JSON path.

## 8. Existing sandbox and path validation

- `runInSandbox` (`src/lib/sandbox/runner.ts`): ephemeral `sandbox-runs/<uuid>/` workspace, `unshare -Urn`
  + `prlimit` caps + SIGKILL wall clock, minimal env, explicit approval required. Sandbox paths are guarded
  by `assertSafeRelativePath`. **M23 file operations never touch the sandbox** — they are DB-row operations
  over `CodeFile`. There are no symlinks in DB storage; path-traversal and absolute-path injection are
  refused by the shared validators at detection, planning AND execution time (server-side, never trusting
  model output or client input).
- Preview (`…/preview`) serves the DB files through a CSP-locked sandboxed iframe; the project root boundary
  is the `projectId` scoping of every query. M23's root-boundary rule ("never rename/move/delete outside the
  project") is enforced by path normalization + the per-project unique constraint.

## 9. Existing preview and build system

- Preview: static inline render + REAL browser error capture (console hooks postMessage from the sandboxed
  iframe) + deterministic audit (`auditPreview` — missing assets / broken internal links / external
  references; `src/lib/code/preview-audit.ts`, pure). **Reuse for M23**: `normalizeRef` (base-dir-aware
  reference resolution) and `extractRefs` are the exact primitives the reference-impact scanner needs for
  asset references in HTML; import specifiers get a parallel scanner (JS/TS import/export/require/dynamic).
- Build: `…/build` (explicit approval) through the existing sandbox; dependency analysis is static
  (`analyzeDependencies`). Untouched by M23.

## 10. Current test architecture (mirror it)

- Runner: `bun test --isolate tests/` (npm script `test`). 1,794 passing tests / 129 files at the M22 tip.
- **Route-level security tests** (the M23 pattern): a self-contained in-memory Prisma fake registered via
  `mock.module('@/lib/db', …)` + mocked `requireUser`/metering/logger, then route modules imported AFTER the
  mocks and exercised with real `Request` objects (`tests/unit/code-projects-security.test.ts`).
- **Pure-function suites** for library modules (e.g. `code-versioning.test.ts`, `code-workspace.test.ts`).
- **Real-persistence acceptance**: `scripts/m22/acceptance.ts` runs the REAL Prisma client against an
  isolated verification SQLite DB (`DATABASE_URL=file:…/verify.db` + `prisma db push --skip-generate`) —
  the honest-substitution policy (recorded model-response fixtures, no provider credentials in this
  sandbox). M23 adds the same style of real-filesystem… **real-SQLite** acceptance for file operations
  (M23 operations are DB-level; "real filesystem mutation tests" in the spec resolve to real `CodeFile`
  row mutations against real SQLite, plus the existing sandbox for anything execution-shaped).
- M21 fixtures (regression inputs, PRESERVED in place): `validation/m21/projects/project-a-landing` (Nebula),
  `project-b-dashboard` (Pulse), `project-c-portfolio` (Nova Reyes) — full React projects with
  `components/` directories and import graphs, ideal for reference-integrity verification. They stay in
  `validation/` (never registered as production projects; the M23 tests load them read-only as fixtures).

## 11. Missing contracts M23 fills (and what it deliberately does NOT build)

| Capability | Status at baseline | M23 disposition |
| --- | --- | --- |
| Natural-language file-operation intent | none (every message = generation turn) | NEW deterministic detector (`src/lib/code/file-ops/detect.ts`), server-side, no model involvement |
| Structured operation plans | none | NEW plan builder with conflict detection + reference impact (`…/plan.ts`), plan hash + operation records |
| Rename/move/delete/create over project files | only single-file delete via editor UI | NEW transactional executor over `CodeFile` rows (`…/execute.ts`), folder = path-prefix rewrite |
| Confirmation binding | none | NEW: plan-hash-bound confirmation; plan change / stale state invalidates it |
| Idempotency / operation ledger | none | NEW additive `CodeFileOperation` table (operation IDs, states, replay-safe execute) |
| Import/reference impact scan | none for code imports (preview audit covers HTML assets only) | NEW scanner reusing `normalizeRef` semantics for import specifiers + asset refs (`…/references.ts`) |
| Reference repair | none | NEW separately-approved repair plans executed through `applyFiles` (+ `repair` version) |
| Version kinds for operations | `turn`/`file-save`/`file-delete` exist | extend union with `file-op` + `repair` (TEXT column — no migration) |
| Chat rendering of operations | none | additive `fileOp` payload on the SSE done frame + JSON response + card UI |
| Duplicated storage/versioning/sandbox/gateway/authz | — | **NOT BUILT (forbidden)**: M23 reuses every existing system |

## 12. Security risks identified up front (each gets a pinned test)

1. Path traversal / absolute-path injection / drive-letter paths → normalize + `assertSafeProjectPath` at
   detection, planning and execution (defense in depth, server-side only).
2. Symlink escapes → N/A at the DB storage layer (no filesystem paths are resolved); recorded honestly.
   The sandbox workspace writer (`materializeFiles`) remains the only filesystem materializer and keeps its
   own validator.
3. Project ownership violations / IDOR / cross-project access → owner-checked project + operation rows;
   foreign ids answer `NOT_FOUND`; operations store their `projectId` and re-verify it at execute time.
4. Unauthorized destructive operations → delete/repair require confirmation bound to the exact plan hash;
   replay of a stale confirmation is refused; cancelled/failed/executed ops refuse re-execution (idempotent
   replay returns the recorded result for executed ops).
5. Malicious filenames → the existing character whitelist + length cap; batch destinations conflict-checked
   case-insensitively (case-only renames handled explicitly).
6. Recursive deletion abuse → folder deletion reports the exact file count; protected system files
   (`package.json`, lockfiles, `NOTICES.md` — the attribution contract) refuse deletion; the root path and
   prefix-empty forms are rejected.
7. Concurrent modification / stale plans → per-file content-hash staleness check at execute + in-transaction
   re-validation of every precondition (SQLite `connection_limit=1` serializes writers).
8. Partial batch failure → multi-row mutations run inside one `db.$transaction`; failure rolls back
   completely and is reported honestly (never "complete success" for a partial outcome).
9. Storage corruption → versions keep their integrity hashes; M23 acceptance re-validates integrity after
   operations; a corrupt version refuses rollback exactly as in M22.
10. Unauthorized archive/version access → unchanged M22 controls (owner-checked routes); M23 adds none.
11. Secret/internal-path leakage in chat responses → operation results contain only project-relative paths;
   no internal storage paths, no env, no credentials (nothing else exists in the operation context).

## 13. Implementation plan (binding)

1. **Schema (additive)**: `CodeFileOperation { id, projectId, kind, status, planJson, planHash, resultJson?,
   createdAt, executedAt? }` + `CodeProject.fileOperations` relation; `prisma db push`; no destructive change.
2. **`src/lib/code/file-ops/` modules** (pure where possible):
   `types.ts` (plan/result contracts) · `detect.ts` (intent + path resolution + clarification, deterministic)
   · `references.ts` (import/asset/config reference scan + repair-plan builder) · `plan.ts` (plan building,
   conflicts, impact, hashing) · `execute.ts` (stale check, transactional mutation, verification, snapshot,
   idempotent replay).
3. **Routes**: `POST …/file-ops/execute` (confirmation-bound; owner-checked; replay-safe) and
   `POST …/file-ops/cancel`. Planning happens inside the chat route (the intent surface).
4. **Chat route integration**: after project resolution, before preflight — detected ops never touch the
   provider; additive `fileOp` on the JSON response, SSE done frame, and assistant `metaJson`; truthful
   deterministic assistant text (no model call, no simulated execution).
5. **Versioning**: `file-op` / `repair` kinds; snapshot AFTER verified mutations; failed ops snapshot
   nothing.
6. **UI (additive)**: operation card in the transcript (detected op, source → destination, affected files,
   conflicts, reference impact, confirm/cancel, result, version badge); confirm via the existing AlertDialog
   pattern; fileOp restored from `metaJson` on project open; RiisheStreamEvent extended additively.
7. **Tests**: pure-function suites (detect/plan/references/execute semantics) + route-level security suite
   (IDOR, traversal, confirmation binding, staleness, replay, concurrent modification) + real-SQLite
   acceptance harness (`scripts/m23/acceptance.ts`) including M21-fixture reference-impact regression
   (Nebula/Pulse/Nova Reyes loaded read-only from `validation/m21/`) + M22 regression re-run.
8. **Docs**: this audit + `docs/M23-FILE-OPERATIONS-REPORT.md`.
9. **Delivery**: one commit `feat(code-giftz): add safe chat-based file operations`, fast-forward push only,
   remote SHA verified after push.

## 14. Preservation checklist (re-verified at delivery)

Generation/explain/review/plan workflows · persistent project lifecycle · targeted editing · version history
and rollback · blob deduplication · browser preview + error capture · static dependency analysis · ZIP
export · React Bits 168 / GSAP 15 / Vanta 13 · internal AI design skills (no UI surface) · model gateway and
provider routing · project tenancy, API keys, scopes, rate limits · async queue and workers ·
RIISHE / LAXII / JAZMII · M21 fixtures under `validation/m21/` untouched · existing UI conventions.
No Ollama. No paid services. No duplicate infrastructure. No unrelated refactoring.
