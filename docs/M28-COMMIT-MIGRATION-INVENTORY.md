# M28-SLM — Commit Migration Inventory

Milestone: **M28-SLM** · Date: 2026-11-21 · Base for all counts: actual Git objects, patch-ids computed with `git patch-id --stable` over `git diff-tree -p`.

Scope: every implementation, docs and WIP commit on the **old public lineage** above `eb8d314` (`eb8d314..main`, 38 commits), plus the 12 sanitized-side implementation commits (`4d134c5..e96d83a`). Nothing was inferred from commit messages alone: ancestry came from `merge-base --is-ancestor`, equivalence from patch-ids and file-blob presence, dependency from actual `import` statements at the M28 tip.

Legend: **F** = changed-file count, **+ins/−del** = insertions/deletions, **Sec** = security-sensitive categories hit (path-based classification), **On sanitized?** = whether the commit object (or an identical patch) already exists on the sanitized line, **Dep** = dependency position, **Order** = proposed migration order (see M28-FEATURE-DEPENDENCY-GRAPH.md).

Classification abbreviations used in §4: `IP` = already present identically, `EE` = present with equivalent implementation, `M` = missing entirely, `P` = partially present, `S` = superseded, `C` = conflicting implementation, `A` = requires manual adaptation, `NM` = must not be migrated.

## 1. Milestone-era commits, old line (`eb8d314..main`, newest first)

