# BEAN AI OPERATIONALIZATION MATRIX

Milestone: Universal AI Operationalization & User Device Acceleration · Branch `feat/ai-operationalization` (local-only; based on the sanitized publication tip `4d134c5794cfe92ff7c8e477f536075e7c8bffb0`) · Compiled 2026-11-18.

Every row was verified against the actual code paths (file:line evidence), not documentation claims. "Current state" reflects the state BEFORE this milestone's implementation; "Implementation" records the exact change made in this milestone (or the honest reason none was needed).

---

## 1. Conversational AI

### 1.1 RIISHE — conversational intelligence

| Field | Information |
|---|---|
| AI system | RIISHE chat (`src/lib/riishe/orchestrator.ts`, UI `src/components/bean/riishe.tsx`) |
| Current state | Working end-to-end (live-verified previously; SSE streaming, tools, research, memory, verification) |
| Purpose | Understand → Retrieve → Solve → Verify → Respond conversations with citations and evidence states |
| Entry point | `POST /api/riishe/chat?stream=1` (SSE) or JSON; sidebar list `GET /api/riishe/chat` |
| Current model | `bean-llm-hosted-primary` — provider-managed checkpoint, not disclosed to tenant (`src/lib/registry/backends.ts`) |
| Runtime | `z-ai-web-dev-sdk` via `hostedLlmAdapter` (`src/lib/adapters/hosted-llm.ts`) with credential-gated fallback chain (OpenAI-compatible → llama.cpp) |
| Tools | `web_search`, `read_url`, `calculate`, `run_code` (sandbox), `read_document`, `analyze_image` — text TOOL_CALL protocol, max 3 rounds |
| Data | History tail (24) + overflow digest, user-approved memories (`RiisheMemory`), evidence pack from research pipeline, document previews, language profile |
| Compute | BEAN server (gateway) — and, NEW in this milestone, the visitor's browser (Tier A on-device lane) |
| Blockers (before) | None for the server path; no device lane existed |
| Implementation | NEW: on-device chat lane (`use-riishe-chat.ts` sendOnDevice → `DeviceCapabilityManager.streamOnDeviceChat` → WebLLM worker, `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`, WebGPU). Honest scope labels (private/unsaved/no retrieval). Size-confirmed download. Server path untouched. |

### 1.2 RIISHE background turns (Tier D adoption)

| Field | Information |
|---|---|
| AI system | RIISHE background job handler (`src/lib/ai-engine/riishe-chat-handler.ts`) |
| Current state | Implemented but not reachable from any product UI |
| Purpose | Long-running turns survive tab close (durable queue, lease recovery) |
| Entry point | `POST /api/ai/jobs {product:'riishe', message, conversationId?}` + SSE replay `/api/ai/jobs/[id]/events` |
| Current model | Same hosted gateway (`bean-llm-hosted-primary`) |
| Runtime | Identical `runGiftzTurnCore`-style shared turn core in worker context |
| Tools | Same tool loop server-side |
| Data | Same conversation/memory construction |
| Compute | Server worker pool (`riishe` pool) |
| Blockers (before) | UI never submitted background chat jobs |
| Implementation | NEW: "Background" composer button (`use-riishe-chat.ts runInBackground`) posting to the existing API; honest queued-note message; worker appends the real answer to the conversation. |

## 2. Coding AI

### 2.1 CODE GIFTZ

