# BEAN — Free and Paid Provider Matrix

> Phase 2 deliverable. Classification verified 2026-11-07 against official repositories, model cards and pricing pages (sources cited inline). Rules honored: **no invented free API access**; an open-source repository is **not** free hosted compute; no unauthorized ChatGPT/Claude cookie extraction, browser automation or subscription sharing; no rate-limit bypass; no purchases without approval.

Classes: **FREE LOCAL** (open-weight model on our own hardware) · **FREE HOSTED** (verified free hosted inference with actual remaining quota) · **LIMITED FREE** (free credits or restricted trial) · **PAID API** (requires paid credits) · **UNAVAILABLE** (missing credentials/hardware/provider access).

## 1. CHAT — RIISHE

| Option | Class | Repo / URL | License | API / worker | Hardware | Credentials | Free limits | Est. cost | Capabilities |
|---|---|---|---|---|---|---|---|---|---|
| Authorized hosted gateway (current primary) | FREE HOSTED | https://z.ai (platform runtime) | platform agreement | z-ai-web-dev-sdk (`/v1/chat/completions`, SSE) | none | platform-managed (`/etc/.z-ai-config`, presence-only check) | governed by the platform agreement; per-product daily quotas + request budgets enforced by BEAN | not reported to tenant (`costUnit: null`) | chat, streaming, multilingual (incl. Tamil), reasoning, summarization, rewrite, web research |
| GLM-5.3 Flash | UNAVAILABLE (as a distinct BEAN lane) | platform-managed; exact checkpoint not disclosed to this tenant | platform agreement | via the hosted gateway only | none | platform | n/a — the gateway does not disclose/permit tenant model pinning | n/a | If the platform routes GLM-class models, it is already consumed through lane 1; no separate integration was invented. |
| Qwen3 quantized (GGUF) | FREE LOCAL | https://huggingface.co/Qwen (Qwen3 family) | Apache-2.0 | llama.cpp server (`https://github.com/ggml-org/llama.cpp`, MIT) | 0.6B–8B Q4_K_M: 0.5–6 GB; CPU inference practical, GPU offload faster | none | unlimited on our hardware | $0 (electricity only) | chat, streaming, multilingual, reasoning (hybrid thinking), summarization, rewrite |
| Dolphin 2.6 Mistral 7B GGUF | FREE LOCAL | https://huggingface.co/cognitivecomputations/dolphin-2.6-mistral-7b | Apache-2.0 (per model card) | llama.cpp | ~4.5 GB Q4 | none | unlimited on our hardware | $0 | chat, instruction following, coding-capable |
| Dolphin 2.9.2 Qwen2 7B GGUF | FREE LOCAL | https://huggingface.co/dphn/dolphin-2.9.2-qwen2-7b | tongyi-qianwen license (per model card) | llama.cpp | ~4.5 GB Q4 | none | unlimited on our hardware | $0 | chat, conversational, coding, function-calling |
| Dolphin GGUF via llama.cpp — **integrated lane** | FREE LOCAL (dormant until operator starts llama-server) | https://github.com/ggml-org/llama.cpp | MIT (runtime); per-model licenses above | `bean-chat-local-llamacpp` OpenAI-compatible adapter | CPU/RAM; CUDA optional | `BEAN_LLAMACPP_BASE_URL`, `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1` | unlimited | $0 | chat, streaming, multilingual, coding (model-dependent) |
| ChatGPT models (official API) | PAID API | https://platform.openai.com | OpenAI ToS | OpenAI-compatible slot (`bean-llm-openai-compatible`, dormant) | none | operator API key | none meaningful | per-token (operator's account) | chat, coding, streaming |
| Claude models (official API) | PAID API | https://docs.anthropic.com | Anthropic ToS | Anthropic Messages API (dedicated adapter required — NOT integrated) | none | operator API key | none meaningful | per-token | chat, coding |
| Hugging Face open-weight chat models via Inference Providers | LIMITED FREE | https://huggingface.co/docs/inference-providers | HF terms | OpenAI-compatible router (`router.huggingface.co/v1` → serves the OpenAI-compatible slot) | none | HF token | **verified 2026-11-07: free accounts get $0 included credits**; PRO ($9/mo) includes $2/month | $9/mo for the credit tier | chat via open models |
| Gemini API free tier | LIMITED FREE | https://aistudio.google.com | Google ToS | OpenAI-compatible endpoint (`/v1beta/openai/`) | none | Google API key (operator-created) | free tier exists; daily quotas tight and repeatedly reduced (reported 20–1,500 RPD by model/period) | $0 within tier | chat, streaming, multilingual |

**Bottom line (chat):** the primary is free-hosted through the authorized gateway; the free-local llama.cpp lane is fully implemented and dormant until the operator starts a server (exact steps: `WORKER-OPERATIONS.md`). Gemini/HF free tiers require credentials BEAN does not have and were not fabricated.

## 2. IMAGE — LAXII

