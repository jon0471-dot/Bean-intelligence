# M28-SLM — Owner Decision Register

Milestone: **M28-SLM** · Date: 2026-11-21 · Scope: **actual unresolved decisions only**. Nothing below was decided silently. The recommended direction (sanitized lineage as the integration line) is stated but explicitly left as the owner's call.

## D1 — Disposition of the old public lineage  **RESOLVED (owner approval, 2026-11-21)**

The owner explicitly approved making the sanitized Git lineage the canonical future BEAN
Intelligence development history, with the old public lineage preserved as a private,
read-only historical archive (M29 authorization, 21 November 2026). Execution record:

- The sanitized lineage is the integration line: G1–G7 were migrated onto
  `e96d83a` on `reconcile/sanitized-m27-m28-migration` (destination head `d2c232a`).
- The old lineage is retained read-only: every old-line branch, backup ref, recovery
  manifest and bundle preserved untouched; no new development on old-line branches;
  no old refs deleted; no history rewritten.
- Sub-decision (a): old-line branch RETENTION — resolved as "preserve" (deletion remains
  prohibited; any future cleanup needs separate authorization).
- Sub-decision (b): remote publication of the sanitized line — remains GATED by the
  publication freeze and the outstanding owner gates (M26.1.3 recovery,
  collaborator notification, credential confirmation). Nothing was pushed.

## D2 — WIP auto-commit snapshot migration (G9)  **DECISION REQUIRED**

Seven WIP auto-commits (`6d72f15`, `b85ba9c`, `d2e2dbd`, `4accc6d`, `d15b3af`, `f9d0e33`, `c472668`) plus the main-tip snapshot `6f0a2b0` (7 UI-evidence PNGs) carry ~10.6k lines of M26.1.4/M26.1.5-R2/PR1 recovery records, bundle-creation scripts, a publish-scan script and evidence images. They are ancestors of `826bf8c`, so their content is part of the old-line tree but is **not** part of any named commit's diff — if only named commits are transplanted, this content is lost.

Options: (a) migrate selected files (M26.1.5-R2 recovery records and scripts are operationally valuable — recommended); (b) migrate all; (c) leave on the old line only. Scan status: no real-key-shaped values found in any of them (`sk-disposable` fixture vocabulary only), except the credential-forensics docs handled separately in D3.

## D3 — Credential-forensics WIP docs (G10)  **DECISION REQUIRED (sign-off)**

`b85ba9c` (`M26_1_4_CREDENTIAL_INVESTIGATION.md` + analyzer script) and `d2e2dbd` (`M26_1_4_CREDENTIAL_REMEDIATION.md` + surface-inventory script) document the M26.2-era credential investigation. Pattern scan: 8 hits, **all** the documented `sk-disposable-<uuid>` fixture vocabulary; zero real-key-shaped values. Because the content is credential-adjacent by design, migration requires explicit owner sign-off even though the scan is clean. Recommended: migrate after sign-off (they are the provenance record for the credential question the owner must still answer in the M26.1.4 checklist §4).

## D4 — `refs/backup/scratch-bf47b8c` disposition  **DECISION REQUIRED**

Scratch ref → `bf47b8c1cacf70170e7f19d86dfa2693892a9af4` (2026-11-14 auto-commit), descending from `6a84481` (the PR #2 base side). It is **not** an ancestor of either main lineage — an orphaned snapshot line. Untouched in this milestone (deletion prohibited). Owner decides: keep as historical recovery material (recommended, zero cost) or remove in a later authorized cleanup.

## D5 — Old-line SHA references inside migrated documentation  **DECISION REQUIRED (policy)**

The February 2027 docs and M26.1.2–4 recovery records cite old-line SHA values (`4114371`, `aba5d4b`, `19a04e9`, `4d134c5`, bundle SHA-256s). After migration these SHAs describe commits that will not exist on the sanitized publication line. Recommended: keep verbatim as historical records (they describe the rewrite process itself, which the sanitized line inherits by reference, not by ancestry). Alternative: add a provenance note per document during migration.

## D6 — `feat/gangzii-audio-production` branch name  **RESOLVED (M29 inspection, 2026-11-21)**

Resolved by direct branch/commit/tree inspection during M29 (as required by the owner's
conditional resolution):

- Branch tip verified: `feat/gangzii-audio-production` → `e983c41b9393217508d9632fbeaadaaa6dc7acc6`
  (Trust specialist coverage — the M26.2-milestone trust work), NOT the M27 audio engine.
- `git merge-base --is-ancestor ae4156157348720fb74f68b26f1325089813f9cf
  feat/gangzii-audio-production` → FALSE: the branch is missing the actual M27
  implementation commit.
- The M27 implementation commit `ae41561` has parent `e983c41` and is preserved on the
  old-line `main` and `feat/m28-audio-reliability-quality` ancestry; backup refs and the
  M29 pre-migration bundle capture it.
- Migration action: M29 G6 migrated the verified M27 content from the ACTUAL source
  commit `ae41561` (never from the branch name). The branch pointer itself was left
  untouched (re-pointing is a ref update the owner may authorize separately; the
  anomaly is now documented here and in the commit record).

## D7 — Remote PR #4 fate at publication time  **DECISION REQUIRED (later, gated)**

Remote `refs/pull/4/head` = `8f61599` (open, untouched). The local reconciliation `e96d83a` supersedes it on the sanitized line. When publication resumes, the owner decides whether the sanitized line replaces the remote PR flow entirely (recommended) or whether PR #4 is closed with a pointer note. No remote action now.

## Explicitly recorded non-decisions

- This milestone does **not** declare the old public lineage abandoned or retained — D1 remains open.
- No ref, bundle, branch or backup was deleted, recreated, overwritten or moved except the two worktree actions recorded in M28-SLM-PRESERVATION-REPORT.md (relocation of an at-risk worktree; creation of the planning worktree).
- No remote operation was performed other than read-only `git ls-remote` verification (twice).
