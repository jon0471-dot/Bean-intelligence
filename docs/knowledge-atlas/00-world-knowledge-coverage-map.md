# World Knowledge Coverage Map

Atlas ID: ATLAS-00 · Review date: 2026-11-24 · Status: documented · Parent: `README.md`

This is the master taxonomy and completeness matrix for the RIISHE World Knowledge Atlas. It maps
major subjects to subdomains, subtopics, source references and current completeness, and is the
index RIISHE's atlas retrieval resolves against first. Domain guides link here; this map links to
every domain guide.

Legend (from `README.md` §5): `documented` — substantive content exists here · `source-indexed` —
upstream sources registered in `02` · `dataset-available` — public dataset/ontology registered ·
`license-verified` — license checked at the recorded version · `integrated-into-retrieval` —
resolvable by RIISHE's atlas tool · `tested-by-riishe` — automated tests exercise it ·
`not-yet-covered` — recognised, no document or stub only.

**Rule:** "not-yet-covered" is an honest statement about this library, never a claim that a subject
does not exist.

---

## 1. Human anatomy and physiology

Subdomains and their state (file: `04-human-anatomy-and-physiology.md`):

| Subdomain | Subtopics included | Status |
|---|---|---|
| Cellular and tissue organisation | cell types, epithelial/connective/muscle/nervous tissue, membranes | documented |
| Skeletal system | bone groups, axial vs appendicular, joint classification, bone remodelling | documented |
| Muscular system | skeletal muscle architecture, fibre types, contraction physiology, major muscle groups | documented |
| Articulations and range of motion | joint classes, ROM concepts, anatomical planes and axes | documented |
| Nervous system | CNS/PNS division, brain regions, spinal cord, peripheral nerves, autonomic system | documented |
| Cardiovascular and lymphatic | heart anatomy, circulation loops, blood composition, lymphatic system | documented |
| Respiratory and digestive | airway structure, gas exchange, GI tract stages, accessory organs | documented |
| Endocrine and immune | major glands and hormones, innate vs adaptive immunity | documented |
| Urinary and reproductive | kidney function stages, reproductive anatomy overview | documented |
| Skin and sensory systems | skin layers, thermoregulation, vision, hearing, balance, touch, proprioception | documented |
| Growth, development and ageing | developmental stages, puberty, senescence, normal variation | documented |
| Medical diagnosis and treatment | — | **not-yet-covered by design** (the atlas records structure and function; it does not provide diagnostic or clinical decision content — see the safety note in `04` §14) |

Primary sources: OpenStax *Anatomy and Physiology 2e* (CC BY 4.0, edition recorded in `02`),
NCBI Bookshelf entries, Uberon ontology (CC BY 3.0) for cross-species anatomy terms.

## 2. Human movement and action

Files: `05-human-biomechanics-and-locomotion.md`, `06-human-actions-gestures-and-motion.md`,
`07-human-dance-sports-and-performance.md`, `08-human-falls-impact-balance-and-recovery.md`.

| Subdomain | Subtopics included | Status |
|---|---|---|
| Biomechanical principles | forces, torques, levers, centre of mass, balance, energy in movement | documented |
| Walking and gait | gait cycle phases, stance/swing, stride parameters, pathological-variation note | documented |
| Running and sprinting | stance mechanics, flight phase, speed-stride relation, economy | documented |
| Jumping, hopping, skipping | countermovement, stretch-shortening cycle, landing mechanics | documented |
| Crawling, climbing, swimming, diving | locomotor alternatives, environment constraints | documented |
| Postures and transitions | standing, sitting, lying, kneeling, squatting, bending, twisting, reaching, rising/lowering | documented |
| Object interaction | grasp types, manipulation, tool use, assembling/disassembling | documented |
| Communication gestures | co-speech gesture classes, facial expression, hand signs, pointing | documented |
| Daily activities | eating, drinking, dressing, bathing, grooming, cooking, cleaning | documented |
| Dance forms | ballet, contemporary, ballroom, hip-hop/street, folk/classical traditions, acrobatics | documented (form-level; individual choreographies are out of scope) |
| Sports and martial arts | striking, throwing, running-based sport actions, swimming strokes, weightlifting movements | documented (representative technique families) |
| Falls and recovery | balance perturbation, slip/trip mechanics, protective responses, landing and rolling | documented |
| Motion datasets | Motion-X (CC BY-NC-SA), HumanML3D (component licenses), AMASS (non-commercial) — registered in `02` with commercial-use analysis | dataset-available · license-verified · **not usable in commercial BEAN products without separate authorization** |
| Quantitative biomechanics (EMG, force-plate data, joint torque tables) | — | **not-yet-covered** (registered as a gap in `03` §2) |

