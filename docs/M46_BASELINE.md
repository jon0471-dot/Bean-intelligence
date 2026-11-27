# M46 BASELINE — Production Readiness & Verified Live Operations

> Milestone M46 · branch `feat/m46-production-readiness-live-operations` · recorded 2026-11-28 (UTC+8) · every SHA in this document was verified with local git commands and live `git ls-remote` against `github.com/jon0471-dot/Bean-intelligence`. Historical references in the milestone instruction were treated as unverified until re-derived from the remote.

## 1. Verified remote state (Phase 0)

| Item | Value | Verification |
| --- | --- | --- |
| `origin/main` | `50e1c7622b43acc531806e0b7f97aa21f42a6050` | `git rev-parse origin/main` after fresh fetch + live `git ls-remote refs/heads/main` |
| M45 final SHA | `83d9be1a6d5c61b3275943ca903360067e8ce11c` | live `git ls-remote refs/heads/feat/m45-conversational-governed-execution` |
| M45 PR | #37 | merge commit subject below |
| M45 merge commit | `50e1c76` = "Merge pull request #37 from jon0471-dot/feat/m45-conversational-governed-execution", parents `7ff0556` (first, main side) + `83d9be1` (second, branch tip), authored by `jon0471-dot <jon975824@gmail.com>` 2026-11-27 21:31:02 +0530 | `git log -1 --format=...` |
| Expected historical baseline | `50e1c76` — **confirmed current** | matches the milestone instruction exactly |

**Main-side history note:** between the M45 branch point (`4bfdfbe`, M44 baseline) and the PR #37 merge, main advanced by exactly one merge: `7ff0556` = "Merge pull request #36 from jon0471-dot/feat/m45-conversational-governed-execution", which merged the M45.0 baseline-doc commit `01fdac5` early. The owner therefore merged PR #36 (baseline doc only) and then PR #37 (the complete M45 branch). No unknown or unrelated commits exist on main.

**Ancestry:** `git merge-base --is-ancestor 83d9be1 origin/main` → **true**. The complete M45 work is contained in main.

**M46 branch existence:** neither `refs/heads/feat/m46-production-readiness-live-operations` (remote, checked via `git ls-remote`) nor the local branch existed before this milestone. Created in §4.

## 2. M45 commit trail (all inside main)

`git log 4bfdfbe..83d9be1` (branch-side commits, oldest first):

| SHA | Subject (abbreviated) |
| --- | --- |
| `01fdac5` | docs(m45.0): M45 baseline reconciliation |
| `deb5cdf` | feat(m45.1): conversational decision tool + two-key wiring |
| `0350e40` | feat(m45.2): real repository integration — narrowly scoped adapter behind the M44 gate |
| `9f9950e` | feat(m45.3): real deployment integration — typed inspection, honest unavailability |
| `b70c2f6` | feat(m45.4): conversational UX status views + 24-scenario acceptance suite |
| `83d9be1` | docs(m45.5): complete M45 documentation set + final verification evidence |

PR #37 delta vs its first parent: **29 files changed, +4,389 / −13** (verified `git diff --stat 7ff0556..50e1c76`). Nothing was rewritten, rebased or force-pushed; main moved only by owner merges.

## 3. Sandbox, worktrees and watchdog (Phase 0 items 1, 7)

| Item | State at M46 start |
| --- | --- |
| zcode-driver watchdog | **ACTIVE** — `/usr/bin/node /app/zcode-driver/main.mjs` observed running (PID 976, started via `/app/zcode-driver/boot.sh start`). The primary worktree is subject to forced checkout of `main`. All M46 work therefore runs in a linked worktree, following the M44 (`m44-wt`) / M45 (`m45-wt`) repository pattern. |
| Primary worktree `/home/z/my-project` | clean, on local `main` at `01f39d7` (the documented environment auto-commit: author `Z User <z@container>`, UUID subject, 213 files incl. `.m41-stash/` backups + milestone docs + `bun.lock`). **Left untouched**, exactly as recorded in M45_BASELINE.md — M46 does not build on it. |
| `m45-wt` | directory exists but **empty** — the M45 linked worktree metadata was lost in the sandbox recycle between sessions. Nothing to preserve; no M45 work was uncommitted (M45 branch tip is merged). |
| `.m33-cg` | still reported `prunable` by `git worktree list`. **Left untouched** (never prune foreign worktree state). |
| Uncommitted changes | none in the primary worktree (`git status --porcelain` empty). |

