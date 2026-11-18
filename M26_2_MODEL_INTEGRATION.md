# M26.2 MODEL INTEGRATION — Selection, Licenses and the ONNX Integration Contract

Milestone: M26.2 · Repository state: branch `feat/m26-2-media-capabilities`
(at `99b2470996110f383b43964d7bf9cc4851d4ceb2`, on top of the six AI
operationalization commits and the sanitized main `4d134c5…`).
Every model below is installed EXPLICITLY (`src/lib/media/local-models.ts`,
SHA-256-pinned, weights under gitignored `storage/models/`) and every claim
in this document was verified by the real-inference acceptance run
(`scripts/m262-out/acceptance.json`, 22/22, 2026-11-18).

## 1. Selection summary

| Lane | Selected model | Why it won | Honest limitations |
|---|---|---|---|
| Background-removal matting (LAXII) | **MODNet** (ONNX, `Xenova/modnet`) | 25.9 MB fp32, trimap-free portrait matting with true alpha output, runs on CPU via onnxruntime-node at the working resolution, alpha upsampled to FULL source resolution | Trained on people: strong non-human subjects can yield conservative mattes — every run carries measured coverage stats and fails honestly when no usable subject exists |
| Matting fallback | **U^2-Netp** (`rembg` portable build) | 4.6 MB, general salient-object map when the portrait model finds no subject | Saliency-quality matte; softer edges; chosen for footprint, not hair quality |
| Masked object removal / destructive masked edits (LAXII) | **LaMa** (`opencv/inpainting_lama` ONNX) | 92.6 MB, real structural inpainting at fixed 512×512 internal, OpenCV-zoo convention, fills the user's brush mask from surrounding content | Fixed internal resolution (result restored to source geometry); not an identity-preserving face generator — disclosed in provenance |
| Image-to-video, local lane (JAZMII) | **RIFE** (`FuryTMP/RIFE_fp32` ONNX of hzwer/Practical-RIFE) | 21.6 MB, real neural frame interpolation on CPU; every in-between frame is model inference, never blending | Frame interpolation of motion trajectories — NOT diffusion scene synthesis; subject-motion/added-content requests are refused honestly at submit time |

All four: **commercial use permitted** (Apache-2.0 / MIT), verified against
the upstream repos on 2026-11-18 and recorded in
`src/lib/media/local-models.ts` (single source of truth for state + license).

## 2. The evaluated alternatives (milestone-specified candidates)

### 2.1 Background removal: MODNet vs BiRefNet vs InSPyReNet

| Candidate | Weights size (verified via HF API, 2026-11-18) | License | Runtime | Decision |
|---|---|---|---|---|
| **MODNet** (`ZHKKKe/MODNet`, ONNX via `Xenova/modnet`) | **25.9 MB** fp32 ONNX (13.0 MB fp16, 6.6 MB quantized variants available) | Apache-2.0 | onnxruntime-node, CPU, milliseconds-scale | **SELECTED** — smallest true-alpha matting model that runs in-process on CPU |
| BiRefNet (`ZhengPeng7/BiRefNet`) | 444.5 MB safetensors (PyTorch checkpoint, Swin backbone) | MIT (code + weights per HF tag) | PyTorch + heavy backbone; no official ONNX in the repo → conversion project | NOT selected for this milestone: ~17× the download, a PyTorch runtime dependency, and CPU inference far outside the budget; the same quality tier can be added later as a GPU-worker lane without changing the pipeline contract |
| InSPyReNet (`plemeri/InSPyReNet`) | Swin-B class PyTorch checkpoint (hundreds of MB, GitHub release artifacts; no in-repo ONNX) | MIT (code) | PyTorch, high-resolution SOD focus | NOT selected — same reasons as BiRefNet; evaluation recorded for a future GPU/worker lane |

Decision rule applied (per the milestone): fit the EXISTING runtime
(onnxruntime-node CPU EP) and hardware budget first; a heavier model that
cannot run here would be a fake capability. The segmentation service
interface (`runPortraitMatte` / `runSaliencyMatte` / `runBestMatte`) is
model-agnostic, so a future BiRefNet worker lane slots in without touching
the routes, queue or export path.

