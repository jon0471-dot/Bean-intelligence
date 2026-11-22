# M30 — Sanitized Canonical Main & Branch Reconciliation — Live Investigation Report

Milestone: **M30** · Date: 2026-11-22 (IST) · Authorization: owner instruction "M30 — Sanitized Canonical Main & Branch Reconciliation" (2026-11-22) ·
Remote operations: **NONE — publication freeze respected. No push, no merge, no rebase, no reset, no force-push, no history rewrite, no PR closure, no ref creation/deletion, no default-branch change.**

Evidence discipline: every fact below was re-established fresh in this session — server-side `git ls-remote` (not cached remote-tracking refs), authenticated GitHub REST API (repo metadata, all 7 PRs, three compares), and local object arithmetic over the actual Git objects (`scripts/m30_verify_state.py`, committed with this report for reproducibility). No SHA was inherited from any prior document without re-verification. All quoted counts are exact at integration tip `082e064` (the pre-report snapshot; docs commits extend SAN-only buckets by one row each, per the M29-CR.1 §9 convention — all preflight checks in the execution plan re-resolve the tip dynamically).

Supersedes nothing; consumes and extends: `docs/M29CR1-COMMIT-ARITHMETIC-REPORT.md` (commit universe), `docs/M29CR1-PUBLICATION-PLAN.md` + `.ps1` (the two gated ordinary pushes), `docs/M29-CONFLICT-RESOLUTION-REPORT.md` (PR classification and conflict-set proofs).

---

## 1. Fresh GitHub refs and SHAs (server-side, `git ls-remote` + REST API, 2026-11-22)

| Ref | Remote SHA | Status |
|---|---|---|
| `HEAD` (default branch = `main`) | `91a68090ef72f71f52797bd88f9b83831fbeb997` | unchanged since M29 |
| `refs/heads/main` | `91a68090ef72f71f52797bd88f9b83831fbeb997` | unchanged since M29 |
| `refs/heads/feat/laxii-jazmii-restoration` | `e7d7003f36896b3ceaf07cde74d36275989469c1` | unchanged since M29 |
| `refs/heads/feat/m26-2-media-capabilities` | `8f61599271b1aa66e86a2c4956f6dc01eef8b737` | unchanged since M29 |
| `refs/heads/fix/laxii-image-output-ux` | `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064` | unchanged since M29 |
| `refs/heads/main-sanitized` | **absent** | Step-2 precondition still holds |
| `refs/pull/1/head` | `8f615992…` | PR #1 head |
| `refs/pull/2/head` | `a0148628…` | PR #2 head (closed) |
| `refs/pull/3/head` | `3ec83650…` | PR #3 head (closed) |
| `refs/pull/4/head` | `8f615992…` | PR #4 head |
| `refs/pull/5/head` | `91a68090…` | PR #5 head (closed) |
| `refs/pull/6/head` | `18c93ed7…` | PR #6 head |
| `refs/pull/7/head` | `18c93ed7…` | PR #7 head |

- Repo is **public**, default branch **`main`**, last push **2026-11-21T05:59:27Z** (= creation of `e7d7003`). **No ref has advanced since the M29 audit** — all four recorded SHAs match byte-for-byte.
- Fresh GitHub compare results (REST `main…branch`): `feat/laxii-jazmii-restoration` = **ahead_by 1, behind_by 0, status `ahead`**; `feat/m26-2-media-capabilities` = **ahead 205, behind 199, `diverged`**; `fix/laxii-image-output-ux` = **ahead 206, behind 199, `diverged`**.
- The task brief's reported figures are therefore confirmed for the two diverged branches (205/199 and 206/199) and **corrected** for `feat/laxii-jazmii-restoration`: it is **1 commit ahead, 0 behind** old `main` (the reported "1 commit behind" is stale — it matches the pre-merge state before PR #5's merge commit `e7d7003` landed on the branch on 2026-11-21).

## 2. Current default branch and PR state

