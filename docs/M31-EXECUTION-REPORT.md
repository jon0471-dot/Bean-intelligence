# M31 — Execute the Complete Sanitized GitHub Repair — Execution Report

Milestone: **M31** · Date: 2026-11-22 (IST) · Authorization: owner instruction "M31 — Execute the Complete Sanitized GitHub Repair" (2026-11-22) ·
Remote operations performed: **NONE — zero pushes, zero PR actions, zero ref creation/deletion/rename, zero default-branch changes, zero force-pushes, zero history rewrite.** The publication freeze remains in force: the M31 brief itself states *"These pushes remain subject to the existing publication freeze. Do not treat this prompt as an automatic freeze-lift authorization."* Additionally, the execution environment holds **no GitHub credentials of any kind** (env tokens unset, no `~/.git-credentials`, no credential helper — verified fresh), so no authenticated remote mutation is possible from here. Every push below remains **prepared, proven, and execution-ready** for the owner's authenticated environment.

Evidence discipline: all facts re-established fresh this session — server-side `git ls-remote` (3 independent captures), unauthenticated GitHub REST reads (PR list, two compares, deployments; see the rate-limit note in §1), the new returncode-aware verification suite `scripts/m31_verify_state.py` (**ALL-PASS, 28/28 checks** at snapshot `d6c0c4e…`; machine-readable evidence in git-excluded `recovery/m31-audit/m31-verify.json`), and physical verification of the Gate 1 delivery package (checksums, structure, verifier hashes). Snapshot commit for all quoted counts: **sanitized tip `d6c0c4ea9645d82b5d1cf1cf6242cdab3d971514` (246 commits)**, taken before this report's own docs commit — all counts re-resolve the tip dynamically per the established M29-CR.1 §9 convention (after the M31 docs commit: |S| 247, SAN-UNPUBLISHED 20, universe 510 — re-proven green post-commit).

Consumes and extends: `docs/M30-BRANCH-RECONCILIATION-REPORT.md` and `docs/M30.1-FINAL-BLOCKER-RESOLUTION-AND-PUBLICATION-READINESS.md` (committed at the tip), `M26_1_5_R2_3_REDELIVERY_REPORT.md` (Gate 1 provenance), `M26_1_4_GITHUB_SUPPORT_STATUS.md` (post-publication cleanup request). One material correction to the prior record is documented in §9 (transparency) and fixed in code.

---

## 1. Fresh live state (this session)

| Ref (server-side `git ls-remote`) | Live SHA | Status |
|---|---|---|
| `HEAD` (default branch = `main`) | `91a68090ef72f71f52797bd88f9b83831fbeb997` | unchanged since M29 |
| `refs/heads/main` | `91a68090ef72f71f52797bd88f9b83831fbeb997` | unchanged |
| `refs/heads/feat/laxii-jazmii-restoration` | `e7d7003f36896b3ceaf07cde74d36275989469c1` | unchanged |
| `refs/heads/feat/m26-2-media-capabilities` | `8f61599271b1aa66e86a2c4956f6dc01eef8b737` | unchanged |
| `refs/heads/fix/laxii-image-output-ux` | `18c93ed7b1e433bb1c06c0a803d5adff0dcaf064` | unchanged |
| `refs/heads/main-sanitized` | **absent** | Op A2 precondition holds |
| `refs/heads/main-archive` | **absent** | rename not started |
| `refs/pull/1..7/head` | `8f615992`, `a0148628`, `3ec83650`, `8f615992`, `91a68090`, `18c93ed7`, `18c93ed7` | unchanged |

- Repo **public**, not a fork; nothing has advanced since the M29 audit (all four branch SHAs byte-identical; last recorded push 2026-11-21T05:59:27Z).
- Fresh API reads captured to `recovery/m31-audit/`: **PR list** — #1 **open** (base `main`@`a0148628`, head m262), #4 **open** (base `fix/…`@`18c93ed7`, head m262), #6 **open** (base `main`@`91a68090`, head fix), #7 **open** (base LJ@`e7d7003f`, head fix); #2/#3/#5 closed **merged** (M30.1 correction, confirmed). **Compares vs `main`**: m262 `diverged` **ahead 205 / behind 199**; fix `diverged` **ahead 206 / behind 199** — the exact reported figures, live. **Deployments: `[]` (0)**. Rulesets endpoint returns 404 unauthenticated (authenticated reads in M30.1: none exist). Rate-limit note: the repo-metadata and LJ compare calls were rate-limited mid-session (unauthenticated 60/h shared IP); the LJ facts below are carried by fresh object arithmetic + the M29/M30/M30.1 API record (`ahead 1 / behind 0`, status `ahead`) — no material gap.

