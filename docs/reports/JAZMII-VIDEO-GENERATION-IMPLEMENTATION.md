# JAZMII — Video Generation Implementation Report

**Date:** 2026-11-04 · **Scope:** §5 of the four-product task — real text-to-video / image-to-video.

## 1. What existed before

A **truthfully not-configured product**: registry entry `bean-video-selfhosted-candidate` with `enabled:false`, an honest `unavailableReason`, a health-report-only adapter (`src/lib/adapters/video-adapter.ts`), and routes that reject with typed evidence:

- `POST /api/jazmii/generate` → catch → persists a `GenerationJob` with `status:'unsupported'`, `errorCode:'NO_BACKEND'`, message "JAZMII is not operational: no licensed video-generation backend is deployed in this environment." → returns `{rejected:true}` — auditable, never simulated.
- `GET /api/jazmii/generate` → `productAvailability.available=false` + reason + job history showing the `unsupported` records.
- Daily quota hardwired to 0; duration/resolution parameters deliberately NOT advertised ("BEAN must not promise parameters no worker can honor").
- UI: amber "Availability: reported truthfully" panel; submission shows the real rejection message; history renders `unsupported` records.

## 2. What changed this session

No product code changes — the honest architecture was already correct. Added **acceptance evidence** (commit `942dbbf`):

| Test | Result |
|---|---|
| Real submit → typed rejection | **PASS** — `NO_BACKEND: "JAZMII cannot accept video jobs yet. No video-generation backend is deployed — BEAN does not simulat[e]…"` |
| Availability + audit trail | **PASS** — `available=false`, 1 `unsupported` record persisted |
| Health projection | **PASS** — JAZMII = `not-configured`, **no probe runs** (`latencyMs:null`, failureCategory `not-configured`) — a missing backend is distinguished from a failed one |

## 3. Why there is no video backend (the honest blocker)

Real video generation requires all of the following; none exist in this environment:

1. **A deployed GPU worker** (Wan 2.2 / HunyuanVideo-class: ≥24GB VRAM; this host has none — the developer workstation's RTX 5060 Ti 16GB is not attached to this deployment and must not be assumed).
2. **A licensed checkpoint** (license under review in the registry entry; weights are multi-GB downloads that must never be fetched silently — §8 reporting duty: size/license/VRAM/RAM/disk/deps before any download).
3. **A `TaskAdapter` implementation** in `video-adapter.ts` (submit → provider task id kept private → poll/validate → download → media storage → persist) for the async workflow Seedance/Veo document.
4. **Registry flip** `enabled:true` — only after a recorded real inference acceptance test.

Per the task rules ("If a backend is not deployed or configured, report that fact. Do not manufacture a successful connection") JAZMII stays **Not configured** and every claim in this report is backed by the committed evidence JSON.

## 4. Tests executed

Suite 1018/0/64 (incl. connectivity-health coverage of the not-configured projection); live acceptance steps above.

## 5. Rollback

No JAZMII source changes this session → nothing to roll back.
