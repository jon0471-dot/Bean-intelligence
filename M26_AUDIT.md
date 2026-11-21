# M26 AUDIT — BEAN Intelligence Production Readiness & Reliability (pre-implementation)

Milestone: M26 · Audit date: 2026-11-16 · Branch: `m26-audit` (from `origin/main`)
This document records what was audited, what was found, and the remediation decisions
taken BEFORE any implementation change. Findings cite code evidence gathered by reading
the current sources at `f0b47ad` (== published scope `b0b03da` for every tracked
reliability/security file; the auto-commit is purely additive — verified via
`git diff --name-status b0b03da f0b47ad`, all entries `A`).

---

## 1. Repository baseline

| Item | Value |
|---|---|
| Remote `origin/main` after fetch | `b0b03daf3bf4d00efd54a3bf3d55d71c4f0ca168` (= M25 results commit, verified via `git ls-remote`) |
| Local HEAD at session start | `f0b47ad9da6e519533548180d98c4a7ee948fe66` — an environment auto-commit (UUID message) sitting 1 commit AHEAD of remote, containing 123 files / +28,574 lines of other-stream WIP |
| Working tree at session start | clean (0 uncommitted changes — the WIP had been swept into the auto-commit) |
| M25 release train | `3f40e75` (M22 baseline) → `ea73545` (M25 feature) → `b0b03da` (M25 results) — all present in remote history |
| Prior WIP backups (git refs, preserved) | `backup/m22-wip-auto-commit` (`e396e42`), `backup/m25-wip-auto-commit` (`ee65874`), `backup/m25-intel-wip-auto-commit` (`5098143`), `backup/laxii-pre-restoration` (`5246b52`), `backup/pre-phase0-81caaa3` (`81caaa3`), `backup/pre-phase1-auto-commit` (`c69fe4b`) |
| New preservation ref created this session | `backup/m26-baseline-auto-commit` = `f0b47ad` (the swept WIP, kept exactly as found) |
| M26 working branch | `m26-audit`, created at `origin/main` (`b0b03da`) — the published, reviewed scope |

### 1.1 Auto-commit (`f0b47ad`) inventory — WIP disposition

The auto-commit swept the previously-untracked streams that M25 §2 explicitly listed as
"NOT recovered into the release": the workspace feature (`src/app/api/workspace/*` ×10
routes, `src/lib/workspace/*` ×6 modules, `src/components/bean/workspace/*`), the quota
gauge (`src/lib/upstream/quota.ts`), `src/lib/jobs/jazmii-view.ts`, Postgres staging
tooling (`scripts/staging-*`, `prisma/schema.postgres.prisma`), infrastructure/recovery
docs (`docs/infrastructure/*`, `docs/reports/*`, `docs/evidence/*`), `workers/wan22/`
config, and misc operational artifacts.

**CRITICAL incident inside the auto-commit (release-safety):** the sweep also committed
`scripts/.github_device_code` — the exact file M25_RESULTS.md §2 documented as
"sensitive — never committed" — plus `db/backups/m22-20261116T011634Z/custom.db` (438 KB
SQLite snapshot) and `db/backups/m22-20261116T011634Z/env.snapshot.txt` (contains only
`DATABASE_URL=`). Cause: `.gitignore` does not list these paths and the auto-commit adds
untracked files wholesale. **None of this has reached the remote** (remote main is still
`b0b03da`). Disposition: preserved verbatim on `backup/m26-baseline-auto-commit` (LOCAL
only, never to be pushed); the M26 release branch excludes them; `.gitignore` hardened
this milestone so future sweeps cannot repeat the incident.

### 1.2 Separately verified published-history exposure (CRITICAL, pre-existing)

`git ls-tree -r b0b03da` contains **24 committed cURL cookie jars**
(`scripts/e2e-*-out/cookies.txt`, `scripts/e2e-*-cookies.txt`, …) holding **30 distinct
`bean_session` tokens**. They entered remote history in `2af6299` (ancestor of
`origin/main`) — i.e. they are published to GitHub **today**. Cross-check against the
current local DB: `Session` table has **0 rows** (post-M22-reset dev DB), so **0 of the
30 tokens are currently valid here**. They are historical local-dev session tokens;
full remediation requires a history rewrite (filter-repo + force-push) that is outside
M26's release-safety rules. Disposition: documented as a production blocker with an
operator runbook step (§ remediation plan); the M26 release commit deletes the jars
from HEAD so future snapshots stop carrying them; token rotation is only meaningful
against whatever DB those tokens were issued for (none valid in this sandbox).

