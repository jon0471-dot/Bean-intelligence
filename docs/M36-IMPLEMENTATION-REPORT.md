# M36 — RIISHE UNIVERSAL AI AGENT, COMPLETE MODEL ECOSYSTEM & USER-OWNED COMPUTE — IMPLEMENTATION REPORT

> Branch: `feat/m36-riishe-universal-model-compute` (from `origin/main` @ `67e209e7d1be75b2fb46537b6f2e541641952ebe`)
> Date: 2026-11-23 · Product: BEAN Intelligence · Primary AI: RIISHE · Budget: ₹0 recurring
> All evidence below is measured on the deployment host. No mock is reported as real execution; environmental blockers are named.

---

## 1. Git SHAs

| | SHA |
|---|---|
| Starting `origin/main` (verified by fetch before any change) | `67e209e7d1be75b2fb46537b6f2e541641952ebe` |
| Working branch | `feat/m36-riishe-universal-model-compute` |
| Ending commit | the M36 commit on the working branch (fast-forward push only; remote SHA independently verified after push — see the worklog entry and the milestone delivery message for the recorded SHA) |

## 2. Upstream repositories evaluated (real review, exact versions)

Full review with decisions and reasons: **`docs/ai/UPSTREAM-RESEARCH-M36.md`**. Summary:

| Candidate | Reviewed version | Decision |
|---|---|---|
| mastra-ai/mastra | 1.0 stable line (releases through Oct 2026) | REJECTED for adoption (would be a second agent framework — forbidden); patterns adapted natively |
| vercel/ai | AI SDK 6/7 line | REJECTED (same reason; `TaskAdapter` already delivers the abstraction) |
| langchain-ai/langgraph 1.2.24 · pydantic/pydantic-ai v2.71.0 | current | REJECTED (Python) |
| BerriAI/litellm v1.108.15 LTS · maximhq/bifrost (Go gateway) | current | REJECTED for adoption (gateway replacement forbidden); adapter/discovery patterns adopted |
| mlc-ai/web-llm | **0.2.89 pinned** (current line) | ACCEPTED — already integrated, verified current |
| huggingface/transformers.js | **4.3.2 pinned** (v4 line) | ACCEPTED — already integrated |
| microsoft/onnxruntime | **onnxruntime-web 1.31.1 pinned** (current npm, Oct 2026) + onnxruntime-node 1.31.1 | ACCEPTED — already integrated; node build used for the M36-B CPU acceptance |
| ggml-org/llama.cpp | b12198 live on this host (MIT) | ACCEPTED — already live |
| huggingface/diffusers | v0.43.0 (Apache-2.0) | EVALUATED — carried as the gated GPU-worker candidate (no GPU host; worker code-complete, honestly unavailable) |
| Comfy-Org/ComfyUI | current (GPL-3.0) | REJECTED — no GPL code embedded; architecture studied only |
| docling v2.100.0 (MIT) | evaluated | SELECTED as the future OCR/PDF-layout path; not deployed (would change the documented single-server topology — recorded, not invented) |
| crawl4ai v0.9.x (Apache-2.0) · browser-use v0.13.14 (MIT) | evaluated | REJECTED (duplicated existing research lanes / security-model mismatch) |
| whisper.cpp v1.9.1 (MIT) | evaluated | NOT integrated — GANGZII's browser Whisper + hosted ASR already work; no measured gap |
| vllm / sglang | current | REJECTED (GPU serving; no GPU; ₹0) |

No new runtime dependency was added to the app. Pinned versions verified current.

## 3. Implemented vs evaluated

