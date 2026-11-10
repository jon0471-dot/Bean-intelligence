# LAXII — Image Generation & Editing Implementation Report

**Date:** 2026-11-04 · **Scope:** §4 of the four-product task — real conversational image generation, editing, preservation.

## 1. What existed before (already real — preserved)

- **Hosted text-to-image** (`bean-image-hosted-primary`): `POST /api/laxii/generate` → 202 + persisted `GenerationJob` → in-process queue worker → managed-SDK generation → artifact written to private storage `storage/laxii/<userId>/<jobId>.jpg|png` → owner-checked delivery via `GET /api/laxii/images/[id]`. Seven sizes (`LAXII_SIZES`). Reachability probe distrusts redirects (`redirect:'manual'`; 3xx → `redirected`, never healthy).
- **Deterministic enhancement** (`bean-image-local-sharp`, in-process Sharp): ops with measured reasons; **preservation invariants enforced server-side** (`src/lib/laxii/preservation.ts`): masks are byte artifacts; compositing uses exact alpha=0 → original pixels verbatim; face-zone geometric gate; measured report (PSNR / changed-pixel facts).
- **Capability truth:** `GET /api/laxii/edit` reports per-mode availability; `smart-edit` / `object-removal` / `reference-guided` throw typed `PROVIDER_UNAVAILABLE` (503) **before any job is created** while the diffusers worker is disabled — masked edits are never silently served by the hosted provider (`src/lib/laxii/provider.ts`).
- **Worker:** `src/lib/laxii/worker.ts` + `workers/laxii-diffusers/worker.py` exist but require a GPU host passing preflight + a recorded real inference test before `backends.ts` flips `enabled:true`. This host has no GPU.

## 2. What changed this session

No product code changes were required in LAXII — its honesty architecture was already in place. This session **added real acceptance evidence** (`scripts/four-product-acceptance.ts`, commit `942dbbf`):

- text-to-image job submission (202 + job id) — **PASS**;
- reference-asset upload with server-measured geometry (201, 1×1 PNG measured as 1×1) — **PASS**;
- schema-valid masked edit on a REAL asset → typed **503 PROVIDER_UNAVAILABLE** — **PASS** (nothing queued, nothing faked);
- full generation-to-artifact run — **BLOCKED by upstream throttling** (see §3);
- artifact IDOR guard — recorded for the completed-artifact case.

## 3. Real generation evidence & blockers

**Measured this session (dev server, live upstream):**

| Attempt | Result |
|---|---|
| `POST /api/laxii/generate` (job `cmw276czl…`, `cmw2783dp…`, `cmw279ci4…`) | 202 queued → worker invoked the real hosted image API → upstream returned **HTTP 429 "Too many requests"** → job `failed` with typed `BACKEND_FAILURE`, error recorded verbatim in `GenerationJob.errorMessage`, usage recorded with `success:false` |
| Health projection | LAXII = **degraded**: reachability probe passes (7–13ms) but the recorded real generation attempt (httpStatus 404/429 evidence in `last-attempts.ts`) keeps the product from claiming Operational — the "HTTP 200 ≠ operational" rule working as designed |

**Conclusion:** LAXII's generation pipeline is real end-to-end (queue, worker, artifacts, metering, failure accounting all exercised), but **no completed image can be claimed today** because the platform's upstream image gateway is throttled (429). Per the task rules this is recorded BLOCKED, not retried into a fake success. The same upstream account served successful LAXII generations in earlier sessions (see `docs/reports/BEAN-INTELLIGENCE-HEALTH-VERIFICATION.md`).

**Identity preservation (InstantID / IP-Adapter):** designed for via the diffusers worker path (`identityThreshold`, `ipAdapterScale` params, face zones, preservation report) but **BLOCKED**: requires the GPU worker + checkpoints. The preservation contract (never silently replace the reference face; measured similarity; conservative reporting) is implemented server-side and unit-tested (`laxii-preservation.test.ts`).

## 4. Tests executed

Suite: 1018/0/64 incl. `laxii-enhance`, `laxii-local-adapter`, `laxii-preservation`, `laxii-provider`, `laxii-worker-protocol`. Live: acceptance steps above (results JSON committed at `scripts/four-product-acceptance-out/acceptance-results.json`).

## 5. Provider configuration requirements

Hosted path needs only the platform SDK (server-side). External providers (OpenAI GPT-Image, Gemini/Nano-Banana) are **Not configured** — no credentials exist in this environment; adding adapters that cannot be verified live would violate the truth policy. GPU worker additionally needs: VRAM ≥ checkpoint requirement, verified checkpoint download (manifest), preflight pass, recorded inference acceptance test.

## 6. Rollback

No LAXII source changes this session → nothing to roll back. Evidence artifacts can be removed by deleting `scripts/four-product-acceptance*`.
