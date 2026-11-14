# CODE GIFTZ — Internal Frontend Library Expansion: Final Report

Repository: `https://github.com/jon0471-dot/Bean-intelligence.git` (branch `main`, fast-forward push only, remote SHA verified).
Baseline at session start: remote `main` = `a258a3761b5bcd58e41a2c2a2c6aa85d06fce508` (`fix(bean): restore shared gateway rate-limit handling`) — verified via `git ls-remote` before any change; working tree clean (92 spurious "mode-only" diffs from the sandbox filesystem were silenced with `core.filemode=false`; zero content drift).
Companion documents: `docs/CODE-GIFTZ-FRONTEND-INTELLIGENCE-AUDIT.md` + `docs/CODE-GIFTZ-FRONTEND-INTELLIGENCE-REPORT.md` (the original 17-component integration, preserved) and `docs/THIRD-PARTY-NOTICES.md` (updated).

**Outcome in one line:** CODE GIFTZ's internal frontend-generation library grew from 17 curated React Bits components + 5 GSAP patterns + 7 Vanta effects to **168 React Bits components (the complete compatible free collection), 15 GSAP patterns covering the full free GSAP 3.13 plugin set, and 13 Vanta effects including the p5-based ones — with the visible UI completely free of the Frontend Toolkit controls** (the selector panel, its catalogue API route and the API selection parameter were removed; selection is now fully automatic inside the generation engine).

---

## 1. Phase 0 — preservation audit (before any change)

Verified by reading the actual files, not from memory:

- **Existing 17 React Bits integrations** — `src/components/giftz-kit/` (17 `.tsx` + 12 `.css`), each carrying its attribution header pinned to upstream commit `4e0d091d…`. **Preserved byte-identical** — the expansion never re-vendors them (the newer upstream commit changed some of their sources; re-vendoring would have violated the preservation requirement).
- **Existing GSAP animation patterns** — `src/lib/frontend-intel/gsap-patterns.ts` (5 patterns, static + React variants). Preserved as-is and extended additively.
- **Existing Vanta effects** — `src/lib/frontend-intel/vanta.ts` (7 effects + lifecycle contract). Preserved; extended additively.
- **Existing attribution/license records** — `docs/THIRD-PARTY-NOTICES.md`, per-file headers, generated-project `NOTICES.md`. Preserved; updated with the expansion facts.
- **Existing component registry** — `src/lib/frontend-intel/catalog.ts` + `types.ts` + `validate.ts` + `vendor.ts` + `engine.ts`. Preserved architecture; extended.
- **Existing frontend orchestration engine, code-generation and sandbox workflows** — turn core hook (`finalizeFrontendTurn`), chat-route brief injection, SSE `done` frame field, sandbox approval flow: all untouched except the selection-removal described in §6 (the engine itself gained capability; nothing was removed from the generation pipeline).
- **No database migration, no schema change** (metadata still rides the existing JSON columns).
- Test baseline re-verified before changes: full suite green at the committed state.

## 2. Upstream inspection (Phase 2 input)

All three upstreams were inspected read-only (nothing copied wholesale):

| Upstream | Pinned reference | Inspection result |
| --- | --- | --- |
| React Bits (`DavidHDev/react-bits`) | commit `cf2801031f07f53d4684e65b961bde7c2e2a6921` (2026-11-14) | **218 components** across 5 categories (TextAnimations 40, Animations 39, Backgrounds 61, Components 42, Micro 39). `LICENSE.md` re-read at this commit: still **MIT + Commons Clause v1.0** (identical text). Repo = free collection; Pro is a separate product (no Pro content used). Every `src/ts-default` component is self-contained (`.tsx` + optional own `.css`, zero cross-file imports). |
| GSAP (`greensock/GSAP`) | installed npm package `gsap@3.13.0` (unchanged pin) | `dist/` verified on disk: **all formerly-premium plugins ship free** — `SplitText.min.js`, `MorphSVGPlugin.min.js`, `MotionPathPlugin.min.js`, `Flip.min.js`, `Draggable.min.js`, `Observer.min.js`, `CustomEase.min.js` (+ CustomBounce/CustomWiggle), `DrawSVGPlugin.min.js`, `ScrambleTextPlugin.min.js`, plus ScrollTrigger/EasePack/ScrollTo/Inertia/Text/ScrollSmoother. No new npm install needed. |
| Vanta (`tengbao/vanta`) | installed npm package `vanta@0.5.24` (unchanged pin) | `dist/` has **14 effect bundles** (7 previously used + cells, dots, halo, ripple, trunk, topology, clouds2). `src/` verified per effect: trunk + topology extend `_p5Base` (p5.js runtime); **clouds2 requires an external texture** (`texturePath: './gallery/noise.png'`) that is not shipped in the package — cannot work offline, excluded. `vendor/p5.min.js` = p5.js **0.6.1**, the exact build Vanta renders with. |

