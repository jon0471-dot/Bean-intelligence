#!/usr/bin/env python3
"""
BEAN Intelligence — LAXII local Diffusers worker.

JSON-lines protocol over stdin/stdout (one request per line, responses and
progress events on stdout, logs on stderr only):

  request : {"id": "...", "method": "preflight|health|unload|txt2img|img2img|
             inpaint|reference_generate|identity_prepare|identity_check|
             upscale|object_removal|cancel", "params": {...}}
  response: {"id": "...", "ok": true, "result": {...}}
          | {"id": "...", "ok": false, "error": {"code": "...", "message": "..."}}
  progress: {"id": "...", "type": "progress", "step": N, "total": M}

HONESTY RULES (binding):
  - This worker NEVER fakes a result. Every heavy dependency is imported
    lazily; if torch/diffusers/models are missing, `preflight` reports the
    exact missing items and every inference method returns UNAVAILABLE.
  - No method claims success unless real bytes were produced by a real
    model run.
  - Identity similarity scores are similarity ESTIMATES. They are reported
    with their threshold verdict, never as proof of identical identity.

This file runs on a plain Python 3.10+ interpreter even with zero ML
dependencies installed (preflight only needs the stdlib), so deployment
hosts can always ask it what is missing.
"""
import argparse
import base64
import io
import json
import os
import shutil
import sys
import threading
import time

WORKER_VERSION = "0.3.1"
# 0.3.1 (Phase 8, 2026-10-31) — deployment-prep fixes found by code inspection
# BEFORE the first GPU-host run (each was a certain first-run failure):
#   1. from_single_file() was handed a model DIRECTORY (or from_pretrained() a
#      single FILE) — both would raise. Weight resolution is now explicit.
#   2. SDXL masked inpainting requires the diffusers-layout directory (fp16
#      variants); the lone single-file checkpoint cannot provide the 9-channel
#      inpaint UNet. Now enforced with a truthful MODEL_MISSING.
#   3. IP-Adapter checkpoint id/path mismatch between preflight (ip-adapter*)
#      and reference_generate (ip-adapter-h94-sd15) — preflight could report
#      "present" while the method reported MODEL_MISSING. Aligned to 'ip-adapter'.
#   4. reference-guided generation needs a BASE SD1.5 txt2img host (the inpaint
#      checkpoint's 9-channel UNet cannot serve it); 'sd15-base' registered.
#   5. huggingface_hub is reported by preflight (it is a real runtime dep).

# ---------------------------------------------------------------------------
# Lazy import helpers (preflight must work with NO ML deps installed)
# ---------------------------------------------------------------------------

_IMPORT_CACHE = {}


def try_import(name):
    if name in _IMPORT_CACHE:
        return _IMPORT_CACHE[name]
    try:
        mod = __import__(name)
        _IMPORT_CACHE[name] = mod
        return mod
    except Exception:
        _IMPORT_CACHE[name] = None
        return None


def fail(request_id, code, message):
    emit({"id": request_id, "ok": False, "error": {"code": code, "message": message}})


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg):
    sys.stderr.write("[laxii-worker] %s\n" % msg)
    sys.stderr.flush()


# ---------------------------------------------------------------------------
# Preflight — runs with stdlib only; reports truth what exists and what's missing
# ---------------------------------------------------------------------------

REQUIRED_PACKAGES = {
    "torch": "inference runtime (CUDA build)",
    "huggingface_hub": "checkpoint download/loading backend for diffusers",
    "diffusers": "pipelines (txt2img / inpaint / IP-Adapter)",
    "transformers": "CLIP/text encoders",
    "accelerate": "device placement / cpu offload",
    "safetensors": "checkpoint format",
    "numpy": "mask/metric math",
    "cv2": "OpenCV DNN — YuNet face detection + SFace (opencv-python)",
    "PIL": "image decode/encode (Pillow)",
}

MIN_DIFFUSERS_VERSION = "0.42"
MIN_TORCH_VERSION = "2.4"
MIN_VRAM_GB = 6.0
MIN_DISK_GB = 12.0


