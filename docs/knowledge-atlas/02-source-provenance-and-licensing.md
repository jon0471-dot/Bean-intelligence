# Source Provenance and Licensing

Atlas ID: ATLAS-02 · Review date: 2026-11-24 · Status: documented · license-verified (as recorded per source) · Parent: `README.md`

This is the source and license register for the whole atlas. Every domain document's References
section points here or to the canonical upstream URL. **Licenses are recorded at the version
checked on the access date; an upstream license change invalidates the recorded status until
re-verified.** Commercial-use flags refer to BEAN's commercial context; `non-commercial` sources
are usable for research/education inside BEAN but must not feed commercial products without
separate authorization or a compatible license.

Access date for all first-party checks below: **2026-11-24** unless stated otherwise.

---

## 1. Anatomy, biology and biodiversity sources

| Source | Publisher / authors | URL | Version checked | Content type | License | Commercial use | Attribution | Limitations |
|---|---|---|---|---|---|---|---|---|
| OpenStax *Anatomy and Physiology 2e* | Rice University (OpenStax) | https://openstax.org/details/books/anatomy-and-physiology-2e | 2e (current edition at access date) | derived textbook descriptions, illustrations | CC BY 4.0 (text; per-edition check required before reuse — see note below) | permitted with attribution | credit OpenStax/Rice, link license, indicate edits | illustrations may carry their own attribution requirements; check per edition — do not assume every edition or image has identical permissions |
| OpenStax *Biology 2e* | Rice University (OpenStax) | https://openstax.org/details/books/biology-2e | 2e | textbook | CC BY 4.0 (same per-edition caution) | permitted with attribution | as above | as above |
| OpenStax *College Physics*, *Chemistry 2e*, *Astronomy 2e* | Rice University (OpenStax) | https://openstax.org/ | current editions at access date | textbook | CC BY 4.0 (same per-edition caution) | permitted with attribution | as above | as above |
| NCBI Bookshelf / PubMed Central | US National Center for Biotechnology Information | https://www.ncbi.nlm.nih.gov/ | live service | literature records, some full texts, sequence data | US Government works generally public domain; individual deposited articles keep their own copyrights — check per item | per item | cite the record; PMC articles keep author copyright | not all content is reusable; NCBI is an index/aggregate |
| Uberon multi-species anatomy ontology | OBO Foundry / obophenotype project (maintainer C. Mungall et al.) | http://obofoundry.org/ontology/uberon.html · https://github.com/obophenotype/uberon | release current at access date | ontology terms (cross-species anatomy) | CC BY 3.0 | permitted with attribution | cite Uberon + license link; attribution stacking across merged ontologies must be tracked | term IDs cited as `[Uberon:<id>]`; CC BY 3.0 attribution required on redistribution of term content |
| GBIF mediated occurrence data | Global Biodiversity Information Facility + dataset publishers | https://www.gbif.org/ | live service; per-dataset | raw occurrence records, taxonomy backbone | per dataset: CC0, CC BY, or CC BY-NC (GBIF licensing policy) | CC0/CC BY yes; **CC BY-NC excluded from commercial use** — filter at dataset/record level | cite dataset DOI + license per GBIF citation guidance | species-level detail lives upstream; this atlas keeps clade-level structure only |
| NCBI Taxonomy | NCBI | https://www.ncbi.nlm.nih.gov/taxonomy | live service | taxonomy names/ids | US Government public domain | yes | cite NCBI Taxonomy | — |

**OpenStax caution (recorded per M38 review):** the atlas cites OpenStax for established structure
and function. Before any bulk reuse (not planned — the atlas stores curated summaries), the exact
edition's licensing page must be re-checked; illustrations sourced from third parties inside
OpenStax books can carry different permissions than the text license.

## 2. Human and animal movement datasets

