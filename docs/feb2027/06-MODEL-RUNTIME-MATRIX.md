# 06 — Model & Runtime Compatibility Matrix (zero-budget transparency)

Authoritative upstream documents (do not duplicate):
`docs/ai/MODEL-REGISTRY.md` (updated 2026-11-23), `docs/ai/LOCAL-MODEL-LANES.md`
(LIVE 2026-11-08), `docs/ai/UPSTREAM-RESEARCH-M36.md` (M36 upstream review),
`docs/ai/FREE-AND-PAID-PROVIDER-MATRIX.md` (2026-11-07),
`docs/ai/GPU-RESOURCE-PLAN.md`, `docs/BEAN-CLIENT-COMPUTE-ARCHITECTURE.md`.
This file records the February-launch transparency surface and its measured
gaps. Budget rule: **₹0 recurring** — `costUnit: null` everywhere, no
purchases, no fabricated free tiers, no Ollama, no cookie extraction, no
rate-limit bypass.

## What exists and is verified

| Surface | Location | State |
|---|---|---|
| Private backend registry (20 entries incl. the operator Anthropic Messages slot; license + `verifiedAt` per backend, fallback lists explicit) | `src/lib/registry/backends.ts` | ✅ routing authority |
| Universal capability records (per-backend modalities, cost class, memory with uncertainty, quantization, credential requirements, download integrity, nine-state availability) | `src/lib/registry/capability-records.ts` | ✅ M36-A — derived from the registries, never a second catalogue |
| Registry reconciliation (backends ↔ engine catalog ↔ router adapter bindings; drift = detectable failure) | `capability-records.ts reconcileRegistries()` | ✅ unit-pinned |
| Provider adapters (hosted gateway, OpenAI-compatible, **Anthropic Messages (M36-A)**, llama.cpp lanes) | `src/lib/providers/*` | ✅ protocol-tested (fake-fetch wire tests; anthropic: 14 tests) |
| Controlled model discovery (real `GET /models` for OpenAI-compatible + Anthropic endpoints; operator catalogue otherwise) | `src/lib/providers/model-discovery.ts` | ✅ credential-gated, cached, never mutates routing |
| Public catalogue projection (no upstream identifiers exposed; products + tasks) | `src/lib/registry/products.ts`, `models.ts`, `/api/v1/models` | ✅ sanitized |
| Availability semantics (layered: product badge / capability rows / public model availability / **nine-state universal vocabulary**; RIISHE response states) | `registry/status.ts`, `capabilities.ts`, `capability-records.ts`, `riishe/states.ts` | ✅ honest |
| Zero-budget guards (per-product request budgets, shared-account budget + user reserve, never guesses money) | `providers/cost-guard.ts`, `providers/account-quota.ts` | ✅ live-verified in prior milestones |
| Fallback honesty (only upstream-class failures, each candidate once, credential-gated, audit-logged `provider.fallback`, mid-stream never restarted) | `providers/routing.ts` | ✅ |
| Local CPU lanes (llama.cpp, Qwen3-1.7B chat @8081, Qwen2.5-Coder-1.5B @8082, RAM-gated spawn, breaker class) | `providers/llamacpp.ts` | ✅ measured on this host (10–15 tok/s chat; honest quality limits documented) |
| Browser compute probes + device tiers 0–4 | `src/lib/client-compute/*` | ✅ probes; **tier 4 now requires a REAL WebGPU compute round-trip benchmark** (`WebGpuEngine.runComputeBenchmark`, M36-B) — no adapter / wrong results = honest refusal |
| Browser AI runtimes (WebLLM 0.2.89 chat · transformers.js 4.3.2 ASR · onnxruntime-web 1.31.1 segmentation) — nested install + bundles build verified | `src/workers/*`, `public/workers/*.js` | ✅ M36-B — consent-gated, integrity-pinned, never auto-downloaded |
| **Real CPU model execution evidence** (pinned MODNet artifact, onnxruntime-node CPU EP, matte output validated) | `scripts/m36-acceptance/cpu-inference.ts` | ✅ 2026-11-23 (588 ms, 512×672, values [0, 0.9943], SHA-256 match) |
| Client model download gate (SHA-256 pinning required, trusted origin, consent + quota, eviction honesty) | `client-compute/model-registry.ts` | ✅ fail-closed |
| Heavy-model slot reservation (one heavy model per device: chat ↔ ASR mutually exclusive, reserve-before-load) | `inference/device-capability-manager.ts` + `resource-manager.ts` | ✅ M36-B |
| Specialist delegation (RIISHE → LAXII/JAZMII/GANGZII through the EXISTING queue: same preflight gates, same dedupe, same durable rows, same receipts) | `src/lib/riishe/specialists.ts` | ✅ M36-C — plan-narrowed + permission-gated |
| Identity hygiene (no model/runtime/backend identities in customer UI or payloads; operator diagnostics exempt) | `registry/capability-records.ts` (public), `riishe/states.ts` (metadata), customer components | ✅ M36-D — static scan pinned in tests |

## Gaps for February (Phase 2/4 work)

1. **Model selection stays internal — by design.** Users pick products and
   capabilities, never models or providers (brief §9 is absolute: no provider
   dropdown, no backend marketplace in customer UI). The earlier Phase-2 note
   about exposing a "sanitized runtime/provider identity panel per product"
   is **superseded by M36-D**: the customer surface shows capability
   availability and honest operational status ONLY ("available / ready /
   running locally on this device / requires setup / temporarily
   unavailable"); backend identities live in restricted owner diagnostics
   (`/api/admin/*`, admin console) and server logs.
2. **Device-fit recommendations** — probes + the memory budget exist; the
   recommendation UI ("which local model fits this device") is served through
   the AI Device page's measured status rows today; a dedicated recommendation
   explainer remains future work.
3. **User-configured providers** — admin vault + env exist (now including the
   Anthropic Messages slot); per-user BYO-key is not built (Phase 4, optional,
   transparent, never a hidden fallback).
4. **Real-browser WebGPU execution evidence** — the compute round-trip
   benchmark ships (M36-B) but no WebGPU hardware exists in the deployment
   sandbox; a real-browser run on a capable device is recorded as pending
   operator hardware (environmental blocker, honestly stated).

## Honest availability snapshot (this host, 2026-11-23)

RIISHE chat operational (hosted gateway; Anthropic Messages slot dormant
awaiting operator credentials; local llama.cpp lane configured-on-demand);
CODE GIFTZ operational; LAXII degraded (t2i + enhancement available;
conversational editing / background removal blocked on this host; Diffusers
worker not-configured — no GPU); JAZMII degraded (t2v available via hosted
async; i2v blocked here). GANGZII operational through the hosted lanes.
Numbers and conditions live in the Dashboard capability rows — the UI is
authoritative, this list is a dated copy.