def run_preflight(params):
    py_ok = sys.version_info >= (3, 10)
    packages = {}
    missing = []
    for mod, purpose in REQUIRED_PACKAGES.items():
        m = try_import(mod)
        if m is None:
            packages[mod] = {"present": False, "purpose": purpose}
            missing.append(mod)
        else:
            version = None
            if mod in ("torch", "diffusers", "transformers", "accelerate"):
                version = getattr(m, "__version__", None)
            packages[mod] = {"present": True, "version": version, "purpose": purpose}
    diffusers_ok = packages["diffusers"]["present"] and _version_at_least(
        packages["diffusers"].get("version"), MIN_DIFFUSERS_VERSION
    )
    torch_ok = packages["torch"]["present"] and _version_at_least(
        packages["torch"].get("version"), MIN_TORCH_VERSION
    )

    cuda = {"available": False, "device": None, "vramTotalGb": None, "vramFreeGb": None,
            "fp16": False, "bf16": False}
    if torch_ok:
        torch = _IMPORT_CACHE["torch"]
        try:
            cuda["available"] = torch.cuda.is_available()
            if cuda["available"]:
                props = torch.cuda.get_device_properties(0)
                cuda["device"] = props.name
                cuda["vramTotalGb"] = round(props.total_memory / 1024 ** 3, 2)
                free, _total = torch.cuda.mem_get_info()
                cuda["vramFreeGb"] = round(free / 1024 ** 3, 2)
                cuda["fp16"] = torch.cuda.is_bf16_supported() or props.major >= 7
                cuda["bf16"] = torch.cuda.is_bf16_supported()
        except Exception as e:  # pragma: no cover - device-specific
            cuda["error"] = str(e)

    models_dir = params.get("modelsDir") or os.environ.get(
        "LAXII_MODELS_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
    )
    disk = {"modelsDir": models_dir, "freeGb": None, "sufficient": None}
    try:
        free_bytes = shutil.disk_usage(models_dir if os.path.isdir(models_dir) else os.path.dirname(models_dir) or ".").free
        disk["freeGb"] = round(free_bytes / 1024 ** 3, 2)
        disk["sufficient"] = disk["freeGb"] >= MIN_DISK_GB
    except Exception as e:
        disk["error"] = str(e)

    models = check_models(models_dir)

    ok = (
        py_ok
        and not missing
        and torch_ok
        and diffusers_ok
        and cuda["available"]
        and (cuda["vramFreeGb"] or 0) >= MIN_VRAM_GB
        and disk["sufficient"] is True
    )
    return {
        "workerVersion": WORKER_VERSION,
        "ok": ok,
        "python": {"version": "%d.%d.%d" % sys.version_info[:3], "ok": py_ok},
        "packages": packages,
        "missingPackages": missing,
        "torchMin": MIN_TORCH_VERSION,
        "diffusersMin": MIN_DIFFUSERS_VERSION,
        "cuda": cuda,
        "disk": disk,
        "models": models,
        "notes": [
            "ok=true means this HOST can run the worker; it is not proof any model has run.",
            "Real capability evidence comes from an executed inference test recorded by BEAN.",
        ],
    }


def _version_at_least(version, minimum):
    if not version:
        return False
    def parts(v):
        return [int(p) for p in v.split(".") if p.isdigit()]
    try:
        pv, pm = parts(version), parts(minimum)
        return pv >= pm
    except Exception:
        return False


