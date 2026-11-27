# M42 — Source Platform Coverage (measured)

> Every row below reflects measured state on the branch `feat/m42-universal-web-research-access`, not desired functionality. Classification: **PASS** (real action succeeded and evidence was validated) / **HONEST UNAVAILABLE** (exact reason recorded) / **DISABLED** (BEAN policy) / **NOT INTEGRATED** (no adapter). Never converted upward.
>
> Live evidence files (committed, machine-readable): `scripts/m42-acceptance/out/academic-probe.json`, `scripts/m42-acceptance/out/security-community-probe.json`, `scripts/m42-acceptance/out/specialist-contract-acceptance.json`.

## 1. Registry rows (runtime source of truth)

`src/lib/research/reach/registry.ts` reports, at every call, with `checkedAt`:

| id | family | kind | state | serving | note (honest) |
|---|---|---|---|---|---|
| github | developer | agent-reach | host-probed (available / unavailable / requires_configuration) | all 7 specialists | Agent Reach channel; state from the real doctor probe |
| web | general-web | agent-reach | host-probed | all 7 | general search + page reads |
| youtube | video-audio | agent-reach | host-probed | all 7 | public metadata/transcripts where supported |
| reddit | community | agent-reach | requires_login (until owner logs in on the host) | all 7 | no cookie copying, ever |
| bilibili | video-audio | agent-reach | host-probed | all 7 | region/channel dependent |
| v2ex | community | agent-reach | host-probed | all 7 | hot/node/read/user actions |
| twitter / linkedin / xiaohongshu / xueqiu / facebook / instagram / xiaoyuzhou / boss | social, video-audio | agent-reach | **disabled** | none | not enabled in the BEAN allowlist |
| obscura | general-web | browser | health-probed | riishe, code-giftz | optional JS-rendered reads |
| direct-official | general-web | direct | available (in-process) | all 7 | official pages, Wikipedia/MediaWiki APIs, Node release index, Crossref, arXiv, OpenAlex, DOAJ, npm, PyPI |
| security-advisories | developer | direct | available (in-process) | all 7 | OSV.dev by-id + package-scoped advisories |
| community-apis | community | direct | available (in-process) | all 7 | Stack Exchange + Hacker News, USER-GENERATED labeling |
| family-scholarly (PubMed/Europe PMC) | scholarly | direct | **not_integrated** | none | Crossref/OpenAlex/arXiv/DOAJ live; these two remain |
| family-gitlab | developer | direct | **not_integrated** | none | reachable via general web search today; dedicated adapter pending |
| family-standards | standards | direct | **not_integrated** | none | reachable via general web search |
| family-images | images | direct | **not_integrated** | none | Wikimedia text lanes exist; per-file license metadata adapters do not |
| family-geo | geo | direct | **not_integrated** | none | query-side geo heuristic only |

## 2. Adapter decision records (M42.3 / M42.3b — one per adapter)

### 2.1 Crossref (`api.crossref.org`) — scholarly DOI metadata
- **API/terms:** official public REST (`/works`), polite pool via descriptive UA. **Auth:** none. **Cost:** free.
- **Rate limits:** documented polite-pool expectations; 1 call/research-run, 8s timeout.
- **Fields:** DOI, title, authors (≤3 as supplied), issued date-parts, container-title, URL → `https://doi.org/<doi>`. Missing fields stay null.
- **Tests:** dispatch gating (scholarly-shape queries only), host allowlist incl. runtime guard, live probe.
- **Failure behavior:** typed `direct_fetch` error → lane note; one adapter's failure never disables others.
- **Live evidence:** PASS — real DOI `10.1039/d4ta08556f/v2/review1` (title + container preserved), earlier window `10.1039/d5nr00872g/v2/review1`.

### 2.2 OpenAlex (`api.openalex.org`) — scholarly discovery
- Same discipline (official API, no auth, per-page bounded, select-fields list).
- **Live evidence:** HONEST UNAVAILABLE — HTTP 429 provider rate limit, recorded verbatim in both probe windows. Not converted to PASS.

### 2.3 arXiv (`export.arxiv.org`) — preprint metadata
- Official Atom API, bounded flat parsing (`<entry>` blocks, ≤4), fields as supplied.
- **Honesty rule enforced:** every record is labeled `arXiv preprint — NOT peer-reviewed` in the snippet; the lane adds an explicit note when preprints are merged. Preprints are never presented as published research.
- **Live evidence:** HONEST UNAVAILABLE in the current window (HTTP 429 then "no result returned"); worked in the earlier window (real preprint records). Recorded per-window.

### 2.4 DOAJ (`doaj.org`) — open-access article metadata
- Official public API, bibjson mapping (title/authors/year/doi).
- **Live evidence:** PASS — real article `10.22146/ijc.21191` with year + three authors as supplied.

### 2.5 npm registry (`registry.npmjs.org`) — package manifest
- Official `/latest` endpoint. **Field honesty:** the endpoint carries no dates → `date: null` (never invented); license from the manifest (string or `{type}`) or the explicit note "license: not declared in the manifest".
- **Live evidence:** PASS — `zod@4.6.7` with homepage `https://zod.dev`.

