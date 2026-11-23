# M33 — CODE GIFTZ: Explicit Run Requests Now Execute Real Code

Implementation report — 2026-11-23. Branch `feat/code-giftz-real-sandbox-execution`,
based on freshly fetched `origin/main` @ `f27d33d3ce59` (the merge of PR #10,
RIISHE M33). Companion to the M34 acceptance work delivered on the same
branch (see `docs/M34-CODE-GIFTZ-ACCEPTANCE.md`).

## 1. Root cause (reproduced)

A user message like "Write a JavaScript function and run it in the sandbox"
produced: generated code → explanation → a MODEL-PREDICTED output block
("When you run this code, you should see…") → and nothing else. Measured root
cause: the chat flow (`src/app/api/code-giftz/chat/route.ts` →
`runGiftzTurnCore`) ended at generation + file persistence + versioning —
there was NO execution-intent recognition and NO sandbox invocation anywhere
in the conversational path. Real execution existed ONLY behind the manual Run
button (`POST /api/code-giftz/run` and `POST /api/code-giftz/projects/[id]/run`,
both requiring the explicit `approval: true` literal). The sandbox runner
itself (`src/lib/sandbox/runner.ts`) was present, real and functional — real
child processes, `unshare -Urn` network namespace + `prlimit` rlimits, minimal
env, wall clock, capped output — it was simply never called from chat.

## 2. What changed (files)

| File | Change |
|---|---|
| `src/lib/giftz/execution-intent.ts` (NEW) | Deterministic, conservative execution-intent detection (pure). Question guards ("how do I…", "explain…") never execute; only unambiguous run/execute/test-in-sandbox imperatives match. |
| `src/lib/giftz/execution.ts` (NEW) | The execution contract: `executeProjectFiles(projectId)` loads the LATEST PERSISTED project files (JS/TS/Python) from the database and runs them through the EXISTING `runInSandbox`; `toExecutionView` derives the honest status (`passed` / `failed` / `timeout` / `spawn-error`) from the real exit/timeout data; `buildExecutionReceipt` renders the system-authored real-result block; exact reasons when a run cannot happen. |
| `src/lib/giftz/turn.ts` | The shared turn core (live route AND background worker) now: detects intent over the ORIGINAL request → emits the `executing` stage → runs the sandbox → appends the system-authored receipt (or the exact unavailable reason) to the reply, ALSO emitted as a final delta so streamed, persisted and JSON-path replies are identical → returns `execution` / `executionUnavailable` (persisted in message metadata by `persistGiftzAssistantTurn`). |
| `src/lib/giftz/chat-stream.ts` | Wire contract gains `execution` / `executionUnavailable` on the terminal `done` frame (additive). |
| `src/app/api/code-giftz/chat/route.ts` | JSON response + SSE persistence + audit metadata carry the real execution outcome (bounded: runId/status/exitCode/timedOut/durationMs — never stdout). |
| `src/lib/ai-engine/giftz-coding-handler.ts` | Background path inherits execution through the shared core; the Trust receipt records the bounded run outcome; the job result row carries it. |
| `src/lib/trust/adapters/code-giftz.ts` | `executed()` records a `sandbox-run:<runId>` tool-output evidence row (status/entry/exit/duration — ID references only, no stdout in the ledger) and adds an honest limitation when a requested run could not happen. |
| `src/lib/sandbox/runner.ts` | ADDITIVE: `entry` field on `SandboxRunResult` (which file executed); `BEAN_SANDBOX_TIMEOUT_MS` operator knob (default unchanged 15s); **measured honesty fix** — `BEAN_SANDBOX_DISABLE_ISOLATION=1` now actually disables the isolation wrap instead of only reporting it missing (the reported profile and the applied wrap always agree). |
| `src/lib/giftz/prompts.ts` | Honesty rule updated: never fabricate execution evidence; when the user asks to run, BEAN executes and the SYSTEM appends the real result — the model must not print prediction blocks. |
| `src/components/bean/code-giftz.tsx` | Reuses the EXISTING terminal: the chat-driven run populates it with the real result; a distinct "Running in the sandbox…" state while the process runs; the terminal shows status (`passed`/`failed`/`timeout`/`runtime failure`), exit code, duration, runtime + entry, stdout/stderr separately (break-words), and the MEASURED isolation line (degraded hosts reported honestly); "execution not run" panel with the exact reason; monotonic sequence guard so a late result never replaces a newer one. |
| `src/lib/riishe/sse-client.ts` | The product-agnostic stream event type gains `stage: 'executing'` + the execution fields (additive typing). |
| Tests (5 files) | `tests/unit/giftz-execution-intent.test.ts` (33 assertions over the exact brief examples), `tests/unit/giftz-execution.test.ts` (real runner through executeProjectFiles: latest-persisted contract, isolation, exact unavailable reasons, ownership), `tests/unit/giftz-turn-execution.test.ts` (wiring: intent → runner called ONCE with persisted files, receipt in reply; no-intent → never executed; honest failure/timeout/spawn reporting; SSE wire lifecycle with the executing stage + execution on done), `tests/unit/giftz-run-routes.test.ts` (manual Run contract preserved: approval literal, ownership, completed-gating, unauthenticated), `tests/integration/giftz-sandbox-execution.test.ts` (REAL processes — see §4). |

