# M26.1 OWNER ACTIONS — Security Closure Checklist

Milestone: M26.1 · Prepared: 2026-11-17 · Branch: `m261-security-closure`
Companion report: `M26_1_RESULTS.md` (evidence for every number below).

**No token value, email, password hash or ciphertext body is reproduced in
this document or anywhere in the repository.** Affected identities are named
by path, blob SHA and (for session rows) SHA-256-truncated hash fingerprints
only. Fingerprints were generated for counting/cross-checking; they are not
usable to reconstruct tokens (each is a truncated digest of a value that is
itself 256 bits of CSPRNG material).

**Rule of engagement for this milestone:** every step that rewrites published
history, rotates a live credential at an external provider, or deletes
recovery material requires the repository owner's explicit action or
approval. The automated work is done and verified; what remains is listed
here with exact instructions.

---

## 1. Status dashboard

| # | Action | Status | Owner required? |
|---|---|---|---|
| 1 | Inventory the exposed material (identifiers only) | **DONE (M26.1 automated)** | No |
| 2 | Determine validity of every exposed token | **DONE — 0 valid** (§3) | No |
| 3 | Revoke/invalidate exposed tokens against the live system | **EFFECTIVE — verified** (§3) | No |
| 4 | Rotate signing keys / credentials | **N/A with evidence** — session model has no signing keys (§4) | No |
| 5 | Re-issue replacements via authorized process | **N/A — affected accounts no longer exist** (§4) | No |
| 6 | Verify old tokens rejected + new credentials work | **DONE** — 7-test regression suite, all pass (§5) | No |
| 7 | Remove residual secrets from HEAD | **DONE** — commit `76e63af`, re-scan clean (§6) | No |
| 8 | History rewrite of published refs | **NOT DONE — plan ready, awaits owner approval** (§7) | **YES** |
| 9 | Rotate 2 upstream provider credentials (vault ciphertext published) | **NOT DONE — owner decision** (§8) | **YES** |
| 10 | Collaborator/clone synchronization after rewrite | **Blocked on #8** (§9) | **YES** |
| 11 | Re-run scans after rewrite | **Blocked on #8** (§10) | **YES** |

---

## 2. Historical exposure inventory (identifiers only)

M26 reported "30 historical session tokens". The M26.1 census (tooling:
`scripts/m261/`) found the true scope is larger:

### 2a. Cookie-jar files — 37 files, 37 distinct tokens

| Group | Paths | Distinct tokens | Where today |
|---|---|---|---|
| 30 jars named `*cookie*`/`cookies.txt` | `scripts/citations-cookies.txt`, `scripts/e2e-30q-out/cookies.txt`, `scripts/e2e-cit-cookies.txt`, `scripts/e2e-clean-cookies.txt`, `scripts/e2e-cookies.txt`, `scripts/e2e-evalfix-out/cookies.txt`, `scripts/e2e-gangzii-cookies.txt`, `scripts/e2e-out/cookies.txt`, `scripts/e2e-out/fresh-chat-cookies.txt`, `scripts/e2e-quality-cookies.txt`, `scripts/e2e-riishe-upgrade-cookies.txt`, `scripts/e2e-verify-out/cookies.txt`, `scripts/e2e-verify-out/cookies2.txt`, `scripts/final-rq-cookies.txt`, `scripts/final-rq-cookies2.txt`, `scripts/flagship-cookies.txt`, `scripts/giftz-chat-cookies.txt`, `scripts/gingee-cookies.txt`, `scripts/golive-out/jazmii-verify-cookies.txt`, `scripts/golive-out/jazmii-verify-cookies2.txt`, `scripts/incident-cookies.txt`, `scripts/perf-cookies-baseline.txt`, `scripts/perf-cookies-post.txt`, `scripts/phase5-ui-out/cookies.txt`, `scripts/retrieval-cookies.txt`, `scripts/rework-cookies.txt`, `scripts/rework-cookies2.txt`, `scripts/rq-fix-cookies.txt`, `scripts/sanity-cookies.txt`, `scripts/stream-fix-cookies.txt` | 30 | removed from HEAD by M26 (`7f66c47`, `be2622d`); still in published history |
| 7 jars with non-`cookie` names | `scripts/e2e-out/c2.txt`, `scripts/e2e-out/cg-ck.txt`, `scripts/e2e-out/cg-ck2.txt`, `scripts/e2e-out/pipeline-ck.txt`, `scripts/e2e-out/pipeline-ck2.txt`, `scripts/e2e-out/uc1.txt`, `scripts/e2e-out/uc2.txt` | 7 | **removed from HEAD by M26.1 (`76e63af`)** — still in published history |

