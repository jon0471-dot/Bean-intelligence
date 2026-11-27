# M43 — Acceptance Matrix

> Recorded window: **2026-11-27** · Branch tip at recording: `dd84b44` (suite) / `9f02b04` (UI walk) · Evidence verbatim: `scripts/m43-acceptance/out/m43-evidence-suite.json` (committed)
> Classification: **PASS** = the mechanism demonstrably worked · **HONEST-UNAVAILABLE** = the real world withheld inputs, reason recorded verbatim · **FAIL** = the mechanism broke. Mode: **LIVE** = through the real research gateway (`runSpecialistResearch` → the shared pipeline, or the real OSV lane); **FIXTURE** = deterministic unit contracts on controlled inputs — never presented as live research.
> Unit suites backing every row: `tests/unit/m43-*.test.ts` (109 M43 tests; full tree 3099 pass / 0 fail / 10 standing honest skips).

## The 20 areas

| # | Area | Mode | Result | Evidence (this window) |
|---|---|---|---|---|
| 1 | Multi-source claim verification | LIVE | PASS | 1 claim checked over 5 real sources → `partially-supported` with basis (honest — no primary authority retrieved this window; never forced PASS) |
| 2 | Primary-source preference | LIVE | PASS | weight basis recorded; no official source this window → honest corroborating-only verdict instead of a forced upgrade |
| 3 | Source independence detection | LIVE | PASS | 5 records → 5 distinct independence groups; corroboration counted over groups |
| 4 | Contradiction detection | LIVE | PASS | mechanism ran over the real set (0 findings — sources agreed; honest zero) |
| 5 | Outdated source rejection | FIXTURE | PASS | historical claim over 3-year-old evidence stays supportable; current-status claim → `outdated` with the policy reason |
| 6 | Publication-date validation | LIVE | PASS | 1 valid / 4 unknown / 0 impossible; no invented dates |
| 7 | Version-sensitive documentation | LIVE | PASS | version check ran (no mismatch this window); outcome recorded |
| 8 | Security advisory verification | LIVE | PASS | REAL official advisory retrieved: CVE-2020-28500 (aka GHSA-29mw-wpgm-hmr9) from `osv.dev/vulnerability/CVE-2020-28500` via the M42.3b lane |
| 9 | Citation correctness | LIVE | PASS | [Sn] attribution numbering matches the pack 1:1 (5 sources) |
| 10 | Unsupported claim detection | FIXTURE | PASS | 3 escalations caught (universal quantifier, causal certainty, precision) |
| 11 | Source disappearance | FIXTURE | PASS | 404→gone (retained), 503→unavailable (not deleted), reasons + timestamps |
| 12 | Rate-limit recovery | LIVE | PASS | 5 sources retrieved despite lane limits; degradation notes recorded verbatim |
| 13 | Malicious prompt injection | FIXTURE | PASS | adversarial source stays weak (`insufficient-evidence`); rendered block keeps UNTRUSTED framing |
| 14 | Duplicate-source detection | LIVE | PASS | 5 URL keys → 5 unique; syndication collapse armed (0 copies this window) |
| 15 | Memory provenance | FIXTURE | PASS | row stores 5 attributed source URLs; class/outcome honest; chain traversable |
| 16 | Knowledge expiry & revalidation | FIXTURE | PASS | 30d/scheduled policy enforced; 410→gone retained; row retrievable |
| 17 | Cross-user isolation | FIXTURE | PASS | other user sees 0 rows; foreign retraction refused |
| 18 | All five product integrations | LIVE | PASS | preflight triggers fire for riishe/code-giftz/laxii/jazmii/gangzii; fiction/transform refused (0 network) |
| 19 | Real mission handoffs | LIVE | PASS | additive payload summary from the live pack: claims + attribution + freshness(`expired` stated honestly for the dated set) + uncertainty |
| 20 | Evidence-backed final deliverables | LIVE | PASS | bounded deliverable line with attribution counts, verification summary, uncertainty, [S#] citation instruction |

**Totals: 20 PASS / 0 HONEST-UNAVAILABLE / 0 FAIL (13 live + 7 fixture; 0 traced late rejections).**
Honest reading: this is ONE recorded window. Rows 1/2 PASS *because the mechanism is honest* — the live retrieval returned no official primary source, and the correct behavior was a `partially-supported` verdict, not a forced `verified`. Rate limits and availability differ per window; re-runs re-record and never overwrite history.

## Unit-test coverage by contract

| Suite | Tests | Pins |
|---|---|---|
| m43-evidence-trust | 23 | records, canonical keys, syndication, date validation, authority matrix, class-driven weight |
| m43-claim-verification | 22 | extraction, the full outcome ladder, contradiction/equal-strength/outdated/version rules |
| m43-contradictions | 16 | M37 reuse, specs, regional, claim-exceeds, resolution rules, uncertainty statement |
| m43-freshness | 13 | seven policies, unknown-state honesty, supersession chains, disappearance marks |
| m43-evidence-memory | 18 | THE GUARD, dedupe→supersession, isolation, retraction, bounds, handoff block |
| m43-integrations | 7 | giftz advisory enrichment (UGC exclusion, no-op purity, honest degrade), payload summary, pass-rule preservation |
| m43-security | 10 | inert injection, credential redaction, isolation, UGC caps, bounded rendering, no-fetch evidence layer |
| **M43 total** | **109** | |

## Adjacent gates recorded this milestone

- Full suite: **3099 pass / 0 fail / 10 standing honest skips** (231 files; M42 recorded 2990/0/10 — the +109 delta is M43).
- tsc: zero errors in changed files (18 pre-existing baseline errors untouched).
- eslint: clean on every touched file.
- prisma: schema valid; additive push applied (CREATE TABLE + indexes; 0 rows touched).
- Production build: `next build` exit 0 (BEAN_BUILD_NO_STANDALONE=1).
- Live UI walk: `validation/m43-ui/` (5 screenshots + console record) — 0 page errors, UI unchanged.
- Suite-found defects fixed before completion: the narrowed `techdocs-reach` mock (M43.11 — bisected to the exact pair, baseline verified 0-fail) and the recycled-sandbox vocab/pRisma-client environment restores (recorded, never weakened any test).
