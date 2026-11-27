# M43 — Evidence Architecture

> Branch: `feat/m43-real-world-intelligence` · Milestone: M43 (stacked on the complete M42 history `9d05757`, reconciled with main `5cad5a0` at `fee31c2`)
> Status markers: **[LIVE]** = measured through the real execution path (see `docs/intelligence/M43-ACCEPTANCE-MATRIX.md`), **[FIXTURE]** = deterministic contract pinned by unit tests on controlled inputs, **[NOT INTEGRATED]** = designed but not wired. Nothing here claims more than its evidence.

## 1. What M43 adds — and what it deliberately does not

M42 gave every BEAN specialist real, bounded access to web references through ONE shared research contract. M43 turns those references into **evidence**: claim-level verification, domain-sensitive trust, honest contradiction representation, freshness policy, and knowledge retention with provenance.

M43 adds **no** second research engine, crawler, cache, vector database, memory service, intelligence product, or user-facing research mode. Every new module consumes the M42 contract (`runSpecialistResearch` / `EvidencePack`) or the records derived from it.

## 2. The module map — one layer, five concerns

| Module | Concern | Consumes | Purity |
|---|---|---|---|
| `src/lib/research/evidence.ts` | The shared claim-scoped **evidence record** (identity, dates-as-supplied, provenance, independence groups, date validation) | `SpecialistEvidencePack` | pure |
| `src/lib/research/source-trust.ts` | Domain-sensitive **authority** (host class × claim kind; frequency-immune) | evidence records | pure |
| `src/lib/research/claim-verification.ts` | **Claim-level verification** (extraction, the 8-outcome ladder, version awareness) | evidence records + the injected retriever | pure + one injected I/O seam |
| `src/lib/research/contradiction-reasoning.ts` | **Contradictions & uncertainty** (reuses the M37 measure engine; resolution only by newer-primary-supersedes) | evidence records | pure |
| `src/lib/research/freshness.ts` | **Freshness policy** (seven domains, expiry/aging/unknown, supersession chains, disappearance marks) | evidence records | pure |
| `src/lib/riishe/evidence-memory.ts` | **Traceable knowledge memory** (six classes, THE GUARD, dedupe→supersession, isolation, retraction) | evidence records + Prisma `EvidenceKnowledge` | service over a delegate boundary |

Supporting adapter: `src/lib/riishe/mission/evidence-summary.ts` — builds the additive mission-payload summary (`claims` / `uncertainty` / `evidenceAttribution` / `freshness`) from the sources a research task **actually retrieved** (no budget multiplication).

## 3. The evidence record **[LIVE]**

One normalized shape carries everything downstream:

```
EvidenceRecord
├─ evidenceId        [E1]… (stable within the set)
├─ sourceId          [S1]… (the M42 citation id — preserved through every handoff)
├─ identity          url · host · publisher(host-derived only) · author(as supplied)
│                    · publishedAt(as supplied) · updatedAt(null unless a lane supplies it)
│                    · retrievedAt(provenance)
├─ passage           bounded excerpt; null when none was captured
├─ pageRead          was the page itself read?
├─ authorityClass    authoritative | strong | corroborating | weak | user-generated
├─ authorityBasis    explainable one-line reason
├─ independenceGroup canonical key — copies of ONE original article share ONE group
├─ dateValid         true (real past date) | false (impossible) | null (absent/unparseable)
└─ role              supporting | contradicting | context
```

**Honesty invariants (unit-pinned):**
- Dates are EXACTLY as supplied upstream. Missing stays `null`; unparseable stays `dateValid: null` (unknown — never guessed); future/impossible dates are `false` and the record is **excluded from support** by the verifier.
- Publisher names come from a host-brand table or are `null` — no invented attribution.
- `canonicalSourceKey` strips tracking params (utm_*, fbclid, si, …), `www.`, fragments; `amp`/`print` mirror paths collapse; cross-host syndication collapses **only on substantive normalized titles** (≥20 chars, ≥4 significant words) — generic titles never merge distinct pages.
- Corroboration counting happens over **distinct independence groups**, never raw rows: ten syndicated copies of one article are one witness. **[LIVE]** — measured 5 records → 5 groups on the acceptance window; the collapse path is fixture-pinned.

