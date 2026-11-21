# BEAN ECOSYSTEM — Client-First Hybrid Compute Engine: Phase 0 Audit

Milestone: BEAN Client-First Hybrid Compute Engine · Repository: `jon0471-dot/Bean-intelligence` · Branch: `main`
Baseline before work: `49b04055f2c41fff0b5160afcd7d4e3059f51afd`
Verification: local HEAD and `origin/main` both measured `49b0405…` via `git ls-remote` before any change; working tree clean; full gates re-measured on this exact tree (1885 pass / 0 fail / 133 files; tsc 0 errors in `src/`+`tests/` — 138 pre-existing in `scripts/` + `validation/` fixtures; eslint clean in `src/`+`tests/`).

This audit inspects the ACTUAL repository before any implementation. It follows the Phase 0
requirement: audit each product independently, do not assume shared architecture, do not
start implementation until the audit is complete. Every claim below was verified by reading
the code (four parallel read-only audits, cross-checked).

---

## 1. Repository identity and state

| Item | Result |
|---|---|
| Repository | `https://github.com/jon0471-dot/Bean-intelligence.git`, branch `main` |
| Remote SHA at audit time | `49b04055f2c41fff0b5160afcd7d4e3059f51afd` (matches required baseline) |
| Framework / runtime | Next.js `16.1.3` (App Router) + React `19.2.3` + Bun runtime + Prisma 6.11 / SQLite (`db/custom.db`) |
| TypeScript | `strict: true`, `noImplicitAny: false`, target ES2020, moduleResolution `bundler` |
| Auth | Custom opaque-session cookie (`bean_session`, httpOnly, SameSite=None; Secure, 7-day TTL, DB-backed) + `bgk_` API keys with scopes; CSRF handled by Origin middleware on all `/api/*` |
| Products in THIS repo | RIISHE, LAXII, JAZMII, CODE GIFTZ (all fully wired), GANGZII (audio — API surface present, runtime unwired) |
| BEAN FX | **ABSENT** — no code, config, docs, nav, or UI anywhere in the repo (searched: `bean fx`, `beanfx`, `premiere`, `caption`, `waveform`, `EDL`, ffmpeg-adjacent docs; all zero or unrelated hits) |
| BEAN Folio | **ABSENT** — no Folio-branded product surface (every `folio` hit is the substring inside "portfolio": CODE GIFTZ website profiles and M21/M24 fixture names) |
| Existing browser-side compute | **None.** Zero usage of `navigator.gpu`, Web Workers, WASM, OffscreenCanvas, AudioContext in `src/`. WebGL2 exists only as decorative fragment-shader backgrounds in `src/components/giftz-kit/*` (CODE GIFTZ's shipped component library — display, not compute). Functional canvas use: LAXII mask painter (control-field painting), MediaRecorder mic capture in the orphaned GANGZII UI |

Product nav (authoritative, `src/components/bean/shell.tsx:26-46`): Dashboard · RIISHE · LAXII · JAZMII · CODE GIFTZ · Developer portal · Usage & quotas · Settings (+ Admin). Public product registry `BeanProductId = 'riishe' | 'laxii' | 'jazmii' | 'code-giftz' | 'gangzii'` (`src/lib/registry/products.ts:12`).

**Consequence for this milestone:** the shared compute engine is built INSIDE this repository
(the only product repository accessible), where the existing architecture already co-locates
the four flagship products behind one auth/router/queue/health spine. No separate package,
no new repository, no duplicate infrastructure. BEAN FX and BEAN Folio adapters cannot be
built against absent code — the shared engine's adapter seam is documented so they can attach
when those products exist. This is stated as a scope limitation, not silently skipped.

---

## 2. Per-product audit

### 2.1 RIISHE — conversational research intelligence (fully wired)

- Pipeline: chat route (`src/app/api/riishe/chat/route.ts`) → `requireUser()` → `preflight()` (rate limit 20/min, quota 300/day, spend guards, concurrency slots) → orchestrator `src/lib/riishe/orchestrator.ts` (Understand → Retrieve → Solve → Verify → Respond) → SSE stream (`src/lib/riishe/sse.ts`, keepalive heartbeats, reset protocol).
- Compute: all inference is LLM calls through the unified gateway (`src/lib/adapters/hosted-llm.ts`, z-ai SDK — server-only credentials at `/etc/.z-ai-config`). Retrieval lane: Agent Reach (spawned binary, argv-only, minimal child env) + Obscura (Rust headless browser CLI) with SSRF deny-list and injection scanning (`src/lib/research/reach/*`, `src/lib/research/browser/obscura.ts`).
- Classification is pure regex (`src/lib/riishe/classify.ts`) — microseconds of CPU, no ML. **No embeddings/vector storage anywhere** (verified by repo-wide grep; memory matching is normalized exact-string comparison, `src/lib/riishe/memory.ts:101`).
- Privilege surface that must never reach a browser: gateway credentials, Agent Reach/Obscura binaries and their login state, per-user rate-limit counters, audit rows.

**Client-side suitability:** negligible benefit. The only portable steps (regex classification, citation dedupe, arithmetic verification) are already deterministic and effectively free server-side; a browser port would move microns of work while adding a second implementation that could drift from the trusted one. Suitable client workloads (embeddings, small-model inference) would require multi-hundred-MB downloads for no measured server-cost reduction. **Verdict: deferred — no adapter in this milestone; documented rationale (Section 5).**

### 2.2 LAXII — image creation & preservation studio (fully wired)

- Capabilities and paths (`src/lib/laxii/*`, `src/app/api/laxii/*`, UI `src/components/bean/laxii.tsx`):
  - Text-to-image: hosted provider (`src/lib/adapters/hosted-image.ts` → z-ai gateway; backend `bean-image-hosted-primary`, model checkpoint not disclosed to tenant). Custom dimensions planned onto native sizes and finished with Sharp Lanczos (`src/lib/laxii/dimensions.ts`).
  - Conversational editing: hosted edit backend; inputs pre-shrunk to ≤1024px JPEG q90 server-side (`src/lib/laxii/jobs.ts:603-609`).
  - Background removal: two-stage — hosted chroma-green edit, then **deterministic chroma cutout** (border-ring median key measurement, smoothstep alpha feather, green despill — pure raw-buffer math, `src/lib/laxii/bg-removal.ts:71-169`) + coverage validation gate. No ML segmentation model exists in the repo (no ONNX/U²-Net/MODNet).
  - Enhancement: measured-analysis planner + **Sharp** ops (denoise, exposure/WB, saturation, sharpen, Lanczos upscale) with mask-controlled compositing where unmasked pixels stay bit-exact (`src/lib/laxii/enhance.ts`, `src/lib/laxii/preservation.ts`). Backend `bean-image-local-sharp` — "no ML model involved", input cap 4096².
  - Masked inpainting / object removal / reference-guided / identity: local Python Diffusers worker, **registry-disabled** (`enabled:false` — no GPU host; planned models 4–24 GB VRAM each, `src/lib/laxii/models.ts`).
- Jobs: `GenerationJob` durable queue (CAS claims, lease/heartbeat, dedupe, cancel, `src/lib/ai-engine/queue.ts`); storage `storage/laxii/assets/<userId>/…` with ownership-checked delivery; limits 25 MB uploads, 6/min burst, 40/day quota; per-capability honest attempt evidence (`src/lib/adapters/last-attempts.ts`, `persisted-attempts.ts`).
- Already client-side: mask painter (canvas 2D → PNG upload), previews, before/after/diff toggle.

**Client-side suitability — the flagship candidate:**
- **Strong:** exact-dimension resize/crop/pad; image compression before upload; the deterministic chroma-cutout stage (pure per-pixel math, portable to Canvas/WASM); unsharp/denoise-style enhancement math (Canvas/WASM ports of the Sharp pipeline with the same preservation-report honesty).
- **Feasible-but-new-work:** true ML segmentation (ONNX Runtime Web + u2net/modnet-class weights ~40–170 MB download; dependency ABSENT today). Must go through the model-registry download policy (size shown, explicit approval, integrity check) and must report `CLIENT_MODEL_NOT_INSTALLED` honestly until installed.
- **Never:** text-to-image, conversational generative editing, masked inpainting (diffusion-class; the repo's own *server* worker needs 4–24 GB VRAM).

### 2.3 JAZMII — video generation engine (fully wired)

- Pipeline: chat/generate routes → zod-bounded input (prompt 3–2000, size 360–1920, durationSec 3–12, fps 12–60) → reference-image validation (`src/lib/jazmii/reference-image.ts` — sharp decode, 256–4096 px/side, ≤15 MB; **validates, never substitutes** the client's URL) → durable job → `processVideoJob` (`src/lib/jobs/video-worker.ts`) → hosted video provider (`src/lib/adapters/hosted-video.ts`, server-only SDK + `X-Token`) → polling (5 s, 15-min deadline) → server-side download (≤100 MB, magic bytes) → **ffprobe completion gate** (real video stream, ≥0.5 s, ≥8 frames) → owner-only Range-served media.
- Intel layer: vision scene-state analysis + prompt conditioning, computed once per job, persisted.
- No thumbnails/posters exist anywhere today (verified). Zero client-side preprocessing.

**Client-side suitability:**
- **Strong:** reference-image client-side pre-check (decode + dimension/byte bounds via `createImageBitmap`/OffscreenCanvas before upload — saves round-trips; server revalidation remains authoritative by design); client-side thumbnail/poster generation from the completed MP4 (canvas capture from `<video>`).
- **Never:** video generation, provider polling, ffprobe-grade server gating, vision/intel calls (credentials + metered gateway classes are server responsibilities).

### 2.4 CODE GIFTZ — coding intelligence (fully wired)

- Pipeline: chat route + turn core (`src/lib/giftz/turn.ts`) → hosted LLM adapter → `parseFiles` → `applyFiles` (path-safe upsert, `src/lib/giftz/workspace.ts`) → version snapshot (SHA-256 content-addressed `CodeBlob`, integrity hash, append-only rollback — `src/lib/code/versioning.ts`). Sandbox execution (`src/lib/sandbox/runner.ts`: `unshare -Urn` + `prlimit`, explicit per-run `approval: true`, never automatic). Preview: sandboxed iframe (`allow-scripts`, no same-origin) with CSP `default-src 'none'` + postMessage error bootstrap — **the generated app already executes in the visitor's browser**.
- Pure, unit-tested, browser-portable modules already in the repo: `src/lib/giftz/fence.ts` (client-safe by design), `src/lib/giftz/diff.ts` + `src/lib/code/diff.ts` (dependency-free LCS), `src/lib/code/dependency-analysis.ts` (pure regex import-scan), `src/lib/code/preview-audit.ts` (pure), `src/lib/frontend-intel/validate.ts` checks (incl. brace-balance syntax screen).
- Known portability blockers: module-level `db` / `node:crypto` / `child_process` imports in `workspace.ts`, `parse.ts`→`runner.ts`, `plan.ts`, `versioning.ts`.

**Client-side suitability:**
- **Strong:** browser-side static analysis over files the UI already fetched (dependency scan, brace/paren balance, preview audit) — pure logic that can run in a Web Worker with zero server round-trip. Must remain advisory: server routes stay authoritative; nothing here touches the sandbox approval contract.
- **Never:** provider calls, sandbox execution, persistence, version integrity (Node crypto), engine kit materialization (fs-bound).

### 2.5 GANGZII — voice, speech & audio workspace (API present, runtime UNWIRED)

- `src/app/api/gangzii/*` exists (tts, transcribe, convert, lyrics, lyrics/analyze, live, music, voices, song-presets, availability); adapters implemented in `src/lib/adapters/hosted-audio.ts` (z-ai audio surface; ffmpeg transcode; Goertzel beep-artifact guard — pure math).
- Runtime reality (code-shown): UI component `src/components/bean/gangzii.tsx` (1,897 lines) is **imported nowhere** (not in `ViewId`, `NAV`, or `page.tsx`); `'gangzii'` is **not registered** in `BEAN_PRODUCTS` → `preflight()` throws NOT_FOUND for gangzii tasks; no engine handler for `speech-synthesis`/`audio-transcription`/`audio-conversion` → honest `NO_BACKEND`; music generation truthfully rejected (license under review, no GPU worker). Corroborated by `docs/reports/BEAN-FOUR-PRODUCT-ARCHITECTURE-AUDIT.md:51`.

**Client-side suitability:** mic capture already browser-side; WAV/PCM assembly, magic-byte sniffing, tone detection are pure and portable. But the product is not navigable and its server pipeline is unwired — integrating client compute into a broken surface would not deliver user value and would touch an orphaned component. **Verdict: deferred — no adapter in this milestone.** (Fixing GANGZII's wiring is an unrelated repair, explicitly out of scope per the preservation rules.)

### 2.6 BEAN FX — ABSENT (see Section 1). ### 2.7 BEAN Folio — ABSENT (see Section 1).

For both: the shared engine exposes a documented adapter seam (`registerProductAdapter`) with
typed task contracts, so a future FX/Folio repository can attach without engine changes. No
code is written against products that do not exist.

---

## 3. Shared infrastructure available for reuse (no duplication)

| Need | Existing system (verified) |
|---|---|
| Auth / ownership | `requireUser()` (`src/lib/auth/session.ts`); every user-scoped row carries `userId`; API-key scopes incl. additive precedent (`images:generate` …) |
| Rate limits / quotas | `checkRateLimit(key, limit, windowMs)` + `checkDailyQuota` (`src/lib/auth/ratelimit.ts`) — a `client-compute:<userId>` key slots in without new machinery |
| Durable job semantics | `GenerationJob` (CAS claim, lease/heartbeat/recovery, `workerKind` free string, dedupe, cancel) + append-only `JobEvent` SSE replay (`src/lib/ai-engine/*`) |
| Health / capability reporting | `/api/health` measured probes + per-capability `capabilities[]` rows (`src/lib/registry/capabilities.ts`), 20 s probe cache, `real | deterministic | simulated` classification, last-attempt evidence |
| Provider fallback honesty | `registry/backends.ts` fallbacks + `wrapWithProviderFallback` — attempted only when verified, audit-logged, never silently substituted |
| Metering / audit | `recordUsage` / `recordAudit` (`src/lib/observability/metering.ts`), `costMicros: null` honesty rule |
| Output validation precedent | ffprobe completion gate (JAZMII), coverage-validation gate (LAXII), export secret scan (CODE GIFTZ) — servers never trust unvalidated success |
| Browser-adjacent pure modules | RIISHE text pipeline, CODE GIFTZ diff/dependency/preview-audit/fence, LAXII chroma/dimension math, GANGZII audio byte math (all dependency-free) |

**Hard server-side boundaries (never move to a browser):** gateway/provider credentials (`/etc/.z-ai-config`, `BEAN_PROVIDER_OPENAI_*`, `BEAN_CREDENTIALS_MASTER_KEY`), Agent Reach/Obscura binaries, the `unshare` sandbox + approval contract, authoritative rate-limit/audit counters, Prisma persistence and version integrity, engine kit/vendor file materialization.

---

## 4. Browser/hardware requirements and risks

- WebGPU: Chromium-family only today (Chrome/Edge 113+; Safari Technology Preview). Firefox: behind flags. Detection must treat absence as normal (Tier 0–1 paths must be fully functional).
- Secure context required for WebGPU, Web Workers module scripts, `navigator.storage.estimate`, SharedArrayBuffer (plus COOP/COEP for SAB — currently absent from `next.config.ts` headers; SAB support must therefore report `false` until headers exist).
- Browsers do not expose exact VRAM/free RAM/GPU model. `hardwareConcurrency` is NOT a performance measure. Device profile must use capability checks + conservative opt-in benchmarks only, never user-agent inference; unknown values stay unknown.
- Mobile: conservative defaults (one heavy model at most, lower concurrency, no auto-downloads) — derived from measured signals (touch + small viewport + low `deviceMemory` tier when exposed), never from UA strings.
- Storage eviction: browsers may evict origin storage under pressure; the model cache must verify integrity on load (`navigator.storage.persist()` requested, never assumed).
- Device loss (`GPUDevice.lost`), context loss (WebGL `WEBGL_lose_context`), tab suspension, and OOM must all be first-class states in the engine.

## 5. Recommended implementation sequence (adapted to this repository)

| Step | Content | Why this order |
|---|---|---|
| 1 | Shared engine core in `src/lib/client-compute/`: typed contracts, capability detection, device profiles/tiers, scheduler, fallback states, privacy/consent, resource manager | Everything else consumes these seams; pure and unit-testable without a browser |
| 2 | WebGPU + CPU/WASM execution engines with compatibility registry | GPU lane gated on real detection; CPU lane bounded (worker pool) |
| 3 | Model registry + download policy (approval, integrity, quota, deletion) | ML-capable workloads (e.g., client segmentation) must not exist outside this gate |
| 4 | LAXII adapter (flagship): client preprocessing (resize/compress/chroma-cutout/enhance-math) wired into the existing LAXII UI behind explicit consent | Real, useful workload; already client-adjacent (mask painter); server route remains authoritative |
| 5 | CODE GIFTZ adapter: browser-side static analysis (dependency scan, balance screen, preview audit) in a worker | Pure modules already exist and are tested; advisory-only |
| 6 | JAZMII adapter: reference-image client pre-check + video thumbnail generation | Cuts wasted submissions; trivially bounded |
| 7 | Server-side additive: authenticated client-compute report endpoint (reuse auth/ratelimit/metering), additive docs | Integration point for existing health/diagnostics without touching the 573-line health route |
| 8 | RIISHE / GANGZII adapters: **deferred with recorded rationale**; BEAN FX / BEAN Folio: **absent — adapter seam only** | Honest scope; no fake capabilities |
| 9 | Tests + real-Chromium capability verification + performance measurements (honest labels) | Evidence before claims |

## 6. Compatibility risks (recorded)

1. **No ML runtime dependency exists in the repo** (no onnxruntime-web/transformers.js). Adding one is required for client segmentation and must be an explicit, pinned, opt-in download — not bundled silently.
2. **LAXII preservation guarantees are byte-exact server-side** (Sharp). A client-side port must either replicate the preservation report honestly or label itself lossy — never claim parity without measurement.
3. **The LAXII/JAZMII/CODE GIFTZ chat surfaces are quota-metered server-side.** Client-side preprocessing reduces upload bytes but must not bypass or duplicate server validation (JAZMII's module explicitly "validates, does not substitute").
4. **CSP on the preview iframe is `default-src 'none'`** — any client compute inside generated previews must come from inlined engine bootstrap, never remote scripts (the existing blocking check stays).
5. **`workerKind` on `GenerationJob`** can carry `'client'` for client-observed task metadata, but a client can never self-attest completion of server-authoritative work; reports are evidence, not truth.
6. **Sandbox recycle hazard (environment):** the platform may recycle the sandbox between sessions; unpushed work must be pushed and verified before the session ends.
