# BEAN Four-Product Acceptance Report

**Date:** 2026-11-04 · **HEAD:** `942dbbf` (+docs) · **Evidence:** `scripts/four-product-acceptance-out/acceptance-results.json` (live run against the real dev server), `scripts/giftz-verify-out/w6-eval-local-*.json`, browser-rendered inspections.

## 1. Verification environment

Real Next.js dev server on :3000 (the same deployment the public preview serves), real Prisma/SQLite database, real upstream provider gateway. Every result below is from an actual backend execution or an actual rendered page — none from mocks. Provider mocks exist only in isolated adapter unit tests and are never counted as generation proof.

## 2. Acceptance matrix (required format)

| Product | Feature | Implementation | Real test | Result |
|---|---|---|---|---|
| RIISHE | Assistant & tools (generation, tool loop, research, docs, memory, streaming) | Full (pre-existing, audited) | Unit suites green; live streamed answers verified in prior sessions; **fresh live turn this session: upstream 429** | **PARTIAL** (blocked by external throttling, honestly surfaced) |
| RIISHE | Conversation persistence + isolation | Full | Live: persisted + listed; intruder → 404 | **PASS** |
| LAXII | Text-to-image pipeline (submit → queue → worker → artifact → delivery) | Full (pre-existing) | Live: real submission 202, worker invoked real upstream API; upstream 429 → typed `BACKEND_FAILURE` job failure recorded verbatim | **PARTIAL** (pipeline real; completed artifact BLOCKED by upstream 429 today) |
| LAXII | Enhancement + exact-preservation editing (masks, face zones, reports) | Full deterministic path (pre-existing) | Unit suites (`laxii-preservation`, `laxii-enhance`); real asset upload 201; capability truth endpoint | **PASS** (deterministic scope) |
| LAXII | Generative masked editing + face-identity preservation (InstantID/IP-Adapter class) | Designed, gated off | Real asset + schema-valid smart-edit → typed **503 PROVIDER_UNAVAILABLE**; worker needs GPU host + licensed checkpoints | **BLOCKED** (hardware/weights; honest refusal verified) |
| JAZMII | Text-to-video / image-to-video | Honest not-configured surface | Live: typed `NO_BACKEND` rejection persisted as `unsupported` audit record; availability=false with reason | **BLOCKED** (no GPU backend/checkpoint deployed — reported, not simulated) |
| CODE GIFTZ | Conversation sidebar (search / rename / date groups / counts / delete-confirm / collapse / mobile) | **Built this session** (`11a68bc`) | 24 unit tests + live UI run-through (create → list → rename → search match/no-match/clear → cancel-delete → confirmed-delete → collapse → mobile drawer) | **PASS** |
| CODE GIFTZ | Persistent database (auto-save, restore-on-refresh, ordering, honest failure states, retry dedupe) | Full (pre-existing, unit-pinned) | Live reopen after reload; IDOR 404; `PERSIST_FAILED` path pinned | **PASS** |
| CODE GIFTZ | Real coding response (gateway turn) | Full | Real model call attempted → upstream 429 captured verbatim | **PARTIAL** (blocked by external throttling) |
| CODE GIFTZ | W6 self-verification | Full, gated off by default | Local eval **PASS** (4/4 ground-truth executed, 8/8 detection, 8/8 verifier contract); live gateway-gated eval → designed BLOCKED path | **PASS (local)** / live **BLOCKED** |

## 3. Separation of claim levels

- **Implemented:** everything in the matrix (source-level, tested).
- **Locally tested:** full unit suite 1018/0/64 files (29,050 expects), tsc 11 pre-existing scripts-only errors, eslint 0, dev-server live API run.
- **Integration tested:** four-product acceptance run on the real server incl. cross-user IDOR guards, typed failure envelopes, health projection.
- **Real-provider tested:** RIISHE/GIFTZ/LAXII generations were attempted against the real provider this session and are currently **429-throttled upstream** (rejections recorded verbatim); earlier sessions hold real successful generations (RIISHE streamed answers; LAXII hosted images; GIFTZ 66/67 R3 runs).
- **Public-preview tested:** dashboard + CODE GIFTZ sidebar inspected in a real browser this session (uniform cards, sidebar flows, honest statuses).
- **Production-ready:** not claimed — single-node queue/rate-limit stores, process-level sandbox isolation, and the upstream throttle dependency remain documented limitations.

## 4. Regression results (this session)

- `bun test`: **1018 pass / 0 fail / 64 files / 29,050 expects** (was 994/62 before the sidebar work).
- `eslint .`: 0 problems on all changed files.
- `tsc --noEmit`: 11 errors, all pre-existing in `scripts/` (baseline preserved; none in changed code).
- Build not re-run this session (no server-side structural changes beyond routes already type-checked; dev server compiled and served all changes).

## 5. Honest status dashboard (measured at report time)

| Product | Status | Evidence |
|---|---|---|
| RIISHE | unavailable | probe deferred; failureCategory `rate-limited` (HTTP 429) |
| LAXII | degraded | reachability probe 5–13ms OK; recorded generation attempt failing (upstream 429/404) |
| JAZMII | not-configured | no probe runs; "backend not deployed" |
| CODE GIFTZ | unavailable | probe deferred; failureCategory `rate-limited` (HTTP 429) |

This is the truthful picture: the platform's own honesty machinery (5-state contract, breaker deferral, last-attempt evidence) is functioning exactly as specified.

## 6. Blockers (explicit)

1. **Upstream provider throttling (account-level 429)** on chat + image classes — external; all live generation acceptance that requires a fresh provider answer is BLOCKED until it lifts. No workaround without violating the no-fabrication rules.
2. **No GPU host / licensed video or diffusers checkpoints** — JAZMII stays Not configured; LAXII generative editing stays honestly refused.
3. **W6 live re-verification + 67/67 R3** — requires blocker 1 to clear.

## 7. Deliverables & rollback

- Commits this task: `66eac2e` (card uniformity), `11a68bc` (sidebar), `942dbbf` (acceptance harness + evidence), docs commit (this report set).
- DB backup before any work: `db/custom.db.backup-20261104-135209.db`.
- Rollback: revert the listed commits; no migrations to undo; user data untouched (test users are isolated `accept-*`/`e2e-4prod` accounts).
