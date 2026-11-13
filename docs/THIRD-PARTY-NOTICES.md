# Third-party notices — BEAN Intelligence Frontend Intelligence Toolkit

This document records the third-party software integrated into the CODE GIFTZ Frontend Intelligence capability, with the exact versions, licenses and upstream sources verified during the Phase 0 audit (see `docs/CODE-GIFTZ-FRONTEND-INTELLIGENCE-AUDIT.md`). License texts were read from the primary sources (the installed packages' LICENSE files / the upstream repositories), not from secondary summaries.

Generated projects that carry third-party code also receive a `NOTICES.md` with the same terms (see `src/lib/frontend-intel/vendor.ts` → `buildNoticesMarkdown`).

---

## 1. GSAP — `gsap@3.13.0`

- **Used for:** the animation engine of the Frontend Intelligence Toolkit (reusable animation patterns, ScrollTrigger integration, React lifecycle cleanup).
- **Upstream:** https://github.com/greensock/GSAP — npm: https://www.npmjs.com/package/gsap
- **License:** Standard "No Charge" GSAP License — https://gsap.com/standard-license — effective April 30, 2025 (Webflow). Free for all users, **including commercial use**, for all GSAP code and plugins (SplitText included since 3.13). Principal restrictions: no no-code visual animation tool competing with Webflow built on/reverse-engineered from GSAP; proprietary notices must be retained. GSAP's license FAQ explicitly states that GSAP code generated with an AI assistant is **not** a prohibited use.
- **Vendored artifacts** (attached to generated static projects, offline): `gsap/dist/gsap.min.js`, `gsap/dist/ScrollTrigger.min.js` — unmodified minified builds from the pinned package.
- **BEAN usage:** GSAP (and `@gsap/react`) are also normal npm dependencies of the BEAN application for catalogue component validation.

## 2. @gsap/react — `@gsap/react@2.1.2`

- **Used for:** the official GSAP React integration (`useGSAP`) — correct React lifecycle initialization and cleanup in React-target generated projects and catalogue components.
- **Upstream:** https://github.com/greensock/GSAP/tree/main/packages/react
- **License:** Standard "No Charge" GSAP License (package.json: "SEE LICENSE AT https://gsap.com/standard-license").

## 3. Vanta — `vanta@0.5.24`

- **Used for:** optional animated 3D background effects (birds, waves, net, globe, fog, clouds, rings) in generated projects.
- **Upstream:** https://github.com/tengbao/vanta — site: https://www.vantajs.com
- **License:** MIT — `node_modules/vanta/LICENSE.md` (read verbatim): "Copyright 2020 Teng Bao. Permission is hereby granted, free of charge, to any person obtaining a copy of this software …" (standard MIT text; the copyright notice and permission notice are preserved in the vendored files and in generated projects' `NOTICES.md`).
- **Vendored artifacts:** `vanta/dist/vanta.<effect>.min.js` per selected effect — unmodified minified builds from the pinned package.

## 4. three.js — `three@0.134.0`

- **Used for:** the WebGL runtime Vanta renders with (global `THREE`). **Deliberate downpin:** Vanta's official site ships `three.r134.min.js`; newer three versions removed the UMD build and break Vanta's contract.
- **Upstream:** https://github.com/mrdoob/three.js (r134)
- **License:** MIT — `node_modules/three/LICENSE` (read verbatim): "Copyright © 2010-2021 three.js authors" (standard MIT text).
- **Vendored artifact:** `three/build/three.min.js` — unmodified minified build from the pinned package.
- **Note:** three.js is NOT imported by BEAN application code; it is only vendored into generated projects that selected a Vanta effect.

## 5. React Bits — free collection, upstream commit `4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce`

- **Used for:** the curated frontend component catalogue (17 installed components listed in `src/lib/frontend-intel/catalog.ts`; implementations in `src/components/giftz-kit/` with attribution headers).
- **Upstream:** https://github.com/DavidHDev/react-bits — site: https://reactbits.dev
- **License:** **MIT + Commons Clause License Condition v1.0** — upstream `LICENSE.md`, "Copyright (c) 2026 David Haz". The license grants use, copying, modification and distribution of the software **as part of an application, website, or product**, for any commercial purpose. Conditions: (1) the copyright + permission notice accompanies copies; (2) **Commons Clause** — the components themselves may not be sold, sublicensed or redistributed (alone, bundled, or as a ported version); the same restriction covers the React Bits tools and sound library. What you make with the components is yours to use in any personal or commercial application.
- **BEAN compliance posture:**
  1. Only free-collection components; no React Bits Pro content or assets.
  2. Every catalogued component file carries an attribution header (name, author, license, exact upstream URL, upstream commit).
  3. Generated React projects receive the component sources under `components/kit/` with attribution headers intact plus a project-level `NOTICES.md`.
  4. The catalogue is an internal capability of the CODE GIFTZ assistant whose output is an application — the license's permitted case — and is never exposed as a standalone component pack for sale or redistribution.
  5. Two components were adapted: import source `'motion/react'` → `'framer-motion'` (recorded per registry entry in `adaptedFrom`); framer-motion 12 exposes the identical API surface used by those components.
- **Re-review trigger:** if BEAN's distribution model ever changes to selling generated component packs (the components "on their own"), this license must be re-reviewed before shipping.

## 6. framer-motion — `framer-motion@12.26.2` (pre-existing BEAN dependency, now pinned in generated React projects)

- **Used for:** React Bits components whose upstream source imports `motion/react` (BlurText, CountUp).
- **Upstream:** https://github.com/motiondivision/motion
- **License:** MIT.

---

**Verification chain:** versions and license fields were read from `node_modules/*/package.json`; license texts from `node_modules/{vanta/LICENSE.md, three/LICENSE}`; the GSAP standard license and React Bits LICENSE.md from the upstream sources (gsap.com/standard-license; the pinned React Bits commit). Findings and decisions are recorded in `docs/CODE-GIFTZ-FRONTEND-INTELLIGENCE-AUDIT.md` §3.