---

## 2. Architecture inventory (what actually exists at this commit)

**Runtime:** Next.js 16 (dev server observed on :3000, `next-server v16.1.3`),
single SQLite DB (`db/custom.db`, Prisma, 28 models, `connection_limit=1`),
embedded AI engine pools started by `src/instrumentation.ts`
(`BEAN_ENGINE_EMBEDDED=true` default; `scripts/ai-workers/worker.ts` for standalone).

**Queues/workers:** `GenerationJob` + `JobEvent` tables (9 states, lease/heartbeat/CAS
claim protocol); pools for `riishe | laxii | jazmii | code-giftz`; legacy processors
`src/lib/jobs/image-worker.ts` (LAXII, Python diffusions worker) and
`video-worker.ts` (JAZMII provider polling); media artifacts under
`storage/{laxii,jazmii}/<userId>/`. **No GANGZII pool and no handlers** (see F-G1).

**Providers/gateway:** hosted z-ai SDK adapter (`hosted-llm.ts`), external
openai-compatible adapter (`/api/v1` lane), local llama.cpp lanes adapter; fallback
chains `['bean-llm-openai-compatible','bean-chat-local-llamacpp']` for RIISHE chat and
GIFTZ code; per-class breakers (`chat`, `chat-fallback`, `chat-llamacpp`,
`functions/images/video/audio`); router with per-user concurrency slots; metering
(`UsageRecord`), audit log, API keys (`bgk_*`, SHA-256), provider-credential vault
(AES-256-GCM).

**Local model lanes:** `src/lib/providers/llamacpp.ts` lane manager (adopt-or-spawn,
RAM-gated via MemAvailable, 3 spawns/h/lane, 20 s deadline) + `src/lib/ai-engine/gpu.ts`
hardware probe. `.env` in this sandbox: **only `DATABASE_URL`** — hosted gateway, local
lanes, LAXII/JAZMII providers are all honestly dormant here.

**Sandbox:** `src/lib/sandbox/runner.ts` — `unshare -Urn` + `prlimit`, argv-array,
minimal env; documented residual: same-uid, no filesystem confinement.

**Integrations actually present in-repo:** BEAN Intelligence (gateway + products),
CODE GIFTZ, RIISHE, LAXII, JAZMII, GANGZII (adapter presets only, async surfaces
broken — F-G1), Client Compute Engine, diagnostics suites, reach/research lanes
(disabled-by-default binaries). **BEAN FX: absent** (verified absent since the Phase-0
audit; nothing to regress). External repos (`laxii-diffusers` python worker, `wan22`
preflight) are documented dependencies, present as configs only.

**Deployment config:** no `prisma/migrations/` dir — schema applied via
`db:push --accept-data-loss`; `next start` = standalone server.js; Caddyfile fronts
:3000; no multi-process hardening of in-memory state (breakers/rate limits/slots are
per-process).

---

## 3. Measured baseline gates (before any change)