## 3. Animals and other organisms

Files: [09-animal-kingdom-taxonomy-and-evolution.md](09-animal-kingdom-taxonomy-and-evolution.md), [10-vertebrate-anatomy-and-physiology.md](10-vertebrate-anatomy-and-physiology.md), [11-insects-and-arthropods.md](11-insects-and-arthropods.md), [12-invertebrates-and-other-animal-groups.md](12-invertebrates-and-other-animal-groups.md), [13-bird-anatomy-flight-and-aerodynamics.md](13-bird-anatomy-flight-and-aerodynamics.md), [14-animal-locomotion-behaviour-and-communication.md](14-animal-locomotion-behaviour-and-communication.md), [15-plants-fungi-microbes-and-ecosystems.md](15-plants-fungi-microbes-and-ecosystems.md).

| Subdomain | Subtopics included | Status |
|---|---|---|
| Metazoan taxonomy | major phyla, phylogenetic relationships, body plans | documented |
| Vertebrate comparative anatomy | skeletal/muscular/nervous/sensory systems across fish, amphibians, reptiles, birds, mammals | documented |
| Insects and arthropods | segments, exoskeleton, compound eyes, leg/wing morphology, metamorphosis, colony behaviour | documented |
| Other invertebrates | molluscs, annelids, cnidarians, echinoderms, sponges | documented |
| Bird flight | feather/wing anatomy, lift/drag/thrust, stroke phases, gliding/soaring/hovering, migration | documented |
| Animal locomotion | gaits across mammals, reptiles, amphibians, fish swimming, arthropod walking/jumping | documented |
| Animal behaviour and communication | signalling modalities, social behaviour, predator-prey dynamics | documented |
| Species-level detail | — | **not-yet-covered** per species (the atlas covers clade-level structure; GBIF provides species-level records — registered in `02`) |
| Plants, fungi, microbes, ecosystems | plant structure/function, fungal biology, microbial life, ecosystem dynamics | documented |

Primary sources: OpenStax *Biology 2e* (CC BY 4.0), GBIF (per-dataset licenses), Movebank
(per-dataset licenses), NCBI Taxonomy.

## 4. Physical world

Files: [16-physics-motion-forces-and-energy.md](16-physics-motion-forces-and-energy.md), [17-chemistry-atoms-molecules-and-reactions.md](17-chemistry-atoms-molecules-and-reactions.md), [18-materials-and-engineering-science.md](18-materials-and-engineering-science.md), [19-earth-oceans-weather-and-climate.md](19-earth-oceans-weather-and-climate.md), [20-ecology-evolution-and-environment.md](20-ecology-evolution-and-environment.md), [21-astronomy-and-space.md](21-astronomy-and-space.md).

| Subdomain | Subtopics included | Status |
|---|---|---|
| Classical mechanics | kinematics, Newton's laws, energy, momentum, rotation, gravitation | documented |
| Fluid mechanics | pressure, buoyancy, flow regimes, drag/lift basics | documented |
| Thermodynamics | temperature, heat, laws of thermodynamics, entropy (conceptual + equations) | documented |
| Electromagnetism and optics | charge, fields, circuits basics, EM waves, reflection/refraction, wave optics | documented |
| Acoustics and waves | wave properties, sound, resonance, Doppler | documented |
| Chemistry | atoms, periodicity, bonding, reactions, organic basics, states of matter | documented |
| Materials science | material classes, mechanical properties, failure, selection logic | documented |
| Earth science | geology, plate tectonics, rock cycle, oceans, atmosphere, weather, climate system | documented |
| Ecology and evolution | populations, communities, ecosystems, natural selection, speciation | documented |
| Astronomy | solar system, stellar life cycles, galaxies, cosmology basics, planetary science | documented |
| Advanced physics (relativity, quantum mechanics, particle physics) | — | **not-yet-covered** beyond conceptual introductions inside `16`/`21` (gap recorded in `03` §2) |

Primary sources: OpenStax *College Physics*, *Chemistry 2e*, *Astronomy 2e* (CC BY 4.0), NOAA/USGS
public education portals (US Government public domain), NASA public domain.

## 5. Human world, technology and design

