# BEAN Intelligence — Project Handoff (Session Continuity Document)

> Maintained for future Z.ai development sessions. Last updated: 2026-11-28 (UTC+8).
> This document contains environment variable NAMES only — never secret values.

## 0.b CURRENT STATE ADDENDUM (2026-11-28 — M48.1 publication reconciliation; supersedes the publication-state claims in 0.a)

- **ALL FOUR PUBLICATION PRs MERGED — M48 IMPLEMENTATION GATE COMPLETE (independently verified 2026-11-28 via `git fetch --prune`, `git ls-remote` and authenticated GitHub API; historical claims re-measured, not assumed).** PR #41 (complete M47 delivery, six commits `95620d9`→`a1ce6fa`) MERGED — merge commit `683ffc40132b94db0d57c34ef5a7fad88869087d`. PR #42 (M48 baseline document, `4cc1e92`) MERGED — merge commit `bafc9aa2d2a7a57f5d4e74c91acaa5848efdd5fc`. PR #43 (P0 hotfix publication, `457d9f0`) MERGED — merge commit `ae0d06c3154c7a1ebf90b0c84461ac97acf9e655`. PR #44 (P0 reliability implementation, `5bfb896`) MERGED — merge commit = **current `origin/main` `ed3ede98db7ca4ecea2ad66ae41f62942cad64e5`** (parents `ae0d06c` + `5bfb896`). Ancestry proven: `a1ce6fa` (M47 final), `4cc1e92` (M48 baseline), `5bfb896` (P0 final) are all ancestors of main — no M47/P0 delivery commits remain outside main; **M48 implementation gate: COMPLETE**, final M48 starting SHA `ed3ede9`. Section 0.a's publication-state claims ("PR #41 still OPEN", "main at `bafc9aa`", "LIVE 12 / LOCAL-INT 41") were accurate at its writing and are now superseded; the P0 acceptance doc was re-evaluated per-scenario in M48.1 with the corrected exclusive distribution **LIVE 13 · LOCAL-INT 40 · HONEST_UNAVAILABLE 1 = 54** (`docs/intelligence/P0-ACCEPTANCE.md` revision note). **M48.1 IN PROGRESS (branch `feat/m48-1-github-readiness`, linked worktree `m48-1-wt`, created from verified `ed3ede9`):** GitHub credential & repository readiness — one authoritative write-readiness decision aligned with the actual execution policy (`writeLaneAvailability` vs `checkRepoPolicy`), real credential validation via the existing M45/M46/M47 adapter (no second GitHub integration), read-only live acceptance, hermetic readiness tests. No production writes; owner retains all merge authority.

## 0.a CURRENT STATE ADDENDUM (2026-11-28 — P0 RIISHE reliability hotfix)