**Implemented (real code + tests):**
- **M36-A — universal capability and adapter foundation**: `src/lib/registry/capability-records.ts` (universal capability records derived from the EXISTING registries — no second catalogue; nine-state availability vocabulary; registry reconciliation drift detection); `src/lib/providers/anthropic.ts` (dedicated official Messages-protocol adapter, dormant until operator credential, never in an automatic fallback chain); `src/lib/providers/model-discovery.ts` (controlled, credential-gated, cached discovery against real `GET /models` endpoints for OpenAI-compatible + Anthropic; operator-catalogue fallback); engine-catalog entry + backend registration (`bean-llm-anthropic`) + router binding + credentials (`resolveAnthropicRuntimeCredential`, admin-vault + env sources, SSRF-validated).
- **M36-B — user-device inference**: worker bundles built and verified (`public/workers/webllm-worker.js` 5.9 MB, `asr-worker.js` 0.57 MB, `segmentation-worker.js` 0.4 MB from the nested pinned deps); REAL WebGPU compute round-trip benchmark (`WebGpuEngine.runComputeBenchmark` — WGSL dispatch, readback, value verification; wrong values = honest fail) merged into `runBenchmark()` so tier 4 requires real evidence; GPU device + CPU engines registered as page-shutdown cleanup hooks (real resource-release gap closed); heavy-model slot reservation wired into on-device chat + ASR lanes (reserve BEFORE load; chat ↔ ASR mutually exclusive); REAL CPU model execution acceptance on the pinned MODNet artifact.
- **M36-C — RIISHE capability orchestration**: `src/lib/riishe/specialists.ts` — three delegation tools (`generate_image` → LAXII, `create_video` → JAZMII, `synthesize_speech` → GANGZII) that submit through the EXISTING durable queue with the SAME router preflight gates (availability, rate limit, quota, budget), the SAME duplicate guard, the SAME durable rows/worker pools/receipts — never recreating specialists; deterministic media-request planning in `capability-plan.ts` (narrow creation-verb patterns; questions/attachments never trigger delegation); two-key gating (server-side permission keys AND plan agreement) wired through `orchestrator.selectTools`, the chat route, and the background chat worker; honest queued-job outputs (never completed-artifact claims); import-cycle guard documented.
- **M36-D — operational-only UX**: payload boundary sanitization (`metadataToJson` drops reach backend ids; `techdocs-reach.ts` drops backend from the persisted artifact and the model-visible block); customer-safe display projection (`displayName`/`runtimeLabel`/`licenseName` in the client model registry + device-capability status); identity strings removed from customer components (composer dialog, AI Device page, GANGZII narration/transcription, LAXII edit history, JAZMII director badge, dashboard worker pools); admin/operator surfaces intentionally preserved (restricted owner diagnostics); the local desktop-engine setup text preserved (the user must run that command on their own machine — it is the feature).
- **M36-E — evaluation and reliability**: 97 new tests across 6 new files (below); stale docs reconciled.

**Evaluated, not integrated** (documented in §2 + UPSTREAM-RESEARCH-M36.md): mastra/langgraph/pydantic-ai/vercel-ai frameworks, litellm/bifrost gateways, docling OCR service, crawl4ai, browser-use, whisper.cpp server lane, vllm/sglang, ComfyUI, diffusers deployment, Google GenAI dedicated adapter (the OpenAI-compatible slot serves it when the operator configures a key).

## 4. Actual model & provider capability coverage

- Registry: **20 private backends** (was 19; +1 Anthropic Messages slot) — every one with an adapter binding or a documented handler-dispatch path (JAZMII composition), pinned by `reconcileRegistries` tests.
- Chat providers: hosted gateway (primary) → operator OpenAI-compatible slot (dormant) → local llama.cpp lane (free-first resilience) + the operator Anthropic Messages slot (dormant, selectable, NEVER auto-chained — no automatic paid fallback).
- Universal capability records: per-backend modalities, structured-output/tool-calling **declared false until an adapter implements and tests them** (brief §5), memory with explicit uncertainty, quantization options (GGUF lane), credential requirements as env-var NAMES, download integrity classes, explicit fallbacks.
- Nine-state availability: available-verified / configured-unhealthy / requires-credentials / requires-unsupported-runtime / requires-missing-hardware / unsupported-by-adapter / disabled-license-policy / not-configured / temporarily-unavailable — each derivation pinned by tests; the PUBLIC catalog vocabulary stays unchanged (private routing metadata and safe public metadata remain separate).
- Delegated capabilities: image creation, video creation, speech synthesis — each mapping to a real registered backend through the real queue.

