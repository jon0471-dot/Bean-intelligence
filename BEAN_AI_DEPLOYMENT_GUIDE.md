# BEAN AI DEPLOYMENT GUIDE

Milestone: Universal AI Operationalization & User Device Acceleration · 2026-11-18.

Covers every configuration the architecture supports, per environment (Windows / Linux / macOS desktop; Android / iOS web). Where a hardware acceleration path is unsupported, the honest fallback is stated — BEAN never promises identical performance across devices.

---

## 0. What runs where (quick map)

| Configuration | Components | Prerequisites |
|---|---|---|
| A — Browser-only | Website + browser-cached models (WebGPU/WASM) | A WebGPU-capable browser for the chat lane; WASM browsers work for ASR/segmentation |
| B — Browser + local desktop engine | Website + your own `llama-server` | llama.cpp on the same computer, loopback + API key |
| C — BEAN gateway (server) | Existing hosted providers, keys, usage | Nothing user-side (credentials are server-side) |
| D — Backend jobs | Durable queue workers | Nothing user-side; jobs survive tab close |

The website is fully functional in Configuration C alone. Tiers A/B are opt-in per user.

## 1. Standard deployment (server side, all OSes)

```bash
bun install                     # app deps (the heavy browser AI runtimes are NOT here — see §3)
bun run db:generate             # prisma client
bun run build                   # builds worker bundles + copies ORT assets + next build (standalone)
bun run start                   # production server (embedded worker pools start automatically)
```

- Embedded AI engine pools (riishe/laxii/jazmii/code-giftz/gangzii) start via `src/instrumentation.ts`; disable with `BEAN_ENGINE_EMBEDDED=0` and run standalone workers if preferred: `bun run workers` (all pools) or `bun run worker --product gangzii`.
- `bun run workers:build` regenerates `public/workers/*.js` (self-hosted AI worker bundles) and `bun run ort:assets` regenerates `public/ort/` — both also run automatically before `build`/`dev`.
- Health: `GET /api/health` reports per-product status with capability-level evidence rows (including the GANGZII entry and the honest `not-configured` music row).
- Optional lanes (all honestly dormant until configured):
  - OpenAI-compatible fallback: `BEAN_PROVIDER_OPENAI_API_KEY` (+ optional `_BASE_URL`/`_MODEL`).
  - Server-side llama.cpp lane: start llama-server on the BEAN host, then `BEAN_LLAMACPP_BASE_URL` + `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1`.
  - SearXNG research fallback: `BEAN_SEARXNG_URL`.

## 2. Configuration A — browser-only inference (end user)

**Requirements by lane:**

| Lane | Browser requirement | Honest fallback when missing |
|---|---|---|
| On-device chat (RIISHE toggle) | WebGPU adapter (Chrome/Edge 113+; Safari 18+/TP where available; Firefox Nightly+flags) | **None for chat** — the pinned q4f16 quantization is WebGPU-only; the UI says so and offers the server lane. No false "CPU chat" promise |
| On-device transcription (GANGZII toggle) | WASM + Web Workers (universal); WebGPU accelerates it | WASM path (slower, honest "running on CPU") |
| LAXII on-device background removal | WASM SIMD + Workers; WebGPU accelerates | WASM SIMD path |
| Device ASR on Android/iOS web | Modern mobile browsers support WASM; WebGPU on Android Chrome; **iOS Safari: WASM lane only** | Mobile budgets: the manager's conservative tier tightens the memory estimate (≤1 GB policy budget) |

**User flow (never automatic):**
1. Open **AI Device** (sidebar) → grant **Run AI on this device** (once per browser; optional *local-only* switch forbids any server fallback).
2. Choose a compute mode: Automatic / GPU acceleration / CPU only / Local desktop engine / Server providers.
3. Models section: every entry shows its real measured size + license + integrity model. "Prepare"/"Download" asks for confirmation with the size FIRST (e.g. chat model 289.7 MB; whisper-tiny 43.6 MB; MODNet 6.3 MB). Cancel/clear/unload are provided.
4. RIISHE: the composer's "On-device · private" chip appears only when the device measure supports it. GANGZII Live: "Transcribe on-device" (audio never leaves the browser). LAXII: segmentation runs after the model download.

**Storage:** models live in the browser cache (Quota-protected; the download gate refuses if free space would drop below a 100 MB headroom). Clearing is per-model in AI Device settings.

## 3. Why the browser runtimes are prebuilt worker bundles

