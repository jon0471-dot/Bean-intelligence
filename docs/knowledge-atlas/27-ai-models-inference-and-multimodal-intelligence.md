Atlas ID: ATLAS-27 · Review date: 2026-11-24 · Status: documented · Parent: README.md

# AI Models, Inference and Multimodal Intelligence

This file records the atlas vocabulary for AI model families, inference concepts, runtime landscapes, multimodal capabilities and their honest limits, and maps that vocabulary to BEAN Intelligence's real execution lanes and device tiers. It is operator-facing: backend identities and registry paths are discussed here, while the customer UI keeps model identity hidden (M36-D identity hygiene).

## 1. Scope and Method

AI claims fail most often at the boundary between what is configured and what actually runs. This file therefore organises model knowledge around a rule: capability statements describe measured execution, never installation or intent. Model families and inference concepts are documented conceptually; the transformer mechanism's foundational description is Vaswani et al., "Attention Is All You Need" (References), and runtime specifics are cited to official upstream repositories rather than paraphrased.

## 2. Model Families

- Transformers: the dominant architecture for language. The attention mechanism conceptually lets every token weigh the relevance of every other token in the context, producing contextual representations; because the computation is parallel across positions, transformers train efficiently at scale and power modern LLMs.
- Diffusion models: the dominant family for image generation. Conceptually, a model learns to reverse a noising process: starting from pure noise, it iteratively denoises toward an image, conditioned on text or another input; each step refines rather than decides.
- CNNs (convolutional neural networks): local receptive fields sliding over grids made them the workhorse of image tasks and they remain common in efficient vision pipelines.
- RNN legacy note: recurrent networks processed sequences token by token, which limited parallelism and long-range learning; they are historically important and survive in niches, but they are not the current mainstream for language.
- Mixture-of-experts (MoE): conceptually, a router activates a small subset of expert sub-networks per token, giving a model large capacity without proportionally large per-token compute.

These families are complements, not competitors: multimodal products typically combine several (a vision encoder, an LLM, a diffusion generator, an ASR/TTS pair).

## 3. Inference Concepts

- Tokens: models process subword units, not words; token counts drive cost, memory, and limits, and text length in characters is not length in tokens.
- Context window: the span a model can attend to in one call; it is finite, and cost and memory grow with its use.
- Temperature and sampling: temperature scales the output distribution — low values make output more deterministic, high values more varied; top-k/top-p restrict sampling to likely candidates. These settings change style and variance, not truthfulness guarantees.
- Quantisation: storing weights at reduced precision — int8 and 4-bit are common practice — trading modest accuracy for memory and speed; this is what makes local execution feasible on consumer hardware.
- KV cache: conceptually, computed attention state for processed tokens is reused across generation steps; the cache trades memory for speed and explains why long contexts carry real memory cost.

## 4. The Runtime Landscape and BEAN's Lanes

The same model family runs in different execution environments with different trade-offs. BEAN's real lanes:

- Browser GPU (WebGPU): WebGPU exposes compute shaders in the browser; the WebLLM lane (BEAN: src/lib/client-compute/inference/webllm-chat-client.ts, runtime @mlc-ai/web-llm 0.2.89 pinned in src/workers/package.json) runs LLM chat fully in-browser on the user's GPU.
- Browser CPU/WASM: ONNX Runtime Web executes ONNX models in-browser via WebAssembly (with optional WebGPU acceleration); BEAN's Whisper ASR lane uses transformers.js (@huggingface/transformers 4.3.2) and the segmentation lane uses onnxruntime-web 1.31.1 with a SHA-256-pinned, self-hosted artifact accepted by measured CPU performance.
- Local server: llama.cpp (MIT) provides a local desktop/server lane for quantised open-weight models; BEAN's llama.cpp lane manager integrates it as a separate, explicitly managed engine.
- Authorised remote: gateway adapters call hosted models over wire protocols — the OpenAI-compatible chat-completions protocol and the Anthropic Messages protocol are the two wire formats BEAN's adapters implement (src/lib/ai-gateway, src/lib/providers). These are protocol adapters, not model identities.

Twenty private backends are registered in src/lib/registry/backends.ts; their identities are hidden from the customer UI and surfaced only in operator-facing surfaces such as this file and admin views.

## 5. Execution Lifecycle and Honest Capability Framing

BEAN models a capability's path to trust as an execution lifecycle: discovered → registered → compatible → credential-configured → runtime-installed → hardware-compatible → download-approved → integrity-verified → execution-tested → output-validated → operational. Three honesty rules give the lifecycle force:

- Only execution-tested states may be represented as operational. Everything earlier is intent, not evidence.
- A compiled worker bundle is NOT proof a model runs. Bundling a runtime proves the code was built; it says nothing about weights, hardware fit, or runtime behaviour.
- A benchmark round-trip is NOT AI inference. A compute benchmark proves the device's capability; it does not prove a model produces valid output. Conversely, a proprietary-weights model cannot run locally: it must use its official API or be marked unavailable.

