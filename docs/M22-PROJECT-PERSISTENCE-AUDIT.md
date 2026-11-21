# CODE GIFTZ — M22 Project Quality, Persistence & Intelligent Editing: Phase 0 Architecture Audit

Repository: `https://github.com/jon0471-dot/Bean-intelligence.git` · Branch: `main`
Audited at commit: **`ee0c91af8cbe249aa38ea99f5b15666dd769a6ad`** — the expected baseline, verified exactly:
`git ls-remote origin refs/heads/main` = local `HEAD` = `ee0c91af…` (remote and local identical, zero drift);
`git status --porcelain` empty → clean working tree. **No code was modified by this audit.**

Purpose: map everything M22 must preserve and reuse before writing a single line. Every statement below was
verified against the committed modules (files read in full this session), not copied from memory.

---

## 1. Repository state

| Check | Measured value |
| --- | --- |
| Current branch | `main` |
| Local HEAD | `ee0c91af8cbe249aa38ea99f5b15666dd769a6ad` |
| Remote main SHA (`git ls-remote`) | `ee0c91af8cbe249aa38ea99f5b15666dd769a6ad` — identical |
| Working tree | clean (`git status --porcelain` → 0 entries) |
| Latest commit | `ee0c91a test(code-giftz): validate real-world frontend generation` (M21 delivery) |
| M21 implementation | present: frontend-intel engine repairs (R-A2/R-A2b/R-B1/R-C1) in `src/lib/frontend-intel/{vanta,engine,validate}.ts`, validation artifacts under `validation/m21/` (135 tracked files incl. the three fixtures `project-a-landing` (Nebula), `project-b-dashboard` (Pulse), `project-c-portfolio` (Nova Reyes), model-response records, browser/build evidence, harness tooling) |
| Prior milestone also verified | `a258a37 fix(bean): restore shared gateway rate-limit handling` and `6a84481 feat(bean): restore LAXII and JAZMII capabilities` are ancestors of HEAD |

## 2. Existing CODE GIFTZ task architecture (preserved, reused)

- **Task modes** (`/api/code-giftz/tasks`, `POST`): `generate | explain | review | plan` against the hosted LLM;
  synchronous `GenerationJob` rows persisted for audit. Untouched by M22.
- **Chat-first workflow** (`/api/code-giftz/chat`, `POST`): SSE streaming (or `?stream=0` JSON) turn execution.
  Both the live route and the **background coding worker** (`src/lib/ai-engine/giftz-coding-handler.ts`, driven by
  the durable `GenerationJob` queue with leases/dedupe/cancel/retry classes) execute the SAME turn core
  `runGiftzTurnCore` (`src/lib/giftz/turn.ts`): controlled continuation → optional self-verification with bounded
  corrective revision → `parseFiles` (path-tagged fences) → `applyFiles` (persistence with real diffs) →
  frontend-intelligence engine attachment (opt-in plan; internal-only) → deterministic generation checks.
- **Frontend intelligence (internal, M20/M21):** `resolveFrontendPlan` runs before prompt assembly;
  168 React Bits components, 15 GSAP patterns, 13 Vanta effects; no UI/API selection surface (enforced by
  `giftz-ui-restriction.test.ts`). The engine persists kit sources + pinned `package.json` + `NOTICES.md`
  through the SAME `applyFiles` path.
- **Prompt layer:** `SYSTEM_PROMPT` (`src/lib/giftz/prompts.ts`) + bounded project context
  (`buildProjectContext`, 24k budget, honest truncation reporting) + tech-docs/research blocks.
  Files ride into the model context as path-tagged fences; the model answers with complete files in
  `path=`-tagged fences (modification = re-emitting the touched file with full new content).

## 3. Generated-file storage (existing mechanism — REUSED, not replaced)

- Storage is **SQLite rows, not a filesystem**: `CodeFile { projectId, path, content, origin: generated|modified }`
  with `@@unique([projectId, path])`. Files persist across sessions today — CODE GIFTZ is already
  session-durable; what is missing is lifecycle (archive/duplicate/metadata), versioning, diff review and export.
