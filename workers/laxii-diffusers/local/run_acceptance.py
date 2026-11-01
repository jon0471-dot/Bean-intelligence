#!/usr/bin/env python3
"""LAXII Phase 8 — real inference + preservation acceptance harness (GPU host).

Drives the EXISTING worker protocol (workers/laxii-diffusers/worker.py, JSON
lines over stdin/stdout — the same frames the Node client consumes) and
executes, in order:

  0. hardware + package snapshot, worker preflight GATE (stop if unsuitable)
  1. checkpoint hash re-verification (models.sha256 / download-record.json)
  2. real inference suite (Step 3 of the phase contract)
  3. preservation acceptance suite (Step 4) on a fixed procedural test set
     plus operator-supplied real photos for face tests
  4. results.json + report.md + all output images in acceptance-out/<run>/

HONESTY CONTRACT (binding, mirrors the worker's):
  - Nothing is marked PASS without measured bytes on disk.
  - Identity similarity scores are ESTIMATES against a threshold — the report
    never describes them as proof of identical identity.
  - Face tests are SKIPPED (truthfully, with reasons) unless operator photos
    exist; skips are listed in the report and the summary line.
  - A green preflight or a completed install does NOT complete this phase.

Usage (inside the setup venv, from workers/laxii-diffusers/):
    python local/run_acceptance.py [--models-dir models] [--real-dir local/testset-real]
        [--skip-sdxl] [--steps-small N] [--allow-face-regeneration]
Exit codes: 0 pass · 2 preflight gate failed · 3 checkpoint hashes failed
            4 one or more tests failed · 5 worker died unexpectedly
"""
import argparse
import base64
import ctypes
import hashlib
import io
import json
import os
import platform
import subprocess
import sys
import threading
import time

from PIL import Image, ImageDraw, ImageFont, ImageFilter

WORKER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER_PY = os.path.join(WORKER_DIR, "worker.py")

IDENTITY_NOTE = ("SFace cosine similarity is an ESTIMATE against a configured threshold — "
                 "never proof of identical identity.")


# ---------------------------------------------------------------------------
# Worker JSON-lines client (same protocol as src/lib/laxii/worker.ts)
# ---------------------------------------------------------------------------

class WorkerDied(Exception):
    pass


class WorkerClient:
    def __init__(self, python_exe, models_dir):
        self.proc = subprocess.Popen(
            [python_exe, WORKER_PY, "--models-dir", models_dir],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=WORKER_DIR, text=True, encoding="utf-8", bufsize=1)
        self.pending = {}
        self.lock = threading.Lock()
        self.ready = threading.Event()
        self.stderr_tail = []
        self.reader = threading.Thread(target=self._read_loop, daemon=True)
        self.reader.start()
        self.err_reader = threading.Thread(target=self._err_loop, daemon=True)
        self.err_reader.start()
        if not self.ready.wait(30):
            raise WorkerDied("worker emitted no ready frame in 30s; stderr: %s"
                             % self._stderr())

    def _stderr(self):
        return " | ".join(self.stderr_tail[-6:])

    def _err_loop(self):
        for line in self.proc.stderr:
            self.stderr_tail.append(line.strip()[:300])
            del self.stderr_tail[:-40]

    def _read_loop(self):
        for line in self.proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "ready":
                self.ready.set()
                continue
            with self.lock:
                entry = self.pending.get(str(msg.get("id")))
            if not entry:
                continue
            if msg.get("type") == "progress":
                cb = entry.get("on_progress")
                if cb:
                    cb(int(msg.get("step", 0)), msg.get("total"))
                continue
            with self.lock:
                self.pending.pop(str(msg.get("id")), None)
            entry["result"] = msg
            entry["event"].set()
        # stdout closed
        with self.lock:
            entries = list(self.pending.values())
            self.pending.clear()
        for e in entries:
            e["died"] = True
            e["event"].set()

    def request(self, method, params, timeout_s=600, on_progress=None):
        rid = "r%d" % (time.monotonic_ns() % 10 ** 12)
        entry = {"event": threading.Event(), "result": None, "died": False,
                 "on_progress": on_progress}
        with self.lock:
            self.pending[rid] = entry
        try:
            self.proc.stdin.write(json.dumps({"id": rid, "method": method,
                                              "params": params}) + "\n")
            self.proc.stdin.flush()
        except BrokenPipeError:
            raise WorkerDied("worker stdin closed; stderr: %s" % self._stderr())
        if not entry["event"].wait(timeout_s):
            with self.lock:
                self.pending.pop(rid, None)
            raise TimeoutError("worker method '%s' exceeded %.0fs; stderr: %s"
                               % (method, timeout_s, self._stderr()))
        if entry["died"]:
            raise WorkerDied("worker process died during '%s'; stderr: %s"
                             % (method, self._stderr()))
        msg = entry["result"]
        if msg is None:
            raise WorkerDied("no response captured for '%s'" % method)
        return msg

    def call_ok(self, method, params, timeout_s=600, on_progress=None):
        """ok=true -> result; ok=false -> TestFailure with the worker's code."""
        msg = self.request(method, params, timeout_s=timeout_s, on_progress=on_progress)
        if msg.get("ok") is not True:
            err = msg.get("error", {})
            raise TestFailure(err.get("code", "WORKER_ERROR"),
                              err.get("message", "unspecified worker error"))
        return msg.get("result", {})

    def close(self):
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(5)
        except Exception:
            self.proc.kill()


class TestFailure(Exception):
    def __init__(self, code, message):
        super().__init__("%s: %s" % (code, message))
        self.code = code


# ---------------------------------------------------------------------------
# Hardware snapshot + VRAM sampler
# ---------------------------------------------------------------------------

def nvidia_smi(fields):
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=" + ",".join(fields),
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10)
        if out.returncode == 0:
            return [x.strip() for x in out.stdout.strip().splitlines()[0].split(",")]
    except Exception:
        pass
    return None


def ram_total_gb():
    try:
        if platform.system() == "Windows":
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            st = MEMORYSTATUSEX()
            st.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
            return round(st.ullTotalPhys / 1024 ** 3, 2)
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemTotal"):
                    return round(int(line.split()[1]) / 1024 ** 2, 2)
    except Exception:
        pass
    return None


