# M29-CR.1 — Corrected Commit Arithmetic & Publication-Readiness Report

Milestone: **M29-CR.1** · Date: 2026-11-22 (IST) · Authorization: owner instruction "M29-CR.1 — Final Commit Arithmetic Audit and Publication Readiness Correction" (2026-11-22) · Remote operations: **NONE — publication freeze respected; no push, no merge, no rewrite, no force, no deletion.**

Supersedes §1–§2 (arithmetic) and Step-2/Option-B SHAs (publication plan) of `M29-COMMIT-RECOVERY-REPORT.md`. All findings below are proven from the actual Git objects by the scripts listed in §8; nothing is inferred from the prior report's claims.

## 1. Root cause of the 498 vs 434 discrepancy — fully resolved, 0 unaccounted

The M29-CR report contained **two different partitions of the same commit universe** and published only one of them:

- **§2 of the M29-CR report** ("the owner's five counts") = `227 + 13 + 158 + 24 + 12 = 434`. These five categories covered (a) all commits on the sanitized line and (b) only those old-side commits that are *patch-equivalent, migrated, or excluded*. They **omitted four buckets of old-side commits that the same report's §3 row-by-row table does classify**: CONTENT REPRESENTED (12), SUPERSEDED (1), WIP SNAPSHOT (46), STRUCTURAL MERGE (5) — together **exactly 64 commits**. `434 + 64 = 498`. The discrepancy is a roll-up omission in the report prose, **not** a set of unaccounted commits: all 64 were already correctly classified row-by-row in the reconciliation table.
- Independently, the "498" headline was itself a stale snapshot: it was computed while the archive line's `main` sat at `bf0e62b`. The workspace auto-committer subsequently added `d88a031` and `d477902` (preservation snapshots on the archive line only). At this audit's snapshot (`main` @ `d477902`) the true all-refs universe is **500** (`git rev-list --all --count`, re-run this audit).

## 2. Corrected commit arithmetic — equals exactly 500 (= 498 + 2 post-report archive snapshots)

