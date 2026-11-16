# M26 OPERATIONS RUNBOOK — BEAN Intelligence

Audience: the operator running BEAN Intelligence in the tested deployment
configuration (single host, single Next.js process, SQLite, embedded engine
pools). Companion: `M26_AUDIT.md`, `M26_RESULTS.md`,
`docs/M26_RELIABILITY_TEST_PLAN.md`.

## 1. Daily operation model

- ONE Next.js process serves HTTP and runs the embedded engine pools
  (`src/instrumentation.ts`, `BEAN_ENGINE_EMBEDDED=1` default). Jobs persist in
  `GenerationJob` (SQLite) — a process restart loses nothing durable.
- Media artifacts live under `storage/{laxii,jazmii}/<userId>/` — the DB and
  this tree must be backed up TOGETHER (a completed job row without its file is
  a broken reference).
- **Single-instance constraint**: breakers, rate-limit windows, concurrency
  slots and lane state are per-process. Running N instances multiplies every
  provider-facing limit by N and fragments cooldown state. Scale by making the
  state external FIRST (documented blocker, M26_RESULTS §15).

## 2. Health and diagnostics

- `GET /api/health` — public: liveness + per-product readiness status
  (`operational / degraded / unavailable / not-configured`). Use this for
  uptime checks and ingress probes.
- The same endpoint WITH an authenticated session returns the operational
  detail: per-endpoint-class breaker windows (consecutive-429 streak, remaining
  cooldown, skipped calls), probe evidence chains, queue depth, engine pools,
  ffprobe availability.
- Every HTTP response carries `x-bean-request-id` (middleware-issued,
  client-supplied ids honored). Join any response to its server logs via this
  id — every structured log line emitted inside the request carries it.
- Structured logs are JSON on stdout; `BEAN_LOG_LEVEL` gates verbosity;
  `BEAN_LOG_DB_QUERIES=1` re-enables per-statement SQL logging (off by default
  since M26 — noise/PII discipline). `server.shutdown` is logged on SIGTERM/
  SIGINT; absence of that line + exit means an unclean crash.

## 3. Local model lanes (llama.cpp)

Enablement (operator host with weights — this sandbox has none):
1. Install llama.cpp (`llama-server` on PATH or `BEAN_LLAMACPP_BIN`).
2. Place GGUF weights OUTSIDE the repo; set `BEAN_LLAMACPP_MODEL_PATH` /
   `BEAN_LLAMACPP_CODE_MODEL_PATH`.
3. Set `BEAN_LLAMACPP_BASE_URL` (default `http://127.0.0.1:8081/v1`), optionally
   `BEAN_LLAMACPP_CODE_BASE_URL` for a separate code lane.
4. Set `BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS=1` (the SSRF opt-in; both `1` and
   `true` are accepted since M26).
5. Optionally `BEAN_LLAMACPP_LOG_DIR` (lane logs; the parent's log fd is closed
   after spawn since M26).

Behavior contract (verified by unit tests):
- An already-answering server is ADOPTED (probe `/models`, 60s cache); probes
  never spawn.
- A down loopback lane is spawned on demand: RAM-gated on the measured
  MemAvailable MINUS pending lane reservations (cross-lane OOM protection),
  weights-checked, bounded to 3 spawns/hour/lane (per process), 20s start
  deadline at 500ms polling.
- Concurrent requests share ONE spawn attempt (duplicate-spawn mutex).
- A spawn that never opens its port is TERMINATED by the deadline path —
  only BEAN's own never-answered child is ever killed; adopted/operator
  servers are never signaled.
- A refused/failed start never blocks the request — the connection failure
  surfaces honestly and the router's fallback chain proceeds.
- Non-loopback lanes (10.x/192.168.x) are NEVER spawned — operator-managed.

Operator care: if you run your OWN llama-server on the lane port, BEAN adopts
it; if you want BEAN to manage the process, let it spawn. Lane logs (when
`BEAN_LLAMACPP_LOG_DIR` is set) capture provider-side output for wedged-server
diagnosis. The spawn bound resets on process restart.

## 4. Provider gateway

