# BEAN Intelligence — Four-Product Backend Connectivity Audit

**Date:** 2026-11-04 · **Scope:** RIISHE (conversational), LAXII (image studio), JAZMII (video), CODE GIFTZ (coding)
**Method:** read-only investigation FIRST (no code was modified before root causes were verified against live evidence), then targeted fixes (see `BEAN-INTELLIGENCE-CONNECTIVITY-FIXES.md`) and live verification (see `BEAN-INTELLIGENCE-HEALTH-VERIFICATION.md`).

---

## 1. Architecture as found

Single Next.js 16.1.3 application (dev server on `:3000`) serves all four products and one private routing layer:

| Layer | File | Role |
|---|---|---|
| Public catalog | `src/lib/registry/products.ts` | Client-safe product identity (RIISHE, LAXII, JAZMII, CODE GIFTZ) — no provider details |
| Private backend registry | `src/lib/registry/backends.ts` | Server-only product→backend mapping, 6 descriptors: `bean-llm-hosted-primary` (RIISHE chat), `bean-image-hosted-primary` (LAXII), `bean-image-local-sharp` (LAXII enhancement), `bean-image-selfhosted-diffusers` (LAXII generative editing, **disabled**), `bean-video-selfhosted-candidate` (JAZMII, **disabled**), `bean-code-llm-hosted-primary` (CODE GIFTZ) |
| Health endpoint | `src/app/api/health/route.ts` | Real backend probes with a 20 s TTL cache + in-flight dedup (`src/lib/adapters/health-cache.ts`) |
| Product probes | `hosted-llm.ts`, `hosted-image.ts`, `research/provider.ts`, `sandbox/runner.ts`, `laxii/local-adapter.ts`, `laxii/diffusers-adapter.ts` | One real probe per backend class |
| Dashboard | `src/components/bean/dashboard.tsx` | 2×2 product card grid; fetches `/api/products` + `/api/health` once on mount |
| Gateway surface | `/api/v1/health`, `/api/v1/models` | Gateway-class health + honest model catalogue |
| Auth/CSRF | `src/middleware.ts`, `src/lib/auth/session.ts` | Session cookies; mutation-origin check at the edge |

The single upstream dependency of the hosted backends is the platform-authorized inference gateway (z-ai-web-dev-sdk → `https://internal-api.z.ai/v1`, credentials from `/etc/.z-ai-config`, managed by the platform runtime — no tenant-side secrets exist for these backends). It rate-limits endpoint classes **separately** (measured 2026-10-29): `chat` (chat completions), `functions` (web_search/page_reader), plus the images endpoint class.

**Authentication/CORS/timeouts state found:**
- All product APIs sit behind `requireUser` session auth; the only unauthenticated surfaces are `/api/products`, `/api/health`, `/api/v1/health`, `/api/v1/models` (all contain no secrets — verified by scan, §7).
- Mutations are CSRF-guarded in `middleware.ts` (origin check). No cross-origin API is offered by design.
- Timeouts: LLM/image requests carry `requestMs` from the backend registry (90 s / 180 s); the LAXII reachability probe had a 5 s deadline; **the browser had NO client-side timeout at all** (defect D3 below).

---

## 2. Observed dashboard values vs. verified root causes

| Product | Dashboard showed | Verified state (live probe 2026-11-04) | Root cause |
|---|---|---|---|
| RIISHE | Unavailable, ~307 ms | Unavailable — real probe rejected with upstream **HTTP 429** (324 ms measured) | Upstream gateway rate-limiting the `chat` endpoint class (long throttle window, documented since 2026-10-29). **Genuine upstream failure, not a dashboard bug.** |
| LAXII | Operational, 29 ms | Reachable (HTTP 404 from the metadata route in 21–59 ms) + configured; local Sharp engine executes live; hosted **generation 429'd on a real attempt** at 10:45 | The health probe measures reachability/configuration only (a generation costs ~60 s and is never run per health check). The product WAS operational by that definition, but the live generation attempt proved the hosted capability was being throttled — **the probe could not see it** (defect D4). |
| JAZMII | Unavailable, no probe time | `latencyMs: null` — **no probe runs** | **Correct honest behavior**: no video backend is deployed (`enabled: false` with a truthful reason). Nothing to probe → no duration. The defect was presentation: "Unavailable" conflated a missing deployment with a failed connection (defect D5). |
| CODE GIFTZ | Unavailable, ~307 ms | Unavailable — same 429 class | **Shared probe**: RIISHE and CODE GIFTZ consumed the ONE cached `hostedLlmAdapter.health()` result, so both rendered the identical latency (defect D1). |

### Why RIISHE and CODE GIFTZ both showed ~307 ms

Not an HTTP 307 and not a coincidence: `/api/health` called `hostedLlmAdapter.health()` **once** under cache key `llm-hosted-primary` and assigned the same measured report to both products. One probe → one latency → rendered twice. The identical numbers were an artifact of shared evidence, while the underlying failure (upstream 429) was and is genuine for both products, which genuinely share the same chat endpoint class.

### Why JAZMII had no probe duration

