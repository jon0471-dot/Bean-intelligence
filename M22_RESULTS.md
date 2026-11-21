# M22 — Controlled Database Reset & Full Test Baseline Verification: RESULTS

Milestone: M22 (work-order label; note the repo already contains `docs/M22-PROJECT-PERSISTENCE-*` from an earlier milestone — the collision is recorded, not resolved by renaming).
Date: 2026-11-16 · Executor: automated session under the M22 work order · Verification-first: no application code was changed.

## 1. Baseline commit and remote SHA

| Item | Value |
|---|---|
| Published baseline at session start | `0aeb53cdb95e88e7767597668f90eda5032a7149` (local HEAD == `origin/main`, verified via `git ls-remote` after fetch) |
| Client-compute implementation commit | `d99e423` (intact, ancestor of baseline) |
| Platform auto-commit found at session start | `e396e42` ("8acee34c-a31c-40d8-bc93-cb4c89b6ef10", 202 files / 39,551 insertions, **0 deletions**) — swept the untracked M25/intel-lanes WIP into a local commit after the last push. NOT pushed (never on remote). Handled in §9. |
| Remote SHA after M22 delivery | recorded in §10 (fast-forward push, verified) |

## 2. Test database identification and safety evidence

**Positively identified reset target: `/home/z/my-project/db/custom.db`.**

- The ONLY database in the repository. `.env` carries exactly one variable, `DATABASE_URL=file:/home/z/my-project/db/custom.db`; every suite reaches the DB through `src/lib/db.ts` (Prisma, SQLite, `connection_limit=1` appended).
- `tests/database-runtime-build.sh` and `scripts/db-migrate-out` label this file the **Preview database**; production is a **different system entirely**: `docs/infrastructure/BEAN-PRODUCTION-DEPLOYMENT.md` specifies a managed `postgres://…` connection string provisioned at deployment, and `.env` here contains no postgres DSN, no provider credentials, and no secrets.
- Pre-reset state (read-only inspection): SQLite, `integrity_check = ok`, `journal_mode = delete`, 28 tables, **total rows = 0** (the platform recycle at 2026-11-16 00:36 + dev-server start at 01:04 had re-created the file empty). There was no user record, no uploaded-media row, no session row to destroy. Media blob area `storage/` (root-owned, mode 700) was probed read-only and **not accessed or modified**.
- **STOP condition evaluated: PASS** — the target is conclusively distinguishable from production (different engine, different host, different process) and contained zero user data.

Shared-state surface documented for §7/§8: all test files share this one DB file AND — under a non-isolated runner — one process-global object (module singletons: Prisma client, provider/backend registry, upstream breaker, in-memory quota/rate-limit maps, `process.env`). No per-suite test database exists; no Prisma seed process exists (`package.json` has no seed block); suites create their own fixture rows.

## 3. Backup and recovery verification

| Item | Result |
|---|---|
| Backup location | `db/backups/m22-20261116T011634Z/` (`custom.db` + `env.snapshot.txt`) |
| Copy fidelity | SHA-256 of backup **identical** to source: `134491622220cd2d…eb5627d` |
| Backup usability | Re-opened independently: `integrity_check = ok`, 28 tables, 0 rows — the backup is queryable and restorable by plain file copy |
| Recovery path | `cp db/backups/m22-20261116T011634Z/custom.db db/custom.db` (+ `bun run db:push` if schema sync desired) |

## 4. Reset and migration results

Sequence executed (dev server **stopped first** — it held an open handle; documented in §9):

