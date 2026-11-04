# BEAN AI Model Expansion Plan

**Date:** 2026-11-04 · **Status:** Evaluation, not deployment — nothing here is claimed operational without evidence
**Branch/HEAD:** `main` @ `df2fd0d`

> Truth policy: this plan separates three evidence classes explicitly —
> **[LIVE]** verified in this repo by real execution, **[DOCU]** verified against the provider's official documentation (link given), **[EST]** estimate that must be re-verified at procurement time. No capability is registered into the runtime registry before it passes the same real-execution gate the four core products went through.

---

## 1. What the deployment can execute TODAY [LIVE]

The authorized hosted gateway (the platform-provided inference agreement) exposes — verified against the installed SDK's typed surface (`node_modules/z-ai-web-dev-sdk/dist/index.d.ts`) and, where marked, by real execution in this repo:

| Capability | SDK surface | Used by | Execution evidence |
|---|---|---|---|
| Chat completions (streaming, thinking toggle) | `chat.completions.create` | RIISHE, CODE GIFTZ | prior live acceptance (6 completed coding jobs; RIISHE 66/67 R3) |
| Vision (multimodal input: image/video/file URLs) | `chat.completions.createVision` | (not yet productized) | typed surface verified [DOCU] |
| Web search / page reader | `functions.invoke` | RIISHE research | prior live acceptance [LIVE] |
| Text-to-image (7 fixed sizes) | `images.generations.create` | LAXII | prior live acceptance (5 completed jobs) [LIVE] |
| **Image editing (image + prompt → edited image)** | `images.generations.edit` | LAXII (new, this programme) | adapter + job branch shipped; live run pending gateway recovery [LIVE code, LIVE run blocked by account 429] |
| **Video generation (async task + polling)** | `video.generations.create` + `async.result.query` | JAZMII (new, this programme) | adapter + worker + media route shipped; live run pending gateway recovery |
| Speech synthesis (TTS) | `audio.tts.create` | GANGZII [LIVE] | real adapter in `src/lib/adapters/hosted-audio.ts` |
| Speech recognition (ASR) | `audio.asr.create` | GANGZII, file transcription [LIVE] | real adapter in `src/lib/files/media.ts` |

Consequence: the "expansion" for this deployment is primarily (a) wiring the **already-capable** gateway surface into honest product APIs, (b) a credential-gated external provider path for models the gateway does not serve, and (c) careful evaluation of open-weight self-hosting — which is hardware-gated (see §5).

## 2. Candidate evaluation — text and coding

| Candidate | Actual capability | Official API / repo | License | Commercial use | API cost [EST, verify at procurement] | Latency | Quality | Deployment complexity | Production verdict |
|---|---|---|---|---|---|---|---|---|---|
| OpenAI GPT API | Text, reasoning, tools, structured output | platform.openai.com | Proprietary ToS | Yes (ToS) | GPT-class tiers from ~$0.15–$15 /1M tok depending on model tier | Low–mid | Frontier | Low (OpenAI-compatible client already exists in the gateway: `bean-external-openai-compatible`) | **Adopt when a credential is provided** — the external path is built, typed (429/auth/billing), and awaiting-credentials |
| Google Gemini | Text, vision, long context | ai.google.dev | Proprietary ToS | Yes | Flash tiers ~$0.10–$4.50 /1M tok; image output ~1120 tok/1K-image on Flash-Lite Image class [DOCU: cloud.google.com/model-garden/pricing] | Low | Frontier | Low–medium | Adopt behind the same external adapter only after per-credential isolation is verified |
| Anthropic Claude | Text, coding, long context | api.anthropic.com | Proprietary ToS | Yes | Sonnet-class ~$3/$15 per 1M in/out [EST] | Mid | Frontier (coding) | Low | Same adoption path; useful as a SECOND verifier opinion in W6-style verification (different model family = real independence) |
| DeepSeek | Text, coding; open weights (MIT for V3/R1 line) | Official API + open-weight repos | MIT (weights) / API ToS | Yes | API very low (~$0.3–$1.5 /1M tok [EST]); self-host GPU-bound | Mid | Strong coding/value | Low (API) / High (self-host) | API: reasonable cost fallback. Self-host: not on this sandbox (no GPU) |
| Qwen | Text, coding; open weights (Apache-2.0 line) | Official API + HF repos | Apache-2.0 (most sizes) | Yes | Low [EST] | Mid | Strong | Low (API) / High (self-host) | Same as DeepSeek |
| Mistral | Text; open-weight line (Apache-2.0) + hosted | api.mistral.ai | Apache-2.0 weights / commercial API | Yes | Low [EST] | Low–mid | Mid | Low (API) | Optional; not needed while gateway serves chat — avoids catalogue bloat |