All 37 were introduced into the published branch by the UUID-message
auto-commit train between `ad593b3` (2026-10-25) and `a94bece` (2026-11-05);
the 7-file group entered at `a634fcf` (2026-10-29) and was missed by the M26
sweep because its names contain no "cookie".

### 2b. SQLite database snapshots — 8 blobs, 143 distinct tokens inside

Published at two paths in remote history: `scripts/e2e-verify-out/verify.db`
(5 distinct blobs) and `scripts/giftz-verify-out/verify.db` (3 distinct
blobs). Blob SHAs (full, for the rewrite plan):

| Blob SHA | Path | Sessions | Users | ApiKeys | Messages |
|---|---|---|---|---|---|
| `bc1aafa17481c1b61914ffb5d4b9cc977c1c173d` | e2e-verify | 74 | 43 | 0 | 692 |
| `e0814f6b3fbf121cf9f4d9058128a67699b32b76` | e2e-verify | 74 | 43 | 0 | 692 |
| `8fa3cf94a13bbd7518f31f3ca3e9b80fafbcbde6` | e2e-verify | 74 | 43 | 0 | 686 |
| `a9a211ccf573f590a26ef8733821658419a25808` | e2e-verify | 72 | 42 | 0 | 672 |
| `3229edc84e2059424d5af1db92a51c8509b11d25` | e2e-verify | 71 | 42 | 0 | 672 |
| `e870f7d852e21f5c114cef80875bfd63585c93d5` | giftz-verify | 136 | 98 | 21 | 655 |
| `fc74c1994082f73c1fdb8e656e2b2c1f2573f9e6` | giftz-verify | 86 | 60 | 0 | 655 |
| `5530bf3a8f42914773590a850820096e7a175bce` | giftz-verify | 84 | 58 | 0 | 655 |

Snapshot contents beyond session tokens:

- **100 distinct user accounts** (emails + scrypt password hashes) — PII +
  password-verification-material exposure. scrypt (cost-hardened,
  `timingSafeEqual` compare) is not practically crackable offline from these
  hashes, but treat the addresses as leaked.
- **21 API-key rows** — SHA-256 hashes and short prefixes only; **no raw
  `bgk_` key material exists in any snapshot** (hash-only storage design
  held). The keys themselves cannot be recovered from the history.
- **2 `ProviderCredential` rows** (blob `e870f7d8…`, labels
  `disposable-e2e`, provider `openai-compatible`) — AES-256-GCM ciphertext
  envelopes (`v1:<iv>.<tag>.<ciphertext>`), unreadable without the vault
  master key. `BEAN_CREDENTIALS_MASTER_KEY` was never committed (verified by
  history-wide scan: env-name references only). See §8 for the owner call.
- **5,379 message rows** — test-harness conversation content.

### 2c. Adjacent published records

- 3 `login.json` response captures (`scripts/e2e-verify-out/login.json`,
  `scripts/e2e-30q-out/login.json`, `scripts/e2e-evalfix-out/login.json`) —
  test-account ids/emails, no passwords.
- Local-only (NEVER pushed — verified): `scripts/.github_device_code`,
  `db/backups/m22-20261116T011634Z/{custom.db,env.snapshot.txt}` inside
  auto-commit `f0b47ad`, preserved on `backup/m26-baseline-auto-commit`.

### 2d. Union arithmetic

37 (jars) + 143 (inside DB snapshots) − 10 (tokens present in both) =
**170 distinct exposed session-token identities**.

---

## 3. Token type, issuer, environment, validity

- **Type**: opaque 64-hex `bean_session` cookie tokens (32 bytes of CSPRNG
  material, `randomBytes(32).toString('hex')`).
- **Issuer**: BEAN Intelligence local-development auth
  (`src/lib/auth/session.ts`, `createSession`), TTL 7 days,
  `SameSite=None; Secure; HttpOnly`.
- **Environment**: all 37 jar tokens were captured against
  `http://localhost` by local E2E scripts; all 8 DB snapshots are isolated
  verification-harness databases (`verify.db`), not the deployed database.
- **Validity check (automated, 2026-11-17)**:
  - live deployment DB (`db/custom.db`): `Session` = **0 rows**, `User` =
    0, `ApiKey` = 0, `ProviderCredential` = 0 → **0 of the 170 tokens are
    valid against the running system**;
  - wall-clock expiry: **0 of 143 snapshot tokens unexpired** (all issued
    ≤ 2026-11-05 with 7-day TTL; latest jar cookie expiry
    2026-11-12T03:41:14Z; audit date 2026-11-17).

