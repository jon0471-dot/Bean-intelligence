# M42 Implementation Report — Universal Web Research & Reference Access

> Branch `feat/m42-universal-web-research-access`, based on `origin/main` = `cc21b80` (M41.7 fully merged via PRs #27/#28/#29/#31). Every milestone: implemented → tested → committed → pushed → remote SHA fetched and independently verified. No force-push; no merge to main without separate owner authorization.

## 1. Exact commits (M42 scope)

| SHA | Milestone | Content (short) |
|---|---|---|
| `bfdd034` | M42.1 | Universal specialist research contract (`agent-evidence.ts`), registry opened to all seven specialists, Tier A–G families with honest `not_integrated` rows; 13 contract tests. (Merged to main via PR #30.) |
| `dbac26a` | M42.2 | Mission integration — media task kinds run mission-scoped preflight research; persisted `researchContext` rides the specialist job row; image/video additive framing, GANGZII receipt-only; customer routes unchanged; executor integration test. |
| `6bb2d9c` | M42.3 | Scholarly + package-registry adapters (Crossref/OpenAlex/arXiv/DOAJ/npm/PyPI) with decision records + live probe. |
| `541be5d` | M42.3 fix | The shipped academic host guard referenced a renamed constant (`ALLOWED_HOSTS` undefined) — 0/7 adapters at runtime while pure tests stayed green; probe on the committed tree measured it; guard fixed + exported as `assertAcademicHostAllowed` + regression tests on the real runtime path; probe re-run 5/7 PASS, honest rows preserved. |
| `6409257` | M42.3b | Security-advisory + community adapters (OSV.dev by-id + package query, Stack Exchange, Hacker News) with decision records, UGC labeling/authority discipline, `guardedFetch` POST support (initial-hop body only), registry honesty fixes (stale rows corrected, GitLab honest row added); live probe 6/7 PASS, Stack Exchange 429 honest. Two field defects found by the probe and fixed pre-commit (wrapper-vs-Response misuse; missing non-2xx handling). |
| `a75b62b` | M42.5 | Race-loser rejection sinks at all four research-path timeout races + regression hygiene tests; live specialist-contract acceptance suite (7 consumers + fiction exclusion through the real execution path) — 9/9 PASS. Diagnosis note: the suspected "late 504 crash" was proven (tracer + exit-code capture) to be the SDK's console.error of HANDLED failures; the process exits 0 — recorded because the diagnosis discipline matters. |
| *(this commit)* | docs | This report + the four required M42 documents + worklog/HANDOFF/capability-matrix updates. |

## 2. Test evidence (all green on the committed tree)

| Suite | Result |
|---|---|
| `tests/unit/research-agent-evidence.test.ts` (contract: budgets incl. mission clamp, triggers incl. fiction exclusion, honest-null normalization, privacy redaction, framing bounds, receipt safety, academic + security/community lane merge, runtime host guards) | 17 pass / 0 fail |
| `tests/unit/research-security-community.test.ts` (dispatch incl. fiction exclusion, allowlist + runtime guard, normalization, UGC labeling + ranking discipline) | 13 pass / 0 fail |
| `tests/unit/research-timeout-hygiene.test.ts` (race-loser sinks: late loser silent, first-settling rejection surfaces, winner passes through) | 4 pass / 0 fail |
| research family (`research-direct-lane`, `research-failure`, `research-merge`, `research-quality`, `research-query-date`, `research-retry`, `research-latency`, `reach-registry`) | 80+14 pass / 0 fail (combined runs at each milestone) |
| `tests/unit/riishe-mission-executor.test.ts` (mission integration incl. the documentary-wildlife jazmii reference-handoff test) | 16 pass / 0 fail |
| eslint on every touched file | clean at every milestone |

## 3. Live evidence (real retrieval, committed machine-readable JSON)

### 3.1 Adapter probes
- **Academic lane** (`out/academic-probe.json`, fixed tree): 5/7 PASS — Crossref real DOI `10.1039/d4ta08556f/v2/review1`; DOAJ real article `10.22146/ijc.21191` (year + 3 authors); npm `zod@4.6.7` (license + homepage); PyPI `requests 2.34.2` (author + homepage); scholarly dispatch lane real DOI `10.1021/acsami.4c17586.s001`. HONEST UNAVAILABLE: OpenAlex HTTP 429; arXiv no-result this window. Superseded window disclosed: the originally committed evidence (5/7) was captured pre-commit; the committed tree actually measured 0/7 (`ALLOWED_HOSTS is not defined`) until `541be5d` — recorded and superseded, never edited in place.
- **Security/community lane** (`out/security-community-probe.json`): 6/7 PASS — `CVE-2021-23336` (aliases + modified timestamp); `lodash (npm): GHSA-29mw-wpgm-hmr9 (aka CVE-2020-28500)`; `django (PyPI): GHSA-2655-q453-22f9 (aka CVE-2012-4520, PYSEC-2012-7)`; a real Hacker News story (author/date/points, UGC-labeled); advisory + community dispatch lanes end-to-end. HONEST UNAVAILABLE: Stack Exchange HTTP 429 (shared per-IP unkeyed quota; keyed integration documented as an owner decision, not auto-enabled).

### 3.2 Specialist contract acceptance (`out/specialist-contract-acceptance.json`)
9/9 PASS through the REAL pipeline with mission-scoped budgets:
- riishe → iea.org, gminsights.com, accuracy.com (EV market, current-facts shape)
- code-giftz → npmjs.com, github.com, stackoverflow.com, zod.dev (dependency/docs shape)
- laxii → allaboutbirds-adjacent visual references; facebook records UGC-flagged
- jazmii → allaboutbirds.org, sciencenews.org (dated), nationalgeographic.com (kingfisher documentary shape)
- gangzii → guidetoiceland.is, bustravel.is (Icelandic pronunciation/subject shape)
- knowledge → cset.georgetown.edu, semiconductors.org, tandfonline.com, csis.org (semiconductor supply chain)
- quality → **nodejs.org**, endoflife.date, herodevs.com, tuxcare.com (LTS fact-check against official sources)
- fiction-exclusion ×2 → deterministic trigger refused at 0–1 ms, **zero network calls**

### 3.3 Mission path
`riishe-mission-executor` suite: a documentary-wildlife video mission completes with the verified reference block riding the jazmii delegation (framed as data, real source URL present) while the narration text stays untouched; the persisted `researchContext` survives retry/resume semantics by construction (job-row parameter) and the customer product routes demonstrably do not send it.

## 4. Acceptance matrix (M42 §14, measured)

| Category | Evidence | Class |
|---|---|---|
| Shared access | 7/7 consumers received task-relevant packs through the real pipeline/contract; media specialists additionally through the real mission path (executor suite) | PASS |
| Primary sources | nodejs.org + endoflife.date retrieved for the LTS fact-check; official pages/Direct lane standing path | PASS |
| General web | real search results with real URLs/hosts/dates in every consumer row | PASS |
| GitHub/developer docs | github.com + npmjs.com + zod.dev retrieved (coding shape); version-aware citation = the npm adapter's exact-version manifest (zod@4.6.7) | PASS |
| Academic sources | Crossref/DOAJ/npm/PyPI live; arXiv preprint labeling enforced in the adapter; OpenAlex/arXiv rate-limited in this window | PASS (with honest-unavailable rows recorded) |
| Video sources | existing YouTube/Bilibili channels host-probed (registry); transcript retrieval remains upstream-dependent — no new bypass | PASS (existing) |
| Community sources | HN story retrieved UGC-labeled + corroborate-note; Stack Exchange 429 honest; community records can never outrank official ones (authority/score pinned by tests) | PASS / HONEST UNAVAILABLE (mixed, verbatim) |
| Image/media references | Wikimedia text lanes standing; per-file license metadata adapters remain NOT INTEGRATED (honest row) | NOT INTEGRATED (disclosed) |
| Cross-agent handoff | persisted `researchContext` provenance by construction + executor integration test (block rides delegation bounded at 2,600 chars) | PASS |
| Citation support | mission-aware verifier (M41.7) refuses unsupported citations; the reference contract's citation map + footer rules carried into every pack | PASS (inherited) |
| Freshness | published/retrieved separated; cache-aware `fetchedAt`; dated sources preserved in the acceptance rows | PASS |
| Conflict handling | ranker staleness/geo warnings + degraded notes carried; contradiction disclosure remains the specialist rules' duty (docs §7) | PASS (framework) |
| Provider outage | breaker `skippedReason` + degraded notes; the SDK's handled 502/504 page-reader failures recorded verbatim in logs; never fabricated packs | PASS |
| Security | SSRF host allowlists + runtime guards pinned; guardedFetch redirect re-validation + initial-hop-only POST body; privacy redaction tests; race-loser sinks | PASS |
| Multi-tenant isolation | owner-scoped reach + M41 owner-scoped mission reads (404 cross-user, measured M41.7); per-user cache keys standing | PASS (inherited) |
| Copyright | bounded excerpts everywhere; license verbatim from official manifests; UGC/unknown-rights rules pinned | PASS |
| Product coverage | contract-level 7/7 through the real pipeline (this window) + mission-path integration test; **full five-product UI-level e2e through a running dev server was NOT run in this window** — see §6 | PARTIAL — honest |
| UI preservation | no customer route or UI file touched by M42; reference channel is mission-only; no new controls | PASS (by diff inspection) |

## 5. Platform coverage delta (this branch)

New adapters LIVE: Crossref, OpenAlex, arXiv, DOAJ, npm, PyPI (M42.3); OSV.dev, Stack Exchange, Hacker News (M42.3b). Registry corrections: npm/PyPI actions now listed on the direct row (stale omission fixed); `family-packages` not_integrated row removed; GitLab added as honest not_integrated. Remaining NOT INTEGRATED (honest): PubMed/Europe PMC, GitLab dedicated adapter, standards-body catalogue adapters, per-file image-license metadata, geo APIs.

## 6. Remaining limitations (honest)

1. **Product-level e2e through the running app** was not re-run in this window; the contract-level acceptance + mission executor suite cover the real execution paths in-process. The dev-server REST workflow run (M41.7-style) remains the acceptance step for a future owner/ops window — the sandbox's 4 GB dev-server OOM history is recorded in M39 notes.
2. **Stack Exchange** unkeyed quota is shared per-IP and measured 429 in this window; a keyed integration requires an owner-registered key (documented, not auto-enabled).
3. **OpenAlex/arXiv** rate-limited in this probe window (recorded verbatim; re-probe is one command).
4. **Reddit** stays `requires_login` (owner action on the host); no cookie copying.
5. **Disabled social platforms** (X, LinkedIn, Facebook, Instagram, Xiaohongshu, Xueqiu, Xiaoyuzhou, BOSS) stay disabled pending lawful documented APIs/approved connectors.
6. **Not integrated families**: PubMed/Europe PMC, GitLab adapter, standards catalogue, per-file image-license metadata, geo APIs — each has an honest registry row.
7. **GuardedFetch POST bodies** are never sent on redirect hops by design; no OSV redirects were observed (single-hop), so 307/308-with-body behavior beyond hop 1 is untested against real infrastructure.
