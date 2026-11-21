# GANGZII TTS Engine Evaluation (M27)

**Date:** 2026-11-21 · **Milestone:** M27 · **Product:** GANGZII · **Decision:** Kokoro-82M v1.0 is the first production local TTS engine.

## Candidates evaluated

### Candidate 1 — Kokoro-82M v1.0 (hexgrad/Kokoro-82M) — SELECTED

| Aspect | Finding |
|---|---|
| Weights license | **Apache-2.0** (model card, verified 2026-11-21 via HF model metadata + community sources) |
| Code license | **Apache-2.0** (`kokoro-js` npm package, v1.2.1 — verified from the package) |
| Dependency license note | `phonemizer` bundles espeak-ng WASM (**GPL-3.0**) — unmodified server-side dependency; imposes no obligation on BEAN-generated audio; recorded in the backend descriptor |
| Runtime | Node.js via `kokoro-js` + `@huggingface/transformers` (onnxruntime-node, **CPU**) — no GPU, no Python |
| Model size | q8 quantization: **92.4 MB** (resilient to quantization per model card) |
| Voices | 54 bundled voice packs (28 English with published quality grades; 26 non-English without published grades — listed as UNTESTED, never claimed) |
| Measured here | Load **824–885 ms**; generation **10.7 s for 8.2 s audio (RTF 1.30)** on 2 vCPU / 3.9 GB RAM, RSS ≈ **642 MB**; output 24 kHz mono PCM16, ffprobe-validated |

Measured evidence: `scripts/m27-kokoro-smoke.ts` and `tests/integration/gangzii-audio-worker.e2e.test.ts` (real speech, real ffprobe facts).

### Candidate 2 — Qwen3-TTS (0.6B / 1.7B) — NOT SELECTED for first launch

| Aspect | Finding |
|---|---|
| Weights license | Apache-2.0 per public model sources (12Hz family) — commercially usable in principle |
| Runtime needs | GPU-class practical inference (1.7B ≈ multi-GB VRAM; CPU batch inference impractically slow for production narration) |
| Fit | Strong future candidate for expressive/voice-design expansion on the owner's GPU host — **Planned**, not blocked |
| Voice cloning | Base variant supports reference cloning — **out of scope** for M27 (requires its own consent + rights design) |

## Selection rule applied (measured, not popularity)

Kokoro wins on: CPU inference (₹0 budget, no GPU dependency), 92 MB on-demand install, Apache-2.0 weights, verified end-to-end HERE. Qwen3-TTS is recorded as the future expansion path when GPU hardware is actually attached.

## Model lifecycle (implemented)

- Install is an **explicit user action** (size shown first: ~92 MB), never automatic.
- Download sources: ModelScope mirror (measured 29 MB/s; the canonical HF source was HTTP-429 rate-limiting this sandbox egress IP during install) then HuggingFace — both recorded in the install manifest.
- sha256 verification whenever a source publishes it; checksum mismatch refuses the install.
- Model lives OUTSIDE the repo (`storage/models/hf/…`), pinned revision recorded in `bean-install-manifest.json`.
- Removal refused while active jobs use the engine; in-process unload supported.

## Install manifest provenance note (honest)

The sandbox install downloaded from the ModelScope mirror of the same repo id because HuggingFace rate-limited this egress IP (40+ retries over ~15 min, all HTTP 429). Locally computed sha256 values are recorded in the manifest; cross-verification against HF's published LFS OIDs is pending and re-running the (idempotent) install on an unthrottled host will verify against the canonical source. Functional verification is independent of source: the engine loaded and produced real, ffprobe-validated speech.
