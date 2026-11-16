# M26 RESULTS — BEAN Intelligence Production Readiness & Reliability Audit

Milestone: M26 · Branch: `m26-release` · Published on `main`
Published tip at writing: `38700d260bcaddd4fb0f5036d28b4f51038233a2` (fast-forward
push, remote-verified — §14). Every claim below is backed by the code audit
(`M26_AUDIT.md`), the regression suites (`docs/M26_RELIABILITY_TEST_PLAN.md`),
the live battery (`scripts/m26/live-verification.sh`), or the measured run
(`scripts/m26/measurements.ts`).

Verdict (§15): **B — Conditionally production-ready: specific blockers remain.**

## 1. Repository baseline and commit SHA

| Item | Value |
|---|---|
| Baseline at session start (local HEAD) | `f0b47ad9da6e519533548180d98c4a7ee948fe66` — an environment auto-commit 1 AHEAD of remote, sweeping 123 files / +28,574 lines of other-stream WIP |
| Remote `origin/main` after fetch | `b0b03daf3bf4d00efd54a3bf3d55d71c4f0ca168` — the M25 results commit, confirmed via `git ls-remote` |
| Working tree | clean (the WIP had been swept into the auto-commit) |
| M25 train verified | `3f40e75` → `ea73545` → `b0b03da`, all in remote history |
| Preservation refs created | `backup/m26-baseline-auto-commit` (= `f0b47ad`, LOCAL only), `backup/m26-f0b47ad-line` (the interim chain that contained the auto-commit — LOCAL only, never pushed) |
| Environment behavior (disclosed) | the sandbox re-checks-out `main` between tool calls; an early M26 commit chain landed on the auto-commit's line before the rebuild — detected by the pre-push tree verification and rebuilt cleanly (§14) |
| Full-suite baseline before changes | **2,122 pass / 0 fail / 151 files** — byte-identical to the M25 published baseline |

## 2. Architecture and deployment findings

- Single Next.js 16 process + SQLite (`db/custom.db`, 28 Prisma models,
  `connection_limit=1` now with `busy_timeout`) + embedded engine pools
  (`GenerationJob`/`JobEvent`, CAS claims, leases/heartbeats). Media under
  `storage/` (backup together with the DB).
- Providers: hosted z-ai SDK adapter, admin-configured external
  OpenAI-compatible lane, local llama.cpp lanes; per-class breakers; per-user
  concurrency slots; SHA-256 `bgk_` API keys; AES-256-GCM credential vault.
- **All reliability state is per-process** (breakers, limiter windows, slots,
  lane state) — the tested deployment is single-instance; multi-instance
  scaling requires externalized state (documented blocker).
- `prisma/migrations/` does not exist — schema changes ride
  `db:push --accept-data-loss`; `schema.postgres.prisma` is two generations
  stale (17/28 tables) — the PG cutover path would break the current app
  (documented blocker).
- Products present in-repo: BEAN Intelligence (gateway/keys/usage/model
  registry), CODE GIFTZ, RIISHE, LAXII, JAZMII, GANGZII (orphaned — async
  surfaces fail honestly at preflight), Client Compute Engine. **BEAN FX is
  absent** (verified — nothing to regress, documented).

## 3. Critical and high-risk issues

