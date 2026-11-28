# M48.1 — GITHUB CREDENTIAL, REPOSITORY READINESS & PUBLICATION RECONCILIATION

**Milestone:** M48.1
**Branch:** `feat/m48-1-github-readiness` (linked worktree `m48-1-wt`)
**Written:** 2026-11-28 (Asia/Calcutta session time)
**Rule honored:** the GitHub write lane is never declared ready from environment-variable presence — readiness matches the actual execution policy, function for function.

---

## 1. Exact starting state (independently verified)

| Fact | Verified value |
|---|---|
| `origin/main` at branch creation | `ed3ede98db7ca4ecea2ad66ae41f62942cad64e5` (merge of PR #44; parents `ae0d06c` + `5bfb896`) — verified via `git fetch --all --prune`, `git ls-remote`, authenticated API |
| PR #41 (M47 completion) | MERGED — merge commit `683ffc40132b94db0d57c34ef5a7fad88869087d`, head `a1ce6fabd247fcd154b12ee5e30e583235fc502b` |
| PR #42 (M48 baseline doc) | MERGED — merge commit `bafc9aa2d2a7a57f5d4e74c91acaa5848efdd5fc`, head `4cc1e92` |
| PR #43 (P0 publication) | MERGED — merge commit `ae0d06c3154c7a1ebf90b0c84461ac97acf9e655`, head `457d9f0` |
| PR #44 (P0 implementation) | MERGED — merge commit = `ed3ede9`, head `5bfb8965898a0eb62cf7dad712397f96a0afe597` |
| M47 final SHA ancestry | `a1ce6fa` — ancestor of main (`git merge-base --is-ancestor`) |
| P0 final SHA ancestry | `5bfb896` — ancestor of main (`git merge-base --is-ancestor`) |
| M48 implementation gate | **COMPLETE** |
| Worktree | `m48-1-wt` created from the verified `ed3ede9`; `feat/m48-live-operations-activation` untouched at `4cc1e92` |

**OBSERVED owner action mid-session (recorded, not performed by this session):** the owner created and merged **PR #45** (head `15462a2` = this branch's first documentation commit → base `main`), advancing main to `b3bcfa2538b9c47aaae7eae93c461978f65076e1` (parents `ed3ede9` + `15462a2`), merged 2026-11-28T04:28:17Z. All later M48.1 work continues on the same branch on top of `15462a2`; the branch was ordinary-merged with `origin/main` before the final push (fast-forward-compatible, no rewrites). "Current main" facts below are stamped with the SHA they were measured against.

---

## 2. Merged-state documentation corrections (Phase 0.1)

Delivered in commit `15462a2` (merged by the owner as PR #45):

| Document | Correction |
|---|---|
| `docs/M48_BASELINE.md` | Gate status line corrected PENDING → **COMPLETE**; the promised post-gate sequence executed and recorded (§5.1) with every PR merge SHA; "Final M48 starting SHA" recorded = `ed3ede9`; historical Phase-0 sections preserved as written |
| `docs/HANDOFF.md` | New addendum **0.b** records the verified merged state (PRs #41–#44, merge SHAs, ancestry proofs, gate complete) and supersedes the publication claims in 0.a (preserved as accurate-at-writing history); "Last updated" bumped |
| `docs/P0-RIISHE-RELIABILITY-REPORT.md` | §6 acceptance totals corrected; §8 limitation 1 marked RESOLVED; new §9 publication reconciliation with the full SHA evidence table |
| `docs/intelligence/P0-ACCEPTANCE.md` | Every one of the 54 rows re-evaluated individually; exactly ONE primary classification each; revision note added |

### P0 acceptance reclassification (the 54-scenario correction)

The original publication stated "LIVE 12" while **enumerating 13 LIVE scenario IDs**, and four B-scenarios carried dual classifications (`LIVE (M47) + LOCAL-INT`), with D34 dual-classified (`LOCAL-INT + HONEST_UNAVAILABLE`). Resolution, derived row-by-row from the recorded evidence:

- **B11, B12, B14, B15 → LOCAL-INT** (exclusive): the "LIVE (M47)" components are historical M47-window measurements; per the counting rule, historical evidence remains in the evidence column and never creates a second classification. The loop contracts are pinned on this tree by `m47-native-execution` + `m47-acceptance`.
- **D34 → HONEST_UNAVAILABLE** (exclusive): classified by its live leg (no WebGPU/dedicated-GPU model in the headless environment, owner-verifiable); the 11-case policy matrix stays cited as supporting evidence, not a second count.
- **Corrected exclusive distribution: LIVE 13** (A1, A3, A4, A5, A6, A9, A10, C20, D29, D38, E44, F53, F54) **· LOCAL-INT 40 · HONEST_UNAVAILABLE 1 = 54** — machine-verified: every row parses to exactly one classification, and 13+40+1 = 54.

---

## 3. The one authoritative readiness decision (Phase 2 fix)

**Source-level problem confirmed:** `writeLaneAvailability()` checked (1) `GITHUB_TOKEN` presence and (2) `BEAN_TEST_REPOSITORY` presence, while every write operation separately runs `checkRepoPolicy()` against `BEAN_REPO_ALLOWLIST` (default `jon0471-dot/Bean-intelligence`). A separately configured integration repository missing from an explicit allowlist was reported **ready** and then refused by the real policy gate — readiness and execution disagreed.

**Fix (no second adapter, no duplicated policy):**

1. `repository-adapter.ts` — `writeLaneAvailability()` is now the static projection of the authoritative decision: it runs the **real** `checkRepoPolicy()` on the resolved integration repository (the same function every write runs) and refuses the production repository (new named export `PRODUCTION_REPOSITORY = 'jon0471-dot/Bean-intelligence'`) even when explicitly configured as `BEAN_TEST_REPOSITORY`.
2. `credential-diagnostics.ts` — new **`assessGitHubWriteReadiness()`**: the ONE authoritative decision composing that projection with live credential probes through the existing diagnostic transport. Eight required facts, each individually `ok` / `not-ok` / `unknown`; **any `unknown` ⇒ not ready**; rate limits stay honest unavailability (never auth-invalid); public read never implies write; token expiration is never invented; the credential value can never reach any field (same seam discipline as M46).
3. `scripts/m47-github-readiness.ts` — prints the full matrix.
4. Diagnostic and execution path share repository resolution and policy functions by construction — nothing is duplicated in a second module.

### The exact readiness matrix (this deployment, as-run)

Measured against `origin/main` history through this branch; run output from `bun scripts/m47-github-readiness.ts` (as-deployed environment):

| # | Fact (fixed report order) | State | Note |
|---|---|---|---|
| 1 | credential-configured | **not-ok** | `GITHUB_TOKEN` absent from the BEAN application runtime — writes honestly unavailable, never simulated |
| 2 | dedicated-integration-repository | **not-ok** | `BEAN_TEST_REPOSITORY` unset — no target configured, nothing defaulted |
| 3 | allowlist-includes-integration-repository | **unknown** | cannot be established without a configured integration repository (unknown ⇒ not ready) |
| 4 | production-repository-protected | **ok** | production repo is not the write target |
| 5 | feature-branch-policy-permits | **ok** | `checkWriteBranchPolicy` accepts feature branches, refuses protected names (same function writes run) |
| 6 | github-authentication | **unknown** | nothing to authenticate in the app runtime (see §4 for the sandbox-credential exhibit) |
| 7 | integration-repository-accessible | **unknown** | no target configured |
| 8 | write-permission-reported | **unknown** | no target configured; public read never implies write |

**Verdict: NOT READY — `HONEST-NOT-READY` as deployed.** Failing: credential-configured, dedicated-integration-repository; unverified: allowlist-includes-integration-repository, github-authentication, integration-repository-accessible, write-permission-reported (unknown is not ready).

---

## 4. Actual credential validation (Phase 3, read-only)

**As-deployed (the BEAN application runtime):** `diagnoseGitHubCredential()` → `state=not-configured`, category `not-configured`, public-read fallback true. This is the lane the readiness decision scores, and it is honestly not ready.

**Exhibit (the sandbox's own operational git credential — NOT the BEAN application lane; used for authenticated READS ONLY, value never displayed):** `GET /user` → 200, login `jon0471-dot` — authentication works, credential owner identity confirmed. Authenticated core rate limit at check time: 4970/5000 remaining (quota state is quota, never an auth verdict). **This exhibit proves the diagnostic vocabulary end-to-end; it does not configure the application lane and is not counted as application readiness.**

**Expiration disclosure:** the GitHub REST surface used (`/user`, `/repos/*`, `/rate_limit`, `/branches/*/protection`) exposes **no** token-expiration field — reported NOT-DISCLOSED-BY-PROVIDER, never invented. A later 401 is classified `auth-invalid`, never guessed.

---

## 5. Actual repository permission result (Phase 5, read-only live acceptance)

All checks were READ-ONLY: zero writes, zero branch operations, zero PR creation, zero cleanup (those belong to M48.2).

| Check | Result |
|---|---|
| Unauthenticated public read | 403 — unauthenticated IP quota exhausted: honestly classified as rate-limit unavailability, NOT a repository failure |
| Authenticated identity | 200 — `jon0471-dot` (exhibit credential, §4) |
| Production repository `jon0471-dot/Bean-intelligence` | accessible, public, default branch `main` |
| GitHub-reported permission flags (production repo, exhibit credential) | **pull=true, push=true, admin=true, maintain=true** — the provider's own least-privilege report |
| Dedicated integration repository | **none exists**: candidates `integration-sandbox`, `bean-integration-sandbox`, `bean-write-lane-sandbox` all 404 — the disposable repository is an owner-side requirement (§7) |
| Invalid repository handling | honest 404 ("does not exist or is not visible"), never fabricated |
| Rate-limit classification | 403 + rate-limit message ⇒ honest unavailability; distinguished from `auth-invalid` in code and pinned by tests |
| Protected-branch restriction probe (`main`) | protection endpoint 404 — no protection viewable (either none configured or the view requires admin scope); **recorded without guessing**: this does NOT mean pushes are unrestricted, and the adapter's client-side protected-branch policy remains the active structural guard |
| Public read ≠ write | pinned: a public repository's readability never satisfies the write-permission fact (`permissions.push` must be GitHub-reported true) |

---

## 6. Allowlist and integration-repository validation

- Default `BEAN_REPO_ALLOWLIST` = `jon0471-dot/Bean-intelligence` (production) — correct as a READ allowlist; it contains **no** disposable write target.
- `BEAN_TEST_REPOSITORY` unset — nothing defaulted, nothing auto-created (mandate: no repository creation without explicit owner authorization).
- The readiness decision now refuses `available: true` whenever `checkRepoPolicy` would reject the target — pinned by tests (scenario 11: allowlist omission ⇒ readiness not-ready AND the actual write refused pre-network with `repo-not-allowlisted`, zero network calls; scenario 13: production repo as test target refused even though the default allowlist contains it; scenario 16: projection-policy agreement in BOTH directions).

---

## 7. Owner-side configuration requirements (Phase 4 — the exact secure path)

The write lane becomes ready only when ALL of the following hold in the **BEAN application deployment environment** (the same secure channel that carries `DATABASE_URL` — never through chat, never in the repository, never in logs):

1. **Credential:** a least-privilege fine-grained personal access token (or repository-scoped GitHub App installation) limited to the dedicated integration repository; permissions: **Contents read/write + Pull requests read/write**; nothing organization-wide. Set as `GITHUB_TOKEN`.
2. **Dedicated disposable repository:** the owner creates it manually (e.g. `jon0471-dot/bean-integration-sandbox`). **No repository is created automatically by this milestone.**
3. **`BEAN_TEST_REPOSITORY`** set to that repository (`owner/bean-integration-sandbox`).
4. **`BEAN_REPO_ALLOWLIST`** configured to include that repository (production may remain in the list for reads; the readiness decision protects production from ever becoming the write target regardless).
5. Restart the deployment; run `bun scripts/m47-github-readiness.ts` — the matrix must print `verdict=ready` with all eight facts `ok` before M48.2 runs any authorized write.

Until then the lane is `HONEST-NOT-READY` and everything not depending on it keeps working (all read lanes, diagnostics, tests).

---

## 8. Tests executed and results (Phase 6 + Phase 7)

| Suite / check | Result |
|---|---|
| **NEW** `tests/unit/m48-1-github-write-readiness.test.ts` — the 17 required scenarios (credential absent / valid / invalid / rate-limited / network-unavailable; integration repo missing / malformed / inaccessible; read-not-write permission; write permission reported; allowlist missing / explicit; production target refused; protected branch rejected; feature branch accepted; projection-policy agreement both directions; secret-leak prevention) + honest-environment projection + LIVE read-only ls-remote probe | **19 pass / 0 fail** |
| M45/M46 repository-adapter + write-lane + credential-diagnostics suites | 47 pass / 0 fail |
| M45 decision governance (per-file hermetic standard) | 23 pass / 0 fail |
| M47 acceptance + native execution + tool-calling registry | green (in census) |
| M44 approval/execution governance + P0 RIISHE reliability suites | green (in census) |
| **Full hermetic per-file census** (every file in its own process; batched runs reproduce the documented pre-existing `mock.module` cross-file interference — proven pre-existing on the pristine base in this session) | **248 files → 3,374 pass / 0 fail / 10 skip** (P0 record 3,355/0/10 @247 + exactly the 19 new M48.1 cases — arithmetic exact) |
| TypeScript (fresh measurement, this environment) | apples-to-apples delta at identical dependency/generated-artifact state: pristine main **236** vs M48.1 tree **209** — the repair removes the TS2307 + 26 poisoned downstream errors (−27); after the production build generates route types the tree measures **189** (further pre-existing errors resolve; `next build` itself exits 0). **Zero TS errors in every M48.1-touched file** (verified on the final tree) |
| ESLint | 0 problems in all 10 touched files; the pre-existing full-project findings are untouched (no unrelated refactoring) |
| Production build | **exit 0** (`prisma generate` before `next build` — the documented operator step for fresh bun installs) |
| Pinned runtime asset | `minilm-l6-embeddings/vocab.txt` restored byte-identical (SHA-256 `07eced375cec…` — exactly the P0-pinned hash); tokenizer suite 7/0 |

---

## 9. Delivery-integrity repair discovered by this milestone

**Finding:** P0 commit `aabefac` (R3) delivered its dependents and its 11-case test suite **without the module they import**: `src/lib/riishe/local-fallback.ts` was silently skipped by `git add` because the bare `local-*` rule in `.gitignore` matches it — the **fourth occurrence** of this documented bug class (three prior incidents are recorded in `.gitignore` comments from earlier milestones). `main` has been type-broken since PR #44 (TS2307 + 26 downstream inference errors = 27), invisible to the P0 session because its worktree had the untracked file on disk — its census and build measurements were real but measured a tree that was never fully committed.

**Repair (commit `081125e`, two files, minimal):** the module restored **byte-identical** from the P0 worktree (sha256 `5a58aac2a36776c9883a0adc339c76f9b5c852df65cb191ee5dd07511d5b6dc1`) — the pure eligibility contract exactly as `aabefac` describes — plus the established `.gitignore` negation `!src/lib/riishe/local-fallback.ts` with the incident record. Verified: `p0-local-fallback` 11/0; census 3,374/0/10; build exit 0.

**Honest note on P0 evidence:** the P0 acceptance rows D34–D37 and the report's census/build claims were accurate measurements of the P0 worktree; the defect was publication (a missed `git add`), not fabrication — but this milestone's fresh-tree re-measurement is what exposed it, which is exactly why fresh verification is mandatory.

---

## 10. Security and secret scan (Phase 7)

- No undeclared token/key patterns in the branch diff (the two declared fake test constants — M46's and M48.1's — are whitelisted by name; they exist so leak tests can bite).
- The real sandbox credential value verified **absent** from the entire branch diff (checked programmatically; the value was never printed, logged or stored in any output).
- No sensitive runtime paths touched (no `.env`, DBs, cookies, sessions).
- No dependency changes (`package.json` + `bun.lock` untouched — no new dependencies).
- Diagnostics leak discipline re-pinned: scenario 17 (M48.1) + the M46 leak case — a token-shaped string can never reach any diagnostic/readiness field.
- Scan verdict: **PASS**.

---

## 11. M48.2 handoff — what is now ready

The codebase is ready for M48.2's authorized isolated repository operations (feature-branch creation, artifact publication, commit, fast-forward push, independent remote SHA verification, PR creation — **no automatic merge, no production writes, no cleanup**):

- `assessGitHubWriteReadiness()` must print `verdict=ready` (all eight facts `ok`) after the owner completes §7; M48.2 gates its live lane on exactly that decision — the same function, no re-implementation.
- The adapter's write workflow (inspect → branch → commit → read-back → fast-forward → PR, each independently verified) is transport-tested end-to-end (M46.3 suite) and policy-aligned with the readiness projection (M48.1 suite, both directions).
- Missing prerequisites are reported `HONEST-NOT-READY` with the exact owner-side requirement — never simulated, never assumed.

## 12. Publication record

| Field | Value |
|---|---|
| Branch | `feat/m48-1-github-readiness` (only this branch was written; no direct main pushes; no merges performed by the session) |
| Commits | `15462a2` docs reconciliation (merged by owner as PR #45) → `6dc625f` readiness decision → `081125e` delivery repair → final report commit (SHA recorded in the commit message of this file's delivery) |
| Final SHA + remote verification | recorded at push time in the final commit and verified via `git ls-remote` (log preserved in the delivery commit) |
| Review PR | created after verification and remote SHA confirmation; **owner retains all merge authority** |
