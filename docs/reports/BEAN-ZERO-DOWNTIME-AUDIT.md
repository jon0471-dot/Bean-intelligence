# BEAN — ZERO-DOWNTIME RECOVERY AUDIT

**Date:** 2026-11-11 · **Baseline HEAD:** `f129ce7` (post `dc6971b` RIISHE chat recovery + LAXII image quality) · **Scope:** audit of the four-product availability architecture against the zero-downtime recovery brief. No JAZMII/CODE GIFTZ runtime behavior was harmed; no new providers, no Ollama, no UI changes.

---

## 1. What was already in place (verified, preserved)

The platform already carried most of the availability architecture from previous work orders. Every item below was re-verified at this HEAD with file:line references.

| Brief requirement | Status | Evidence |
| --- | --- | --- |
| Cached health results with expiry | ✅ pre-existing | `src/lib/adapters/health-cache.ts:21` (20s TTL, in-flight dedup, `cached:true` honesty flag, lastHealthyAt tracker) |
| No inference requests for health checks | ✅ pre-existing (2026-11-10) | `src/lib/adapters/gateway-reachability.ts:38-75` — free unmetered `GET /models` liveness; LLM/research probes fire ZERO metered calls (`hosted-llm.ts:394`, `research/provider.ts:216`); measured live this session: usage rows 41 → 41 across two fresh polls |
| Never probe repeatedly while a breaker is open | ✅ pre-existing | LLM/research probes report breaker state with NO network call (`hosted-llm.ts` health layer 3); per-class 429 breakers fail fast with `attempted:false` |
| Honest failure classification + typed errors | ✅ pre-existing | `src/lib/upstream/gateway.ts:104-131` (`classifyUpstreamError`), SSE payloads `upstreamStreamErrorPayload()` (`gateway.ts:350`) |
| Escalating bounded 429 cooldown breaker | ✅ pre-existing | `gateway.ts:190-194` — 60s→120s→…→600s cap per endpoint class (chat / chat-fallback / chat-llamacpp / functions / images / video / audio) |
| Credential-gated fallback chains | ✅ pre-existing | `src/lib/registry/backends.ts:115,437` (RIISHE + GIFTZ → `bean-llm-openai-compatible` → `bean-chat-local-llamacpp`), enforced by `src/lib/providers/routing.ts:103-198` (`wrapWithProviderFallback`); dormant without credentials, audit-logged fallback decisions |
| Durable queue, leases, crash recovery | ✅ pre-existing | `src/lib/ai-engine/queue.ts` (CAS claims, retry_wait, `recoverStaleJobs` at `:365`), `runner.ts` (slot loops survive handler crashes; lease watchdog `:188`) |
| Retry never re-hits a throttled account | ✅ pre-existing | `ai-engine/classify.ts:26` — `rate_limited` is terminal; `types.ts:101` RETRYABLE_CLASSES excludes it |
| Duplicate-submission prevention (RIISHE/GIFTZ) | ✅ pre-existing | `queue.ts:85` (`hasActiveDuplicate`) used at `src/app/api/ai/jobs/route.ts:143,220` |
| Worker slots survive failed requests | ✅ pre-existing | `runner.ts:238-271` — `slotLoop` catches, continues; JAZMII poller re-attach guard `handlers.ts:49` |
| Video throttle parking (Retry-After + breaker-aligned) | ✅ pre-existing | `src/lib/jobs/video-worker.ts:157-167` (`videoSubmitBackoffMs`), `:570-666` (`settleThrottledSubmission`) |
| Per-product operator budgets | ✅ pre-existing | `src/lib/providers/cost-guard.ts:50` (`assertProviderBudget`, opt-in env) |
| Per-user quotas + concurrency + rate limits | ✅ pre-existing | `src/lib/router/router.ts:144-163` |
| Dashboard status model incl. Rate-limited/Blocked | ✅ pre-existing | `src/lib/registry/status.ts:103,157-195` (operational / degraded / rate-limited / unavailable / not-configured) rendered by `components/bean/dashboard.tsx:90-150` |
| RIISHE chat throttle → preserve request | ✅ pre-existing | `src/app/api/riishe/chat/route.ts:43-48,135-155` (dangling-retry collapse), user row persisted at `:253` BEFORE the model call |

**Local model lanes (honest re-check):** the llama.cpp lane stays dormant — no GGUF weights, no `llama-server`, 2 vCPU / 3.9 GB (verified in the 2026-11-10 CHAT-RECOVERY audit; nothing changed). The OpenAI-compatible fallback stays dormant — no `BEAN_PROVIDER_OPENAI_*` credential is configured in this runtime (`registry/backends.ts:487` evaluates `enabled` from the real environment). Neither was activated; no credentials were invented.

