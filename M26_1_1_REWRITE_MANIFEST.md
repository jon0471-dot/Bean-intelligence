# M26.1.1 REWRITE MANIFEST — Controlled Git History Sanitization

Milestone: M26.1.1 · Prepared: 2026-11-17 · Executed in disposable clone
`/home/z/my-project/recovery/bean-rewrite` (never in the original working
repository).

**No secret value appears in this document.** Every affected identity is
represented by a path, a commit SHA, a blob SHA or a file digest. The bundle
SHA-256 below is a digest of the backup file, not secret material.

Status summary: the rewrite is **complete and verified locally** in the
disposable clone. **Nothing has been published.** Remote update is gated on
owner actions documented in `M26_1_1_RESULTS.md` §8 and
`M26_1_1_COLLABORATOR_GUIDE.md` (off-machine recovery copy + collaborator
notification). Locally-rewritten history ≠ remotely-published history.

---

## 1. Authorization and scope

- Authorizing instruction: M26.1.1 "BEAN Intelligence Git History
  Sanitization" — execute the controlled remediation of sensitive material
  exposed in published Git history.
- In-scope refs (the ONLY refs this milestone may ever update remotely):
  `refs/heads/main`, `refs/heads/feat/laxii-jazmii-restoration`.
- Explicitly out of scope: tags (none exist — `git ls-remote --tags` empty,
  verified), other branches, forks, mirrors, the 10 local-only WIP backup
  refs, and the original working repository (untouched: HEAD still
  `a014862…`, all 9 `backup/*` refs + `refs/backup/scratch-bf47b8c`
  intact, working tree clean).

## 2. Pre-rewrite published state (verified, not assumed)

| Item | Value |
|---|---|
| Remote `main` | `a01486289149e0347b41d111c376b8a2b078ad80` (`git ls-remote` verified; identical to the M26.1 release tip — no new commits since M26.1) |
| Remote `feat/laxii-jazmii-restoration` | `6a84481c6ebc893ccb97e97ac5a353937194eac3` (`git ls-remote` verified; strict ancestor of `main`; tip of the M21-era restoration, unchanged since before M25) |
| Commits | main 216 · feat 190 (feat fully contained in main) |
| Tags / PR refs / CI workflows | none / none advertised / none (no `.github/` on either branch) |
| Repo visibility (GitHub) | PUBLIC, 0 forks, 0 stars/watchers at preflight; contributors: `jon0471-dot`, `ebinj-dev` (2 commits) — collaborator notification required, see the guide |
| Fresh clone | `recovery/bean-rewrite`, cloned from the origin URL, both branch SHAs asserted equal to the remote before any tool ran |

## 3. Affected-path list — reconciliation of "48"

The M26.1 narrative referenced a "48-path rewrite list". Verification
against the actual remote history reconciles the number:

- **42 distinct affected paths** are reachable from the two published refs
  (enumerated directly with `git rev-list --objects`): 40 sensitive files +
  2 SQLite snapshot paths.
- The 2 snapshot paths host **8 distinct DB blob objects** → 40 files + 8
  blobs = the "48 items" figure. The rewrite list is the 42 paths; blob
  counting was the source of the discrepancy.

### 3a. The 40 file paths (`--path`, verbatim from `M26_1_OWNER_ACTIONS.md` §7.2)

```
scripts/citations-cookies.txt
scripts/e2e-30q-out/cookies.txt
scripts/e2e-cit-cookies.txt
scripts/e2e-clean-cookies.txt
scripts/e2e-cookies.txt
scripts/e2e-evalfix-out/cookies.txt
scripts/e2e-gangzii-cookies.txt
scripts/e2e-out/cookies.txt
scripts/e2e-out/fresh-chat-cookies.txt
scripts/e2e-quality-cookies.txt
scripts/e2e-riishe-upgrade-cookies.txt
scripts/e2e-verify-out/cookies.txt
scripts/e2e-verify-out/cookies2.txt
scripts/final-rq-cookies.txt
scripts/final-rq-cookies2.txt
scripts/flagship-cookies.txt
scripts/giftz-chat-cookies.txt
scripts/gingee-cookies.txt
scripts/golive-out/jazmii-verify-cookies.txt
scripts/golive-out/jazmii-verify-cookies2.txt
scripts/incident-cookies.txt
scripts/perf-cookies-baseline.txt
scripts/perf-cookies-post.txt
scripts/phase5-ui-out/cookies.txt
scripts/retrieval-cookies.txt
scripts/rework-cookies.txt
scripts/rework-cookies2.txt
scripts/rq-fix-cookies.txt
scripts/sanity-cookies.txt
scripts/stream-fix-cookies.txt
scripts/e2e-out/c2.txt
scripts/e2e-out/cg-ck.txt
scripts/e2e-out/cg-ck2.txt
scripts/e2e-out/pipeline-ck.txt
scripts/e2e-out/pipeline-ck2.txt
scripts/e2e-out/uc1.txt
scripts/e2e-out/uc2.txt
scripts/e2e-verify-out/login.json
scripts/e2e-30q-out/login.json
scripts/e2e-evalfix-out/login.json
```

