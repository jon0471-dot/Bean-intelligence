# M38 Model Capability Coverage Report — measured 2026-11-24

> Branch: `feat/m38-world-atlas-adaptive-ai-creative-engine` · Host: deployment sandbox (Linux, CPU-only; **no WebGPU adapter present**)
> Method: every cell below is filled from a real check performed on the recorded date or cites the pinned prior evidence. Unmeasured cells say so. No guessed values.
> The code-level authority for runtime state remains `src/lib/registry/` (nine-state availability) and `src/lib/client-compute/` (device tiers, model gates). This report is the M38 §B2 snapshot.

## 1. Execution evidence collected on this host (2026-11-24)

| Check | Command | Result |
|---|---|---|
| Real CPU model execution (MODNet portrait matting, ONNX) | `bun scripts/m36-acceptance/cpu-inference.ts` | **PASSED** — artifact SHA-256 `92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a` verified (6,632,188 B), execution provider `cpu`, duration **483 ms**, matte range [0, 0.9943], shape preserved, foreground detected |
| Worker bundles from pinned runtimes | `bun run workers:build` | **BUILT** — `webllm-worker.js` 6,168,626 B (5.88 MB), `asr-worker.js` 595,558 B (0.57 MB), `segmentation-worker.js` 416,525 B (0.40 MB); heavy runtimes stay out of the Next graph |
| WebGPU compute | — | **NOT MEASURABLE on this host** — no WebGPU adapter in the sandbox; the real WGSL round-trip benchmark ships and is behavior-tested against structural fakes (`tests/unit/device-gpu-benchmark.test.ts`, wrong values = fail); a real-browser GPU run remains pending operator hardware |
| Browser model download/consent/integrity gates | `bun test --isolate tests/unit/client-compute-model-registry.test.ts` etc. | covered by the client-compute suite (114-test lane; run in the M38 full-suite verification) |
| Protocol-level remote lanes | `bun test --isolate tests/unit/provider-anthropic-protocol.test.ts` | wire-protocol tests pass (headers, SSE decode, breaker classes); a live remote call was **not** made in this sandbox — honest separation of protocol testing from live execution |

## 2. M38 §B2 capability coverage table (actual status)

Legend: **measured** = real execution/check on the recorded date; **tested** = automated test evidence, not a live run; **bundled** = runtime built and pinned, no measured model run; **not integrated** = no working lane exists; **pending hardware** = code complete, requires real GPU.

| Capability | Local CPU | Local GPU (browser) | Authorized remote | Verified state |
|---|---|---|---|---|
| Chat and reasoning | not integrated (browser CPU-only LLM lane does not exist; WebLLM requires WebGPU) | **bundled + benchmark-tested**: webllm-worker 5.88 MB built from `@mlc-ai/web-llm` 0.2.89; WebGPU round-trip benchmark gates tier 4; real in-browser model run pending operator hardware | **operational**: hosted gateway chat lane (live chat verified in M35/M37 acceptance sessions; probe/breaker tests) | remote lane operational; local GPU lane execution-tested for the *compute path*, model-run pending hardware; honestly surfaced to users as on-device chat being device-dependent |
| Coding | llama.cpp local lane exists in the production topology (MIT); not re-measured on this sandbox host — recorded, not claimed | same chat constraints | **operational**: hosted coding lane + CODE GIFTZ pipeline | remote operational; local llama.cpp lane recorded-only in this environment |
| Vision (analysis) | hosted-gateway vision analysis operational | not applicable | operational | operational |
| Vision (segmentation/matting) | **measured**: MODNet ONNX real CPU execution 483 ms, matte validated (this host, today); browser path via `segmentation-worker.js` 0.40 MB (WebGPU EP → WASM fallback) | browser WebGPU EP attempted by onnxruntime-web when present; not measurable here | not needed (local-first privacy lane) | **operational (execution-tested + output-validated)** — the strongest verified lane |
| Image generation | not integrated (weights not local) | not integrated | **operational**: hosted image lane through LAXII queue | remote operational; local honestly unavailable |
| Image editing | sharp-based local editing **operational** (LAXII edit lane) | not applicable | hosted edit lane | operational (local deterministic pipeline) |
| Video | JAZMII local composition (ffmpeg-based, worker dispatch) operational; generative video local **not integrated** (Wan 2.2 worker never implemented — M36 record stands) | not applicable | hosted video lane operational | composition operational; generative local honestly unavailable |
| Audio/transcription | browser WASM lane: asr-worker 0.57 MB (`@huggingface/transformers` 4.3.2, Whisper ONNX, pinned revision) — **bundled, model-gated, consent+integrity enforced**; not measured running in this sandbox (requires browser) | same worker can use WebGPU EP when present | hosted ASR lane operational | remote operational; browser lane bundled+gated, live-run pending browser environment |
| Speech generation | **operational**: kokoro-js 1.2.1 server-side TTS (local CPU, GANGZII narration) | not applicable | hosted TTS slot (dormant without credential) | local CPU operational |
| Document/OCR | text-layer extraction operational (pdf/office pipeline, M37 page markers); **scanned-image OCR honestly unavailable** (docling sidecar recorded, not deployed) | not applicable | hosted document parsing slot | text extraction operational; OCR gap stands |
| Embeddings/reranking | **not integrated** — no backend exists in the registry for these verbs (`UniversalCapability` reserves the ids; no adapter) | not applicable | not integrated | honestly unavailable |
| 3D/pose/motion | **not integrated** | not applicable | not integrated | honestly unavailable |

