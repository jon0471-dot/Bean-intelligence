# BEAN Intelligence — Connectivity Fixes

**Date:** 2026-11-04 · Companion to `BEAN-INTELLIGENCE-CONNECTIVITY-AUDIT.md` (root causes D1–D11) and `BEAN-INTELLIGENCE-HEALTH-VERIFICATION.md` (live results).

Design rule honored throughout: **no fake endpoints, no mock responses, no hardcoded operational statuses, no redesign.** Every fix makes measured evidence more precise; none of them upgrades a failure or invents a success.

---

## 1. Server — health contract (Phase 2 + Phase 3)

### 1.1 `src/lib/adapters/types.ts` — structured failure evidence
- New `HealthFailureCategory` union: `rate-limited | auth | billing | timeout | network | unreachable | misconfigured | redirected | not-configured | backend-error`.
- `HealthReport` gains `httpStatus?: number | null` (observed HTTP status; `null` when no HTTP exchange happened or the transport does not expose one — e.g. the managed SDK's successful completions) and `failureCategory?: HealthFailureCategory | null` (null on healthy reports).

### 1.2 `src/lib/upstream/gateway.ts` — one canonical mapping
- New exported `healthFailureCategory(kind)` maps the existing `UpstreamFailureKind` to the payload category. Shared by the LLM, research and sandbox probes so the same upstream failure always reports the same category.

### 1.3 `src/lib/adapters/hosted-llm.ts` — LLM probe (RIISHE / CODE GIFTZ)
- `health()` now returns `httpStatus` (parsed from the classified failure) and `failureCategory` on unhealthy outcomes; explicit `null`s on success (no guessed status).

### 1.4 `src/lib/adapters/hosted-image.ts` — LAXII probe (D4, D6, D7)
- `probeGatewayReachability` now uses **`redirect: 'manual'`**: a 3xx answer is reported as its own `redirected` state and is **never** followed or counted as healthy; the redirect target URL is deliberately NOT surfaced (may point somewhere internal). Deadline is env-tunable (`BEAN_IMAGE_PROBE_TIMEOUT_MS`, bounded 100 ms–15 s, default 5 s) and always present.
- Status semantics tightened: healthy **only** for 2xx or the known-absent metadata route (404 — the measured normal case for this gateway, kept honest in the detail text); 401/403 → `auth`; 429 → `rate-limited`; **5xx → unhealthy `backend-error`** (previously wrongly healthy); other 4xx → `backend-error`; abort → `timeout`; network failure → `unreachable`; missing config → `misconfigured`.
- Every branch carries `httpStatus` + `failureCategory`.

### 1.5 `src/lib/research/provider.ts`, `src/lib/sandbox/runner.ts`
- Both probes return the structured fields too (deferred probes: `latencyMs: null`, `failureCategory: 'rate-limited'`, `httpStatus: null` — a skipped probe is never rendered as a measured latency).

### 1.6 `src/lib/adapters/health-cache.ts` — last-success tracking
- The globalThis store gains `lastHealthyAt` (per probe key) with a **shape backfill** (a store created by an older module instance during hot-reload previously crashed `lastHealthyAtFor` with "Cannot read properties of undefined (reading 'get')" — measured live during this audit, fixed by backfilling the field).
- `lastHealthyAtFor(key)` exposes when a backend last **passed a real probe**; only fresh probe successes write it (cache replays never do); failures never erase it; process restart resets it to an honest unknown.

### 1.7 `src/lib/adapters/last-attempts.ts` — NEW: real-attempt evidence (D4)
- Records the outcome of every **real** hosted image generation attempt at the queue worker (`src/lib/jobs/queue.ts`): successes and failures alike, never synthetic probes.
- Only **upstream-class** failures (`rate-limited | auth | billing | timeout | network | unreachable`) can affect product status — a content-policy/user-error rejection is request-specific, not product health.
- `recentUpstreamFailure(task)` returns the failure only while fresh (15 min window — conservative vs the measured multi-minute 429 windows); a success overrides it; the full attempt stays visible as history (`lastGenerationAttempt` in the payload).

### 1.8 `src/lib/jobs/queue.ts` — observation point
- `processImageJob` records `noteRealAttempt('image-generation', …)` on completion (success) and on failure (classified via `classifyUpstreamError` + `healthFailureCategory`; `timed out` messages map to `timeout`).

### 1.9 `src/lib/adapters/safe-probe.ts` — NEW: failure isolation (D2)
- `safeProbe(key, probe)` wraps `cachedHealth`; a throwing probe becomes an honest failed report (`failureCategory: 'backend-error'`, no stack trace) instead of 500-ing the whole endpoint. Used by **all** probes in `/api/health` and `/api/v1/health`.

### 1.10 `src/app/api/health/route.ts` — rewritten composition
- **Independent product probes (D1):** RIISHE probes under key `llm-hosted-primary`, CODE GIFTZ under its own key `code-giftz-chat-primary` (matching the registry's separate `bean-code-llm-hosted-primary` descriptor). Independent measured evidence; both still honor the same chat-class 429 breaker (same upstream endpoint class — honest fail-fast, zero network traffic while open, so no throttle-deepening probe storm).
- Every probe through `safeProbe` (D2).
- Each product entry now carries: server-derived `status` (same pure function the dashboard uses), `probe` (with structured fields), `lastHealthyAt`, plus the existing capability layers (`research`, `sandbox`, `deterministic`, `generative`) and LAXII's `generation` evidence + `lastGenerationAttempt`.
- JAZMII: explicit `status: 'not-configured'`, truthful reason as detail, `latencyMs: null`, `failureCategory: 'not-configured'` — no fabricated probe.
- Payload also exposes `probeCacheTtlMs` (20 000) so consumers can reason about freshness.

### 1.11 `src/lib/registry/status.ts` — four-state derivation (D5)
- `ProductStatus` = `operational | degraded | unavailable | not-configured`.
- Registry entry with no enabled backend → `not-configured` (missing deployment), distinct from `unavailable` (a configured backend failed its measured probe).
- Secondary-capability failures (research / sandbox / generation) → `degraded`. A disabled registry entry still outranks any probe (no green product without a backend).

---

## 2. Client — dashboard integration (Phase 4)

### 2.1 `src/components/bean/shared.tsx`
- `beanFetch` gains an **opt-in** `timeoutMs` (AbortController-based; timer always cleared; a caller-supplied signal always wins). Undefined ⇒ byte-for-byte previous behavior for every existing caller.

### 2.2 `src/components/bean/dashboard.tsx`
Availability information only — card design, colors, typography, icons, borders, shadows, grid untouched:
- **Refresh without page reload (D8):** 45 s interval (each cycle carries a real re-probe because the server TTL is 20 s), refresh on tab focus, manual "Refresh availability" control, and a global "availability checked Xs ago" indicator. Excess-request guards: skip while a refresh is in flight or one finished < 10 s ago (plus the server's dedup/TTL and the 429 breaker).
- **Checking state (Phase 3):** badges show "Checking…" (existing gold badge) while a refresh round-trip is in flight; initial load keeps the existing skeletons; a never-loaded health payload renders "Status unknown" instead of implying evidence.
- **Meaningful failure info (D9):** footer shows the measured category + HTTP status, e.g. `probe deferred · rate-limited (HTTP 429)`; Degraded products name the failing capability (`research: …`, `sandbox: …`, `generation: rate-limited (HTTP 429)`); the full safe detail text + checkedAt is on the footer's hover tooltip. Compact labels keep footers single-line.
- **Honest durations (D10):** `probe Nms` only when a probe completed; `probe deferred` (breaker open) or `not probed` (nothing to probe) otherwise.
- **Not-configured ≠ Unavailable (D5):** gold "Not configured" badge for registry-disabled products.
- **Stale guard:** on refresh failure the last measured statuses stay visible and the indicator switches to `refresh failed (…) — showing the last measured status` — stale data never poses as current.
- Health fetches use the new 15 s timeout (D3).

---

## 3. Tests (Phase 6) — no test weakened, all pre-existing assertions preserved except the three documented below

**New file `tests/unit/connectivity-health.test.ts` (19 tests)** covering, against real production code with faults injected only at the real boundaries (SDK mock, global fetch, injected probes):
1. Redirects: 302/307 → not healthy, `redirected` category, target never surfaced, `redirect: 'manual'` pinned on the wire.
2. Timeout: hung gateway → `timeout` category, no HTTP status, deadline message (via the bounded env override).
3. Connection refusal → `unreachable`, distinct from timeout/misconfiguration.
4. Invalid configuration (missing baseUrl/apiKey) → `misconfigured`.
5. Backend failures: 500 → unhealthy `backend-error` (the previously-wrong behavior pinned as a regression); unexpected 405 → not verified; 200/404 → healthy with structured evidence; 401/429 keep categories + statuses.
6. `safeProbe` isolation: throwing probe → honest failed report without stack trace; sibling probe unaffected.
7. `lastHealthyAt` tracking: success records, failure leaves untouched, unknown key → null.
8. Real-attempt evidence: fresh upstream failure → LAXII `degraded`; success overrides; content-class rejection is NOT product-health evidence; expiry after the 15 min window; probe-driven fallback.
9. `beanFetch` timeout: hung request → `AbortError`; fast response unaffected; no `timeoutMs` ⇒ no abort wired (unchanged legacy behavior).

**Updated `tests/unit/health-mapping.test.ts`:** the three assertions pinning `productStatus(false, …) === 'unavailable'` now expect `'not-configured'` — the truth policy itself (no enabled backend can never be green, measured beats configured) is unchanged and still asserted; only the state NAME became precise. Documented in the test file.

**Totals:** 994 pass / 0 fail across 63 files (28 995 expects) — up from 951/0/60 before this audit (W1–W5 baseline), i.e. +43 tests, zero regressions.

---

## 4. Dashboard card uniformity (the UI-only work order)

**Requirement:** all four cards exactly equal width and height at the same viewport, using the bottom cards (JAZMII/CODE GIFTZ, 206 px at 1280×900) as reference; reduce the top two (RIISHE/LAXII, 227 px); no truncation/removal of text; no clipping/overflow; no design/typography/spacing changes; preserve responsive layout.

**Measured conflict:** the top row was 21 px taller ONLY because LAXII's description renders 4 lines (85 px) vs 3 lines (63 px) for the other three cards, and every card's footer wrapped to 2 lines (the failure-info text added by Phase 4). Forcing 206 px would clip exactly one line of LAXII's description — violating the task's own harder constraints ("Do not truncate or remove any existing text", "no clipping, overflow or overlapping content").

**Implemented (CSS-only, minimal):**
1. Footer compacted to ONE line for all cards: the per-card "checked Xs ago" moved to the global indicator next to Refresh (all cards share one fetch cycle), failure labels compacted (same facts, fewer words), detail text moved to the native hover tooltip.
2. `sm:min-h-[207px]` on all four cards — 207 px is LAXII's exact full-text content height, i.e. the bottom-card reference (206 px) + 1 px, the minimum height at which no card clips.

**Verified computed geometry (agent-browser, `getBoundingClientRect`):**
| Viewport | Result |
|---|---|
| 1280×900 | RIISHE 488×207, LAXII 488×207, JAZMII 488×207, CODE GIFTZ 488×207 — **identical**, `scrollWidth/scrollHeight` show no overflow |
| 1440×900 | all four 544×207 — identical, no overflow |
| 1024×800 | top row 264, bottom 242 — unequal **by design boundary**: LAXII's description needs a 5th line at this width; forcing equality here would clip it (forbidden). Below the exact-equality breakpoint the honest behavior is "no clip, cards grow as needed". |
| 390×844 (mobile) | `min-h` applies only at `sm+`; single-column natural heights preserved — current responsive layout unchanged |

Deviation from the reference height: +1 px (bottom cards 206→207). This is the minimal deviation that satisfies the no-clip constraint; documented rather than hidden.

---

## 5. Files changed (complete list)

| File | Change |
|---|---|
| `src/lib/adapters/types.ts` | `HealthFailureCategory`, `HealthReport.httpStatus/failureCategory` |
| `src/lib/upstream/gateway.ts` | `healthFailureCategory()` canonical mapping |
| `src/lib/adapters/hosted-llm.ts` | probe structured fields |
| `src/lib/adapters/hosted-image.ts` | manual redirects, tightened status semantics, env-tunable deadline, structured fields |
| `src/lib/research/provider.ts` | probe structured fields |
| `src/lib/sandbox/runner.ts` | probe structured fields |
| `src/lib/adapters/health-cache.ts` | `lastHealthyAt` tracker + shape backfill |
| `src/lib/adapters/last-attempts.ts` | NEW — real-attempt evidence |
| `src/lib/adapters/safe-probe.ts` | NEW — probe failure isolation |
| `src/lib/jobs/queue.ts` | records real generation attempt outcomes |
| `src/app/api/health/route.ts` | independent probes, isolation, derived statuses, lastHealthyAt, generation evidence |
| `src/app/api/v1/health/route.ts` | isolation via shared `safeProbe` |
| `src/lib/registry/status.ts` | four-state `productStatus` |
| `src/components/bean/shared.tsx` | `beanFetch` opt-in timeout |
| `src/components/bean/dashboard.tsx` | refresh/checking/failure-info/not-configured/stale-guard + card uniformity (`sm:min-h-[207px]`, one-line footers) |
| `tests/unit/connectivity-health.test.ts` | NEW — 19 tests |
| `tests/unit/health-mapping.test.ts` | three assertions updated to `not-configured` (documented) |
| `scripts/bean-connectivity-verify.ts` | NEW — live per-product verification script (evidence generator) |
| `docs/reports/BEAN-INTELLIGENCE-*.md` | the three required reports |

**Unchanged on purpose:** all product routes/behavior (RIISHE/LAXII/JAZMII/CODE GIFTZ APIs), the router, the registry truth policies, the 429 breaker discipline, the JAZMII no-simulation policy, CODE GIFTZ's W1–W5 implementation and its tests.
