# CODE GIFTZ — M23 Chat-Based File Operations & Safe Project Mutation: Final Report

Repository: `https://github.com/jon0471-dot/Bean-intelligence.git` · Branch `main` · fast-forward push only.
Baseline at session start: **`b34eedad6ef629e80fbf920774fb2f29ed7d73b8`** (required baseline verified exactly:
`git ls-remote` = local HEAD; clean tree). Companion document: `docs/M23-FILE-OPERATIONS-AUDIT.md`
(the mandatory pre-implementation audit — everything below was designed against it; **no duplicate storage,
project, versioning, sandbox, AI-gateway or authorization system was created**).

**Outcome in one line:** users can now create, rename, move and delete project files and folders through
natural-language CODE GIFTZ chat — resolved deterministically server-side against the real project file list,
planned as structured server-validated operations, confirmed for destructive actions with a
plan-hash-bound confirmation, executed transactionally over the existing DB-backed storage with staleness
and replay protection, verified (content preservation + reference integrity), versioned through the M22
history with rollback-as-new-version, and offered a separately reviewable import-repair after every
rename/move — while the full regression suite (1,876 tests), the internal frontend library
(168 React Bits / 15 GSAP / 13 Vanta), the M21 fixtures and every existing security control remained intact.

---

## 1. Previous architecture and reused components

| Area | Found at baseline (M22 tip) | M23 disposition |
| --- | --- | --- |
| Project files | `CodeFile { projectId, path, content, origin }` rows (SQLite), folders implicit from path prefixes | REUSED — all operations are transactions over these rows; no filesystem, no new storage |
| Single write path | `applyFiles` (upsert + honest diffs) | REUSED for reference repairs; structural ops (path/delete/create) get a transactional executor beside it |
| Path safety | `assertSafeProjectPath` / `assertSafeRelativePath` / `hasUnsafeEntryName` | REUSED at detection, planning AND execution (defense in depth) + new `normalizeProjectPath` |
| Versioning | `snapshotProjectVersion` with blob dedup, integrity hash, rollback-as-new-version | REUSED as-is; `VersionKind` extended additively with `file-op` and `repair` (SQLite TEXT — no migration) |
| Ownership | `requireUser` + `userId !== user.id → NOT_FOUND` on every route | REPLICATED verbatim on the two new routes; operations are always loaded through the owner-checked project |
| Chat pipeline | `POST /api/code-giftz/chat` (SSE + JSON), `createGiftzChatStream` lifecycle, retry dedupe | REUSED — a detected operation rides the SAME stream lifecycle with a truthful deterministic assistant message; undetected messages flow bit-for-bit as before |
| Targeted editing | `buildTargetedEditBrief` (re-emit only changed files; no rename/move/delete through the channel) | UNCHANGED — file-op turns are intercepted BEFORE prompt assembly, so the model never sees them |
| Reference scanning | `normalizeRef`/`extractRefs` semantics from the M22 preview audit | REUSED as the semantic basis for the new import/asset reference scanner |
| Sandbox / queue / gateway / tenancy | untouched | UNTOUCHED — file operations consume no model tokens (the preflight slot is released immediately) |

## 2. New operation contracts

`src/lib/code/file-ops/` (server-only, pure where possible):

- **`detect.ts`** — deterministic intent detection: rename / move (single + explicit batch) / delete /
  create-folder / batch-rename-by-convention / explicit-content create / consequence-only questions
  ("what happens if I delete X?" → explanation, never execution). Resolution ladder: exact path → folder
  prefix → unique folder basename → unique basename → unique stem → word-overlap candidates (deletion only,
  clarification, never auto-picked). Guards: a code fence is a content edit (except the one-fence
  explicit-content create); multi-word rename/move destinations are prose and never guessed; "move the hero
  section in App.tsx" (destination resolves to an existing file) is a code edit; `..`/absolute/drive paths
  are refused by normalization.
