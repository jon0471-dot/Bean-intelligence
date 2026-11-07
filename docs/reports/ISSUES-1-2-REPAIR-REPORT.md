# ISSUES 1 & 2 — SCOPED REPAIR REPORT

**Date:** 2026-11-07 (UTC) · **Baseline:** `716e40d` · **Scope:** Issue 1 (JAZMII video 429) + Issue 2 (provider rate limiting across all four products). Issues 3–6 untouched.

**Success criterion met:** real AI requests work — all four products produced REAL provider-backed artifacts during the acceptance run. Where provider access is still blocked (research `functions` class), this report says exactly what is missing instead of claiming a fix.

---

## 1. Root cause — ISSUE 1 (JAZMII video generation fails, HTTP 429)

### 1.1 Request trace (verified end-to-end)

`JAZMII UI` → `POST /api/jazmii/generate` (zod-validated: duration 3–12 s, size 360–1920 WxH, quality speed|quality) → job row `GenerationJob` (status `queued`) → engine pool claim (`src/lib/ai-engine/queue.ts`, CAS + lease) → `processVideoJob` (`src/lib/jobs/video-worker.ts`) → `submitVideoJob` (`src/lib/adapters/hosted-video.ts`) → **z-ai-web-dev-sdk 0.0.18** `video.generations.create` → **`POST https://internal-api.z.ai/v1/video/generation`** (Bearer platform-managed key from `/etc/.z-ai-config`; values never read by BEAN code). Polling: `GET /async-result?id=<task>` every 5 s (bounded 15 min). Output downloaded server-side, validated by MP4/WebM magic bytes, stored under `storage/jazmii/<user>/`, re-served per-user via `/api/jazmii/jobs/<id>/media`.

- **Provider:** Z.ai authorized hosted inference gateway (single platform-managed account; the only video provider configured).
- **Model:** provider-managed text-to-video model; **exact checkpoint not disclosed to the tenant** (recorded verbatim in `src/lib/registry/backends.ts`; BEAN sends no `model` field — the provider default serves).
- **Account/quota:** one shared platform account. The gateway returns `HTTP 429 {"error":"Too many requests, please try again later"}` with **no Retry-After header and no quota detail** (measured; the SDK discards response headers entirely, throwing `status NNN: <body>`).

### 1.2 What the 429 actually is (measured from 24 historical job rows)

- 20 of 24 JAZMII video jobs failed `RATE_LIMITED` across **02:21–07:02Z on 2026-11-07**, while two 5-second jobs **completed between throttle windows** (02:34, 03:07).
- **5-second and 10-second requests throttle alike** — the requested 10 s duration / 16:9 / quality is **NOT** the trigger.
- The failures are time-windowed, not permanent: an account-wide provider throttle window that lasts minutes.
- Not incorrect endpoint routing: the endpoint answered (a 429 is a provider answer, not a routing failure). Not invalid credentials (429, never 401/403). Not duplicate submissions (single attempts throughout).
- **Model capability VERIFIED by the acceptance run:** the exact screenshot-class request (10 s, 1280×720, quality) was accepted and completed with a real MP4 (§4.3) — the model supports 10-second duration, 16:9 and quality mode.

### 1.3 Application defects found and fixed (all on the Issue-1 path)

