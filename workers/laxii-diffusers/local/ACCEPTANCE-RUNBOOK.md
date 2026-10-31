# LAXII Phase 8 — acceptance runbook (local Windows GPU host)

Everything in this folder runs **on your PC** (the RTX 5060 Ti host), never in
the BEAN dev sandbox (disk-full, no GPU — measured). Three scripts, in order:

```
workers/laxii-diffusers/
  windows/setup.ps1          one-shot: venv + cu128 torch + pins + BasicSR patch + preflight gate
  windows/hardware_report.ps1 machine facts -> hardware-report.json (read-only)
  local/download_models.py   license-aware, SHA-256-recorded checkpoint download (~17 GB)
  local/run_acceptance.py    REAL inference + preservation acceptance (this is the phase gate)
```

## 0. Prerequisites (checked, not assumed)

| Item | Requirement | Why |
| --- | --- | --- |
| OS | Windows 10 / 11 (PowerShell 5.1+) | scripts target Windows |
| GPU | NVIDIA RTX 5060 Ti 16 GB | Blackwell sm_120 |
| Driver | ≥ 576.02 (first RTX 5060 Ti driver, 2025-04-16) | sm_120 + CUDA 12.8 runtime |
| Python | 3.11–3.13 (3.12 recommended) | diffusers 0.42 needs ≥3.11; numpy 1.26.4 wheel availability |
| Disk | ≥ 45 GB free on the target drive | checkpoints ~17 GB + venv ~10 GB + outputs |
| RAM | 32 GB class | SDXL loading + Windows |

## 1. Hardware report (Step 2 input, read-only)

```powershell
powershell -ExecutionPolicy Bypass -File windows\hardware_report.ps1
```
Writes `windows/hardware-report.json`. If it does not show the RTX 5060 Ti with
driver ≥ 576.02, **stop** — install the driver first (this is the "stop if the
environment is unsuitable" rule; the preflight gate enforces it mechanically too).

## 2. Setup + preflight gate

```powershell
# from the repo root
powershell -ExecutionPolicy Bypass -File workers\laxii-diffusers\windows\setup.ps1
```
What it does: venv at `workers/laxii-diffusers/.venv` → pip upgrade →
`torch==2.11.0 torchvision==0.26.0` from the **cu128** index → pinned
`requirements.txt` → `windows/patch_basicsr.py` (fixes the documented
basicsr/torchvision+numpy breakage and PROVES the Real-ESRGAN import chain) →
runs the worker's own `preflight` and exits non-zero unless it passes.

PASS here means "the host can run the worker". It is NOT a capability claim.

## 3. Checkpoints (licenses shown, hashes recorded)

```powershell
& workers\laxii-diffusers\.venv\Scripts\Activate.ps1
cd workers\laxii-diffusers
python local\download_models.py --accept-licenses
```
Prints every license (OpenRAIL-M / OpenRAIL++-M / Apache-2.0 / BSD-3 / MIT) and
refuses to run without `--accept-licenses`. Writes `models/models.sha256` and
`models/download-record.json` (repo, revision, size, SHA-256 per file). Partial
download: `--only sdxl-base-1.0`. Re-runs are idempotent (hash-checked).

## 4. Operator test photos (needed ONLY for the face tests)

Create `workers/laxii-diffusers/local/testset-real/` and place:
- 1–2 photos with **one clear frontal face** (≥ 512 px),
- 1 photo with **two or more faces**,
- JPG/PNG. Use only photos you have the rights to; they never leave the
  machine (`identity_prepare` is local-only; only rectangles + a handle are
  returned; embeddings stay in worker memory).

Without photos, P2/P3/P7 are recorded as **SKIP with that reason** — the run
still completes, but the phase cannot be called complete while face-protection
acceptance is unexecuted. That is by design.

## 5. Run the acceptance (Steps 3 + 4)

```powershell
python local\run_acceptance.py                       # full suite
python local\run_acceptance.py --skip-sdxl           # if SDXL must wait
python local\run_acceptance.py --allow-face-regeneration   # opt-in destructive P7
```
- Runs against the **existing worker protocol** (JSON lines) — the same frames
  the Node client consumes.
- Gates: preflight must pass; every checkpoint hash is re-verified; a mismatch
  stops everything before any inference.
- Expected wall time on a 5060 Ti: roughly 15–40 min including SDXL (first
  model loads dominate). All timings, seeds, settings and VRAM peaks are
  recorded per test.
- Outputs land in `local/acceptance-out/<run>/`: `results.json`, `report.md`,
  every output/before/after/diff PNG, and the fixed procedural test set.
- Exit codes: `0` pass · `2` preflight gate failed · `3` checksum failed ·
  `4` test failures · `5` worker died.

## 6. What to bring back to BEAN

The whole `acceptance-out/<run>/` folder + `windows/hardware-report.json`.
Only after BEAN reviews these artifacts is `bean-image-selfhosted-diffusers`
considered for `enabled: true` in `src/lib/registry/backends.ts` — and only if
the report shows ACCEPTED (skips allowed only for genuinely absent face-photo
tests, clearly labeled). Do NOT flip the flag yourself; the enablement gate is
recorded in `worklog.md`.

## 7. Troubleshooting (measured causes, no guessing)

| Symptom | Cause / fix |
| --- | --- |
| `CUDA error: no kernel image is available` + warning about sm_120 | a non-cu128 torch got installed — re-run setup.ps1 (it pins torch==2.11.0+cu128) |
| `ModuleNotFoundError: torchvision.transforms.functional_tensor` | patch step skipped — run `python windows\patch_basicsr.py` |
| preflight `missingPackages: [torch, ...]` under `python` | you are outside the venv — activate `.venv` first |
| download 429/timeout on HF | retry with `--only <id>`; all files resume; no HF token needed (repos are ungated) |
| first SDXL load takes minutes | `from_pretrained` fp16 variant load — one-time cost per process |
| VRAM OOM in SDXL inpaint | close other GPU apps; the worker keeps ONE pipeline resident by design |
