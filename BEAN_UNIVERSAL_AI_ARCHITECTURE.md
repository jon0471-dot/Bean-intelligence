# BEAN UNIVERSAL AI ARCHITECTURE

Milestone: Universal AI Operationalization & User Device Acceleration · 2026-11-18 · Branch `feat/ai-operationalization` (local-only).

## 0. Principles (inherited and preserved)

1. **One server gateway.** Every server-side inference flows through the existing BEAN gateway and provider registry (`src/lib/ai-gateway`, `/api/v1`). No parallel gateway was built.
2. **Truth policy.** Statuses are measured, never assumed. A capability that cannot run reports WHY with a recovery action (stable error codes). No fake health, no demo providers, no simulated responses.
3. **Additive integration.** Existing RIISHE/CODE GIFTZ/LAXII/JAZMII contracts, the durable queue, approval gates and sandbox boundaries are untouched; the device lanes are opt-in side paths.
4. **The visitor's device processes the visitor's own requests.** No shared compute, no mining, no cross-visitor work (see DEVICE_COMPUTE_PRIVACY).

## 1. The four compute locations

```
                    ┌──────────────────────────────────────────────────┐
                    │            DeviceCapabilityManager               │
                    │  (measured capabilities · memory budget policy · │
                    │   residency · selection policy · honest status)  │
                    └───────────────┬──────────────────────────────────┘
        user mode + consent + privacy class
                                    │
   ┌──────────────┬─────────────────┼──────────────────┬────────────────┐
   ▼              ▼                 ▼                  ▼                ▼
┌────────┐  ┌────────────┐  ┌──────────────┐  ┌───────────────┐  ┌────────────┐
│ Tier A │  │  Tier A'   │  │   Tier B     │  │    Tier C     │  │  Tier D    │
│WebGPU  │  │ CPU / WASM │  │ llama.cpp on │  │ existing BEAN │  │ durable    │
│WebLLM  │  │Transformers│  │ the VISITOR's│  │ gateway +     │  │ queue +    │
│(worker)│  │.js (worker)│  │ own computer │  │ provider      │  │ worker     │
│        │  │            │  │ (loopback)   │  │ registry      │  │ pools      │
└────────┘  └────────────┘  └──────────────┘  └───────────────┘  └────────────┘
   browser      browser          visitor PC         BEAN server       BEAN server
```

### Tier A — Browser-local inference (NEW, operational)

**Runtimes (pinned):**

| Package | Version | License | Role |
|---|---|---|---|
| `@mlc-ai/web-llm` | 0.2.89 | Apache-2.0 | WebGPU chat LLM engine, module worker (`src/workers/webllm-worker.ts`) |
| `@huggingface/transformers` | 4.3.2 | Apache-2.0 | ONNX pipelines (ASR), module worker (`src/workers/asr-worker.ts`), revision-pinned fetches |
| `onnxruntime-web` | 1.31.1 | MIT | Direct ORT segmentation (MODNet); WASM assets self-hosted under `/ort/` (no third-party CDN) |

**Models (client registry `src/lib/client-compute/model-registry.ts`):**

| Model id | Source + integrity | Size (measured) | Tasks |
|---|---|---|---|
| `riishe-chat-webllm-qwen2.5-0.5b` | `mlc-ai/Qwen2.5-0.5B-Instruct-q4f16_1-MLC` @ `32ff081f…`, runtime-managed revision pin | 289,693,824 B (17 files) | `chat.on-device` (WebGPU only — q4f16) |
| `gangzii-asr-browser-whisper-tiny` | `Xenova/whisper-tiny` @ `5332fcc3…`, runtime-managed revision pin | 43,622,127 B (q8 set) | `audio.transcription.on-device` (WebGPU→WASM) |
| `laxii-bgremoval-modnet` | `Xenova/modnet` exact artifact @ `fa2fa546…`, **SHA-256 `92e49898…` verified by BEAN** | 6,632,188 B | `image.segmentation` (WebGPU EP attempted → WASM) |