def check_models(models_dir):
    """Verify declared checkpoints exist on disk; checksums are verified
    against models.sha256 when that file exists (never invented here)."""
    import hashlib

    declared = [
        ("sd15-inpaint", ["sd-v1-5-inpainting", "stable-diffusion-v1-5"], 3.0),
        ("sd15-base", ["sd15-base", "v1-5-pruned-emaonly.safetensors"], 2.0),
        ("sdxl-base-1.0", ["sdxl-base-1.0", "sd_xl_base_1.0.safetensors", "stable-diffusion-xl-base-1.0"], 6.0),
        ("ip-adapter-h94-sd15", ["ip-adapter"], 0.5),
        ("pulid-sdxl", ["pulid_sdxl.safetensors", "pulid"], 2.0),
        ("realesrgan-x4plus", ["RealESRGAN_x4plus.pth"], 0.05),
        ("big-lama", ["big-lama", "lama_fp32.jit"], 0.1),
        ("face-detection-yunet", ["face_detection_yunet_2023mar.onnx"], 0.001),
        ("face-recognition-sface", ["face_recognition_sface_2021dec.onnx"], 0.03),
    ]
    sha_path = os.path.join(models_dir, "models.sha256")
    sha_map = {}
    if os.path.isfile(sha_path):
        with open(sha_path, "r", encoding="utf-8") as fh:
            for line in fh:
                bits = line.strip().split()
                if len(bits) == 2:
                    sha_map[bits[1]] = bits[0]
    results = []
    for model_id, candidates, min_gb in declared:
        found = None
        for cand in candidates:
            p = os.path.join(models_dir, cand)
            if os.path.isdir(p) and os.listdir(p):
                found = {"path": p, "kind": "directory"}
                break
            if os.path.isfile(p):
                found = {"path": p, "kind": "file"}
                break
        entry = {"id": model_id, "present": found is not None, "minGb": min_gb}
        if found:
            entry.update(found)
            if found["kind"] == "file":
                size_gb = os.path.getsize(found["path"]) / 1024 ** 3
                entry["sizeGb"] = round(size_gb, 3)
                expected = sha_map.get(os.path.basename(found["path"]))
                if expected:
                    h = hashlib.sha256()
                    with open(found["path"], "rb") as fh:
                        for chunk in iter(lambda: fh.read(1 << 20), b""):
                            h.update(chunk)
                    entry["checksumVerified"] = h.hexdigest() == expected
                else:
                    entry["checksumVerified"] = None
        results.append(entry)
    return results


# ---------------------------------------------------------------------------
# Engine (lazy — only touchable after preflight-level deps are present)
# ---------------------------------------------------------------------------

class Engine:
    def __init__(self):
        self.lock = threading.Lock()
        self.pipelines = {}
        self.current_model = None
        self.embeddings = {}  # handle -> {rects, embedding}
        self._embed_counter = 0
        self.cancelled = set()

    # -- guards ------------------------------------------------------------

    def _require(self, request_id, *modules):
        missing = [m for m in modules if try_import(m) is None]
        if missing:
            fail(request_id, "UNAVAILABLE",
                 "Worker cannot run: missing packages %s. Run preflight for the full report." % ", ".join(missing))
            return False
        return True

    def _need_model(self, request_id, model_id):
        models = check_models(models_dir())
        entry = next((m for m in models if m["id"] == model_id), None)
        if not entry or not entry.get("present"):
            fail(request_id, "MODEL_MISSING",
                 "Checkpoint '%s' is not downloaded to the models dir. Download it per the manifest; BEAN never fabricates results." % model_id)
            return False
        return True

    def _b64_to_pil(self, b64):
        from PIL import Image
        return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")

    def _pil_to_b64_png(self, image):
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("ascii")

    def _cancel_cb(self, request_id, total):
        def _cb(pipe, step_index, timestep, callback_kwargs):
            if request_id in self.cancelled:
                raise _Cancelled()
            emit({"id": request_id, "type": "progress",
                  "step": step_index + 1, "total": total})
            return callback_kwargs
        return _cb

    # -- model loading with VRAM discipline --------------------------------

    def _load(self, request_id, model_id, task):
        torch = _IMPORT_CACHE["torch"]
        diffusers = _IMPORT_CACHE["diffusers"]
        key = (model_id, task)
        if key in self.pipelines:
            return self.pipelines[key]
        cuda = torch.cuda.is_available()
        dtype = torch.float16 if cuda else torch.float32
        log("loading %s (%s) dtype=%s" % (model_id, task, dtype))
        t0 = time.time()
        base = model_path(model_id)
        if model_id == "sd15-inpaint" and task == "inpaint":
            weights = _find_weights(base)
            if not weights:
                fail(request_id, "MODEL_MISSING",
                     "No loadable SD1.5-inpaint checkpoint (.safetensors/.ckpt) under %s. Run local/download_models.py." % base)
                return None
            pipe = diffusers.StableDiffusionInpaintPipeline.from_single_file(
                weights, torch_dtype=dtype)
        elif model_id == "sd15-base" and task == "txt2img":
            weights = _find_weights(base)
            if not weights:
                fail(request_id, "MODEL_MISSING",
                     "No loadable SD1.5-base checkpoint (.safetensors) under %s. Run local/download_models.py." % base)
                return None
            pipe = diffusers.StableDiffusionPipeline.from_single_file(
                weights, torch_dtype=dtype)
        elif model_id == "sdxl-base-1.0" and task == "inpaint":
            if not _is_diffusers_dir(base):
                fail(request_id, "MODEL_MISSING",
                     "SDXL masked inpainting requires the diffusers-layout directory %s "
                     "(model_index.json + fp16 variant weights); the lone single-file checkpoint "
                     "cannot provide the 9-channel inpaint UNet. Run local/download_models.py." % base)
                return None
            pipe = diffusers.StableDiffusionXLInpaintPipeline.from_pretrained(
                base, torch_dtype=dtype, variant="fp16")
        elif model_id == "sdxl-base-1.0" and task == "txt2img":
            if _is_diffusers_dir(base):
                pipe = diffusers.StableDiffusionXLPipeline.from_pretrained(
                    base, torch_dtype=dtype, variant="fp16")
            else:
                weights = _find_weights(base)
                if not weights:
                    fail(request_id, "MODEL_MISSING",
                         "No SDXL checkpoint found under %s. Run local/download_models.py." % base)
                    return None
                pipe = diffusers.StableDiffusionXLPipeline.from_single_file(
                    weights, torch_dtype=dtype)
        else:
            fail(request_id, "MODEL_UNSUPPORTED",
                 "Model '%s' is not registered for task '%s'. Note: the SD1.5-inpaint "
                 "checkpoint (9-channel UNet) cannot serve plain txt2img; use sd15-base "
                 "or sdxl-base-1.0." % (model_id, task))
            return None
        if cuda:
            pipe = pipe.to("cuda")
            pipe.enable_attention_slicing()
        else:
            pipe.enable_model_cpu_offload()
        self.pipelines = {key: pipe}  # keep ONE pipeline resident (VRAM discipline)
        self.current_model = key
        log("loaded %s in %.1fs" % (model_id, time.time() - t0))
        return pipe

    def unload(self):
        torch = _IMPORT_CACHE.get("torch")
        self.pipelines.clear()
        self.current_model = None
        if torch is not None and torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
        return {"unloaded": True}