| # | SHA (full) | Short | Parents | Contained in | Date (author) | Msg | F | +ins/−del | Patch-ID | On sanitized? | Merge? | Sec | Dep | Technique | Order |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `6f0a2b07d441b7a5ca3b98199d7b65932a8c4dd6` | `6f0a2b0` | 88fa9b3 | main (tip) | 2026-11-21 | c6423191-ebe8-4c3e-b3f6-abb80f0b0d9b | 7 | +0/−0 | `e7851e88…` | NO (old-line only) | no | — | earlier commits in chain | A (owner decision) | 9 |
| 2 | `88fa9b3720387312ac066bfe069b495a263b4e3c` | `88fa9b3` | fc7ee8b | feat/m28-audio-reliability-quality, main | 2026-11-21 | docs(m28): git record amendment — workspace main-pinning incident and external remote change recorde | 1 | +2/−0 | `3ecd3ecd…` | NO (old-line only) | no | — | earlier commits in chain | A/D (base-file adaptations) | 7 |
| 3 | `fc7ee8bd0994f1af383c171b43ceeca6269b8277` | `fc7ee8b` | fcf0bf4 | main | 2026-11-21 | docs(m28): results report — 17-section owner record with precise status labels (Implemented / Verifi | 1 | +144/−0 | `0e8ba7be…` | NO (old-line only) | no | — | earlier commits in chain | A/D (base-file adaptations) | 7 |
| 4 | `fcf0bf4419b24d5b085385707f3db5a4fb341a3f` | `fcf0bf4` | 4bdca0b | main | 2026-11-21 | fix(gangzii): M28 — soundtrack UI types for the ducking result payload (tsc clean in src/) | 1 | +2/−1 | `c3a7e8e1…` | NO (old-line only) | no | — | earlier commits in chain | A/D (base-file adaptations) | 7 |
| 5 | `4bdca0b954c36f06cb807d4b45ab81db20863b81` | `4bdca0b` | 75db418 | main | 2026-11-21 | feat(gangzii): M28 UI — model-artifact provenance card + dynamic ducking controls (desktop/mobile in | 5 | +372/−4 | `2c8521eb…` | NO (old-line only) | no | — | earlier commits in chain | A/D (base-file adaptations) | 7 |
| 6 | `75db418281c3fa350327cebc5b6803cf9b1bfa6c` | `75db418` | 597daba | main | 2026-11-21 | feat(gangzii): M28 Priority G — Trust receipts carry the six distinct verification states + full aud | 3 | +219/−2 | `105bec24…` | NO (old-line only) | no | — | earlier commits in chain | A/D (base-file adaptations) | 7 |
| 7 | `597daba77977bfb852305d69b7eab94564474a83` | `597daba` | ce2dbb2 | main | 2026-11-21 | feat(jazmii): M28 Priority F — audio timeline synchronization with explicit review flags | 3 | +212/−42 | `eb0af82c…` | NO (old-line only) | no | — | earlier commits in chain | A/D (base-file adaptations) | 7 |
| 8 | `ce2dbb24cd6d8e9de20eda0afbf436aaf4f2074a` | `ce2dbb2` | ba93dc7 | main | 2026-11-21 | feat(gangzii): M28 Priority E — narration timing confidence vocabulary + honest forced-alignment eva | 12 | +336/−62 | `c8c48e63…` | NO (old-line only) | no | — | earlier commits in chain | A/D (base-file adaptations) | 7 |
| 9 | `ba93dc7369a9473f8cbb4c42160364d41649cdde` | `ba93dc7` | 02a35f4 | main | 2026-11-21 | feat(jazmii): M28 Priority D — real HyperFrames SFX integration on the pinned runtime's verified aud | 9 | +476/−21 | `193ae889…` | NO (old-line only) | no | media-access | earlier commits in chain | A/D (base-file adaptations) | 7 |
| 10 | `02a35f48c13f2e0fdcf90953d694a4b5299f3dda` | `02a35f4` | 735ab85 | main | 2026-11-21 | feat(gangzii): M28 Priority C — dynamic narration ducking with deterministic timeline automation | 9 | +660/−12 | `7d6d2e5f…` | NO (old-line only) | no | — | earlier commits in chain | A/D (base-file adaptations) | 7 |
| 11 | `735ab8538cc8339a5db10f7b74bde9addf789e09` | `735ab85` | 9a0a9f0 | main | 2026-11-21 | feat(gangzii): M28 Priority B — repeatable speech-quality evaluation suite + shared EBU R128 parser  | 8 | +1023/−23 | `4d8b7ff0…` | NO (old-line only) | no | media-access | earlier commits in chain | A/D (base-file adaptations) | 7 |
| 12 | `9a0a9f0d3e8562612ea73249c6710cd1d2534a26` | `9a0a9f0` | ae41561 | main | 2026-11-21 | feat(gangzii): M28 Priority A — model-artifact integrity verifier + canonical provenance utility | 6 | +1430/−17 | `a4dc9666…` | NO (old-line only) | no | — | earlier commits in chain | A/D (base-file adaptations) | 7 |
| 13 | `ae4156157348720fb74f68b26f1325089813f9cf` | `ae41561` | e983c41 | main | 2026-11-21 | feat(gangzii): M27 audio production engine — local Kokoro-82M TTS, narration studio, soundtrack mixi | 64 | +6650/−118 | `078b3f30…` | NO (old-line only) | no | auth-session,db-schema | earlier commits in chain | D (schema+lock merge, base-file adaptations) | 6 |
| 14 | `e983c41b9393217508d9632fbeaadaaa6dc7acc6` | `e983c41` | 8de0144 | feat/trust-specialist-coverage, feat/gangzii-audio-production, main | 2026-11-20 | feat(trust): specialist coverage — every supported execution path settles honest receipts | 17 | +2329/−26 | `32783f33…` | NO (old-line only) | no | — | earlier commits in chain | A (fallback B) | 5 |
| 15 | `8de01444bba53d56c278d1a91eda9e9cd251a56a` | `8de0144` | 4ab7f03 | feat/jazmii-auto-director, main | 2026-11-20 | test(jazmii): explicit timeouts for real-render composition tests (CPU-contention safe) | 1 | +3/−3 | `7470a44c…` | NO (old-line only) | no | — | earlier commits in chain | A/D (schema+lock merge on d2d6a4a3, f91096e1) | 4 |
| 16 | `4ab7f036ce1d9686a43d5de3dcbbb1dad61e2f28` | `4ab7f03` | f91096e | main | 2026-11-20 | fix(jazmii): OOM-lean composition presets + composition checkpoint resume | 6 | +566/−2 | `290d6a8a…` | NO (old-line only) | no | — | earlier commits in chain | A/D (schema+lock merge on d2d6a4a3, f91096e1) | 4 |
| 17 | `f91096e110eba12357418f7228a503751d0dbd98` | `f91096e` | 91fb59c | main | 2026-11-20 | test(jazmii): Auto Director verification suite + pinned HyperFrames dependency | 10 | +1375/−5 | `3ca42815…` | NO (old-line only) | no | — | earlier commits in chain | A/D (schema+lock merge on d2d6a4a3, f91096e1) | 4 |
| 18 | `91fb59cf44ea3c8b3aa5f5f53d4187eac70e42d1` | `91fb59c` | d2d6a4a | main | 2026-11-20 | feat(jazmii): Auto Director API + workspace UI | 10 | +1225/−4 | `b2200a4d…` | NO (old-line only) | no | — | earlier commits in chain | A/D (schema+lock merge on d2d6a4a3, f91096e1) | 4 |
| 19 | `d2d6a4a3ce0d18faed8e5215430d5d2bbabe7293` | `d2d6a4a` | 3a28bfe | main | 2026-11-20 | feat(jazmii): Auto Director production orchestration on the durable queue | 5 | +1075/−0 | `164a273d…` | NO (old-line only) | no | db-schema | earlier commits in chain | A/D (schema+lock merge on d2d6a4a3, f91096e1) | 4 |
| 20 | `3a28bfe85cb3d3cf36c3b462c9c79b760fc846cb` | `3a28bfe` | e025495 | main | 2026-11-20 | feat(jazmii): Auto Director foundation — storyboard schema, Creative Director planner, composition e | 7 | +1879/−0 | `b3e500c8…` | NO (old-line only) | no | — | earlier commits in chain | A/D (schema+lock merge on d2d6a4a3, f91096e1) | 4 |
| 21 | `e0254951d74494b3b6e95dde25561540942c70cd` | `e025495` | 2a9b4cb | main | 2026-11-20 | docs(m2615r2c): M26.1.5-R2.2 recovery re-delivery milestone record | 11 | +1570/−0 | `770a4c16…` | NO (old-line only) | no | — | earlier commits in chain | A | 8 |
| 22 | `2a9b4cbd9d5baebe9aefc3a3006191bf27efa63f` | `2a9b4cb` | 7a64e18 | main | 2026-11-20 | feat(trust): Phase 1 — executor checkpoint resume + product adapters | 14 | +1948/−37 | `d8a0ac07…` | NO (old-line only) | no | — | earlier commits in chain | A (fallback B/D) | 3 |
| 23 | `7a64e18cf1a96ec399181959666f120293c9960d` | `7a64e18` | ea1e074 | main | 2026-11-20 | docs(feb2027): completion report — final commit graph + workspace-recycle incident record | 1 | +29/−6 | `c46b6eae…` | NO (old-line only) | no | — | earlier commits in chain | A/B | 2 |
| 24 | `ea1e074dba38a163499767e855d839b53af395ac` | `ea1e074` | 6145578,2bf9f7b | main | 2026-11-20 | merge(trust): consolidate Trust Engine implementation with February 2027 docs (local working branch  | 22 | +0/−0 | `n/a (merge)` | NO (old-line only) | yes | db-schema | earlier commits in chain | structural | — |
| 25 | `2bf9f7be45b9342e6289137dd3164beed02673ad` | `2bf9f7b` | 826bf8c | feat/feb2027-trust-engine, main | 2026-11-20 | docs(feb2027): February 2027 launch documentation set | 10 | +597/−0 | `f4efa906…` | NO (old-line only) | no | — | earlier commits in chain | structural | — |
| 26 | `826bf8c8e383e293a4d3dd4ffde01aad476e3479` | `826bf8c` | c472668 | main | 2026-11-20 | feat(trust): Trust Engine foundation — truthful lifecycle, execution receipts, scoped approvals, che | 21 | +2993/−0 | `7e9f9f34…` | NO (old-line only) | no | db-schema | none (base) | D | 1 |
| 27 | `614557864e04c803a9e07d7d145ee5ab0bbede53` | `6145578` | b1a21c2 | backup/feb2027-presplit-main, main | 2026-11-20 | docs(feb2027): completion report with exact evidence (Phase 0 + Phase 1 foundation) | 1 | +118/−0 | `534f9f5a…` | NO (old-line only) | no | — | none (base) | A/B | 2 |
| 28 | `b1a21c2a4306086d2adfb12c9c9cc1f1645e15be` | `b1a21c2` | c472668 | main | 2026-11-20 | docs(feb2027): February 2027 launch documentation set | 10 | +597/−0 | `f4efa906…` | NO (old-line only) | no | — | none (base) | A/B | 2 |
| 29 | `c4726683736cb48d320ac897bfb50731b8470706` | `c472668` | f9d0e33 | main | 2026-11-19 | 7202184d-5426-4790-9866-f5172fb28feb | 8 | +939/−0 | `ba4d77f6…` | NO (old-line only) | no | — | earlier commits in chain | A (owner decision) | 9 |
| 30 | `f9d0e332228a6a5b54f5b9393214e4ac8c03d381` | `f9d0e33` | d15b3af | main | 2026-11-19 | f879c965-47b6-450c-8399-8f9ecdb3545d | 33 | +6545/−0 | `3cf2f9c7…` | NO (old-line only) | no | — | earlier commits in chain | A (owner decision) | 9 |
| 31 | `d15b3af53203b7eb085f4357ba003227bbc3f603` | `d15b3af` | 4accc6d | main | 2026-11-18 | 8576428d-4e94-4ba5-a5d9-3e1b2a9a3fa1 | 6 | +819/−0 | `19636253…` | NO (old-line only) | no | — | earlier commits in chain | A (owner decision) | 9 |
| 32 | `4accc6d9a3a8668b91def8cb9297dd4990285c30` | `4accc6d` | d2e2dbd | main | 2026-11-18 | d305b0d4-a8c0-43ca-8a34-b5f33e037c6c | 2 | +308/−0 | `1e031f42…` | NO (old-line only) | no | — | earlier commits in chain | A (owner decision) | 9 |
| 33 | `d2e2dbde0a7b1e1ae97c13be60b9a31c6a673101` | `d2e2dbd` | b85ba9c | main | 2026-11-18 | ac161a25-36b7-4f9e-b769-74706c823ea9 | 2 | +413/−0 | `d40c0f5f…` | NO (old-line only) | no | secret-named-path | none (base) | B (content transplant after owner sign-off) | 10 |
| 34 | `b85ba9c72e4e4c9b1e26dd129c3bfb7b4a2b0fd5` | `b85ba9c` | 6d72f15 | main | 2026-11-18 | 3ec01241-6251-4e51-a689-379ee529a157 | 2 | +395/−0 | `c85a08ba…` | NO (old-line only) | no | secret-named-path | none (base) | B (content transplant after owner sign-off) | 10 |
| 35 | `6d72f155eece497501e27d7317630dc9a4249d7d` | `6d72f15` | 77230c5 | main | 2026-11-18 | 6e4579a7-4d07-43c9-aa10-60d009e0ef3f | 1 | +104/−0 | `6154b081…` | NO (old-line only) | no | — | none (base) | A (owner decision) | 9 |
| 36 | `77230c5baf8b11d106f73e30fdaeac6df333086a` | `77230c5` | 9fc1591 | main | 2026-11-18 | docs(m26.1.4): publication blocked pending owner gates — all local verification PASS (AI branch 4114 | 6 | +607/−0 | `acb33e11…` | NO (old-line only) | no | — | none (base) | A | 8 |
| 37 | `9fc15916d2ab1c30cf148c6d8177a62013566b40` | `9fc1591` | 28e034d | main | 2026-11-17 | docs(m26.1.3): recovery reconstructed byte-identical to lost records; rewrite exactly reproduced (ab | 7 | +915/−0 | `84c8e8d7…` | NO (old-line only) | no | — | none (base) | A | 8 |
| 38 | `28e034d37ba83ba78ec962485938a92ab804bbe6` | `28e034d` | eb8d314 | main | 2026-11-17 | docs(m26.1.2): publication gate closure verdict C — M26.1.1 recovery material and rewrite clone lost | 4 | +666/−0 | `24a825a4…` | NO (old-line only) | no | — | none (base) | A | 8 |


Notes on specific rows:

- **`ea1e074d` (merge)** is structural: its content reaches the sanitized line through its parents — `6145578` (G2 docs) and `826bf8c` + `2bf9f7b` (G1/G2). The merge object itself is never transplanted (policy: no merge-commit cherry-picks).
- **`2bf9f7b` ≡ `b1a21c2`**: the only patch-id collision found in the entire inventory (`f4efa906d11ac3af8286f36a970b44e88debb0c4`). The February 2027 documentation set was committed twice (trust-engine branch and presplit main) and reconciled by `ea1e074d`. It must be migrated **once**.
- **`6f0a2b0`** (local main tip) adds 7 PNG UI-evidence screenshots (+0/−0 lines, binary) — pure WIP evidence, no code.
- WIP auto-commits `6d72f15`, `b85ba9c`, `d2e2dbd`, `4accc6d`, `d15b3af`, `f9d0e33`, `c472668` carry ~10.5k lines of M26.1.4/M26.1.5-R2/PR1 recovery records, bundle scripts and credential-forensics docs. Their content rides in the ancestry of `826bf8c`; if only named commits are transplanted, this content is **lost** — hence group G9/G10 decisions (see §3, §4).
- Infrastructure touchpoints (conflict surface with the sanitized base): `826bf8c`, `d2d6a4a3` and `ae41561` modify `prisma/schema.prisma`; `f91096e1` pins `hyperframes@0.9.72` in `package.json` + `bun.lock`; `ae41561` adds `kokoro-js@1.2.1` in `package.json` + `bun.lock`.

## 2. Sanitized-side implementation commits (`4d134c5..e96d83a`) — already present, not migration candidates

| # | SHA (full) | Short | Parents | Contained in | Date | Msg | F | +ins/−del | Sec | Role |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `e96d83a5196f45712350aaf41d13a1e5dfcebae7` | `e96d83a` | 18c93ed,8f61599 | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-21 | Merge feat/m26-2-media-capabilities into fix/laxii-image-output-ux — local reconciliation of PR #4 ( | 82 | +0/−0 | db-schema,git-workflow,media-access,worker-execution | PR #4 local reconciliation (merge) — migration BASE |
| 2 | `8f61599271b1aa66e86a2c4956f6dc01eef8b737` | `8f61599` | 99b2470 | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-18 | docs(m26.2): results, model integration contract and deployment guide — real-inference validation ev | 3 | +450/−0 | — | M26.2 results docs |
| 3 | `99b2470996110f383b43964d7bf9cc4851d4ceb2` | `99b2470` | 4114371 | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-18 | feat(m26.2): LAXII + JAZMII full capability activation — real local inference lanes | 49 | +4809/−63 | db-schema,git-workflow,logging,media-access,worker-execution | M26.2 LAXII+JAZMII capability activation |
| 4 | `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064` | `18c93ed` | 0330a6c | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-18 | docs(m26.3): results, aspect-ratio root cause (measured provider contract), image viewer contract an | 1 | +16/−9 | — | M26.3 results docs |
| 5 | `0330a6c71cd36a7070113d7332e70c1a47a4e234` | `0330a6c` | 9db41fe | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-18 | fix(laxii): exact aspect ratios on the provider's measured size contract, in-app image viewer, water | 34 | +1634/−70 | logging | M26.3 aspect-ratio + lightbox + watermark |
| 6 | `9db41fe7c704f17dbcddc1c46359f273272a0fd5` | `9db41fe` | 4114371 | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-18 | fix(build): restore the llama.cpp engine client source swallowed by the local-* ignore pattern — com | 2 | +232/−0 | git-workflow | llama.cpp client source restore |
| 7 | `411437144ee01abac07d7f0693cfaac0f6101e41` | `4114371` | 37f6f85 | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-18 | docs: six operationalization deliverables + README accuracy corrections | 3 | +216/−6 | — | six operationalization deliverables |
| 8 | `37f6f8518459bf9fd1dbb2f2e128c7d1ce0d0bb5` | `37f6f85` | 2cb249b | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-18 | build+test: consolidated validation fixes — Turbopack OOM root-caused & fixed | 18 | +999/−376 | git-workflow | Turbopack OOM fix + validation |
| 9 | `2cb249b22c38ebdeb3e877581be347bd015b1e16` | `2cb249b` | afe63c4 | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-18 | test(client-compute): pin the new inference contracts | 4 | +298/−0 | — | client-compute inference contract pins |
| 10 | `afe63c432b3003a580a6a5e0efaf87eec93d0e8f` | `afe63c4` | 7eb7912 | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-18 | feat(ui): AI Device settings + on-device lanes wired into RIISHE & GANGZII | 8 | +975/−19 | — | AI Device settings + on-device lanes |
| 11 | `7eb7912e6e48617805c8e137e32f39dc2a0afa88` | `7eb7912` | 5167c7b | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-18 | feat(client-compute): universal browser AI inference core (Tier A/B) | 18 | +2606/−22 | — | universal browser AI inference core |
| 12 | `5167c7b1579e4843a5dcb1cd6f02d7bdba91114a` | `5167c7b` | 4d134c5 | reconcile/pr4-m262-into-m263 + ancestors | 2026-11-18 | feat(gangzii): wire the orphaned audio product to real execution | 17 | +944/−20 | auth-session | GANGZII wired to real execution (pre-M27) |


All 12 are contained in `reconcile/pr4-m262-into-m263` (the migration base `e96d83a`), so none of them is a migration candidate. They are listed because they define what the sanitized base already provides — see §4.

## 3. Patch-identity and file-presence evidence

Patch-id index over 50 commits (38 milestone + 12 sanitized): **49 unique patch-ids, exactly 1 collision** (`2bf9f7b` ≡ `b1a21c2`). No milestone implementation commit is patch-identical to any sanitized-side commit — the milestone work is genuinely absent from the sanitized line.

File-level presence of the milestone content in the sanitized tree (`e96d83a`):

| Range | Changed files | Already present in `e96d83a` tree (modifications of base files) | New files (absent) |
|---|---|---|---|
| Trust foundation + Phase 1 + specialist (`826bf8c`, `2a9b4cb`, `e983c41`) | 21 / 14 / 17 | workers, riishe chat handler, giftz workspace, laxii jobs, tasks UI | entire `src/lib/trust/*` core, `docs/feb2027/*`, trust API routes |
| JAZMII Auto Director ×6 | 7 / 5 / 10 / 10 / 6 / 1 | `video-worker`, `queue`, ffprobe-adjacent files | entire `src/lib/jazmii/director/*`, `director-worker`, `jazmii-director.tsx`, director API routes |
| M27 (`ae41561`) | 64 | 27 (incl. `src/lib/jobs/audio-worker.ts`, `hosted-audio`, `gangzii.tsx`, `shell.tsx`) | 37 (entire local-TTS stack: `gangzii/tts-engine`, `narration-service`, `text-normalize`, narration/soundtrack UI, 9 gangzii API routes, 3 director-audio routes, kokoro scripts, M27 docs) |
| M28 ×11 | 39 across 11 commits | 2 (`audio-worker.ts`, `media/ffprobe.ts`) | 37 (ducking, timing, model-integrity, loudness parser, trust `adapters/audio` extension, speech-eval suite, provenance card UI, M28 docs) |

`docs/feb2027/` (10 files) does **not** exist on the sanitized tree — no collision for G2. The six operationalization deliverables (`BEAN_AI_*`, `BEAN_DEVICE_COMPUTE_PRIVACY.md`, `BEAN_UNIVERSAL_AI_ARCHITECTURE.md`) **are** already present at the sanitized root (delivered by `4114371`) — do not re-migrate their content.

## 4. Classification per feature

| Feature | Sanitized base state | Class | Evidence |
|---|---|---|---|
| M21–M25 product work, M26 reliability, M26.1 security closure | Present as sanitized rewrite (whole chain `78ba13bd…aba5d4b9` + shared base) | IP/EE | rewritten pairs documented in M28-SANITIZED-LINEAGE-MAP.md §2; base tree compiles per PR4 record |
| Six AI operationalization commits | Present (`5167c7b…4114371`) | IP | sanitized-side table §2 |
| M26.2 media capabilities (sanitized-side label) | Present (`99b2470`, `8f61599`) | IP | sanitized-side table §2 |
| M26.3 image-output UX | Present (`9db41fe`, `0330a6c`, `18c93ed`) | IP | sanitized-side table §2 |
| PR #4 integration | Present as local merge `e96d83a` | IP | verified §3 of lineage map |
| February 2027 documentation set | Missing (`docs/feb2027/` absent) | M (migrate once — twin `2bf9f7b`≡`b1a21c2`) | patch-id collision; tree check |
| Trust Engine foundation (schema, lifecycle, receipts, approvals, checkpoints) | Missing entirely | M | `src/lib/trust/*` absent from `e96d83a` tree |
| Trust Phase 1 checkpoint resume + product adapters | Missing entirely (workers exist; wiring absent) | M + A | worker files present, trust imports absent |
| JAZMII Auto Director (storyboard, planner, composition, API, UI) | Missing entirely | M | `src/lib/jazmii/director/*` absent |
| Trust specialist coverage (M26.2 old-line label) | Missing entirely | M | `docs/M26.2-TRUST-SPECIALIST-COVERAGE-REPORT.md` absent; receipt wiring absent |
| M27 GANGZII audio production | Missing (27 of 64 files are base-file modifications → adaptation) | M + A | §3 file table; audio-worker/hosted-audio/gangzii.tsx conflict surface |
| M28 audio reliability & creative quality | Missing (2 of 39 files are base modifications) | M + A | §3 file table |
| GANGZII hosted-lane wiring (`5167c7b`, sanitized) | Present; M27 builds the local engine on top | EE (superseded in behavior by M27, not a conflict — different modules) | M27 touches `audio-worker.ts` which contains hosted-lane code → merge review |
| Recovery/operations records (G8: `e0254951`, `28e034d`, `9fc1591`, `77230c5`) | Missing (docs + scripts) | M | docs-only, no collisions expected |
| WIP snapshots (G9: `f9d0e33`, `d15b3af`, `4accc6d`, `c472668`, `6d72f15`, `6f0a2b0`) | Missing | M, owner decision | M26.1.4/PR1/R2 records, bundle scripts, M26-publish scan, 7 PNGs |
| Credential-forensics WIP docs (G10: `b85ba9c`, `d2e2dbd`) | Missing | M, owner sign-off | pattern scan: only `sk-disposable` fixture vocabulary, 0 real-key-shaped values |
| Old-line M26/M26.1 originals + M26.1.1-4 rewrite saga originals | Present on sanitized as rewritten copies | NM (originals must not be imported) | containment matrix; historical session-token/cookie content lives in these objects |

## 5. Security-sensitive classification (path-based, per commit)

Categories flagged across the inventory: `auth-session` (`ae41561` — gangzii asset file route), `db-schema` (`826bf8c`, `d2d6a4a3`, `ae41561` — prisma), `media-access` (`ba93dc73`, `735ab853`, `e96d83a`), `worker-execution` (`99b2470`, `e96d83a`), `git-workflow` (`9db41fe`, `37f6f85`, `99b2470`, `e96d83a`), `logging` (`0330a6c`, `99b2470`), `secret-named-path` (`b85ba9c`, `d2e2dbd` — credential-forensics docs).

Secret-value scan over every milestone commit diff (10-class pattern: `sk-…`, `ghp_…`, `xox…`, `Bearer …`, `AKIA…`, key/secret/token/password assignments): **15 hits total, all adjudicated benign** — the documented `sk-disposable-<uuid>` harness fixture class, fixture regex literals, and a prose mention (`SK-VALIDATED`). Zero real-key-shaped values. Per-commit: `b85ba9c` 7, `f9d0e33` 3, `28e034d` 2, `d2d6a4a` 1, `d2e2dbd` 1, `9fc1591` 1. The historical temporary inspection-account credential occurrence lives in old-lineage objects that are **not** migration candidates (NM class); no proposed content migration carries it.

The historical sensitive-path inventory (session-token files, session-cookie jars, `storage/` media, provider credential vault) was compared against every proposed migration group: G1–G8 touch none of the quarantined paths as *content*; the prisma-schema merges are structural, not data.

## 6. Machine-readable companion

`docs/M28-MIGRATION-MANIFEST.json` encodes every item above (source SHA, destination base, feature, predecessors, technique, full file paths, security review status, verification requirements, migration status). It is generated from the same captured evidence (`scripts/m28slm-out/inventory.json`) and is the authoritative per-item record; this document is the human-readable view.
