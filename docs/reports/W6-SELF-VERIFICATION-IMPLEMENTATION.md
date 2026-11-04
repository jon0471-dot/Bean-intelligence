# W6 — Self-Verification Implementation Report

**Date:** 2026-11-04 · **Scope:** §9 of the four-product task — independent self-verification for CODE GIFTZ, carried forward from W1–W5 closure (`READY WITH EXPLICIT BLOCKERS`).

## 1. What existed before (built in W6 commits `29bd0c0`/`1abf077`, preserved)

`src/lib/verification/` implements the full cycle **Generate → Re-derive → Compare → Correct → Verify**:

- `pipeline.ts` — `verifyAndCorrect`: draft → **independent verifier pass through the unified gateway** (separate model role `verificationModel`, default `bean-code-hosted`) → if blocking issues: exactly one corrective revision (budget `min(maxAttempts−1, regenerations)`) → re-verify. Statuses `verified | corrected | corrected-unverified | unverified | skipped`.
- `config.ts` — disabled **by default**; enabled only via env `BEAN_VERIFY_*` or the admin `SystemSetting['verification.config']`; **hard caps** (maxAttempts ≤3, timeout ≤120s, regenerations ≤1, input ≤60k chars) that override any looser config.
- Strict verifier contract: only strict JSON reports count; malformed/prose/refusal replies can never become a pass; confidence clamped; verdicts are never guessed from typos. Verifier reasoning stays server-side — only `publicVerificationSummary` (status/attempts/corrections/issuesFound) reaches the wire.
- Chat integration (`code-giftz/chat/route.ts`): SSE stages `verifying`/`revising` (client buffer reset so the revision replaces the draft), full outcome persisted in `CodeMessage.metaJson`, verification token overhead metered as labeled estimates; tasks that don't need verification are untouched (`skipped`).
- Security hardening from the W6 security review: SSRF url-guard (`SEC-W6-01`), security headers (`SEC-W6-02`).
- Eval machinery: `evals/code-giftz/` (ground truth by **executing** generated snippets), `scripts/giftz-w6-eval.ts` (`local` no-network / `live` gateway-gated, exits `2 BLOCKED` on throttle), R3 probe `scripts/giftz-r3-probe.ts`.

## 2. Evidence executed this session

- **`bun scripts/giftz-w6-eval.ts local` → PASS**: ground truth **4/4 executed** (generated order-discipline snippets actually run under Bun; no memorized answers), order-focus detection **8/8**, verifier-report contract **8/8** (clean pass, fenced pass, prose-wrapped fail, prose refusal, verdict-typo NOT guessed, out-of-range confidence clamped, malformed issues dropped, empty string). Report JSON committed at `scripts/giftz-verify-out/w6-eval-local-*.json`.
- **Live W6 through the gateway: BLOCKED** by the same upstream 429 throttling documented in the acceptance report (the eval's designed `2 BLOCKED` exit path — by design, never a fabricated pass).
- Unit coverage: `verification-w6.test.ts`, `self-verification.test.ts`, `gateway` suites — all green in the 1018/0/64 run.

## 3. R3 benchmark status (unchanged, honestly carried forward)

- Last recorded recovery data: 20 fresh runs, best **66/67**, no 67/67 run; failure category = R3 nested-awaits ordering under provider-side sampling variance; prompt-text iteration deliberately stopped.
- **No 67/67 run was performed this session** (live gateway blocked). The W6 closure decision remains **READY WITH EXPLICIT BLOCKERS** exactly as documented in `docs/reports/W1-W5-FINAL-CLOSURE-REPORT.md` and `W6-ACCEPTANCE-REPORT.md`. W6 is NOT re-accepted here; a 67/67 claim will only ever come from a real complete live run.

## 4. Rules compliance

No Ollama; no hardcoded benchmark answers; no answer injection; no verifier-reasoning leakage on the wire; bounded attempts/timeouts; untrusted generated code only inside the existing sandbox model; verification disabled unless an operator enables it; normal (non-verification) responses unchanged.

## 5. Rollback

No W6 pipeline changes this session. Historical rollback: revert `29bd0c0`/`1abf077` (documented in the W6 implementation report).
