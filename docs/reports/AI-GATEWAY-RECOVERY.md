# AI Gateway Recovery — Account-Wide HTTP 429 Audit

**Date:** 2026-11-04
**Scope:** Authorized upstream inference gateway (`z-ai-web-dev-sdk` → provider-managed endpoint, tenant credentials from the platform runtime). This is the ONLY configured provider for this deployment.
**Branch/HEAD at audit:** `main` @ `2fd0621` (+ Phase 1 working tree changes, see "Changes shipped" below)
**Verdict:** The 429 is an **account-wide temporary rate limit (throttling) answered at the provider edge** — not invalid credentials, not a billing refusal, and not a model-specific rejection. It affects every endpoint class the account serves (chat, functions, images). The provider discloses no quota counters, no `Retry-After`, and no reset time; recovery is therefore verified by real spaced probes through a bounded escalating circuit breaker, never assumed.

---

## 1. Live probe evidence (2026-11-04T15:14Z, single spaced probes, no fan-out)

Probe script: `scripts/phase1-gateway-probe.ts` · Raw artifact: `scripts/phase1-gateway-out/probe.json`

| Endpoint class | Request | Result | Latency | Classification |
|---|---|---|---|---|
| `chat` | POST chat completions (`Reply with exactly: OK`) | **HTTP 429** — `{"error":"Too many requests, please try again later"}` | 26 ms | `rate_limited` |
| `functions` | POST web_search (`num: 1`) | **HTTP 429** — same generic body | 9 ms | `rate_limited` |
| `images` (metadata only) | GET `{baseUrl}/models`, `redirect: manual` | **HTTP 404** — host answered, metadata route absent (measured normal case for this gateway) | 4 ms | reachable, **not** proof of generation capability |

