# M26.1.1 RESULTS — BEAN Intelligence Git History Sanitization

Milestone: M26.1.1 · Prepared: 2026-11-17 · Branch context: published
`main` + `feat/laxii-jazmii-restoration` (the only refs in scope).
Companion documents: `M26_1_1_REWRITE_MANIFEST.md` (full technical record),
`M26_1_1_COLLABORATOR_GUIDE.md` (post-publication recovery),
`M26_1_RESULTS.md` + `M26_1_OWNER_ACTIONS.md` (the M26.1 baseline this
milestone executes).

**Verdict (§10): B — Local rewrite verified; publication and two owner
gates remain. Nothing secret remains in the LOCALLY REWRITTEN history;
the PUBLISHED history is untouched and still contains all of it.**

Headline: the owner-authorized history rewrite was executed end-to-end in
a disposable, bundle-backed clone with `git-filter-repo` 2.47.0. All 42
affected paths (40 files + 2 SQLite snapshot paths hosting 8 blob objects
— the "48-path" figure counted blobs; reconciled in the manifest §3) are
unreachable from both rewritten branches; the direct SQLite census is
zero; 2,963 rewritten-history blobs scan with **0 `bean_session` hits**;
the full suite passes at the exact M26.1 baseline (2,188/0) and the
production build passes. The two provider credentials are recorded as
disposable with code-level evidence. Publication did NOT proceed because
two safety gates are owner-only (off-machine recovery copy; collaborator
notification on a PUBLIC repo with a second contributor identity).

## 1. Initial repository state (verified, not assumed)

| Item | Value |
|---|---|
| `git fetch origin --prune` | performed first; produced zero ref updates — no commits have appeared on either branch since M26.1 |
| Remote `main` (`git ls-remote`) | `a01486289149e0347b41d111c376b8a2b078ad80` — byte-equal to the M26.1 remote-verified release tip quoted in the M26.1.1 starting point |
| Remote `feat/laxii-jazmii-restoration` | `6a84481c6ebc893ccb97e97ac5a353937194eac3` — strict ancestor of `main` (re-verified with `git merge-base --is-ancestor`); matches the SHA recorded as remote baseline in the M22-era audit docs |
| Local `main` | identical to remote; working tree clean; HEAD `a014862` |
| Tags / open PRs / CI | none (`git ls-remote` shows no tags, no `refs/pull/*`; no `.github/` workflows on either branch) |
| Repo visibility | PUBLIC on GitHub, 0 forks, 0 stars, 2 contributor identities (`jon0471-dot`, `ebinj-dev`, 2 commits) — this raises the priority of the collaborator-notification gate |
| Backup refs | all 9 `backup/*` heads + `refs/backup/scratch-bf47b8c` verified local-only (unreachable from either remote ref) |
| M26.1 documents read in full | `M26_1_RESULTS.md`, `M26_1_OWNER_ACTIONS.md`, `docs/M26_1_QUARANTINE_INVENTORY.md` |
| Corrections found vs M26.1 records | (a) the "48-path" list is actually 42 distinct paths + 8 blob objects; (b) the 3 `login.json` captures were still present in the published `main` tip tree (M26.1 §2 row 4 said "No"); both corrections are handled — the rewrite list covered everything either way |
| STOP-condition check | no unexpected changes on either branch → cleared to proceed |

## 2. Historical exposure assessment (post-rewrite)

Pre-rewrite exposure (per M26.1 census, re-confirmed by path enumeration
against the remote refs before rewriting): 42 distinct paths — 30
`*cookie*` jars + 7 non-cookie-named jars (`c2/cg-ck/cg-ck2/pipeline-ck/
pipeline-ck2/uc1/uc2.txt`) + 3 `login.json` captures + 2 `verify.db`
snapshot paths (8 blob objects) holding 143 in-DB tokens; union with the
jars = **170 distinct session-token identities**, 100 user records, 21
API-key hash rows (hash-only; no raw key recoverable), 2 AES-256-GCM
provider-credential ciphertexts, 5,379 harness message rows.

Post-rewrite, measured inside the disposable clone (full detail in the
manifest §7):

- Sensitive-path census across every object reachable from both rewritten
  branches: **0**.
- Full-history blob scan: 5,088 unique blobs (was 5,172 pre-rewrite);
  **0 `bean_session` hits** in 2,963 scanned blobs; only the
  M26.1-classified benign classes remain (64-hex artifact digests, test
  fixtures) — identical classified set to the pre-rewrite tracked-tree
  scan.
