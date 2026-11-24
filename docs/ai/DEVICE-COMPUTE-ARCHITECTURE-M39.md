# M39 — DEVICE COMPUTE ARCHITECTURE (Universal Live AI Runtime & Automatic Device Compute)

> Branch: `feat/m39-universal-live-ai-runtime` · Date: 2026-11-24 · Companion docs:
> `docs/M39-IMPLEMENTATION-REPORT.md`, `docs/ai/MODEL-EXECUTION-MATRIX-M39.md`, `docs/ai/LOW-SPEC-ACCEPTANCE-M39.md`,
> prior architecture: `docs/BEAN-CLIENT-COMPUTE-ARCHITECTURE.md` (M36 engine), `docs/ai/MODEL-COVERAGE-M38.md` (M38 lifecycle + coverage).
> Budget: ₹0 recurring · No new paid infrastructure · No new user-facing controls.

## 1. What M39 adds (and where)

M39 turns every registered AI capability into an automatically routed, genuinely
executing path. It is **internal backend/orchestration only** — the customer UI is
unchanged; there is no model selector, no GPU/CPU switch, no hardware panel.

Additions by commit (all on the feature branch, remote-verified):

| Commit | What it wired |
|---|---|
| `f9e5016` (m39.1) | **Quality-route policy → automatic execution.** `resolveQualityRoute` (M38 §B5) now consults the scheduler for MODEL-backed tasks only; deterministic compute lanes keep fixed quality. Evidence mirrors the executor's own gates (model gate, backend gate, privacy) so the policy can never approve a lane the executor refuses. `prefer-backend` moves backend steps first with verified local lanes kept as honest fallback **after a real backend failure**; `local-with-limitation` results carry the stated limitation on the output; `no-route` failures carry the honest policy text. Additive `ClientModelEntry.qualityClass` (webllm chat minimal / whisper-tiny balanced / MODNet high) + descriptor/kind complexity. |
| `9496496` (m39.2) | **CPU/WASM chat lane + GPU-failure automatic fallback.** Registered `riishe-chat-wasm-qwen2.5-0.5b-gguf` (Qwen2.5-0.5B-Instruct q4_k_m GGUF, 491,400,032 bytes, sha256-verified `74a4da8c…7a9db`, revision `9217f5db` pinned) executed by a new `wasm-chat-worker` (wllama 4.0.0, MIT, llama.cpp GGUF) that mirrors the existing webllm worker protocol (`init/generate/interrupt/unload/status` → `progress/ready/delta/done/error/state`) with `n_gpu_layers=0` so client-CPU claims are literally true. Context is adapted to the policy memory budget, `max_tokens` honestly clamped, abort-signal cancellation, `exit()` heap release. Self-hosted wasm assets (no CDN). DCM: GPU-first selection preserved; cpu-only mode genuinely skips the GPU chat lane; GPU-class load failures (device-lost / webgpu-unavailable / OOM) **auto-fallback to CPU with recorded degradation**; approval-gated bean-managed download (SHA-256 gate) before any artifact load; residency-based streaming/interrupt/unload routing. |
| `348f696` (m39.3) | **Universal execution matrix + delivery parser fix.** `scripts/m39-acceptance/execution-matrix.ts` drives every registered backend through its real production path with honest ok/true-null/false outcomes; `parseFiles` now honors a path directive the model places inside the fence (live-found delivery defect). |

Everything reuses the EXISTING architecture: one model registry
(`src/lib/client-compute/model-registry.ts` + `src/lib/registry/backends.ts`), one
scheduler (`src/lib/client-compute/scheduler.ts`), one resource manager, one durable
job queue, one Trust Engine — no duplicate registry, compute manager, inference
gateway, RAG or queue was added.

## 2. The automatic routing pipeline (end to end)