`@mlc-ai/web-llm@0.2.89`, `@huggingface/transformers@4.3.2` and `onnxruntime-web@1.31.1` are **build-time dependencies of the worker bundles only** (`src/workers/package.json`), not app dependencies. `bun run build`/`dev` bundle them once into `public/workers/*.js` (same-origin, no CDN) and copy ORT's WASM assets to `public/ort/`. The app's Next.js graph never imports them (measured: their presence in the app tree alone OOM-kills the Turbopack build in a 4 GB environment; with the nested layout the build passes). After checkout, the first `bun install && bun run build` handles everything automatically.

## 4. Configuration B — local desktop engine (end user's own computer)

**Step 1 — install llama.cpp** (per OS):
- Windows: download a release build (`llama-server.exe`) or build with CMake; NVIDIA CUDA / Vulkan builds available.
- Linux: distro package, release binary, or build (`cmake -B build && cmake --build build`); CUDA/Vulkan flags optional.
- macOS: release binary or build; Metal is used automatically on Apple Silicon.
- A GGUF model is required (e.g. Qwen3-1.7B Q4_K_M ≈ 1 GB class). Download from the model card you have license-reviewed — BEAN never fetches weights itself.

**Step 2 — start the engine loopback-only with an API key (all OSes):**
```bash
llama-server -m path/to/model.gguf --host 127.0.0.1 --port 8080 --api-key <your-secret> -c 8192
```
- `--host 127.0.0.1` is mandatory in BEAN's contract (never expose the engine publicly; BEAN refuses non-loopback pairing).
- `--api-key` is strongly required: without it, any local page could call the engine. Optionally add `--cors-origins` to restrict origins further.

**Step 3 — pair in the website:** AI Device → Local desktop engine → host `127.0.0.1`, port `8080`, paste the API key → **Pair** (BEAN verifies with a real `/v1/models` probe and shows the reported model) → **Verify** any time. Unpair deletes the stored key. Mode "Local desktop engine" (or Automatic) routes eligible requests there; unreachability is reported honestly with the recovery action.

**Per-OS notes (honest):** Windows sandbox-less setups identical; macOS sleep may drop the connection (Verify re-pairs); Linux identical. GPU offload (`-ngl N`) is a llama.cpp flag — BEAN neither measures nor claims your VRAM.

## 5. Mobile (Android / iOS web)

- All server lanes (Configuration C) work in mobile browsers — the UI is responsive by design (RIISHE drawer, GANGZII tabs, AI Device settings).
- Device lanes: Android Chrome supports WebGPU (chat lane available on capable devices); iOS Safari supports WASM lanes (ASR/segmentation) — the chat lane honestly reports "WebGPU unavailable" rather than pretending. Background jobs (Tier D) are the recommended path for long generations on mobile: close the tab safely, the durable worker completes the turn.

## 6. Operator setup for the remaining product surfaces

- **LAXII generative masked editing** (Diffusers worker): requires a GPU host (≥8 GB VRAM class). Deploy `workers/laxii-diffusers/worker.py` (see its README), run its preflight + one real inference acceptance, record evidence, then flip `bean-image-selfhosted-diffusers.enabled`. Without this, the capability reports BLOCKED honestly (deterministic enhancement + on-device bg-removal still work).
- **JAZMII image-to-video**: needs one completed live run on the provider (measured 429-blocked previously); status flips automatically on real evidence.
- **GANGZII music generation**: no backend deployed — refuses with NO_BACKEND honestly. Deploying one requires a licensed model + worker; do not enable without a real acceptance run.
- **Docling (optional document-understanding upgrade)**: install Python docling on the BEAN host, run it through the EXISTING ingestion worker path (no new queue), then record evidence before advertising. Not shipped enabled by default (see REPOSITORY_EVALUATION §5).

## 7. Verification checklist after deployment

1. `GET /api/health` — five products present; gangzii capabilities show real probe evidence; music row "not configured".
2. `bun run test` — 2,216 tests pass (baseline preserved + operationalization pins).
3. AI Device page — tier/runtimes measured on a real device; the three models show measured sizes; downloads require confirmation.
4. RIISHE — server chat works; on-device chip appears on WebGPU-capable browsers only.
5. GANGZII — TTS/transcribe/convert/live flows produce real artifacts; ffprobe verifies conversions.
6. `bun run build` — worker bundles + ORT assets + standalone output; no CDN dependency.
