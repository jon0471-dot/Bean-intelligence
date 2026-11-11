# BEAN INTELLIGENCE — FOUR-PRODUCT OPERATIONAL TRANSFORMATION

**Date:** 2026-11-11 · **Branch HEAD at completion:** `98676a9` (chain: `df068d0` → `a5d8b16` → `98676a9`)
**Scope:** RIISHE (conversational intelligence) · LAXII (image creation & preservation) · JAZMII (video generation) · CODE GIFTZ (coding intelligence)
**Execution rule honored throughout:** every advertised capability produces a real, validated output; no mock output was ever presented as live evidence; no failed probe was ever turned green.

---

## 1. Architecture audit (as found at `df068d0`)

### What already existed (verified working, preserved untouched)

| Layer | Implementation | Evidence |
| --- | --- | --- |
| Backend-only model registry | `src/lib/registry/backends.ts` (12 backends, enabled/disabled with truthful `unavailableReason`), `models.ts`, `products.ts`, `capabilities.ts` | health payload renders registry-gated rows (`generative-worker: not-configured`) |
| Provider adapters | `src/lib/adapters/hosted-{llm,image,video,audio}.ts` (authorized z-ai gateway via `z-ai-web-dev-sdk`), `openai-compatible.ts`, `llamacpp.ts` | real HTTP traffic measured in prior acceptance runs |
| Async task engine | `src/lib/ai-engine/` — durable CAS claim + lease + heartbeat + `recoverStaleJobs` sweep (60s), pools per product, jittered bounded retries | JAZMII job `cmwbh554h` completed across 2 server restarts, 5 submission attempts, 0 duplicates |
| Persistence | Prisma/SQLite (`db/custom.db`): `User/Session/Conversation/Message/Document/GenerationJob/JobEvent/UsageRecord/AuditLog/ImageAsset/CodeProject/CodeFile/ProviderCredential/ApiKey/SystemSetting` | quotas count `UsageRecord` rows with `success:true` only |
| Auth & security | opaque 256-bit sessions (7d TTL), scrypt passwords, CSRF origin allowlist middleware, AES-256-GCM credential envelope (`BEAN_CREDENTIALS_MASTER_KEY`), SSRF url-guard, upload magic-byte sniffing + zip-bomb/traversal refusal | `src/lib/auth/*`, `src/lib/security/*`, `src/lib/files/*` |
| Rate limiting & quotas | 20/min→now per-product burst (`router.ts`), durable daily quotas (riishe 300 / laxii 40 / jazmii 6 / giftz 150), per-user + total concurrency, shared-account quota + user reserve | `src/lib/auth/ratelimit.ts`, `src/lib/router/router.ts`, `src/lib/providers/account-quota.ts` |
| Health system | quota-free probes, 20s cache, 250ms probe stagger, per-class 429 breakers (60s→600s escalation), capability-level rows with evidence chains | `src/app/api/health/route.ts`, `src/lib/registry/capabilities.ts` |
| Storage | `storage/<product>/<userId>/` outside `/public`, owner-checked byte-serving with Range support | `laxii/images/[id]`, `jazmii/jobs/[id]/media` |

### Root causes found for every degraded capability