- Direct SQLite census: **0 DB blobs** → 0 tokens, 0 user emails, 0
  API-key prefixes, 0 message rows from snapshots.
- The 8 published DB blob SHAs and the quarantined-WIP objects are
  physically absent from the rewritten object store.

Limitations (honest): the scans cover objects reachable from the two
rewritten refs with the 13 M26.1 pattern classes plus direct SQLite
parsing; a novel credential format could evade regex classes; objects
unreachable from any ref were never in collaborator reach and are not
enumerated; provider-side leakage outside the repo remains invisible to
any repository scan (resolved for the 2 ciphertexts by §3 below).

## 3. Provider credential decision — RECORDED (evidence-based)

The two `ProviderCredential` rows published inside DB blob `e870f7d8…`
(labels `disposable-e2e`, provider `openai-compatible`, masked hints
`sk…6836` / `sk…2294`, AES-256-GCM envelopes) were inspected using
identifiers only. **Decision: both were disposable test credentials; no
provider-side revocation or rotation is required.** Evidence:

1. The seeding code is published at HEAD (`scripts/giftz-sec-e2e.ts`):
   `DISPOSABLE_SECRET = \`sk-disposable-${crypto.randomUUID()…}\`` — the
   "API keys" are synthetic strings fabricated in-process by the harness;
   no provider ever issued them.
2. The harness targets the isolated local instance
   (`http://127.0.0.1:3100`) and only exercises the credential lifecycle
   (create → masked-hint check → list → DB-at-rest envelope scan →
   configuration status); it never invokes the credential against an
   upstream model endpoint.
3. A `sk-disposable-<uuid>` value cannot correspond to any real provider
   account key (providers do not issue keys with that attacker-chosen
   prefix), and the ciphertexts are unreadable without the vault master
   key, which was never committed (M26.1 history-wide scan: env-NAME
   references only).

Residual owner check (one line, no action expected): if the owner ever
manually configured a REAL key into the `bean-external-openai-compatible`
credential slot outside this harness, rotate it at the provider console —
no evidence of that exists in the repository or the harness design.

## 4. Git history remediation status

| Ref | Pre-rewrite (published today) | Rewritten (LOCAL only) | Commits |
|---|---|---|---|
| `main` | `a01486289149e0347b41d111c376b8a2b078ad80` | `aba5d4b9d47c8bb190ae6ed5d4deebbbfe78993d` | 216 → 215 (one pure-jar-deletion commit `be2622d` correctly pruned as empty; no legitimate content lost — manifest §6c) |
| `feat/laxii-jazmii-restoration` | `6a84481c6ebc893ccb97e97ac5a353937194eac3` | `19a04e91a8a62647e52ba4967608390cfc362796` | 190 → 190 |

- Tool: `git-filter-repo` 2.47.0, `--invert-paths` over the verified
  42-path list, both branches rewritten consistently in one pass.
- Ancestry preserved (`feat` still strict ancestor of `main`); milestone
  anchors M22/M25/M26/M26.1 all mapped to new SHAs with messages intact
  (manifest §6b); tip trees differ from the release trees ONLY by the
  sensitive-path removals (main −3 files, feat −40 files, zero
  additions/modifications anywhere).
- Old objects are fully purged from the clone (the pre-rewrite commit
  SHAs and all 8 DB blob SHAs fail `git cat-file -e`); `filter-repo`
  removed the clone's `origin` remote itself (push-accident protection).
- **No remote object has been rewritten, deleted or pushed by this
  milestone.** The published history still contains all 42 paths until
  the owner executes the §8 runbook.

## 5. Workspace isolation and preservation results

- Pre-rewrite bundle created OUTSIDE the clone BEFORE any rewrite:
  verified twice (`git bundle verify` + independent clone-from-bundle
  SHA assertions), SHA-256 `c8a4a057fc7753c158f200f621bed02f22b196579b03b7ef5dd65b4ccd870703`
  (64,949,133 bytes), plus an AES-256-CBC encrypted copy with
  round-trip-verified hash and a chmod-600 randomly generated passphrase.
  The bundle contains the sensitive history and must never be uploaded,
  distributed or deleted.
- All 10 local-only WIP refs bundled, verified and SHA-256-recorded
  separately (manifest §5) — quarantined WIP survives independent of the
  rewrite and of this sandbox session.
