# LAXII Preservation-First Engine — Architecture & Existing-Implementation Audit

**Phase 0 deliverable.** Written 2026-10-31, before any code change to LAXII.
Purpose: record exactly what the existing LAXII implementation is, what the mission's
"preserve" list maps to in reality, and the target architecture this project builds.

## 1. Existing LAXII implementation (audited, 2026-10-31)

| Capability | Status | Evidence |
| --- | --- | --- |
| Pluggable provider architecture | **EXISTS** — preserved | `src/lib/adapters/types.ts` (`TaskAdapter` with optional `generateImage`), `src/lib/registry/backends.ts` (private descriptors), `src/lib/router/router.ts` (preflight: product→task→enabled backends→rate limit→quota→concurrency→limits→execute→metering) |
| Managed provider | **EXISTS** — preserved unchanged | `src/lib/adapters/hosted-image.ts` (`bean-image-hosted-primary`, Z.ai authorized gateway; text-to-image only; 7 fixed sizes; JPEG output; ~60 s; honest health probe that explicitly does NOT run a generation) |
| Async job pipeline | **EXISTS** — preserved, extended | `src/lib/jobs/queue.ts` (in-process worker; `GenerationJob` rows; jobs completed only when real bytes exist), `POST/GET /api/laxii/generate`, `GET /api/laxii/jobs/[id]`, `GET /api/laxii/images/[id]` (owner-checked byte delivery) |
| UI studio | **EXISTS** — preserved design, extended in place | `src/components/bean/laxii.tsx` (prompt + 7 sizes + job gallery, gold `bean-glass` design language) |
| Verified real inference | **EXISTS** (2026-10-24 probe + 2026-10-29 health) | `models/manifests/bean-image-hosted-primary.json` (78,652-byte JPEG, magic FFD8FF), `scripts/stage0-report.json` |

## 2. Mission "preserve" list vs reality (honest gap report)

The mission says to *preserve* the following. The audit result:

| Mission item | Found in repo? | Disposition |
| --- | --- | --- |
| Pluggable provider architecture | Yes | Preserved — all new engines plug in behind the same seam |
| Managed provider | Yes | Preserved byte-for-byte; remains the text-to-image fallback |
| Local Diffusers + IP-Adapter **Python worker** | **No — did not exist** | **Built** in this project (`workers/laxii-diffusers/`); the word "preserve" is satisfied as "never remove what is built here" |
| `LAXII_PROVIDER=diffusers\|auto` behavior | **No — did not exist** | **Built** (`src/lib/laxii/provider.ts`), semantics documented below |
| Local Sharp compositing, masking, grading, metrics, export | **No — did not exist** for LAXII (Sharp was used only by document/file processing) | **Built** (`src/lib/laxii/preservation.ts`, `enhance.ts`, `metrics.ts`) |

There was no prior LAXII Python worker, provider switch, or Sharp image pipeline to
preserve — grep across the repo finds `diffusers` only in a JAZMII video candidate
manifest and the architecture doc. This is recorded to prevent a false "preserved
existing worker" claim. What *does* exist is preserved untouched: no existing route,
adapter, contract, UI style or unrelated product was modified or replaced.

## 3. Environment constraints (measured 2026-10-31)

- This development sandbox: **no GPU** (`nvidia-smi` absent), 3.9 GB RAM, ~7.6 GB free disk, Python 3.12 (no torch/diffusers installed), Node 24 + **Sharp 0.34.5 installed**.
- Consequences, applied without exceptions:
  - No large model dependencies are installed here (mission §1). `workers/laxii-diffusers/requirements.txt` is documented, never pip-installed in this environment.
  - **No inference claim of any kind is made.** The Diffusers worker ships with an honest preflight that reports missing requirements on this machine; the managed provider and the deterministic Sharp engine remain the only *executed* paths here. Real Diffusers/IP-Adapter/PuLID/Real-ESRGAN/LaMa execution awaits the RTX 5060 Ti 16 GB host and its preflight pass.
  - Every deterministic (non-generative) capability — masks, compositing, enhancement, metrics, validation — **is** executed and tested here, because it needs only Sharp.