class _Cancelled(Exception):
    pass


def models_dir():
    return os.environ.get(
        "LAXII_MODELS_DIR",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "models"))


def model_path(model_id):
    mapping = {
        "sd15-inpaint": "sd-v1-5-inpainting",
        "sd15-base": "sd15-base",
        "sdxl-base-1.0": "sdxl-base-1.0",
        "ip-adapter-h94-sd15": "ip-adapter",
    }
    return os.path.join(models_dir(), mapping.get(model_id, model_id))


def _is_diffusers_dir(path):
    """True when `path` is a diffusers-layout pipeline directory."""
    return os.path.isdir(path) and os.path.isfile(os.path.join(path, "model_index.json"))


def _find_weights(path):
    """Resolve a concrete single-file checkpoint under `path` (or `path` itself
    when it is a file). Prefers .safetensors over pickle formats (.ckpt/.pt/.bin).
    Returns None for diffusers-layout directories (those load via from_pretrained)
    and for anything with no loadable weights."""
    if os.path.isfile(path):
        return path
    if not os.path.isdir(path) or _is_diffusers_dir(path):
        return None
    candidates = []
    for root, _dirs, files in os.walk(path):
        for name in files:
            if name.endswith(".safetensors") or name.endswith((".ckpt", ".pt", ".bin")):
                candidates.append(os.path.join(root, name))
    candidates.sort(key=lambda p: (0 if p.endswith(".safetensors") else 1, p))
    return candidates[0] if candidates else None


# ---------------------------------------------------------------------------
# Methods
# ---------------------------------------------------------------------------

