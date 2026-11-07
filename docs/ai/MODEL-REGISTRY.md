# BEAN — Model Registry

> Server-only catalog (`src/lib/ai-engine/model-registry.ts` + `src/lib/registry/backends.ts`). **Internal routing only — BEAN has no model-selection UI.** Users ask products for capabilities; this registry decides the rest.

Every model adapter declares: product compatibility, supported capabilities, input formats, output formats, context/resolution limits, maximum duration, hardware requirements, cost classification, availability. Facts below were verified against official repositories/cards on **2026-11-07** unless marked otherwise.

## CHAT — RIISHE (also CODE GIFTZ coding)

| # | Model / lane | Class | License | Interface | Hardware | Credentials | Notes |
|---|---|---|---|---|---|---|---|
| 1 | **Authorized hosted gateway** (`bean-llm-hosted-primary`, provider-managed checkpoint not disclosed to tenant) | `free-hosted` | Platform inference agreement | z-ai-web-dev-sdk chat-completions, SSE streaming | none (provider-managed) | platform runtime (`/etc/.z-ai-config`, presence-checked) | Primary for chat + coding. Periodically account-throttled (429) — fallback chain exists for exactly this. |
| 2 | **Operator OpenAI-compatible slot** (`bean-llm-openai-compatible`) | `paid-api` (provider-dependent) | per operator's account | OpenAI `POST {base}/chat/completions`, SSE | none | `BEAN_PROVIDER_OPENAI_API_KEY` or admin-vault credential (AES-256-GCM) | Dormant until configured. Works with OpenAI, Groq, Together, OpenRouter, DeepSeek, vLLM… |
| 3 | **Local llama.cpp GGUF** (`bean-chat-local-llamacpp`) | `free-local` | per loaded model (see below) | llama-server OpenAI-compatible `/v1` (`https://github.com/ggml-org/llama.cpp`, MIT) | CPU inference works; CUDA offload when GPU present; 4 GB+ RAM for 7B Q4 | none (`BEAN_LLAMACPP_BASE_URL` + `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1`) | **No Ollama (policy).** Capability verified by a real completion probe. Candidate GGUFs: Qwen3 (Apache-2.0), Dolphin 2.6 Mistral 7B (Apache-2.0 base per model card), Dolphin 2.9.2 Qwen2 7B (tongyi-qianwen license). |
| 4 | Gemini API free tier | `limited-free` | Google ToS | OpenAI-compatible endpoint `generativelanguage.googleapis.com/v1beta/openai/` | none | Google API key (operator-created) | Free tier exists with tight daily quotas (reported 20–1,500 RPD depending on model/period, slashed repeatedly). Requires approval + key; never activated automatically. |
| 5 | HF Inference Providers | `limited-free` | HF terms | OpenAI-compatible router `router.huggingface.co/v1` | none | HF token | Verified 2026-11-07: free accounts get **no** included monthly credits (pay-as-you-go needs a credit purchase); PRO ($9/mo) includes $2/month credits. Not free for this deployment without a purchase decision. |
| 6 | ChatGPT / Claude official APIs | `paid-api` | OpenAI / Anthropic ToS | OpenAI-compatible (slot #2 serves OpenAI directly) / Anthropic API | none | operator key | Official APIs only. Account-cookie extraction, browser automation and subscription sharing are **prohibited** and were not used. |

## IMAGE — LAXII

| # | Model / lane | Class | License | Interface | Hardware | Notes |
|---|---|---|---|---|---|---|
| 1 | **Hosted text-to-image** (`bean-image-hosted-primary`) | `free-hosted` | platform agreement | managed SDK | none | Operational (real acceptance evidence 2026-11-04). |
| 2 | **Hosted conversational edit** (`bean-image-hosted-edit`) | `free-hosted` | platform agreement | managed SDK `images.edit` ({prompt, images:[{url}], size}) | none | Whole-image regenerative edit — NOT pixel-preserving. |
| 3 | **Deterministic Sharp engine** (`bean-image-local-sharp`) | `free-local` | Sharp Apache-2.0 | in-process | CPU | Preservation-first enhancement: masks, grading, upscale. Operational. |
| 4 | **Local Diffusers worker** (`bean-image-selfhosted-diffusers`) | `unavailable` here (no GPU) | SD1.5-inpaint/SDXL OpenRAIL-M / OpenRAIL++-M; IP-Adapter h94 Apache-2.0; Real-ESRGAN BSD-3; big-lama Apache-2.0; YuNet MIT | JSON-lines Python worker (`workers/laxii-diffusers`) | CUDA, ≥6 GB free VRAM class | Masked inpainting, reference-guided generation, object removal, upscale. Code-complete with license/checksum/preflight gates; honestly blocked on this GPU-less host. |
| 5 | **Z-Image / Z-Image-Turbo / Z-Image-Edit** (Tongyi-MAI) | `free-local` (hardware-gated) | **Apache-2.0** (verified LICENSE 2026-11-07) | diffusers / ComfyUI | 6B; **Turbo fits 16 GB consumer VRAM**, 8 NFEs, sub-second on H800-class | Candidate for the operator PC. Turbo = generation; Z-Image-Edit = instruction editing; Omni-Base/Edit checkpoints "to be released" per repo. Would need a real worker + acceptance run. |
| 6 | **Qwen-Image-2.1 / Edit** (QwenLM) | `free-local` (license-restricted) | **Qwen RESEARCH LICENSE — bars commercial use of weights** (verified LICENSE 2026-11-07; effective 2026-09-20) | diffusers `QwenImage21Pipeline`, ComfyUI, vLLM-Omni | 7B DiT; Pro/Turbo hosted APIs are PAID (Alibaba Model Studio) | Technically strong (mask editing, 10 reference images, RGBA) but the **non-commercial research license conflicts with BEAN's commercial posture** → not selectable without an explicit licensing decision. |
| 7 | Nano Banana (Gemini image) via official API | `paid-api` | Google ToS | Gemini API | none | Requires a paid Google API account; no free image tier claimed. Not integrated (no credentials); the OpenAI-compatible slot does not serve it — a dedicated adapter would be required. |

## VIDEO — JAZMII

| # | Model / lane | Class | License | Interface | Hardware | Notes |
|---|---|---|---|---|---|---|
| 1 | **Hosted video** (`bean-video-hosted-primary`) | `free-hosted` | platform agreement | async tasks (`create` → `query`), 429-safe polling | none | Operational (real T2V/I2V artifacts 2026-11-04). Protected — not modified. |
| 2 | **Wan 2.2 TI2V-5B** | `free-local` (candidate) | **Apache-2.0** (official repo LICENSE) | Wan2.2 pipeline / ComfyUI / diffusers | 720P@24fps on a single consumer GPU ("such as the 4090" per official card); fp16 peak ≈ **11 GB** (community-measured), INT8 ≈ 5.4 GB, INT4 ≈ 2.7 GB GGUF | **RTX 5060 Ti 16 GB fits fp16 with headroom.** A14B variants do NOT fit 16 GB. No worker implemented + no acceptance run → honestly `unavailable` until both exist. |
| 3 | **Seedance** (ByteDance) | `paid-api` | proprietary — **NOT open source**; "free integration wrapper" claims are false | official ByteDance/Volcano API only | none | Recorded to prevent the exact confusion the brief warns about: an integration wrapper does not make Seedance open or free. Not integrated; would require operator approval + paid account. |
| 4 | **LTX-Video / LTX-2** (Lightricks) | `limited-free` | LTXV Open Weights License — free only for entities **<$10M annual revenue** | diffusers / ComfyUI | LTX-2 heavier than TI2V-5B | Viable only after a revenue-threshold review; otherwise a paid commercial license is required. |
| 5 | HunyuanVideo-family | `free-local` (candidate) | mixed community licenses | — | ≥24 GB class | Below TI2V-5B in practicality for 16 GB; kept as future candidates only. |

## CODING — CODE GIFTZ

| # | Model / lane | Class | License | Interface | Notes |
|---|---|---|---|---|---|
| 1 | **Hosted coding model** (`bean-code-llm-hosted-primary`) | `free-hosted` | platform agreement | managed SDK + BEAN sandbox | Operational; shares the chat fallback chain. |
| 2 | Local **Qwen2.5-Coder / Qwen3-Coder** GGUF via llama.cpp | `free-local` (candidate) | Apache-2.0 | llama-server `/v1` (slot #3 of chat chain) | Small quantized coder models fit 16 GB-class RAM/GPU; quality below hosted frontier models — honest positioning: resilience lane, not primary. |
| 3 | **OpenCode** (coding agent) | evaluated — not integrated | open source (agent harness, MIT-family — verify pinned revision before any adoption) | CLI agent | It is an **agent harness, not a foundation model**. Integrating it would add host command-execution surface that contradicts the security rule "Do not expose arbitrary host command execution to BEAN users". BEAN's own approval-gated sandbox + shared turn core already provide the required loop. Re-evaluate only with a hardened, containerized execution story. |
| 4 | Dolphin GGUF coding-capable models | `free-local` (candidate) | tongyi-qianwen (2.9.2 Qwen2 family) | llama-server | Via the llama.cpp lane. |

## Routing rules (enforced)

1. Select a compatible authorized provider.
2. Check its circuit breaker and available quota.
3. Select an eligible local worker **only if the measured hardware fits**.
4. Queue the request → execute in the background worker → persist the result → notify the frontend.
5. Never silently substitute an incompatible model; never send a video task to an image-only model; never send masked editing to a model without editing support; never run a local model that does not fit the available hardware.

**Cost discipline:** `costUnit` stays `null` everywhere (no provider reports per-request cost to this tenant). The operator's request-budget guard (`BEAN_DAILY_REQUEST_BUDGET_*`) and per-product daily quotas bound usage. No credits are purchased and no subscriptions created by BEAN.