## 4. Revocation, rotation, replacement — status and rationale

- **Revocation**: the authoritative credential store for these tokens is
  the `Session` table. The deployed database was reset (M22) and holds zero
  session rows, so every exposed token is already dead on the live system —
  revocation is **effective by construction and verified** (live row count =
  0). There is nothing further for the owner to revoke in the current
  deployment.
- **Rotation of signing keys**: **not applicable** — sessions are validated
  by direct DB lookup (`db.session.findUnique({ where: { token } })`), there
  is no HMAC/signing key whose rotation would affect them. Documented
  residual (M26 §15 item 6): tokens are stored plaintext in the DB;
  hash-at-rest migration is a schema change listed as a future milestone.
- **Replacements**: no action — the accounts behind all exposed material
  lived in the reset dev/harness databases and no longer exist. New
  credentials are issued only through the normal login flow; the flow's
  correctness (including the M26 S-8 password-change-revokes-all-sessions
  behavior) is pinned by the new regression suite.
- **If a different, owner-operated deployment ever restored one of these
  snapshots or reused one of these dev accounts on a shared database**: run
  `DELETE FROM Session;` (and audit `User`) there first — that is the only
  revocation path that can matter. Verify with the same row-count check.

## 5. Automated verification (already executed, reproducible)

```bash
# old-token rejection / invalidation / revocation semantics
bun test tests/unit/m261-session-token-lifecycle.test.ts   # 7 pass / 0 fail

# full regression battery
bun run test                                              # 2188 pass / 0 fail

# secret scans (values never printed; hashes only)
bun run scripts/m261/secret-scan.ts                       # tracked tree: 0 bean_session hits
bun run scripts/m261/db-census-driver.ts                  # published DB census
bun run scripts/m261/union-tokens.ts                      # 170-token union math
```

## 6. HEAD remediation already committed

- Commit `76e63af` on `m261-security-closure` → fast-forward push to `main`
  (no force): deletes the 7 residual token files, widens `.gitignore`
  (`scripts/e2e-out/*.txt`, harness DB snapshots under `scripts/`), adds the
  regression suite and the scan tooling.
- Post-commit tracked-tree scan: **0 `bean_session` matches** across 2,466
  tracked files. Release artifact inspection (`.next/standalone`): clean.

## 7. PUBLISHED-HISTORY REWRITE — requires owner approval

**Nothing below is executed by this milestone.** No force-push, no remote
history rewrite, no backup deletion has occurred or will occur without the
owner's explicit instruction. The published history still contains all 37
jar files, all 8 DB snapshots and the 3 login.json captures.

### 7.1 Preconditions (owner)

1. Confirm every collaborator/CI system is reachable for re-notification
   (§9) — rewriting history without coordinating locks stale clones that can
   push the secret-bearing history right back.
2. Take and VERIFIY a full backup (§10) — after this step the backup is the
   only place the objects exist.
3. Confirm no open PRs/branches from the affected window are still needed.

### 7.2 Recommended procedure (owner-run)