### 2.2 Image-to-video: diffusion-class I2V evaluated, honestly unavailable here

| Candidate | Weights class | License | Verdict on this host |
|---|---|---|---|
| WAN 2.2 I2V (`Wan-AI/Wan2.2-I2V-*`) | multi-GB to ~10s-of-GB diffusion transformer | Apache-2.0 (upstream) | Requires a GPU worker class this host does not have; weights alone exceed the sandbox disk/memory class. Recorded as the target model for the GPU Diffusers worker lane |
| CogVideoX-5b-I2V (`THUDM/CogVideoX-5b-I2V`) | ~13 GB fp16 class | Apache-2.0 | Same verdict — GPU worker lane, not CPU in-process |
| SVD (`stabilityai/stable-video-diffusion-*`) | ~9 GB fp16 class | **STABILITY NON-COMMERCIAL community license** | Additionally DISQUALIFIED for commercial use even on future GPU hardware |

The shipped I2V lane is therefore the honest local-motion lane: parsed
motion programs over the provided still + RIFE neural in-between frames,
ffmpeg-encoded and ffprobe-gated. It performs REAL inference for every
frame and discloses its lane class on every result
(`provenance.laneClass`). Requests that need generative scene synthesis are
refused with `CAPABILITY_UNSUPPORTED` at submit time and pointed at the
hosted engine — never faked.

## 3. The ONNX integration contract (measured, reused by every model)

These were the real integration bugs found and fixed during validation; they
are documented so future lanes do not rediscover them:

1. **Channels-first (NCHW) tensors.** ONNX vision inputs/outputs are plane
   layouts, not pixel-interleaved. Feeding sharp's HWC raw bytes as
   `[1,3,H,W]` produces garbage (noise mattes, striped frames) on ALL four
   models. Every lane now de-interleaves explicitly
   (`segmentation.ts`, `inpaint-local.ts`, `i2v-local.ts`).
2. **Dims order is [N,C,H,W].** Building the MODNet tensor as
   `[1,3,W,H]` silently transposes every non-square input (measured: a
   512×768 portrait fed transposed produced a garbage 14.6%-subject matte;
   the correct order produces a clean 57%-subject matte with crisp hair
   edges). Square inputs mask the bug — non-square probes are mandatory.
3. **Per-model preprocessing comes from the model source, not habit:**
   MODNet normalizes to [-1,1] per the `Xenova/modnet` processor config
   (mean 0.5 / std 0.5); U^2-Net uses ImageNet mean/std per the rembg
   reference; LaMa uses OpenCV-dnn BGR 0..1; RIFE consumes RGB 0..1 planes.
   Plain 0..1 input on MODNet produced broken mattes on portraits the model
   otherwise segments near-perfectly.
4. **Do not route single-channel raw mattes through sharp's resize.**
   Measured: a 1-channel raw alpha resized by sharp in this environment came
   back corrupted (striped, coverage collapsed 57%→19%, silently widened to
   3 channels). The alpha is now upsampled with plain typed-array bilinear
   math (`upsampleAlpha`) — deterministic and dependency-free.
5. **MODNet working geometry**: shortest edge 512, aspect kept, both sides
   /32-snapped (encoder concat requirement — non-aligned dims fail with a
   Concat axis-3 mismatch), long side bounded by `BEAN_MATTE_MAX_SIDE`
   (default 1024); the alpha is always upsampled back to the FULL source
   resolution.

## 4. Manifest-of-record

`src/lib/media/local-models.ts` carries, per model: exact source URL, pinned
SHA-256, byte length, license block (name, commercialUse, sourceUrl,
verifiedAt), task/role/limitations, runtime and download size. States are
derived from the REAL files on disk (`not-installed | downloading | ready |
corrupted | failed`) — a missing or hash-mismatched artifact is NEVER
reported ready, and nothing downloads at page load or import time.

Fixture provenance for the acceptance media: `scripts/m262/fixtures/PROVENANCE.md`
(Pexels License, exact source URLs, byte-identity verification for
`scene.jpg`).