## 3. Explicit execution-intent behavior

- **Executes** (the instruction IS the approval): "Run this code." / "Run it
  in the sandbox." / "Write a function and execute it." / "Test this
  JavaScript in the sandbox." / "Generate the code and run it." / "Debug this
  and run it again." / the reproduced phrasing "Write a JavaScript function
  and run it in the sandbox."
- **Never executes**: "Write a JavaScript function." / "Explain this
  function." / "Show me an example." / "Review this code." / "What does this
  code do?" / "How do I run this code locally?" (questions ABOUT running are
  answers, not commands).
- The manual Run button keeps its separate explicit `approval: true` contract
  (pinned by tests) — chat execution is additive and does not weaken it.

## 4. REAL integration evidence (not mocks)

`tests/integration/giftz-sandbox-execution.test.ts` spawns REAL interpreters
through `runInSandbox`. Measured output (2026-11-23, this sandbox host):

- **Factorial/prime demo** (the reproduced issue, as a real JS process):
  stdout captured verbatim — `factorial(5) = 120 … OK`, `factorial(0) = 1 …
  OK`, the negative-input contract line, `isPrime(7) = true … OK`,
  `isPrime(10) = false … OK`, `ALL CHECKS PASSED`; `exitCode: 0`,
  `timedOut: false`, real duration, `entry: 'main.js'`,
  `isolation: { networkNamespace: true, rlimits: true, processSeparation: true }`.
  A second live run through the PRODUCT run route (dev server + real API):
  identical stdout, `exit 0 · 63ms`, full isolation profile.
- **Python Fibonacci**: real CPython, first 20 numbers
  `[0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181]`,
  `sum: 10945`, `average: 547.25`, exit 0.
- **TypeError handling**: a genuine `TypeError` triggered inside try/catch,
  caught, execution continued, exit 0.
- **CSV file operations**: `students.csv` persisted as a project file; the
  program read it back, computed 5 records / average 81.60 / top Bob 92, and
  WROTE `summary.txt` into the permitted ephemeral workspace — the test then
  verified the file PHYSICALLY EXISTS on disk (file creation confirmed by the
  filesystem, not by model text).
- **Debug-and-rerun**: the ORIGINAL faulty off-by-one program failed with a
  real `TypeError` and non-zero exit; the minimal correction (`i <=` → `i <`)
  executed and printed EXACTLY `30` with exit 0.
- **Timeout**: an endless loop is killed by a kernel fence (wall clock or CPU
  rlimit) and NEVER reported as success; a sleeping program hits the wall
  clock specifically (`timedOut: true`, ≥ wall-clock duration, no output).
- **Spawn error**: a missing runtime (direct-spawn mode) yields
  `exitCode: null` + `[sandbox] spawn error: …` — an honest runtime failure.