- **`plan.ts`** — builds the structured `FileOpPlan`: exact per-file mutations, destination-conflict
  detection (case-insensitive, excluding the operation's own sources so case-only renames work), protected
  paths (`package.json`, lockfiles, `NOTICES.md` refuse deletion; rename/move stay allowed), root rejection,
  per-operation limit (25 mutations), reference-impact scan, truthful consequence text. `planHash` =
  SHA-256 over the canonical plan JSON — **the confirmation binding**.
- **`execute.ts`** — the confirmation-bound executor: plan-integrity re-hash, staleness gate (sources must
  still exist; destinations must still be free; repair edits must still match their text), one atomic
  `db.$transaction` with IN-TRANSACTION re-validation of every precondition, replay-safe ledger
  (`CodeFileOperation` rows: `awaiting_confirmation → executed | cancelled | failed | stale`), post-execution
  verification (content preservation by hash + remaining-reference count), version snapshot AFTER verified
  mutations only (kind `file-op` / `repair`; a failed operation snapshots NOTHING), and the repair offer.
- **`references.ts`** — import/asset/config reference scanning (ESM/from/require/dynamic-import
  specifiers resolved relative to the importing file, HTML src/href, CSS url(), root-relative and `@/`
  alias forms, extension-less imports) + repair-edit construction (recomputed relative/alias/root
  specifiers, folder moves rewrite every ref under the moved prefix, extension convention preserved) +
  exact-text replacement with honest missing-reference reports.

Routes: `POST /api/code-giftz/projects/[id]/file-ops/execute` (the confirmation action; idempotent replay)
and `POST …/file-ops/cancel`. Planning happens inside the chat route — there is no client-supplied plan
anywhere; the server never trusts model output or browser input for paths.

## 3. Confirmation and authorization behavior

- **Destructive operations require explicit confirmation**: deletion (always) and reference repair (always).
  Rename/move/create are non-destructive (contents preserved, versioned, reversible) and execute immediately
  — with the full plan/result card shown in the transcript either way.
- **The confirmation is bound to the exact plan**: the execute endpoint loads the operation row, recomputes
  the plan hash from the stored plan bytes and refuses on mismatch (pinned by test: a tampered plan is
  refused and marked `failed`). A previous confirmation never authorizes a different operation.
- **Stale plans are refused and recorded as `stale`** (sources vanished, destinations taken, repair text
  changed) — the user is told to re-plan; nothing is partially applied.
- **Replay-safe**: an already-executed operation returns its recorded result verbatim (`replayed: true`)
  instead of mutating twice; cancelled/failed records refuse execution; an identical destructive plan
  re-sent while awaiting confirmation reuses the same operation row.
- **Ownership**: both routes answer `NOT_FOUND` for foreign/missing projects (no existence leak) and 401
  when unauthenticated; operations from one project cannot execute under another's id.

## 4. Security protections (each pinned by a test)

Path traversal / absolute-path / drive-letter injection (normalize + existing validators at all three
layers) · root deletion refusal · protected system files (`package.json`, lockfiles, `NOTICES.md`) ·
malicious filenames (the existing character whitelist + case-aware conflict checks) · recursive-deletion
abuse (exact file counts shown, 25-mutation cap, folder content reported before confirmation) · IDOR /
cross-project access (route-level tests) · unauthorized destructive operations (confirmation binding) ·
stale confirmation replay (staleness gate + ledger states) · duplicate execution (idempotent replay) ·
concurrent modification (pre-execute gate + in-transaction re-validation; SQLite `connection_limit=1`
serializes writers) · partial batch failure (atomic transaction — all or nothing, honestly reported) ·
storage corruption (M22 integrity hashes re-validated after operations; rollback refuses corrupt versions)
· symlink escapes (N/A — DB-level storage resolves no filesystem paths; the sandbox writer keeps its own
validator; recorded honestly) · secret/internal-path leakage (chat responses carry project-relative paths
only; no internal paths, env or credentials exist in the operation context).

## 5. Failure and recovery behavior

- A multi-file operation runs in ONE transaction: a mid-batch failure rolls back completely and the ledger
  records `failed` with the truthful reason — partial success is never reported as success (pinned: a
  folder delete whose source set changed refuses WHOLE, leaving every surviving file untouched).
- Failed/stale operations never create versions.
- Every successful mutation snapshots a version; deletion never destroys historical versions or
  deduplicated blobs, so M22 rollback restores deleted trees exactly (pinned end-to-end: rename → folder
  delete → rollback → tree restored, all versions integrity-valid).
- The chat response for a failed/stale/refused operation states the honest reason and that nothing changed.

## 6. Versioning integration

- New `VersionKind` values: `file-op` (structural operations) and `repair` (approved reference fixes) —
  additive to the M22 union; no schema migration.
- Blob deduplication unchanged: re-emitted unchanged files across versions still cost one row.
- Rollback remains append-only (rollback = NEW version). The acceptance run re-validated integrity on
  every version after operations (7/7 and 2/2 ok in the regression projects).
- Rename detection in `changedFilesJson` records the real `renamed` change with `previousPath`.

## 7. Chat interface integration

- The chat route intercepts detected operations after project resolution and BEFORE the model preflight —
  a file operation consumes no provider slot and no tokens, never reaches the model, and cannot be
  triggered by model output (detection is deterministic server-side).
- Additive `fileOp` payload on the JSON response, the SSE `done` frame, and assistant `metaJson` — so
  pending confirmations survive a page reload and stay actionable.
- The transcript card (same gold-on-dark design language) shows: detected operation, source → destination,
  EVERY affected path (full list for batches), conflict warnings, reference-impact warnings, the
  consequence text, Confirm/Cancel (destructive ops; Confirm opens a dialog stating the exact plan and the
  version-history recovery semantics), execution progress, the truthful result with verification detail,
  the recorded version badge, and the "Review repair" action when imports may break.
- Clarification questions render as plain assistant text; rejected/failed plans show the honest reason.
- No separate file-management dashboard; no internal toolkit surfaces; existing navigation unchanged.

## 8. Reference integrity workflow

1. Detection/planning scans every project file for references to the affected path(s) — imports
   (relative/extension-less/`@`-alias/root-relative), HTML assets, CSS `url()`.
2. The rename/move executes WITHOUT touching any other file's content (the M23 rule: never silently
   rewrite imports).
