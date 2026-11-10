# BEAN — RIISHE ACCEPTANCE (FULL FUNCTIONAL TEST)

**Date:** 2026-11-07 · **User:** `fulltest-20261107021238@bean-e2e.test` (fresh isolated account; retry items on a second fresh account) · **Conversation:** `cmw5rqg39002ir9vimlw709vb`

All ten brief items executed against the real API with real model responses. Evidence lines: `scripts/fulltest-out/evidence.jsonl` (steps `riishe-*`).

| # | Item | Method | Result | Classification |
|---|---|---|---|---|
| 1 | New conversation | POST `/api/riishe/chat?stream=1` | 200 · conversation created · real reply acknowledging codename GOLDEN CANYON | REAL |
| 2 | General question | same turn | "Hello, I'm RIISHE, the AI assistant from BEAN Intelligence…" (134 chars) | REAL |
| 3 | Reasoning question | "17 sheep, all but 9 run away…" | Answer: **"9"** — correct | REAL |
| 4 | Summary request | "Summarize this conversation…" | 119 chars, mentions GOLDEN CANYON (first attempt 429; passed in a later breaker window at 02:40 UTC) | REAL |
| 5 | Rewriting | informal → formal | "I am going to obtain some food promptly as I am extremely hungry." | REAL |
| 6 | Multilingual | Tamil prompt | Full Tamil-script response: "நான் உங்களுக்கு தமிழில் பதிலளிக்கிறேன்." (regex-verified U+0B80–0BFF; first attempt 429, passed in later window) | REAL |
| 7 | Streaming | SSE frames | **38 frames, 134 chars in 946 ms**, `done` frame received; retry turn 53 chars; cancellation turn partial-then-abort | REAL |
| 8 | Conversation context | "What is my project codename?" | **"GOLDEN CANYON"** — held across turns | REAL |
| 9 | Persistence (refresh) | GET conversation detail | 200 · **10 messages**, roles `user,assistant,…` intact, codename intact in stored user turns | DETERMINISTIC |
| 10a | Cancellation | client abort mid-stream | Abort issued after 16 chars / 536 ms; server healthy afterwards; the discarded turn is not persisted (cooperative cancel) | REAL |
| 10b | Error handling | empty message / unknown id | **typed 400** / **typed 404** — no 500s | DETERMINISTIC |

## Honest observations

- **Intermittent account 429s:** 3 of the ~10 chat turns hit the provider's account throttle (`The upstream AI gateway is rate-limited right now (HTTP 429)…`). The typed error is shown in-stream and the question is preserved client-side for retry — the UX handled it as designed. Every 429 is recorded in evidence; none were retried inside their throttle window.
- **Cancellation record:** after a client abort the user turn is not written to the DB; the abort surfaces as no new turn rather than a "cancelled" marker. Truthful and safe, noted as designed behavior.
- **No memory command was used** in any prompt; all answers are real model output from the conversation context alone.

## Deliverable conversation (openable in RIISHE)

Sign in as `fulltest-20261107021238@bean-e2e.test` (or any fresh account and re-run `bun scripts/fulltest/four-product-full-test.ts auth riishe`) and open the sidebar — conversation `cmw5rqg39002ir9vimlw709vb` contains the full 10-message exchange (codename setup, reasoning puzzle, summary, rewrite). A second conversation from the retry window (`cmw5sop26006pr9vir9e3zxu2`, account `fulltest-20261107023820@bean-e2e.test`) carries the Tamil exchange.

## In-product test workflow (Rule 8)

RIISHE workspace → bottom card "RIISHE test suite": streaming chat (REAL), persistence after refresh (DETERMINISTIC), empty-message validation (SIMULATED). In-browser run: **3/3 passed** (screenshot `scripts/fulltest-out/ui-riishe-suite-final.png`).

## Verdict

**OPERATIONAL** — every user-facing RIISHE feature tested works with real model responses; the only limitation is the external account-level throttle, surfaced honestly.