- The M22 instruction "do not assume files should be stored directly inside SQLite; determine the appropriate
  mechanism from the existing architecture" resolves to: **the existing architecture already chose SQLite
  TEXT storage for CodeProject files**, and every consumer (preview, sandbox run, file save, model context
  builder) reads from the DB. LAXII uses filesystem storage (`storage/` + `ImageAsset.path`) for binary media —
  a different product with different access patterns. Migrating CODE GIFTZ files to the filesystem would be a
  rewrite of all consumers (forbidden by "reuse existing implementations"; high regression risk) with no
  functional gain: file contents are bounded (`MAX_FILE_CHARS = 24_000` per file from the model path;
  400_000 via the manual editor), `MAX_TURN_FILES = 12` per turn, `MAX_SESSION_FILES = 25` declared per project.
  **Decision: keep DB storage; add storage-efficient versioning on top (content-hash blob dedup, §7).**

## 4. Project ownership (existing, preserved)

Every CODE GIFTZ route loads the project then checks `project.userId !== user.id → NOT_FOUND('Project not found.')`
(no existence leak across users) — verified in: `projects/[id]/route.ts` (GET/DELETE), `projects/[id]/files`
(POST), `projects/[id]/preview` (GET), `projects/[id]/run` (POST), `chat/route.ts` (POST/GET), `chat/[id]/route.ts`
(GET/PATCH/DELETE). `requireUser()` (session cookie) guards all of them. This owner-check pattern is the
template for every new M22 route.

## 5. Database schema (additive-only policy)

- Prisma + SQLite (`prisma/schema.prisma`, `DATABASE_URL=file:…`, `connection_limit=1` serialization noted in
  `src/lib/db.ts`). **No migrations directory exists** — schema sync is `prisma db push` (the repo's
  `npm run db:push`). Additive columns/tables are non-destructive; M22 adds columns/tables only, never drops
  or retypes existing ones.
- Relevant existing models: `CodeProject { id, userId, title, createdAt, updatedAt }`,
  `CodeMessage { projectId, role, content, metaJson (changes summary/verification/research), createdAt }`,
  `CodeFile` (above). Gaps M22 fills: no `description`, `framework`, `language`, `status` (archive), no
  `lastOpenedAt`, no version tracking.

## 6. Sandbox execution and approval (existing, preserved)

`src/lib/sandbox/runner.ts`: ephemeral workspace `sandbox-runs/<uuid>/`, child process with minimal env (no
secrets/DATABASE_URL), `unshare -Urn` fresh user+network namespace + `prlimit` caps (AS 4 GiB, CPU 10 s,
NPROC 512, NOFILE 256, FSIZE 16 MiB) + SIGKILL wall clock (15 s) + 64 KB output caps; the actually-active
isolation layers are reported per run (honest profile). Entry detection is single-file (`main.ts|main.js|main.py`
→ first runnable); max 10 files per run. Execution happens ONLY after the explicit `approval: z.literal(true)`
body flag (`projects/[id]/run/route.ts`) — generation never auto-executes. **Consequence recorded for M22
Phase 6:** the sandbox's network namespace has no interfaces, so `npm install` cannot download packages inside
it — dependency installation feasibility must be reported honestly, never faked.

## 7. Preview infrastructure (existing, extended by M22)

`projects/[id]/preview/route.ts` serves the project's `index.html`/`main.html` as a standalone document with
project CSS/JS inlined; CSP `default-src 'none'; script-src 'unsafe-inline'; …`; consumed inside a
`sandbox="allow-scripts"` iframe (no same-origin → cannot touch BEAN cookies/APIs). Static only — no build
step, no multi-page routing, no error capture. M22 adds: cache-busted refresh after accepted changes,
in-page console-error collection (postMessage from the sandboxed frame), deterministic missing-asset /
broken-internal-link audit, and a mobile-width viewport toggle. Compilation-error detection is recorded as
not applicable to static HTML previews (no compiler exists in that path) — the honest equivalent signals are
the in-frame runtime errors and the sandbox terminal for JS entries.

## 8. Existing job queue (reused, not duplicated)

`GenerationJob` + `JobEvent` durable queue (worker leases, `dedupeKey`, cooperative cancel, error classes,
bounded retries, SSE event replay from any cursor) drives the background coding worker. M22's versioning hooks
attach AFTER the turn core completes — no new queue, no new worker.

## 9. Existing file download/export functionality