## 2. Operations actually completed

1. **Fresh fact base** — 3× `ls-remote`, PR/compare/deployment API captures archived (`recovery/m31-audit/m31-*.json`).
2. **New returncode-aware verification suite** `scripts/m31_verify_state.py` written, committed, executed: **ALL-PASS 28/28** — remote state, all fast-forward proofs, lineage guard, containment (m262 22/0, fix 21/0 branch-only = 0), app-tree purity with **corrected objects** (two formulations), deploy-config surface scan (both trees: none), manifest 225/225 + G8–G10 89/89 absent, universe closes (509 = 246 + 263; SAN-UNPUBLISHED 19), LJ preservation facts.
3. **Defect found, fixed, documented** (§9): M30's committed purity check was vacuous (bad object constant + error-blind comparison); fixed in `scripts/m30_verify_state.py` and re-proven genuine.
4. **Gate 1 package physically verified** (§4): root `SHA256SUMS.txt` 21/21 OK, package sums 10/10 OK, verifier SHA-256s **match the M30.1 G1-a record byte-for-byte**, structure exact (verifier 5 files; batches 2/3/5 = 10 `.enc`; transfer guide, recovery manifest, separate 64-byte passphrase artifact mode 600 in a mode-700 directory).
5. **Gate 2 notification prepared** (Appendix A) — not sent; no authorized channel/destination exists in this environment.
6. **Gate 3 provider-by-provider checklist prepared** (Appendix E) — no secret values printed anywhere.
7. **D2/D3/D4/D7 conservative defaults recorded** (Appendix C) as recommendations, not authorizations.
8. **Default-branch migration + rollback finalized** (§7) — M30.1 §2 analysis carried forward with fresh platform-surface re-checks.
9. **Runbook finalized** (§8) — the two M31-approved pushes are Ops A1/A2; Phases B–E owner-gated.
10. **Evidence committed locally** as one docs-only commit on the sanitized branch (this report + `scripts/m31_verify_state.py` + the M30 script fix) — the established M29/M30/M30.1 pattern; application tree untouched (purity re-proven post-commit).

**Not executed, with reasons:** Ops A1/A2 (publication freeze not lifted by the M31 brief per its own §5; Gates 1-a/1-b/2/3 OPEN with zero closure evidence; no credentials in this environment); Phase B renames and default-branch change (separate recorded authorizations required); Phase C alignment pushes (depend on Phase B); Phase D PR closures (D7, owner action); LJ L2 (owner-gated history-meaning change).

## 3. Branch comparison results (live)

| Branch | vs old `main` (API, fresh) | vs canonical tip `d6c0c4e` (objects, fresh) | After Ops A–E |
|---|---|---|---|
| `feat/m26-2-media-capabilities` @ `8f615992` | `diverged` 205/199 | contained (0 branch-only; FF to tip proven) | **0/0 `identical`** after C1 |
| `fix/laxii-image-output-ux` @ `18c93ed7` | `diverged` 206/199 | contained (0 branch-only; FF to `e96d83a` and to tip proven) | **0/0 `identical`** after A1+C2 |
| `feat/laxii-jazmii-restoration` @ `e7d7003f` | `ahead` 1/0 (M29/M30/M30.1 record; fresh API rate-limited) | 200 ahead / 227 behind tip; **no FF exists**; zero unique content (tree ≡ old main; 0 non-merge unique commits) | L1 (recommended): diverged, documented; L2 (owner-gated): 0/0 `identical` |

A branch may be called **fixed only after** Phase E's live checks return `identical` on GitHub. None is claimed fixed.

## 4. Recovery-verifier status (Gate 1) — **FOUND, VERIFIED INTACT; OWNER EXECUTION REMAINS OPEN**