| Option | Class | Repo / URL | License | Interface | Hardware | Credentials | Free limits | Capabilities |
|---|---|---|---|---|---|---|---|---|
| Hosted text-to-image (current primary) | FREE HOSTED | platform agreement | — | managed SDK | none | platform | BEAN quotas | text-to-image |
| Hosted conversational edit | FREE HOSTED | platform agreement | — | managed SDK `images.edit` | none | platform | BEAN quotas | image-to-image, conversational edit |
| Deterministic Sharp engine | FREE LOCAL | https://sharp.pixelplumbing.com | Apache-2.0 | in-process | CPU | none | unlimited | enhancement, mask compositing, upscale, grading |
| Local Diffusers worker (SD1.5-inpaint, SDXL, IP-Adapter, Real-ESRGAN, big-lama) | UNAVAILABLE here (no GPU) / FREE LOCAL on a GPU host | https://github.com/huggingface/diffusers | OpenRAIL-M / OpenRAIL++-M, Apache-2.0, BSD-3, MIT (per component; see decision matrix) | JSON-lines Python worker | CUDA ≥6 GB free VRAM | none | unlimited | masked inpainting, reference-guided generation, object removal, upscale |
| Z-Image-Turbo (6B) | FREE LOCAL (candidate, hardware fits RTX 5060 Ti 16 GB) | https://github.com/Tongyi-MAI/Z-Image | **Apache-2.0** (LICENSE verified 2026-11-07) | diffusers / ComfyUI | 16 GB-class consumer VRAM; 8 NFEs | none | unlimited | text-to-image (Turbo); Z-Image-Edit for instruction editing (checkpoint release status per repo) |
| Qwen-Image-2.1 (+ Edit) | FREE LOCAL but license-restricted | https://github.com/QwenLM/Qwen-Image-2.1 | **Qwen RESEARCH LICENSE — non-commercial use of weights** (verified 2026-11-07) | diffusers `QwenImage21Pipeline`, ComfyUI | 7B DiT; hosted Pro/Turbo APIs are PAID | none for local | unlimited (license permitting) | t2i, masked editing, 10 reference images, RGBA |
| Nano Banana via official API | PAID API | Gemini API image models | Google ToS | Gemini API (dedicated adapter — not integrated) | none | Google API key + paid billing | no verified free image tier | image generation + editing |
| Existing LAXII hosted image models | FREE HOSTED | platform | — | managed SDK | none | platform | BEAN quotas | t2i, edit, enhance (operational) |

## 3. VIDEO — JAZMII

| Option | Class | Repo / URL | License | Interface | Hardware | Credentials | Notes |
|---|---|---|---|---|---|---|---|
| Hosted video (current primary — operational, protected) | FREE HOSTED | platform agreement | — | async tasks + 429-safe polling | none | platform | real T2V/I2V evidence on record |
| Wan 2.2 TI2V-5B | FREE LOCAL (candidate; no worker yet) | https://github.com/Wan-Video/Wan2.2 | **Apache-2.0** | Wan2.2 pipeline / ComfyUI / diffusers | 720P@24fps on single consumer GPU (official card: "such as the 4090"); fp16 ≈ 11 GB peak (community-measured); INT4 GGUF ≈ 2.7 GB | none | RTX 5060 Ti 16 GB fits fp16 with headroom. **No worker implemented, no acceptance run → UNAVAILABLE until both exist.** |
| Wan 2.2 A14B (T2V/I2V) | UNAVAILABLE on this hardware | same repo | Apache-2.0 | same | MoE 14B×2 — far beyond 16 GB at fp16 | none | Do not assume otherwise (explicit brief rule). |
| LTX-Video / LTX-2 | LIMITED FREE | https://github.com/Lightricks/LTX-Video | LTXV Open Weights License — free only **<$10M annual revenue**; paid license above | diffusers / ComfyUI | heavier than TI2V-5B | none | Revenue-threshold review required before any adoption. |
| Seedance (ByteDance) | PAID API | official ByteDance/Volcano provider | proprietary — **not open source; a wrapper does not change that** | official API only | none | operator account + approval | Recorded explicitly to prevent the "wrapper = open source" confusion the brief prohibits. |

## 4. CODING — CODE GIFTZ

| Option | Class | Repo / URL | License | Interface | Notes |
|---|---|---|---|---|---|
| Hosted coding model (current primary) | FREE HOSTED | platform | agreement | managed SDK + BEAN sandbox | operational; shares chat fallback chain |
| Qwen2.5-Coder / Qwen3-Coder GGUF | FREE LOCAL (candidate) | https://huggingface.co/Qwen | Apache-2.0 | llama.cpp lane | resilience lane, not primary (quality honesty) |
| OpenCode | EVALUATED — NOT INTEGRATED | https://github.com/anomalyco/opencode (as referenced by the brief; verify the exact org/revision before any adoption) | open source (agent) | CLI agent harness | An **agent harness, not a foundation model**. Integration would expose host command-execution surface against the security rule; BEAN's approval-gated sandbox covers the required loop. |
| Existing configured coding APIs | FREE HOSTED | platform | — | — | covered by lane 1 + fallback chain |

## 5. Explicitly rejected / prohibited

- **ChatGPT/Claude account-cookie extraction, browser automation, subscription sharing** — prohibited; never used; official APIs only.
- **Ollama** — prohibited by policy; llama.cpp is the local runtime.
- **Rate-limit bypass / throttled-account retry loops** — prohibited; 429s are terminal per job, breakers open, fallbacks are credential-gated.
- **Purchasing credits/subscriptions** — prohibited without approval; nothing was purchased.
- **Fabricating free tiers** — HF free accounts have no included credits (verified); Gemini's free tier needs a Google account BEAN does not have; none were invented.
