# BEAN — FOUR-PRODUCT ZERO-DOWNTIME RECOVERY

**Date:** 2026-11-11 · **Baseline HEAD:** `f129ce7` · Companion documents: `BEAN-ZERO-DOWNTIME-AUDIT.md` (what existed, what was missing), `BEAN-LIVE-ACCEPTANCE.md` (live evidence).

This report documents the code changes that close the seven audit gaps (G1–G7). Every change preserves the existing four-product architecture, the existing registry/adapters, and the prior honesty contracts (no fabricated success, no fake badges, no invented credentials, no Ollama).

---

## 1. Staggered provider probes (G1)

**File:** `src/lib/adapters/probe-stagger.ts` (new, 62 lines) + `src/app/api/health/route.ts`.

- `staggeredRemoteProbes()` runs the FIVE network probes (RIISHE chat, CODE GIFTZ chat, research, LAXII image, JAZMII video reachability — all targeting the same gateway host) **serially with a fixed 250ms gap**: at most one remote request in flight at any moment, which keeps the same-host request rate far below the provider's authoritative 2-QPS limit regardless of probe count.
- The three LOCAL probes (sandbox runtime, Sharp engine, Diffusers preflight — no network) stay parallel via the unchanged `Promise.all`.
- With the 20s health cache (`health-cache.ts`), the added worst-case latency lands only on fresh (cache-miss) polls — measured 1046ms and 1182ms for fresh polls in the live acceptance, both well inside the dashboard's 45s refresh.
- The "never probe repeatedly while a breaker is open" guarantee is unchanged: LLM/research probes make no network call at all while their class breaker is open.

## 2. Shared account quota accounting + user reserve (G2, G7)

**File:** `src/lib/providers/account-quota.ts` (new, 167 lines); wired at `src/lib/router/router.ts:170` (user preflight), `:245` (background adapter resolution), `src/lib/intel/vision.ts:50-59`, `src/lib/jobs/image-worker.ts:230-238`.

Measured reality this closes: all four products ride ONE provider account whose real ceiling is enforced at the ACCOUNT level (live headers: `x-ratelimit-limit-daily: 300`, `remaining-daily: 0` while per-user daily still showed 196 remaining). The pre-existing per-product budget guard could not see the shared pool.

- `BEAN_ACCOUNT_DAILY_BUDGET` (opt-in, integer): the shared daily request budget counted across ALL products from today's `UsageRecord` rows (success or failure — failed upstream calls can still cost, same policy as cost-guard).
- `BEAN_ACCOUNT_DAILY_USER_RESERVE` (fraction, default 0.25, clamped [0, 0.9]): once usage ≥ `budget − reserve`, AUTOMATED/enhancement consumption stands down honestly:
  - the bounded vision service (`analyzeImageOnce` — LAXII verification, JAZMII continuity) returns a real skip reason and makes NO network call;
  - LAXII's targeted quality-correction edit is not attempted (the already-produced image stays the result; the reason is persisted in the job's verification report).
- **Real user requests are never withheld by the reserve** — they may consume up to the FULL budget; only at the full budget does the router refuse with typed `COST_LIMIT` (`assertAccountQuotaForUserRequest`, audit-logged as `provider.account_budget_exceeded`).
- With no budget configured the module is a no-op — zero behavior change unless the operator opts in.

## 3. Retry-After / reset headers honored when present (G3)

**Files:** `src/lib/upstream/gateway.ts:196-251,287-299`; `src/lib/providers/openai-compatible.ts`.

- `parseRetryAfterHeaders(headers, now)` — pure parser honoring, in order: `retry-after` (delta-seconds or HTTP-date), then `x-ratelimit-reset` (epoch seconds or ms). Absent/garbage headers return null — a hint is never invented.
- `clampProviderRetryAfterMs()` — provider hints are clamped to [5s, 10min] so an absurd or malicious value can neither spam the provider nor wedge a product.
- `noteUpstream429(cls, now, providerRetryAfterMs?)` — when a hint exists, the breaker cooldown respects the provider's own window instead of BEAN's escalated guess; without a hint the existing 60s→600s schedule is unchanged (the z-ai gateway sends none — verified live again this session).
- The OpenAI-compatible fallback lane (direct fetch — the one lane that CAN read headers) parses and propagates the hint on 429 in both `execute()` and `health()`; the typed error carries `retryAfterMs`, which the video worker's `videoSubmitBackoffMs()` and the new image parking already consume.

## 4. Bounded retries with exponential backoff AND jitter (G4)

**Files:** `src/lib/ai-engine/config.ts:83-100`; `src/lib/ai-engine/queue.ts:281-285`; `src/lib/ai-engine/runner.ts:209-214`.

- `jitteredRetryBackoffMs(base, rand?)`: ±20% bounded jitter (never below 1s), rand injected for deterministic tests.
- Wired into BOTH retry computation points: the queue's `finishFailed` retry_wait scheduling and the runner's `settleRetry`. A synchronized cohort of failing jobs can no longer re-hit a recovering provider at the same instant.
- Unchanged on purpose: the 429 protocol (rate_limited failures are never auto-retried) — throttle recovery for jobs is handled by explicit, breaker-aligned parking (§5), not by blind retries.

