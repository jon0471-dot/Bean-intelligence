# M36 — Upstream Repository Research & Adoption Decisions

> Reviewed 2026-11-23 against live upstream sources (official repositories,
> release pages, npm/PyPI metadata). Exact reviewed versions recorded per
> candidate. Rule (brief §4): **no project is selected because of star count** —
> each entry records what was verified and why it was accepted, adapted, or
> rejected. BEAN policy constraints applied throughout: ₹0 recurring budget,
> no Ollama, no second agent framework, no gateway replacement, single-server
> SQLite deployment preserved, GPL code never embedded.

## A. Agent orchestration and workflows

| Candidate | Reviewed version | License | Decision | Reason |
|---|---|---|---|---|
| mastra-ai/mastra | 1.0 stable line (Jan 2026); releases through Oct 2026 (Storage v2 for agents & evented workflows) | Apache-2.0 (ELv2 enterprise add-ons exist — only the Apache core was considered) | **REJECTED for adoption; patterns adapted natively** | BEAN already has a stateful orchestrator (`src/lib/riishe/orchestrator.ts`: classify → plan → retrieve → tool loop → verify), a fixed tool registry with permission gating, Trust-Engine receipts and durable job queue. Installing mastra would create exactly the "second agent framework" the brief forbids. Adapted patterns: explicit auditable step planning (`capability-plan.ts` extension), task-aware capability routing, bounded tool loops. |
| vercel/ai (AI SDK) | 6.x line (Dec 2025) → 7 docs current | Apache-2.0 | **REJECTED** | Same reason. Its provider-abstraction value is already delivered by BEAN's own `TaskAdapter` contract + backend registry. |
| langchain-ai/langgraph | 1.2.24 (PyPI, Nov 2026) | MIT | **REJECTED** | Python; BEAN is TypeScript. Graph/checkpoint patterns already realized natively by the Trust Engine ledger (checkpoints, resume, approvals). |
| pydantic/pydantic-ai | v2.71.0 (Nov 2026) | MIT | **REJECTED** | Python. The typed agent-loop pattern is already implemented in BEAN's typed `ToolDescriptor`/`executeToolCall` contracts. |

## B. Broad model/provider ecosystem

| Candidate | Reviewed version | License | Decision | Reason |
|---|---|---|---|---|
| BerriAI/litellm | v1.108.15 LTS (Nov 21 2026) | MIT | **REJECTED for adoption; adapter/routing patterns adopted** | LiteLLM is a gateway/proxy. BEAN already has its own gateway, quota enforcement, credentials vault, registry, routing and fallback rules (brief §4B "Critical"). Installing it would duplicate quota systems and create a competing authorization path. Adopted patterns: per-protocol provider adapters, credential-gated dormant slots, controlled upstream model discovery (M36-A implementation). |
| maximhq/bifrost | current Go gateway line (15–20+ providers; enterprise self-hosted) | Apache-2.0 core | **REJECTED** | Same gateway-replacement objection; Go service would add a second runtime to a documented single-server deployment. |
| OpenAI chat-completions spec | stable public contract | — | **ACCEPTED (implemented)** | `providers/openai-compatible.ts` (live). M36-A adds controlled `GET /v1/models` discovery against real endpoints. |
| Anthropic Messages API | `2023-06-01` version header; `/v1/messages` + `/v1/models` (official docs) | — | **ACCEPTED (implemented M36-A)** | `providers/anthropic.ts`: real protocol adapter (`x-api-key` + `anthropic-version`, `system` field separate from messages, `content_block_delta` SSE events). Dormant until an operator configures a credential; never auto-routed; health = real tiny completion. |
| Google GenAI API | OpenAI-compatible endpoint (`generativelanguage.googleapis.com/v1beta/openai/`) documented in `docs/ai/MODEL-REGISTRY.md` (verified 2026-11-07) | Google ToS | **EVALUATED — carried, not re-implemented** | The OpenAI-compatible slot already serves it (recorded limitation: free-tier quotas are small and repeatedly changed; requires operator key). A dedicated google-genai adapter is future work only if the operator supplies credentials. |
| Hugging Face Inference Providers | router.huggingface.co/v1; free accounts get **no** included monthly credits (verified 2026-11-07 in MODEL-REGISTRY.md) | HF terms | **EVALUATED — not activated** | Requires a credit purchase decision. Never activated automatically. |

## C. Browser and user-device inference

| Candidate | Reviewed version | License | Decision | Reason |
|---|---|---|---|---|
| mlc-ai/web-llm | **0.2.89** (pinned in `src/workers/package.json`; current line — npm listed 0.2.87 published Oct 2026, docs carry 0.2.89) | Apache-2.0 | **ACCEPTED — already integrated** (`src/workers/webllm-worker.ts`, WebGPU chat lane). M36-B verifies the real bundle builds and the lane stays consent-gated. |
| huggingface/transformers.js | **4.3.2** (pinned; v4 line announced with C++ WebGPU runtime, ModelRegistry API) | Apache-2.0 | **ACCEPTED — already integrated** (`src/workers/asr-worker.ts`, Whisper ASR lane at pinned revision `5332fcc3…`). |
| microsoft/onnxruntime | **onnxruntime-web 1.31.1** (pinned; current npm release Oct 2026) + onnxruntime-node 1.31.1 for server-side test evidence | MIT | **ACCEPTED — already integrated** (`src/workers/segmentation-worker.ts`, MODNet segmentation at pinned SHA-256 artifact; M36-B adds a real CPU ONNX execution test). |
| ggml-org/llama.cpp | b12198 live on this host (chat + code lanes; MIT) | MIT | **ACCEPTED — already live** (`providers/llamacpp.ts`; measured 10–15 tok/s, honest quality limits documented in LOCAL-MODEL-LANES.md). |