| # | Sev | Issue | Resolution this milestone |
|---|---|---|---|
| S-1 | CRITICAL | Workspace terminal RCE + zero tenancy (unreleased WIP swept by the auto-commit: `bash -lc` with the full server env for any member user) | **Quarantined** — the feature is excluded from the release branch (rebuild without the auto-commit); documented P0 requirements before it can ever ship (`M26_AUDIT.md` §4.5) |
| S-2 | CRITICAL | 30 historical session tokens in 30 committed cURL cookie jars, PUBLISHED in remote history (verified: 0 currently valid against the local DB — `Session` table empty) | **Mitigated**: all 30 jars removed from HEAD (24 found by the audit + 6 variant-named jars found in the pre-push sweep); `.gitignore` hardened; full remediation = history rewrite, owner action (§15) |
| S-3 | CRITICAL | The auto-commit swept `scripts/.github_device_code` + a DB backup + an env snapshot into a LOCAL commit | **Contained**: never pushed (verified in the release tree); `.gitignore` hardened so future sweeps skip these paths |
| S-4 | HIGH | Sandbox same-uid residual: approved sandbox code can read `.env` and the DB file and exfiltrate via stdout (network namespace blocks network exfil only) | **Documented blocker** — real fix is uid/mount-namespace isolation (out of audit-fix scope); runbook states the constraint |
| S-5 | HIGH | Sibling-tenant CSRF: `same-site` fetches from a hostile `*.space-z.ai` page fell through the suffix-scoped origin allowlist | **FIXED** — same-site requests are authorized only by the EXACT allowlist; live-verified (403s) + 6 tests |
| F-1 | HIGH | A cancelled RUNNING LAXII image job still completed and overwrote the row | **FIXED** — cancel checkpoints + guarded CAS completion; raced cancels settle `cancelled` with honest spend metering; 3 tests |
| F-G1 | HIGH | GANGZII async jobs could be enqueued into a queue no pool claims (queued forever) | **FIXED (defense-in-depth)** — unwired task types settle `NO_BACKEND` at enqueue; live check confirms zero stuck rows; the product's async surfaces themselves remain orphaned-by-design (honest typed failure) |
| F-11/F-12 | HIGH | Stale PG migration artifact; `db:push --accept-data-loss` with no migration history | **Documented blockers** (§15) |
| S-4b | HIGH | Full-project `tsc` OOM-killed under the dev server (3.9 GB host) | Gates run in the documented build window (server stopped) |

## 4. Model-lane lifecycle results (`ensureLaneServer` — audited personally)

Verified BEFORE fixes (all code-read): documented contract largely implemented
(adopt-or-spawn, MemAvailable gate, 3/h/lane bound, 20s deadline, refusal never
blocks, probes never spawn). Gaps found and FIXED:

- **LANE-1 duplicate-spawn mutex**: concurrent ensures for one lane share a
  single in-flight attempt (7 orchestration tests with injected probes/spawns —
  no real processes needed).
- **LANE-2 cross-lane RAM admission**: MemAvailable minus every pending lane
  reservation feeds the documented gate; reservations held for the whole spawn
  window and released on success AND failure; both lanes admitted when RAM
  truly fits (measured 1900+800 vs 4096 test).
- **LANE-3 failed-spawn cleanup**: the just-spawned, never-answered child is
  terminated (SIGTERM→SIGKILL) on deadline expiry — only BEAN's own child;
  operator/adopted servers are never signaled; PID recorded in lane logs.
- **LANE-4 fd leak**: the parent's log fd is closed after spawn.
- Honest limits: the spawn/adopt path is NOT_TESTED against real weights on
  this host (no GGUF/binary — the M25-documented limitation, unchanged); the
  crash-loop bound is per-process and resets on restart.

## 5. Provider reliability results

- **G-1 external-lane breaker isolation**: the `/api/v1` external lane got its
  own `chat-external` breaker class (429s noted, fail-fast on its own cooldown,
  success resets the streak, zero-I/O skips). A hosted 429 no longer fail-fasts
  external calls and an external 429 no longer reports the hosted window as the
  client's `Retry-After` hint. Tests: external 429 opens ONLY `chat-external`;
  hosted-429-then-external-call proceeds with real network I/O.
- **G-2 cancellation propagation**: external non-streaming calls now compose the
  caller's signal (`AbortSignal.any`) and refuse already-dead callers before the
  wire — previously a cancelled caller's fetch ran to completion and was billed.
- **G-3 stream-open deadlines**: first-delta deadline (30s default, env-tunable)
  for BOTH lanes + bounded external stream-open — a hung open previously held
  the SSE turn indefinitely under heartbeats. Tests reject within ~120ms (tuned).
- **G-9 env-flag alignment**: one canonical parse of
  `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS` (`1`/`true`) across url-guard, llama
  lanes, and the credential registry — the documented `true` spelling no longer
  leaves lanes silently dormant.
- Verified-solid (unchanged, re-confirmed): one attempt per candidate; 429 never
  retried; per-class isolation; typed 7-class failure taxonomy; recovery =
  verified real success; credentials env-names-only, keys only in the
  Authorization header; Bearer redaction in every error path.
