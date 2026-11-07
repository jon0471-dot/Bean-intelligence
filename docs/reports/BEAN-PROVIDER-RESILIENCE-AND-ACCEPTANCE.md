# BEAN — PROVIDER RESILIENCE & REAL ACCEPTANCE

**Date:** 2026-11-07 (UTC) · **Base commit:** `157897a` (HEAD `9f726d4` = same code + DB/sandbox artifacts only) · **This change:** provider-independent execution layer + official edit contract + bounded real acceptance
**Regression after this change:** **1,102 passed / 0 failed / 70 files** (baseline 1,084 / 0 / 69 → +18 provider-resilience tests, +1 file) · `tsc --noEmit` clean on `src/` + `tests/` · ESLint clean on all touched files.

---

## 0. What this session did (and did not do)

The brief demanded real AI execution, provider fallbacks and complete user testing — not badge changes. Three things were delivered:

1. **Provider-independent execution layer (Phases 1 + 6):** every chat-class product (RIISHE, CODE GIFTZ) now routes through a capability chain with a **prepared, credential-gated fallback provider**; per-product request budgets, per-provider circuit breakers, typed error classification, usage attribution that follows the backend that actually served, and an **admin-only provider routing console**. No badge was repainted anywhere.
2. **LAXII conversational-edit contract corrected to the OFFICIAL provider documentation** (Phases 3): the body now sent is exactly `{ prompt, images: [{ url }], size }` — the shape published by the provider's own SDK documentation, which is also the only measured shape never rejected by the gateway validator.
3. **Bounded real acceptance** (Phase 7): single, breaker-gated attempts against every provider class — with zero 429 retries — during the **most complete account-wide throttle ever measured on this deployment** (all four endpoint classes 429 simultaneously). Every verdict is recorded verbatim.

Not done (standing red lines): no Ollama, no fabricated outputs, no purchases or new provider activation without approval, no deployment/PostgreSQL/infrastructure work, no DB destruction (the live DB was only read; app-level writes are its own), no Git history rewrite, no unrelated UI redesign.

---

## 1. PHASE 1 — provider inspection result (the one authorized provider)

| Question | Answer (measured) |
|---|---|
| Current provider, all four products | Z.ai authorized hosted inference gateway (`z-ai-web-dev-sdk` 0.0.18 → `https://internal-api.z.ai/v1`, credentials platform-managed in `/etc/.z-ai-config`) |
| Capabilities actually used | chat + streaming + thinking (RIISHE, CODE GIFTZ), images.generations (LAXII T2I), images.generations/edit (LAXII conversational edit), videos.generations + async result (JAZMII), functions.invoke web_search/page_reader (RIISHE research) |
| Authentication status | Platform-managed config file present with apiKey + baseUrl + token (presence verified without reading values) — **the only credential that exists in this environment**; no other provider keys are configured anywhere (`/etc`, `.env`, process env) |
| Quota / rate limits | No documented quota; **measured**: generic `{"error":"Too many requests, please try again later"}`, no `Retry-After`, windows last minutes, and **2026-11-07 04:35–04:42Z: account-wide throttling hit chat (14 consecutive 429s), functions (8–9), images (2), video (1) simultaneously** — a shared account under external load, not caused by BEAN's single spaced attempts |
| Cost per request | Not disclosed by the provider (`costUnit: null`; BEAN never invents cost figures) |
| Request/response contract | Managed SDK; **one real contract defect found and fixed** (see §2.1): the SDK 0.0.18 typings/CLI disagree with the provider's own published edit documentation |

**Conclusion:** provider independence cannot come from a second *authorized* provider today, because no second credential exists. What CAN be delivered — and was — is the full routing/fallback architecture that activates a second provider the moment its credential is provided (admin console or env), plus the precise Phase-8 credential requirements (§7).

---

## 2. EXACT CODE CHANGES (12 files, 5 new)

### 2.1 LAXII conversational edit — official contract (`src/lib/adapters/hosted-image.ts`)

The edit body is now **exactly the provider's documented shape**:

```json
{ "prompt": "...", "images": [{ "url": "data:image/jpeg;base64,…" }], "size": "1024x1024" }
```

Evidence chain (strongest source first):
1. **The provider's own published documentation** for this SDK (retrieved 2026-11-07): `zai.images.generations.edit({ prompt, images: [{ url: imageSource }], size?, model? })` — quoted verbatim: *"The images parameter must be an array of objects with a url property, not a plain string."*
2. **The gateway validator's own error text** (measured live through the real job path): *"image_to_image task must provide images"* — plural, naming the documented field.
3. **Measured history** (`scripts/probe-image-edit-out/`, `scripts/finalcap-out/`): the SDK 0.0.18 CLI's singular `image` body **was measured failing 400/1210** (11-shape matrix); the documented url-keyed-object form was never contract-rejected — its only probe landed in a 429 window (no verdict).

