# M28-SLM — Sanitized Lineage Map

Milestone: **M28-SLM** · Date: 2026-11-21 · Publication status: **FROZEN** · History rewrite: **NOT authorized** · Remote modification: **PROHIBITED**

Every SHA in this document was verified against actual Git objects in `jon0471-dot/Bean-intelligence` (local repo at `/home/z/my-project`). No SHA was inferred from a commit message alone; all ancestry claims were tested with `git merge-base --is-ancestor`.

## 1. Verified refs (reported → exact)

| Reported ref | Exact SHA | Exists | Verified role |
|---|---|---|---|
| `4d134c5794cfe92ff7c8e477f536075e7c8bffb0` | `4d134c5794cfe92ff7c8e477f536075e7c8bffb0` | Yes | Sanitized baseline tip (`docs(m26.1.1)` history-sanitization results). Ancestor of the PR #4 reconciliation; **not** an ancestor of local `main` or `origin/main`. |
| `e96d83a5196f45712350aaf41d13a1e5dfcebae7` | `e96d83a5196f45712350aaf41d13a1e5dfcebae7` | Yes | Locally reconciled PR #4 merge. Short SHA is unique (1 object). Tip of `reconcile/pr4-m262-into-m263`. |
| `a01486289149e0347b41d111c376b8a2b078ad80` | `a01486289149e0347b41d111c376b8a2b078ad80` | Yes | Old public verified main (`chore(m26.1)` quarantine generator). Merge base of local `main` and `origin/main`. |
| `91a6809` | `91a68090ef72f71f52797bd88f9b83831fbeb997` | Yes | Current remote `main` (`Merge pull request #3`). Short SHA unique. |
| `6f0a2b0` | `6f0a2b07d441b7a5ca3b98199d7b65932a8c4dd6` | Yes | Local `main` tip (WIP auto-commit `c6423191-…` on top of the M28 tip). Short SHA unique. |
| `e983c41` | `e983c41b9393217508d9632fbeaadaaa6dc7acc6` | Yes | Trust specialist coverage (M26.2 milestone on the old line). Tip of `feat/trust-specialist-coverage` **and** of `feat/gangzii-audio-production` (see §7 note). |
| `ae41561` | `ae4156157348720fb74f68b26f1325089813f9cf` | Yes | M27 GANGZII audio production engine. Parent: `e983c41`. |
| `88fa9b3` | `88fa9b3720387312ac066bfe069b495a263b4e3c` | Yes | M28 tip. Tip of `feat/m28-audio-reliability-quality`; contained in local `main`. |
| `8de0144` | `8de01444bba53d56c278d1a91eda9e9cd251a56a` | Yes | JAZMII Auto Director tip (sixth commit). Tip of `feat/jazmii-auto-director`. |

All short SHAs in the task brief were checked with `git rev-parse --disambiguate` — each resolves to exactly one object.

## 2. The two lineages

Both lineages descend from a **shared object-identical base** (the pre-rewrite history of the local verified workspace plus the official remote history, in rewritten form on the sanitized side and original form on the old side). The deepest commits that differ form rewrite pairs (same logical change, different objects).

### Merge bases (main vs sanitized)

`git merge-base --all main 4d134c5` returns **two** best common ancestors:

- `cafdb6826da9c4edcd62e2ead15d801869ae9c3a` — auto-commit `bffc86a5-185a-47e0-a042-f7ebba511c48`, parent `1157731`, tree `e74f2664…`
- `4d9a30bb15d320f82139673c039b75a7f4869205` — same subject, parent `51ea4b67`, tree `66d7ac81…` (twin of the above; trees differ by 2 tool-result scratch files)

The same pair is the merge base for every sanitized-vs-old comparison tested (`main`, `origin/main`, M27, M28, JAZMII tip vs `e96d83a`). Everything below these two commits is byte-identical in both lineages; everything above them exists in two forms.

### Sanitized lineage (target for migration)

