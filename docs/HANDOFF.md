# BEAN Intelligence — Project Handoff (Session Continuity Document)

> Maintained for future Z.ai development sessions. Last updated: 2026-11-12 (UTC+8).
> This document contains environment variable NAMES only — never secret values.

## 0. Permanent GitHub Sync & Update Policy (standing, every session)

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
