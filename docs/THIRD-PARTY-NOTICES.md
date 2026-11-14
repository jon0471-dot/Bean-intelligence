# Third-party notices — BEAN Intelligence Frontend Intelligence Toolkit

This document records the third-party software integrated into the CODE GIFTZ Frontend Intelligence capability, with the exact versions, licenses and upstream sources verified during the Phase 0 audit (see `docs/CODE-GIFTZ-FRONTEND-INTELLIGENCE-AUDIT.md`) and the 2026-11 internal-library expansion (see `docs/CODE-GIFTZ-INTERNAL-FRONTEND-LIBRARY-REPORT.md`). License texts were read from the primary sources (the installed packages' LICENSE files / the upstream repositories), not from secondary summaries.

Generated projects that carry third-party code also receive a `NOTICES.md` with the same terms (see `src/lib/frontend-intel/vendor.ts` → `buildNoticesMarkdown`).

---

## 1. GSAP — `gsap@3.13.0`

- **Used for:** the animation engine of the Frontend Intelligence Toolkit (reusable animation patterns, ScrollTrigger integration, React lifecycle cleanup). Since the 2026-11 expansion the vendored set covers the FULL free GSAP 3.13 plugin set: ScrollTrigger, SplitText, MorphSVGPlugin, MotionPathPlugin, Flip, Draggable, Observer, CustomEase, DrawSVGPlugin, ScrambleTextPlugin (all ship free in the installed package's `dist/`).
- **Upstream:** https://github.com/greensock/GSAP — npm: https://www.npmjs.com/package/gsap
- **License:** Standard "No Charge" GSAP License — https://gsap.com/standard-license — effective April 30, 2025 (Webflow). Free for all users, **including commercial use**, for all GSAP code and plugins (SplitText included since 3.13). Principal restrictions: no no-code visual animation tool competing with Webflow built on/reverse-engineered from GSAP; proprietary notices must be retained. GSAP's license FAQ explicitly states that GSAP code generated with an AI assistant is **not** a prohibited use.
- **Vendored artifacts** (attached to generated static projects, offline): `gsap/dist/gsap.min.js` plus the per-plugin minified builds required by the selected patterns (`gsap/dist/<Plugin>.min.js`) — unmodified minified builds from the pinned package.
- **BEAN usage:** GSAP (and `@gsap/react`) are also normal npm dependencies of the BEAN application for catalogue component validation.

## 2. @gsap/react — `@gsap/react@2.1.2`

- **Used for:** the official GSAP React integration (`useGSAP`) — correct React lifecycle initialization and cleanup in React-target generated projects and catalogue components.
- **Upstream:** https://github.com/greensock/GSAP/tree/main/packages/react
- **License:** Standard "No Charge" GSAP License (package.json: "SEE LICENSE AT https://gsap.com/standard-license").

## 3. Vanta — `vanta@0.5.24`

- **Used for:** optional animated background effects in generated projects. Since the 2026-11 expansion: birds, waves, net, globe, fog, clouds, rings, cells, dots, halo, ripple (three.js) + trunk, topology (p5.js). `clouds2` is deliberately NOT supported — it fetches an external noise texture (`texturePath: './gallery/noise.png'`) that is not shipped in the package and cannot be vendored offline.
- **Upstream:** https://github.com/tengbao/vanta — site: https://www.vantajs.com
- **License:** MIT — `node_modules/vanta/LICENSE.md` (read verbatim): "Copyright 2020 Teng Bao. Permission is hereby granted, free of charge, to any person obtaining a copy of this software …" (standard MIT text; the copyright notice and permission notice are preserved in the vendored files and in generated projects' `NOTICES.md`).
- **Vendored artifacts:** `vanta/dist/vanta.<effect>.min.js` per selected effect — unmodified minified builds from the pinned package.

## 4. three.js — `three@0.134.0`

- **Used for:** the WebGL runtime Vanta renders with (global `THREE`). **Deliberate downpin:** Vanta's official site ships `three.r134.min.js`; newer three versions removed the UMD build and break Vanta's contract.
- **Upstream:** https://github.com/mrdoob/three.js (r134)
- **License:** MIT — `node_modules/three/LICENSE` (read verbatim): "Copyright © 2010-2021 three.js authors" (standard MIT text).
- **Vendored artifact:** `three/build/three.min.js` — unmodified minified build from the pinned package.
- **Note:** three.js is NOT imported by BEAN application code; it is only vendored into generated projects that selected a Vanta effect.

## 5. p5.js — `0.6.1` (vendored from INSIDE the vanta package)

- **Used for:** the p5-based Vanta effects `trunk` and `topology` (verified in the vanta sources: both extend `_p5Base`). p5 0.6.1 is the exact build Vanta 0.5.24 ships and renders with (`node_modules/vanta/vendor/p5.min.js`).
- **Upstream:** https://github.com/processing/p5.js (v0.6.1)
- **License:** **LGPL-2.1** (p5.js repository, v0.6.1). LGPL compliance posture for generated projects: the library is vendored as a separate, replaceable file (`vendor/p5.min.js`), unmodified; generated projects' `NOTICES.md` carry the license notice, the version and the upstream source link, and the file can be swapped or upgraded by the project owner without touching application code. BEAN does not modify p5.
- **Vendored artifact:** `vanta/vendor/p5.min.js` → emitted as `vendor/p5.min.js` only for projects that select a p5-based effect.

## 6. React Bits — free collection, TWO pinned upstream generations

- **Used for:** the curated frontend component catalogue. The ORIGINAL 17 integrations stay pinned to commit `4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce` (preserved verbatim); the 2026-11 EXPANSION vendored all remaining compatible free components from commit `cf2801031f07f53d4684e65b961bde7c2e2a6921` (168 installed, 50 honestly excluded with recorded reasons — see `src/lib/frontend-intel/catalog-expansion.ts` and the expansion report). Implementations live in `src/components/giftz-kit/` with attribution headers.
- **Upstream:** https://github.com/DavidHDev/react-bits — site: https://reactbits.dev
- **License:** **MIT + Commons Clause License Condition v1.0** — verified at BOTH pinned commits (`4e0d091…` and `cf28010…`, upstream `LICENSE.md`, "Copyright (c) 2026 David Haz" — identical text). The license grants use, copying, modification and distribution of the software **as part of an application, website, or product**, for any commercial purpose. Conditions: (1) the copyright + permission notice accompanies copies; (2) **Commons Clause** — the components themselves may not be sold, sublicensed or redistributed (alone, bundled, or as a ported version); the same restriction covers the React Bits tools and sound library. What you make with the components is yours to use in any personal or commercial application.
- **BEAN compliance posture:**
  1. Only free-collection components; no React Bits Pro content or assets.
  2. Every catalogued component file carries an attribution header (name, author, license, exact upstream URL, upstream commit).
  3. Generated React projects receive the component sources under `components/kit/` with attribution headers intact plus a project-level `NOTICES.md`.
  4. The catalogue is an internal capability of the CODE GIFTZ assistant whose output is an application — the license's permitted case — and is never exposed as a standalone component pack for sale or redistribution.
  5. Adaptations are minimal and recorded per registry entry (`adaptedFrom`): import source `'motion/react'` → `'framer-motion'` (framer-motion 12 exposes the identical API surface), and — for 4 expansion components — behavior-preserving TypeScript annotations so the files pass BEAN's strict tsc gate. No other upstream code is modified.
  6. The library is INTERNAL: there is no user-facing catalogue/selector UI and no API surface exposing the registry; components reach users only inside generated applications (the license's permitted case).
- **Re-review trigger:** if BEAN's distribution model ever changes to selling generated component packs (the components "on their own"), this license must be re-reviewed before shipping.

## 7. framer-motion — `framer-motion@12.26.2` (pre-existing BEAN dependency, now pinned in generated React projects)

- **Used for:** React Bits components whose upstream source imports `motion/react` (2 original + 20 expansion components; the import source is adapted and recorded).
- **Upstream:** https://github.com/motiondivision/motion
- **License:** MIT.

---

**Verification chain:** versions and license fields were read from `node_modules/*/package.json`; license texts from `node_modules/{vanta/LICENSE.md, three/LICENSE}`, the p5.js license from the upstream v0.6.1 repository, and the React Bits `LICENSE.md` at BOTH pinned commits; the GSAP standard license from gsap.com/standard-license. Findings and decisions are recorded in `docs/CODE-GIFTZ-FRONTEND-INTELLIGENCE-AUDIT.md` §3 and `docs/CODE-GIFTZ-INTERNAL-FRONTEND-LIBRARY-REPORT.md` §Licensing.