## 5. Real local inference evidence (measured on this host, 2026-11-23)

`bun scripts/m36-acceptance/cpu-inference.ts` (artifact pinned + integrity-gated):

```
artifactBytes: 6,632,188   sha256: 92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a  (EXACT pin match)
executionProvider: cpu (onnxruntime-node)   inputDims: [1,3,512,672]   outputDims: [1,1,512,672]
durationMs: 588   matte range: [0, 0.9943]   shape preserved: true   all values in [0,1]: true   foreground detected: true
=== M36-B ACCEPTANCE: REAL CPU INFERENCE PASSED (actual model output validated) ===
```

- The preprocessing mirrors the browser segmentation worker's pinned config (shortest edge 512, ÷32, rescale 1/255, mean/std 0.5) — the same model, the same math.
- Worker bundles build: `bun run workers:build` produced all three bundles from the nested pinned runtimes.

**Environmental blockers (stated honestly):**
- Real-browser **WebGPU** execution: no WebGPU adapter exists in this sandbox; the compute round-trip benchmark ships and is tested against structural fakes (correct values → pass; wrong values → fail; no adapter → honest refusal), but a real-browser run on capable hardware is pending operator hardware.
- Real WebLLM/Transformers.js model downloads in tests: deliberately not performed in the sandbox test suite (no-auto-download policy is a product behavior, and the runtimes require the browser worker environment); their consent/integrity/quota gates remain covered by the existing 114-test client-compute suite.

## 6. Low-spec and high-performance device behavior

- Device tiers remain conservative by construction; the new benchmark cannot INFLATE a tier: `gpuComputeOk=false` keeps tier 3, and only a verified round-trip grants tier 4 (pinned by `tests/unit/device-gpu-benchmark.test.ts`).
- Low-end: no GPU/WASM-less devices stay tier 0–1; heavy models stay behind the model gate + memory gate + consent; nothing loads at page init (runtimes are worker-bundled, loaded on demand only).
- High-performance: tier-4 devices now reachable via real evidence; the one-heavy-model slot (chat ↔ ASR) is reserved BEFORE loading and released on unload/failure (pinned contract).
- Page-shutdown release: GPU device + CPU workers now registered as cleanup hooks on `pagehide` (previously only scheduler counters were released).
- UI responsiveness: no heavy runtime entered the app graph (nested worker deps; verified by the successful Turbopack production build and by the bundle layout — heavy inference lives in `public/workers/*.js`, loaded per lane on demand).

## 7. UI privacy checks (backend identities hidden)

`tests/unit/ui-identity-hygiene.test.ts` (24 tests):
1. **Payload sanitization**: `metadataToJson` drops `reach.backend` from every persisted source while the in-memory metadata keeps full provenance for Trust receipts.
2. **Giftz artifact**: `research.sources` no longer carry a backend field; the model-visible reference block cites the CHANNEL only (`not.toContain('github-api')`).
3. **Client model registry projection**: display names / runtime labels / license names carry no foundation-model or runtime-package identity.
4. **Static scan of 18 customer components** (comments stripped; documented functional-id exemptions only): zero occurrences of `Qwen2.5-0.5B`, `Kokoro-82M`, `Whisper-tiny`, `WebLLM`, `web-llm`, `transformers.js`, `onnxruntime`, `bean-llm-`, `bean-image-`, `bean-video-`, `bean-audio-`, `github-api`. Operator surfaces (`admin.tsx`, `admin-gateway.tsx`) are explicitly exempt (restricted owner diagnostics, brief §9).

Removed from the customer UI (rendered text): the composer on-device dialog model name, the AI Device model ids + runtime package labels, GANGZII narration "Kokoro-82M" and transcription "Whisper-tiny" strings, the LAXII edit-history engine id, the JAZMII director engine badge, the dashboard worker-pool names, and the RIISHE source tooltip backend id. License disclosure (required for downloads) is retained as the bare license name (e.g. `Apache-2.0`).

