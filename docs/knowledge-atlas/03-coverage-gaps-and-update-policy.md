# Coverage Gaps and Update Policy

Atlas ID: ATLAS-03 · Review date: 2026-11-24 · Status: documented · Parent: `README.md`

This document records what the atlas does **not** yet cover, why, and how the atlas grows and gets
reviewed. An honest gap list is a feature: it lets RIISHE say "this is outside my documented
knowledge" instead of improvising.

---

## 1. Principles

1. **"Not yet documented" ≠ "does not exist."** Gaps are statements about this library only.
2. **Gaps are actionable.** Each gap names the next concrete step (which document, which sources,
   which license checks).
3. **Coverage is never claimed as complete.** No atlas document or RIISHE response may assert
   exhaustive world knowledge.
4. **Scientific disagreements are preserved.** Where sources conflict, documents record both
   positions with their evidence strength; RIISHE must not silently resolve disputes (see §4).

## 2. Current gap register (2026-11-24)

| # | Gap | Domain | Why it exists | Next step |
|---|---|---|---|---|
| G1 | Quantitative biomechanics depth (EMG activation tables, force-plate norms, joint torque datasets) | Human movement | Curated qualitative action schema is in place; numeric normative data needs careful per-population sourcing with license checks | Add a quantitative annex to `05` only with licensed, citable datasets (e.g. open gait-report datasets registered in `02`) |
| G2 | Per-species pages for animals | Animals | The atlas covers clade-level structure; species detail is enormous and GBIF already carries authoritative species records | Add species pages only where a concrete RIISHE use case needs them; link GBIF dataset records instead of duplicating |
| G3 | Advanced physics depth (general relativity, quantum field theory, particle physics) | Physical world | `16`/`21` give conceptual introductions; deep coverage needs a dedicated advanced-physics document with rigorous sourcing | Create `30-advanced-physics.md` when reasoning quality demands it |
| G4 | Deep national histories and individual biographies | Human world | `22` records structures and long arcs; fine-grained history is vast and politically sensitive to summarise | Expand per-region history pages incrementally with primary/academic sources |
| G5 | Per-model AI catalogue pages | AI & agents | The live authoritative per-backend state is the code registry (`src/lib/registry/`); static pages would drift from reality | Keep the split: code registry = runtime state; `27` = durable concepts. Re-evaluate only if a stable model catalogue format proves useful |
| G6 | Motion-X / AMASS / HumanML3D data integration into a commercial product | Movement datasets | Licenses are non-commercial (`02` §2); commercial use needs separate authorization | Blocked until the owner obtains licenses; research/education uses may proceed under the recorded terms |
| G7 | Scanned-document OCR knowledge (document image analysis) | Document intelligence | Recorded in M36/M37 as an honest gap pending a docling sidecar decision | Track in the AI domain docs; not an atlas gap per se |
| G8 | Languages beyond English-structure exemplars | Languages | `23` covers universal structure with a few exemplars | Add per-family language pages when multilingual product needs grow |

## 3. Update workflow

When new content is added:

1. **Draft** a new document following `01-knowledge-schema-and-relationships.md` (header block,
   numbered sections, action schema for movement entries, controlled vocabularies).
2. **Register sources** in `02-source-provenance-and-licensing.md` — publisher, URL, version,
   license, commercial-use flag, attribution, limitations, access date. No registration, no merge.
3. **Update the coverage map** (`00`) — move subtopics from `not-yet-covered` to `documented`, add
   the file to the master table and the aggregate snapshot with the date.
4. **Close or narrow a gap** — update the register in this file (§2) with what changed.
5. **Run the atlas test suite** — see §5. All checks must pass.
6. **Commit with a milestone-prefixed message** on the working branch; the review date in the
   header must change if content (not just formatting) changed.

## 4. Dispute and uncertainty policy

- Where established sources disagree (e.g. classification of a species, mechanisms of a disease,
  dates of historical events), the document states the mainstream position, the main alternatives,
  and the evidence basis — in prose, marked as disagreement.
- RIISHE carries disagreement forward: answers must not silently pick one side when the atlas
  records a dispute; they name the uncertainty.
- Hypotheses are labelled as hypotheses. Individual variation (biological, cultural) is labelled
  as variation, never averaged away.

## 5. Automated checks (the atlas test suite)

The atlas is guarded by `tests/unit/atlas-library.test.ts` (M38):

1. **Existence** — all 31 required files exist under `docs/knowledge-atlas/`.
2. **Schema conformance** — every document has the header block (`Atlas ID`, `Review date`,
   `Status`, `Parent`), numbered `##` sections, and a References section.
3. **Substance** — minimum body size per document (no stubs); no placeholder markers
   (`TODO`, `TBD`, `XXX`, `lorem`).
4. **Link integrity** — every relative Markdown link between atlas files resolves to an existing
   file.
5. **Coverage-map consistency** — the coverage map's master table lists exactly the files that
   exist; the aggregate snapshot's file count matches reality.
6. **License register sanity** — every non-commercial dataset mention is paired with the
   commercial-use warning text (guarding the G6 rule in prose).

## 6. Review cadence

| Scope | Cadence |
|---|---|
| License re-verification for sources used by active features | before any release that newly depends on them; otherwise quarterly |
| Coverage map + gap register | every atlas expansion (mandatory) |
| Full content review of a domain guide | when its sources publish a new edition/version, or at least yearly |
| Disputed-claim re-check | when a cited source updates or retracts |

## 7. Honest limits of this policy

- Reviews re-check recorded sources; they cannot detect silent upstream link rot between checks —
  links carry access dates so staleness is visible.
- The atlas contains no medical, legal or financial advice by design; gaps toward clinical content
  (G1 note in `00` §1) are deliberate boundaries, not omissions.
