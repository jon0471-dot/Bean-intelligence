# RIISHE Live-Research Failure — Root-Cause Investigation Report

Date: 2026-11-12 · Scope: READ-ONLY (no product code modified) · Repo: Bean Intelligence @ 30278a3

## 1. Request lifecycle trace (verified)

1. **Frontend** — `src/components/bean/riishe/use-riishe-chat.ts` / `sse-client.ts`: POST `/api/riishe/chat?stream=1`, consumes SSE (`stage`, `delta`, `research`, `done` events).
2. **Backend API** — `src/app/api/riishe/chat/route.ts`: preflight (auth, origin/CSRF, rate limit, body validation), SSE `start()` at L383–401, persists `Message.metadata` (sources/degraded/stages) on completion.
3. **Orchestration** — `src/lib/riishe/orchestrator.ts` `orchestrateTurn`: understand → capability plan → `searchNeeded` decision → `runResearch` (L459–471) → tool plan → solve → verify → SSE.
4. **Search-provider selection** — `src/lib/research/pipeline.ts` `runResearch` (L579): query generation (incl. recency-windowed variants, e.g. `"new AI model" launch 2026-11-05..2026-11-12`), then gateway searches (bounded concurrency 2) + the key-free independent lane (`src/lib/research/direct.ts`).
5. **Provider authentication** — `src/lib/research/provider.ts` `webSearch` (L151): `z-ai-web-dev-sdk` `functions.invoke('web_search')`; credentials are platform-injected (no keys in `.env`, `ProviderCredential` table empty — auth is NOT the failure).
6. **Search execution** — gateway search → its upstream `google.serper.dev.psmoe.com` (Serper.dev proxy) with a 4s read timeout on the gateway side.
7. **Result parsing** — `webSearch` filters/maps `url/name/snippet/host_name/rank/date`; malformed responses become typed errors.
8. **Citation extraction** — `rank.ts` ranking, redirect-wrapper resolution, page reads (`readPage` with `directFetchPage` fallback), `src/lib/verify/citations.ts`.
9. **Answer generation** — orchestrator builds the evidence block; on `pack.sources.length === 0` it appends the honesty note (L527–531): "live research was requested but every search tool failed…"; model then streams the degraded answer.

## 2. Exact root cause

**Primary (provider availability):** every recency-windowed gateway search in the failing turn failed because the gateway's own upstream search backend timed out — `Primary search failed: ReadTimeout(HTTPSConnectionPool(host='google.serper.dev.psmoe.com', port=443): Read timed out. (read timeout=4))`, wrapped by the gateway as HTTP 500 with inner code 42900 "UpstreamAPIError". One query received an authoritative 422 "No search results available" in the same window, proving the search backend itself was alive and answering.

**Secondary (code robustness):**
- `classifyUpstreamError` (`src/lib/upstream/gateway.ts` L104–131) parses the FIRST `status NNN` in the SDK error text — the outer `500` — so the inner 429/422 is invisible: the failure classifies as generic transient `'other'`, the documented 429 fail-fast/breaker path never engages, and every query is retried once into the same struggling upstream.
- The independent key-free lane (`research/direct.ts`) has **zero candidate coverage** for AI-release/announcement questions (`officialDirectCandidates` L312–348 covers only Node.js versions, US president, India PM, Tamil Nadu CM, Indian government announcements), and its Wikipedia search failed/returned nothing during the same window. Its notes are **neither logged nor persisted** (Message.metadata drops `independent`), so the fallback lane's failure is invisible post-hoc.

**Result:** `pack.sources = []` → orchestrator honesty note → truthful "unable to verify" answer. The honesty contract worked; nothing was fabricated. NOT the cause: auth (no 401/403 anywhere), SSE streaming (stream completed normally; stages researching 26.68s → tools 2.05s → verifying 3ms), rate-limit breaker (never opened, due to the misclassification), parsing/citation extraction (URLs survive — verified live and historically).

## 3. Redacted error evidence

