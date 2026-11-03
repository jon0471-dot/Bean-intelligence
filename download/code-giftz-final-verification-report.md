# CODE GIFTZ — FINAL PRODUCTION VERIFICATION & COMPLETION REPORT

**2026-11-03, 10:10 UTC** · Verification-only session (GIFTZ-FINAL-VERIFY). Implementation was completed in prior sessions; this session executed the three verification checks, recovered the public preview, and ran the full regression/safety suite.

---

## 1. Executive summary

| Check | Status | One-line result |
| --- | --- | --- |
| CHECK 1 — Real-provider streaming verification | **BLOCKED** | Upstream gateway in a sustained HTTP 429 throttle window (continuous 07:40 → 10:10+ UTC, ≥ 2.5 h, re-probed with bounded backoff; the typed-failure path was verified live end-to-end, but **no long generation could complete — not PASSED, per the acceptance rule**) |
| CHECK 2 — Fresh Q1–Q6 benchmark | **BLOCKED** | Same gateway dependency; the bench command was attempted per protocol and skipped without burning attempts; **no fresh scores exist and no historical results are reused** |
| CHECK 3 — Public preview recovery | **PARTIAL — 9/13 items PASS live; 3 items BLOCKED, 1 NOT TESTED** | Preview genuinely recovered on port 3000 via the platform's own startup path; public URL, real-DB auth, message submission, error handling, retry, post-failure recovery, refresh, console and network all verified in a real browser; streaming-dependent items blocked by the same gateway throttle |

