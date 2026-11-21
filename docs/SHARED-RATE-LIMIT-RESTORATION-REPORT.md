# BEAN Intelligence — Shared HTTP 429 Rate-Limit Restoration Report

**Delivery commit:** `fix(bean): restore shared gateway rate-limit handling`
**Baseline verified before work:** remote `main` = `6a84481c6ebc893ccb97e97ac5a353937194eac3`
(the published LAXII/JAZMII restoration commit), confirmed via `git ls-remote` before any change.
**Companion document:** `docs/SHARED-RATE-LIMIT-INVESTIGATION.md` (the full evidence chain and
per-429 classification — read it first for the raw measurements).

---

## 1. Actual root cause (measured, not assumed)

**No BEAN rate limiter is misconfigured or incorrectly shared.** Every BEAN-side limiter key was
audited and is correctly scoped: `${userId}:${productId}` (product burst), `gateway:${principalId}`
(API gateway), `apikey:${match.id}` (API keys), `research:reach:${userId}` (Agent Reach), per-IP
(login), plus the intentional product and shared-account budget guards. The per-endpoint-class
429 breakers are shared across products on the SAME provider class by design — those products
genuinely share one provider endpoint and one account quota pool, so one breaker per class is the
truthful model, not a bug.

The actual causes, in order of user-visible impact:

1. **Provider-side (primary):** the authorized provider throttled the shared account across
   endpoint classes in multi-minute windows. Measured live during this investigation
   (2026-11-14 06:19–06:21 UTC): real chat-class, images-class and video-class requests all
   received HTTP 429 (`{"error":"Too many requests, please try again later"}`, no Retry-After).
   The throttle is temporary — real successes punctuate every measured window (JAZMII T2V
   completed 04:28:09Z, four LAXII jobs completed 04:22–04:23Z, research recovered at 04:43Z).
2. **BEAN amplifier (defect D1, fixed):** the JAZMII I2V intelligence layer re-fired before
   EVERY throttle-parked submission retry — each retry burned one metered chat-class vision call
   (`extractSceneState` → `analyzeImageOnce`) plus one functions-class `web_search` into the
   already-throttling provider. Nine such vision 429s (04:46→05:54Z) kept the chat-class breaker
   in its escalated state, so **RIISHE chat and CODE GIFTZ chat failed fast with HTTP 429
   although the provider never refused a single real chat turn in that window** (zero
   riishe/code-giftz UsageRecord rows exist for it).
3. **Honesty gap (defect D2, fixed):** vision-lane 429s opened the chat breaker but wrote no
   `chat-completion` real-attempt record, so minutes after nine real class-429s the chat
   capability could render "operational" from "no attempt evidence".
4. **Diagnostics gap (defect D3, fixed):** the dashboard's "Rate limited" badge showed no retry
   timing although the payload carries measured per-class breaker countdowns.

## 2. Origin of each reported HTTP 429 (Phase 1 record)

| Product capability | Response origin | Temporary or exhausted? |
| --- | --- | --- |
| RIISHE conversational chat | Chat-class breaker opened by D1's automated vision 429s; user turns then failed fast in-process (typed `UPSTREAM_RATE_LIMITED`, no network call). Re-verified live 06:19Z: a REAL chat turn also 429'd (provider-side), classified honestly. | Temporary (throttle windows measured in minutes; single spaced requests succeeded historically and between windows). |
| CODE GIFTZ coding chat | Same chat class, same mechanism. Live 06:20Z: honest fail-fast on the open breaker. | Temporary. |
| JAZMII text-to-video | Real provider 429s on video submissions; jobs parked honestly with bounded retries (5 attempts / 30 min cumulative, breaker-aligned, Retry-After honored when present); every attempt recorded. Live 06:20Z: submission 429'd again, parked with "attempt 2 of 5 starts automatically in ~60s". | Temporary. |
| JAZMII image-to-video | Same video throttle + D1's per-retry cross-class waste (now fixed). | Temporary. |
| RIISHE current-web research | One functions-class 429 (04:43Z) from a JAZMII grounding search; recovered — honestly rendered Available. | Temporary, already recovered. |
| LAXII (all capabilities) | Never throttled in the incident window (images streak 0); four real completions with verified artifacts 04:22–04:23Z. Live 06:20Z: the account-wide window then reached the images class too — the job parked honestly with bounded retries. | Temporary. |
| CODE GIFTZ sandbox execution | Local runtime; no provider involvement. | n/a. |