- `dev.log:68482` — `Failed to invoke remote function: Error: Function invoke failed with status 500: {"result":null,"error":"Search failed: request failed with status 429: {"code":429,"message":"Primary search failed: ReadTimeout(ReadTimeoutError(\"HTTPSConnectionPool(host='google.serper.dev.psmoe.com', port=443): Read timed out. (read timeout=4)\"))","name":"UpstreamAPIError","status":42900}` (×4 in the turn)
- `dev.log:68506` — same wrap, inner 422: `No search results available for query "new AI model" launch 2026-11-05..2026-11-12` (backend alive in the same window)
- Persisted `Message.metadata` (conversation `cmwd14mw10001pticay86t2i4`, retrievedAt `2026-11-12T04:10:27.756Z`): `degraded` = 3 search failures (2× inner-429 upstream timeout, 1× inner-422 zero results); `sources: []`; perf: researchMs 26,679 / searchMs 24,928 / totalMs 28,752.
- Stack: `webSearch (provider.ts:159)` ← `searchWithBoundedRetry (pipeline.ts:515/527)` ← `mapWithConcurrency (567)` ← `runResearch (670)` ← `chat/route.ts start (401)`.
- No credentials or PII present in any evidence; `GatewayRequestLog` and `ProviderCredential` tables are empty.

## 4. Reproducibility

**Not reproducible at steady state — transient upstream window.** Live verification ~25 minutes later:
- Direct provider probe: `web_search` OK in 1,093ms (3 real results), `page_reader` OK in 3,714ms (real page + publishedTime extracted).
- Full E2E re-run of the EXACT failing question through the real server (`POST /api/riishe/chat?stream=1`): SUCCESS — researching 14.9s, 3 persisted sources (`help.openai.com/.../model-release-notes` pageRead=true, `en.wikipedia.org/wiki/Grok_(chatbot)` pageRead=true via the independent lane, `benchlm.ai/model-updates`), grounded answer naming GPT-6 Rosalind Research (OpenAI, Oct 30 2026). Honest degraded notes: one 403 page read (`ai.miraheze.org`), one claim-repair note.

## 5. Fallback mechanisms status

| Mechanism | Status |
|---|---|
| Gateway `web_search` (primary, z-ai SDK) | Operational now; upstream (Serper proxy) intermittently timed out at 04:10Z |
| Gateway `page_reader` + per-URL `directFetchPage` fallback | Operational (E2E pageRead=true) |
| Independent lane — Wikipedia MediaWiki API | Operational (probe: 3 hits in 0.5–1.4s); transiently failed at 04:10Z; undated results, so not a freshness source |
| Independent lane — deterministic official candidates | Operational but **zero coverage** for AI-release questions |
| Other search providers | None configured (`ProviderCredential` empty; single gateway provider) |

## 6. URL / source-metadata survival

Verified both directions: historical turns persist sources with real URLs + dates + pageRead flags (e.g. `nodejs.org/dist/index.json`, date `2026-11-10`), and today's E2E turn persisted 3 sources with URLs through SSE → metadata → DB. Citations survive the complete pipeline when any lane returns results.

## 7. Recommended minimal fix (needs approval before implementation)

1. **`src/lib/upstream/gateway.ts` — `classifyUpstreamError`:** also parse the gateway's INNER status (`/"status":\s*(\d{4,5})/`, `/request failed with status (\d{3})/` in the payload), preferring the innermost code; map inner 42900 → rate-limited/upstream-timeout class (fail fast, no doomed retry, breaker engages per documented contract) and 42206 → authoritative zero-results (no transient retry).
2. **`pipeline.ts` / orchestrator:** persist the pack's `independent` notes (and searchCalls/pageReadCalls) into `Message.metadata` alongside `degraded`, so fallback-lane failures are diagnosable post-hoc.
3. **Optional (approval required):** add a key-free official-candidate class for release/announcement questions (e.g. vendor release-notes pages / GitHub releases feeds) to `officialDirectCandidates`, so a gateway search blackout cannot blank freshness-sensitive questions.

## 8. Tests needed to verify the fix

- Unit: `classifyUpstreamError` with the REAL wrapped message (`Function invoke failed with status 500: …inner 429…42900…`) → non-`other` class; inner 42206 → zero-results class.
- Unit: `searchWithBoundedRetry` with the wrapped-429 error → `attempts === 1` (fail fast, no retry into a 429 window).
- Unit: turn metadata now contains `independent` notes from the pack.
- Regression: existing `scripts/riishe-gateway-down-acceptance.test.ts` and the research-failure/research-quality suites pass unchanged; the 5-case `scripts/riishe-live-research-e2e.ts` suite still passes (real sources required per case).
- Failure drill: mock the SDK to throw the wrapped-500/429 message; assert the turn completes with independent-lane sources for a covered question (Node.js case) and honest degradation otherwise.

## 9. Investigation artifacts (git-excluded, investigation-only)

`scripts/riishe-diagnostic-probe.ts`, `scripts/riishe-e2e-repro.ts` (added to `.git/info/exclude`); one test conversation created under the existing fixture user (`cmwd1bw3g000qpticvxpsorjk`). Working tree clean; nothing pushed.