| Field | Information |
|---|---|
| AI system | CODE GIFTZ (`src/lib/giftz/turn.ts`, UI `src/components/bean/code-giftz.tsx`) |
| Current state | Working end-to-end (fence protocol → real files, diffs, versions, plan-hash file-ops, sandbox execution, W6 self-verification) |
| Purpose | Chat-first coding assistant with multi-file refactoring and gated execution |
| Entry point | `POST /api/code-giftz/chat` (project-scoped SSE); background `coding-task` |
| Current model | `bean-code-llm-hosted-primary` (hosted gateway; fallback chain as RIISHE) |
| Runtime | `hostedLlmAdapter` via unified gateway; verifier via `BEAN_VERIFY_MODEL` |
| Tools | No native tool calls — path-tagged fences + human-gated sandbox (`unshare -Urn`) |
| Data | `buildProjectContext` smallest-first 24k budget, techdocs retrieval, frontend-intel brief |
| Compute | BEAN server; browser compute = upload preprocessing only (by design — never untrusted code execution on visitors) |
| Blockers (before) | None material |
| Implementation | No code change required (verified working; browser GPU used only for eligible on-device inference, never as a shared code-execution worker — per task §7 the visitor's browser is NOT used for CODE GIFTZ execution). |

## 3. Image AI (LAXII)

### 3.1 LAXII generation / hosted editing / enhancement

| Field | Information |
|---|---|
| AI system | LAXII (`src/lib/laxii/*`, UI `laxii.tsx`) |
| Current state | Working: text-to-image + hosted conversational edit availability reported truthfully; deterministic Sharp enhancement working; masked generative editing honestly BLOCKED (no GPU worker) |
| Purpose | Image creation, preservation-first enhancement, masked editing |
| Entry point | `/api/laxii/generate|edit|enhance` + engine tasks |
| Current model | `bean-image-hosted-primary` / `bean-image-hosted-edit` (provider-managed); `bean-image-local-sharp` (deterministic); `bean-image-selfhosted-diffusers` (disabled until GPU preflight + real inference test) |
| Runtime | Managed SDK images API; local Sharp 0.34; planned local Diffusers worker (shipped, hardware-gated) |
| Tools | Mask painter, dimension planning, typography pipeline, OCR validation |
| Data | ImageAsset storage, reference images, continuity frames |
| Compute | Server + local process |
| Blockers (before) | Browser background-removal model registered but inert (no runtime, no verified checksum) |
| Implementation | NEW: on-device MODNet background removal made operational — artifact pinned (revision `fa2fa546…`, SHA-256 `92e49898…`, 6,632,188 B), onnxruntime-web runtime wired (WebGPU EP attempted → WASM fallback, provider reported), real segmentation handler in the scheduler (`image.segmentation`). Server Diffusers worker stays honestly hardware-gated (no GPU host in this environment — unchanged). |

## 4. Video AI (JAZMII)

| Field | Information |
|---|---|
| AI system | JAZMII (`src/lib/jobs/video-worker.ts`, UI `jazmii.tsx`) |
| Current state | Working: text-to-video (real completed MP4 evidence on record); image-to-video honestly BLOCKED (provider 429, never completed) |
| Purpose | Async text-to-video generation with job tracking, magic-byte + ffprobe artifact validation |
| Entry point | `/api/jazmii/generate` + `/api/ai/jobs` engine task `video-generation` |
| Current model | `bean-video-hosted-primary` (provider-managed); self-hosted candidate recorded, disabled |
| Runtime | Managed async task API + poller with restart re-attach |
| Tools | Reference image, quality modes, ffprobe gate |
| Data | GenerationJob + persisted provider task id (never exposed) |
| Compute | Provider-managed GPU (server) |
| Blockers (before) | i2v requires one completed live run (provider-side throttling measured) |
| Implementation | None required — preserved intact. Honest blocker disclosure retained. |

## 5. Voice / audio AI (GANGZII) — the orphan, now wired

| Field | Information |
|---|---|
| AI system | GANGZII (`src/lib/adapters/hosted-audio.ts`, UI `gangzii.tsx`, 12 API routes) |
| Current state (before) | **Orphaned**: adapter + routes + 1,896-line UI all real and probed (2026-10-27 evidence), but no catalog entry → every route failed NOT_FOUND; audio jobs settled NO_BACKEND (M26 F-G1 regression) |
| Purpose | Speech synthesis (7 voices), speech-to-text, live voice conversation, deterministic format conversion |
| Entry point | `/api/gangzii/tts|transcribe|convert|live|lyrics|music|voices|availability|jobs|audio` |
| Current model | `bean-audio-tts-hosted-primary` / `bean-audio-asr-hosted-primary` (provider-managed, measured limits); `bean-audio-tools-local` (ffmpeg, no model) |
| Runtime | Gateway TTS/ASR (chunked WAV synthesis, leading-tone artifact guard), local ffmpeg |
| Tools | Voice studio, live-voice turn pipeline, dual-mono labeling + ffprobe channel verification |
| Data | Per-user storage outside /public, owner-checked delivery, user-controlled deletion |
| Compute | Server + (NEW) visitor's browser for transcription |
| Blockers (before) | Missing registry wiring (product, backends, adapters, pool, nav, health) |
| Implementation | NEW: catalog entry; 3 backend descriptors with measured limits; router adapters with real cached probes; engine handlers (`speech-synthesis`/`audio-transcription`/`audio-conversion`) in `src/lib/jobs/audio-worker.ts`; dedicated `gangzii` worker pool; kick-list + standalone worker; health route entry with honest not-configured music row; nav + view mount; rate limit 8/min + 80/day. NEW Tier A lane: on-device Whisper-tiny transcription (audio never leaves the browser; size-confirmed). |

## 6. Retrieval & research (shared)

| Field | Information |
|---|---|
| AI system | Research pipeline (`src/lib/research/pipeline.ts`), semantic router, direct lane, Agent Reach lane |
| Current state | Working (gateway web_search/page_reader with per-class breakers; independent direct lane; reach lane optional + honest) |
| Purpose | Evidence-gathering for RIISHE answers and CODE GIFTZ techdocs |
| Entry point | Server-internal (orchestrator), no direct user route |
| Current model | Optional LLM query refinement via hosted gateway (zod-validated) |
| Runtime | Gateway functions class + guarded fetches |
| Tools | web_search, page_reader, channel registry, SSRF guard |
| Data | Freshness-aware cache, evidence pack, staleness/degradation labels |
| Compute | Server |
| Blockers (before) | No vector/embedding RAG existed (deterministic policy design) |
| Implementation | None required — preserved. Embeddings evaluated and NOT adopted this milestone (no consumer with measurable benefit over the policy pipeline; see REPOSITORY_EVALUATION §MiniLM). |

## 7. Intel layer (cross-product conditioning)

| Field | Information |
|---|---|
| AI system | `src/lib/intel/*` — vision (glm-4.5v), grounding, techdocs, world/cinema, language/crosslingual |
| Current state | Working |
| Purpose | Vision analysis, entity grounding, official-docs digests, language profiles |
| Entry point | Server-internal |
| Current model | Vision: provider `glm-4.5v` via gateway; others deterministic/heuristic |
| Runtime | Gateway + ffmpeg frame extraction |
| Tools | Search chains, extract providers |
| Data | Continuity scenes, ontology compile |
| Compute | Server |
| Blockers (before) | None |
| Implementation | None required. |

## 8. Gateway & provider registry (Tier C)

| Field | Information |
|---|---|
| AI system | Unified gateway (`src/lib/ai-gateway/gateway.ts`, `/api/v1/*`) |
| Current state | Working (OpenAI-style contracts, SHA-256 hashed keys, scopes, 30/min + 500/day, usage records, streaming, typed errors, AES-256-GCM provider credentials) |
| Purpose | THE single server-side inference gateway (no parallel gateway built — per task rules) |
| Entry point | `POST /api/v1/chat/completions`, `GET /api/v1/models|providers|usage|health`, keys CRUD |
| Current model | Registry projection (`registry/models.ts` public-safe) |
| Runtime | Hosted lane + prepared OpenAI-compatible lane + llama.cpp lane (credential-gated) |
| Tools | Scope enforcement (`chat:completions`, `models:read`, …) |
| Data | UsageRecord + GatewayRequestLog (no prompts/secrets) |
| Compute | Server |
| Blockers (before) | Capability-aware DEVICE routing did not exist (server fallback chain existed) |
| Implementation | NEW: capability-aware CLIENT-side selection policy (`DeviceCapabilityManager.selectExecutionPath`) implementing the 5-step order (browser GPU → browser CPU → paired local engine → server → honest unavailable), honoring mode/privacy/consent. Server contracts unchanged. |

## 9. Background worker system (Tier D)

| Field | Information |
|---|---|
| AI system | Durable queue (`src/lib/ai-engine/*`, SQLite CAS claims, leases, heartbeats, retry classes, cancel flags) |
| Current state | Working (embedded pools + standalone worker; recovery sweep; SSE event replay) |
| Purpose | Persistent, recoverable, cancellable background execution |
| Entry point | `scripts/ai-workers/worker.ts` / embedded `src/instrumentation.ts` |
| Current model | Handlers: image-generation/enhancement/editing, video-generation, chat, coding-task — and now audio |
| Runtime | Worker pools per product |
| Tools | Approval gates (file-ops plan hash, refactor approval) preserved |
| Data | GenerationJob + JobEvent (append-only) |
| Compute | Server |
| Blockers (before) | GANGZII audio tasks had no handler (settled NO_BACKEND) |
| Implementation | NEW: 3 audio handlers + `gangzii` pool; UI adoption for RIISHE background turns. |

## 10. Device acceleration (Tier A) — built, was inert; now operational

| Field | Information |
|---|---|
| AI system | Client-compute engine (`src/lib/client-compute/*`) + NEW browser runtimes |
| Current state (before) | Framework complete (capability detection, tiers, consent, scheduler, WebGPU/CPU engines, telemetry) with ZERO runtimes/models — honestly inert |
| Purpose | Each visitor's device processes that visitor's own inference (WebGPU; WASM fallback) |
| Entry point | NEW: AI Device settings view; RIISHE on-device toggle; GANGZII on-device ASR toggle |
| Current model | NEW: `riishe-chat-webllm-qwen2.5-0.5b` (289,693,824 B measured, revision-pinned), `gangzii-asr-browser-whisper-tiny` (43,622,127 B q8 set, revision-pinned), `laxii-bgremoval-modnet` (6,632,188 B, SHA-256-pinned) |
| Runtime | NEW: `@mlc-ai/web-llm@0.2.89` (WebGPU LLM), `@huggingface/transformers@4.3.2` (ONNX pipelines), `onnxruntime-web@1.31.1` (self-hosted WASM assets) |
| Tools | DeviceCapabilityManager (measured capabilities, memory budget policy, residency, honest §8 statuses), error catalog with recovery, Web Workers for all inference |
| Data | Browser-managed caches (BEAN Cache API + WebLLM/Transformers.js caches) with explicit user control |
| Compute | Visitor's device |
| Blockers (before) | No runtime dependencies, no models, no runtime probes |
| Implementation | NEW: full runtime layer (see UNIVERSAL_AI_ARCHITECTURE §Tier A) — engines, workers, clients, selection policy, settings UI, consent, real download gates. |

## 11. Dead / disconnected surfaces found and fixed

| Surface | Problem found | Fix in this milestone |
|---|---|---|
| `/api/gangzii/*` (12 routes) | All failed `NOT_FOUND 'Unknown BEAN product.'` (preflight) | Product + backends + adapters registered |
| GANGZII UI | 1,896 lines mounted by nothing | Nav + view mount |
| GANGZII audio jobs | Settled `NO_BACKEND` forever (F-G1) | Real handlers + pool (regression test updated honestly) |
| `laxii-bgremoval-modnet` registry entry | `sha256: null`, source URL pointed at a repo PAGE (HTML), `enabled: false` | Exact artifact URL + measured SHA-256 + enabled |
| `image.segmentation` kind | Registered with NO handlers | Real onnxruntime-web handler |
| RIISHE background jobs | API existed, no UI path | Composer "Background" action |
| GANGZII microphone | `Permissions-Policy: microphone=()` blocked getUserMedia | `microphone=(self)` (same-origin only) with rationale |

## 12. Systems verified and intentionally NOT changed

- BEAN FX / BEAN Folio: do not exist in this repository (boundary preserved).
- LAXII Diffusers worker: complete code path, disabled pending GPU host + real inference acceptance (honest; unchanged).
- JAZMII image-to-video: provider-side blocker (measured 429s; never completed) — disclosed, unchanged.
- GANGZII music generation: no configured backend — honest NO_BACKEND refusal preserved (row added to health).
- Existing API gateway, provider registry, auth, retrieval, queues, sandbox, approval gates: preserved (additive changes only).