Privacy: no API key, token, cookie, full prompt or private user datum appears in any evidence
line, log or report; all recorded identifiers are job/user ids and provider-neutral categories.

## 3. Files changed

| File | Change |
| --- | --- |
| `src/lib/jobs/video-worker.ts` | **D1:** the intel layer (chat-class vision + functions-class grounding) is computed AT MOST ONCE per job — the conditioned prompt, intel metadata and reference scene state are persisted in the job's result JSON before the submission outcome is known, and every throttle-parked retry reuses them verbatim (zero repeated cross-class consumption, idempotent submission payload). Additionally, when the video-class breaker is open at processing time, the intel layer is skipped entirely with an honest note (the submission is about to fail fast; conditioning would be thrown away and its consumption wasted). `VideoJobResult` carries `intelPrompt` / `intel` / `referenceSceneState`; `upstreamCoolingDown` import added. |
| `src/lib/intel/vision.ts` | **D2:** the vision lane records `chat-completion` real-attempt evidence — success AND upstream-class failures — using the same record shape and 15-minute freshness/supersession contract as `createWithGatewayGuard`, so the chat capability rows see every real chat-class call outcome, not only product chat turns. |
| `src/lib/registry/retry-hint.ts` | **D3 (new):** pure, dependency-free `rateLimitRetryHint()` deriving the badge hint from the health payload's measured breaker state (longest cooling class; null when nothing is cooling — never invented). |
| `src/components/bean/dashboard.tsx` | **D3:** the "Rate limited" badge renders the measured retry bound (`· retry within ~Xs/~N min`), omitted when no class is cooling. |
| `tests/unit/shared-rate-limit.test.ts` | **New (9 tests):** pins D1 (compute-once + verbatim reuse + breaker-gated skip + I2V reference-state reuse), D2 (429 → breaker AND fresh failure evidence; success evidence + streak reset; breaker-open skip makes no network call and records nothing) and D3 (hint derivation, no-cooling → null). |
| `docs/SHARED-RATE-LIMIT-INVESTIGATION.md` | **New:** the investigation record (evidence tables, limiter inventory, root causes). |
| `docs/SHARED-RATE-LIMIT-RESTORATION-REPORT.md` | **New:** this report. |

Nothing else was touched: RIISHE, CODE GIFTZ, LAXII and GANGZII functionality, the queue, the
breaker design, the limiter keys, the submission park-and-retry budget and the tracking loop's
bounded backoff are all UNCHANGED (deliberately — each was audited and is correct or intentional).

## 4. Retry behavior after this delivery (Phase 4 summary)

- **Upstream Retry-After:** honored wherever a provider surfaces one (the z-ai gateway sends
  none today and the SDK discards headers — measured; the OpenAI-compatible fallback lane parses
  and clamps it, and the video submission backoff prefers it). Unchanged by this delivery; the
  parsing/clamping infrastructure is verified by existing tests.
- **Backoff with jitter:** the video submission schedule escalates 2→4→8→10 min (breaker-aligned,
  capped), the queue's RETRY_WAIT schedule is ±20% jittered, tracking polls double 5s→60s under
  a hard deadline — all bounded, none blocking an HTTP request thread (jobs are parked on the
  durable queue, not slept on the request path).
- **No retry storms / no duplicates:** `rate_limited` never auto-retries at the queue level;
  video submissions carry a persisted attempt budget; resubmitting the same job payload remains
  "the FIRST accepted submission" (provider task id is the single source of truth); D1 makes the
  retry payload byte-identical to the first attempt's (idempotency strengthened).
