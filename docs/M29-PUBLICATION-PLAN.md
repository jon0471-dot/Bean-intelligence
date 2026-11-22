# M29-CR — PowerShell-Compatible Publication Plan

Milestone: **M29-CR** · Date: 2026-11-22 (IST) · Status: **PREPARED — every command below requires the security gates closed and separate owner authorization. Nothing has been executed against the remote.**

Repository: `https://github.com/jon0471-dot/Bean-intelligence.git`
All commands are plain `git` invocations and run unchanged in PowerShell 5.1+ and PowerShell 7+ on Windows (git for Windows). No bash-only syntax is used.

## 0. Current recorded state (verified by `git ls-remote` at 2026-11-22, twice this milestone)

| Ref | Remote SHA now |
|---|---|
| `refs/heads/main` (= HEAD) | `91a68090ef72f71f52797bd88f9b83831fbeb997` |
| `refs/heads/feat/laxii-jazmii-restoration` | `e7d7003f36896b3ceaf07cde74d36275989469c1` |
| `refs/heads/feat/m26-2-media-capabilities` | `8f61599271b1aa66e86a2c4956f6dc01eef8b737` |
| `refs/heads/fix/laxii-image-output-ux` | `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064` |
| `refs/pull/1/head`, `refs/pull/4/head` | `8f61599271b1aa66e86a2c4956f6dc01eef8b737` |
| `refs/pull/2/head` (closed) | `a01486289149e0347b41d111c376b8a2b078ad80` |
| `refs/pull/3/head` (closed), `refs/pull/5/head` (closed) | `3ec836503c630c632f14bc22e5ffc6dfa3c844a8` / `91a68090ef72f71f52797bd88f9b83831fbeb997` |
| `refs/pull/6/head`, `refs/pull/7/head` | `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064` |

## 1. Preflight gate script (run before ANY push; aborts on any mismatch)

```powershell
# --- M29-CR preflight: verify the remote is exactly the recorded state ---
$expected = @{
  "refs/heads/main"                         = "91a68090ef72f71f52797bd88f9b83831fbeb997"
  "refs/heads/feat/laxii-jazmii-restoration"= "e7d7003f36896b3ceaf07cde74d36275989469c1"
  "refs/heads/feat/m26-2-media-capabilities"= "8f61599271b1aa66e86a2c4956f6dc01eef8b737"
  "refs/heads/fix/laxii-image-output-ux"    = "18c93ed7b1e433bb1c06c0a803d5adff0dcaf064"
}
$actual = @{}
git ls-remote origin | ForEach-Object {
  $parts = $_ -split "`t"
  if ($expected.ContainsKey($parts[1])) { $actual[$parts[1]] = $parts[0] }
}
$ok = $true
foreach ($k in $expected.Keys) {
  if (-not $actual.ContainsKey($k) -or $actual[$k] -ne $expected[$k]) {
    Write-Host "MISMATCH or MISSING: $k -> $($actual[$k])" -ForegroundColor Red; $ok = $false
  } else {
    Write-Host "OK: $k -> $($actual[$k])"
  }
}
if (-not $ok) { throw "Remote state does not match the recorded pre-publication state. ABORT — do not push." }
Write-Host "Preflight PASS — remote matches the recorded state." -ForegroundColor Green
```

## 2. Publication operations (in order, each verified before the next)

### Step 1 — Fast-forward the PR #4 base branch to the verified reconciliation (resolves PR #4's conflict set)

- Type: **normal fast-forward** (parent 1 of the new SHA is exactly the current remote tip — no force, no rewrite).
- Before: `origin/fix/laxii-image-output-ux` = `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064`
- After:  `origin/fix/laxii-image-output-ux` = `e96d83a5196f45712350aaf41d13a1e5dfcebae7`

```powershell
git push origin e96d83a5196f45712350aaf41d13a1e5dfcebae7`:refs/heads/fix/laxii-image-output-ux
```

Effect: PR #4's conflict set (`.gitignore`, `src/components/bean/laxii.tsx`) is delivered **by the reconciliation merge commit itself**; GitHub recomputes the PR clean (head `8f61599` is fully contained in the new base). PR heads of #6/#7 automatically move to `e96d83a` (same branch) — they remain lineage-blocked against their old-history bases, unchanged.