## 5. LAXII throttle parking — jobs survive throttle windows (G5)

**File:** `src/lib/jobs/image-worker.ts` (`imageGenerationBackoffMs` :72-82, `settleThrottledGeneration` :459-553, catch-path :388-396).

The old worker failed an image job TERMINALLY on a real 429 ("The request was not repeated") — a minutes-long provider throttle window destroyed a job BEAN had already accepted. The video worker has parked such jobs since 2026-11-08; images now get the identical recovery:

- A throttle-class failure (real 429 or a breaker skip) parks the job in `retry_wait` with a breaker-aligned backoff: provider Retry-After (when a lane can read one) → the images-breaker remaining window → the escalating 60s·2^(n-1) schedule, capped at 10 minutes.
- **Bounded both ways:** `IMAGE_MAX_GENERATION_ATTEMPTS = 3` real attempts and `IMAGE_MAX_CUMULATIVE_THROTTLE_MS = 30min` cumulative parked wait; exhaustion ends in an honest terminal `RATE_LIMITED` failure that states exactly what happened. A breaker SKIP made no network request — it counts NO attempt and only extends the wait.
- The attempt/wait budget persists in the job's `resultJson`, so parking survives process restarts; a successful generation records its recovery history (`submissionAttempts`, `throttleWaitMs`) in the final result.
- No duplicate submission is possible: with no provider artifact, the retry IS the first accepted generation.
- Live evidence: the acceptance run observed a real throttled generation park (`retry_wait`, attempts=1, nextRunAt +60s, "attempt 2 of 3 starts automatically in ~60s") — `BEAN-LIVE-ACCEPTANCE.md` §3.

## 6. Duplicate-submission prevention extended to LAXII + JAZMII (G6)

**Files:** `src/app/api/laxii/generate/route.ts`, `src/app/api/laxii/edit/route.ts`, `src/app/api/jazmii/generate/route.ts`.

- All three submit routes now compute a `dedupeKeyFor(...)` and refuse an identical ACTIVE job with a typed `CONCURRENCY_LIMIT` error (HTTP 429 in the shared error table), persisting `dedupeKey` on the job row. Terminal jobs never block a deliberate resubmission.
- JAZMII fingerprints a data-URL driver (`first 48 chars + length`) instead of hashing up to 8 MB.
- Live evidence: identical double-submit refused (`CONCURRENCY_LIMIT`), while a distinct prompt submits normally (202) — `BEAN-LIVE-ACCEPTANCE.md` §4.
- Caught and fixed during the live run: the routes needed the `BeanApiError` import (first run returned 500 `INTERNAL_ERROR`; fixed, re-run clean). This is why the acceptance runs against the real server, not only mocks.

## 7. Product-specific requirements — status

- **RIISHE:** multilingual chat + direct web research untouched; research availability remains a separate functions-class capability row that never moves the chat badge. Chat throttled → honest typed error (live: JSON 429 `RATE_LIMITED`, 672ms) + the user's question is PRESERVED (persisted user row without an assistant reply — the exact retry state; live-verified). Fallback chain exists and is credential-gated; dormant here, so the preserved-request path is the honest behavior.
- **LAXII:** t2i / conversational editing / enhancement pipelines unchanged; completed images are never lost (parked jobs keep their rows; correction keeps the original unless the re-check proves the edit better); only real configured backends serve; deterministic enhancement is never claimed as generation.
- **JAZMII:** T2V/I2V pipelines untouched; accepted jobs already survive throttling via the video worker's breaker-aligned parking; worker slots survive failures (runner slot-loop + poller re-attach guard); statuses are the real states (queued/running/retry_wait→queued/completed/failed).
- **CODE GIFTZ:** sandbox execution stays local and independent (health-probed live, zero provider cost); coding chat keeps context and files across retries (dangling-collapse in `/api/ai/jobs`); the coding fallback is the same credential-gated chain — activated only by a real operator credential.

## 8. Verification

- Unit/regression: **1278 passed / 0 failed** (`bun run test`, 84 files; 50 new tests: account-quota reserve arithmetic + user gate, Retry-After parsing + breaker honoring, backoff jitter bounds, probe stagger serialization, image throttle parking end-to-end with scripted adapter + fake DB, and the availability-badge scenario matrix for all ten acceptance scenarios).
- `bunx tsc --noEmit`: **src/ clean** (102 pre-existing errors confined to `scripts/` diagnostics, identical count at baseline `f129ce7` via `git stash`).
- `bun run lint`: clean. `bun run build`: successful (Next.js standalone).
- Live acceptance: 12 PASS / 1 honest SKIP / 0 FAIL against the real dev server (`scripts/zero-downtime-acceptance.ts`, output `scripts/zero-downtime-acceptance-out/acceptance.json`, evidence `docs/evidence/zero-downtime/`).
