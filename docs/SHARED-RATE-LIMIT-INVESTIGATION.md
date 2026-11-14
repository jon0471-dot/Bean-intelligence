# BEAN Intelligence — Shared HTTP 429 Rate-Limit Investigation

**Status:** investigation complete (Phase 0 + Phase 1); fixes follow in this delivery.
**Baseline verified:** `origin/main` = `6a84481c6ebc893ccb97e97ac5a353937194eac3` (the published
LAXII/JAZMII restoration commit), confirmed with `git ls-remote` before any work.
**Investigation window:** 2026-11-14 04:22–06:08 UTC (live dev server + `db/custom.db` + `dev.log`
+ in-memory breaker state of the running process).
**Method:** repository code audit of every limiter/429 path, then live reproduction against the
running server — no assumption is evidence; every claim below carries its measurement.

---

## 1. The reported dashboard observations, classified

Phase 1 taxonomy (from the brief): 1 = BEAN app limiter, 2 = per-user limiter, 3 = per-project /
API-key limiter, 4 = shared provider gateway, 5 = provider-specific quota, 6 = provider
concurrency, 7 = worker queue / backend, 8 = upstream 429 forwarded without classification.

| Observation | Origin (taxonomy) | What actually happened |
| --- | --- | --- |
| RIISHE conversational chat: HTTP 429 | **4 → 7 (shared chat class opened by another product's automated calls), then 1 (BEAN fail-fast)** | The chat-class breaker was opened by NINE consecutive automated vision-call 429s fired by the JAZMII I2V pipeline (`intel/vision.ts`), not by RIISHE traffic. A real user chat during the open breaker got BEAN's typed fail-fast `RATE_LIMITED` (HTTP 429) without a network call. **No RIISHE chat request was refused by the provider in the window** (zero `riishe` UsageRecord rows exist in the DB). |
| CODE GIFTZ coding chat: HTTP 429 | **Same as RIISHE** | Same endpoint class (`chat`), same breaker, same 9 vision-call 429s. Zero `code-giftz` UsageRecord rows in the window. |
| JAZMII text-to-video: HTTP 429 | **5 → 4 (real provider throttle of the video endpoint), forwarded with honest classification** | Real upstream 429s on video submissions. Provider body: `{"error":"Too many requests, please try again later"}` — no Retry-After, no reset info. Two resubmitted I2V jobs exhausted their bounded submission budgets (5 attempts / 30 min, then 4 attempts / 40 min). |
| JAZMII image-to-video: HTTP 429 | **5 → 4 (same provider throttle), amplified by D1 below** | Same video-endpoint throttle. Each throttled retry ALSO fired one chat-class vision call first (defect D1) — 9 chat 429s total. |
| RIISHE current-web research: Available | **(recovered transient)** | One functions-class 429 at 04:43:16Z (a JAZMII T2V grounding `web_search` inside the throttle window), breaker streak 1, then expiry verified by real traffic. Honest transient. |
| LAXII: Operational | **(never throttled)** | `images` class streak 0 — zero 429s all window. Four real LAXII jobs (t2i, conversational edit, background removal, enhancement) all completed 04:22:40–04:23:13Z with verified artifacts. |
| CODE GIFTZ sandbox execution: Available | **(local, no provider)** | Local sandbox runtime probe; no provider involvement. |

## 2. Measured evidence (verbatim record)

### 2.1 Real execution timeline (UsageRecord / GenerationJob / JobEvent / dev.log)

| UTC time | Event | Evidence |
| --- | --- | --- |
| 04:22:30 | Evidence user registered (`cmwfwger40000qea2u3db51pf`) | AuditLog `auth.register` |
| 04:22:40–04:23:13 | LAXII t2i + conversational-edit + background-removal + enhancement ALL COMPLETED (jobs `cmwfwgmfd…`, `cmwfwgml8…`, `cmwfwgmlt…`, `cmwfwgmq4…`) | GenerationJob 4× `completed`, artifacts verified |
| 04:23:16.691 | JAZMII T2V queued (`cmwfwhe4z001bqea2mwwsomw6`) → **completed 04:28:09.324** with a real ffprobe-validated video | GenerationJob; proves the account was NOT quota-exhausted at 04:28 |
| 04:23:16.707 | JAZMII I2V queued (`cmwfwhe5f001dqea279oo2cve`) — submission accepted ~04:30, then its STATUS POLLING was throttled 04:35:14→04:46:25 (14 consecutive `rate_limited` polls, backoff 5s→60s capped) → honest `BACKEND_TIMEOUT`; provider kept the accepted task | JobEvent + dev.log `jazmii.job_tracking_retry` ×14 |
| 04:43:16.855 | functions-class 429 (`web_search` grounding inside a JAZMII T2V intel pass) — honest degradation logged | dev.log `jazmii.intel_degraded`; breaker `functions` streak=1, last429At=04:43:16.855Z |
| 04:46:46.468 | I2V resubmitted (`cmwfxblxg001tqea2vzikbl6f`) → 4 authorized submission attempts (04:46:47, 04:48:47, 04:52:48, 05:00:49; backoffs 120s→240s→480s→600s, all real 429s) → budget exhausted → failed `RATE_LIMITED` 05:10:49 | JobEvent `submission_throttled` ×4 |
| 05:24:14.038 | I2V resubmitted again (`cmwfyns5x0025qea2jdlsx999`) → 4 authorized attempts (05:24:14, 05:34:15, 05:44:16, 05:54:17; backoff 600s each) → exhausted → failed `RATE_LIMITED` 05:54:17.104 | JobEvent ×4; errorMessage: "The video provider kept throttling submissions (HTTP 429): 4 authorized submission attempt(s) over ~40 minutes…" |
| 04:46:47→05:54:17 | **NINE chat-class vision 429s** — `Failed to make vision API request: Error: API request failed with status 429` at `intel/vision.ts:62` ← `intel/continuity.ts:131 extractSceneState` ← `jobs/video-worker.ts:295` ← the I2V processing above | dev.log ×9 (grep "Failed to make vision API request"); breaker `chat` streak=9, last429At=05:54:17.073Z — 30 ms before the video 429 at 05:54:17.103Z |
| 06:08:02 | Live breaker snapshot: `chat` streak 9 (cooling expired), `functions` streak 1, `images` streak 0, `video` streak 10, `audio` streak 0 | `GET /api/health` → `gateway.breaker.classes` |

### 2.2 Provider behavior measured

- 429 body is the generic throttle wording; **no Retry-After header** (the SDK discards response
  headers entirely — documented in `src/lib/upstream/gateway.ts`); **no reset/quota specifics**.
- The throttle is **temporary, not exhausted**: real successes punctuate it (T2V completion
  04:28:09, LAXII completions 04:22–04:23, research recovery after 04:43).
- All endpoint classes ride ONE provider account (documented measured evidence in
  `src/lib/providers/account-quota.ts`: `x-ratelimit-remaining-daily` counts down across
  RIISHE chat, LAXII images, JAZMII video and CODE GIFTZ alike — 272 → 208 in a prior
  acceptance run).

### 2.3 Limiter inventory (Phase 2 audit — identity and isolation)

| Limiter | Key namespace | Scope | Verdict |
| --- | --- | --- | --- |
| Product burst limiter (`router.ts` preflight) | `${userId}:${productId}` | per user × per product | **Correctly isolated.** `PRODUCT_RATE_LIMITS` (riishe 20, laxii 6, jazmii 6, giftz 15/min) is wired (2026-11-11 fix). |
| Daily product quota | DB count per `userId+product` | per user × per product | Correct. |
| API-gateway limiter (`/api/v1/chat/completions`) | `gateway:${principalId}` | per API principal | Correct. |
| API-key limiter | `apikey:${match.id}` | per key | Correct. |
| Agent Reach limiter | `research:reach:${userId}` | per user | Correct. |
| Login limiter | per IP | per IP | Correct. |
| Per-product provider budget (`cost-guard.ts`) | DB count per product/day | product-global | Opt-in (unset here); intentional operator spend guard. |
| Shared account budget (`account-quota.ts`) | DB count across all products/day | **account-global by design** | Intentional — the provider quota IS account-level. Not a bug. |
| Upstream 429 breakers (`upstream/gateway.ts`) | per ENDPOINT CLASS (`chat`/`functions`/`images`/`video`/`audio`) | **shared across products on the same class** | Intentional and honest: products on the same class hit the same provider endpoint and the same account quota pool, so one class = one breaker is the truthful model. Isolating them per product would fabricate capacity the provider does not grant. |
| Queue retry policy | `rate_limited` never auto-retried by the queue; video submissions have their own bounded park-and-retry budget (5 attempts / 30 min cumulative, breaker-aligned, Retry-After honored when present) | per job | Correct per the 2026-11-08 issues-1-2 repair. |

**Phase 2 conclusion: no BEAN limiter is incorrectly shared or overly restrictive.** The
cross-product coupling the dashboard showed is (a) the intentional account-global provider
quota and (b) defect D1 below — a traffic-generation defect, not a limiter-key defect.

## 3. Root causes

### RC1 (provider, not a BEAN bug) — intermittent account-wide throttle
The authorized provider throttled the account across endpoint classes in multi-minute windows
(all 429 bodies are the generic throttle message; the video class absorbed most of it this
window). Temporary, verified by the successes punctuating the window. BEAN classified every one
of these honestly (`rate_limited` → typed `UpstreamRateLimitError` → `RATE_LIMITED`), never
forwarding a raw 429 as a fake success or a fake outage.

### RC2 / D1 (BEAN defect — THE amplifier) — JAZMII I2V intel layer re-fires on every throttle retry
`jobs/video-worker.ts` runs the intelligence layer (`extractSceneState` → `analyzeImageOnce`
**chat-class vision call**; `prepareVideoIntelligence` → **functions-class `web_search`**) BEFORE
EVERY submission attempt — including every retry of a throttle-parked job. Consequences,
measured: 9 chat-class 429s (streak 9, none followed by a chat success → breaker escalated to
its 10-minute cap each time), 1 functions 429, wasted metered calls into a throttling provider,
and — the user-visible damage — **RIISHE chat and CODE GIFTZ chat failing fast with HTTP 429
although the provider never refused a single real chat turn in the window.** One product's
automated retry consumption starved unrelated products' user-facing capability on the shared
class: exactly the "one product's traffic exhausts unrelated product-specific limits" failure
mode (here the limit is the intentional account-global quota, but the *waste* was avoidable).

### RC3 / D2 (BEAN defect — honesty gap) — vision 429s leave no real-attempt evidence
`analyzeImageOnce` opens the chat breaker on a 429 (`noteUpstream429('chat')`) but never records
a `chat-completion` real-attempt record (`recordChatAttempt` lives only in `hosted-llm.ts`).
Measured consequence at 06:08:02Z: with `chat` streak=9 and the breaker just expired, the health
probe fell through to "no attempt evidence" and rendered **RIISHE chat Operational minutes after
nine real class-429s** — violating "Do not display Operational while real requests are failing."

### RC4 / D3 (BEAN defect — diagnostics) — no retry timing on dashboard rate-limited rows
The payload exposes per-class breaker state (`remainingMs`, `consecutive429s`), and the admin
page renders it, but the main dashboard's "Rate limited" badge shows no retry timing, so a
transient throttle looks open-ended. (Not a status-calculation defect: transient 429s already
expire via the 15-minute attempt freshness window and the ≤10-minute breaker cap.)

## 4. What is NOT a bug (verified, left unchanged)

- Per-endpoint-class breakers shared across products on the same class (truthful shared-quota
  model; isolating them would lie about capacity).
- The video submission park-and-retry budget (bounded, breaker-aligned, Retry-After honored,
  job never destroyed, every attempt recorded; duplicate-safety keyed on the persisted provider
  task id).
- The tracking loop's bounded backoff (5s→60s cap, hard deadline, honest `BACKEND_TIMEOUT`
  verdict; a status poll of an ACCEPTED task is not new work).
- Queue-level `rate_limited` = terminal (never retries into a throttle).
- Quota-free health probes (the 2026-11-10 self-inflicted probe loop is fixed; today's evidence
  contains zero probe-originated 429s).
- Zero secret leakage anywhere in the evidence: no API keys, tokens, cookies, prompts or user
  data in any log line, payload or job record inspected.

## 5. Fix plan (implemented in this delivery)

1. **D1:** compute the JAZMII intel layer ONCE per job — persist the conditioned prompt in the
   job's result JSON on the first attempt and reuse it verbatim on every retry (idempotent
   submissions, zero repeated cross-class consumption). Additionally skip the intel layer
   entirely when the video-class breaker is open at processing time (a submission cannot fire
   then; conditioning would be thrown away).
2. **D2:** record chat-class real-attempt evidence from the vision lane (success AND upstream
   failure), so the chat capability's status is backed by every real chat-class call, not only
   product chat turns.
3. **D3:** surface honest retry timing on the dashboard's rate-limited badge from the payload's
   breaker state.
4. Tests pin all three; controlled live tests across all four products verify behavior under
   the real configured quotas (no artificial unlimited limits).
