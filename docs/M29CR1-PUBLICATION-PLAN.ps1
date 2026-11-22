<#
.SYNOPSIS
  M29-CR.1 — Corrected PowerShell publication plan for Bean-intelligence.

.DESCRIPTION
  Executes the two documented ordinary pushes (plus optional, separately-authorized
  main swap) AFTER the owner-side security gates are closed and the freeze is lifted.

  Two independent acknowledgment gates are required, or the script does nothing:
    1. $env:M29CR1_GATES_CLOSED     = "1"   -> owner affirms: M26.1.3 recovery confirmation,
                                               collaborator notification, and credential
                                               confirmation (M26.1.4 checklist section 4) are
                                               CLOSED, and the publication freeze is LIFTED.
    2. $env:M29CR1_ALLOW_MAIN_SWAP  = "1"   -> SEPARATE authorization to touch refs/heads/main
                                               (Step 4). Never combined with gate 1 implicitly.

  Safety properties:
    - Step 1 is a pure fast-forward (parent-1 relationship is verified before pushing).
    - Step 2 creates a NEW remote ref (main-sanitized); it never forces and never rewrites.
    - The integration tip is taken dynamically from the local branch — no hardcoded stale SHA.
    - Step 4 (main swap) is quarantined: refused unless BOTH its own acknowledgment is set
      AND the guarded --force-with-lease is anchored to the recorded old-main SHA.
    - Every step verifies before proceeding; any drift throws and aborts the whole run.

.NOTES
  Tested semantics for Windows PowerShell 5.1 and PowerShell 7+ (git for Windows).
  All refspecs are double-quoted (corrects the fragile backtick-escaped colons of the
  prior M29-CR plan). Repository: https://github.com/jon0471-dot/Bean-intelligence.git
#>

$ErrorActionPreference = "Stop"

# ---- configuration -----------------------------------------------------------
$RepoUrl                = "https://github.com/jon0471-dot/Bean-intelligence.git"
$Pr4BaseBranch          = "fix/laxii-image-output-ux"       # Step 1 target (existing ref)
$Pr4ReconciliationSha   = "e96d83a5196f45712350aaf41d13a1e5dfcebae7"
$Pr4BaseOldSha          = "18c93ed7b1e433bb1c06c0a803d5adff0dcaf064"
$SanitizedLocalBranch   = "reconcile/sanitized-m27-m28-migration"  # Step 2 source (live)
$SanitizedRemoteName    = "main-sanitized"                  # Step 2 target (NEW ref)
$AppTreeSha             = "d2c232a6fa225644e91e967d2148558ba67b9679"
$OldMainSha             = "91a68090ef72f71f52797bd88f9b83831fbeb997"  # lease anchor only
$M262Sha                = "8f61599271b1aa66e86a2c4956f6dc01eef8b737"

function Assert-Git($args) {
  git @args
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed (exit $LASTEXITCODE). ABORT." }
}

Write-Host "=== M29-CR.1 publication: preflight ===" -ForegroundColor Cyan

# ---- gate 0: freeze / owner gates --------------------------------------------
if ($env:M29CR1_GATES_CLOSED -ne "1") {
  Write-Host "PUBLICATION FROZEN. M29CR1_GATES_CLOSED is not set." -ForegroundColor Yellow
  Write-Host "Outstanding owner gates: M26.1.3 recovery confirmation; collaborator notification;"
  Write-Host "credential confirmation (M26.1.4 section 4); publication freeze lift."
  Write-Host "Nothing was executed. Set M29CR1_GATES_CLOSED=1 only after the owner closes every gate."
  return
}

# ---- local-side checks --------------------------------------------------------
# FF precondition: parent-1 of the PR #4 reconciliation commit must be the current remote tip.
$recParents = (git log -1 --format=%P $Pr4ReconciliationSha).Trim() -split "\s+"
if ($recParents[0] -ne $Pr4BaseOldSha) {
  throw "FF precondition broken: parent-1 of $Pr4ReconciliationSha is $($recParents[0]), expected $Pr4BaseOldSha. ABORT."
}
Write-Host "OK: parent-1 of $Pr4ReconciliationSha is $Pr4BaseOldSha (pure fast-forward — no force needed)."

