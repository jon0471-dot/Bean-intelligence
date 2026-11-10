# CODE GIFTZ — W1–W5 FINAL CLOSURE REPORT

**Work order:** W1–W5 FINAL CLOSURE (Tasks A–G) · **Report date:** 2026-11-04 (all timestamps UTC)
**Head:** `a81565c` (closure) on top of `05d51c8` (W5 delivery) · **Decision: B — READY WITH EXPLICIT BLOCKERS**
**Status vocabulary (only these):** PASS · PARTIAL · BLOCKED · FAIL · NOT VERIFIED

---

## 1. Executive Summary & Final Decision

All seven closure tasks were executed against the real codebase, real isolated environments and, where the upstream gateway permitted, real live traffic. Four tasks closed PASS (B, C, F, G), two closed PARTIAL with precisely documented external blockers (A, D), one is NOT VERIFIED with its runner ready (E). Five genuine defects were found by the closure verification itself and fixed (Section 10) — none of the fixes regressed the test baseline.

**Final gate state (re-run this session, 08:03–08:07 UTC):** Bun **951 pass / 0 fail / 60 files**, ESLint **0**, tsc **11 pre-existing errors all in `scripts/`** (zero in `src/`/`tests/`/`evals/`), `npm run build` **exit 0**, security sweep **7/7 PASS**.

**Decision: B — READY WITH EXPLICIT BLOCKERS.** W6 feature work may start. The explicit blockers (upstream 429 window, platform ~30 s ingress stream cutoff, benchmark 66/67 sampling ceiling) are external to the product code, are listed with their exact evidence in Section 13, and none blocks W6 implementation work. Two ready-to-run scripts will convert the blocked live items to verified the moment a healthy gateway window opens.

---

## 2. Scope, Work Order Lineage & Non-Negotiables Compliance

| Phase | Work order | Scope (one line) | Delivery report |
| --- | --- | --- | --- |
| W1 | STREAMFIX-1103 / GIFTZ-STREAM-Q1Q6-1103 | Streaming lifecycle reliability (final flush, total-duration guard, idle/heartbeat config, max_tokens honesty, controlled continuation) + Q1–Q6 intelligence disciplines | worklog.md:1340, :1462 |
| W2 | GIFTZ-STREAM-Q1Q6-1103-SESSION2 | Final gates, R3 residual fix attempt, honest 429 eval handling, delivery report | download/code-giftz-delivery-report.md |
| W3 | GIFTZ-FINAL-VERIFY-1103 | Three-check final verification (streaming / fresh benchmark / public preview) | download/code-giftz-final-verification-report.md |
| W4 | GIFTZ-GATEWAY-RECOVERY-1104 | Gateway recovery re-run: stream 240 + bench 240 fresh, public-preview browser E2E | download/code-giftz-final-verification-report.md |
| W5 | GIFTZ-W5-SELFVERIF-GATEWAY | Self-verification engine + unified AI gateway (/api/v1) + secure key & credential management | download/code-giftz-w5-delivery-report.md |
| Closure | THIS work order | Tasks A–G below | this report |

Commit chain (no history rewritten, no user work overwritten): `48a7d54→3784903→7c409e9→4a4c274→12db09e→2507990` (W1–W4 era, 11-03) → `ce6b4f1→68e6057→4f81ecf→05d51c8` (W5, 11-04 04:10–05:50) → `d9a17ed→a81565c` (closure, 11-04 06:14/07:41) → report commit (this document).

Non-negotiables compliance, checked item by item: Git history intact (only additive commits) ✓ · W1–W5 functionality preserved (951-test suite green) ✓ · no test weakened, deleted or skipped ✓ · no hardcoded answers, no score manipulation (ground truth is computed by executing snippets locally, `evals/code-giftz/run-eval.ts`) ✓ · no Ollama, no invented providers ✓ · no secrets in logs/reports/git (sweep items 2/3/5/7) ✓ · 429 discipline: max one controlled retry then stop and record ✓ (evidence: Sections 3, 6) · destructive DB ops preceded by impact checks and backups ✓ (Section 5).

