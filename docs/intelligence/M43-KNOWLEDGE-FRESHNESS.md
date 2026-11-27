# M43 — Knowledge Freshness Policy

> How BEAN decides knowledge is fresh, aging, expired or unknowable — and how updates preserve history. Companion to `docs/intelligence/M43-EVIDENCE-ARCHITECTURE.md`. Status markers as in the architecture doc.

## 1. Not all knowledge changes at the same rate **[FIXTURE contracts]**

| Domain | Expired after | Aging after | Revalidation | Rationale |
|---|---|---|---|---|
| security-vulnerability | 30 days | 7 days | scheduled, frequent | advisories change as patches land; affected-version ranges move |
| software-docs | 180 days | 90 days | on version change | documentation truth is version-scoped; a version mismatch flags supersession |
| price-availability | 7 days | 2 days | near the time of use | stale prices are never presented as current |
| legal-regulatory | 90 days | 30 days | at use (jurisdiction + effective dates) | amendments supersede older texts; jurisdiction matters |
| science-fundamentals | 1825 days | 730 days | scheduled, slow | fundamentals revalidate slowly; replicate vs overturn, never silent flips |
| historical | never | never | none | facts do not expire; provenance is preserved permanently |
| current-events | 14 days | 3 days | scheduled | events age in days; date-stamp every statement |

Domain classification is deterministic (`classifyKnowledgeDomain` + claim-kind fallback). **Unclassifiable text is treated as time-sensitive** — the conservative default; when freshness is unknown, the system behaves as if it might be stale, not as if it is current.

## 2. The four states **[FIXTURE-pinned; LIVE set-verdicts in mission payloads]**

- `fresh` — within the domain window, with a stated reason.
- `aging` — beyond the aging threshold: recheck recommended (revalidationDue = true).
- `expired` — beyond the max window: identified with the policy reason; the verifier's outdated rule turns expired time-sensitive support into the `outdated` claim outcome; expired evidence can never back `permanent-foundational` knowledge.
- `unknown` — **no usable publication date**. Never silently fresh, never silently expired; `revalidationDue = true` because unknown freshness demands a check. Upstream lanes that supply no date keep producing honest `unknown` records — dates are never invented to satisfy a policy.

## 3. Version awareness **[FIXTURE]**

Software-docs records expose the highest major version they mention (`highestMajorVersion`). The claim verifier compares claim versions against evidence versions: a full mismatch raises `versionNote` ("every supporting source speaks of a different version — the evidence may not describe this version's behavior"); a partial mismatch is flagged too. Version-sensitive knowledge records exist precisely for this class.

## 4. Updates never destroy history **[FIXTURE]**

`supersedeRecord` moves the current pointer and appends the predecessor to a chain (oldest first, depth-capped). In knowledge memory, a same-claim write with new evidence becomes a row with `supersedesId`, and `knowledgeChain` traverses the full lineage. A previously verified claim's evidence and provenance survive every update — "never silently update a previously verified claim" is enforced structurally, not by convention.

## 5. Source disappearance **[FIXTURE]**

- HTTP 404/410 → `gone`: the source no longer exists. The record and its provenance are RETAINED; claims must not rely on it alone.
- Other failures (5xx, network) → `unavailable`: marked, not deleted; revalidation may restore it.
- Both marks carry the reason and `markedAt` timestamp. Retrieval-based knowledge stays usable with the disappearance noted; nothing is fabricated to fill the hole.

## 6. Revalidation runs on the EXISTING infrastructure **[NOT a new poller]**

The freshness module is pure date math + policy. It computes `revalidationDue` for:
- the pipeline's existing freshness follow-up query (one bounded re-query when evidence is stale — M42 behavior, unchanged);
- demand-triggered re-checks when a consumer needs a value near use (prices, legal effective dates);
- the mission scheduler's existing task model (a future `revalidate-knowledge` task kind can consume `revalidationDue` rows without any new polling loop).

There is no background crawler, no periodic site polling, no rate-limit pressure added by M43.

## 7. What the UI shows **[LIVE]**

Nothing new — deliberately. Freshness surfaces through the EXISTING surfaces: staleness warnings, the verification note, mission payload `freshness` fields and the honest availability chips. No freshness dashboard, no expiry settings panel.
