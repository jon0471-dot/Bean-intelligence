# LAXII Local Diffusers Worker

Preservation-aware generative editing worker for LAXII (BEAN Intelligence).

**Status: SHIPPED AS CODE, NOT DEPLOYED.** No inference test has completed in the
BEAN development sandbox (no GPU, no torch, ~7.6 GB free disk). The worker is
`enabled: false` in `src/lib/registry/backends.ts` until **both** gates pass on the
GPU host and are recorded in `worklog.md`:

1. `preflight` returns `ok: true` on the GPU host (RTX 5060 Ti 16 GB target).
2. A real inference acceptance test produces a real image end-to-end.

## Deployment (GPU host)

```bash
cd workers/laxii-diffusers
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# Download checkpoints per models/manifests/bean-image-selfhosted-diffusers.json.
# Record sha256 in models/models.sha256 as "<hex>  <filename>" — preflight and
# every load verify against it and refuse mismatches. NEVER bypass this.
mkdir models
# example layout:
#   models/sd-v1-5-inpainting/…          (SD 1.5 inpaint — OpenRAIL-M)
#   models/sd_xl_base_1.0.safetensors    (SDXL base — OpenRAIL++-M)
#   models/ip-adapter/…                  (h94/IP-Adapter — Apache-2.0; NOT FaceID)
#   models/pulid_sdxl.safetensors        (PuLID-SDXL)
#   models/RealESRGAN_x4plus.pth         (BSD-3)
#   models/big-lama/model.jit            (Apache-2.0)
#   models/face_detection_yunet_2023mar.onnx        (MIT)
#   models/face_recognition_sface_2021dec.onnx      (MIT — provenance review pending)

python3 worker.py --models-dir ./models
```

## Protocol

One JSON object per line on stdin; responses/progress on stdout; logs on stderr.

```json
{"id": "1", "method": "preflight", "params": {"modelsDir": "./models"}}
{"id": "2", "method": "inpaint", "params": {"image": "<b64>", "mask": "<b64>",
  "prompt": "...", "steps": 30, "seed": 42, "model": "sd15-inpaint"}}
{"id": "2", "type": "progress", "step": 7, "total": 30}
{"id": "2", "ok": true, "result": {"images": ["<b64 png>"], "model": "sd15-inpaint"}}
```

Methods: `preflight`, `health`, `unload`, `txt2img`, `img2img`* (diffusers img2img
pipeline is exposed through `inpaint` with strength < 1 — full-image regenerative
path is deliberately NOT exposed as an unmasked operation), `reference_generate`
(IP-Adapter), `identity_prepare` (YuNet detect + SFace embed, local-only),
`identity_check` (cosine similarity vs configurable threshold — an estimate, never
"proof of identity"), `upscale` (Real-ESRGAN or Lanczos), `object_removal` (big-lama),
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
  worker as `WORKER_UNAVAILABLE` — never as success.
