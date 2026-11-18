# BEAN AI OPERATIONALIZATION RESULTS

Milestone: Universal AI Operationalization & User Device Acceleration · Executed 2026-11-18 · Branch `feat/ai-operationalization` (LOCAL-ONLY, based on the sanitized publication tip `4d134c5794cfe92ff7c8e477f536075e7c8bffb0`; no remote operation of any kind was performed).

Companion documents: `BEAN_AI_OPERATIONALIZATION_MATRIX.md`, `BEAN_UNIVERSAL_AI_ARCHITECTURE.md`, `BEAN_AI_REPOSITORY_EVALUATION.md`, `BEAN_DEVICE_COMPUTE_PRIVACY.md`, `BEAN_AI_DEPLOYMENT_GUIDE.md`.

**Headline: implementation is complete and validated at full baseline.** Five products now run real inference (GANGZII was recovered from a fully orphaned state), browser-local AI is operational across three lanes with pinned/measured models, the optional llama.cpp desktop engine pairs loopback-only, and every existing contract, queue, gate and boundary is preserved. Consolidated validation: **2,216 tests / 0 failures / 39,746 expectations / 163 files; eslint clean; scoped TypeScript 0 errors; `bun run build` PASS (standalone + route table); secret scan: 0 `bean_session`, only the documented benign classes.** Two REAL live probes (audio + chat) were executed against the actual gateway through the wired paths.

## 1. Milestone-phase record (commits on `feat/ai-operationalization`)

| Commit | Content |
|---|---|
| `5167c7b` | feat(gangzii): wire the orphaned audio product to real execution |
| `7eb7912` | feat(client-compute): universal browser AI inference core (Tier A/B) |
| `afe63c4` | feat(ui): AI Device settings + on-device lanes wired into RIISHE & GANGZII |
| `2cb249b` | test(client-compute): pin the new inference contracts |
| `37f6f85` | build+test: consolidated validation fixes — Turbopack OOM root-caused & fixed |
| (final) | docs: deliverables + README accuracy corrections |

## 2. What became operational

### 2.1 GANGZII — the orphan, recovered (was: every route 404'd, jobs settled NO_BACKEND)