## 4. Verification — the outcome ladder **[LIVE]**

`verifyClaim` never forces a PASS. The ladder, in decision order:

1. **source-unavailable** — records existed but every one was unusable (impossible dates).
2. **contradicted** — a contradicting independence group is STRONGER than the best support. Count never matters: three weak blogs against one government advisory is `contradicted`.
3. **partially-supported + unresolved recorded** — equal-strength disagreement (≥strong on both sides). The system **never silently picks** a preferred answer; the unresolved note is carried to deliverables.
4. **outdated** — a time-sensitive claim (current-events / statistical / security) whose entire dated support is beyond the caller's window. Overrides EVERY positive outcome.
5. **verified** — primary-authority support corroborated by ≥2 distinct independence groups.
6. **strongly-supported** — primary authority, single group; or strong support across ≥2 groups.
7. **partially-supported** — strong support, single group; corroborating support across ≥2.
8. **insufficient-evidence** — corroborating-only single group; or weak/UGC-only support (experience can never verify a fact); or nothing retrieved.
9. **unverifiable** — evidence exists but none of it supports the claim.

Explainability: every `ClaimCheck.basis[]` records the decision trail (what was excluded and why, what the decisive class was, what the contradiction did). `summarizeClaimVerification` renders the bounded honest note the UI and receipts display — including "not all statements above were independently verified".

**Version awareness:** claims referencing `vX.Y` are compared against the versions their evidence actually mentions; a full mismatch raises `versionNote` (never a silent acceptance).

## 5. Trust — authority depends on the claim **[LIVE]**

`classifyClaimKind` (deterministic) assigns one of nine kinds; the authority matrix maps **host class × claim kind**:

| Host class | Primary authority for | Otherwise |
|---|---|---|
| government | regulatory; statistical | corroborating |
| advisory (OSV/NVD/CISA/vendor-sec) | security-vulnerability | strong |
| standards-docs / vendor docs | technical-behavior | corroborating |
| academic | research-finding | corroborating |
| original data (gov data portals, WHO, WB…) | statistical | corroborating |
| reputable news | current-events; strong everywhere it reports | corroborating |
| social/UGC | community-experience (as EXPERIENCE evidence, labeled user-generated) | user-generated, never authoritative |

Manipulation immunity is structural: authority is a pure function of host class × claim kind. Popularity, repetition, SEO ranking and coordinated copies are **not inputs** — copies collapse into one independence group before any counting. UGC keeps the M42 low-authority treatment and never outranks a primary source for the same claim.

Aggregation (`summarizeEvidenceWeight`) is **class-driven, not count-driven**: twelve weak groups stay weak; one authoritative primary group decides. This is the encoded form of "a large number of weak sources must never outweigh one authoritative primary source automatically".

## 6. Contradictions — context preserved, resolution explicit **[LIVE mechanism over live evidence]**

`detectClaimContradictions` composes:
- the **M37 measure engine** (reused, never duplicated) for cross-source numeric/date conflicts anchored to a shared entity;
- **conflicting technical specs** — same unit family, different values, different independence groups;
- **conflicting regional requirements** — explicit claim regions vs evidence pinned to other jurisdictions, or universal-jurisdiction language ("every major jurisdiction") vs region-pinned evidence;
- **claim-exceeds-evidence** — universal-quantifier / causal-certainty / precision escalation of the claim beyond what the passages state; claims with NO supporting passage are flagged outright.

`resolveContradictions` marks a finding **resolvable only** when a newer primary-authority source supersedes an explicitly older one (≥30 days), with the basis stated and **both values preserved** (supersession, not deletion). Everything else stays `unresolved`, and `uncertaintyStatement` renders "What remains uncertain: …" for deliverables.

## 7. Freshness — one policy per knowledge domain **[FIXTURE contracts; LIVE set-verdict in handoffs]**

| Domain | Expired after | Revalidation | Rule |
|---|---|---|---|
| security-vulnerability | 30d | scheduled (frequent) | affected ranges move as patches land |
| software-docs | 180d | version-change | version mismatch flags supersession |
| price-availability | 7d | on-use | never presented as current when stale |
| legal-regulatory | 90d | on-use | verify jurisdiction + effective dates at use |
| science-fundamentals | 1825d | scheduled (slow) | replicate vs overturn, never silent flips |
| historical | never | none | provenance preserved permanently |
| current-events | 14d | scheduled | date-stamp everything |