## 2. Gaps found (all closed this session — see BEAN-FOUR-PRODUCT-RECOVERY.md)

| # | Gap | Evidence at audit | Fix |
| --- | --- | --- | --- |
| G1 | Health fan-out fires 5 same-host network probes in one parallel burst | `src/app/api/health/route.ts` — single `Promise.all` over 8 probes | Remote probes now serialized with a 250ms gap (`src/lib/adapters/probe-stagger.ts`); local probes stay parallel |
| G2 | No SHARED account-level quota accounting — four per-product budgets could sum past the provider's real account ceiling (300/day measured), and nothing reserved quota for real users | `cost-guard.ts` is per-product only | `src/lib/providers/account-quota.ts` (new): shared daily budget + configurable user reserve; automated/enhancement consumption stands down at `budget − reserve` |
| G3 | Retry-After / reset headers discarded where they ARE readable | `providers/openai-compatible.ts:156-158` had the `Response` in hand and dropped the headers | `parseRetryAfterHeaders()` + `clampProviderRetryAfterMs()` (`upstream/gateway.ts:209-251`); `noteUpstream429()` honors a provider hint (clamped 5s..10min); fallback lane parses on 429 in both `execute()` and `health()` |
| G4 | Job retry backoff had NO jitter — synchronized failure cohorts re-hit the provider at the same instant | `ai-engine/config.ts:65` fixed schedule `[15s, 60s]`, consumed without jitter at `queue.ts:278` and `runner.ts:210` | `jitteredRetryBackoffMs()` (±20%, bounded, min 1s) wired into both retry computations |
| G5 | LAXII image jobs died TERMINALLY on a 429 — a throttle window destroyed an accepted job (video already parked; images did not) | `jobs/image-worker.ts:332-334` old code: `"The request was not repeated"` + `status:'failed'` | Throttle parking mirrored from video: `settleThrottledGeneration()` (`image-worker.ts:459-553`), breaker-aligned backoff (`imageGenerationBackoffMs`), budgets persisted in resultJson (3 real attempts / 30min cumulative), breaker skip counts no attempt |
| G6 | Duplicate-submission guard missing on LAXII + JAZMII submit routes (only `/api/ai/jobs` had it) | No `dedupeKey` set by `laxii/generate`, `laxii/edit`, `jazmii/generate` | Guards added to all three (typed `CONCURRENCY_LIMIT` refusal + persisted dedupeKey); data-URL fingerprinting keeps video keys cheap |
| G7 | The reserve concept had no enforcement point for automated metered consumption | Vision verification / targeted correction consumed the shared account unconditionally | User-reserve gate in `intel/vision.ts:50-59` (skips honestly) and in the image-worker correction step (`image-worker.ts:230-238`); the user's primary request is NEVER withheld by the reserve |

## 3. Live state at audit time (measured, 2026-11-10 ~05:40-06:00Z)

- **Shared account daily quota: EXHAUSTED.** `x-ratelimit-remaining-daily: 0/300`, HTTP 429 on a direct probe (evidence `docs/evidence/zero-downtime/quota-gate-initial.txt`). Per-user daily still had room (`x-ratelimit-user-daily-remaining: 196`) — confirming the account-level pool is the binding constraint, which is exactly what G2's shared accounting now models.
- The provider sends **no Retry-After** header and the managed SDK discards headers entirely (re-confirmed live: `retryAfter: null`) — G3's parser is wired so any lane that CAN read headers honors them; today that is the fallback lane only.
- `x-ratelimit-limit-qps: 2` (authoritative per-second limit) — the reason G1's anti-burst staggering matters even for unmetered reachability GETs.

## 4. Items deliberately NOT done (with reasons)

- **Fallback activation:** no fallback was activated — both prepared slots are credential-dormant and the brief forbids inventing credentials. Scenario 3 ("fallback handles the request") is covered by `tests/unit/provider-fallback.test.ts` (mock adapters, breaker isolation, audit trail) rather than a live run.
- **Real server-kill restart test (scenario 7):** covered by unit tests (`ai-engine-queue.test.ts` — lease expiry → `recoverStaleJobs` requeue) and by the running system's startup recovery (`runner.ts:303-305`); a live `kill -9` of the shared dev server mid-session was not performed.
- **No Ollama, no new AI product, no four-product architecture change, no JAZMII/CODE GIFTZ behavior change** beyond the shared guards noted above.
