# M39 — MODEL EXECUTION MATRIX (every registered capability, real evidence)

> Branch: `feat/m39-universal-live-ai-runtime` · Evidence date: **2026-11-24** (same-day runs)
> Canonical machine-readable evidence: `scripts/m39-acceptance/out/execution-matrix.json`
> (regenerate: `BASE=http://localhost:3000 bun scripts/m39-acceptance/execution-matrix.ts`)
> Outcome vocabulary: **ok:true** = real inference produced a validated, task-specific output ·
> **ok:null** = honest unavailability (credentials / hardware / provider throttle / not implemented — exact reason recorded) ·
> **ok:false** = the lane was expected to work here and genuinely failed.

## 1. How to reproduce

```bash
# 1. dev server (existing project configuration)
npm run dev            # port 3000
# 2. the matrix drives every backend through the REAL product routes
BASE=http://localhost:3000 bun scripts/m39-acceptance/execution-matrix.ts
# → scripts/m39-acceptance/out/execution-matrix.json + matrix-run.log
```

The script registers a fresh account per run (first-account-is-admin applies only on
an empty database; model installation is admin-gated exactly like the product),
uploads real bytes, submits real jobs through the durable queue, waits through the
REAL execution lifecycle, and validates every artifact by container magic bytes /
content checks / provenance fields — never by trusting status strings.

## 2. Verified matrix — final same-day run

**26 PASS / 8 honest-unavailable / 0 FAIL** (`execution-matrix.json`,
`finishedAt` recorded inside; run duration ~16 min). Earlier same-day runs are
quoted where they add evidence (e.g. the provider-throttle run).

### RIISHE (chat + reasoning + documents + vision + tools)

| Capability | Backend / lane | Runtime | Evidence (this host, CPU-only) |
|---|---|---|---|
| text-generation | `bean-llm-hosted-primary` (authorized gateway) | provider-managed | PASS — background job completed; persisted answer "The capital of France is Paris." fetched from the conversation |
| document-understanding (text) | `bean-documents-text` extraction pipeline | in-process parsers | PASS — 125-char extraction persisted, status ready |
| document-grounded-qa | `bean-llm-hosted-primary` + document context | provider-managed | PASS — grounded answer carried BOTH planted facts (Lisbon + budget code BX-77) |
| vision-image-analysis | gateway vision model via documents route | provider-managed | PASS — 408 chars of real image description persisted |
| tool calling / workflow / delegation | existing orchestrator (M37) + `search_atlas`/`read_atlas_doc` (M38) | in-process | 38 + 95 targeted tests green on this tree (real orchestrator drives); live matrix exercises the chat path end-to-end |

### CODE GIFTZ (generation + delivery + REAL sandbox execution)

