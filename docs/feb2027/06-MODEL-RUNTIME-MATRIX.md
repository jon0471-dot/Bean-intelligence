# 06 — Model & Runtime Compatibility Matrix (zero-budget transparency)

Authoritative upstream documents (do not duplicate):
`docs/ai/MODEL-REGISTRY.md` (2026-11-07), `docs/ai/LOCAL-MODEL-LANES.md`
(LIVE 2026-11-08), `docs/ai/FREE-AND-PAID-PROVIDER-MATRIX.md` (2026-11-07),
`docs/ai/GPU-RESOURCE-PLAN.md`, `docs/BEAN-CLIENT-COMPUTE-ARCHITECTURE.md`.
This file records the February-launch transparency surface and its measured
gaps. Budget rule: **₹0 recurring** — `costUnit: null` everywhere, no
purchases, no fabricated free tiers, no Ollama, no cookie extraction, no
rate-limit bypass.

## What exists and is verified

| Surface | Location | State |
|---|---|---|
| Private backend registry (10 entries, license + `verifiedAt` per backend, fallback lists explicit) | `src/lib/registry/backends.ts` | ✅ routing authority |
| Public catalogue projection (no upstream identifiers exposed; 4 products) | `src/lib/registry/products.ts`, `models.ts`, `/api/v1/models` | ✅ sanitized |
| Availability semantics (layered: product badge / capability rows / model availability `available|unavailable|awaiting-credentials|disabled`; RIISHE response states) | `registry/status.ts`, `capabilities.ts`, `riishe/states.ts` | ✅ honest |
| Zero-budget guards (per-product request budgets, shared-account budget + user reserve, never guesses money) | `providers/cost-guard.ts`, `providers/account-quota.ts` | ✅ live-verified in prior milestones |
| Fallback honesty (only upstream-class failures, each candidate once, credential-gated, audit-logged `provider.fallback`, mid-stream never restarted) | `providers/routing.ts` | ✅ |
| Local CPU lanes (llama.cpp, Qwen3-1.7B chat @8081, Qwen2.5-Coder-1.5B @8082, RAM-gated spawn, breaker class) | `providers/llamacpp.ts` | ✅ measured on this host (10–15 tok/s chat; honest quality limits documented) |
| Browser compute probes (WebGPU adapter/limits, WebGL, WASM+SIMD, storage, cores; device tiers 0–4 conservative) | `src/lib/client-compute/*` | ✅ probes; GPU operations registry intentionally minimal (`image.chroma-cutout` CPU-default) |
| Client model download gate (SHA-256 pinning required, trusted origin, consent + quota) | `client-compute/model-registry.ts` | ✅ fail-closed (`enabled:false` until an operator pins integrity) |

## Gaps for February (Phase 2/4 work)

1. **No model-selection UI** — by design users pick products, never models
   (`ARCHITECTURE.md`). The brief requires "real model selection using the
   existing model/provider registry": Phase 2 must expose a sanitized
   runtime/provider identity + availability panel per product (what served
   this answer, which runtime, verified status) without leaking the private
   registry.
2. **Device-fit recommendations** — probes exist; the recommendation UI
   ("which local model fits this device") does not. Must present requirements
   (RAM/quantization/platform) from measured data, never guesses, and must
   not assume WebGPU or GPUs.
3. **Browser lanes** — only LAXII preprocessing/chroma-cutout uses client
   compute today; broader browser inference remains postponed unless a
   verified kernel lands in `GPU_OPERATIONS`.
4. **User-configured providers** — admin vault + env exist; per-user BYO-key
   is not built (Phase 4, optional, transparent, never a hidden fallback).

## Honest availability snapshot (this host, 2026-11-20)

RIISHE chat operational (hosted gateway; local llama.cpp lane configured-on-demand);
CODE GIFTZ operational; LAXII degraded (t2i + enhancement available;
conversational editing / background removal blocked on this host; Diffusers
worker not-configured — no GPU); JAZMII degraded (t2v available via hosted
async; i2v blocked here). GANGZII is not exposed (no backend). Numbers and
conditions live in the Dashboard capability rows — the UI is authoritative,
this list is a dated copy.