## 3. Execution-lifecycle snapshot (M38 §B2 ladder)

The `executionLifecycle` ladder (added in `src/lib/registry/capability-records.ts`) turns this
report's discipline into code. Representative derivations:

| Lane | Stage reached | Blocked by |
|---|---|---|
| MODNet segmentation (LAXII, client) | `output-validated` → `operational` when counted as serving (it is: wired end-to-end through the scheduler) | — (real run + matte validation + serving lane) |
| Hosted chat gateway | `operational` | — (serving; live sessions) |
| Browser WebGPU chat (WebLLM) | `execution-tested` for the compute path / `runtime-installed` for the model run | `hardware-compatible` on this host (no adapter); real-browser model run pending |
| Browser ASR (Whisper lane) | `runtime-installed` | measured browser run (download+consent enforced at runtime) |
| Hosted Anthropic Messages slot | `compatible` | `credential-configured` (dormant by design) |
| Local Diffusers SD (M36 worker) | `compatible` | `runtime-installed` on a GPU host |
| Embeddings / 3D / pose | `discovered` (verb reserved) | `registered` — no backend exists |

**Rule enforced by tests** (`tests/unit/execution-lifecycle.test.ts`): a stage can never be
reported beyond the first open gate; `execution-tested` without `integrity-verified` is
impossible; only `execution-tested`/`output-validated`/`operational` may be represented as
operational anywhere.

## 4. Runtime selection architecture (M38 §B3) — what exists, what was added

- Existing scheduler target order: `client-gpu → client-cpu → local-worker → backend` with consent,
  visibility, concurrency, model-gate, memory-gate and runtime-probe checks on every candidate —
  unchanged and re-tested.
- Existing chat lane selection policy: webgpu → cpu → local-engine → server (resilient, honest
  refusals) — unchanged.
- The `local-worker` bridge remains an **honest refusal** ("not configured on this device") — no
  fake bridge was added.
- M38 evaluation outcome: **no new runtime dependency**. WebLLM 0.2.89 / Transformers.js 4.3.2 /
  onnxruntime-web 1.31.1 remain the pinned integrated runtimes; llama.cpp stays the local-server
  lane; **wllama 4.0.0 (MIT) evaluated as a candidate** (WASM SIMD + WebGPU + CPU fallback) and
  deliberately **not integrated** — a fourth runtime would duplicate existing lanes without a
  measured gap (see `UPSTREAM-RESEARCH-M38.md`).

## 5. Device capability & low-spec behavior (M38 §B4) — measured architecture facts

- Device tiers 0–4 derive from real probes (WASM/SIMD validation modules, Worker, WebGL max
  texture size, WebGPU adapter + feature/limit enumeration, `hardwareConcurrency`,
  coarse `deviceMemory`, storage estimate) — tier 4 requires the real GPU round-trip; tiers can
  never be inflated by a failed benchmark.
- Conservative mode (mobile hint, insecure context, fallback adapter, ≤2 GB memory) reduces
  budgets — never inflates them.
- Nothing loads at page init: heavy runtimes live in worker bundles, loaded on demand per lane.
- The one-heavy-model slot (chat ↔ ASR) is reserved before load and released on unload/failure.
- Page-shutdown release: GPU device + CPU workers registered as `pagehide` cleanup hooks.
- M38 adds the quality-routing policy layer (§B5): see `src/lib/client-compute/quality-routing.ts`
  — a weak local lane must not silently replace a stronger authorized route for demanding work;
  limitations are stated, never hidden.

## 6. Download & safety gates (M38 §B6) — preserved and pinned by tests

Explicit consent before any fetch; pinned revisions; SHA-256 checksum validation (`CHECKSUM_FAILED`
honest state); trusted-origin + storage-quota checks; `REFUSED_RUNTIME_MANAGED` for models owned by
a runtime's own cache; delete/cleanup; no automatic large downloads at page open; no Ollama; no
visitor hardware used for other visitors' work (each device executes only its owner's tasks).

## 7. What this report does NOT claim

- No WebGPU inference was measured (no adapter on this host) — the GPU column shows exactly that.
- Worker bundle compilation is **not** claimed as model execution; only the MODNet CPU run is a
  measured inference.
- Remote-lane live calls were not made from this sandbox; protocol and gate tests + historical
  live-session evidence carry that column.
- Universal compatibility claims would require the §H performance profiles (low-end CPU-only →
  dedicated GPU); this host covers the CPU-only case plus the gated architecture.
