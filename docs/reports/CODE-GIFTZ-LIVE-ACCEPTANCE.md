# CODE GIFTZ LIVE Acceptance Report (GO-LIVE Phase 3)

**Date:** 2026-11-05 · **Branch/HEAD:** `main` @ `dca2220` (+ this session's commit) · **Environment:** real Next.js dev server on :3000, real Prisma/SQLite, real provider gateway, real local sandbox runner.

## 1. Verdict (feature level)

| Feature | Status | Real evidence |
|---|---|---|
| Real coding responses (streamed SSE turn against the hosted LLM) | **PASS (LIVE)** | 2026-11-04T16:32Z: two streamed answers (1,052 and 1,041 chars, SSE `text/event-stream`) that contained working `debounce(fn, wait)` code; conversation `projectId` returned in-stream; upstream 429 windows surface as an honest in-stream error frame that keeps the user's message for retry (verified live the same day) |
| Conversation sidebar (search / rename / date groups / counts / delete-confirm / collapse / mobile) | **PASS** | 24 unit tests + live UI run-through (`11a68bc`); date-group fixtures made calendar-safe this session (hardcoded-date flake fixed) |
| Persistent database (auto-save, restore-on-refresh, ordering, honest failure states, retry dedupe) | **PASS (LIVE)** | `giftz-persistence` live records: project detail restored after the turn (HTTP 200); reopen-after-reload + IDOR-404 pinned by suites and prior live checks |
| Task mode + sandbox execution (generate → files → run with explicit approval) | **PASS (implementation, live-run through the local executor)** | `POST /api/code-giftz/tasks` (mode generate) creates a completed task row with extracted files; `POST /api/code-giftz/run {approval:true}` executes the task's OWN files in the sandboxed runner and returns the process's verbatim exit code/output. Six completed tasks exist in the DB (three carry a generated `main.js`); the sandbox route enforces ownership + status + non-empty files (typed errors otherwise). Today's FRESH live task-create attempts were rejected by the account-wide chat-class throttle (typed 429, honest) — the last gateway-created task therefore predates this session |
| W6 self-verification | **PASS (local)** / live **throttle-gated** | See `W6-FINAL-ACCEPTANCE.md`; local eval re-run PASS this session (ground truth 4/4 executed, detection 8/8, verifier contract 8/8) |
| Security (ownership, approval gating, verifier-reasoning non-disclosure) | **PASS** | Owner checks on every task/project route (IDOR 404 pinned); sandbox run requires `approval: true`; the verification summary is public-sanitized (confidence/status only — internal reason stays server-side) |

## 2. Measured external dependency

The shared provider account throttles the chat class in intermittent windows (minutes-long; 2026-11-05 saw a sustained heavy phase with the escalating breaker riding its 600 s cap, streak 5). Behavior during throttle windows is by design and verified live: the SSE stream carries an honest error frame, the user's message is preserved for retry, the breaker prevents probe storms, and recovery is verified by a real call — never by a timer.

## 3. Sandbox execution contract (pinned)

1. `POST /api/code-giftz/tasks {mode:'generate', prompt, language}` → hosted LLM turn → fenced code blocks extracted to files → task row `completed` with `resultJson.files`.
2. `POST /api/code-giftz/run {taskId, approval:true}` → ownership + completed-status + files checks → `runInSandbox(files)` (process-isolated) → verbatim `{exitCode, stdout, stderr, timedOut}`.
3. No approval, no execution. No files, no execution (typed `VALIDATION_ERROR`). Not the owner → 404.

## 4. Test baseline (this report)

- `bun test`: **1,045 pass / 0 fail / 67 files** (sidebar, chat-stream lifecycle, workspace, streaming, W6 suites all green; this session fixed a calendar-fragile sidebar fixture — now date-proof).
- `eslint`: clean on changed files; `tsc --noEmit` baseline errors remain scripts-only.

## 5. Blockers

1. **Shared-account chat-class throttling** — gates fresh live task-creation and live W6/R3 runs; clears in provider windows; no workaround without violating the no-fabrication rules.
2. None product-side: all GIFTZ features are implemented, persisted and unit-pinned.

## 6. Deliverables & rollback

- Chat route (SSE lifecycle, task-mode branch, verification pipeline), tasks/run routes, sidebar + workspace UI, `src/lib/giftz/chat-stream.ts`, sandbox runner.
- Evidence: committed `scripts/golive-out/evidence.jsonl` (dca2220), DB job/message rows, live UI captures (`scripts/phase5-ui-out/`, `scripts/giftz-verify-out/preview-e2e/`).
- Rollback: revert this session's commit; no migrations; user data untouched.