The registry entry for video generation is `enabled: false` ("No video-generation backend is deployed. BEAN does not simulate video jobs"). The health route fabricates no probe for it — `latencyMs: null` is the honest value, and the dashboard printed "probe —". The missing deployment is confirmed live: `POST /api/jazmii/generate` → `{"rejected": true, "code": "NO_BACKEND"}` with an audited job row (`status: unsupported`, `errorCode: NO_BACKEND`).

### LAXII's actual health endpoint and capabilities

- Health probe = GET `{gateway}/models` with tenant credentials; the gateway answers **HTTP 404** (metadata route absent — the measured normal case since deployment) which the probe treats, correctly and explicitly, as "host reachable; NOT proof of generation".
- Capabilities verified live on 2026-11-04: deterministic enhancement (Sharp) **works** (job completed, real output asset); hosted image generation **currently 429-throttled upstream** (real attempt failed at progress 15; evidence in `dev.log` `laxii.job_failed`); generative editing **honestly refused** (`POST /api/laxii/edit` mode `smart-edit` → 503 `PROVIDER_UNAVAILABLE` with the truthful reason); asset upload **works** (201).

---

## 3. Defects found (and their status)

| ID | Defect | Severity | Status |
|---|---|---|---|
| D1 | RIISHE and CODE GIFTZ shared ONE health probe result (identical latency/detail; not independent) | Medium | **Fixed** — independent probe cache keys per product |
| D2 | A probe that THROWS would reject the route's `Promise.all` → whole `/api/health` 500 → all four products' statuses die together | Medium | **Fixed** — `safeProbe` isolation (`src/lib/adapters/safe-probe.ts`) on every probe in both health routes |
| D3 | No client-side timeout on the dashboard's health fetch — a hung request left skeletons forever | Medium | **Fixed** — opt-in `timeoutMs` in `beanFetch` (15 s for dashboard calls; unchanged behavior for all other callers) |
| D4 | A reachable-but-throttling gateway was invisible to LAXII's status (reachability probe cannot see generation failures; live evidence: real generation 429'd while probe passed) | High | **Fixed** — real-attempt evidence tracker (`src/lib/adapters/last-attempts.ts`): recent upstream-class generation failures → LAXII **Degraded** with the measured category/HTTP status |
| D5 | "Unavailable" conflated *failed connection* with *not configured* | Medium | **Fixed** — four-state contract (`productStatus`), JAZMII renders "Not configured" |
| D6 | Redirects were silently followed by the LAXII reachability probe (`fetch` default) — a 3xx answer from wherever the gateway redirects could count as health | Medium | **Fixed** — `redirect: 'manual'`; 3xx is its own honest `redirected` category, never healthy, target never surfaced |
| D7 | The LAXII probe treated ANY status except 401/403/429 as healthy — including a **500** | High | **Fixed** — only 2xx and the known-absent metadata route (404) count as verified; 5xx/unexpected 4xx → unhealthy with `backend-error` |
| D8 | Health data fetched once on mount and presented as current forever; no refresh, no failure signal, no evidence age | Medium | **Fixed** — 45 s auto-refresh + refresh-on-tab-focus + manual "Refresh availability" control + global "availability checked Xs ago" + refresh-failure announcement |
| D9 | No structured failure information (a bare red badge with no reason) | Medium | **Fixed** — `failureCategory` + `httpStatus` on every probe; dashboard renders e.g. "rate-limited (HTTP 429)"; hover tooltip carries the safe detail text |
| D10 | Probe cards showed durations even when no probe completed (deferred/breaker) or nothing existed to probe | Low | **Fixed** — duration only for completed probes; "probe deferred" / "not probed" otherwise |
| D11 | Four cards had unequal heights (top row 227 px vs bottom 206 px at 1280 px viewport) | Cosmetic (explicit user work order) | **Fixed** — see `BEAN-INTELLIGENCE-CONNECTIVITY-FIXES.md` §4 and the card-uniformity note |

**Not a defect (verified, kept as-is):** JAZMII's null probe duration (truthful no-backend); LAXII's 404-based reachability semantics (explicitly documented in the probe itself); the upstream 429 windows themselves (platform-side; the in-repo 429 breaker already prevents retry storms and its discipline is preserved).

---

## 4. Evidence captured during this audit

- `scripts/bean-connectivity-out/evidence.json` — full per-product live verification output (auth walls, catalogues, controlled attempts, NO_BACKEND job row, leak scans).
- `scripts/bean-connectivity-out/dashboard-after.png` / `dashboard-mobile.png` — rendered dashboard after fixes (1280 px / 390 px).
- `dev.log` — `laxii.job_failed` (upstream HTTP 429, jobId recorded), `codegiftz.chat_failed` (breaker skip), probe 429s with timestamps.
- Test suite: `tests/unit/connectivity-health.test.ts` (new, 19 tests) + updated `tests/unit/health-mapping.test.ts`; totals in the verification report.

---

## 5. Honesty boundaries preserved

- No endpoint, mock or hardcoded status was introduced anywhere; every status derives from a real probe or a real attempt.
- The 429 discipline (one controlled attempt per product class, then record + stop) was honored during verification; no retry storms were created.
- No credentials, session cookies, stack traces or internal URLs appear in any health payload (leak-scan evidence in §7 of the verification report).
- CODE GIFTZ's W1–W5 closure blockers are untouched: live JSON+SSE completion verification remains BLOCKED by the same upstream 429 window and is reported as such, not claimed.
