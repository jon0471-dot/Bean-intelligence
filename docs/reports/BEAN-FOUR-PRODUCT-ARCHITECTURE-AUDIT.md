# BEAN Four-Product Architecture Audit

**Date:** 2026-11-04 · **Branch:** main · **Baseline HEAD:** `c061e2b` · **Audit method:** read-only exploration of the full repository, schema, routes, adapters and tests, plus a live rendered-site inspection.

## 0. What existed before this task

The platform was substantially built across W1–W5 and the 2026-11-04 connectivity audit (commits through `4e8c31d`): a four-product SPA (RIISHE / LAXII / JAZMII / CODE GIFTZ), a server-only backend registry, a unified AI gateway, per-product health probes with a 5-state contract, an in-process job queue, a code sandbox, and 62 unit test files. This audit maps that reality and names the gaps the four-product upgrade must close.

## 1. Runtime & process map

- **App:** Next.js 16 (App Router, standalone build), SQLite via Prisma (`db/custom.db`), Bun test runner, dev server on :3000.
- **Request path:** UI → `/api/<product>/*` → `requireUser()` (session cookie) → zod `parseBody` → `preflight()` (`src/lib/router/router.ts`: availability → rate limit → daily quota → concurrency → capability) → product route → gateway/backend adapter → Prisma persistence → typed error envelope (`src/lib/api/errors.ts`, 18 typed codes).
- **Frontend never touches model providers.** All generation flows through server-side adapters (`src/lib/adapters/*`, `src/lib/ai-gateway/*`).

## 2. Registry, status contract, gateway

- `src/lib/registry/products.ts` — public, client-safe catalog of the 4 flagship products + task types + size lists. No provider/model identity.
- `src/lib/registry/backends.ts` — **server-only truth**: 6 backend descriptors (RIISHE chat `bean-llm-hosted-primary` ✅; LAXII image `bean-image-hosted-primary` ✅; LAXII sharp-enhance `bean-image-local-sharp` ✅; LAXII diffusers edit `bean-image-selfhosted-diffusers` ❌ disabled; JAZMII `bean-video-selfhosted-candidate` ❌ disabled; GIFTZ `bean-code-llm-hosted-primary` ✅). Single-shot routing (`fallbacks: []`, `maxAttempts: 1`) by design.
- `src/lib/registry/status.ts` — server states `operational | degraded | unavailable | not-configured` (+ client-transient `checking` = the 5-state contract). Degraded = backend reachable but a measured capability failing (research / sandbox / generation evidence from `last-attempts.ts`).
- `src/lib/ai-gateway/gateway.ts` — plan → normalize → execute (hosted SDK or external OpenAI-compatible), SSE streaming, typed error mapping (429 / auth / billing / timeout / truncation / network), metering (`UsageRecord` + `GatewayRequestLog`, no prompts logged, `costMicros` null because the provider reports no cost), rate limits 30/min + 500/day per principal.
- **Credentials:** `ProviderCredential` rows, AES-256-GCM envelope encryption, master key `BEAN_CREDENTIALS_MASTER_KEY` (env-only, fail-closed). Hosted path uses the platform SDK (server-side only). Bearer secrets redacted from error strings. Admin-only gateway UI shows `maskedHint` only.

## 3. Product surfaces (real vs stubbed)

| Product | Real today | Honest gaps |
|---|---|---|
| **RIISHE** | Full chat: SSE streaming, multi-turn context (24-msg window + digest), 6 real tools (web_search, read_url, calculate, run_code, read_document, analyze_image), conversation search/rename/delete + date-grouped sidebar, document pipeline, user-approved memory, typed upstream failure frames | Single gateway, no fallback/retry; model identity undisclosed by provider design |
| **LAXII** | Hosted text-to-image (7 sizes, async job queue, artifacts on disk, owner-checked delivery); deterministic Sharp enhancement; mask editor with exact-preservation compositing (alpha=0 → original bytes verbatim), preservation report; per-mode capability truth endpoint | Hosted API has no img2img; generative editing requires the diffusers worker (GPU preflight + recorded inference test before registry flip) — **BLOCKED on hardware** |
| **JAZMII** | Truthful not-configured surface: submit → typed `NO_BACKEND` rejection recorded as `unsupported` `GenerationJob`; availability endpoint with reason | No video backend deployed (needs GPU worker ≥24GB class + licensed checkpoint) — **BLOCKED on infrastructure** |
| **CODE GIFTZ** | Chat-first coding with streaming, file extraction (`path=` fences), real LCS diffs, workspace editor, sandbox run (15s SIGKILL, minimal env), isolated preview iframe, W6 verification hooks; conversation sidebar | Sidebar upgrades delivered this task (§5). Sandbox is process-level isolation, JS/TS-only — documented |