3. The result reports the remaining-reference count and offers a repair plan (its own operation row, its
   own confirmation) listing the affected files; the dialog shows the consequence and every file before
   approval.
4. The approved repair applies EXACT text replacements in exactly the identified files through `applyFiles`
   (the single content-write path), records a `repair` version, and re-scans — reporting the honest
   remaining count (0 after a complete repair).
5. Files that changed between offer and approval make the repair stale; it refuses rather than guessing.

## 9. Tests and results (Phase 14/16 — real counts, no fabricated evidence)

- **Full test suite:** `bun test --isolate tests/` → **1,876 pass / 0 fail / 132 files / 38,629 expects**
  (M22 baseline 1,794 / 129 — the +82 are exactly the three new M23 suites: 32 detection, 14 reference
  scanning, 36 security/flow; zero existing tests weakened or deleted).
- **New suites:**
  - `code-file-ops-detect.test.ts` (32): normalization, resolution ladder, ambiguity clarifications,
    prose-edit fall-through, fence guard, explicit-content create, explain-only questions, conventions.
  - `code-file-ops-references.test.ts` (14): import/alias/root/asset scanning, folder-move ref rewriting,
    exact repair edits, stale-missing reports, `normalizeRef` parity with the preview audit.
  - `code-file-ops-security.test.ts` (36, route-level over a fully mocked Prisma boundary): the full
    security matrix in §4 plus atomicity, versioning integration, rollback integrity, replay, staleness,
    protected paths, clarification and no-op behaviors.
- **TypeScript:** `tsc --noEmit` → 0 errors in `src/` + `tests/`.
- **ESLint:** 0 errors, 0 warnings in `src/`, `tests/`, `scripts/m23/`.
- **Production build:** `npm run build` PASS — 49 routes compiled; the two new file-op routes registered.
- **Real SQLite persistence tests:** `scripts/m23/acceptance.ts` (evidence:
  `scripts/m23-out/acceptance.json`) against an isolated verification DB — **16/16 steps passed** (§10).
- **Secret scan over the delta:** 0 hits (secret-assignment shapes, private-key blocks, AWS/GitHub/OpenAI
  token patterns); no `.env`, lockfiles or `node_modules` in the delta; the verification DB is gitignored.
- **UI restriction:** `giftz-ui-restriction.test.ts` green (part of the full suite) — no toolkit panels,
  catalogue routes or frontend-selection fields were introduced.

## 10. Real acceptance evidence (all 10 demonstration dimensions)

Method (the established M21/M22 honest-substitution policy): no provider credentials exist in this sandbox,
so the external LLM hop cannot run — and M23 needs none: file operations are deterministic server-side code,
exercised end-to-end through the REAL committed modules against REAL SQLite (isolated `verify.db`).

| # | Demonstration | Result | Evidence detail |
| --- | --- | --- | --- |
| 1 | Nebula fixture seeded as a persistent project | PASS | 22 files, version 1 |
| 2 | Chat rename executes with byte-identical content | PASS | `components/site-nav.tsx → top-nav.tsx`, v2, contentsPreserved=true |
| 3 | Offered import repair fixes `App.tsx` | PASS | 1 file repaired, remainingReferences 0, v3 (`repair`) |
| 4 | Folder move preserves nested contents | PASS | 7 kit files byte-identical at new prefix, v4 |
| 5 | Batch rename by convention | PASS | PascalCase file created via explicit-content flow, batch → `site-footer.tsx` |
| 6 | Create folder + explicit-content file | PASS | `docs/.gitkeep` marker + `docs/manual.md` with real content |
| 7 | Destructive delete: confirmation gate + cancel | PASS | plan lists 7 files; nothing changed before confirm; cancel leaves all files |
| 8 | Confirmed folder deletion | PASS | exactly the 7 planned files removed, v7 |
| 9 | Rollback-as-new-version + integrity | PASS | tree restored, v8; ALL versions integrity-valid (7/7) |
| 10 | Reopen + verified ZIP export | PASS | fresh SQLite reads byte-exact; ZIP reopened and verified (19 entries, 0 issues) |
| + | M21 fixture regression (Pulse, Nova Reyes) | PASS | representative rename/folder-delete/create ops; integrity 2/2 each |
| + | Fixtures untouched on disk | PASS | 70 fixture files hash-verified unchanged; verification projects cleaned up |