def method_txt2img(engine, request_id, p):
    if not engine._require(request_id, "torch", "diffusers", "PIL"):
        return
    model_id = p.get("model", "sdxl-base-1.0")
    if not engine._need_model(request_id, model_id):
        return
    pipe = engine._load(request_id, model_id, "txt2img")
    if pipe is None:
        return
    gen = _make_generator(p.get("seed"))
    kwargs = dict(
        prompt=p["prompt"],
        width=_snap(p.get("width", 1024)),
        height=_snap(p.get("height", 1024)),
        num_inference_steps=int(p.get("steps", 30)),
        guidance_scale=float(p.get("guidance", 6.0)),
    )
    if p.get("negativePrompt"):
        kwargs["negative_prompt"] = p["negativePrompt"]
    if gen is not None:
        kwargs["generator"] = gen
    try:
        with engine.lock:
            out = pipe(callback_on_step_end=engine._cancel_cb(request_id, kwargs["num_inference_steps"]), **kwargs)
    except _Cancelled:
        engine.cancelled.discard(request_id)
        fail(request_id, "CANCELLED", "Cancelled by request.")
        return
    images = [engine._pil_to_b64_png(im) for im in out.images]
    used_seed = p.get("seed")
    emit({"id": request_id, "ok": True, "result": {
        "images": images, "model": model_id,
        "seed": used_seed, "steps": kwargs["num_inference_steps"],
        "guidance": kwargs["guidance_scale"],
        "size": [kwargs["width"], kwargs["height"]],
    }})


def method_inpaint(engine, request_id, p):
    if not engine._require(request_id, "torch", "diffusers", "numpy", "PIL"):
        return
    model_id = p.get("model", "sd15-inpaint")
    if not engine._need_model(request_id, model_id):
        return
    pipe = engine._load(request_id, model_id, "inpaint")
    if pipe is None:
        return
    import numpy as np
    image = engine._b64_to_pil(p["image"])
    mask_img = engine._b64_to_pil(p["mask"]).convert("L")
    # Mask semantics: alpha>0 = EDITABLE (matches BEAN TS engine).
    mask_arr = 255 - np.array(mask_img)  # diffusers: 0 = keep, 255 = regenerate
    from PIL import Image as PILImage
    mask_img = PILImage.fromarray(mask_arr.astype("uint8"))
    kwargs = dict(
        prompt=p["prompt"],
        image=image,
        mask_image=mask_img,
        num_inference_steps=int(p.get("steps", 30)),
        guidance_scale=float(p.get("guidance", 6.0)),
        strength=float(p.get("strength", 1.0)),
    )
    if p.get("negativePrompt"):
        kwargs["negative_prompt"] = p["negativePrompt"]
    seed = p.get("seed")
    if seed is not None:
        kwargs["generator"] = _make_generator(seed)
    try:
        with engine.lock:
            out = pipe(callback_on_step_end=engine._cancel_cb(request_id, kwargs["num_inference_steps"]), **kwargs)
    except _Cancelled:
        engine.cancelled.discard(request_id)
        fail(request_id, "CANCELLED", "Cancelled by request.")
        return
    emit({"id": request_id, "ok": True, "result": {
        "images": [engine._pil_to_b64_png(im) for im in out.images],
        "model": model_id, "seed": seed, "steps": kwargs["num_inference_steps"],
    }})


