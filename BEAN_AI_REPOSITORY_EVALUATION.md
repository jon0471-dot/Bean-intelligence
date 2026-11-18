# BEAN AI REPOSITORY EVALUATION

Milestone: Universal AI Operationalization & User Device Acceleration · Evaluated 2026-11-18 against the actual Phase-2 inventory (`BEAN_AI_OPERATIONALIZATION_MATRIX.md`). Versions/availability verified on 2026-11-18 (npm registry, GitHub, Hugging Face API). Every "Decision" cites the reason grounded in THIS repository's real modules.

Legend: Maintenance is the observed release/commit cadence on 2026-11-18; "model weights license" is recorded separately from code license wherever weights exist.

---

## 1. `mlc-ai/web-llm` — ADOPTED (Tier A browser LLM)

| Field | Value |
|---|---|
| URL | https://github.com/mlc-ai/web-llm |
| Version adopted | **0.2.89** (npm `@mlc-ai/web-llm`, pinned exact; dist-tag latest) |
| Maintenance | Active (docs at 0.2.8x, frequent releases; MLC project ecosystem) |
| Code license | Apache-2.0 (verified via npm) |
| Model weights license | Per prebuilt model — adopted model `Qwen2.5-0.5B-Instruct` is **Apache-2.0** (verified on HF: `license:apache-2.0`) |
| Commercial-use restrictions | None for Apache-2.0 code/weights; redistribution of weights is not required (runtime fetches to the visitor's browser cache) |
| Runtime dependencies | WebGPU (browser), Web Workers; weights from `huggingface.co` / `raw.githubusercontent.com` |
| Supported OS | Any OS with a WebGPU-capable browser (Windows/macOS/Linux desktop browsers; Android Chrome partially — honest per-device gating) |
| GPU/CPU compatibility | WebGPU GPU inference; q4f16 models require fp16 shader support. No WASM fallback for this quantization — the CPU path is the honest "not supported on device" state |
| Model download size | 289,693,824 B for the adopted 0.5B q4f16 build (measured from the pinned repo tree) |
| Security implications | Runs entirely client-side; weights cached by the runtime; pinned revision prevents silent weight substitution; no prompt data leaves the device in this lane |
| Decision | **ADOPTED** as the Tier A chat engine, wrapped behind BEAN's common inference interface (worker + client seam), one engine per tab |

## 2. `huggingface/transformers.js` — ADOPTED (Tier A NLP/ASR)

| Field | Value |
|---|---|
| URL | https://github.com/huggingface/transformers.js |
| Version adopted | **4.3.2** (npm `@huggingface/transformers`, pinned exact) |
| Maintenance | Very active (v3 introduced WebGPU; v4 line current in 2026) |
| Code license | Apache-2.0 (verified via npm) |
| Model weights license | Per model — adopted `Xenova/whisper-tiny` repo is tagged **Apache-2.0** (upstream OpenAI Whisper is MIT; the ONNX build tags Apache-2.0 — recorded verbatim, both noted) |
| Commercial-use restrictions | None for the adopted set (Apache-2.0/MIT family) |
| Runtime dependencies | onnxruntime-web (bundled), WASM; optional WebGPU; weights fetched from `huggingface.co` at the pinned revision |
| Supported OS | Any OS with WASM+Workers browsers (universal); WebGPU acceleration where available |
| GPU/CPU compatibility | WebGPU attempted with automatic, honest WASM fallback (the chosen provider is reported) |
| Model download size | 43,622,127 B (whisper-tiny q8 set: encoder q8 + decoder-merged q8 + tokenizer + configs — measured from the pinned tree) |
| Security implications | Client-side only in BEAN's usage; revision pinning; no audio leaves the device in the local lane |
| Decision | **ADOPTED** for browser ASR (GANGZII live voice) as the speech pipeline. **Embeddings NOT adopted this milestone** — the retrieval stack is a deliberate policy/web-search design with no consumer that measurably benefits from client embeddings; recorded as an integration-ready candidate (MiniLM-class, ~22 MB q8) rather than shipping an enabled model without a real consumer |

## 3. `ggml-org/llama.cpp` — ADOPTED (Tier B, optional local desktop)

| Field | Value |
|---|---|
| URL | https://github.com/ggml-org/llama.cpp |
| Version adopted | Operator-provisioned `llama-server` (BEAN client is version-agnostic OpenAI-compatible; existing server-side lane unchanged) |
| Maintenance | Extremely active (multiple releases/week historically; 2026 CORS work: `--cors-origins` options via PR #25655) |
| Code license | MIT |
| Model weights license | Per GGUF loaded (operator's responsibility — e.g. Qwen3 Apache-2.0); BEAN never downloads weights without the operator's explicit license acceptance (existing policy, preserved) |
| Commercial-use restrictions | MIT code: none; weights per model card |
| Runtime dependencies | Self-contained server binary; optional CUDA/Vulkan backends |
| Supported OS | Windows, Linux, macOS (official builds) |
| GPU/CPU compatibility | NVIDIA GPU offload, Vulkan/CPU fallbacks, hybrid splitting — operator-selected |
| Model download size | Per GGUF (Qwen3-1.7B Q4_K_M ≈ 1.0–1.4 GB class; verify at adoption) |
| Security implications | MUST run loopback-only with `--api-key` (default `--cors-origins *` is permissive — measured community reports; BEAN's pairing contract requires `--api-key` and documents `--host 127.0.0.1`); BEAN refuses non-loopback pairing hosts |
| Decision | **ADOPTED** for Tier B: browser pairing client + settings UI (NEW) + preserved server-side lane. No Ollama (explicit project policy) |

## 4. `ggml-org/whisper.cpp` — EVALUATED, NOT ADOPTED (native path)

| Field | Value |
|---|---|
| URL | https://github.com/ggml-org/whisper.cpp |
| Maintenance | Active |
| Code license | MIT |
| Model weights license | Whisper GGUF conversions follow the upstream MIT Whisper models |
| Runtime dependencies | Native binary / WASM example (server mode optional) |
| Supported OS | Windows/Linux/macOS native; WASM example exists |
| GPU/CPU | Core ML / Vulkan / CUDA offloads; CPU baseline |
| Download size | tiny/base GGML models are sub-100 MB; larger tiers grow accordingly |
| Security implications | Same loopback/api-key discipline as llama.cpp if served |
| Decision | **NOT ADOPTED this milestone** — browser ASR is covered by Transformers.js (no new native install for the common case) and server ASR by the authorized gateway (measured evidence on record). whisper.cpp remains the documented upgrade path if an operator wants native-device ASR without a browser runtime; the WASM example would duplicate the Transformers.js lane for the same task |

## 5. `docling-project/docling` — EVALUATED, ADAPTER-READY, NOT SHIPPED BY DEFAULT

| Field | Value |
|---|---|
| URL | https://github.com/docling-project/docling |
| Maintenance | Active (regular releases; IBM-backed) |
| Code license | MIT |
| Model weights license | Bundled OCR/layout model dependencies carry their own licenses (e.g. EasyOCR/segments-1 PDL) — must be reviewed at adoption time per model |
| Runtime dependencies | Python ≥3.10, torch (CPU wheels exist), heavy install (~GB class) |
| Supported OS | Windows/Linux/macOS (Python) |
| GPU/CPU | CPU works; GPU accelerates OCR/layout |
| Download size | Multi-GB install (torch + models); not a browser/runtime dependency |
| Security implications | Server-side process parsing untrusted documents — needs sandbox/timeout discipline like any parser |
| Decision | **NOT INTEGRATED this milestone** — RIISHE document ingestion already extracts text/structure server-side and CODE GIFTZ has its own toolchain; Docling's Python/torch footprint cannot be honestly "available" in this deployment without a real acceptance run. Recorded as the recommended upgrade for PDF table/structure/OCR quality via the EXISTING ingestion worker (no duplicate job system): operator installs `docling` (or points `BEAN_DOCLING_*` at a service), the ingestion path adopts it behind the same Document pipeline. Not wired now to avoid shipping an unavailable dependency behind an enabled flag |

## 6. `AI4Bharat/IndicTrans2` — EVALUATED, NOT ADOPTED

| Field | Value |
|---|---|
| URL | https://github.com/AI4Bharat/IndicTrans2 |
| Maintenance | Research-grade release (checkpoint releases; tooling less active than inference frameworks) |
| Code license | MIT (per AI4Bharat announcement) |
| Model weights license | MIT — released for research AND commercial use (per AI4Bharat) |
| Runtime dependencies | Python, torch/fairseq-class stack + IndicTokenizer; server-side only |
| Supported OS | Linux-class deployment |
| GPU/CPU | CPU possible, GPU recommended |
| Download size | dist-200M (sub-GB class) to 1B+ (multi-GB class) per direction — verify at adoption |
| Security implications | None beyond large-weight serving |
| Decision | **NOT ADOPTED** — no in-repo product currently requires Indic↔English translation as a feature; adding a multi-GB Python inference stack without a consumer violates the milestone's "no dead integrations" honesty. Re-evaluate if RIISHE multilingual answering needs dedicated translation (today it answers multilingually via the hosted model) |

## 7. `google-ai-edge/LiteRT` (LiteRT.js) — EVALUATED, NOT ADOPTED

| Field | Value |
|---|---|
| URL | https://github.com/google-ai-edge/LiteRT |
| Maintenance | Active (Google edge stack) |
| Code license | Apache-2.0 |
| Model weights license | Per .tflite model |
| Runtime dependencies | LiteRT.js (WebGPU/WASM delegates), .tflite compiled models |
| Supported OS | Browser (desktop/mobile) |
| GPU/CPU | WebGPU delegate + WASM CPU |
| Download size | Per compiled model (typically smaller than ONNX peers) |
| Security implications | Client-side, same cache/consent discipline as the other runtimes |
| Decision | **NOT ADOPTED** — the selected runtimes (WebLLM + Transformers.js + ORT) already cover every REAL requirement found in the inventory with one overlapping-runtime exception policy satisfied. Introducing a third model format without a measurable fit (compiled-model op coverage for a concrete BEAN task) violates the task's "avoid overlapping runtimes without a measured reason". Re-evaluate if a specialized .tflite-only model becomes necessary |

## 8. `qdrant/qdrant` — EVALUATED, NOT ADOPTED

| Field | Value |
|---|---|
| URL | https://github.com/qdrant/qdrant |
| Maintenance | Very active |
| Code license | Apache-2.0 |
| Model weights license | n/a (engine) |
| Runtime dependencies | Standalone service (Rust); client SDKs |
| Supported OS | Linux/macOS/Windows (Docker common) |
| GPU/CPU | CPU service (GPU optional indexing accelerators) |
| Download size | Service binary/image, tens-of-MB class |
| Security implications | New network service → auth, tenant isolation and migration work required |
| Decision | **NOT ADOPTED** — BEAN retrieval genuinely lacks NOTHING required for current scope: the existing stack (policy-driven web research + conversation digest + memory + documents) has no vector-embedding consumer; introducing Qdrant without embeddings would be infrastructure without a purpose. Trigger for future adoption: a real embeddings consumer (semantic document search at scale) with a migration plan and measured benefit — documented in UNIVERSAL_AI_ARCHITECTURE §6 |

## 9. Agent orchestration frameworks (LangGraph et al.) — NOT ADOPTED (per task instruction)

BEAN already implements persistent jobs (durable queue with leases/recovery/cancel), tool workflows (RIISHE tool loop with explicit permissions), and approval controls (CODE GIFTZ plan-hash gates, sandbox run gating). Introducing an orchestration framework would duplicate an existing, tested implementation. **Decision: preserve and improve the existing engine** (this milestone added audio handlers and background adoption without any framework dependency).

---

## Adoption summary

| Repository | Decision | Where it lives in BEAN |
|---|---|---|
| web-llm 0.2.89 | ADOPTED | Tier A chat engine (worker) |
| transformers.js 4.3.2 | ADOPTED (ASR) | Tier A speech lane (worker) |
| llama.cpp | ADOPTED (optional, loopback) | Tier B pairing client + preserved server lane |
| whisper.cpp | Not adopted (evaluated) | Documented upgrade path |
| docling | Not adopted (adapter-ready) | Recommended ingestion upgrade via existing worker |
| IndicTrans2 | Not adopted (evaluated) | Re-evaluate on real translation need |
| LiteRT.js | Not adopted (evaluated) | Re-evaluate on a concrete .tflite need |
| qdrant | Not adopted (evaluated) | Re-evaluate with a real embeddings consumer |
| LangGraph-class frameworks | Not adopted | Existing engine preserved/improved |

All adopted packages are pinned exact in `package.json`; model entries with measured sizes/revision pins live in `src/lib/client-compute/model-registry.ts`; license records for server-side backends remain in `src/lib/registry/backends.ts` + `models/licenses/`.
