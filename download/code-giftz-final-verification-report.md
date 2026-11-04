# CODE GIFTZ — Gateway Recovery Verification Report

**Work order:** "NEXT ACTION: GATEWAY RECOVERY VERIFICATION"
**Executed:** 2026-11-04, 08:25–10:50 CST (00:25–02:50 UTC)
**Scope discipline:** no new features, no unrelated code/UI changes; product changes limited to the response-contract disciplines in `src/app/api/code-giftz/chat/route.ts` — the sanctioned fix path for demonstrated benchmark defects (fix general reasoning root cause → re-run full suite).

---

## 1. Executive summary

| # | Verification | Status | Evidence anchor |
|---|---|---|---|
| 1 | Provider health (HTTP 429 cleared) | **PASS** | §2 — exact health response saved |
| 2 | Real-provider streaming (`giftz-eval-run.sh stream 240`) | **PASS** | §3 — 6/6 checks, exit 0 |
| 3 | Fresh benchmark (`giftz-eval-run.sh bench 240`) | **FAIL** (66/67 best of 20 fresh runs) | §4 — full run table, 12 root-cause fixes |
| 4 | Public preview browser E2E (short stream, stop, retry, Markdown, refresh, duplicates) | **PASS** (short/medium streaming + all interaction checks) | §5 — real browser via agent-browser |
| 4b | Long streaming (>30 s) through the **public preview URL** | **BLOCKED** (platform ingress cuts SSE at ~30 s) | §5.4 — 3 reproduced cuts vs. clean 42 s local run |
| 5 | Final regression (test / lint / tsc / build) | **PASS** (11 pre-existing `scripts/` tsc errors, unchanged) | §6 |
| 6 | Isolation & safety (no orphan servers, no production data damage, no secrets leaked) | **PASS** | §6.3 |

**Completion claim per the work order:** real-provider streaming **passes**; the fresh benchmark does **not** yet reach 67/67 in a single fresh run (best 66/67, up from the historical 65/67), so completion is **not claimed** for CHECK-benchmark. Details, root-cause fix history, and the remaining variance are in §4.

---

## 2. Provider health — HTTP 429 has cleared (**PASS**)

Prior sessions were blocked 2 h+ by a global upstream 429 window (07:40→09:40+ UTC on 2026-11-03). Per the work order, the first action was a single disciplined health probe (no hammering, no retries) through the app's own readiness endpoint, which performs a **real live completion probe** against the gateway:

```
GET http://127.0.0.1:3000/api/health  →  HTTP 200  (2026-11-04T00:25:46Z)
riishe.available: true      probe: healthy, latencyMs 745,
                            "Gateway responded to a live completion probe."
riishe.research.available:  true   (live web_search probe, 1 result in 1253 ms)
code-giftz.available:       true   (same chat-class probe)
```

Exact response saved to `scripts/giftz-verify-out/health-probe-1793751944.json`. The gateway stayed healthy for the entire session (~2.5 h of live generation, 20+ eval/preview turns, zero 429 events observed).

---

## 3. Real-provider streaming — `stream 240` (**PASS**)

Environment: platform environment regeneration had wiped `.next/standalone`; rebuilt from current source (`npm run build`, 4 successful builds this session). The eval script started the isolated :3100 verify instance (standalone bundle + DB copy `scripts/giftz-verify-out/verify.db`), waited on the gateway probe (healthy after 0 s), then ran the E2E pack. Production DB untouched.

**Result: 6/6 checks, EVAL EXIT 0** — report `evals/code-giftz/results/stream-e2e-1793752401863.json`, ran at 2026-11-04T00:33:21Z:

| Metric | Measured |
|---|---|
| Answer length | **20,770 chars** streamed (check: > 6,000) |
| Streaming deltas | **5,044** (check: > 50 — real incremental streaming) |
| TTFT | **869 ms** (check: < 30 s) |
| Total duration | 57.1 s |
| Terminal state | legitimate `done`, no error frame |
| Persistence | streamed answer **byte-exact** (no truncation, no duplication) |
| Project files | 1 created from the answer (`main.html`) |