- Known accepted trade-offs (documented, not fixed): timeout-triggered fallback
  can double-spend one turn (the hosted SDK request is non-cancellable — bounded
  by maxAttempts=1); quota gates are count-then-act with post-turn recording
  (G-5/G-6 blockers, §15).

## 6. Multi-file refactoring results (CODE GIFTZ)

Verified-solid (re-confirmed by reading): single-transaction all-or-nothing
execution with in-transaction re-validation; plan-hash integrity + replay +
status lifecycle; DFS cycle detection that cannot hang; deterministic ordering
(prompt-injection resistance pinned by structural tests; approval always
required).

FIXED this milestone:

- **R-1 bounded graph build**: `node_modules/.next/dist/build/coverage/.git`
  excluded; >2,000 analyzable files refuse honestly (typed `RefactorScopeError`
  mapped to a customer-safe reply in the chat route and a typed rejection in
  the flow) — previously 4 full-set regex parses per turn with no cap and no
  refusal.
- **R-2 move-module ambiguity**: a token matching MULTIPLE basenames now
  CLARIFIES with the candidate list — previously one plan silently moved every
  same-named file ("never guesses" contract violation).
- **R-3 no prose hijacking**: "restructure this function" / "consolidate these
  two functions" / "deduplicate this logic" stay normal edit turns;
  folder/project-shaped intent still detects (both directions pinned).
- **R-4 `/…`-specifier parity**: root-relative specifiers resolve as graph
  edges like `@/…` — rename-symbol importer coverage no longer misses them.
- **R-5 transactional rollback**: the user-facing undo is now ONE transaction
  (restore + append-only rollback snapshot) — a crash can no longer leave a
  half-restored workspace.
- **R-6 in-transaction snapshot**: the refactor version snapshot is created
  INSIDE the execute transaction — no mutated-but-unversioned window; at the
  200-version cap the snapshot is skipped gracefully and DISCLOSED
  (`versionSeq: null`), never silent, never bricking the project.
- Honest limits: no execution-based (compile) validation pre-apply — static
  gates only, with the sandbox build as the explicit separate gate (unchanged,
  documented in-code); no concurrency test tier (SQLite + connection_limit=1 is
  the stated race-safety premise — now ALSO true for the snapshot/rollback
  writes).

## 7. Security findings (summary — full detail in `M26_AUDIT.md` §4.5)