- Catalog entry, 3 backend descriptors (measured 2026-10-27 limits), router adapters with real cached probes, dedicated worker pool, kick-list + standalone worker registration, health entry (incl. honest not-configured music row), nav + view mount, quotas (8/min, 80/day).
- REAL engine handlers (`src/lib/jobs/audio-worker.ts`): chunked TTS → one assembled 24 kHz mono WAV with the documented leading-tone guard; gateway ASR (WAV/WebM); deterministic ffmpeg conversion **with ffprobe channel verification** (a mono file can never be mislabeled stereo). Checkpointed cancellation + guarded completion + usage metering, mirroring the LAXII processor contract.
- **LIVE PROOF (2026-11-18, real gateway):** TTS probe healthy; synthesis through the exact handler path produced a **4.38 s / 210,284-byte 24 kHz WAV (geometry exact to the byte: 44 + 4.38×24000×2)**; the ASR round-trip transcribed the actually-spoken text ("Bean Intelligence Gangzey Voice Wiring Verification" — the ASR's phonetic rendering of GANGZII); ffmpeg probe healthy (7.1.5).

### 2.2 Tier A — browser-local AI (each visitor's device processes that visitor's own requests)

- **Runtimes adopted and pinned:** `@mlc-ai/web-llm@0.2.89` (Apache-2.0), `@huggingface/transformers@4.3.2` (Apache-2.0), `onnxruntime-web@1.31.1` (MIT). All three live ONLY in a nested build-time package (`src/workers/package.json`) and ship as **self-hosted worker bundles** (`public/workers/*.js`, 5.88/0.57/0.40 MB) — no third-party CDN, and never inside the Next.js compile graph.
- **Models (all measured, nothing invented):**
  - `riishe-chat-webllm-qwen2.5-0.5b` — `mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC` @ revision `32ff081f…`, **289,693,824 bytes** (HF tree API), Apache-2.0, VRAM estimate 945 MB (pinned prebuilt record), WebGPU-only (honest).
  - `gangzii-asr-browser-whisper-tiny` — `Xenova/whisper-tiny` @ `5332fcc3…`, **43,622,127 bytes** (q8 set), Apache-2.0 (upstream Whisper MIT), WebGPU→WASM fallback.
  - `laxii-bgremoval-modnet` — exact artifact @ `fa2fa546…`, **6,632,188 bytes**, **SHA-256 `92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a`** (downloaded and hashed in-sandbox), Apache-2.0 — the BEAN-managed checksum gate now PASSES on a real pin and MODNet background removal runs through onnxruntime-web off-thread.
- **Engines:** WebLLM chat worker (streaming, interrupt, unload, one model per tab), Whisper ASR worker (16 kHz mono decode → transferable PCM, q8 dtypes, provider fallback), segmentation worker (cache-read + ORT in-worker; matte composited at original geometry; actual provider reported).
- **DeviceCapabilityManager:** measured capability snapshot (WebGPU adapter probe, WASM/SIMD, workers, coarse memory bucket), safe memory budget (labeled policy estimate), runtime probes registered from real facts, residency tracking, **the 5-step selection policy** (browser GPU → browser CPU → paired local engine → server → honest unavailable), honest §8 status vocabulary, failure recording with recovery.
- **UI:** full **AI Device** settings page (device facts, consent + local-only switches, five compute modes, per-capability status rows, model downloads with real size shown BEFORE approval, progress/cancel/clear/unload, loopback pairing UI, privacy summary); RIISHE "On-device · private" composer lane (toggle appears only when measured capability supports it; size-confirmed download; streaming generation; honest unsaved/no-retrieval labeling; partial-limit handling); GANGZII "Transcribe on-device" live-voice lane (audio never leaves the browser).
- **Integrity model (honest, two-tier):** bean-managed artifacts pass the strict SHA-256 gate; runtime-managed weights are pinned by measured upstream revision and `requestDownload` REFUSES them (`REFUSED_RUNTIME_MANAGED`) instead of faking a checksum it does not compute.

### 2.3 Tier B — local desktop engine (optional, loopback-only)

- `src/lib/local-engine/llamacpp-client.ts` + pairing UI: loopback hosts only (non-loopback refused — unit-pinned), real `/v1/models` pairing probe with auth classes, OpenAI-compatible streaming with typed failures, key stored only in the visitor's localStorage and sent only to the engine. The pre-existing server-side llama.cpp lane is preserved unchanged.

### 2.4 Tier C — capability-aware routing (no parallel gateway)

- The client selection policy routes each request by model requirements + device capability + privacy policy + user preference; the server gateway, contracts, scopes, keys, metering and breakers are byte-for-byte preserved (`/api/v1/*` untouched).

### 2.5 Tier D — background adoption (no duplicate queue)

- RIISHE "Background" composer action → existing `POST /api/ai/jobs` durable queue; the worker runs the SAME server turn core and appends the real answer; the tab can close safely. The three audio handlers now execute on the engine instead of settling NO_BACKEND (M26 F-G1 regression updated honestly: the NO_BACKEND contract itself is still pinned via music-generation).

### 2.6 Live proof for the server chat lane

- Hosted LLM health probe healthy; **real completion returned**: "Bean live probe ok." (363 ms) through the exact adapter RIISHE/CODE GIFTZ use.

## 3. Consolidated validation (single pass, after all implementation)

| Gate | Result |
|---|---|
| `bun install` | 927 packages (3 AI runtimes nested under `src/workers`, not the app tree) |
| `bun run test` | **2,216 pass / 0 fail / 39,746 expect() / 163 files (59.02 s)** — exact baseline preserved (2,188/39,587/159) plus 28 new operationalization pins; 5 stale state-pins updated honestly (documented in-commit); no flake observed |
| TypeScript (scoped `src`+`tests`, established overlay) | **0 errors** |
| `eslint src tests` | clean (exit 0) |
| `bun run build` | **PASS** — worker bundles + ORT assets + standalone route table |
| Secret scan (tracked 2,506 files + 2,971 history blobs) | **0 `bean_session` tokens**; hits are exactly the documented benign classes (64-hex digests incl. the NEW sha-256 pins, test fixtures for bgk_/postgres/OpenAI-shaped keys) — nothing new to classify |
| LIVE audio probe | synthesis 4.38 s WAV (exact geometry) + ASR round-trip transcript (real text) |
| LIVE chat probe | real hosted completion (363 ms) |

**Build OOM root cause (measured, then fixed structurally):** `next build` (Turbopack, Next 16.1.3) was killed (exit 137, five times) in the 4 GB sandbox. An isolation experiment (packages removed from node_modules → build compiles successfully) proved the trigger was the **presence** of the three browser runtimes in the app's node_modules (Turbopack watch/scan memory), not their imports. Fix: nested build-time package for the worker bundles + `turbopack.root` scoping (a parent lockfile was also walking the outer workspace) + runtimes in `serverExternalPackages`. After the fix the build passes cleanly. Additionally, webpack-path diagnostics confirmed the repo is Turbopack-native (pre-existing builtin-resolution differences under webpack are unrelated).

## 4. Honest limitations and remaining external prerequisites

- **On-device chat is WebGPU-only** (the pinned q4f16 quantization has no CPU path). The UI states this and the honest fallback is the server lane; no CPU chat model was shipped to avoid pretending.
- **Browser execution of these lanes was not possible in this sandbox** (no WebGPU device). Verification evidence: runtime packages pinned and installed, worker bundles build, full protocol/selection/integrity logic unit-pinned (28 new tests), production build passes, ORT wasm assets self-hosted. Real-device validation is a listed follow-up for the owner (any WebGPU-capable Chrome).
- **LAXII generative masked editing** still requires the GPU Diffusers worker (preflight + real inference acceptance) — unchanged, honestly blocked.
- **JAZMII image-to-video** still requires one completed live provider run (measured throttle blocker) — unchanged, honestly blocked.
- **GANGZII music generation** has no backend — refuses honestly.
- **Provider cost accounting** stays null (no invented pricing — preserved policy).
- **`serverExternalPackages` browser runtimes** are belt-and-braces (they are not imported by the graph); removal would not change behavior.

## 5. Preservation verification

- Existing API gateway (`/api/v1/*`), provider registry, key hashing/scopes/rate limits/usage accounting: untouched (only additive registry entries).
- RIISHE orchestrator/tool loop/verification/memory: untouched; the on-device lane is a separate client-side path with its own honest labels.
- CODE GIFTZ turn core, file-ops gates, sandbox: untouched (visitor browsers are never used for code execution).
- LAXII server pipelines + JAZMII poller + ffprobe gates: untouched.
- Durable queue semantics (CAS claims, leases, recovery, cancel): preserved; audio handlers follow the same contract; `enqueueJob`'s honest NO_BACKEND settlement remains pinned for unwired tasks.
- Sandboxing, auth, RBAC, session security: untouched.
- Git safety: work happened exclusively on the local `feat/ai-operationalization` branch inside the sanitized clone; the original working repository (`/home/z/my-project`, pre-rewrite line + 10 WIP refs) was left byte-identical (verified below); **no remote operation of any kind was performed**.

## 6. Final local state

| Item | Value |
|---|---|
| Branch | `feat/ai-operationalization` @ final commit (child of `4d134c5794cfe92ff7c8e477f536075e7c8bffb0`) |
| Sanitized clone | `recovery/bean-rewrite` — main `4d134c5…`, feat `19a04e91…` (verified at milestone start; re-derived exactly after the third workspace-restart loss via the committed M26.1.3 procedure) |
| Original working repo | `9fc15916…` on the pre-rewrite line, clean, WIP refs intact — untouched |
| Public GitHub | **UNCHANGED** (see closing statement) |
| Restart durability | full-branch checkpoint bundle refreshed after every commit at `/home/z/my-project/download/bean-ai-op-checkpoint.bundle` (sanitized history only — no sensitive material) |

`PUBLIC GITHUB STATUS: UNCHANGED — historical sensitive material remains in published Git history.`