No network errors, no duplicate assistant messages, no `Controller is already closed` events in the server log (`grep -c` = 0).

---

## 4. Fresh benchmark — `bench 240` (**FAIL at 67/67 — best fresh run 66/67; every check individually demonstrated**)

### 4.1 Progression

20 complete fresh benchmark runs were executed (no historical reuse; every run live-generated all 10 items, Q1–Q6 + R1–R4 = 67 checks). Fresh totals, chronological:

```
62, 64, 63, 65, 65, 66, 64, 63, 63, 65, 65, 66, 65, 61, 66, 66, 64, 63, 66, 63  (of 67)
```

Five runs reached **66/67** (runs 6, 12, 15, 16, 19). Result files: `evals/code-giftz/results/benchmark-regression-1793752*.json` through `…93*.json` (timestamps 00:36–02:48 UTC).

### 4.2 Root-cause fixes applied (12 distinct defects, each verified repaired)

Following the standing rule ("fix the general reasoning root cause, then re-run the full suite"), every observed failure mode was traced to its general defect class and fixed in the response-contract disciplines of `src/app/api/code-giftz/chat/route.ts`:

| # | Observed failure | General root cause | Fix (discipline) | Verified |
|---|---|---|---|---|
| 1 | Q2 `handles empty array` / Q4 `empty string behavior` | Edge cases exercised in tests but never documented in prose | D6: "State the contract — in prose, not only in tests" | Pass 19/20, 18/20 |
| 2 | Q6 `no mutation / no sorting` | Purity never stated explicitly | D6: purity as an explicit sentence | Pass 17/20 |
| 3 | R2 final line dropped a letter (F, then E) | Final order line assembled from memory, not the trace | D2 + LAST CHECK: copy from trace, verify | Pass 14/20 |
| 4 | R3 queued outer's continuation at `await callee()` statement | Await-timing rule stated without the two-case split | D2: already-resolved value queues at the statement; pending promise queues at settle | Pass 14/20 |
| 5 | R2 (over-correction) chained `.then` queued immediately onto `p` | "Already resolved" not judged on the exact receiver; `.then` returns a NEW pending promise | D2 + worked Example 1 (M5/M6, verified by execution) | Pass 14/20 |
| 6 | Q1 fluent chain `Promise.resolve().then(C).then(D)` misjudged | Implicit receiver of the second `.then` | D2: judge the RECEIVER exactly (fluent-chain rule) | Pass 12/20 |
| 7 | Q2 array collector with `includes()` guard | Data-structure choice not tied to O(n) claim | D7: "Match data structures to the job" (two-Set pattern, code-shaped contrast) | Pass 13/20 |
| 8 | Q4 complexity statement omitted despite prompt naming "in O(n)" | Requirements dropped under verbosity | D4: ALWAYS state complexity; repeat the named target over the final code | Pass 18/20 |
| 9 | Q1 chained callback declared "never resolves" | `.then` callback completion RESOLVES the returned promise — implicit | D2: "a chained .then callback is NEVER lost" | Pass 18/20 |
| 10 | R4 final line transposed B/G three times (code-order bias) | Assembly by code layout instead of trace chronology | LAST CHECK: running output list built during the trace + position-by-position verification + "registered earlier ≠ printed earlier" | Pass 16/20 |
| 11 | Q3 invented 1-based indices for a JS array function | Indexing convention never stated | D6: state the convention (JavaScript arrays are 0-based) | Pass 17/20 |
| 12 | Q5 "LIFO logic explained" failed — stack mechanics explained without naming LIFO | Ordering property not named | D7: name the ordering property correctness depends on | Pass 19/20 |

Two worked examples inside the contract were **verified by actual execution** before being shipped (the M1–M6 example's ground truth `S1 M1 M2 M3 M5 M4 M6 T1` was initially mis-derived and corrected after executing it — the eval's EXECUTED-ground-truth methodology applied to our own prompt).

### 4.3 Per-check stability across all 20 fresh runs

