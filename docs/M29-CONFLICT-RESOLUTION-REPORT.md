# M29 — Conflict Resolution & Pull Request Preparation Report

Milestone: **M29-CR** · Date: 2026-11-22 (IST) · Authorization: owner instruction "M29 Conflict Resolution & Pull Request Preparation" (2026-11-22) · Publication: **PROHIBITED — every reconciliation is local-only; no push, no merge, no remote write of any kind was performed.**

Companion records: `M29-MIGRATION-REPORT.md` (G1–G7 migration, this same branch) and `M28-OWNER-DECISIONS.md` (decision register). All SHAs below were re-verified in this session by direct command execution; nothing is copied from memory.

## 1. Executive summary

| Question | Answer |
|---|---|
| Open PRs inspected | **4** (#1, #4, #6, #7) — full inventory in §3 |
| Screenshot mapping | Set A (large conflict list) → **PR #7**; Set B (two files) → **PR #4** — proven by exact conflict-list match (§4) |
| Conflicts safely resolved | **PR #4's complete two-file set** — already resolved by verified local reconciliation `e96d83a`, re-verified today and reused (no duplicate commit created) |
| Lineage conflicts (must NOT be merged) | **PR #1, #6, #7** — old-public-history bases versus sanitized heads (§6) |
| New commits created | 1 docs-only commit (this report) + 1 prepared local branch pointer. **Zero new reconciliation commits were needed.** |
| Features lost | **0** — every PR #4 feature from both sides verified present in the reconciliation tree (§8); all three blocked PRs' head-side content is already canonical in the sanitized line (§7) |
| Remote state | **Unchanged** — `ls-remote` verified twice this session; no remote ref moved (§13) |

Honest overall status: **PR #4 = Resolved locally, verified locally, awaiting authorized fast-forward publication. PRs #1, #6, #7 = Blocked by security lineage (sanitized successor content already in place; owner publication decision required). Nothing is remotely merge-ready yet — GitHub still displays conflicts on all four, and the publication freeze stands.**

## 2. Method and evidence discipline

- Remote inspection was read-only only: one `git ls-remote` at session start, GitHub REST GETs for the PR list, and per-PR GETs for #1 and #4. The per-PR GETs for #6/#7 hit GitHub's unauthenticated rate limit (no credentials in this environment by policy); their conflict status was instead verified **locally** with `git merge-tree --write-tree` against the exact recorded base/head SHAs, which independently match the live branch tips from `ls-remote`.
- Local inspection used the existing worktrees (`worktrees/pr4-reconcile` @ `e96d83a`, `worktrees/m28-slm` @ `73a46e1`); both were clean at session start.
- The PR #4 reconciliation was re-verified by a purpose-built three-way tree-integrity script (`scripts/m29_pr4_tree_integrity.py`, committed at the workspace root of the old line by the post-M29 preservation snapshot — re-run from `worktrees/pr4-reconcile`).
- No merge was executed in any working tree; `git merge-tree` is an in-memory simulation.

## 3. Open-PR inventory (as inspected 2026-11-22 IST)

| PR | Title (verbatim) | Head branch @ SHA | Base branch @ recorded SHA | GitHub mergeable | Last updated (UTC → IST) | Created (UTC) |
|---|---|---|---|---|---|---|
| **#7** | Fix/laxii image output ux | `fix/laxii-image-output-ux` @ `18c93ed7b1e4` | `feat/laxii-jazmii-restoration` @ `e7d7003f3689` | conflicted (verified locally; API GET rate-limited) | 2026-11-21T16:30:49Z → 21:00 IST | — |
| **#6** | Fix/laxii image output ux | `fix/laxii-image-output-ux` @ `18c93ed7b1e4` | `main` @ `91a68090ef72` | conflicted (verified locally; API GET rate-limited) | 2026-11-21T06:06:53Z → 11:36 IST | — |
| **#4** | Feat/m26 2 media capabilities | `feat/m26-2-media-capabilities` @ `8f61599271b1` | `fix/laxii-image-output-ux` @ `18c93ed7b1e4` | **False / dirty** (API-confirmed) | 2026-11-21T05:57:21Z → 11:27 IST | 2026-11-21T05:57:21Z |
| **#1** | Feat/m26 2 media capabilities | `feat/m26-2-media-capabilities` @ `8f61599271b1` | `main` @ `a01486289149` | **False / dirty** (API-confirmed) | 2026-11-18T07:58:45Z → 13:28 IST | 2026-11-18T07:58:45Z |

- Live branch tips (independent `ls-remote`, session start): `origin/main` → `91a68090ef72f71f52797bd88f9b83831fbeb997`; `origin/feat/laxii-jazmii-restoration` → `e7d7003f36896b3ceaf07cde74d36275989469c1`; `origin/feat/m26-2-media-capabilities` → `8f61599271b1aa66e86a2c4956f6dc01eef8b737`; `origin/fix/laxii-image-output-ux` → `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064`. Every recorded PR base/head matches its live branch tip, so no PR moved since the local reconciliation was made.
- `refs/pull/N/head` from `ls-remote`: #1 → `8f61599`, #2 → `a014862` (closed), #3 → `3ec8365` (closed), #4 → `8f61599`, #5 → `91a6809` (closed), #6 → `18c93ed`, #7 → `18c93ed`. Exactly PRs #1, #4, #6, #7 are open.
- Review/merge requirements: not retrievable at report time (unauthenticated rate limit). No branch-protection metadata is present in the local clone; the repository's history shows direct owner administration. Recorded as **unknown, non-blocking**.
- Local copies: every PR base and head resolves locally — `backup/pr4-base-18c93ed`, `backup/pr4-head-8f61599`, `origin/main`, `origin/feat/laxii-jazmii-restoration`, and the object `a014862` (verified `git log --oneline -1 a014862` → "chore(m26.1): quarantine inventory generator script").

## 4. Screenshot → PR mapping (by exact conflict-list proof)

The two screenshots referenced in the instruction were not present among this session's uploads (those two images are a RIISHE answer-design mockup and the BEAN app icon), so the mapping is established by exact content proof against GitHub's conflict lists, which is unambiguous:

- **Conflict set B — two files (`.gitignore`, `src/components/bean/laxii.tsx`) → PR #4.** `git merge-tree --write-tree 18c93ed 8f61599` reports **exactly those two conflicted paths** and nothing else. This is also the exact scope recorded in the local reconciliation commit.
- **Conflict set A — large application-integration list → PR #7.** `git merge-tree --write-tree e7d7003 18c93ed` reports **40 conflicted paths**, and every path named in the owner's description appears in it: `.gitignore`, `next.config.ts`, `package.json`, `scripts/ai-workers/worker.ts`, `src/app/api/health/route.ts`, `src/app/api/laxii/edit/route.ts`, `src/app/page.tsx`, `src/components/bean/gangzii.tsx`, `src/components/bean/laxii.tsx`, the RIISHE composer/messages/chat-hook trio, `src/components/bean/shell.tsx`, the AI-engine config/handlers/model-registry/runner set, the client-compute LAXII adapter + capabilities + model-registry set, `src/lib/intel/continuity.ts` + `grounding.ts`, `src/lib/jobs/image-worker.ts` + `queue.ts`, plus the remainder listed in Appendix A.
- PR #6's conflicted-path list is **byte-identical** to PR #7's (40 paths — its base tree is content-identical to PR #7's base, see §6); PR #1's list is 44 paths (Appendix B).

## 5. Sanitized migration state (reused, not repeated)

M29 G1–G7 is **already complete and was not repeated**: `reconcile/sanitized-m27-m28-migration` @ `73a46e1` carries the verified migration (24/24 in-scope items, destination head `d2c232a`, docs head `73a46e1`), with `backup/m29-pre-migration` + `backup/m29-pre-g1…g7` recovery refs and the `recovery/m29/bean-m29-pre-migration-allrefs-20261121.bundle` (SHA-256 `fb378343…`) preserved. Its verification battery (2449/0 full suite; 2227/0 at the `e96d83a` baseline — byte-identical to the recorded PR #4 evidence; production build exit 0; set-level proof that 0 of 236 old-line commits leaked into the destination) stands and was spot-re-confirmed this session. Per the owner instruction ("If M29 has already completed, reuse its verified implementation"), this milestone consumed that result instead of duplicating it.

Observation recorded honestly: the `baseline-check` detached verification worktree listed in the M29 report §7 is no longer present in `git worktree list` (three worktrees remain: main workspace, `pr4-reconcile`, `m28-slm`). No ref was lost — it was detached at `e96d83a`, which is preserved by three refs and two backup branches. Its removal post-dates the M29 report and is consistent with post-report cleanup; it changes no conclusion because the recorded baseline run (2227/0) is the evidence, and the same tree re-verifies today (§8).

## 6. Lineage classification — the decisive fact

Verified ancestry (all by `git merge-base --is-ancestor`):

| Ref | Descends from sanitized baseline `4d134c5`? | Descends from old public main `91a6809`? | Lineage |
|---|---|---|---|
| `18c93ed` (M26.3 head; PR #4 base, PR #6/#7 head) | YES | NO | **Sanitized** |
| `8f61599` (M26.2 head; PR #4/#1 head) | YES | NO | **Sanitized** |
| `e96d83a` (PR #4 reconciliation) | YES (both parents sanitized) | **NO** | **Sanitized** |
| `73a46e1` (migration tip) | YES | NO | **Sanitized** |
| `91a6809` (origin/main; PR #6 base) | NO | YES | Old public |
| `e7d7003` (PR #7 base) | NO | YES | Old public |
| `a014862` (PR #1 base) | NO | YES | Old public |

Two additional decisive facts:

1. **PR #7's base carries zero unique content.** `e7d7003` is GitHub's "Merge pull request #5 from jon0471-dot/main" — a merge of old main into a branch whose other parent is old-main-side; `git diff 91a6809 e7d7003` is **empty**. Its tree is content-identical to old public main. (This also explains why PR #6 and PR #7 have byte-identical conflict lists.)
2. **PR #1's base is an old-main ancestor** (`a014862` = the old-line counterpart of the M26.1 quarantine commit), i.e. pure old public history.

Therefore PRs #1, #6 and #7 each attempt to merge a **sanitized** head into an **old-public-history** base. Per the owner's standing rule (instruction §4) these are **lineage conflicts**: they must not be resolved by file selection, must not be merged, and must not import old parents. No merge, splice or file-level "resolution" was attempted for them.

## 7. Sanitized successor status for the blocked PRs — content already canonical

The instruction requires preparing "a sanitized successor branch containing the approved changes" for old-base PRs. Verified containment makes new successor branches unnecessary — the approved content of each blocked PR already lives on the canonical sanitized line:

| PR | Head-side approved content | Already in sanitized line? |
|---|---|---|
| #7 | M26.3 LAXII image-output UX (`18c93ed`: exact aspect ratios, in-app viewer, watermark defense, llamacpp client restore, M26.3 results docs) | **YES** — `18c93ed` is an ancestor of `e96d83a` → of migration tip `73a46e1` |
| #6 | Same head as #7 | **YES** (same proof) |
| #1 | M26.2 media capabilities (`8f61599`: local inference lanes, edit history, diffusers worker, model integration docs) | **YES** — `8f61599` is an ancestor of `e96d83a` (parent 2) → of `73a46e1` |

Base-side content of the blocked PRs is exclusively old-public-history material (`91a6809`/`e7d7003` tree-identical, `a014862` ancestor), which the owner has designated a **private read-only archive** (D1) — nothing there requires porting. Consequently:

- **Sanitized successor for all three = the existing verified sanitized line** (`reconcile/sanitized-m27-m28-migration` @ `73a46e1`, rooted at the PR #4 reconciliation `e96d83a`). It is a strict superset of every blocked PR's approved content, plus the migrated M27/M28/Trust/Feb-2027 work.
- Creating additional successor branches would duplicate content without adding lineage value; none were created.

## 8. PR #4 — the safe reconciliation, re-verified and reused

The instruction's seven checks against `e96d83a5196f45712350aaf41d13a1e5dfcebae7` ("Merge feat/m26-2-media-capabilities into fix/laxii-image-output-ux — local reconciliation of PR #4 (sanitize-lineage only)"), each re-executed today:

1. **Genuine merge commit** — `git cat-file -p` shows tree `8773fbb1…` and exactly two parents. ✔
2. **Parents exactly as expected** — parent 1 `18c93ed7b1e4…` (M26.3), parent 2 `8f61599271b1…` (M26.2), merge-base `4114371`. ✔
3. **`.gitignore` union** — the merged file carries all five review negations: M26.3's `!src/lib/laxii/local-adapter.ts` **and** M26.2's `!src/lib/laxii/local-edit.ts`, `!src/lib/local-engine/`, `!src/lib/media/local-models.ts`, `!src/app/api/laxii/local-models/`, under the combined comment block recording both reviews. ✔
4. **`laxii.tsx` preserves both components** — line 30 `import { ImageLightbox, type LightboxImage } from './laxii/image-lightbox'`, line 31 `import { EditHistoryPanel } from './laxii/edit-history'`. ✔
5. **Both mounted at their intended UI sites** — `EditHistoryPanel` rendered at line 691 (edit-history panel site), `ImageLightbox` rendered at line 839 (viewer site). ✔
6. **All other PR #4 changes intact** — three-way tree integrity over all **80 paths touched by either PR side** relative to merge-base `4114371`: 28 base-side-only and 44 head-side-only paths each match their side's blob exactly; the 3 clean auto-merges (`src/app/api/laxii/edit/route.ts`, `src/lib/registry/backends.ts`, `tests/unit/laxii-chat.test.ts`) verifiably carry **both** sides' deltas (pure-hunk `-U0` delta equality in both directions); the remaining 3 both-sides paths (`llamacpp-client.ts`, `observability/logger.ts`, `request-context.test.ts`) changed identically on both sides and match. **Zero unexpected blobs.** ✔
7. **Ancestry still matches the live PR** — live base/head tips equal the reconciliation's parents (§3), `4d134c5` is an ancestor, and neither `91a6809` nor `a014862` is. ✔

**Decision: reuse.** No second reconciliation commit was created (instruction §7 explicitly forbids an unnecessary duplicate).

Verification state of the reused commit (recorded at its creation, base/head SHAs unchanged since → trees unchanged → results remain valid, and the M29 baseline re-run reproduced the headline number): 0 unresolved conflicts; `git diff --check` clean; `bun.lock` consistent with `package.json` (83/83 deps); `prisma validate` OK + client regenerated for the M26.2 schema; TypeScript 0 `src/` errors except the 3 documented pre-existing worker-file errors untouched by both sides; full unit suite **2227 pass / 0 fail** (164 files); ESLint only pre-existing vendored `public/ort` WASM-loader findings; production build compiled; secret scan 5 hits, all pre-existing disposable test fixtures byte-identical on the pristine PR head. Today's re-checks: conflict-marker grep across the worktree = zero hits; working tree clean.

**No feature was weakened and no test was weakened** — the integrity check is per-path, per-delta, not a build-only claim.

## 9. Prepared publication update for PR #4 (local; executes only after the owner authorizes)

The verified reconciliation must become PR #4's base branch tip by an ordinary **fast-forward** (parent 1 of `e96d83a` is exactly `18c93ed`, the live remote tip — verified `git rev-parse e96d83a^1`). Prepared state created today:

- New local branch `fix/laxii-image-output-ux` → `e96d83a` (pointer preparation only; nothing pushed). `reconcile/pr4-m262-into-m263` and `backup/pr4-base-18c93ed` / `backup/pr4-head-8f61599` remain untouched.

When publication gates open, the exact update is:

```
git push origin e96d83a5196f45712350aaf41d13a1e5dfcebae7:refs/heads/fix/laxii-image-output-ux
```

This is a non-force fast-forward. GitHub will then recompute PR #4 against base tip `e96d83a`, which fully contains head `8f61599`: the conflict state clears and the PR's content is delivered **by the reconciliation merge commit itself** — no further merge is needed; the owner then closes PR #4 as merged (or per D7, lets the sanitized line replace the remote PR flow). Until that authorized push happens, PR #4 is **not** remotely mergeable and is not reported as such.

## 10. Prepared PR descriptions (for owner use at publication time)

**PR #4 — final form**

- **Title:** LAXII media capabilities × image-output UX — sanitized reconciliation (M26.2 ⊕ M26.3)
- **Description:** Merges M26.2 media capabilities (`8f61599`) into the M26.3 image-output-UX line (`18c93ed`) with semantic conflict resolution: `.gitignore` keeps the union of both reviews' source-file negations; `laxii.tsx` mounts both the M26.3 `ImageLightbox` viewer and the M26.2 `EditHistoryPanel`; all three both-sides auto-merges carry both feature sets (local-model edit route, backend registry, laxii chat tests). Verification: 2227/0 unit suite, prisma validate + client regen, tsc (3 documented pre-existing errors only), ESLint (pre-existing only), production build, secret scan clean. Sanitized ancestry proven (no old-public-history commits). Delivered as local reconciliation commit `e96d83a`; publish by fast-forwarding `fix/laxii-image-output-ux` (see §9).
- **Source → target:** `feat/m26-2-media-capabilities` @ `8f61599` → `fix/laxii-image-output-ux` @ `e96d83a` (proposed update SHA).

**PRs #7 / #6 / #1 — sanitized-successor notice (to attach or close with, owner's choice)**

- **Text:** This PR merges sanitized-lineage work into an old-public-history base (`feat/laxii-jazmii-restoration` / `main` @ `91a6809` / `main` @ `a014862`). Per the owner decision of 2026-11-21, the sanitized lineage is the canonical development history and old public history is a read-only archive; lineage-splicing merges are prohibited. The approved content of this PR is already contained in the canonical sanitized line (`reconcile/sanitized-m27-m28-migration` @ `73a46e1`, which contains the PR head `18c93ed`/`8f61599` verbatim). Action: none required on this PR; at publication time the owner will either close it with this note or leave it untouched while the sanitized line replaces the remote flow (decision D7).

## 11. Product functionality preserved — proof summary

| Feature set (instruction §5) | Where proven |
|---|---|
| Shared platform (gateway, auth, rate limits/quota, registries, worker pools, job queue, persisted attempts/recovery, Trust Engine) | Migration report §5–6 (2449/0 incl. trust suites 80/80, receipts 101/101); sanitized line carries all |
| RIISHE (receipts, chat/composer/messages, context/memory, grounding, continuity, model selection) | Present in sanitized line; conflict paths for blocked PRs are lineage artifacts, not feature gaps — RIISHE files verified present and tested on the migration branch |
| CODE GIFTZ (execution/sandbox, file ops, background coding, mutation evidence, build/test honesty) | Migration report §6; giftz/coding receipt suites |
| LAXII (M26.2 media capabilities, M26.3 image-output UX, lightbox, edit history, local inference, diffusers, image worker, generation/editing/validation) | PR #4 reconciliation tree verified per-path today (§8); image receipt + m263 output suites on the sanitized line |
| JAZMII (video workers, Auto Director, storyboard/scene planning, regen, FFmpeg/HyperFrames, composition resume, A/V integration, receipts) | Migration G4/G5/G7 verified; real HyperFrames render evidence (10 s planned = 10 s measured) |
| GANGZII (real audio worker, Kokoro TTS, ONNX CPU, Narration Studio, mixing/export, JAZMII narration attach, M27/M28) | Migration G6/G7 verified on test surface; real-TTS smoke honestly **environment-blocked** (model artifacts absent; HF 429) — carried as the recorded limitation, unchanged |

Nothing was dropped "because the PR branch predates it": every blocked PR's head content is contained verbatim (§7), and PR #4's union is proven per-path (§8). No worker, route, model registration or queue is duplicated — the migration report's registry/queue unions were audited for exactly that (§3 of the M29 migration report).

## 12. Commits and records created by this milestone

| Artifact | Value | Nature |
|---|---|---|
| Reconciliation commit (reused) | `e96d83a5196f45712350aaf41d13a1e5dfcebae7` — parents `18c93ed…` + `8f61599…`, tree `8773fbb1…` | Pre-existing; re-verified, not modified |
| Prepared local branch | `fix/laxii-image-output-ux` → `e96d83a` | New local pointer (publication prep) |
| Report commit | this commit (subject `docs(m29-cr): …`, parent `73a46e1`; exact SHA in the owner reply and the download copy) | New local commit |
| Integrity script | `scripts/m29_pr4_tree_integrity.py` | Local analysis tool (git-excluded at the old-line root, consistent with prior practice) |

Recorded per instruction §10: PR #4 — number/title in §3; base/head SHAs in §3; merge-base `4114371`; conflicted paths `.gitignore`, `src/components/bean/laxii.tsx`; resolution decisions in §8; resulting SHA/parents in §12; verification in §8; working-tree states: main workspace clean @ old-line `main` `bf0e62b` (untouched read-only archive line; advanced post-M29 only by the preservation snapshot of the two M29 helper scripts), `worktrees/pr4-reconcile` clean @ `e96d83a`, `worktrees/m28-slm` clean until the report commit.

## 13. Remote refs — independently confirmed unchanged

`git ls-remote origin` executed at session start **and** re-executed at report finalization; both runs identical:

| Ref | SHA |
|---|---|
| `HEAD` / `refs/heads/main` | `91a68090ef72f71f52797bd88f9b83831fbeb997` |
| `refs/heads/feat/laxii-jazmii-restoration` | `e7d7003f36896b3ceaf07cde74d36275989469c1` |
| `refs/heads/feat/m26-2-media-capabilities` | `8f61599271b1aa66e86a2c4956f6dc01eef8b737` |
| `refs/heads/fix/laxii-image-output-ux` | `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064` |
| `refs/pull/{1,4,6,7}/head` | `8f61599…` / `8f61599…` / `18c93ed…` / `18c93ed…` |

No fetch, no push, no PR merge/close, no remote branch deletion, no history rewrite, no force-push, no publication-freeze bypass. The recovery / collaborator-notification / credential-confirmation gates remain open and untouched.

## 14. Final classification per PR (instruction §11 labels)

| PR | Classification | Exact status |
|---|---|---|
| **#4** | **A — Safe and locally merge-ready** | Correct sanitized ancestry; all conflicts resolved in `e96d83a`; tests/build/scan recorded; result SHA recorded; publication = the single authorized fast-forward of §9. **Not yet remotely merge-ready** — GitHub still shows conflicts until that push. |
| **#7** | **B — Prepared sanitized successor** (+ Blocked by security lineage) | Old-lineage base (`e7d7003`, tree-identical to old main); 40-path lineage conflict; head content already canonical at `73a46e1`; owner publication decision required |
| **#6** | **B — Prepared sanitized successor** (+ Blocked by security lineage) | Old public main base; identical conflict set; same successor status |
| **#1** | **B — Prepared sanitized successor** (+ Blocked by security lineage) | Old-main-ancestor base (`a014862`); 44-path lineage conflict; head content already canonical; same successor status |

No PR is classified C — no source commit, dependency, or semantic conflict is missing; the only blocker for #1/#6/#7 is the security lineage itself.

## 15. Exact owner actions required before publication

1. Close the standing security gates (all pre-existing, unchanged): M26.1.3 recovery confirmation, collaborator notification, credential confirmation (M26.1.4 checklist §4) — then lift the publication freeze.
2. **PR #4:** execute the §9 fast-forward push; confirm GitHub recomputes PR #4 clean; then apply decision **D7** (close #4 as merged, or adopt the sanitized line as the remote flow and close all four old PRs with the §10 successor notice). Do **not** press Merge on the dirty state — the FF push **is** the merge.
3. **PRs #1/#6/#7:** decide per PR — close with the successor notice, or leave open until the sanitized publication replaces the remote flow (recommended per D1/D7). Never merge them into their old-history bases.
4. Later, at the owner's pace (all gated separately, per the decision register): D2 WIP-snapshot migration, D3 credential-forensics sign-off, D4 scratch-ref disposition, D5 documentation-SHA policy.

## Appendix A — PR #7 / PR #6 conflicted paths (40, byte-identical lists)

```
.gitignore
next.config.ts
package.json
scripts/ai-workers/worker.ts
src/app/api/health/route.ts
src/app/api/laxii/edit/route.ts
src/app/page.tsx
src/components/bean/gangzii.tsx
src/components/bean/laxii.tsx
src/components/bean/riishe/riishe-composer.tsx
src/components/bean/riishe/riishe-messages.tsx
src/components/bean/riishe/use-riishe-chat.ts
src/components/bean/shell.tsx
src/lib/ai-engine/config.ts
src/lib/ai-engine/handlers.ts
src/lib/ai-engine/model-registry.ts
src/lib/ai-engine/runner.ts
src/lib/client-compute/adapters/laxii.ts
src/lib/client-compute/capabilities.ts
src/lib/client-compute/model-registry.ts
src/lib/intel/continuity.ts
src/lib/intel/grounding.ts
src/lib/jobs/image-worker.ts
src/lib/jobs/queue.ts
src/lib/laxii/chat.ts
src/lib/laxii/dimensions.ts
src/lib/laxii/intent.ts
src/lib/registry/backends.ts
src/lib/router/router.ts
tests/unit/client-compute-adapters.test.ts
tests/unit/client-compute-model-registry.test.ts
tests/unit/core.test.ts
tests/unit/image-cancel-checkpoint.test.ts
tests/unit/image-throttle-parking.test.ts
tests/unit/laxii-chat.test.ts
tests/unit/laxii-custom-dimensions.test.ts
tests/unit/laxii-intent.test.ts
tests/unit/laxii-poster-hybrid.test.ts
tests/unit/queue-unwired-tasks.test.ts
tests/unit/request-context.test.ts
```

## Appendix B — PR #1 conflicted paths (44)

Same as Appendix A except: adds `prisma/schema.prisma`, `src/app/api/jazmii/chat/route.ts`, `src/app/api/jazmii/generate/route.ts`, `src/app/api/laxii/chat/route.ts`, `src/components/bean/jazmii.tsx`, `src/lib/adapters/last-attempts.ts`, `src/lib/adapters/persisted-attempts.ts`, `src/lib/ai-engine/queue.ts`, `src/lib/ai-engine/types.ts`, `src/lib/jazmii/reference-image.ts`, `src/lib/jobs/video-worker.ts`, `src/lib/laxii/jobs.ts`, `src/lib/laxii/provider.ts`, `src/lib/laxii/worker.ts`, `tests/unit/laxii-hosted-edit.test.ts`, `workers/laxii-diffusers/worker.py`; and omits `src/lib/ai-engine/model-registry.ts`, `src/lib/intel/continuity.ts`, `src/lib/intel/grounding.ts`, `src/lib/jobs/image-worker.ts`, `src/lib/laxii/chat.ts`, `src/lib/laxii/dimensions.ts`, `src/lib/laxii/intent.ts`, `tests/unit/image-cancel-checkpoint.test.ts`, `tests/unit/image-throttle-parking.test.ts`, `tests/unit/laxii-custom-dimensions.test.ts`, `tests/unit/laxii-intent.test.ts`, `tests/unit/laxii-poster-hybrid.test.ts`.

## Appendix C — PR #4 conflicted paths (2, the screenshot-B set)

```
.gitignore
src/components/bean/laxii.tsx
```