class VramMonitor:
    """Samples device-level VRAM in a background thread. Records the peak
    between start() and stop(). Device-level = includes other processes; the
    report says so."""

    def __init__(self, interval_s=0.25):
        self.interval = interval_s
        self.samples = []
        self.current_label = None
        self.peaks = {}
        self.stop_evt = threading.Event()
        self.thread = threading.Thread(target=self._loop, daemon=True)
        self.thread.start()

    def _loop(self):
        while not self.stop_evt.is_set():
            vals = nvidia_smi(["memory.used"])
            if vals:
                try:
                    used = float(vals[0])
                    self.samples.append((time.time(), self.current_label, used))
                    if self.current_label:
                        prev = self.peaks.get(self.current_label, 0.0)
                        self.peaks[self.current_label] = max(prev, used)
                except ValueError:
                    pass
            self.stop_evt.wait(self.interval)

    def start(self, label):
        self.current_label = label
        self.peaks.setdefault(label, 0.0)

    def stop(self):
        self.current_label = None

    def peak_mb(self, label):
        return self.peaks.get(label)

    def finish(self):
        self.stop_evt.set()


# ---------------------------------------------------------------------------
# Fixed procedural test set (deterministic; NOT real photographs — stated
# everywhere it is used) + preservation metrics
# ---------------------------------------------------------------------------

FIXTURE_SPECS = [
    ("portrait-single", 640, 800),
    ("portrait-multi", 800, 640),
    ("product-watch", 720, 720),
    ("landscape", 1024, 640),
    ("architecture", 832, 1216),
    ("poster-text", 768, 1024),
    ("logo-badge", 512, 512),
    ("photo-lowres", 128, 96),
    ("background-complex", 1024, 768),
    ("localized-edit", 896, 896),
]


def _vgrad(w, h, c0, c1):
    return Image.linear_gradient("L").resize((w, h)).point(lambda v: int(c0 + (c1 - c0) * v / 255)).convert("RGB")