```bash
# 0. all collaborators push/merge what they need BEFORE the rewrite date
# 1. fresh clone + tooling
git clone <repo-url> bean-rewrite && cd bean-rewrite
pip install git-filter-repo            # or: brew install git-filter-repo

# 2. backup OUTSIDE the clone (verify by SHA)
git bundle create ../bean-pre-rewrite.bundle --all
git verify-pack -v .git/objects/pack/*.idx | tail -3   # sanity
sha256sum ../bean-pre-rewrite.bundle                   # record; keep ≥ 90 days

# 3. rewrite: drop the affected paths across ALL refs
git filter-repo --invert-paths --force \
  --path scripts/citations-cookies.txt \
  --path scripts/e2e-30q-out/cookies.txt \
  --path scripts/e2e-cit-cookies.txt \
  --path scripts/e2e-clean-cookies.txt \
  --path scripts/e2e-cookies.txt \
  --path scripts/e2e-evalfix-out/cookies.txt \
  --path scripts/e2e-gangzii-cookies.txt \
  --path scripts/e2e-out/cookies.txt \
  --path scripts/e2e-out/fresh-chat-cookies.txt \
  --path scripts/e2e-quality-cookies.txt \
  --path scripts/e2e-riishe-upgrade-cookies.txt \
  --path scripts/e2e-verify-out/cookies.txt \
  --path scripts/e2e-verify-out/cookies2.txt \
  --path scripts/final-rq-cookies.txt \
  --path scripts/final-rq-cookies2.txt \
  --path scripts/flagship-cookies.txt \
  --path scripts/giftz-chat-cookies.txt \
  --path scripts/gingee-cookies.txt \
  --path scripts/golive-out/jazmii-verify-cookies.txt \
  --path scripts/golive-out/jazmii-verify-cookies2.txt \
  --path scripts/incident-cookies.txt \
  --path scripts/perf-cookies-baseline.txt \
  --path scripts/perf-cookies-post.txt \
  --path scripts/phase5-ui-out/cookies.txt \
  --path scripts/retrieval-cookies.txt \
  --path scripts/rework-cookies.txt \
  --path scripts/rework-cookies2.txt \
  --path scripts/rq-fix-cookies.txt \
  --path scripts/sanity-cookies.txt \
  --path scripts/stream-fix-cookies.txt \
  --path scripts/e2e-out/c2.txt \
  --path scripts/e2e-out/cg-ck.txt \
  --path scripts/e2e-out/cg-ck2.txt \
  --path scripts/e2e-out/pipeline-ck.txt \
  --path scripts/e2e-out/pipeline-ck2.txt \
  --path scripts/e2e-out/uc1.txt \
  --path scripts/e2e-out/uc2.txt \
  --path scripts/e2e-verify-out/login.json \
  --path scripts/e2e-30q-out/login.json \
  --path scripts/e2e-evalfix-out/login.json \
  --path-glob 'scripts/e2e-verify-out/verify.db' \
  --path-glob 'scripts/giftz-verify-out/verify.db'

# 4. local verification BEFORE pushing
git rev-list --objects --all | grep -E "cookies|e2e-out/(c2|cg-ck|pipeline-ck|uc)|verify.db|login.json"
#   → expect NO output (or only unrelated matches)
git log --all --oneline -- scripts/e2e-cookies.txt      # expect nothing
bun run scripts/m261/secret-scan.ts                     # run inside the clone: 0 jar/db hits

# 5. push (owner-authorized force, refs explicitly enumerated)
git push --force origin main
git push --force origin feat/laxii-jazmii-restoration
# (no tags exist to rewrite — `git ls-remote --tags origin` returns empty, verified)

# 6. server-side GC so the OLD objects (incl. the 170 tokens) become unreachable
#    GitHub: Settings → Danger Zone → "Run garbage collection" / contact support
#    to expire unreachable objects and any cached views; self-hosted:
git -C /path/to/bare.git reflog expire --expire=now --all
git -C /path/to/bare.git gc --prune=now --aggressive
```

Alternative if `git-filter-repo` is unavailable: BFG
`bfg --delete-files 'verify.db'` plus the same explicit file list; verify
identically. Do NOT use `filter-branch` (slow, error-prone at this history
size).

### 7.3 What the rewrite must preserve

- The M22/M25/M26 release commits and tags of `main` history (they contain
  no secrets — verified by the M26.1 history scan) will keep their messages
  but get NEW SHAs; re-verify the suite on the rewritten tip before/after
  push: `bun run test` (2,188 expected) + build.
- The quarantined-WIP LOCAL refs (`backup/m26-baseline-auto-commit`,
  `backup/m26-f0b47ad-line`, `backup/m22-wip-auto-commit`,
  `backup/m25-wip-auto-commit`, `backup/m25-intel-wip-auto-commit`,
  `backup/laxii-pre-restoration`, `backup/pre-phase0-81caaa3`,
  `backup/pre-phase1-auto-commit`) are LOCAL-ONLY (verified: never pushed).
  Leave them untouched so the preserved WIP (workspace feature, staging
  tooling, `workers/wan22/`) survives the rewrite.

## 8. Owner decision — upstream provider credentials

The 2 `ProviderCredential` rows published inside blob `e870f7d8…` are
AES-256-GCM ciphertexts with labels `disposable-e2e` and masked hints
`sk…6836` / `sk…2294` (structure only; values redacted everywhere). They are
unreadable without the vault master key, which was never committed.

**Decision for the owner**: if EITHER masked key corresponds to a real
upstream API key that was ever used outside this sandbox (i.e. the e2e
harness was pointed at a shared/paid provider account), rotate that key at
the provider console (OpenAI-compatible provider → revoke + issue new →
update via the admin credential UI, which re-encrypts with the current
master key). If both were pure throwaways against local mocks (their
`disposable-e2e` labels and the harness design suggest so), no provider
action is needed — record the decision here:

| Item | Action | Owner sign-off |
|---|---|---|
| ProviderCredential `masked sk…6836` | rotate at provider / confirm throwaway | ____________ |
| ProviderCredential `masked sk…2294` | rotate at provider / confirm throwaway | ____________ |

## 9. Collaborator and CI implications (after §7 is approved and run)

- Every clone made before the rewrite is **obsolete**: a stale clone holds
  the secret-bearing objects and a `git push` from it can silently restore
  them. Send: *"Repository history was rewritten on <date>. Run:
  `git fetch origin && git checkout main && git reset --hard origin/main &&
  git clean -fdx; git push --force-with-lease origin main` is FORBIDDEN —
  if you have local work, rebase it onto the new main before pushing
  anything."*
- CI/caches: clear every CI workspace/cache that persists `.git`
  (GitHub-hosted runners start fresh; self-hosted runners need cache
  purge). Delete and re-add any deploy keys/webhooks if the platform
  reports stale refs.
- Open PRs: force-update branches from the rewritten main; re-run gates
  (suite + build) since all SHAs changed.
- Forks/mirrors: any fork retains the old history — request GitHub Support
  to purge fork networks or delete forks; mirrors must re-clone.

## 10. Backup and recovery procedure

- **Before rewrite**: `git bundle create bean-pre-rewrite.bundle --all`
  (§7.2 step 2). Store OFF-MACHINE (the bundle contains the secrets; treat
  it with the same sensitivity as the tokens — encrypted storage, limited
  access, expiry date ≥ 90 days).
- **The bundle is the recovery path**: `git clone bean-pre-rewrite.bundle
  restored` reconstructs the exact pre-rewrite history including the
  quarantined-WIP refs if bundled with `--all` from this sandbox. Do NOT
  distribute it.
- **Preserved-WIP recovery** (independent of the rewrite): the backup refs
  listed in §7.3 live in THIS sandbox's `.git`; export them before any
  sandbox recycle:
  ```bash
  for r in backup/m26-baseline-auto-commit backup/m26-f0b47ad-line \
           backup/m22-wip-auto-commit backup/m25-wip-auto-commit \
           backup/m25-intel-wip-auto-commit backup/laxii-pre-restoration \
           backup/pre-phase0-81caaa3 backup/pre-phase1-auto-commit; do
    git bundle create "$r.bundle" "$r"
  done
  ```
- **Never delete** the pre-rewrite bundle or the backup refs until §10
  verification (§11) has passed and ≥ 30 days have elapsed without incident.

## 11. Post-remediation verification (owner, after §7)

```bash
# 1. freshness
git fetch origin && git rev-parse origin/main           # == local main tip

# 2. unreachable-object check (expect empty)
git rev-list --objects origin/main origin/feat/laxii-jazmii-restoration \
  | grep -E "cookies|verify.db|e2e-out/(c2|cg-ck|pipeline-ck|uc[12])\.txt|login.json"

# 3. token-value check (expect zero bean_session hits)
bun run scripts/m261/secret-scan.ts

# 4. DB-census re-run (expect "DB blobs: 0")
bun run scripts/m261/db-census-driver.ts

# 5. release gates on the rewritten tip
bun run test && bun run build

# 6. GitHub UI spot check: open any pre-rewrite commit hash → expect 404
```

## 12. Outstanding items and responsible owner

| Item | Blocker | Owner |
|---|---|---|
| History rewrite approval + execution (§7) | explicit approval REQUIRED (no force-push rule) | repository owner |
| Server-side object GC + fork/mirror purge (§7.2 step 6, §9) | blocked on rewrite | repository owner |
| Collaborator re-sync (§9) | blocked on rewrite | repository owner |
| Provider-credential decision (§8) | masked keys unrecoverable from history | repository owner |
| Post-rewrite verification (§11) | blocked on rewrite | repository owner |
| Pre-rewrite bundle + off-machine storage (§10) | recommended before rewrite | repository owner |
| Session-token hash-at-rest migration (future milestone) | schema change, M26 §15 item 6 | BEAN maintainers |

---

**Automated-vs-owner boundary (explicit):** steps §2–§7.1 rows marked DONE
were executed by the M26.1 automated session and are reproducible from the
listed scripts/tests. Sections §7.2–§11 were **prepared, not executed**;
every command is documented for the owner to run. This document contains no
secret values by construction — every affected identity is represented by a
path, blob SHA or truncated hash fingerprint.