### 3b. The 2 snapshot paths (`--path-glob`, hosting all 8 DB blobs)

```
scripts/e2e-verify-out/verify.db
scripts/giftz-verify-out/verify.db
```

### 3c. List verification against remote history

Independent enumeration of every path reachable from `origin/main` +
`origin/feat/laxii-jazmii-restoration` matching the sensitive-pattern
census returned exactly these 42 paths — no additional path and none
missing. The list is complete for the published refs. (The local-only
backup refs are NOT in scope and keep their history verbatim.)

## 4. Recovery material (PHASE 2) — created BEFORE any rewrite

| Artifact | Value |
|---|---|
| Pre-rewrite bundle | `recovery/bean-pre-rewrite-m2611.bundle` — 64,949,133 bytes |
| `git bundle verify` | "is okay"; 3 refs (`main`, `feat/…`, `HEAD`); "records a complete history" |
| Bundle SHA-256 | `c8a4a057fc7753c158f200f621bed02f22b196579b03b7ef5dd65b4ccd870703` |
| Independent verification | fresh `git clone` FROM the bundle; both pre-rewrite commit SHAs present as objects (asserted with `git cat-file -e`); throwaway clone removed afterwards (derived copy, not recovery material) |
| Encrypted copy | `recovery/bean-pre-rewrite-m2611.bundle.enc` (AES-256-CBC, PBKDF2, 200,000 iterations); decrypt round-trip hash identical to the bundle |
| Passphrase | `recovery/bean-pre-rewrite-m2611.passphrase` (chmod 600, randomly generated, never printed) — the encrypted copy is useless without it; BOTH files must move off-machine together |
| Off-machine storage | **NOT yet done — owner action.** The bundle contains the 170 exposed tokens, 100 user records, 2 credential ciphertexts and quarantined WIP; treat it as secret material; never upload or distribute it; never delete it |
| WIP-ref bundles | 10 separate verified bundles under `recovery/wip-refs/` (see §5) |

## 5. Quarantined WIP preservation

All 10 local-only refs were bundled and verified separately (read-only
against the working repository):

| Bundle | SHA-256 |
|---|---|
| `backup_laxii-pre-restoration.bundle` | `1f2b0f999bfec49c0a2b585f6f9e4e6fc3b432e829ca369fdd26ed8b1a6fed8a` |
| `backup_m22-wip-auto-commit.bundle` | `3105a3e8bfed647d4260ee30b02848702b25425f9f58229f8de3b2866554ec6c` |
| `backup_m25-intel-wip-auto-commit.bundle` | `6001bdfefde0b34938f1de56939bfa3636549b47548df6822b9733887f20d492` |
| `backup_m25-wip-auto-commit.bundle` | `33caf8a39f0f1ea7d1d728add3134770ca0332badfd06f9a03a583371fae4323` |
| `backup_m26-baseline-auto-commit.bundle` | `443ad3445a96196d7dd8d966a29dcbc597abd1a12c5dbd6ee967bb604c596342` |
| `backup_m26-f0b47ad-line.bundle` | `cf280ea02d0edfb814b13b88bb1d6f32a9a14b04b8b41e857d9642d3e29d472a` |
| `backup_m261-local-main-pre-sync.bundle` | `c8dd96f697e4ea9216d39c412bcd8b5300775a11d8fa4efb1ab9e18763c73047` |
| `backup_pre-phase0-81caaa3.bundle` | `23fe92488b357f26004456c3043f8f4448e31c5290aed3df8dcedcc6e67a77f9` |
| `backup_pre-phase1-auto-commit.bundle` | `547bdaf5f995496ac04b61455d572f6d234f5e1d2266d4faf8c4a07db24e83e2` |
| `refs_backup_scratch-bf47b8c.bundle` | `8565c5313f3fd5a18651588490bd4d320afb67453cc7736358bcae535213d3ae` |