1. `rm db/custom.db` (backup retained, hash-verified above).
2. `bun run db:push` — the repository's documented schema-sync command (`prisma db push --accept-data-loss`). Output: "Your database is now in sync with your Prisma schema"; Prisma Client regenerated.
3. Post-reset verification: file created fresh, `integrity_check = ok`, **28 tables — exact parity** with the pre-reset table inventory (ApiKey … User, including `ClientComputeReport` from the published milestone), **0 rows**.
4. No migration system exists (`prisma/migrations/` absent by design; `db:push` is the repo's mechanism) — "apply the correct migrations" is satisfied by the documented `db:push`.
5. Seed/fixture state: **none required** — no automated seeds exist in the repo; the suite's DB-backed tests create and clean their own rows (empirically confirmed: the full suite is green on the empty reset DB, §5). No global fixture rebuild was needed.

## 5. Full-suite results

Environment: bun 1.3.14, 2 vCPU, published tree `0aeb53c` checked out clean in a git worktree (`node_modules` shared), dev server stopped (no SQLITE contention), reset DB. Documented command per `package.json`: **`bun run test` == `bun test --isolate tests/`**.

| Run | Command | Result |
|---|---|---|
| A (post-reset) | documented `bun run test` | **1971 pass / 0 fail / 0 skipped / 38,961 expects / 141 files / 54.87s** |
| B (reproducibility) | documented `bun run test` | **1971 pass / 0 fail / 38,961 expects / 141 files / 54.67s — identical to A** |
| C1 (variable under test) | bare `bun test tests/` (NO `--isolate`) | **75 fail / 16 errors / 1740 tests ran / 141 files / 35.0s** |
| C2 (reproducibility) | bare `bun test tests/` | **75 fail / 16 errors — identical to C1** (non-isolated mode is deterministic within a fixed environment) |
| Pre-reset reference | 2026-11-15 post-recycle measurements (§13 of the implementation report; non-isolated, pre-reset db, dev server running) | 81 fail (clean-HEAD worktree) / 104 fail (main tree) |

**Answer to the milestone's core question:** the previously reported failures were caused by
(1) **running without the documented `--isolate` flag** (test-order/global-state dependency —
75 failing files collapse to 0 under the documented command), amplified by
(2) **shared-database + environment contamination** in the post-recycle state (db mutated by a
dev server, server process contending on SQLite, recycled gateway config — decontaminated here
by the controlled reset). **No genuine code defect was found.** C1/C2 lost 231 tests outright
(1740 vs 1971 ran) to import/cascade deaths (the 16 errors) — same class.

## 6. Client-compute test results (expected baseline 86/86)

**86 pass / 0 fail / 312 expects across 8 files** on the reset DB (`--isolate`, explicit run;
the same 8 files also green inside runs A/B). Published implementation `d99e423` untouched.

## 7. Failure-by-failure classification (all remaining failures = non-isolated runs only)

Under the **documented command there are ZERO failures to classify**. The 75 failures (11 files) observed without `--isolate` classify as follows:

| Class | Verdict | Evidence |
|---|---|---|
| A. Genuine application regression | **RULED OUT** | Byte-identical published tree; every failing file passes individually (135/135 tests, 11 files) and the full suite is green twice under the documented command |
| B. Test-order dependency | **CONFIRMED — primary cause** | (i) all 11 files pass individually; (ii) minimal poisoning chain found by binary search over the measured execution order: 20-file prefix + `provider-fallback.test.ts` = green; inserting `ai-gateway.test.ts` at position 21 → 5 assertion failures in `provider-fallback` (registry/env leak: expected `fallbacks = []`, received leaked OpenAI-compatible lanes); (iii) `--isolate` (fresh global object per file, per `bun test --help`) eliminates 75/75 |
| C. Shared database / fixture contamination | **CONFIRMED for yesterday's red runs; ELIMINATED here** | 81 → 11 failing files after the controlled reset + dev-server stop; remaining 11 fail identically on the empty DB (not DB-content-dependent); no suite requires pre-seeded rows |
| D. Timing / concurrency instability | **NOT PRESENT** | C1 and C2 produced identical failure sets (deterministic); no timeout-class failures observed in A/B |
| E. Environment / dependency issue | **ENVIRONMENTAL NOTES ONLY** (did not affect green runs) | `storage/` is root-owned 700 in today's sandbox (media-writing tests would EACCES in the main tree; the worktree runs used a fresh writable path; recorded, not triggered); `typescript@5.9.3`/`@types/node@25.0.9` match `bun.lock`; the 12 test files that write `process.env` (list captured) are the leak vector enabling class B |
| F. Existing test-suite debt | **CONFIRMED (bounded)** | Bare `bun test` (no `--isolate`) is not the documented command; the 11 files' reliance on shared process state is pre-existing debt, unchanged by this milestone |
| G. Inconclusive | **NONE** | Every failure accounted for by B (+C as the removed amplifier) |

Failing files (11, with failing-test counts): `provider-fallback` (9), `ai-engine-queue` (15), `reach-gateway` (10), `reach-adapter` (10), `intel-continuity` (4), `ffprobe-health` (1), `research-direct-lane` (1), `jazmii-video` (3), `jazmii-evidence-wiring` (4), `zero-downtime-quota` (1), `chat-recovery-quota` (2). Per-test messages and stack traces captured in `/tmp/m22/runC*.log` and `runC-junit.xml` (session artifacts; distilled evidence above).

## 8. Remaining test-order dependencies

- The 11 files above remain order-sensitive **only under a non-isolated runner**; the documented `--isolate` command is immune by construction ("Run each test file in a fresh global object. Leaked handles from one file cannot affect another.").
- Demonstrated poisoner: `ai-gateway.test.ts` (mutates provider/backend registry + `process.env` scenario state) → victim `provider-fallback.test.ts`. Twelve files write `process.env` without a harness-enforced restore (enumerated in the worklog); this is the general leak vector.
- Operational rule going forward: **baseline claims must use `bun run test`**; bare `bun test` results are not comparable to the gate.

## 9. Production-data safety confirmation

- Production (managed Postgres, external host per deployment docs) was never addressed by any command in this milestone — different engine, host, and credentials; nothing in this sandbox references it.
- Reset destroyed **0 rows** (DB pre-verified empty; backup taken first, hash-verified, restorable).
- `storage/` (persistent media area) untouched — read probe only, permission-denied, no writes attempted or performed.
- The platform auto-commit `e396e42` (202 WIP files incl. M25 + intel-lanes) was **preserved on branch `backup/m22-wip-auto-commit`** and the working tree was restored to the published state with those files back as untracked (byte-identical content, 0 deletions in the auto-commit; verified: 0 modified tracked files after surgery). Nothing was discarded and nothing WIP was published.
- Dev server: stopped (PIDs recorded) for handle-safety and contention-free measurement, then **restarted via the documented `bun run dev`**; health re-verified (§10 evidence in worklog).
- Client-compute published implementation, audit/architecture/security docs, and the §13 instability report: **unmodified** (working tree byte-identical to `0aeb53c` apart from intended M22 files).

## 10. Files changed and commit details

| File | Change |
|---|---|
| `M22_RESULTS.md` | NEW — this report |
| `worklog.md` | APPENDED — M22 session entry |
| `scripts/m22-poison-hunt.py` | NEW — forensic tool (minimal-poisoner binary search over measured execution order) |

Commit: single descriptive commit on `main`, containing ONLY the three files above; push-delta scanned with the repo's S5 scanner (`scripts/phase1-secret-scan.py`) before push; **fast-forward-only push; remote SHA verified == local HEAD** (SHA values recorded in the worklog entry and visible via `git ls-remote`). No force push. No M25 WIP committed.

Final verification actuals: documented full suite 1971/0 (twice) · client-compute 86/0 · `tsc --noEmit` on published tree: **0 errors in `src/`+`tests/`** (140 pre-existing error lines confined to `scripts/`+`validation/`, unchanged scope — none attributable to the client-compute milestone; the M25/intel-lanes WIP TypeScript errors live on the backup branch / untracked files and are excluded from this verdict) · production build `bun run build`: PASS (standalone server assembled) · S5 secret scan on delta: clean · working tree after delivery: HEAD == origin/main == M22 commit + 92 untracked WIP paths restored.

## 11. Remaining risks and recommended next milestone

1. **Bare `bun test` remains red by design-debt** (class B/F). Risk: future sessions repeating yesterday's mistake will misread the suite as regressed. Recommendation (next milestone, small scope): add per-file env/registry save-restore hygiene or make `--isolate` unavoidable (e.g., CI wrapper), so both invocation styles are green — without touching application code.
2. **§13 relationship**: §13's provisional conclusion ("full-suite gate not re-verified green in recycled environment") is now superseded by this controlled re-baseline (green twice under the documented command on a reset DB). §13 is preserved verbatim; this report is the corrective record.
3. **`storage/` permission drift** (root 700 after recycle) is an environment hazard for media-write tests in the main tree; flag to the platform owner, not fixable in-repo.
4. **Outstanding debt (unchanged)**: M25 completion (5 failed acceptance steps, preserved on backup branches) remains the next real implementation milestone, followed by the intel-lanes WIP review.