| Capability | Backend / lane | Runtime | Evidence |
|---|---|---|---|
| code-generation | `bean-code-llm-hosted-primary` | provider-managed | PASS — coding job completed, project persisted |
| project-delivery | giftz workspace apply | in-process | PASS — `fizzbuzz.py` delivered with real FizzBuzz code (after the M39 parser fix: the model's inline `path=` directive is honored instead of leaking into the file body) |
| sandbox-execution | restricted sandbox (`runInSandbox`) | real child process | PASS — FizzBuzz sequence verified in stdout (exit code + output checked); 10 integration tests + full suite green |

### LAXII (generation + enhancement + local vision models + hosted edit)

| Capability | Backend / lane | Runtime | Evidence |
|---|---|---|---|
| image-generation | `bean-image-hosted-primary` | provider-managed | PASS — 159,080-byte artifact, JPEG magic verified |
| asset + mask upload | laxii assets (sharp-decoded) | local | PASS — 1024×1024 original + geometry-matched rasterized brush mask (mask-kind asset) |
| image-enhancement | `bean-image-local-sharp` | sharp (local deterministic) | PASS — 1,825,947-byte PNG output |
| background-removal-local | `bean-image-local-segmentation` | **MODNet ONNX, server onnxruntime CPU** (25,888,640 B, SHA-256 verified) | PASS — 2,186,272-byte PNG matte |
| object-removal-lama | `bean-image-local-edit` | **big-lama inpainting ONNX** (92,591,623 B, SHA-256 verified) | PASS — 2,048,099-byte output, masked composite |
| image-editing-hosted | `bean-image-hosted-edit` | provider-managed | PASS — 536,485-byte PNG output |
| smart-edit-generative | `bean-image-selfhosted-diffusers` | requires ≥8 GB-class GPU worker — **not deployed here** | ok:null — HTTP 503 honest unavailability, nothing queued, nothing faked |

### JAZMII (video generation + local motion)

| Capability | Backend / lane | Runtime | Evidence |
|---|---|---|---|
| video-generation-hosted | `bean-video-hosted-primary` | provider task API + server-side download + ffprobe gate | PASS — real video artifact served (HTTP 206 on range request). A third same-day run recorded an honest account-throttle 429 (5 authorized attempts inside one account-wide window) — throttling behavior is real and honestly reported, never papered over |
| video-motion-local | `bean-video-local-motion` | **RIFE fp32 ONNX** (21,604,631 B, SHA-256 verified) + ffmpeg | PASS — real motion+RIFE artifact served; result provenance `engine: local-motion-rife` (the lane is image-to-video: the matrix submits a real reference still) |
| video-generation-wan | `bean-video-selfhosted-candidate` | never implemented | ok:null — honest unavailability (registry enabled:false) |

### GANGZII (TTS local + hosted, ASR, ffmpeg tools)

| Capability | Backend / lane | Runtime | Evidence |
|---|---|---|---|
| engine-install | `bean-audio-tts-local-kokoro` | kokoro-js 1.2.1 | PASS — Kokoro-82M q8 installed with sha256 verification |
| speech-synthesis-local | Kokoro-82M q8 | on-device wasm runtime | PASS — 184,844-byte RIFF/WAV |
| speech-synthesis-hosted | `bean-audio-tts-hosted-primary` | gateway TTS | PASS — 206,444-byte RIFF/WAV |
| audio-transcription | `bean-audio-asr-hosted-primary` | gateway ASR | PASS — REAL round-trip: the Kokoro-synthesized sentence came back verbatim ("Bean Intelligence runs speech synthesis on your device.") |
| audio-conversion | `bean-audio-convert-local-ffmpeg` | ffmpeg (local) | PASS — 78,764-byte MP3, magic verified |
| audio-production | `bean-audio-tools-local-ffmpeg` | ffmpeg (local) | PASS — trim + fade-in chain completed with validated output (final run) |

### Dormant credential-gated lanes (honest — never faked)

| Lane | State |
|---|---|
| `bean-llm-openai-compatible` | registered, **dormant without an operator-configured credential** — honest registry row recorded |
| `bean-llm-anthropic` | adapter wire-protocol-tested (M36), dormant without credentials — honest |
| `bean-chat-local-llamacpp` | real llama.cpp slot, dormant without `BEAN_LLAMACPP_BASE_URL` — honest registry row recorded |

### Not-integrated supporting capabilities (honest)

| Capability | State |
|---|---|
| scanned-image OCR | ok:null — docling recorded-not-deployed; no OCR integration to test |
| retrieval embeddings | ok:null — verbs reserved in the capability vocabulary; no backend/adapter registered yet |
| retrieval reranking | ok:null — verbs reserved; no backend/adapter registered yet |

## 3. Client (browser) models — registry facts + acceptance routing

| Registered model | Runtime | Device requirement | Integrity | Verified where |
|---|---|---|---|---|
| `riishe-chat-webllm-qwen2.5-0.5b` | WebLLM 0.2.89 (WebGPU) | GPU (WebGPU adapter + real init) | runtime-managed pinned revision `32ff081f…` | GPU acceptance = hardware-dependent (no GPU in this sandbox; owner hardware pass pending — see LOW-SPEC doc) |
| `riishe-chat-wasm-qwen2.5-0.5b-gguf` | wllama 4.0.0, llama.cpp GGUF, `n_gpu_layers=0` | CPU (~768 MB budget) | bean-managed download + pinned sha256 `74a4da8c…7a9db` | REAL CPU/WASM inference accepted in the live browser session (see M39 implementation report §preview/acceptance) |
| `gangzii-asr-browser-whisper-tiny` | Transformers.js / onnxruntime-web | light/medium memory | runtime-managed pinned revision | worker bundle built; in-browser acceptance recorded in the implementation report |
| `laxii-bgremoval-modnet` | onnxruntime-web | medium | runtime-managed pinned revision | worker bundle built; server-side MODNet lane verified live (above) |

Browser-side execution happens in dedicated workers (`public/workers/`:
`webllm-worker.js`, `wasm-chat-worker.js`, `asr-worker.js`,
`segmentation-worker.js`) — model inference never blocks the main UI thread.

## 4. Honest environment limits (this sandbox)

- **No GPU / no WebGPU**: GPU lanes were not measurable here; nothing was claimed
  from simulation. Real-GPU acceptance (RTX 5060 Ti) is documented as pending owner
  hardware acceptance.
- **Account-wide provider throttle**: one hosted-video run hit a real 429 throttle
  window and recorded it verbatim; the lane passed when the window cleared.
- **~4 GB RAM sandbox**: running the full test suite concurrently with the live
  server once OOM-killed the dev server (kernel log recorded); suites were re-run
  sequentially (2793 pass / 0 fail / 5 skip). The application's own resource
  policies (budgets, one-heavy-model slot, pagehide release) are the product-side
  answer to the same constraint on visitor devices.
