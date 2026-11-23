# BEAN Client-First Hybrid Compute Engine — Architecture

Milestone: BEAN client-first hybrid compute · Companion docs:
`docs/BEAN-CLIENT-COMPUTE-AUDIT.md` (Phase 0), `docs/BEAN-CLIENT-COMPUTE-SECURITY.md`,
`docs/BEAN-CLIENT-COMPUTE-IMPLEMENTATION-REPORT.md`.

## 1. What was built (and where)

A shared, client-first hybrid compute engine inside THIS repository — the only BEAN
product repository (audit Section 1). It lives in `src/lib/client-compute/` and follows
the existing monorepo conventions: TypeScript strict, client-safe modules (no Node-only
imports anywhere in the engine), additive to every existing product pipeline.

```
src/lib/client-compute/
  types.ts            typed contracts (task, capability, profile, consent, states, reports)
  capabilities.ts     real browser capability detection (WebGPU/WebGL/WASM/Workers/storage)
  device-profile.ts   tier derivation (0–4) + bounded opt-in CPU benchmark
  privacy.ts          explicit consent store + local-only enforcement + redaction
  fallback.ts         honest execution states + privacy-safe fallback decisions
  scheduler.ts        the centralized 12-step task scheduler
  webgpu/engine.ts    WebGPU execution engine (device lifecycle, loss/OOM, buffer cleanup)
  webgpu/compatibility.ts  GPU operation registry (nothing runs on GPU without an entry)
  cpu/engine.ts       bounded CPU lane (Web Workers, cancellation, crash honesty)
  model-registry.ts   client model registry + download policy (approval, checksum, quota)
  resource-manager.ts one-heavy-model slot, concurrency caps, page-shutdown cleanup
  validate.ts         per-kind output validators (no completion without validation)
  telemetry.ts        local diagnostics ring + sanitized capability report builder
  adapters/
    laxii.ts          LAXII client adapter (preprocess, chroma cutout, model-gated segmentation)
    image-kernels.ts  pure, worker-serializable image math (downscale, chroma key)
    image-io.ts       injectable decode/encode (browser defaults: createImageBitmap + canvas)
    code-giftz.ts     CODE GIFTZ advisory analysis kernel (balance + relative imports)
    jazmii.ts         JAZMII reference pre-check + video thumbnail capture
  index.ts            getClientCompute() singleton wiring + report sharing
```

Server-side additive pieces: `src/app/api/client-compute/reports/route.ts`
(authenticated capability-report storage) and the `ClientComputeReport` Prisma model
(additive table, verified via `prisma migrate diff` before `db push`).

## 2. Core contract

The spec's target contract maps 1:1 onto implemented methods:

| Contract target | Implementation |
|---|---|
| `detectCapabilities()` | `capabilities.ts::detectCapabilities()` — always resolves; non-DOM → honest `'non-browser'` snapshot |
| `getDeviceProfile()` | `device-profile.ts::deriveDeviceProfile()` — tier 0–4 from measured facts only |
| `registerTask()` | `ComputeScheduler.registerTask()` — validates, never executes |
| `scheduleTask()` | `ComputeScheduler.scheduleTask()` / `runTask()` — the 12-step process |
| `executeOnGPU()` | `WebGpuEngine.execute()` — registry-gated, timeout, cancellation, auto buffer cleanup |
| `executeOnCPU()` | `CpuEngine.runFunction()` — worker pool, cancellation, progress, main-thread policy |
| `loadLocalModel()` | `ModelRegistry.requestDownload()` — approval + checksum + quota gated |
| `reportProgress()` | scheduler/handler progress events → local ring + observer callback |
| `cancelTask()` | `AbortSignal` end-to-end (scheduler, engines, handlers) |
| `releaseResources()` | `WebGpuEngine.releaseAll()`, `CpuEngine.releaseAll()`, `ResourceManager.releaseAll()`, pagehide hook |
| `validateOutput()` | `validate.ts::validateOutput()` — per-kind; unknown kinds FAIL honestly |
| `getComputeStatus()` | `ClientCompute.getStatus()` — minimal, honest UI surface |

## 3. Scheduling model

Every task descriptor carries: product id, kind, input, capability requirements,
workload feasibility, resource class, privacy class, timeout, priority, fallback
policy, abort signal. The scheduler executes, in order:

1. validate descriptor + kind registration (product ownership enforced)
2. duplicate prevention (active `productId:kind` key)
3. consent gate — **no device execution without explicit consent**
4. capability snapshot + device profile (real measurement)
5. model gate — required runtime installed? model verified-installed?
6. feasibility gates — capability requirements, policy memory budget, device-task
   admission (concurrency), tab-visibility refusal
7. target selection — every candidate must pass ALL gates; the fixed order
   (GPU → CPU → local worker → backend) never overrides feasibility; missing GPU
   registry entries make the GPU target unreachable by construction
8. execution with enforced deadline (a handler that ignores abort still loses the race)
9. progress events (redacted notes only)
10. **mandatory output validation** — failed validation = failed task, never completion
11. resource release (per-task GPU buffers destroyed; device tasks end)
12. honest result: one of the 11 spec states, with a per-target attempts trail

The final result prefers the most recent REAL execution failure over a trailing gate
refusal, so the honest cause surfaces in UI.

## 4. Execution targets

- **client-gpu** — WebGPU engine. Currently intentionally EMPTY of workloads: no BEAN
  kernel has a GPU compatibility entry yet, so the GPU lane is plumbed and tested but
  never selected. Entries land with their kernels.
- **client-cpu** — Web Workers via a generic kernel protocol (blob-URL workers). Kernels
  must be self-contained pure functions (serialized with `Function.prototype.toString`);
  adapter tests enforce serialization parity. Main-thread fallback is explicit-opt-in
  only; heavy/medium workloads are refused without workers.
- **local-worker** — Phase 12 investigation item. The scheduler reports the honest
  refusal (`local worker bridge is not configured`) until an authenticated loopback
  bridge exists. No bridge was built this milestone.
- **backend** — a per-product delegate to the product's OWN authenticated routes. The
  server remains authoritative; client reports are evidence, never self-attestation.

## 5. Product adapters (audit-driven)

| Product | Adapter | Status |
|---|---|---|
| LAXII | `image.preprocess` (downscale/compress before upload), `image.chroma-cutout` (deterministic chroma-key port), `image.segmentation` (model-gated honest placeholder) | **Wired into the LAXII UI** behind an explicit consent toggle; server re-validation untouched |
| CODE GIFTZ | `code.analysis` (delimiter balance + relative-import resolution in a real worker; `local-only` privacy) | Library-level; advisory only, server analysis remains authoritative |
| JAZMII | `video.reference-check` (server bounds mirrored, drift-checked by test), `video.thumbnail` (canvas capture) | Library-level; generation itself stays server-side |
| RIISHE | — | **Deferred with rationale** (audit §2.1): portable steps are already deterministic and effectively free server-side; no measured server-cost reduction justifies a second implementation |
| GANGZII | — | **Deferred**: product surface is runtime-unwired (orphaned UI, unregistered backends) — integrating into a broken surface would not deliver value (audit §2.5) |
| BEAN FX / BEAN Folio | — | **ABSENT from the repository**; the adapter seam (`registerProductAdapter`) is the documented attachment point when they exist |

## 6. Consent and privacy flow

1. Consent state machine (`privacy.ts`): `null` (never asked) → `{granted, localOnly}`
   persisted under `bean.clientCompute.consent.v1`.