FIXED: S-5 sibling-tenant CSRF (§3), S-6 IPv4-mapped-IPv6 SSRF bypass
(dotted + WHATWG hex-hextet forms; metadata never allowed), S-7/S-10 worker
fetch guards (JAZMII reference re-fetch + provider video download now ride the
research gateway's `guardedFetch` — every redirect hop revalidated), S-8 auth
hardening (register rate limit 5/10min; transactional admin bootstrap — no
double-admin race; password change revokes ALL sessions), S-9 upload
memory-DoS (pre-buffer content-length + bounded raw reads on
`laxii/assets` + `code-giftz/attachments`), S-11 health detail split, S-12
diagnostics run rate limit.

QUARANTINED: the workspace feature (S-1) — the entire surface
(`src/app/api/workspace/*`, `src/lib/workspace/*`, workspace UI) is excluded
from the release; preserved verbatim on local backup refs with documented P0
requirements (per-user tenancy, sandboxed preview, no terminal-as-shell, audit
+ rate limits) before any future ship.

VERIFIED-STRONG (unchanged): scrypt+timingSafeEqual passwords; AES-256-GCM
fail-closed vault; `bgk_` keys (SHA-256, constant-time, rotation/revocation,
scopes, audit); portal 404-cloaked tenancy; generic INTERNAL_ERROR contract;
argv-array everywhere; the RIISHE upload pipeline; cross-user scoping in all
sampled queries; admin routes role-gated + audited; no prompts/contents/
credentials in any of ~70 logger call sites.

## 8. Queue and database recovery results

- **F-3**: `finishFailed` re-checks ownership INSIDE both writes (retry and
  terminal) — a stale worker can no longer park/fail a re-claimed row;
  `__recovery__` keeps its legitimate bypass (4 race tests).
- **F-4**: `recoverStaleJobs` re-verifies lease expiry inside the requeue write
  — a slow-but-alive worker is no longer wrongly requeued (duplicate provider
  execution prevented); genuine recovery still works.
- **F-2/F-8**: legacy terminal settles (video completion/fail/cancel, laxii
  fail) are CAS-guarded on non-terminal statuses — no lost-lease clobber; a
  cancel can no longer flip a `completed` row.
- **F-6**: `ensureVideoPoller` re-attach is the executor ONLY for pool-less
  deployments — engine-claimed rows are never double-executed by a read route
  spawning a second poller.
- **F-9**: the inline-kick failure path actually settles now (the previous id
  never matched the ownership guard).
- **F-10**: SQLite URL gains `busy_timeout` (bounded, overridable) and verbose
  query logging is gated behind `BEAN_LOG_DB_QUERIES=1`.
- **LIVE DEMONSTRATION**: a disposable dead-worker row (expired lease) was
  requeued by the real `recoverStaleJobs` in **8 ms** (`retry_wait`/
  `WORKER_LOST`, owner cleared) — measured, then cleaned up.
- Honest limits: duplicate-submission remains check-then-insert (no partial
  unique index on SQLite — documented); submit flows' message+job creation is
  not transactional (LOW); no dead-letter table (terminal `failed` rows with
  typed error classes is the design).

## 9. Observability improvements

- **O-1 request correlation IDs** (the audit's highest-leverage gap): the
  middleware issues/forwards/echoes `x-bean-request-id`; `handle()` enters the
  logger's AsyncLocalStorage context — every structured log line inside a
  request carries `requestId`, and unexpected-error logs carry it too. Live
  verified; 3 tests.
- **O-4 shutdown events**: SIGTERM/SIGINT log `server.shutdown` (signal, pid) —
  unclean crashes are distinguishable from restarts.
- **S-11/O-3**: `/api/health` — public liveness + per-product readiness;
  operational detail (breaker windows, probe evidence, queue depth) for
  authenticated sessions only. The detail never contained credentials/endpoints/
  paths (field-by-field audit verification stands).
- **S-12**: diagnostics runs rate-limited (3/5min/user — each run fires real
  product jobs).
- Honest limits: no aggregate latency metrics (needs a metrics store);
  diagnostics runs remain in-memory (30-min TTL); no persisted health history.

## 10. Product regression results

All green in the canonical suite (2,181 tests) + live battery:

- **BEAN Intelligence**: gateway/chat/completions/keys/usage/model-registry
  suites — including the new external-lane breaker, cancellation and
  stream-deadline contracts.
- **CODE GIFTZ**: full chat/file-ops/versioning/refactor/export suites + the
  M26 refactoring contracts (bounds, clarification, no-hijack, transactional
  undo/snapshot).
- **RIISHE**: chat, streaming, retry-bounds, continuation suites — the slot-leak
  fix preserves the concurrency contract (SSE ownership handoff).
- **LAXII**: image suites incl. throttle parking + the new cancel checkpoint
  contract.
- **JAZMII**: video suites (30/30) incl. resume/polling/cancellation with the
  guarded settles.
- **GANGZII**: honest typed failure verified live; zero stuck queue rows.
- **BEAN FX**: absent from the repository (verified) — nothing to test,
  documented.
- **Client Compute Engine**: 86-test suite green; zero client-compute files
  changed.
- auth/API keys/rate limits/queues/usage: shared limiter, breaker, and queue
  suites green; live DB untouched by gates (disposable accounts deleted).

## 11. Actual performance measurements

All measured locally (`scripts/m26/measurements.ts`); DEV server, dormant
providers — NOT production benchmarks:

| Metric | Measurement | Context |
|---|---|---|
| `/api/health` concurrency | 250 requests (5×50 parallel), **0 failures**; p50 **1.69 s**, p95 **4.18 s**, max 4.19 s | dev-mode compilation + the unreachable-gateway probe timeout dominate each wave; the probe cache (20s) and probe dedup keep repeated waves cheap — treat as an upper bound for the DEV shape, not a latency claim |
| Stale-job recovery | `recoverStaleJobs` requeued a dead worker's expired-lease row in **8 ms** (`retry_wait`/`WORKER_LOST`) | live demonstration, disposable row, deleted after |
| Lane startup | NOT_TESTED | no GGUF weights/binary on this host (M25-documented; decision matrix + refusal path unit-pinned; live refusal path verified in M25) |
| Model latency / throughput | NOT_TESTED | no provider credentials in this sandbox — honest dormancy, zero provider calls |

## 12. Tests passed and failed

| Gate | Result |
|---|---|
| `bun run test` (canonical, isolated) | **2,181 pass / 0 fail / 158 files / 39,559 expects** — final run on the release tree; baseline 2,122 + 59 new M26 tests; one mid-milestone red (test fakes not covering the new consumed logger/queue surface) was fixed by extending the fakes — never skipped/weakened |
| `tsc --noEmit` scoped `src/`+`tests/` | **0 errors** (pre-existing debt: 148 lines in `scripts/` + 2 in `validation/` — other streams, unchanged) |
| `eslint src tests` | clean |
| `bun run build` (production, server stopped) | **PASS, zero warnings** (`✓ Compiled successfully`, standalone `server.js` verified) |
| Secret scans | push-delta pattern sweep: only throwaway harness credentials (`TestPass123`-class, valid only against the local dev DB); the published tree contains **zero** device codes, DB backups or cookie jars |
| Live battery (`scripts/m26/live-verification.sh`) | **17/17 PASS** |

## 13. Files changed (release train, 9 commits)

| Commit | Contents |
|---|---|
| `7f66c47` | audit baseline (`M26_AUDIT.md`) + release-safety (.gitignore hardening, 24 jars removed) + LANE-1..4 + S-6 SSRF + S-7/S-10 worker guards + tests |
| `623176d` | S-5 CSRF, S-8 auth hardening, S-9 upload caps, F-1 cancel contract, F-G1, F-9 + tests |
| `969fcd6` | F-3/F-4 race fixes, F-2/F-6/F-8 guarded settles, F-10 SQLite hardening + tests |
| `254fde6` | G-1/G-2/G-3/G-4/G-9 gateway reliability + O-1 request ids + O-4 shutdown + S-11 health split + S-12 + tests |
| `cb4e038` | R-1..R-6 refactoring reliability + honest scope-error mapping + tests |
| `ea1982d` | test-fake surface extensions (logger context, queue findUnique/updateMany) |
| `1b94a27` | `scripts/m26/` live battery + measurements |
| `477a160`→`be2622d` (as picked) | the 6 remaining cookie jars removed + widened `.gitignore` |
| `38700d2` | `docs/M26_RELIABILITY_TEST_PLAN.md` + `docs/M26_OPERATIONS_RUNBOOK.md` |

New/modified production files: `src/lib/providers/llamacpp.ts`,
`src/lib/security/url-guard.ts`, `src/lib/intel/vision.ts`,
`src/lib/adapters/hosted-video.ts`, `src/lib/api/origin.ts`,
`src/middleware.ts`, `src/lib/observability/logger.ts`, `src/lib/api/errors.ts`,
`src/instrumentation.ts`, `src/lib/db.ts`, `src/lib/ai-engine/queue.ts`,
`src/lib/jobs/{queue,image-worker,video-worker}.ts`, `src/lib/laxii/jobs.ts`,
`src/lib/code/refactoring/{graph,detect,chat-flow,execute}.ts`,
`src/lib/code/versioning.ts`, `src/lib/ai-gateway/gateway.ts`,
`src/lib/ai-gateway/providers/openai-compatible.ts`,
`src/app/api/v1/chat/completions/route.ts`,
`src/app/api/auth/register/route.ts`, `src/app/api/account/settings/route.ts`,
`src/app/api/health/route.ts`, `src/app/api/diagnostics/route.ts`,
`src/app/api/laxii/assets/route.ts`, `src/app/api/code-giftz/attachments/route.ts`,
`src/app/api/code-giftz/chat/route.ts` — plus 59 new/extended test files'
content and 4 documents. NOT included (quarantined WIP, preserved on local
refs): the workspace feature, quota gauge, Postgres staging tooling, `workers/
wan22/`, evidence/infrastructure docs swept by the auto-commit.

## 14. Commit and remote SHA verification

| Item | Value |
|---|---|
| Dedicated branch | `m26-release` (built from `origin/main` `b0b03da`; `m26-audit` retained as a marker) |
| Rebuild disclosure | an early commit chain inherited the auto-commit (`f0b47ad`) through the environment's checkout behavior; the pre-push verification caught it (the tree diff must contain ONLY quarantined-WIP paths) and the six reviewed commits were cherry-picked onto a clean base — the sensitive files were NEVER pushed |
| Push method | fetch → FF pre-check (`git merge-base --is-ancestor origin/main HEAD`) → fast-forward pushes `b0b03da..be2622d` and `be2622d..38700d2` — no force push, no destructive operations |
| Remote verification | `git ls-remote origin refs/heads/main` == `38700d260bcaddd4fb0f5036d28b4f51038233a2` == local `m26-release` HEAD, immediately post-push |
| Working-tree state | release tree clean; quarantined WIP + sensitive artifacts preserved verbatim on `backup/m26-baseline-auto-commit` and `backup/m26-f0b47ad-line` (LOCAL only, never push these) |

## 15. Remaining production blockers (the reason for verdict B)

1. **Published-history session material (CRITICAL, owner action)**: 30
   historical session tokens remain in remote git history despite HEAD
   removal. Mitigation: keep the repo private and treat those tokens as
   exposed; full fix = history rewrite + force-push (owner-authorized) +
   token rotation. Verified: 0 tokens valid against the current local DB.
2. **Sandbox same-uid residual (HIGH)**: approved sandbox code can read `.env`
   and the DB file and exfiltrate via stdout. Mitigation: run single-tenant;
   real fix = dedicated uid/mount namespace.
3. **Quota accounting (HIGH)**: count-then-act quota gates (TOCTOU overshoot
   under concurrency) and the account budget counting TURNS while providers
   count upstream calls — the exact mismatch behind the measured 2026-11-08→09
   exhaustion storm. The quota gauge/hold module exists but is UNWIRED
   (quarantined stream — must not ship half-wired). Mitigation: the breaker
   escalation + bounded retries prevent storms; a reservation-based budget is
   the real fix.
4. **Multi-process state (HIGH for scaling, N/A single-instance)**: breakers,
   rate limits, slots and lane state are per-process. The tested deployment is
   single-instance; externalize before horizontal scaling.
5. **No migration history (MEDIUM)**: schema changes ride
   `db:push --accept-data-loss` with no review artifact; the PG migration
   path's artifacts are stale and would break the current app. Mitigation:
   manual additive-only discipline + pre-push diff review; regenerate
   `schema.postgres.prisma` before any cutover.
6. **Login limiter keyed on spoofable `x-forwarded-for`; plaintext session
   tokens (MEDIUM)**: front the app with the ingress (Caddy) that sets XFF
   from the socket address; token-hash migration is a schema change
   (documented).
7. **Observability depth (MEDIUM)**: no aggregate latency metrics, no persisted
   health history, diagnostics runs ephemeral — diagnosability is honest but
   point-in-time (operator rating: 6/10 → improved by request IDs + health
   split this milestone).
8. **GANGZII async surfaces (MEDIUM, product scope)**: orphaned by design —
   routes fail honestly; wiring handlers is a product milestone, not an audit
   fix.
9. **Lane adopt/spawn against real weights (LOW, environmental)**: unit-pinned
   + M25-live refusal path; needs an operator host with weights for a full
   live run (enablement path documented in the runbook).

**Verdict: B — Conditionally production-ready.** The system is reliable,
secure and recoverable for the TESTED deployment configuration (single
instance, ingress-fronted, single-tenant sandbox use, repo kept private) as
demonstrated by the evidence above; the listed blockers are specific, bounded,
and each carries a documented mitigation or a defined owner action. This is
not a blanket "production-ready" claim — items 1–3 in particular require
operator action or product-scope work before a hardened multi-tenant launch.