Unrelated-file check: the ONLY content change across the entire Nebula run was the user-approved repair
(`App.tsx`); every other original file remained byte-for-byte identical.

## 11. Known limitations (honest)

1. Detection is deterministic by design: unusual phrasings fall through to the normal model turn (which
   still cannot rename/move/delete — the targeted-edit brief says so). Batch operations require explicit
   paths ("move a.ts, b.ts and c.ts into src/lib"); "these three files" without names asks for them.
2. Bulk deletion of a whole project's files is not a chat operation (the 25-mutation per-operation cap and
   the protection list are deliberate); the project delete flow covers that case with its own confirmation.
3. Folders materialize as `.gitkeep` markers (the conventional empty-folder representation); a folder
   "exists" while its marker does. This is documented in the plan card and the export manifest notes.
4. Bare create-file requests ("create utils.ts") are deliberately NOT file operations: real content comes
   from the targeted-edit pipeline (the normal model turn), never an empty placeholder. Explicit-content
   creates (one pasted path-tagged fence naming the same path) are real create operations.
5. Custom path aliases other than `@/` are not statically resolvable; such references are never rewritten
   and never silently broken — the scanner simply does not claim them (an honest limitation, stated in the
   audit and here).
6. The repair scanner covers import/require/dynamic-import specifiers, HTML src/href and CSS url() forms;
   string-built dynamic paths (e.g. `import('./' + name)`) are undetectable statically — stated, not hidden.
7. The M23 acceptance harness (like M21/M22) cannot exercise the live LLM hop in this sandbox; file
   operations require none, and the mocked chat-route suites pin the interception ordering.
8. `App.tsx`-style repairs are shown per file in the confirmation dialog; the per-line diff is viewable in
   the editor after application (the repair response reports exactly which files changed and re-scans).

## 12. Deployment and recovery instructions

- Deploy: pull `main`, `npm install` (no new dependencies), `npx prisma db push` (additive sync — one new
  table `CodeFileOperation` + the `CodeProject.fileOperations` relation; no existing column is dropped or
  retyped), `npm run build`, restart. No env changes; no destructive steps.
- Recovery/rollback of this milestone: reverting the code leaves the new table unused and harmless (the
  additive-only policy); removing it entirely would require a manual `DROP TABLE`, which is deliberately
  NOT automated.
- The verification DB (`scripts/m23-out/verify.db`) is a throwaway runtime artifact (gitignored); deleting
  it loses nothing (the harness recreates it).

## 13. Files changed (complete list)

**Modified (8):** `prisma/schema.prisma` (additive `CodeFileOperation` + relation) ·
`src/lib/code/versioning.ts` (VersionKind union + two kinds) · `src/lib/giftz/chat-stream.ts`
(additive `fileOp` on the turn result + done frame) · `src/lib/riishe/sse-client.ts` (additive wire field) ·
`src/app/api/code-giftz/chat/route.ts` (detection interception + file-op turn flow) ·
`src/app/api/code-giftz/chat/[id]/route.ts` (fileOp restored from metaJson) ·
`src/components/bean/code-giftz.tsx` (operation cards, confirm/cancel, repair offer, state) · `.gitignore`
(m23-out verification DB).

**Added (12):** `src/lib/code/file-ops/{types,detect,references,plan,execute}.ts` · routes
`…/[id]/file-ops/{execute,cancel}/route.ts` · `tests/unit/code-file-ops-{detect,references,security}.test.ts` ·
`scripts/m23/acceptance.ts` (+ the committed evidence `scripts/m23-out/acceptance.json`) ·
`docs/M23-FILE-OPERATIONS-AUDIT.md` + this report.

**Deleted:** none. **Unrelated files touched:** none. **Destructive migrations:** none.
**Existing tests modified:** none.

## 14. Publication

Per the repo sync policy: full gates on the exact tree (§9), push-delta secret/forbidden-artifact scan
(zero hits), ONE descriptive commit on `main`
(`feat(code-giftz): add safe chat-based file operations`), fast-forward push only (never force-push, never
rewrite history, no unrelated files staged, no secrets committed), `git ls-remote origin refs/heads/main`
verified equal to local HEAD immediately after push, final working tree clean.
