# M34 — CODE GIFTZ Seven-Test Acceptance Table (real evidence)

Delivered on the same branch as the M33 execution foundation
(`feat/code-giftz-real-sandbox-execution`, base `f27d33d`). Every PASS below
carries evidence from an ACTUAL execution (real process stdout / real browser
interaction) — never a generated prediction. Where something is BLOCKED or
NOT RUN, the exact reason is stated.

## Acceptance table

| # | Test | Verdict | Evidence |
|---|---|---|---|
| 1 | **JavaScript factorial + prime checker, executed** | **PASS** | Automated REAL-sandbox integration test (`tests/integration/giftz-sandbox-execution.test.ts`): real JS process stdout verbatim — `factorial(5) = 120 … OK`, `factorial(0) = 1 … OK`, `factorial(-3) = undefined for negative inputs … OK`, `isPrime(7) = true … OK`, `isPrime(10) = false … OK`, `ALL CHECKS PASSED`; `exitCode: 0`, real duration, full isolation profile. PLUS a live run through the product run route (dev server): identical stdout, `exit 0 · 63ms`, terminal rendered in the UI (screenshot `download/m33cg-visual/giftz-run-desktop.png`). |
| 2 | **Python Fibonacci, executed** | **PASS** | REAL CPython execution: stdout `first 20: [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181]`, `sum: 10945`, `average: 547.25`, `ALL PYTHON CHECKS PASSED`, exit 0. The `.py` → Python dispatch is pinned by `isPythonEntry` and exercised by the same runner. |
| 3 | **TypeError handling, executed** | **PASS** | REAL JS process: the TypeError genuinely triggered (`notAnObject.property = 1` on null), caught (`step 2: caught TypeError: …`), execution continued (`step 3: execution continued…`), `TYPEERROR-DEMO-OK`, exit 0. |
| 4 | **CSV file operations, executed** | **PASS** | `students.csv` persisted as a project file; the program read it back in the sandbox: `records: 5`, `average: 81.60`, `top: Bob 92`, `CSV-DEMO-OK`, exit 0; the program WROTE `summary.txt` into the permitted ephemeral workspace and the test verified the file PHYSICALLY EXISTS on disk with the computed contents (file creation proven by the filesystem, not by model text). |
| 5 | **Responsive calculator, browser-verified** | **PASS (browser interactions verified via the live preview document)** | The malformed-attributes defect is fixed (all attributes properly quoted); files persisted through the product (`index.html`, `calculator.js`, `style.css`). REAL browser verification in the preview document: addition 2+3=5 · subtraction 10−4=6 · multiplication 7×6=42 · division 20÷5=4 · division-by-zero → `Cannot divide by 0` · decimal input (1.5+2.5=4) · Delete (123→12) · Clear (→0) · keyboard (7*6+Enter→42, digits/dot/Escape) · post-error state resets (fresh operand after `Cannot divide by 0`) · responsive layout (no overflow at 375/375; screenshots `calculator-verification.png`, `calculator-mobile.png`). One calculator logic defect was found and fixed during verification (after an operator key the next digit appended to the old operand → `2+3` gave 25; now starts a new operand). Note: the verification ran against the preview DOCUMENT opened directly (the iframe's `sandbox` attribute without allow-same-origin blocks parent-JS access by design — real isolation, preserved). |
| 6 | **React task manager** | **PARTIAL PASS — logic executed for real; toolchain build BLOCKED (reported, not faked)** | Project created through the product with `taskLogic.js` (pure logic) + `main.test.js` (harness) + `App.jsx` (React component: add/edit/delete/complete/filter/empty-state/validation) + `package.json`. REAL sandbox execution of the logic: `TASK-MANAGER-LOGIC-OK (7/7 behaviors verified)` — add/priority, complete-toggle, filters (active/completed/all), edit, delete, too-short refusal, invalid-priority refusal — exit 0, 133ms. `npm run build` / `react-scripts build` is **BLOCKED inside the sandbox**: the build route reports verbatim — "package-manager lifecycle scripts are not executable inside it (no network, no node_modules)" — the namespace has no network by design and no React runtime is vendored. React BROWSER rendering: NOT RUN (same reason). These limits are stated, not papered over. |
| 7 | **JavaScript debugging (off-by-one), executed** | **PASS** | The ORIGINAL faulty program executed for real: `exitCode ≠ 0`, real `stderr: TypeError … price` (the off-by-one read of `items[2]`), stdout contains no `30`. The minimal correction (`i <=` → `i <`) executed: stdout EXACTLY `30`, exit 0, no stderr. Diagnose → modify → execute → verify, demonstrated end-to-end. |

## Why the seven tests previously failed / were not completed

Measured root cause (M33 report §1): the conversational flow never executed
anything — no execution-intent recognition and no sandbox invocation in the
chat path, so "run this" requests ended at generated code plus a
model-predicted output block. Tests 1–4 and 7 require exactly that missing
capability (generate → persist → execute → read real output), which M33 now
implements. Test 5 requires browser verification (done via the preview) and
Test 6 hits the sandbox's fundamental no-network design (reported honestly).

## M34 engineering-capability mapping (existing vs. new)

| Capability (M34 §5) | State |
|---|---|
| Project-aware file inspection | Already existed (`buildProjectContext` — budgeted, honest truncation) |
| Multi-file generation/editing | Already existed (`parseFiles`/`applyFiles` + real diffs) |
| Targeted patch application | Already existed (targeted-edit brief + M25 refactoring flows with approval) |
| Real terminal/sandbox execution | **NEW in chat** (M33) — was manual-Run only |
| Execution error analysis | Real stderr/exit surfaced verbatim; iterative debugging = follow-up turns with conversation context + execution intent ("debug this and run it again" executes again) |
| Test execution + result reporting | Real process results; the model is prompted to never fabricate them |
| Project build verification | Existed (build route) with the honest no-network note — verified live in Test 6 |
| File-change summaries | Already existed (added/modified + diffs, never fabricated) |
| Git-diff visibility | Already existed (workspace diff view) |
| Conversation context | Already existed (history window + project context) |
| Approval before destructive ops | Already existed (M23 file-ops confirmation + M25 refactor approval); M33 adds deterministic execution-intent as the chat-path approval, manual Run unchanged |
| Structured task plan + progress states | Additive stage frames (`thinking`/`verifying`/`executing`) + distinct UI states (Generated / Files saved / Running / Passed / Failed / Timed out / Preview available / Execution unavailable) |

Multi-iteration execution INSIDE a single turn (auto rerun-on-failure loops)
is NOT implemented — the honest iteration model is multi-turn: the user sees
the real failure and can say "debug and run again", which executes the
corrected project through the same guarded path. Recorded as the next
reliability step, not claimed here.

## Security verification (M34 §6)

All existing controls preserved and re-verified by tests: network namespace +
rlimits + process separation + minimal env (secrets test proves the child env
holds only PATH/HOME/NODE_ENV/NODE + the runtime's own npm_* markers),
timeouts, output caps, ownership (IDOR 404s), the manual-Run approval
literal, audit + Trust receipts for every real run, no Ollama, no paid
services, no weakened isolation (the one runner change CLOSES an honesty gap:
the disable-isolation flag now truly disables the layers it reports as
disabled).