---

## 3. Task A — R3 Nested-Awaits: Diagnosis, Fix, Disposition · **PARTIAL**

**Objective:** distinguish a deterministic defect from model sampling variance for the sole recurring benchmark failure; 67/67 or a technically argued acceptance decision — no silent waiver.

**What was built:** `scripts/giftz-r3-probe.ts` — runs ONLY the R3 question N times through the real product SSE route on the isolated :3100 instance, scoring each answer against ground truth **computed by executing the snippet locally** (`bun -e`), with incremental per-run JSON saves so partial evidence survives interruption. Launcher `scripts/giftz-r3-closure-run.sh` waits (bounded, 30 s steps) for a healthy gateway window and **skips without burning attempts** if it never opens.

**Measured diagnosis (20 fresh full runs, 00:36–02:22 UTC + post-W5 run 05:18:26 UTC):**
- Bench totals 61–66, mean 64.25, best 66/67; post-W5 = 66/67, sole fail = R3 order check.
- Per-check stability across 20 runs: **55/67 checks 100 %**; the 12 residuals (exact-order derivation + explicit-phrasing checks) 60–95 %, **every check ≥ 12/20**.
- R3 passes in the majority of runs across independent sessions on identical code → **deterministic product defect ruled out**; the residual is model-side sampling variance in exact-order derivation. Prompt-length interference is real (one +250-char edit → 61/67), which is why iteration stopped at the measured sweet spot.

**Fix shipped (commit `a81565c`, chat route discipline 2):** the nested-async worked example gained the *walk-into-the-awaited-callee* rule — evaluating `await callee()` IS part of the caller's synchronous run, so the callee's pre-await logs print at that exact point — plus the call-site walk-in rule, letters deliberately different from the benchmark item (S1 N3 N1 S2 N2 M1 N4). **The example's output was verified by executing it with Bun before being written into the prompt.**

**Live N-run probe status:** first attempt 07:37–07:40 UTC burned 429s (8 upstream 429 events in `server-r3-closure.log`; zero completed runs — the six latest turns in the isolated DB are user-prompt-only rows, 05:24–05:28 UTC, no assistant content). Second attempt this session 08:07–08:12 UTC: gateway never healthy in the 240 s bounded wait → **probe skipped, zero attempts burned** (correct discipline). No `r3-probe-*.json` exists because no run ever completed — nothing was fabricated.

**Disposition (technically argued, not a waiver):** R3 is accepted as a documented model-side sampling residual with a shipped targeted mitigation; the acceptance bar for the *code* is met (product route is deterministic and verified), the 67/67 bar is a model-behavior bar that cannot be met by code and is therefore re-scoped to W6's model-side self-verification feature. Unblock: `bash scripts/giftz-r3-closure-run.sh 6 240` in a healthy window.

---

## 4. Task B — Unified Model Registry Reconciliation · **PASS**

