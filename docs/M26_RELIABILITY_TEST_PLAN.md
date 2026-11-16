# M26 RELIABILITY TEST PLAN — BEAN Intelligence

Milestone: M26 (production-readiness audit) · Scope: what was tested, how, and
what each test proves. Companion documents: `M26_AUDIT.md` (findings),
`M26_RESULTS.md` (outcomes), `docs/M26_OPERATIONS_RUNBOOK.md` (operations).

## 0. Testing principles

1. **`bun run test` is the canonical gate** (`bun test --isolate tests/`) — the
   non-isolated runner is order-dependent (M22's documented finding) and is
   never used for acceptance.
2. **Mock boundaries only at real seams** (Prisma client, HTTP, the provider
   SDK); the logic under test is the real production code.
3. **No assertion weakening to obtain green**: where a fix changed behavior,
   the test pins the NEW documented contract; no `skip`, no `any`, no tsconfig
   weakening.
4. **Live verification uses disposable data only** — throwaway accounts
   (`*@disposable.local`), a marked demo row, deleted after the run. The live
   database holds no user data in this sandbox.
5. **Honest NOT_TESTED statements** for what this host cannot exercise (see §7).

## 1. Unit suites (added or extended this milestone)

| Suite | Pins |
|---|---|
| `tests/unit/llamacpp-lane-manager.test.ts` (new, 7) | LANE-1 duplicate-spawn mutex (N concurrent ensures → exactly one spawn, per-lane not global); LANE-2 cross-lane spawn-RAM admission (pending reservation shrinks what other lanes see; released on failure; both lanes admitted when RAM fits); probe-cache adopt path unchanged |
| `tests/unit/llamacpp-lanes.test.ts` (existing, extended in batch-1 review) | planLaneStart decision matrix unchanged (adopt/skip/rate/weights/RAM) |
| `tests/unit/url-guard.test.ts` (extended, +5) | S-6 IPv4-mapped-IPv6: mapped metadata NEVER allowed; mapped loopback hatch-gated; public mapped passes; hex-hextet + dotted forms; the mapping helper itself |
| `tests/unit/worker-fetch-guards.test.ts` (new, 7) | S-7/S-10: worker-side fetches refuse loopback/metadata targets with ZERO fetch attempts; public targets fetch; data URLs pass; downloadVideo container validation intact |
| `tests/unit/origin.test.ts` (extended, +6) | S-5: hostile sibling (`evil.space-z.ai`) with `Sec-Fetch-Site: same-site` rejected; suffix host + same-site rejected unless exactly allowlisted; app-origin same-origin passes; loopback dev allowance unchanged |
| `tests/unit/image-cancel-checkpoint.test.ts` (new, 3) | F-1: cancel before generation → settled cancelled, zero provider calls, zero usage; cancel during generation → completion write REFUSED, spend metered as CANCELLED failure, no artifact; no-cancel happy path completes |
| `tests/unit/queue-unwired-tasks.test.ts` (new, 3) | F-G1: unwired task types settle failed NO_BACKEND at enqueue (never parked forever); wired tasks still wake pools |
| `tests/unit/ai-engine-queue.test.ts` (extended, +4) | F-3: a stale worker's finishFailed cannot park/fail a re-claimed row; the legitimate owner and `__recovery__` still settle; F-4: recovery does not requeue a lease-renewed row (write-time re-verification) and still requeues genuinely expired leases |
| `tests/unit/db-url.test.ts` (new, 4) | F-10: busy_timeout forced (bounded default, override, 60s cap), connection_limit preserved, non-file URLs untouched |
| `tests/unit/ai-gateway.test.ts` (extended, +6) | G-1: external 429 opens `chat-external` ONLY; a hosted 429 never fail-fasts the external lane; repeated external 429s fail fast with zero network I/O; G-2: an aborted caller unwinds the external fetch mid-flight (and the pre-abort guard refuses already-dead callers); G-3: hung hosted AND external stream-opens reject within the deadline |
| `tests/unit/request-context.test.ts` (new, 3) | O-1: log lines inside a request scope carry `requestId`; nested async keeps it; worker logs outside a scope carry none |
| `tests/unit/code-refactor-m26.test.ts` (new, 11) | R-1: generated dirs excluded, oversized projects refused honestly (typed RefactorScopeError), in-bounds projects still build; R-2: ambiguous basenames clarify (never silent multi-move), exact paths still move; R-3: prose stays a normal edit turn, folder-shaped intent still detects; R-4: `/…` specifiers resolve with `@/…` parity |
| Existing suites re-run unmodified | 2,122-test M25 baseline (gateway/queue/laxii/jazmii/giftz/riishe/client-compute/security suites) |

## 2. Live verification battery (`scripts/m26/live-verification.sh`, 17 checks)

Executed against the RUNNING dev server (bounded, disposable accounts):

1. O-1: every response carries `x-bean-request-id`; ids differ per request; a
   client-supplied id is honored (echoed).
2. S-5: `POST` with `Origin: https://evil.space-z.ai` + `Sec-Fetch-Site: same-site`
   → 403; suffix host + same-site without exact allowlist → 403; the app
   origin's same-origin mutation passes the origin gate (non-403).
3. S-8: rapid registrations hit the limiter (429 among 7); password change
   (PATCH) succeeds and the OLD session is revoked (health falls back to the
   public shape); re-login with the new password works; the authenticated
   session sees the FULL health detail (breaker state present).
4. F-G1: GANGZII TTS answers a typed error without hanging; ZERO gangzii jobs
   stuck in queued/running states in the DB.
5. S-11: the unauthenticated health payload has no breaker/evidence detail and
   keeps per-product readiness statuses.

## 3. Measured performance & recovery run (`scripts/m26/measurements.ts`)

- `/api/health` concurrency: 250 requests (5 waves × 50 parallel), 0 failures —
  p50/p95/max recorded in M26_RESULTS §11 with environment context.
- Queue recovery DEMONSTRATION: a disposable `running` row with an expired
  lease (dead `workerId`) is inserted; the REAL `recoverStaleJobs` runs; the
  row is requeued `retry_wait`/`WORKER_LOST` (measured ms); the row and the
  disposable owner are deleted afterwards.
- Lane lifecycle: honest NOT_TESTED statement (no GGUF weights/binary on this
  host — the M25-documented limitation is unchanged; the decision matrix and
  refusal path are unit-pinned).

## 4. Release gates

| Gate | Command | Expectation |
|---|---|---|
| Full suite | `bun run test` | 0 fail (2,181 at the time of release; baseline was 2,122) |
| TypeScript | `npx tsc --noEmit` | 0 errors in `src/` + `tests/` (pre-existing debt confined to `scripts/`/`validation/` is other-stream, unchanged) |
| ESLint | `npx eslint src tests` | clean |
| Production build | `bun run build` | PASS with zero warnings; standalone `server.js` verified |
| Secret scan | pattern sweep over the push delta + tree | no credential-shaped literals; zero sensitive files in the published tree |
| Product regression | the full suite's product sections | gateway/keys/usage, GIFTZ, RIISHE, LAXII, JAZMII, CCE suites green |

## 5. What each fix's test does NOT prove

- The lane spawn path is not exercised against real `llama-server` weights
  (documented operator-host enablement path; decision logic is unit-pinned and
  the refusal path was live-verified in M25 — unchanged).
- Multi-process state (breakers, rate limits, slots) remains per-process; the
  single-instance deployment is the tested configuration (documented blocker).
- The dev-server concurrency measurement reflects dev-mode compilation and
  dormant-provider probe timeouts — it is NOT a production latency benchmark.
- Quota TOCTOU (count-then-act) and the account-budget basis mismatch are
  documented blockers, not fixed; their tests (zero-downtime-quota) pin
  current behavior only.

## 6. Regression discipline

Every M26 fix ships with at least one regression test executed in the
canonical suite (§1). Where a fix changed a documented contract (cancellation
of running image jobs, GANGZII queue behavior, health payload visibility), the
test pins the NEW contract explicitly and the change is disclosed in
`M26_RESULTS.md`.