### 2.6 PyPI (`pypi.org`) — project metadata
- Official JSON API; version/license/author/homepage as supplied.
- **Live evidence:** PASS — `requests 2.34.2`, author + homepage preserved.

### 2.7 OSV.dev (`api.osv.dev`) — security advisories
- Official public JSON API. Two actions: `GET /v1/vulns/{id}` (CVE/GHSA/OSV ids) and `POST /v1/query` (package + ecosystem enumeration — the only official way to list advisories for a package).
- **Auth:** none. **Cost:** free. **Rate limits:** generous but undocumented — bounded to 1–2 calls per research run, 8s timeout.
- **Fields:** id, aliases (≤4), summary/details (≤300), severity score or database_specific severity, modified/published dates — exactly as supplied; author is always null (advisories have none).
- **UGC rule:** OSV records are OFFICIAL (authority 0.85, social=false); community records never outrank them.
- **Tests:** id-regex dispatch (CVE/GHSA/OSV patterns), package-shape dispatch (npm/PyPI ecosystems), host allowlist + runtime guard, honest-null normalization, ≤3 advisories cap.
- **Live evidence:** PASS ×3 — `CVE-2021-23336` with aliases + modified timestamp; `lodash (npm): GHSA-29mw-wpgm-hmr9 (aka CVE-2020-28500)`; `django (PyPI): GHSA-2655-q453-22f9 (aka CVE-2012-4520, PYSEC-2012-7)`.

### 2.8 Stack Exchange (`api.stackexchange.com`) — community Q&A
- Official API v2.3 `search/advanced`, `site=stackoverflow`, pagesize ≤4, relevance sort.
- **Auth:** none (unkeyed access). **Quota (honest):** shared per-IP unkeyed quota — the live probe measured **HTTP 429** in the current window; recorded HONEST UNAVAILABLE verbatim. A keyed integration would require an owner-registered key (documented requirement, not auto-enabled).
- **Content handling:** titles are HTML-escaped by the API — decoded with a FIXED entity map (`&amp; &lt; &gt; &quot; &#x27; &#39;`); any other entity is DROPPED, never guessed. Every record's snippet carries `community Q&A (user-generated)` with score/answer-count/accepted-status; records enter the pool as social/community with authority 0.45.
- **Attribution:** the record URL links back to the source page (SE terms).
- **Live evidence:** HONEST UNAVAILABLE (HTTP 429) — exact reason recorded.

### 2.9 Hacker News (`hn.algolia.com`) — community discussion
- Official public HN Search API by Algolia (the backend behind HN's own search). `tags=story`, ≤4 hits.
- **Auth:** none. **Cost:** free. **Rate limits:** documented public API; 1 call per research run.
- **Content handling:** every record labeled `community discussion (user-generated)` with points/comments; missing outbound URL falls back to the item page (`news.ycombinator.com/item?id=`).
- **Live evidence:** PASS — real story with author, ISO created_at, points/comments preserved; dispatch lane end-to-end PASS (real query → ranked UGC record with the corroborate-with-official-sources note).

## 3. Existing channels (pre-M42, state from the live doctor probe)

| Channel | Actions | Access rule |
|---|---|---|
| GitHub | search / read public repos, releases, issues, docs | public read/search by default; private repos only via an explicit authorized connector |
| General web | search + page read | the authorized gateway boundary |
| YouTube | search / read / subtitles where the upstream channel provides them | public/authorized transcript methods only; no DRM bypass |
| Bilibili | search / read / subtitles / hot-list where supported | availability may be region/channel dependent |
| Reddit | search / read / subreddit ops | OPTIONAL; owner-controlled host login required; stays requires_login until a real login + read test succeed; no cookie copying |
| V2EX | hot / node / read / user | measured per action |
| Obscura | fetchRenderedPage / extractText / extractLinks / captureScreenshot | optional; only for pages that genuinely require JS rendering |
| Wikimedia direct | article evidence / infobox fields | policy-compliant UA headers (measured 403 without them) |
| Official-site direct | candidate pages + Node release index | bounded direct fetch, SSRF-guarded |

## 4. Probe windows (verbatim)

| Window | academic-probe | security-community-probe |
|---|---|---|
| 2026-11-26 (committed tree, broken guard) | 0/7 — every adapter `ALLOWED_HOSTS is not defined` (superseded evidence, disclosed in the M42.3 fix commit) | — |
| 2026-11-26 (fixed tree) | 5/7 PASS (crossref, doaj, npm, pypi, dispatch); openalex HTTP 429; arxiv no-result | — |
| 2026-11-26 (M42.3b tree) | — | 6/7 PASS (osv-by-id, osv-npm, osv-pypi, hackernews, both dispatch lanes); stackexchange HTTP 429 |

Specialist-contract acceptance (same day): 9/9 PASS — real evidence for all seven consumers through the real pipeline with mission-scoped budgets; fiction/transform objectives refused with zero network calls.