## 4. M46 working setup

- Branch `feat/m46-production-readiness-live-operations` created from **`origin/main` = `50e1c76`** (verified, not assumed).
- Linked worktree `/home/z/my-project/m46-wt` (same pattern as `m45-wt`; sidesteps the watchdog without fighting it).
- Dependencies installed in the worktree (`bun install`, 981 packages).
- **M46.0 commit:** recorded at the end of this document with remote verification.

## 5. M41–M45 capability inventory (verified in source, Phase 0 item 9)

Present in `m46-wt` and spot-verified (files exist, exports audited, tests present):

- **M41 mission engine** — `src/lib/riishe/mission/` (graph/planner/executor/store/safety/verifiers/handoff/tools/types).
- **M42 research gateway** — `src/lib/research/reach/` (gateway/adapter/registry/allowlist/injection/url-safety/config).
- **M43 evidence intelligence** — `src/lib/riishe/claims.ts`, `src/lib/riishe/evidence-memory.ts`.
- **M44 governed decisions** — `decision.ts`, `action-contract.ts`, `action-lifecycle.ts`, `action-runner.ts`, `authorization.ts`, `evidence-summary.ts`, `mission-bridge.ts`; Trust Engine `src/lib/trust/` (tasks/approvals/digest/receipt/checkpoints/resume/adapters).
- **M45 conversational governance** — `conversation-binding.ts`, `conversation-intent.ts`, `decision-evidence.ts`, `decision-tool.ts` (740 lines), `decision-tool-tool.ts`, `repository-adapter.ts` (592), `deployment-adapter.ts` (266), `action-status-view.ts`.
- **Test suite** — 244 `*.test.ts` files under `tests/` (M45 grew the suite from 235).
- **Prisma** — `ExecutionDecision` model at `prisma/schema.prisma:1001`, additive, indexes `(userId, conversationId)`, `(userId, status)`, `(trustTaskId)`.

## 6. M45 security-invariant audit (Phase 1) — results

Every invariant re-verified against actual source, not documentation:

| # | Invariant | Evidence location | Verdict |
| --- | --- | --- | --- |
| 1 | Server-derived conversational intent | `orchestrator.ts:781` stamps `turnIntent` from the real user message; `decision-tool-tool.ts:132` reads `ctx.turnIntent ?? classifyTurnIntent(ctx.userMessageText)` — never model tool input | **PRESERVED** |
| 2 | Advice-first behavior | `conversation-intent.ts` `INTENT_ALLOWED_OPERATIONS` (advice → only create/inspect); `decision-tool.ts:676` `guardOperation` throws before any state change | **PRESERVED** |
| 3 | Two-key authorization | route permission key `allowExecutionGovernance` (chat route `route.ts:274`) AND per-turn capability plan (`orchestrator.ts:554`); tool re-checks the key (`decision-tool-tool.ts:126`) | **PRESERVED** |
| 4 | Owner-only approval | `authorization.ts:193` `validateApprovalDecision` refuses non-owner decisions AND executor self-approval | **PRESERVED** |
| 5 | Digest-bound approval | `authorization.ts:77` `approvalDigest` over contract+plan; bind-recheck in `validateApprovalBinding` | **PRESERVED** |
| 6 | Stale approval rejection | acceptance S8 (requested / denied / consumed / expired → `not-granted`) | **PRESERVED** |
| 7 | Consume-once execution | `conversation-binding.ts` `TurnOperationLedger` (bounded, one-shot per binding+operation) + Trust approval consume-once | **PRESERVED** |
| 8 | Cross-user isolation | `validateBinding` user-mismatch refusal before any other check; S9 verifies no existence leak | **PRESERVED** |
| 9 | Delegated scope restrictions | `authorization.ts:161` `checkDelegation`; acceptance S21 | **PRESERVED** |
| 10 | Independent verification | `action-lifecycle.ts:55-56` — `VERIFYING` is the only edge into `SUCCEEDED`; failure edges FAILED / RECOVERY_REQUIRED / PARTIALLY_SUCCEEDED | **PRESERVED** |
| 11 | Audit integrity | `recordAudit` calls in both adapters; Trust receipts | **PRESERVED** |
| 12 | Structural prohibition `EXECUTING → SUCCEEDED` | `action-lifecycle.ts:79` explicitly rejects the sequence | **PRESERVED** |

