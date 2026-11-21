# M26.1 RESULTS — BEAN Intelligence Security Closure & Operator Remediation

Milestone: M26.1 · Branch: `m261-security-closure` (built from remote `main`)
Final commit: `76e63af` — fast-forward push, remote-verified (§9).
Companion documents: `M26_1_OWNER_ACTIONS.md` (owner checklist), `M26_AUDIT.md`,
`M26_RESULTS.md` (the M26 verdict this milestone closes against).

**Verdict (§10): B — Automated remediation complete; owner actions remain.**

Headline finding: the M26 report documented "30 historical session tokens in
remote git history". The M26.1 census found the true exposure is **170
distinct session tokens**, including **7 tokens that were still live in the
published HEAD tree** until this milestone's fix commit — the M26 sweep's
name-based filter (`*cookie*`) missed them. Additionally, 8 published SQLite
database snapshots hold 143 further tokens, 100 user records and 2
AES-256-GCM credential ciphertexts that M26 never enumerated. All 170 tokens
are invalid against the live system (0 session rows; 0 unexpired); the
published history itself can only be cleaned by the owner-driven rewrite
that is prepared — not executed — in `M26_1_OWNER_ACTIONS.md` §7.

## 1. Initial repository state

| Item | Value |
|---|---|
| `git fetch origin` | performed first; no errors |
| Remote `origin/main` | `8cb93a9a9da0e6e0fec281d40cc717e47086689e` (the M26 results commit — one commit past the `38700d2` tip quoted in the M26 report; the results-report commit itself, expected) |
| Local `main` before work | byte-identical SHA `8cb93a9…`; `git rev-list --left-right --count main...origin/main` = `0  0` |
| Working tree at start | clean except milestone tooling added as the session progressed (`scripts/m261/`) |
| Remote refs | `HEAD` → `main`, `refs/heads/main`, `refs/heads/feat/laxii-jazmii-restoration` — no tags (`git ls-remote --tags` empty) |
| `git ls-remote` cross-check | `git rev-parse origin/main` == `git ls-remote origin refs/heads/main` == `8cb93a9…` |
| Prior releases verified | M25 train `3f40e75 → ea73545 → b0b03da` and all 9 M26 release commits present in remote history |
| M26 reports read | `M26_AUDIT.md` (S-2/S-3 detail, §1.1/1.2), `M26_RESULTS.md` (§15 operator actions), `M25_RESULTS.md` (device-code sensitivity) |
| Uncommitted WIP preserved | none present besides this milestone's own tooling; quarantined WIP remains on the LOCAL backup refs enumerated in `M26_1_OWNER_ACTIONS.md` §7.3 |

The current repository state was re-verified from scratch (tree listings,
row counts, scans) rather than assumed from the M26 report — which is
exactly how the 7 residual HEAD tokens and the DB snapshots were found.

## 2. Historical exposure assessment

Tooling (committed under `scripts/m261/`, values never printed — hashes
only): `secret-scan.ts`, `inspect-history-credentials.ts`,
`classify-hits.ts`, `cross-check-tokens.ts`, `db-census.ts`,
`db-census-driver.ts`, `extract-db-material.ts`, `union-tokens.ts`.

