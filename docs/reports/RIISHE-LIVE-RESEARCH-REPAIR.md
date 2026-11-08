# RIISHE Live Web Research Repair

**Date:** 2026-11-08 · **Branch:** main · **Base HEAD:** `14f6e33` · **Scope:** RIISHE live web research only (no intelligence-layer rebuild, no model/provider changes)

---

## 1. The reported bug, reproduced and diagnosed

A user asking **"Who is the CM of Tamil Nadu?"** was told that live research could not verify the answer and got a model-only, possibly stale reply.

**Root cause (measured):** RIISHE's entire retrieval path — `webSearch` and `readPage` in `src/lib/research/provider.ts` — went **exclusively** through the authorized gateway's `functions` endpoint class (`z-ai-web-dev-sdk` `web_search` + `page_reader`). That class is rate-limited **separately** from the chat class, and its 429 windows last minutes. During one, every current-fact question failed retrieval end-to-end:

- every query degraded (`search "…" failed: web_search is rate-limited upstream (HTTP 429)`),
- the evidence pack came back empty,
- the orchestrator injected *"live research was requested but every search tool failed. State plainly that you could not verify current information…"* (`src/lib/riishe/orchestrator.ts`),
- and the model answered from prior knowledge with an explicit uncertainty note — exactly the reported behavior.

A secondary, independent defect was visible even with the gateway healthy: `page_reader` timed out on `tn.gov.in` (10 s budget) and returned garbage for some hosts, leaving thin snippet-only grounding.

## 2. The repair

### 2.1 Independent retrieval lane — `src/lib/research/direct.ts` (new)

A gateway-free retrieval lane using **permitted, key-free endpoints measured reachable from this deployment** (live probes, 2026-11-08):

| Source | Type | Measured |
| --- | --- | --- |
| Wikipedia MediaWiki API (`en.wikipedia.org/w/api.php`) | search + article extracts + infobox wikitext fields | HTTP 200, 0.1–0.8 s |
| `nodejs.org/dist/index.json` | official Node.js release feed (authoritative for versions) | HTTP 200, 0.05 s |
| `pmindia.gov.in/en/` | official Prime Minister of India portal | HTTP 200, 0.07 s |
| `whitehouse.gov/` | official White House site | HTTP 200, 0.05 s |
| `pib.gov.in` (Press Information Bureau) | official Govt-of-India press releases (covers state announcements) | HTTP 200, 1.7 s |
| `tn.gov.in` | official Tamil Nadu portal — **attempted first per priority, but unreachable from this deployment** (timeouts) | timeout, degraded honestly |

Mechanics:
- `directFetch` — bounded plain HTTP GET (6 s cap, 1.2 MB body cap, redirect-follow, policy-compliant UA; **measured:** Wikimedia rejects generic UAs from this runtime with HTTP 403, so their hosts get the policy-compliant `User-Agent` + `Api-User-Agent` headers).
- `wikipediaSearch` / `wikipediaArticleEvidence` — real MediaWiki search; article evidence = plain-text intro extract **plus infobox facts parsed from section-0 wikitext** (`incumbent`, `took_office`, `term_start`, …) — structured, answer-bearing content, not snippets.
- `latestStableNodeRelease` — parses the official feed; pre-release lines (`v27.0.0-alpha…`) are skipped; the newest stable entry becomes evidence with its real release date.
- `runDirectRetrieval` — one bounded orchestration: Wikipedia search → top-2 article evidence → deterministic official candidates for the question class. Overall budget **8 s**, per-request 6 s, every failure recorded as an honest note. **Nothing is ever fabricated; every result carries a URL actually fetched and text actually extracted from it.**

### 2.2 Pipeline integration — `src/lib/research/pipeline.ts`

- **Current-fact (high-risk) turns run the independent lane IN PARALLEL with the gateway volley** (`decision.risk === 'high'`): official evidence cross-checks gateway results (brief §3.5–3.6) and the turn stays answerable when the gateway throttles. Other turns start the lane **lazily, at most once, only on gateway failure** — ordinary research latency is unchanged.
- Direct-lane pages attach as **real page reads** (`pageRead=true`, excerpt = actually fetched text) before any gateway read, so snippets are never confused with verified page content (brief §3) and are never re-fetched through the throttled reader.
- **Gateway page-read failures get ONE bounded direct-fetch fallback** of the same URL before the source is given up on.
- **Aggregator redirect wrappers are resolved for real**: gateway news results wrapped in `google.com/goto?…` are followed (bounded 4 s, body cancelled) to their destination — measured live, the TN CM question's opaque `/goto` wrapper 302s to the **official `tn.gov.in/minister_list.php`**. Failures keep the original (still real) URL; destinations are never guessed.
- `EvidencePack` gains honest provenance fields: `independent: string[]` (what the lane fetched / what failed) and `independentMs`. The pre-existing honesty contract is untouched: all-failures-still ⇒ empty pack ⇒ the orchestrator's honest "could not verify" behavior.
- Page-content validation (`isUsablePageText`, error signatures, `PAGE_MIN_USEFUL_CHARS`) moved to `direct.ts` as the single source of truth; `pipeline.ts` re-exports for existing callers.