**Decision:** do NOT add any of these as separate UI products. They join the internal capability registry as chat-capable backends. Priority order if credentials arrive: OpenAI (existing adapter), Anthropic (verifier independence for W6), DeepSeek/Qwen (cost fallback). The UI-facing products remain RIISHE / CODE GIFTZ.

## 3. Candidate evaluation — image

| Candidate | Capability | Official source | License | Cost [EST] | Production verdict |
|---|---|---|---|---|---|
| GPT Image (gpt-image-1 line → 2.x line) | T2I + strong instruction editing, multi-reference | developers.openai.com/api/docs/guides/image-generation | Proprietary | ~$0.005–$0.211/image by tier [DOCU: pricing calculator, Nov 2026]; retired DALL·E ids removed from API May 2026; GPT Image 1.5 / 1 Mini retire Dec 1 2026 — **only current model ids may be configured** (mission rule) | **Adopt when credential provided** — LAXII's editing UX is already built against the gateway's images.edit; an OpenAI adapter slots the same `editImage` seam |
| Google Nano Banana (Gemini image) | T2I + conversational editing, character consistency | ai.google.dev/gemini-api/docs/image-generation | Proprietary | Flash-Lite Image class ~$0.034/1K-image-output [DOCU: Model Garden pricing] | Same adoption seam; evaluate against GPT Image on edit-precision when both exist |
| FLUX family | T2I/img2img open weights | black-forest-labs (repo) | FLUX.1-dev is **non-commercial**; FLUX.1-schnell Apache-2.0 | Self-host: GPU (≥24 GB VRAM class for dev; 16 GB tight) | **Do not adopt dev weights** (license + VRAM). Schnell-only would be a quality downgrade vs hosted — reject for now (recorded decision, matches the 2026-10-31 engine decision matrix) |
| Stable Diffusion (SD 1.5 / SDXL) | T2I/inpaint/img2img | github.com/huggingface/diffusers | OpenRAIL-M / OpenRAIL++-M (commercial OK with use restrictions) | Free weights; GPU required; ~2–4 GB VRAM SD1.5, 8–12 GB SDXL | Already the SELECTED engine for the local Diffusers worker (masked inpaint path) — pending hardware preflight on the target GPU host (RTX 5060 Ti 16 GB reported). No change |
| Identity preservation (InstantID / IP-Adapter) | Face/identity conditioning | github.com/InstantID/InstantID, github.com/cubiq/ComfyUI_IPAdapter_plus | InstantID: research-restricted weights; IP-Adapter: Apache-2.0 (base), FaceID variants restricted | Free weights, GPU | **InstantID rejected for production** (license + ethics controls); IP-Adapter (non-FaceID) stays the candidate via the local worker. Face-identity claims remain gated on consented reference images + measurable similarity, as implemented |

## 4. Candidate evaluation — video

| Candidate | Capability | Official source | License | Cost [EST/DOCU] | Production verdict |
|---|---|---|---|---|---|
| BytePlus Seedance | T2V/I2V, 480–1080p, up to 30 s (2.5), references | docs.byteplus.com (ModelArk) | Proprietary ToS | Seedance 2.5: 5 s 16:9 ≈ $0.514 (480p) / $1.156 (720p) / $2.843 (1080p); 2.0 series cheaper [DOCU: framesurfer pricing audit Sep 2026 — re-verify on the official pricing page] | **Adopt when credential provided** — JAZMII's async job architecture (submit/poll/media) is provider-agnostic; a Seedance adapter implements the same VideoAdapter seam |
| Google Veo | T2V/I2V with audio | ai.google.dev/gemini-api/docs/video | Proprietary ToS | ~$0.03–$0.60/s by tier [DOCU: pricing calculators Nov 2026]; NOTE — Veo 3.1 *Preview* access in the Gemini API was shut down Oct 22 2026; only GA endpoints qualify | Adopt on the same seam; verify the CURRENT GA video endpoint before any integration work is written |
| Wan 2.2 (open weights) | T2V/I2V, 480p/720p class | github.com/Wan-Video/Wan2.2 | Apache-2.0 (mainline) | Free weights; T2V-A14B class wants ~24 GB VRAM (offload tricks reduce it); 5 s clip ≈ minutes on consumer GPUs | **Blocked by hardware** in this sandbox (no GPU). On the RTX 5060 Ti 16 GB workstation: only the 5B-class variants are plausible, quality below hosted. Keep as candidate for the GPU worker path; do NOT auto-download weights (size/VRAM/disk preflight first — implemented as worker preflight) |
| CogVideoX | T2V/I2V open weights | github.com/THUDM/CogVideo | Apache-2.0 series | Free weights; 2B class runs on 12–16 GB with quantization; quality below Wan/Seedance | Optional worker candidate only; not worth the queue slot while hosted video exists. Recorded, not adopted |
| Google Flow | (application, not an API) | — | Proprietary app | — | **Not integrable** — no official API; BEAN builds a comparable UX with legitimate Veo API capabilities only. Never claimed to be "Flow source" |

