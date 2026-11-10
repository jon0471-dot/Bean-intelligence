# BEAN Intelligence — LAXII Phase 8 — Local hardware report (Windows GPU host)
#
# Collects the machine facts the deployment decision depends on and writes them
# to hardware-report.json next to this script. Read-only: it changes nothing.
#
#   powershell -ExecutionPolicy Bypass -File hardware_report.ps1
#
# The report is a measurement, NOT a pass/fail verdict. The pass/fail gate is
# the worker's own `preflight` (run by setup.ps1 / run_acceptance.py), which
# checks the actual CUDA+PyTorch stack, VRAM and checkpoints.

$ErrorActionPreference = 'Continue'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$reportPath = Join-Path $scriptDir ('hardware-report.json')

$report = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  os = $null
  cpu = $null
  ramTotalGb = $null
  gpu = $null
  disk = @()
  python = $null
}

# --- OS / RAM / CPU ---------------------------------------------------------
try {
  $os = Get-CimInstance Win32_OperatingSystem
  $report.os = [ordered]@{
    caption = $os.Caption
    version = $os.Version
    build   = $os.BuildNumber
  }
  $cs = Get-CimInstance Win32_ComputerSystem
  if ($cs.TotalPhysicalMemory) {
    $report.ramTotalGb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 2)
  }
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  if ($cpu) { $report.cpu = ('{0} ({1} cores)' -f $cpu.Name.Trim(), $cpu.NumberOfCores) }
} catch {
  $report.os = @{ error = $_.Exception.Message }
}

# --- GPU: prefer nvidia-smi (authoritative for driver + VRAM) ---------------
$nvSmi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($nvSmi) {
  try {
    $csv = & nvidia-smi --query-gpu=name,driver_version,memory.total,compute_cap,vbios_version --format=csv,noheader,nounits 2>$null
    $gpuList = @()
    foreach ($line in $csv) {
      $p = $line.Split(',') | ForEach-Object { $_.Trim() }
      if ($p.Count -ge 4) {
        $gpuList += [ordered]@{
          name          = $p[0]
          driverVersion = $p[1]
          vramTotalMb   = [double]$p[2]
          computeCap    = $p[3]
          vbios         = if ($p.Count -ge 5) { $p[4] } else { $null }
        }
      }
    }
    if ($gpuList.Count -gt 0) { $report.gpu = $gpuList }
  } catch {
    $report.gpu = @{ error = $_.Exception.Message }
  }
}
if (-not $report.gpu) {
  # Fallback: WMI knows the card name but NOT the driver's CUDA readiness.
  try {
    $cards = Get-CimInstance Win32_VideoController | ForEach-Object {
      [ordered]@{ name = $_.Name; driverVersion = $_.DriverVersion; source = 'Win32_VideoController' }
    }
    $report.gpu = $cards
    Write-Host 'NOTE: nvidia-smi not found — CUDA readiness UNKNOWN from WMI alone.' -ForegroundColor Yellow
  } catch {
    $report.gpu = @{ error = $_.Exception.Message }
  }
}

# --- Disk free (all fixed drives, largest first) -----------------------------
try {
  $report.disk = Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    [ordered]@{
      drive   = $_.DeviceID
      freeGb  = [math]::Round($_.FreeSpace / 1GB, 2)
      totalGb = [math]::Round($_.Size / 1GB, 2)
    }
  }
} catch {
  $report.disk = @(@{ error = $_.Exception.Message })
}

# --- Python launchers visible to PATH ----------------------------------------
foreach ($cand in @('py', 'python', 'python3')) {
  $cmd = Get-Command $cand -ErrorAction SilentlyContinue
  if ($cmd) {
    try {
      $v = & $cand --version 2>&1
      $report.python = [ordered]@{ launcher = $cand; version = ($v | Out-String).Trim() }
      break
    } catch { }
  }
}

# --- Emit ---------------------------------------------------------------------
$report | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 $reportPath
Write-Host '==================== LAXII local hardware report ===================='
$report | ConvertTo-Json -Depth 4
Write-Host ''
Write-Host ("Saved: {0}" -f $reportPath)
Write-Host 'Targets for this phase: RTX 5060 Ti 16 GB, driver >= 576.02 (first RTX 5060 Ti driver),'
Write-Host '>= 45 GB free disk for venv + checkpoints, Python 3.11-3.13 (3.12 recommended).'
Write-Host 'This report does NOT certify CUDA readiness — the worker preflight does.'
