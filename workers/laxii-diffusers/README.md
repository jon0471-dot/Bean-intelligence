# LAXII Local Diffusers Worker

Preservation-aware generative editing worker for LAXII (BEAN Intelligence).

**Status: SHIPPED AS CODE, NOT DEPLOYED.** No inference test has completed in the
BEAN development sandbox (no GPU, no torch, ~7.8 GB free disk). The worker is
`enabled: false` in `src/lib/registry/backends.ts` until **both** gates pass on the
GPU host and are recorded in `worklog.md`:

1. `preflight` returns `ok: true` on the GPU host (RTX 5060 Ti 16 GB target).
2. A real inference acceptance test produces a real image end-to-end
   (`local/run_acceptance.py` verdict ACCEPTED, recorded in `worklog.md`).

## Deployment (Windows GPU host — Phase 8, primary path)

Target: Windows 10/11 + NVIDIA RTX 5060 Ti 16 GB (Blackwell, compute capability
**sm_120** → requires **CUDA 12.8 wheels**: torch 2.11.0+cu128, the newest release
on the cu128 index as of 2026-10-31; driver ≥ 576.02). Full runbook with
troubleshooting: **[local/ACCEPTANCE-RUNBOOK.md](local/ACCEPTANCE-RUNBOOK.md)**.

```powershell
# from the repo root
powershell -ExecutionPolicy Bypass -File workers\laxii-diffusers\windows\hardware_report.ps1
powershell -ExecutionPolicy Bypass -File workers\laxii-diffusers\windows\setup.ps1
& workers\laxii-diffusers\.venv\Scripts\Activate.ps1
cd workers\laxii-diffusers
python local\download_models.py --accept-licenses
python local\run_acceptance.py
```

Verified package matrix (2026-10-31): torch 2.11.0+cu128 / torchvision 0.26.0+cu128 /
diffusers 0.42.1 (Python ≥3.11) / transformers 5.22.1 / accelerate 1.15.0 /
huggingface_hub 2.4.0 / safetensors 0.8.0 / numpy 1.26.4 / opencv-python 4.14.0.94 /
basicsr 1.4.2 + realesrgan 0.3.0 (needs `windows/patch_basicsr.py` — documented
functional_tensor + numpy-alias fix, verified by real imports).

## Deployment (Linux/WSL host)

```bash
cd workers/laxii-diffusers
python3 -m venv .venv && . .venv/bin/activate
pip install torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt
python windows/patch_basicsr.py   # same BasicSR fix, works on any OS
python3 worker.py --models-dir ./models
```

## Checkpoint layout (worker 0.3.1 mapping — created by download_models.py)

```
models/
  sd-v1-5-inpainting/sd-v1-5-inpainting.safetensors   (SD1.5 inpaint — OpenRAIL-M)
  sd15-base/v1-5-pruned-emaonly.safetensors           (SD1.5 base, IP-Adapter host — OpenRAIL-M)
  sdxl-base-1.0/                                      (diffusers layout, fp16 variants — OpenRAIL++-M;
                                                       REQUIRED for SDXL masked inpaint: the lone
                                                       single-file checkpoint cannot provide the
                                                       9-channel inpaint UNet)
  ip-adapter/models/ip-adapter_sd15.safetensors       (h94/IP-Adapter — Apache-2.0; NOT FaceID)
  ip-adapter/models/image_encoder/                    (CLIP ViT-H, downloaded for offline use)
  RealESRGAN_x4plus.pth                               (BSD-3)
  big-lama/model.jit                                  (Apache-2.0, TorchScript packaging)
  face_detection_yunet_2023mar.onnx                   (MIT)
  face_recognition_sface_2021dec.onnx                 (MIT — provenance review pending)
  models.sha256, download-record.json                 (SHA-256 + provenance, recorded at download)
```

Checksums are recorded AT DOWNLOAD and re-verified by preflight and by the
acceptance harness before any inference. NEVER bypass this.

## Protocol

One JSON object per line on stdin; responses/progress on stdout; logs on stderr.

```json
{"id": "1", "method": "preflight", "params": {"modelsDir": "./models"}}
{"id": "2", "method": "inpaint", "params": {"image": "<b64>", "mask": "<b64>",
  "prompt": "...", "steps": 30, "seed": 42, "model": "sd15-inpaint"}}
{"id": "2", "type": "progress", "step": 7, "total": 30}
{"id": "2", "ok": true, "result": {"images": ["<b64 png>"], "model": "sd15-inpaint"}}
```

Methods: `preflight`, `health`, `unload`, `txt2img` (sdxl-base-1.0 | sd15-base),
`inpaint` (sd15-inpaint | sdxl-base-1.0 diffusers-layout; strength < 1 = the
masked img2img path — full-image regenerative img2img is deliberately NOT exposed
as an unmasked operation), `reference_generate` (IP-Adapter, host `sd15-base`),
`identity_prepare` (YuNet detect + SFace embed, local-only), `identity_check`
(cosine similarity vs configurable threshold — an estimate, never "proof of
identity"), `upscale` (Real-ESRGAN or Lanczos), `object_removal` (big-lama),
`cancel` (cooperative, checked every diffusion step).

Mask semantics: alpha > 0 = **editable** (matches the BEAN TypeScript engine; the
worker inverts for diffusers internally).

## Honesty rules baked into the code

- Every ML dependency is imported lazily; with nothing installed, `preflight` runs on
  bare Python and reports the exact missing packages, CUDA state, VRAM, disk and
  checkpoint presence. It never claims readiness it cannot prove.
- Inference methods return `UNAVAILABLE` / `MODEL_MISSING` instead of degrading.
- `identity_check` result text always states that a similarity score is an estimate.
- The Node side (`src/lib/laxii/worker.ts`) enforces timeouts and treats a dead
  worker as `WORKER_UNAVAILABLE` — never as success. On Windows it defaults to
  `python` (no `python3` shim); override with `LAXII_WORKER_PYTHON`.

## worker.py 0.3.1 — deployment-prep fixes (Phase 8, found by code inspection)

Each was a certain first-run failure on the GPU host; all fixed BEFORE the first
local run and re-covered by the protocol tests:

1. `from_single_file()` was handed a model directory / `from_pretrained()` a file —
   weight resolution is now explicit (`_find_weights`, `_is_diffusers_dir`).
2. SDXL masked inpaint now REQUIRES the diffusers-layout directory (truthful
   `MODEL_MISSING` otherwise); single-file SDXL serves txt2img.
3. IP-Adapter preflight/method path mismatch (`ip-adapter*` vs `ip-adapter-h94-sd15`)
   aligned to `models/ip-adapter` in h94 repo layout.
4. `reference_generate` now uses a real base SD1.5 host (`sd15-base`, new
   checkpoint) — the inpaint checkpoint's 9-channel UNet cannot serve it; non-SD15
   hosts are rejected with `MODEL_UNSUPPORTED`.
5. `huggingface_hub` reported by preflight (real runtime dependency).