Freshness verification of the quarantine inventory: `git diff
--name-status 76e63af backup/m26-baseline-auto-commit` reports **160 added
files** — exactly the count in the committed
`docs/M26_1_QUARANTINE_INVENTORY.md` (160 table rows). Marker files
confirmed present on the ref: `scripts/e2e-out/c2.txt`, `scripts/e2e-out/uc2.txt`,
`db/backups/m22-20261116T011634Z/custom.db`,
`db/backups/m22-20261116T011634Z/env.snapshot.txt`,
`scripts/.github_device_code`, `workers/wan22/preflight.py`,
`workers/wan22/worker.config.json`. Nothing quarantined was deleted,
restored or staged anywhere in this milestone.

## 6. Rewrite execution (PHASE 4)

- Tool: `git-filter-repo` 2.47.0 (pip-installed in the sandbox).
- Command: `git filter-repo --invert-paths --force` + the 42 paths of §3
  (40 `--path`, 2 `--path-glob`) — verbatim per `M26_1_OWNER_ACTIONS.md`
  §7.2. (`--force` was required by the tool; safety intent preserved
  because the clone was fresh, SHA-asserted, and bundle-backed first.)
- The tool ran only inside `recovery/bean-rewrite`. It removed the `origin`
  remote itself (push-accident protection) and pruned old objects; the two
  branch refs are the only refs that exist in the clone afterwards.

### 6a. Ref map (old → new)

| Ref | Pre-rewrite | Post-rewrite |
|---|---|---|
| `refs/heads/main` | `a01486289149e0347b41d111c376b8a2b078ad80` | `aba5d4b9d47c8bb190ae6ed5d4deebbbfe78993d` |
| `refs/heads/feat/laxii-jazmii-restoration` | `6a84481c6ebc893ccb97e97ac5a353937194eac3` | `19a04e91a8a62647e52ba4967608390cfc362796` |

### 6b. Commit map — milestone anchors (old → new)

| Anchor | Old | New |
|---|---|---|
| feat restoration tip (M21-era) | `6a84481…` | `19a04e9…` |
| M22 client-compute train | `3f40e75…` | `870a8ad…` |
| M25 intel lanes | `ea73545…` | `33adf7f…` |
| M25 results | `b0b03da…` | `96721a4…` |
| M26 results | `8cb93a9…` | `78ba13b…` |
| M26.1 fix (7 residual files) | `76e63af…` | `6beabfd…` |
| M26.1 owner checklist | `601c90d…` | `828995f…` |
| M26.1 inventory record | `6e4255c…` | `28269d7…` |
| M26.1 release tip | `a014862…` | `aba5d4b…` |

Full old→new map preserved at `recovery/bean-rewrite/.git/filter-repo/commit-map`
(216 rows) and `ref-map`.

### 6c. Commit-count delta and the single pruned commit

main 216 → **215**; feat 190 → **190**. Exactly one commit was pruned as
empty: `be2622d14569523d8d2b9a324971f52f489d972c` — "fix(m26): remove the
remaining 6 committed session-cookie jars". Its entire diff was the
deletion of 6 jar files (30 lines) that the rewrite removes anyway, so
pruning loses no legitimate content (verified via `git show --stat` on the
old commit). Its sibling M26 commit `7f66c47` (which also added real
content) was preserved as `47c06d6…`. No commit deduplication occurred
(all 216 old commits map to 216 distinct new commits minus the 1 pruned).

### 6d. What the rewrite changed at the tips (tree diff, old vs new)

- `main` tip: tracked files 2,480 → 2,477 — removed exactly
  `scripts/e2e-30q-out/login.json`, `scripts/e2e-evalfix-out/login.json`,
  `scripts/e2e-verify-out/login.json`; **zero additions, zero
  modifications**. (Note: these 3 captures were still present in the
  published `main` tip tree — M26.1 §2 row 4 recorded them as "not in HEAD
  today", which the tip-tree check disproves; the rewrite list covered
  them regardless.)
