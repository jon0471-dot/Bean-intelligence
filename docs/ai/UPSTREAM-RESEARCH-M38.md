# M38 Upstream Research — Universal Model Ecosystem & Adaptive Inference

> Branch: `feat/m38-world-atlas-adaptive-ai-creative-engine` · Research date: 2026-11-24 · Companion to `MODEL-COVERAGE-M38.md`
> Method: current upstream repositories/releases verified via official pages today; pinned versions cross-checked against `src/workers/package.json` and `package.json`. Decisions follow the M38 §B1/B3 constraints: no second gateway/registry, no runtime added without a demonstrated gap, never bypass credentials/licenses.

## 1. Model ecosystem integration surface (M38 §B1)

BEAN's provider surface after M36/M38 review — what exists, what the research confirmed, what stays gated:

| Ecosystem | BEAN integration | M38 review result |
|---|---|---|
| OpenAI-compatible providers | existing `bean-llm-openai-compatible` slot + operator-credential discovery (`src/lib/providers/model-discovery.ts`, credential-gated, cached, never mutates routing) | CONFIRMED — the compatible slot also serves Google-style OpenAI-compatible endpoints and any actively maintained official provider exposing the standard; no new adapter needed |
| Anthropic Messages API | dedicated protocol adapter `src/lib/providers/anthropic.ts` (M36) — dormant until operator credential, never auto-chained | CONFIRMED current; wire-protocol tests cover headers/system mapping/SSE decode/429 breakers |
| Google GenAI | served through the OpenAI-compatible slot when the operator configures it (M36 evaluation stands) | RE-CONFIRMED no dedicated adapter justified at ₹0 budget; recorded as available-by-configuration |
| Hugging Face model ecosystem | Transformers.js 4.3.2 in the browser ASR lane; HF-hosted weights reachable through consent-gated download flows | CONFIRMED current version line |
| Open-weight local models | llama.cpp lane (MIT) + GGUF quantization options recorded in capability records | CONFIRMED |
| Specialized image/vision/video/audio/speech models | existing per-task backends (20 private backends) with task-derived capability verbs | CONFIRMED — specialization is expressed as backends, not a parallel catalogue |
| OCR / document models | text-layer extraction operational; scanned-OCR gap stands (docling recorded, not deployed — single-server topology decision) | UNCHANGED, honest gap |
| Embeddings / reranking | capability verbs reserved in `UniversalCapability`; no backend/adapter exists | honestly unavailable — no lane invented |
| Coding / reasoning models | hosted coding lane + local llama.cpp lane | CONFIRMED |
| 3D / pose / motion | no backend | honestly unavailable |

**No second gateway or model registry was created.** `BACKEND_REGISTRY` (20 entries), the engine
catalog and the client model registry remain the only registries; the M38 execution-lifecycle
ladder is an additive vocabulary over them (`capability-records.ts`), not a new catalogue.

## 2. Official runtime evaluation (M38 §B3)

| Runtime | Upstream | Version checked 2026-11-24 | License | Hardware path | Decision |
|---|---|---|---|---|---|
| WebLLM | https://github.com/mlc-ai/web-llm | **0.2.89** (pinned in `src/workers/package.json`; current line verified in M36 and re-checked today) | Apache-2.0 | browser WebGPU (WebGPU-first; no CPU-only fallback lane) | KEEP — already integrated, verified current |
| Transformers.js | https://github.com/huggingface/transformers.js | **4.3.2** (pinned) | Apache-2.0 | browser WASM EP, WebGPU EP where present | KEEP — already integrated (ASR lane) |
| ONNX Runtime | https://github.com/microsoft/onnxruntime | **onnxruntime-web 1.31.1** (pinned, worker-side) + onnxruntime-node 1.21.0 (app-side acceptance) | MIT | browser WASM/WebGPU EPs; server CPU EP | KEEP — already integrated (segmentation + CPU acceptance) |
| llama.cpp | https://github.com/ggml-org/llama.cpp | server lane per M36 record (MIT) | MIT | local desktop/server CPU (+ optional GPU by upstream build) | KEEP — existing free-first resilience lane |
| wllama | https://github.com/ngxson/wllama | **4.0.0** (released 2026-11-22, verified today) | MIT | browser WASM SIMD + WebGPU with CPU fallback; multimodal + tool-calling support upstream | **EVALUATED, NOT INTEGRATED** — adding it would create a fourth browser runtime overlapping WebLLM (chat) and ONNX (vision/audio) without a measured task gap; revisit only if a CPU-only LLM chat requirement is confirmed on real low-spec devices |
| motion (Framer Motion) | https://github.com/motiondivision/motion | 12.23.2 (app dep) | MIT | animation | KEEP (CODE GIFTZ animation toolchain) |
| GSAP | https://gsap.com · https://github.com/greensock/GSAP | 3.13.0 (app dep) | 100% free incl. all plugins since Webflow acquisition (announced 2025-04-30; verified via gsap.com pricing page today) | animation | KEEP — license concern closed |