## 4. Target architecture

```
LAXII studio UI (src/components/bean/laxii.tsx — extended in place)
  Create | Enhance | Edit | Reference | Preservation | Face protection | History
        │  same auth, same job polling, same gold design system
        ▼
API layer (additive routes only)
  POST /api/laxii/assets      reference/original/mask uploads (owner-checked)
  POST /api/laxii/enhance     deterministic enhancement job
  POST /api/laxii/edit        smart-edit / strict-preserve / background job
  GET  /api/laxii/preflight   local hardware preflight (truthful report)
  GET  /api/laxii/models      public-safe model catalog (capability-aware)
        │
        ▼
LAXII engine modules (src/lib/laxii/*)
  provider.ts      capability-aware provider selection + LAXII_PROVIDER
  preservation.ts  mask ops (dilate/erode/feather/negative), exact-pixel
                   compositing, preservation validation report
  enhance.ts       analysis-driven non-generative enhancement pipeline
  metrics.ts       difference maps, region equality, change stats
  models.ts        model catalog: license, VRAM, tasks, quant, checksums
  worker.ts        Node↔Python worker client (JSON lines, spawn, timeouts)
        │
        ├──► Managed provider (hosted-image.ts — UNCHANGED)   [executes today]
        ├──► Sharp deterministic engine                        [executes today]
        └──► Python Diffusers worker (workers/laxii-diffusers) [preflight-gated;
             JSON-lines over stdio: preflight/health/txt2img/img2img/
             inpaint/reference/identity; YuNet+SFace; LaMa; Real-ESRGAN;
             never enabled until a real inference test passes]
```

### Provider semantics (`LAXII_PROVIDER`)

- `auto` (default): deterministic Sharp work always runs locally; text-to-image uses
  the managed provider; generative edit steps (inpaint/reference/identity/upscale-model)
  use the Diffusers worker **only when it is enabled**, i.e. its preflight passed and a
  real inference acceptance test is recorded. If the worker is not enabled the job
  **fails with a truthful `PROVIDER_UNAVAILABLE` error** — it never silently degrades
  into a whole-image generative reconstruction or a fake success.
- `diffusers`: generative work must use the worker; if unavailable the same truthful
  error is returned (no managed fallback for ops the managed provider cannot do).
- The managed provider is never used for masked edits: it has no img2img path
  (`imageToImage: false`, measured) and would violate preservation.

### Preservation model (the core product rule)

1. **STRICT PRESERVE** — the original is authoritative. Pipeline is non-generative
   first (orientation → denoise → exposure/WB → grade → local contrast → optional
   upscale). Unmasked pixels are composited from **exact original bytes** whenever the
   op is not a user-approved global color/exposure change; the validation report
   measures and ships the actual preserved-pixel percentage.
2. **SMART EDIT** — brush masks (positive/negative), configurable feather, generation
   only inside the mask region, exact-original compositing outside it, difference map +
   before/after in the UI. Face protection adds an automatic hard "do not modify" face
   zone (YuNet-detected on the worker host, or user-approved regions anywhere).
3. **CREATIVE GENERATE** — prompt + optional reference (IP-Adapter) + optional identity
   conditioning (PuLID-SDXL). The UI states plainly that regenerated faces have **no
   pixel-level identity guarantee**; the identity-drift gate flags outputs whose
   face-embedding similarity falls below a configurable threshold — a flag, never a
   claim of identical identity.

### Honesty guarantees carried over

Jobs are completed only when real output bytes exist; failures, cancellations and
unavailable providers are recorded truthfully; model provenance metadata (provider,
model id, license, seed, ops applied) is stored with every artifact; no benchmark or
inference capability is claimed without a measured run recorded in `worklog.md`.