$tip = (git rev-parse $SanitizedLocalBranch).Trim()
if ($LASTEXITCODE -ne 0) { throw "local branch $SanitizedLocalBranch not found. ABORT." }
Write-Host "local integration tip: $tip"

Assert-Git @("merge-base", "--is-ancestor", $Pr4ReconciliationSha, $tip)
Write-Host "OK: tip contains the PR #4 reconciliation commit."

Assert-Git @("merge-base", "--is-ancestor", $AppTreeSha, $tip)
Write-Host "OK: verified application tree $AppTreeSha contained in tip."

$localFixTip = (git rev-parse $Pr4BaseBranch).Trim()
if ($LASTEXITCODE -ne 0 -or $localFixTip -ne $Pr4ReconciliationSha) {
  throw "Local branch $Pr4BaseBranch = $localFixTip, expected the prepared reconciliation SHA $Pr4ReconciliationSha. ABORT."
}
Write-Host "OK: local $Pr4BaseBranch is the prepared reconciliation commit (remote equality is asserted by the remote-state gate below)."

$mb = (git merge-base $tip $OldMainSha).Trim()
if ($mb -ne "cafdb6826da9c4edcd62e2ead15d801869ae9c3a") {
  throw "LINEAGE GUARD: merge-base(sanitized tip, recorded old-main SHA) = $mb, expected cafdb68. Old unsanitized history may have leaked. ABORT."
}
Write-Host "OK: lineage guard — sanitized line meets old main only at the pre-split fork cafdb68 (checked against the recorded SHA, immune to a stale local origin/main)."

# ---- gate 1: remote state matches the recorded pre-publication state ----------
$expected = @{
  "refs/heads/main"                         = $OldMainSha
  "refs/heads/feat/m26-2-media-capabilities"= $M262Sha
  "refs/heads/fix/laxii-image-output-ux"    = $Pr4BaseOldSha
}
$actual = @{}
git ls-remote $RepoUrl | ForEach-Object {
  $parts = $_ -split "`t"
  if ($expected.ContainsKey($parts[1])) { $actual[$parts[1]] = $parts[0] }
  if ($parts[1] -eq "refs/heads/$SanitizedRemoteName") { $actual["__exists"] = $parts[0] }
}
$ok = $true
foreach ($k in $expected.Keys) {
  if (-not $actual.ContainsKey($k) -or $actual[$k] -ne $expected[$k]) {
    Write-Host "REMOTE MISMATCH or MISSING: $k -> $($actual[$k])" -ForegroundColor Red; $ok = $false
  } else {
    Write-Host "OK remote: $k -> $($actual[$k])"
  }
}
if (-not $ok) { throw "Remote state does not match the recorded pre-publication state. ABORT — do not push." }
if ($actual.ContainsKey("__exists")) {
  throw "refs/heads/$SanitizedRemoteName already exists remotely ($($actual['__exists'])). Step 2 assumes absence. ABORT."
}
Write-Host "OK remote: refs/heads/$SanitizedRemoteName does not exist yet (Step 2 precondition)." -ForegroundColor Green
Write-Host "Preflight PASS." -ForegroundColor Green

# ---- Step 1: fast-forward fix/laxii-image-output-ux 18c93ed -> e96d83a --------
Write-Host "`n=== Step 1: fast-forward $Pr4BaseBranch (resolves PR #4 conflict set) ===" -ForegroundColor Cyan
Write-Host "before: $Pr4BaseOldSha  after: $Pr4ReconciliationSha  (parent-1 verified in preflight)"
Assert-Git @("push", $RepoUrl, "${Pr4ReconciliationSha}:refs/heads/${Pr4BaseBranch}")
Write-Host "Step 1 done." -ForegroundColor Green