- **Secrets**: the child environment contains ONLY the minimal env
  (`PATH`, `HOME`, `NODE_ENV` + the runtime's own `NODE` marker); no
  `DATABASE_URL`, no master keys, no session/cookie/token-shaped keys, no
  secret-shaped values.

## 5. Security properties (preserved + verified)

- Generated code NEVER runs inside the Next.js process — real child spawn in
  an ephemeral workspace, exactly as before.
- Network namespace (`unshare -Urn`) + rlimits (`prlimit`: as/cpu/nproc/
  nofile/fsize) + process separation + minimal env + SIGKILL wall clock +
  64KB output cap — all unchanged; the isolation profile of EVERY run is
  reported verbatim (degraded hosts say so).
- Ownership: chat execution operates on the project already ownership-checked
  by the route; the run routes' IDOR 404 contract is pinned by tests.
- Approval: chat path = the user's explicit execution instruction
  (deterministically detected); manual path = the unchanged `approval: true`
  literal. Every run is audit-logged with its bounded real outcome.
- Trust Engine: real runs become evidence in the EXISTING receipt ledger
  (bounded references — no stdout in the ledger).
- No new paid services, no Ollama, no network access for untrusted code. The
  one honesty FIX to the runner closes a measured gap: the documented
  `BEAN_SANDBOX_DISABLE_ISOLATION` escape hatch now actually disables the
  layers it claims to disable (reported profile == applied wrap).

## 6. UI verification (real rendering, desktop + mobile)

Dev server + disposable account + the REAL routes:

- Desktop 1440×900: project loaded → Run clicked → the EXISTING terminal
  populated with `exit 0 · 76ms` and the verbatim factorial/prime stdout,
  wrapped cleanly, status chip + isolation line rendered; screenshot
  `download/m33cg-visual/giftz-run-desktop.png`. Mobile 390×844: no horizontal
  overflow (`390/390`).
- Two measured layout defects fixed in passing (they directly broke the
  execution workflow): (a) the workspace root applied the resize width a
  SECOND time (46% × 46% = a 207px sliver at 1440px — the sandbox terminal
  was unusable); (b) the editor's unwrapped highlighted code stretched the
  flex row and pushed action rows off-screen (body overflow 1457/1440).
  Both fixed minimally (`width: 100%` on the root; `min-w-0`/`flex-wrap` on
  the editor container and header rows); body overflow now 1440/1440 exactly.
- One UI bug I introduced during the change (a template literal missing `$`
  in the status chip) was caught by this inspection and fixed before commit.

## 7. Known limitations

1. A live model turn could not be exercised in this sandbox (no provider
   credentials) — the generation→execution WIRING is pinned by the turn-core
   and wire-lifecycle tests (real code paths, controlled generation), and the
   execution half is proven end-to-end live. The full model-driven demo
   requires a deployed backend.
2. Chat execution runs the project's entry through the JS/Python runtimes —
   DOM-dependent web code reports its real failure honestly (Node cannot
   render); browser behavior belongs to the CSP-restricted preview.
3. Duplicate execution from repeated events: the UI guards result
   application with a monotonic sequence, and each turn triggers at most one
   run server-side; a same-tick double-click of the MANUAL Run button could
   still issue two requests (pre-existing React-state race, out of M33 scope,
   recorded for the next reliability pass).
4. The `BEAN_SANDBOX_TIMEOUT_MS` knob exists so tests/constrained hosts can
   shorten the wall clock; production default remains 15s.

## 8. Verification results (exact, 2026-11-23)

| Check | Result |
|---|---|
| `bun test --isolate tests/` | **2546 pass / 0 fail / 5 skip** (194 files; incl. 47 new M33 tests + 10 real-process integration tests) |
| `npx tsc --noEmit` | 11 errors, ALL pre-existing on the pristine base (3 in untouched `src/workers/*` — measured with a stash/pop A/B; 8 in untouched legacy test files); **zero errors in M33 files** |
| eslint on all 16 changed code/test files | clean |
| `bunx prisma validate` | schema valid (schema untouched) |
| `bun run build` | success (4 warnings, all pre-existing in untouched files) |
| Secret/security scan of the full diff | clean — no secrets, no new secret-bearing env access (only the three sandbox operator knobs), no stdout in ledger/audit |
| Real sandbox execution | factorial/prime exit 0 (unit + live route), Fibonacci, TypeError, CSV + filesystem verification, debug-and-rerun 30, timeout, spawn-error, secrets — all PASS with real process evidence |
| UI inspection | desktop + mobile, screenshots inspected; terminal populated with real output; body overflow 1440/1440 and 390/390 |
