# M48 BASELINE — LIVE OPERATIONS ACTIVATION & REAL-WORLD ACCEPTANCE

**Milestone:** M48 — LIVE OPERATIONS ACTIVATION & REAL-WORLD ACCEPTANCE
**Document status:** Phase 0 (M47 publication reconciliation) evidence record.
**M48 implementation gate: ~~PENDING~~ → COMPLETE (owner merged PR #41, #42, #43, #44; verified 2026-11-28 — see §5.1).**
**Written:** 2026-11-28 (Asia/Calcutta session time)
**M48.1 correction:** the current-state claims in this document were accurate at writing; the publication state has since advanced. Independently verified current state: PRs #41–#44 all MERGED, `origin/main` = `ed3ede98db7ca4ecea2ad66ae41f62942cad64e5`. See §5.1.

---

## 1. Purpose and scope

M48 activates BEAN Intelligence's existing governed execution capabilities against real, explicitly authorized systems. Before any M48 implementation, Phase 0 requires a mandatory reconciliation of the M47 publication state: PR #40 merged the M47 branch at `a57de848`, while the complete M47 feature branch ends at `a1ce6fa` — six commits further. This document records, with independent evidence, exactly what was found on the remote, what was prepared, and what owner action is required before M48 implementation may begin.

**Nothing in this document constitutes M48 implementation.** The only artifact delivered on the M48 branch at this stage is this reconciliation record.

---

## 2. Verified remote state (Phase 0 reconciliation evidence)

All SHAs below were verified in this session (2026-11-28) via `git fetch origin --prune`, `git ls-remote`, and authenticated GitHub API reads. Historical references were treated as claims, not facts, and re-measured.

### 2.1 Primary refs

| Ref | Verified SHA | Meaning |
|---|---|---|
| `origin/main` | `82fd02832f6f5c82ba1d76f02a2ec1ea2295a6ac` | PR #40 merge commit — current remote main |
| `refs/pull/40/head` | `a57de848e20abe9b9d10476d499471393246f51a` | PR #40 merged the M47 branch at this SHA |
| `feat/m47-native-tool-operations-activation` (remote) | `a1ce6fabd247fcd154b12ee5e30e583235fc502b` | Complete M47 branch tip — **exactly `a1ce6fa`, not advanced** |
| `refs/pull/41/head` | `a1ce6fabd247fcd154b12ee5e30e583235fc502b` | Follow-up PR created this session (see §4) |
| `refs/pull/39/head` | `c881430e6505…` | Matches the documented M46 final SHA — history consistent |
| `refs/heads/feat/m48-live-operations-activation` | *(did not exist before this session)* | Confirmed absent via `ls-remote refs/heads/*` |

### 2.2 PR #40 merge state — verified merged

- `origin/main` **is** the PR #40 merge commit `82fd028` ("Merge pull request #40 from jon0471-dot/feat/m47-native-tool-operations-activation").
- Parents verified byte-exact: parent 1 = `0e3dcbf95a817fa050f3f8c1c503cd979c62da7d` (the M46 main), parent 2 = `a57de848e20abe9b9d10476d499471393246f51a` (the PR #40 head).
- `git merge-base --is-ancestor a57de848 82fd028` → true. PR #40's content is fully in main.

### 2.3 The six branch-only M47 commits

`git rev-list --count a57de848..a1ce6fa` = **6**; `git merge-base origin/feat/m47-native-tool-operations-activation origin/main` = `a57de848` — i.e. the branch is exactly 6 ahead / 1 behind (the merge commit), matching the pre-session independent inspection. Every commit was inspected (`git show`, `git diff-tree --name-status`):

| # | SHA | Subject | Changed files | Assessment |
|---|---|---|---|---|
| 1 | `95620d9b6bb8…` | fix(m47.2): correct the tsc record + 6 test-only type errors | `tests/unit/m47-native-execution.test.ts` | M47 delivery (test-only correction) |
| 2 | `9b359633ceb5…` | feat(m47.3): per-turn conversational invocation records — full observability field set, decision-operation visibility, honest fallback records | `src/lib/riishe/orchestrator.ts`, `tool-invocation.ts`, `toolloop.ts` + test | M47 delivery (Phase 3) |
| 3 | `dc0283957791…` | feat(m47.4): secure GitHub credential activation — real readiness evidence, honest-unavailable live lane | `docs/M47_BASELINE.md`, `scripts/m47-github-readiness.ts` | M47 delivery (Phase 4) |
| 4 | `7b91cc6a39a7…` | feat(m47.5): real staging deployment activation — refreshed LOCAL-LIVE proof, honest-unavailable live lanes | `scripts/m47-staging-readiness.ts` | M47 delivery (Phase 6) |
| 5 | `abb103de1c54…` | feat(m47.6): uniquely-identified M47 acceptance suite — 13 scenarios, each classified once | `tests/unit/m47-acceptance.test.ts` | M47 delivery (Phase 9) |
| 6 | `a1ce6fabd247…` | docs(m47.7): complete M47 documentation set + final verification evidence | 12 documentation files (HANDOFF + M47 report + 8 intelligence docs + worklog) | M47 delivery (Phase 11) |

**All six commits are intended M47 delivery work.** No commit touches unrelated subsystems; no commit weakens authorization, governance or security invariants.

### 2.4 Duplicate-representation checks

- **Patch-id equivalence:** for each of the six commits, `git show | git patch-id --stable` was compared against every commit on `origin/main` — **no match** for any of the six. The six commits are *not* already represented by equivalent later commits on main.
- **PR scan:** `git ls-remote origin 'refs/pull/*/head'` enumerates every PR ref. The highest is `#40` (head `a57de848`). **No PR #41 existed** and zero open PRs existed (authenticated API: `state=open` → 0) before this session's action. No owner-created PR already contains the six commits.

---

## 3. Repository / environment observations

- **Worktrees (watchdog-aware setup):** primary worktree `/home/z/my-project` is watchdog-controlled and pinned to `main`; M47 worked in linked worktree `m47-wt` (at `a1ce6fa`, clean); this milestone created linked worktree `m48-wt` at `/home/z/my-project/m48-wt` on `feat/m48-live-operations-activation`.
- **Local `main` divergence (environment artifact, not owner work):** the sandbox watchdog auto-created two local-only commits on `main` (`01f39d7`, `984300f` — UUID subjects, authored `Z User <z@container>`, touching only the `m47-wt` gitlink). These are **local-only**, never pushed, and `origin/main` is unaffected and clean. Left untouched deliberately; the remote is authoritative.
- **`/tmp/m46-pristine`** reference worktree at `82fd028` (detached) remains available for pre-existing-vs-new comparisons.
- **GitHub API rate limit:** the unauthenticated quota for this sandbox IP was exhausted during reconciliation; all reads were completed via the git protocol (`fetch` / `ls-remote`) and an authenticated API session. No secret value was read, printed, or logged at any point; the stored credential was used only in-memory via `git credential fill`.

---

## 4. Follow-up PR — created and independently verified

The six M47 commits remained branch-only, so per the Phase 0 mandate a normal review PR was prepared:

| Field | Value |
|---|---|
| **PR** | **#41** — https://github.com/jon0471-dot/Bean-intelligence/pull/41 |
| **Title** | feat(m47): complete the M47 delivery — remaining M47.2 fix through M47.7 (invocation records, credential & staging activation, acceptance suite, documentation) |
| **Head** | `a1ce6fabd247fcd154b12ee5e30e583235fc502b` (`feat/m47-native-tool-operations-activation`) |
| **Base** | `82fd02832f6f5c82ba1d76f02a2ec1ea2295a6ac` (`main`) |
| **Commits** | exactly 6: `95620d9` → `9b35963` → `dc02839` → `7b91cc6` → `abb103d` → `a1ce6fa` (unchanged, no rewrites) |
| **Changed files** | 20 (API-reported) |
| **State at writing** | open, not merged — **since MERGED by the owner (merge commit `683ffc40132b94db0d57c34ef5a7fad88869087d`, 2026-11-28T02:45:31Z); verified via authenticated API — see §5.1** |
| **Verification channels** | (1) git protocol: `refs/pull/41/head` = `a1ce6fa…`; (2) authenticated API re-read: number 41, state open, merged false, head/base/commits as above |

Duplicate-avoidance check ran before creation (0 open PRs; no `feat/m47-*` head PR). No merge was performed and none will be — **the owner retains all merge authority.**

---

## 5. M48 implementation gate — PENDING

Per the M48 mandate, M48 implementation must not begin until the owner merges the complete M47 delivery into main.

**Owner action required: review and merge PR #41** (https://github.com/jon0471-dot/Bean-intelligence/pull/41).

After owner merge, the post-gate sequence will be executed and recorded here:

1. `git fetch origin --prune`.
2. Verify `a1ce6fa` (final M47 commit) is an ancestor of `origin/main`.
3. Verify no M47 delivery changes remain outstanding (`rev-list` / `diff` checks between the M47 branch tip and main).
4. Record the exact final M48 starting SHA below.
5. Resume M48 implementation from the complete, verified `origin/main`.

| Field | Value |
|---|---|
| Current verified `origin/main` (pre-gate) | `82fd02832f6f5c82ba1d76f02a2ec1ea2295a6ac` |
| M48 working branch | `feat/m48-live-operations-activation` — created from the verified `origin/main` above; currently carries **only this reconciliation document** |
| **Final M48 starting SHA** | **TO BE RECORDED after owner merge of PR #41** (post-merge `origin/main`) → **RECORDED 2026-11-28: `ed3ede98db7ca4ecea2ad66ae41f62942cad64e5` — see §5.1** |

Deliberately **not** done: stacking any M48 implementation on this branch; creating an M48 PR; merging PR #41; rebasing or rewriting the M47 branch.

### 5.1 Post-gate verification — recorded 2026-11-28 (M48.1 session, independently verified)

The owner executed the gate. Each step of the promised post-gate sequence was then performed and verified:

1. `git fetch --all --prune` → `origin/main` advanced `82fd028` → `ed3ede98db7ca4ecea2ad66ae41f62942cad64e5`.
2. Ancestor checks (`git merge-base --is-ancestor`): `a1ce6fa` (final M47 commit) ✓ ancestor of main; `4cc1e92` (this document's commit, merged via PR #42 = `bafc9aa`) ✓ ancestor of main; `5bfb896` (P0 final tip) ✓ ancestor of main.
3. PR states via authenticated GitHub API (historical claims re-measured): **PR #41 MERGED** (merge commit `683ffc40132b94db0d57c34ef5a7fad88869087d`, head `a1ce6fa` — the six M47 commits); **PR #42 MERGED** (merge commit `bafc9aa2d2a7a57f5d4e74c91acaa5848efdd5fc`, head `4cc1e92` — this document); **PR #43 MERGED** (merge commit `ae0d06c3154c7a1ebf90b0c84461ac97acf9e655`, head `457d9f0` — P0 hotfix publication); **PR #44 MERGED** (merge commit `ed3ede9…` = current main, head `5bfb896` — the P0 reliability implementation). All four closed/merged, none open.
4. No M47 or P0 delivery commits remain outside main: the M47 branch tip and the P0 branch tip are both ancestors of `ed3ede9`.
5. **Final M48 starting SHA: `ed3ede98db7ca4ecea2ad66ae41f62942cad64e5`** (merge of PR #44; parents `ae0d06c3154c7a1ebf90b0c84461ac97acf9e655` + `5bfb8965898a0eb62cf7dad712397f96a0afe597`). All M48 implementation work starts from this SHA.
6. `feat/m48-live-operations-activation` was NOT reset, rewritten or moved — it remains at `4cc1e92` as merged history.

---

## 6. Infrastructure readiness carry-forward (to be re-verified in M48.1)

The following is M47's recorded operational state, carried forward as *claims to re-measure*, not facts to assume. Phase 1 of M48 re-verifies every item directly in source and runtime.

### 6.1 GitHub write lane (M47.4 recorded state)

- Adapter: existing typed M45/M46/M47 repository adapter; **no second GitHub integration** will be built.
- Environment contract (verify in source before use): `GITHUB_TOKEN` + `BEAN_TEST_REPOSITORY`; the test repository must be a **designated, isolated integration-test repository**, explicitly allowlisted. `jon0471-dot/Bean-intelligence` is **never** treated as disposable or write-acceptable.
- M47 runtime finding: both variables **unset** in the sandbox runtime → live write lane `HONEST-UNAVAILABLE`, never simulated.
- This session found a repository-scoped credential in the sandbox's git credential store (used only for branch push/PR creation above, value never exposed). **This is the sandbox's own operational credential — it is NOT a substitute for the BEAN application's configured `GITHUB_TOKEN`/`BEAN_TEST_REPOSITORY` lane**, and M48 Phase 1 will evaluate readiness of the actual application lane independently and honestly.

### 6.2 Staging lane (M47.5 recorded state)

- Adapter: existing M46/M47 deployment adapter; environment names to re-verify in source: `BEAN_STAGING_ROOT`, `BEAN_STAGING_BASE_URL`, `BEAN_STAGING_DEPLOY_TOKEN`, `BEAN_DEPLOY_PROVIDER`, `BEAN_DEPLOY_TOKEN`.
- M47 recorded a refreshed **LOCAL-LIVE** staging proof (isolated root, real process, real HTTP health) with external staging `HONEST-UNAVAILABLE`.
- M48 Phase 4 re-measures; local loopback is never reported as external LIVE deployment.

### 6.3 Provider tool-calling lane (M47.1/M47.2 recorded state)

- Hosted lane `bean-llm-hosted-primary`: measured **native** tool calling, **buffered-only** (`streamingToolCalls=false` — measured hard constraint; never promoted without new measured evidence).
- `openai-compatible` / `anthropic` / `llamacpp`: **unknown** + text protocol (never advertised native from unmeasured state).
- Registry is authoritative for runtime protocol selection; M48 must preserve the five evidence states and the measured constraints.

---

## 7. Regression baselines (historical M47 figures — re-measure fresh in M48 Phase 9)

| Check | M47 reported (historical, not assumed current) |
|---|---|
| Test suite | **244 test files** (239 unit + 5 integration), per-file hermetic strategy: **3,322 pass / 0 fail / 10 skip** |
| TypeScript | **234 errors** = fresh-measured M47 baseline (exact per-file:line parity vs pristine M46+5-environment note); M48 rule: measure fresh, report exact deltas, add zero |
| ESLint | clean on all touched files |
| Production build | successful |
| Known issue | batched multi-file test runs reproduce a pre-existing `mock.module` cross-file interference (documented, proven pre-existing on the pristine merge tree); hermetic per-file strategy remains the evidence standard |

M48 will re-measure all baselines before implementation and report actual deltas. Existing errors are never hidden; tests are never removed or weakened for green results.

---

## 8. M48 milestone plan (post-gate)

| Milestone | Scope |
|---|---|
| M48.1 | GitHub credential & repository readiness (readiness matrix, honest classification) |
| M48.2 | Real repository write workflow (branch/artifact/commit/push/PR with independent verification) |
| M48.3 | Real staging deployment + independent verification (isolated scope enforced) |
| M48.4 | Conversational-to-execution end-to-end acceptance (Workflows A/B/C via RIISHE + native tool calling) |
| M48.5 | Operational failure recovery + security/adversarial testing |
| M48.6 | Desktop/mobile Preview verification + manual acceptance checklist |
| M48.7 | Full regression, documentation, final publication report |

Each milestone: implemented + tested + committed + pushed + independently remote-SHA-verified. Fast-forward pushes only; no force-push ever; missing external credentials are recorded `HONEST_UNAVAILABLE` with the exact owner-side requirement, and work continues on everything that does not depend on them.

---

## 9. Phase 0 verdict

> M48.1 update (2026-11-28): the PENDING gate below was the state at writing and is now **COMPLETE** — see §5.1 for the independently verified post-gate record.

- M47 publication reconciliation: **complete** (§2–§4).
- Follow-up PR #41: **created, verified, awaiting owner merge** (§4) → **MERGED by the owner, verified (§5.1)**.
- M48 implementation gate: ~~**PENDING — owner action required**~~ → **COMPLETE** (§5.1).
- No M48 implementation has been started. No main writes, no merges, no force-pushes, no cleanup of any branch/artifact/PR.