| # | Defect | Measured evidence | Fix |
|---|--------|-------------------|-----|
| D1 | A **submission-time 429 terminally failed an accepted job** — a provider refusal destroyed a job BEAN had already accepted | 20 historical `RATE_LIMITED` terminal rows; the screenshot case (`cmw61y6a`, 10 s) | Throttled submissions now park the job in `retry_wait` with bounded, breaker-aligned backoff; budget persisted in `resultJson` (5 real attempts / 30 min cumulative wait), then honest terminal `RATE_LIMITED` |
| D2 | Submit-vs-resume keyed on **row status**, not the persisted provider task id → duplicate-submission risk on any re-claim | Job `cmw60bf4` failed with `resumed video job has no persisted provider task id` | Decision keyed on `result.providerTaskId`; a task id is **never** resubmitted |
| D3 | The jobs-list poller re-attach **raced engine claims**, executing queued jobs outside the claim protocol (the cause of D2's measured failure) | `cmw60bf4` timeline | `ensureVideoPoller` skips queued/`retry_wait` rows while engine pools are active (probe wired via `jobs/queue.ts`); orphaned running rows still re-attach; inline (pool-less) deployments unchanged |
| D4 | The runner's **fixed 180 s settle-watchdog** false-failed legitimately long-running video handlers | Live during acceptance: a healthy 10 s-quality render marked `INTERNAL_ERROR` at +180 s | Lease-aware stall watchdog: reject only when the job's **lease lapses without heartbeat** (the runner heartbeats while handlers work); inline/no-lease rows never raced |
| D5 | A re-claim of a poller-owned job **clobbered the row with an empty artifact** | Event log of tainted job `cmw6mi8pr…`: `artifact {"result":{}}` written while the render was still processing | `noSettle` handler outcome + `isVideoPollerActive` guard: the engine settles nothing when a live in-process poller owns the job |

Throttle-retry semantics (D1 fix, exactly per brief): bounded backoff 60 s → 120 s → 240 s → 480 s → 600 s cap; **Retry-After is honored when a provider ever sends one** (typed `retryAfterMs` on `UpstreamRateLimitError`, clamped 5 s–10 min) — the current gateway sends none (measured), so BEAN's own escalation schedules the retry; breaker skips (cooldown open, zero network I/O) count **no** attempt; never more than one in-flight submission per job; with no provider task id no upstream generation exists, so a retry is the *first* accepted submission — never a duplicate. A throttled **result download** (after the provider accepted and finished the task) is retried boundedly (3 attempts, 5 s/10 s) so a real result is never discarded.

### 1.4 Alternative video providers (brief questions 5–7)

**None exists.** The admin credential vault has **0 rows**, no `BEAN_PROVIDER_OPENAI_*` / `BEAN_LLAMACPP_*` env credentials are set, and the prepared fallback adapters are chat/coding-only (not video-capable). No capability-compatible fallback routing can be implemented without inventing access, which BEAN does not do. **Exactly what is missing:** an authorized alternative video-provider credential (admin gateway console or env). Until then JAZMII is honestly single-provider, and the throttle-resilient submission path (§1.3) is what keeps accepted jobs alive across provider throttle windows.

---

## 2. Root cause — ISSUE 2 (shared provider rate limiting across all four products)

Investigated every product's actual routing (`src/lib/router/router.ts`, `src/lib/registry/backends.ts`, adapters, engine handlers):

| Question (brief) | Measured answer |
|---|---|
| Same provider account for all four? | **Yes** — RIISHE chat + web research, LAXII images/edits, JAZMII video, GIFTZ coding all ride the one platform-managed z-ai gateway (`zai-gateway`). CODE GIFTZ sandbox execution is BEAN-local (no provider). |
| Shared quota / account-level limit? | **Yes** — endpoint classes throttle separately at first (`chat`, `functions`, `images`, `video`, `audio` each have their own breaker), then account-wide windows hit every class. Measured 2026-11-07: `functions` streak 3 at 16:46Z while `chat` had already recovered; video job polling throttled by the same windows as submissions. |
| Credentials valid? | **Yes** — failures are 429 throttles, never 401/403; real completions/images/videos succeeded during the acceptance window. |
| Model identifiers + endpoints correct? | **Yes** — SDK-managed (`z-ai-web-dev-sdk` 0.0.18): chat `POST /chat/completions`, video `POST /video/generation` + `GET /async-result`, functions `POST /functions/invoke`. No tenant-visible checkpoint names exist to be wrong; the registry records that honestly. |
| Background workers generating duplicate requests? | **No retry loops anywhere** — chat/research/image adapters are single-attempt with breaker fail-fast; health probes cached 20 s with in-flight dedup; JAZMII frontend polls 4 s only while jobs are pending; video pollers bounded per job. The one duplicate-submission path (D2/D3, video) is fixed. |
| App-level concurrency exceeding provider limits? | **No evidence** — router in-flight caps (video 2 total / 1 per user, images 4, chat 16), engine pools 2 slots/product, per-user active-job limit 3. Every observed 429 is a provider account-wide window, not self-inflicted load. |

**Independent provider routing implemented (within authorization reality):**

- Per-product, per-endpoint-class breakers (already in place, verified unchanged) keep one class's throttle from fail-fasting another class's traffic.
- Chat/coding (RIISHE + CODE GIFTZ) have credential-gated fallback chains — `bean-llm-openai-compatible` → `bean-chat-local-llamacpp` — attempted only on upstream-class failures, audit-logged, mid-stream never restarted. **Both are dormant:** no vault rows, no env credentials. Nothing was activated because nothing is authorized to activate.
- Images/video are single-provider by authorization reality (§1.4): no alternative exists to route to.
- JAZMII's routing independence is the repaired submission path itself: accepted jobs queue through their own pool + breaker + bounded retry, and a chat/images/research throttle never blocks a JAZMII submission from being *accepted* (jobs are only failed by their own class's evidence, after the bounded budget).

Dashboard badges were **not** touched; they render measured health + real completions.

---

## 3. Exact files changed