- **None for CodeProject projects today.** The closest existing capabilities: LAXII/JAZMII media downloads
  (`/api/laxii/assets/[id]`, `/api/jazmii/jobs/[id]/media` — single artifact responses) and the file-upload
  pipeline's `src/lib/files/archive.ts` (JSZip-based archive INSPECTION for uploads, with reusable
  path-traversal detection `hasUnsafeEntryName`, zip-bomb and encryption checks).
- **`jszip@^3.10.2` is already a dependency** (used for inspection) — M22 reuses it for export GENERATION
  plus a load-back verification pass. No new dependency is added at repo level.

## 10. Persistent projects & versioning — what already exists vs. what M22 adds

| Lifecycle capability | Status at baseline |
| --- | --- |
| Create project | EXISTS (implicitly via first chat turn; `chat/route.ts` auto-creates with title = first 60 chars of message) |
| Save generated files | EXISTS (`applyFiles`, real diffs, no-op on identical content) |
| Open existing project | EXISTS (sidebar list + detail GET; files + messages restored) |
| Continue editing | EXISTS (chat turns re-emit touched files; manual editor Save via `projects/[id]/files`) |
| Rename project | EXISTS (`chat/[id]` PATCH, `sanitizeConversationTitle`) |
| Description / framework / language metadata | MISSING |
| Duplicate project | MISSING |
| Archive / restore | MISSING (`Project` (developer portal) has `status`, `CodeProject` does not) |
| Delete with confirmation + ownership | EXISTS (UI AlertDialog + owner-checked DELETE) |
| Track metadata (lastOpenedAt, currentVersion, status) | MISSING |
| **Version history** | **MISSING entirely** — `planFileUpdates` computes per-file version numbers but never persists them; no snapshot/rollback/compare anywhere |
| Diff & change review | PARTIAL — per-turn real line diffs (`diffContent` + `src/lib/code/diff.ts` LCS `diffLines`/`compactDiff`/`diffStats`, capped at 2,000 rows) persisted in message `metaJson`; no cross-version comparison, no dependency/config change view, no pre-apply review surface |
| Visual preview & repair | PARTIAL (§7) |
| Dependency & build management | MISSING for projects (frontend turns get bare-import↔package.json validation inside the engine's deterministic checks only) |
| Complete project export | MISSING (§9) |

## 11. Reuse decisions (binding for implementation)

1. **Turn core / persistence**: reuse `applyFiles` as the single file-write path; versioning hooks wrap it,
   never bypass it.
2. **Owner checks**: replicate the existing `userId !== user.id → NOT_FOUND` pattern verbatim in every new route.
3. **Path safety**: reuse `assertSafeProjectPath` (chat paths, allows spaces) and `assertSafeRelativePath`
   (sandbox paths) as applicable; ZIP entry names re-validated with `hasUnsafeEntryName`.
4. **Diffs**: reuse `diffLines`/`compactDiff`/`diffStats` from `src/lib/code/diff.ts`.
5. **ZIP**: reuse `jszip` (already a dependency) for export; verification = load-back + entry count + name checks.
6. **Sandbox**: any dependency/build execution attempt goes through the existing `runInSandbox` with explicit
   approval; results (including honest failure from network isolation) are recorded verbatim.
7. **Schema**: additive columns on `CodeProject` + new tables `CodeBlob`, `CodeVersion`, `CodeVersionFile`;
   `prisma db push` sync; no destructive migration; no new database file.
8. **UI**: extend the existing `code-giftz.tsx` workspace + `code-giftz-sidebar.tsx` (same visual language,
   gold-on-dark design system); no separate developer dashboard; no toolkit selectors.
9. **Tests**: mirror the repo's established pattern — in-memory Prisma-boundary fakes via `mock.module`
   (as in `tests/unit/api-keys-projects.test.ts`), pure-function suites for libraries, no test touches the real DB.

## 12. Preservation checklist (verified at baseline, all M22 gates re-run at delivery)

168 React Bits components · 15 GSAP patterns · 13 Vanta effects · component registry + attribution +
`NOTICES.md` contract · frontend-intel orchestration (internal-only) · turn core, parse/apply/diff ·
task modes (generate/explain/review/plan) · chat SSE + background worker · sandbox isolation + explicit
approval · project ownership/tenancy · API keys, scopes, rate limits · `GenerationJob`/`JobEvent` queue ·
RIISHE / LAXII / JAZMII · M21 fixtures under `validation/m21/` (untouched) · UI without unrelated redesign.
