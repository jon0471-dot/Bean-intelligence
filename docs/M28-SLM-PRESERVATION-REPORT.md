# M28-SLM — Preservation Report

Milestone: **M28-SLM** · Date: 2026-11-21 · All statements below were verified by direct inspection at the time of writing.

## 1. Branches preserved (untouched)

All 23 local branches and 4 remote-tracking branches listed in M28-SANITIZED-LINEAGE-MAP.md §5 are byte-identical to their pre-milestone state. One branch was **created**: `reconcile/sanitized-m27-m28-migration` (at `e96d83a`, ancestry verified first). No branch was deleted, renamed, re-pointed or merged.

## 2. Backup refs preserved (untouched)

14 `backup/*` branches — including the four PR #4 guards `backup/pr4-base-18c93ed` (`18c93ed`), `backup/pr4-head-8f61599` (`8f61599`), `backup/m262-media-capabilities` (`8f61599`), `backup/m263-image-output-ux` (`18c93ed`) — plus the custom namespace ref `refs/backup/scratch-bf47b8c` (`bf47b8c`). None recreated or overwritten; `e96d83a` and both PR #4 parents remain exactly as reported.

## 3. Recovery bundles

**Historical bundles: MISSING (pre-existing condition).** `M26_1_5_RECOVERY_TRANSFER.md` records the M26.1.5-R2 loss: the encrypted pre-rewrite bundle (`recovery/bean-pre-rewrite-m2613.bundle.enc`, 64,949,186 B), its plaintext twin (SHA-256 `c8a4a057…`), and all eight `wip-refs` backup bundles — none found on the filesystem today. The **branch objects those bundles backed are still present locally** (the `backup/*` branches), so no content is lost — but the documented off-repo recovery copies no longer exist.

**New preservation bundle created this milestone** (local artifact, not committed to any branch, not pushed):

| Property | Value |
|---|---|
| Path | `recovery/m28slm/bean-m28slm-allrefs-20261121.bundle` |
| Contents | `--all`: every local branch, backup ref, remote-tracking ref, both worktree HEADs at creation time |
| Size | 224,406,312 bytes |
| SHA-256 | `1b4d321b043c4c54ee5f4e64a6d803292aabc6fcb4e93358539022ef23d48e5d` (sidecar `.sha256` written) |
| Verify | `git bundle verify` → "The bundle records a complete history" |
| Captures | old line tip `6f0a2b0`, sanitized tip `e96d83a`, all milestone tips, all backup refs — i.e. both lineages and every recovery ref in one artifact |

Note: the bundle was taken **before** the docs-only inventory commit on the planning branch; it preserves the exact pre-inventory state of both lineages.

## 4. Worktrees

| Worktree | Action this milestone | Rationale |
|---|---|---|
| `/home/z/my-project` (`main` @ `6f0a2b0`) | Untouched; status clean before and after | Main working tree must not be modified |
| `/tmp/m28-reconcile-wt` (`reconcile/pr4-m262-into-m263` @ `e96d83a`) | **Relocated** via `git worktree move` to `/home/z/my-project/worktrees/pr4-reconcile` | The PR #4 reconciliation checkout lived in `/tmp`, which is subject to workspace recycling — the same class of incident that destroyed the M26.1.5-R2 recovery material. Branch and HEAD unchanged. |
| `/home/z/my-project/worktrees/m28-slm` | **Created** (`git worktree add -b reconcile/sanitized-m27-m28-migration`) | Dedicated isolated migration workspace; base `e96d83a` verified sanitized before creation |
| `.git/info/exclude` | Appended local-only entries (`/worktrees/`, analysis artifacts) | Keeps `git status` clean without touching tracked files; `.git/info/exclude` is not versioned content |

`worktrees/` remains git-excluded, so the nested worktrees do not pollute the main worktree's status.

## 5. Remote refs — unchanged, independently verified

`git ls-remote origin` (read-only) executed twice during this milestone; both runs returned identical results, and every value matches the local remote-tracking refs:

```
91a68090ef72f71f52797bd88f9b83831fbeb997  HEAD / refs/heads/main
e7d7003f36896b3ceaf07cde74d36275989469c1  refs/heads/feat/laxii-jazmii-restoration
8f61599271b1aa66e86a2c4956f6dc01eef8b737  refs/heads/feat/m26-2-media-capabilities
18c93ed7b1e433bb1c06c0a803d5adff0dcaf064  refs/heads/fix/laxii-image-output-ux
refs/pull/1/head=8f61599  refs/pull/2/head=a0148628…  refs/pull/3/head=3ec8365…
refs/pull/4/head=8f61599  refs/pull/5/head=91a6809…  refs/pull/6/head=18c93ed…
```

No push, no fetch (remote-tracking refs untouched), no ref update of any kind.

## 6. WIP and uncommitted state

- Main worktree: clean before this milestone (`git status --porcelain -uall` = 0 lines) and clean after; no stash entries exist.
- PR4-reconcile worktree: clean (0 lines).
- Analysis artifacts produced this milestone are deliberately untracked and locally excluded: `scripts/m28slm_inventory.py`, `scripts/m28slm_emit.py`, `scripts/m28slm_splice.py`, `scripts/m28slm-out/` (captured evidence JSON), `recovery/m28slm/`.

## 7. Filesystem artifacts at risk of workspace recycling

| Artifact | Risk | Status |
|---|---|---|
| Historical recovery bundles (`recovery/*` documented in M26_1_5 docs) | **Already lost** to the earlier recycle | Documented missing; replacement bundle created (§3) |
| `/tmp/m28-reconcile-wt` | Was in `/tmp` (recycle-prone) | Resolved — relocated to `worktrees/pr4-reconcile` |
| New bundle under `recovery/m28slm/` | Lives inside the workspace (survives app-recycle, not disk loss) | Owner should copy `recovery/m28slm/` off-machine (the M26.1.5 lesson: a second copy outside the recycled scope is required) |
| `.git/git-credentials` (local credential store) | Present in `.git/`; never versioned, never published | Left untouched; **do not** copy into any bundle artifact that leaves the machine |
| `.git/filter-repo/` state | Evidence of the M26.1.1 rewrite tooling | Untouched |
| `/home/z/{pyproject.toml, uv.lock, node_modules}` | Outside the repo, recycle-prone | Not repo content; informational |

## 8. Freeze compliance

No push, no PR merge, no history rewrite, no force-push, no remote ref update, no branch/backup/bundle deletion, no old-lineage modification, no gate bypass. The only repository mutations were: creation of the planning branch + worktree, relocation of the at-risk worktree, the docs-only inventory commit on the planning branch, and the new local bundle — all recorded above.