A record without a usable date is `unknown` — never silently fresh, never silently expired (and `revalidationDue` is true, because unknown freshness demands a check). `supersedeRecord` chains keep the FULL previous evidence reachable (oldest first) — a previously verified claim's evidence is never destroyed by an update. `markSourceUnavailable` marks 404/410 as `gone` and other failures as `unavailable` — retained with reason + timestamp, never deleted. The module is pure: it computes due-ness for the EXISTING scheduled/demand-triggered infrastructure; it performs no polling and cannot violate rate limits.

## 8. Knowledge memory — provenance or it does not ship **[FIXTURE service contracts; schema live]**

Prisma `EvidenceKnowledge` (additive; validated; pushed to the local DB — CREATE TABLE + indexes only): user/project isolation, domain, the six classes (`permanent-foundational`, `version-sensitive`, `time-sensitive`, `project-specific`, `user-authorized`, `unverified-research-note`), claim, verification outcome, confidence, bounded `sourcesJson` attribution, independence-group count, freshness status, canonical `claimKey`, `validFrom`/`validUntil`, `supersedesId` version chains, `retractedAt`/`retractionNote`.

**THE GUARD:** a record with a null or non-positive verification outcome can NEVER be stored under a trusted class — deterministic `UnverifiedKnowledgeRefusal`. Unverified research notes are the only home for unverified statements. Expired evidence can never back `permanent-foundational`. **Never is an unverified research note turned into trusted permanent knowledge.**

Dedupe: canonical claim key + canonical-source overlap → an exact duplicate returns the EXISTING row; a same-claim write with new evidence becomes a **supersession** (`supersedesId` chain, traversable oldest-first). Retrieval: deterministic, per-user isolated on EVERY query, excludes retracted rows, excludes unverified notes unless explicitly requested, flags expired validity. Retraction is owner-scoped and retains the row. The persistence boundary follows the honest `memory-db.ts` pattern: a process holding a pre-schema Prisma client degrades to null and callers surface "initializing" — nothing is fabricated.

## 9. Where it runs **[LIVE]**

| Consumer | What it gains | Where |
|---|---|---|
| RIISHE orchestrator | claim-evidence-strength warnings + repair instruction + uncertainty in the verification note (additive to M37) | `src/lib/riishe/orchestrator.ts` |
| CODE GIFTZ | official OSV advisories appended to the tech-docs block (deterministic dispatch; UGC never enters the prompt) | `src/lib/intel/techdocs-reach.ts`, `src/lib/ai-engine/giftz-coding-handler.ts` |
| Mission research tasks | additive payload fields: claims, uncertainty, attribution, freshness | `src/lib/riishe/mission/executor.ts`, `evidence-summary.ts` |
| Quality gate | honest claim-audit notes in `verifyResearch` reasons (pass rule unchanged) | `src/lib/riishe/mission/verifiers.ts` |
| LAXII / JAZMII / GANGZII | keep the M42.2 reference contracts unchanged (attribution + rights framing already enforced); evidence flows through the same pack | mission preflight (M42.2) |

## 10. Honest limitations

- `updatedAt` is `null` on every record today — no upstream lane supplies a last-updated date; it is never invented.
- The claim verifier is deterministic. It weighs evidence it is given; it does not perform additional model-side reasoning about semantics. Deep semantic verification remains the hosted model's job inside the existing verify/correct loop.
- Direct-lane records merge into specialist packs only when the ranked pipeline left budget room (the M42 overflow-only rule). Budget-full packs stay honest — the lane remains available for direct use (acceptance #8 measures it directly).
- Knowledge memory retrieval is deterministic (domain/class/confidence/recency). Embedding-assisted recall is NOT wired into it (no duplicate vector store); the existing MiniLM lane stays on attached-document search.
- `EvidenceKnowledge` was pushed to the local sandbox DB; production DB migration is an owner operation (`bun run db:push`, additive CREATE TABLE + indexes only).