**Discrepancy found:** W5 implementation named gateway models after internal backends (`bean-code-hosted` was fine but others diverged: `bean-llm-hosted-primary` vs W0's `bean-chat-hosted`, etc.).

**Resolution (verified in code + live):** `src/lib/registry/models.ts` now maps internal backend ids to stable public gateway ids — `bean-llm-hosted-primary→bean-chat-hosted`, `bean-code-llm-hosted-primary→bean-code-hosted`, `bean-image-hosted-primary→bean-image-hosted`, `bean-image-local-sharp→bean-image-enhance-local`, `bean-image-selfhosted-diffusers→bean-image-edit-local` — plus `bean-external-openai-compatible` and `bean-video-selfhosted-candidate`. Implementation, API surface (`/api/v1/models`, `/api/v1/chat/completions`), documentation (`docs/api/GATEWAY-API.md`, updated in the closure commit) and tests now agree.

**Live catalogue (measured through the real endpoint during the Task F security E2E):** `bean-chat-hosted, bean-image-hosted, bean-image-enhance-local, bean-image-edit-local, bean-video-selfhosted-candidate, bean-code-hosted, bean-external-openai-compatible`. Honesty flags verified live: `bean-image-edit-local` reported **disabled with reason**; `bean-external-openai-compatible` flipped **awaiting-credentials → configured** exactly when the E2E created its credential — never advertised as available when it is not.

---

## 5. Task C — verify.db Schema Drift Repair · **PASS**

**Before:** isolated `scripts/giftz-verify-out/verify.db` had 13 tables vs production's 17 (drift = missing the four W5 tables, breaking W5-related verification runs).

**Fix, backup-first:** backup `verify.db.backup-20261104-062639.db` taken before surgery; second backup `e2e-verify-out/verify.db.backup-20261104-072252.db` for the second environment; schema aligned by Prisma (`db push` against the isolated file only).

**Verified this session (08:03 UTC, programmatic read):** verify.db = **17 tables**; production `db/custom.db` = **17 tables**; **identical table sets** (`ApiKey, AuditLog, CodeFile, CodeMessage, CodeProject, Conversation, Document, GatewayRequestLog, GenerationJob, ImageAsset, Message, ProviderCredential, RiisheMemory, Session, SystemSetting, UsageRecord, User`). **Production DB untouched** — no migrations, no writes outside isolated environments.

Isolated-DB state (durable facts): ApiKey 21 rows, ProviderCredential 2 rows, GatewayRequestLog 0 rows (see §6), SystemSetting 0 rows, 55 additive eval users.

---

## 6. Task D — Live /api/v1 Gateway Verification · **PARTIAL (auth surface PASS; completion path BLOCKED)**

**Live-verified PASS (real HTTP through the unified API, security E2E cred phase, 07:36 UTC — 30/30 checks):**
- App-key lifecycle: POST /api/v1/keys returns raw key exactly once (never stored — hash-only storage, DB scan hits=0, hash shape verified, 20 key rows); GET lists metadata only; rotate returns a new raw once and **the old key is rejected immediately (401)** while the new one authenticates; DELETE revokes; double-revoke is a typed VALIDATION_ERROR (400).
- Authentication: invalid key → 401 UNAUTHENTICATED; no principal → 401.
- Authorization: scope enforcement — a `models:read`-only key calling chat is denied **403 FORBIDDEN**.
- Rate limiting: burst of 31 requests → 30 honest unknown-model 404 rejections (no upstream contact) then **429 at request #31** with the stable `RATE_LIMITED` code — the 30/min limiter engaged within its window.
- Catalogue: GET /api/v1/models → 200 with the reconciled registry (§4).
- Fail-closed configuration: without `BEAN_CREDENTIALS_MASTER_KEY`, credential creation returns the typed **503 PRODUCT_UNAVAILABLE** naming the missing config, while models/auth stay reachable (nocred phase, 3/3).

**BLOCKED by upstream 429 (recorded, not faked):** authenticated JSON completion and authenticated SSE completion through `/api/v1/chat/completions`, and consequently usage-accounting-with-rows. Evidence: `server-apilive.log` (07:15 UTC) and `server-apilive2.log` (07:26 UTC) both show the upstream `429 Too many requests`; the two latest isolated-DB turns carry user prompts with **no assistant rows**; GatewayRequestLog = 0 rows is consistent (429 rejections are pre-upstream and unknown-model 404s are pre-upstream — no successful v1 completion has ever been recorded). Runner `scripts/giftz-api-live-e2e.ts` implements exactly one 65 s-cooldown retry then honest typed-failure reporting.

---

## 7. Task E — Live Self-Verification (Verification-Enabled) Run · **NOT VERIFIED**

**What exists:** `scripts/giftz-verify-live-e2e.ts` (commit `a81565c`) — starts from a verification-enabled isolated instance (`BEAN_VERIFY_ENABLED=true`, isolated env only; production default stays OFF) and asserts, with no mocks: stage order (verifying before done), done-frame public summary shape exactly `{status, attempts, corrections, issuesFound}`, byte-exact persistence, and zero verifier-reasoning leakage into the user-visible stream.

**Status: NOT VERIFIED.** The previous closure session ended before this run could execute; the current session's bounded gateway wait (08:07–08:12 UTC) never opened a window, and the run requires a real hosted-model turn. The pipeline remains covered by **17 unit tests** (all 12 spec categories, including the double clamp, cancellation between passes and mid-revision, streaming revision assembly, leak tests) — unit-tested, not live-verified, and this report claims nothing beyond that.

**Unblock (single command sequence in a healthy window):** start the isolated server with `BEAN_VERIFY_ENABLED=true DATABASE_URL=file:.../verify.db` (standalone build, :3100) then `bun scripts/giftz-verify-live-e2e.ts http://127.0.0.1:3100`; afterwards the env is gone with the process — production default OFF is never touched.

---

## 8. Task F — Credential Encryption & Key Lifecycle Verification · **PASS (three-state, honest)**

**State 1 — Encryption TESTED (live, both phases, 07:36 UTC):** AES-256-GCM versioned envelope verified at rest — format `v1:<iv>.<tag>.<ct>` (envelope prefix=v1, len=122); **zero plaintext hits** in the raw DB scan before AND after rotation; rotation re-encrypts under the current env key and reports **counts, not secrets** (`{"ok":true,"reencrypted":1,"failed":1,...}` — the failed row is a stale credential from a prior disposable-key dev run, and the fail-closed report of an undecryptable row is itself the correct behavior); create/list responses expose no plaintext and no >24-char prefix; `openssl rand -hex 32` master key generated in the runner, never printed, unset after the run.

**State 2 — Functionality CONFIGURED:** fail-closed without master key (typed 503 PRODUCT_UNAVAILABLE, §6); admin dashboard shows masked hints only; docs updated (`docs/api/GATEWAY-API.md` in the closure commit).

**State 3 — Real external credentials VERIFIED:** not applicable / not claimed — no real external provider credential exists in this environment, so no claim of real-credential verification is made. Nothing is overstated.

---

## 9. Task G — Full Regression vs Baseline · **PASS**

Re-run on the current build this session (08:03–08:07 UTC), against the committed baseline (951/0/60 · lint 0 · tsc 11 scripts-only · build ✓ · sweep 7/7):

| Gate | Baseline (W5 delivery) | Closure re-run | Verdict |
| --- | --- | --- | --- |
| bun test | 951 pass / 0 fail / 60 files | **951 pass / 0 fail / 60 files** (28,840 expect calls, 16.35 s) | PASS — no new failures |
| npm run lint (eslint .) | 0 | **0** | PASS |
| tsc --noEmit | 11 errors, all in scripts/ | **11 errors, same pre-existing files** (`scripts/` only; 6 files incl. merge-backup legacy) — 0 in src/tests/evals | PASS (pre-existing, unmasked) |
| npm run build | ✓ exit 0 | **✓ Compiled successfully 19.9 s, 44 static pages, exit 0** | PASS |
| w5-security-sweep.sh | 7/7 | **7/7 PASS** (client-import, bundle secrets, hardcoded keys, logger payloads, hash-only storage, error-text leaks, .env) | PASS |
| Isolated DB schema | 13-table drift | **17 tables = production set** | PASS (Task C) |
| W1 streaming regression | stream E2E 6/6 (05:15:19Z, post-W5 build) | no product-route change since; R3 discipline change is prompt-text only | PASS (carried, evidence §11) |

**Investigation of new failures: none required — zero new failures.** The five closure code fixes (§10) landed without moving any gate.

---

## 10. Defects Found & Fixed During Closure (commit `a81565c`)

Each fix was caught by the closure's own live/HTTP verification, then fixed with a documented rationale in code:

1. **GET /api/admin/gateway unconditional 500 since W5** — a temporal-dead-zone race: the llm health probe was inlined into the same `Promise.all` as `getGatewayModels`, whose synchronous health callback read `llmHealth` before assignment. Fix: sequence the probe before the catalogue build (`src/app/api/admin/gateway/route.ts`). Caught by the closure live E2E; not covered by unit tests before.
2. **Unknown model id returned 500** instead of the documented typed 404 — `resolveGatewayModel` throws a plain Error with `code:'NOT_FOUND'`; the gateway now maps it to `BeanApiError('NOT_FOUND', …)` pointing at GET /api/v1/models (`src/lib/ai-gateway/gateway.ts`).
3. **Missing master key crashed as opaque 500** — now mapped to the typed fail-closed **PRODUCT_UNAVAILABLE** with the operator-actionable message; mapping keys on the stable error name to avoid a chunk-ordering TDZ in the standalone bundle (`src/lib/api/errors.ts`); error logs gained a 6-frame stack prefix for diagnosability (no secrets).
4. **Double-revoke was a silent no-op** — now typed VALIDATION_ERROR (400) per the documented contract §2.6 (`src/lib/security/api-keys.ts`).
5. **R3 prompt discipline (Task A)** — walk-into-callee rule added to the nested-async worked example; example output Bun-verified before shipping (`src/app/api/code-giftz/chat/route.ts`).

All five are additive fixes; none weakens a test, and the full regression re-run (§9) confirms baseline parity.

---

## 11. Benchmark & Test Evidence Ledger (all measured, nothing reused across sessions)

| Evidence | When (UTC) | Result | Artifact |
| --- | --- | --- | --- |
| 20 fresh full benchmark runs | 11-04 00:36–02:22 | totals 62,64,63,65,65,66,64,63,63,65,65,66,65,61,66,66,64,63,66,63 — mean 64.25, **best 66/67** | worklog.md (GIFTZ-GATEWAY-RECOVERY-1104) |
| Post-fix live stream E2E | 11-04 00:33 | **6/6** — 20,770 chars / 5,044 deltas / TTFT 869 ms / 57.1 s / done / byte-exact persist | stream-e2e-1793752401863.json |
| Post-W5 live stream E2E | 11-04 05:15:19 | **6/6** — 25,188 chars / 5,666 deltas / TTFT 1,208 ms / 70.5 s / done / byte-exact / 1 file | giftz-verify-out/ |
| Post-W5 full benchmark | 11-04 05:18:26 | **66/67**, sole fail = R3 order check | giftz-verify-out/ |
| W5 unit additions | 11-04 05:50 | +67 tests (ai-gateway 20, api-keys 15, security-crypto 15, self-verification 17) → **951 total** | tests/unit/*.test.ts |
| Security/credential E2E (2 phases) | 11-04 07:36 | **33/33 checks PASS** (nocred 3 + cred 30) | sec-e2e-closure-*.log |
| Live /api/v1 completion attempts | 11-04 07:15 / 07:26 / 07:37–07:40 | **BLOCKED — upstream 429** each time | server-apilive*.log, server-r3-closure.log |
| Disciplined 240 s health wait | 11-04 08:07–08:12 | never healthy → skip, **0 attempts burned** | this report (console transcript) |
| Exact 429 capture (prior session) | 11-04 05:44:13 | chat completion + web_search 429 archived | gateway-probe-1793771053.json |

---

## 12. W1–W5 Acceptance Matrix

Legend: statuses only from {PASS, PARTIAL, BLOCKED, FAIL, NOT VERIFIED}. "LIVE" = real hosted-provider / real-browser evidence, never mocks.

| Work order | IMPLEMENTED | UNIT TESTED | INTEGRATION TESTED | LIVE VERIFIED | ACCEPTANCE CRITERIA MET |
| --- | --- | --- | --- | --- | --- |
| **W1** streaming reliability & response limits | PASS | PASS (stream-config 8, continuation 7, max_tokens 4, streaming +7, protocol pins +10) | PASS (short/long/Tamil/Q11/Q14/Q15 live E2E on isolated instance) | PASS (long turn byte-exact 9,708 chars; disconnect containment live) | **PASS** |
| **W2** session-2 gates + R3 fix + eval harness | PASS | PASS | PASS | PARTIAL (stream 6/6 + bench 65/67 live; live eval BLOCKED ≥90-min 429) | **PARTIAL** (67/67 not achieved — claimed honestly) |
| **W3** three-check final verification | PASS (verification only) | PASS (baseline gates) | PARTIAL (browser E2E 9 PASS / 3 BLOCKED / 1 NOT TESTED) | PARTIAL (CHECK 1+2 BLOCKED 429 07:40→10:10+; CHECK 3 partial) | **PARTIAL** |
| **W4** gateway recovery re-run | PASS (harness ready) | PASS | PASS (browser E2E: register/login/stream/Markdown/stop/retry/refresh — all PASS, zero duplicates, zero 5xx) | PARTIAL (stream 6/6 00:33Z PASS; bench best fresh 66/67 = FAIL by strict bar; >30 s public stream BLOCKED by platform ingress) | **PARTIAL** |
| **W5** self-verification + unified gateway + key mgmt | PASS | PASS (+67 tests; 12/12 self-verification categories) | PASS (security E2E 33/33 live incl. fail-closed) | PARTIAL (stream 6/6 05:15:19Z + bench 66/67 05:18:26Z; models/keys/scopes/rate-limit/credentials live PASS; **/api/v1 completion path + verify-enabled live run BLOCKED 429**) | **PARTIAL** (67/67 not achieved; live /api/v1 completions pending window) |
| **Closure A** R3 disposition | PASS (probe + fix shipped) | PASS | PARTIAL (probe ran, zero completed runs — 429) | BLOCKED (bounded wait 08:07–08:12 never healthy) | **PARTIAL** (technically argued disposition, no silent waiver) |
| **Closure B** registry reconciliation | PASS | PASS | PASS | PASS (live catalogue matches docs) | **PASS** |
| **Closure C** verify.db schema | PASS | n/a | PASS | PASS (17=17 programmatic verify) | **PASS** |
| **Closure D** live /api/v1 | PASS | PASS (20 ai-gateway tests) | PARTIAL | PARTIAL (auth surface PASS; completions BLOCKED) | **PARTIAL** |
| **Closure E** live self-verification | PASS (runner ready) | PASS (17 tests) | NOT VERIFIED | NOT VERIFIED | **NOT VERIFIED** (blocked + session boundary) |
| **Closure F** credential encryption | PASS | PASS (15 crypto tests) | PASS | PASS (2-phase live; state-3 real-credential N/A, not claimed) | **PASS** |
| **Closure G** full regression | PASS | PASS | PASS | PASS (gates re-run this session) | **PASS** |