```
(shared rewritten base: official-remote copy ff2b2f8 → … + local verified copy)
        │
   cafdb682 / 4d9a30bb   ← merge bases (shared tips)
        │
  78ba13bd  docs(m26): results report                          ┐
  6beabfd2  fix(m26.1): remove 7 session-token files           │ M26/M26.1
  828995f7  docs(m26.1): owner-action checklist                │ SANITIZED
  28269d75  docs(m26.1): per-file quarantine inventory         │ REWRITE
  aba5d4b9  chore(m26.1): quarantine inventory generator       │ (no originals)
  4d134c5   docs(m26.1.1): history sanitization results        ┘
        │
  5167c7b  feat(gangzii): wire the orphaned audio product      ┐
  7eb7912  feat(client-compute): browser AI inference core     │
  afe63c4  feat(ui): AI Device settings + on-device lanes      │ six AI
  2cb249b  test(client-compute): pin inference contracts       │ operationalization
  37f6f85  build+test: Turbopack OOM fix                       │ commits
  4114371  docs: six operationalization deliverables           ┘
        │
        ├─→ 9db41fe → 0330a6c → 18c93ed   (fix/laxii-image-output-ux, M26.3)
        └─→ 99b2470 → 8f61599             (feat/m26-2-media-capabilities, M26.2)
                    │
        e96d83a  MERGE  ← PR #4 local reconciliation  ★ migration base
```

Containment verified: `4d134c5` is an ancestor of `18c93ed`, of `8f61599`, and of `e96d83a`. `e96d83a` contains **none** of: `a0148628`, `91a6809`, `eb8d314`, `28e034d`, `9fc1591`, `77230c5`, `2bf9f7b`, `2a9b4cb`, `3a28bfe8`, `8de0144`, `e983c41`, `ae41561`, `88fa9b3` (each tested with `merge-base --is-ancestor` → false).

### Old public lineage (source of implementation content)

```
   cafdb682 / 4d9a30bb   ← shared tips
        │
  8cb93a9  docs(m26): results report                            ┐ original
  be2622d  fix(m26): remove 6 session-cookie jars               │ (unrewritten
  38700d2  docs(m26): reliability test plan                     │  objects with
  76e63af  fix(m26.1): remove 7 session-token files             │  historical
  601c90d  docs(m26.1): owner-action checklist                  │  sensitive
  6e4255c  docs(m26.1): per-file quarantine inventory           │  content)
  a014862  chore(m26.1): quarantine inventory generator         ┘ ← old verified public main
        │
  eb8d314  docs(m26.1.1): history sanitization results (old-line copy)
  28e034d  docs(m26.1.2): gate closure verdict C (rewrite clone lost)
  9fc1591  docs(m26.1.3): recovery reconstructed byte-identical (4d134c5 re-verified)
  77230c5  docs(m26.1.4): publication blocked pending owner gates
  6d72f15→c472668   WIP auto-commits (M26.1.4/PR1 recovery artifacts, ~10.5k lines)
        │
  6145578  docs(feb2027): completion report (presplit main)  ─┐
  b1a21c2  docs(feb2027): launch documentation set            │ two branches,
  826bf8c  feat(trust): Trust Engine foundation               │ merged:
  2bf9f7b  docs(feb2027): launch documentation set (twin)     │
        ├───────────────────────────────────────────────────┘
  ea1e074d  merge(trust): consolidate (parents 6145578 + 2bf9f7b)
        │
  7a64e18c  docs(feb2027): completion report
  2a9b4cb   feat(trust): Phase 1 — checkpoint resume + adapters
  e0254951  docs(m2615r2c): recovery re-delivery record
  3a28bfe8 → d2d6a4a3 → 91fb59cf → f91096e1 → 4ab7f036 → 8de0144   JAZMII Auto Director ×6
        │
  e983c41   feat(trust): specialist coverage (M26.2 milestone)
  ae41561   feat(gangzii): M27 audio production engine
  9a0a9f0d → 735ab853 → 02a35f48 → ba93dc73 → ce2dbb24 → 597daba7
          → 75db4182 → 4bdca0b9 → fcf0bf44 → fc7ee8bd → 88fa9b3   M28 ×11
        │
  6f0a2b0   local main tip (WIP auto-commit: 7 PNG evidence files)
```