## 5. Audio [LIVE] + candidates

Already real and productized through the authorized gateway [LIVE]: **TTS** (GANGZII voices), **ASR** (GANGZII transcription, file transcription), plus the audio task taxonomy (speech-synthesis / audio-transcription / audio-conversion / music-generation) registered in the product registry.

Candidates beyond the gateway, for future evaluation — same registry gate, no UI products:

| Capability | Candidates | License | Verdict |
|---|---|---|---|
| Speech-to-text (extra) | OpenAI Whisper API / open whisper-large-v3 (MIT) | API proprietary; weights MIT | API reasonable; local whisper needs only ~10 GB VRAM (large) or CPU for small — plausible on the workstation; adopt only if GANGZII coverage is proven insufficient |
| Text-to-speech (extra) | ElevenLabs (proprietary), OpenAI TTS, Piper (MIT, local) | varies | Gateway TTS covers the need; revisit on voice-quality demand. Piper is the low-risk local fallback |
| Voice activity detection | Silero VAD (MIT) | MIT | Tiny, CPU-class, trivially embeddable — adopt opportunistically for transcription preprocessing |
| Subtitles / translation | Whisper-derived pipelines + ASR translation | MIT / API | Build on ASR once demand exists; no new model needed |

## 6. Capability registry integration path (Phase 7 alignment)

The central registry (`src/lib/registry/`) is already the single internal source of truth: backend descriptors (provider adapters + limits + concurrency + timeouts + retry policy + license + metering), the routing layer, the public-safe model projection, and the health probes. Expansion = adding a `BackendDescriptor` + adapter, gated by:

1. **Real execution gate** — a scripted adapter test with the SDK boundary mocked + one live acceptance run recorded in a report before `enabled: true` flips.
2. **Credential gate** — external providers stay `awaiting-credentials` (typed `PRODUCT_UNAVAILABLE`) until an administrator stores a credential server-side (`ProviderCredential`).
3. **No UI surface** — products stay RIISHE / LAXII / JAZMII / CODE GIFTZ (+ GANGZII audio); new models are reachable only through the same product APIs.

## 7. Cost control (non-negotiable for any adoption)

- Every backend carries `metering` + usage records (`UsageRecord` with `costMicros: null` until a provider reports real cost data — never invented).
- Per-principal gateway burst limit + durable daily quota; per-backend concurrency caps; registry `retries.maxAttempts: 1` (no retry storms, no uncontrolled spend).
- 429 handling everywhere: per-endpoint-class escalating breaker (60 s → 600 s cap), fail-fast with zero network traffic, honest `RATE_LIMITED` reporting.
- No model weight download before a storage/disk/VRAM/RAM preflight report (the local worker's preflight enforces this in code).

## 8. Explicitly rejected / recorded decisions

- **InstantID weights** — research-restricted license; rejected for production (identity preservation via IP-Adapter non-FaceID + consented reference images instead).
- **FLUX.1-dev** — non-commercial license; rejected. (FLUX-schnell technically clean but a quality downgrade with no GPU to run it.)
- **Google Flow** — proprietary application; no API; never copied or claimed.
- **Catalogue inflation** — adding models without a use does not improve the product; every candidate must name the product seam it improves.
- **Second video queue** — JAZMII uses the existing in-process job queue; no parallel queue system is introduced.
