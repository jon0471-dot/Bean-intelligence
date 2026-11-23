# M35 — Shared job concurrency diagnostic ("maximum number of concurrent jobs")

Diagnostic + root-cause-fix report — 2026-11-23. Branch
`fix/shared-job-concurrency-slot-leak`, based on the freshly fetched
`origin/main` (`f27d33d…`, the M33 merge). The reported error is

> "You already have the maximum number of concurrent jobs for this product. Wait for one to finish."

That exact string exists at exactly ONE runtime location: the router's
per-user in-flight counter, `src/lib/router/router.ts` line 95 (`acquireSlot`,
`CONCURRENCY_LIMIT`). No database record participates in this specific gate —
the counter is the module-level `inFlight` map inside the router process.
This milestone changes NOTHING about product limits, isolation, fairness,
cancellation, timeout handling, Trust receipts, APIs or UI: it fixes the one
path that leaked slots from that counter and proves it with tests and a live
run.

## 1. Investigation results (all ten requested areas)

| # | Area asked | Finding |
|---|---|---|
| 1 | Shared job queue + concurrency manager | Two separate mechanisms. (a) The router's in-memory `inFlight` map (per-backend `perUser` + `total` counters, `acquireSlot`/`releaseSlot`) gates INTERACTIVE requests. (b) A durable DB queue (`generationJob`, `src/lib/ai-engine/queue.ts`) with per-user ACTIVE-state caps (`engineConfig().perUserActiveLimit`, default 3), duplicate-submission guard (`dedupeKey`) and lease-based recovery gates BACKGROUND jobs. The reported message comes only from (a). |
| 2 | RIISHE job creation/completion lifecycle | Interactive: `preflight()` acquires 1 slot → the streamed turn runs → the stream's own `finally` must release. The release was structurally broken (root cause below). |
| 3 | Product job registrations | Every product's routes audited. CODE GIFTZ chat: correct (`createGiftzChatStream` releases exactly once in `src/lib/giftz/chat-stream.ts`, plus route `catch` release). JAZMII generate/chat, GANGZII lyrics/analyze/live/convert/transcribe/tts/produce, LAXII generate/edit/enhance/chat: all plain `try/finally { release() }` or immediate release (queue holds the slot). Only `src/app/api/riishe/chat/route.ts` had the broken handoff. |
| 4 | Stale RUNNING/PENDING/QUEUED jobs | DB-side is healthy: `recoverStaleJobs()` re-queues lease-expired active jobs (M26 F-4 re-verifies the lease INSIDE the write) or settles them failed when the retry budget is exhausted; cancel-flagged queued jobs are settled cancelled. Background caps therefore do not leak across worker crashes. |
| 5 | Timeout/cancellation/failure/cleanup paths | All covered by the route-level `finally`s — EXCEPT the leaked SSE path, where the cleanup ran but was neutralized (below). Router timeouts (`requestMs`) remain active; nothing changed. |
| 6 | Completed/failed jobs release slots? | JSON path: yes (already correct, now regression-pinned). SSE path: NO on the pre-fix code — every streamed turn leaked one slot. |
| 7 | Streaming disconnects | Contained by design (`createSseWriter` swallows enqueue failures; the turn finishes server-side and persists). With the leak, a disconnect ALSO permanently consumed its slot; with the fix the slot returns when the turn settles. Regression-tested with a real `reader.cancel()`. |
| 8 | Duplicate requests | Interactive duplicates each hold a slot while running (correct — bounded by the cap). Background duplicates are refused 409 via `hasActiveDuplicate`. The `isDanglingDuplicateUserRow` collapse keeps retry history honest. No change needed. |
| 9 | Cross-product / cross-user sharing | Correct and now test-pinned: counters key on BACKEND id — RIISHE chat = `bean-llm-hosted-primary` (per-user 2 / total 16), CODE GIFTZ = `bean-code-llm-hosted-primary` (1/4), so one product cannot block another; the `perUser` map isolates users. |
| 10 | DB ↔ in-memory consistency | The in-memory counter is per-process by design (documented limitation, unchanged here). DB job rows and the in-memory counter are independent by architecture; the leak was purely in-memory. |

## 2. The exact occupant of the capacity

For interactive chat there is no DB "job" — the occupant is a leaked
in-flight slot in the router's `perUser` map for backend
`bean-llm-hosted-primary`. Classification per the mandate:

- genuinely running: **no** (the turn had long finished);
- stuck: **no** (nothing was in flight);
- abandoned after a client disconnect: this class existed historically but
  was NOT the live defect;
- incorrectly marked running: **yes — this one.** The slot counter stayed
  incremented after every streamed turn even though the turn completed;
- completed but not released: **yes — same defect**, the release call was a
  no-op;
- duplicated: **no** (one acquire per request; release-once guard intact).

## 3. Live historical evidence (committed artifacts)

`scripts/e2e-riishe-upgrade-out/dig-*.sse` — section 8 of
`scripts/e2e-riishe-upgrade.sh`, a 26-turn SEQUENTIAL streamed conversation
for ONE user (dated Nov 12, i.e. the pre-M26 code):

- `dig-1.sse` … `dig-13.sse`: streamed successfully (real model answers);
- `dig-14.sse`: `{"ok":false,"error":{"code":"INTERNAL_ERROR",…}}` — a turn
  threw mid-request, and the pre-M26 code had unguarded awaits between slot
  acquisition and the execution paths' try/finally: the slot leaked;
- `dig-15.sse` … `dig-26.sse`: ALL TWELVE are the exact reported error
  (`CONCURRENCY_LIMIT`, "You already have the maximum number of concurrent
  jobs for this product.") — the user was locked out for the rest of the run.

M26 (commit `254fde6`, 2026-11-16) fixed those unguarded awaits with the
`releaseOnce` guard — but its SSE ownership handoff introduced the regression
fixed here.

## 4. Root cause (verified in code + deterministic reproduction)

In `src/app/api/riishe/chat/route.ts`, the M26 G-4 handoff did this right
before returning the streamed `Response`:

```ts
slotReleased = true            // intent: stop the OUTER finally from releasing now
return new Response(stream, …)
} finally {
  releaseOnce()                // outer finally
}
```

`slotReleased` is the SHARED idempotence flag of `releaseOnce()` — it means
"release() actually ran". Setting it eagerly at response-return time poisoned
the guard for the STREAM's own cleanup: the stream lifecycle's `finally`
(line 566-568) calls `releaseOnce()`, which saw the flag already `true` and
silently returned WITHOUT calling `release()`. Because `start()` is invoked
at ReadableStream construction and always suspends on its first `await`
(`trust.begin()`), the poisoning assignment ALWAYS executed before the
stream's cleanup. Net effect, deterministic:

- **every streamed (`?stream=1`) RIISHE turn acquired one slot and never
  returned it** — completed turns, failed turns, timeout-classified turns and
  cancelled streams all leaked;
- `bean-llm-hosted-primary` allows `maxInFlightPerUser: 2`, so the SECOND
  streamed turn locked the account out with the reported CONCURRENCY_LIMIT
  until process restart (the counter is in-memory);
- the non-streaming JSON path released correctly (its `finally` runs before
  the poisoning assignment), which is why non-streaming usage never locked
  anyone out and the bug hid.

Reproduction (pre-fix, committed in this milestone's history as the RED run):
`bun test --isolate tests/unit/riishe-chat-slot-release.test.ts` →
**3 pass / 5 fail**, with the five SSE-release tests failing exactly as
predicted (`Expected: 200 / Received: 429`) while the JSON and
product-isolation guards passed.

## 5. The fix (minimal, single file)

`src/app/api/riishe/chat/route.ts` only — 24 insertions / 5 deletions, all
in the slot-ownership block:

1. New dedicated flag `let sseHandoff = false`.
2. The SSE return sets `sseHandoff = true` instead of `slotReleased = true`.
3. The outer `finally` releases via `if (!sseHandoff) releaseOnce()`.

`slotReleased` keeps its original meaning ("release() actually ran") and is
now set exclusively by `releaseOnce()`. Exactly-once release holds on every
interleaving: streamed response returned → the stream's `finally` releases;
any throw before that point → the outer `finally` releases; memory-command
short-circuit path → releases explicitly before its inline stream, unchanged.

Nothing else changed: no limit value, no registry entry, no router code, no
adapter, no UI, no API shape, no schema.

## 6. Regression tests (new: tests/unit/riishe-chat-slot-release.test.ts)

Real route handler + real router (`preflight`/`acquireSlot`/`releaseSlot`)
with the Prisma boundary faked; orchestrator controllable. 8 tests:

1. **completed** — three consecutive streamed turns all stream (cap 2 would
   block the 3rd if turn 1 leaked);
2. **failed** — two streamed turns whose backend call throws (error frame)
   still leave capacity for the next turn;
3. **timed out** — two timeout-classified streamed failures
   (`UPSTREAM_TIMEOUT` frames) still leave capacity;
4. **cancelled / disconnected** — a real `reader.cancel()` mid-stream frees
   the slot once the turn settles; two more turns stream;
5. **concurrent** — 5 concurrent streamed turns: at most 2 admitted (cap
   holds), the rest get 429 `CONCURRENCY_LIMIT`, and after the admitted turns
   settle, ALL slots are free (2 more turns stream);
6. **JSON completed** — three JSON turns succeed (release already correct;
   stays correct);
7. **JSON failed** — a typed upstream failure (429 envelope) releases the
   slot;
8. **product + user isolation** (real `preflight`) — user A at RIISHE's
   per-user cap: user B unaffected; user A's CODE GIFTZ (different backend
   id) unaffected; release restores capacity exactly.

RED→GREEN evidence: pre-fix 3 pass / 5 fail; post-fix **8 pass / 0 fail**
(the JSON + isolation tests passed before AND after — they pin contracts the
fix must not break).

## 7. Full verification at the milestone boundary (fresh runs)

- `bun test --isolate tests/` — **2470 pass / 0 fail / 5 skip, 185 files,
  40,651 expects** (pre-fix baseline on the same tree: 2462 pass / 5 skip;
  the +8 are the new tests; zero regressions).
- One earlier full-suite run showed a single failure in
  `tests/unit/jazmii-evidence-wiring.test.ts` ("mixed history: each
  capability reads its own newest completion"). It is a PRE-EXISTING,
  NONDETERMINISTIC suite-isolation flake, not caused by this milestone:
  it passes in isolation (verified with and without the fix), failed once in
  a full run WITHOUT the fix, passed in a full run WITHOUT the fix, and
  passed in the final full run WITH the fix. Recorded here honestly; not
  modified (out of milestone scope).
- `npx tsc --noEmit` — 159 errors, byte-identical count on the pristine tree
  and with the fix; all in untouched legacy `scripts/` and `tests/` files.
  Zero errors in the touched files. (No new type errors introduced.)
- `npx eslint src/app/api/riishe/chat/route.ts tests/unit/riishe-chat-slot-release.test.ts` — clean.
- `bunx prisma validate` — valid.
- `bun run build` — success; the 2 warnings are the pre-existing ones
  (middleware→proxy deprecation; `src/instrumentation.ts` Edge-runtime
  `process.pid`), both untouched files, unchanged from M33's record.
- Secret scan of the complete diff — clean (no secrets, no new env access,
  no tokens).

## 8. Live verification (real dev server, real endpoints, real model)

Fresh disposable account on `localhost:3000` (health 200), server run from
the fixed tree:

- **6 sequential streamed turns**: HTTP 200 with real model answers and
  `done` frames — turns 1–6 ALL stream. On the pre-fix code turn 3 is
  guaranteed 429 `CONCURRENCY_LIMIT` (deterministic unit reproduction), and
  the committed dig-*.sse artifacts show the historical live equivalent.
- **4 concurrent streamed turns** on the same account: exactly **2 × 200**
  and **2 × 429 CONCURRENCY_LIMIT** — the configured per-user cap of 2 is
  still enforced (the fix does NOT relax any limit; the burst is refused
  honestly beyond it).
- **1 sequential turn after the burst**: HTTP 200 — every slot came back
  after the concurrent turns settled.

## 9. What was deliberately NOT changed

- All concurrency limit values (per-user / total, every backend).
- User and product isolation semantics (test-pinned instead).
- Queue fairness, cancellation, timeout handling, Trust receipts.
- The durable DB job queue and its recovery sweep (audited healthy).
- Existing APIs, wire contracts and UI.
- No job records deleted; no active jobs reset (none needed — no DB rows
  were involved in the leak).

## 10. Known limitations (honest scope)

- The router's in-flight counters remain per-process (multi-worker
  deployments each hold their own map). This is pre-existing architecture,
  unchanged by this milestone.
- A streamed turn whose orchestrator hangs forever would hold its slot until
  the process restarts; in practice the adapter/router `requestMs` timeout
  (90 s for the hosted chat backend) bounds the wait — same contract as CODE
  GIFTZ's stream lifecycle.
- The pre-existing jazmii evidence-wiring suite-isolation flake described in
  §7 is recorded, not fixed here (unrelated subsystem; no unrelated
  refactoring in a targeted fix milestone).