def method_reference_generate(engine, request_id, p):
    if not engine._require(request_id, "torch", "diffusers", "transformers", "PIL"):
        return
    # IP-Adapter conditioning runs on a BASE txt2img host. The sd15-inpaint
    # checkpoint is NOT valid here (its 9-channel UNet is inpaint-only), and
    # the deployed h94 adapter set is the SD1.5 one — an SDXL host would need
    # sdxl_models/* which is deliberately not deployed.
    model_id = p.get("model", "sd15-base")
    if model_id != "sd15-base":
        fail(request_id, "MODEL_UNSUPPORTED",
             "reference_generate currently supports model 'sd15-base' only (h94 SD1.5 "
             "IP-Adapter set, Apache-2.0); got '%s'." % model_id)
        return
    if not engine._need_model(request_id, model_id):
        return
    pipe = engine._load(request_id, model_id, "txt2img")
    if pipe is None:
        return
    ip_dir = model_path("ip-adapter-h94-sd15")  # models/ip-adapter (h94 repo layout)
    if not _is_ip_adapter_dir(ip_dir):
        fail(request_id, "MODEL_MISSING",
             "IP-Adapter checkpoint missing under %s — expected the h94/IP-Adapter layout "
             "(models/ip-adapter_sd15.safetensors + models/image_encoder). Run local/download_models.py." % ip_dir)
        return
    try:
        pipe.load_ip_adapter(
            ip_dir,
            subfolder="models",
            weight_name=p.get("ipAdapter", {}).get("weightName", "ip-adapter_sd15.safetensors"),
            image_encoder_folder="models/image_encoder",
        )
        pipe.set_ip_adapter_scale(float(p.get("ipAdapter", {}).get("scale", 0.6)))
        ref = engine._b64_to_pil(p["referenceImage"])
        kwargs = dict(
            prompt=p["prompt"],
            ip_adapter_image=ref,
            width=_snap(p.get("width", 512)),
            height=_snap(p.get("height", 512)),
            num_inference_steps=int(p.get("steps", 30)),
            guidance_scale=float(p.get("guidance", 6.0)),
        )
        seed = p.get("seed")
        if seed is not None:
            kwargs["generator"] = _make_generator(seed)
        with engine.lock:
            out = pipe(callback_on_step_end=engine._cancel_cb(request_id, kwargs["num_inference_steps"]), **kwargs)
    except _Cancelled:
        engine.cancelled.discard(request_id)
        fail(request_id, "CANCELLED", "Cancelled by request.")
        return
    except Exception as e:
        fail(request_id, "BACKEND_FAILURE", "Reference generation failed: %s" % e)
        return
    emit({"id": request_id, "ok": True, "result": {
        "images": [engine._pil_to_b64_png(im) for im in out.images],
        "model": model_id, "referenceConditioning": p.get("ipAdapter", {}),
    }})


