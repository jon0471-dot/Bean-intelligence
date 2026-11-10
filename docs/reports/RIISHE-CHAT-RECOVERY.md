# RIISHE CHAT RECOVERY

**Date:** 2026-11-10 · **Branch:** main · **Base HEAD:** `d4d059d` · **Scope:** RIISHE conversational chat (Part A of the RIISHE-chat-recovery + LAXII-image-quality brief). Other products' runtime behavior untouched.

---

## 1. The reported state, reproduced and diagnosed

**Reported:** conversational chat RATE LIMITED (HTTP 429); current-web research AVAILABLE.

**Measured reproduction (all evidence in `docs/evidence/riishe-recovery/`):**

| Evidence | Reading |
|---|---|
| Direct gateway probe, 02:19Z (`quota-probe-2026-11-10T0219Z.txt`) | **HTTP 200, `x-ratelimit-remaining-daily: 134/300`, `limit-qps: 2`** — the account itself was serving single requests fine |
| `/api/health` capture, 02:28:40Z (`health-before-fix-2026-11-10T0228Z.json`) | **RIISHE + CODE GIFTZ `rate-limited`: "probe deferred while the cooldown breaker is open"** — the chat-class breaker was OPEN in the serving process, 21 calls skipped; `last429At: 02:27:48Z`; the functions breaker had a 429 at 02:25:43Z |
| `UsageRecord` failure row, 02:04:06Z | `riishe:chat:UPSTREAM_RATE_LIMITED`, durationMs **8**, tokensIn 1 — a breaker FAIL-FAST (no network) surfacing as a user-facing rate limit |
| Research probe inside the same health payload | **healthy — a real web_search succeeded (1138 ms)** while chat reported rate-limited |

### Root cause: a self-sustaining 429 loop powered by health monitoring

The provider rate-limits the shared account at **2 requests per second** (authoritative `x-ratelimit-limit-qps: 2` header) across ALL endpoint classes, plus 300 requests/day. The `/api/health` fan-out fired, in ONE `Promise.all`, **2 real chat completions + 1 real web_search per fresh poll** — and the dashboard refreshes health every 45 s. Three concurrent metered requests against a 2-QPS limit trip it on essentially every refresh; the resulting 429 opened the chat-class breaker (60 s), so the NEXT poll (45 s later, still inside the window) deferred with no network, the poll after that (90 s) fired a fresh 3-burst and tripped again — **a loop that kept chat "rate-limited" indefinitely while the account had 134/300 daily requests remaining and served every single spaced request**. This exactly reproduces the reported state: chat 429, research fine (its probe is one request, so after expiry it fits under the QPS cap and recovers).

Secondary application-side contributors found in the same audit:

1. **Four raw chat-completion call sites bypassed the chat-class 429 breaker entirely** — search-query generation (`research/pipeline.ts`), semantic freshness routing (`research/semantic-router.ts`), claims verification (`verify/claims.ts`), cross-lingual query expansion (`intel/crosslingual.ts`). While the breaker was open, any research turn still fired raw completions INTO the throttling gateway (uncounted quota, throttle deepening).
2. **Health polling burned customer inference quota** — 3 metered requests per fresh poll ≈ 240/h against the 300/day budget if a dashboard stayed open; the budget itself then exhausts and produces REAL sustained 429s (measured later this session: the account reached 0/300 under benchmark load; failures honest, no retries).
3. The breaker amplification: a single transient QPS-trip 429 became a 60 s hard outage for ALL chat traffic (the 8 ms fail-fast rows), so the blip the health fan-out produced was user-visible.

### Qwen3 local inference lane (brief A.3) — inspected, honestly dormant

Checked the complete path so activation could be judged on facts:

- The adapter and routing exist and are complete (`src/lib/providers/llamacpp.ts`, backend `bean-chat-local-llamacpp`, its own breaker class `chat-llamacpp`, SSRF-guarded loopback policy, credential-gated fallback chain).
- **No licensed GGUF weights exist** on this host (filesystem-wide search found zero `.gguf` files; `models/` holds only manifest/license JSON).
- **No llama.cpp runtime exists** (`llama-server`/`llama-cli` absent).
- No activation env vars are set (`BEAN_LLAMACPP_BASE_URL`, `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS`).
- Hardware: **2 vCPU / 3.9 GB RAM** — below any practical chat-model serving capacity.

**Decision:** the local lane stays dormant exactly as designed ("consumes nothing until then"); nothing was pretended into existence. Chat recovery had to come from fixing the hosted path — which the diagnosis showed was self-inflicted, not an upstream capacity problem.

---

## 2. The repair

### 2.1 Quota-free health probes (brief A.6)