| Capability | Measured root cause (file:line evidence) | Fix (this run) |
| --- | --- | --- |
| **JAZMII text-to-video "Authentication Failed" (HTTP 401)** | The gateway answered **401 `{"error":"missing X-Token header"}`** for *every* endpoint class (chat, functions, video — 7 occurrences in `dev.log`, 01:14Z). The platform credential file was rewritten at 01:26Z (new 243-char token) but never re-verified. The health probe (`src/lib/adapters/hosted-video.ts:219-224` pre-fix) sent **Bearer only**, so a green reachability probe masked the broken submission auth surface. | Probe + config check now cover the real auth surface (token required, probe sends `X-Token`); live T2V + I2V submissions verified with real provider task ids (see §10). |
| **JAZMII image-to-video "available" while submissions 401'd** | `unverifiedCapability` (`src/lib/registry/capabilities.ts:436-501` pre-fix) read only probe + last attempt — a 4-day-old persisted success outweighed a live credential outage. | Evidence parity: fresh upstream failure / class breaker / shared throttle now outrank old successes; persisted failure evidence added (below). |
| **Restart whitened fresh failures** | Persisted evidence was **success-only** (`src/lib/adapters/persisted-attempts.ts` pre-fix): after a restart, T2V's 401 evaporated and the Nov-10 success read as current. | `persistedUpstreamFailure()` + `persistedLastAttempt()` read failed `GenerationJob` rows (`errorClass` → category); newest record wins. |
| **Degenerate video could complete** | The only completion gate was container magic bytes (`hosted-video.ts:177-198`); ffprobe ran only in offline acceptance scripts. A 1-frame MP4 would have been advertised. | New `src/lib/media/ffprobe.ts` — **ffprobe is now the production completion gate** (codec, ≥0.5s duration, ≥8 frames); failures are honest `ARTIFACT_INVALID` terminal failures; measured stream facts stored in `resultJson.stream`. |
| **RIISHE "Deep Research"/"Writing" modes unbacked** | No mode layer existed; the semantic freshness router (`src/lib/research/semantic-router.ts`) was **dead code** — built, tested, never invoked (audit flag). | Response modes implemented (§3 below); semantic router actually wired into the Auto decision with a lazy, mockable load. |
| **"Last checked" could postdate the real fetch** | `retrievedAt` was stamped at respond time; the pack's cache-aware `fetchedAt` never reached metadata. | `retrievedAt` now comes from `pack.fetchedAt` (original fetch time, cache-aware). |
| **page_reader-only outage invisible** | `readPage` never recorded health evidence (only `webSearch` did). | Both success and failure now record real-attempt evidence. |
| **Dormant conflation paths** | `status.ts:184-193` + `dashboard.tsx:273-281` would degrade a product badge from display-only secondary slots on legacy payloads. | Removed; badge follows capability rows / core dependency only. |
| **LAXII background removal not implemented** | Provider edit endpoint returns **opaque JPEG only** (measured live: transparent-fraction 0). | Real two-stage pipeline (§4 below). |
| **LAXII enhance route missing duplicate guard** | `enhance/route.ts` had no `dedupeKeyFor`/`hasActiveDuplicate` — double-click queued duplicates. | Guard added (same 409 contract as generate/edit). |
| **LAXII running-job cancel ignored** | `laxii/jobs.ts` checkpoints read only `status failed/rejected`; the engine's `cancelRequested` signal was never read. | `stopIfCancelled()` settles running enhancement/edit jobs as `cancelled` between stages. |
| **CODE GIFTZ sandbox network-unrestricted** | Same-uid child process, full network egress, no rlimits (`runner.ts` pre-fix; honestly documented). | Measured hardening (§6 below). |
| **Dead rate-limit config** | `PRODUCT_RATE_LIMITS` exported, never imported — every product silently shared 20/min. | Wired into `preflight` (laxii/jazmii 6, giftz 15, riishe 20 per minute). |
| **Sandbox workspaces accumulated (602 stale dirs)** | `cleanupOldRuns` ran only opportunistically inside run routes. | Boot + 6-hourly scheduled sweep in `src/instrumentation.ts`. |

---

## 2. Shared AI infrastructure (Phase 2) — state after this run

Every requirement is implemented and measured: backend-only provider registry; capability registry; provider-specific adapters; credential validation (probe-time config checks now cover the **real** auth surface); request routing (`router.preflight`); bounded exponential backoff with jitter; rate-limit handling (`Retry-After` clamped, breaker-aligned parking); per-endpoint-class circuit breakers; async task processing (durable queue); persistent generation history; structured logging (`logger.*` events); usage tracking (per-user, per-product, success-only billing); real health probes (quota-free, staggered, cached); artifact storage (owner-gated); cancellation + job recovery (leases + `recoverStaleJobs` + poller re-attach).

Provider declarations carry: name, model identifier (disclosed as provider-managed where the tenant is not told the checkpoint — never invented), supported capabilities, input/output formats, max duration/size, auth status, availability, rate limits, last successful request, failure reason — all rendered in `/api/health` and `/api/v1/providers`.

PostgreSQL/Redis were **not** introduced: SQLite + the durable `GenerationJob` engine already provide the equivalent, and the brief forbids unnecessary infrastructure.

---

## 3. RIISHE — response modes and honest retrieval

