# M40 — MILESTONE 0: SAFE BASELINE RECOVERY (recorded)

> Date: 2026-11-25 · Branch: `feat/m40-real-hardware-capability-completion`
> All SHAs in this record were independently verified in this session by
> `git fetch --all --prune` + `git cat-file -t` + `git merge-base --is-ancestor`
> + `git ls-remote` — none were assumed from the milestone text.

## 1. Verified starting state

| Ref | SHA (verified) | Notes |
|---|---|---|
| `origin/main` | `eff0d9692572df5477ad295228c823efa462d531` | matches the M40 instruction's stated baseline exactly |
| M39.5 | `e856d571e60181fc98d0ea81b40eee6dbabe9092` | exists; `feat(m39.5)` corrective pass (WASM SIMD probe fix + honest lane dialog + M39 report) |
| M39.6 | `8f9c1fba42aae3f8d60e3ba3380078b014eeb2ca` | exists; `docs(m39.6)` publication record; is the HEAD of `origin/feat/m39-universal-live-ai-runtime` |

Ancestry facts (measured, not assumed):

- `git merge-base --is-ancestor e856d57… 8f9c1fba…` → **YES**: M39.6 descends from M39.5.
- M39.5 reachable from `origin/main` → **NO**. M39.6 reachable from `origin/main` → **NO**. Both statements match the instruction's premise ("not yet on that main baseline").
- `origin/feat/m39-universal-live-ai-runtime` vs `origin/main`: **2 ahead / 0 behind** (the two commits above). `origin/main` (`eff0d96`, the owner-authorized PR #19 merge) is therefore an ancestor of M39.6 — incorporation is a pure fast-forward.

Local checkout note (recorded honestly): the local `main` ref sat one commit ahead of `origin/main` (`ccabfcf`, an accidental container-authored commit titled with a UUID, pre-existing from an earlier session's auto-commit incident documented in the M36 worklog). It was NOT modified, per the instruction "Create the M40 feature branch without modifying `main`". The M40 branch was created from `origin/main` directly.

## 2. Actions taken (this session)

1. `git fetch --all --prune` — all remotes fetched, deleted remote-tracking branches pruned (13 remote branch heads listed, none dangling).
2. Created `feat/m40-real-hardware-capability-completion` at `origin/main` = `eff0d969…` (`git checkout -b … eff0d969…`). `main` untouched.
3. `git merge --ff-only origin/feat/m39-universal-live-ai-runtime` → fast-forward, **no conflicts, no cherry-picks, no history rewrite**: the working baseline now contains `eff0d96` + M39.5 (`e856d57`) + M39.6 (`8f9c1fba`). Diff carried by the FF: 8 files changed, 220 insertions(+), 7 deletions(-) (M39 report, SIMD regression tests, honest dialog wording, coverage addendum, phase plan, worklog).
4. Pushed the branch (normal fast-forward, new remote ref) and verified the remote SHA independently:
   `git ls-remote origin feat/m40-real-hardware-capability-completion` →
   **`8f9c1fba42aae3f8d60e3ba3380078b014eeb2ca`** (byte-identical to the local merged HEAD).

## 3. Exact working baseline (all included commits)

```
8f9c1fba42aae3f8d60e3ba3380078b014eeb2ca  docs(m39.6)  — publication record
e856d571e60181fc98d0ea81b40eee6dbabe9092  feat(m39.5)  — SIMD probe fix + honest lane dialog
eff0d9692572df5477ad295228c823efa462d531  Merge PR #19 (feat/m39-universal-live-ai-runtime)  ← origin/main
```

Every M40 submilestone builds on this baseline; no duplicate changes were
cherry-picked; `main` is not modified by M40 (merge requires separate owner
authorization).