```
customer uses RIISHE / CODE GIFTZ / LAXII / JAZMII / GANGZII
        │  (existing product surfaces — unchanged UI)
        ▼
task classification (existing kind/descriptor; complexity from descriptor → kind → 'standard')
        ▼
ComputeScheduler 12-step selection (M36, unchanged order):
  1 validate → 2 consent/privacy → 3 client-execution allowed → 4 device profile
  5 model gate (registry + runtime + verified install) → 6 workload feasibility
  (memory class + admission + visibility) → 7 plan build → 8 quality-route consult (M39.1)
  → 9 execute with time budget + cancellation → 10 per-target fallback on REAL failure
  → 11 output validation → 12 honest report (states + degradations + limitations)
        ▼
execution target (decided automatically, never by the customer):
  A. compatible local GPU (WebGPU) — only after real capability checks + successful
     model/operator initialization (webllm chat lane, whisper ASR, MODNet browser matting)
  B. compatible local CPU/WASM — wllama chat lane (M39.2), CPU kernels, ffmpeg-class
     deterministic tools; quantized models for constrained devices
  C. authorized + configured remote execution — hosted gateways already wired through
     the router (chat, code, image, video, TTS, ASR); never a hidden new paid service
        ▼
Trust receipt + honest output (unverified output can never finalize as a plain "completed" task)
```

Key wiring facts:

- `quality-route-integration.ts` is the ONLY place scheduler facts become
  `QualityRouteInput` — `authorizedBackendAvailable` mirrors the scheduler's backend
  gate (privacy class + fallback policy + registered delegate), `localModelVerified`
  mirrors the model gate. The policy layer cannot approve a lane the executor refuses.
- `applyQualityRouteToPlan` partitions the plan backend-first ONLY for
  `prefer-backend`; relative order inside each group is preserved; verified local
  lanes stay as fallback after a REAL backend failure (a failed backend is recorded,
  not simulated).
- `local-with-limitation` outputs carry the limitation text on the result (e.g. the
  on-device chat model is a small model; retrieval/tools/memory/citations are not
  part of the on-device lane).
- A weak local model NEVER silently replaces a stronger authorized route
  (`minimal`-class models cannot serve `standard`/`demanding` tasks automatically
  while an authorized stronger route exists).

## 3. Execution lanes and their runtimes

### 3.1 Client (visitor device) lanes — `src/lib/client-compute/model-registry.ts`

| Registered model | Runtime | Device requirement | Integrity gate | Quality class |
|---|---|---|---|---|
| `riishe-chat-webllm-qwen2.5-0.5b` | WebLLM 0.2.89 (WebGPU) | GPU tier; WebGPU adapter + successful init required | runtime-managed pinned revision `32ff081f…` | minimal |
| `riishe-chat-wasm-qwen2.5-0.5b-gguf` | wllama 4.0.0 / llama.cpp GGUF (CPU WASM) | any tier with ~768 MB budget; `n_gpu_layers=0` | bean-managed download + pinned sha256 `74a4da8c…7a9db` | minimal |
| `gangzii-asr-browser-whisper-tiny` | Transformers.js / onnxruntime-web (WASM, WebGPU where offered) | light/medium memory class | runtime-managed pinned revision | balanced |
| `laxii-bgremoval-modnet` | onnxruntime-web (WASM; WebGPU backend only after real capability checks) | medium class | runtime-managed pinned revision | high |

Worker bundles are self-hosted (`public/workers/`, built by `scripts/build-workers.mjs`);
the wasm chat runtime ships its own assets (10.34 MB main + 16.82 MB compat, no CDN).

### 3.2 Server-local lanes (installed models, `src/lib/media/local-models.ts`)

| Backend | Model | Install gate | Verified execution (this host) |
|---|---|---|---|
| `bean-image-local-segmentation` | MODNet ONNX (25,888,640 B) | explicit download + size + SHA-256 | real CPU inference, matte validated |
| `bean-image-local-edit` | big-lama inpainting ONNX (92,591,623 B) | same gate | real CPU inpaint, masked composite |
| `bean-video-local-motion` | RIFE fp32 ONNX (21,604,631 B) | same gate | real frame interpolation in the local motion lane |
| `bean-audio-tts-local-kokoro` | Kokoro-82M q8 (kokoro-js 1.2.1) | engine install route with sha256 | real synthesis when the runtime downloads are present |
| `bean-image-local-sharp`, `bean-audio-tools-local-ffmpeg`, `bean-audio-convert-local-ffmpeg`, `bean-video-composition-local` | deterministic (sharp / ffmpeg / HyperFrames) | n/a (code, not weights) | real deterministic execution |