| Gate | Result |
|---|---|
| `bun run test` (`bun test --isolate tests/`) | **2122 pass / 0 fail / 151 files / 39,376 expects** — identical to the M25 published baseline |
| `eslint src tests` | clean |
| `tsc --noEmit` scoped `src/`+`tests/` | 0 errors (full-project run OOM-killed under the dev server's 1.4 GB RSS on this 3.9 GB host — re-run in the build window with the server stopped, per the documented M22/M25 constraint; historical debt ≈159 lines confined to `scripts/`/`validation/`/`backup/`) |
| Production build | not yet run this session (release gate) |
| Dev server | healthy on :3000 |

---

## 4. Findings

Severity model: CRITICAL = exploitable or data-destroying now; HIGH = verified defect
with concrete reliability/security impact; MEDIUM = verified defect, bounded impact;
LOW/INFO = hygiene. Every finding names the deciding file:line. Disposition codes:
**[FIX-M26]** fixed in this milestone with regression tests · **[DOC-BLOCKER]** honest
blocker with documented mitigation, fix out of milestone scope · **[QUARANTINE]** WIP
kept out of the release · **[ACCEPTED]** measured/documented trade-off, no change.

### 4.1 Model-lane lifecycle (`ensureLaneServer` — audited personally, full file read)

The documented contract (docs/ai/LOCAL-MODEL-LANES.md) is largely implemented:
pure decision `planLaneStart()` with adopt/skip(non-loopback)/rate-limit(3/h/lane)/
weights-present/RAM(MemAvailable)/spawn ordering (llamacpp.ts:254-283); argv-array
detached spawn with measured flags (:355-372); 20 s deadline with 500 ms polling
(:375-385); refusal never blocks the request (:324-327); probes never spawn
(health(), :495-552); honest measured RAM via `memAvailableMbFromMeminfo` (gpu.ts:61-79).

| # | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| LANE-1 | HIGH | **No duplicate-spawn mutex.** Two concurrent requests hitting a down lane both probe (cache only stores the failed result, :305), both pass the gates, both call `spawnLaneServer` — double spawn on the same port (second child dies on port-bind, but consumes 2 of the 3 hourly spawn budget, briefly doubles RAM pressure, and leaves a raced `spawns[]` array). The checklist item "Handle multiple simultaneous requests for the same lane" is not met; `health-cache.ts:90-103` shows the correct in-flight-dedup pattern already in-repo. | llamacpp.ts:298-337 | **[FIX-M26]** |
| LANE-2 | MEDIUM | **No cross-lane RAM admission.** The RAM gate is per-lane decision from a 60 s-cached hardware report (gpu.ts:48-49,142-161); two lanes spawning concurrently each see the same (possibly stale) `freeRamMb` and both start — combined overshoot toward OOM. VRAM has a reservation ledger (gpu.ts:204-222); system RAM has none. | llamacpp.ts:316-323; gpu.ts:195 | **[FIX-M26]** (spawn-time reservation across lanes) |
| LANE-3 | MEDIUM | **No cleanup of our own failed spawns.** Nothing records the spawned PID and nothing kills a llama-server that never opened its port inside the deadline — it keeps loading RAM indefinitely; a wedged-but-listening server passes the /models probe and every turn then burns the 180 s floor before fallback. Checklist items "Clean up abandoned processes" / "Detect unhealthy or unresponsive model servers" unmet for the spawn path. Killing is safe-scoped: only our own just-spawned, never-answered child (never operator processes). | llamacpp.ts:344-393 | **[FIX-M26]** (bounded: kill only our own deadline-failed child; PID ledger) |
| LANE-4 | LOW | fd leak: when `BEAN_LLAMACPP_LOG_DIR` is set the parent opens the log fd (:352) and never closes it — ≤3 fds/h/lane. | llamacpp.ts:349-354 | **[FIX-M26]** (close fd after spawn) |
| LANE-5 | LOW | Crash-loop containment resets on process restart and is per-process (a standalone worker + server double the effective bound to 6/h). Accepted as consistent with the repo's documented per-process reliability state (see G-8). | llamacpp.ts:218-231 | **[ACCEPTED]** |
| LANE-6 | INFO | Adoption does not verify the adopted server runs the lane's declared model (documented operator-managed semantics; a real completion probe later proves capability). | llamacpp.ts:264-266 | **[ACCEPTED]** |

### 4.2 Provider & AI gateway reliability

| # | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| G-1 | MEDIUM | `/api/v1` external lane is gated on the HOSTED breaker (`assertNotCoolingDown('chat')` before the external branch) and its own 429s never open any breaker — cross-provider coupling + unbounded external retry exposure; wrong `Retry-After` hint sourced from the hosted window. | ai-gateway/gateway.ts:304-313; ai-gateway/providers/openai-compatible.ts:100-104 | **[FIX-M26]** (own `chat-external` breaker class + note 429s) |
| G-2 | MEDIUM | External non-streaming path ignores the caller's `AbortSignal` (only `AbortSignal.timeout` is used) → cancelled callers' fetches run to completion and are billed. | ai-gateway/providers/openai-compatible.ts:92 | **[FIX-M26]** (`AbortSignal.any`) |
| G-3 | MEDIUM | Streaming path has no deadline on stream-open (idle/total guards engage only after the iterable exists); a hung stream-open holds the SSE turn indefinitely under heartbeats. | ai-gateway/providers/openai-compatible.ts:160; adapters/hosted-llm.ts:560-568 | **[FIX-M26]** (bounded open deadline) |
| G-4 | MEDIUM | RIISHE chat route can leak its concurrency slot permanently: several unguarded awaits sit between `acquireSlot` and the first `try/finally` (DB conversation ops, memory commands). Two leaked slots lock the user out with `CONCURRENCY_LIMIT` until restart. | src/app/api/riishe/chat/route.ts:66-301 | **[FIX-M26]** |
| G-5 | MEDIUM | Quota gates are count-then-act with post-turn recording (TOCTOU overshoot under concurrency); account budget counts turns while the provider counts upstream calls (rows-per-turn mismatch ≈ the measured 2026-11-08→09 exhaustion storm). | ai-gateway/gateway.ts:63-77; providers/account-quota.ts:75-79; riishe route:459-469 | **[DOC-BLOCKER]** (reservation redesign = cross-cutting; documented) |
| G-6 | HIGH | Quota gauge/hold module (`upstream/quota.ts`) is unwired dead code whose docstring claims live integration — the designed defense against account-level daily exhaustion does not exist at runtime. | upstream/quota.ts:23-41; upstream/gateway.ts:389-391 (no caller) | **[QUARANTINE]** (stream WIP; its wiring is the quota milestone's scope — must not ship half-wired) |
| G-7 | LOW | Timeout-triggered fallback double-spend: the hosted SDK request is non-cancellable; fallback proceeds while the abandoned primary usually still completes upstream. | adapters/hosted-llm.ts:609-617; providers/routing.ts:40-49 | **[ACCEPTED]** (documented platform limitation; single fallback attempt bounds cost) |
| G-8 | MEDIUM | All reliability state (breakers, rate-limit windows, concurrency slots, lane state, health cache) is per-process `globalThis` — N instances = N× provider pressure and N× client allowance under the documented multi-instance scaling plan. | upstream/gateway.ts:229-336; auth/ratelimit.ts:17; router.ts:72-101 | **[DOC-BLOCKER]** (single-instance is the tested deployment configuration; externalize before scaling) |
| G-9 | LOW | Streamed metering records chars as tokens (~4× inflation in token fields; row-count budgets unaffected); `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS` parsed `==='true'` in url-guard vs `==='1'` in lanes/credentials — `true` admits vault loopback URLs but silently keeps lanes dormant. | src/app/api/v1/chat/completions/route.ts:157-158,173-174; security/url-guard.ts:76; llamacpp.ts:115 | **[FIX-M26]** (align the flag parse; token-field fix documented only — row budgets unaffected) |
| G-10 | INFO | Verified-solid: one attempt per candidate, first success wins, all-fail throws last typed error; 429 never retried anywhere, first-429-opens-breaker with 60 s→600 s escalation; per-class isolation (`chat-llamacpp` cannot poison hosted); typed 7-class failure taxonomy; recovery = verified real success; probes quota-free; credentials env-names-only, keys only in Authorization header, Bearer redaction everywhere. | upstream/gateway.ts:120-409; providers/routing.ts:58-189; tests upstream-429/provider-retry/retry-after-headers/provider-fallback | **[ACCEPTED]** |

### 4.3 Persistent queue, DB & recovery

| # | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| F-G1 | HIGH | **GANGZII async jobs are queued forever**: TTS/transcribe/convert routes enqueue `GenerationJob(product='gangzii')` but no pool claims that product and no handler exists — with embedded pools running the rows stay `queued` forever (worse than the documented honest `NO_BACKEND`). | src/app/api/gangzii/{tts,transcribe,convert}/route.ts; jobs/queue.ts:65-71; ai-engine/runner.ts:351; ai-engine/handlers.ts:30-57 | **[FIX-M26]** (honest fail-fast at enqueue: no handler configured → typed `NO_BACKEND` failure, job settled, never silently parked forever) |
| F-1 | HIGH | A cancelled RUNNING LAXII text-to-image job still completes and overwrites the row (`image-worker.ts` has zero cancel checkpoints; completion is an unconditional `update`). Contract says "the worker will stop at its next checkpoint". | jobs/image-worker.ts (no `cancel` refs; :307-328) | **[FIX-M26]** (cancel checkpoints + guarded completion writes) |
| F-2 | MEDIUM | Legacy processors settle rows with unconditional writes (`updateJob/failJob/progress/markCancelled`): a worker that lost its lease can clobber the new owner's state (the exact clobber class measured on `runner.ts:135-139` before). | jobs/image-worker.ts:204-206; video-worker.ts:221-223,894-926; laxii/jobs.ts:151-168 | **[FIX-M26]** (guarded CAS writes on completion/cancel paths) |
| F-3 | MEDIUM | `finishFailed` ownership check is read-then-write and its WHERE omits `workerId` (all other settle paths include it) — a stale worker's failure can park/fail a job now owned by another worker. | ai-engine/queue.ts:269-317 | **[FIX-M26]** (careful: preserve the `__recovery__` caller) |
| F-4 | MEDIUM | `recoverStaleJobs` requeues without re-verifying lease expiry at write time (read stale → updateMany matches `{id,status}` only) — a slow-but-alive worker whose heartbeat lands in the window gets its live row requeued (duplicate provider execution). | ai-engine/queue.ts:375-397 | **[FIX-M26]** (`leaseUntil` precondition in the write) |
| F-5 | MEDIUM | Duplicate-submission guard is check-then-insert (no unique constraint on active `dedupeKey`); per-user active cap has the same race. Two concurrent identical submits double-spend provider work. | ai-engine/queue.ts:85-92; ai/jobs route:143-181 | **[DOC-BLOCKER]** (partial unique index needs a schema/migration decision on SQLite; documented with bounded impact) |
| F-6 | MEDIUM | Cross-process video poller re-attach bypasses claims: any read route can attach an executing poller to `running` rows even when engine pools are active; two processes can poll/write the same provider task. | jobs/video-worker.ts:963-981; jazmii/generate/route.ts:137-147 | **[FIX-M26]** (suppress re-attach when pools are active — same-process suppression already exists, extend the guard) |
| F-7 | LOW | Submit flows create user message + job without a transaction (orphaned message when job create fails). | ai/jobs/route.ts:161-181 | **[FIX-M26]** (wrap in `$transaction`) |
| F-8 | LOW | `requestVideoCancel` read-then-write can clobber a just-completed row (ms window). | video-worker.ts:988-1011 | **[FIX-M26]** (status-guarded `updateMany`) |
| F-9 | LOW | Inline-kick failure path calls `finishFailed('__kick__')` which can never match the ownership guard — silent no-op. | jobs/queue.ts:80-84; ai-engine/queue.ts:273 | **[FIX-M26]** (honest recovery-worker id) |
| F-10 | LOW | SQLite hardening: no `busy_timeout`, no WAL, `log:['query']` unconditionally (prod log noise/PII risk). | db.ts:16-30 | **[FIX-M26]** (busy_timeout + env-gated query logging; WAL deferred — journal-mode change needs an operator decision) |
| F-11 | HIGH | `schema.postgres.prisma` is two generations stale (missing engine columns, JobEvent, M22 versioning models, Project, ClientComputeReport — 17 of 28 tables in the committed DDL); the documented PG cutover path would break the current app. | prisma/schema.postgres.prisma; scripts/db-migrate-pg.ts:69-87 | **[DOC-BLOCKER]** (regeneration is the PG milestone's work; documented so nobody cuts over on this artifact) |
| F-12 | HIGH | No migration history; `db:push --accept-data-loss` is the operative schema path — any diff (incl. destructive) applies without review. | package.json:11; no `prisma/migrations/` on disk | **[DOC-BLOCKER]** (migration adoption out of scope; documented) |
| F-13 | INFO | Verified-solid: claim = genuine single-statement CAS (attempts+workerId preconditions); lease/heartbeat (120 s / lease÷4); `recoverStaleJobs` on every pool start + 60 s sweep; cancel-before-claim settled inside claim; `requestCancel` CAS; video resume dedupes on persisted `providerTaskId`; all 12 job routes owner-scoped (no IDOR); bounded throttle parking (image 3/30 min, video 5/30 min); event seq unique-with-retry. | ai-engine/queue.ts:142-193,331-437; video-worker.ts:279-289 | **[ACCEPTED]** |

### 4.4 Intelligent multi-file refactoring (CODE GIFTZ)

Verified-solid first: single-transaction all-or-nothing execution with in-transaction
re-validation (execute.ts:146-197; tested failure→no partial state), plan-hash integrity
+ replay + status lifecycle (execute.ts:94-117), DFS cycle detection that cannot hang
(graph.ts:377-400), deterministic ordering throughout (sorted keys/canonical JSON),
prompt-injection resistance pinned by structural tests, protected paths + traversal
gates on drafts, approval always required.

| # | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| R-1 | MEDIUM | **Unbounded graph builds**: no file-count cap, no node_modules exclusion in the refactoring graph; every turn re-parses the full file set ~4× (detect → chat-flow → validate → execute). A 5,000-file project completes but with linear multi-second parse cost and no honest "too large" refusal. | code/refactoring/graph.ts:296-314; code-giftz/chat/route.ts:144 | **[FIX-M26]** (bounded graph: cap + node_modules exclusion + honest LIMIT refusal) |
| R-2 | MEDIUM | Move-module basename ambiguity: a token matching multiple basenames collects ALL of them as sources → one plan silently moves both `hero.tsx` files. Contradicts the "never guesses" contract. | code/refactoring/detect.ts:49-59,174-183 | **[FIX-M26]** (ambiguous basename → clarification, matching extract's behavior) |
| R-3 | MEDIUM | Detection hijack: any message containing "restructur*"/"consolidat*" routes to a multi-file plan even for function-level prose ("help me restructure this function"). | code/refactoring/detect.ts:68,118-131,168-171 | **[FIX-M26]** (prose-shaped → normal edit turn; folder-shaped intent only) |
| R-4 | LOW | Root-relative (`'/…'`) specifiers are neither edges nor unresolved entries — rename-symbol importer coverage can miss them (move-module is covered via the M23 scanner; asymmetric). | code/refactoring/graph.ts:244-252 | **[FIX-M26]** (record `/'-specifiers as unresolved entries; no guessing) |
| R-5 | LOW | `rollbackToVersion` (the undo path) is non-transactional — crash mid-rollback leaves half-restored state; weaker than the path it undoes. | code/versioning.ts:574-592 | **[FIX-M26]** (wrap in `$transaction`) |
| R-6 | LOW | Version snapshot runs AFTER the execute transaction; a crash in the window leaves a mutated-but-unversioned project (replay safely refused; zero-version projects have no restore point). | code/refactoring/execute.ts:190-214 | **[FIX-M26]** (snapshot inside the transaction) |
| R-7 | LOW | Dead-but-tested code: `updateGraph`/`runStaticValidation` exported+tested, never called in production paths. | graph.ts:321-357; validate.ts:37-126 | **[ACCEPTED]** (removal is refactoring outside the defect class; documented) |
| R-8 | INFO | No execution-based validation pre-apply (static gates only; sandbox build is the explicit separate gate — honestly documented in validate.ts:115). Truncated-provider-draft acceptance exists but passes the same static gates. | validate.ts:115; assisted.ts:139-161 | **[ACCEPTED]** |

### 4.5 Security

| # | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| S-1 | CRITICAL | **Workspace terminal RCE (unreleased WIP)**: `POST /api/workspace/terminal` runs `bash -lc` with the FULL server env for any member user, no ownership/audit/rate-limit; combined with the origin-runs-preview iframe and zero per-user tenancy this is a full RCE-as-service surface. It exists ONLY in the auto-commit (`f0b47ad`), never released. | src/app/api/workspace/terminal/route.ts:26-65 [in f0b47ad] | **[QUARANTINE]** (feature stays out of the release branch; documented P0 requirements before it can ever ship) |
| S-2 | CRITICAL | **Published-history secret exposure**: 24 cookie jars with 30 session tokens in remote main (§1.2); 0 currently valid locally; full fix needs history rewrite (operator action, outside no-force-push rules). | git ls-tree b0b03da; commit 2af6299 | **[DOC-BLOCKER]** + jars deleted from HEAD in M26 commit |
| S-3 | CRITICAL | Auto-commit swept `scripts/.github_device_code` + DB backup + env snapshot into a local commit (§1.1). Remote unaffected. | f0b47ad | **[QUARANTINE]** + .gitignore hardening **[FIX-M26]** |
| S-4 | HIGH | Sandbox same-uid residual: approved sandbox code can read `../../.env` and `db/custom.db` (all users' scrypt hashes + plaintext session tokens) and exfiltrate via stdout (network-namespace blocks network exfil only). Documented residual; real fix = dedicated uid/mount namespace. | sandbox/runner.ts:245-255; docs/security/SECURITY.md | **[DOC-BLOCKER]** |
| S-5 | HIGH | CSRF from sibling `*.space-z.ai` pages: only `Sec-Fetch-Site: cross-site` is rejected; `same-site` falls through to an Origin allowlist whose default suffix scope admits any sibling subdomain. The docstring's compensating-control claim is wrong. | src/lib/api/origin.ts:123-128,185-222 | **[FIX-M26]** (same-site + non-allowlisted exact origin → reject; test added) |
| S-6 | MEDIUM | Provider SSRF guard misses IPv4-mapped-IPv6 (`::ffff:127.0.0.1`, `::ffff:169.254.169.254` pass); provider fetches follow redirects without revalidation (research guard does it correctly). | security/url-guard.ts:65-73; providers/openai-compatible.ts:95 | **[FIX-M26]** (v4-mapped-v6 ranges; redirect revalidation documented for the provider lane — metadata exposure bounded by header stripping) |
| S-7 | MEDIUM | JAZMII worker re-fetches the user reference image WITHOUT the SSRF guard and with redirect-follow (submit path is guarded; the worker path is the bypass). | jobs/video-worker.ts:342 → intel/vision.ts:141-158 | **[FIX-M26]** (guard the worker fetch) |
| S-8 | MEDIUM | Auth hardening gaps: register has NO rate limit (mass account creation); login limiter keyed on spoofable `x-forwarded-for`; first-registrant-admin re-grant race after admin self-delete; password change doesn't revoke sessions; sessions stored plaintext with 7-day fixed TTL. | auth/register/route.ts:15-51; auth/login/route.ts:18; account/settings/route.ts:38-64; auth/session.ts:20-43 | **[FIX-M26]** (register rate limit; admin-bootstrap race guard; session revocation on password change). Login XFF key + plaintext tokens: **[DOC-BLOCKER]** (proxy contract + token-hash migration) |
| S-9 | MEDIUM | Upload memory-DoS: `laxii/assets` and `code-giftz/attachments` buffer the full multipart before size checks (multi-GB body → memory); the correct pre-check pattern exists in riishe/documents. | laxii/assets/route.ts:15-32; code-giftz/attachments/route.ts:55-72 | **[FIX-M26]** (pre-read content-length caps) |
| S-10 | MEDIUM | Provider-controlled video URL downloaded with redirect-follow, no guard (payload magic-byte-validated). | adapters/hosted-video.ts:195-211 | **[FIX-M26]** (same guard as S-7) |
| S-11 | LOW | `/api/health` is unauthenticated and exposes breaker state, queue depths, attempt evidence (no paths/env/credentials — verified field by field). Ops-posture exposure; liveness must stay public for the platform. | app/api/health/route.ts:183-572 | **[FIX-M26]** (split: keep a minimal public liveness/readiness; move breaker/queue detail behind admin auth; tests updated) |
| S-12 | LOW | Diagnostics `run` and uploads are not rate-limited; workspace routes (WIP) have zero audit/rate-limit. | diagnostics/route.ts:26-44 | **[FIX-M26]** (rate-limit diagnostics run; workspace stays quarantined) |
| S-13 | LOW | No CSP/HSTS at app level (documented ingress responsibility); `typescript.ignoreBuildErrors: true`. | next.config.ts:43-54 | **[DOC-BLOCKER]** |
| S-14 | INFO | Verified-strong: scrypt+timingSafeEqual passwords; AES-256-GCM fail-closed vault; `bgk_` keys SHA-256 + constant-time + rotation/revocation + scopes + audit; portal 404-cloaked tenancy; generic INTERNAL_ERROR contract (no stack/message leak); argv-array everywhere (reach/ffprobe/llama spawn); RIISHE upload pipeline (pre-checks, magic sniffing, zip-bomb rejection); cross-user scoping clean in all sampled queries; admin routes role-gated + audited; metering/audit logging without content. | (per-domain files; see test map) | **[ACCEPTED]** |

### 4.6 Observability & diagnostics

| # | Sev | Finding | Evidence | Disposition |
|---|---|---|---|---|
| O-1 | HIGH | **No correlation/request IDs anywhere** (grep: 0 matches) — a 500 cannot be joined to its job/provider log line without timestamp hand-matching. | repo-wide | **[FIX-M26]** (middleware-issued `x-bean-request-id`, propagated into logger fields and returned as a response header) |
| O-2 | MEDIUM | Queue depth yes; **processing-latency metrics none** (no aggregate anywhere). | health/route.ts:437-441; admin/overview | **[DOC-BLOCKER]** (needs a metrics store; single counters added where cheap) |
| O-3 | MEDIUM | `/api/health` detail payload unauthenticated (same finding as S-11). | health/route.ts | **[FIX-M26]** (via S-11) |
| O-4 | LOW | Format inconsistency (JSON logger vs plain-text middleware/instrumentation lines); unexpected-error logs carry no route context; shutdown is never logged (no SIGTERM hook); diagnostics runs are in-memory-only (30-min TTL). | middleware.ts:25-29; errors.ts:131-139; instrumentation.ts | **[FIX-M26]** (SIGTERM shutdown log; route context where the handler already knows it) |
| O-5 | INFO | Verified-solid: JSON structured logger with `BEAN_LOG_LEVEL`; job IDs pervasive; per-class breaker state exposed; resource-admission refusals logged with measured reasons (searxng ram/rate/home, llamacpp spawn failures); retry counts + cancellation + client-disconnect events per-event; typed error taxonomy end-to-end; **no prompts/file contents/credentials in any of ~70 logger call sites** (generated content persists only in 72-h JobEvent rows by design); operator diagnosability honestly rated 6/10 today. | observability/logger.ts; ai-engine/events.ts | **[ACCEPTED]** |

---

## 5. Products regression surface (what must not break)

BEAN Intelligence gateway (chat/completions/keys/usage/model registry), CODE GIFTZ
(chat/file-ops/versioning/refactor/export/sandbox/approval), RIISHE (chat/research/
retrieval/streaming/memory), LAXII (image gen/edit/bg-removal/enhance + worker),
JAZMII (t2v/i2v/polling/cancel/media), GANGZII (adapter presets — async surfaces fail
honestly after F-G1 fix), Client Compute Engine (86-test suite; untouched), BEAN FX
(absent — nothing to test, documented). Auth/API keys/rate limits/queues/usage.

## 6. Remediation plan for this milestone (approved scope)

**Wave 1 — critical/high security & data-integrity:** S-2/S-3 (HEAD cleanup +
gitignore), S-5 (origin/CSRF), S-6/S-7/S-10 (SSRF guard + worker fetch guards),
S-8 (register rate limit, admin-bootstrap race, session revocation on password change),
S-9 (upload pre-checks), F-1 (cancelled image job completes), F-G1 (GANGZII honest
fail-fast), R-1/R-2/R-3 (refactor bounds/ambiguity/hijack), LANE-1..4 (lane manager).

**Wave 2 — verified reliability:** F-2/F-3/F-4/F-6/F-7/F-8/F-9 (queue CAS/recovery
hardening), G-1/G-2/G-3/G-4 (external lane breaker + cancellation + stream-open
deadline + slot leak), F-10 (SQLite busy_timeout + env-gated query logging), R-4/R-5/R-6
(refactor transactional rollback/snapshot + '/'-specifier recording), S-11/O-3
(health split), O-1 (request IDs), O-4 (shutdown log), S-12 (diagnostics rate limit),
G-9 (env-flag parse alignment).

**Explicitly out of scope (documented, not fixed):** quota reservation redesign (G-5),
quota gauge wiring (G-6 — quarantined stream), multi-process state externalization
(G-8), Postgres migration path (F-11/F-12), sandbox uid isolation (S-4), CSP/HSTS
(S-13), login XFF key + plaintext session-token hashing (S-8 remainder), latency
metrics store (O-2), workspace feature completion (S-1 — quarantined), BEAN FX (absent),
history rewrite of published cookie jars (S-2 — operator action).

Every fix ships with a regression test. No tsconfig weakening, no `any`, no test
skipping, no assertion weakening.