## 3. React Bits expansion (Phase 2)

**Selection rule (binding, applied mechanically by `scripts/kit-expansion-curation.ts`):** a component is selected only when its bare imports are a subset of `{ gsap, @gsap/react, motion }`. `motion/react` (the renamed framer-motion package, used by 30 upstream files) is adapted to `framer-motion` exactly like the two original adaptations — recorded per entry in `adaptedFrom`.

**Result: 168 installed / 50 excluded (218 = complete free collection accounted for).**

| Upstream category | Installed (new) | Notes |
| --- | --- | --- |
| Backgrounds | 54 | incl. Aurora + Particles, which needed `ogl` at the OLD pin and are self-contained at the new one (state flip recorded in the registry with a note) |
| Animations (general) | 29 | cursors, ribbons, pixel transitions, marquees, reveal effects |
| Components (UI) | 29 | navs, cards, galleries, carousels, counters, menus |
| TextAnimations | 24 | scramble/decrypt/typewriters, loopers, split-flap, pressure text |
| Micro | 15 | micro-interactions (hold buttons, toggles, sliders, gauges) |
| **Total new** | **151** | plus the 17 preserved = **168 installed** |

**Exclusions — 50 components, every one with a recorded verified reason** (`EXPANSION_EXCLUSIONS` in `src/lib/frontend-intel/catalog-expansion.ts`, surfaced as `notInstalledReason` in the registry; never advertised as available):

| Reason | Count | Components |
| --- | --- | --- |
| `@hugeicons/*` icon packages not approved | 28 | SpringCheck, VoicePill, PeekRating, PromptBar, BranchedMenu, CodeSlots, GlideSelect, RefineFrame, PulseHeart, BellToggle, CallChip, SlideCommit, SwipeToast, SlingButton, SwipeRow, ThoughtLine, FuseButton, ElasticSlider, FlowingMenu, ProfileCard, AnimatedList, MagicBento, Carousel, ReflectiveCard, CardNav, Stepper, Masonry, CardSwap |
| `ogl` WebGL library not approved | 10 | EvilEye, PatternWaves, MicroSlats, WarpText, DitherVeil, RippleDistortion, ElectricLogo, CrystalizedBall, MorphSlider, FlexCarousel |
| Direct `three` dependency outside the approved Vanta contract | 5 | ColorBends, Hyperspeed, PaperCrumple, Lanyard, BlobCursor |
| React Bits' private `vgpu` WebGPU package (not publishable standalone) | 2 | AeroShards, ShapeWaves |
| `matter-js` physics engine not approved | 2 | FallingText, FolderFloat |
| `@react-three/fiber` + `drei` stack not approved | 1 | ModelViewer |
| `@use-gesture/react` not approved | 1 | DomeGallery |
| **Forced exclusion: runtime CDN dependency** | 1 | GridScan — loads face-api.js + model weights from a CDN at runtime (remote script + model injection), incompatible with the offline/CSP contract |

**Adaptations (minimal, recorded per entry and in each file header):**
- 17 components: import source `motion/react` → `framer-motion` (same recorded adaptation as the original integration).
- 4 components: ONE behavior-preserving TypeScript annotation each so the files pass BEAN's strict `tsc` gate (`ChromaGrid` `stops: string[]`, `GlowCursor` `bloom: Target[]`, `PixelSwap` timer handle type, `ScrollVelocity` `spans: React.ReactElement[]`). Runtime behavior identical to upstream; header + registry record it.
- 12 components whose DEFAULT props reference remote assets (gallery images / variable fonts) are installed with an honest registry note: they work with user-supplied assets; the remote defaults degrade gracefully in the CSP-restricted preview.

