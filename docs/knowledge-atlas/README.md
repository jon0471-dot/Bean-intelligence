# RIISHE World Knowledge Atlas

Atlas ID: ATLAS-ROOT · Review date: 2026-11-24 · Status: Foundation v1 (M38)
Maintainer: BEAN Intelligence (RIISHE knowledge program) · Branch: `feat/m38-world-atlas-adaptive-ai-creative-engine`

## 1. What this atlas is

This is a curated, source-backed Markdown knowledge library that RIISHE can consult through its
existing retrieval and document-grounding architecture. Each document is a structured reference on
one domain of the real world: what is established, how it connects to neighbouring domains, which
sources and datasets carry the underlying evidence, which licenses apply, and what is **not yet
covered**.

Three honest scope statements, stated up front:

1. **This atlas is finite.** A collection of Markdown files does not contain every fact in
   existence. `00-world-knowledge-coverage-map.md` records what is documented, what is only
   source-indexed, and what is not yet covered. "Not yet documented" never means "does not exist".
2. **This atlas is a reference, not a source of authority.** RIISHE must attribute every
   atlas-derived statement to the document and its listed upstream sources, and must prefer the
   original sources for high-stakes questions. The atlas does not grant clinical, legal or
   engineering authority.
3. **This atlas is versioned and reviewable.** Every document carries an `Atlas ID` and a
   `Review date`. Claims are tied to sources in `02-source-provenance-and-licensing.md`. Updates
   follow `03-coverage-gaps-and-update-policy.md`.

## 2. What this atlas is not

- It is **not** a second vector database, a second memory service, or a competing RAG pipeline.
  RIISHE reads these documents through the existing RIISHE tool architecture (a dedicated atlas
  tool that pages through the indexed documents, plus the existing document-grounding pipeline).
  There is exactly one retrieval architecture in BEAN.
- It is **not** a bulk copy of books, datasets, images or videos. No dataset files are committed to
  this repository. The atlas stores curated descriptions, ontology-term references, source-linked
  summaries and license records, and points to the authoritative upstream location for anything
  heavier.
- It is **not** a silent knowledge dump into prompts. Atlas content enters a conversation only
  through an explicit retrieval step with visible citations, bounded like every other evidence
  source in RIISHE.

## 3. Document set (M38 initial)

Every document uses the schema defined in `01-knowledge-schema-and-relationships.md` (header block,
key-facts discipline, relationship section, references with access dates, review date).

### Foundation

| File | Scope |
|---|---|
| `00-world-knowledge-coverage-map.md` | Master taxonomy, per-domain completeness, known gaps |
| `01-knowledge-schema-and-relationships.md` | Document schema, action/movement schema, cross-domain relation model |
| `02-source-provenance-and-licensing.md` | Source and dataset register: provenance, licenses, attribution, commercial-use flags |
| `03-coverage-gaps-and-update-policy.md` | Gap list, update workflow, review cadence, dispute policy |

### Human anatomy and movement

| File | Scope |
|---|---|
| `04-human-anatomy-and-physiology.md` | Cells, tissues, organ systems, skeleton, muscles, joints, nervous, cardiovascular, respiratory, digestive, endocrine, immune, urinary, reproductive, skin, senses, growth and variation |
| `05-human-biomechanics-and-locomotion.md` | Biomechanical principles, gait, running, jumping, load handling, posture mechanics |
| `06-human-actions-gestures-and-motion.md` | The structured action ontology: postures, transitions, object interaction, communication gestures, daily activities |
| `07-human-dance-sports-and-performance.md` | Dance forms, sports movements, martial arts, athletics, performance |
| `08-human-falls-impact-balance-and-recovery.md` | Balance control, slips, trips, falls, protective responses, landing mechanics, recovery |

### Animals and living organisms

| File | Scope |
|---|---|
| `09-animal-kingdom-taxonomy-and-evolution.md` | Metazoan diversity, major phyla, evolutionary relationships |
| `10-vertebrate-anatomy-and-physiology.md` | Comparative vertebrate anatomy and physiology |
| `11-insects-and-arthropods.md` | Arthropod body plans, insect systems, metamorphosis, colony behaviour |
| `12-invertebrates-and-other-animal-groups.md` | Molluscs, annelids, cnidarians, echinoderms, sponges and other groups |
| `13-bird-anatomy-flight-and-aerodynamics.md` | Wing and feather anatomy, flight physics, stroke phases, manoeuvring, migration |
| `14-animal-locomotion-behaviour-and-communication.md` | Terrestrial/aquatic/aerial locomotion across species, gaits, behaviour, communication |
| `15-plants-fungi-microbes-and-ecosystems.md` | Plant, fungal, microbial life; ecosystem structure and function |

### Physical world