Rejection recorded for the browser lane: **no new runtime introduced** — the four
runtimes above cover WebGPU chat, browser ASR, browser vision/segmentation and
server-local GGUF. Adding another (e.g. wllama, ratchet) would duplicate an
existing capability with no measured gap.

## D. Image, video and creative intelligence

| Candidate | Reviewed version | License | Decision | Reason |
|---|---|---|---|---|
| huggingface/diffusers | v0.43.0 (Nov 11 2026) | Apache-2.0 | **EVALUATED — carried (gated candidate)** | BEAN's Diffusers worker (`workers/laxii-diffusers`, SD1.5-inpaint/SDXL + IP-Adapter + Real-ESRGAN + LaMa) is code-complete with license/checksum/preflight gates but honestly `unavailable` on this GPU-less host. Not modified (protected working path). |
| Comfy-Org/ComfyUI | current line | **GPL-3.0** | **REJECTED — never embedded** | GPL code is not copied into BEAN. Its node-graph workflow architecture was studied conceptually only; BEAN's pipeline composition stays native (JAZMII composition engines). |
| Z-Image-Turbo / Qwen-Image / Wan 2.2 / LTX / Seedance | per `docs/ai/MODEL-REGISTRY.md` (verified 2026-11-07; license notes stand) | mixed (Apache-2.0 / non-commercial / revenue-threshold / proprietary) | **CARRIED** | Existing gated-candidate records are accurate and were re-checked, not duplicated. Seedance remains rejected (proprietary; "free wrapper" claims are false). |

## E. Documents and research

| Candidate | Reviewed version | License | Decision | Reason |
|---|---|---|---|---|
| docling-project/docling | v2.100.0 (June 2026; IBM-origin, graduated project) | MIT | **EVALUATED — selected as the future OCR/PDF-layout path; not deployed this milestone** | A Python sidecar service would change the documented single-server deployment topology (09-DEPLOYMENT-RUNBOOK). BEAN's `files/extract.ts` covers text/PDF/DOCX/XLSX/PPTX with an honest scanned-PDF gap. Docling is recorded as the chosen upstream component for the OCR gap when the operator approves a second service process; deployment steps intentionally not invented. |
| unclecode/crawl4ai | v0.9.x docs line; Apache-2.0 | Apache-2.0 | **EVALUATED — rejected for now** | BEAN's research lanes (allowlisted fetch + Agent Reach + browser-rendered reads) already deliver measured extraction; a Python crawl service duplicates them and widens the SSRF surface. |
| browser-use/browser-use | v0.13.14 (Oct 26 2026) | MIT | **REJECTED** | Python; its autonomous-browser model conflicts with BEAN's rule that browser execution stays isolated, allowlisted and approval-gated (Agent Reach lanes remain the sanctioned path). |

## F. Speech and audio

| Candidate | Reviewed version | License | Decision | Reason |
|---|---|---|---|---|
| ggml-org/whisper.cpp | v1.9.1 current | MIT | **EVALUATED — not integrated** | GANGZII already ships working transcription (browser Whisper-tiny via transformers.js + hosted ASR + live lane). A server-side whisper.cpp lane is a viable future operator-host option; no measured gap justifies adding it now. |
| Existing GANGZII engines (Kokoro-82M TTS, hosted ASR/TTS) | in-repo | Apache-2.0 (Kokoro) | **PRESERVED** | Untouched per brief §4F. |

## G. Higher-performance model serving

| Candidate | Reviewed version | Decision | Reason |
|---|---|---|---|
| vllm-project/vllm / sgl-project/sglang | current lines | **REJECTED** | GPU serving runtimes; no operator GPU and ₹0 budget make them permanently unavailable here. They are not browser runtimes. Never activated. |

## Net adoption for M36

Implemented natively (no new runtime dependencies):
1. **Anthropic Messages protocol adapter** + credential slot (dormant until configured) — broadens the provider ecosystem per §4B without a gateway replacement.
2. **Controlled upstream model discovery** for OpenAI-compatible and Anthropic endpoints (real `GET /models` where the provider exposes it; operator-maintained catalogue otherwise).
3. **Universal capability-record layer** over the existing registries (single source of truth preserved; reconciliation cross-check added).
4. **RIISHE specialist delegation** through the existing durable queue (patterns adapted from mastra/pydantic-ai planning + BEAN's own approvals).

Pinned runtime versions verified current: web-llm 0.2.89, transformers.js 4.3.2,
onnxruntime-web 1.31.1, llama.cpp b12198, kokoro-js 1.2.1.

License compliance: no GPL code embedded (ComfyUI studied only); no model
weights downloaded or redistributed; all candidate weights licenses remain
recorded in MODEL-REGISTRY.md.