- `feat` tip: removed exactly 40 paths (37 jar files + 3 `login.json` —
  the full file list of §3a minus the 2 snapshot paths, which sit only in
  this branch's history, not its tip); **zero additions, zero
  modifications**.
- No source file, test, doc or config path was added or modified by the
  rewrite. All content deltas are pure removals from §3.

## 7. Post-rewrite verification (PHASE 5, all inside the clone)

| # | Check | Result |
|---|---|---|
| 1 | Sensitive-path census across all objects reachable from BOTH rewritten refs (`git rev-list --objects` + pattern filter) | **0 paths** |
| 2 | Full-history blob scan (M26.1 13-class scanner, adapted to the rewritten refs): 5,088 unique blobs-with-paths (pre-rewrite: 5,172), 2,963 blobs scanned | **0 `bean_session` hits**; remaining hits are the M26.1-classified benign classes only (64-hex artifact digests in acceptance evidence, test fixtures in `tests/unit/*`, `bgk_`/master-key/postgres/OpenAI-shaped literals in fixture scripts) — same classified set as the pre-rewrite tracked-tree scan |
| 3 | Direct SQLite census (parsed, not regex): distinct DB blobs | **0** (tokens 0, user emails 0, user ids 0, API-key prefixes 0, sessions 0) |
| 4 | The 8 published DB blob SHAs (`bc1aafa…`, `e0814f6…`, `8fa3cf9…`, `a9a211c…`, `3229edc…`, `e870f7d…`, `fc74c19…`, `5530bf3…`) | all **absent** from the clone object store (`git cat-file -e` fails) |
| 5 | Login captures | absent (path census + tip diff) |
| 6 | Tracked-tree scan at the rewritten tip (2,477 files) | **0 token hits**; 21 benign-classified hits (M26.1 §2 rows 5/6) |
| 7 | Legitimate release code present | all milestone anchors mapped (§6b); messages verified present; tip tree differs from the release tip ONLY by §6d removals |
| 8 | Ancestry | `feat` still a strict ancestor of `main`; counts 215/190 |
| 9 | Quarantined WIP | WIP objects (`f0b47ad`, `477a160`) absent from the clone; `workers/wan22/*`, `db/backups/*`, `scripts/.github_device_code` unreachable; the clone never contained the backup refs |

## 8. Release gates on the rewritten tip (PHASE 5)

| Gate | Result |
|---|---|
| `bun install` + `prisma generate` | OK (862 packages) |
| `bun run test` — run A | 2,187 pass / **1 fail** (single flake, test name not captured; immediate re-runs clean) |
| `bun run test` — runs B & C (full log captured) | **2,188 pass / 0 fail / 39,587 expects / 159 files** — exact M26.1 baseline |
| `tsc --noEmit` (full project) | 0 errors in `src/` + `tests/`; 144 pre-existing `scripts/` + 2 `validation/` errors — the documented M26 §12 debt, unchanged by construction (the rewrite modified no `.ts` path — see §6d); +1 error from a disposable scan-script copy removed after use |
| `eslint src tests` | clean (exit 0) |
| `bun run build` | **PASS** (production build, standalone output) |

Interpretation: run A's flake cannot be rewrite-related content drift —
the rewritten tree is byte-identical to the release tree outside the 42
removed non-code paths — and did not reproduce in two consecutive full
runs. Honest record: 1 flake observed, name uncaught, twice-clean repeats
at the exact baseline.

## 9. Publication state and lease-protected update plan (PHASE 6-8)

**Not published.** The task's publication gate requires: verified backup
(done), owner-controlled off-machine recovery copy (owner action),
provider-credential decision (recorded — see `M26_1_1_RESULTS.md` §3),
collaborator notification (owner action), CI/PR implications understood
(done: none exist), inspected tips (done), passing local gates (done).
Two gates remain owner-side, so the remote update is NOT executed by this
milestone.

The exact lease-protected runbook (expected old SHAs recorded NOW,
re-verified at execution time) is in `M26_1_1_RESULTS.md` §8. Lease
expectations at manifest time:

- `main`: old `a01486289149e0347b41d111c376b8a2b078ad80` → new docs-tip
  (child of `aba5d4b9d47c8bb190ae6ed5d4deebbbfe78993d`)
- `feat/laxii-jazmii-restoration`: old `6a84481c6ebc893ccb97e97ac5a353937194eac3`
  → new `19a04e91a8a62647e52ba4967608390cfc362796` (+ no docs commit on
  this branch)
- If either old SHA differs at execution time: STOP and reconcile.

Post-publication (owner-run): remote/local SHA equality, fresh-clone
rescan, GitHub UI spot-check (pre-rewrite commit hash → expect 404),
server-side object GC via GitHub Support (unreachable objects and cached
views persist until then), fork/mirror re-check.

## 10. Identifier-only guarantee

Every token, email, password hash, API key, ciphertext and master key
referenced by this milestone is represented ONLY by paths, commit/blob
SHAs, file digests or counted rows. No secret value was printed, logged,
committed or transmitted. The bundle passphrase lives only in
`recovery/bean-pre-rewrite-m2611.passphrase` (chmod 600) and is never
reproduced.
