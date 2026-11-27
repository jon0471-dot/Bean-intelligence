# M43 — Contradiction & Uncertainty Handling

> How BEAN detects, represents, resolves (rarely) and states disagreements. Companion to `docs/intelligence/M43-EVIDENCE-ARCHITECTURE.md`. Status markers as in the architecture doc.

## 1. Principles **[LIVE]**

1. **Preserve the context of every disagreement** — both sides keep evidence ids, values, dates and a note. Nothing is collapsed into "sources disagree" without saying who said what.
2. **Never silently select** whichever answer the model (or the ranker, or the recency sort) prefers.
3. **Resolution must be earned** — only an explicitly newer primary-authority source supersedes an explicitly older contradicting one; the basis is recorded; both values remain.
4. **When evidence cannot resolve a contradiction, say what remains uncertain** — in the verification note, in mission payload `uncertainty`, and in deliverables.
5. **A claim can also contradict its own evidence** — stating MORE than the sources show is a finding (claim-exceeds-evidence), and the repair pass instructs the composer to weaken the statement to the strength the evidence supports.

## 2. What is detected **[LIVE mechanism over real evidence]**

| Kind | Trigger | Source |
|---|---|---|
| conflicting-numerical-values | same measure unit, same entity anchor, different canonical values, different sources (M37 engine, REUSED) | `riishe/contradictions.ts` via `detectClaimContradictions` |
| conflicting-dates | same entity, different calendar dates (M37 engine) | same |
| conflicting-technical-specs | same spec unit family (% / MB / requests / …), different values, DIFFERENT independence groups | `research/contradiction-reasoning.ts` |
| outdated-vs-current | resolvable class: newer primary supersedes older | resolver |
| conflicting-regional-requirements | claim region vs evidence pinned to another jurisdiction; or universal-jurisdiction language vs region-pinned evidence | same |
| conflicting-product-info / scientific / legal | carried by the kind vocabulary; surfaced through numeric/spec/regional detectors where the shapes match | vocabulary |
| unsupported-causal / claim-exceeds-evidence | causal-certainty, universal-quantifier or precision escalation of the claim beyond the passages; claims with no supporting passage at all | `detectClaimExceedsEvidence` |

Conservative by design: identical values are never flagged; single-region evidence never triggers regional findings; the M37 sentence-initial-anchor rule (a capitalized token that merely starts a sentence is not a proper noun) stays untouched — a missing match is the honest default.

## 3. RIISHE chat integration **[LIVE]**

The orchestrator already ran the M37 cross-source audit and fed disagreements into the repair prompt. M43 adds, additively:

- `claim-evidence strength` verification entry — when the ANSWER exceeds its cited evidence (escalation findings), with the specific notes;
- a repair-prompt item instructing: "state each at the strength the evidence actually supports, preserving its citation";
- the uncertainty statement appended to the contradiction note ("What remains uncertain: …");
- threading through both post-process passes so the repair result is re-audited with the same lens.

The pass/fail rules, injection gates and citation audits are untouched — the M43 layer can only ADD honest warnings, never remove existing ones.

## 4. Mission payloads **[LIVE]**

Research tasks attach `uncertainty` (the bounded statement) plus per-claim outcomes. `verifyResearch`'s pass rule is UNCHANGED (source counts) — contradicted or weak claims ride in the reasons as quality-trail audit notes: "claim audit: N statement(s) are contradicted by stronger evidence — they must not be presented as established fact". Quality agents therefore see the same honest picture without any gate change.

## 5. Uncertainty statements **[LIVE]**

`uncertaintyStatement` renders at most ~480 chars: the leading unresolved disagreement (subject + both values + evidence ids), a count of further open disagreements, and up to two unresolved-claim notes. Empty when nothing is unresolved — the function never fabricates uncertainty where the evidence agrees.

## 6. What this does NOT do (honest boundaries)

- It does not decide truth by vote, average, or model preference.
- It does not hide weaker contradictions (they are noted, not dropped).
- It does not resolve equal-strength scientific disagreement — that stays explicitly open, because collapsing it would fabricate certainty.
- It does not perform model-side semantic reconciliation; the deterministic layer feeds the existing hosted verify/correct loop, which remains the semantic judge within its own honest bounds.
- Spec conflicts across DIFFERENT products/versions are version-mismatch information, not necessarily contradictions — the version-awareness note distinguishes them.