Seven pull requests exist; **four are open, three are closed unmerged** (none has ever been merged by GitHub: every `merged=false`):

| PR | State | Base (pinned SHA) | Head | Content |
|---|---|---|---|---|
| #1 | **open** | `main` @ `a0148628` (old-main ancestor) | `feat/m26-2-media-capabilities` @ `8f615992` | M26.2 → old main; **lineage-blocked** (old base) |
| #2 | closed | `feat/laxii-jazmii-restoration` @ `6a84481c` | `main` @ `a0148628` | historical sync experiment |
| #3 | closed | `main` @ `a0148628` | `feat/laxii-jazmii-restoration` @ `3ec83650` | historical; `3ec83650` is an ancestor of old main |
| #4 | **open** | `fix/laxii-image-output-ux` @ `18c93ed7` | `feat/m26-2-media-capabilities` @ `8f615992` | the two-file conflict set (`.gitignore`, `src/components/bean/laxii.tsx`) — **already resolved by `e96d83a`** (re-proven fresh: `git merge-tree --write-tree 18c93ed 8f61599` conflicts on exactly those 2 paths) |
| #5 | closed | `feat/laxii-jazmii-restoration` @ `3ec83650` | `main` @ `91a68090` | merge commit `e7d7003` exists on the branch with the PR #5 title as message, but GitHub records the PR closed-unmerged |
| #6 | **open** | `main` @ `91a68090` | `fix/laxii-image-output-ux` @ `18c93ed7` | M26.3 → old main; **lineage-blocked** (old base) |
| #7 | **open** | `feat/laxii-jazmii-restoration` @ `e7d7003f` | `fix/laxii-image-output-ux` @ `18c93ed7` | **lineage-blocked** (old base; 40-path conflict set per M29 §4) |

## 3. Why each branch diverged — root causes (verified against objects)

Shared fact: old public `main` and the sanitized line share exactly a **19-commit pre-split root** (root object `d85a9f2a`), forking at `cafdb6826da9c4edcd62e2ead15d801869ae9c3a`. Everything after the fork on the old-main side (199 commits) is old public history containing the sensitive session/database artifacts that motivated the sanitized lineage.

1. **`feat/laxii-jazmii-restoration` @ `e7d7003`** — not diverged at all. Its only unique object is a single merge commit `e7d7003` = "Merge pull request #5 from jon0471-dot/main" (parents `3ec83650` ⊕ `91a6809`). `3ec83650` (its other lineage) is an **ancestor of old `main`** — old `main`'s tip `91a6809` is itself the merge `a0148628` ⊕ `3ec83650`, i.e. the branch side was already merged into old main earlier. Verified: `git rev-list --count 91a6809..e7d7003` = 1 (only the merge object), `git rev-list --count 3ec83650 ^91a6809` = 0, and `git diff 91a6809 e7d7003` is **empty** — the branch tree is byte-identical to old `main`'s tree. Zero unique content; zero non-merge unique commits. The branch is a historical artifact of the PR #2/#3/#5 sync experiments.
2. **`feat/m26-2-media-capabilities` @ `8f61599`** — genuinely diverged from old `main` at `cafdb682`: the branch grew 205 commits the old main never took; old main grew 199 commits the branch never took (the post-fork old-side history, now quarantined). Merge-base with `fix/laxii-image-output-ux` is `411437144ee01abac07d7f0693cfaac0f6101e41`; the two branches each carry a tiny unique tail (2 vs 3 commits), which produced PR #4's two-file conflict.
3. **`fix/laxii-image-output-ux` @ `18c93ed7`** — same fork point `cafdb682`, 206 ahead / 199 behind; same two-branch fork from `4114371` with a 3-commit tail.

## 4. Sanitized-lineage status (fresh verification, `scripts/m30_verify_state.py` — all PASS)

