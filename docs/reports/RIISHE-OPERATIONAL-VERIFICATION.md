# RIISHE — Operational Verification Report

**Date:** 2026-11-04 · **Scope:** §2/§6 of the four-product task — verify the assistant is genuinely operational and fix real failures (not health indicators).

## 1. What was audited (no changes needed — findings below)

RIISHE's implementation was verified end-to-end at source level and against the live server:

| Capability | Mechanism | Status |
|---|---|---|
| Real text generation | `bean-llm-hosted-primary` → platform hosted LLM SDK, server-side only, SSE streaming | Implemented; **live turn this session BLOCKED by upstream 429** (see §2) |
| Conversation context | DB history tail (24 msgs) + LLM-condensed overflow digest (`summary`/`summaryCount`) | Implemented + unit-tested (`riishe-continuation`, `riishe-association`) |
| Tool invocation & result handling | bounded 3-round text-protocol tool loop; 6 real tools incl. sandboxed `run_code`, `web_search`, vision | Implemented + unit-tested (`toolloop`, `tools`, `riishe-tools-v2`) |
| Research integration | same SDK `functions.invoke` (web_search / page_reader) with typed failure classes | Implemented (`research-*` suites) |
| File/document handling | capability-gated uploads, magic-byte sniffing, PDF/DOCX/XLSX extraction, honest `unsupported` notes | Implemented (`documents`, `files-pipeline`) |
| Streaming responses | spec-correct SSE frames, 15s keepalive, disconnect-safe server-side completion, verify-rewrite `reset` | Implemented (`riishe-streaming`, `sse-client`) |
| Conversation persistence | `Conversation`/`Message` rows; list/search/rename/delete + date-grouped sidebar | Implemented; live-verified in earlier session and via unit pins |
| Error handling | typed upstream failure frames (429/auth/billing/timeout/truncation) — partial text preserved and labeled, never counted as success | Implemented (`upstream-429`, `research-failure`) |
| Auth & user isolation | session-scoped queries; foreign conversation → 404 | Implemented; IDOR re-verified live this session |

## 2. Live evidence this session

- **Real assistant turn: BLOCKED by upstream throttling.** `POST /api/riishe/chat` returned the honest typed envelope `429 RATE_LIMITED` — both the fail-fast breaker form ("chat completion not attempted: upstream gateway is rate-limited (HTTP 429 observed moments ago)") and, when the breaker had cooled, the real upstream rejection ("API request failed with status 429: Too many requests…"). Captured verbatim in `scripts/four-product-acceptance-out/acceptance-results.json`.
- **Conversation persistence + IDOR:** verified via the acceptance run (conversation listed; intruder `GET /api/riishe/conversations/[id]` → 404).
- **Health projection:** RIISHE = `unavailable` with `failureCategory: rate-limited, httpStatus: 429` — the dashboard says exactly what is happening, nothing more.
- Earlier sessions (recorded in `docs/reports/BEAN-INTELLIGENCE-CONNECTIVITY-*.md` and the W1–W5/eval reports) contain real streamed RIISHE answers, tool executions, citation/claim verification runs — the product was operationally verified when the upstream was healthy.

## 3. Honest current status

**Degraded-by-infrastructure:** every layer RIISHE owns (orchestration, tools, persistence, isolation, streaming, error honesty) is real and tested (suite: 1018/0/64). The one thing that cannot be demonstrated right now is a fresh live model answer, because the shared upstream account is returning 429 to every chat-class call. Per the task rules this is reported as-is: no fake success, no health-indicator tampering.

## 4. Fix-up work this session

None required — no defect found in RIISHE itself. The upstream throttling is external and is handled by the existing breaker (zero-network deferral, honest `latencyMs:null`, typed user-facing messages with a Retry affordance).

## 5. Rollback

No RIISHE source changes this session → nothing to roll back.