| File | Change |
|---|---|
| `src/lib/jobs/video-worker.ts` | D1 + D2 + D3: taskId-keyed resume, throttle-resilient submission (`retry_wait` + bounded budget persisted in `resultJson`), `waitForDue` schedule honor, throttled-download retry, `ensureVideoPoller` pool gating, exported backoff math/constants |
| `src/lib/ai-engine/runner.ts` | D4: lease-aware stall watchdog replaces the fixed 180 s race; `noSettle` honored |
| `src/lib/ai-engine/handlers.ts` | D5: video handler returns `noSettle` when a live poller owns the job |
| `src/lib/ai-engine/types.ts` | `noSettle` outcome field |
| `src/lib/jobs/queue.ts` | Wires the engine-pool probe into the video worker (no import cycle) |
| `src/lib/upstream/gateway.ts` | `UpstreamRateLimitError.retryAfterMs` carrier (honored by the video backoff when a provider ever surfaces Retry-After) |
| `tests/unit/jazmii-video.test.ts` | Re-pinned submission-429 contract + 8 new pins (retry_wait parking, skip≠attempt, budget exhaustion, resubmit-once, due-wait, duplicate guard, download retry, poller gating, backoff math) |
| `scripts/fulltest/issues-1-2-acceptance.ts`, `-b.ts` | The bounded real-world acceptance runs (evidence below) |

No other source files changed. (The working tree contains sandbox-generated file-mode changes on unrelated files; they are excluded from this commit.)

## 4. Provider + model used, and the real acceptance evidence

Provider for all four runs: **Z.ai authorized hosted inference gateway** (platform-managed account, `internal-api.z.ai/v1`). Model identities as disclosed: provider-managed, checkpoint not disclosed to tenant. Evidence log: `scripts/fulltest-out/issues-1-2-acceptance.jsonl`.

1. **RIISHE — real chat response** (16:34:04Z): streamed answer *"The capital of Japan is Tokyo. The Pacific Ocean surrounds Japan."* — 65 chars, HTTP 200, 736 ms, single attempt.
2. **LAXII — real text-to-image** (16:34–16:35Z): job `cmw6mi9iq000io2l1w8fqrdmg` completed; 1024×1024 JPEG, **98,148 bytes** downloaded through the authenticated asset route (`/api/laxii/assets/…`, HTTP 200).
3. **JAZMII — real 10-second text-to-video** (16:42:18→16:45:34Z): job **`cmw6mstur0008o277pbrr252m`**, prompt "aerial sunrise over a golden desert canyon", **durationSec 10, size 1280×720 (16:9), quality mode**, 1 attempt, no false failures:
   - Provider task `202611080042191c4efac5a8074948` → SUCCESS; MP4 stored server-side at `storage/jazmii/<user>/cmw6mstur…mp4`.
   - Authenticated download `GET /api/jazmii/jobs/cmw6mstur…/media` → HTTP 200, **1,924,204 bytes**, container magic `ftyp` (real MP4).
   - **ffprobe verification: duration 10.226 s · 1280×720 · h264 (High profile) · 317 frames · playable mp4 container.**
4. **CODE GIFTZ — real coding response + sandbox execution** (16:48Z): task `cmw6mxjps000co2773dkbrslq` generated `main.js`; sandbox run **exit 0**, stdout exactly `level: true` / `hello: false` / `A man, a plan, a canal: Panama: true` — output verified, not just the model response. (A first attempt at 16:35Z hit an honest HTTP 429 — single attempt, no retry; the later breaker-gated attempt succeeded.)

Background-survival context: the video job executed entirely in the engine worker pool — the submitting HTTP request returned 202 in milliseconds, and the artifact was retrieved minutes later from persistent storage.

## 5. Remaining external blockers (honest)

1. **Provider account-wide throttle windows.** The gateway's own rate limiter still opens minutes-long account-wide windows (research `functions` class was throttled at report time — breaker streak 3). BEAN now rides them out where jobs are accepted (JAZMII) and reports them honestly everywhere else. RIISHE *live* web research can still be refused during such a window; that is the provider refusing, not a BEAN defect.
2. **No alternative video/image provider credentials exist.** Adding provider independence for JAZMII/LAXII requires the operator to configure an authorized alternative (admin gateway console vault or `BEAN_PROVIDER_OPENAI_*`-style env). BEAN did not purchase, invent or assume any access.
3. **Chat/coding fallback lanes dormant** for the same reason — prepared, credential-gated, honestly reported `not-configured`.

## 6. Regression results

- Full suite: **1126 pass / 0 fail / 71 files** (24 new video-repair pins; pre-repair baseline at HEAD was 1102 pass / 0 fail with 0 failed as the anchor).
- `tsc --noEmit`: **0 errors** in src+tests (pre-existing loose scripts excluded, unchanged).
- `eslint` on all changed files: **clean**.

## 7. Issues 3, 4, 5, 6 — untouched confirmation

No changes to: any product UI (RIISHE/LAXII/GIFTZ/JAZMII components, dashboard, layouts, styling), GANGZII, product test suites other than the JAZMII video pin file, unrelated services, unrelated database tables, or any schema. The diff for this repair is exactly the seven source/test files in §3 plus the two acceptance scripts and this report. The live database was only written by normal product operations (job rows during the acceptance runs); no migrations, no destructive operations, `db/custom.db` untouched by hand.