- **55 of 67 checks: 100% (20/20)** — all structural, persistence, terminal-state, complexity, data-structure, Unicode, validation and byte-exact-persistence checks.
- **12 checks: 60–95%** — all require either deriving an exact output order for a fresh script variant (Q1-order 12/20, R1 15/20, R2 14/20, R3 14/20, R4 16/20) or making an explicit statement whose phrasing the model sometimes varies (Q2 duplicates-Set 13/20, Q2 no-includes 17/20, Q3 exact pair 17/20, Q3 pair derivation 18/20, Q6 purity 17/20, Q1 chained-then explanation 18/20, Q4 complexity 18/20, Q4 empty-string 18/20, Q2 empty 19/20, Q5 LIFO 19/20).
- **Every one of the 67 checks passed in at least 12 of 20 fresh runs**; each fix demonstrably repaired its target (e.g. R4 transposition: failed 3× consecutively, passed 4/4 in the four runs after fix #10 when its neighbors were stable).

### 4.4 Honest verdict and why iteration stopped

- Historical benchmark: **65/67**. Best fresh result now: **66/67** — an improvement, but the work order's bar is a passing fresh run, and 67/67 was not achieved in a single run. **Benchmark status: FAIL by the strict criterion.**
- The residual is sampling variance: in the last 6 runs failures rotated among single order/phrase checks (66, 66, 64, 63, 66, 63) while all other items held. Adding more prompt text empirically causes collateral regressions (run 14: 61/67 after +250 chars), so prompt iteration was stopped at the measured sweet spot (~8.3–8.9k chars, deduplicated rules, execution-verified examples).
- Not attempted (out of scope): weakening checks, hardcoding answers, retry-until-lucky without disclosure — all prohibited. Every run above is disclosed, including the worst (61/67).
- **Recommended next step (outside this ticket):** a model-side answer self-verification pass (generate → re-derive → compare → regenerate on mismatch) would convert the remaining ~15% per-check variance into near-certainty; it is a product feature and was deliberately not built here.

Representative best run (1793758752137): Q1 6/6 · Q2 8/8 · Q3 9/9 · Q4 10/10 · Q5 9/9 · Q6 8/9 · R1 4/4 · R2 4/4 · R3 4/4 · R4 4/4 — the single failing check (`Q6 no mutation`) passed in 17/20 runs.

---

## 5. Public preview — recovery and real-browser E2E

### 5.1 Platform state

- The platform has restarted the preview: `next-server v16.1.3` on **:3000** (pid 1135, platform-managed `bun run dev`, started 00:13), serving the real DB via `.env` `DATABASE_URL=file:…/db/custom.db`.
- `.env` was regenerated again down to `DATABASE_URL` only (the documented environment-reset failure class). The durable fix from the earlier CSRF ticket held: `resolveSuffixConfig` falls back to the platform scope (`space-z.ai`) when the env var is undefined, so browser mutations through the public origin worked without any config change this time — measured, not assumed.
- Public URL reachable: `https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai/` → HTTP 200; `/api/health` → HTTP 200 with `riishe.available: true`.
- The dev server serves the CURRENT source (hot-reload), so the updated disciplines were live in the preview during E2E.

### 5.2 Real-browser E2E (agent-browser — Chromium, public origin)

Accounts: dedicated `gz-e2e-*@bean-test.dev` / `gz-streamtest-*@bean-test.dev` eval accounts only.

| Check | Result | Evidence |
|---|---|---|
| Preview page loads (title, no 502/500) | **PASS** | v1 C1 screenshot; network log: zero 5xx across all runs |
| Register → dashboard through the public origin | **PASS** | v1/v2: auto sign-in → `#dashboard`; v3: separate **login** path also PASS |
| Short streaming turn | **PASS** | Stop control visible during generation; terminal state; answer rendered (`v2-c4-short.png`) |
| Streaming UI live (Stop control present mid-generation) | **PASS** | v2 C4/C6 |
| Stop mid-generation | **PASS** | Partial code text preserved + honest label "Generation stopped — the text above is incomplete." (`v2-c6-stopped.png`, `c6-after-stop.png`); composer NOT disabled after failure; Retry offered for error states |
| Retry after stop (re-send same prompt) | **PASS with note** | Server-side retry-collapse kept the DB clean — exactly ONE user row for the repeated prompt (verified read-only in `db/custom.db`); the UI shows the stopped turn's bubble plus the optimistic re-send bubble until refresh (cosmetic; server truth correct — reported, not "fixed", per scope discipline) |
| Markdown rendering | **PASS** | Live answer rendered heading + bold bullet list + syntax-highlighted code blocks (`c5-markdown.png`); DOM counts headings=1 list=8 code=11 |
| Project files created + workspace restored | **PASS** | "created index.html / styles.css / app.js" chips; files restored from server after refresh (source of truth) |
| Refresh persistence | **PASS** | After full reload: rail shows the project (2 files); reopening it restores all 3 prompts **exactly once each** + persisted Markdown answer + files (`v3b-history.png`, 5/5 PASS) |
| Duplicate messages (DB truth) | **PASS** | Read-only sqlite: 1 user row per prompt, no duplicates (`db/custom.db`, eval accounts only) |
| Console/page errors | **PASS** | 0 uncaught page errors, 0 console errors (filtered) across all 4 browser runs |
| HTTP 5xx/502 | **PASS** | 0 across all runs |
| Session persistence (cookie on public origin) | **PASS** | v3 login → dashboard → reopen project |

### 5.3 Long streaming through the public preview — platform ingress cap discovered (**BLOCKED**)

A systematic cutoff experiment (same dev server, same long prompt, raw HTTP):

| Path | Duration | Chars | Terminal frame |
|---|---|---|---|
| public ingress | 29.29 s | 13,166 | **done ✓** (finished just under the cap) |
| public ingress | 30.15 s | 13,118 | **none — connection cut mid-stream** |
| public ingress | 30.62 s | 8,912 | **none — cut** |
| public ingress | 32.59 s | 7,308 | **none — cut** |
| `127.0.0.1:3000` (ingress bypassed) | **42.14 s** | 15,795 | **done ✓** |

**Conclusion:** the platform ingress in front of the public preview terminates streaming responses at ≈30 s total duration. This is a deployment-level constraint, not an application defect: the standalone app streams 57 s answers fine (§3), the direct local stream ran 42 s to completion, and the UI handles the cut exactly as designed — typed "Response interrupted — the text above is incomplete.", partial text preserved, composer stays enabled, retry offered, server-side generation unwound cleanly (no zombie persistence, `client_disconnected` logged, no `Controller is already closed`).

**Consequences for CHECK 3:** short and medium streaming through the public preview **PASS**; generations requiring > ~30 s through the public URL cannot complete **until the platform raises the ingress streaming timeout** — reported as BLOCKED with the evidence above rather than hidden.

### 5.4 Screenshots

`scripts/giftz-verify-out/preview-e2e/`: `c1-landing.png`, `c2-dashboard.png`, `c4-short-answer.png`, `c5-markdown.png`, `c6-streaming-before-stop.png`, `c6-after-stop.png`, `c7-after-retry.png`, `c8-after-refresh.png`, `v2-c4-short.png`, `v2-c6-stopped.png`, `v2-c7-retry.png`, `v3-history.png`, `v3b-history.png`.

---

## 6. Final regression

### 6.1 Four commands (fresh, this session)

| Command | Result |
|---|---|
| `bun test` (project's actual runner — `npm test` is not defined in package.json) | **884 pass / 0 fail** (56 files, 28,627 expect calls, 16.4 s) |
| `npx eslint .` (equals `npm run lint`) | **0 errors, 0 warnings** |
| `npx tsc --noEmit` | **11 errors — ALL pre-existing, ALL in `scripts/`** (build fixtures, merge-backup snapshots, seed & retrieval-verify utilities). `src/` is clean; today's `route.ts` changes introduced **zero** new errors. Old/new separation unchanged from the prior session's baseline. |
| `npm run build` (equals `next build` + standalone assembly) | **✓ compiled successfully** (5 successful builds this session; final build reflects the final source state; `.next/standalone/server.js` present) |

### 6.2 Changed files (complete list for this ticket)

| File | Change |
|---|---|
| `src/app/api/code-giftz/chat/route.ts` | Response-contract disciplines only: await/.then two-case timing precision, fluent-chain rule, chained-then-never-lost rule, FIFO-back emphasis, prose edge-case + purity + indexing-convention requirements, two-Set data-structure rule, ordering-property naming, complexity restatement, running-output-list + position-by-position final check, two execution-verified worked examples (restructured: rules deduplicated, examples moved to the end for recency). **No** logic, persistence, streaming, UI or provider changes. |
| `scripts/giftz-prompt-tighten.py`, `scripts/giftz-stream-cutoff-test.sh`, `scripts/giftz-preview-e2e.sh`, `scripts/giftz-preview-e2e-v3.sh` (+v3b) | New verification tooling (probe splice, ingress-cutoff experiment, browser E2E) |
| `scripts/giftz-verify-out/…`, `evals/code-giftz/results/…` | Fresh evidence artifacts (health probe JSON, 20 benchmark JSONs, 1 stream JSON, SSE captures, 13 screenshots) |

**Unchanged:** all other product code, UI components, provider configuration, middleware, auth, Prisma schema, migrations.

### 6.3 Isolation & safety

- **No orphan/duplicate servers:** the only listener is the platform's own preview (`:3000`, pid 1135). The eval script's `trap` killed its :3100 instance after every run (verified after the final run).
- **No production data damage:** the real DB received only new rows under dedicated `gz-*@bean-test.dev` / `gz-streamtest-*@bean-test.dev` eval accounts (verified read-only). No existing user/project rows read-modified-written; all destructive operations ran against `scripts/giftz-verify-out/verify.db`.
- **No credentials leaked:** `.env` inspection output was redacted before printing; no tokens/keys appear in logs, reports or screenshots.
- **No unexpected migrations:** `prisma migrate` never invoked.

---

## 7. Remaining limitations

1. **Benchmark variance (primary):** single-run 67/67 not achieved; best 66/67. Root causes exhausted at the prompt level; the residual needs a model-side self-verification pass (feature work, out of scope) or a provider-side determinism knob.
2. **Public-preview ingress ≈30 s streaming cap (platform):** long generations through the public URL are typed-interrupted with partials preserved. Requires a platform-side timeout increase; the application side is already correct.
3. **Retry-after-stop UI cosmetics:** after re-sending a stopped prompt, the conversation shows both the stopped turn's user bubble and the re-send's optimistic bubble until refresh; the server (and every later refresh) keeps exactly one. Cosmetic only; left unchanged per scope discipline.
4. **Pre-existing tsc errors (11):** all in `scripts/` utilities; tracked since the prior session; untouched.
5. **Environment regeneration wipes `.next/standalone` and `.env` extras:** both failure classes already have durable mitigations (rebuild on demand; platform-scope origin fallback) — rebuild was required once this session.

---

## 8. Final status (four-state)

| Verification item | Status |
|---|---|
| Provider health / 429 recovery | **PASS** |
| Real-provider streaming (`stream 240`, isolated production instance) | **PASS** |
| Fresh benchmark 67/67 in one run (`bench 240`, 20 fresh runs, 12 root-cause fixes) | **FAIL** (best 66/67; all 67 checks individually demonstrated; variance documented) |
| Public preview recovered (platform-managed, real DB, current source) | **PASS** |
| Short/medium streaming via public preview (real browser) | **PASS** |
| Stop / retry / duplicate-message / refresh-persistence / Markdown (real browser) | **PASS** |
| Long streaming > 30 s via public preview | **BLOCKED** (platform ingress streaming cap; app behavior correct) |
| Regression: test / lint / tsc / build | **PASS** (tsc: 11 pre-existing `scripts/` errors, separately reported) |
| Isolation, safety, no credentials leaked | **PASS** |

**Overall: completion is NOT claimed.** Real-provider streaming and every preview interaction check pass with fresh evidence; the fresh benchmark improved from 65/67 (historical) to a best of 66/67 across 20 disclosed fresh runs but did not reach 67/67 in a single run. The two concrete blockers for full completion are (a) the benchmark's residual single-check variance — fix path: model-side answer self-verification pass; (b) the platform's ~30 s ingress streaming cap — fix path: platform timeout configuration. Everything else required by the work order is verified green with reproducible evidence.
