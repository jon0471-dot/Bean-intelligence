# BEAN — CODE GIFTZ ACCEPTANCE (FULL FUNCTIONAL TEST)

**Date:** 2026-11-07 · **User:** `fulltest-20261107021632@bean-e2e.test` · **Project:** `cmw5rvgo0003tr9vib0ajcnw6` · **Evidence:** `scripts/fulltest-out/evidence.jsonl` (`giftz-*`), artifact `giftz-file-debounce.js`, screenshots `ui-giftz-suite*.png`

| # | Item | Result | Classification |
|---|---|---|---|
| 1 | Real coding conversation | Streaming turn: "Write a JavaScript function debounce(fn, wait)…" → **311 SSE frames, 1,418 chars**, file tagged `path=debounce.js` | REAL |
| 2 | Code generation | Task `cmw5rvxpv004gr9vi1g7rep75` (mode `generate`): `isPalindrome.js` produced with executable example | REAL |
| 3 | Debugging | Task `cmw5rvn740044r9vizfq4ubid`: buggy `sumToN` (ignores negative n) → corrected `main.js` generated | REAL |
| 4 | Refactoring / explanation | Follow-up turn: one-sentence explanation of debounce ("Debounce delays the execution of a function until a specified amount of time has passed without it being called.") | REAL |
| 5 | Multi-file context | Same turn asked the model to list visible project files → it named `debounce.js`, the project's actual file — project context is reaching the model | REAL |
| 6 | Streaming | 311 frames on turn 1 (SSE deltas decoded server-side) | REAL |
| 7 | Sandbox execution | **Verified output, not just the model's response**: `POST /api/code-giftz/run {taskId, approval: true}` → `exitCode 0`, stdout exactly: `"level": true` / `"hello": false` / `"A man, a plan, a canal: Panama": true`; a second run executed the UI-suite's `greet.js` → `GIFTZ-SUITE-OK`, exit 0 in **51–56 ms** | DETERMINISTIC |
| 8 | File creation | Generated files persisted as owned CodeFile rows; full content retrievable via the project detail payload | DETERMINISTIC |
| 9 | File download | `debounce.js` content pulled from the project payload and written to `scripts/fulltest-out/giftz-file-debounce.js` (the UI builds its download blob from exactly this payload) | DETERMINISTIC |
| 10 | Conversation persistence | GET project: restored with 4 messages + 1 file; task detail (owner-checked) reloads with files intact | DETERMINISTIC |

## Notes

- Output verification went beyond HTTP 200: the sandbox `stdout` was parsed and checked against the expected values for all three palindrome cases, and the exit code was required to be 0.
- No chat-class call was retried inside a 429 window; the session's chat-class 429s (recorded under RIISHE) apply to this product equally — CODE GIFTZ calls all landed in open windows.

## In-product test workflow (Rule 8)

CODE GIFTZ workspace → "CODE GIFTZ test suite" card: code generation (REAL), sandbox execution with verified output (DETERMINISTIC), task/file persistence (DETERMINISTIC). In-browser run: **3/3 passed** (`ui-giftz-suite-final.png`).

## Verdict

**OPERATIONAL** — conversational coding, generation, debugging, explanation with multi-file context, streaming, sandbox execution with verified output, file retrieval and persistence all real.