**Audit finding (the one operational gap M46 targets):** M45's production-model walkthrough answered two governance-shaped requests advice-first without emitting a tool call. Root cause identified in source: tool invocation runs over a **text protocol** (`TOOL_CALL: {json}` lines parsed by regex in `toolloop.ts`), because the gateway adapter exposes plain chat completions (no native function calling). Whether the governed tool is invoked depends on (a) the tool catalog + protocol instructions reaching the model in the system prompt (`registry.ts describeTools`) and (b) the model's protocol compliance. There is **no tool-calling capability in the model registry** (`registry/models.ts` `ModelCapability` = chat/streaming/image/audio verbs only), so no honest per-provider capability distinction exists yet. This is Phase 2's (M46.1) primary target.

## 7. Acceptance-report accounting correction (Phase 1 requirement)

The M45 report (`docs/M45_IMPLEMENTATION_REPORT.md` §"Classification split") states **1 LIVE + 4 LOCAL-LIVE + 15 LOCAL-INT + 5 MOCKED + 2 MANUAL = 27**, while the same report states the suite is **24 scenarios (24/0 pass)**. Investigation against the actual test file `tests/integration/m45-acceptance.test.ts` (24 `test()` cases):

**Identity census of the real test file:**

| Classification | Test cases | Scenario identities |
| --- | --- | --- |
| LIVE | S10 | 1 |
| LOCAL-LIVE | S15, S17, S18 | 3 |
| LOCAL-INT | S1–S6, S8, S9, S11, S16, S21, S-UX (12 cases) + S19+S20 (one combined case, two identities) | 13 |
| MOCKED | S7, S12, S13, S14, S22 | 5 |
| MANUAL (note rows) | S23-note, S24-note | 2 |
| **Total** | **24 cases** | **24 identities (S19 and S20 are distinct scenarios sharing one test)** |

**Root cause of the 27:** the report's counts were taken from the doc table `docs/intelligence/M45-ACCEPTANCE.md` plus an extra LOCAL-LIVE row and extra LOCAL-INT rows that do not exist in the suite (LOCAL-LIVE claimed 4 vs 3 real; LOCAL-INT claimed 15 vs 13 real), i.e. **3 over-counted rows — a reporting mistake**, not overlapping categories. The doc table also folds scenarios 19 and 20 into one row ("19/20"), which hides one identity.

**Corrected canonical accounting (authoritative):** 24 unique scenarios = 1 LIVE + 3 LOCAL-LIVE + 13 LOCAL-INT + 5 MOCKED + 2 MANUAL. Sum = 24 = suite size. ✔ reconciles.

**Historical preservation:** the original M45 records are NOT rewritten. `docs/intelligence/M45-ACCEPTANCE.md` receives an appended, clearly marked reconciliation section (commit of this milestone), and `docs/M45_IMPLEMENTATION_REPORT.md` receives an appended correction note pointing at it. No historical pass/fail result is altered.

**Verification-vs-execution distinction (Phase 1):** every M45 scenario now carries exactly one of: *executed in the suite* (22 identities), *verified by separate suites* (S23 — the full regression ran as its own suite step), or *performed outside the suite* (S24 — the Preview walkthrough, manually recorded). Operations that remained unavailable (live PR creation against the owner repo, real staging deployment) stay MOCKED / honest-unavailable — unchanged.

## 8. Infrastructure discovery (Phase 0 item 10 — names only, no secret values)