**Overall: NOT fully verified.** Two of three checks are blocked by one external dependency (the upstream AI gateway), and the third is partially blocked by the same dependency. Everything executable without the provider was executed and passed with live evidence. No defects requiring code changes were found during verification (the preview recovery was an operations fix — relaunching the platform's own startup script — not a code change).

---

## 2. CHECK 1 — Real-provider streaming verification · **BLOCKED**

### 2.1 Gateway availability inspection (per §1.1)

- Configured provider: the platform-authorized gateway via `z-ai-web-dev-sdk` (no model/provider change made or permitted).
- Health verification: `GET /api/health` → `ok: true, live: true` with `products.riishe.available: false`, probe detail *"Upstream gateway rate-limited (HTTP 429) — probe rejected"* — **continuous from 07:40 UTC (first probe of the day) through 10:10 UTC (last probe)**, re-checked at 09:11, 09:25, 09:36, 09:45, 09:58, 10:09 and by every eval attempt.
- `Retry-After` headers: **not exposed** by the provider SDK (inspected `z-ai-web-dev-sdk` — no Retry-After surface; `src/lib/upstream/gateway.ts` documents the measured behavior: single spaced requests still receive 429 six+ minutes after a burst, so the window is long and heuristic backoff is the only option).
- Rate-limit respect: the app holds a 60 s post-429 circuit breaker (`UPSTREAM_429_COOLDOWN_MS`, sliding) so no call is wasted or hammering; the eval harness probes the app's own health endpoint every 30 s (breaker-gated, so real requests only when the breaker is open) and **skips the eval entirely (exit 2) rather than burning attempts** when the window stays closed. No credential rotation, no throttling bypass.

### 2.2 Streaming test execution

`scripts/giftz-eval-run.sh stream 240` — invoked per protocol (09:11, 09:25, 10:0x); each run: bounded wait loop → never healthy → **skipped without attempts**. Consequently the long-response metrics (request ID, TTFT, delta count, char count, terminal event, byte-exact persistence) **could not be produced this session and are NOT fabricated**. Status: **BLOCKED**.

Live evidence that WAS produced on the real provider path this session (the throttled gateway exercises the typed failure path end-to-end, HTTP → SSE → UI):

- SSE turn returns **exactly one terminal frame**: `{"error":"The upstream AI gateway is rate-limited right now (HTTP 429). … your question is kept below, so you can retry without retyping it.","code":"UPSTREAM_RATE_LIMITED","partial":true}` — `done` correctly absent, zero deltas, **no generic "network error" anywhere**, no crash.
- Server log shows typed `codegiftz.chat_failed` records and **zero occurrences of the historical crash signature `Invalid state: Controller is already closed`**.
- Harness artifacts retained: `scripts/giftz-verify-out/t3-short-prompt.sse`, `t4-retry.sse`, `rc1.sse`, `rc2.sse`.

Most recent completed real-provider streaming run (prior session, post-fix build, retained as prior evidence — **not** claimed as this session's verification): 20,588 chars / 4,667 deltas / 51 s / terminal `done` / streamed == persisted byte-exact / zero duplicate assistant messages.

### 2.3 Failure-mode matrix (§1.3)

| Failure mode | Status | Evidence |
| --- | --- | --- |
| Gateway HTTP 429 | **PASS (live)** | typed `UPSTREAM_RATE_LIMITED` frame, `partial:true`, honest wording; 429 recorded in server log; UI renders the typed error card (screenshot `e2e-error-visible.png`) |
| Recovery after failure | **PASS (live)** | second message after a failed turn succeeded in reaching the API and rendering its own (typed) outcome; UI Retry re-invoked the turn; chat never disabled |
| Gateway disconnect / idle timeout / overall timeout / user cancellation / partial-response interruption | **NOT TESTED live — requires an active generation (gateway-blocked)**; pinned by 45 unit tests running the real lifecycle with fault-injected deps: `cancel()` mid-generation unwinds with no error frame and releases once; `request.signal` abort unwinds; idle/total guards raise labeled timeouts; truncation preserves partial text on the wire; a fully generated answer persists exactly once even when the client vanishes |
| Upstream billing cancellation | **NOT TESTED / not claimable** — the authorized SDK exposes no AbortSignal; no claim of provider-side cancellation is made (recorded limitation) |

### 2.4 Duplicate-persistence guarantees (verified without the gateway)

- Failed turns persist **zero assistant rows** (live DB assert on the isolated copy: `ASSISTANT_ROWS_TOTAL: 0`).
- Retry idempotency: retrying a failed turn within the same project collapses the duplicated trailing user prompt (live: **1 user row / 0 assistant rows** after UI-flow retry — `RETRY-COLLAPSE PASS`); a failed *first* turn (no `projectId` yet) legitimately starts a fresh project on retry — still no duplicate rows, observed live in the browser (3 sidebar projects, each with exactly one user row, on the isolated copy; mirrored on the real DB by the clearly-named `browsere2e-*` account used for the preview E2E).

## 3. CHECK 2 — Fresh benchmark · **BLOCKED**

`scripts/giftz-eval-run.sh bench 240` — same gateway throttle; the harness waited its bounded window and skipped (no attempts burned, nothing fabricated). **No fresh Q1–Q6/R1–R4 scores are reported and the historical 65/67 is explicitly NOT reused.** The runner, question pack, and executed-ground-truth mechanism are in place and unattended-ready: per-question content checks (Q1 exact FIFO order `A F H C E G D B` + chained-`.then` timing; Q2 Set-based O(n) with insertion-order justification; Q3 Map-based with the verified `[-1,-2,-3,-4,-5] → [1, 2]` derivation; Q4 sliding window + UTF-16/code-point/grapheme precision incl. `Intl.Segmenter`; Q5 LIFO stack + explicit non-bracket contract; Q6 first-occurrence main function + safe midpoint + O(1)/O(log n) space split; R1–R4 ground truth computed by executing the snippets) plus per-question byte-exact persistence checks.

## 4. CHECK 3 — Public preview recovery · **PARTIAL (9 PASS / 3 BLOCKED / 1 NOT TESTED)**

### 4.1 Startup configuration inspection (§3.1)

| Item | Finding |
| --- | --- |
| Platform boot | `start.sh` → init → **"custom dev script"** (runs `package.json "dev"`) → "Starting Caddy server" (boot timeline `/tmp/boot-timeline.log`, last boot 03:25:36 UTC) |
| `package.json "dev"` | `next dev -p 3000 2>&1 \| tee dev.log` — port hard-pinned to **3000** |
| `package.json "start"` | `NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATABASE_URL=file:/home/z/my-project/db/custom.db bun .next/standalone/server.js` — production fallback also pinned to **3000 + real DB** |
| Next config | `output: "standalone"`; fresh standalone build present |
| Ingress | Caddy `:81` default handle → `reverse_proxy localhost:3000` (platform-managed; not modifiable from the sandbox) |
| Port env | No PORT set in `.env`/project files — the 3100 incident (previous session) was a stale captured launch env, already neutralized by the script-level pins |
| DB env | `.env` → `DATABASE_URL=file:/home/z/my-project/db/custom.db` (real DB only; no test/mock DB referenced anywhere in startup) |

Root cause of the 502 (reproduced): the platform's dev server was OOM-killed at ~06:40 UTC (kernel log, previous session's build memory spike) and the platform never re-booted (sandbox uptime 6h28m, last boot 03:25) → nothing listened on :3000 → ingress 502.

### 4.2 Recovery (§3.2)

Relaunched **the platform's own boot path** (`npm run dev`, the exact command `start.sh` runs) on **:3000** — not a second server, not a :3100 workaround. Result:

- `:3000` LISTEN — `next-server` pid 11219; `GET /` → 200; `/api/health` → 200 `ok:true live:true`.
- **Public preview URL** `https://preview-chat-5607195a-212f-4a85-8f55-146057425b38.space-z.ai/` → **200** through the real ingress (measured with curl AND in a real browser).
- Real-DB connection proven by write path: registered `browsere2e-1793699882@bean-test.dev` through the public URL; row verified present in `db/custom.db` (read-only check). No test/mock database in the serving path.
- Startup does not depend on a manually maintained process in the configuration sense: the platform's own boot sequence reproduces this state on every future boot (both `dev` and `start` scripts are pinned to :3000 + real DB). The relaunch is the same command the platform runs.
- No secrets exposed in logs (server logs contain only typed lifecycle events; no credentials printed — verified by scan).

### 4.3 Browser E2E on the public preview URL (§3.3) — real browser (agent-browser), not localhost curl

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Application loads | **PASS** | title `BEAN Intelligence — Brand-Owned AI Platform`, dashboard renders |
| 2 | Login / existing authentication | **PASS** | signed in via the UI form against the real DB; session cookie persisted |
| 3 | Existing conversations remain accessible | **PASS** | sidebar projects persisted; session + data survived refresh (this session used a dedicated E2E account — real users' conversations untouched) |
| 4 | New user message can be submitted | **PASS** | prompt submitted in CODE GIFTZ; message bubble + project created |
| 5 | Short response streams correctly | **BLOCKED** | gateway 429 → typed error instead of a stream (correct behavior; a real stream needs the provider) |
| 6 | Long response streams correctly | **BLOCKED** | same |
| 7 | Markdown / code blocks render | **NOT TESTED (live answer required)** | renderer stack present in the served bundle (`react-markdown`/`react-syntax-highlighter` chunks load, HTTP 200); rendering of an actual streamed answer needs the provider |
| 8 | Stop generation works | **BLOCKED** | requires an active stream; pinned by unit tests (cancel unwinds, releases once, no error frame) |
| 9 | Error handling works | **PASS** | typed 429 error card with Retry button rendered in the UI (screenshot `e2e-error-visible.png`); question text preserved |
| 10 | Failed request doesn't disable chat | **PASS** | UI Retry executed; a second, different message submitted and processed after failures (screenshot `e2e-post-failure.png`) |
| 11 | Refresh doesn't break | **PASS** | reload → session, dashboard and workspace intact; `/api/auth/session`, `/api/products`, `/api/code-giftz/chat` all 200 |
| 12 | No critical console errors | **PASS** | console: only dev-mode info (React DevTools hint, HMR connected, Fast Refresh); **zero page errors** |
| 13 | No 502/500/failed requests | **PASS** | full network log: every request 200/304 (scripts, fonts, API calls) — zero ≥ 400 |

### 4.4 One operational observation (no defect against the checks; no code change made)

A failed *first* turn never learns its `projectId` (the typed error frame deliberately carries none), so retrying it from the UI starts a fresh project rather than reusing the empty one; each failed-turn project holds exactly one user row and zero assistant rows — **no duplication of user or assistant content anywhere** (verified live). Mid-conversation retries reuse the project and engage the server-side collapse (verified: 1 user row / 0 assistant rows). Left unchanged deliberately: this is cosmetic, unrelated to the three checks' pass criteria, and any change would violate the verification-only scope.

## 5. Regression checks (final gates)

| Gate (work order name → actual) | Result |
| --- | --- |
| `npm test` → **`bun test`** (package.json has no `test` script — inspected and used the project's actual runner) | **884 pass / 0 fail** (56 files, 28,627 assertions), incl. 45 new streaming reliability tests |
| `npm run lint` | **exit 0, zero problems** (project-wide) |
| `npx tsc --noEmit` | **11 errors — ALL pre-existing, ALL in `scripts/`**; zero in `src/`, `tests/`, `evals/`. Breakdown: `scripts/build-e2e-fixtures.ts` (1, Oct 26, missing `xlsx` types), `scripts/merge-backup/src-running/**` (7, Oct 29, stale backup of an old source tree), `scripts/seed-giftz-project.ts` (1, Nov 3 02:19 — predates the streaming work), `scripts/verify-retrieval-live.ts` (2, Oct 28, stale pipeline API). **None of the changed files (route.ts, code-giftz.tsx, chat-stream.ts, retry.ts, sse-client.ts, gateway.ts, evals/*, tests/*) contribute any error.** Not claimed as zero |
| `npm run build` | **✓ Compiled successfully, exit 0** (run with the dev server controlled to avoid the OOM class that killed it on Nov 3 ~06:40) |

## 6. Changed files

**This verification session changed NO product code.** Files touched this session (all verification/ops artifacts):

| Path | Reason |
| --- | --- |
| `package.json`, `src/**` (route.ts, code-giftz.tsx, sse-client.ts, gateway.ts, chat-stream.ts, retry.ts), `evals/code-giftz/*`, `tests/unit/giftz-*` | **Unchanged this session** — these carry the (prior-session + first-turn) implementation under verification; verified on disk and via gates |
| `download/code-giftz-final-verification-report.md` | this report |
| `scripts/giftz-eval-run.sh` | eval harness (prior turn): isolated :3100 instance + gateway-wait + skip-without-burning-attempts |
| `scripts/giftz-step1-verify.sh`, `giftz-retry-collapse-verify.sh`, `giftz-t5-db-assert.ts`, `giftz-check3-prep.sh` | verification scripts (typed-failure, retry-collapse, DB asserts, preview prep) |
| `scripts/giftz-verify-out/*` (sse captures, screenshots, server.log, verify.db) | live evidence artifacts (verify.db is an ISOLATED COPY — the real DB was never written by evals) |
| `dev.log.pre-recovery-1103` | preserved the 2,988-line dev.log containing the original root-cause evidence before relaunch rotated it |

## 7. Remaining limitations

1. **Upstream gateway throttle (the single blocker).** Sustained global HTTP 429 (≥ 2.5 h at final probe); no Retry-After exposed; long-window behavior measured and documented. Blocks CHECK 1 completion, CHECK 2 entirely, and preview items 5/6/7/8. Everything is staged for instant re-verification when it clears: `scripts/giftz-eval-run.sh stream 240` then `scripts/giftz-eval-run.sh bench 240`.
2. **No upstream AbortSignal** in the authorized SDK — cancelled turns unwind at the next delta (or idle timeout); no provider-side billing-cancellation claim is possible.
3. **`max_tokens` semantics** — unset by default (provider default applies; no silent BEAN cap); when set it is the provider's ceiling; output-length cuts now continue once (bounded) before surfacing typed `UPSTREAM_TRUNCATED` with partial text preserved.
4. **Dev-mode first-hit compile 500s** are a platform-launch-mode artifact (self-healing; all routes were warmed before the browser E2E — the captured network log shows zero ≥ 400).
5. **Model-quality residual** — R3-class scheduling errors can still occur on novel variants (disciplines reduce, cannot eliminate); the regression pack with executed ground truth catches them mechanically once the gateway allows fresh runs.

## 8. Final status

- CHECK 1 Real-provider streaming: **BLOCKED** (external provider; typed-failure + no-duplicate guarantees verified live in its place)
- CHECK 2 Fresh benchmark: **BLOCKED** (no results fabricated; none reused)
- CHECK 3 Public preview: **9/13 PASS (live browser evidence), 3 BLOCKED, 1 NOT TESTED** — infrastructure recovery itself complete and verified
- Overall completion: **NOT CLAIMED** — per the acceptance rule, full verification remains open on exactly one external dependency (the gateway window), with every command and harness ready to produce the outstanding evidence the moment it clears.