**Two honest integrity models:**
- *Bean-managed* (`laxii-bgremoval-modnet`): BEAN fetches the exact bytes and refuses anything that fails the pinned SHA-256. `requestDownload` keeps the full policy gate (explicit approval, storage quota, headroom).
- *Runtime-managed* (WebLLM/Transformers models): the runtime fetches weights into its own browser cache from a revision BEAN pins by measured commit SHA. `requestDownload` REFUSES these (`REFUSED_RUNTIME_MANAGED`) rather than pretending to checksum-manage what it does not checksum-manage. Sizes were measured from the upstream file tree at pin time.

**Engines:**
- `src/workers/webllm-worker.ts` — engine lifecycle (load/unload), streaming generation, interrupt, one model per tab. Client seam: `inference/webllm-chat-client.ts` (init timeout, worker-crash handling, error mapping).
- `src/workers/asr-worker.ts` — Whisper pipeline (q8 dtypes; WebGPU attempted with honest WASM fallback), 30 s chunking. Client seam: `inference/browser-asr-client.ts` (16 kHz mono decode on the main thread via AudioContext, transferable PCM to the worker).
- `inference/ort-segmentation.ts` — MODNet preprocessing exactly per the pinned preprocessor config (shortest-edge 512, ÷32, rescale 1/255, mean/std 0.5), matte composited at original geometry, provider reported (`webgpu`/`wasm`).

**Model download control (non-negotiable):** nothing downloads on page load. Every download shows the measured size first and requires an explicit approval click (RIISHE composer dialog, GANGZII live panel, AI Device settings). Progress is real (runtime progress callbacks). Pause/cancel, clear-cache and unload are first-class.

### Tier B — Local desktop inference (llama.cpp, optional)

Two lanes, both optional and honestly dormant without config:
1. **Visitor's own computer (NEW):** `src/lib/local-engine/llamacpp-client.ts` — the BROWSER pairs directly with a loopback `llama-server`. Contract: loopback hosts only (`127.0.0.1` / `localhost` / `[::1]` — enforced, non-loopback refused), API key required in practice (`--api-key` defeats cross-origin abuse), the pairing key lives only in the visitor's localStorage and is sent only to the engine, never to BEAN. Pairing = real `/v1/models` probe; identity is measured, not assumed. Inference = OpenAI-compatible streaming with typed failures.
2. **BEAN host (pre-existing, preserved):** the server-side llama.cpp lane (`src/lib/providers/llamacpp.ts`, `BEAN_LLAMACPP_BASE_URL`) with its lane manager, breakers and real completion probes — unchanged.

The website functions fully without any local engine.

### Tier C — Existing BEAN gateway (preserved + capability-aware routing)

- All existing `/api/v1` contracts, provider adapters, key hashing, scopes, rate limits, usage accounting, tenant isolation, streaming and error contracts are untouched.
- **NEW — capability-aware selection policy** (`DeviceCapabilityManager.selectExecutionPath`), applied client-side per request:
  1. Compatible **WebGPU** model on this device,
  2. compatible **CPU/WASM** model on this device,
  3. authenticated, explicitly-configured **local desktop engine**,
  4. existing configured **server-side provider/worker**,
  5. honest **unavailable** state with the reason trail.
  User mode (`auto` / `gpu-preferred` / `cpu-only` / `local-engine` / `server`), device-compute consent and local-only privacy are hard inputs: `local-only` forbids step 4 unconditionally.

### Tier D — Existing background worker system (preserved + adopted)

- The durable SQLite queue (CAS claims, leases, heartbeats, retry classes with 429-never-retried, cancel flags, stale-job recovery) is unchanged.
- NEW handlers: `speech-synthesis`, `audio-transcription`, `audio-conversion` (`src/lib/jobs/audio-worker.ts`) — real execution replacing the honest NO_BACKEND settle.
- NEW adoption: RIISHE "Background" composer action submits `POST /api/ai/jobs`; the worker runs the same turn core server-side and appends the real answer to the conversation. Closing the tab never corrupts or loses an accepted job.

## 2. Capability-aware routing in practice (examples)

