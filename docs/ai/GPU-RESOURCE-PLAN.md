# BEAN — GPU Resource Plan

> Phase 5 deliverable. Detection is measured, never assumed (`src/lib/ai-engine/gpu.ts`). Last measured: 2026-11-07.

## 1. Current hosts

| Host | GPU | CPU | RAM | Disk | Verdict |
|---|---|---|---|---|---|
| Deployment sandbox (runs BEAN today) | **none** (`nvidia-smi` absent — measured) | 2 cores | 3 GB total (~1–2 GB available) | ~6.7 GB free | All GPU-local models honestly `unavailable`. Hosted providers carry all generative work. The llama.cpp CPU lane (small GGUF) is the only realistic local model path here. |
| Operator PC (target) | **RTX 5060 Ti 16 GB** | Ryzen 7 | 32 GB | 1 TB | Feasible for: quantized chat (llama.cpp CUDA offload), SD1.5/SDXL-class image work (existing Diffusers worker), **Wan 2.2 TI2V-5B fp16 (≈11 GB peak — fits with headroom)**. Not feasible: Wan A14B fp16, GLM-class frontier chat locally. |

## 2. Detection & scheduling

- `detectHardware()` probes `nvidia-smi --query-gpu=name,memory.total,memory.free`, CPU count, RAM, free disk; cached 60s.
- `checkHardwareFit(requirement)` compares a model's declared VRAM/RAM/disk need against **measured** values minus active reservations.
- `reserveVram(jobId, modelId, mb)` / `releaseVram(jobId)` bound concurrent GPU work so simultaneous jobs cannot exhaust the card (stale reservations reaped after 30 min).
- GPU-heavy pools run `concurrency: 1` by default; the LAXII Diffusers worker keeps exactly ONE pipeline resident.

## 3. Model load/unload lifecycle

- **Load on demand**: the Diffusers worker loads a pipeline only when a request needs it (`txt2img` / `inpaint` / `upscale` …), reporting CUDA, free VRAM and fp16/bf16 support in `preflight`.
- **Unload after configurable idle (added 2026-11-07)**: a daemon reaper releases the resident pipeline after `LAXII_WORKER_IDLE_UNLOAD_MS` (default 600 000 ms; floor 30 000 ms) without work. A busy-lock makes it race-free — the main loop holds the lock for the whole request, so a model is **never** unloaded mid-generation; the reaper skips if the lock is not immediately available and emits an `idle_unload` notice event.
- **CPU fallback only where practical**: the worker enables `enable_model_cpu_offload()` without CUDA (slow but real); llama.cpp runs CPU inference natively. Video generation has NO practical CPU path — Wan 2.2 stays GPU-gated.

## 4. Model-by-model fit on the operator PC (RTX 5060 Ti 16 GB)

| Model | Need (measured/official) | Fits 16 GB? | Path |
|---|---|---|---|
| LLM 7B–8B Q4_K_M GGUF (Qwen3 / Dolphin / Qwen2.5-Coder) | 4.5–6 GB VRAM (or CPU-only) | **yes** | llama.cpp lane — implemented, dormant |
| SD 1.5-inpaint (existing worker) | ~4–6 GB | **yes** | existing worker + preflight + acceptance run |
| SDXL-base inpaint (existing worker) | ~8–10 GB | **yes** (one pipeline resident) | same |
| Real-ESRGAN x4plus | ~2–4 GB | **yes** | same |
| **Wan 2.2 TI2V-5B** (720P@24fps) | fp16 ≈ **11 GB** peak (official: single consumer GPU "such as the 4090"); INT8 ≈ 5.4 GB; INT4 GGUF ≈ 2.7 GB | **yes** (fp16 with headroom; quantized comfortably) | worker NOT implemented — must be built + acceptance-tested before enablement |
| Wan 2.2 T2V-A14B / I2V-A14B | MoE 14B×2; ≫16 GB at fp16 | **no** | excluded on this PC (explicit brief rule honored) |
| HunyuanVideo-class | ≥24 GB class | **no** | excluded |
| GLM-5.3-class frontier chat | provider-hosted | n/a | stays on the hosted gateway |

## 5. Honest unavailability contract

A local model is **routable only when**: (a) its hardware requirement passes the measured fit check, (b) the worker's own preflight passes (licenses accepted, checksums verified, CUDA present), and (c) a REAL inference acceptance test has completed. A worker that merely starts proves nothing. Today this yields: every GPU model `unavailable` on the sandbox host; the operator PC becomes viable only after the acceptance runs recorded in `REAL-MODEL-ACCEPTANCE.md`.

## 6. Queuing behavior

GPU-heavy jobs queue in the durable engine (RETRY_WAIT/backoff for transient infra errors only). While the GPU is saturated, jobs stay QUEUED (visible, cancellable); they are never silently dropped or falsely accelerated.