## 4. Health, probes, jobs, W6, security (verified mechanics)

- **Probes:** 7 independent probes in `/api/health` (LLM chat + code chat on **separate cache keys** — this fixed the earlier ~307ms shared-path artifact), `safe-probe` isolation (a throwing probe cannot 500 the endpoint), 20s cache TTL with in-flight dedup, `redirect:'manual'` image probe (3xx → `redirected`, never counted healthy), 429 circuit breaker (60s per endpoint class, probes **deferred to zero network** while open, `latencyMs:null`), JAZMII rendered as `not-configured` without a probe.
- **Jobs:** `enqueueJob` in-process fire-and-forget over persisted `GenerationJob` rows; cancel = queued-only with ownership check; no durable worker loop (single-node by design, documented).
- **W6:** `src/lib/verification/` — generate → independent verifier (via unified gateway) → ≤1 corrective revision → re-verify; statuses `verified|corrected|corrected-unverified|unverified|skipped`; strict-JSON verifier contract (malformed never passes); **disabled by default**, hard caps (attempts ≤3, timeout ≤120s, regenerations ≤1). Eval suites in `evals/code-giftz/` + `scripts/giftz-w6-eval.ts`.
- **Security:** scrypt passwords; opaque session cookies (httpOnly, SameSite=None + Origin middleware CSRF compensation); `bgk_` API keys stored only as SHA-256 with per-key rate limits and scopes; per-resource ownership checks (404-on-foreign-ID pattern); URL SSRF guard on credential write AND read; audit log for admin actions; logger never logs prompts/secrets.

## 5. Gaps closed by this task

1. **CODE GIFTZ sidebar was desktop-only** (220px rail, no search, no rename, instant delete, no mobile access) → replaced with the ChatGPT-style sidebar (commit `11a68bc`): `?q=` server search reusing RIISHE's shared filter, PATCH rename with the shared sanitizer, delete confirmation dialog, date-grouped history (Today/Yesterday/7d/30d/Older), message+file counts, desktop collapse rail, mobile Sheet drawer with closeAfterAction. 24 new tests (suite → 1018/0/64 files).
2. **Dashboard card uniformity at 2-col widths 640–1200px** (commit `66eac2e`): `sm:auto-rows-fr` equalizes both grid rows; ≥1280px unchanged at the 207px floor; mobile stack per-content. Verified on the rendered site at 660/768/1024/1152/1280/1440/1920 + 390.
3. **Acceptance evidence harness** (commit `942dbbf`): `scripts/four-product-acceptance.ts` produces the per-product real-API evidence in §11 of the acceptance report.

## 6. Remaining structural gaps (documented, not silently deferred)

- No external image/video provider adapters (external family is OpenAI-compatible **chat** only); adding them without credentials to verify against would violate the "never fabricate operational status" rule — recorded as Not configured instead.
- No idempotency keys on `/api/v1/chat/completions` or job submission; duplicate submissions re-spend provider quota (rate limits + breaker bound the damage; flagged for a future task).
- Queue is single-node in-process; multi-node needs a durable queue + shared rate-limit/health stores.
- `/api/health` is unauthenticated (failure categories/latencies only — no secrets); a detailed admin-gated variant is advisable.
- GANGZII (5th product) has live audio APIs but an orphaned UI and unregistered music backends — out of scope for the four-product task, listed here for completeness.

## 7. Test baseline reconciliation

The three recorded counts are snapshots of **different commits**, same runner (`bun test`, flat `tests/unit/*.test.ts`): 884/56 (gateway recovery commit) → 951/60 (W1–W5 closure) → 994/62 (connectivity audit, +43) → **1018/64 now** (+24 giftz-sidebar). Re-verified this session: `1018 pass / 0 fail / 29,050 expects / 64 files` in 17.0s. tsc baseline: 11 pre-existing errors, all in `scripts/`; eslint: 0.