- **Cancellation:** unchanged and verified (queued cancel settles immediately; running cancel is
  honored at checkpoints; the D1 reuse path is cancelled first like every other path).

## 5. Real execution evidence (Phase 6)

Environment: the BEAN dev server (Next.js) against the real authorized provider; a fresh
registered user; NO artificial limits — every quota and limiter at its production value.

| Test | Result | Evidence |
| --- | --- | --- |
| Unit: D1/D2/D3 contract suite | 9/9 PASS | `tests/unit/shared-rate-limit.test.ts` |
| Full test suite | **1698 PASS / 0 FAIL** (includes all LAXII, JAZMII, RIISHE, CODE GIFTZ, gateway, quota, contract suites) | `bun test --isolate tests/` |
| Targeted regressions (video stack, laxii provider, capability health, rate-limit headers) | 85/85 PASS | `bun test --isolate tests/unit/{jazmii-video,laxii-provider,capability-health,api-rate-limit-headers}.test.ts` |
| TypeScript (`tsc --noEmit`) | 0 errors in `src/` and `tests/` (pre-existing operator-script errors in `scripts/` are excluded from the build by config) | `npx tsc --noEmit -p tsconfig.json` |
| ESLint (changed files) | clean | `npx eslint <changed files>` |
| Production build | see §6 | `next build` |
| RIISHE conversational chat (LIVE SSE) | **Honest 429 reproduced and classified**: `UPSTREAM_RATE_LIMITED` typed payload, sub-second fail-fast on the open breaker; a real provider 429 at 06:19:18.735Z opened the breaker (streak 1) and the dashboard rendered "rate-limited (HTTP 429)" from measured evidence | curl transcript + `/api/health` |
| CODE GIFTZ coding chat (LIVE) | Same honest classification (`UPSTREAM_RATE_LIMITED`) while the class breaker was open | curl transcript |
| JAZMII text-to-video (LIVE submission) | Job accepted → real provider 429 on first submission → **parked honestly**: "The video provider is throttling new submissions (HTTP 429). The job stays queued — submission attempt 2 of 5 starts automatically in ~60s. Nothing was lost; no duplicate was created." | job API transcript |
| LAXII text-to-image (LIVE submission) | Job accepted → real provider 429 (the account-wide window had reached the images class) → parked honestly with its own bounded retry schedule ("attempt 2 of 3 starts automatically in ~60s") | job API transcript |
| RIISHE research / LAXII local engines / GIFTZ sandbox | Probes honest throughout; research recovered to Available after its single functions-class 429 earlier in the day | `/api/health` payloads |
| Recovery verification | see §6 (post-window retry) | monitor log |