| File | Scope |
|---|---|
| `16-physics-motion-forces-and-energy.md` | Kinematics, dynamics, energy, momentum, fluids, thermodynamics, electromagnetism, waves, optics, acoustics |
| `17-chemistry-atoms-molecules-and-reactions.md` | Atoms, bonding, reactions, organic chemistry, states of matter |
| `18-materials-and-engineering-science.md` | Material classes, mechanical properties, engineering disciplines |
| `19-earth-oceans-weather-and-climate.md` | Geology, plate tectonics, oceans, atmosphere, weather, climate |
| `20-ecology-evolution-and-environment.md` | Ecological principles, evolution, population biology, environmental dynamics |
| `21-astronomy-and-space.md` | Solar system, stellar evolution, galaxies, cosmology, planetary science |

### Human world and technology

| File | Scope |
|---|---|
| `22-human-history-culture-and-society.md` | Historical periods, cultural dynamics, social structures, economics, politics |
| `23-languages-communication-and-social-behaviour.md` | Language structure, acquisition, nonverbal communication, social behaviour |
| `24-technology-engineering-and-computing.md` | Computing, electronics, robotics, networks, software engineering practice |
| `25-architecture-art-music-and-visual-design.md` | Architectural principles, art movements, music theory, visual design fundamentals |
| `26-professional-software-ui-ux-and-motion-design.md` | Professional UI/UX practice, design systems, motion design discipline (mirrors the CODE GIFTZ standards in `docs/agents/`) |

### AI and agent knowledge

| File | Scope |
|---|---|
| `27-ai-models-inference-and-multimodal-intelligence.md` | Model families, inference runtimes, multimodal capabilities, honest capability/limitation framing |
| `28-agent-planning-tools-verification-and-recovery.md` | Planning, tool use, verification loops, failure recovery, agent safety |
| `29-professional-code-generation-and-product-engineering.md` | Professional engineering workflow, quality gates, delivery discipline for code-generating agents |

## 4. How RIISHE uses this atlas

1. **Retrieval.** A dedicated RIISHE tool (`search_atlas` / `read_atlas_doc`) resolves a topic to
   the relevant documents and sections using the index in `00-world-knowledge-coverage-map.md` and
   the per-document section structure. The tool pages content the same way the existing
   `read_document` tool does, so the orchestrator's bounded tool loop treats atlas content exactly
   like request-attached documents.
2. **Grounding and citations.** Atlas content enters answers with the same citation discipline as
   web evidence: section-level attribution, no silent substitution of general knowledge when the
   user asks for grounded answers, and explicit "the atlas does not cover this" when a topic is
   outside the current coverage map.
3. **Cross-domain reasoning.** The relation model in `01-knowledge-schema-and-relationships.md`
   lets RIISHE connect anatomy to biomechanics, biomechanics to physics, species to locomotion,
   and actions to failure modes, instead of memorising isolated facts.
4. **Uncertainty handling.** Where scientific sources disagree or evidence is partial, documents
   record the disagreement (see `03-coverage-gaps-and-update-policy.md` §4). RIISHE must carry that
   uncertainty through to the user rather than silently resolving it.

## 5. Completeness vocabulary

The atlas uses exactly these status labels — both in each document header and in the coverage map:

| Label | Meaning |
|---|---|
| `documented` | The document exists with substantive, source-linked content in this library |
| `source-indexed` | Upstream sources are registered in `02-source-provenance-and-licensing.md` with license status |
| `dataset-available` | A public dataset/ontology is registered and locatable (not committed to this repo) |
| `license-verified` | The license has been checked at the recorded version and commercial-use implications recorded |
| `integrated-into-retrieval` | RIISHE's atlas tool can resolve and page this document |
| `tested-by-riishe` | Automated tests exercise retrieval and grounding over this document |
| `not-yet-covered` | The topic is recognised but has no document, or the existing one is a stub — always stated, never hidden |

## 6. Contributing and reviewing

- New documents must follow the schema in `01-knowledge-schema-and-relationships.md`, register
  their sources in `02-source-provenance-and-licensing.md`, and update the coverage map.
- Every document carries a `Review date`. Reviews re-check sources, licenses and the coverage map
  (cadence in `03-coverage-gaps-and-update-policy.md`).
- Licenses are checked at the recorded upstream version; a license change upstream invalidates the
  recorded status until re-verified.

## 7. References (foundation-level)

- OBO Foundry — opening ontologies and principle set: https://obofoundry.org/ (accessed 2026-11-24)
- Uberon multi-species anatomy ontology (CC BY 3.0): http://obofoundry.org/ontology/uberon.html (accessed 2026-11-24)
- OpenStax (Rice University) openly licensed textbooks: https://openstax.org/ (accessed 2026-11-24)
- NCBI literature and sequence databases: https://www.ncbi.nlm.nih.gov/ (accessed 2026-11-24)
- GBIF — Global Biodiversity Information Facility: https://www.gbif.org/ (accessed 2026-11-24)
- Motion-X dataset (CC BY-NC-SA overall; per-subdataset licenses apply): https://motion-x-dataset.github.io/ (accessed 2026-11-24)
- AMASS Archive of Motion Capture as Surface Shapes (non-commercial research license): https://amass.is.tue.mpg.de/license.html (accessed 2026-11-24)
- Movebank animal tracking data platform: https://www.movebank.org/ (accessed 2026-11-24)
- Full license register with commercial-use analysis: `02-source-provenance-and-licensing.md`