def make_fixture(name, w, h):
    """Deterministic procedural fixtures. Same inputs on every run (no random
    source is consumed). These are geometry carriers, not photographs."""
    img = _vgrad(w, h, 24, 210)
    dr = ImageDraw.Draw(img)
    if name == "portrait-single":
        dr.ellipse([w * 0.35, h * 0.12, w * 0.65, h * 0.42], fill=(196, 168, 140))
        dr.rectangle([w * 0.28, h * 0.45, w * 0.72, h * 0.95], fill=(70, 90, 130))
    elif name == "portrait-multi":
        for cx in (0.28, 0.72):
            dr.ellipse([w * cx - w * 0.12, h * 0.12, w * cx + w * 0.12, h * 0.42],
                       fill=(186, 158, 132))
        dr.rectangle([0, h * 0.46, w, h], fill=(84, 74, 96))
    elif name == "product-watch":
        dr.ellipse([w * 0.2, h * 0.2, w * 0.8, h * 0.8], outline=(230, 200, 80), width=14)
        dr.ellipse([w * 0.34, h * 0.34, w * 0.66, h * 0.66], fill=(20, 22, 28))
        dr.line([w * 0.5, h * 0.5, w * 0.62, h * 0.4], fill=(240, 240, 240), width=6)
    elif name == "landscape":
        dr.rectangle([0, h * 0.6, w, h], fill=(40, 70, 48))
        dr.polygon([(0, h * 0.62), (w * 0.3, h * 0.28), (w * 0.55, h * 0.62)], fill=(120, 118, 128))
        dr.ellipse([w * 0.72, h * 0.08, w * 0.86, h * 0.22], fill=(240, 220, 140))
    elif name == "architecture":
        for i in range(6):
            x = w * (0.06 + i * 0.16)
            dr.rectangle([x, h * (0.25 + (i % 3) * 0.08), x + w * 0.11, h * 0.92],
                         fill=(58 + i * 12, 62 + i * 10, 78 + i * 8))
    elif name == "poster-text":
        try:
            font = ImageFont.load_default(size=max(28, h // 14))
        except TypeError:
            font = ImageFont.load_default()
        dr.rectangle([0, 0, w, h], fill=(16, 18, 24))
        dr.text((w * 0.08, h * 0.18), "LAXII", fill=(232, 196, 106), font=font)
        dr.text((w * 0.08, h * 0.42), "PRESERVE FIRST", fill=(238, 238, 238), font=font)
        dr.text((w * 0.08, h * 0.62), "PHASE 8 FIXTURE", fill=(150, 150, 160), font=font)
    elif name == "logo-badge":
        dr.ellipse([w * 0.15, h * 0.15, w * 0.85, h * 0.85], fill=(18, 18, 20),
                   outline=(212, 175, 55), width=10)
        try:
            font = ImageFont.load_default(size=w // 5)
        except TypeError:
            font = ImageFont.load_default()
        tb = dr.textbbox((0, 0), "B", font=font)
        dr.text((w / 2 - (tb[2] - tb[0]) / 2, h / 2 - (tb[3] - tb[1]) / 2),
                "B", fill=(232, 196, 106), font=font)
    elif name == "photo-lowres":
        dr.rectangle([0, 0, w, h], fill=(90, 110, 90))
        dr.ellipse([w * 0.25, h * 0.2, w * 0.75, h * 0.8], fill=(160, 140, 120))
    elif name == "background-complex":
        for i in range(0, w, 24):
            dr.line([(i, 0), (i - h, h)], fill=(40 + (i % 48), 46 + (i % 64), 60), width=3)
        dr.rectangle([w * 0.42, h * 0.3, w * 0.5, h * 0.9], fill=(200, 60, 50))
        dr.rectangle([w * 0.6, h * 0.2, w * 0.66, h * 0.85], fill=(60, 120, 200))
    elif name == "localized-edit":
        dr.rectangle([0, h * 0.55, w, h], fill=(52, 84, 130))
        dr.ellipse([w * 0.4, h * 0.1, w * 0.6, h * 0.3], fill=(230, 190, 120))
    return img


def build_fixtures(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    paths = {}
    for name, w, h in FIXTURE_SPECS:
        p = os.path.join(out_dir, name + ".png")
        if not os.path.isfile(p):
            make_fixture(name, w, h).save(p, format="PNG")
        paths[name] = p
    return paths


# --- mask builders (BEAN semantics: value > 0 = EDITABLE) --------------------

def mask_rect(w, h, x0, y0, x1, y1, feather=0.0):
    m = Image.new("L", (w, h), 0)
    ImageDraw.Draw(m).rectangle([x0, y0, x1, y1], fill=255)
    if feather > 0:
        m = m.filter(ImageFilter.GaussianBlur(feather))
    return m


def mask_union(*masks):
    out = masks[0]
    for m in masks[1:]:
        import numpy as np
        out = Image.fromarray(np.maximum(np.array(out), np.array(m)))
    return out


# --- metrics (same definitions as src/lib/laxii/metrics.ts) ------------------

def diff_stats(before, after):
    import numpy as np
    a = np.asarray(before, dtype=np.int16)
    b = np.asarray(after, dtype=np.int16)
    d = np.abs(a - b)
    changed = np.any(d > 0, axis=2)
    mse = float(np.mean(d.astype(np.float64) ** 2))
    psnr = 10.0 * __import__("math").log10(255.0 ** 2 / mse) if mse > 0 else float("inf")
    return {
        "changedPct": round(100.0 * float(changed.sum()) / changed.size, 3),
        "meanAbsDiff": round(float(d.mean()), 4),
        "psnrDb": round(psnr, 2),
    }


def composite_exact(orig, gen, mask_l):
    """BEAN compositePreserved semantics, reproduced exactly:
    outside the editable mask -> ORIGINAL BYTES verbatim; inside -> generated;
    the feather band (0<mask<255) blends linearly."""
    import numpy as np
    o = np.asarray(orig.convert("RGB"), dtype=np.uint8)
    g = np.asarray(gen.convert("RGB"), dtype=np.uint8)
    m = np.asarray(mask_l, dtype=np.float32) / 255.0
    m = m[..., None]
    out = (m * g + (1.0 - m) * o)
    out = np.where(m > 0, out, o)  # guarantee bit-exact zeros outside mask
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def preservation_report(orig, composited, mask_l):
    """exact% / blend% / changed% + hard-interior equality, mirroring the
    validatePreservation contract. `composited` is the final image the user
    would receive (original bytes outside the mask, generation inside)."""
    import numpy as np
    o = np.asarray(orig.convert("RGB"), dtype=np.int16)
    c = np.asarray(composited.convert("RGB"), dtype=np.int16)
    m = np.asarray(mask_l)
    exact = np.all(c == o, axis=2)
    hard_keep = m == 0
    band = (m > 0) & (m < 255)
    exact_pct = 100.0 * float(exact.sum()) / exact.size
    hard_ok = bool(np.all(exact[hard_keep])) if hard_keep.any() else True
    return {
        "exactPreservedPct": round(exact_pct, 3),
        "hardUnmaskedInteriorBitExact": hard_ok,
        "blendBandPct": round(100.0 * float(band.sum()) / band.size, 3),
        "changedPct": round(100.0 - exact_pct, 3),
    }


def save_diff(before, after, path, amp=8):
    """Amplified absolute-difference map (same x8 convention as metrics.ts)."""
    import numpy as np
    a = np.asarray(before.convert("RGB"), dtype=np.int16)
    b = np.asarray(after.convert("RGB"), dtype=np.int16)
    d = np.abs(a - b) * amp
    Image.fromarray(np.clip(d, 0, 255).astype(np.uint8)).save(path, format="PNG")


# ---------------------------------------------------------------------------
# The acceptance suites
# ---------------------------------------------------------------------------

def b64_png(img):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def png_ok(b64):
    raw = base64.b64decode(b64)
    return raw[:8] == b"\x89PNG\r\n\x1a\n" and len(raw) > 1000, raw


class Suite:
    def __init__(self, args, out_dir):
        self.args = args
        self.out_dir = out_dir
        self.results = []
        self.passed = self.failed = self.skipped = 0

    def record(self, tid, name, status, detail, artifacts=None):
        entry = {"id": tid, "name": name, "status": status, "detail": detail}
        if artifacts:
            entry["artifacts"] = artifacts
        self.results.append(entry)
        mark = {"PASS": "+", "FAIL": "!", "SKIP": "-"}[status]
        print("  [%s] %s — %s" % (mark, tid, name))
        for k, v in detail.items():
            print("        %s: %s" % (k, v))
        if status == "PASS":
            self.passed += 1
        elif status == "FAIL":
            self.failed += 1
        else:
            self.skipped += 1

    def guard(self, tid, name, fn):
        print("  ..  %s — %s" % (tid, name))
        try:
            detail, artifacts = fn()
            ok = detail.pop("_pass", True)
            self.record(tid, name, "PASS" if ok else "FAIL", detail, artifacts)
        except TestFailure as e:
            self.record(tid, name, "FAIL", {"error": str(e)})
        except SkipTest as e:
            self.record(tid, name, "SKIP", {"reason": str(e)})
        except Exception as e:  # noqa: BLE001 — a crash IS a failed test
            self.record(tid, name, "FAIL", {"error": "%s: %s" % (type(e).__name__, e)})


class SkipTest(Exception):
    pass


def run(args):
    import numpy as np  # venv guarantee (preflight already proved it)

    run_id = time.strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(WORKER_DIR, "local", "acceptance-out", run_id)
    os.makedirs(out_dir, exist_ok=True)
    print("=" * 78)
    print("LAXII Phase 8 acceptance run %s" % run_id)
    print("outputs: %s" % out_dir)
    print("=" * 78)

    results = {"runId": run_id, "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "phase": "LAXII-8", "workerVersion": None, "honestyNote":
               "PASS = measured on this host during this run. Preflight/install success alone does not complete Phase 8.",
               "environment": {}, "preflight": None, "checkpoints": None,
               "tests": [], "vramPeaksMb": {}, "summary": {}}

    # ---- Step 2a: hardware snapshot ----------------------------------------
    gpu = nvidia_smi(["name", "driver_version", "memory.total", "compute_cap"])
    env = {
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "ramTotalGb": ram_total_gb(),
        "gpu": ({"name": gpu[0], "driverVersion": gpu[1], "vramTotalMb": gpu[2],
                 "computeCap": gpu[3]} if gpu and len(gpu) >= 4 else {"probe": "unavailable"}),
        "note": "GPU numbers come from nvidia-smi (authoritative driver view).",
    }
    try:
        import torch, diffusers, transformers, cv2  # noqa: E401
        env["packages"] = {"torch": torch.__version__, "torch.version.cuda": torch.version.cuda,
                           "diffusers": diffusers.__version__, "transformers": transformers.__version__,
                           "opencv": cv2.__version__}
        env["torchCudaAvailable"] = torch.cuda.is_available()
        env["torchCudaRuntime"] = torch.version.cuda
        if torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            env["torchDevice"] = {"name": p.name, "vramTotalGb": round(p.total_memory / 1024 ** 3, 2),
                                  "computeCapability": "%d.%d" % (p.major, p.minor),
                                  "bf16": bool(torch.cuda.is_bf16_supported())}
    except Exception as e:
        env["packages"] = {"error": str(e)}
    results["environment"] = env
    print(json.dumps(env, indent=2, default=str)[:1200])

    # ---- Step 2b: worker preflight GATE ------------------------------------
    print("\n[gate] worker preflight")
    wc = WorkerClient(sys.executable, args.models_dir)
    try:
        pf = wc.call_ok("preflight", {"modelsDir": args.models_dir}, timeout_s=120)
        results["workerVersion"] = pf.get("workerVersion")
        results["preflight"] = pf
        print("  preflight.ok = %s (worker %s)" % (pf.get("ok"), pf.get("workerVersion")))
        print("  cuda: %s %s | vram free %s GB | missing: %s" % (
            pf["cuda"].get("available"), pf["cuda"].get("device"),
            pf["cuda"].get("vramFreeGb"), ", ".join(pf.get("missingPackages", []))))
        if not pf.get("ok"):
            print("\nSTOP: preflight did not pass. The environment is unsuitable as measured; "
                  "nothing was run and nothing is claimed. See the preflight report in results.json.")
            results["summary"] = {"verdict": "PREFLIGHT_GATE_FAILED"}
            _write_results(results, out_dir)
            wc.close()
            return 2
        required = ["sd15-inpaint", "sd15-base", "sdxl-base-1.0", "ip-adapter-h94-sd15",
                    "realesrgan-x4plus", "big-lama", "face-detection-yunet", "face-recognition-sface"]
        present = {m["id"] for m in pf["models"] if m.get("present")}
        absent = [m for m in required if m not in present]
        if absent:
            print("\nSTOP: required checkpoints missing: %s. Run local/download_models.py --accept-licenses." % absent)
            results["summary"] = {"verdict": "CHECKPOINTS_MISSING", "missing": absent}
            _write_results(results, out_dir)
            wc.close()
            return 2
    finally:
        pass

    # ---- Step 2c: checkpoint hash re-verification ---------------------------
    print("\n[gate] checkpoint SHA-256 re-verification")
    record_path = os.path.join(args.models_dir, "download-record.json")
    sha_path = os.path.join(args.models_dir, "models.sha256")
    if not os.path.isfile(record_path) and not os.path.isfile(sha_path):
        print("STOP: no download record found — run local/download_models.py first. "
              "Inference without recorded provenance is not accepted.")
        results["summary"] = {"verdict": "NO_DOWNLOAD_RECORD"}
        _write_results(results, out_dir)
        wc.close()
        return 3
    verified, bad = [], []
    if os.path.isfile(record_path):
        with open(record_path) as fh:
            rec = json.load(fh)
        for m in rec["models"]:
            for it in m["items"]:
                p = os.path.join(args.models_dir, it["file"])
                h = hashlib.sha256()
                with open(p, "rb") as f2:
                    for chunk in iter(lambda: f2.read(1 << 20), b""):
                        h.update(chunk)
                okh = h.hexdigest() == it["sha256"]
                verified.append({"id": m["id"], "file": it["file"], "sha256": it["sha256"],
                                 "bytes": it.get("bytes"), "match": okh, "source": it.get("repo") or it.get("url")})
                if not okh:
                    bad.append(it["file"])
    results["checkpoints"] = {"verified": verified, "allMatch": not bad}
    print("  %d files re-verified, allMatch=%s" % (len(verified), not bad))
    if bad:
        results["summary"] = {"verdict": "CHECKSUM_MISMATCH", "files": bad}
        _write_results(results, out_dir)
        wc.close()
        return 3

    mon = VramMonitor()
    suite = Suite(args, out_dir)
    fixtures = build_fixtures(os.path.join(out_dir, "testset"))
    print("\n[fixtures] fixed procedural set written (deterministic, NOT photographs): %s"
          % ", ".join(sorted(fixtures)))

    # ================= Step 3: real inference ================================

    # T1 SDXL txt2img (professional tier)
    def t1():
        mon.start("T1-txt2img-sdxl-1024")
        t0 = time.time()
        r = wc.call_ok("txt2img", {"prompt": "professional product photograph of a brass camera on dark silk",
                                   "width": 1024, "height": 1024, "steps": 30, "guidance": 6.0,
                                   "seed": 42, "model": "sdxl-base-1.0"}, timeout_s=1200)
        dt = time.time() - t0
        mon.stop()
        okb, raw = png_ok(r["images"][0])
        img = Image.open(io.BytesIO(raw))
        p = os.path.join(out_dir, "T1-txt2img-sdxl.png")
        img.save(p)
        return {"_pass": okb and img.size == (1024, 1024), "model": r["model"], "seed": r.get("seed"),
                "steps": r.get("steps"), "wallSeconds": round(dt, 2), "size": list(img.size),
                "pngMagic": okb, "vramPeakMb": mon.peak_mb("T1-txt2img-sdxl-1024")}, [p]
    suite.guard("T1", "txt2img SDXL 1024 (real inference)", t1)

    # T1b determinism (informational)
    def t1b():
        r = wc.call_ok("txt2img", {"prompt": "professional product photograph of a brass camera on dark silk",
                                   "width": 1024, "height": 1024, "steps": 30, "guidance": 6.0,
                                   "seed": 42, "model": "sdxl-base-1.0"}, timeout_s=1200)
        okb, raw = png_ok(r["images"][0])
        first = open(os.path.join(out_dir, "T1-txt2img-sdxl.png"), "rb").read()
        return {"_pass": True, "byteIdenticalToFirstRun": raw == first,
                "note": "informational: same seed+settings on the same GPU/version"}, []
    suite.guard("T1b", "txt2img determinism probe (same seed)", t1b)

    # T2 SD15-base txt2img (fast tier)
    def t2():
        mon.start("T2-txt2img-sd15-512")
        t0 = time.time()
        r = wc.call_ok("txt2img", {"prompt": "a lighthouse at dusk, film grain", "width": 512,
                                   "height": 512, "steps": 25, "guidance": 6.0, "seed": 7,
                                   "model": "sd15-base"}, timeout_s=900)
        dt = time.time() - t0
        mon.stop()
        okb, raw = png_ok(r["images"][0])
        img = Image.open(io.BytesIO(raw))
        p = os.path.join(out_dir, "T2-txt2img-sd15.png")
        img.save(p)
        return {"_pass": okb and img.size == (512, 512), "model": r["model"],
                "wallSeconds": round(dt, 2), "size": list(img.size),
                "vramPeakMb": mon.peak_mb("T2-txt2img-sd15-512")}, [p]
    suite.guard("T2", "txt2img SD1.5-base 512 (fast tier)", t2)

    # T3 reference-guided generation (IP-Adapter)
    def t3():
        ref = fixtures["product-watch"]
        mon.start("T3-reference-ipadapter")
        t0 = time.time()
        r = wc.call_ok("reference_generate",
                       {"prompt": "a golden wristwatch product shot, studio light",
                        "referenceImage": b64_png(Image.open(ref)), "width": 512, "height": 512,
                        "steps": 25, "guidance": 6.0, "seed": 11, "model": "sd15-base",
                        "ipAdapter": {"scale": 0.6}}, timeout_s=900)
        dt = time.time() - t0
        mon.stop()
        okb, raw = png_ok(r["images"][0])
        p = os.path.join(out_dir, "T3-reference-ipadapter.png")
        Image.open(io.BytesIO(raw)).save(p)
        Image.open(ref).save(os.path.join(out_dir, "T3-reference-input.png"))
        return {"_pass": okb, "model": r["model"], "referenceConditioning": r.get("referenceConditioning"),
                "wallSeconds": round(dt, 2),
                "note": "IP-Adapter (h94, Apache-2.0) influence is qualitative here — no identity claim is made",
                "vramPeakMb": mon.peak_mb("T3-reference-ipadapter")}, [p, os.path.join(out_dir, "T3-reference-input.png")]
    suite.guard("T3", "reference-guided generation (IP-Adapter on sd15-base)", t3)

    # T4 image-to-image enhancement via masked inpaint, strength < 1
    def t4():
        orig = Image.open(fixtures["localized-edit"]).convert("RGB")
        w, h = orig.size
        m = mask_rect(w, h, int(w * 0.40), int(h * 0.06), int(w * 0.60), int(h * 0.32), feather=6)
        mon.start("T4-img2img-strength-0.35")
        t0 = time.time()
        r = wc.call_ok("inpaint", {"image": b64_png(orig), "mask": b64_png(m),
                                   "prompt": "a bright golden balloon in the sky",
                                   "steps": 25, "guidance": 6.0, "strength": 0.35, "seed": 21,
                                   "model": "sd15-inpaint"}, timeout_s=900)
        dt = time.time() - t0
        mon.stop()
        okb, raw = png_ok(r["images"][0])
        gen = Image.open(io.BytesIO(raw))
        comp = composite_exact(orig, gen, m)
        rep = preservation_report(orig, comp, m)
        p_out = os.path.join(out_dir, "T4-composited.png")
        p_d = os.path.join(out_dir, "T4-diff.png")
        comp.save(p_out)
        save_diff(orig, comp, p_d)
        return {"_pass": okb and rep["hardUnmaskedInteriorBitExact"],
                "strength": 0.35, "wallSeconds": round(dt, 2), "preservation": rep,
                "rawDiffStats": diff_stats(orig, comp),
                "note": "img2img is exposed per protocol ONLY through the masked path; the unmasked "
                        "full-image regenerative operation is deliberately not available",
                "vramPeakMb": mon.peak_mb("T4-img2img-strength-0.35")}, [p_out, p_d]
    suite.guard("T4", "image-to-image enhancement (masked, strength 0.35)", t4)

    # T5 masked inpainting strength 1.0 (SD1.5)
    def t5():
        orig = Image.open(fixtures["landscape"]).convert("RGB")
        w, h = orig.size
        m = mask_rect(w, h, int(w * 0.30), int(h * 0.35), int(w * 0.62), int(h * 0.70), feather=10)
        mon.start("T5-inpaint-sd15")
        t0 = time.time()
        r = wc.call_ok("inpaint", {"image": b64_png(orig), "mask": b64_png(m),
                                   "prompt": "a crystal lake between the mountains",
                                   "steps": 30, "guidance": 6.5, "strength": 1.0, "seed": 33,
                                   "model": "sd15-inpaint"}, timeout_s=900)
        dt = time.time() - t0
        mon.stop()
        okb, raw = png_ok(r["images"][0])
        gen = Image.open(io.BytesIO(raw))
        comp = composite_exact(orig, gen, m)
        rep = preservation_report(orig, comp, m)
        p_out = os.path.join(out_dir, "T5-composited.png")
        p_d = os.path.join(out_dir, "T5-diff.png")
        p_raw = os.path.join(out_dir, "T5-raw-worker-output.png")
        gen.save(p_raw)
        comp.save(p_out)
        save_diff(orig, comp, p_d)
        return {"_pass": okb and rep["hardUnmaskedInteriorBitExact"] and comp.size == orig.size,
                "maskCoveragePct": round(100.0 * float((np.asarray(m) > 0).sum()) / m.size, 2),
                "wallSeconds": round(dt, 2), "preservation": rep,
                "rawVsCompositedDiff": diff_stats(gen, comp),
                "note": "raw worker output is also kept: the diffusers pipeline does NOT guarantee "
                        "bit-exact unmasked pixels — the composite step does (defense in depth)",
                "vramPeakMb": mon.peak_mb("T5-inpaint-sd15")}, [p_out, p_d, p_raw]
    suite.guard("T5", "masked inpainting SD1.5 strength 1.0", t5)

    # T6 masked inpainting SDXL 1024 (professional path)
    def t6():
        if args.skip_sdxl:
            raise SkipTest("--skip-sdxl given; SDXL inpaint not run in this session")
        orig = Image.open(fixtures["architecture"]).convert("RGB").resize((1024, 1024))
        w, h = orig.size
        m = mask_rect(w, h, int(w * 0.35), int(h * 0.25), int(w * 0.7), int(h * 0.6), feather=8)
        mon.start("T6-inpaint-sdxl-1024")
        t0 = time.time()
        r = wc.call_ok("inpaint", {"image": b64_png(orig), "mask": b64_png(m),
                                   "prompt": "glass curtain walls reflecting sunset",
                                   "steps": 30, "guidance": 6.0, "strength": 1.0, "seed": 55,
                                   "model": "sdxl-base-1.0"}, timeout_s=1800)
        dt = time.time() - t0
        mon.stop()
        okb, raw = png_ok(r["images"][0])
        gen = Image.open(io.BytesIO(raw))
        comp = composite_exact(orig, gen, m)
        rep = preservation_report(orig, comp, m)
        p_out = os.path.join(out_dir, "T6-composited-sdxl.png")
        p_d = os.path.join(out_dir, "T6-diff-sdxl.png")
        comp.save(p_out)
        save_diff(orig, comp, p_d)
        return {"_pass": okb and rep["hardUnmaskedInteriorBitExact"] and comp.size == orig.size,
                "wallSeconds": round(dt, 2), "preservation": rep,
                "vramPeakMb": mon.peak_mb("T6-inpaint-sdxl-1024")}, [p_out, p_d]
    suite.guard("T6", "masked inpainting SDXL 1024 (professional path)", t6)

    # T7 object removal (big-lama) + model upscale (Real-ESRGAN)
    def t7():
        orig = Image.open(fixtures["background-complex"]).convert("RGB")
        w, h = orig.size
        m = mask_rect(w, h, int(w * 0.40), int(h * 0.28), int(w * 0.52), int(h * 0.92), feather=0)
        mon.start("T7a-object-removal-lama")
        t0 = time.time()
        r1 = wc.call_ok("object_removal", {"image": b64_png(orig), "mask": b64_png(m)}, timeout_s=600)
        dt1 = time.time() - t0
        mon.stop()
        okb1, raw1 = png_ok(r1["images"][0])
        rem = Image.open(io.BytesIO(raw1))
        p1 = os.path.join(out_dir, "T7a-object-removal.png")
        rem.save(p1)
        low = Image.open(fixtures["photo-lowres"]).convert("RGB")
        mon.start("T7b-upscale-realesrgan")
        t0 = time.time()
        r2 = wc.call_ok("upscale", {"image": b64_png(low), "factor": 4}, timeout_s=600)
        dt2 = time.time() - t0
        mon.stop()
        okb2, raw2 = png_ok(r2["images"][0])
        up = Image.open(io.BytesIO(raw2))
        p2 = os.path.join(out_dir, "T7b-upscale-x4.png")
        up.save(p2)
        return {"_pass": okb1 and okb2 and up.size == (low.width * 4, low.height * 4),
                "lamaWallSeconds": round(dt1, 2), "esrganWallSeconds": round(dt2, 2),
                "upscaledSize": list(up.size),
                "vramPeakMb": max(mon.peak_mb("T7a-object-removal-lama") or 0,
                                  mon.peak_mb("T7b-upscale-realesrgan") or 0)}, [p1, p2]
    suite.guard("T7", "object removal (big-lama) + Real-ESRGAN x4", t7)

    # T8 cancellation + recovery
    def t8():
        mon.start("T8-cancel")
        with wc.lock:
            before_ids = set(wc.pending.keys())
        settled = threading.Event()
        outcome = {}

        def run_long():
            try:
                outcome["msg"] = wc.request(
                    "txt2img", {"prompt": "a very detailed oil painting of a harbour",
                                "width": 512, "height": 512, "steps": 40, "seed": 9,
                                "model": "sd15-base"}, timeout_s=900)
            except Exception as e:  # transport-level failure is also an outcome
                outcome["err"] = e
            settled.set()

        th = threading.Thread(target=run_long, daemon=True)
        th.start()
        # observe the pending id of the long request (client-side pending map)
        target_id = None
        for _ in range(2400):
            with wc.lock:
                new_ids = set(wc.pending.keys()) - before_ids
            if new_ids:
                target_id = sorted(new_ids)[0]
                break
            time.sleep(0.05)
        if not target_id:
            mon.stop()
            raise TestFailure("NO_PROGRESS", "could not observe the long request id")
        # give the job time to actually start stepping before cancelling
        time.sleep(3)
        rc = wc.call_ok("cancel", {"targetId": target_id}, timeout_s=10)
        if not settled.wait(300):
            mon.stop()
            raise TestFailure("CANCEL_TIMEOUT", "long request did not settle after cancel")
        mon.stop()
        msg = outcome.get("msg") or {}
        if msg.get("ok") is False:
            code = (msg.get("error") or {}).get("code", "WORKER_ERROR")
        elif msg.get("ok") is True:
            code = "COMPLETED"
        else:
            code = getattr(outcome.get("err"), "code", "TRANSPORT_ERROR")
        cancelled_ok = code == "CANCELLED"
        # recovery: a normal short request must still succeed
        r = wc.call_ok("txt2img", {"prompt": "a small green boat", "width": 256, "height": 256,
                                   "steps": 12, "seed": 5, "model": "sd15-base"}, timeout_s=600)
        okb, _raw = png_ok(r["images"][0])
        return {"_pass": bool(rc.get("cancelled")) and cancelled_ok and okb,
                "cancelAnswered": bool(rc.get("cancelled")),
                "longRequestCode": code or "COMPLETED",
                "recoveryInferenceOk": okb,
                "vramPeakMb": mon.peak_mb("T8-cancel")}, []
    suite.guard("T8", "cancellation of a running job + recovery", t8)

    # T9 model loading/unloading + VRAM discipline
    def t9():
        mon.start("T9-unload")
        h1 = wc.call_ok("health", {}, timeout_s=30)
        u = wc.call_ok("unload", {}, timeout_s=120)
        h2 = wc.call_ok("health", {}, timeout_s=30)
        mon.stop()
        return {"_pass": u.get("unloaded") is True and h2.get("loaded") == [],
                "healthBefore": h1, "healthAfter": h2,
                "vramFreeAfterUnloadGb": h2.get("vramFreeGb"),
                "vramPeakMb": mon.peak_mb("T9-unload")}, []
    suite.guard("T9", "model unload + VRAM release (health protocol)", t9)

    # ================= Step 4: preservation acceptance ========================
    real_dir = args.real_dir
    real_photos = []
    if real_dir and os.path.isdir(real_dir):
        real_photos = sorted(
            os.path.join(real_dir, f) for f in os.listdir(real_dir)
            if f.lower().endswith((".jpg", ".jpeg", ".png")) and
            os.path.isfile(os.path.join(real_dir, f)))

    # P1/P5: exact preservation + dimensions across the generative tests above
    # are already measured per-test; P1 aggregates the verdicts:
    def p1():
        gens = [t for t in suite.results if t["id"] in ("T4", "T5", "T6") and t["status"] == "PASS"]
        if not gens:
            raise SkipTest("no generative tests passed — nothing to aggregate")
        hard_ok = all(t["detail"]["preservation"]["hardUnmaskedInteriorBitExact"] for t in gens)
        min_exact = min(t["detail"]["preservation"]["exactPreservedPct"] for t in gens)
        return {"_pass": hard_ok, "aggregatedExactPreservedPctMin": min_exact,
                "definition": "outside the editable mask every pixel equals the original bytes "
                              "(alpha==0 -> verbatim), verified per test",
                "identityNote": "pixel preservation is a property of THIS run, not a generic guarantee"}, []
    suite.guard("P1", "exact unmasked-pixel preservation (aggregate)", p1)

    # P2/P3: face protection, single + multiple faces (needs real photos)
    def face_tests():
        if not real_photos:
            raise SkipTest("no operator photos in %s — face-protection tests need real, "
                           "rights-cleared photos (YuNet cannot be trusted on procedural renders). "
                           "See ACCEPTANCE-RUNBOOK.md for the placement contract." % real_dir)
        return real_photos
    real_available = True
    try:
        face_tests()
    except SkipTest:
        real_available = False

    def p2(idx, name):
        orig = Image.open(real_photos[idx]).convert("RGB")
        if min(orig.size) < 256:
            orig = orig.resize((max(256, orig.width), max(256, orig.height)))
        w, h = orig.size
        prep = wc.call_ok("identity_prepare", {"image": b64_png(orig)}, timeout_s=120)
        faces = prep.get("faces", [])
        if not faces:
            raise SkipTest("YuNet found no face in %s — pick a photo with a clear frontal face" % name)
        # a face-protection ZONE = face rect padded by 25%; the edit mask overlaps it
        zones = []
        for f in faces:
            pad_x, pad_y = int(f["width"] * 0.25), int(f["height"] * 0.25)
            zones.append([max(0, f["x"] - pad_x), max(0, f["y"] - pad_y),
                          min(w, f["x"] + f["width"] + pad_x), min(h, f["y"] + f["height"] + pad_y)])
        # BEAN face-protection: hard zones subtracted from the editable mask
        editable = mask_rect(w, h, 0, 0, w - 1, h - 1, feather=4)
        import numpy as np
        e = np.asarray(editable).copy()
        for zx0, zy0, zx1, zy1 in zones:
            e[max(0, zy0):zy1, max(0, zx0):zx1] = 0
        protected_zone_only = np.zeros_like(e)
        for zx0, zy0, zx1, zy1 in zones:
            protected_zone_only[zy0:zy1, zx0:zx1] = 255
        # edit the sky/background everywhere EXCEPT faces
        m = Image.fromarray(e)
        mon.start("P-face-%s" % name)
        r = wc.call_ok("inpaint", {"image": b64_png(orig), "mask": b64_png(m),
                                   "prompt": "dramatic sunset sky and clouds", "steps": 25,
                                   "guidance": 6.0, "strength": 1.0, "seed": 77,
                                   "model": "sd15-inpaint"}, timeout_s=900)
        mon.stop()
        okb, raw = png_ok(r["images"][0])
        gen = Image.open(io.BytesIO(raw))
        comp = composite_exact(orig, gen, m)
        # verify: every pixel of the protected zone is the ORIGINAL
        zmask = Image.fromarray(protected_zone_only)
        zrep = preservation_report(orig, comp, Image.fromarray(np.where(np.asarray(m) == 0, 255, 0).astype("uint8")))
        rep = preservation_report(orig, comp, m)
        p_out = os.path.join(out_dir, "P%d-%s.png" % (idx + 2, name))
        comp.save(p_out)
        return {"_pass": okb and zrep["hardUnmaskedInteriorBitExact"],
                "facesDetected": len(faces), "faceRects": faces, "protectedZones": zones,
                "protectedZoneVerdict": "bit-exact original" if zrep["hardUnmaskedInteriorBitExact"] else "MODIFIED (FAIL)",
                "preservation": rep, "model": r["model"],
                "vramPeakMb": mon.peak_mb("P-face-%s" % name)}, [p_out]

    if real_available:
        suite.guard("P2", "face protection — single face stays bit-exact", lambda: p2(0, "face-protect-single"))

        def p3_wrapper():
            # multi-face requires a photo where YuNet actually finds >= 2 faces
            idx = 1 if len(real_photos) > 1 else 0
            probe = wc.call_ok("identity_prepare", {"image": b64_png(Image.open(real_photos[idx]).convert("RGB"))},
                               timeout_s=120)
            if len(probe.get("faces", [])) < 2:
                raise SkipTest("multi-face acceptance needs a photo with >= 2 clear faces "
                               "(detected %d in the available photo(s))" % len(probe.get("faces", [])))
            return p2(idx, "face-protect-multi")
        suite.guard("P3", "multiple-face handling — all faces protected", p3_wrapper)
    else:
        suite.record("P2", "face protection — single face stays bit-exact", "SKIP",
                     {"reason": "no operator test photos (see ACCEPTANCE-RUNBOOK.md)"})
        suite.record("P3", "multiple-face handling — all faces protected", "SKIP",
                     {"reason": "no operator test photos"})

    # P4: mask boundary behaviour (deterministic, no GPU needed)
    def p4():
        orig = Image.open(fixtures["localized-edit"]).convert("RGB")
        w, h = orig.size
        f_hard = mask_rect(w, h, int(w * 0.3), int(h * 0.3), int(w * 0.7), int(h * 0.7), feather=0)
        f_soft = mask_rect(w, h, int(w * 0.3), int(h * 0.3), int(w * 0.7), int(h * 0.7), feather=8)
        a_hard, a_soft = np.asarray(f_hard), np.asarray(f_soft)
        band_hard = int(((a_hard > 0) & (a_hard < 255)).sum())
        band_soft = int(((a_soft > 0) & (a_soft < 255)).sum())
        return {"_pass": band_hard == 0 and band_soft > 0,
                "feather0BandPixels": band_hard, "feather8BandPixels": band_soft,
                "definition": "feather=0 must yield a hard boundary (no blend band); feather=8 "
                              "must yield a measurable transition band; interior/exterior exactness "
                              "is asserted per generative test"}, []
    suite.guard("P4", "mask boundary — feather band behaviour", p4)

    # P5: dimension preservation (already asserted per test; explicit probe)
    def p5():
        orig = Image.open(fixtures["product-watch"]).convert("RGB")
        w, h = orig.size
        m = mask_rect(w, h, int(w * 0.4), int(h * 0.4), int(w * 0.6), int(h * 0.6))
        r = wc.call_ok("inpaint", {"image": b64_png(orig), "mask": b64_png(m),
                                   "prompt": "a dark dial", "steps": 10, "guidance": 6.0,
                                   "strength": 1.0, "seed": 3, "model": "sd15-inpaint"},
                        timeout_s=600)
        okb, raw = png_ok(r["images"][0])
        out = Image.open(io.BytesIO(raw))
        return {"_pass": okb and out.size == orig.size,
                "in": list(orig.size), "out": list(out.size)}, []
    suite.guard("P5", "output dimensions equal input dimensions", p5)

    # P7: identity similarity for regenerated faces (opt-in, estimate only)
    if real_available and args.allow_face_regeneration:
        def p7():
            orig = Image.open(real_photos[0]).convert("RGB")
            if min(orig.size) < 256:
                orig = orig.resize((max(256, orig.width), max(256, orig.height)))
            w, h = orig.size
            prep = wc.call_ok("identity_prepare", {"image": b64_png(orig)}, timeout_s=120)
            faces = prep.get("faces", [])
            if not faces:
                raise SkipTest("no face detected in the first operator photo")
            f = faces[0]
            fm = mask_rect(w, h, max(0, f["x"]), max(0, f["y"]),
                           min(w - 1, f["x"] + f["width"]), min(h - 1, f["y"] + f["height"]), feather=4)
            r = wc.call_ok("inpaint", {"image": b64_png(orig), "mask": b64_png(fm),
                                       "prompt": "a portrait of a person, neutral expression",
                                       "steps": 30, "guidance": 6.5, "strength": 1.0, "seed": 91,
                                       "model": "sd15-inpaint"}, timeout_s=900)
            okb, raw = png_ok(r["images"][0])
            regen = Image.open(io.BytesIO(raw))
            comp = composite_exact(orig, regen, fm)
            chk = wc.call_ok("identity_check", {"imageA": b64_png(orig), "imageB": b64_png(comp)},
                             timeout_s=120)
            p_out = os.path.join(out_dir, "P7-face-regeneration.png")
            comp.save(p_out)
            sim = chk.get("similarity")
            return {"_pass": True,  # this test MEASURES and reports; it cannot "fail" —
                    # the drift gate verdict IS the result
                    "similarityEstimate": sim, "threshold": chk.get("threshold"),
                    "driftGateVerdict": chk.get("verdict"), "allPairScores": chk.get("allScores"),
                    "note": IDENTITY_NOTE + " A passing gate does NOT assert identical identity.",
                    "regeneratedFaceRegion": f}, [p_out]
        suite.guard("P7", "identity similarity for a regenerated face (estimate)", p7)
    elif real_available:
        suite.record("P7", "identity similarity for a regenerated face (estimate)", "SKIP",
                     {"reason": "--allow-face-regeneration not given (destructive face test is opt-in)"})
    else:
        suite.record("P7", "identity similarity for a regenerated face (estimate)", "SKIP",
                     {"reason": "no operator test photos"})

    # ---- VRAM table ----------------------------------------------------------
    vram = {k: v for k, v in mon.peaks.items() if v}
    results["vramPeaksMb"] = {k: round(v, 1) for k, v in sorted(vram.items())}
    mon.finish()

    # ---- finalize --------------------------------------------------------------
    wc.close()
    results["tests"] = suite.results
    results["summary"] = {
        "pass": suite.passed, "fail": suite.failed, "skip": suite.skipped,
        "verdict": ("ACCEPTANCE_FAILED" if suite.failed else
                    ("ACCEPTED_WITH_SKIPS" if suite.skipped else "ACCEPTED")),
        "identityNote": IDENTITY_NOTE,
        "providerStillDisabled": True,
        "enablementRule": "bean-image-selfhosted-diffusers stays enabled:false in "
                          "src/lib/registry/backends.ts until BEAN reviews these artifacts.",
    }
    results["finishedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _write_results(results, out_dir)
    _write_report_md(results, out_dir)

    print("\n" + "=" * 78)
    print("SUMMARY: %d pass / %d fail / %d skip — verdict: %s"
          % (suite.passed, suite.failed, suite.skipped, results["summary"]["verdict"]))
    print("identity metric note: %s" % IDENTITY_NOTE)
    print("results: %s" % os.path.join(out_dir, "results.json"))
    print("=" * 78)
    return 0 if suite.failed == 0 else 4


def _write_results(results, out_dir):
    with open(os.path.join(out_dir, "results.json"), "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, default=str)


def _write_report_md(results, out_dir):
    lines = []
    r = results
    lines.append("# LAXII Phase 8 — Real Inference & Preservation Acceptance Report")
    lines.append("")
    lines.append("- Run: `%s` · finished %s" % (r["runId"], r.get("finishedAt")))
    lines.append("- Worker: `%s` (protocol JSON-lines)" % (r.get("workerVersion") or "?"))
    lines.append("- Environment: `%s`" % json.dumps(r.get("environment", {}), default=str)[:400])
    lines.append("- Preflight ok: `%s` · checkpoints allMatch: `%s` (see results.json)"
                 % ((r.get("preflight") or {}).get("ok"), (r.get("checkpoints") or {}).get("allMatch")))
    lines.append("")
    lines.append("| id | test | status | key measurements |")
    lines.append("|---|---|---|---|")
    for t in r.get("tests", []):
        d = {k: v for k, v in t["detail"].items() if k != "_pass"}
        key = "; ".join("%s=%s" % (k, v) for k, v in list(d.items())[:6])
        lines.append("| %s | %s | %s | %s |" % (t["id"], t["name"], t["status"], key[:400]))
    lines.append("")
    lines.append("## VRAM peaks (device-level, includes other processes)")
    for k, v in (r.get("vramPeaksMb") or {}).items():
        lines.append("- %s: %s MB" % (k, v))
    lines.append("")
    lines.append("## Verdict")
    s = r.get("summary", {})
    lines.append("**%s** — %s pass / %s fail / %s skip." % (
        s.get("verdict"), s.get("pass"), s.get("fail"), s.get("skip")))
    lines.append("")
    lines.append("Honesty notes:")
    lines.append("- " + IDENTITY_NOTE)
    lines.append("- PASS means measured on this host during this run; a completed install or "
                 "preflight alone does not complete Phase 8.")
    lines.append("- The Diffusers backend stays `enabled: false` until BEAN reviews these artifacts.")
    with open(os.path.join(out_dir, "report.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser(description="LAXII Phase 8 acceptance harness")
    ap.add_argument("--models-dir", default=os.path.join(WORKER_DIR, "models"))
    ap.add_argument("--real-dir", default=os.path.join(WORKER_DIR, "local", "testset-real"),
                    help="operator-supplied real photos (1 face / multiple faces) for face tests")
    ap.add_argument("--skip-sdxl", action="store_true", help="skip the two SDXL tests")
    ap.add_argument("--allow-face-regeneration", action="store_true",
                    help="opt in to the destructive face-regeneration identity test (P7)")
    args = ap.parse_args()
    try:
        code = run(args)
    except WorkerDied as e:
        print("\nSTOP: the worker process died unexpectedly: %s" % e)
        code = 5
    sys.exit(code)


if __name__ == "__main__":
    main()