**`src/lib/adapters/hosted-llm.ts` — `health()` rewritten.** Fires ZERO metered requests. Evidence ladder, in order: (1) config — gateway client resolves with baseUrl/apiKey; (2) **free reachability** — a GET on the gateway's `/models` metadata path, which the gateway's router layer answers with HTTP 404 and **no rate-limit headers** (measured: unmetered); (3) chat-class breaker state — an open breaker reports `rate-limited` with the observed-429 timestamp; (4) **REAL-attempt evidence** — the most recent actual chat completion recorded by real traffic (in-memory via `last-attempts.ts` + persisted via `UsageRecord` rows so the evidence survives a restart); with no evidence yet the report says exactly what its status is based on. The detail never claims a completion probe ("No completion was fired — recovery is verified by the next REAL chat call, never by a probe request").

**`src/lib/research/provider.ts` — `probeResearchHealth()` rewritten** on the same pattern for the functions class (config → free reachability → functions breaker → last real `web_search` attempt recorded by customer research turns). The per-poll `web_search('ping')` is gone.

**`src/lib/adapters/gateway-reachability.ts` (new)** — the shared free reachability probe (extracted from the image/video adapters' proven pattern: bounded timeout, redirect-never-followed policy, config read in memory only). The image/video adapters' own private copies are untouched.

### 2.2 Real-attempt evidence for the chat and functions classes

- `src/lib/adapters/last-attempts.ts`: `AttemptTask` widened with `chat-completion` and `research-search`.
- `src/lib/adapters/hosted-llm.ts`: `createWithGatewayGuard` — the single choke point for guarded chat completions (solve, continuation, tool loop, digests, codeTask, and now the research-path helpers) records every REAL attempt (success + upstream failure; breaker skips are never recorded — no network happened).
- `src/lib/research/provider.ts`: `webSearch()` records every real functions-class attempt the same way.
- `src/lib/adapters/persisted-attempts.ts`: `persistedAttempt('chat-completion')` reads the most recent chat `UsageRecord` row (either chat product) and maps error codes to honest health categories — restart-surviving evidence so an exhausted-account failure is not wiped from the gauge by a process restart.

### 2.3 One guarded entry point for the four bypassing call sites

`guardedChatCompletion()` (exported from `hosted-llm.ts`) gives every out-of-adapter chat call the SAME contract as all other chat-class traffic: fail fast (typed, zero network) while the breaker is open, record observed 429s into the breaker, record real-attempt evidence. Wired into:

- `research/pipeline.ts` `generateQueries` (breaker skip → the existing raw-question fallback)
- `research/semantic-router.ts` `gatewayTransport` (skip → deterministic freshness decision, as with any transport error)
- `verify/claims.ts` `gatewayTransport` (skip → honest `ran:false` + degraded note)
- `intel/crosslingual.ts` default transport (skip → variant dropped, as with any failure)

No caller's fallback behavior changed; they simply stop firing completions into an active throttle.

### 2.4 Honest unavailability UX — verified in place (brief A.5)

The existing contract was audited and exercised live during the pre-fix state: a breaker-open turn returns the typed `UPSTREAM_RATE_LIMITED` SSE/JSON payload ("The upstream AI gateway is rate-limited right now (HTTP 429)… your question is kept below, so you can retry without retyping it"), the client drops the empty bubble and restores the question to the composer (`restoreQuestionForRetry`), and the dangling-retry collapse prevents duplicate user rows on the natural retry. The 02:04:06Z failure row shows the path working end-to-end in production. No code change was needed here — the 429s it handled honestly were being manufactured by the health fan-out.

### 2.5 Deliberately unchanged

- The chat-class breaker semantics (60 s base, escalating to 10 min) — correct for measured multi-minute throttle windows; the fix removes the artificial 429s that were feeding it.
- The dashboard's 45 s health refresh interval — with zero metered calls per poll the interval no longer matters.
- The `retry`/`retryFromMessageId` regeneration flows, history window + digest, tool loop, streaming protocol — untouched.
- Image/video/audio adapters' runtime behavior (their files were only read for the shared pattern; image/video got NO code change).

---

## 3. Verification (live, against the real dev server + real gateway)

Harness: `scripts/riishe-chat-recovery-verify.ts` (fresh user, sequential, single-attempt; evidence `scripts/riishe-recovery-out/riishe-verify.json` → `docs/evidence/riishe-recovery/riishe-verify-ALL-PASS.json`). **26/26 steps PASS** (final run; the first run's 2 failures were harness assertions fixed — a single-token answer legitimately arrives in one SSE frame, and a correct one-word Tamil answer was below the old length bar — product behavior was correct in both).

| Brief §A.7 item | Measured result |
|---|---|
| Health monitoring consumes no inference quota | **2 fresh `/api/health` polls (21 s apart, exceeding the 20 s cache TTL) → ZERO new `UsageRecord` rows** (16→16); probe details cite the free liveness check + real-attempt evidence ("the most recent REAL chat completion succeeded at 2026-11-10T02:57:20Z") |
| English conversation | `"391"` streamed for 17×23 (first delta 455 ms, total 459 ms, 1 usage row) |
| Tamil conversation | `"சென்னை"` streamed in 6 deltas (637 ms), Tamil script range verified, same-language protocol |
| Multilingual conversation | Hindi `"भारत की राजधानी नई दिल्ली है।"` streamed in 22 deltas (Devanagari verified) |
| Conversation history + context recall | Follow-up turn recalled "17 * 23" → "the answer was 391" from two turns earlier (691 ms) |
| Streaming | Multi-delta SSE on Tamil (6), Hindi (22), recall turns; `firstTokenMs` recorded per turn |
| Web research with citations | One current-fact turn: 3 sources, `[n]` citations, correct evidence-grounded answer ("C. Joseph Vijay … since 10 May 2026"), 12.5 s |
| Rate-limit handling | Unit-pinned (breaker fail-fast, typed errors, no retry into throttles, health deferral) + the pre-fix live evidence above; the post-fix app no longer manufactures its own 429s |
| Persistence | Conversation re-read via API: 6 rows (3 user + 3 assistant) incl. the English and Tamil turns |
| Metering | Every product turn wrote exactly one usage row; failed calls record `success:false` and are never charged against quota |

**Authoritative quota accounting:** account delta across the verification run = 9 requests (2 quota-header probes + 5 product turns; the research turn's query-gen + searches + solve ride inside one turn's rows). The health polls contributed 0.

---

## 4. Regression

- `bun run test` (`bun test --isolate tests/`): **1228 pass / 0 fail** across 79 files (was 1216 pre-existing + broken; the suite also gained 22 new tests and 4 test files were repaired — see below).
- `bunx tsc --noEmit`: **0 errors** in `src/` + `tests/` (pre-existing `scripts/` baseline noise unchanged).
- `bun run lint`: clean.
- `bun run build` (production): compiled successfully, 46/46 pages.

Pre-existing breakage fixed along the way (measured, not caused by this work): `tests/unit/upstream-429.test.ts`, `research-latency`, `research-retry`, `research-failure`, `claim-repair` all failed ESM linking at baseline ("Export named 'resolveRedirectUrl' not found") because their `research/direct` mocks lacked two exports `pipeline.ts` statically binds — verified by `git stash` (baseline failed identically). The partial mocks were completed with honest pure stubs. `package.json` regained `"test": "bun test --isolate tests/"` (the isolate flag the suite's mock-isolation depends on had been lost).

---

## 5. Files changed

| File | Change |
|---|---|
| `src/lib/adapters/gateway-reachability.ts` | **new** — free, unmetered gateway liveness probe (shared) |
| `src/lib/adapters/hosted-llm.ts` | quota-free `health()`; real chat-attempt recording; `guardedChatCompletion()` export |
| `src/lib/adapters/last-attempts.ts` | `chat-completion` / `research-search` attempt keys |
| `src/lib/adapters/persisted-attempts.ts` | persisted chat evidence from `UsageRecord` |
| `src/lib/research/provider.ts` | quota-free research probe; search-attempt recording |
| `src/lib/research/pipeline.ts` | `generateQueries` routed through the chat guard |
| `src/lib/research/semantic-router.ts` | gateway transport through the chat guard |
| `src/lib/verify/claims.ts` | claims transport through the chat guard |
| `src/lib/intel/crosslingual.ts` | expansion transport through the chat guard |
| `src/app/api/health/route.ts` | header comment documents the quota-free fan-out (code unchanged) |
| `package.json` | `"test": "bun test --isolate tests/"` restored |
| `tests/unit/llm-probe-cache.test.ts` | rewritten for the quota-free contract |
| `tests/unit/upstream-429.test.ts` | probe assertions updated (no completion ever fired); pre-existing mock-linking breakage fixed |
| `tests/unit/chat-recovery-quota.test.ts` | **new** — 12 tests pinning the quota contract |
| `tests/unit/persisted-chat-attempts.test.ts` | **new** — 6 tests for the persisted-evidence ladder |
| `tests/unit/{research-latency,research-retry,research-failure,claim-repair}.test.ts` | pre-existing partial mocks completed (ESM linking fix) |
| `scripts/riishe-chat-recovery-verify.ts` | **new** — the live verification harness |
| `docs/evidence/riishe-recovery/*` | probe headers, pre-fix health capture, ALL-PASS verification JSON |

## 6. Remaining external constraints (honest)

1. **The provider's 2-QPS and 300/day account limits are real.** The app no longer manufactures 429s, but heavy legitimate traffic can still exhaust the 300/day budget — that state now renders honestly (breaker + persisted evidence + typed user errors), and failed calls are never charged.
2. **`tn.gov.in` remains unreachable** from this deployment (recorded in the prior repair report; unchanged).
3. The llama.cpp lane stays dormant for the documented hardware/weights reasons (§1). If the operator supplies weights + runtime, activation is config-only (`BEAN_LLAMACPP_BASE_URL` + opt-in flag) with zero code change.
4. A small ambient consumption drift on the shared account is observable between probes (this authoring session itself rides the same platform account); BEAN-side calls are individually metered, but the account counter is shared beyond BEAN's processes.