- Quarantine inventory re-verified fresh: `backup/m26-baseline-auto-commit`
  adds exactly 160 files vs the fix tip (matches the committed inventory's
  160 rows); marker files confirmed on the ref (including the 7 token
  files, the m22 DB backup + env snapshot, the device code, and the
  `workers/wan22/` pair).
- Nothing quarantined was deleted, restored or staged; the original
  working repository is untouched (HEAD still `a014862`, tree clean, all
  backup refs present; recovery material excluded locally via
  `.git/info/exclude`, never committed).
- No broad cleanup command was ever run against the working repository.

## 6. Secret scan and census results (summary)

| Scan | Scope | Result |
|---|---|---|
| Path census | all objects reachable from both rewritten refs | 0 affected paths |
| Blob pattern scan (13 classes) | 2,963 rewritten-history blobs + 2,477 tracked files + untracked | 0 `bean_session` hits anywhere; 20 blobs / 18 paths with benign-class hits only (M26.1 §2 rows 5/6) |
| Direct SQLite census | all `*.db/*.sqlite/*.sqlite3` blobs reachable from both refs | distinct DB blobs **0**; tokens/emails/key-prefixes 0 |
| Absent-object assertions | 8 DB blob SHAs, 2 WIP commit SHAs, 3 pre-rewrite tip SHAs | all absent from the clone |
| Untracked scan in clone | untracked-not-ignored files | 0 hits |

## 7. Security regression results (rewritten tip, inside the clone)

| Gate | Result |
|---|---|
| `bun run test` | runs B & C: **2,188 pass / 0 fail / 39,587 expects / 159 files** — exact M26.1 baseline. Run A recorded 1 flake (name not captured; did not reproduce in two consecutive full runs; the rewritten tree is byte-identical to the release tree outside the removed non-code paths, so the flake is environmental) |
| `tsc --noEmit` | 0 errors in `src/` + `tests/`; 146 pre-existing `scripts/`+`validation/` debt errors unchanged by construction (no `.ts` path touched — manifest §6d) |
| `eslint src tests` | clean |
| `bun run build` | **PASS** (production standalone build) |
| M26.1 session-lifecycle suite | included in the full run (2,188) |

## 8. Owner actions remaining (publication runbook)

Everything below happens in `recovery/bean-rewrite` unless stated. **If
any expected SHA differs at execution time, STOP and reconcile.**

1. **Secure the recovery copy off-machine (do FIRST):** move
   `recovery/bean-pre-rewrite-m2611.bundle.enc` AND
   `recovery/bean-pre-rewrite-m2611.passphrase` to owner-controlled
   encrypted storage, together. Verify by decrypting off-machine and
   comparing SHA-256 `c8a4a057fc7753c158f200f621bed02f22b196579b03b7ef5dd65b4ccd870703`.
   Never upload/distribute the bundle; never delete it or the 10
   `recovery/wip-refs/*.bundle` files.
2. **Notify collaborators** (see `M26_1_1_COLLABORATOR_GUIDE.md`): the
   repo is PUBLIC; contributor identities found: `jon0471-dot`,
   `ebinj-dev`. Rewriting a public repo's history without notice risks a
   stale clone pushing the secret-bearing history back.
3. **Re-verify the remote is still where the manifest left it:**
   ```bash
   git -C /home/z/my-project/recovery/bean-rewrite remote add origin https://github.com/jon0471-dot/Bean-intelligence.git
   git ls-remote origin refs/heads/main refs/heads/feat/laxii-jazmii-restoration
   # expect: main a014862…, feat 6a84481…  — anything else: STOP
   ```
4. **Verify the prepared document-only commit on the rewritten main:**
   the M26.1.1 documents are ALREADY committed on top of `aba5d4b`
   (message `docs(m26.1.1): history sanitization results, rewrite
   manifest + collaborator guide…`). The docs cannot embed their own
   SHA — the push-time tip is recorded by step 6:
   ```bash
   cd /home/z/my-project/recovery/bean-rewrite
   git status --porcelain         # expect clean
   git log --oneline -2           # expect: <docs commit> / aba5d4b…
   ```
   If this clone was ever rebuilt, re-create the commit instead:
   `git add M26_1_1_RESULTS.md M26_1_1_REWRITE_MANIFEST.md M26_1_1_COLLABORATOR_GUIDE.md scripts/m2611/ && git commit -m "docs(m26.1.1): history sanitization results, rewrite manifest + collaborator guide"`