Files: [22-human-history-culture-and-society.md](22-human-history-culture-and-society.md), [23-languages-communication-and-social-behaviour.md](23-languages-communication-and-social-behaviour.md), [24-technology-engineering-and-computing.md](24-technology-engineering-and-computing.md), [25-architecture-art-music-and-visual-design.md](25-architecture-art-music-and-visual-design.md), [26-professional-software-ui-ux-and-motion-design.md](26-professional-software-ui-ux-and-motion-design.md).

| Subdomain | Subtopics included | Status |
|---|---|---|
| History and society | periodisation overview, cultural dynamics, social/economic/political structures | documented |
| Language and communication | phonology/morphology/syntax/semantics, acquisition, pragmatics, nonverbal channels | documented |
| Technology and computing | computing layers, electronics basics, networks, robotics, software engineering practice | documented |
| Architecture, art, music, visual design | architectural principles, art movements, music theory fundamentals, visual design elements | documented |
| Professional software, UI/UX and motion design | design systems, typography, spacing, interaction states, responsive layout, accessibility, animation discipline | documented (mirrors `docs/agents/PROFESSIONAL-UI-UX-DESIGN-STANDARD.md` and `ANIMATION-AND-INTERACTION-STANDARD.md`) |
| National histories and individual biographies in depth | — | **not-yet-covered** (the atlas records structures and long arcs; deep per-country or per-biography coverage is a registered gap, `03` §2) |

## 6. AI and agent knowledge

Files: [27-ai-models-inference-and-multimodal-intelligence.md](27-ai-models-inference-and-multimodal-intelligence.md), [28-agent-planning-tools-verification-and-recovery.md](28-agent-planning-tools-verification-and-recovery.md), [29-professional-code-generation-and-product-engineering.md](29-professional-code-generation-and-product-engineering.md).

| Subdomain | Subtopics included | Status |
|---|---|---|
| Model families and inference | transformers, diffusion, CNNs, runtime landscape (WebLLM, Transformers.js, ONNX Runtime, llama.cpp, wllama), quantisation, device tiers | documented |
| Multimodal intelligence | vision, audio, speech, document understanding capabilities and limits | documented |
| Agent architecture | planning, tool use, verification, recovery, memory, safety (aligned with BEAN's RIISHE architecture docs in `docs/ai/`) | documented |
| Professional code generation | engineering workflow, quality gates, anti-slop discipline, delivery checklists (aligned with `docs/agents/`) | documented |
| Model-specific catalogues (per-model specs, benchmarks) | — | **not-yet-covered** as per-model pages; the live per-backend catalogue is the code registry (`src/lib/registry/`), which stays authoritative for runtime state |

## 7. Cross-domain relationship spine

The atlas is organised so that reasoning can cross domain boundaries:

- anatomy (04) → biomechanics (05) → actions (06/07/08) → physics (16)
- taxonomy (09) → comparative anatomy (10) → locomotion (13/14) → physics (16)
- chemistry (17) → materials (18) → engineering (18/24) → technology (24)
- earth (19) → ecology (20) → biology (09/15) → climate (19)
- perception (04 §skin/senses) → communication (23) → design (25/26)
- agents (28) → code generation (29) → professional software/design (24/26)

The relation vocabulary is defined in `01-knowledge-schema-and-relationships.md` §4.

## 8. Aggregate completeness snapshot (2026-11-24)

| Domain group | Files | Documented | Not yet covered (explicit) |
|---|---|---|---|
| Foundation | 5 | 5 | — |
| Human anatomy & movement | 5 | 5 | quantitative biomechanics datasets, clinical content (by design) |
| Animals & organisms | 7 | 7 | per-species pages |
| Physical world | 6 | 6 | advanced physics depth |
| Human world & technology | 5 | 5 | deep national histories, biographies |
| AI & agent knowledge | 3 | 3 | per-model catalogue pages (kept in code registry) |
| **Total** | **31** | **31** | 5 recorded gap areas (`03` §2) |

All 31 documents are registered in the retrieval index and paged by RIISHE's atlas tool
(`integrated-into-retrieval`), exercised by automated tests (`tested-by-riishe`).

## 9. What this map does not claim

- The map lists what **this library** covers, not what is true or knowable.
- Subtopic presence at `documented` level means representative, source-linked coverage of the
  subtopic's structure — not exhaustive detail of every instance within it.
- Coverage decisions and the next expansion candidates are tracked in
  `03-coverage-gaps-and-update-policy.md`.