---

## 13. Remaining Blockers & Unblock Paths

| # | Blocker | Type | Evidence | Impact on W6 | Unblock |
| --- | --- | --- | --- | --- | --- |
| 1 | Upstream gateway sustained 429 (≥2 h continuous at last probe; window exhausted 08:12 UTC this session) | External | server-apilive*.log 07:15/07:26; server-r3-closure.log 07:40; gateway-probe-1793771053.json 05:44:13 | None for feature work; must clear before /api/v1 external exposure and before claiming live verification | Healthy window → `bash scripts/giftz-r3-closure-run.sh 6 240`, then `bash scripts/giftz-sec-closure-run.sh` (re-confirm), then API-live + verify-live runners (§6, §7) |
| 2 | Platform ingress cuts public streaming at ~30 s total (reproducible ×3) | External (platform) | worklog.md W4 entry (30.15/30.62/32.59 s cut vs 42.1 s direct OK) | Only long public streams; app-side typed path verified correct | Platform raises the ingress streaming timeout |
| 3 | Benchmark 66/67 ceiling — model sampling residual on exact-order checks | Model behavior | 20-run stability data (§3) | None (feature lever identified: model-side self-verification = W6 candidate) | W6 self-verification feature or model upgrade |
| 4 | tsc: 11 pre-existing errors confined to `scripts/` legacy | Legacy, untouched | tsc output (6 files, incl. merge-backup copies) | None (src/tests/evals clean) | Optional cleanup, out of closure scope |