The universal availability vocabulary (src/lib/registry/capability-records.ts) maps evidence to nine states, each naming exactly what is missing: available-verified (probed and healthy), configured-unhealthy (configured but failing health), requires-credentials, requires-unsupported-runtime, requires-missing-hardware, unsupported-by-adapter, disabled-license-policy, not-configured (no enabled backend), and temporarily-unavailable (transient failure). The vocabulary's design principle is precision: "requires-missing-hardware" and "requires-credentials" are different facts with different fixes, and conflating them hides the actionable one.

## 6. Multimodal Capabilities and Limits

- Vision-language: image understanding and description are strong but not reliable at fine detail (text in images, counting, precise spatial relations are typical weak points).
- Image generation/editing: diffusion-based generation is capable but prompt-sensitive; editing depends on segmentation and inpainting quality; outputs require review for artefacts and prompt compliance.
- Video: generation and understanding are the most resource-intensive modalities — latency, memory, and cost bound realistic outputs (short clips, low throughput), and BEAN routes video through durable job queues rather than interactive calls.
- ASR/TTS: speech recognition and synthesis are mature; accuracy degrades with noise, accents, and domain vocabulary; BEAN's ASR runs in-browser via transformers.js and TTS server-side via kokoro-js.
- OCR/document understanding: layout-aware extraction works well on clean documents; handwriting, tables, and scans need review.
- Embeddings/reranking: text vectors enable similarity retrieval and grounding — the "nearest in meaning" primitive behind evidence gathering (file 24 §databases; file 28 §grounding).

Standing failure modes apply across all modalities: hallucination (fluent output unsupported by evidence), grounding failure (claim-to-source mismatch), and latency/memory constraints on device. A capability statement that omits its failure modes is incomplete by atlas rules.

## 7. Device Tiers 0-4

BEAN's client compute assigns devices to tiers 0–4, derived only from a measured capability snapshot plus benchmark evidence, with conservative-by-construction semantics: unknown values lower the tier rather than raise it. Tier 0 means no usable client lane; tier 1 marks a CPU/WASM lane; GPU capability raises the tier; tier 3 marks a WebGPU compute device; tier 4 requires tier-3 capability plus benchmark evidence. The benchmark requirement exists because static capability signals (adapter names, feature flags) do not prove usable throughput: a real WebGPU compute round-trip measures that the device can actually submit work and receive correct results within acceptable time. The scheduler gates every job on consent, visibility, concurrency, memory headroom, model registry state, and a runtime probe before execution — capability claims never skip the gates.

## 8. Privacy Model

BEAN's client-compute privacy model: the user's device executes only that user's work. There is no pooled client compute and no cross-user state; on-device lanes keep inputs local by construction, and the scheduler's consent and visibility gates mean a device never participates in work its owner did not request. Server-side lanes run under the platform's own tenancy and trust rules. Privacy statements in this atlas are architectural, not aspirational: they describe what the scheduler enforces, and are tested in the repo's client-compute privacy suite rather than asserted.

## 9. Relationships

| Sibling | Relation | Rationale |
| --- | --- | --- |
| [24-technology-engineering-and-computing.md](24-technology-engineering-and-computing.md) | generalises | File 24's AI-infrastructure and hardware sections generalise what this file specialises into lanes |
| [28-agent-planning-tools-verification-and-recovery.md](28-agent-planning-tools-verification-and-recovery.md) | applies-to | Agent tool loops consume the inference lanes and capability gates documented here |
| [23-languages-communication-and-social-behaviour.md](23-languages-communication-and-social-behaviour.md) | applies-to | ASR, TTS and multilingual capabilities apply to the language phenomena that file documents |
| [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md) | grounds-in | Claim-evidence labelling follows the schema's honesty rules |
| [00-world-knowledge-coverage-map.md](00-world-knowledge-coverage-map.md) | evidenced-by | The coverage map records this domain's scope and review status |

## 10. References

- Vaswani et al., "Attention Is All You Need", arXiv:1706.03762 — https://arxiv.org/abs/1706.03762
- WebLLM upstream repository — https://github.com/mlc-ai/web-llm
- Transformers.js upstream repository — https://github.com/huggingface/transformers.js
- ONNX Runtime upstream repository — https://github.com/microsoft/onnxruntime
- llama.cpp upstream repository — https://github.com/ggml-org/llama.cpp
- MDN Web Docs, WebGPU API — https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- MDN Web Docs, WebAssembly — https://developer.mozilla.org/en-US/docs/WebAssembly
- OpenAI API reference (OpenAI-compatible wire protocol) — https://platform.openai.com/docs/api-reference
- Anthropic API documentation (Messages protocol) — https://docs.anthropic.com/
