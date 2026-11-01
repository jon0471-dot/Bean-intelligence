# LAXII Professional Image Engine — Model & Repository Decision Matrix

**Phase 0 deliverable.** Evaluated before any integration. Rule: a repository is
ADOPTED only with a verified license, a real deployment path on the target hardware
(RTX 5060 Ti 16 GB / 32 GB RAM, subject to local preflight), and a maintenance signal.
Non-commercial licenses are disqualifying for BEAN's hosted commercial service unless a
separate agreement is obtained (same rule as LICENSING-REPORT.md §3).

License sources were re-verified on **2026-10-31** from the official repositories /
model cards (URLs below). Sizes and VRAM figures are from the official cards and are
**estimates to be confirmed by local preflight** — nothing here asserts a model was run.

## 1. Repository decision matrix

| # | Repository | License (code) | Key weights + license | Commercial use | Maintenance | VRAM class | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [huggingface/diffusers](https://github.com/huggingface/diffusers) | Apache-2.0 (verified 2026-10-31; latest v0.42.1) | n/a — runtime library | Yes | Active (commits Oct 2026, 34.8k stars) | n/a | **ADOPT** — local generation/inpaint runtime behind the LAXII Python worker |
| 2 | [tencent-ailab/IP-Adapter](https://github.com/tencent-ailab/IP-Adapter) | Apache-2.0 (verified 2026-10-31) | Diffusers-ready re-release [h94/IP-Adapter](https://huggingface.co/h94/IP-Adapter) — **Apache-2.0** (verified 2026-10-31); ⚠️ [h94/IP-Adapter-FaceID](https://huggingface.co/h94/IP-Adapter-FaceID) is **non-commercial** ("the face model is non-commercial (not the code)" — maintainer, 2024-01-22) because it needs InsightFace weights | Base adapters: **Yes**; FaceID variants: **No** | Original repo quiet; diffusers-native `IPAdapter`/`IPAdapterPlus` pipelines maintained upstream | CLIP ViT-H ≈ 2.5 GB + adapter ≈ 0.1–1.7 GB; ~4–6 GB VRAM with SD1.5 | **ADOPT** — reference-guided generation via the Apache-2.0 h94 SD1.5/SDXL adapter set; FaceID variants excluded |
| 3 | [cubiq/ComfyUI_IPAdapter_plus](https://github.com/cubiq/ComfyUI_IPAdapter_plus) | **GPL-3.0** (verified 2026-10-31) | n/a | GPL obligations attach to derivative works | **Maintenance-only** (maintainer notice 2025-04-14: no consistent work planned) | n/a (ComfyUI nodes) | **SKIP** — no functional need (diffusers covers IP-Adapter natively); GPL-3.0 + maintenance-only make it a liability. ComfyUI remains an optional workflow backend to *evaluate*, never a replacement (per mission §1) |
| 4 | [ToTheBeginning/PuLID](https://github.com/ToTheBeginning/PuLID) | Apache-2.0 (verified 2026-10-31) | PuLID-SDXL weights: SDXL-base-derived → governed by SDXL's OpenRAIL++-M terms; PuLID-FLUX weights: **FLUX.1-dev-derived → non-commercial** (FLUX.1-dev Non-Commercial License, already recorded in LICENSING-REPORT.md) | SDXL tier: **Yes** (subject to OpenRAIL++-M use restrictions); FLUX tier: **No** | Active (NeurIPS 2024; updates through 2024–2026) | PuLID-SDXL + EVA-CLIP ≈ +3–4 GB over SDXL base | **ADOPT (SDXL tier only)** — face-identity conditioning for Creative Generate; FLUX tier excluded |
| 5 | [cubiq/PuLID_ComfyUI](https://github.com/cubiq/PuLID_ComfyUI) | ComfyUI node package | n/a | n/a | n/a | n/a | **SKIP** — same ComfyUI-only rationale as #3 |
| 6 | [InstantX/InstantID](https://github.com/InstantX/InstantID) | Apache-2.0 (code) | **Requires InsightFace antelopev2** — InsightFace zoo trained weights are **non-commercial research-only** ("antelopev2 (as well as all of the models in the insightface model zoo) do not allow commercial use" — InstantID issue #26, 2024-01-22; confirmed by maintainer discussion on HF) | **No — as shipped** | Active | SDXL-class | **REJECT** for the commercial hosted product. Zero-shot identity would be nice, but the mandatory antelopev2 dependency is non-commercial. PuLID-SDXL (which pairs with YuNet/SFace, see §2) covers the same product need legally |
| 7 | [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | BSD-3-Clause (verified 2026-10-31, LICENSE file) | [RealESRGAN_x4plus.pth](https://github.com/xinntao/Real-ESRGAN/releases) — BSD-3-Clause (~64 MB) | **Yes** (name-endorsement clause only) | Mature/stable | ~0.5–2 GB (tiled on demand) | **ADOPT** — generative-class upscaling inside the worker; BEAN's deterministic Lanczos path (Sharp) stays the default first stage |
| 8 | [advimman/lama](https://github.com/advimman/lama) | Apache-2.0 (verified 2026-10-31) | big-lama weights — Apache-2.0 (distributed in the Apache-2.0 repo/releases; third-party packaging confirms same) | **Yes** | Mature/stable (paper WACV 2022) | ~1–2 GB | **ADOPT** — large-mask object-removal inpaint inside the worker (SD-inpaint covers text-driven edits; LaMa covers clean structural removal) |

## 2. Face detection / identity metric components (identity-preservation subsystem)

The mission requires face detection + a validated identity-similarity metric with
**commercial-use rights checked**. This rules out the obvious InsightFace stack:

| Component | Candidate | License | Commercial | Decision |
| --- | --- | --- | --- | --- |
| Face detection | InsightFace SCRFD / antelopev2 | Non-commercial (model zoo) | **No** | REJECT |
| Face detection | [OpenCV Zoo YuNet](https://huggingface.co/opencv/face_detection_yunet) (ONNX, ~75k params, 10–300 px faces) | **MIT** — "All files in this directory are licensed under MIT License" (model card, verified 2026-10-31) | **Yes** | **ADOPT** — worker-side automatic face-region detection |
| Identity metric | InsightFace ArcFace (w600k) | Non-commercial | **No** | REJECT |
| Identity metric | [OpenCV Zoo SFace](https://huggingface.co/opencv/face_recognition_sface) | MIT per model directory (official card) — ⚠️ training-data provenance question raised publicly (e.g. OpenCV Zoo issue #318, 2026-09); flagged for legal review before commercial enablement | Conditionally yes | **ADOPT (provisional)** — cosine-similarity embedding comparison for the identity-drift gate; the score is always displayed as a similarity estimate, **never** as proof of identical identity (mission §5) |
| Fallback identity control | User-approved face-region masking (no biometric model) | n/a — BEAN-local geometry only | Yes | **ADOPT** — always available; runs even when no face model is deployed. No biometric data leaves the machine |

## 3. Base checkpoints (worker tiers)

| Checkpoint | License | Commercial | Size (download, official card) | Role | Target VRAM (16 GB card) |
| --- | --- | --- | --- | --- | --- |
| [SD 1.5 inpaint](https://huggingface.co/runwayml/stable-diffusion-v1-5) (CreativeML OpenRAIL-M, per official card) | OpenRAIL-M — use-based restrictions, commercial allowed | Yes | ~4.3 GB (fp16 ~2.1 GB) | Smart Edit inpainting at 512² (fast tier), IP-Adapter host | ~3–4 GB — comfortable |
| [SDXL base 1.0](https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0) (CreativeML Open RAIL++-M License, verified 2026-10-31) | OpenRAIL++-M — commercial allowed subject to use restrictions | Yes | ~6.9 GB (fp16) | Photorealistic/professional generation, PuLID host, SDXL inpaint | 8–12 GB fp16; FP8/quant options documented, **not asserted** |
| [FLUX.1-schnell](https://huggingface.co/black-forest-labs/FLUX.1-schnell) | Apache-2.0 (verified in LICENSING-REPORT.md 2026-10-24) | Yes | ~23.8 GB bf16 / ~12 GB fp8 | Candidate fast T2I tier | 12B params — **does not fit 16 GB comfortably at bf16**; fp8/quant only after local preflight proves it. Kept as CANDIDATE, never default |

## 4. Rejected / excluded items and why

- **InstantID** — mandatory non-commercial face model (antelopev2). Commercial hosted product ⇒ disqualified.
- **IP-Adapter-FaceID (h94)** — non-commercial (insightface face model). Rejected; PuLID-SDXL + SFace replaces the need.
- **FLUX.1-dev** — non-commercial (already recorded 2026-10-24). PuLID-FLUX inherits this — excluded.
- **ComfyUI as a required runtime** — GPL-3.0 node ecosystem + maintenance-only status + a second runtime to operate. Diffusers is Apache-2.0, diffusers-native, and already the mission's named worker runtime. ComfyUI may be evaluated later as an optional workflow backend only.
- **CodeFormer / GFPGAN "face restoration" as unconditional post-processing** — GFPGAN weights (Apache-2.0) exist, but mission §5 forbids unconditional face restoration; it is implemented as an explicit user opt-in step only, and is out of scope until the identity benchmark exists. (Recorded, not adopted.)

## 5. Checksum policy (honesty rule)

Checksums are **not invented here**. Every manifest in `models/manifests/` records the
official source URL and file size from the model card; the worker's download preflight
verifies SHA-256 **at download time** against the value published on the official card
and refuses to load a checkpoint whose verification failed. Checksum columns in these
docs say `verified-at-download` until a real download happens on the GPU host.

## 6. Net integration set (Phase 2–6 scope)

ADOPTED: diffusers (runtime) · h94/IP-Adapter base set (reference conditioning) ·
PuLID-SDXL (identity conditioning) · Real-ESRGAN x4plus (upscaling) · big-lama (object
removal) · YuNet (face detection) · SFace (identity metric, provisional) · SD1.5-inpaint
+ SDXL-base (checkpoints) · FLUX.1-schnell (candidate only).

All of it is **inert until the local hardware preflight passes and a real inference test
completes**; nothing in this matrix claims any model was executed.