2. The LAXII consent toggle is the only UI surface added; it writes engine consent and
   labels its effect honestly ("images over 4 MB are downscaled/compressed on this
   device before upload. The server still validates every upload.").
3. The scheduler re-reads `isDeviceComputeAllowed()` / `isLocalOnlyMode()` on EVERY
   scheduling and fallback decision — mid-flight consent changes are honored.
4. `local-only` tasks can never reach the backend (both kind-level privacy and the
   user-level local-only mode are enforced, independently tested).
5. Diagnostics redaction: strings truncate with a size note; objects reduce to type
   labels; progress notes are adapter-authored text only (no payloads).

## 7. Model registry and downloads

- Entries are code-defined honest facts; as of M36 (2026-11-23) the registry
  ships THREE measured entries, all enabled: `laxii-bgremoval-modnet`
  (BEAN-managed, pinned SHA-256 `92e49898…`, 6,632,188 bytes — real artifact
  integrity verified on the deployment host), `riishe-chat-webllm-qwen2.5-0.5b`
  and `gangzii-asr-browser-whisper-tiny` (runtime-managed: WebLLM /
  Transformers.js fetch their own caches from revision BEAN pins by commit
  SHA; `requestDownload` honestly refuses them — `REFUSED_RUNTIME_MANAGED`).
  Browser runtime dependencies are NESTED (`src/workers/package.json`:
  `@mlc-ai/web-llm` 0.2.89, `@huggingface/transformers` 4.3.2,
  `onnxruntime-web` 1.31.1) — deliberately outside the app's own node_modules;
  bundles build via `scripts/build-workers.mjs` into `public/workers/`.
- Download flow: enabled gate → runtime gate → EXPLICIT approval gate → trusted-origin
  gate → checksum-metadata gate → storage-quota gate (with ≥100 MB headroom) → streamed
  fetch with progress → SHA-256 verification → Cache Storage install → verified install
  state. A model is "installed" ONLY after checksum pass.
- Deletion is first-class; eviction simply returns to not-installed (verified on load).
- M36-D display hygiene: `listPublic()` projects `displayName` /
  `runtimeLabel` / `licenseName` — customer-safe capability language; the
  foundation-model identity stays in this source file (attribution record).
- REAL EXECUTION EVIDENCE (M36-B): the pinned MODNet artifact ran through
  onnxruntime-node's CPU execution provider on the deployment host (588 ms,
  512×672 input → 1×1×512×672 matte, values [0, 0.9943], foreground detected)
  — `scripts/m36-acceptance/cpu-inference.ts`. Real-browser WebGPU execution
  remains pending operator hardware (no WebGPU in the sandbox — stated, not
  faked).

## 8. Resource management

- ONE active heavy model per budget (heavy-model slot with honest acquisition failure).
- Device-task concurrency cap (2 normal / 1 conservative) enforced by admission gate.
- Policy memory budgets per resource class (labeled policy, not hardware facts):
  light 64 / medium 256 / heavy 1024 MB (conservative: 32/96/384).
- GPU buffers created during a task are destroyed automatically when the task ends;
  the engine releases the device on `releaseAll()` and records device loss honestly.
- `pagehide` releases everything — no compute continues after the page is gone; tasks
  are never STARTED while the tab is hidden; no background mining, no hidden workloads.

## 9. Server coordination

- `POST /api/client-compute/reports` stores a sanitized capability report
  (zod-validated bounded shape: booleans, coarse numbers, tier, installed-model ids —
  there is no field a vendor string, user agent, task payload or prompt could hide in).
  10/min/user rate limit via the shared limiter; audited as `client-compute.report`.
- `GET /api/client-compute/reports` returns ONLY the caller's own last 5 reports.
- Reports integrate with the existing health/diagnostics philosophy (measured evidence
  rows); the health route itself was not modified (additive integration point documented
  in the implementation report).

## 10. Honest-state reference

| State | Meaning |
|---|---|
| `CLIENT_GPU_AVAILABLE` | GPU lane executed the task successfully |
| `CLIENT_CPU_AVAILABLE` | CPU lane executed the task successfully |
| `CLIENT_MODEL_NOT_INSTALLED` | Required model not verified-installed |
| `CLIENT_MODEL_DOWNLOADING` | Model bytes downloading (registry flow) |
| `CLIENT_MODEL_UNSUPPORTED` | Runtime missing / operation not supported on device |
| `CLIENT_MEMORY_INSUFFICIENT` | Memory policy budget or admission refused |
| `CLIENT_GPU_DEVICE_LOST` | GPU device lost during/after execution |
| `CLIENT_EXECUTION_FAILED` | Local execution failed (validation, crash, cancel, timeout) |
| `BACKEND_FALLBACK_AVAILABLE` | Backend delegate exists for this product |
| `BACKEND_FALLBACK_RUNNING` | Backend executed the task |
| `NO_SUPPORTED_EXECUTION_PATH` | No target passed the gates |

## 11. Verification artifacts

- Unit suites: `tests/unit/client-compute-*.test.ts` (7 files, 86 tests) +
  `tests/helpers/client-compute-fake-worker.ts` (protocol-faithful fake worker).
- Real-Chromium harness: `validation/client-compute/browser/` (source + measured JSON
  results + screenshots; rebuild: `bun build validation/client-compute/browser/harness-entry.ts --outfile validation/client-compute/browser/bundle.js --target=browser`).
- Real-app UI E2E: `validation/client-compute/ui-e2e/` (log, snapshots, screenshot of
  the LAXII consent toggle + on-device preprocessing) via
  `scripts/clientcompute-ui-e2e.sh`.
