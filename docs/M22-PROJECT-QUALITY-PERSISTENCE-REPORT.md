# CODE GIFTZ — M22 Project Quality, Persistence & Intelligent Editing: Final Report

Repository: `https://github.com/jon0471-dot/Bean-intelligence.git` · Branch `main` · fast-forward push only.
Baseline at session start: **`ee0c91af8cbe249aa38ea99f5b15666dd769a6ad`** (expected baseline verified exactly:
`git ls-remote` = local HEAD; clean tree). Companion document: `docs/M22-PROJECT-PERSISTENCE-AUDIT.md`
(Phase 0 audit — everything below was designed against it; no duplicate infrastructure was built).

**Outcome in one line:** CODE GIFTZ projects are now fully persistent development artifacts — lifecycle
(create/open/edit/rename/duplicate/archive/restore/delete with metadata), storage-efficient version history
with rollback-as-new-version and integrity validation, real change review with bounded diffs, a hardened
preview with REAL in-browser error capture and repair drafting, static dependency analysis with an honest
sandboxed build-attempt path, and a verified secret-free ZIP export — while the full regression suite
(1,794 tests), the internal frontend library (168 React Bits / 15 GSAP patterns / 13 Vanta effects), the M21
fixtures, RIISHE/LAXII/JAZMII and all security controls remained intact.

---

## 1. Initial architecture audit (Phase 0 — reuse decisions)

The audit (see the companion document) established what already existed and what was missing:

| Area | Found at baseline | M22 disposition |
| --- | --- | --- |
| Project persistence | `CodeProject`/`CodeMessage`/`CodeFile` in SQLite; files already persist across sessions | REUSED as the storage mechanism (existing architecture's choice; consumers all read the DB; no rewrite) |
| Lifecycle | create (chat auto-create), open, rename, delete, manual file save | REUSED + additive: explicit create endpoint, description/framework/language/status/lastOpenedAt metadata, duplicate, archive/restore, file delete |
| Version history | none | NEW (`src/lib/code/versioning.ts` + 3 tables) |
| Diff & change review | per-turn real diffs (`src/lib/code/diff.ts`) | REUSED (LCS diff) + NEW cross-version compare |
| Preview | static inline CSP-locked iframe | REUSED + additive error bootstrap, viewport toggle, refresh, deterministic audit |
| Sandbox | `runInSandbox` (network namespace + rlimits + SIGKILL, explicit approval) | UNTOUCHED — build attempts go through it verbatim |
| Job queue | `GenerationJob`/`JobEvent` durable queue | UNTOUCHED — versioning hooks ride after the turn core |
| Export | none for projects; `jszip` already a dependency (upload inspection) | NEW export builder reusing `jszip` + `hasUnsafeEntryName` |
| Model gateway / routing / modes | intact | UNTOUCHED |

## 2. Existing functionality reused (explicit list)

`applyFiles` remains the single file-write path (versioning wraps it, never bypasses it); `parseFiles`
remains the extraction contract; `assertSafeProjectPath` guards every path; `diffLines`/`compactDiff`/
`diffStats` power all diff payloads; `sanitizeConversationTitle` powers rename; `hasUnsafeEntryName`
(archive inspection) guards ZIP entries; `runInSandbox` executes builds; `requireUser` + the
`userId !== user.id → NOT_FOUND` owner-check pattern guards every route; the RIISHE sidebar UX contract
(search debounce + `encodeURIComponent(q)` + shared `filterConversationsByTitle`) is preserved bit-for-bit.

## 3. Database changes (additive only, non-destructive)

`prisma db push` (the repo's established sync workflow — no migrations directory exists):
- `CodeProject` + 6 nullable/defaulted columns: `description`, `framework`, `language`, `status`
  (`active|archived`, default `active`), `lastOpenedAt`, `currentVersion` (default 0). Existing rows are
  untouched (verified: push reported "in sync" with zero data loss on the live dev DB).
- 3 NEW tables: `CodeBlob` (content-addressed file content, SHA-256-deduped per project),
  `CodeVersion` (seq/kind/summary/changedFilesJson/contentHash/fileCount, `@@unique([projectId, seq])`),
  `CodeVersionFile` (per-version path→blobHash map + change/previousPath).
- All deletions cascade from `CodeProject` (project delete removes its version history and blobs).

## 4. Storage design (storage-efficient, per the Phase 3 requirement)

File content is stored ONCE per unique value: a version maps paths to blob hashes, so re-emitting unchanged
files across many versions costs one row total (measured in `code-versioning.test.ts`: after a 1-file change,
the unchanged file's blob count stays exactly 1). Integrity: `contentHash` covers the sorted `(path, blobHash)`
pairs; every version detail and every rollback revalidates it — a missing blob or hash mismatch is reported
as CORRUPT and refused, never silently repaired. Duplicate-version protection: a snapshot of a state identical
to the latest version is an honest no-op (`{created: false, skipped: 'unchanged'}`). Version cap: 200 per
project with an honest user-facing message at the limit.

## 5. Project lifecycle (Phase 1)

New endpoints (all owner-checked, all `NOT_FOUND` on foreign/missing projects — verified by route-level
security tests): `POST /api/code-giftz/projects` (explicit create), `POST …/[id]/open` (lastOpenedAt),
`POST …/[id]/duplicate` (deep copy: metadata + files + messages + initial version on the copy; original
untouched), `POST …/[id]/archive` / `POST …/[id]/restore` (status flip; archived projects leave the default
lists but stay openable via `?status=archived` / `?includeArchived=1`), `PATCH …/[id]` (title via the shared
sanitizer + description), and `DELETE …/[id]/files` (workspace file deletion recorded as a version). The UI
sidebar gained Duplicate/Archive/Restore actions, a "Show archived projects" toggle, and version badges.

## 6. Targeted editing workflow (Phase 2)

The turn pipeline already re-emits only touched files; M22 adds a **targeted-edit brief**
(`buildTargetedEditBrief` in `src/lib/giftz/prompts.ts`) injected ADDITIVELY when the project has files:
the model is instructed to re-emit ONLY files actually changed (complete content per fence), never the whole
project, never rename/delete through the channel, and to ask one clarifying question when the intended
modification is genuinely ambiguous (per spec: ask, don't guess). Ambiguity and clarification behavior were
already part of the system prompt; the brief sharpens them for modification turns. Every accepted turn with
changes automatically records a version (see §7); the model cannot implicitly mutate unrelated files because
`applyFiles` writes only what the turn actually emitted and reports identical content as a no-op.

## 7. Versioning implementation (Phase 3)

- **Automatic versions after accepted modifications**: hooked in `runGiftzTurnCore` (shared by the live SSE
  route AND the background coding worker — one implementation): any turn with ≥1 real file change snapshots
  the project (`kind: 'turn'`, summary = the user's request text, clamped). Snapshot failure is logged and
  NEVER fails the turn. The version seq rides the wire (`versionSeq` in the SSE `done` frame, JSON response,
  message `metaJson`, and worker `resultJson` — additive fields only).
- **Manual snapshots**: `POST …/versions` with an optional summary (unchanged workspace → honest no-op).
- **Kinds**: `initial` (seq 1 — a diff from nothing, every file honestly "added"), `turn`, `manual`,
  `rollback`, `file-save`, `file-delete`.
- **Comparison**: `GET …/versions/<seq>/compare?target=<seq>|current` — added/deleted/renamed/modified with
  real line diffs under a 40k payload budget and honest truncation flags. Renames are detected by content
  hash (same blob, different path, old path absent) and consume the old path (never double-listed as deleted).
- **Rollback**: validates target integrity FIRST, then rewrites the workspace to the recorded file set
  (upserts + deletions through the same file-write semantics) and records a NEW `rollback` version —
  history is append-only and every prior version remains intact and valid (verified: `1,2,3,4` all
  `integrity ok` after a rollback in the acceptance run).
- **Concurrent-edit protection**: version rows are created inside a transaction with the unique
  `(projectId, seq)` constraint (SQLite + `connection_limit=1` serializes writers); the manual file-save
  endpoint additionally supports `expectedUpdatedAt` optimistic concurrency — a stale save is refused with
  an honest conflict message and the other writer's content is never clobbered (test-pinned).

## 8. Diff and rollback UX (Phase 4 + Phase 8)

The workspace gained a **Versions panel**: recorded history (seq, kind, honest summary, real per-file change
badges), one-click compare-against-current with colored line diffs and +/− stats, and a Restore action behind
a confirmation dialog that explains the truthful semantics ("creates a NEW version — nothing is deleted from
history"). File-level change inspection (added/modified/deleted/renamed) reuses the existing per-turn diff
badges; the editor gained a "Delete file" action (confirm-guarded, records a `file-delete` version).

## 9. Preview and repair (Phase 5)

- **Saved & modified projects preview identically**; after accepted changes the iframe re-fetches via a
  cache-busting key (plus an explicit Refresh button).
- **REAL runtime evidence**: the preview route injects an error-observation bootstrap that hooks
  `console.error`/`console.warn`, `window.onerror` and `unhandledrejection` INSIDE the sandboxed iframe and
  `postMessage`s each event to the workspace, which shows them in an evidence strip. These are genuine
  observations from the user's own browser rendering — never fabricated, never synthesized server-side.
- **Deterministic audit** (`GET …/preview-check`): missing assets, broken internal links, external references
  (stated as CSP-blocked) — pure static analysis in `src/lib/code/preview-audit.ts`.
- **Repair workflow**: "Draft repair" composes a targeted repair request from the REAL collected evidence
  (console observations + audit findings) into the composer; the user sends it through the NORMAL chat turn
  — existing approval and generation flows stay intact. The preview panel gained Desktop/Mobile-width
  rendering (390px) — a real viewport check in the user's browser.
- **Recorded honestly**: compilation errors do not exist in this static-preview path (no compiler) — stated
  in the audit response `scope` rather than simulated.

## 10. Dependency and build management (Phase 6)

`src/lib/code/dependency-analysis.ts` (pure static analysis, `GET …/dependencies`): package-manager detection
from lockfiles (npm/bun/pnpm/yarn), missing imports (bare undeclared + unresolvable relative; node builtins
and `node:` prefixes excluded), unused-dependency heuristic with an explicit caveat note, duplicate
declarations across sections, unpinned ranges recorded (never "resolved"), and build-script validation
(referenced local files must exist). Execution: `POST …/build` (explicit `approval: true`, matching the
sandbox-run contract) attempts the detected script through the EXISTING `runInSandbox` and records the REAL
result verbatim — including the honest truth that the sandbox's network-isolated namespace cannot download
dependencies (reported in the response notes, never papered over; no silent upgrades; no installs outside
the sandbox; nothing auto-executed).

## 11. Complete project export (Phase 7)

`GET …/export` streams a ZIP built by `src/lib/code/export.ts`:
- complete source tree with nested folders, package manifest/lockfile when present, `README.md` with honest
  run/build instructions derived from the actual `package.json` scripts + detected lockfile manager, and
  `manifest.json` (per-file SHA-256 + the exact exclusion list);
- **security**: `.env*`, secret/credential/cookie-named files, `node_modules/`, build outputs, logs are
  excluded by name policy; files whose CONTENT trips a secret scan are excluded fail-closed (and listed);
  traversal-shaped entry names are excluded before the manifest is built (archive stays internally
  consistent); **the archive is REOPENED and verified entry-by-entry (count, names, hashes) before it is
  ever returned** — a failed verification ships nothing;
- rate-limited by size/file-count budgets with honest 400 messages; usage metered; audit recorded.

## 12. Security controls and tests (Phase 9)

`tests/unit/code-projects-security.test.ts` (19 tests, route-level over a fully mocked Prisma boundary —
the established repo pattern) pins: IDOR (every new route `NOT_FOUND` for foreign/missing projects; export
401 when unauthenticated), path traversal refusal (save + delete), stale-`expectedUpdatedAt` conflict
refusal (no silent clobber), owner-only archive/restore/rollback, corrupt-version rollback refusal,
invalid-seq `VALIDATION_ERROR`s, archived-list filtering, export exclusion of `.env` at the response level,
and metadata PATCH ownership. The versioning/export/dependency/preview suites add 41 more tests including
integrity-corruption simulation and traversal-shaped archive entries. **No existing security control was
weakened; no existing test was modified** (the one pinned source-contract test that my URLSearchParams
refactor broke was fixed by restoring the pinned source shape instead of touching the test).

## 13. Tests and results (Phase 10 — full gates on the final tree)

- **Full test suite:** `bun test --isolate tests/` → **1,794 pass / 0 fail / 129 files / 38,368 expects**
  (M21 baseline 1,728 pass / 124 files; the +66 are exactly the five new M22 suites — zero existing tests
  weakened or deleted).
- **TypeScript:** `tsc --noEmit` → 0 errors in `src/` + `tests/`.
- **ESLint:** 0 errors, 0 warnings in `src/` + `tests/` (full-repo lint flags only pre-existing findings
  inside the M21 generated fixtures under `validation/m21/`, which are generated deliverables — unchanged
  by M22, `git status validation/` empty).
- **Production build:** `npm run build` PASS (49 routes compiled; all new routes registered).
- **Library integrity (re-measured on the final tree):** 168 installed React Bits components / 168 kit
  sources on disk / 15 GSAP patterns / 13 Vanta effects — unchanged.
- **UI restriction:** `giftz-ui-restriction.test.ts` green — no toolkit panel, no catalogue route, no
  frontend-selection API field; M22's UI additions (Versions/Export/sidebar actions/preview evidence) touch
  none of the restricted surfaces.
- **Secret scan:** 0 hits over the 35-file delta (patterns: secret assignments, private-key blocks,
  OpenAI/GitHub/AWS token shapes); no `.env`, lockfiles, `node_modules` or build outputs in the delta.
- **M21 fixtures preserved:** `validation/m21/` untouched (Nebula, Pulse, Nova Reyes remain isolated
  validation artifacts — NOT moved into production directories and not registered as projects).

## 14. Final acceptance demonstration (all 10 steps — real execution evidence)

`scripts/m22/acceptance.ts` (evidence: `scripts/m22-out/acceptance.json`, run on an ISOLATED verification
SQLite DB — never the runtime DB). Method recorded up front (identical substitution policy to M21): no
provider credentials exist in this sandbox, so the external LLM hop cannot run; the coding-model role is
performed by recorded model-response-shaped fixtures fed through the REAL committed modules (`parseFiles`,
`applyFiles`, `snapshotProjectVersion`, `compareVersions`, `rollbackToVersion`, `auditPreview`,
`analyzeDependencies`, `buildProjectZip` + `verifyExportZip`) against real Prisma/SQLite persistence.

| # | Acceptance step | Result | Evidence detail |
| --- | --- | --- | --- |
| 1 | Generate a complete application | PASS | 3 files extracted from the path-fence contract, persisted |
| 2 | Save as a persistent project | PASS | rows in SQLite; version 1 (`initial`) with content hash |
| 3 | Close and reopen | PASS | fresh DB read recovers all 3 files byte-exact |
| 4 | Modify one section without regenerating | PASS | exactly 1 file modified (hero); styles.css/app.js untouched |
| 5 | Review the actual file changes | PASS | real diff: +2/−1 lines on index.html |
| 6 | Preview the modified application | PASS | entry detected, 0 missing assets, 0 broken links (+ live console capture in the browser) |
| 7 | Create a new version | PASS | manual snapshot v3 (`manual` kind) |
| 8 | Roll back to an earlier version | PASS | v4 (`rollback` kind); history 1,2,3,4 all intact; integrity 4/4 ok |
| 9 | Export a complete valid ZIP | PASS | 2,263 bytes, 5 verified entries, 0 issues |
| 10 | Reopen the exported project | PASS | ZIP re-imported into a NEW project, byte-identical |

**11/11 passed** (incl. a Phase 6 dependency-analysis bonus check).

## 15. Known limitations (honest)

1. The external LLM hop of the live chat route could not run here (no provider credentials); turn-level
   behavior is covered by the existing mocked suites and the acceptance harness exercised everything
   downstream of model output as shipped.
2. The sandbox cannot download dependencies (network namespace has no interfaces — by design). Dependency
   correctness is established by static analysis; build attempts through the sandbox report their real,
   often-failing result verbatim. Large builds (>10 files) are refused with an honest message.
3. The static preview has no compiler, so "compilation errors" do not exist in that path; runtime errors
   ARE captured live (browser bootstrap). Responsive checks are a viewport toggle, not automated layout
   assertion tooling.
4. Manual snapshot of an unchanged workspace is an honest no-op (duplicate-version protection) — surfaced
   as `{created: false, skipped: 'unchanged'}` in the API and UI, never as a fake new version.
5. Version history is capped at 200 per project (honest message at the limit); blob rows persist for the
   project's lifetime and are removed only by project deletion (cascade).
6. Rename detection is content-hash-based (exact-content matches only; a renamed AND edited file is
   reported as modified+added — the honest conservative classification).
7. The secret scan is a narrow, deliberately low-false-positive heuristic; it is a safety net, not a
   guarantee (documented in the manifest notes shipped with every export).

## 16. Deployment and recovery instructions

- Deploy: pull `main`, `npm install` (no new dependencies), `npx prisma db push` (additive sync — safe on
  the production SQLite file), `npm run build`, restart. No env changes; no destructive steps.
- Recovery/rollback of this milestone: the schema change is additive — reverting the code to the prior
  commit leaves the added columns/tables unused and harmless (existing columns were never retyped or
  dropped). To remove them entirely, a manual `DROP TABLE`/column drop would be required and is NOT
  automated (deliberately — no destructive migrations in this milestone).
- The verification DB (`scripts/m22-out/verify.db`) is a throwaway runtime artifact (gitignored); deleting
  it loses nothing (the acceptance harness recreates it).

## 17. Files changed (complete list)

**Modified (12):** `prisma/schema.prisma` (additive models/columns) · `src/lib/giftz/turn.ts` (version hook)
· `src/lib/giftz/chat-stream.ts` (`versionSeq` on the done frame) · `src/lib/giftz/prompts.ts` (targeted-edit
brief) · `src/lib/ai-engine/giftz-coding-handler.ts` (versionSeq in resultJson) ·
`src/app/api/code-giftz/chat/route.ts` (brief injection, versionSeq persistence, list metadata +
includeArchived, create-time framework metadata) · `src/app/api/code-giftz/projects/route.ts` (list metadata
+ status filter + POST create) · `src/app/api/code-giftz/projects/[id]/route.ts` (metadata GET + PATCH +
audit) · `…/[id]/files/route.ts` (concurrency + versioning + DELETE) · `…/[id]/preview/route.ts` (error
bootstrap injection) · `src/components/bean/code-giftz.tsx` + `src/components/bean/code-giftz-sidebar.tsx`
(versions panel, export, lifecycle actions, preview evidence, mobile viewport).

**Added (16):** `src/lib/code/{versioning,export,dependency-analysis,preview-audit}.ts` · routes:
`…/[id]/{open,duplicate,archive,restore,export,dependencies,build,preview-check}/route.ts`,
`…/[id]/versions/route.ts`, `…/[id]/versions/[seq]/{route,compare/route,rollback/route}.ts` ·
`tests/unit/code-{versioning,export,dependency-analysis,preview-audit,projects-security}.test.ts` ·
`scripts/m22/acceptance.ts` + `scripts/m22-regression-check.ts` · `docs/M22-PROJECT-PERSISTENCE-AUDIT.md`
+ this report.

**Deleted:** none. **Unrelated files touched:** none. **Destructive migrations:** none.

## 18. Publication

Per the repo sync policy: full gates on the exact tree (§13), push-delta secret/forbidden-artifact scan
(§13, zero hits), ONE descriptive commit on `main`
(`feat(code-giftz): add persistent projects and intelligent editing`), fast-forward push only (never
force-push, never rewrite history, no unrelated files staged, no secrets committed), `git ls-remote origin
refs/heads/main` verified equal to local HEAD immediately after push, final working tree clean.