- **Five response modes, backend-selected** (no provider/mode exposure to users): `normal-chat`, `web-search`, `deep-research`, `document-analysis`, `writing` — detected by deterministic classifiers (`src/lib/riishe/classify.ts`: `isDeepResearchQuery`, `isWritingTask`) plus attachment presence, recorded in `metadata.router.mode`.
- **Deep research** runs the pipeline **and** keeps `web_search`/`read_url` in the bounded tool loop (genuinely multi-source), with a report protocol (overview → key findings → conflicting/uncertain claims → limitations, every claim cited, empty sections omitted, padding forbidden).
- **Writing mode** adds a structured content-creation protocol (audience/purpose/format defaults, no fabricated statistics or citations, `[verify: X]` flags for checkable claims).
- **Semantic freshness router wired**: when the deterministic policy is not confident, `resolveAutoSearchDecision` adjudicates (can only ADD retrieval; failure degrades to deterministic; rides the guarded chat class so an open 429 breaker skips it with zero traffic).
- Citations: numbered evidence block → audit (`auditCitations`) → fabricated-URL stripping → clickable publisher links with publication dates and retrieval timestamps; insufficient evidence is stated, never padded.
- Live evidence (§10): Node.js version question returned 2 sources, `retrievedAt` present, and the cited URL `https://nodejs.org/en/blog/release/v26.13.0` opened with HTTP 200.

## 4. LAXII — real image intelligence

- **Text-to-image / conversational editing** — unchanged real hosted pipelines (preserved).
- **Background removal (NEW, real, validated):** the hosted endpoint has **no alpha output** (measured), so the honest pipeline is two stages: (1) provider replaces the background with uniform chroma-key green (`CHROMA_BG_PROMPT`, `src/lib/laxii/bg-removal.ts`); (2) deterministic cutout — the key is **measured from the most uniform edge band** (per-edge median + 95th-percentile spread; the whole-ring median was measured to be polluted by subjects that reach the bottom edge), alpha via smoothstep feather between adaptive thresholds, green-spill suppression, then **validation gates** (transparent ≥2%, opaque ≥2%, spread ≤120) — anything else is an honest failed job, never a stored fake cutout. Output: true-alpha PNG with measured key/thresholds/coverage in the job record. Own evidence chain (`image-bg-removal` attempt keys + persisted rows) — never advertised from conversational-editing's record.
- **Preservation** — bit-exact compositing, mask dilation/feather, face-protection gate, measured `PreservationReport` (pre-existing, preserved; verified by `tests/unit/laxii-preservation.test.ts`).
- **Originals unchanged:** sha256 of the source asset compared before/after all edits in the live run — bit-identical.
- Local Diffusers worker remains **honestly `not-configured`** (registry `enabled:false`, truthful reason; no GPU in this environment). Masked smart-edit/object-removal refuse with `PROVIDER_UNAVAILABLE` before any job row is created — the user's image is never touched.

## 5. JAZMII — real video generation

- The 401 root cause and fix are in §1. **Both T2V and I2V completed live** with real provider task ids (`20261111095300678784af6ece41f7`, `202611111000141df2da6c22534406`, `20261111102517219537de29f84a66`).
- The async workflow is end-to-end: validate → backend select → submit → **persist provider task id** → poll (throttle-aware backoff) → server-side download (bounded throttle retries) → magic bytes → **ffprobe gate** → store → owner-only media serving. Measured facts from the live I2V run: `stream: {codec: h264, 1080×1080, 5.13s, 159 frames, validatedBy: ffprobe}`.
- Throttle parking with restart-surviving budgets (5 real attempts / 30 min cumulative) — the live I2V job survived 2 server restarts mid-parking and completed without duplicates.
- Cancellation is honest stop-tracking (provider exposes no cancel API), labeled verbatim.

## 6. CODE GIFTZ — coding intelligence

- Real coding chat on `bean-code-llm-hosted-primary` (streaming, persisted, resumable via JobEvent replay).
- **Sandbox hardening (measured on this host):** runs are wrapped `prlimit --as=4G --cpu=10 --nproc=128 --nofile=256 --fsize=16M -- unshare -Urn <runtime>` — a **fresh user+network namespace (no interfaces: connect() fails)** plus kernel rlimits, on top of the existing minimal env, ephemeral workspace, SIGKILL wall clock. Every run result and the health probe report **which layers are active** (`isolation: {networkNamespace, rlimits, processSeparation}`) — never a blanket isolation claim. Residual: same-uid filesystem readability (no root for mount namespaces) — recorded in `docs/security/SECURITY.md`, container/gVisor recommended for multi-tenant production.
- Live evidence: model-written project executed **inside the isolation chain** (exit 0, `SUM_OF_SQUARES=55`); a deliberately failing test reported verbatim (exit 1, stderr `ASSERTION FAILED: expected 55 got 56`); project persisted and retrievable.

