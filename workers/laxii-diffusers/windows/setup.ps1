# BEAN Intelligence — LAXII Phase 8 — one-shot local setup (Windows GPU host)
#
# Target: Windows 10/11 + NVIDIA RTX 5060 Ti 16 GB (Blackwell, sm_120).
# Creates a self-contained venv inside workers/laxii-diffusers/.venv with the
# verified 2026-10-31 package matrix, applies the documented BasicSR patch,
# then runs the worker's OWN preflight as the pass/fail gate.
#
# Run from the repo root:
#   powershell -ExecutionPolicy Bypass -File workers\laxii-diffusers\windows\setup.ps1
#
# This script NEVER claims inference capability — only setup + preflight.

param(
  # Directory that hosts .venv and models\. Defaults to workers\laxii-diffusers
  # inside the repo containing this script. A fast drive with >= 45 GB free is
  # strongly recommended (checkpoints ~17 GB + venv ~10 GB).
  [string]$WorkerDir = "",
  [switch]$SkipPreflight
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $WorkerDir) {
  $WorkerDir = Split-Path -Parent $scriptDir   # workers/laxii-diffusers
}
$venvDir = Join-Path $WorkerDir '.venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'

function Info($m)    { Write-Host ("[setup] " + $m) }
function Warn($m)    { Write-Host ("[setup] WARNING: " + $m) -ForegroundColor Yellow }
function Die($m)     { Write-Host ("[setup] STOP: " + $m) -ForegroundColor Red; exit 3 }

Info ("worker dir: " + $WorkerDir)

# --- 1. Windows check --------------------------------------------------------
if (-not ($env:OS -eq 'Windows_NT')) { Die 'This setup script targets Windows.' }

# --- 2. NVIDIA driver presence ------------------------------------------------
$nv = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if (-not $nv) {
  Die "nvidia-smi not found. Install the NVIDIA GeForce driver (>= 576.02 for the RTX 5060 Ti) and reboot, then re-run."
}
try {
  $gpuLine = (& nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader,nounits | Select-Object -First 1)
  Info ("GPU: " + $gpuLine)
} catch { Warn ("nvidia-smi query failed: " + $_.Exception.Message) }

# --- 3. Disk space check (>= 45 GB on the target drive) -----------------------
$drive = (Get-Item $WorkerDir).PSDrive
$freeGb = [math]::Round($drive.Free / 1GB, 1)
Info ("free disk on " + $drive.Name + ": " + $freeGb + " GB")
if ($freeGb -lt 45) {
  Die ("Only $freeGb GB free on " + $drive.Name + " — checkpoints (~17 GB) + venv (~10 GB) need >= 45 GB. " +
       "Re-run with -WorkerDir on a larger drive.")
}

# --- 4. Python 3.11-3.13 (3.12 recommended) -----------------------------------
$pyCmd = $null
foreach ($cand in @(@('py','-3.12'), @('py','-3.11'), @('py','-3.13'), @('py','-3.14'), @('python'))) {
  try {
    $pyArgs = @()
    if ($cand.Count -gt 1) { $pyArgs += $cand[1] }
    $ver = & $cand[0] @pyArgs --version 2>$null
    if ($ver -match 'Python 3\.(\d+)\.') {
      $minor = [int]$Matches[1]
      if ($minor -ge 11 -and $minor -le 14) { $pyCmd = $cand; break }
    }
  } catch { }
}
if (-not $pyCmd) {
  Die "No Python 3.11-3.13 found. Install Python 3.12 (winget install Python.Python.3.12) and re-run."
}
Info ("python: " + ($pyCmd -join ' '))

# --- 5. venv -------------------------------------------------------------------
if (-not (Test-Path $venvPython)) {
  Info "creating venv (.venv) ..."
  $venvArgs = @()
  if ($pyCmd.Count -gt 1) { $venvArgs += $pyCmd[1] }
  & $pyCmd[0] @venvArgs -m venv $venvDir
  if ($LASTEXITCODE -ne 0) { Die "venv creation failed." }
} else {
  Info "existing venv found — reusing."
}

# --- 6. pip + torch cu128 (Blackwell sm_120 requires CUDA 12.8 builds) --------
Info "upgrading pip ..."
& $venvPython -m pip install --upgrade pip | Out-Null
if ($LASTEXITCODE -ne 0) { Die "pip upgrade failed." }

Info "installing torch 2.11.0 + torchvision 0.26.0 (cu128 wheels — verified RTX 5060 Ti / sm_120 support) ..."
& $venvPython -m pip install torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) { Die "torch cu128 install failed — check network/proxy." }

Info "installing remaining pinned requirements ..."
& $venvPython -m pip install -r (Join-Path $WorkerDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Die "requirements install failed." }

# --- 7. BasicSR compatibility patch + import proof -----------------------------
Info "applying BasicSR compatibility patch (functional_tensor / numpy aliases) ..."
& $venvPython (Join-Path $scriptDir 'patch_basicsr.py')
if ($LASTEXITCODE -ne 0) { Die "BasicSR patch/verify failed — see output above." }

# --- 8. THE GATE: the worker's own preflight -----------------------------------
if ($SkipPreflight) {
  Warn "-SkipPreflight given; skipping the preflight gate."
} else {
  Info "running worker preflight (the real gate — stdlib honesty report) ..."
  $req = '{"id":"gate","method":"preflight","params":{}}'
  $out = $req | & $venvPython (Join-Path $WorkerDir 'worker.py') 2>$null
  $report = $null
  foreach ($line in $out) {
    if ($line -match '^\{') { try { $j = $line | ConvertFrom-Json } catch { } ; if ($j -and $j.result) { $report = $j.result } }
  }
  if (-not $report) { Die "no preflight response parsed — run the worker manually and inspect stderr." }
  $ok = [bool]$report.ok
  Info ("preflight.ok        : " + $ok)
  Info ("python              : " + $report.python.version)
  Info ("cuda.available      : " + $report.cuda.available)
  Info ("cuda.device         : " + $report.cuda.device)
  Info ("vram free/total GB  : " + $report.cuda.vramFreeGb + " / " + $report.cuda.vramTotalGb)
  Info ("disk free GB        : " + $report.disk.freeGb)
  Info ("missing packages    : " + ($report.missingPackages -join ', '))
  $models = @($report.models)
  Info ("checkpoints present : " + ($models | Where-Object { $_.present }).Count + "/" + $models.Count)
  if ($ok) {
    Write-Host ""
    Write-Host "SETUP + PREFLIGHT PASSED." -ForegroundColor Green
    Write-Host "This proves the HOST can run the worker. It does NOT prove any model has run."
    Write-Host "Next:  python local\download_models.py --accept-licenses"
    Write-Host "Then:  python local\run_acceptance.py   (real inference + preservation acceptance)"
    exit 0
  } else {
    Write-Host ""
    Write-Host "PREFLIGHT NOT PASSED — truthful reasons above." -ForegroundColor Red
    Write-Host "If checkpoints are the only gap, run:  python local\download_models.py --accept-licenses"
    exit 4
  }
}
Info "setup complete."