5. **Publish with explicit per-ref leases (never a bare force push):**
   ```bash
   git push --force-with-lease=refs/heads/main:a01486289149e0347b41d111c376b8a2b078ad80 origin main:refs/heads/main
   git push --force-with-lease=refs/heads/feat/laxii-jazmii-restoration:6a84481c6ebc893ccb97e97ac5a353937194eac3 origin feat/laxii-jazmii-restoration:refs/heads/feat/laxii-jazmii-restoration
   ```
   Update ONLY these two refs. No tags exist. Do not touch other
   branches, forks or mirrors without separate approval.
6. **Post-publication verification (PHASE 8, owner-run):**
   ```bash
   git ls-remote origin refs/heads/main refs/heads/feat/laxii-jazmii-restoration   # == local tips of step 5
   git clone <repo-url> fresh-check && cd fresh-check
   git rev-list --objects --all | grep -E "cookies|verify\.db|login\.json|e2e-out/(c2|cg-ck|pipeline-ck|uc[12])\.txt"   # expect empty
   bun install && bun run scripts/m261/secret-scan.ts && bun run scripts/m261/db-census.ts   # expect 0 bean_session; DB blobs 0
   bun run test && bun run build                                                    # 2,188/0; build PASS
   ```
   Then: open any pre-rewrite commit hash on github.com → expect 404.
   Re-check fork count and any mirror.
7. **Server-side cleanup:** contact GitHub Support to expire unreachable
   objects and cached views (incl. any cached commit pages and the events
   API) after the push. A normal push does NOT immediately purge every
   cached/unreachable object; old SHAs may resolve via the API until GC.
8. **Sync this sandbox afterwards:** `git -C /home/z/my-project fetch
   origin && git -C /home/z/my-project checkout main && git -C
   /home/z/my-project reset --hard origin/main` (the working repo's
   pre-rewrite docs commit and history remain recoverable from the
   bundle; the backup refs are untouched by the reset).

## 9. Files changed and commit SHAs

| Location | Change |
|---|---|
| Disposable clone (`recovery/bean-rewrite`) | both branch refs rewritten (§4); document-only commit prepared on top of `aba5d4b` (its SHA is fixed by step 4 of the runbook and recorded by the push-time verification — the docs tip cannot embed its own SHA) |
| Working repository (local `main`, NOT pushed — intentionally: pushing the docs before publication would strand the rewrite one commit behind and force a re-rewrite) | docs commit adds `M26_1_1_RESULTS.md`, `M26_1_1_REWRITE_MANIFEST.md`, `M26_1_1_COLLABORATOR_GUIDE.md`, `scripts/m2611/` (phase2/4/5 scripts) — content-identical to the clone commit; both SHAs recorded post-publication |
| Untracked, never committed | `recovery/` (bundle, encrypted copy, passphrase, 10 WIP bundles, clone) — excluded via `.git/info/exclude` |

Tooling committed: `scripts/m2611/phase2-preserve.sh`,
`phase4-rewrite.sh`, `phase5-verify.sh`, `phase5-scans.sh`,
`phase5-tests.sh` — each phase of this milestone is reproducible from
them.

## 10. Final verdict

**B — Local rewrite verified; publication and owner gates remain.**

- Closed and verified locally: recovery material (bundle + encrypted copy
  + 10 WIP bundles, all hash-verified), the 42-path purge across both
  branches (path census 0, blob scan 0 `bean_session`, SQLite census 0,
  absent-object assertions), release gates at the exact baseline
  (2,188/0 tests, tsc 0 in src+tests, eslint clean, build PASS), ancestry
  and tip-tree integrity, WIP preservation, provider-credential decision
  recorded with evidence.
- Why not A: the rewritten branches are NOT published. The task's own
  publication gate requires the owner-controlled off-machine recovery
  copy and collaborator notification on a PUBLIC repo — two actions this
  session cannot honestly perform. Per the rules, no force-push was
  executed; expected lease SHAs are pre-recorded (§8).
- Why not C: every step that could be executed autonomously was executed
  and verified; nothing is blocked, unmitigated or unowned — the remaining
  work is a copy-paste owner runbook with pre-verified expectations.
- Residual risks after publication (owner-owned): GitHub-side cached
  views and unreachable objects until Support/GC acts; forks/mirrors
  (0 observed at preflight — re-verify); anyone who cloned before the
  rewrite retains the old objects; the bundle remains secret material
  forever. The verdict applies to the local state of
  `recovery/bean-rewrite` as recorded in the manifest and does not claim
  any remote effect.