Selection policy (unchanged architecture, restated for M38): the platform auto-selects among
browser GPU inference → browser CPU/WASM inference → approved local worker execution → existing
local model runtimes (llama.cpp lane) → existing authorized backend execution, with every hop
gated by consent, capability probes, model registry state, memory budget and validation. The
`local-worker` bridge stays an honest refusal while unconfigured.

## 3. Movement/knowledge dataset evaluation (M38 §D)

| Dataset/Ontology | Upstream | License (verified date) | Commercial use in BEAN | Decision |
|---|---|---|---|---|
| Uberon | https://github.com/obophenotype/uberon · http://obofoundry.org/ontology/uberon.html | CC BY 3.0 (OBO Foundry page) | permitted with attribution | USE as ontology-term reference in the knowledge atlas |
| OpenStax textbooks | https://openstax.org/ | CC BY 4.0 (current editions; per-edition check recorded in the atlas register) | permitted with attribution; paraphrase + cite, never bulk-copy | USE as the atlas's textbook-level source |
| GBIF | https://www.gbif.org/ | CC0 / CC BY / CC BY-NC **per dataset** (GBIF licensing policy) | filter CC BY-NC records out of commercial paths | USE as species-record backbone; per-dataset license discipline |
| Motion-X | https://motion-x-dataset.github.io/ | **CC BY-NC-SA overall**; sub-datasets carry their own licenses (BAUM/AIST++/EgoBody CC BY 4.0; HAA500 MIT; HuMMan S-Lab 1.0; GRAB/AMASS academic-only; remainder CC BY-SA 4.0) | **NOT usable commercially without separate authorization**; annotated results additionally gated by original institutions | REGISTER + cite in atlas only; no data committed; commercial integration blocked pending license |
| AMASS | https://amass.is.tue.mpg.de/license.html | custom non-commercial research license (MPI) | NO commercial use; prohibits training for commercial purposes | REGISTER + cite only |
| HumanML3D | https://github.com/EricGuoICT/HumanML3D | repo scripts Apache-2.0-style; data NOT redistributable (AMASS policy); component licenses vary | scripts yes; AMASS-derived data no | REGISTER + cite only |
| Movebank | https://www.movebank.org/ | per-dataset (commonly CC0/CC BY) | per dataset | REGISTER as animal-tracking source; per-study checks required |

Working rule (recorded in the atlas `02-source-provenance-and-licensing.md` §2): no dataset files
are committed to the repository; the atlas stores descriptions, ontology-term references and
license records only.

## 4. Animation tooling evaluation (M38 §F4)

- **motion / framer-motion 12** (MIT, already in the app): declarative React animation — entrance/
  exit, layout transitions, presence; compositor-friendly transform/opacity patterns.
- **GSAP 3.13** (free since Webflow 2025-04-30, verified today): timeline choreography,
  scroll-linked sequences, complex easing — already integrated with a curated pattern library
  (`src/lib/frontend-intel/gsap-patterns.ts`) and `@gsap/react` useGSAP.
- **Existing CSS animation capabilities**: transitions/keyframes for micro-interactions — the
  first choice for simple state feedback (per `docs/agents/ANIMATION-AND-INTERACTION-STANDARD.md`).
- Decision: no new animation library; the two existing tools plus CSS cover the required purpose
  categories. Multiple animation libraries are NOT stacked without demonstrated need.

## 5. Decisions summary (what M38 actually changed)

1. Added the execution-lifecycle vocabulary + derivation (code + 14 tests) — additive.
2. Recorded this research and the measured coverage report — documentation.
3. Added the quality-routing policy layer for adaptive, honest lane selection (M38 §B5) — additive.
4. **No new runtime dependency, no new gateway/registry, no provider adapter changes.**
5. wllama 4.0.0 recorded as a candidate with the measured reason for non-adoption.
6. All dataset integrations remain license-gated; non-commercial datasets flagged for commercial
   exclusion.