| Source | Publisher | URL | Version checked | Content type | License | Commercial use | Attribution | Limitations |
|---|---|---|---|---|---|---|---|---|
| Motion-X | IDEA-Research (conditional distribution) | https://motion-x-dataset.github.io/ | site + license PDF at access date | SMPL-X motion + text annotations over 8 public sub-datasets and 15K videos | **CC BY-NC-SA overall**; sub-dataset licenses apply on top | **NO for commercial BEAN products without separate authorization** — non-commercial + share-alike; annotated results additionally gated by approvals of original institutions | cite paper + license; respect sub-dataset attribution | derived from gated sub-datasets; redistribution restricted |
| — Motion-X sub-datasets (as published by Motion-X site) | various | see Motion-X assets page | access date | mixed | BAUM, AIST++, EgoBody: CC BY 4.0 · HAA500: MIT · HuMMan: S-Lab License 1.0 · GRAB, AMASS: academic/non-commercial only · remainder: CC BY-SA 4.0 | mixed; GRAB/AMASS components excluded from commercial use | per sub-dataset | Motion-X annotations do **not** relicense the underlying data |
| AMASS | Max Planck Institute for Intelligent Systems (MPG) | https://amass.is.tue.mpg.de/license.html | license page at access date | SMPL-H body motion capture archive | custom non-commercial research license (single-user, non-transferable) | **NO commercial use** — explicitly prohibits commercial products/services and training for commercial use | cite AMASS paper (Mahmood et al., 2019) | no redistribution; no reverse engineering |
| HumanML3D | Eric Guo et al. (ICT/CAS) | https://github.com/EricGuoICT/HumanML3D | repo at access date | text–motion annotations + processing scripts over AMASS/Humanise/etc. | scripts Apache-2.0-style repo license; **data cannot be redistributed** (AMASS distribution policy) — must be reproduced via provided scripts under each source's license | scripts yes; derived data follows source licenses (AMASS parts non-commercial) | verify each component's license separately before any use | per M38 review: component licenses (AMASS-derived parts) are non-commercial |
| Movebank | Max Planck Institute of Animal Behavior / Movebank consortium | https://www.movebank.org/ | live service; per-dataset | animal tracking GPS/accelerometry records | **per dataset** (commonly CC0 or CC BY; some datasets carry custom terms) | per dataset; check each study's terms before use | cite study + Movebank dataset DOI | datasets vary in scope; animal behaviour datasets index (JackieZhai/awesome-behavior-datasets) is a discovery list, not a data source |

**Working rule recorded for BEAN:** no dataset files are committed to this repository; the atlas
stores descriptions and license records only. Any future integration of Motion-X/AMASS/HumanML3D
data into a commercial BEAN product requires a separate license authorization and is recorded in
`03-coverage-gaps-and-update-policy.md` §4 as a blocked dependency until then.

## 3. Physical world and general science sources

| Source | Publisher | URL | License | Commercial use | Notes |
|---|---|---|---|---|---|
| NASA portals (solar system exploration, Earth Observatory) | NASA (US Government) | https://www.nasa.gov/ · https://earthobservatory.nasa.gov/ | public domain (US Government works; some media carry third-party restrictions — check per asset) | yes for PD content | used for astronomy/earth facts |
| NOAA education resources | NOAA (US Government) | https://www.noaa.gov/education | public domain (per-asset caution) | yes | oceans, weather, climate |
| USGS | US Geological Survey | https://www.usgs.gov/ | public domain (per-asset caution) | yes | geology, plate tectonics |
| Britannica / Stanford Encyclopedia of Philosophy style reference works | various | — | varies (many all-rights-reserved) | **facts are not copyrightable; expression is** | atlas writes its own prose; these are verification references only, not sources of copied text |

## 4. Human world, design and technology sources

| Source | Publisher | URL | License | Commercial use | Notes |
|---|---|---|---|---|---|
| W3C WAI accessibility guidance | W3C | https://www.w3.org/WAI/ | W3C document use policy (permissive with attribution) | yes | WCAG-oriented content in `26` |
| MDN Web Docs | Mozilla | https://developer.mozilla.org/ | CC BY-SA 2.5 (content) | yes with attribution + share-alike for reused text | web platform facts in `24`/`26`; atlas paraphrases |
| arXiv / ACL / NeurIPS open-access papers | authors | https://arxiv.org/ | per paper (many CC BY or author-retained) | per paper | cited for AI/agent claims in `27`–`29` |

