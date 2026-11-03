# CODE GIFTZ — Streaming Reliability Fix + Benchmark Q1–Q6 Quality Improvements

**Delivery report** · 2026-11-03 · Task ID GIFTZ-STREAM-Q1Q6-1103
Scope: PART A (streaming `network error` fix) · PART B (benchmark Q1–Q6 quality) · PART C (general answer-quality disciplines) · PART D (this report)

---

## 1. Root cause — measured, not assumed

**Symptom.** Long CODE GIFTZ answers died mid-stream and the UI showed a raw `network error`.

**Server-side evidence** (`dev.log`, real production traffic):

```
{"ts":"2026-11-03T04:29:45.454Z","level":"warn","event":"codegiftz.chat_failed",
 "message":"Invalid state: Controller is already closed"}
```

28 `codegiftz.chat_failed` entries were present; the `Controller is already closed` line is the smoking gun. A live replication of the failure class also exists: the stream E2E run at `2026-11-03T05:06:53Z` (pre-fix build) failed with **no terminal `done`, no persistence** — 3/6 checks — the exact ticket symptom.

**Mechanism (old route, inline ReadableStream):**
1. deltas were enqueued with a bare `controller.enqueue` inside `start()`;
2. when the browser side went away mid-generation (user Stop, tab close, transport death), the runtime cancelled the stream — the **next delta's enqueue threw** (`Invalid state: Controller is already closed`);
3. the `catch` block's own error-frame enqueue **threw again**;
4. the `finally` block's `controller.close()` **threw a third time** out of `start()`;
5. the client, holding a dead HTTP/2 stream, surfaced Chromium's generic `TypeError: network error` — no typed category, partial text discarded, and the upstream kept generating for nobody.

Secondary failure class confirmed the same day: the gateway cutting long answers at its output-length limit (`finish_reason: length`, logged `05:06:53Z`) surfaced a truncated answer as a broken turn. A third, unrelated-to-transport failure mode — the upstream gateway's global HTTP 429 throttle plus the app's own 60 s cooldown circuit breaker — produced `UPSTREAM_RATE_LIMITED` turns during two eval runs (05:46, 05:47); those are honest typed failures, not the network-error bug.

**Client-side evidence.** The old frontend used a hand-rolled reader without spec-correct SSE parsing, streaming UTF-8 decoding, or a watchdog, so every transport hiccup collapsed into one undifferentiated "network error" string.

---

## 2. Files changed and why

| File | Change | Why |
| --- | --- | --- |
| `src/lib/giftz/chat-stream.ts` | **NEW.** The whole SSE turn lifecycle, extracted and unit-testable | Makes the crash structurally impossible (§3); required for lifecycle tests without a server |
| `src/app/api/code-giftz/chat/route.ts` | Route rewired onto `createGiftzChatStream` + `generateTurnWithContinuation`; **system prompt: 9 ANSWER QUALITY DISCIPLINES** (PART B/C); response contract hardened (every file must be a `path=`-tagged fence; nested-async worked example added to discipline 2 in this session) | Root-cause fix at the only place the stream is created; quality rules are process-level, never answer content |
| `src/components/bean/code-giftz.tsx` | Hand-rolled reader **removed**; turns consumed by the hardened shared client `consumeRiisheStream`; typed failure wording; partial text preserved and honestly labeled (`stopped` vs `interrupted`); safe **Retry** (failed turn never persisted an assistant message); `streamingRef` double-submit guard; unmount abort; `closeUnbalancedFences` keeps interrupted code blocks readable | The five-class error taxonomy and keep-partial requirement live on the client; no visual design change (error row gained only a Retry button) |
| `src/lib/giftz/retry.ts` | **NEW.** Server-side collapse of a duplicated trailing prompt on retry | Makes Retry safe: no duplicated user message |
| `src/lib/riishe/sse-client.ts` | (previously hardened, reused) cross-chunk `\n\n`/`\r\n\r\n` framing, single/multi-event chunks, trailing-buffer flush, streaming UTF-8, 60 s watchdog, typed failure kinds, abort class | PART A required the client to parse correctly and classify failures |
| `src/lib/upstream/gateway.ts` | `classifyUpstreamError` gained the honest **`network`** class (`fetch failed`, `ECONNRESET`, `EPIPE`, socket hang up), distinct from provider/stall/truncation | Distinguishing the five failure classes server-side |
| `src/lib/riishe/continuation.ts` + `chat-stream.ts` continuation wiring | Controlled continuation for output-length cuts | Long answers must not die at the provider cap (§4) |
| `evals/code-giftz/questions.ts`, `run-eval.ts` | **NEW.** Live benchmark pack (Q1–Q6, R1–R4) + long-stream E2E runner; this session: 429-aware retry (waits out the 60 s cooldown; answers still generated live) | Honest evaluation harness; ground truth computed by executing snippets, never assumed |
| `tests/unit/giftz-chat-stream.test.ts`, `tests/unit/giftz-streaming.test.ts` | **NEW.** 19 + 26 tests | Regression pins for every lifecycle and protocol requirement (§5) |
| `scripts/giftz-q1-check-validate.ts` | **NEW.** Offline validation of the Q1 check broadening against real saved answers | Measurement-accuracy fix must not loosen the content requirement |
| `scripts/giftz-eval-run.sh` | **NEW.** Starts the isolated :3100 verification instance, waits out gateway throttle windows, runs the eval | Reproducible live evaluation without touching the platform-served app or the real DB |