| Request | Mode | Device facts | Chosen path |
|---|---|---|---|
| RIISHE chat | auto | WebGPU adapter + budget ≥ 945 MB, model cached | Tier A WebGPU worker (labeled "on-device · private · unsaved") |
| RIISHE chat | auto | No WebGPU adapter | No CPU chat model registered → server lane (reason trail shown) |
| RIISHE chat | cpu-only | WebGPU present | Server lane (GPU skipped by mode) |
| RIISHE chat | local-only | consent granted, no GPU | **null target** — honest unavailable; server forbidden by privacy class |
| GANGZII live voice | auto | WASM+SIMD + workers, whisper cached | Tier A ASR (audio never leaves the browser) |
| GANGZII live voice | auto | whisper not downloaded | Server ASR (real gateway) until user approves the measured 43.6 MB download |
| RIISHE long research turn | any | user clicks "Background" | Tier D durable queue |
| LAXII background removal | auto | consent + ortWeb + modnet installed | Tier A onnxruntime-web (WebGPU EP → WASM, provider reported) |

## 3. Model operations (task §8)

- Server-side registry (`src/lib/registry/backends.ts`) keeps full descriptors (identity as disclosed, revision, limits, license posture, data handling, metering, secrets by name, concurrency/timeouts/retries, enabled + truthful unavailableReason). PUBLIC projection stays `registry/models.ts` (no provider identities).
- Client registry entries now carry: identifier, exact source, license (+URL), pinned revision, required runtime, supported tasks, measured size, memory estimate (labeled policy), integrity model, limitations, enabled gate, and verified install state.
- Status vocabulary (task §8) implemented in `DeviceCapabilityManager` with `AI_CAPABILITY_STATUS_EXPLANATIONS`: `ready / loading / downloading / not-installed / not-configured / unsupported-on-device / unavailable / degraded / failed` — derived from measured facts + real failures, never configuration optimism.
- A model is never reported usable when its files are missing: `getInstallState` requires a verified cache hit (bean-managed) or a loaded engine (runtime-managed).

## 4. Operational error handling (task §9)

`src/lib/client-compute/inference/errors.ts` defines the stable catalog (`AI_*` codes) with, for every code: human message + actionable recovery. `toAiError` maps any thrown value (WebLLM, Transformers.js, ORT, fetch, worker) by message-signature; unknown failures keep a bounded honest diagnostic. Worker protocols surface the same codes. The server's existing BeanApiError contracts are untouched — the catalog covers the DEVICE lanes and the local-engine client.

Covered: missing provider config, invalid model, not downloaded, unsupported capability, timeout, OOM, network interruption, GPU device loss, engine unreachable, invalid response, stream termination, rate limit, provider auth failure, cancellation, queue rejection.

## 5. Deployment configurations (all real, all honest)

| Configuration | What runs | Status in this milestone |
|---|---|---|
| A — Browser-only | Website + user-approved browser model; inference in the visitor's browser | Implemented (RIISHE on-device chat, GANGZII on-device ASR, LAXII on-device bg-removal) |
| B — Browser + local desktop engine | llama.cpp on the visitor's PC, loopback pairing | Implemented (pairing client + settings UI; requires the user to run llama-server) |
| C — Existing gateway | Hosted providers, keys, usage | Preserved (unchanged contracts) |
| D — Backend jobs | Durable queue workers | Preserved + audio handlers + RIISHE background adoption |

Startup/health reporting: `/api/health` (per-product probes + capability rows + queue depth + embedded pools) extended with the GANGZII entry; device-side health is computed on-device by the manager (better privacy: the device never has to upload capability data unless the user opts into the sanitized report).

## 6. What was deliberately NOT built

- No Ollama (policy), no paid-API requirements, no placeholder providers.
- No vector store migration (Qdrant evaluated, not adopted — see REPOSITORY_EVALUATION).
- No LangGraph/orchestration framework (the existing engine covers it).
- No shared/distributed visitor compute (would require a separate opt-in architecture with isolation/verification/abuse controls).
- No new v1 endpoints for the reserved scopes (`images:generate` etc.) — out of scope; the gateway contracts remain exactly as they were.