- **Located:** `download/M26_1_5_R2_OWNER_DELIVERY/M26_1_5_R2_OWNER_VERIFIER/` (exactly `Verify-WIP-Recovery.ps1`, `verify_wip.py`, `requirements.txt`, `README.md`, `EXPECTED_RESULTS.md`) + `download/M26_1_5_R2_OWNER_DELIVERY/M26_1_5_R2_WIP_RECOVERY/` (batch-a 2 + batch-b 3 + batch-c 5 = 10 `.enc`, `RECOVERY_MANIFEST.md`, `OWNER_TRANSFER_GUIDE.md`, `SHA256SUMS.txt`) + `download/M26_1_5_R2_OWNER_SECRET/` (64-byte passphrase artifact, mode 600, mode-700 dir; never printed).
- **Checksums verified fresh:** delivery root `sha256sum -c` **21/21 OK**; package sums **10/10 OK**. Verifier hashes match the M30.1 G1-a record exactly: `Verify-WIP-Recovery.ps1` = `261b3c1be8c652c5e6457e0514bd39b5d1b133eb362b506a0a46593eb6512661`, `verify_wip.py` = `5ba1ab7d5112153a2bb66f1ff638e96b8c7fe530a513430e821d3f1eb65ddd50`.
- **Authenticity & provenance (honest):** this is the **R2.3 RECONSTRUCTED edition** — the original R2.1/R2.2 verifier bytes were destroyed by the fourth workspace recycle and were never committed to Git; the reconstruction follows the documented R2.1 contract and the committed M26.1.3 crypto format, and all ten plaintext bundles were re-derived **byte-identically (10/10)** against the committed digest records before re-encryption (run-3 passphrase; R2.2 passphrase VOID). No substitute was fabricated as "original"; the README discloses the full provenance chain. Same-day recorded testing: **31/31 fixture suite** + wrong-key rejection (`InvalidTag`) + real-container proof (4,090 objects/0 missing) + **full real-package run (exit 0, 10/10)**, all under PowerShell 7.4.6 on Linux (`M26_1_5_R2_3_REDELIVERY_REPORT.md`).
- **PS 5.1 compatibility:** safe by construction — pure ASCII (0 non-ASCII bytes), 12 static scans for PS7-only syntax clean, AST parse 0 errors, `-ExecutionPolicy Bypass` documented, version-branched venv paths. Windows 5.1 has **not** been executed in this environment (Linux; pwsh not installed — fresh check), so the recorded limitation stands and G1-a is exactly the owner's first Windows run.
- **Remaining owner actions (OPEN):** **G1-a** — run `-ChecksumsOnly` on Windows (expected console: `encrypted files verified: 10 of 10`, exit 0; verify `Get-FileHash` values above first); **G1-b** — full verification (needs Python 3.9+; run-3 passphrase from the owner-secret delivery) and keep the real generated report; then move both artifacts to durable **owner-controlled off-machine** storage. Gate 1 closes only on the owner's recorded `GATE 1 CLOSED — OWNER VERIFIED`; a tool run cannot print that state. The primary bundle `bean-pre-rewrite-m2613.bundle` remains UNRECOVERED (verifier actively rejects it; record stands).

## 5. Collaborator-notification status (Gate 2) — **PREPARED, NOT SENT (no channel available here); OPEN**

No authorized communication channel or collaborator destination exists in this execution environment, so nothing was sent and no acknowledgment exists (none fabricated). The exact notification text is ready in **Appendix A**. The owner must send it via their channel and record who/when/channel + each acknowledgment. Requested acknowledgments: (1) old clones must not push; (2) PRs against old public `main` must not be merged; (3) sanitized history is the canonical development direction.

## 6. Credential-confirmation status (Gate 3) — **CHECKLIST PREPARED; INVESTIGATION STILL OPEN (baseline unchanged: "UNCERTAIN — DO NOT UPGRADE")**

The provider-by-provider checklist is in **Appendix E** (names and exposure surfaces only; no secret values are printed anywhere in this report). Current recorded baseline (unchanged from R2.3/M26.1.4): two observable **synthetic-looking** credential rows in the old public history; it cannot be proven that no real provider key was ever entered elsewhere; **no provider-side confirmation exists**. The G10 credential-forensic documents remain private (D3). Related owner-only item carried forward: the **GitHub Support server-side cleanup request** (`M26_1_4_GITHUB_SUPPORT_STATUS.md`) is prepared but **NOT FILED** — it may be filed only after publication, from the owner account, with its SHA placeholders re-derived from the actual published tips (its draft predates the M27–M28 migration plan).

## 7. Default-branch migration status — **FULLY VALIDATED, NOT EXECUTED (requires separate recorded authorization + OV-1..3)**