### Step 2 — Publish the sanitized integration line as a NEW remote branch (normal push creating a new ref — no force, no history change)

- Before: `refs/heads/main-sanitized` does not exist remotely.
- After:  `refs/heads/main-sanitized` = the integration branch tip (verify immediately before publishing with `git rev-parse reconcile/sanitized-m27-m28-migration`; includes the M29 G1–G7 migration, the PR #4 reconciliation, and all M29/M29-CR documentation commits)

```powershell
git push origin reconcile/sanitized-m27-m28-migration`:refs/heads/main-sanitized
```

(Alternative name — the owner may choose any name; `main-sanitized` is the documented proposal. Publishing under the migration branch's own name works identically: `git push origin reconcile/sanitized-m27-m28-migration`.)

### Step 3 — Verify every remote SHA afterwards

```powershell
git ls-remote origin
```

Expected after steps 1–2:

| Ref | Expected SHA |
|---|---|
| `refs/heads/fix/laxii-image-output-ux` | `e96d83a5196f45712350aaf41d13a1e5dfcebae7` |
| `refs/heads/main-sanitized` | the integration tip printed by `git rev-parse reconcile/sanitized-m27-m28-migration` (record concretely in the owner reply / download copy) |
| `refs/heads/feat/m26-2-media-capabilities` | `8f61599271b1aa66e86a2c4956f6dc01eef8b737` (unchanged) |
| `refs/heads/main` | `91a68090ef72f71f52797bd88f9b83831fbeb997` (unchanged — see Step 4) |
| `refs/heads/feat/laxii-jazmii-restoration` | `e7d7003f36896b3ceaf07cde74d36275989469c1` (unchanged) |

Also verify the GitHub PR states after step 1: PR #4 must show a clean/contained state (never merged by this task — the owner presses any merge UI action personally, per D7).

### Step 4 — `main` swap: SEPARATELY AUTHORIZED ONLY (never part of the fast-forward plan)

The sanitized line is NOT a descendant of old public `main` (merge-base `cafdb68`; old `main` is not an ancestor of the sanitized line — verified). Therefore **no fast-forward can move remote `main` to the sanitized line**, and force-updating `main` during the freeze is prohibited. Options, in owner-control order:

- **Option A (recommended — no force at all):** on GitHub → Settings → Branches: set the default branch to `main-sanitized` (published in Step 2). Old `main` remains as the read-only archive until the owner deletes/renames it after collaborator notification is complete. No shell command touches old history.
- **Option B (only with explicit, separately recorded owner authorization AFTER the gates close):**

```powershell
# NEVER run during the security freeze. Guarded non-FF update (fails if main moved):
git push --force-with-lease=refs/heads/main:91a68090ef72f71f52797bd88f9b83831fbeb997 origin 8e5c2ea78622a81117331892a6180afd976b818f`:refs/heads/main
```

This command is documented for completeness only; executing it is an owner decision outside this milestone's authorization.

### Step 5 — PR dispositions after publication (owner actions, per D7)

```powershell
# No git commands — GitHub UI actions by the owner:
# 1. PR #4: after Step 1 the PR recomputes clean; owner closes it as merged
#    (the reconciliation commit e96d83a already IS the merge result).
# 2. PRs #1, #6, #7: close with the sanitized-successor notice
#    (docs/M29-CONFLICT-RESOLUTION-REPORT.md §10) — their bases are old
#    public history and must never merge; their content is canonical on
#    main-sanitized.
# 3. Collaborators: notified per the outstanding M26.1.3 gate before any
#    default-branch change.
```

## 3. What this plan deliberately does NOT do

- No history rewrite, no `--force` on any existing ref during the freeze, no remote branch deletion, no PR merge/closure by automation, no bypass of the recovery / collaborator-notification / credential-confirmation gates.
- No publication of the excluded material (G8/G9/G10 commits, credential-forensics docs, WIP snapshots with cookie/login artifacts) — these stay on the private archive line pending owner decisions D2/D3/D4.
