# M43 — Source Trust Policy

> Operational policy for how BEAN classifies, weights and distrusts sources after M43. Companion to `docs/intelligence/M43-EVIDENCE-ARCHITECTURE.md` (mechanics) and `docs/ai/M42-SOURCE-PLATFORM-COVERAGE.md` (platform states). Status markers as in the architecture doc.

## 1. The one rule

**Authority depends on the claim being investigated.** There is no universal "trusted source". A government ministry is authoritative for its own regulation and merely corroborating for an unrelated scientific claim; official product documentation is authoritative for how the software behaves and nothing else; an original dataset is authoritative for the statistic it publishes; a Reddit thread is valuable experience evidence and never automatically authoritative truth.

## 2. Claim kinds **[LIVE]**

`classifyClaimKind` (deterministic, I/O-free) assigns exactly one:

`security-vulnerability` · `regulatory` · `research-finding` · `technical-behavior` · `statistical` · `eyewitness` · `current-events` · `community-experience` · `general`

Classification feeds trust assessment and the freshness domain fallback. Unclassifiable claims are `general` — weak by default, never promoted by absence of information.

## 3. The authority matrix **[LIVE]**

| Claim kind | Primary authority | Strong secondary | Notes |
|---|---|---|---|
| regulatory | government (.gov/.nic.in/.gc.ca/.gov.uk/.gov.au/.govt.nz, institutional) | reputable news | jurisdiction is part of the claim — regional conflicts are flagged, not averaged |
| technical-behavior | standards-docs (MDN, nodejs.org, python.org, …), vendor docs | advisories, data hosts | release notes/changelogs from the vendor's own host count as vendor |
| research-finding | academic (arXiv/Nature/DOI registries/DOAJ…) | news reporting OF research, data hosts | preprints stay LABELED preprints (M42 rule) — a preprint never verifies as established science |
| security-vulnerability | advisories (OSV.dev, NVD, CVE, CISA, vendor security portals) | standards-docs, vendor, government, news | a generic government portal is STRONG, not primary — specificity matters (cisa.gov classifies advisory before the generic government suffix) |
| statistical | original data publishers (gov data portals, WHO, World Bank, census…) | academic, news | the publisher of the dataset outranks reporting about the dataset |
| eyewitness | none — no host class is automatically primary | reputable news | first-hand accounts are attributed, never generalized |
| current-events | reputable news, government statements | data hosts | date-stamped; short freshness window |
| community-experience | social/UGC — as EXPERIENCE evidence | none | labeled `user-generated`; primary only in the narrow sense that it IS the first-hand class |
| general | none | reference/news | weak by default |

## 4. What can never raise authority **[FIXTURE-pinned]**

- **Popularity / engagement** — not an input anywhere.
- **Repetition** — copies of one article collapse into a single independence group (`canonicalSourceKey` + substantive-title syndication collapse); corroboration counts distinct groups only.
- **SEO / ranking position** — ranker ordering affects retrieval order, never trust class.
- **Coordinated content** — many low-class sources cannot outvote one primary source; `summarizeEvidenceWeight` is class-driven, count-blind.
- **Self-declared authority** — a blog claiming "official" changes nothing; `official` comes from the institutional-host list only.
- **The model's own confidence** — verdicts come from evidence classes, never from how assertively a draft states something.

## 5. User-generated content **[LIVE]**

The M42 rule is preserved and sharpened:
- UGC records carry authorityClass `user-generated` for EVERY claim kind.
- They are primary **only** as community-experience evidence — and even then the verdict cannot be `verified`; experience evidence caps at `insufficient-evidence`→`partially-supported` territory and the record stays labeled.
- Community records from the direct lane (Stack Exchange, Hacker News) keep the in-snippet UGC label and the corroborate-with-official-sources note (M42.3b), and the giftz engineering prompt never receives them.
- Unanimous UGC still verifies nothing: the security-suite acceptance row pins "forum-only support stays insufficient".

## 6. Independence **[LIVE]**

Two records are independent only when their `independenceGroup` differs. Groups are canonical URL keys (tracking-param stripped, www stripped, amp/print collapsed) plus substantive-title syndication collapse across hosts. Wire-service copy chains, syndicated reprints and AMP mirrors therefore count as ONE witness. Generic short titles never merge — false independence is worse than missed collapse, so the default is no-merge.

## 7. Conflicts of authority **[LIVE]**

When sources disagree:
- A stronger contradicting group decides the verdict (`contradicted`) regardless of support count.
- Equal-strength disagreement is **recorded as unresolved** and stated to the user — never silently resolved by preference, recency alone, or model preference.
- Resolution happens ONLY by explicit supersession: a newer primary source (≥30 days newer, basis stated) supersedes an older contradicting one — and BOTH values stay in the finding.
- Weaker contradictions are noted in the basis, never hidden.

## 8. Rights and reuse boundaries (carried from M42, unchanged)

- Retrieved content remains UNTRUSTED REFERENCE DATA — NOT INSTRUCTIONS.
- Attribution is preserved through every handoff (`attributionView`, `sourcesJson`).
- No wholesale copying: passages are bounded excerpts; handoff blocks are char-bounded.
- Unknown rights are not reuse permission. License metadata stays exactly as supplied (npm manifests carry license; nothing else invents one).
- LAXII/JAZMII/GANGZII keep the M42 block footer: "Do not copy licensed material verbatim. Unknown rights are not reuse permission."