---

## 14. Evidence Index (artifacts on disk, all committed or in scripts/giftz-verify-out/)

- **Scripts (commit `a81565c`):** `scripts/giftz-r3-probe.ts` (101 L) + `scripts/giftz-r3-closure-run.sh`; `scripts/giftz-sec-e2e.ts` (246 L) + `scripts/giftz-sec-closure-run.sh`; `scripts/giftz-api-live-e2e.ts` (190 L); `scripts/giftz-verify-live-e2e.ts` (135 L); `scripts/w5-security-sweep.sh`; `scripts/giftz-eval-run.sh`.
- **Logs:** `sec-e2e-closure-cred.log` (30 PASS lines), `sec-e2e-closure-nocred.log` (3 PASS lines), `server-apilive.log` / `server-apilive2.log` (429 evidence), `server-r3-closure.log` (429 evidence), `gateway-probe-1793771053.json` (exact 429 body).
- **Reports:** `download/code-giftz-delivery-report.md` (W2), `download/code-giftz-final-verification-report.md` (W3–W4), `download/code-giftz-w5-delivery-report.md` (W5), this file (closure).
- **Isolated DB:** `scripts/giftz-verify-out/verify.db` (17 tables) + backups `verify.db.backup-20261104-062639.db`, `e2e-verify-out/verify.db.backup-20261104-072252.db` (backups git-ignored by design).
- **Production DB:** `db/custom.db` — untouched by the closure; 17 tables; zero writes outside additive eval accounts in isolated copies.