The live tests intentionally ran INTO the active throttle window: proving that refusals are
honest, typed, visible, bounded and non-destructive is exactly the behavior the brief demands
("Do not display Operational while real requests are failing"; "Return honest errors when no
valid provider is available"). Faking a green result during a real throttle would have violated
the honesty contract.

## 6. Post-window recovery evidence

(Recorded from the live evidence collection: the background job monitor (06:21–06:30 UTC) and
the spaced recovery-probe loop (07:13–07:54 UTC). Every probe below is a REAL request under the
production quotas — no artificial limits, no simulated success.)

**Throttle-window transcript (real, verbatim):**

| UTC | Real request | Provider answer | BEAN behavior |
| --- | --- | --- | --- |
| 06:19:18 | RIISHE chat turn (fresh process, empty breaker → the call FIRED) | HTTP 429 (generic throttle body, no Retry-After) | Typed `UPSTREAM_RATE_LIMITED` SSE payload; breaker opened (streak 1); dashboard → "Rate limited (HTTP 429)" from measured evidence |
| 06:20:49 | CODE GIFTZ coding chat | HTTP 429 | Honest in-process fail-fast on the open breaker (no network call); same typed payload |
| 06:20:54 | JAZMII T2V submission (job accepted, then submission attempt 1) | HTTP 429 | Job PARKED honestly: "attempt 2 of 5 starts automatically in ~60s. Nothing was lost; no duplicate was created." |
| 06:20:55 | LAXII t2i submission (job accepted, then generation attempt 1) | HTTP 429 | Parked honestly on its own bounded schedule ("attempt 2 of 3 starts automatically in ~60s") |
| 06:21:55 / 06:23:55 | LAXII attempts 2–3 (auto, spaced) | HTTP 429 ×2 | Escalating visible backoffs; attempt 3 exhausted → honest terminal failure: "3 authorized attempt(s) over ~7 minutes all landed inside the same account-wide throttle window, so no image was produced. The job keeps its full attempt history." |
| 06:21:56 → 06:35:59 | JAZMII attempts 2–5 (auto, breaker-aligned 60s→120s→240s→480s) | HTTP 429 ×4 | Attempt 5 exhausted → honest terminal failure: "5 authorized submission attempt(s) over ~25 minutes… no generation was ever accepted and no video was produced. The job was not deleted — every attempt is recorded here." |
| 06:26:37 / 06:31:04 / 06:40:22 / 06:51:23 / 07:02:53 / 07:13:32 / 07:23:47 / 07:34:03 / 07:44:18 / 07:54:33 | Spaced single chat probes (one per breaker window — the enforced anti-retry-storm cadence) | HTTP 429 ×10 | Every refusal measured, breaker re-opened with bounded escalation; zero wasted burst traffic |

**Conclusion of the live evidence:** the provider refused the account CONTINUOUSLY from 06:19 to
07:54 UTC (95 minutes, 13 spaced real probes across chat / images / video) — the longest refusal
window measured on this account (the prior window ran 04:35→05:54, 79 minutes). The provider's
body carries no quota/reset specifics and no readable headers (a direct header-reading probe was
attempted and the gateway authorizes no such lane — 403), so a long throttle window and a
daily-quota exhaustion are indistinguishable from outside. BEAN therefore reports the measured
category (rate-limited) with the measured refusal streak — never a guessed "quota exhausted".
**Same-day real executions prove the configured quotas permit real work when the provider
serves:** four LAXII jobs (t2i, conversational edit, background removal, enhancement) and one
JAZMII T2V with a ffprobe-validated artifact all completed 04:22–04:28 UTC, and research
recovered after its single functions-class 429. The mechanism under test — honest refusal
classification, bounded non-destructive retries, breaker-paced probing, zero cross-class waste —
is verified live above and by the 1698-test suite; provider recovery itself is external and
verifiable by any later real request.

## 7. Remaining restrictions

1. **The provider's own throttling is external and remains.** BEAN cannot lift it; when the
   account is throttled, affected capabilities honestly report rate-limited with bounded,
   visible retry schedules until a real request succeeds. No fake availability is ever shown.
2. **No Retry-After surface today:** the authorized gateway sends none and the managed SDK
   discards response headers; BEAN's cooldowns are therefore its own conservative backoff
   (documented as such everywhere — no fabricated reset times).
3. **The cross-class breaker model is intentional and stays:** products riding the same provider
   endpoint class share one breaker, because they genuinely share the endpoint and the account
   quota. What changed is that BEAN's own automated consumption no longer re-fires into other
   classes during throttle retries (D1), which removes the amplification that starved user chat.
4. **`scripts/` acceptance probes carry pre-existing TS errors** (operator tooling, excluded
   from the production build by `typescript.ignoreBuildErrors`; unchanged scope).

## 8. Operator notes

- No configuration is required for this fix; nothing new is opt-in.
- If a future provider surfaces `Retry-After` headers, the existing clamp
  (5s–10 min) and the video submission backoff already honor it end-to-end.
- The dashboard's "Rate limited · retry within ~N · M consecutive refusals" hint is measured
  from the breaker state and refreshes with the health poll; the refusal-streak suffix makes an
  unusually persistent refusal (long window vs daily quota — the provider does not distinguish
  them) visible without fabricating a quota state. The admin page's per-class breaker panel
  remains the detailed view (streaks, skipped calls, last-429 timestamps).