### 3.3 Hosted lanes (authorized gateways already in the router)

`bean-llm-hosted-primary` (+ fallbacks: credential-gated OpenAI-compatible slot, local
llama.cpp loopback slot), `bean-code-llm-hosted-primary`, `bean-image-hosted-primary`,
`bean-image-hosted-edit`, `bean-video-hosted-primary`, `bean-audio-tts-hosted-primary`,
`bean-audio-asr-hosted-primary`. Availability is measured by health probes, never
assumed; dormant credential slots are skipped, never faked; no Ollama; no hardcoded
provider keys; no new recurring paid infrastructure.

## 4. Resource protection (privacy, security, device health)

Inherited from M36/M38 and pinned by the existing suite, plus M39.2 changes:

- **Per-visitor isolation.** A visitor's device executes only that visitor's own
  requested work. There is no background mining, no hidden compute-sharing, no
  cross-user execution system. Client tasks come from the visitor's own session and
  are cancelled on `pagehide` (`ResourceManager.attachPageLifecycle` → `releaseAll`).
- **Download consent + integrity.** No model package downloads silently: every
  bean-managed artifact requires explicit approval with the real size shown before
  approval (M39.2 lane included), then a pinned SHA-256 gate; runtime-managed caches
  (WebLLM/Transformers.js) are refused by `requestDownload`
  (`REFUSED_RUNTIME_MANAGED`) instead of faking a checksum gate. Licenses are pinned
  per entry (Apache-2.0 Qwen2.5, MIT wllama, per-model licenses for server-local
  artifacts).
- **Budgets.** Policy memory budgets per resource class (light 64 / medium 256 /
  heavy 1024 MB; conservative 32 / 96 / 384 MB), one heavy model at a time,
  device-task concurrency cap (2 normal, 1 conservative), per-task time budget,
  context length adapted to the budget in the wasm chat lane.
- **Lifecycle hardening.** Tab suspension: tasks are not STARTED while hidden and
  `visibilitychange` is recorded (no hidden work). Lost GPU devices: the WebGPU
  engine detects device loss/OOM and reports `CLIENT_GPU_DEVICE_LOST`; the chat lane
  auto-falls back to CPU with a recorded degradation (M39.2). Worker crashes: every
  client worker client (`webllm-chat-client`, `wasm-chat-client`, `ort-segmentation`,
  `browser-asr-client`) listens for worker `error` and converts it into an honest
  failure state. Interrupted downloads: `.part` → rename atomicity on server-local
  installs; browser downloads are resumable caches managed by the runtimes; a failed
  integrity gate refuses the artifact.
- **Release.** GPU device destroyed when the last task completes; workers exit() and
  release heap when jobs finish; `releaseAll` on page hide. Nothing keeps VRAM/RAM
  reserved in the background.
- **Privacy.** Local lanes keep sensitive inference data on the device; backend
  steps go through the existing privacy-class gates; provider/model/runtime
  identities stay out of the customer UI (M36-D hygiene, re-verified in M39).

## 5. Honest environment statement

This sandbox has **no GPU** and ~4 GB RAM. During M39:

- WebGPU execution was NOT measurable here (M36/M38 finding, unchanged) — GPU lanes
  are gated by real capability checks and would honestly fall back or refuse; no GPU
  success was ever claimed from a simulation. The unit/integration suite covers the
  GPU path with fake workers and honest-state contracts; real-GPU acceptance belongs
  on real hardware (the owner's Ryzen 7 + RTX 5060 Ti acceptance pass is documented
  as a remaining hardware-dependent item in the implementation report).
- One full-suite run executed concurrently with the live server + video jobs
  exhausted the 4 GB sandbox and the kernel OOM-killed the dev server (dmesg
  recorded); the suite was re-run sequentially afterwards. This is an environment
  constraint, not an application defect — and it is exactly why the resource
  policies in §4 exist for visitor devices.
