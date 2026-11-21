# M29 — Sanitized Implementation Migration Report

Milestone: **M29** · Date: 2026-11-21 · Authorization: **owner-approved G1–G7 execution, 21 November 2026** · Publication: **PROHIBITED (local commits only)**

Every claim below is backed by a command output captured during execution. Nothing is inferred from a summary. The migration manifest (`M28-MIGRATION-MANIFEST.json`, extended with `migration_results`) is the authoritative per-item record; original inventory fields are preserved byte-intact.

## 1. Executive summary

| Metric | Value |
|---|---|
| Groups attempted | G1–G7 (G8/G9/G10 outside authorization — not touched) |
| Groups completed | **7 of 7** |
| Groups partially completed / blocked | 0 / 0 (G6's real-TTS smoke is environment-blocked — see §6) |
| Items migrated | **24 of 24 in-scope** (manifest total 36; 12 items in G8–G10 excluded) |
| File paths migrated | 225 per-item paths, **153 unique files** |
| Destination commits | 8 (7 group commits + 1 test-surface adaptation) |
| Old-lineage commits imported into destination | **0** (set-level proof over 236 candidates, §4) |

## 2. Destination lineage

- Branch: `reconcile/sanitized-m27-m28-migration`
- Base: `e96d83a5196f45712350aaf41d13a1e5dfcebae7` (PR #4 local reconciliation — verified sanitized integration candidate; parents `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064` + `8f61599271b1aa66e86a2c4956f6dc01eef8b737`, merge-base `4114371`)
- Head: `d2c232a6fa225644e91e967d2148558ba67b9679`
- Commit chain (each with a single sanitized parent):

| Commit | Content | Source material |
|---|---|---|
| `bce2779` | M28-SLM planning documents (pre-existing) | — |
| `fb03ea5` | Preservation report (pre-existing) | — |
| `953c752` | G1 — Trust Engine foundation | `826bf8c8e383e293a4d3dd4ffde01aad476e3479` |
| `75ef989` | G2 — February 2027 launch documentation | `b1a21c2a4306086d2adfb12c9c9cc1f1645e15be`, `614557864e04c803a9e07d7d145ee5ab0bbede53`, `7a64e18cf1a96ec399181959666f120293c9960d` |
| `b429132` | G3 — Trust Phase 1 checkpoint resume + product adapters | `2a9b4cbd9d5baebe9aefc3a3006191bf27efa63f` |
| `30c14a4` | G4 — JAZMII Auto Director (6 commits) | `3a28bfe8…`, `d2d6a4a3…`, `91fb59cf…`, `f91096e1…`, `4ab7f036…`, `8de01444…` |
| `b8a4427` | G5 — Trust specialist coverage | `e983c41b9393217508d9632fbeaadaaa6dc7acc6` |
| `a0d52b2` | G6 — M27 GANGZII audio production engine | `ae4156157348720fb74f68b26f1325089813f9cf` |
| `9303a56` | G7 — M28 audio reliability & creative quality (11 commits) | `9a0a9f0d…` → `88fa9b37…` chain |
| `d2c232a` | G5 test-surface adaptation (post-verification fix) | — |

## 3. Migration technique record

All 24 items used **content-only transplantation** (manifest techniques A/B/D as flagged): per file, either (a) new-file copy from the source blob, or (b) `git diff <src>^ <src> -- <file>` applied with `git apply -3` onto the sanitized worktree file (3-way merge: base = source pre-image, ours = sanitized version, theirs = source post-image). No merge commit was transplanted (`ea1e074d` excluded; G2's `7a64e18` taken file-wise). No old `.git` content copied; no wholesale file replacement without review; no schema conflict suppressed by field dropping.

Semantic conflict resolutions (all reviewed, none blanket ours/theirs):

1. **prisma/schema.prisma** (G1): union — sanitized `LaxiiEditHistory` kept AND trust models added; later additive merges for director (G4) and audio (G6) models. `prisma validate` after each schema-bearing group; client regenerated.
2. **registry/backends.ts** (G4, G6): union of backend descriptors; the M27 audio descriptor set adopted after auditing that every measured constraint survived (TTS 6000/1024 chars, 24 kHz mono, speed 0.5–2.0, 7-voice set; ASR wav/webm, 25 MB, plain-text transcript); same-id stage-0 predecessors removed to avoid duplicate declarations; a comment-block opener restored after the union; formats honestly narrowed to the implemented WAV/MP3/M4A conversion set.
3. **ai-engine/handlers.ts** (G4, G6): union imports (G4); M27 unified `processAudioJob` handler set including `audio-production` (G6).
4. **next.config.ts** (G4, G6): three capabilities preserved — `BEAN_BUILD_NO_STANDALONE` conditional output, sanitized turbopack root scoping (documented OOM fix), old-line `outputFileTracingExcludes`; `serverExternalPackages` union (browser-AI externals + M27 local-TTS stack); a G4-era duplicate `output:` key cleaned.
5. **router/router.ts** (G6): M27 audio adapter entries adopted AND sanitized M26.2 local-inference-lane health entries preserved; a **pre-existing sanitized-base syntax defect** in the segmentation-lane template literal (missing `[`, misspelled variable, present since `8f61599`) was repaired (byte-verified before/after).
6. **laxii/jobs.ts** (G5): the hosted-edit completion path runs BOTH the sanitized `recordEditHistory` (undo/restore ledger) AND G5's `recordMediaJobCompletion` receipt — no feature dropped on either side.
7. **shell.tsx / page.tsx** (G6): M27 GANGZII mount adopted; sanitized AI-Device view and nav entry kept; duplicate `AudioLines` import removed.
8. **core.test.ts / queue-unwired-tasks.test.ts** (G4, G6): M27 expanded task sets and restructured wake expectations; duplicate declaration resolved in favor of the M27 superset.
9. **config.ts / queue.ts / ratelimit.ts** (G6): M27 measured values (gangzii pool 1; wake list `as const`; 20/min, 300/day).
10. **video-worker.ts** (G3, G5): sanitized local-I2V imports kept; trust media-receipt import superseded to the fuller G5 set.

Dependency/lockfile reconciliations: `hyperframes@0.9.72` (G4) and `kokoro-js@1.2.1` (G6) added onto the sanitized lock. Audits found **0 downgrades and 0 removals**; version transitions were 3 upgrades at G4 (acorn 8.19.0, citty 0.2.2, giget 3.3.1) and 0 at G6. `bun install --frozen-lockfile --dry-run` passes; `bun install` completed (929 + 40 packages) and `kokoro-js@1.2.1` resolves.

## 4. Git verification (all commands executed against the migration worktree)

- `git merge-base --is-ancestor e96d83a… HEAD` → true (base is ancestor).
- `git rev-list e96d83a…..HEAD` → exactly 10 commits (2 planning docs + 7 groups + 1 test fix) — every migration source maps to its documented destination commit.
- **Set-level old-lineage proof**: the old-line-only commit set (`git rev-list 6f0a2b0 ^ 4d134c5`, 236 commits — includes `a0148628`, `91a6809`, `443b6f2f`, `ea1e074d`, old M26.1.x originals, all WIP auto-commits, all milestone originals) was tested with `git merge-base --is-ancestor <sha> HEAD`: **0 leaked**.
- Spot checks: `a0148628…`, `91a6809…`, `ea1e074d…`, and every source commit root NOT ancestors of HEAD.
- `git diff --check` clean at every group commit; per-group secret scans clean (only pre-existing disposable-fixture vocabulary hit patterns elsewhere in the tree, consistent with the PR #4 record).
- All 14 pre-existing backup branches byte-identical to their pre-migration values (including `backup/pr4-base-18c93ed`, `backup/pr4-head-8f61599`, `backup/m262-media-capabilities`, `backup/m263-image-output-ux`); 8 new `backup/m29-pre-*` refs created as recovery points (one per group + pre-migration).
- Old main worktree untouched: HEAD `6f0a2b07…` before and after; status clean (one untracked local helper script `scripts/m29_transplant.py`, recorded in §7).
- Remote-tracking refs unchanged: `origin/main` → `91a68090…`, `origin/feat/laxii-jazmii-restoration` → `e7d7003f…`, `origin/feat/m26-2-media-capabilities` → `8f61599…`, `origin/fix/laxii-image-output-ux` → `18c93ed…`. No fetch, no push, no remote operation of any kind.
- **Explicit statement: no old-lineage commit was imported into the destination history.**

## 5. Application verification

| Check | Result |
|---|---|
| Prisma schema validation | Valid after every schema-bearing group (G1, G4, G6) |
| Prisma client generation | Regenerated after G1, G4, G6 |
| Migration consistency | No `prisma/migrations` directory changes; additive-schema policy preserved (no production migration executed, no data-loss operation) |
| Unit suite (full, `bun test --isolate tests/`) | **2449 pass / 0 fail** (187 files, 40,656 expect calls) |
| Baseline comparison (detached worktree at `e96d83a`) | **2227 pass / 0 fail** (164 files) — exactly matches the recorded PR #4 reconciliation evidence; the migration adds 222 tests, all passing |
| TypeScript (`tsc --noEmit`) | `src/` errors = the 3 documented pre-existing baseline errors only (asr-worker union limit; webllm-worker optional dependency ×2); zero migration-introduced errors |
| ESLint (full) | Identical totals to baseline: 186 problems (45 errors, 141 warnings) — all pre-existing patterns; zero new |
| Production build (`next build`, `BEAN_BUILD_NO_STANDALONE=1`) | **exit 0 — ✓ Compiled successfully**, full route table emitted; one non-fatal trace-time note (`kokoro-js/package.json` dynamic-resolution warning inside `tts-engine.ts` version detection) |
| Integration e2e (audio worker) | Honest SKIP path (model artifacts absent in this environment; the test refuses mocks by design) — 2 pass / 0 fail |
| M28 provenance utility suite | 4/4 pass; the utility itself runs and honestly reports NOT-INSTALLED |
| Secret scan (per group + final) | Clean |

Test-execution note: one intermittent full-suite flake was investigated to root cause — the reach-lane pipeline tests are wall-clock-budget sensitive under full-suite CPU contention (they pass in isolation, with neighbors, and in the final full run; a 20s runner budget also passes). Separately, the G5-migrated `laxii-image-failure-receipts` test needed a one-line mock adaptation (commit `d2c232a`) because the sanitized image-worker imports M26.3's `unwantedTextDefects`, which the old-line test predates; the mock now matches the pattern used by the three existing sanitized suites.

## 6. Product regressions (evidence-backed)

| Path | Evidence | Status |
|---|---|---|
| Trust Engine task lifecycle / receipts / recovery | trust suites 80/80 (G3) + receipts 101/101 (G5) + full-suite trust tests | Implemented, Migrated, Verified (unit + integration surfaces) |
| RIISHE background + interactive chat receipts | riishe handler/route wiring in G1/G3; receipt suites | Implemented, Migrated, Verified (test surface) |
| CODE GIFTZ file operations + background coding | giftz/workspace + coding-handler receipts (G5); background receipt suite | Implemented, Migrated, Verified (test surface) |
| LAXII image operations | image-worker receipt wiring (G3/G5); laxii failure-receipt suite 6/6; m263 output suite | Implemented, Migrated, Verified (test surface) |
| JAZMII actual video generation | video-worker real lanes preserved (sanitized M26.2 I2V imports kept through G3/G5 unions); video receipt suites | Implemented, Migrated, Verified (test surface) |
| JAZMII Auto Director scene regen + composition recovery | director suite 32/32 incl. checkpoint-resume and real-media pipelines | Implemented, Migrated, **Verified end-to-end (real ffmpeg renders)** |
| HyperFrames pinned-render composition | REAL e2e: `hyperframes@0.9.72` + managed headless Chrome; 10 s planned = 10 s measured; ffprobe-verified h264 | **Verified end-to-end (real render)** |
| GANGZII real Kokoro speech generation | Code + engine + registry migrated and unit-verified; model artifacts ABSENT in this sandbox (pre-existing recycle loss); download blocked by HF 429 per-IP | **Blocked (environment)** — no quality/provenance claim made |
| GANGZII audio editing/exports | narration/convert/production worker + loudness/true-peak units | Implemented, Migrated, Verified (test surface); real-run blocked as above |
| GANGZII→JAZMII narration synchronization | timing confidence + timeline sync suites (G7) 56/56 | Implemented, Migrated, Verified (test surface) |
| M28 model-integrity verification | verifier + utility migrated; runs; reports NOT-INSTALLED honestly | Implemented, Migrated; canonical HF checksum verification remains PENDING (owner-preserved state) |

## 7. Preservation record

- **Recreated after recycle loss (pre-migration discovery):** both reconciliation worktree directories (`worktrees/pr4-reconcile`, `worktrees/m28-slm`) were found destroyed by workspace recycling at M29 start — branch refs unaffected (they live in the main `.git`); both recreated at the same paths/branches (`e96d83a` / `fb03ea5`) before any migration work. The M28-SLM all-refs bundle (`recovery/m28slm/`) and the m28slm analysis scripts were also lost to the same recycle event (pre-existing condition, now documented).
- **New recovery bundle:** `recovery/m29/bean-m29-pre-migration-allrefs-20261121.bundle` (224,439,531 bytes; SHA-256 `fb378343c7c2883454f82efbcd33f431010ffaa200cca3db34cb003403d28aee`; `git bundle verify` → complete history) — captures BOTH lineages and every ref at the pre-migration state. Treat as sensitive recovery material, not a publication artifact.
- **New backup refs:** `backup/m29-pre-migration` + `backup/m29-pre-g1…g7` (8 refs, none overwriting an existing name).
- **All old-lineage branches, milestones, backups, scratch ref, recovery manifests: preserved untouched.** G8/G9/G10 content (including the credential-forensics docs, D3) NOT migrated.
- **Worktrees at finish:** `main` @ `6f0a2b0` (untouched), `pr4-reconcile` @ `e96d83a`, `m28-slm` @ `d2c232a` (migration), plus `baseline-check` (detached @ `e96d83a`, created for the baseline verification runs — retained as verification evidence; removable only by future authorized cleanup).
- **Local-only artifacts (git-excluded/untracked, recycle-prone):** `scripts/m29_transplant.py` (transplant helper), `scripts/m29_manifest_results.py` (manifest results writer), `/tmp/reach-probe*.test.ts` (flake investigation), hard-linked `node_modules` copy + `tsconfig.tsbuildinfo` inside `worktrees/baseline-check`.
- **Model artifacts:** `storage/models/hf/onnx-community/Kokoro-82M-v1.0-ONNX` absent (pre-existing loss; download script blocked by HF rate-limit). No model weights are committed to Git (policy preserved).

## 8. Owner decisions recorded

- **D1 RESOLVED** — sanitized lineage canonical; old lineage archival/read-only (owner approval executed; sub-decisions recorded in `M28-OWNER-DECISIONS.md`).
- **D6 RESOLVED** — branch/commit/tree inspection completed; anomaly confirmed and documented; migration sourced from the actual M27 commit `ae41561`; branch pointer untouched.
- **D2, D3, D4 remain pending** — WIP snapshots, credential-forensics docs and scratch ref untouched (outside authorization).
- **D5 policy applied** — historical old-line SHA references kept verbatim as provenance in migrated documentation.
- **D7 unchanged** — remote PR #4 remains open; no remote action.

## 9. Publication statement

- No push. No PR merge. No PR closure. No remote branch deletion. No history rewrite. No force-push. No remote main update. No publication-freeze bypass. **Remote refs unchanged** (verified against the independently recorded `ls-remote` values from the M28-SLM preservation report).
- The recovery / collaborator-notification / credential-confirmation gates remain open and untouched.
- The destination branch is a complete BEAN Intelligence implementation on clean sanitized ancestry, ready for later owner-reviewed publication — not a premature GitHub update.