---

## 15. Final Decision & W6 Gate

**Decision: B — READY WITH EXPLICIT BLOCKERS.**

Rationale, in one paragraph per leg:
- **Product code legs are green:** full regression at baseline parity (951/0/60, lint 0, build ✓, sweep 7/7) after five closure fixes; registry reconciled and live-matched; isolated schema at production parity; credential encryption live-verified in both configuration states with fail-closed behavior; streaming regression carried green (6/6 post-W5).
- **The blocked legs share exactly one cause** — the upstream 429 window (plus the platform ingress limit, which affects only >30 s public streams). None of them indicates a product defect: the auth/scope/rate-limit/models/credential surface of the same /api/v1 deployment verified PASS live against the real gateway code, and the completion path is unit-tested against that code with the adapter seam mocked.
- **Nothing was overstated:** every PARTIAL/BLOCKED/NOT VERIFIED above carries its artifact; no live result is fabricated, no score is reused across sessions, no test was weakened, and the one thing the closure could not measure (R3 live N-run pass rate) is explicitly converted into a documented acceptance decision rather than a silent waiver.

**W6 may start.** Conditions attached to the decision: (1) before any external exposure of `/api/v1`, run the three live runners in a healthy window and record the results (§6/§7 commands); (2) the benchmark 67/67 push moves into W6 as the model-side self-verification feature rather than further prompt iteration; (3) the closure discipline (no silent waivers, four-state statuses, artifact-backed claims) carries into W6 acceptance.
