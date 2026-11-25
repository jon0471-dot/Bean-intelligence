<#
.SYNOPSIS
M40.9 — ONE-COMMAND RTX 5060 Ti acceptance runner (real hardware, Windows).

.DESCRIPTION
Runs the complete M40 RTX acceptance on the actual Windows PC:
  1. safe-syncs the M40 feature branch (fetch + fast-forward ONLY — never a
     hard reset, never discards local work; aborts cleanly if the tree is dirty),
  2. installs dependencies if missing (bun preferred, npm fallback),
  3. builds the production artifacts (workers + ORT assets) and the harness bundle,
  4. starts the harness static server (localhost only),
  5. opens the harness in the installed Chrome with --expose-gc,
  6. waits for the browser to POST its finished evidence JSON to the server
     (saved to validation\m40-rtx\results-<utcstamp>.json),
  7. schema-validates the evidence and prints the acceptance verdict.

The evidence file is the acceptance record (adapter identity, providers,
timings, heap deltas, per-check verdicts). It contains browser-side
measurements only — no secrets and no local file paths — and can be committed
as-is.

.EXAMPLE
powershell -ExecutionPolicy Bypass -File scripts\m40-acceptance\run-rtx-acceptance.ps1
Optional switches:
  -SkipSync        skip the git fast-forward sync (offline / detached runs)
  -SkipBuild       skip dependency install + builds (artifacts already present)
  -TimeoutMinutes  evidence wait timeout (default 25)
#>
param(
  [switch]$SkipSync,
  [switch]$SkipBuild,
  [int]$TimeoutMinutes = 25
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
Set-Location $repo
$branch = 'feat/m40-real-hardware-capability-completion'
$port = if ($env:RTX_HARNESS_PORT) { [int]$env:RTX_HARNESS_PORT } else { 8787 }

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor DarkYellow }

# ---------------------------------------------------------------- 1. safe sync
if (-not $SkipSync) {
  Step '1/6 safe branch sync (fast-forward only — no reset, no discard)'
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) { Write-Warning 'git not found on PATH — skipping sync (continuing with the current checkout)' }
  else {
    $dirty = git status --porcelain
    if ($dirty) { throw "working tree has uncommitted changes — the runner never discards local work. Commit or stash them first:`n$dirty" }
    git fetch origin
    $onBranch = (git rev-parse --abbrev-ref HEAD) -eq $branch
    if (-not $onBranch) { git checkout $branch }
    git pull --ff-only origin $branch
    Write-Host ("branch {0} at {1}" -f $branch, (git rev-parse --short HEAD))
  }
}

# ------------------------------------------------------------- 2. dependencies
if (-not $SkipBuild) {
  Step '2/6 dependencies (bun preferred, npm fallback)'
  if (-not (Test-Path 'node_modules')) {
    if (Get-Command bun -ErrorAction SilentlyContinue) { bun install }
    else { npm install }
  } else { Write-Host 'node_modules present — skipping install' }
}

# ------------------------------------------------------------------ 3. builds
if (-not $SkipBuild) {
  Step '3/6 builds (workers + ORT assets + harness bundle)'
  if (Get-Command bun -ErrorAction SilentlyContinue) { bun run build }
  else { npm run build }
  node validation/m40-rtx/build.mjs
}

# ------------------------------------------------------------ 4. server + browser
Step '4/6 harness server + Chrome'
$log = Join-Path $env:TEMP 'm40-rtx-harness-server.log'
$node = (Get-Command node).Source
$server = Start-Process -FilePath $node -ArgumentList "scripts/m40-acceptance/rtx-harness-server.mjs" -WorkingDirectory $repo -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden
Write-Host "server pid $($server.Id), log $log"

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $probe = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$port/bundle.js" -Method Head -TimeoutSec 3
    if ($probe.StatusCode -eq 200) { $ready = $true; break }
  } catch { }
}
if (-not $ready) {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  throw "harness server did not become ready on port $port — see $log / $log.err"
}
Write-Host "harness ready: http://localhost:$port/harness"

$chromePaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) }
if (-not $chromePaths) {
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  throw 'Chrome not found in the standard install locations — open http://localhost:8787/harness manually with --js-flags=--expose-gc'
}
$chrome = $chromePaths[0]
Write-Host "launching $chrome (keep the tab open; the run finishes on its own)"
Start-Process -FilePath $chrome -ArgumentList @('--js-flags=--expose-gc', "--window-size=1100,900", "http://localhost:$port/harness")

# ------------------------------------------------------- 5. wait for evidence
Step '5/6 waiting for the browser to report its evidence'
$started = Get-Date
$deadline = $started.AddMinutes($TimeoutMinutes)
$outDir = Join-Path $repo 'validation\m40-rtx'
$evidence = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  $latest = Get-ChildItem -Path $outDir -Filter 'results-*.json' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latest -and $latest.LastWriteTime -gt $started) { $evidence = $latest; break }
  Write-Host ("  … waiting ({0:n0}s elapsed; the full run includes the model download and 10+ GPU mattes)" -f ((Get-Date) - $started).TotalSeconds)
}
if (-not $evidence) {
  Write-Warning "no evidence file appeared within $TimeoutMinutes minutes. The harness page stays open — finish it manually (Download evidence JSON into validation\m40-rtx\), then re-run step 6 with:"
  Write-Warning "  node scripts\m40-acceptance\validate-rtx-evidence.mjs validation\m40-rtx\<your-file>.json"
  exit 2
}
$rel = [IO.Path]::GetRelativePath($repo, $evidence.FullName)
Write-Host "evidence received: $rel ($([math]::Round($evidence.Length/1KB,1)) KB)"

# ------------------------------------------------------ 6. schema + verdict
Step '6/6 schema validation + acceptance verdict'
node scripts/m40-acceptance/validate-rtx-evidence.mjs $rel
$verdict = $LASTEXITCODE
Write-Host "`nNEXT: commit the evidence on the feature branch (it is the acceptance record):"
Write-Host "  git add $rel"
Write-Host "  git commit -m `"docs(m40.9): RTX 5060 Ti acceptance evidence captured on the real hardware`""
exit $verdict
