# Knowledge Schema and Relationships

Atlas ID: ATLAS-01 · Review date: 2026-11-24 · Status: documented · Parent: `README.md`

This document defines the structural conventions every atlas document follows: the document header
block, the content discipline, the reusable **action schema** for human movement, the cross-domain
relation vocabulary, and the citation format. Consistency here is what allows RIISHE to resolve
sections, compare documents and carry citations rather than just "knowing" a fact.

---

## 1. Document header block

Every atlas document begins with exactly this header pattern (fields on individual lines, no YAML
front-matter, so plain Markdown tooling stays usable):

```
# <Title>

Atlas ID: ATLAS-<NN> · Review date: YYYY-MM-DD · Status: <status-label> · Parent: <parent-doc>
```

- `Atlas ID` — stable identifier matching the file number (`ATLAS-04`, `ATLAS-13`, ...; foundation
  docs use `ATLAS-ROOT` and `ATLAS-00`–`ATLAS-03`).
- `Review date` — the date the content was last reviewed against its sources (UTC, `YYYY-MM-DD`).
- `Status` — one or more completeness labels from `README.md` §5 (typically `documented`).
- `Parent` — the file this document logically reports to (`README.md` for domain guides).

## 2. Content discipline

1. **Sections are numbered** (`## 1.`, `## 2.`, ...) so retrieval can cite "ATLAS-06 §3.2" precisely.
2. **Key facts are atomic sentences.** One claim per sentence where possible; RIISHE grounds claims
   at sentence level.
3. **No invented citations.** A reference either exists in `02-source-provenance-and-licensing.md`
   or the public record (publisher + title + URL + access date), or it is not written. Where a
   statement rests on general scientific consensus without a single citable page, it is attributed
   to the registered textbook-level source (e.g. OpenStax *Anatomy and Physiology 2e*).
4. **Uncertainty is explicit.** Disagreements, hypotheses and individual variation are marked as
   such in prose ("sources differ...", "current hypothesis...", "varies widely between individuals").
5. **No clinical, legal or financial authority.** Anatomy/movement content describes structure,
   function and mechanism — never diagnosis or treatment instructions.
6. **Links resolve.** Cross-references use relative Markdown links between atlas files; external
   links use the canonical upstream URL recorded in `02`.
7. **English is the working language** of the atlas (the repository's product language); RIISHE
   translates explanations on demand through its existing language layer.

## 3. The action schema (human movement)

`06`–`08` describe human actions using this schema. Each action entry follows the same twelve
fields so RIISHE can reason about *how an action happens*, compare actions and detect failure
modes — rather than memorising action names.

```markdown
### <Action name>
- **Class:** <posture | locomotion | manipulation | communication | daily-activity | performance | fall-recovery>
- **Initial posture:** <body configuration before the action>
- **Body parts involved:** <list>
- **Joint movements:** <primary joints with movement names (flexion/extension/...), per phase>
- **Muscle groups and forces:** <agonist/antagonist/stabiliser roles; force type (concentric/eccentric/isometric)>
- **Phases:** <preparation → execution → recovery, with transitions>
- **Balance and centre of mass:** <CoM behaviour, base of support changes>
- **Speed, acceleration, trajectory:** <typical qualitative/quantitative profile>
- **Ground/object interaction:** <contact points, friction or manipulation demands>
- **Environmental constraints:** <surfaces, space, obstacles, load>
- **Common variations:** <named variants and how they differ>
- **Failure modes and limitations:** <what goes wrong and the biomechanical reason>
- **References:** <registered source refs + motion datasets where available>
```

Fields are omitted only when genuinely inapplicable (e.g. "ground interaction" for a facial
expression) — the omission must be plausible, never lazy.

### 3.1 Movement-class vocabulary (controlled)

Action entries use these controlled values for `Class`:

`posture` · `locomotion` · `manipulation` · `communication` · `daily-activity` · `performance`
(dance/sports/martial arts) · `fall-recovery`.

### 3.2 Gait-phase vocabulary (controlled, for locomotion entries)

Walking/running entries use the standard cycle phases: `initial contact → loading response →
mid-stance → terminal stance → pre-swing` (stance period) and `initial swing → mid-swing → terminal
swing` (swing period). Running keeps the same functional phases plus explicit flight periods.

### 3.3 Joint-movement vocabulary (controlled)

`flexion · extension · hyperextension · abduction · adduction · medial (internal) rotation · lateral
(external) rotation · pronation · supination · dorsiflexion · plantarflexion · inversion · eversion ·
elevation · depression · protraction · retraction · circumduction · lateral flexion`.

## 4. Cross-domain relation vocabulary

Documents reference each other with these controlled relation types (used in each document's
"Relationships" section and usable by RIISHE to traverse the atlas):

| Relation | Direction | Example |
|---|---|---|
| `grounds-in` | doc → source/doc | biomechanics claims ground in physics mechanics |
| `explains-mechanism-of` | doc → doc | anatomy explains mechanism of locomotion |
| `specialises` | doc → doc | bird flight specialises animal locomotion |
| `generalises` | doc → doc | taxonomy generalises species locomotion |
| `constrains` | doc → doc | physics constrains achievable jump heights |
| `applies-to` | doc → doc | action schema applies-to dance forms |
| `contrasts-with` | doc ↔ doc | mammalian vs arthropod skeletons contrast |
| `evidenced-by` | doc → dataset | gait phases evidenced-by motion datasets |

A document's Relationships section lists its neighbours as a table of
`relation → target file → what crosses the boundary`, e.g.:

```markdown
## N. Relationships
| Relation | Target | Boundary note |
|---|---|---|
| grounds-in | 16-physics-motion-forces-and-energy.md | levers, torques, energy |
| specialises | 14-animal-locomotion-behaviour-and-communication.md | human gait as a primate locomotion case |
```

## 5. Citation format

In-text: bracketed short refs like `[OpenStax A&P 2e §10.4]` or `[Uberon:0000982]` (ontology term
IDs where they exist). Full records live in `02-source-provenance-and-licensing.md`; a document's
References section lists only the refs it actually uses, each with publisher, URL and access date.

## 6. Retrieval index contract (for the RIISHE atlas tools)

- The RIISHE tools `search_atlas` and `read_atlas_doc` (in
  `src/lib/riishe/tools/atlas.ts`) resolve a free-text topic to ranked
  document+section candidates by scanning the ACTUAL files under this
  directory at load time (cached per process). Because the index is derived
  live from the files, it can never drift from reality — there is no
  hand-maintained list to go stale.
- `search_atlas` ranks sections with deterministic term-overlap scoring
  (title > heading > body) and reports the scores; `read_atlas_doc` pages a
  document or a single section (mirrors the existing `read_document` paging
  contract: offset + bounded characters, honest end-of-document note).
- Section citations produced from atlas reads are formatted `ATLAS-<NN> §<section>` so they render
  in RIISHE's citation list like any other source, with the file path as the locator.
- When the library directory is absent (a deployment without the docs tree), both tools report the
  gap honestly — nothing is synthesized in its place.

## 7. Versioning and traceability

- The atlas is versioned with the repository itself: a document's "version" is the git blob of its
  file at a given commit. RIISHE can cite `ATLAS-06 @ <commit>` when traceability matters.
- Content edits update `Review date` and, where sources change, the register in `02`.
- The coverage map and gap list are re-validated by the atlas test suite on every change
  (existence, schema conformance, link resolution, minimum substance) — see
  `03-coverage-gaps-and-update-policy.md` §5.