The rename-based transition (`main` → `main-archive`; `main-sanitized` → `main`; default branch → `main`) was consequence-analyzed domain-by-domain in M30.1 §2 and re-checked fresh this session: **0 deployments** (fresh API), **no workflows / Pages / hooks / environments / protection rules / rulesets** (M30.1 authenticated reads; rulesets endpoint confirmed non-readable unauthenticated), **no deploy-config files in either tree** (fresh scan: no `.github/`, `vercel.json`, `netlify.toml`, `.vercel/`, `Dockerfile`, `docker-compose.yml`, `render.yaml`, `fly.toml`, `app.yml` in old main or the tip). **Vercel remains the one unverifiable-from-GitHub surface** — owner dashboard items **OV-1..3** (which projects link this repo; each project's Production Branch; whether to suspend git integration until the sanitized tree build-verifies). Rollback preserves both histories with zero force-pushes: reverse the renames and re-set the default branch (`main-archive` @ `91a68090…` anchors the old lineage permanently). GitHub PR retargeting on rename is documented behavior but must be **verified, not assumed** (Phase B verification commands in the runbook).

## 8. Deployment verification — **GitHub platform surface: EMPTY (fresh); Vercel: owner dashboard (OV-1..3)**

- Fresh: `GET /deployments` → `[]`; deploy-config scan of both trees → none (§7). M30.1 same-day authenticated: 0 workflows, no Pages (`has_pages=false`), 0 webhooks, no environments, no protection, no rulesets.
- Consequence: nothing on the GitHub platform can trigger a deployment of either lineage. The only production-deploy surface is the Vercel git integration (if any project is linked), which cannot be inspected from here — OV-1..3 is a **pre-transition** owner requirement.

## 9. Corrections to the prior record (transparency)

1. **M30's committed purity check was vacuous — now fixed and re-proven genuine.** `scripts/m30_verify_state.py` (introduced with the M30 report commit `a339544`) used app-tree constant `d2c232a7862…`, which is **not an object in this repository** (the tree of the verified commit `d2c232a6fa2` is actually `d81fb3c1…`), and its error-blind stdout comparison reported PASS on a git `fatal: bad object` failure (exit 128, empty stdout). The M30/M30.1 *claims* remain true — M30.1's own `m301_verify_state.py` re-proved purity with the valid commit SHA (archived `E_proofs.app_tree_purity_diff_empty = true`, genuine execution), and M31 re-proves it freshly **two ways**: commit-level `d2c232a6fa2 → d6c0c4e` diff excluding docs/+scripts/ is **empty**, and tree-level `d81fb3c1 → d6c0c4e` diff excluding docs/ + audit scripts is **empty**; `src/`, `prisma/`, `package.json`, `next.config.ts` are byte-identical. The M31 suite is returncode-aware end-to-end, and the M30 script's constant + comparison are fixed in the docs commit accompanying this report. (Minor pattern note: `m301_verify_state.py`'s purity call also passed `check=False`; its objects are valid so its result was genuine — the error-blind pattern is now eliminated in the M31 suite and the patched M30 script.)
2. **Universe drift, classified:** 507 (M30.1 snapshot) → **509** now = +`d6c0c4e` (M30.1 report docs commit, SAN-UNPUBLISHED) + `b689ace` (workspace archive auto-snapshot, OLD-PRESERVATION-AUTO). Definitions unchanged; identity closes exactly (|S| 246 + |O−S| 263 = 509; SAN-UNPUBLISHED 19 at `d6c0c4e`; +1 each with this report's docs commit). No double counting ever existed (M30.1 §1 resolution stands: 6 local-only patch-equivalent originals are a strict subset of the 158 = 157 + 1).
3. No other corrections: PR states, compare figures, containment numbers, FF proofs, and gate statuses all reproduce the M30.1 record exactly.

## 10. Remaining owner-controlled blockers (every item OPEN until real evidence exists)

| # | Item | Precise owner action | Acceptance evidence |
|---|---|---|---|
| 1 | **Publication-freeze lift** | Separate, recorded authorization naming what may be pushed and by whom. *The M31 brief explicitly does not lift it.* | freeze-lift record |
| 2 | **Gate 1-a / 1-b** | Run the delivered Windows verifier (`-ChecksumsOnly`, then full) per Appendix D; move package + passphrase to off-machine owner storage | verifier report 10/10; owner confirmation record |
| 3 | **Gate 2** | Send Appendix A text via an authorized channel; collect acknowledgments | datestamped notification + acknowledgments |
| 4 | **Gate 3** | Complete Appendix E checklist against provider dashboards; record rotation/revocation (values never displayed) | findings + rotation confirmations |
| 5 | **OV-1..3 (Vercel)** | Dashboard check before any default-branch change | settings export / written record |
| 6 | **D2 / D3 / D4** | G9 WIP snapshots: keep private (recommended); G10 forensic docs: keep private (recommended); private backup refs: preserve (recommended) | decision records |
| 7 | **D7** | Close PR #4 as delivered-by-reconciliation (after A1); close #1/#6/#7 as superseded (prepared texts: M29-CONFLICT-RESOLUTION-REPORT §10) | PR close-out records |
| 8 | **Canonical-transition authorization** | Approve the rename-based transition (Phase B) as a separate recorded authorization | authorization record |
| 9 | **LJ choice (L1/L2)** | L1 = keep as archive with documented successor (recommended, zero risk, banner stays diverged); L2 = owner-gated force-with-lease alignment after backup ref | choice record |
| 10 | **GitHub Support cleanup request** | After publication: file `M26_1_2_GITHUB_SUPPORT_REQUEST.md` from the owner account with SHAs re-derived from the published tips; never claim cleanup complete until GitHub confirms | ticket number + GitHub confirmation |

## 11. Final execution runbook (prepared only — nothing below has been executed)

Ordering mandatory: **A → B → C → D → E**. Ordinary Git pushes (A, C) are separated from GitHub settings changes (B, D). `$tip` resolves dynamically at execution time (`git rev-parse reconcile/sanitized-m27-m28-migration`; snapshot `d6c0c4e…`) — never hardcode a docs-committed SHA. Every push is proven fast-forward (§3/§4 of the M31 suite) or explicitly owner-gated. Abort on any precondition mismatch. Full per-op text: M30.1 §5 (committed at the tip); the deltas below are M31-confirmed.

**Preflight (before every phase; abort on mismatch):** `git fetch --all --prune`; verify the four remote SHAs exactly as in §1; `main-sanitized` still absent; `git merge-base --is-ancestor e96d83a5… "$tip"`; containment checks; lineage guard `merge-base "$tip" origin/main` = `cafdb682…`; purity `git diff --stat d2c232a6fa2… "$tip" -- . ':(exclude)docs' ':(exclude)scripts'` = EMPTY (returncode-checked). Failure → STOP, re-run `scripts/m31_verify_state.py`, do not improvise.

| Op | Type | Command (verification after each) | Precondition → expected result |
|---|---|---|---|
| **A1** (= M31 Push 1) | **ordinary FF push** | `git push origin "e96d83a5196f45712350aaf41d13a1e5dfcebae7:refs/heads/fix/laxii-image-output-ux"` then `git ls-remote origin refs/heads/fix/laxii-image-output-ux` → `e96d83a5…` | freeze lifted + Gates 1–3 closed; parent-1 of `e96d83a` = `18c93ed` exactly; target still `18c93ed` → PR #4 conflict set clears; fix = 0 ahead / N behind (recompute live) |
| **A2** (= M31 Push 2; brief's literal SHA `082e064c…` is historical — push the live tip per the no-stale-refs rule) | **ordinary push, new ref** | `git push origin "${tip}:refs/heads/main-sanitized"` then `git ls-remote origin refs/heads/main-sanitized` → `${tip}` | A1 verified; ref still absent; publishes SAN-UNPUBLISHED (19 at snapshot; recompute) |
| **B1** | **GitHub settings — rename** | rename `main` → `main-archive` (UI or authenticated API); verify `git ls-remote origin` shows `main` absent, `main-archive` = `91a68090…` | Phase A verified; OV-1..3 recorded; canonical-transition authorization recorded; PRs #1/#6 auto-retarget — **verify, do not assume** |
| **B2** | **GitHub settings — rename** | rename `main-sanitized` → `main`; no PR references it (verified) | execute immediately; do not pause before B3 |
| **B3** | **GitHub settings — default branch** | set default → `main`; verify `refs/heads/main` = `${tip}` and API `default_branch` = `main` | canonical main active |
| **C1** | **ordinary FF push** | `git push origin "${tip}:refs/heads/feat/m26-2-media-capabilities"` → ls-remote = `${tip}` | Phase B verified; `8f615992` ancestor of tip → **0/0 `identical`** |
| **C2** | **ordinary FF push** | `git push origin "${tip}:refs/heads/fix/laxii-image-output-ux"` → ls-remote = `${tip}` | `e96d83a` ancestor of tip → **0/0 `identical`** |
| **C3** | **LJ — L1 default: NO operation** (archive + documented successor, Appendix B); L2 owner-gated: backup push `e7d7003…:refs/heads/backup/lj-pre-canonical-e7d7003` then `--force-with-lease` anchored to `e7d7003…` → `${tip}` | A-L2 authorization recorded | L1: diverged by documented choice; L2: **0/0 `identical`** |
| **D1** | **GitHub settings — PR closures (D7)** | close #4 (delivered-by-reconciliation after C2); close #1/#6/#7 (superseded; prepared texts) | clean PR end state |
| **E** | **read-only acceptance gate** | `git ls-remote origin` + per-branch `compare/main...<branch>` API loop | main = `${tip}`; main-archive = `91a68090…`; m262/fix = `${tip}` (0/0 `identical`); LJ per L1/L2; **only then may a branch be called fixed** |

**Failure/rollback:** push rejected → a remote ref moved mid-plan; re-run preflight, never force. Post-A rollback of a branch name is a rewind (force-with-lease) — emergency-only, separate owner authorization; no commit is ever lost (FF targets contain their own history; backup refs preserve LJ under L2). Phase B rollback: reverse the renames + re-set default (§7) — zero force, zero object loss, old lineage permanently reachable at `main-archive` @ `91a68090…`.

## 12. Tests / type checks / lint / build status

No application change is proposed or made by M31: the published tree is byte-identical to the verified `d2c232a` application tree (fresh proofs A/B/C, §2 op 2). The recorded battery **at that exact tree**: full unit suite **2410 pass / 0 fail** (M28-RESULTS) rising to **2445/0** with the M29-CR consolidation, plus `tsc` baseline, `eslint 186` baseline, prisma checks, **production build**, and secret scan — all clean (`1465cbb` commit record, M29-CR.1). A fresh battery run was **deliberately not** executed here: the sandbox working tree sits on the local WIP `main` line whose app content **differs** from the published tree (66-file delta, +7,964 lines — fresh `git diff` proof), so any run would test the wrong tree. The honest verification for the published artifact is the zero-diff proof + the recorded battery at the identical tree.

## 13. Final verdict

**BLOCKED** — blocked by owner-controlled gates, with zero unresolved technical issues and 100% execution readiness.

- Every check that can be executed without the gates was executed, fresh, and passed (28/28 + Gate 1 package verification + API captures).
- The publication freeze remains in force by the M31 brief's own terms; Gates 1-a/1-b/2/3, OV-1..3, D2/D3/D4/D7, the canonical-transition authorization, and the LJ L1/L2 choice are all OPEN with zero closure evidence; and this environment holds no credentials, so no authenticated remote operation is possible from here.
- No branch is claimed fixed. The end states in §3 are proven-in-principle from live object arithmetic and become claims only when Phase E's live checks return `identical` on GitHub.
- The moment the gates close with evidence and an authenticated environment exists, the runbook (§11) executes unchanged in order A→B→C→D→E: no force-push in the recommended path (the only force-with-lease is the owner-gated LJ L2, anchored to the exact live tip), no commit discarded, no history rewritten, old `main` preserved bit-for-bit as `main-archive`.

---

## Appendix A — Gate 2 notification text (ready to send)

> **Subject: Bean-intelligence — canonical `main` is changing to the sanitized history (action required)**
>
> The repository's `main` branch will be transitioned to the sanitized integration history (the line that excludes the sensitive session/database artifacts from the old public history). The old public history will be preserved unchanged as `main-archive` — nothing will be deleted or rewritten.
>
> What this means for you:
> 1. **Old clones must not push.** Any clone made before the transition carries the old `main`; pushing from it will be rejected (non-fast-forward). Re-clone or `git fetch && git reset --hard origin/main` on a clean branch after the transition is announced as complete.
> 2. **PRs against the old public `main` must not be merged.** Open PRs #1 and #6 target the old lineage and will be closed as superseded.
> 3. **Sanitized history is the canonical development direction.** After the transition, `main` denotes the sanitized lineage; all new work bases on it.
>
> Please reply with an acknowledgment of these three points. The transition will only proceed after acknowledgments are recorded.

## Appendix B — `docs/BRANCH-SUCCESSION.md` (prepared; commit on canonical main after Phase E per M30.1 §3.3)

> `feat/laxii-jazmii-restoration` @ `e7d7003f36896b3ceaf07cde74d36275989469c1` (2026-11-21) is a **historical archive**: its tree is byte-identical to the old public `main` tree (`91a68090…`, now `main-archive`), and its only unique object is the structural merge commit `e7d7003` itself (zero non-merge unique commits, zero unique content — proven by empty `git diff 91a68090 e7d7003` and empty `git rev-list --no-merges e7d7003 ^91a68090`). Its **content successor is canonical `main`** (sanitized lineage, tip `<sha-at-publication>`): the old-main content is fully represented there via the verified twin/transplant program (157 patch-id twins + 24 transplants; 158/158 recomputed, 0 failures). The branch is preserved unchanged; under owner-selected option L2 only, it would be aligned to canonical via a backup-ref-protected, lease-anchored move with separate recorded authorization.

## Appendix C — Owner decision defaults (recommendations, not authorizations)

- **D2** — G9 WIP snapshots: **keep private/archived** (no publication without explicit owner decision; destruction only with a destruction receipt).
- **D3** — G10 credential-forensic documents: **keep private/archived** (they document exposure surfaces; publish nothing).
- **D4** — private backup references (`refs/backup/scratch-bf47b8c` et al.): **preserve** (they are part of the verified preservation envelope; hygiene review is optional and owner-owned).
- **D7** — close superseded PRs **only after** the sanitized successor is published and Phase E verifies (`identical`), using the prepared close-out texts.

## Appendix D — Gate 1 owner quick-start (from the delivered README/EXPECTED_RESULTS)

```powershell
# 1) place the folder at C:\Tools\M26_1_5_R2_OWNER_VERIFIER and verify hashes first
Get-FileHash C:\Tools\M26_1_5_R2_OWNER_VERIFIER\Verify-WIP-Recovery.ps1   # expect 261B3C1B...12661
Get-FileHash C:\Tools\M26_1_5_R2_OWNER_VERIFIER\verify_wip.py             # expect 5BA1AB7D...DD50
# 2) checksum-only pass (needs nothing else; PowerShell 5.1 default shell)
C:\Tools\M26_1_5_R2_OWNER_VERIFIER\Verify-WIP-Recovery.ps1 -ChecksumsOnly `
  -PackagePath C:\Tools\M26_1_5_R2_WIP_RECOVERY
#    expected console end: "encrypted files verified: 10 of 10" / "UNCHANGED: YES" / exit 0
# 3) full verification (Python 3.9+ on PATH; run-3 passphrase from the owner-secret delivery; keep the report)
```
Then copy both artifacts to durable owner-controlled encrypted storage. Gate 1 closes only on your recorded `GATE 1 CLOSED — OWNER VERIFIED`.

## Appendix E — Gate 3 provider checklist (no secret values; status all OPEN)

| Provider / surface | Exposure surface in the old public history | Owner dashboard verification (record status, never values) |
|---|---|---|
| OpenAI (`BEAN_PROVIDER_OPENAI_API_KEY` family) | key-name surface in old tree; forensic scan rows | platform dashboard: rotate key; review usage/billing for foreign activity |
| Z.ai gateway (provider security review) | named in provider review | dashboard: rotate; review logs |
| Exa (research-reach channel) | research lane config | dashboard: rotate; review usage |
| Database host (`DATABASE_URL` — host redacted; detail in private G10 docs) | connection-string family in old history | host dashboard: rotate credentials; check connection logs |
| llamacpp (`BEAN_LLAMACPP_API_KEY`) | local inference lane; no external SaaS | confirm no external endpoint configured |
| Vercel / deployment env vars | configured outside the repo | dashboard inventory (OV-1..3); rotate if ever stored |
| Any credential entered outside env files | "cannot prove no real provider key was ever entered elsewhere" (recorded limitation) | owner review of personal credential stores |

*Zero-remote-operation confirmation: this session performed only read-only remote interactions (`git ls-remote`, unauthenticated REST GETs). Zero pushes, zero ref mutations, zero PR actions, zero settings changes. The M31 report, `scripts/m31_verify_state.py`, and the `scripts/m30_verify_state.py` fix are committed locally on the unpublished sanitized branch as one docs-only commit (established M29/M30/M30.1 pattern), leaving the application tree byte-identical to verified `d2c232a` (purity re-proven post-commit). Evidence archived git-excluded under `recovery/m31-audit/`.*