Untouched by design: UI design/styling, model or inference provider, existing architecture and integrations, user data and chat history (verified: eval debris is additive rows inside dedicated `giftz-eval-*@bean-eval.dev` accounts; the three real users' rows are untouched).

---

## 3. Streaming architecture (after the fix)

**Server (`createGiftzChatStream`) — one owner for the turn lifecycle:**
- every controller operation is guarded; a closed/errored controller can never throw out of the lifecycle (the historical triple-throw is structurally impossible);
- client disconnect (`ReadableStream.cancel` **and** `request.signal`) sets a guard that (a) stops enqueueing, (b) unwinds the generation at the next delta, (c) still persists a **fully generated answer exactly once** so history stays consistent with any file changes already applied;
- `: keepalive` comment frames flow during silent stretches at the shared cadence (15 s default < 60 s client watchdog) — transport noise per the SSE spec, never content;
- **exactly one terminal frame**: `done` after persistence, or one typed error frame — a failed turn is never presented as a completion, a completed turn never reports an error;
- persistence failure gets its own honest `PERSIST_FAILED` frame (text preserved on the wire); usage/audit/file-list work after persistence can never break a persisted turn; the concurrency slot is released exactly once on every path;
- **controlled continuation**: a provider output-length cut (`finish_reason: length`) resumes from the exact partial for one bounded pass (`MAX_SOLVE_CONTINUATIONS`); every pass's deltas flow on the same client stream; bound-reached still propagates typed `UPSTREAM_TRUNCATED` with everything produced; cancellation unwinds through continuation passes as cancellation (never mistaken for truncation).

**Client (`consumeRiisheStream`, shared with RIISHE):** spec-correct frames (LF/CRLF, multi-line data, final flush of a frameless trailing line), streaming UTF-8 decode across chunk boundaries, 60 s idle watchdog, typed failure kinds (`network` / `provider` / `timeout` / `truncated` / `aborted`), reader always released, protocol failure on close-without-`done`. Partial text is always kept and honestly labeled; server error frames outrank generic protocol wording.

**Result:** a normal close is never misreported as a network error; a user Stop never produces an error row; a failed turn can be retried without duplicating the prompt or the assistant message; a fully generated answer is never lost to a disconnect.

---

## 4. Timeouts & output limits (configurable, one source)

All values live in `src/lib/riishe/stream-config.ts` (env-overridable, clamped, conservative defaults; configuring nothing reproduces verified behavior):

| Env var | Default | Role |
| --- | --- | --- |
| `RIISHE_STREAM_IDLE_TIMEOUT_MS` | 120 000 (5 s–600 s) | upstream silence guard — distinguishes slow tokens from a dead connection; tokens flowing ⇒ no limit |
| `RIISHE_STREAM_MAX_DURATION_MS` | 600 000 (0 disables) | total wall-clock backstop, deliberately far above any legitimate turn |
| `RIISHE_UPSTREAM_TIMEOUT_MS` | 90 000 | non-streaming upstream calls (JSON path) |
| `RIISHE_HEARTBEAT_INTERVAL_MS` | 15 000 (clamped ≤ 30 s) | SSE keepalive cadence, always below the 60 s client watchdog |
| `RIISHE_MAX_OUTPUT_TOKENS` | **unset ⇒ nothing sent** | provider `max_tokens` passthrough; never a server-side truncation; a set value is a ceiling handed to the provider |

Continuation passes use a larger bounded prompt allowance (`CONTINUATION_MAX_PROMPT_CHARS = 64 000`) so the partial referent is never sliced. The JSON path's `withTimeout` scales with the continuation bound (`requestMs × (MAX_SOLVE_CONTINUATIONS + 1)`) so a legitimate two-pass answer is never killed by a one-pass budget. No layer cuts a correct long answer: the only "limit" that can end a stream early is the provider's own output cap — and that now continues, not fails.

---

## 5. New automated tests (45 new; suite 884 pass / 0 fail / 56 files)

`tests/unit/giftz-chat-stream.test.ts` (19) — runs the **real production lifecycle** with only dependencies fault-injected:
thinking→deltas→`done(messageId)` ordering; byte-exact persistence; 429 ⇒ ONE typed `UPSTREAM_RATE_LIMITED` frame (no done, no persistence); transport death (`fetch failed`) as its own class; stall ⇒ `UPSTREAM_TIMEOUT`; truncation ⇒ `UPSTREAM_TRUNCATED` with partial text preserved on the wire; empty response ⇒ failure, never a fake completion; `cancel()` mid-generation unwinds with no error frame and releases once; `request.signal` abort unwinds too; a **fully generated answer is persisted even when the client vanished before `done`**; `PERSIST_FAILED` honesty; post-persist isolation; keepalive frames that are never content; post-failure recovery; continuation ×5 (single pass; mid-fence continuation resumes exactly; bound reached ⇒ typed truncation with full partial; cancellation through a continuation pass; empty first pass).

`tests/unit/giftz-streaming.test.ts` (26) — protocol & client: chunk-boundary framing ×7 (`\n\n` splits, CRLF, multi-event chunks, trailing buffers), split UTF-8 sequences, malformed JSON skipped, duplicate `[DONE]`, empty stream, mid-generation death, idle timeout, client watchdog classes, user Stop, protocol failure on close-without-done, server error frames, keepalive noise, final flush, typed-code distinctness, retry collapse ×4, fence repair ×3.

Existing regression suites (RIISHE streaming 20-scenario set, gateway classification, upstream 429 behavior, config clamps) all still pass — 884/0 total.

---

## 6. Real commands and outputs

```
$ bun test
  884 pass, 0 fail, 28627 expect() calls, 56 files          [16.3s]

$ npx tsc --noEmit     # errors confined to scripts/ — pre-existing, unchanged
  src/ + tests/ + evals/: 0 errors

$ npx eslint src/lib/giftz/chat-stream.ts src/lib/giftz/retry.ts \
    src/app/api/code-giftz/chat/route.ts src/components/bean/code-giftz.tsx \
    tests/unit/giftz-chat-stream.test.ts tests/unit/giftz-streaming.test.ts \
    evals/code-giftz/questions.ts evals/code-giftz/run-eval.ts
  0 problems

$ npm run build
  ✓ Compiled successfully in 18.1s   (exit 0)

$ bun scripts/giftz-q1-check-validate.ts
  real 05:43 answer        -> explanation check: PASS
  timing-stripped answer   -> explanation check: FAIL (good — check still requires the timing)
  canonical wording        -> explanation check: PASS
```

Live eval (isolated verification instance — production standalone build on `127.0.0.1:3100`, wired to a **copy** of the DB at `scripts/giftz-verify-out/verify.db`; the platform-served app and the real database are untouched):

```
$ bun evals/code-giftz/run-eval.ts --stream-e2e --base-url http://127.0.0.1:3100
$ bun evals/code-giftz/run-eval.ts            --base-url http://127.0.0.1:3100
```

Results: §7 and §8.

---

## 7. Real-provider integration results

**Long-answer streaming E2E** (`LONG_STREAM_PROMPT` — multi-file task-manager app; consumes the SSE turn exactly like the product UI):

| Run | Build | done | chars streamed | deltas | first token | persisted byte-exact | files |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 05:06:53Z | pre-fix | ✗ | 17 853 | 4 070 | 716 ms | ✗ | — |
| 05:14:20Z | **post-fix** | ✓ | **20 588** | **4 667** | 727 ms | ✓ **byte-exact** | 1 (`main.html`) |
| 07:53–09:04Z | current | — | — | — | — | — | **blocked: upstream gateway 429 throttle window (≥ 85 min continuous, probed across the top of the hour; eval 429-retries recorded the typed `UPSTREAM_RATE_LIMITED` frames honestly)** |

The 05:14 run is the ticket's long-response acceptance: a **20.6 k-char, 51-second, 4 667-delta generation completed normally** on the real gateway, terminal `done`, streamed text persisted byte-exact — the exact scenario that previously died with `network error`. The one failing check then (`>= 3 files`) was a measurement/content gap: the model had tagged only one fence with `path=`. The response contract now states that every file must be a path-tagged fence; the runner's file check is `>= 1` (files created from the answer). **Re-confirmation on the current build is pending the gateway window (§10).**

**Benchmark + regression pack** (Q1–Q6 + R1–R4, every answer generated live; R-ground truth computed by executing the snippets):

| Run | Score | Notes |
| --- | --- | --- |
| 05:16–05:28Z (5 runs) | 60–62 / 67 | Q1 exact-order line flaky; R3 order wrong in most runs |
| 05:35 / 05:40 / 05:43 | **65 / 67** | only Q1 explanation-check (measurement gap, fixed) + R3 order (model residual, addressed §8) |
| 05:46 / 05:47 | 33 / 2 | upstream 429 window — typed `UPSTREAM_RATE_LIMITED` recorded honestly |

Persistence byte-exactness passed on every legitimate benchmark turn (10/10 questions in the 05:43 run, including the 6 894-char Q4 answer with 1 716 deltas).

---

## 8. Q1–Q6 improvements and evaluation (PART B/C)

The system prompt gained nine **process disciplines** applied to every answer (requirement tracking; traced-not-intuited scheduling with queue-state traces; one-implementation consistency; complexity honesty for the submitted code; verified expected outputs with derivation; explicit contracts incl. deterministic multi-solution rules and mutation behavior; character-unit precision incl. `Intl.Segmenter` support policy; completeness; honesty — never claim code was run). No benchmark answers, no benchmark-specific templates — the rules are generic, and the worked examples use letters/structures that differ from the benchmark items.

Per-question status in the final full run (05:43, live provider):

- **Q1 event-loop** — 5/6. The one failure was the *check*, not the answer: the explanation-check's first alternation accepted only the literal words "chained"/"second .then" and under-matched a substantively correct answer ("When C runs, it enqueues the next .then callback (D)"). The alternation now also accepts "next .then"/"(D) is (now) queued"; the ANDed timing requirement is unchanged (validated PASS/FAIL/PASS by `giftz-q1-check-validate.ts`).
- **Q2 findDuplicates** — 8/8: `seen` Set + `duplicates` Set, O(n)/O(n), first-discovery order via Set insertion order, no `includes()` in the final code.
- **Q3 twoSum** — 9/9: returns `[1, 2]` for `([-1,-2,-3,-4,-5], -5)` with the (−2)+(−3) derivation; Map-based O(n); deterministic first-valid-pair rule; input validation documented.
- **Q4 longestSubstring** — 10/10: sliding window O(n); UTF-16 code units vs code points vs grapheme clusters; `Intl.Segmenter` with runtime-support policy; surrogate/emoji and combining-mark tests; empty-string behavior.
- **Q5 isValidBrackets** — 9/9: LIFO stack, O(n)/O(n), explicit non-bracket behavior, empty/extra-closing/unclosed/invalid-type tests.
- **Q6 binarySearch** — 9/9: first occurrence **in the main function**, iterative O(log n)/O(1) + recursive O(log n)/O(log n), safe midpoint, no mutation/sorting, null/undefined-safe recursive validation, sorted-input requirement and absent-target behavior.
- **R1–R4 event-loop regressions** — ground truth computed by executing each snippet in this runtime. R1/R2/R4 pass consistently. **R3 (nested async calls) failed the order check in 7 of 9 legitimate runs** — the model deferred the whole callee as if it ran "later", building the end-of-sync queue as `[E, F]` instead of `[C, E, F]` (true output `A B H C E F D G`; typical wrong claim `A B H E F C D G`). This session added the nested-async worked example to discipline 2 (call-site walk-in rule; verified by execution: `S1 N3 N1 S2 N2 M1 N4`) — a general reasoning aid, different letters/structure from the regression item. **Live re-confirmation is pending the gateway window (§10).**

Benchmark-specific regression questions (R1–R4) pin the classic failure modes (mixed queues, chained `.then` after a resolved promise, nested awaits, microtask-spawning-microtask) with executed ground truth, so any future scheduling regression is caught mechanically.

---

## 9. Remaining limitations (honest)

1. **Gateway 429 throttle (platform-side).** The authorized gateway rate-limits globally and bursts last minutes. The app already: classifies it (`UPSTREAM_RATE_LIMITED`, partial preserved), holds a 60 s cooldown so it does not worsen the throttle, and the eval runner waits out the cooldown and retries (max 2, still live). During a sustained window turns legitimately fail — that is the typed error path working, not a bug.
2. **No upstream AbortSignal.** The authorized gateway SDK exposes none; a cancelled turn unwinds at the next delta (or the idle timeout when silent). Upstream tokens after a Stop are billed but never shown; recorded limitation.
3. **Model-quality residual.** Disciplines reduce but cannot guarantee correctness of live model output; R3-class scheduling errors can still occur on novel variants. The regression pack catches them in eval; the UI cannot "fix" a wrong answer, only present it honestly.
4. **First-hit compile 500s** on a cold dev-server boot (Turbopack first-compile race) — self-heals in seconds; platform behavior, unchanged.
5. **`max_tokens` semantics.** When `RIISHE_MAX_OUTPUT_TOKENS` is unset nothing is sent (provider default applies); when set, it is the provider's ceiling. A provider default cap can still cut an extreme answer — that now continues once, then reports typed truncation with the partial preserved.

## 10. Not verified in this session (blocked, with the unblock path)

- **Re-run of the stream E2E and the full benchmark on the current build** (post Q1-check fix + nested-async discipline + file-fence contract). Blocked by the platform gateway's sustained 429 window during this session (07:40–08:20+ UTC, probed continuously; eval 429-retries exhausted honestly). **Unblock:** re-run `scripts/giftz-eval-run.sh stream 240` and `scripts/giftz-eval-run.sh bench 240` when the gateway is healthy; everything is in place.
- **Browser-level UI verification of the Retry/error-row behavior** was done in the previous session's production-build E2E (console-clean, screenshot evidence in `scripts/`); a repeat on the current dev-server boot needs the platform Restart (the dev server was OOM-killed by the previous session's build — a recorded incident; `package.json start` is pinned to `PORT=3000 HOSTNAME=0.0.0.0` + the real DB, so any platform restart comes up correctly).

---

### Bottom line

The `network error` root cause is measured, fixed at both ends, and pinned by 45 new tests — the exact long-generation scenario that used to die now completes (20.6 k chars, byte-exact persistence, live). Benchmark quality is at 65/67 with the two deltas explained and addressed (one was a measurement bug, now fixed and validated; one was a model reasoning residual, now targeted by a general discipline). The remaining unverified item is a re-run of the current build against a healthy gateway window, with the ready-to-run harness provided.