| Area | Finding |
| --- | --- |
| GitHub credential path | repo-local git credential store (HANDOFF §0, account `jon0471-dot`, mode 0600, never committed) drives git push/pull. The **repository adapter** reads `GITHUB_TOKEN` from the server env for GitHub REST calls; absent token → unauthenticated public-repo reads with honest rate-limit reporting. **No token was displayed, exported or logged during this milestone.** |
| Repository allowlist | `BEAN_REPO_ALLOWLIST` env (comma-separated, max 8, owner-controlled); default `jon0471-dot/Bean-intelligence`. M46 Phase 4 requires an explicitly configured dedicated integration-test repo — none is configured today (`BEAN_TEST_REPOSITORY` does not exist yet). |
| Deployment shape | standalone Next.js build (`next build` → `.next/standalone/server.js`, started by `npm start` with `DATABASE_URL=file:…/db/custom.db`), reverse-proxied by **Caddy on `:81`** → `localhost:3000` with `XTransformPort` multi-port support (`Caddyfile` at repo root). Health endpoint `src/app/api/health/route.ts` (comprehensive adapter/product probes). Logging via `tee dev.log` / `tee server.log`. |
| Deployment provider env | `BEAN_DEPLOY_ROOT`, `BEAN_DEPLOY_BASE_URL`, `BEAN_DEPLOY_PROVIDER`, `BEAN_DEPLOY_TOKEN`, `BEAN_STAGING_DEPLOY_TOKEN`, `BEAN_PRODUCTION_DEPLOY_ENABLED` — **all absent today** → deployment history honestly unavailable; production refused outright (adapter enforces). |
| Database provider | **SQLite** (`prisma/schema.prisma` datasource `provider = "sqlite"`, `url = env("DATABASE_URL")`; production run uses `file:/home/z/my-project/db/custom.db`). **No `prisma/migrations/` directory exists** — schema management today is `prisma db push` (`db:push` script even carries `--accept-data-loss`). Phase 6 must establish a real additive migration path. |
| Operational patterns to extend (Phase 7) | retry/continuation (`src/lib/riishe/retry.ts`, `continuation.ts`), stream guards (`stream-config.ts`: idle/total/heartbeat env-tuned), circuit-breaker / reachability patterns (`adapters/gateway-reachability.ts`, `hosted-llm.ts`, `hosted-image.ts`, `hosted-video.ts`), rate-limit classification (orchestrator, repository-adapter, `sse-client.ts`), recovery (`mission/recovery.ts`), checkpoints/resume (Trust Engine). |
| Model/provider capability registry | `src/lib/registry/models.ts` (gateway models, truth policy, no tool-calling verb) + `src/lib/ai-engine/model-registry.ts` (engine routing) — the "existing provider capability registry" Phase 2 must extend. |

## 9. Outstanding limitations carried into M46 (from M45 records, re-checked)

1. **Live write lane:** repository adapter write ops (branch/commit/push/PR) are implemented + MOCKED-tested but never executed against GitHub (owner rule: no writes to the owner repo). Requires a dedicated integration repo + credential (Phase 4).
2. **Real staging deployment:** no `BEAN_DEPLOY_PROVIDER`/staging infra configured; M45 verified inspection + loopback health honestly, never a real deploy (Phase 5).
3. **Production migration:** `ExecutionDecision` schema reaches SQLite only via `db push`; no migration baseline exists (Phase 6).
4. **Model tool-calling reliability:** advice-first walkthrough gap documented in §6; no per-provider tool-calling capability signal (Phase 2).
5. **Unauthenticated GitHub rate limits:** live read-lane scenarios depend on api.github.com quota; git-level verification (`git ls-remote`) remains the quota-free fallback (used in Phase 0 here).

## 10. Blockers

None. The baseline is safe: main contains the complete M45 work, no outstanding M44/M45 branch-only commits, no local work at risk, watchdog handled by the linked-worktree pattern.

## 11. M46.0 publication record

| Item | Value |
| --- | --- |
| Commit | `docs(m46.0): M46 baseline reconciliation + M45 readiness audit …` (exact SHA recorded in the M46 implementation report) |
| Push | normal fast-forward to `feat/m46-production-readiness-live-operations` |
| Remote verification | `git ls-remote` performed after push; result recorded in the implementation report |
| Merge into main | **NOT performed** — requires separate owner authorization |