- **P0 RIISHE ALWAYS-RESPOND HOTFIX DELIVERED (2026-11-28, branch `fix/riishe-always-respond`, linked worktree `riishe-reliability-wt`; every milestone committed + pushed + remote-SHA-verified).** Owner-mandated product-reliability repair: RIISHE must behave like a working AI assistant, not an infrastructure status page. Verified start: origin/main `bafc9aa` (owner merge of PR #42 = the M48 baseline doc — the only main change since `82fd028`); **PR #41 (six M47 commits) still OPEN and untouched**; the hotfix branch was built FROM the complete M47 tip `a1ce6fa` (per mandate) then ordinary-merged with main → base `683ffc4` (full M47 ancestry proven: a1ce6fa, bafc9aa, 4cc1e92 all ancestors). Commit trail: `457d9f0` baseline doc → `e73f49c` R1 (ResearchStatusStrip relocated to restricted admin diagnostics; customer-facing completion policy `src/lib/riishe/completion-policy.ts` separating conversation delivery / evidence verification / operational execution — the false "Completed with limitations" badge on ordinary chat is GONE without touching internal Trust semantics; governed calculate tool executions now map to COMPUTATION_VERIFIED; "search not warranted" is policy, never degradation) → `ec88c76` R2 (FIRST SSE data event carries the conversation ID — `writer.send({conversationId})` right after `: connected`; bounded dead-wire recovery schedule `RECOVERY_SCHEDULE_MS` [0,8s,20s,40s] in `src/lib/riishe/retry.ts`; adoption never duplicates messages and never replays requests) → `aabefac` R3 (consented browser-local fallback `src/lib/riishe/local-fallback.ts` — eligible hosted inference failure + explicit on-device consent + model already loaded + nothing streamed + no attachments → the EXISTING on-device runtime answers with honest on-device disclosure; no silent downloads; server failover contracts re-pinned by provider-fallback suite) → `b63db73` R4 (research-failure isolation: an exploding retrieval lane degrades the turn honestly — TOOL_UNAVAILABLE + note — instead of aborting the answer; stream reliability reviewed in source + existing suites) → R5 acceptance/docs commit. **Fresh measurements: tsc 234 = 234 (zero delta); full per-file hermetic census 247 files = 3,355 pass / 0 fail / 10 skip (M47's 3,322/0/10 + exactly the 33 new P0 cases); eslint clean; production build exit 0 (NOTE: fresh bun installs skip postinstall — run `prisma generate` before `next build`).** PREVIEW (real app, production build, isolated DB copy `db/p0-preview-test.db`, `BEAN_TRUSTED_ORIGINS=http://localhost:3100`, real Chromium): 7 real hosted turns streamed (incl. Tamil + Hindi + a follow-up turn), 0 limitation badges + 0 status-strip occurrences on desktop AND mobile, LIVE SSE wire capture shows the FIRST data frame = identity-only conversationId, live disconnect persisted exactly 1 user + 1 assistant row (no duplicates) with `taskStages=['verifying']` and NO limitation stage (independent Prisma DB read), mobile `scrollWidth <= clientWidth` (no overflow), console + page errors EMPTY on every segment. ACCEPTANCE: `docs/intelligence/P0-ACCEPTANCE.md` — 54 unique scenarios, ONE classification each: LIVE 12 / LOCAL-INT 41 / HONEST_UNAVAILABLE 1 (the consented local-model fallback with a REAL model — no WebGPU/GPU in the headless preview env; owner-verifiable). The assistant performed NO merges: PR #41 awaits the owner; no main-targeted hotfix PR was created (mandate forbids a misleading duplicate while PR #41 is open); this branch merges cleanly after PR #41 (fast-forward-compatible, the six M47 commits exist exactly once in its history). Docs: `docs/RIISHE-RELIABILITY-BASELINE.md`, `docs/P0-RIISHE-RELIABILITY-REPORT.md`, `docs/intelligence/P0-ACCEPTANCE.md`.

## 0. CURRENT STATE (2026-11-27 — supersedes the snapshot in §1 for sync purposes)

- **M44 DELIVERED (2026-11-27, branch `feat/m44-autonomous-decision-execution`, tip `3947ae1` pushed + remote-verified):** autonomous decision intelligence & verified execution, stacked on the COMPLETE M43 history (including the four then-branch-only M43 commits `d0e7dff`/`9f02b04`/`ce4df4a`/`ec5adb2`) and reconciled with main `0861430` via content-identical normal merge `0c9b4c0`. Implementation trail (every SHA pushed + remotely verified): `beb8ff2` baseline report (73 stale worktree leftovers archived; the zcode-driver watchdog documented — it force-checks out main on the PRIMARY worktree every few seconds, so all M44 work ran in the linked worktree `m44-wt`, the repo-precedented pattern), `89dd730` decision engine + action contracts, `c5f26dd` authorization gate + execution lifecycle + independent verification + recovery, `bb8b445` shared verified-action runner + all-product mission bridge, `7b8c842`/`3947ae1` 20-area acceptance suite. **OBSERVED (2026-11-27, recorded by the M44 session — NOT performed by it): the OWNER created and merged PR #34** (→ main, merge `d11462e`, parents `0861430`+`c5f26dd`) while the session was running — main now carries M44 through m44.2; the commits after it (`bb8b445`, `7b8c842`, `3947ae1`, docs) await the owner's next action. Full suite 3176/0/10 across 235 files (+77 = the M44 tests); production build exit 0; acceptance window 19 PASS / 1 honest-unavailable (the delegated live UI walk — performed: sign-up → dashboard → RIISHE live grounded probe with the verification + contradiction notes rendering through the UNCHANGED customer UI; 8 screenshots in validation/m44-ui/; 0 page errors) / 0 FAIL. Standing M44 rules: `EXECUTING → SUCCEEDED` is structurally illegal (only a confirmed independent verification opens the SUCCEEDED edge); approvals bind to the exact plan digest (modified → digest-mismatch, re-planned → plan-stale); only owner-user decisions approve human-class actions; delegated scopes must be subsets of the grantor's; policy self-modification is refused before the gate; unverified execution observations never become trusted knowledge (M43 guard); actions without a real execution path (push/deploy/publish/pay) are refused honestly even with a granted approval. Docs: docs/M44-IMPLEMENTATION-REPORT.md + docs/intelligence/M44-*.md (2 files) + docs/M44-BASELINE-REPORT.md.
- **OBSERVED (2026-11-27, recorded by the M43 session — NOT performed by it): the OWNER created and merged PR #33** (`feat/m43-real-world-intelligence` → main, merge commit `0861430`) while the session was still working: main advanced `5cad5a0` → `0861430`, bringing everything through `dd84b44` (m43.0 baseline … m43.10 acceptance suite) into main, which therefore now also contains the complete M42 history (`a75b62b`/`ace7023`/`e02b551`/`9d05757` all verified ancestors). The branch carries THREE further commits awaiting the owner’s next action: `d0e7dff` (m43.11 suite-found mock fix + full-suite re-run green), `9f02b04` (m43.12 live UI walk record), `ce4df4a` (m43.13 documentation set). No merge, no force-push, performed by this session.
- **M43 COMPLETE (2026-11-27, branch `feat/m43-real-world-intelligence`, NOT merged — awaiting owner authorization):** real-world intelligence, evidence reasoning & continuous knowledge, stacked on the COMPLETE M42 history (tip `9d05757` — including the three branch-only commits `a75b62b`/`ace7023`/`e02b551` that main lacks) and reconciled with main `5cad5a0` via normal merge `fee31c2`; PR #33 was verified NOT to exist. Implementation trail (every SHA pushed + remotely verified): `95f8dee` evidence representation + source trust, `03ce9dc` claim verification (8-outcome honest ladder), `8b60027` contradiction/uncertainty (M37 engine reused), `8f0e217` freshness policies, `12a2cef` traceable knowledge memory (Prisma EvidenceKnowledge + THE GUARD), `ebdbf49` all-product integration, `3f5abca` security hardening, `dd84b44` 20-area live acceptance suite (recorded window: 20 PASS / 0 unavailable / 0 FAIL; real CVE-2020-28500 advisory from osv.dev), `d0e7dff` suite-found mock fix (bisected; baseline verified 0-fail), `9f02b04` live UI walk (0 new panels; 0 page errors). Full suite 3099/0/10; production build exit 0; prisma additive push applied locally (production DB migration = owner operation). Docs: docs/M43-IMPLEMENTATION-REPORT.md + docs/intelligence/M43-*.md (5 files). Standing M43 rules: evidence verdicts are never forced to PASS; unverified research notes can never be stored as trusted knowledge; updates supersede, never destroy history; the evidence layer performs no network of its own.

- **origin/main** = `cc21b80` → **`5cad5a0`** (PR #31, M41.7 complete; then **PR #32 — merged by the OWNER on GitHub 2026-11-26 22:13 IST while the M42 session was running** — brought `feat/m42-universal-web-research-access` through `6409257` into main: M42.1 contract, M42.2 mission integration, M42.3 adapters + runtime-guard fix, M42.3b security/community adapters). M41 phases are all merged (PRs #24/#26/#27/#28/#29/#30/#31).
- **Open working branch:** `feat/m42-universal-web-research-access` (tip `e02b551`, 3 commits ahead of main). Beyond the owner-merged set it carries: M42.5 (`a75b62b` — race-loser rejection sinks at all four research-path timeout races + the live 7-consumer specialist-contract acceptance, 9/9 PASS), the M42 documentation set (`ace7023` — operating manual, source-platform coverage with 9 adapter decision records, agent reference contract, security/copyright/privacy, implementation report, worklog/HANDOFF/capability updates) and the final verification sweep record (`e02b551` — full suite 2990/0/10, production build exit 0, secret sweep clean, 0 UI files touched). Every pushed SHA was fetched back and independently verified. **The M42-session itself performed NO merge — the observed PR #32 merge was the owner's own GitHub action; the 3 remaining commits await owner authorization.**
- Standing M42 rules: one shared research gateway + one evidence contract (`src/lib/research/agent-evidence.ts`); no per-product scrapers; honest registry states (`available / requires_configuration / requires_login / experimental / unavailable / disabled / not_integrated`); "supports all websites" is never claimed; do not enable paid/restricted platforms without owner approval.
- Worklog entry `0-M42` (worklog.md) carries the full milestone trail with live-evidence summaries.

## 0.1 Permanent GitHub Sync & Update Policy (standing, every session)

**Official repository (confirmed by owner 2026-11-12):** `https://github.com/jon0471-dot/Bean-intelligence.git` — owner `jon0471-dot`, name `Bean-intelligence`, branch `main`. Never switch repositories, never push to similarly-named repos, never create replacements without explicit owner approval.

**Workflow for every completed change:** MAKE CHANGE → TEST → REVIEW → SECURITY SCAN → COMMIT → PUSH → VERIFY.

1. Complete the task; run relevant tests/validation.
2. Inspect the complete diff; check for out-of-scope changes.
3. Scan staged files for secrets/credentials/keys/DB files/session tokens/PII/generated runtime data; confirm sensitive files are excluded from tracking (see §10 rules).
4. Commit with conventional message (`feat(scope): …`, `fix(scope): …`, `refactor(scope): …`, `security(github): …`, `docs(scope): …`, `chore(scope): …`).
5. Push to `main` immediately when all checks pass — do not wait for the owner to say "push".
6. Verify the push against the remote reference (`git ls-remote` or GitHub API) and report the exact SHA + verification result. Never claim GitHub is updated without remote verification.

**Safety (never bypass):** no force-push, no remote-history deletion/overwrite, no secrets/.env/DBs/session data/generated media/logs/uploads in commits, no blind remote-file replacement, no discarding local work, no unrelated functionality changes, no unverified "tested" claims. If anything blocks a safe push: stop, preserve local work, explain the blocker, propose the safest recovery.

**Session start checklist:** verify repo + branch (`main`); check connectivity + write permissions; `git fetch origin`; inspect remote changes; preserve local uncommitted work; reconcile remote changes safely before developing; never overwrite newer remote work.

**Authorization:** established once via the persistent repo-local git credential store (2026-11-12; account pinned `jon0471-dot`; `credential.helper = store --file=<repo>/.git/git-credentials`, mode 0600, git-internal and never committed) and reused across sessions — pushes resolve automatically with no per-push login. Never re-ask while valid; if verification fails (`scripts/gh-credential-verify.py`, git-excluded, reports identity + push permission without ever displaying the token), stop and report; never ask the owner to paste tokens/passwords into chat. The GitHub CLI device flow is a FALLBACK for genuine authentication failure only (`scripts/sync-policy.md` §3.3, git-excluded).

**§0.1 Current sync state (2026-11-14 — supersedes the historical §1 table below for anything it contradicts):**

| Item | Measured 2026-11-14 |
| --- | --- |
| `origin/main` | `6c280e4` (frontend intelligence toolkit) — the §1 reconciliation push and all later verified work are PUBLISHED |
| Working clone | the full clone inside the sandbox workspace, branch `feat/agent-reach-integration` at `d33e530` (Agent Reach integration, parent `6c280e4`) — `origin/main` is a verified strict ancestor, so any commit on top fast-forwards `main` |
| LAXII/JAZMII restoration | built and verified on top of `d33e530` — see `docs/LAXII-JAZMII-RESTORATION-AUDIT.md`, `docs/LAXII-JAZMII-RESTORATION-REPORT.md`, `scripts/laxii-jazmii-restore-out/EVIDENCE.md`; commit `feat(bean): restore LAXII and JAZMII capabilities` pushed to `main` as a fast-forward (remote SHA verified with `git ls-remote`) |
| Dashboard truth after restoration | LAXII operational (t2i / conversational-editing / background-removal / deterministic enhancement all real-attempt-evidenced; local Diffusers worker honestly `not-configured` — no GPU host); JAZMII operational (t2v + i2v real-attempt-evidenced; ffprobe availability reported) |
| Sandbox workspace note | `/home/z/my-project` (the sandbox root) holds a STALE parallel checkout on a junk local commit (`5246b52`: embedded-repo gitlinks + ~229 MB Obscura reference binaries) — it is NOT the delivery vehicle; the nested full clone is authoritative. Any session finding this layout should sync the outer workspace from `origin/main` (backup branch first) or simply work inside the nested clone |

## 1. Repository & Sync State

| Item | Value |
| --- | --- |
| **Official repository** | `https://github.com/jon0471-dot/Bean-intelligence.git` (public, default branch `main`, HEAD `a705bdb`, 74 commits) |
| Branch | `main` |
| Local HEAD at handoff | `27afc3e` (96 commits: 64e092f + sync-prep 3052104 + tracking-hygiene 27afc3e; working tree clean) |
| Discarded candidate name | `bean-ai-Inteligence` — not publicly visible (404); owner confirmed the official repo is `Bean-intelligence`; do not use the other name |

**History relationship:** local and remote histories are **parallel but unrelated by SHA** (same commit messages, different roots: local `9d4dd82` vs remote `d85a9f2` — the remote was re-rooted when first pushed). Remote-only content: `a705bdb` (+20 `.gitignore` secret/runtime rules) and `d38074a` (pure chmod sweep, 1608 files, 0 content lines). Local is ahead by the entire verified recovery work (~20 meaningful commits). File-tree divergence: 85 files only-in-local (scripts/docs/tests/src evidence of verified work), 3 files only-in-remote (`.zscripts/dev.pid`, the two `verify.db` files — all sensitive/runtime).

**Reconciliation — EXECUTED 2026-11-12 (owner-approved), push pending authorization:**
1. **Local history purge: DONE.** `git filter-repo --prune-empty never --invert-paths` removed every sensitive/runtime path from all 99 commits (`.env`, `db/custom.db*`, both `verify.db`, `sandbox-runs/`, `storage/`, `upload/`, `tool-results/`, `dev.log.pre-recovery-1103`, `.zscripts/dev.pid`, junk sentence-named PDF). `.git`: 169 MB → 53 MB (92 MB after absorbing remote history via the merge). Full pre-purge backup: `backup/bean-pre-purge-20261112.bundle` (103.7 MB, gitignored). Commit-map: `.git/filter-repo/commit-map`.
   **Old→new SHA mapping (reference commits):** `1e3f7cc`→`60b1346`, `c1a77e5`→`0375512`, `9b1eeb9`→`ee2cb63`, `e96d757`→`5a2f471`, `a5d8b16`→`350f974`, `b902fa3`→`fb72337`; sync commits `3052104`→`77aeac7`, `27afc3e`→`f1bf804`, `fad4457`→`55702a0`, `bf83073`→`35d5370`.
2. **Remote reconciliation merge: DONE.** `merge(github)` commit **`443b6f2`** = parents `35d5370` (local lineage) + `a705bdb` (remote main tip). `-X ours` resolution (local verified-newer everywhere); `.gitignore` union = local superset; remote-only legitimate content kept (`download/README.md`); remote-only runtime/sensitive files (`verify.db` ×2, `dev.pid`, `dev.log.pre-recovery-1103`, remote `tool-results/*`) removed from the resulting tree. Resulting tree vs pre-merge local HEAD: exactly one file (`download/README.md`).
3. **Validation: PASSED.** Full suite 1367/0; tsc 0 errors (src+tests); lint clean; sensitive paths absent from every LOCAL-lineage commit and from the push delta `a705bdb..443b6f2` (99 commits, zero sensitive objects); tree content secret scan clean; remote main unchanged at `a705bdb`.
4. **Push: PENDING** — `git push origin main` is a fast-forward (merge commit contains `a705bdb` as parent); blocked only by missing GitHub write authorization in the sandbox (dry-run probe: "could not read Username"). Next session with valid auth: verify remote main still `a705bdb` → `git push origin main` → verify remote SHA == pushed SHA.

**Session-token revocation (exposure remediation, 2026-11-12):** the public `verify.db` files were NOT synthetic fixtures — they are production-DB copies (scrypt password hashes of real users; 143 exposed session tokens, 80 of them matching LIVE production sessions, all unexpired). **All 80 matching production sessions were revoked** (`db/custom.db` sessions 328→248; post-revoke overlap with the exposed set: 0; pre-revoke DB backup: `backup/db-custom-pre-session-revoke-20261112.db`). Remaining recommendation for the owner: consider forcing a password reset for users whose scrypt hashes were public (41 email-overlaps in e2e verify.db, 54 in giftz verify.db), since offline cracking of weak passwords is possible even with scrypt.

**§1.1 History-cleanup scope (measured, local history audit 2026-11-12):**

| Path pattern | Objects | Size | Content risk |
| --- | --- | --- | --- |
| `db/custom.db`, `db/custom.db.backup-*` | across 62 commits | 114.4 MB with verify DBs | User rows (email + passwordHash), Session tokens |
| `scripts/e2e-verify-out/verify.db`, `scripts/giftz-verify-out/verify.db` | 2 | (included above) | Same schema, fixture users |
| `.env` | historical | tiny | Benign (local sqlite path) but must never be in history |
| `storage/` | 212 blobs | 32.6 MB | Generated media |
| `upload/` | 4 blobs | 12.2 MB | Private uploaded media |
| `sandbox-runs/`, `tool-results/` | 71+8 blobs | ~0 MB | Generated execution artifacts |
| `dev.log.pre-recovery-1103` | 1 | 713 KB | Scanned: no credentials (Prisma SQL column names only) |
| Junk PDF committed under a sentence as filename | 1 | 639 B | Accidental test artifact |

Total ≈ 159 MB of the 169 MB `.git`. After purge: repo shrinks to ~10 MB of real content; no PII/credentials/session data reachable from any pushed commit.

**Remote (public) residual exposure — separate owner decision, not fixable by this push:** the two `verify.db` files and `dev.log.pre-recovery-1103` exist in the PUBLIC repo's current tree and history. Our merge push removes them from `main`'s tip going forward; true removal from remote history requires a remote history rewrite (force-push — explicit owner approval required) or GitHub support/GC. Old commits remain reachable by SHA until then. Recommend rotation assessment for the fixture credentials.

**Reference commits verified present locally (Phase 2 of sync brief):**
`1e3f7cc` (LAXII T2I freshness hotfix), `c1a77e5`, `9b1eeb9` (LAXII recovery evidence), `e96d757` (platform-wide recovery verification), `a5d8b16` (JAZMII auth correction + phases 1-6), `b902fa3` (custom dimensions + poster hotfix). After the local history rewrite their SHAs change (mapping will be reported); messages and diffs are preserved. Do not recreate them manually.

## 2. Stack & Runtime

- Bun + Next.js (dev server on port 3000, `dev` logs to `dev.log`)
- Prisma ORM, SQLite datasource (`db/custom.db`, env `DATABASE_URL`)
- LAXII image workers: Python (`LAXII_WORKER_PYTHON`) + local diffusers models dir (`LAXII_WORKER_MODELS_DIR`), hosted provider adapter fallback (`LAXII_PROVIDER`)
- CODE GIETZ sandbox: `unshare -Urn` network namespace + `prlimit` rlimits + process separation (`src/lib/sandbox/runner.ts`)
- JAZMII completion gate: `ffprobe` stream validation (codec/duration/frames)
- Poster recovery OCR validation: `tesseract`
- Z.ai SDK functions used by diagnostics: `web_search`, `page_reader`

## 3. Completed Functionality (all verified live, see commit messages for evidence)

### RIISHE — conversational intelligence
- Real chat + live web research (independent retrieval lane), source verification with opening citations, `retrievedAt` from `pack.fetchedAt`
- SSE streaming recovery (verified: 19 deltas, `done:true`, response persisted)
- Response modes with semantic freshness router wired (was dead code, fixed in `a5d8b16`)
- Page-reader failures recorded as health evidence

### LAXII — image intelligence
- Text-to-image (custom dimensions: width/height 256..4096, exact decoded pixels verified per artifact)
- Conversational editing (PNG output, materially-different artifact verified)
- Background removal (two-stage chroma pipeline, per-edge band selection; measured transparency accepted)
- Deterministic enhancement (measured-available probe; no false negative)
- Poster generation: provider `StackOverflowError` root-caused (HTTP 200 + error body), adapter calls documented wire contract directly, typed `ImageProviderResponseError`, ONE bounded transient retry, hybrid-typography recovery with real OCR validation
- Persisted failure freshness: 15-min `ATTEMPT_FRESHNESS_MS` window + last-write-wins + superseded-by-newer-attempt (`recentPersistedUpstreamFailure`), fixes stale-429 pinning (`1e3f7cc`)
- Capability isolation (per-capability breakers/mode markers), bounded retries, throttle parking, Retry-After honored, restart-proof persisted evidence

### JAZMII — video intelligence
- Text-to-video + image-to-video, asynchronous job processing with polling bounds
- Auth-surface probe fix: `X-Token` header required and sent (bearer-only probe masked the real 401; fixed in `a5d8b16`, verified live in `e96d757`)
- ffprobe-gated completion: real T2V (h264 1890x1080, 5.19s, 161 frames) + I2V (h264 1080x1080, 5.13s, 159 frames) verified 2026-11-12

### CODE GIETZ — coding intelligence
- Coding chat, repository understanding, project persistence
- Sandboxed execution with measured isolation profile (`networkNamespace`, `rlimits`, `processSeparation`), real failure verbatim reporting
- Scheduled sandbox sweep, retention via `BEAN_SANDBOX_RETENTION_HOURS`

### Shared infrastructure
- Capability registry mapping capabilities to real implementations; 9-state health semantics (Checking/Operational/Degraded/Unavailable/Rate-limited/Auth-failed/Not-configured/Maintenance/Unknown)
- Health probes: 15s client fetch bound (no stuck "Checking"), `probeCapability` failure note carries measured diagnostic, per-product queue depth from real DB counts
- Worker liveness ≠ capability health (readiness/liveness distinction)
- Provider budgets: `SystemSetting` `provider_budget_*` overrides with 30s cache, env fallback
- Provider credentials surfaced via `ProviderCredential` table (encrypted, masked hints) — 0 rows currently; keys come from env
- Staggered health probes (shared-account 2-QPS limit finding F1)

## 4. Pending Functionality

1. **GitHub synchronization itself** — blocked on (a) repository-name confirmation (`bean-ai-Inteligence` vs existing `Bean-intelligence`) and (b) working GitHub authorization reaching this sandbox (see §6 Known Issues #1).
2. Poster generation at provider: upstream `java.lang.StackOverflowError` for the measured prompt remains a provider-side fault; client-side recovery (bounded retry + hybrid-typography composite) is shipped. Retry the raw probe (`scripts/hotfix-poster-probe.ts`) if the provider is fixed.
3. `scripts/` TypeScript baseline: ~142 pre-existing tsc errors in one-off diagnostic/fulltest scripts (src/ and tests/ are clean). Cleanup is optional, not blocking.

## 5. Architecture Decisions (immutable context)

1. **Persisted evidence freshness over truth-by-age:** a persisted upstream failure only gates a capability for `ATTEMPT_FRESHNESS_MS` (15 min) and is superseded by any newer attempt (success or failure) — fixes the stale-429-forever bug of `1e3f7cc`.
2. **Capability isolation:** one capability's rate-limit/auth state must never pin another capability or the product badge.
3. **Honest health evidence:** only real attempted requests produce rate-limit evidence; no fail-fast impersonation; `errorClass` persisted as measured.
4. **Bounded everything:** retries (jittered, budget-capped), throttle parking (30-min budget), poll windows (`JAZMII_VIDEO_MAX_POLL_MS`), probe timeouts (15s client bound).
5. **Sandbox isolation is non-negotiable:** network namespace + rlimits + process separation; `BEAN_SANDBOX_DISABLE_ISOLATION` exists only for measured diagnostics.
6. **No key material in public payloads:** provider credentials masked (`maskedHint`), auth-gated provider endpoints.
7. **Fast-forward-only sync:** preserve both remote and local history; no force-push, no destructive resets.

## 6. Known Issues (as of 2026-11-12)

1. **RESOLVED 2026-11-12 — persistent repo-local credential store established (see §0 Authorization); this item is a dated 2026-11-12 snapshot.** Historical text: GitHub authorization not yet available in sandbox — no `gh` CLI, no GitHub OAuth function in the Z.ai SDK (`Unknown function: github_oauth`), no SSH keys, no git credential store, no `GITHUB_TOKEN`/`GH_TOKEN` env. Push cannot start until the user completes authorization through Z.ai so that a credential becomes available to `git` here, and confirms the exact target repository.
2. **Tracked sensitive runtime data (STOP-GATE per sync brief Phase 4):** git currently tracks `db/custom.db` (153 `User` rows incl. `passwordHash`, 328 `Session` tokens), `db/custom.db.backup-20261104-135209.db` (65 users), `db/custom.db.backup-20261107-engine.db` (106 users), `scripts/e2e-verify-out/verify.db` (43 users), `scripts/giftz-verify-out/verify.db` (98 users). `.env` is tracked but benign (`DATABASE_URL` = local SQLite path only, no credentials). **These must be untracked (`git rm --cached`) and must never be pushed; historical blobs in local history are an open decision for the user (purge-before-first-push vs private-repo acceptance).**
3. **Existing exposure on the public `Bean-intelligence` repo:** `scripts/e2e-verify-out/verify.db` and `scripts/giftz-verify-out/verify.db` are already tracked/pushed there (test-fixture users with password hashes + session tokens). Recommend remote purge + rotation assessment regardless of the sync outcome.
4. Health fan-out can transiently trip the provider's authoritative 2-QPS limit (finding F1, 2026-11-10) — staggered probes shipped; keep probe concurrency low.
5. Provider rate limits are account-level and time-windowed (real 2h+ 429 window observed 2026-11-11 05:14→07:17Z); LAXII bounded chain behaved correctly throughout.

## 7. Test Results

**Executed 2026-11-14 (Agent Reach integration tree, branch `feat/agent-reach-integration`):**

| Suite | Command | Result |
| --- | --- | --- |
| Baseline (pre-integration, `main` @ `6c280e4`) | `bun test --isolate tests/` | **1579 pass / 0 fail** (110 files) |
| Final (integration) | `bun test --isolate tests/` | **1657 pass / 0 fail** (119 files, +78 new reach/browser tests, zero regressions) |
| TypeScript | `tsc --noEmit` | **0 errors in `src/` and `tests/`** (135 pre-existing in `scripts/` one-offs) |
| Lint | `eslint .` | 0 errors / 2 pre-existing warnings (unused eslint-disable in vendored giftz-kit) |

**Executed 2026-11-12 (previous tree):** full 1367/0 (92 files); tsc 0 in src/tests (142 pre-existing in scripts/); lint clean.

Historical baselines for reference only (older trees): full 1389/0, operational acceptance 26/26, JAZMII 8/8, LAXII 33/33.

## 8. Deployment Instructions

```bash
bun install
bun run db:generate            # prisma generate
bun run db:push                # create/update SQLite schema (DATABASE_URL must point to db/custom.db)
bun run dev                    # development on :3000 (logs to dev.log)
# production:
bun run build                  # next build + static/standalone copy
bun run start                  # standalone server on :3000
```

- Prerequisites: Bun, Python (LAXII workers), `ffprobe` (JAZMII validation), `tesseract` (poster OCR validation); Linux user namespaces enabled for the CODE GIETZ sandbox (`unshare -Urn`).
- Dev server recovery: prefer inline `sleep + timeout` or a supervised process; detached `nohup` processes are recycled in this environment.

## 9. Required Environment Variables (names only — values must never be committed)

**Core (required):**
- `DATABASE_URL` — Prisma/SQLite datasource (e.g. local `file:` path)

**Provider routing (required for hosted provider capabilities):**
- `BEAN_PROVIDER_OPENAI_API_KEY`, `BEAN_PROVIDER_OPENAI_BASE_URL`, `BEAN_PROVIDER_OPENAI_MODEL`
- `BEAN_LLAMACPP_API_KEY`, `BEAN_LLAMACPP_BASE_URL`, `BEAN_LLAMACPP_MODEL` (local inference option)
- `LAXII_PROVIDER` — LAXII adapter selection

**Workers / runtime (optional, defaults exist):**
- `LAXII_WORKER_PYTHON`, `LAXII_WORKER_MODELS_DIR`
- `BEAN_SANDBOX_RUNTIME`, `BEAN_SANDBOX_PYTHON`, `BEAN_SANDBOX_DISABLE_ISOLATION`, `BEAN_SANDBOX_RETENTION_HOURS`, `BEAN_SANDBOX_RLIMIT_AS`, `BEAN_SANDBOX_RLIMIT_CPU`, `BEAN_SANDBOX_RLIMIT_FSIZE`, `BEAN_SANDBOX_RLIMIT_NOFILE`, `BEAN_SANDBOX_RLIMIT_NPROC`

**Tuning knobs (optional, all timeout/budget/limit overrides):**
- `BEAN_IMAGE_PROBE_TIMEOUT_MS`, `BEAN_INTEL_CROSSLINGUAL_TIMEOUT_MS`, `BEAN_INTEL_GROUNDING_TIMEOUT_MS`, `BEAN_INTEL_TECHDOCS_TIMEOUT_MS`, `BEAN_VERIFY_MAX_ATTEMPTS`, `BEAN_VERIFY_MAX_INPUT_CHARS`, `BEAN_VERIFY_MIN_CONFIDENCE`, `BEAN_VERIFY_MODEL`, `BEAN_VERIFY_REGENERATIONS`, `BEAN_VERIFY_TIMEOUT_MS`, `JAZMII_VIDEO_DOWNLOAD_RETRY_MS`, `JAZMII_VIDEO_MAX_POLL_MS`, `JAZMII_VIDEO_POLL_INTERVAL_MS`, `RIISHE_MAX_OUTPUT_TOKENS`, `BEAN_LOG_LEVEL`, `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS`

**Shared research gateway (optional; Agent Reach + Obscura, all names only):**
- `BEAN_RESEARCH_AGENT_REACH_BIN`, `BEAN_RESEARCH_REACH_DISABLED`, `BEAN_RESEARCH_REACH_DISABLED_CHANNELS`, `BEAN_RESEARCH_REACH_TIMEOUT_MS`, `BEAN_RESEARCH_REACH_LANE_BUDGET_MS`, `BEAN_RESEARCH_REACH_MAX_ITEMS`, `BEAN_RESEARCH_REACH_MAX_TEXT_CHARS`, `BEAN_RESEARCH_REACH_MAX_STDOUT_BYTES`, `BEAN_RESEARCH_REACH_RATE_PER_MIN`, `BEAN_RESEARCH_REACH_CONCURRENCY`
- `BEAN_RESEARCH_OBSCURA_BIN`, `BEAN_RESEARCH_OBSCURA_TIMEOUT_MS`, `BEAN_RESEARCH_URL_GUARD_DNS`
- Agent Reach install (operator, on the host): `uv tool install https://github.com/Panniantong/Agent-Reach/releases/latest/download/agent-reach.zip && agent-reach setup` — BEAN never runs login/configure commands; login-gated channels stay `requires_login` until the owner logs in interactively. Obscura (optional): pin a release asset for the target platform (v0.2.7 for Linux/macOS; v0.2.5 is the most recent release shipping Windows x86-64 zips) or the verified distroless container with `OBSCURA_CDP_TOKEN`, loopback-only publishing.

## 10. Security Rules (standing)

1. Never commit: `.env*` (except `.env.example`), `db/*.db`, DB backups, `sandbox-runs/`, `storage/`, `upload/`, logs, SSH keys, model weights.
2. Never print or transmit secret values; diagnostics use masked hints and length-only reporting.
3. Never bypass provider rate limits or authentication; never fake capability states; no mock/Ollama substitution.
4. Preserve verified history; no force-push to shared branches; push only after explicit user approval.

## 11. M46 ADDENDUM (2026-11-28 — production readiness & verified live operations; additive)

Branch `feat/m46-production-readiness-live-operations` (commit trail `3eec7f3`→`593ddd7`→`00bab43`→`e60cda3`→`54239f0`→`e6bdd48`→docs; every SHA pushed + `git ls-remote`-verified). Baseline: origin/main `50e1c76` (PR #37 merge) — see `docs/M46_BASELINE.md`. Full report: `docs/M46_IMPLEMENTATION_REPORT.md`; acceptance matrix (32 scenarios, reconciled totals): `docs/intelligence/M46-ACCEPTANCE.md`.

**New env names (all optional; behavior unchanged when unset):**
- `BEAN_TEST_REPOSITORY` — the dedicated integration-test repository for the live GitHub write lane (explicit config only; never defaulted; owner production repo never assumed disposable).
- `BEAN_STAGING_ROOT`, `BEAN_STAGING_BASE_URL` (explicit port; NOT 3000), `BEAN_STAGING_DEPLOY_TOKEN` — the real local staging lane. External staging still honest-unavailable without `BEAN_DEPLOY_PROVIDER`/`BEAN_DEPLOY_TOKEN`.
- `BEAN_TRUSTED_ORIGINS` — the strict CSRF origin allowlist (no wildcards); add non-3000 walkthrough origins explicitly.

**New operational seams:** `src/lib/riishe/tool-invocation.ts` (tool-protocol honesty + declined-invocation observability — `riishe.tool_invocation.declined`); `credential-diagnostics.ts` (least-privilege GitHub credential report, leak-proof); repository-adapter `reconciliation-required` outcome (uncertain remote writes are NEVER blind-retried — VERIFYING decides; audit `m46.write_reconciliation`); deployment-adapter local staging lane + retained-build rollback; `scripts/m46-migration-preflight.py` + the reviewed additive migration `prisma/migrations/20261128_m46_execution_decision_additive/migration.sql` (purely additive; production apply is an OWNER operation).

**Standing limitations (owner configuration pending):** live GitHub writes need `GITHUB_TOKEN` + `BEAN_TEST_REPOSITORY`; external staging needs a provider; the hosted chat lane declined governed tool calls in all sampled windows (now measured per turn — never faked); dependency audit tooling unavailable in-sandbox (zero dependency changes made).

**Test suite:** 243 files, 0 failures (batched runs — the 4 GB sandbox crashes natively under full-parallel `--isolate` on ONNX-bearing files; reproduced independent of code changes). 67 new M46 cases. tsc delta 0; eslint clean; build exit 0.

## 12. M47 ADDENDUM (2026-11-28 — native tool calling & live operations activation; additive)

Branch `feat/m47-native-tool-operations-activation` (commit trail `8b5e486`→`cf1fa7b`→`a57de84`→`95620d9`→`9b35963`→`dc02839`→`7b91cc6`→`abb103d`→docs; every SHA pushed + `git ls-remote`-verified; the OWNER merged PR #40 mid-session (main `0e3dcbf`→`82fd028`) — BEAN performed no merge). Baseline: origin/main `0e3dcbf` (PR #39 merge) — see `docs/M47_BASELINE.md` (+ §10 owner-merge addendum). Full report: `docs/M47_IMPLEMENTATION_REPORT.md`; acceptance matrix (45 unique scenarios, reconciled totals 6 LIVE + 4 LOCAL-LIVE + 27 LOCAL-INT + 1 MANUAL + 7 HONEST-UNAVAILABLE): `docs/intelligence/M47-ACCEPTANCE.md`.

**Decisive evidence:** the hosted chat lane MEASURABLY supports provider-native tool calling in non-streaming requests (genuine `tool_calls` emitted, ids preserved, role:tool round-trips accepted); streaming+tools measured NOT USABLE → native tool turns are buffered-only; the complete conversational loop (adapter seam → governed validation → real execution → verified round-trip) measured LIVE (`scripts/m47-live-native-e2e.ts`). The M46 text protocol remains for every unmeasured lane.

**New seams:** `tool-invocation.ts` capability registry (native/text-protocol/unsupported/unknown/temporarily-unavailable + per-lane descriptors + `toolCallingDiagnostics()`); adapter contract `NativeToolSpec`/`NativeToolCall`/`nativeToolsToWire` (+ ChatTurn role:'tool'); protocol-aware `toolloop` (pre-execution refusal classes, role:tool results, decisionOps observability); orchestrator `loopProtocol` + full per-turn invocation records (plain-fallback turns recorded too); NATIVE_TOOL_PROTOCOL prompt variant.

**Standing limitations (owner configuration pending, unchanged):** live GitHub writes need `GITHUB_TOKEN` + `BEAN_TEST_REPOSITORY`; configured staging needs `BEAN_STAGING_ROOT`/`BEAN_STAGING_BASE_URL`/`BEAN_STAGING_DEPLOY_TOKEN`; external staging needs `BEAN_DEPLOY_PROVIDER`/`BEAN_DEPLOY_TOKEN`; other model lanes stay text-protocol until configured AND measured; streaming native calls unsupported on the hosted lane (measured).

**Environment notes:** Turbopack rejects symlinked node_modules (real install required for build); pinned MiniLM vocab reinstall + SHA-256 `07eced37…` verified; per-file test runs are the hermetic regression strategy (batched multi-file interference proven pre-existing on the pristine tree).

**Test suite:** per-file hermetic census 244 files, 3,322 pass / 0 fail / 10 skip. 50 new M47 cases. tsc delta 0 (234=234, exact location parity); eslint clean; build exit 0.
