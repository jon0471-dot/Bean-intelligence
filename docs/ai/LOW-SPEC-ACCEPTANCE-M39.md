# M39 — LOW-SPEC ACCEPTANCE (honest scope, simulated evidence vs real hardware)

> Branch: `feat/m39-universal-live-ai-runtime` · Date: 2026-11-24
> Companion docs: `docs/M39-IMPLEMENTATION-REPORT.md`, `docs/ai/DEVICE-COMPUTE-ARCHITECTURE-M39.md`, `docs/ai/MODEL-EXECUTION-MATRIX-M39.md`.
> Rule honored throughout: **a device simulation or a unit test is never counted as proof of real GPU inference.** Hardware-dependent evidence is explicitly separated below.

## 1. What "low-spec" means in BEAN (measured, not guessed)

Device tiers 0–4 are derived from measured browser facts only
(`src/lib/client-compute/device-profile.ts`: hardwareConcurrency, deviceMemory when
exposed, WebGPU adapter probe, storage estimate, a bounded opt-in CPU benchmark).
`conservative` mode (mobile / low memory / battery-aware) can lower budgets but can
never be inflated by claims. The policy layer that consumes the tier:

| Policy knob | Normal | Conservative |
|---|---|---|
| Device-task concurrency cap | 2 | 1 |
| Memory budget light / medium / heavy (MB) | 64 / 256 / 1024 | 32 / 96 / 384 |
| Heavy models active at once | 1 | 1 |
| Chat context in the CPU/WASM lane | adapted to the budget | adapted (smaller) |

## 2. Simulated low-spec evidence (unit/integration — reproducible anywhere)

These run in CI-like conditions with fake workers/profiles; they prove the POLICY
and the FALLBACK CONTRACTS, not real-GPU execution:

- `tests/unit/quality-routing.test.ts` + `tests/unit/quality-route-integration.test.ts`
  (19 tests): a weak local model never silently replaces a stronger authorized route;
  `prefer-backend` reorders the plan with verified local lanes kept as honest fallback
  after a REAL backend failure; `local-with-limitation` carries the stated limitation;
  `local-only` mode excludes backends; `no-route` carries the honest policy text.
- `tests/unit/wasm-chat-lane.test.ts` (16 tests): the CPU lane mirrors the webllm
  protocol, reports `n_gpu_layers=0` so CPU claims are literally true, adapts context
  to the policy memory budget, clamps max_tokens honestly, supports abort-signal
  cancellation, releases heap on exit, and the registry refuses artifacts whose
  SHA-256 does not match the pin.
- `tests/unit/device-selection.test.ts` + `tests/unit/client-compute-scheduler.test.ts`:
  cpu-only mode genuinely skips the GPU chat lane; GPU-class load failures
  (device-lost / webgpu-unavailable / OOM) auto-fallback to CPU with recorded
  degradation; memory-feasibility gate refuses workloads above the tier budget with
  an honest message; tasks are not started while the tab is hidden.
- `tests/unit/client-compute-device-profile.test.ts` + `tests/unit/client-compute-cpu-engine.test.ts`:
  tier derivation from measured facts; CPU lane cancellation/crash honesty.
- Total in the M39-verified suite: **112 client-compute routing/device/lane tests
  green** (51 + 61 across the eleven files listed above), part of the full suite
  result recorded in the implementation report.

## 3. Real execution on THIS host (no GPU, ~4 GB RAM, CPU-only)

The execution matrix (`scripts/m39-acceptance/execution-matrix.ts`) ran the
server-local lanes as REAL inference on this CPU-only host — this is genuine
low-spec-path evidence for the server side of the product (exact artifacts,
sizes and latencies in `docs/ai/MODEL-EXECUTION-MATRIX-M39.md`):

- MODNet matting, big-lama inpainting, RIFE frame interpolation: real ONNX CPU
  inference with SHA-256-pinned artifacts (installed through the product's own
  explicit install route, bytes verified).
- sharp enhancement, ffmpeg conversion/production, Kokoro TTS, hosted lanes: real
  outputs validated by container magic bytes / ffprobe / content checks.
- Honest unavailability recorded where a lane cannot run here (GPU Diffusers worker
  not deployed → HTTP 503; WebGPU not measurable on this host; credential-gated
  slots dormant without credentials).

## 4. Real low-spec browser hardware — NOT AVAILABLE in this environment (honest)

- This sandbox provides no GPU and cannot represent a real low-spec laptop. Browser
  acceptance performed here (agent-browser against the real app) exercises the REAL
  decision paths and the REAL CPU/WASM lane on a desktop-class CPU; it is NOT a
  substitute for a physical low-spec device pass.
- **The owner's Windows hardware (Ryzen 7, RTX 5060 Ti 16 GB, 32 GB RAM) is not
  reachable from this environment.** The real-GPU acceptance pass (WebGPU chat lane,
  real GPU-failure → CPU fallback on hardware, WebGPU matting/ASR backends) must be
  executed there; `docs/ai/MODEL-EXECUTION-MATRIX-M39.md` §How-to-reproduce lists
  the exact commands. Until that pass, GPU-lane availability on real hardware is
  reported as **hardware-dependent — pending owner hardware acceptance**, never as
  verified-live.
- What IS verified live about the GPU path on THIS host: the capability checks run,
  report honestly, and the automatic policy routes around them (chat went to the
  authorized server lane; no fake GPU success anywhere).

## 5. Battery/thermal/CPU protection statement

BEAN never runs compute the visitor did not request: no background mining, no
compute-sharing, no cross-user execution. Device inference happens only inside an
active user task, with the concurrency cap, time budget, cancellation
(abort-signal, interrupt verb), pagehide release and worker exit() cleanup described
in `docs/ai/DEVICE-COMPUTE-ARCHITECTURE-M39.md` §4. Heavy work is never started
while the tab is hidden.