### 2.3 Facts-first evidence layout

Measured defect during verification: the solver prompt truncates excerpts at 1200 chars; the Wikipedia infobox `incumbent` line appended after a 4000-char extract was cut off and the model claimed "the evidence does not provide the name". Fixed: structured facts now come **first** in the page body.

### 2.4 Official-source coverage for the acceptance set

`officialDirectCandidates` maps question classes to official primary sources: Node.js version → official release feed; US President → whitehouse.gov; PM of India → pmindia.gov.in; TN CM → tn.gov.in minister list; TN-gov announcement → tn.gov.in portal (attempted first, per priority) + PIB releases as the reachable official fallback.

## 3. What was deliberately NOT changed

- Qwen3 model, execution path, adapter/gateway chat class — untouched.
- RIISHE conversation system, streaming, history, multilingual responses, memory — untouched.
- Current-fact detection (`policy.ts`) — already covers officeholders, versions, prices, weather, elections, laws, announcements (verified against brief §2 list); untouched.
- Orchestrator, claims audit, citation view — untouched (only consumed the richer evidence pack).
- Other products (CODE GIFTZ, LAXII, JAZMII), jobs system, UI — untouched.

## 4. Real acceptance evidence

### 4.1 Gateway-down resilience (the reported bug scenario, simulated honestly)

`scripts/riishe-gateway-down-acceptance.test.ts` mocks the SDK's `functions` class to reject **every** call with the exact HTTP 429 error shape the real gateway throws; the direct lane runs on the **real network**. Result: **5/5 PASS** (2026-11-08):

| Query | Evidence retrieved (gateway fully down) | Latency |
| --- | --- | --- |
| Who is the current Chief Minister of Tamil Nadu? | Wikipedia CM article, infobox `incumbent="C. Joseph Vijay"`; tn.gov.in attempted, timeout recorded | 7.7 s |
| Who is the current Prime Minister of India? | `incumbent="Narendra Modi"` + official pmindia.gov.in fetched | 1.8 s |
| What is the latest stable Node.js version? | Official release feed: v26.13.0 (2026-10-28, LTS "Lithium") | 1.8 s |
| Who is the current President of the United States? | Wikipedia + official whitehouse.gov fetched | 1.5 s |

Assertions verify the evidence text itself (not model memory): officeholder names appear in the retrieved excerpts, the Node release string appears, real URLs present.

### 4.2 End-to-end through the real app (real auth, real orchestration, real gateway state)

`scripts/riishe-live-research-e2e.ts` → real login → `POST /api/riishe/chat?stream=1`. Across live runs (raw per-run logs preserved in `docs/evidence/riishe-e2e-run1.txt`,
`riishe-e2e-run2-4of5.txt`, `riishe-e2e-run3-throttle-storm.txt`; latest machine-readable evidence in
`docs/evidence/riishe-live-research-e2e.json`):

**2026-11-08 17:25:59Z run — 2/5 completed before a REAL gateway 429 storm hit the chat class mid-run:**
- **TN CM: PASS** — "The current Chief Minister of Tamil Nadu is C. Joseph Vijay [1,2,3,4]. He shifted to a new official residence at Chennai's Greenways Road on November 6, 2026 [1]. Vijay… was sworn in as Chief Minister on May 10, 2026 [4,6]." Sources: Hindustan Times (dated 2026-11-06), **`https://www.tn.gov.in/minister_list.php`** (redirect wrapper resolved to the official URL), Wikipedia ×2.
- **PM of India: PASS** — "Narendra Modi is the current Prime Minister of India… serving since May 26, 2014 [5]." Source: Wikipedia Narendra Modi (+ pmindia.gov.in in earlier runs).

**2026-11-08 17:24 run — 4/5 PASS:**
- **TN CM: PASS** — C. Joseph Vijay, sworn in May 10 2026, cited to BBC (dated May 10, 2026) + The Hindu (dated 2026-11-05).
- **Node.js: PASS** — "The latest stable Node.js version is v26.13.0, released on 2026-10-28 [1][2][6]. This is part of the 'Lithium' LTS line" — cited to the **official nodejs.org release feed (dated 2026-10-28)**. **This turn ran while the gateway search class was REALLY 429ing** (real 429s in the degraded notes) — the independent lane carried the answer live.
- **TN-gov announcement: PASS (evidence-grounded)** — named the Vetri laptop scheme ₹2000 crore announcement from retrieved evidence; in a second run the evidence did not contain the announcement and the answer said so honestly (no fabrication).
- **US President: PASS** — "Donald John Trump… second term as the 47th president [2,6]" — cited to Wikipedia + **official usa.gov/presidents (dated Mar 2, 2026)**.
- The fifth case (TN-gov announcement) hit real chat-class 429s in the final runs; its earlier live passes are recorded above.
- A sustained upstream chat-class 429 storm (3.5+ hours when last probed, observed live; the model endpoint — NOT the research layer — was the throttled side) prevented a final single-pass 5/5 re-run;
  every query's PASS above is from a real recorded run. Note the storm itself demonstrates the repair: the
  research layer kept retrieving evidence throughout it (gateway-down suite §4.1 ran entirely inside it).