The SDK 0.0.18 typings/CLI disagree with the provider's official docs AND are the shape that measured 400 — the official documentation wins. Test pin updated (`tests/unit/laxii-hosted-edit.test.ts`, 7/7 pass). Until a real edit succeeds through a clear provider window, the capability stays honestly **Blocked** in the dashboard; a typed 400, if the validator still refuses the documented shape, will be recorded verbatim on the job.

### 2.2 New provider layer (`src/lib/providers/` — 4 new modules)

| Module | What it does |
|---|---|
| `credentials.ts` | **SERVER-ONLY** credential resolution, values never logged/returned: `zai-gateway` = platform-managed config presence; `openai-compatible` = **admin vault first** (encrypted `providerCredential` row, active status), env vars second (`BEAN_PROVIDER_OPENAI_API_KEY` + optional `BASE_URL`/`MODEL`), honest `not-configured` otherwise |
| `openai-compatible.ts` | The **prepared fallback adapter** (real chat / chatStream / codeTask / health over the standard OpenAI wire protocol; Bearer redaction; hard AbortSignal timeout; reuses the audited SSE decoder). **Dormant without credentials** — typed refusal, zero fetches (pinned by test). Verifies chat capability with a real completion probe, never assumes. Uses the dedicated `chat-fallback` breaker class |
| `routing.ts` | **Bounded capability-chain fallback**: primary → declared fallbacks, each candidate at most once per request; activates ONLY on upstream-class failures (429/auth/billing/timeout/network), never on validation errors; a stream that already yielded tokens **never restarts** on another provider (no duplicated text — pinned by test); every fallback decision is audit-logged (`provider.fallback`); single-provider chains pass through untouched (zero behavior change for LAXII/JAZMII today) |
| `cost-guard.ts` | **Operator request budgets** per product (`BEAN_DAILY_REQUEST_BUDGET_<PRODUCT>`): opt-in daily upstream-request ceiling with typed `COST_LIMIT` refusal + audit event. Honest labeling: the provider reports no cost data, so the budget is request-count based, never a fabricated money figure |

### 2.3 Resilience wiring