Local `main` descends from `a0148628` (merge base of `main` vs `origin/main`), so **local main is an old-line continuation**, not a sanitized branch. `origin/main` = `91a6809` = `a0148628` + PR #2 merge (`3ec83650`, parents `6a84481` + `a014862`) + PR #3 merge (`91a6809`, parents `a014862` + `3ec83650`).

### Rewrite-pair structure (why both lines share the same pre-M26 content)

The M26.1.1 sanitization produced rewritten copies of the entire post-fork history — including a rewritten copy of the old official remote chain: `a705bdb → … → 443b6f2f` (originals, old line only) correspond to `ff2b2f8 → … → 87a8885f` (rewritten copies, sanitized line only). Verified: `ff2b2f8` is an ancestor of `4d134c5` and of `e96d83a` but **not** of local `main`; `443b6f2f` is an ancestor of `main` and of `origin/main` but not of the sanitized line. Consequence: the sanitized lineage is not "free of official-remote history" — it carries the **sanitized rewrite** of it. What it must never receive is the **original objects** (`a0148628` chain, `443b6f2f` chain, old M26.1.x chain, milestone originals).

## 3. PR #4 integration point (protected)

`e96d83a5196f45712350aaf41d13a1e5dfcebae7` — verified properties:

| Check | Result |
|---|---|
| Real merge commit | Yes — 2 parents |
| Parents exactly as reported | `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064` (M26.3, first) + `8f61599271b1aa66e86a2c4956f6dc01eef8b737` (M26.2, second) |
| Merge base of the two parents | `4114371` |
| Ancestry sanitized | Yes — contains `4d134c5`; clean of every old-line ref listed in §2 |
| M26.2-side content present | All 24 files added by `99b2470` exist in the merge tree |
| M26.3-side content present | All 13 files added by `0330a6c` exist in the merge tree |
| Conflict resolution | Semantic, per `.gitignore` union + `src/components/bean/laxii.tsx` dual imports (both `ImageLightbox` and `EditHistoryPanel` preserved) — recorded in the commit message |
| Verification record | Complete, in the commit message itself: 0 unresolved conflicts, bun.lock 83/83 consistent, prisma validate OK, TypeScript 0 src errors (3 pre-existing worker-file errors), unit suite 2227/0 (164 files), ESLint pre-existing vendored findings only, production build ✓, secret scan 5 hits all pre-existing disposable fixtures |
| Backup refs preserved | `backup/pr4-base-18c93ed` → `18c93ed`, `backup/pr4-head-8f61599` → `8f61599`, `backup/m262-media-capabilities` → `8f61599`, `backup/m263-image-output-ux` → `18c93ed` (all byte-identical to reported targets; untouched) |

The remote PR #4 (`refs/pull/4/head` = `8f61599`, head branch `feat/m26-2-media-capabilities`, base `fix/laxii-image-output-ux`) remains open and untouched on the remote; the local merge `e96d83a` is the sanitized-line equivalent and was never pushed.

## 4. Branch membership of key implementation tips

| Commit | Branches containing it |
|---|---|
| `88fa9b3` (M28) | `feat/m28-audio-reliability-quality`, `main` |
| `ae41561` (M27) | `main` (only) |
| `e983c41` (trust specialist) | `feat/trust-specialist-coverage`, `feat/gangzii-audio-production`, `main` |
| `8de0144` (JAZMII ×6 tip) | `feat/jazmii-auto-director`, `main` |
| `2bf9f7b` (feb2027 docs) | `feat/feb2027-trust-engine`, `main` |
| `6145578` (presplit main) | `backup/feb2027-presplit-main`, `main` |
| `6f0a2b0` (local main) | `main` (tip) |
| `e96d83a` (PR4 rec) | `reconcile/pr4-m262-into-m263` |
| `8f61599` | `backup/m262-media-capabilities`, `backup/pr4-head-8f61599`, `origin/feat/m26-2-media-capabilities` |
| `18c93ed` | `backup/m263-image-output-ux`, `backup/pr4-base-18c93ed`, `origin/fix/laxii-image-output-ux` |
| `a0148628` | `main`, `origin/main`, `m26-audit`/`m26-release` ancestry |