def method_identity_prepare(engine, request_id, p):
    """YuNet detect + SFace embed. Embeddings stay in worker memory (local
    processing guarantee); only rects and a handle are returned."""
    if not engine._require(request_id, "cv2", "numpy"):
        return
    import cv2
    import numpy as np
    yunet_path = model_path("face-detection-yunet")
    sface_path = model_path("face-recognition-sface")
    for path, label in ((yunet_path, "face-detection-yunet"), (sface_path, "face-recognition-sface")):
        if not (os.path.isfile(path) or os.path.isdir(path)):
            fail(request_id, "MODEL_MISSING", "Face model missing: %s" % label)
            return
    detector = cv2.FaceDetectorYN.create(os.path.realpath(yunet_path) if os.path.isfile(yunet_path) else _find_onnx(yunet_path), "", (320, 320))
    recognizer = cv2.FaceRecognizerSF.create(
        os.path.realpath(sface_path) if os.path.isfile(sface_path) else _find_onnx(sface_path), "")
    img = cv2.imdecode(np.frombuffer(base64.b64decode(p["image"]), dtype=np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    rects = []
    aligned_feats = []
    if faces is not None:
        for f in faces:
            x, y, fw, fh = [int(v) for v in f[:4]]
            rects.append({"x": x, "y": y, "width": fw, "height": fh})
            aligned = recognizer.alignCrop(img, f)
            aligned_feats.append(recognizer.feature(aligned))
    handle = None
    if aligned_feats:
        engine._embed_counter += 1
        handle = "emb-%d" % engine._embed_counter
        engine.embeddings[handle] = aligned_feats
    emit({"id": request_id, "ok": True, "result": {
        "handle": handle,
        "faces": rects,
        "count": len(rects),
        "metric": "SFace cosine (similarity estimate, not proof of identity)",
        "processedLocally": True,
    }})


def method_identity_check(engine, request_id, p):
    """Compare two images' faces. If both images contain exactly one face,
    returns a single similarity; multi-face -> best-matching pair with all
    scores attached (multi-face identity handling is explicit, not hidden)."""
    if not engine._require(request_id, "cv2", "numpy"):
        return
    if not (engine._need_model(request_id, "face-detection-yunet")
            and engine._need_model(request_id, "face-recognition-sface")):
        return
    import cv2
    import numpy as np

    def embed(b64):
        yunet_path = _find_onnx(model_path("face-detection-yunet")) or model_path("face-detection-yunet")
        sface_path = _find_onnx(model_path("face-recognition-sface")) or model_path("face-recognition-sface")
        detector = cv2.FaceDetectorYN.create(yunet_path, "", (320, 320))
        recognizer = cv2.FaceRecognizerSF.create(sface_path, "")
        img = cv2.imdecode(np.frombuffer(base64.b64decode(b64), dtype=np.uint8), cv2.IMREAD_COLOR)
        h, w = img.shape[:2]
        detector.setInputSize((w, h))
        _, faces = detector.detect(img)
        out = []
        if faces is not None:
            for f in faces:
                aligned = recognizer.alignCrop(img, f)
                out.append(recognizer.feature(aligned))
        return out

    feats_a = embed(p["imageA"])
    feats_b = embed(p["imageB"])
    threshold = float(p.get("threshold", 0.363))
    if not feats_a or not feats_b:
        emit({"id": request_id, "ok": True, "result": {
            "detectedA": len(feats_a), "detectedB": len(feats_b),
            "verdict": "no-face-detected",
            "note": "No face found; identity gate cannot run. Use user-approved face regions instead.",
        }})
        return
    scores = [
        float(cv2.FaceRecognizerSF.compare(feats_a[i], feats_b[j])[0])
        for i in range(len(feats_a)) for j in range(len(feats_b))
    ]
    best = max(scores)
    emit({"id": request_id, "ok": True, "result": {
        "similarity": best,
        "allScores": scores,
        "threshold": threshold,
        "passed": best >= threshold,
        "metric": "SFace cosine",
        "verdict": "within-range" if best >= threshold else "flagged",
        "note": "A similarity score is an estimate against a configured threshold — never proof of identical identity.",
    }})


def method_upscale(engine, request_id, p):
    if not engine._require(request_id, "torch", "numpy", "PIL"):
        return
    model = p.get("model", "realesrgan-x4plus")
    if model == "lanczos":
        from PIL import Image
        img = engine._b64_to_pil(p["image"])
        factor = int(p.get("factor", 4))
        up = img.resize((img.width * factor, img.height * factor), Image.LANCZOS)
        emit({"id": request_id, "ok": True, "result": {
            "images": [engine._pil_to_b64_png(up)], "model": "lanczos"}})
        return
    if not engine._need_model(request_id, "realesrgan-x4plus"):
        return
    try:
        import torch  # noqa: F401
        from basicsr.archs.rrdbnet_arch import RRDBNet
        from realesrgan import RealESRGANer
    except Exception:
        fail(request_id, "UNAVAILABLE",
             "Real-ESRGAN requires the 'realesrgan' and 'basicsr' packages (see requirements.txt).")
        return
    rrdb = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4)
    upsampler = RealESRGANer(
        scale=4, model_path=model_path("realesrgan-x4plus"), model=rrdb,
        tile=int(p.get("tile", 384)), tile_pad=10, pre_pad=0, half=True)
    import numpy as np
    img = engine._b64_to_pil(p["image"])
    arr = np.array(img)[:, :, ::-1]
    out, _ = upsampler.enhance(arr, outscale=int(p.get("factor", 4)))
    from PIL import Image as PILImage
    up = PILImage.fromarray(out[:, :, ::-1])
    emit({"id": request_id, "ok": True, "result": {
        "images": [engine._pil_to_b64_png(up)], "model": "realesrgan-x4plus"}})


def method_object_removal(engine, request_id, p):
    """LaMa big-lama (TorchScript) — large-mask structural inpaint."""
    if not engine._require(request_id, "torch", "numpy", "PIL"):
        return
    if not engine._need_model(request_id, "big-lama"):
        return
    import numpy as np
    import torch
    from PIL import Image

    jit_path = _find_onnx(model_path("big-lama")) or os.path.join(model_path("big-lama"), "model.jit")
    if not os.path.isfile(jit_path):
        fail(request_id, "MODEL_MISSING", "big-lama TorchScript file not found under %s." % model_path("big-lama"))
        return
    model = torch.jit.load(jit_path, map_location="cpu").eval()
    img = engine._b64_to_pil(p["image"])
    mask = np.array(engine._b64_to_pil(p["mask"]).convert("L")) > 127  # True = remove
    arr = np.array(img).astype(np.float32) / 255.0
    # Pad to multiples of 8 (LaMa requirement).
    ph, pw = (8 - arr.shape[0] % 8) % 8, (8 - arr.shape[1] % 8) % 8
    arr_p = np.pad(arr, ((0, ph), (0, pw), (0, 0)), mode="reflect")
    mask_p = np.pad(mask, ((0, ph), (0, pw)), mode="reflect")
    x = torch.from_numpy(arr_p.transpose(2, 0, 1)[None])
    m = torch.from_numpy(mask_p[None, None].astype(np.float32))
    with torch.no_grad():
        pred = model(x, m)
    out = pred[0].permute(1, 2, 0).clamp(0, 1).numpy()
    out = (out[: arr.shape[0], : arr.shape[1]] * 255).astype(np.uint8)
    emit({"id": request_id, "ok": True, "result": {
        "images": [engine._pil_to_b64_png(Image.fromarray(out))], "model": "big-lama"}})


def _find_onnx(path):
    if os.path.isfile(path):
        return path
    if os.path.isdir(path):
        for name in sorted(os.listdir(path)):
            if name.endswith(".onnx"):
                return os.path.join(path, name)
    return None


def _is_ip_adapter_dir(path):
    """The h94/IP-Adapter layout reference_generate loads offline:
       <dir>/models/ip-adapter_sd15.safetensors + <dir>/models/image_encoder/."""
    return (
        os.path.isdir(path)
        and os.path.isfile(os.path.join(path, "models", "ip-adapter_sd15.safetensors"))
        and os.path.isdir(os.path.join(path, "models", "image_encoder"))
    )


def _snap(v):
    return max(64, int(round(v / 64.0)) * 64)


def _make_generator(seed):
    torch = _IMPORT_CACHE.get("torch")
    if seed is None or torch is None:
        return None
    if torch.cuda.is_available():
        return torch.Generator("cuda").manual_seed(int(seed))
    return torch.Generator("cpu").manual_seed(int(seed))


METHODS = {
    "txt2img": method_txt2img,
    "inpaint": method_inpaint,
    "reference_generate": method_reference_generate,
    "identity_prepare": method_identity_prepare,
    "identity_check": method_identity_check,
    "upscale": method_upscale,
    "object_removal": method_object_removal,
}


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="LAXII local Diffusers worker")
    parser.add_argument("--models-dir", default=None, help="checkpoint directory")
    args = parser.parse_args()
    if args.models_dir:
        os.environ["LAXII_MODELS_DIR"] = args.models_dir

    engine = Engine()
    emit({"id": None, "type": "ready", "workerVersion": WORKER_VERSION,
          "pid": os.getpid()})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            fail(None, "BAD_REQUEST", "Unparseable request line: %s" % e)
            continue
        rid = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}
        try:
            if method == "preflight":
                emit({"id": rid, "ok": True, "result": run_preflight(params)})
            elif method == "health":
                if engine.current_model:
                    emit({"id": rid, "ok": True, "result": {
                        "loaded": list("%s:%s" % k for k in engine.pipelines.keys()),
                        "vramFreeGb": _vram_free()}})
                else:
                    emit({"id": rid, "ok": True, "result": {
                        "loaded": [], "vramFreeGb": _vram_free(),
                        "note": "No pipeline resident; models load on demand."}})
            elif method == "unload":
                emit({"id": rid, "ok": True, "result": engine.unload()})
            elif method == "cancel":
                target = params.get("targetId")
                if target:
                    engine.cancelled.add(target)
                emit({"id": rid, "ok": True, "result": {"cancelled": target}})
            elif method in METHODS:
                engine.cancelled.discard(rid)
                METHODS[method](engine, rid, params)
            else:
                fail(rid, "UNKNOWN_METHOD", "Unknown method '%s'." % method)
        except _Cancelled:
            fail(rid, "CANCELLED", "Cancelled by request.")
        except BrokenPipeError:
            break
        except Exception as e:  # never crash the loop on a single failure
            log("error in %s: %r" % (method, e))
            fail(rid, "INTERNAL_ERROR", "%s: %s" % (type(e).__name__, e))
    log("stdin closed; exiting")


def _vram_free():
    torch = _IMPORT_CACHE.get("torch")
    if torch is not None and torch.cuda.is_available():
        try:
            free, _ = torch.cuda.mem_get_info()
            return round(free / 1024 ** 3, 2)
        except Exception:
            return None
    return None


if __name__ == "__main__":
    main()