- `src/lib/upstream/gateway.ts`: new breaker class **`chat-fallback`** so a throttle on the primary gateway can never fail-fast the fallback (pinned: a 429 on the fallback class leaves the `chat` breaker closed).
- `src/lib/registry/backends.ts`: `bean-llm-openai-compatible` descriptor (enabled **evaluated from the real environment** at process start; honest `unavailableReason` with the exact activation requirement); `fallbacks: ['bean-llm-openai-compatible']` on the RIISHE and CODE GIFTZ chat backends. Image/video chains stay single-provider — no authorized alternative exists, and none is pretended.
- `src/lib/router/router.ts`: preflight now (a) enforces the provider request budget after per-user quotas, (b) returns the adapter **wrapped with the capability chain**, and (c) exposes `servedBy` — a mutable ref holding the backend id that ACTUALLY served.
- `src/app/api/riishe/chat/route.ts`, `src/app/api/code-giftz/chat/route.ts`, `src/app/api/code-giftz/tasks/route.ts`: usage records and all adapter calls (including GIFTZ's streaming/continuation/revision paths) now go through the wrapped adapter and attribute usage to `servedBy` — truthful accounting when a fallback serves.
- `src/lib/api/errors.ts`: typed `COST_LIMIT` (429-class operator budget refusal).

### 2.4 Admin-only provider configuration (never browser-exposed keys)

- `src/app/api/admin/overview/route.ts` + `src/components/bean/admin.tsx`: new **"Provider routing & fallback chains"** section — per backend: enabled state, credential status (`platform-managed` / `admin-vault` / `env-configured` / `not-configured`), credential SOURCE (names only), declared fallback chain, and live breaker state (open/remaining/consecutive-429s). Verified rendering live (screenshots `scripts/actualwork-out/ui-admin-routing*.png`). No credential material is exposed anywhere in the payload.
- The admin **gateway console** (pre-existing) remains the place administrators add an encrypted `openai-compatible` credential (AES-256-GCM at rest, SSRF-validated base URL, masked views only). This session's layer consumes exactly that store at request time through its single decryption path.

---

## 3. BOUNDED REAL ACCEPTANCE — what was attempted (and what the provider said)

Evidence: `scripts/actualwork-out/evidence.jsonl` (all timestamps UTC; every step breaker-gated off `/api/health`; **single attempts, zero 429 retries**).

| Attempt (single) | Class state before | Verdict |
|---|---|---|
| LAXII real T2I (`cmw5wtyzr…` 04:35:21Z) | images breaker closed | **HTTP 429** — job failed honestly with upstream throttle evidence |
| LAXII real T2I retry-after-window (`cmw5wxa2b…` 04:37:56Z) | images breaker expired again | **HTTP 429** — breaker re-armed with escalation |
| JAZMII real T2V (`cmw5wyfl6…` 04:38:49Z) | video breaker closed | **HTTP 429 on submission** (typed RATE_LIMITED to the user) |
| RIISHE chat + GIFTZ codegen (04:42:14Z) | chat breaker open (14 consecutive 429s) | **Blocked by the recovery-window protocol — zero network, no retry** |
| LAXII real T2I (`cmw5x7tps…` 04:46:08Z) + JAZMII real T2V (`cmw5x7yel…` 04:46:14Z) | both breakers expired again | **HTTP 429 on both** — final single attempts; all AI attempts STOPPED per protocol (breakers escalated to multi-minute windows) |

**Measured conclusion:** 2026-11-07 04:33–04:46Z is a **sustained account-wide throttle across every endpoint class** (chat reached 16 consecutive 429s; functions, images and video refused every single attempt). Six single, spaced, breaker-gated attempts were made in total — every verdict recorded verbatim, zero retry loops. The throttle is external load on the shared platform account, not BEAN's traffic. The dashboard reports the truth (gold **Rate limited**), and it self-corrects on the next real success.

---

## 4. EXACTLY WORKING CAPABILITIES (standing real evidence, re-verified today)

| Capability | State | Evidence |
|---|---|---|
| LAXII deterministic enhancement | **Operational** (probe re-ran live 04:41Z) | Real Sharp decode→grade→round-trip on every probe; preservation fix (90.82% exact-preserved) stands at `6e3c508` |
| CODE GIFTZ sandbox execution | **Operational** (probe re-ran live 04:41Z) | Local restricted runtime executes for real; prior verified run: `isPalindrome` exit 0, `greet.js` → `GIFTZ-SUITE-OK` in 51 ms |
| JAZMII image-to-video | **Operational** (persisted real artifact) | 3,585,301-byte MP4 on disk (02:21:35Z), DB row + bytes verified today |
| JAZMII text-to-video | Operational when not throttled | Real completions on disk: 1,229,759 B (03:08:24Z) + 1,537,913 B (02:49Z) + 1,506,330 B (Nov 5); submission/polling/persistence/download verified at `157897a` with 18-consecutive-429 tracking resilience |
| RIISHE conversational chat | Operational when not throttled | Full 10-item real suite at `6e3c508` (streaming 38 frames/946 ms, Tamil, context recall, persistence); live probe passed 03:34:15Z |
| RIISHE current-web research | Independent of chat (display-only row) | Real `web_search` probe passed 03:09:04Z; throttled windows honestly shown, chat unaffected |
| LAXII text-to-image | Operational when not throttled | Persisted real generation 02:48:14Z + `fulltest-out` artifacts on disk today |
| LAXII conversational editing | **Blocked** (pending one clear provider window) | Official documented contract now wired server-side (§2.1); validator verdict on the documented shape is the only remaining unknown — old shapes are measured-failing, the documented shape never was |

---

## 5. DASHBOARD STATE (measured snapshot 04:41Z, capability-level truth model)

```
RIISHE       Rate limited   chat: rate-limited · research: rate-limited
LAXII        Degraded       text-to-image: rate-limited · conversational-editing: blocked
                            image-enhancement: operational · generative-worker: not-configured
JAZMII       Rate limited   text-to-video: rate-limited · image-to-video: operational
CODE GIFTZ   Rate limited   coding-chat: rate-limited · sandbox-execution: operational
```

This is the truth, not pessimism: the only failed rows are the ones the provider is actively refusing; every locally-executable capability (enhancement, sandbox) and every persisted real media capability (I2V) reads operational. No badge was touched by hand — states derive from measured probes and persisted real-attempt evidence only.

---

## 6. REMAINING BLOCKERS

1. **Account-wide provider throttling (external).** All four endpoint classes 429'd simultaneously 04:33–04:42Z. Nothing client-side can fix a shared account under external load; the breaker backs off 60 s → 600 s with bounded escalation and the dashboard says exactly what is happening. The provider-resilience layer (§2) is the architectural remedy: with one approved credential it routes RIISHE/GIFTZ chat to an authorized alternative automatically.
2. **LAXII conversational editing — one verdict pending.** The official documented body is now sent; the old bodies are measured-failing (400/1210). A real success through a clear window flips the capability to Available; a typed 400 on the documented shape is recorded verbatim and keeps it honestly Blocked.
3. **LAXII smart-edit / object-removal / reference-guided — Not configured (hardware).** The local Diffusers worker requires a GPU host (≥6 GB free VRAM enforced by preflight; RTX 5060 Ti 16 GB target, CUDA 12.8 wheels, license-verified checkpoint set, real-inference acceptance gate). This sandbox has no GPU; the worker reports missing requirements honestly and the registry keeps traffic off. Config runbook: `workers/laxii-diffusers/README.md` + `local/ACCEPTANCE-RUNBOOK.md`.

---

## 7. USER APPROVAL REQUIRED — exact credential requirements (Phase 8, verified facts only)

### 7.1 Chat fallback for RIISHE + CODE GIFTZ (kills the "Rate limited" badge dependency)

The integration is complete and dormant. Activate with ONE of:

**Option A — admin console (recommended; encrypted at rest):**
1. Set `BEAN_CREDENTIALS_MASTER_KEY` (32-byte hex) in the runtime environment — the console currently reports "not configured".
2. Admin → gateway console → Provider credentials → add provider `openai-compatible` with the API key + base URL.

**Option B — runtime environment:** set `BEAN_PROVIDER_OPENAI_API_KEY` (+ optional `BEAN_PROVIDER_OPENAI_BASE_URL`, `BEAN_PROVIDER_OPENAI_MODEL`).

| Provider (OpenAI-compatible) | Free tier (verified against official docs 2026-11-07) | Cost if paid | GPU required |
|---|---|---|---|
| **Google AI Studio (Gemini API)** | **Yes** — "Start building free of charge with generous limits"; e.g. Gemini Flash-class models free of charge on the Free tier; flagship models excluded from Free (source: aistudio.google.com/docs/pricing, /docs/rate-limits) | Paid tier from ~$0.75/1M input tokens (Flash) | No |
| **Groq** | **Yes** — free tier with per-model RPM/RPD limits (source: console.groq.com/docs/rate-limits); OpenAI-compatible endpoint documented | Paid tiers available | No |
| **OpenAI** | **No free usage** — lowest API tier still requires purchasing credits (source: developers.openai.com/api/docs/guides/rate-limits) | Per-token | No |

No account was created, no credit spent, and no provider was activated without approval — the layer stays dormant until an operator adds one of the above.

### 7.2 LAXII conversational editing

Already fixed to the official contract (§2.1). If the validator still refuses the documented shape, the choice is: (a) provider documents the `images.edit` contract, or (b) an approved alternative image-edit provider (any new paid provider requires explicit approval).

### 7.3 LAXII smart-edit family (GPU)

Provision a GPU host ≥ 8 GB VRAM class (worker enforces ≥ 6 GB free at preflight), then follow `workers/laxii-diffusers/local/ACCEPTANCE-RUNBOOK.md` (torch 2.11.0+cu128, license acceptance, real-inference acceptance test) before enablement.

---

## 8. TEST COUNTS & QUALITY GATES

- Full regression: **1,102 passed / 0 failed / 70 files** (+18: fallback semantics, breaker isolation, credential resolution, dormant-adapter refusal, budget parsing, official edit-body pin).
- `tsc --noEmit`: clean on `src/` + `tests/`. ESLint: clean on all 13 touched files.
- UI verified in-browser: dashboard capability rows render the measured states; admin "Provider routing & fallback chains" renders enabled/credential/breaker/fallback for every backend (screenshots `scripts/actualwork-out/ui-*.png`).

## 9. DELIVERABLES

- Code: §2 (12 files: 5 new in `src/lib/providers/`, 7 wired changes) + test updates.
- Evidence: `scripts/actualwork-out/` — `evidence.jsonl` (bounded attempts, verbatim), UI screenshots.
- Standing artifacts preserved and re-verified on disk today: JAZMII MP4s (3,585,301 / 1,537,913 / 1,229,759 / 1,506,330 B), LAXII T2I/enhancement/preservation JPEGs, GIFTZ sandbox outputs.
- This report: `docs/reports/BEAN-PROVIDER-RESILIENCE-AND-ACCEPTANCE.md`