Corroborating history from BEAN's own database (`GenerationJob`):
- `laxii / image-generation`: 5 `completed`, 7 `failed` with `BACKEND_FAILURE` (upstream 429s observed during the 2026-11-04 connectivity audit — a real generation was 429'd while the cheap reachability probe passed).
- `code-giftz / coding-task`: 6 `completed` (earlier live acceptance, before the throttle).
- `jazmii / video-generation`: 7 honest `NO_BACKEND` refusals (no video backend existed; never faked).

No video or image generation was submitted during this audit (cost + long latency + a throttled account); the images/video endpoints are assessed via the typed SDK surface and read-only metadata route.

## 2. Audit checklist (every requested item)

| # | Check | Method available to this tenant | Finding |
|---|---|---|---|
| 1 | Provider account quota | Provider exposes **no tenant-facing quota endpoint**; error body carries no quota specifics | **Not directly readable.** The uniform generic 429 across two independently-throttled endpoint classes is consistent with an account-level RPM/TPM window; daily-quota exhaustion cannot be excluded from the tenant side. |
| 2 | Billing / account status | HTTP status discrimination | A billing refusal would be **HTTP 402** (BEAN maps it to the typed `UpstreamBillingError`). Observed status is 429 → **billing refusal not indicated**. |
| 3 | Rate limits | Measured probe behavior | Confirmed active: immediate edge rejection (9–26 ms) with a window measured to last **minutes** (2026-10-29: single spaced probes still 429 more than six minutes after the last burst). |
| 4 | Requests per minute | Not disclosed by provider; BEAN enforces its own caps | Provider RPM counters are not tenant-visible. BEAN-side limits: per-user sliding window + per-backend `maxInFlightPerUser` / `maxInFlightTotal` (router) + per-caller gateway burst limit and durable daily quota (`ai-gateway/types.ts`). |
| 5 | Tokens per minute | Not disclosed by provider | No TPM accounting exposed to the tenant. BEAN records estimated tokens in/out per call (`UsageRecord`). |
| 6 | Daily quotas | Not disclosed by provider | Cannot be verified against the provider; BEAN enforces its own durable daily quota per calling principal (`GATEWAY_DAILY_QUOTA`). |
| 7 | API key validity | Status discrimination | An invalid key yields **401/403** (typed `UpstreamAuthError`). The key was **accepted** (throttle is applied after auth) → **credentials are valid**. |
| 8 | Organization / project configuration | Not exposed by the provider API | No tenant-facing org/project endpoints exist on this gateway; no evidence of org-level restriction beyond the throttle itself. |
| 9 | Model availability | Typed SDK surface; 429 is pre-model | The 429 body contains no model-conditional wording and applies to both endpoint classes → **not model-specific throttling**. Model identity remains provider-managed (not disclosed to tenants; recorded verbatim in the registry). |
| 10 | Retry-after headers | SDK discards response headers (verified against `dist/index.js`: only `status` + body are thrown) | **No `Retry-After` is available** — neither via headers nor the body. BEAN therefore never fabricates a reset time; cooldowns are BEAN's own conservative backoff, and expiry is verified by a real probe call. |
| 11 | Regional availability | Reachability probe | The configured host answers (GET /models → 404 in 4 ms). No evidence of regional blocking; a region-restricted endpoint would not authenticate-and-throttle normally. |
| 12 | Provider request logs | Not tenant-visible | The provider does not expose request logs to this tenant. BEAN-side equivalents: `GatewayRequestLog` (per-call status/error/tokens/duration) and per-product `GenerationJob` records — both preserve the failure history without prompts or secrets. |
| 13 | Concurrent request limits | BEAN-side enforcement (verified in code) | Router enforces per-user and total in-flight caps per backend descriptor; the gateway adds a per-principal sliding-window burst limit. A 429 additionally opens the per-class breaker so concurrency cannot multiply probes into a throttle. |

## 3. Determination

| Hypothesis | Evidence for | Evidence against | Verdict |
|---|---|---|---|
| Account-wide quota exhaustion | All endpoint classes 429 simultaneously; generic wording | No quota specifics in body; earlier windows recovered within minutes (more typical of a rolling RPM window than a hard daily cap) | **Possible but unverifiable from the tenant side** |
| Model-specific throttling | — | 429 is identical across chat + functions (+ images per the 11-04 audit) with no model-conditional wording | **Excluded** |
| Temporary rate limiting (RPM/TPM window) | Immediate edge 429; windows measured to last minutes; earlier recovery history | — | **Most consistent — accepted** |
| Invalid billing configuration | — | 402 never observed; auth succeeds (throttle applies post-auth) | **Excluded** |
| Organization/project restriction | — | No org-specific error surface; throttle is uniform | **No evidence** |
| Excessive concurrent requests from BEAN | Router caps were already enforced before this audit | BEAN's own request volume at the time was modest (single-user acceptance runs); 429s also occurred after idle periods | **Contributing factor possible during bursty turns; mitigated below** |

## 4. Changes shipped in this recovery (all tested, no behavior faked)

1. **Bounded escalating backoff** (`src/lib/upstream/gateway.ts`): consecutive observed 429s (no intervening success) double the per-class cooldown **60 s → 120 s → 240 s → 480 s → 600 s (hard cap)**; any real success resets the streak. A success never pre-clears an open window — recovery stays verified call-by-call. Result: a throttled account sees at most one real probe per cooldown window, tapering to one probe per 10 minutes, instead of a probe every minute indefinitely.
2. **Images endpoint-class breaker** (`src/lib/adapters/hosted-image.ts`): image generations previously fired into an account-wide throttle even while the cheap reachability probe passed (measured 2026-11-04). They now fail fast with the typed `UpstreamRateLimitError` (zero network traffic) while the images-class breaker is open, open the breaker on an observed 429, and reset the streak on success.
3. **New endpoint classes** `video` and `audio` reserved in the breaker taxonomy for the JAZMII video and audio integrations (this report's §6) — per-class isolation from day one.
4. **Success accounting**: real successes on the `chat` (`hosted-llm`) and `functions` (`research/provider`) classes now reset the escalation streak.
5. **Operator-visible breaker state** (`GET /api/health` → `gateway.breaker`): per-class `coolingDown`, `remainingMs`, `consecutive429s`, `currentCooldownMs`, `last429At`, `skippedCalls`, plus the base/cap window constants — no credentials, no model identities, no endpoints in the payload.
6. **Health isolation preserved**: breakers are strictly per endpoint class; product probes remain independent (safeProbe + per-product cache keys); one product's failure cannot alter another's health result.

## 5. Alternative provider status (honest)

- **No alternative provider is configured in this deployment** (environment carries only `DATABASE_URL`; no OpenAI/Google/BytePlus/Veo credentials exist server-side).
- The unified gateway already contains an **external OpenAI-compatible provider path** (`bean-external-openai-compatible`, typed 429/auth/billing classification, per-credential isolation) that activates only when an administrator adds a credential. It is honestly reported `awaiting-credentials`.
- Per the mission rules, **no provider switch happened** — none was possible, and none would have been done silently. The gateway recovery therefore hardens the ONLY live path.
- The authorized SDK's own capability surface (verified against `dist/index.d.ts`) includes **video generation (async task + polling)**, **image editing** and **audio TTS/ASR** on the same account — these become available when the throttle clears, without any new credentials.

## 6. Recovery plan / how the throttle is handled going forward

1. While a class's breaker is open: zero network traffic for that class; callers receive the honest typed `RATE_LIMITED`/`UpstreamRateLimitError` immediately; the UI keeps the user's message for retry (existing contract).
2. At window expiry the **next real request is the probe**. Success → service resumes and the streak resets. 429 → the window escalates (capped at 10 minutes).
3. Long-running generation endpoints (images/video) NEVER hold an HTTP request open while retrying; they surface the typed failure through the job record and product API (existing queue contract).
4. Unbounded retry loops are prohibited by design: exactly one attempt per request in every adapter (registry `retries.maxAttempts: 1`), plus the bounded breaker.
5. When the throttle clears, live acceptance proceeds per phase (RIISHE / CODE GIFTZ / LAXII / JAZMII reports); a fresh 429 during acceptance re-opens the breaker and is reported as such — never retried into.

## 7. Verification

- `bun test` → **1026 pass / 0 fail / 65 files** (was 1018/0/64; +8 escalation tests in `tests/unit/upstream-backoff-escalation.test.ts`, all prior tests unmodified and passing).
- `bunx tsc --noEmit` → 11 errors, all pre-existing in `scripts/` (recorded baseline), **0 in `src/`**.
- Breaker semantics preserved: the pre-existing `tests/unit/upstream-429.test.ts` suite (fail-fast, per-class independence, recovery-verified-by-real-call) passes unchanged.