| # | Category | Count | Introduced by | In HEAD today |
|---|---|---|---|---|
| 1 | Cookie jars, `*cookie*`-named | 30 files / 30 tokens | `ad593b3`→`a94bece` (2026-10-25→11-05) | No (M26 removed) |
| 2 | Cookie-jar-shaped files WITHOUT "cookie" in the name (`scripts/e2e-out/{c2,cg-ck,cg-ck2,pipeline-ck,pipeline-ck2,uc1,uc2}.txt`) | 7 files / 7 tokens (0 overlap with #1) | `a634fcf` (2026-10-29) | **YES → removed by M26.1 `76e63af`** |
| 3 | SQLite snapshots `scripts/{e2e-verify-out,giftz-verify-out}/verify.db` | 8 blobs / 143 distinct tokens inside | sweeps ending ≤ `a94bece` | No (gitignored since M26) |
| 4 | login.json captures | 3 files (test-account ids/emails, no passwords) | `2af6299` et al. | No |
| 5 | 64-hex artifact hashes (`sha256=` acceptance evidence) | false positives — artifact digests, not tokens | — | tracked, benign |
| 6 | Test-fixture literals (`bgk_`, master-key env assignment, postgres URL, OpenAI-style key in `tests/unit/*`) | throwaway, valid only against the local dev DB | — | tracked, benign |

Union: 37 (jars) + 143 (in-DB) − 10 (overlap) = **170 distinct exposed
session-token identities**; plus 100 distinct user emails + scrypt hashes,
21 API-key hash rows (raw keys NOT recoverable — hash-only storage held),
2 vault ciphertexts (labels `disposable-e2e`), 5,379 message rows.

Why the snapshots are in scope: `verify.db` blobs are reachable from
`origin/main` (paths verified with `git rev-list --objects origin/main`),
i.e. **published**, not merely local. The vault master key
(`BEAN_CREDENTIALS_MASTER_KEY`) was never committed — a full-history search
found only env-NAME references in docs — so the 2 ciphertexts are not
independently recoverable.

## 3. Token revocation and rotation status

| Required action | Status | Evidence |
|---|---|---|
| Identify type/issuer/environment/auth system | DONE | opaque 64-hex `bean_session` cookies; issuer `src/lib/auth/session.ts` (`createSession`, 7-day TTL); issuer environment = local dev harness (localhost jars, isolated `verify.db` harness DBs) |
| Determine validity | DONE | live `Session` table = **0 rows**; snapshot rows 0/143 unexpired; jar expiries all ≤ 2026-11-12 → **0 of 170 valid** |
| Revoke/invalidate | EFFECTIVE BY CONSTRUCTION (verified) | the authoritative store for these tokens is the `Session` table of the deployed DB; it holds zero rows (live count query), so every exposed token fails lookup today |
| Rotate signing keys | **N/A — evidence-based** | sessions are validated by direct DB lookup, no HMAC/signing key exists to rotate; nothing to rotate in the live system (User/ApiKey/ProviderCredential counts all 0) |
| Issue replacements | N/A | the accounts behind the exposed material lived in reset/harness databases and no longer exist; fresh credentials flow through the normal login process, whose security is pinned by the new suite |
| Verify old tokens rejected | DONE | regression suite test 1 + 2 (absent token → null; expired row → null + deleted) |
| Verify new credentials work | DONE | suite tests 3–5 (valid round-trip; logout invalidation; password change revokes ALL sessions and the response reports `sessionsRevoked=true`) |
| Residual repo references | DONE for HEAD | §5 scans; published history remains (owner rewrite pending) |
| Tokens absent from docs/logs/tests/committed files | DONE | this report and the owner doc use paths, blob SHAs and truncated hash fingerprints only; the test suite generates fresh random tokens |

No token value was ever printed, logged or written to any file in this
milestone. Every fingerprint in the documents is `sha256(value)[:16]` — a
one-way truncated digest used solely for set arithmetic.

## 4. Git history remediation status

**Prepared, NOT executed** — per the no-force-push rule and the explicit
requirement that history rewriting awaits repository-owner approval.

- Every affected commit identified: introduction train
  `ad593b3 → a94bece` (13 commits; the 7-file group entered at `a634fcf`),
  deletions in `7f66c47`/`be2622d` (M26) and `76e63af` (M26.1).
- Every affected reference identified: `refs/heads/main` and
  `refs/heads/feat/laxii-jazmii-restoration` (the latter is an ancestor of
  `main`, sharing the same history — a main-only rewrite would leave it
  holding the jars at its tip; both refs must be rewritten together). No
  tags exist. The 8 LOCAL `backup/*` refs are verified never-pushed and are
  explicitly excluded from the rewrite (they preserve quarantined WIP).
- `git filter-repo` procedure with the complete 48-path list, pre-rewrite
  bundle backup + SHA recording, pre-push local verification, explicit-ref
  force push, server-side GC, and a 6-step post-rewrite verification — all
  documented in `M26_1_OWNER_ACTIONS.md` §7.2/§11.
- Collaborator/CI implications (stale-clone re-push hazard, cache purge,
  PR re-basing, fork purge) documented in §9.
- **No remote object has been rewritten, deleted or force-pushed by this
  milestone; the pre-rewrite bundle has NOT been created yet** (creating it
  is owner step §10, so the recovery copy stays under owner control).

## 5. Workspace WIP quarantine results

The quarantined-WIP set (160 files added by the
`backup/m26-baseline-auto-commit` line relative to the fix tip `76e63af`:
153 quarantined-WIP files + the 7 token files this milestone removed from
HEAD) was re-inventoried file-by-file (`scripts/m261/quarantine-inventory.ts`),
and the full per-file record — path, git status, sensitivity class,
secrets/PII flag, staleness, future-milestone tag, retention verdict — is
committed as `docs/M26_1_QUARANTINE_INVENTORY.md`. Summary:

| Class | Files | Sensitive? | Retain? |
|---|---|---|---|
| Workspace feature (S-1 quarantine) | 34 | no secrets; unreleased feature | YES, on local refs only |
| Session/live-run artifacts (incl. the 37 jars' disk copies) | 30 | YES — tokens | YES on local refs only; never release |
| Postgres staging tooling + outputs | 16 | placeholders only (`user:pass@host` literals verified) | YES, future milestone |
| DB snapshot + env snapshot + device code | 3 | **YES** | YES on local refs only |
| Hardware-gated worker config (`workers/wan22/`) | 2 | no secrets | YES, future milestone |
| Load-test / harness outputs | 11 | emails/PII-low only | YES, local only |
| General WIP (docs, evidence, reports) | 56 | emails/PII-low only | YES, local only |

Verification performed:

- `git status --porcelain` clean at the fix commit — **no quarantined file
  is staged** in any M26.1 commit.
- No secret is in the release artifact: tracked-tree scan = 0 token hits;
  `.next/standalone` inspected = clean.
- No generated build output or local credential file is committed: `.env`,
  `db/`, `.next/`, `node_modules/`, `backup/` all ignored (verified via
  `git status --ignored`).
- Nothing quarantined was deleted or restored: the only working-tree
  deletions are the 7 token files (release-safety), and the diff of every
  M26.1 commit contains only them + `.gitignore` + new tests/tooling/docs.

## 6. Secret scan results

| Scan | Scope | Result |
|---|---|---|
| Tracked-tree scan (2,473 → 2,466 files, 13 pattern classes) | HEAD | before fix: 7 `bean_session` hits (the missed jars) + benign classes; **after fix `76e63af`: 0 token hits**; remaining hits = 64-hex artifact digests + test fixtures (each classified, §2 row 5/6) |
| Untracked-not-ignored scan | working tree | 0 hits |
| Published-history blob scan (5,172 unique blobs from both remote refs) | `origin/main` + `origin/feat/*` | 67 blobs with hits → 57 paths → the §2 census (37 jars, 8 DB blobs, 3 login.json, evidence digests, test fixtures) |
| Vault-master-key history search (`-S`) | all refs | env-name references only — **no key literal ever committed** |
| Release artifact inspection | `.next/standalone/.next/server`, `.next/static` | clean |

**Scanning limitations (honest):** (1) regex classes catch token-shaped
material, not arbitrary secrets — a novel credential format could evade the
13 classes; (2) binary blobs are scanned as bytes, so a 64-hex match inside
compressed content would be missed (the SQLite snapshots were parsed
directly, not regex-scanned, which is why the census is trustworthy);
(3) `git rev-list --objects` covers reachable objects — objects unreachable
from any ref (orphaned) are not scanned but are also not cloned by
collaborators; (4) provider-side leakage (a provider key used elsewhere) is
invisible to any repo scan — that is the §8 owner decision.

## 7. Security regression results

| Gate | Result |
|---|---|
| New suite `tests/unit/m261-session-token-lifecycle.test.ts` | **7 pass / 0 fail** — old-token rejection; expired-row rejection + cleanup; valid round-trip with no token material in the payload; logout invalidation kills the same cookie; password change revokes EVERY session (S-8, response reports `sessionsRevoked=true`); token shape uniqueness (64-hex, per-login unique); wrong password does not rotate hash nor touch sessions |
| Auth/API-key/session regression (existing suites) | `api-keys`, `api-keys-projects`, `origin`, `portal-tenancy`, `security-crypto`, `api-rate-limit-headers` — all green inside the full run |
| Full canonical suite `bun run test` | **2,188 pass / 0 fail / 159 files / 39,587 expects** (M26 baseline 2,181 + 7 new) |
| Scoped `tsc --noEmit` | **0 errors in `src/`+`tests/`** (pre-existing `scripts/` debt unchanged, documented M26 §12) |
| `eslint src tests` | clean |
| Production build `bun run build` (server stopped — documented S-4b window) | **PASS**, standalone `server.js` verified |
| Live DB untouched | the deployed DB is read via read-only connections throughout; no test writes near it |

## 8. Owner actions still pending

Full detail in `M26_1_OWNER_ACTIONS.md` §12; summary:

1. **History-rewrite approval + execution** (`OWNER_ACTIONS` §7) — the 170
   tokens, 8 DB blobs and 3 login.json captures remain reachable in remote
   history until the owner runs the prepared procedure (both refs, bundle
   backup first, server-side GC, fork/mirror purge).
2. **Pre-rewrite bundle** (`OWNER_ACTIONS` §10) — must be created by the
   owner so the recovery copy stays under owner control.
3. **Provider-credential decision** (`OWNER_ACTIONS` §8) — rotate or
   confirm-throwaway for the 2 published vault ciphertexts (unreadable
   without the never-committed master key; decision recorded with sign-off).
4. **Collaborator/CI re-sync** (`OWNER_ACTIONS` §9) and **post-rewrite
   verification** (`OWNER_ACTIONS` §11) — blocked on 1.

Nothing in the current deployment requires an owner credential action: 0
sessions, 0 users, 0 API keys, 0 provider credentials exist in the live DB.

## 9. Files changed and commit SHA

| Commit | Contents |
|---|---|
| `76e63af` | fix(m26.1): the 7 residual token files removed from HEAD; `.gitignore` hardened (`scripts/e2e-out/*.txt`, harness DB snapshots under `scripts/*-out/`); session-token lifecycle regression suite (7 tests); `scripts/m261/` scan/census tooling |

Document-only commit follows on the same branch before push. Branch
strategy: `m261-security-closure` built from `origin/main` (`8cb93a9`);
push method: fetch → FF pre-check (`git merge-base --is-ancestor
origin/main HEAD`) → fast-forward-only push → immediate
`git ls-remote origin refs/heads/main` equality check. **No force push; no
history rewrite; no backup ref touched.** The docs tip cannot embed its own
SHA; the push-time tip equals the remote `main` SHA recorded by the
verification step and remains checkable with
`git rev-parse origin/main` (expected train: `8cb93a9` → `76e63af` →
docs tip).

## 10. Final security closure verdict

Release train: `8cb93a9` (remote main at fetch) → `76e63af` (fix) →
docs commit (tip). Post-push remote verification: `git ls-remote origin
refs/heads/main` == local `m261-security-closure` tip (equality asserted
immediately after the fast-forward push).

**B — Automated remediation complete; owner actions remain.**

- What is closed and independently verified: the live-system exposure (0
  valid tokens, 0 accounts to rotate for), the HEAD-level release hygiene
  (0 token-bearing files in the published tree after `76e63af`, scan- and
  artifact-verified), the rejection/invalidation/revocation semantics
  (regression suite), and the gates (2,188/0 tests, tsc, eslint, build).
- Why not A: required owner actions remain outstanding — the published
  history still holds all 170 tokens and the 8 DB snapshots, and the
  provider-credential decision is not recorded. Per the milestone rules, A
  cannot be claimed while any required owner action is outstanding.
- Why not C: every P0 item either holds an executed, verified mitigation
  (revocation effective, HEAD clean) or a prepared, precisely-scoped owner
  procedure (`M26_1_OWNER_ACTIONS.md`) — no P0 item is unmitigated or
  unowned.
- Honest scope statement: the scans cover reachable Git objects with 13
  pattern classes plus direct SQLite parsing; a novel credential format or
  provider-side leakage would not be visible from the repository. The
  verdict applies to the tested single-instance deployment with the repo
  kept private until the rewrite completes.
