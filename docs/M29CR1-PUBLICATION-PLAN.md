# M29-CR.1 — Corrected Publication Plan (narrative)

Milestone: **M29-CR.1** · Date: 2026-11-22 (IST) · Status: **PREPARED, NOT EXECUTED — publication freeze active; every command requires the owner-side gates closed and the freeze lifted.**

Executable form: `M29CR1-PUBLICATION-PLAN.ps1` (Windows PowerShell 5.1 / PowerShell 7+, git for Windows). Supersedes `M29-PUBLICATION-PLAN.md` (M29-CR); the two documented ordinary pushes are unchanged in intent, corrected in syntax and SHAs.

## 0. Recorded remote state (verified `git ls-remote`, twice this audit)

| Ref | Remote SHA |
|---|---|
| `refs/heads/main` (default) | `91a68090ef72f71f52797bd88f9b83831fbeb997` |
| `refs/heads/feat/laxii-jazmii-restoration` | `e7d7003f36896b3ceaf07cde74d36275989469c1` |
| `refs/heads/feat/m26-2-media-capabilities` | `8f61599271b1aa66e86a2c4956f6dc01eef8b737` |
| `refs/heads/fix/laxii-image-output-ux` | `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064` |
| `refs/heads/main-sanitized` | **absent** (Step 2 precondition) |

## 1. The two documented ordinary pushes (READY — gated on freeze lift + owner gates)

### Step 1 — Fast-forward `fix/laxii-image-output-ux`: `18c93ed…` → `e96d83a…`

Pure fast-forward: **parent 1 of `e96d83a` is exactly `18c93ed`** (re-verified this audit: `git log -1 --format=%P e96d83a` → `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064 8f61599…`). Ordinary push; no force; no history rewrite.

```powershell
git push origin "e96d83a5196f45712350aaf41d13a1e5dfcebae7:refs/heads/fix/laxii-image-output-ux"
```

Effect: the PR #4 conflict set (`.gitignore`, `src/components/bean/laxii.tsx`) is delivered by the reconciliation merge itself; head `8f61599` becomes fully contained in the new base, so PR #4 recomputes clean. PR heads of #6/#7 (same branch) move to `e96d83a` automatically; they remain lineage-blocked against their old-history bases.

### Step 2 — Create `main-sanitized` at the LIVE integration tip

Ordinary push creating a new ref; no force; no history change. The SHA is read from the local branch immediately before pushing — **never a hardcoded stale SHA** (the M29-CR plan's Option B hardcoded `8e5c2ea`, which the amend had already superseded; corrected).

```powershell
# resolve the tip at execution time (at this audit: 1465cbb600775d68ae45e91eab0f2a45f364ca8e)
$tip = (git rev-parse reconcile/sanitized-m27-m28-migration).Trim()
git push origin "${tip}:refs/heads/main-sanitized"
```

Effect: publishes the sanitized integration line including every local-only sanitized commit (SAN-UNPUBLISHED bucket, 14 rows at audit time — grows by one per docs commit, hence the dynamic resolution).

### Step 3 — Verify every remote SHA

```powershell
git ls-remote origin
```

Expected: `fix/laxii-image-output-ux` = `e96d83a…`; `main-sanitized` = the resolved `$tip`; `feat/m26-2-media-capabilities` and `main` unchanged. The .ps1 performs this comparison programmatically and aborts on any mismatch.

## 2. QUARANTINED — main replacement (never part of the ordinary-push plan)

The sanitized line is **not** a descendant of old public `main` (merge-base `cafdb68`; proven). No fast-forward can move remote `main`; any update to it is a history-meaning change.

- **Recommended path (no force at all)**: GitHub → Settings → Branches → set default branch to `main-sanitized`. Old `main` stays as the read-only archive until the owner deletes/renames it after collaborator notification is complete.
- **Guarded swap (only with separate recorded owner authorization AFTER all gates close)**:

```powershell
# QUARANTINED — the .ps1 refuses this unless M29CR1_ALLOW_MAIN_SWAP=1 is set explicitly.
git push --force-with-lease="refs/heads/main:91a68090ef72f71f52797bd88f9b83831fbeb997" origin "${tip}:refs/heads/main"
```

The lease anchors to the exact recorded old-main SHA, so the command fails safely if `main` has moved. Never runnable during the freeze.

## 3. Acknowledgment gates in the corrected script

| Gate | Enables | Owner affirmation required |
|---|---|---|
| `M29CR1_GATES_CLOSED = 1` | Steps 1–3 | M26.1.3 recovery confirmation closed; collaborator notification done; credential confirmation (M26.1.4 §4) done; publication freeze lifted |
| `M29CR1_ALLOW_MAIN_SWAP = 1` | Step 4 only | Separate authorization to change the meaning of `refs/heads/main` |

Without the first gate the script prints the outstanding blockers and executes nothing.

## 4. Preflight additions over the M29-CR plan

1. Local: tip's parent-1 must be `e96d83a…` (FF precondition); tip must contain the verified application tree `d2c232a`; remote `fix/laxii-image-output-ux` must still be at `18c93ed…`.
2. Lineage guard: `git merge-base <tip> origin/main` must equal `cafdb68…` — aborts if any old unsanitized history has crept into the sanitized line since this audit.
3. Remote: all recorded SHAs must match; `main-sanitized` must be absent.

## 5. What this plan does not do

No history rewrite on any existing ref, no force during the freeze, no remote branch deletion, no PR merge/closure by automation, no publication of excluded material (G8/G9/G10 commits, credential-forensics docs, WIP snapshots with cookie/login artifacts), no bypass of the three owner-side gates, no claim of remote publication.
