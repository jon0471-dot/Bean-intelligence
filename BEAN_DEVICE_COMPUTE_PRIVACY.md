# BEAN DEVICE COMPUTE PRIVACY

Milestone: Universal AI Operationalization & User Device Acceleration · 2026-11-18.

This document is the privacy contract for device acceleration. It is written as enforceable behavior (each rule cites the code that enforces it), not as aspirations.

---

## 1. The core guarantee

**Every visitor's device processes that visitor's own AI requests — and nothing else.**

| Never happens | Enforced by |
|---|---|
| A visitor's GPU executes another person's job | There is no shared/distributed compute path anywhere in the codebase: device engines are invoked only from the device owner's own UI actions (`DeviceCapabilityManager.streamOnDeviceChat / transcribeLocally`); no server route can dispatch work to a browser. The optional sanitized capability report contains no task payload and is the ONLY data surface that can leave the device, and only with consent |
| Background compute after opt-out | Every device handler consults `isDeviceComputeAllowed()` (consent gate) via the scheduler; the selection policy returns the server lane or honest-unavailable when consent is absent (`device-capability-manager.ts` `selectExecutionPath`) |
| CPU/GPU mining or unrelated workloads | The scheduler only runs registered task kinds (`image.preprocess`, `image.chroma-cutout`, `image.segmentation`, on-device chat/ASR); there is no generic compute executor and no third-party task surface |
| Local model files uploaded to BEAN | Model bytes live in browser caches (BEAN Cache API / WebLLM / Transformers.js caches). No upload path exists; the capability report carries model IDs only (`CapabilityReport.installedModels` — ids, verified only) |
| User prompts or private files transferred to another visitor | Device lanes never transmit payloads at all; server lanes go only to BEAN's own gateway (existing contracts); the local engine lane talks only to loopback |
| Hidden service workers performing inference without knowledge | Inference runs in foreground module workers spawned by explicit user actions; no service worker performs AI work; the first on-device use requires the consent switch plus (for any model download) a size-confirmed approval |

## 2. Consent architecture

- `ClientComputeConsent` (`privacy.ts`, key `bean.clientCompute.consent.v1`): `granted` (explicit opt-in, default absent = OFF) and `localOnly` (backend fallback forbidden). The scheduler consults it on EVERY fallback decision — a privacy expectation is never silently changed by a fallback.
- The AI Device settings page exposes both switches; RIISHE/GANGZII on-device toggles refuse to enable without consent and point the user to the settings.
- Withdrawing consent stops all device compute immediately (subsequent selections route to the server lane or report unavailable).

## 3. Download consent and control

- Nothing downloads on page load. Every model download requires an explicit confirmation dialog that shows the MEASURED byte size (e.g. "289.7 MB — Qwen2.5-0.5B-Instruct, Apache-2.0, WebGPU") before any fetch.
- Downloads report real progress; they can be cancelled; caches can be cleared per model (bean-managed artifact delete; WebLLM namespaces `webllm/model|wasm|config`; runtime-managed entries document their cache ownership).
- Integrity: bean-managed artifacts must match the pinned SHA-256 or they are refused and never installed; runtime-managed weights are fetched from a revision BEAN pins by measured commit SHA.

## 4. Resource-aware scheduling (protecting the user's hardware)

| Rule | Implementation |
|---|---|
| One large generative model per browser tab | `WebLlmChatClient` singleton (`getSharedWebLlmClient`); switching models unloads the previous engine first (`webllm-worker.ts ensureEngine`) |
| Avoid multiple large models concurrently | One chat engine + one ASR pipeline max; segmentation is bounded and on-demand; the resource manager caps concurrent heavy tasks (`resource-manager.ts`) |
| Unload inactive models under memory pressure | Explicit Unload control (settings + engine unload); page-lifecycle handling in the resource manager (`attachPageLifecycle`); GPU device loss maps to `AI_GPU_DEVICE_LOST` with retry guidance |
| Cancellation always available | Stop button (interruptGenerate), AbortSignal propagation through workers, `AI_GENERATION_CANCELLED` semantics |
| No heavy compute while hidden / under pressure | Conservative tier mode tightens concurrency + memory budget; task admission respects resource classes; tab-suspension surfaces honest state (`AI_TAB_SUSPENDED` catalog entry) rather than pretending to run |
| Reduced-data / reduced-power respect | CPU-only mode; small model set (0.5B chat / tiny ASR); no autoplay of model downloads |

## 5. Data flows (complete map)

| Lane | Prompt/media | Model weights | Metadata |
|---|---|---|---|
| Tier A device chat (WebGPU) | Stays in the browser | Browser cache (WebLLM) | Nothing leaves the device; the thread is labeled "on-device · private · unsaved" — turns are NOT persisted server-side |
| Tier A device ASR | Recording decoded + transcribed in-browser; never uploaded | Browser cache (Transformers.js, pinned revision) | Nothing leaves the device |
| Tier A device segmentation | Image processed in-browser | Browser cache (BEAN-managed, SHA-256 verified) | Nothing leaves the device |
| Tier B local engine | Prompt sent to `http://127.0.0.1:<port>/v1` ONLY | On the user's disk (operator-provided GGUF) | The pairing key stays in localStorage; BEAN servers never see engine traffic |
| Tier C server lanes | Sent to BEAN's gateway (existing contracts; provider credentials stay server-side) | Provider-side | Usage records without prompts/secrets (existing `UsageRecord`/`GatewayRequestLog` design) |
| Tier D background jobs | Sent to BEAN's gateway via the durable queue (existing contracts) | Provider-side | Job rows + events, owner-scoped, deletion controls |

## 6. Diagnostics and telemetry

- Diagnostics are redacted by construction (`redactForDiagnostics`): long strings are truncated to bounded labels; media/prompt payloads never enter notes.
- The sanitized `CapabilityReport` (tier, coarse flags, installed model IDs) is the only shareable device surface, requires explicit consent, and excludes vendor/architecture strings, user agents, raw model info and any payloads. The on-device status view computes everything locally by default — sharing is opt-in.

## 7. Local engine security

- Loopback-only pairing: `localEngineBaseUrl` refuses any non-loopback host (unit-pinned). Non-loopback addresses are never stored (settings sanitization drops them).
- Pairing verifies the engine identity (`/v1/models` with the key) and records what answered; reachability is measured, never assumed (`AI_LOCAL_ENGINE_UNREACHABLE` on failure).
- The API key is stored ONLY in the visitor's localStorage, sent ONLY to the loopback engine, and never transmitted to BEAN. Unpair deletes it.
- Documented server posture: `llama-server --host 127.0.0.1 --api-key <secret>`; with an API key set, cross-origin pages cannot use the engine (they lack the key), and BEAN's own origin policy is unaffected. `--cors-origins` can further restrict origins for defense in depth.

## 8. What this architecture deliberately does NOT do

- No shared/distributed visitor compute (would be a separate opt-in architecture with task isolation, verification, privacy and abuse controls — explicitly out of scope per the task).
- No silent capability probing loops; detection runs once per tab (cached) and on explicit re-measure.
- No device fingerprinting: capability detection reads feature availability (WebGPU adapter, WASM/SIMD, workers, coarse memory bucket, storage estimate) — never hardware identity, never user-agent-based decisions.
