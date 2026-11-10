# CODE GIFTZ — W6 IMPLEMENTATION REPORT

**Date:** 2026-11-04 · **Head:** `29bd0c0` (W6) on the recovered closure state · **Author:** main agent
**Scope:** model-side self-verification & answer reliability (work order Part 3) + carry-forward of W1–W5 open items + the workspace preview persistence fix (user request).

---

## 1. Incident handled before implementation: workspace snapshot regression

At ~09:35 UTC this session, the workspace **restored a stale snapshot** (`.git` metadata at 11-03, `12db09e`) while the worktree files stayed current — surfaced first as the supervisor script vanishing mid-session. Forensics (`git reflog`, object checks): a **cron-turn sandbox** (my registered preview heartbeat) had restored the stale snapshot and auto-committed it (`25fe7f9`, "-cron" suffix, 09:26:15 UTC). Full integrity audit afterwards: **all W5+closure files present** (5 closure-fix markers verified, 17-table production DB with 62 users, all /api/v1 routes, `bun test` 951/0/60 on the recovered tree). Only the uncommitted supervisor script was lost (rewritten, `d0f711b`). The cron job was deleted and is **disqualified** as a recovery mechanism (see the preview report, R4).

## 2. Architecture of the W6 changes

**Existing engine preserved (no duplication):** the W5 pipeline (`src/lib/verification/{config,pipeline,prompts}.ts`) remains the single bounded loop — draft → verify → (one corrective revision → re-verify) with hard caps (maxAttempts ≤ 3, timeout ≤ 120 s, regenerations ≤ 1, input ≤ 60 000 chars clamped at env-parse AND DB-read time). W6 **extends** it:

1. **Derivational verifier discipline** (`prompts.ts`, VERIFIER_SYSTEM_PROMPT): the verifier must now work in two steps — ENUMERATE the request's explicit requirements first, then verify each; recalculations must be recomputed independently ("never adopt the draft's arithmetic"); a full EXECUTION-ORDER DISCIPLINE block encodes the measured failure classes: running output list, walk-into-awaited-callee, continuation-queues-on-resolution-at-the-back, FIFO drain then macrotasks, and **position-by-position comparison against the draft's claimed order — never deriving the order from the draft's own explanation** (work order §3.2: not a memorized-sequence comparison).
2. **Request-type verification focus** (`buildVerificationFocus`): conservative keyword detection (biased toward matching — a false positive only ADDS a checklist) appends a per-request checklist to the verifier's user turn. Detected ONCE from the original request, never from the draft.
3. **Threading** (`pipeline.ts`): focus computed once per turn and passed into every verifier pass; revision instructions, public summary and statuses untouched (the focus is INTERNAL — never user-visible).
4. **Provider compatibility (§3.4): unchanged by design** — verification resolves `verificationModel` through the unified gateway/registry (default `bean-code-hosted`), no provider is hardcoded, unavailable models surface the registry's honest states; credentials never reach the frontend. Verified by the 12 url-guard tests + 42-check E2E + existing ai-gateway suite.
5. **Sandbox boundary (§3.2)**: ground truth is executed ONLY in the eval harness locally (`bun -e` on benchmark snippets, as W2 established); the product pipeline deliberately does NOT execute user code server-side (no sandbox) — documented decision.

## 3. Files changed

| File | Change |
| --- | --- |
| `src/lib/verification/prompts.ts` | Two-step verifier prompt (enumerate → verify), derivational order discipline, unsupported-claims rule; `buildVerifierUserTurn(…, focus?)`; `buildVerificationFocus()` with prefix-matching regex (trailing `\b` plural bug found by the eval and fixed) |
| `src/lib/verification/pipeline.ts` | Focus computed once per turn, threaded into `runVerifierPass` |
| `src/lib/security/url-guard.ts` | NEW — SSRF guard for provider base URLs (SEC-W6-01) |
| `src/lib/security/provider-credentials.ts` | URL validation at create + replace (before the master-key gate) and decrypt-time defense-in-depth |
| `next.config.ts` | Security headers: X-Content-Type-Options, Referrer-Policy, Permissions-Policy (SEC-W6-02; framing headers deliberately excluded — preview panel embeds cross-origin by design) |
| `next.config.ts` typescript ignoreBuildErrors | unchanged (pre-existing) |
| `tests/unit/verification-w6.test.ts` | NEW — 11 tests (detection, prompt discipline, threading, internal-only guarantee, budget behavior) |
| `tests/unit/url-guard.test.ts` | NEW — 12 tests (accept matrix, reject matrix, escape-hatch limits) |
| `scripts/giftz-w6-eval.ts` | NEW — reproducible evaluation suite (local + live modes) |
| `scripts/giftz-w6-security-e2e.ts` | NEW — 42-check HTTP-level security matrix incl. full production-DB cleanup |
| `scripts/preview-supervisor.sh` | NEW — preview reconcile-to-healthy (root causes R1–R5) |
| `scripts/render-closure-report-html.cjs→mjs` | ESM conversion (4 lint errors fixed) |

## 4. Verification behavior after W6

- Statuses, caps, clamps, cancellation and leak guarantees are byte-identical to W5 (17 W5 tests unchanged and passing).
- New: order-type requests get the derivational checklist; the verifier's report contract is hardened by tests proving malformed replies never parse into passes.
- `publicVerificationSummary` shape unchanged: `{status, attempts, corrections, issuesFound}` only.

## 5. Tests and evaluation results

| Suite | Result |
| --- | --- |
| W6 unit (verification-w6) | **11 pass / 0 fail** |
| W6 unit (url-guard) | **12 pass / 0 fail** |
| W5 self-verification suite | **17 pass / 0 fail** (unchanged) |
| W6 eval — local mode | **PASS**: 4/4 order cases' ground truth executed (OC1 `N5 N3 N1 M1 N2 N4 N6`, OC2 `S1 T1 T3 T2`, OC3 `S2 P1 P2 Z1 Z2`, OC4 `B0 B1 A1 B5 A2 B3 B4`); focus detection 8/8 (after fixing the measured plural false negative); report-contract honesty 8/8 |
| W6 eval — live mode | **BLOCKED** — upstream 429; bounded wait, zero attempts burned, exit 2 |
| Full Bun suite | **974 pass / 0 fail / 62 files** (baseline 951/0/60 → +23 W6 tests, 0 regressions) |
| ESLint | **0** (fixed the 4 require-import errors my prior-turn renderer had introduced) |
| tsc --noEmit | **11 errors, all pre-existing legacy `scripts/`** — zero new |
| `npm run build` | **exit 0** |
| w5-security-sweep | **7/7 PASS** |

## 6. Benchmark impact — HONEST

**No 67/67 claim.** The W6 verifier upgrade targets exactly the R3 residual, and the local eval proves the mechanics (executed ground truth, detection, contract). The live A/B measurement (verification ON vs OFF over the order-case set and the full benchmark) is blocked by the upstream 429 window (timestamped 09:56:14 UTC, bounded waits exhausted twice). The moment a window opens: `bash scripts/giftz-r3-closure-run.sh 6 240` then the W6 live eval — both runners are committed and ready.

## 7. Preview persistence (user request) — summary, details in the dedicated report

Root causes R1–R5 measured; `scripts/preview-supervisor.sh check` reconciles the whole-website preview to healthy and is now the task-end recovery step; recovery verified live three times this session (boot → 200 via the real ingress in ~2 s; kill → auto-recovery; Prisma-client fix → W5 API surface working). Cron-based recovery measured harmful (stale-snapshot regression) and was removed.