**Registry:** `src/lib/frontend-intel/catalog.ts` merges the preserved 17 (commit `4e0d091…`) with the expansion set (commit `cf28010…`, data in the committed `src/lib/frontend-intel/catalog-expansion.ts`, auto-derived by the curation script with BEAN-curated descriptions/tags). Every installed entry: id, name, category, description, real dependencies (verified against the kit files' imports in BOTH directions by tests), compatibility, styling, `installed: true`, license, attribution, upstream commit, kit files, auto-selection tags. `tsc`, attribution-header and import-discipline tests enforce the contract.

**SSR validation manifest:** `tests/unit/giftz-kit-ssr-manifest.json` (generated by `scripts/kit-ssr-probe.tsx`): **167 of 168 components render server-side without throwing** (163 with default props, 4 with recorded props); the single browser-only component (`WarmTooltip`, touches `window` during render) is honestly recorded and validated by the transpiler + tsc gates — it works normally inside generated React projects (client-side).

## 4. GSAP expansion (Phase 3)

`src/lib/frontend-intel/gsap-patterns.ts` now ships **15 reusable patterns** (5 preserved + 10 new), each for BOTH targets. New patterns use ONLY official, currently-supported, appropriately-licensed builds from the installed `gsap@3.13.0` package:

| # | Pattern | GSAP capability | Plugin build vendored |
| --- | --- | --- | --- |
| 1 | entrance-timeline (preserved) | Timeline orchestration | gsap core |
| 2 | scroll-reveal-batch (preserved) | ScrollTrigger | ScrollTrigger |
| 3 | text-reveal (preserved) | Text animation | gsap core |
| 4 | hover-lift (preserved) | quickTo micro-interaction | gsap core |
| 5 | svg-draw (preserved) | SVG stroke animation | ScrollTrigger |
| 6 | **split-text** | SplitText chars/words reveal (accessible `aria:'auto'`; instance reverted on unmount) | SplitText |
| 7 | **morph-svg** | MorphSVGPlugin shape morphing (reversible hover tween) | MorphSVGPlugin |
| 8 | **motion-path** | MotionPathPlugin travel-along-path with autoRotate | MotionPathPlugin |
| 9 | **flip** | Flip layout-state transitions (grid expand/reorder) | Flip |
| 10 | **draggable** | Draggable with bounds (inertia deliberately OFF — InertiaPlugin not vendored) | Draggable |
| 11 | **observer** | Observer unified wheel/touch/pointer section navigation (used sparingly, documented) | Observer |
| 12 | **custom-ease** | CustomEase branded easing curve | CustomEase |
| 13 | **scroll-scrub** | **Responsive animations via `gsap.matchMedia()`** — scrubbed motion exists only ≥768px and is fully reverted below it | ScrollTrigger |
| 14 | **draw-svg** | DrawSVGPlugin stroke drawing | DrawSVGPlugin + ScrollTrigger |
| 15 | **scramble-text** | ScrambleTextPlugin decode effect (aria-label preserved) | ScrambleTextPlugin |

Discipline preserved and extended: every pattern guards `prefers-reduced-motion` before any tween and leaves content visible when declined; static output is one guarded init; React output uses the official `@gsap/react` `useGSAP` with `scope` + `dependencies` — and the patterns that create non-tween handles (SplitText instances, Draggable, Observer, `gsap.matchMedia`) return an **explicit cleanup** (tests enforce it). Motion remains opt-in: the default set is still entrance + scroll-reveal only.

Vendor layer (`src/lib/frontend-intel/vendor.ts`): per-plugin UMD builds are materialized into generated static projects from the installed package in canonical order (`vendor/<Plugin>.min.js` after `vendor/gsap.min.js`, before `app.js`); a missing build fails the plan loudly. `next.config.ts` tracing extended (`gsap/dist/*.min.js` + vanta's p5).

## 5. Vanta expansion (Phase 4)

`src/lib/frontend-intel/vanta.ts` now registers **13 of the 14 upstream effects**:

- **Three.js family (11):** birds, waves, net, globe, fog, clouds, rings (preserved) + **cells, dots, halo, ripple** — per-effect option keys verified against each effect's `defaultOptions` in the vanta sources (e.g. halo uses `baseColor`/`color2`, cells/ripple use `color1`/`color2`, dots has no speed).
- **p5.js family (2):** **trunk, topology** — verified p5-based (`_p5Base`); the runtime is **p5.js 0.6.1 vendored from inside the vanta package** (`node_modules/vanta/vendor/p5.min.js` → `vendor/p5.min.js`), the exact build Vanta 0.5.24 renders with.
- **Excluded honestly: `clouds2`** — fetches an external noise texture not shipped in the package; cannot satisfy the no-remote-fetch contract inside the CSP preview. Reason recorded in code and notices.

Requirements implemented per the work order: correct per-family runtime (three.js OR p5.js — the static template guards `window.THREE` vs `window.p5` and skips the WebGL probe for p5; the React `VantaBackground` imports the matching runtime and passes the p5 constructor explicitly, since bundlers do not set `window.p5`); lazy per-effect loading; responsive canvas sizing; resource cleanup (destroy on unmount/pagehide, single-renderer guard); WebGL fallback; reduced-motion fallback checked before any renderer exists; GPU resource management via the destroy contract and the performance steering below. **No effect selector exists in the UI** (see §6) — the engine selects only when the request calls for a background.

## 6. Internal AI orchestration upgrade (Phase 5 of the work order)

`resolveFrontendPlan` now builds a **SITE PROFILE** from the request and project state, and the brief carries it:

- **Website type** — landing / portfolio / dashboard / store / blog / docs detection with per-type guidance and motion budgets (e.g. "Dashboard: data density first — NO WebGL backgrounds, motion limited to feedback transitions").
- **Design style** — minimal, playful, dark, corporate, glassmorphism, neon/cyber, retro/pixel, elegant cues quoted as style guidance.
- **Animation intensity** — `subtle` (default: entrance + scroll reveal at most), `balanced` (keyword-driven additions from the pattern library), `showpiece` (explicit cinematic/showcase requests scale the set to at most 6 library patterns — never unbounded, never invented timelines).
- **Component suitability** — pointer/cursor-heavy components are skipped under a stated performance budget unless the request is explicitly playful.
- **Performance requirements** — heavy Vanta effects (globe/clouds/halo) are dropped from the AUTO path when a performance budget is stated; explicit requests are honored but the brief carries an honest performance note. Heavy-effect pages get fallback + low-end-device guidance.
- **Mobile compatibility** — mobile-first keywords add explicit touch-degradation guidance; responsive remains default-on and is verified by the generation checks.
- **Existing project dependencies** — React files in the project flip the target to React (preserved); Tailwind detection adds "style with Tailwind, don't import a second framework".
- **Deterministic validation** (`validate.ts`, extended): every GSAP plugin build a plan promises must be loaded by `index.html` before `app.js`; the Vanta runtime check is family-aware (`vendor/three.min.js` vs `vendor/p5.min.js`); all prior defect classes (remote injection, ghost kit imports, undeclared imports, version drift, missing cleanup, missing fallback, path escapes) unchanged. The engine also now reports not-installed selection ids honestly instead of silently dropping them.

The model still writes every file through the existing fence contract; `parseFiles`/`applyFiles`/diffs/self-verification/sandbox are untouched.

## 7. UI restriction — CRITICAL (implemented exactly as specified)

Removed, not replaced:

- **Deleted** `src/components/bean/giftz-frontend-panel.tsx` — the visible Frontend Toolkit selector (target framework, React Bits component catalogue chips, GSAP animation selector, Vanta background selector, responsive toggle) and the per-message Frontend summary strip (which exposed registry internals).
- **Deleted** `src/app/api/code-giftz/frontend/catalog/route.ts` (and its directory) — the registry-exposing catalogue endpoint.
- **Removed** the `frontend` selection field from the chat API zod schema and the selection wiring in `src/components/bean/code-giftz.tsx` (state, request payload, history-load mapping, bubble rendering).
- **No replacement settings panel.** A source-contract test (`tests/unit/giftz-ui-restriction.test.ts`) locks this: no panel file, no catalog route, no panel imports in the chat UI, no `frontend:` API field, no direct registry imports from app components — while asserting the capability itself remains fully wired internally.
- Nothing else in the CODE GIFTZ UI was modified (workspace, tabs, editor, diffs, sandbox terminal, preview, sidebar, research strip all untouched).

The user now simply describes what they want; the engine resolves target, components, animations and background automatically.

## 8. Testing (Phase 7)

- **Updated/expanded suites:** `frontend-intel-catalog` (registry truth at scale: 218 accounted, both upstream pins, adaptation records, dependency↔import consistency both directions, honest exclusions), `giftz-kit-render` (168-file coverage via the manifest; transpiler parse of every `.tsx`; balanced-CSS check; 167 SSR no-throw renders; the one browser-only entry honestly recorded; original-15 regression guard), `frontend-intel-gsap` (15 patterns; every required plugin build exists on disk; explicit-cleanup enforcement; reduced-motion in every pattern), `frontend-intel-vanta` (13 effects; clouds2 exclusion evidence; per-family runtime guards in BOTH static and React contracts; per-effect option mapping; vendor order), `frontend-intel-engine` (site profile: dashboard suppression, performance budget vs explicit requests, showpiece intensity bounded, plugin vendor builds, p5 pinning for trunk/topology in static AND React), `frontend-intel-validate` (unchanged, all green), plus NEW `giftz-ui-restriction`.
- **Full suite: 1,719 pass / 0 fail / 124 files / 38,043 expects** (baseline before this task: 1,579 pass / 110 files — the delta is the new/expanded tests; no existing test weakened or deleted; the only pre-existing type error fixed was the `shared-rate-limit.test.ts` mock declaration, which strengthens the mock's typing without changing behavior).
- **Existing CODE GIFTZ behavior:** all giftz chat-streaming / workspace / sandbox / mode tests green — unchanged.
- **ESLint:** 0 errors, 0 warnings (the kit-scoped override was extended with the react-hooks v6 rule ids the expanded upstream files trip — upstream code itself was NOT rewritten to satisfy lint).
- **TypeScript:** `tsc --noEmit` → **0 errors in src/ and tests/**; 137 pre-existing errors in `scripts/` exactly as before this task (recorded separately per policy; this task's scripts contribute zero).
- **Sandbox approval:** untouched — runs still require explicit per-run user approval; no test exercises a bypass.

## 9. Production build

- `npm run build` (Next.js 16 standalone) — **PASS**.
- Standalone output verified to contain the expanded traced set: `.next/standalone/src/components/giftz-kit/**` (323 files), `node_modules/gsap/dist/*.min.js` (core + all 10 plugin builds), `node_modules/three/build/three.min.js`, `node_modules/vanta/dist/*.min.js` (all 14 bundles), `node_modules/vanta/vendor/p5.min.js` — so engine file reads work identically in dev, test and production.

## 10. Licensing (Phase 8; primary sources re-verified)

| Library | Version / pin | License (source verified) | Distribution in generated projects |
| --- | --- | --- | --- |
| GSAP | 3.13.0 (unchanged) | Standard "No Charge" GSAP License (gsap.com/standard-license; free incl. commercial since 2025-04-30; AI-generated GSAP code explicitly not a prohibited use) | Core + per-plugin minified UMD builds + notices; proprietary notices preserved |
| @gsap/react | 2.1.2 | Standard "No Charge" GSAP License | Declared dependency in React-target package.json |
| Vanta | 0.5.24 | MIT (`LICENSE.md` re-read) | Per-effect bundles + MIT notices |
| three.js | 0.134.0 | MIT (`LICENSE` re-read) | Vendored UMD + MIT notices |
| **p5.js** | **0.6.1** (vendored from inside the vanta package) | **LGPL-2.1** (upstream v0.6.1) | Vendored unmodified as a separate, replaceable `vendor/p5.min.js` only for p5-based effects; project `NOTICES.md` carries the license, version and upstream source link, keeping the library inspectable/replaceable per LGPL |
| React Bits | commits `4e0d091…` (17) + `cf28010…` (151) | **MIT + Commons Clause v1.0** — `LICENSE.md` re-read at BOTH commits (identical text) | Components inside generated applications (the license's permitted "as part of an application, website, or product" case); attribution headers preserved in every file; per-project `NOTICES.md`; **no Pro content**; the library is INTERNAL (no catalogue UI/API surface), never sold or redistributed as a component pack |
| framer-motion | 12.26.2 (unchanged) | MIT | Declared dependency for adapted components |

`docs/THIRD-PARTY-NOTICES.md` updated with the expansion facts, the second pinned commit, the p5.js entry and its LGPL posture, and the internal-only distribution note. The Commons Clause re-review trigger remains recorded.

## 11. Dependency changes

**None in BEAN's own `package.json`** — no new npm dependencies were installed. GSAP plugin builds come from the already-pinned `gsap@3.13.0`; the p5 runtime is vendored from the already-pinned `vanta@0.5.24`'s own `vendor/` directory. Generated React projects that select a p5-based Vanta effect pin `p5@0.6.1` (the npm package of the same version Vanta vendors) in their emitted `package.json`.

## 12. Files changed (complete list)

**Deleted (2):**
- `src/components/bean/giftz-frontend-panel.tsx` (visible toolkit panel + summary strip)
- `src/app/api/code-giftz/frontend/catalog/route.ts` (registry-exposing endpoint)

**Added (302 files):**
- `src/components/giftz-kit/` — 294 new component files (151 `.tsx` + 143 `.css` companions)
- `src/lib/frontend-intel/catalog-expansion.ts` (committed registry data, auto-derived + curated)
- `tests/unit/giftz-ui-restriction.test.ts`, `tests/unit/giftz-kit-ssr-manifest.json`
- `scripts/kit-expansion-curation.ts`, `scripts/kit-expansion-scan.ts`, `scripts/kit-ssr-probe.tsx` (provenance + validation tooling), `scripts/kit-expansion-out/selection.json` (selection evidence)
- `docs/CODE-GIFTZ-INTERNAL-FRONTEND-LIBRARY-REPORT.md` (this document)

**Modified (17):**
- `src/lib/frontend-intel/` — `catalog.ts` (merged registry), `gsap-patterns.ts` (15 patterns + plugin build map), `vanta.ts` (13 effects + per-family runtime), `vendor.ts` (plugin builds + p5), `engine.ts` (site profile + plugin vendoring + honest not-installed reporting), `validate.ts` (plugin/p5 vendor checks)
- `src/app/api/code-giftz/chat/route.ts` (selection field removed; plan resolution unchanged otherwise)
- `src/components/bean/code-giftz.tsx` (panel/summary/state wiring removed; nothing else)
- `next.config.ts` (tracing: all plugin builds + p5), `eslint.config.mjs` (kit-scope rule ids), `docs/THIRD-PARTY-NOTICES.md`
- `tests/unit/` — `frontend-intel-catalog.test.ts`, `frontend-intel-gsap.test.ts`, `frontend-intel-vanta.test.ts`, `frontend-intel-engine.test.ts`, `giftz-kit-render.test.tsx`, `shared-rate-limit.test.ts` (pre-existing mock type fix, behavior unchanged)

**Unrelated files touched:** none. **Schema/migrations:** none.

## 13. Remaining limitations (honest)

1. 50 upstream components remain un-integrated for recorded dependency/licensing reasons (§3 table); they are registry-visible as "not installed" with reasons, never advertised.
2. `clouds2` (Vanta) is unsupported — external texture dependency (recorded).
3. 12 installed components use remote-asset DEFAULTS (gallery images / variable fonts); they work with user-supplied assets, and the CSP-restricted preview shows their fallbacks until real assets are provided (noted per entry).
4. 1 of 168 components (`WarmTooltip`) is not SSR-renderable in BEAN's probe (browser API during render) — validated by parse + tsc; works client-side in generated projects (recorded in the manifest).
5. React-target projects remain code deliverables without live preview (sandbox executes single files) — labeled honestly in the brief.
6. The 4 type-annotation adaptations and 17 import adaptations are deviations from verbatim upstream, each recorded in the file header and registry.
7. Deterministic checks report; they do not auto-correct (unchanged from the original integration).
8. GSAP remains pinned at 3.13.0; `gsap.matchMedia()` responsiveness covers the scroll-scrub pattern; other patterns are layout-agnostic by design.

## 14. Publication

Per the repo sync policy: full gates on the exact tree (§8–9), push-delta secret/forbidden-artifact scan (zero hits), ONE descriptive commit on `main`, fast-forward push only (never force-push), `git ls-remote origin refs/heads/main` verified equal to local HEAD immediately after push (verified SHA reported in the session delivery message), final working tree clean.