## 5. Runtime and code dependencies referenced by the atlas

| Component | Upstream | Version referenced | License | Notes |
|---|---|---|---|---|
| WebLLM (mlc-ai/web-llm) | https://github.com/mlc-ai/web-llm | 0.2.89 pinned in `src/workers/package.json` | Apache-2.0 | browser WebGPU LLM runtime; already integrated |
| Transformers.js (@huggingface/transformers) | https://github.com/huggingface/transformers.js | 4.3.2 pinned | Apache-2.0 | browser ASR (Whisper lane); already integrated |
| ONNX Runtime (web + node) | https://github.com/microsoft/onnxruntime | onnxruntime-web 1.31.1 pinned; node used for acceptance | MIT | segmentation + CPU acceptance path |
| llama.cpp | https://github.com/ggml-org/llama.cpp | server lane (MIT) | MIT | existing local llama.cpp lane |
| wllama | https://github.com/ngxson/wllama | evaluated (M38); current upstream 4.0.0 (2026-11-22); **not integrated** at review date | MIT | WASM binding for llama.cpp; WASM SIMD + WebGPU with CPU fallback; recorded as a candidate runtime, not a dependency — no runtime is added without a demonstrated need |
| GSAP | https://gsap.com/ · https://github.com/greensock/GSAP | 3.13.0 (app dependency) | 100% free incl. all plugins since 3.13 (Webflow, announced 2025-04-30) | existing animation dependency |
| motion (Framer Motion / motion division) | https://github.com/motiondivision/motion | 12.23.2 (app dependency `framer-motion`) | MIT | existing animation dependency |
| Kokoro.js | https://github.com/hexgrad/kokoro | 1.2.1 (app dependency) | Apache-2.0 | server-side TTS lane; model Kokoro-82M Apache-2.0 per existing registry records |
| MODNet portrait-matting ONNX artifact | pinned artifact recorded in `src/lib/client-compute/model-registry.ts` + `models/` manifests/licenses | sha256 `92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a` (6,632,188 bytes) | license/probe attestation in `models/licenses/` | the one real-execution-verified client model |

The **authoritative runtime state** for every model/backend is the code registry
(`src/lib/registry/`, `src/lib/client-compute/`) — never these prose tables. This section exists so
license questions have a recorded answer at a point in time.

## 6. Attribution obligations summary for BEAN

1. Textbooks (OpenStax): attribution + license link on redistribution; the atlas paraphrases and
   cites rather than reproducing.
2. Ontologies (Uberon): CC BY 3.0 attribution when term content is redistributed.
3. Biodiversity data (GBIF/Movebank): dataset-level citation + license; CC BY-NC records excluded
   from commercial paths.
4. Motion datasets: Motion-X/AMASS/HumanML3D-AMASS-parts are **non-commercial** — usable for
   research/education features only, never silently shipped in commercial products.
5. Code runtimes: license names retained in the client model registry projection (bare SPDX name,
   required disclosure for downloads) — backend identities stay out of the customer UI per M36-D.

## 7. Verification log

| Date | Check |
|---|---|
| 2026-11-24 | Uberon license confirmed CC BY 3.0 via OBO Foundry ontology page |
| 2026-11-24 | Motion-X license confirmed CC BY-NC-SA + per-sub-dataset table via official site |
| 2026-11-24 | AMASS license confirmed non-commercial research-only via official license page |
| 2026-11-24 | HumanML3D redistribution restriction confirmed via official repository (AMASS policy) |
| 2026-11-24 | GBIF licensing policy confirmed (CC0/CC BY/CC BY-NC per dataset) via gbif.org terms |
| 2026-11-24 | GSAP free-for-all-use status (3.13+, Webflow) confirmed via gsap.com pricing page + Webflow announcement |
| 2026-11-24 | Runtime versions cross-checked against `src/workers/package.json` pins |
