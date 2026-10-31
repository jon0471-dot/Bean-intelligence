#!/usr/bin/env python3
"""LAXII Phase 8 — checkpoint downloader for the local GPU host.

Downloads every declared LAXII checkpoint into the EXACT layout the worker
preflight expects (workers/laxii-diffusers/models/), verifies SHA-256 for every
file, and writes a full provenance record. Nothing here is optional paperwork:

  - Licenses are PRINTED and require --accept-licenses (OpenRAIL models carry
    use-based restrictions; you accept them for your deployment).
  - Every file's SHA-256 is computed at download time and written to
    models/models.sha256 ("<hex>  <relpath>") + models/download-record.json
    (repo/revision, license, size, hash). run_acceptance.py re-verifies all of
    them before any inference.

Usage (inside the setup venv):
    python local/download_models.py --accept-licenses            # everything
    python local/download_models.py --accept-licenses --only sdxl-base-1.0

Layout produced (matches worker.py 0.3.1 model_path mapping):
    models/
      sd-v1-5-inpainting/sd-v1-5-inpainting.safetensors   ~4.3 GB
      sd15-base/v1-5-pruned-emaonly.safetensors           ~4.3 GB
      sdxl-base-1.0/          (diffusers layout, fp16 variants)  ~6.9 GB
      ip-adapter/models/ip-adapter_sd15.safetensors        ~0.1 GB
      ip-adapter/models/image_encoder/model.safetensors    ~2.5 GB
      RealESRGAN_x4plus.pth                                ~0.07 GB
      big-lama/model.jit                                   ~0.2 GB
      face_detection_yunet_2023mar.onnx                    ~0.4 MB
      face_recognition_sface_2021dec.onnx                  ~40 MB
      models.sha256, download-record.json
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import time
import urllib.request
import zipfile

WORKER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # workers/laxii-diffusers
DEFAULT_MODELS_DIR = os.path.join(WORKER_DIR, "models")
RECORD_VERSION = 1

# ---------------------------------------------------------------------------
# Download plan. Sizes are from the official cards (approximate). URLs were
# HEAD-verified on 2026-10-31. Licenses were verified in
# docs/models/LAXII-ENGINE-DECISION-MATRIX.md (sources there).
# ---------------------------------------------------------------------------

def hf(repo, filename, target, size_gb, note):
    return {"kind": "hf_file", "repo": repo, "filename": filename,
            "target": target, "sizeGb": size_gb, "note": note}

def hf_folder(repo, pattern, target_dir, size_gb, note):
    return {"kind": "hf_folder", "repo": repo, "pattern": pattern,
            "targetDir": target_dir, "sizeGb": size_gb, "note": note}

def url_file(url, target, size_gb, note):
    return {"kind": "url_file", "url": url, "target": target,
            "sizeGb": size_gb, "note": note}

def url_zip_extract(url, target_dir, inner, target, size_gb, note):
    return {"kind": "url_zip_extract", "url": url, "targetDir": target_dir,
            "inner": inner, "target": target, "sizeGb": size_gb, "note": note}

MODELS = [
    {
        "id": "sd15-inpaint",
        "role": "masked inpainting fast tier (Smart Edit)",
        "license": "CreativeML OpenRAIL-M (commercial use permitted subject to use-based restrictions)",
        "licenseSource": "https://huggingface.co/sd-legacy/stable-diffusion-inpainting",
        "items": [hf("webui/stable-diffusion-inpainting",
                     "sd-v1-5-inpainting.safetensors",
                     "sd-v1-5-inpainting/sd-v1-5-inpainting.safetensors",
                     4.3,
                     "community mirror of the deprecated runwayml repo; safetensors (no pickle execution). "
                     "Official card: sd-legacy/stable-diffusion-inpainting")],
    },
    {
        "id": "sd15-base",
        "role": "base SD1.5 txt2img host for IP-Adapter reference-guided generation",
        "license": "CreativeML OpenRAIL-M (commercial use permitted subject to use-based restrictions)",
        "licenseSource": "https://huggingface.co/sd-legacy/stable-diffusion-v1-5",
        "items": [hf("sd-legacy/stable-diffusion-v1-5",
                     "v1-5-pruned-emaonly.safetensors",
                     "sd15-base/v1-5-pruned-emaonly.safetensors",
                     4.3,
                     "successor org of the deprecated runwayml repo")],
    },
    {
        "id": "sdxl-base-1.0",
        "role": "professional txt2img + masked inpainting (diffusers layout, fp16 variants)",
        "license": "CreativeML Open RAIL++-M License (commercial use permitted subject to use-based restrictions)",
        "licenseSource": "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0",
        "items": [hf_folder("stabilityai/stable-diffusion-xl-base-1.0",
                            ["model_index.json", "*.json",
                             "scheduler/*", "tokenizer/*", "tokenizer_2/*",
                             "text_encoder/config.json", "text_encoder/model.fp16.safetensors",
                             "text_encoder_2/config.json", "text_encoder_2/model.fp16.safetensors",
                             "unet/config.json", "unet/diffusion_pytorch_model.fp16.safetensors",
                             "vae/config.json", "vae/diffusion_pytorch_model.fp16.safetensors"],
                            "sdxl-base-1.0",
                            6.9,
                            "fp16 variant files only; *.bin / safety_checker / single-file skips")],
    },
    {
        "id": "ip-adapter-h94-sd15",
        "role": "reference-guided conditioning (SD1.5 base adapter set)",
        "license": "Apache-2.0 (h94/IP-Adapter re-release of the tencent-ailab IP-Adapter)",
        "licenseSource": "https://huggingface.co/h94/IP-Adapter",
        "excluded": "h94/IP-Adapter-FaceID is NON-COMMERCIAL (insightface) and is deliberately NOT downloaded",
        "items": [
            hf("h94/IP-Adapter", "models/ip-adapter_sd15.safetensors",
               "ip-adapter/models/ip-adapter_sd15.safetensors", 0.1, "SD1.5 base adapter"),
            hf_folder("h94/IP-Adapter", ["models/image_encoder/*"], "ip-adapter",
                      2.5, "CLIP ViT-H image encoder (needed offline)"),
        ],
    },
    {
        "id": "realesrgan-x4plus",
        "role": "generative-class x4 upscaling",
        "license": "BSD-3-Clause",
        "licenseSource": "https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE",
        "items": [url_file("https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
                           "RealESRGAN_x4plus.pth", 0.07, "official v0.1.0 release asset")],
    },
    {
        "id": "big-lama",
        "role": "large-mask object removal (TorchScript)",
        "license": "Apache-2.0 (advimman/lama)",
        "licenseSource": "https://github.com/advimman/lama",
        "items": [url_zip_extract(
            "https://huggingface.co/smartywu/big-lama/resolve/main/big-lama.zip",
            "big-lama", "big-lama.pt", "big-lama/model.jit", 0.2,
            "widely-used IOPaint TorchScript packaging of the Apache-2.0 big-lama weights "
            "(the upstream repo ships training checkpoints, not TorchScript)")],
    },
    {
        "id": "face-detection-yunet",
        "role": "face-region detection for protection + drift gate",
        "license": "MIT (OpenCV Zoo model directory)",
        "licenseSource": "https://huggingface.co/opencv/face_detection_yunet",
        "items": [url_file("https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
                           "face_detection_yunet_2023mar.onnx", 0.001, "official OpenCV Zoo file")],
    },
    {
        "id": "face-recognition-sface",
        "role": "identity-similarity metric (ESTIMATE, never proof of identity)",
        "license": "MIT per model directory — PROVISIONAL for commercial use: training-data "
                   "provenance review pending (OpenCV Zoo issue #318). The worker labels every "
                   "score as a similarity estimate.",
        "licenseSource": "https://huggingface.co/opencv/face_recognition_sface",
        "items": [url_file("https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx",
                           "face_recognition_sface_2021dec.onnx", 0.04, "official OpenCV Zoo file")],
    },
]

# pulid-sdxl is DECLARED in the manifest but has no worker method wired yet —
# it is NOT downloaded by this script (honest: unused bytes are not deployed).


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def hf_commit_sha(repo):
    """Record the exact revision served at download time (never guess it)."""
    try:
        with urllib.request.urlopen(
                "https://huggingface.co/api/models/%s" % repo, timeout=30) as r:
            return json.load(r).get("sha")
    except Exception:
        return None


def download_url(url, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    part = dest + ".part"
    t0 = time.time()
    with urllib.request.urlopen(url, timeout=120) as resp, open(part, "wb") as fh:
        shutil.copyfileobj(resp, fh, 1 << 20)
    os.replace(part, dest)
    return time.time() - t0


def main():
    ap = argparse.ArgumentParser(description="LAXII checkpoint downloader")
    ap.add_argument("--models-dir", default=DEFAULT_MODELS_DIR)
    ap.add_argument("--accept-licenses", action="store_true",
                    help="confirm you have read the printed licenses for your deployment")
    ap.add_argument("--only", action="append", default=[],
                    help="download only these model ids (repeatable)")
    args = ap.parse_args()

    models = [m for m in MODELS if not args.only or m["id"] in args.only]
    if args.only:
        known = {m["id"] for m in MODELS}
        for oid in args.only:
            if oid not in known:
                print("unknown --only id: %s (known: %s)" % (oid, ", ".join(sorted(known))))
                return 2

    print("=" * 78)
    print("LAXII checkpoint licenses — read before accepting (deployment-wide):")
    total_gb = 0.0
    for m in models:
        for it in m["items"]:
            total_gb += it["sizeGb"]
        excluded = ("\n      EXCLUDED: " + m["excluded"]) if m.get("excluded") else ""
        print("  - %s — %s\n      %s\n      license: %s\n      source:  %s%s"
              % (m["id"], m["role"], m["licenseSource"], m["license"],
                 ", ".join(sorted({i.get("repo", i.get("url", "")) for i in m["items"]})), excluded))
    print("  approx total download: %.1f GB (+ HF cache overhead)" % total_gb)
    print("=" * 78)
    if not args.accept_licenses:
        print("\nRefusing to download without consent. Re-run with --accept-licenses "
              "after reading the licenses above.")
        return 2

    os.makedirs(args.models_dir, exist_ok=True)
    record = {
        "recordVersion": RECORD_VERSION,
        "downloadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "modelsDir": os.path.abspath(args.models_dir),
        "licensesAcceptedByFlag": True,
        "models": [],
    }
    sha_lines = []

    for m in models:
        entry = {"id": m["id"], "license": m["license"], "items": []}
        print("\n[%s]" % m["id"])
        for it in m["items"]:
            if it["kind"] == "hf_file":
                dest = os.path.join(args.models_dir, it["target"])
                if os.path.isfile(dest):
                    print("  exists, verifying: %s" % it["target"])
                else:
                    print("  hf download: %s @ %s (~%.1f GB)" % (it["filename"], it["repo"], it["sizeGb"]))
                    from huggingface_hub import hf_hub_download
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    got = hf_hub_download(repo_id=it["repo"], filename=it["filename"])
                    os.makedirs(os.path.dirname(dest), exist_ok=True)
                    shutil.move(got, dest)
                digest = sha256_of(dest)
                sha_lines.append("%s  %s" % (digest, it["target"]))
                entry["items"].append({"kind": "hf_file", "repo": it["repo"], "file": it["target"],
                                       "bytes": os.path.getsize(dest), "sha256": digest,
                                       "revision": hf_commit_sha(it["repo"]), "note": it["note"]})
                print("    sha256 %s" % digest)

            elif it["kind"] == "hf_folder":
                print("  hf snapshot: %s from %s (~%.1f GB)" % (it["pattern"], it["repo"], it["sizeGb"]))
                from huggingface_hub import snapshot_download
                local = snapshot_download(repo_id=it["repo"], allow_patterns=it["pattern"])
                dest_dir = os.path.join(args.models_dir, it["targetDir"])
                os.makedirs(dest_dir, exist_ok=True)
                copied = 0
                for root, _dirs, files in os.walk(local):
                    rel = os.path.relpath(root, local)
                    for name in files:
                        src = os.path.join(root, name)
                        dst = os.path.join(dest_dir, rel, name)
                        os.makedirs(os.path.dirname(dst), exist_ok=True)
                        shutil.copy2(src, dst)
                        relpath = os.path.normpath(os.path.join(rel, name)).replace("\\", "/")
                        digest = sha256_of(dst)
                        sha_lines.append("%s  %s" % (digest, relpath))
                        entry["items"].append({"kind": "hf_file", "repo": it["repo"], "file": relpath,
                                               "bytes": os.path.getsize(dst), "sha256": digest,
                                               "revision": hf_commit_sha(it["repo"]), "note": it["note"]})
                        copied += 1
                print("    %d files copied from cache" % copied)

            elif it["kind"] == "url_file":
                dest = os.path.join(args.models_dir, it["target"])
                if not os.path.isfile(dest):
                    print("  url download: %s (~%.2f GB)" % (it["url"], it["sizeGb"]))
                    took = download_url(it["url"], dest)
                    print("    done in %.1fs" % took)
                digest = sha256_of(dest)
                sha_lines.append("%s  %s" % (digest, it["target"]))
                entry["items"].append({"kind": "url_file", "url": it["url"], "file": it["target"],
                                       "bytes": os.path.getsize(dest), "sha256": digest, "note": it["note"]})
                print("    sha256 %s" % digest)

            elif it["kind"] == "url_zip_extract":
                dest = os.path.join(args.models_dir, it["target"])
                if not os.path.isfile(dest):
                    zpath = os.path.join(args.models_dir, "_big-lama.zip")
                    print("  url download + extract: %s" % it["url"])
                    download_url(it["url"], zpath)
                    os.makedirs(os.path.join(args.models_dir, it["targetDir"]), exist_ok=True)
                    with zipfile.ZipFile(zpath) as zf:
                        inner = [n for n in zf.namelist()
                                 if n.endswith(it["inner"]) or n.endswith(it["inner"].replace(".pt", ".pth"))]
                        if not inner:
                            print("    zip contents: %s" % zf.namelist())
                            raise SystemExit("expected %s inside the zip" % it["inner"])
                        with zf.open(inner[0]) as src, open(dest, "wb") as out:
                            shutil.copyfileobj(src, out)
                    os.remove(zpath)
                digest = sha256_of(dest)
                sha_lines.append("%s  %s" % (digest, it["target"]))
                entry["items"].append({"kind": "url_zip_extract", "url": it["url"], "file": it["target"],
                                       "bytes": os.path.getsize(dest), "sha256": digest, "note": it["note"]})
                print("    sha256 %s" % digest)
        record["models"].append(entry)

    # Persist the two verification artifacts.
    with open(os.path.join(args.models_dir, "models.sha256"), "w", encoding="utf-8") as fh:
        fh.write("# LAXII checkpoints — SHA-256 recorded at download time\n")
        fh.write("# format: <hex>  <path relative to this dir>\n")
        for line in sorted(set(sha_lines)):
            fh.write(line + "\n")
    with open(os.path.join(args.models_dir, "download-record.json"), "w", encoding="utf-8") as fh:
        json.dump(record, fh, indent=2)

    # Self-check: every recorded hash must re-verify NOW.
    bad = []
    for m in record["models"]:
        for it in m["items"]:
            p = os.path.join(args.models_dir, it["file"])
            if not os.path.isfile(p) or sha256_of(p) != it["sha256"]:
                bad.append(it["file"])
    if bad:
        print("\nFAIL self-check (hash mismatch/missing): %s" % bad)
        return 3
    print("\nAll downloads complete and hash-verified (%d files). Record: %s"
          % (len(sha_lines), os.path.join(args.models_dir, "download-record.json")))
    print("Next: python local/run_acceptance.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