## 7. Real-time data (Phase 7)

The shared live-information infrastructure is RIISHE's research lane: capability-specific sources (web via the authorized gateway + the independent key-free lane: Wikipedia/official sources), recorded source URLs + publication dates + retrieval timestamps (`fetchedAt` cache-aware, now propagated to metadata), freshness windows with today-anchored queries, cache with TTLs and invalidation, stale-data detection (`staleness` in packs), multi-source comparison in deep research. For weather/financial structured feeds: **no authorized provider credentials exist**, so those source types are honestly not wired — no fabricated provider was introduced (the brief forbids both).

## 8. Honest operational dashboard (Phase 8)

- Product badges: **Operational / Degraded / Rate limited / Not configured / Unavailable**; capability rows carry: Operational, Degraded, Rate limited, Blocked, Unavailable, **Not configured** — plus the new **"Authentication failed"** failure label (was "credentials rejected").
- New per-card displays: **queue depth** (real DB count of queued/retry_wait jobs per product), **worker availability** (embedded engine pools actually alive in the process), alongside existing backend latency, provider health, last generation attempt and evidence tooltips (state, source, checked-at).
- Verified live: `laxii` renders `rate-limited` while its T2I class carries a fresh 429 — the transient provider state, not a product defect — with `background-removal: operational` from its real completed run and `generative-worker: not-configured` honestly gray.

## 9. Security and cost control (Phase 9)

Already in place and re-verified: AES-256-GCM credential envelope with masked hints only; backend-only env secrets; session auth + CSRF middleware; scrypt passwords; per-user usage limits + durable daily quotas; per-product burst limits (now actually wired); login rate limiting; upload magic-byte + zip-safety validation; owner-gated artifact serving; audit logs (`recordAudit`); shared-account quota with user reserve.
**New:** admin-configurable provider budgets — `SystemSetting` rows keyed `provider_budget_<product>` override the env budgets (`BEAN_DAILY_REQUEST_BUDGET_*`) at runtime with a 30s cache; misconfigured values fall back safely; exceeded budgets throw the typed `COST_LIMIT` error and write an audit row. Live leak scan: `/api/health` public payload contains no key material; `/api/v1/providers` is auth-gated (401 unauthenticated).

## 10. Acceptance test results (Phase 10 — all live, real provider output)

**RIISHE** (`scripts/bean-optrans-out/acceptance.json`)
- Normal conversation: real model response, 340 chars, 2.0s, `mode=normal-chat` → **PASS**
- Current events: retrieval ran, 2 sources, `mode=web-search`, `retrievedAt` present → **PASS**
- Citation opens the correct source: `https://nodejs.org/en/blog/release/v26.13.0` → HTTP 200 → **PASS**
- Honest degradation on unavailable search: covered by `tests/unit/research-failure.test.ts` + `upstream-429.test.ts` (12 hermetic scenarios; live config-breaking intentionally not performed against shared credentials) → **PASS (suite)**

**LAXII**
- T2I: real JPEG 1024×1024, 91,503 B, sha256 `3882f1b5…` → **PASS**
- Background removal: real transparent PNG 1312×1312, **83.62% transparent / 16.23% opaque**, sha256 `4fdc636e…` (first attempt honestly FAILED validation and was recorded as a failure — the fix per-edge key then passed; both facts are in the evidence) → **PASS**
- Conversational edit: real modified artifact (PNG 1312×1312, 1.9 MB, `differsFromOriginal=true`) → **PASS**
- Originals unchanged: sha256 before == after → **PASS**