## 8. Test totals

- **Full suite after M36: 2652 pass / 0 fail / 5 skip across 201 files, 41,501 expect() calls** (`bun test --isolate tests/`, 136 s). Baseline before M36: 2555 pass / 0 fail / 5 skip. Delta: **+97 tests, +0 failures.**
- New test files: `provider-anthropic-protocol` (14 — real wire protocol: headers, system mapping, SSE decode, 429 breaker class + retry hint, auth failure without secret exposure, dormant zero-fetch, real completion probe), `model-discovery` (8 — credential gating, provider-API mapping, honest degradation, caching), `universal-capability-records` (22 — derivation, no cross-task leakage, memory uncertainty, nine states, reconciliation drift classes), `riishe-specialist-delegation` (17 — planning narrowness, two-key gating, real gate propagation, duplicate refusal, honest failures, identity hygiene), `ui-identity-hygiene` (24), `device-gpu-benchmark` (12 — real round-trip semantics incl. wrong-value honesty, tier-4 gating, cleanup).
- One pre-existing suite-isolation flake is recorded historically (jazmii-evidence-wiring, M35); it passed in isolation and in the final full runs.
- Regressions re-run: RIISHE streaming + slot release (`riishe-chat-slot-release` 8/8), Trust lifecycle, CODE GIFTZ sandbox execution (integration, 16/16), project memory, LAXII/JAZMII/GANGZII suites — all green in the full run.

## 9. Security, license and performance findings

- **Security**: the Anthropic slot follows the platform's credential discipline (values only in the `x-api-key` header; redacted from error paths incl. `x-api-key` and `sk-ant-` shapes; SSRF-validated base URL via the existing guard; dedicated breaker class `chat-anthropic` prevents cross-lane fail-fast). Discovery is credential-gated, SSRF-checked, cached 5 min, and never mutates routing. Delegation re-uses the exact product gates — no new authorization path was created. A real import-cycle (TDZ) introduced by the delegation wiring was caught by the suite and fixed with a documented dynamic-import guard.
- **License**: no GPL code embedded (ComfyUI); no model weights redistributed; the MODNet acceptance run verified the pinned artifact's SHA-256 before executing; the Anthropic slot records its access-terms and `verifiedAt`; attribution records remain in the registry sources.
- **Secrets**: full-diff secret scan clean (only deliberate test fixtures `sk-ant-test-key` / `sk-test-key`, never real credentials).
- **Performance**: production Turbopack build succeeds; no heavy runtime in the app graph (nested worker deps); delegation adds zero hot-path work to ordinary turns (planner regexes are microseconds; tools absent unless planned); the GPU benchmark is opt-in and ≤5 s bounded.

## 10. Remaining unavailable models / capabilities (and why)

- Local Diffusers (SD inpainting/upscale) — no GPU host (worker code-complete, gated).
- Wan 2.2 TI2V-5B — no GPU worker implemented + no acceptance run (recorded path to enablement).
- Anthropic Messages slot — dormant until the operator configures a credential (by design; no automatic activation).
- Qwen-Image-2.1 / Seedance / LTX-2 — license restrictions (research-only / proprietary / revenue threshold); recorded, not integrated.
- Docling OCR — selected upstream, not deployed (single-server topology decision recorded).
- Scanned-PDF OCR in Document Intelligence — honest gap until a docling sidecar is approved.
- Real-browser WebGPU run — pending operator hardware (benchmark ships; evidence recorded from the server-side CPU path).

## 11. Publication

- Normal fast-forward push of `feat/m36-riishe-universal-model-compute` to origin (no force-push, no history rewrite; `main` untouched pending separate authorization).
- Remote SHA independently verified by fetching origin and comparing refs after the push; commit visible on GitHub. Evidence recorded in the worklog entry and the milestone delivery message.