Proven set arithmetic (`scripts/m29cr1_set_arithmetic.py`): sanitized-reachable set |S| = 241, old-side-reachable |O| = 278, **overlap |S∩O| = 19** (pre-split root below fork point `cafdb68` — the prior report's "sets are disjoint by construction" was wrong), universe |S∪O| = **500** = `git rev-list --all`.

Corrected table (`M29CR1-COMMIT-RECONCILIATION-TABLE-500.md`, 500 rows, one primary disposition per commit):

| # | Disposition | Rows | Maps to owner category |
|---|---|---|---|
| 1 | SAN-PUBLISHED — sanitized-only, already on GitHub | 208 | Cat 1 (227) minus the 19 shared-root |
| 2 | SHARED-ROOT — pre-split root in both lineages | 19 | Cat 1 (part of the 227) |
| 3 | SAN-UNPUBLISHED — local-only sanitized | 14 | Cat 2 (13 as published + `1465cbb` added by the amend) |
| 4 | OLD-MIGRATED (manifest G1–G7) | 24 | Cat 4 |
| 5 | OLD-PATCH-EQUIVALENT | 157 | Cat 3 |
| 6 | OLD-PATCH-DUPLICATE | 1 | Cat 3 (158th member) |
| 7 | OLD-REPRESENTED (sensitive artifacts excluded) | 12 | **omitted from §2** (§3 bucket 4) |
| 8 | OLD-SUPERSEDED | 1 | **omitted from §2** (§3 bucket 5) |
| 9 | OLD-WIP-SNAPSHOT | 46 | **omitted from §2** (§3 bucket 6) |
| 10 | OLD-MERGE (structural) | 5 | **omitted from §2** (§3 bucket 7) |
| 11 | OLD-EXCLUDED (manifest G8/G9/G10) | 12 | Cat 5 |
| 12 | OLD-PRESERVATION-AUTO (post-report archive snapshot) | 1 | new: `d477902`, created after the M29-CR table was generated |
| | **TOTAL** | **500** | `git rev-list --all` = 500 — 0 unaccounted |

Sanity identities (all verified): `227 + 14 = 241 = |S|`; `158 + 24 + 12 + 1 + 46 + 5 + 12 + 1 = 259 = |O − S|`; `208 + 19 = 227 = |S ∩ Cat1|`; `222 + 259 + 19 = 500`; at the prior report's moment `main@bf0e62b`: `241 + 276 − 19 = 498` ✓; at the M29-CR table's moment `main@d88a031`: old-only = 258 = its row count ✓.

## 3. What this audit independently re-proved (not inherited)

1. **Universe count**: `git rev-list --all` = 500 across 40 refs; `git log --all` agrees; sets S/O/overlap computed from `git rev-list` per ref, not from any report.
2. **Patch-id verification**: recomputed `git patch-id --stable` for **all 259 old-only and all 241 sanitized-reachable commits**. Exactly 157 old-only commits have a sanitized twin — matching the published count; **157/157 published twin-claims recomputed without a single failure**. The patch-duplicate claim re-proven: `2bf9f7b` ≡ `b1a21c2`, both patch-id `f4efa906d11ac3af8286f36a970b44e88debb0c4`.
3. **Structural merges**: 5 old-side merge objects have no patch-id and 2 parents each (`443b6f2f`, `ea1e074d`, `3ec83650`, `91a68090`, `e7d7003f`) — content-via-parents classification is structurally forced, not judged.
4. **Empty commits**: 10 old-side commits have tree == parent tree (no patch-id) — all sit in WIP SNAPSHOT rows of the published table.
5. **Manifest completeness**: sweep re-run — 314 manifest paths: G1–G7 = **225/225 present** in the integration tree, 0 missing; G8/G9/G10 = 89 paths intentionally absent; 41 distinct product-code paths missing are each explained (quarantined other-stream WIP; giftz UI-selection surface removal enforced by `tests/unit/giftz-ui-restriction.test.ts`); **0 runtime/credential artifacts** in the tree.
6. **Lineage isolation**: none of `91a6809`, `a014862`, `6f0a2b0`, `e7d7003` is an ancestor of the integration tip; the deepest connection between the two lines is exactly merge-base `cafdb68` on both sides.
7. **PR #4 fast-forward**: parent 1 of `e96d83a` is exactly `18c93ed` (`parent1=18c93ed7b1e433bb1c06c0a803d5adff0dcaf064 8f61599…`) — pure fast-forward, no force needed.
8. **Preservation**: all 40 refs verified present (24 backup refs incl. `backup/m29-pre-g1…g7`, `backup/pr4-base-18c93ed`, `backup/pr4-head-8f61599`, `refs/backup/scratch-bf47b8c`); 3 worktrees intact; `recovery/m29/bean-m29-postmigration-allrefs-20261122.bundle` intact (SHA-256 `fb378343…` recorded at creation).
9. **Table integrity**: the published 258-row table parses to 258 unique SHAs, all real objects, all inside the old-only set, no duplicates; exactly one old-only commit (`d477902`) post-dates it.

## 4. Corrections to the M29-CR report (errors found by this audit)

| # | Prior claim | Correction (proven) |
|---|---|---|
| 1 | "498 = 240 sanitized + 258 old-side, sets disjoint" | Sets are **not disjoint**: overlap = 19 shared-root commits. Correct current: \|S\| = 241, \|O\| = 278, union = 500. 498 was valid only at the earlier `main@bf0e62b` moment (241 + 276 − 19). The "240 + 258" figure mixed two different snapshots and double-counted the shared root while dropping one sanitized commit |
| 2 | "shared pre-split root = 10 commits" | The shared root is **19 commit objects** (10 distinct subjects — each auto-commit subject occurs as two commit objects; the "10" counted subjects, not commits) |
| 3 | "Category 2 = 13 commits" | Now **14**: the tip `1465cbb` (amend of the unreachable `9324e83`) was created after that count; `git rev-list reconcile/sanitized-m27-m28-migration ^origin/fix/laxii-image-output-ux ^origin/feat/m26-2-media-capabilities` = 14 |
| 4 | §2 five categories presented as complete accounting | They omitted §3 buckets 4–7 (12 + 1 + 46 + 5 = 64) — the direct cause of the owner-visible 434 vs 498 gap |
| 5 | §6 summary: "new branch push main-sanitized → 8e5c2ea" | Stale. The plan document itself already used `1465cbb`; Option B's guarded main-swap still hardcoded `8e5c2ea` — corrected to the live integration SHA in the corrected plan (§6 below) |
| 6 | §1 "final tip 1465cbb" + "docs-only commits after the battery: 73a46e1, 8e5c2ea, 9324e83, 1465cbb" | `9324e83` is an **unreachable amended-away object** (not reachable from any ref); it is not part of the universe and was correctly excluded from `rev-list --all`, but listing it alongside real docs commits is misleading |

No classification in the 258-row reconciliation table was found wrong. One old-only commit was missing from it (`d477902`) — now row 500 of the corrected table.

## 5. Verified sanitized integration (Part B)

| Check | Result |
|---|---|
| Branch tip | `reconcile/sanitized-m27-m28-migration` = `1465cbb600775d68ae45e91eab0f2a45f364ca8e` |
| Application tree | identical to verified `d2c232a` for all non-`docs/` paths (diff empty outside `docs/`); docs-only commits after the battery: `73a46e1`, `8e5c2ea`, `1465cbb` |
| G1–G7 functionality | 225/225 manifest file paths present; migration_results groups G1–G7 all "Migrated + verified" with destination commits `953c752`, `75ef989`, `b429132`, `30c14a4`, `b8a4427`, `a0d52b2`, `9303a56` (+ G5 test-surface fix `d2c232a`) |
| PR #4 reconciliation preserved | `e96d83a` in ancestry; three-way tree integrity over 80 touched paths PASS (M29 evidence, unchanged); lightbox + edit-history both mounted |
| Excluded artifacts | 0 cookie/session/login/verify.db/.pid artifacts in tree; the only "credential"-named files are legitimate handling/inspection code (`src/lib/providers/credentials.ts`, `src/lib/security/provider-credentials.ts`, `scripts/bean-credential-surface-probe.ts`, `scripts/m261/inspect-history-credentials.ts` — no values, verified by read) |
| Old unsanitized ancestry | none (§3 item 6); old history confined to archive line + 19 shared pre-split root objects |
| Backup refs & branches | all 40 refs present; bundles intact; WIP/branches untouched |
| Test battery | 2445/0 (2450 incl. 5 honest skips) at `d2c232a` app tree — tree unchanged since; no re-run required, no new application commits exist |

## 6. Corrected publication plan (Part C)

`M29CR1-PUBLICATION-PLAN.ps1` (executable, PowerShell 5.1+/7+) + narrative in `docs/M29CR1-PUBLICATION-PLAN.md`. Corrections applied to the M29-CR plan:

1. **PowerShell syntax**: the push commands used a backtick-escape before the refspec colon (`e96d83a…`:refs/heads/…`). It happens to expand correctly, but is fragile and breaks on copy-paste; all refspecs are now double-quoted (`git push origin "SHA:refs/heads/NAME"`), which is unambiguous in PS 5.1+ and PS 7+.
2. **Stale SHA removed**: Option B (guarded main-swap) pushed `8e5c2ea`; corrected to the **actual current integration tip** (`1465cbb…`), and the script takes the tip dynamically (`git rev-parse`) with abort-on-mismatch, so no future docs commit can make the script stale.
3. **New-branch precondition check**: preflight now fails if `refs/heads/main-sanitized` already exists remotely (Step 2 assumes absence).
4. **Local-side preflight added**: verifies FF parent-1 relation for Step 1, verifies the sanitized tip contains `e96d83a` and `d2c232a`, and verifies old-`main` is NOT an ancestor (lineage guard).
5. **Main-replacement quarantined**: Step 4 / Option B is fenced behind a `M29CR1_ALLOW_MAIN_SWAP` environment variable that the script explicitly refuses to honor during the freeze, with a printed warning; `--force-with-lease` is anchored to `91a6809…` exactly as before (still requires separate owner authorization after gates).
6. **Exact branch names**: Step 1 pushes to `refs/heads/fix/laxii-image-output-ux` (existing); Step 2 creates `refs/heads/main-sanitized` (new). Nothing else is touched.
7. **Post-push verification scripted**: `git ls-remote` compared against the expected table, including "unchanged" assertions for `main` and `feat/m26-2-media-capabilities`.

Validated facts used by the plan: FF `18c93ed → e96d83a` (parent-1 proven, §3 item 7); remote state matches the recorded table (verified twice this session via `ls-remote`); PR #4/#6/#7 share branch `fix/laxii-image-output-ux`, so Step 1 moves all three heads simultaneously; PR #4 head `8f61599` is parent 2 of `e96d83a`, hence fully contained after Step 1.

## 7. Remaining owner-side blockers (Part D) — none closed, none bypassed

1. M26.1.3 recovery-confirmation gate — **open**.
2. Collaborator notification — **open**.
3. Credential confirmation (M26.1.4 checklist §4) — **open**.
4. Publication freeze lift — **owner action**.
5. Owner decisions: D2 (G9 WIP snapshots), D3 (G10 credential-forensics sign-off), D4 (scratch-ref disposition), D7 (PR #4 close-as-merged vs sanitized-flow replacement) — **all open**.
6. Evidence of gate closure: none observed remotely or locally this audit; remote state matches the pre-freeze record exactly.

## 8. Readiness statement (Part E.6)

**The repository is READY for the two documented ordinary pushes — and for nothing beyond them.**

- Push 1: `git push origin "e96d83a…:refs/heads/fix/laxii-image-output-ux"` — a pure fast-forward (parent-1 proven); ordinary push, no force.
- Push 2: `git push origin "reconcile/sanitized-m27-m28-migration:refs/heads/main-sanitized"` — creation of a new ref; ordinary push, no force, no history change.
- Both pushes publish only sanitized-lineage content (0 old-side commits reachable from either pushed SHA beyond the 19 shared pre-split root objects, which are byte-identical in both lines).
- **They must not be executed now**: the freeze is active and the three owner gates (§7 items 1–3) remain outstanding without independent evidence of closure. Execution is authorized the moment the owner lifts the freeze and closes those gates — the corrected script performs full preflight and aborts on any drift.
- Anything touching `refs/heads/main` (default-branch change or guarded swap) is **not** part of the ready set and remains separately gated.

## 9. Reproducibility

All arithmetic and classifications regenerate from committed scripts:

- `scripts/m29cr1_set_arithmetic.py` — S/O/overlap/universe, ancestry guards
- `scripts/m29cr1_verify_table.py` — published-table verification + full patch-id recomputation
- `scripts/m29cr1_build_table.py` — corrected 500-row table + CSV
- `scripts/m29cr_completeness_sweep.py` — manifest path presence (unchanged, re-run)
- Machine-readable sets/results: `scripts/m29cr1_sets.json`, `scripts/m29cr1_table_verify.json`

Note: the universe is a live object count. Docs commits added after this snapshot (including this report's own commit) extend the SAN-UNPUBLISHED bucket by one row each; the totals identity (every reachable commit exactly one disposition) always re-verifies with `scripts/m29cr1_set_arithmetic.py` + `scripts/m29cr1_build_table.py`. No application tree change results from any of these commits.
