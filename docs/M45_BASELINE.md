# M45 BASELINE — REPOSITORY RECONCILIATION RECORD

> Milestone: M45 — Conversational Intelligence & Governed Real-World Execution
> Branch: `feat/m45-conversational-governed-execution`
> Recorded: 2026-11-27 (UTC), recovery session after a sandbox startup failure.
> Every SHA below was verified live in this session by `git fetch --all --prune`, `git rev-parse`, `git merge-base --is-ancestor`, and `git ls-remote origin` (independent network query). No SHA was assumed from any prior report.

## 1. Verified remote state

| Ref | SHA (verified live) | Method |
| --- | --- | --- |
| `origin/main` | `4bfdfbe134da98c91ae13ba0aa2d9bbc7571b309` | `git ls-remote` + post-fetch `rev-parse`, both agree |
| `origin/feat/m44-autonomous-decision-execution` | `e2497c51009974239abb0b42509da3f466784c5b` | `git ls-remote` + post-fetch `rev-parse`, both agree |
| `origin/feat/m45-conversational-governed-execution` | absent before this session | `git ls-remote` returned no matching ref |

Fetch delta observed this session: `main` advanced `eff0d96..4bfdfbe` (76 commits) — this single advance carried the M40 → M44 history into `origin/main`.

## 2. PR #35 verification

The GitHub REST API could not be queried from this sandbox (unauthenticated rate limit for the egress IP), so PR #35 was verified at the git level, which is stronger evidence than API metadata:

- Merge commit `4bfdfbe134da98c91ae13ba0aa2d9bbc7571b309` exists on `origin/main` with subject **"Merge pull request #35 from jon0471-dot/feat/m44-autonomous-decision-execution"** (written by GitHub at merge time).
- Parents verified: first parent `d11462eabf3c803e5d559f77d8ddfe112a131935` (the reported PR #35 base — itself the **PR #34 merge**, subject "Merge pull request #34 from jon0471-dot/feat/m44-autonomous-decision-execution"), second parent `e2497c51009974239abb0b42509da3f466784c5b` (the reported PR #35 head).
- This matches the owner's independently checked report exactly: head `e2497c5`, merge `4bfdfbe`, base `d11462e`.

## 3. The four reported M44 commits and ancestry

All four exist and are **ancestors of `origin/main`** (`git merge-base --is-ancestor`):

| Short | Full SHA | Ancestor of origin/main | Content (verified) |
| --- | --- | --- | --- |
| `bb8b445` | `bb8b445983fbb6213a5e25bef7c1a29d86e720e3` | YES | shared verified-action runner + all-product mission bridge |
| `7b8c842` | `7b8c8420228208fe69342b93f417a1e367a8c124` | YES | acceptance suite (part 1 of the m44.4/m44.5 pair) |
| `3947ae1` | `3947ae1f6631d100736e03bb1740606919c1905b` | YES | acceptance suite + report (parent of `e2497c5`) |
| `e2497c5` | `e2497c51009974239abb0b42509da3f466784c5b` | YES | M44 documentation set (docs(m44.5), M44 report tail) |

Linear chain verified: `3947ae1` is the parent of `e2497c5`; the M44 report inside `e2497c5` records the full implementation trail `0c9b4c0 → beb8ff2 → 89dd730 → c5f26dd → bb8b445 → 7b8c842 → 3947ae1`.

## 4. M44-to-main comparison

`git merge-base --is-ancestor e2497c5 origin/main` → YES. The M44 branch tip **is an ancestor of current main**; there are **zero branch-only M44 commits remaining**. The M44 branch is fully contained in `origin/main`. **Baseline rule satisfied: nothing was discarded, rewritten, cherry-picked or bypassed — the owner's PR #35 merge already brought all four outstanding commits into main.**

## 5. M41–M44 infrastructure state on `origin/main` (spot-verified)

- **M41 mission engine**: `src/lib/riishe/mission/` — `graph.ts`, `planner.ts`, `executor.ts`, `store.ts`, `safety.ts`, `verifiers.ts`, `handoff.ts`, `tools.ts`, `types.ts`.
- **M42 research gateway**: `src/lib/research/reach/` — `gateway.ts`, `adapter.ts`, `registry.ts`, `allowlist.ts`, `injection.ts`, `url-safety.ts`, `config.ts`.
- **M43 evidence engine**: `src/lib/riishe/claims.ts`, `src/lib/riishe/evidence-memory.ts` (+ research evidence plumbing).
- **M44 decision/execution layer** (extends the M41 module, no separate framework): `src/lib/riishe/mission/` gains `decision.ts`, `action-contract.ts`, `action-lifecycle.ts`, `action-runner.ts`, `authorization.ts`, `evidence-summary.ts`, `mission-bridge.ts`.
- **Trust Engine**: `src/lib/trust/` — `tasks.ts`, `approvals.ts`, `digest.ts`, `receipt.ts`, `checkpoints.ts`, `resume.ts`, `adapters/`.
- **M44 documentation on main**: `docs/M44-BASELINE-REPORT.md`, `docs/M44-IMPLEMENTATION-REPORT.md`, `docs/intelligence/M44-DECISION-EXECUTION-ARCHITECTURE.md`, `docs/intelligence/M44-AUTHORIZATION-AND-SAFETY.md`.
- **Test suite**: 235 `*.test.ts` files under `tests/` (unit + integration + fixtures + helpers), consistent with the M44 report's full-suite record (3176 pass / 0 fail / 10 skip across 235 files).

**M44 known-limitation pointers relevant to M45** (verified present in the docs on main):

- "a per-turn chat decision tool would need new two-key permission wiring in the orchestrator (recorded as future work, not hidden)" — `docs/M44-IMPLEMENTATION-REPORT.md` line ~186.
- "not yet exposed as a per-turn chat tool (that would need new permission-key wiring in the orchestrator's two-key pattern)" — `docs/intelligence/M44-AUTHORIZATION-AND-SAFETY.md` line ~147.
- Repository pushes / deployments / external communications are classified and approval-gated but have **NO real execution path yet** — the M44 runner refuses them honestly even with a granted approval. M45 Phase 3/4 build those real adapters; Phase 2 must implement the two-key wiring these notes call for. These are implementation-phase work items, **not baseline blockers**.

## 6. Worktree and local-state inspection (nothing cleaned, nothing discarded)

- **zcode-driver watchdog is ACTIVE** (verified via `ps`: `/app/zcode-driver/boot.sh start` + `/app/zcode-driver/main.mjs` running). Per `docs/HANDOFF.md` (M44 block): it force-checks out `main` on the PRIMARY worktree every few seconds; M44 ran in the linked worktree `m44-wt` (now gone — sandbox recycle). **M45 therefore runs in the linked worktree `m45-wt`.** The primary worktree is left exactly as found.
- **Primary worktree** `/home/z/my-project`: on local `main` at `01f39d75c67f7912bb532d159b8727ea78942da5`, working tree **clean** (`git status --porcelain` empty).
- **Local `main` divergence (documented, NOT modified)**: `main...origin/main` = 1 ahead / 76 behind; merge-base `eff0d96`. The 1 local-only commit `01f39d7` is an environment auto-commit (author `Z User <z@container>`, UUID subject, dated 2026-11-24) sweeping up 213 files (27,035 insertions): `.m41-stash/` working-tree backups, milestone docs/screenshots, `bun.lock`/config artifacts. Its real-content counterparts (M40/M41 mission engine, docs) are already integrated on `origin/main` through the merged milestone history; the commit is retained untouched on local `main`. M45 does **not** build on it.
- **`feat/m45-conversational-governed-execution` did not exist** locally or remotely before this session (verified both) — created fresh.
- **Other worktrees**: `/home/z/my-project/.m33-cg` (branch `feat/code-giftz-real-sandbox-execution` @ `8f7170c`) is **prunable** (its directory is missing post-recycle). Left as-is; no prune performed (minimum-touch).
- **Stash**: `stash@{0}` — "stale pre-M37 working tree + duplicate M36-M39 artifacts (safety net before sync to origin/main eff0d96)", self-labeled stale. Left as-is.
- **Untracked/uncommitted work at risk: none.** The working tree was clean before any M45 action; the M45 branch was created from `origin/main` without disturbing the primary worktree.

## 7. M45 branch status and starting point

- Branch `feat/m45-conversational-governed-execution` created in linked worktree `/home/z/my-project/m45-wt` from **verified `origin/main` = `4bfdfbe134da98c91ae13ba0aa2d9bbc7571b309`**.
- Starting HEAD: `4bfdfbe` (the PR #35 merge commit — the complete M44 baseline).
- No M45 implementation has been performed yet beyond this baseline report. Phases 1–10 follow only after this baseline is committed, pushed and remote-verified.
- Upstream note: initial `git worktree add -b` set the branch to track `origin/main`; the first push will use `-u origin feat/m45-conversational-governed-execution` to bind the correct upstream. No force-push will ever be used.

## 8. Remaining blockers

**None for the baseline.** The complete M44 baseline is safely established:

1. `origin/main` verified live at the reported PR #35 merge SHA.
2. All four outstanding M44 commits verified as merged ancestors of `origin/main`.
3. M41–M44 infrastructure verified present on `origin/main`.
4. No local work at risk; nothing modified, cleaned or reset.
5. Watchdog mitigation in place (`m45-wt` linked worktree, repo-precedented pattern).

Environment notes recorded honestly (not blockers):

- GitHub REST API is rate-limited from this sandbox egress IP (unauthenticated). Git-level verification was used instead and is sufficient. This may also constrain M45's repository-adapter live tests later; if a token is configured for the app at that point, it must never be exposed to model context or logs.
- `.m33-cg` worktree metadata is prunable; left untouched deliberately.
- DoD of this Phase-0 deliverable: this file committed + pushed to `feat/m45-conversational-governed-execution` + remote SHA independently verified (recorded in the commit that carries it).