- Live tip: `refs/heads/reconcile/sanitized-m27-m28-migration` = `082e064c6e1244ad8b88971e99b65bd655c65044` (244 commits, local-only; **not on the remote**).
- Application tree purity: tip tree ≡ verified `d2c232a` outside `docs/` and audit scripts (diff empty).
- Manifest completeness: **225/225 G1–G7 manifest paths present** in the tip tree, 0 missing; all **89 G8/G9/G10 paths intentionally absent**, 0 unexpectedly present (314 manifest paths total, `docs/M28-MIGRATION-MANIFEST.json`).
- Lineage isolation: old `main` is **not** an ancestor of the tip; `merge-base(tip, 91a6809)` = `cafdb682…` exactly — the deepest old-side connection remains the 19-commit shared pre-split root. No new sensitive artifacts: the only filename matches for cookie/session/credentials patterns in the tip tree are legitimate source/ops files (auth route implementations, credential-handling libraries, secret-scan tooling), matching the M29-CR.1 content verification.
- PR #4 reconciliation preserved: `e96d83a` (parents `18c93ed` ⊕ `8f61599`) **is an ancestor of the tip**; parent-1 of `e96d83a` is exactly `18c93ed7…` (pure fast-forward, re-proven).
- Containment: **`feat/m26-2-media-capabilities` and `fix/laxii-image-output-ux` are fully contained in the sanitized tip** (`git rev-list 082e064…8f61599` = 20/0; `082e064…18c93ed` = 19/0 — zero branch-only commits on both sides).
- Live set arithmetic (all refs): universe `git rev-list --all --count` = **505** = |S| 244 (sanitized tip) + (|O−S| 261 old-side-only) with overlap 19 — closes exactly; the 505 = 500 (M29-CR.1 audit snapshot) + 3 docs commits on the sanitized line (`741156c`, `b87acb3`, `082e064`) + 2 post-audit archive auto-snapshots (`6b83697`, `4274b54` on the local WIP `main` line). No unexplained commit gaps.

## 5. Per-branch unique-commit inventory and classification (M30 Phase 3)

**`feat/m26-2-media-capabilities` @ `8f615992`** — 205 commits ahead of old `main`, 199 behind; vs canonical tip: 0 unique commits.
- Classification: **already contained in sanitized history** (every commit of the branch is an ancestor of `082e064` via `e96d83a` parent-2). Content survived the PR #4 reconciliation (M29 three-way tree integrity over 80 paths: PASS; lightbox + edit-history both mounted; no duplicate changes introduced — the reconciliation is the single merge, not a replay).