# ---- Step 2: create main-sanitized at the LIVE integration tip ----------------
Write-Host "`n=== Step 2: publish sanitized line as new branch $SanitizedRemoteName ===" -ForegroundColor Cyan
Write-Host "before: (absent)  after: $tip (read live from $SanitizedLocalBranch — never a hardcoded stale SHA)"
Assert-Git @("push", $RepoUrl, "${tip}:refs/heads/${SanitizedRemoteName}")
Write-Host "Step 2 done." -ForegroundColor Green

# ---- Step 3: verify every remote SHA ------------------------------------------
Write-Host "`n=== Step 3: post-push verification ===" -ForegroundColor Cyan
$expectedAfter = @{
  "refs/heads/$Pr4BaseBranch"               = $Pr4ReconciliationSha
  "refs/heads/$SanitizedRemoteName"         = $tip
  "refs/heads/feat/m26-2-media-capabilities"= $M262Sha
  "refs/heads/main"                         = $OldMainSha
}
$actualAfter = @{}
git ls-remote $RepoUrl | ForEach-Object {
  $parts = $_ -split "`t"
  if ($expectedAfter.ContainsKey($parts[1])) { $actualAfter[$parts[1]] = $parts[0] }
}
$ok2 = $true
foreach ($k in $expectedAfter.Keys) {
  if (-not $actualAfter.ContainsKey($k) -or $actualAfter[$k] -ne $expectedAfter[$k]) {
    Write-Host "POST-PUSH MISMATCH: $k -> $($actualAfter[$k]) expected $($expectedAfter[$k])" -ForegroundColor Red; $ok2 = $false
  } else {
    Write-Host "OK: $k -> $($actualAfter[$k])"
  }
}
if (-not $ok2) { throw "Post-push verification failed. Investigate before any further action." }
Write-Host "Post-push verification PASS." -ForegroundColor Green

# ---- GitHub UI follow-ups (owner actions, no git commands) ---------------------
Write-Host @"

Owner follow-ups on GitHub (manual, per decision D7):
  1. PR #4 now recomputes clean (head 8f61599 fully contained in the new base e96d83a).
     Owner closes it as merged personally. Automation must not press merge.
  2. PRs #1, #6, #7: close with the sanitized-successor notice
     (docs/M29-CONFLICT-RESOLUTION-REPORT.md section 10). Their bases are old public
     history and must never merge; their content is canonical on $SanitizedRemoteName.
  3. Default-branch change (Settings -> Branches -> default = $SanitizedRemoteName) is an
     owner action, only after collaborator notification is complete.
"@ -ForegroundColor Cyan

# ---- Step 4: main swap — QUARANTINED, separately authorized only --------------
Write-Host "`n=== Step 4: refs/heads/main swap — QUARANTINED ===" -ForegroundColor Magenta
if ($env:M29CR1_ALLOW_MAIN_SWAP -ne "1") {
  Write-Host "Refused: M29CR1_ALLOW_MAIN_SWAP is not set. Old main remains untouched."
  Write-Host "Recommended path needs no force at all: set the GitHub default branch to $SanitizedRemoteName;"
  Write-Host "keep old main as the read-only archive until collaborator notification is complete."
  Write-Host "`nPUBLICATION COMPLETE (Steps 1-3). main untouched." -ForegroundColor Green
  return
}
Write-Host "M29CR1_ALLOW_MAIN_SWAP=1 detected — guarded non-FF update with exact-lease protection." -ForegroundColor Magenta
Write-Host "This rewrites the meaning of refs/heads/main. It fails safely if main moved from the recorded SHA."
Assert-Git @("push", "--force-with-lease=refs/heads/main:${OldMainSha}", $RepoUrl, "${tip}:refs/heads/main")
Write-Host "Step 4 done: refs/heads/main = $tip." -ForegroundColor Green
Write-Host "`nPUBLICATION COMPLETE (Steps 1-4)." -ForegroundColor Green