- Fallback chains: RIISHE chat and GIFTZ code try the hosted gateway, then the
  local llama lane; each candidate at most once per request; 429 is NEVER
  retried (first observed 429 opens that lane's breaker, escalating 60s→600s).
- Breaker classes: `chat` (hosted), `chat-external` (admin-configured external
  providers), `chat-llamacpp` (local lanes), plus `functions/images/video/
  audio` — one lane's throttle cannot fail-fast another lane.
- `/api/v1` external lane: give the external provider its own credential; its
  429s open `chat-external` and its cooldown is what clients see as
  `Retry-After` — never the hosted window.
- Stream-open deadlines (30s default, `BEAN_GATEWAY_STREAM_OPEN_TIMEOUT_MS` /
  `BEAN_EXTERNAL_STREAM_OPEN_TIMEOUT_MS`) bound hung streams; client
  cancellation propagates on both lanes.
- The quota gauge/hold module (`src/lib/upstream/quota.ts`) is QUARANTINED WIP
  — it is not wired into the runtime. The documented count-then-act quota
  residual (TOCTOU overshoot under concurrency; account budget counts turns,
  not upstream calls) stands — see M26_RESULTS §15.

## 5. Queues and workers

- Claiming is CAS (`attempts`+`workerId` preconditions); leases (120s default)
  are heartbeat-renewed; `recoverStaleJobs` runs at every pool start and every
  60s — a dead worker's jobs requeue (`WORKER_LOST`) or fail honestly when the
  attempt budget is exhausted. Demonstrated live in M26 (8ms requeue).
- Terminal settles are CAS-guarded — a worker that lost its lease cannot
  clobber a re-claimed row.
- Cancelling a RUNNING job settles it at the worker's next checkpoint; LAXII
  text-to-image now checks before generation and before completion (a raced
  cancel is honored and the provider spend is metered as a cancelled failure).
- GANGZII async surfaces: NOT operational in this build (not registered in
  `BEAN_PRODUCTS`; routes fail honestly at preflight). If a job with no wired
  handler ever reaches the queue, it settles `NO_BACKEND` at enqueue — no task
  can be parked forever.
- `BEAN_ENGINE_EMBEDDED=0` runs pools down (inline fallback executes jobs);
  dedicated workers: `bun run workers`.

## 6. SQLite care

- The connection URL is forced to `connection_limit=1&busy_timeout=5000`
  (`BEAN_DB_BUSY_TIMEOUT_MS` overrides, capped 60s) — cross-process writers
  wait on the file lock instead of failing SQLITE_BUSY.
- Backup: stop writes or use the SQLite online backup API
  (`scripts/phase1-db-snapshot.py`), then copy `db/custom.db` + `storage/`.
  `db:push --accept-data-loss` is the schema path — REVIEW any schema diff
  before pushing; there is no migration history to roll back (documented
  blocker).
- `db/backups/`, cookie jars (`scripts/**/*cookies*`) and
  `scripts/.github_device_code` are git-ignored since M26 — never re-add them.

## 7. Published-history exposure (operator action required)

GitHub remote history contains committed cURL cookie jars with historical
local-dev session tokens (24 `*.txt` jars + 6 variant-named jars, 30 distinct
tokens; 0 valid against the current local DB). They are REMOVED from HEAD as
of M26 but remain in published history. Full remediation (owner action):
1. `git filter-repo` (or BFG) to strip `scripts/**/*cookies*`,
   `scripts/.github_device_code`, `db/backups/` from all history;
2. force-push the rewritten history (a deliberate, owner-authorized
   force-push — outside M26's release rules);
3. rotate/expire any tokens issued by a DB that ever shared history with the
   repo, and treat every historical session as exposed until rotated.
Until then: the repository must be treated as containing stale session
material in its history; keep it private or accept the documented exposure.

## 8. Known honest failure modes (no action required)

- Dormant providers (no credentials) report `not-configured` — no cost, no
  retries; the UI shows the measured reason.
- A wedged-but-listening local model server shows healthy `/models` probes and
  slow turns (the 180s local timeout floor) — check lane logs; restart the
  server process. The spawn-deadline path kills only BEAN-spawned children.
- The quota gauge and Postgres migration artifacts (`schema.postgres.prisma`,
  `scripts/db-migrate-out/`) are stale other-stream WIP — do not cut over on
  them (M26_RESULTS §15).

## 9. Security posture quick reference

- Sessions: `SameSite=None; Secure` cookie + the origin middleware; password
  change revokes ALL sessions. Login/register and the mutation gate are
  rate-limited; the register limiter keys on `x-forwarded-for` (spoofable when
  the port is directly reachable — documented residual; front with the
  ingress).
- Sibling-tenant CSRF: `Sec-Fetch-Site: same-site` requests are authorized
  ONLY by the exact `BEAN_TRUSTED_ORIGINS` allowlist — the platform suffix
  scope serves the app's own origin only.
- SSRF: provider base URLs, reference-image re-fetches and provider video
  downloads are guard-validated (incl. IPv4-mapped-IPv6) with manual-redirect
  revalidation where user-influenceable.
- Sandbox: `unshare -Urn` + rlimits, argv-array spawns, minimal env — with the
  DOCUMENTED residual that sandbox code runs same-uid and can read `.env` and
  the DB file. Do not run the sandbox on a multi-tenant host until uid/mount
  isolation lands (M26_RESULTS §15).
- The workspace feature (terminal, preview, per-user tenancy) is QUARANTINED
  WIP — never deploy a build that includes it (see `M26_AUDIT.md` §4.5 S-1).
