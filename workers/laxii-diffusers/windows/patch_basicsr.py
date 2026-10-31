#!/usr/bin/env python3
"""LAXII Phase 8 — post-install compatibility patch for BasicSR (GPU host).

WHY THIS EXISTS (verified 2026-10-31):
  Real-ESRGAN's runtime depends on the `basicsr` package. The last published
  basicsr release (1.4.2, 2022) has two breakages with the current stack:

  1. basicsr/data/degradations.py line 8 imports
     `torchvision.transforms.functional_tensor` — that private module was
     removed in torchvision 0.17. The fix (used upstream in XPixelGroup PRs
     and by every modern install guide) is to import `rgb_to_grayscale` from
     `torchvision.transforms.functional` instead. Because `basicsr/__init__`
     imports subpackages eagerly, this breaks even `from basicsr.archs...`.
  2. Removed NumPy aliases (np.float / np.int / np.bool) appear in a few
     basicsr files and raise AttributeError on any NumPy >= 1.24.

  This script applies both fixes IN THE INSTALLED VENV ONLY, keeps a .bak of
  every file it touches, is idempotent, and then PROVES the result by
  importing the Real-ESRGAN path the worker uses. It edits nothing else.

Run AFTER `pip install -r requirements.txt`, with the venv interpreter:
    python windows/patch_basicsr.py
"""
import os
import re
import shutil
import sys
import importlib.util

ALIAS_FIXES = [
    (re.compile(r"\bnp\.float(?![0-9_a-zA-Z])"), "float"),
    (re.compile(r"\bnp\.int(?![0-9_a-zA-Z])"), "int"),
    (re.compile(r"\bnp\.bool(?![0-9_a-zA-Z])"), "bool"),
    (re.compile(r"\bnp\.object(?![0-9_a-zA-Z])"), "object"),
]
FUNCTIONAL_TENSOR = "from torchvision.transforms.functional_tensor import rgb_to_grayscale"
FUNCTIONAL_FIXED = "from torchvision.transforms.functional import rgb_to_grayscale"


def locate_basicsr():
    spec = importlib.util.find_spec("basicsr")
    if spec is None or not spec.submodule_search_locations:
        print("FAIL: basicsr is not installed in this environment "
              "(run `pip install -r requirements.txt` first).")
        return None
    return list(spec.submodule_search_locations)[0]


def patch_file(path, need_functional, need_aliases):
    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
        src = fh.read()
    out = src
    changed = []
    if need_functional and FUNCTIONAL_TENSOR in out:
        out = out.replace(FUNCTIONAL_TENSOR, FUNCTIONAL_FIXED)
        changed.append("functional_tensor->functional")
    if need_aliases:
        n = 0
        for rx, repl in ALIAS_FIXES:
            out, k = rx.subn(repl, out)
            n += k
        if n:
            changed.append("%d numpy alias(es)" % n)
    if not changed:
        return False
    bak = path + ".pre-laxii-patch.bak"
    if not os.path.exists(bak):
        shutil.copy2(path, bak)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(out)
    print("  patched %s (%s)" % (os.path.relpath(path), ", ".join(changed)))
    return True


def main():
    root = locate_basicsr()
    if not root:
        return 1
    print("basicsr location: %s" % root)

    # -- fix 1: torchvision functional_tensor import (exact known line) -----
    degradations = os.path.join(root, "data", "degradations.py")
    fixed1 = False
    if os.path.isfile(degradations):
        with open(degradations, "r", encoding="utf-8", errors="ignore") as fh:
            need = FUNCTIONAL_TENSOR in fh.read()
        fixed1 = patch_file(degradations, need, False)
        if not need:
            print("  degradations.py: functional_tensor import already absent (ok)")
    else:
        print("  WARNING: %s not found (basicsr layout changed?)" % degradations)

    # -- fix 2: removed NumPy aliases anywhere under basicsr -----------------
    fixed2 = 0
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            if not name.endswith(".py"):
                continue
            path = os.path.join(dirpath, name)
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                src = fh.read()
            needs = any(rx.search(src) for rx, _ in ALIAS_FIXES)
            if needs and patch_file(path, False, True):
                fixed2 += 1
    print("  numpy-alias fixes applied to %d file(s)" % fixed2)

    # -- prove the exact import chain the worker needs -----------------------
    print("Verifying imports (this is a real import, not a claim)...")
    try:
        import basicsr  # noqa: F401  (eager __init__ — the breaking import)
        from basicsr.archs.rrdbnet_arch import RRDBNet  # noqa: F401
        from realesrgan import RealESRGANer  # noqa: F401
    except Exception as e:
        print("FAIL: Real-ESRGAN import chain still broken after patch: %r" % e)
        return 2
    print("OK: basicsr + realesrgan import cleanly.")

    # -- informational: the rest of the stack --------------------------------
    try:
        import torch
        import diffusers
        import cv2
        print("torch %s | CUDA available: %s | diffusers %s | cv2 %s"
              % (torch.__version__, torch.cuda.is_available(),
                 diffusers.__version__, cv2.__version__))
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            print("device 0: %s, %.1f GB, compute capability %d.%d"
                  % (props.name, props.total_memory / 1024 ** 3,
                     props.major, props.minor))
    except Exception as e:
        print("NOTE: core stack not importable yet (%r) — preflight will report it." % e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
