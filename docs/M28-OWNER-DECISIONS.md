# M28-SLM — Owner Decision Register

Milestone: **M28-SLM** · Date: 2026-11-21 · Scope: **actual unresolved decisions only**. Nothing below was decided silently. The recommended direction (sanitized lineage as the integration line) is stated but explicitly left as the owner's call.

## D1 — Disposition of the old public lineage  **DECISION REQUIRED**

Local `main` (`6f0a2b0`) is a continuation of the old public lineage (it descends from `a0148628`, the previously verified public main) and carries every approved milestone (Trust, JAZMII, M27, M28) as original objects, including the historical sensitive content in old M26/M26.1 objects. The sanitized lineage (`4d134c5` → `e96d83a`) carries the same pre-M26 content in rewritten form but none of the milestone work yet.

- **Recommended direction:** keep the sanitized lineage as the only publication line (migrate G1–G8 content onto `e96d83a` per the manifest), and keep the old-line refs only as local recovery material until the February 2027 publication.
- **Open sub-decisions:** (a) retain or eventually delete old-line branches (`main`, `m26-audit`, `m26-release`, `m261-security-closure`, milestone branches) once migration lands — deletion is prohibited during this milestone; (b) whether `origin/main` (old line) is eventually replaced by a sanitized publication (a remote action, gated by the publication freeze and owner gates).
- **Not decided here.** No old-line ref was touched.

## D2 — WIP auto-commit snapshot migration (G9)  **DECISION REQUIRED**

Seven WIP auto-commits (`6d72f15`, `b85ba9c`, `d2e2dbd`, `4accc6d`, `d15b3af`, `f9d0e33`, `c472668`) plus the main-tip snapshot `6f0a2b0` (7 UI-evidence PNGs) carry ~10.6k lines of M26.1.4/M26.1.5-R2/PR1 recovery records, bundle-creation scripts, a publish-scan script and evidence images. They are ancestors of `826bf8c`, so their content is part of the old-line tree but is **not** part of any named commit's diff — if only named commits are transplanted, this content is lost.

Options: (a) migrate selected files (M26.1.5-R2 recovery records and scripts are operationally valuable — recommended); (b) migrate all; (c) leave on the old line only. Scan status: no real-key-shaped values found in any of them (`sk-disposable` fixture vocabulary only), except the credential-forensics docs handled separately in D3.

## D3 — Credential-forensics WIP docs (G10)  **DECISION REQUIRED (sign-off)**

`b85ba9c` (`M26_1_4_CREDENTIAL_INVESTIGATION.md` + analyzer script) and `d2e2dbd` (`M26_1_4_CREDENTIAL_REMEDIATION.md` + surface-inventory script) document the M26.2-era credential investigation. Pattern scan: 8 hits, **all** the documented `sk-disposable-<uuid>` fixture vocabulary; zero real-key-shaped values. Because the content is credential-adjacent by design, migration requires explicit owner sign-off even though the scan is clean. Recommended: migrate after sign-off (they are the provenance record for the credential question the owner must still answer in the M26.1.4 checklist §4).

## D4 — `refs/backup/scratch-bf47b8c` disposition  **DECISION REQUIRED**

Scratch ref → `bf47b8c1cacf70170e7f19d86dfa2693892a9af4` (2026-11-14 auto-commit), descending from `6a84481` (the PR #2 base side). It is **not** an ancestor of either main lineage — an orphaned snapshot line. Untouched in this milestone (deletion prohibited). Owner decides: keep as historical recovery material (recommended, zero cost) or remove in a later authorized cleanup.

## D5 — Old-line SHA references inside migrated documentation  **DECISION REQUIRED (policy)**

The February 2027 docs and M26.1.2–4 recovery records cite old-line SHA values (`4114371`, `aba5d4b`, `19a04e9`, `4d134c5`, bundle SHA-256s). After migration these SHAs describe commits that will not exist on the sanitized publication line. Recommended: keep verbatim as historical records (they describe the rewrite process itself, which the sanitized line inherits by reference, not by ancestry). Alternative: add a provenance note per document during migration.

## D6 — `feat/gangzii-audio-production` branch name  **DECISION OPTIONAL**

The branch points at `e983c41` (trust specialist coverage), not at `ae41561` (the actual GANGZII audio engine). M27/M28 work lives on `main` + `feat/m28-audio-reliability-quality`. No action taken under the freeze. Owner may re-point or rename in a later authorized cleanup to avoid future confusion.

## D7 — Remote PR #4 fate at publication time  **DECISION REQUIRED (later, gated)**

Remote `refs/pull/4/head` = `8f61599` (open, untouched). The local reconciliation `e96d83a` supersedes it on the sanitized line. When publication resumes, the owner decides whether the sanitized line replaces the remote PR flow entirely (recommended) or whether PR #4 is closed with a pointer note. No remote action now.

## Explicitly recorded non-decisions

- This milestone does **not** declare the old public lineage abandoned or retained — D1 remains open.
- No ref, bundle, branch or backup was deleted, recreated, overwritten or moved except the two worktree actions recorded in M28-SLM-PRESERVATION-REPORT.md (relocation of an at-risk worktree; creation of the planning worktree).
- No remote operation was performed other than read-only `git ls-remote` verification (twice).
