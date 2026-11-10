# BEAN Intelligence — Health Verification

**Date:** 2026-11-04 · Companion to `BEAN-INTELLIGENCE-CONNECTIVITY-AUDIT.md` and `BEAN-INTELLIGENCE-CONNECTIVITY-FIXES.md`.
All results below are from **real, live calls** against the running application (`http://localhost:3000`) — no simulated endpoints. Evidence file: `scripts/bean-connectivity-out/evidence.json`; screenshots in the same directory.

---

## 1. Dashboard end-state (rendered, verified in the real browser)

| Product | Badge now | Footer (measured) | Correct because |
|---|---|---|---|
| RIISHE | **Unavailable** (red) | `probe 195ms · rate-limited (HTTP 429)` | Its own probe really ran and really got a 429 |
| LAXII | **Operational** (green) / **Degraded** (gold) while a recent real generation failed | `probe 168ms` (or `generation: rate-limited (HTTP 429)`) | Reachable + configured + local engine live; degradation appears from REAL attempt evidence within the 15 min window |
| JAZMII | **Not configured** (gold) | `not probed · backend not deployed` | No video backend deployed — missing configuration, not a failed connection; no fake probe duration |
| CODE GIFTZ | **Unavailable** (red) | `probe 441ms · rate-limited (HTTP 429)` | Its OWN probe (441 ms ≠ RIISHE's 195 ms — independence visible on screen) |

Global footer: `availability checked 27s ago · ⟳ Refresh availability`. Auto-refresh every 45 s + on tab focus + manual control. During a refresh the badges show **Checking…**.

Card geometry (UI-only work order): all four cards **488×207 px identical** at 1280×900 (also 544×207 at 1440×900), no overflow/clipping; mobile (390 px) keeps the natural responsive single-column layout. Reference height honored within +1 px (206→207 — the minimum height at which LAXII's full 4-line description fits without clipping; see FIXES §4).

---

## 2. Per-product live verification (Phase 5)

### RIISHE — Conversational Intelligence
| Check | Result | Evidence |
|---|---|---|
| Health endpoint | measured: `available=false`, latency 176–324 ms (varies by run), `httpStatus=429`, `failureCategory=rate-limited` | `/api/health` live payloads |
| Authentication (API surface) | unauthenticated `POST /api/riishe/chat` → **401** PASS | evidence.json `riishe.live.unauthWall` |
| Upstream credential state | **HTTP 429, not 401** — the gateway authenticated the tenant request and throttled it; credentials are accepted, quota is the constraint | probe detail + `dev.log` |
| Conversational connectivity / actual response generation | **BLOCKED (upstream 429 window)** — one controlled attempt at 10:45:35Z returned the honest typed error `RATE_LIMITED` ("call skipped to avoid worsening the throttle"; zero network while the breaker is open). Earlier real probes measured actual 429 responses. 429 discipline honored: one controlled attempt, recorded, no retry storm. | evidence.json `riishe.live.liveAttempt` |
| Session-level auth | `requireUser` enforced on the chat route (401 without session) | same |

### LAXII — Image Creation & Preservation Studio
| Check | Result | Evidence |
|---|---|---|
| Health endpoint | measured: `available=true`, `httpStatus=404` (gateway host answers; metadata route absent — documented normal case), probe detail explicitly states generation is NOT tested here | `/api/health` |
| Image generation capability | **Real attempt:** job submitted (202, jobId `cmw1zqiwu002essu3ogw5kikh`) → **failed at progress 15 — upstream HTTP 429** (`dev.log` `laxii.job_failed`). The failure is now visible as product **Degraded** evidence for 15 min. A second controlled attempt at 11:07 also 429'd (recorded; then stopped per 429 discipline). | evidence.json + tracker payload `lastGenerationAttempt` |
| Image enhancement capability | **PASS — real work:** asset uploaded (201, assetId `cmw1zqmgo002jssu3iq3q4h1q`) → deterministic enhancement job **completed** (`pipeline: deterministic-sharp`, measured `exactPreservedPct` recorded by the engine) | evidence.json `enhanceResult` + `dev.log` `laxii.preservation_job_completed` |
| Preservation/editing capability | **Honest refusal:** `POST /api/laxii/edit` (`smart-edit`) → **503 `PROVIDER_UNAVAILABLE`** with the truthful reason "local Diffusers worker has not passed its hardware preflight…". No fake edit output. | evidence.json `smartEditRefusal` |
| Honest capability availability | generation = upstream-throttled (real evidence), enhancement = operational, editing = not deployed — each reported separately | `/api/health` capability layers |

### JAZMII — Video Generation Engine
| Check | Result | Evidence |
|---|---|---|
| Health endpoint | `status=not-configured`, `latencyMs=null`, `failureCategory=not-configured`, detail = registry truth ("No video-generation backend is deployed…") | `/api/health` |
| Video job submission | `POST /api/jazmii/generate` → **`{rejected: true, code: NO_BACKEND}`** with the deploy-a-worker guidance; **no synthetic job** | evidence.json `jazmii.submit` |
| Job status tracking | The truthful rejection is recorded as an auditable job row: id `cmw1zqoup002vssu3i5qeecd6`, `status=unsupported`, `errorCode=NO_BACKEND`; owner-only poll `GET /api/jazmii/jobs/<id>` → 200 `unsupported` | evidence.json `jobRecord` + `jobPoll` |
| Preview / export availability | None offered — the generate schema intentionally omits duration/resolution parameters ("never promise unsupported capability"); no preview/export endpoints exist | route inspection |

### CODE GIFTZ — Coding Intelligence
| Check | Result | Evidence |
|---|---|---|
| Health endpoint | Its OWN probe (key `code-giftz-chat-primary`): `available=false`, `httpStatus=429`, `rate-limited`; latency measured independently (441 ms vs RIISHE 195 ms in one cycle — separate results on screen) | `/api/health` |
| Authentication | unauthenticated `POST /api/code-giftz/chat` → **401** PASS | evidence.json `giftz.unauthWall` |
| Model catalogue | `GET /api/v1/models` → 200, 7 entries with honest availability: `bean-image-hosted: available`, `bean-image-enhance-local: available`, `bean-chat-hosted: unavailable`, `bean-code-hosted: unavailable` (upstream 429), `bean-image-edit-local: disabled`, `bean-video-selfhosted-candidate: disabled`, `bean-external-openai-compatible: awaiting-credentials` | evidence.json `modelCatalogue` |
| Code generation connectivity | **BLOCKED (same upstream 429 window)** — one controlled attempt: SSE stream opened (HTTP 200) and delivered the honest typed error frame `UPSTREAM_RATE_LIMITED` (`partial: true`); user text preserved for retry. **W1–W5 closure blockers remain exactly as documented; no live JSON/SSE completion pass is claimed.** | evidence.json `giftz.liveAttempt` |
| Sandbox capability | measured available (bun runtime executed a trivial script, ~50 ms) | `/api/health` `code-giftz.sandbox` |

---

## 3. Isolation verification (one backend failing ≠ others failing)

Captured in one health cycle while the chat class was 429-throttled upstream:
`riishe=unavailable · laxii=operational · jazmii=not-configured · code-giftz=unavailable`.
LAXII and JAZMII were completely unaffected by the chat-class failure; RIISHE and CODE GIFTZ now fail on **independent** measured evidence instead of one shared result; a throwing probe can no longer take the endpoint down (`safeProbe` unit tests + live 200 responses throughout).

## 4. Regression and safety (Phase 6)

| Gate | Result |
|---|---|
| Full Bun suite | **994 pass / 0 fail** (63 files, 28 995 expects) — baseline before this audit: 951/0/60; +43 tests, zero regressions |
| New health/connectivity tests | `tests/unit/connectivity-health.test.ts` — 19 tests: success, timeout, connection refusal, invalid configuration, redirects (302/307), 5xx, unexpected 4xx, probe-throw isolation, last-success tracking, real-attempt degradation, client timeout |
| `tests/unit/health-mapping.test.ts` | 3 assertions updated to the `not-configured` state name (truth policy preserved and still asserted); all other pre-existing tests untouched |
| ESLint | **0 problems** |
| tsc | **11 errors — identical to the pre-audit baseline**, all in `scripts/` legacy files; none in `src/` or `tests/` |
| Production build | not rebuilt in this task (supervisor policy: the dev server is the preview; no builds beside it — the OOM guard). `next build` was green at the W6 baseline (19.9 s, 44 pages) and no build-affecting config changed. |
| Credentials in frontend bundle | scan of client chunks for `ZAI_GATEWAY_CREDENTIALS`, `sk-…`, session-cookie literals, private-key blocks: **clean** |
| Credentials in API responses | leak scan over health/products/models/chat/edit/enhance/JAZMII responses: **0 hits** in 9 scanned surfaces |
| Production `custom.db` | untouched except the app's own legitimate writes (verify-user registration, the audited LAXII/JAZMII job rows created by the tests themselves); no destructive DB operation performed |
| Git history | preserved; no history rewrite; work committed as new commits on `main` |

## 5. Unresolved blockers (honest list)

1. **Upstream gateway 429 window (chat + images + functions classes)** — platform-side throttling, windows measured to last minutes. Effects while open: RIISHE and CODE GIFTZ report Unavailable with measured 429 evidence; LAXII generation attempts fail (product shows Degraded); live JSON/SSE completion verification stays BLOCKED. This is an **environment blocker, not an in-repo defect** — the breaker, the typed errors and the honest statuses are the correct in-repo behavior. Recovery is verified by the next real probe (never assumed).
2. **JAZMII has no video backend** — deployment of a licensed GPU worker (and license authorization) is required before JAZMII can accept jobs. Reported as `not-configured` until then; no simulation exists or will be added.
3. **LAXII generative editing** requires the local Diffusers worker (GPU preflight + a real inference acceptance test) — honestly refused at the API; dashboard reports the capability layers truthfully.
4. **Card equality below ~1100 px desktop width** — at e.g. 1024×800 LAXII's description needs one more wrapping line, so rows can differ; forcing equality there would clip text, which the work order forbids. Equal-height is guaranteed at the inspected viewport sizes (1280/1440) and the mobile layout is untouched.
5. **CODE GIFTZ live streaming/JSON completions** remain at the W1–W5 documented state (BLOCKED by blocker 1); the streaming transport itself was exercised (SSE opened, typed error frame delivered, connection closed cleanly).

## 6. Acceptance criteria — final check

- [x] All four product connections investigated (read-only first; root causes verified with live evidence)
- [x] Every confirmed defect has a documented correction (D1–D11 → FIXES report) or is an explicit blocker (§5)
- [x] Health statuses reflect genuine backend probes (five-state contract incl. Checking; measured beats configured; nothing invented)
- [x] Product capabilities reported honestly (per-capability layers; real-attempt evidence; honest refusals)
- [x] No existing product functionality unnecessarily changed (product routes/router/registry untouched; API shapes backward-compatible)
- [x] Regression tests pass (994/0; ESLint 0; tsc at baseline)
- [x] The actual BEAN Intelligence website preview was opened and inspected in a real browser (dashboard end-state + screenshots + computed geometry verification)
- [x] Backend not deployed/configured → reported as such (JAZMII not-configured; LAXII editing; CODE GIFTZ blockers) — nothing was manufactured to make the dashboard green
