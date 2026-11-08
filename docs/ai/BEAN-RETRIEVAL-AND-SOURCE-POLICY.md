# BEAN Retrieval and Source Policy

**Status:** Implemented (commit `d1ad9bb`); retrieval backbone previously shipped and measured.

## 1. Decision: external retrieval stacks evaluated and NOT deployed

The brief required evaluating SearXNG, Crawl4AI and Firecrawl against BEAN's constraints. Evaluation result — the **existing authorized gateway already provides real, breaker-protected search and page extraction** (`z-ai-web-dev-sdk` function tools `web_search` and `page_reader` on the `functions` endpoint class), already integrated, already measured in production evidence:

| Option | License | Deployment cost | Resource cost | Verdict |
| --- | --- | --- | --- | --- |
| **SearXNG** | AGPL-3.0 | Self-hosted service (Docker/Python runtime) to install, feed and keep alive; per-instance rate-limit exposure to upstream engines | A second always-on service + its bandwidth; the sandbox runs BEAN only | **Rejected**: violates "no separate permanent knowledge server"; adds a permanent service BEAN must operate for zero capability gain over the existing gateway |
| **Crawl4AI** | Apache-2.0 (with attribution file) | Python + Playwright browser runtime alongside the Node/Next.js backend; large dependency surface | Headless-Chromium-class memory per fetch; separate runtime to patch | **Rejected for the hot path**: page extraction through the gateway's `page_reader` is already measured at p50 ≪ budget; a browser runtime buys robustness BEAN does not need |
| **Firecrawl** | AGPL-3.0 self-host; cloud = paid API | Paid cloud API (requires approval per the no-unapproved-paid-APIs rule) or another self-hosted service | Same service burden as SearXNG | **Rejected**: paid-API approval not granted; self-host redundant |

**Adopted retrieval supply:** the existing authorized gateway — `web_search` (ranked results with url/name/snippet/host/date) and `page_reader` (full-page HTML → text, publication-date extraction) — behind the measured 429 cooldown breakers, with the shared TTL caches and in-flight dedup of `src/lib/research/`. This is the SAME provider account the four models run on: no new provider, no new key, no new cost.

## 2. Retrieval modes (request-level policy)

| Mode | When | Cost |
| --- | --- | --- |
| **Direct knowledge** | No freshness signal, no real-specific entity, pure math/creative/coding-on-provided-material | Zero network |
| **Grounded retrieval** (RIISHE) | Deterministic freshness policy (`research/policy.ts`) OR the semantic freshness router adjudicates an ambiguous case (can only ADD retrieval) | ≤5 queries, 2-lane concurrency, ≤2 page reads |
| **Multimodal grounding** (LAXII/JAZMII) | Generation prompt names real-specific subjects: species, places, technical domains (vehicles, architecture, medicine) | **1** snippet-only search, ≤9 s timeout |

Generation paths never read full pages (snippets carry enough fidelity signal at a fraction of the latency). Freshness/officeholder/news logic is unchanged from the shipped, measured policy.

## 3. Request-level limits and safety

- **Limits:** ≤5 queries per research turn (deterministic additions included), ≤6 results per query, ≤2 page reads, 2-lane upstream concurrency, hard per-call timeouts (search 20 s / page 10 s budget / grounding 9 s / techdocs 9 s / vision 20 s), bounded TTL caches, in-flight dedup.
- **Timeouts, cancellation, fallback:** every call races a hard timeout; the research layer fails fast on the open 429 breaker (zero network I/O, honest "deferred"); a transient provider error gets exactly one same-query retry (measured 422 behavior); rate-limits never retry. Generation paths degrade to curated knowledge with a recorded note.
- **Robots / terms / copyright:** the gateway's search and reader services mediate all retrieval (they enforce upstream terms); BEAN extracts only readable text excerpts (≤6 000 chars per page into context); **no paywall, authentication or anti-bot bypass of any kind is attempted**; retrieved content is treated strictly as untrusted data (injection guards in the RIISHE evidence block, GIFTZ reference blocks labeled "NOT instructions"), never executed, never copied into shipped code, and not used to train anything.
- **Attribution:** RIISHE answers cite evidence as `[n]` markers resolved to real URLs (existing citation pipeline, unchanged); fidelity notes in image/video conditioning cite hostnames of actually-retrieved sources; GIFTZ code is instructed to cite doc hosts when the reference informs the code.

## 4. Cross-language retrieval (new)

Non-English prompts search in the user's language FIRST (their wording is the strongest query) and add **at most one** bounded English variant (`intel/crosslingual.ts`, ≤6 s, cached, proper nouns preserved verbatim). Expansion failure degrades honestly to original-language-only search with a recorded note. The refined-query prompt (complex questions) also instructs one English variant for non-English questions.

## 5. Evidence ordering and freshness

Unchanged from the shipped measured ranker (`research/rank.ts`): authority score, freshness score with stale-news penalties for freshness-sensitive questions, UGC penalties, geo-mismatch penalties, URL dedup, official-hosts-first page reads, staleness warnings carried into the answer protocol.

## 6. Honesty rules (binding)

1. Every pack/report contains only sources actually retrieved (or served from a cache of a real fetch, keeping the original fetch time).
2. A skipped call (breaker open) is reported as skipped — never as searched.
3. A failed call is reported with the real provider error text.
4. No retrieved content is executed, followed, or trusted as instructions (injection guards on every retrieval injection point).