## 5. Complete ref inventory (30 refs)

Local branches (23): `main` → `6f0a2b0`; milestones `feat/m28-audio-reliability-quality` → `88fa9b3`, `feat/jazmii-auto-director` → `8de0144`, `feat/trust-specialist-coverage` → `e983c41`, `feat/gangzii-audio-production` → `e983c41`, `feat/feb2027-trust-engine` → `2bf9f7b`; sanitized integration `reconcile/pr4-m262-into-m263` → `e96d83a`; planning `m25-intel-lanes` → `ea73545`, `m26-audit` → `b0b03da`, `m26-release` → `8cb93a9`, `m261-security-closure` → `601c90db`; backups `backup/feb2027-presplit-main` → `6145578`, `backup/laxii-pre-restoration` → `5246b52`, `backup/m22-wip-auto-commit` → `e396e42`, `backup/m25-intel-wip-auto-commit` → `5098143`, `backup/m25-wip-auto-commit` → `ee65874`, `backup/m26-baseline-auto-commit` → `f0b47ad`, `backup/m26-f0b47ad-line` → `b4be65d`, `backup/m261-local-main-pre-sync` → `477a160`, `backup/m262-media-capabilities` → `8f61599`, `backup/m263-image-output-ux` → `18c93ed`, `backup/pr4-base-18c93ed` → `18c93ed`, `backup/pr4-head-8f61599` → `8f61599`, `backup/pre-phase0-81caaa3` → `81caaa3`, `backup/pre-phase1-auto-commit` → `c69fe4b`.

Custom namespace: `refs/backup/scratch-bf47b8c` → `bf47b8c1cacf70170e7f19d86dfa2693892a9af4` (auto-commit `1547f802-…`, 2026-11-14; descends from `6a84481`, the PR #2 base side; **not** an ancestor of either main lineage — orphaned scratch snapshot, owner decision pending).

Remote-tracking (4): `origin/main` → `91a6809`, `origin/feat/laxii-jazmii-restoration` → `e7d7003` (= merge PR #5, parents `3ec8365` + `91a6809`), `origin/feat/m26-2-media-capabilities` → `8f61599`, `origin/fix/laxii-image-output-ux` → `18c93ed`.

## 6. Naming collision warning

Two unrelated milestones carry the "M26.2" label:

- **Old line M26.2** = Trust Engine specialist coverage (`e983c41`, branch `feat/trust-specialist-coverage`).
- **Sanitized line M26.2** = media capabilities (`8f61599`, branch/PR `feat/m26-2-media-capabilities`).

They are different work on different lines. The migration inventory treats them as separate groups (G5 for the trust-specialist work; the media-capability work is already present on the sanitized base).

## 7. Branch-name anomaly

`feat/gangzii-audio-production` points at `e983c41` (trust specialist coverage), **not** at `ae41561` (the actual GANGZII audio engine). The branch name predates the M27 commit; the M27/M28 work lives on `main` and on `feat/m28-audio-reliability-quality`. Recorded as an owner decision (no action taken under the freeze).

## 8. Worktrees

| Path | HEAD | Branch |
|---|---|---|
| `/home/z/my-project` | `6f0a2b0` | `main` (clean, untouched by this milestone) |
| `/home/z/my-project/worktrees/pr4-reconcile` | `e96d83a` | `reconcile/pr4-m262-into-m263` (relocated from `/tmp/m28-reconcile-wt` — was at risk of workspace recycling) |
| `/home/z/my-project/worktrees/m28-slm` | `e96d83a` | `reconcile/sanitized-m27-m28-migration` (created this milestone, ancestry verified before creation) |