**`fix/laxii-image-output-ux` @ `18c93ed7`** — 206 ahead / 199 behind; vs canonical tip: 0 unique commits.
- Classification: **already contained in sanitized history** (the tip's first-parent chain passes through `18c93ed` → `e96d83a`).

**`feat/laxii-jazmii-restoration` @ `e7d7003`** — 1 ahead / 0 behind old `main`; vs canonical tip: 200 objects not in canonical (199 old-main-side post-fork commits + the merge object), 225 canonical-side commits not in the branch.
- Classification of its unique commits: exactly **one** object, the structural merge `e7d7003` — **superseded / merge-object with zero unique content** (`git diff 91a6809 e7d7003` empty; `git rev-list e7d7003 ^91a6809 --no-merges` empty). Its content successor is old `main`'s content, which the sanitized line already represents (157 patch-id twins + 24 transplants + represented/excluded buckets per the M29-CR.1 500-row table). **No legitimate unique work exists to preserve on this branch.**
- Note: its tree is content-identical to old `main`, so no sensitive tip-level artifacts exist on it (old `main`'s tip tree contains only legitimate code files; the sensitive artifacts are in old-side *history*).

## 6. Canonical-base proposal (M30 Phase 2)

Establish the verified sanitized integration history (`reconcile/sanitized-m27-m28-migration` tip, resolved dynamically at execution time) as the canonical `main` lineage. Every owner category maps onto the verified ledger with zero unaccounted commits:

| Owner category (M30 brief) | Verified disposition | Evidence |
|---|---|---|
| 17 approved, non-sensitive unpublished commits | **SAN-UNPUBLISHED = 17** at snapshot `082e064` (14 at the M29-CR.1 audit + `741156c` + `b87acb3` + `082e064`) | `git rev-list --count 082e064 ^origin/fix/laxii-image-output-ux ^origin/feat/m26-2-media-capabilities` = 17; all docs/audit commits |
| 24 transplanted source commits and their sanitized destinations | **OLD-MIGRATED = 24** (G1–G7, destination commits `953c752`, `75ef989`, `b429132`, `30c14a4`, `b8a4427`, `a0d52b2`, `9303a56`, + G5 test-surface fix `d2c232a`) | M29-CR.1 §5, manifest re-verified 225/225 today |
| Six patch-equivalent originals | **Not matched to a verified set.** The recomputed figure is **158** old-side commits patch-equivalent to the sanitized line (157 OLD-PATCH-EQUIVALENT + 1 OLD-PATCH-DUPLICATE `2bf9f7b` ≡ `b1a21c2`, patch-id `f4efa906…`); the "six" figure could not be tied to any committed audit bucket and is flagged as a nomenclature question for the owner. No impact on the plan: patch-equivalence means the content is already canonical either way | M29-CR.1 §3 item 2 (157/157 recomputed, 0 failures) |
| 12 owner-gated G8/G9/G10 commits | **OLD-EXCLUDED = 12** — excluded from the sanitized line by design; 89 associated paths verified absent from the tip tree | manifest sweep, fresh |
| 49 WIP/archive snapshots | **46 OLD-WIP-SNAPSHOT + 3 post-audit archive auto-snapshots** (`d477902` row 500, then `6b83697`, `4274b54`) = 49 — all excluded from the sanitized line | M29-CR.1 §2 + fresh universe arithmetic |
| The three target branches and their unique work | m262/m263: **100% contained** in canonical (0 unique commits); LJ: **zero unique content** (one superseded merge object only) | §4, §5 — fresh |

Publication shape (no force required anywhere in the recommended path):

1. **Step 1** — fast-forward `fix/laxii-image-output-ux` to `e96d83a` (completes PR #4's reconciliation delivery on the branch; moves PR #6/#7 heads with it).
2. **Step 2** — create `main-sanitized` at the live integration tip (new ref; publishes the 17 SAN-UNPUBLISHED commits).
3. **Step 3** — canonical name transition (owner-authorized, history-meaning): **recommended = rename, not force**: GitHub → rename `main` → `main-archive` (default branch follows the rename; old lineage preserved as a read-only archive ref), rename `main-sanitized` → `main`, then set default branch back to `main`. Zero force-pushes, zero object loss, both lineages remain reachable. The M29-CR.1 guarded swap (`--force-with-lease` anchored to `91a68090…`, quarantined behind `M29CR1_ALLOW_MAIN_SWAP=1`) remains the alternative and stays fenced behind separate recorded authorization.
4. **Step 4** — reconcile the three target branches against canonical `main` (§7).
5. **Step 5** — PR dispositions (D7) and final `git ls-remote` verification.

## 7. Per-branch reconciliation strategy, exact commands, FF proofs, expected GitHub results (M30 Phase 4)

All commands assume execution **after** the owner lifts the freeze and closes the gates (§9); `$tip` is resolved dynamically at execution time (`git rev-parse reconcile/sanitized-m27-m28-migration`; at this report's snapshot = `082e064…`). Every push below is proven fast-forward or explicitly marked owner-gated. Numbers "behind/ahead" are quoted at snapshot `082e064` and grow by one per docs commit — the preflight recomputes them live and aborts on drift.

### 7.1 `fix/laxii-image-output-ux` — method: **normal-merge already performed (PR #4 reconciliation) + fast-forward to canonical**

- FF proof A: parent-1 of `e96d83a` = `18c93ed7…` exactly (`git rev-parse e96d83a^1` — re-verified today). Push is an ordinary fast-forward, no force.
- FF proof B: `18c93ed` is an ancestor of `$tip` (rev-list 19/0) → the later canonical alignment push is also a pure fast-forward.
- Expected GitHub states: today "206 ahead, 199 behind main" (diverged) → after Step 1: **0 ahead, 19 behind** (banner "19 commits behind main", Sync button) → after Step 4: **0 ahead, 0 behind, compare status `identical`** → **"This branch is up to date with main."** (guaranteed under every banner interpretation).

```bash
# Step 1 (ordinary FF push — completes PR #4 reconciliation delivery)
git push origin "e96d83a5196f45712350aaf41d13a1e5dfcebae7:refs/heads/fix/laxii-image-output-ux"
# Step 4b (after canonical main is active; ordinary FF push)
git push origin "${tip}:refs/heads/fix/laxii-image-output-ux"
```

PR effects: PR #4 base recomputes against `e96d83a`, which fully contains head `8f61599` → conflict state clears, content delivered by the reconciliation merge itself; PR #6/#7 heads move to `e96d83a` (and later to canonical `main`) automatically, remaining lineage-blocked against their old bases → owner closes per D7 (§9).

### 7.2 `feat/m26-2-media-capabilities` — method: **fast-forward to canonical** (its merge into the lineage is already `e96d83a` parent-2)

- FF proof: `8f61599` is an ancestor of `$tip` (rev-list 20/0, re-verified; also FF-2: ancestor of `e96d83a`).
- Expected GitHub: today "205 ahead, 199 behind" (diverged) → after canonical main is active: **0 ahead, 20 behind** → after Step 4a: **0/0 `identical`** → **"This branch is up to date with main."**

```bash
# Step 4a (after canonical main is active; ordinary FF push)
git push origin "${tip}:refs/heads/feat/m26-2-media-capabilities"
```

### 7.3 `feat/laxii-jazmii-restoration` — method: **historical branch with documented successor** (recommended) or **owner-gated canonical alignment**

- FF proof: `e7d7003` is **not** an ancestor of `$tip` (verified FF-6 FAIL by design — the branch carries old-main ancestry that canonical excludes). **No fast-forward to canonical exists.**
- Legal-but-rejected path: merging canonical into the branch is an ordinary FF push (`e7d7003` would be parent-1 of the new merge), but the merge-tree dry run reports **214 conflicted paths** (`.gitignore`, `package.json`, `prisma/schema.prisma`, the four product UIs, the full API surface…) — impractical and error-prone; rejected.
- **Option L1 (recommended, no history change):** keep the branch as a historical archive of the PR #2/#3/#5 sync experiments; canonical `main` (post-rename) is its documented content successor (its tree ≡ old `main` tree; content successor preserved in canonical via the twin/transplant program). GitHub display: "200 ahead, 225 behind main" (diverged) — **the green banner is not achievable on this path.**
- **Option L2 (owner-gated alignment):** a history-meaning change of the same class as the main swap, only with explicit recorded authorization after all gates close. Content-lossless and object-preserving: the branch carries zero unique content (§5) and `e7d7003` remains reachable via a pre-move backup ref and the recovery bundles.
  - Expected GitHub after L2: **0 ahead, 0 behind, `identical`** → **"This branch is up to date with main."**

```bash
# L2 pre-move preservation (ordinary push creating a backup ref; no force)
git push origin "e7d7003f36896b3ceaf07cde74d36275989469c1:refs/heads/backup/lj-pre-canonical-e7d7003"
# L2 alignment (OWNER-GATED — force-with-lease anchored to the exact live tip; fails safely if LJ moved)
git push --force-with-lease="refs/heads/feat/laxii-jazmii-restoration:e7d7003f36896b3ceaf07cde74d36275989469c1" \
  origin "${tip}:refs/heads/feat/laxii-jazmii-restoration"
```

### 7.4 Order of operations and expected ahead/behind table (at snapshot `082e064`)

| # | Operation | Ref type | FF? | Expected GitHub compare vs canonical `main` afterwards |
|---|---|---|---|---|
| 1 | push `e96d83a…` → `fix/laxii-image-output-ux` | existing branch | **FF** (parent-1 proof) | fix: 0 ahead / 19 behind |
| 2 | push `$tip` → `main-sanitized` (new) | new ref | n/a (creation) | — |
| 3 | rename `main`→`main-archive`, `main-sanitized`→`main`, default → `main` | owner UI actions, no push | n/a | canonical `main` = sanitized lineage |
| 4a | push `$tip` → `feat/m26-2-media-capabilities` | existing branch | **FF** | m262: 0/0 `identical` |
| 4b | push `$tip` → `fix/laxii-image-output-ux` | existing branch | **FF** | fix: 0/0 `identical` |
| 5 | LJ per L1 or L2 (§7.3) | existing branch | L1: none; L2: force-lease, gated | L1: diverged (documented); L2: 0/0 `identical` |
| 6 | close PRs #1/#4/#6/#7 with successor notes (D7) | PR state | n/a | all open PRs resolved |
| 7 | `git ls-remote origin` final verification | read-only | n/a | see expected table below |

Expected final remote state: `main` = `$tip`; `feat/m26-2-media-capabilities` = `$tip`; `fix/laxii-image-output-ux` = `$tip`; `feat/laxii-jazmii-restoration` = `$tip` (L2) or `e7d7003…` (L1); `main-archive` = `91a68090…`; `backup/lj-pre-canonical-e7d7003` = `e7d7003…` (L2 only). GitHub UI: all three target branches display **"This branch is up to date with main."** (guaranteed for m262/m263 under every interpretation; for LJ under L2, or L1 leaves it diverged by documented choice).

## 8. Security checks and results (M30 Phase 4 / first brief Phase 4)

| Check | Result | Evidence |
|---|---|---|
| All unique approved changes preserved | **PASS** | m262/m263: 100% ancestry-contained in canonical (rev-list 0 branch-only commits); LJ: zero unique content (tree diff vs old main empty; 0 non-merge unique commits); PR #4 conflict content verified inside `e96d83a` (fresh 2-path merge-tree match) |
| No sensitive historical artifacts introduced | **PASS** | old `main` not ancestor of tip (merge-base = `cafdb682…` only); 0 runtime/credential artifacts in tip tree; 89 G8–G10 paths absent; no pushes performed — remote byte-identical to M29 record |
| No unrelated application changes | **PASS** | tip tree ≡ verified `d2c232a` outside `docs/` + audit scripts (diff empty); the only new non-docs file since `d2c232a` is the committed audit sweep script |
| No commits silently lost | **PASS** | live universe 505 closes exactly (S 244 + O−S 261, overlap 19); every bucket of the M29-CR.1 500-row table re-anchors (§6 mapping); all 40+ local refs and backup refs intact |
| No duplicate changes unnecessarily introduced | **PASS** | PR #4 handled by the single reconciliation merge `e96d83a` (not a replay); patch-equivalent old-side commits intentionally *not* re-created — twins already canonical |
| Resulting branch ancestry and tree correct | **PASS** | FF proofs A/B and FF-3/4/5 all PASS; lineage guard re-proven; `e96d83a` three-way integrity inherited from M29 (re-proven conflict scope) |
| Freeze compliance | **PASS** | zero remote mutations this session; `git ls-remote` before/after identical; all pushes above are *prepared*, not executed |

## 9. Owner actions still required (M30 Phase 6 — none closed, none bypassed)

| Gate / decision | Scope | Closes what |
|---|---|---|
| **Gate 1** | Off-machine recovery confirmation **and** Windows-side execution of the delivered owner verifier (`M26_1_5_R2_OWNER_DELIVERY` — `-ChecksumsOnly` first, then full recovery verification with the real report kept) | evidence that the recovery package is genuine; prerequisite for any publication |
| **Gate 2** | Collaborator notification and acknowledgment of the sanitized-lineage decision | permission to change remote ref meanings |
| **Gate 3** | Credential exposure investigation and confirmation (M26.1.4 checklist §4) | security clearance for publishing |
| **Freeze lift** | separate explicit owner action | enables Steps 1–2 of §7 |
| **D2** | G9 WIP snapshot disposition (keep archived / destroy) | final bucket of the ledger |
| **D3** | G10 credential-forensic document disposition | final bucket of the ledger |
| **D4** | Private backup reference disposition (`refs/backup/scratch-bf47b8c` et al.) | ref hygiene decision |
| **D7** | PR disposition: after Step 1, close PR #4 as delivered-by-reconciliation; close PRs #1/#6/#7 as superseded-by-canonical-lineage (prepared close-out text exists in M29-CONFLICT-RESOLUTION-REPORT §10) | clean PR state at the end state |
| **Canonical transition** | Step 3 of §6 (rename path recommended) + Option L1/L2 choice for LJ — each a separate, recorded authorization (history-meaning changes) | the "up to date with main" end state |

Evidence of gate closure observed this session: **none** — remote and local state match the pre-freeze record exactly.

## 10. Can the three branches safely become up to date with canonical main? (precise statement)

- **`feat/m26-2-media-capabilities`: YES — unconditionally, safely.** It is already fully contained in the sanitized lineage; after the canonical `main` transition, one ordinary fast-forward push makes it identical to `main` (0/0, `identical`). No force, no work lost, no new commits.
- **`fix/laxii-image-output-ux`: YES — unconditionally, safely.** Same containment; Step 1 (FF to `e96d83a`) completes the PR #4 reconciliation delivery; a second ordinary FF aligns it to canonical `main` (0/0, `identical`). No force, no work lost, no new commits.
- **`feat/laxii-jazmii-restoration`: YES only via an owner-gated history-meaning change; NO via ordinary operations.** The branch is not an ancestor of canonical history and cannot become one (its ancestry contains old public `main`, which canonical excludes by design). Fast-forward is impossible; the merge-in path is legal but conflicts on 214 paths (rejected); the merge would also leave the branch ahead-but-not-identical. The two real options are: keep it as a **historical branch with documented successor** (L1 — display stays diverged, zero risk) or perform the **owner-gated canonical alignment** (L2 — force-with-lease anchored to `e7d7003…`, content-lossless because the branch carries zero unique content, object-preserving via a pushed backup ref). Under L2 it reaches 0/0 `identical` and displays the green banner; under L1 it will not, by documented owner choice.

## 11. Remaining blockers

1. All owner gates (§9) — evidence of closure still outstanding; publication freeze active.
2. The canonical `main` name transition and the LJ L1/L2 choice require separate recorded owner authorizations (history-meaning changes; not part of the two gated ordinary pushes).
3. Nomenclature: the brief's "six patch-equivalent originals" could not be matched to a verified audit bucket (recomputed figure: 158 = 157 + 1) — owner to confirm the intended referent; no arithmetic or plan impact.
4. Banner semantics note: GitHub's branch banner is not part of any API; the guaranteed-green end state for m262/m263 (0/0 `identical`) is interpretation-independent. For calibration, `feat/laxii-jazmii-restoration` is *today* in exactly the non-behind state class (1 ahead / 0 behind, API status `ahead`) — the owner can read its current branch-page banner directly to see how GitHub renders that state class before choosing L1/L2.
5. The sanitized branch remains local-only; nothing of the sanitized lineage (including the 17 SAN-UNPUBLISHED commits) is on GitHub until Steps 1–2 execute under authorization.

## 12. Zero-remote-operation confirmation

This session performed exactly one class of remote interaction: **read-only** (`git fetch` into local remote-tracking refs, `git ls-remote`, authenticated REST GETs for repo/PR/compare metadata, page fetches). Zero pushes, zero ref mutations on GitHub, zero PR actions, zero default-branch changes. Local object database: only the merge-tree dry-run wrote unreferenced merge objects (no refs); the M30 report and verification script are committed **locally** on the unpublished sanitized branch as docs-only commits, in the established M29 pattern, leaving every app-tree blob identical to the verified `d2c232a` state.