**JAZMII** (`scripts/bean-optrans-out/jazmii-acceptance.json` + `jazmii-i2v-followup.json`)
- T2V: real MP4 h264 1890×1080, 5.19s, **161 frames**, 3.37 MB, sha256 `781f40ff…`, provider task id persisted → **PASS**
- I2V: real MP4 h264 1080×1080, 5.13s, **159 frames**, 4.65 MB, ffprobe-measured, completed across server restarts → **PASS**
- Job status updates + ffprobe validation + invalid-credentials reporting: honest 401 evidence chain retained in capability rows until a fresh success → **PASS**

**CODE GIFTZ**
- Real code generation (545 chars) → **PASS**; isolated execution inside measured `{networkNamespace:true, rlimits:true}` → **PASS**; real failure verbatim (exit 1 + stderr) → **PASS**; project persistence → **PASS**

**Platform**
- All four product routes work; auth works; dashboard reflects actual dependencies (capability rows present for all products); **job recovery works** (I2V completed across restarts; `recoverStaleJobs` sweeps every 60s); no fake success responses (every completion carries a validated artifact); no secrets in frontend payloads → **PASS**
- Quota correctness: usage rows are success/failure-disaggregated; daily quotas count `success:true` only; exactly one row per attempt (verified in DB across the acceptance users)

**Full test suite:** `bun run test` → **1296 pass / 0 fail** (86 files, 32,035 expect calls). `bunx tsc --noEmit` → **0 errors in `src/` + `tests/`** (pre-existing errors remain only in one-off `scripts/`). `bun run lint` → clean. `bun run build` → production build succeeds.

## 11. Remaining blockers (honest)

1. **Sandbox filesystem confinement** — network + rlimits are enforced, but the child still runs as the same OS uid; root-free mount namespaces are not available here. Container/gVisor required before multi-tenant production. (`/etc/.z-ai-config` is world-readable by the platform; keep secrets off shared hosts.)
2. **Local Diffusers worker** — requires a GPU host + model weights (`workers/laxii-diffusers/` runbook ready); masked generative editing stays honestly `not-configured` until a real preflight + inference test passes on that host.
3. **Provider quota ceiling** — one shared account, ~300 requests/day, authoritative 2-QPS limit; account-wide 429 windows are handled (parking, breakers, staggering) but not removable from BEAN's side.
4. **Weather/financial structured feeds** — no authorized provider credentials; not wired rather than faked.
5. **Pre-existing `scripts/` type errors** — one-off harness scripts carry TS errors (the app tree is clean); worth a cleanup pass, out of scope here.

## 12. Deployment readiness assessment

**Ready now (current single-node profile):** all four products serve real, validated outputs; the background engine recovers jobs across restarts; health is quota-free and self-probe-safe; secrets are encrypted at rest and never leave the backend; quotas/budgets/audit are enforced. **Required env vars:** `DATABASE_URL`, `BEAN_CREDENTIALS_MASTER_KEY` (32-byte key for the credential envelope), optional `BEAN_DAILY_REQUEST_BUDGET_<PRODUCT>` (+ runtime `provider_budget_*` SystemSetting rows), optional `BEAN_SANDBOX_*` (isolation/retention tuning), `LAXII_PROVIDER` (leave `auto`), gateway credentials are platform-managed (`/etc/.z-ai-config`) and must contain a valid `token` (the video endpoints require `X-Token`). **Database migrations:** none required — this run added zero schema changes (all evidence uses existing columns, incl. `errorClass`/`cancelRequested`/`dedupeKey`). **Workers:** zero-config embedded engine (`BEAN_ENGINE_EMBEDDED=0` + `scripts/ai-workers/worker.ts` for a split deployment). **Verdict:** production-ready for the current single-tenant/trusted-audience profile; the sandbox containerization in §11.1 is the one gating item before multi-tenant exposure.

---

### Evidence index
- `docs/evidence/bean-optrans-jazmii.txt`, `docs/evidence/bean-optrans-acceptance.txt` — verbatim acceptance runs
- `scripts/bean-optrans-out/` — `acceptance.json`, `jazmii-acceptance.json`, `bg-removal-acceptance.json`, real artifacts (T2V/I2V MP4, T2I JPEG, transparent PNG) with sha256
- Reports referenced: `docs/reports/BEAN-POST-QUOTA-ACCEPTANCE.md` (F1 probe-stagger finding), `docs/reports/RIISHE-CHAT-RECOVERY.md` (quota-free probes), `docs/reports/LAXII-LIVE-ACCEPTANCE.md` (edit contract history)