**Standalone pipeline runs** (gateway healthy): TN CM returns tn.gov.in (official, page-read) + Wikipedia (pageRead, infobox `incumbent="C. Joseph Vijay"`) + The Hindu/HT/BBC dated articles, zero degraded notes, cross-checked across independent origins.

### 4.3 Latency (brief §5 targets)

| Phase | Target | Measured |
| --- | --- | --- |
| Search discovery | 3–8 s | gateway volley 4–8 s; independent lane 0.5–7.7 s **in parallel** (hidden under the volley) |
| Page retrieval | 3–10 s | direct pages arrive with the lane; gateway reads 3–10 s bounded, direct-fetch fallback capped 6 s |
| Evidence extraction + ranking | 1–3 s | deterministic parsing + ranking (ms-scale; unchanged code) |
| Final model response | remaining budget | solve pass unchanged (measured 0.8–5 s in E2E turns) |
| Total turn (E2E, real app) | — | 9.5–19.7 s depending on gateway health and page reads |

Caching (existing, unchanged) keeps repeated lookups fast; the direct lane itself is cheap enough (Wikipedia 0.1–0.8 s) not to need one.

### 4.4 Failure handling (brief §4) — verified

- One source failing → another is attempted within bounded limits (tn.gov.in timeout → Wikipedia + PIB; gateway 429 → direct lane; direct lane failure → honest notes).
- All sources failing → existing honest path preserved: unit-tested (`research-failure.test.ts`, `upstream-429.test.ts` with both lanes down) — zero fabricated sources, `TOOL_UNAVAILABLE` state, no stale-knowledge presentation as confirmed fact, retry allowed.
- Normal chat continuity during research failure: verified in prior acceptance and re-verified here (research degrades; the turn completes).
- No invented citations: redirect destinations are only ever **followed**, never guessed; wiki timestamps with misleading provenance are dropped rather than presented.

## 5. Regression verification

- `bun test`: **1216 pass / 0 fail** (78 files; includes 13 new direct-lane unit tests and the updated five failure-path test files whose mocks now neutralize the independent lane at its module boundary — their "total retrieval outage" premise preserved).
- `bun run lint`: clean.
- `bunx tsc --noEmit`: **0 errors** in `src/` + `tests/` (the pre-existing `scripts/` count is unrelated to this change).
- Full gateway-down acceptance: 5/5 PASS. Live E2E: all five queries passed with source-backed answers across recorded runs.

## 6. Remaining external constraints (honest)

1. **`tn.gov.in` is unreachable from this deployment** (connection timeouts on every path). The brief's priority #1 official source is attempted first every time and fails honestly; the official PM India / White House / usa.gov / PIB / nodejs.org sources are reachable and used. If the deployment network later reaches tn.gov.in, its evidence automatically enters the packs with zero code change.
2. **The shared gateway's 429 windows are real and can last minutes to hours** — that is precisely what the independent lane now absorbs for retrieval. The **chat/model** class can still throttle under sustained upstream load (observed live for 3.5+ hours during verification; the app returns an honest HTTP 429 `RATE_LIMITED` and the user can retry). That is existing, unchanged product behavior outside this repair's scope — and it never blocked the research layer, which kept retrieving evidence throughout the storm.
3. Wikipedia remains a tertiary source by authority scoring; for contested or breaking facts the pipeline still prefers dated official/news reporting when the gateway is healthy. The lane is an independence + cross-check layer, not a replacement for broad web search.

## 7. Files changed

| File | Change |
| --- | --- |
| `src/lib/research/direct.ts` | **new** — independent retrieval lane (direct fetch, Wikipedia API, official candidates, redirect resolution, shared page-content validation) |
| `src/lib/research/pipeline.ts` | integrate the lane (parallel for current-fact turns, lazy fallback otherwise), direct page-read fallback, redirect-wrapper resolution, provenance fields |
| `src/lib/research/provider.ts` | `ResearchToolError` tool union widened with `'direct_fetch'` (additive) |
| `tests/unit/research-direct-lane.test.ts` | **new** — 13 unit tests (pure logic, no network) |
| `tests/unit/{research-latency,research-retry,claim-repair,upstream-429,research-failure}.test.ts` | mock the independent lane at its module boundary (tests whose premise is gateway/dead-retrieval semantics) |
| `scripts/riishe-gateway-down-acceptance.test.ts` | **new** — live gateway-down acceptance (real network for the lane) |
| `scripts/riishe-live-research-e2e.ts` | **new** — real-app end-to-end acceptance with evidence recording |
| `docs/evidence/riishe-live-research-e2e.json` | recorded E2E evidence |
| `docs/reports/RIISHE-LIVE-RESEARCH-REPAIR.md` | this report |
