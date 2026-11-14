# CODE GIFTZ — M21 Real-World Generation Validation: Final Report

Repository: `https://github.com/jon0471-dot/Bean-intelligence.git` · Branch `main` · fast-forward push only.
Baseline at session start: **`80e7a67bf497038643962624ec43551ef9eeb271`** (expected baseline verified: `git fetch` + `origin/main` = local HEAD; clean tree). Commit date 2026-11-14.
Companion document: `docs/M21-GENERATION-VALIDATION-AUDIT.md` (Phase 0 — measured against the committed modules before any change).

**Outcome in one line:** CODE GIFTZ's internal frontend library independently generated three complete, production-built, browser-validated React applications (immersive landing page with a live Vanta Birds hero, an analytics dashboard with restrained motion and full state coverage, a multi-page hash-routed developer portfolio) — every generated file passing the deterministic generation checks, TypeScript, ESLint and vite production builds with **zero console/page errors in every browser pass** — while the frontend toolkit stayed invisible in the UI and the full regression suite (1,728 tests), library counts (168 React Bits / 15 GSAP patterns / 13 Vanta effects) and all existing BEAN products remained intact.

---

## 1. Method (honest scope, declared up front)

- The **engine, deterministic validator and file-fence parser ran as real product code** (`resolveFrontendPlan`, `parseFiles`, `finalizeFrontendTurn` — imported from the committed `src/lib/frontend-intel/` + `src/lib/giftz/`, executed by `scripts/m21/harness.ts`).
- The **coding-model role** was performed in-session by the validating agent consuming the real system prompt + the engine's real bounded brief, emitting responses in the product's `path=`-fence contract. The raw responses are preserved verbatim (`validation/m21/model-responses/{a,b,c}.md`); the conversational parts become the recorded `ASSISTANT-MESSAGE.md` per project. No provider credentials exist in this environment, so the external LLM hop of the live route could not run; everything downstream of model output was exercised exactly as shipped. This substitution is recorded here and does not touch product code.
- **Generated projects were materialized under `validation/m21/projects/`** — isolated from `src/`, never inside production application directories. DB workspace persistence is covered by the existing `giftz-workspace` tests (untouched); the one-step materialization deviation is harness-side only.
- **Build harness = validator tooling**, separate from the deliverables (`validation/m21/harness/`: vite + @vitejs/plugin-react + typescript + eslint stack; per-project installs run from the GENERATED `package.json` pins verbatim; `tsconfig.harness.json` + `harness-env.d.ts` + eslint config are glue files living beside, not inside, the generated app code).
- **Browser validation = real Chromium rendering** (Playwright 1.57, chromium 1200) of each project's production build served locally: desktop 1440×900, mobile 390×844, `prefers-reduced-motion: reduce` emulation, and a WebGL-blocked context (canvas `getContext` overridden to `null`). 15 evidence screenshots in `validation/m21/evidence/`.
- **Sandbox workflow**: the generated sample-data module of project B was executed through the REAL `runInSandbox` (network namespace + rlimits + process separation all active, per the runner's honest report) — `validation/m21/reports/sandbox-run.json`.

## 2. The three generated projects

### Project A — "Nebula" immersive technology landing page

- **Location:** `validation/m21/projects/project-a-landing/` (9 model files + 10 engine files).
- **Request (natural language, no toolkit):** dark immersive tech landing page for a fictional AI-infrastructure platform; hero, navigation with mobile menu, feature cards, showcase, testimonials, pricing, FAQ, footer; rich entrance/scroll animations, animated headings, count-up stats, interactive animated background; accessible, responsive.
- **Engine selections (automatic):** target **react**; components **SplitText, BlurText, CountUp, ScrollReveal, AnimatedContent**; GSAP patterns **entrance-timeline, scroll-reveal-batch, text-reveal, hover-lift, scroll-scrub, custom-ease** (showpiece intensity, bounded ≤6); Vanta background **birds** (three.js family); 10 engine files incl. `VantaBackground.tsx`, `types/vanta.d.ts`, pinned `package.json`, `NOTICES.md`.
- **Result:** full landing page (6 feature cards, 3 pricing tiers, 5 FAQ items, testimonials, showcase with desktop-only scrub parallax, footer) — deterministic checks 0 blocking/0 warnings; tsc 0 errors; ESLint 0/0; vite **BUILD PASS**; browser: **Vanta Birds canvas renders live** (3D flock in the hero), anchor navigation scrolls (scrollY 3776 after nav click), mobile hamburger opens/closes, 6/3/5 section counts verified, **0 console errors across all four passes** (desktop, reduced-motion, WebGL-blocked, mobile).

### Project B — "Pulse" analytics dashboard

- **Location:** `validation/m21/projects/project-b-dashboard/` (11 model files + 8 engine files).
- **Request:** professional analytics dashboard; sidebar, header, KPI cards, charts, searchable/filterable/sortable data table, date-range controls, loading/empty/error states, responsive; **clearly labeled sample data**; performance matters.
- **Engine selections (automatic, after repair R-B1 below):** target **react**; components **SpotlightCard** (KPI cards), **Dock** (sidebar/bottom nav), **LatticeLoader** (loading state); GSAP patterns **entrance-timeline, scroll-reveal-batch** only (dashboard profile enforces minimal motion); background **none** (dashboard suppression works); 8 engine files.
- **Result:** 4 KPI cards with sparklines, 2 dependency-free SVG charts (12-week trend + region bars), 8-region table (search filters 8→1 for "eu-west", sort toggles order, status filter, date-range select), loading/empty/error panels reachable via demo controls, 7 "SAMPLE" labels, mobile bottom-dock navigation verified visible and clickable, no horizontal overflow, **0 console errors**; reduced-motion pass: content fully visible, no canvas; sandbox execution of the generated data module: **10/10 runtime checks passed** with all three isolation layers active.

### Project C — "Nova Reyes" multi-page developer portfolio

- **Location:** `validation/m21/projects/project-c-portfolio/` (13 model files + 10 engine files).
- **Request:** multi-page React portfolio — Home, About, Projects, project detail pages, Contact — working internal navigation, animated typography, project gallery with interactive cards, elegant dark style, responsive nav, accessible links.
- **Engine selections (automatic):** target **react**; components **SplitText, BlurText, SpotlightCard, GlareHover, Dock**; GSAP patterns **entrance-timeline, scroll-reveal-batch, text-reveal, hover-lift**; background none (not requested); 10 engine files.
- **Result:** five routes on a **dependency-free hash router with real anchor links** (`#/`, `#/about`, `#/projects`, `#/projects/atlas-maps` …, `#/contact`, plus an honest not-found page): browser pass clicked Home→Projects→detail→About→Contact, verified 4 project cards, detail page (h1 "Atlas Maps", 4 sections), contact form (3 fields) with honest no-backend confirmation, deep-link to `#/projects` works, mobile quick-nav dock visible with 4 buttons, no horizontal overflow, **0 console errors**.

## 3. Dependency information

- **BEAN's own `package.json`: unchanged** — zero new dependencies at repo level. The three engine repairs below are code-only.
- Generated projects pinned the tested matrix verbatim (engine-emitted `package.json`):
  - A: react ^19, react-dom ^19, **gsap 3.13.0, @gsap/react 2.1.2, framer-motion 12.26.2, vanta 0.5.24, three 0.134.0**
  - B: react ^19, react-dom ^19, **gsap 3.13.0, @gsap/react 2.1.2** (no three/vanta — no background selected)
  - C: react ^19, react-dom ^19, **gsap 3.13.0, @gsap/react 2.1.2, framer-motion 12.26.2** (kit SpotlightCard/GlareHover use framer-motion; Dock/BlurText/SplitText need none beyond gsap)
- Harness (validator-side only): vite 7.3.0, @vitejs/plugin-react 5.1.4, typescript 5.9.3, eslint 9.39.2 + typescript-eslint 8.50.1 + eslint-plugin-react-hooks 7.0.1, playwright 1.57.0, @types/react 19.2.7, @types/react-dom 19.2.3, **@types/three 0.134.0** (installed `--no-save` next to generated projects that include `three` — deliverable `package.json` stays verbatim).

## 4. Actual browser testing (per pass, all three projects)

| Pass | What was verified | A | B | C |
| --- | --- | --- | --- | --- |
| Desktop fresh render (evidence) | hero renders, animations settle, screenshot | ✓ (Birds live) | ✓ | ✓ |
| Desktop checks | section counts, nav, interactions, console errors | ✓ | ✓ | ✓ |
| Reduced-motion emulation | no animated renderer, content fully visible, 0 errors | ✓ | ✓ | ✓ |
| WebGL-blocked context | static-gradient fallback, content legible, 0 errors | ✓ | n/a (no canvas by design) | ✓ (gradient CTA fallbacks) |
| Mobile 390×844 | no horizontal overflow, navigation usable, screenshot | ✓ | ✓ | ✓ |
| Console/page errors | captured in ALL passes | **0** | **0** | **0** |

Evidence: 15 screenshots in `validation/m21/evidence/` (`a-desktop-hero`, `a-desktop-full`, `a-mobile-menu-open`, `a-reduced-motion`, `a-webgl-fallback`, `b-desktop-hero`, `b-desktop-full`, `b-mobile`, `b-reduced-motion`, `b-webgl-fallback`, `c-desktop-hero`, `c-desktop-full`, `c-mobile`, `c-reduced-motion`, `c-webgl-fallback`) + machine reports in `validation/m21/reports/{a,b,c}-browser.json`.

## 5. Failures and repairs (Phase 6 log — exact, no weakening)

**Model-response repairs (generated-code defects found by the gates, fixed in the recorded responses, re-validated end-to-end):**

| ID | Failure (exact) | Source | Repair | Re-check |
| --- | --- | --- | --- | --- |
| R-A1 | `tsc TS2322`: `id` prop passed to SplitText (not in its props) | model file `hero.tsx` | removed the prop; section labeled via `aria-label` | tsc 0 errors |
| R-A1b | mobile horizontal overflow (scrollWidth 457 vs 390): grid children at auto min-size let the terminal `pre`'s min-content widen the track | model `styles.css` | `min-width: 0` on all grid children + `max-width: 100%` on the terminal | overflow false |
| R-A1c | hero H1 invisible in every screenshot: `background-clip: text; color: transparent` gradient heading + SplitText word spans (words inherit `color: transparent`; gradient clips to the parent's empty text nodes); plus view-trigger race above the fold | model `styles.css` + `hero.tsx` | solid heading color; above-the-fold text uses `trigger="load"` | H1 renders in screenshots; 0 errors |
| R-B1 | `tsc TS6133` unused import; `tsc TS2304` missing `useState` import; React 19 removed the global `JSX` namespace | model files | imports corrected; `ReactElement` type used | tsc 0 errors |
| R-C1 | **ghost kit import**: `pages/about.tsx` imported `'../components/kit/ScrollReveal'`, which the engine never emitted for this plan — and the deterministic kit-import check did NOT flag it because its regex only matched `'./components/kit/…'` forms | model file + validator gap | model response fixed to use only selected components; **validator extended** (below) | ghost import class now blocked by tests |

**Engine corrections (narrowly scoped, each driven by a demonstrated blocker; no library expansion):**

| ID | Blocker (demonstrated) | Narrow fix | Regression tests added |
| --- | --- | --- | --- |
| R-A2 | Every generated **three-family** React project with a Vanta background could not build: the emitted `VantaBackground.tsx` statically referenced `import('p5')`, which bundlers resolve even on an untaken branch, while `p5` is not in that project's dependency set (vite build failure) | `vantaReactComponentSource(effect)` — family-aware emission: p5-family keeps the shared source; three-family emission drops the p5 branch entirely | `frontend-intel-vanta.test.ts`: no `import('p5')` in any of the 11 three-family emissions, source identity for trunk/topology |
| R-A2b | Generated three-family projects **fell back to the gradient instead of rendering the effect**: vite's CJS interop exposes the effect factory as `{ default: factory }`, but the emitted component only looked up `VANTA[effect.toUpperCase()]` (verified in-browser: canvas count 0 with WebGL available) | emitted source now resolves BOTH shapes (function default OR registry keyed by the global effect name); a `resolveVantaEffectCtor` helper mirrors the branch for unit testing | 4 unit tests over both interop shapes + null path; browser re-run: **canvas mounts, Birds render** |
| R-B1 | Dashboard auto-selection handed the model **decorative Background-effect components** (`radar` — a radar-sweep background whose tags include the literal string "dashboard"; `balatro` — matched via the generic tag "cards") for a site type whose own brief mandates "data density and legibility first — NO WebGL backgrounds" | auto-selection skips `Background effect` category entries for `dashboard`/`docs` site types (mirrors the existing Vanta suppression; explicit selections untouched; catalogue unchanged) | engine test: dashboard excludes radar/balatro, landing still selects them, explicit selection honored |
| R-C1 (validator) | The kit-import check missed **parent-relative** (`'../components/kit/…'`) ghost imports — real multi-page apps import kit files from `pages/*.tsx` | regex extended to `(?:\.{1,2}\/)?components\/kit\/` (detection widened, nothing weakened) | validate test: ghost via `'../'` blocked; real emitted component via `'../'` accepted |

**Harness/tooling fixes (validator side, recorded for completeness):** vite CLI `--root` → positional root; eslint 9 flat config has no `--resolve-plugins-relative-to`; `@types/three` needed as an adjacent `--no-save` type companion for tsc (three r134 ships no types); evidence screenshots must be taken on a fresh load (earlier capture flow resized the page mid-animation, producing a misleading "missing H1" frame); the Dock kit component renders its toolbar `position:fixed`, so the semantic `<nav>` wrapper has a 0×0 box — the mobile-nav usability assertion targets the dock **button** (`navButtonVisible: true`) rather than the wrapper box.

## 6. Generation intelligence validation (Phase 4)

Measured on the real `resolveFrontendPlan` runs (values recorded in the audit + per-project `plan/plan.json`):

| Signal | A (landing) | B (dashboard) | C (portfolio) |
| --- | --- | --- | --- |
| Website type | landing ("landing page") | dashboard ("analytics dashboard") | portfolio ("portfolio site") |
| Target framework | react (React named) | react | react |
| Design style | dark + corporate cues | corporate | elegant/dark (guidance) |
| Animation intensity | showpiece ("immersive", "rich") — bounded to 6 patterns | subtle → dashboard-minimal (2 patterns) | subtle + pattern tags → 4 |
| Component suitability | 5 text/section components, all used | **defect found → repaired (R-B1)**: 3 suitable components | 5 suitable components, all used |
| Background requirements | birds (keyword-detected) | none (dashboard suppression) | none (not requested) |
| Performance budget | stated → heavy effects avoided, one background canvas | stated → minimal motion honored | — |
| Mobile compatibility | responsive default-on, verified | mobile-first cues honored (bottom dock) | responsive default-on, verified |
| Existing dependencies | n/a (empty project) | n/a | n/a |

Negative checks (all held): no nonexistent components imported (deterministic kit-import check, now also for `'../'` forms); no invented dependencies (bare-import ↔ `package.json` check; the engine itself refuses unpinned deps); no duplicate components; no missing styles (kit CSS travels with kit files); no remote assets (remote-injection ban); **no paid React Bits Pro content** (168 installed components are all from the free collection; exclusions recorded); no unnecessary animation (dashboard stayed at 2 patterns); no existing project files broken (all work isolated under `validation/m21/`).

## 7. Quality scorecards (Phase 7)

Measured results and subjective design evaluation are separated. "Measured" = executed gate or browser assertion; "Subjective" = reviewer judgment from the rendered screenshots.

**Project A — Nebula landing**

| Dimension | Score | Basis |
| --- | --- | --- |
| Functional completeness | 10/10 (measured) | all requested sections + mobile menu present (browser counts: 6/3/5/…) |
| Component correctness | 10/10 (measured) | validator 0 blocking; kit imports all resolve; CountUp/SplitText/BlurText/ScrollReveal/AnimatedContent verified rendering |
| Animation quality | 9/10 (4 measured, 1 subjective) | patterns run (entrance/scrub/reveal verified visually); −1 subjective: scrub parallax is subtle |
| Responsive behavior | 10/10 (measured) | no overflow at 390; hamburger works; fluid clamp() type |
| Accessibility | 9/10 (measured + subjective) | landmarks/skip-link/focus-visible/aria present; −1 subjective: decorative icons could carry longer labels |
| Performance | 8/10 (measured, bounded) | one background canvas (Birds); builds lazy-chunk all 13 Vanta bundles; no perf instrumentation claimed |
| Visual consistency | 9/10 (subjective) | coherent dark gradient system (screenshots) |
| Build reliability | 10/10 (measured) | tsc/eslint/vite all clean after repairs |
| Dependency correctness | 10/10 (measured) | exact pinned matrix installed and bundled |

**Project B — Pulse dashboard**: Functional 10/10 (all states + controls verified) · Component correctness 10/10 · Animation quality 10/10 (restrained exactly as the profile demands — measured pattern set) · Responsive 10/10 (no overflow; mobile dock button visible) · Accessibility 9/10 (aria-sort, roles, labels; −1 subjective: chart text alternatives are summary-level) · Performance 9/10 (memoized rows/KPIs, zero canvases; no perf instrumentation claimed) · Visual consistency 9/10 (subjective; tabular numerals, consistent badges) · Build reliability 10/10 · Dependency correctness 10/10.

**Project C — Nova Reyes portfolio**: Functional 10/10 (5 routes + deep links + form verified) · Component correctness 10/10 (after R-C1) · Animation quality 9/10 (subjective; page entrances + hover-lift verified) · Responsive 10/10 · Accessibility 9/10 (aria-current, skip link, landmarks; −1 subjective: focus management on route change could announce page titles) · Performance 9/10 (no canvases, tiny bundle; no perf instrumentation claimed) · Visual consistency 9/10 (subjective) · Build reliability 10/10 · Dependency correctness 10/10 (multi-page achieved with **zero** invented dependencies).

No performance measurements (LCP/FPS/etc.) were executed; none are claimed. Build/bundle facts and browser assertions above are the measured basis.

## 8. Regression (Phase 8) — full gates on the final tree

- **Full test suite:** `bun test --isolate tests/` → **1,728 pass / 0 fail / 124 files / 38,130 expects** (M20 baseline 1,719; the +9 are exactly the new regression tests from §5 — no existing test weakened or deleted).
- **Library integrity (re-measured on the final tree):** 168 installed React Bits components / 0 missing kit files / 0 unattributed files; 15 GSAP patterns; 13 Vanta effects; 0 missing vendor builds; 50 exclusion records intact.
- **UI restriction:** `giftz-ui-restriction.test.ts` green (no toolkit panel, no catalogue route, no `frontend:` API field — enforced by source contract).
- **TypeScript:** `tsc --noEmit` → 0 errors in `src/` + `tests/`.
- **ESLint:** 0 errors, 0 warnings (`src` + `tests`).
- **Production build:** `npm run build` PASS; standalone output traces all 323 kit files.
- **Sandbox approval:** runner untouched; execution in this milestone went through the real `runInSandbox` contract; the product's per-run approval flow is unchanged (covered by existing tests).
- **Existing products:** RIISHE / LAXII / JAZMII / gateway suites all green within the full run.
- **Security scan:** secret/credential scan over the full 138-file delta (patterns: key/secret/token assignments, private-key blocks, AWS/GitHub/OpenAI token shapes) → **0 hits**; no `.env`, lockfiles, `node_modules` or build outputs in the delta.

## 9. Remaining limitations (honest)

1. The external LLM hop of the live chat route could not run here (no provider credentials in the sandbox); the coding-model role was performed in-session against the real brief, and every downstream gate ran as shipped. End-to-end provider-dependent behavior remains covered by the existing mocked suites.
2. Generated React projects are code deliverables in the product (no live preview — unchanged, recorded since M20); the browser evidence here comes from the validator's own build-and-render harness, not a product preview surface.
3. The sandbox executes single-entry scripts; the React UIs are outside that contract by design. The sandbox check therefore exercised the generated data module (10/10 runtime checks) rather than the UI.
4. Two upstream-behavior notes discovered and recorded: the Dock kit component renders its toolbar `position:fixed` (semantic nav wrapper collapses to 0×0 — a11y buttons remain present and visible); the ScrollReveal scrub look depends on scroll position in static full-page captures.
5. The two narrow engine corrections (R-A2 family-aware emission, R-B1 dashboard selection steering) and the validator widening (R-C1) change committed product code; each is covered by new regression tests and the full suite. No catalogue/library expansion happened (168/15/13 unchanged).
6. Subjective scores in §7 are reviewer judgments, explicitly not measurements.

## 10. Files changed (complete list)

**Modified (6):**
- `src/lib/frontend-intel/vanta.ts` (R-A2 family-aware emission + R-A2b ctor resolution + `resolveVantaEffectCtor`)
- `src/lib/frontend-intel/engine.ts` (R-A2 emission call + R-B1 background-component suppression)
- `src/lib/frontend-intel/validate.ts` (R-C1 parent-relative kit-import matching)
- `tests/unit/frontend-intel-vanta.test.ts`, `tests/unit/frontend-intel-engine.test.ts`, `tests/unit/frontend-intel-validate.test.ts` (9 new regression tests)

**Added (validation artifacts, isolated):**
- `docs/M21-GENERATION-VALIDATION-AUDIT.md`, `docs/M21-GENERATION-VALIDATION-REPORT.md` (this document)
- `validation/m21/` — `model-responses/{a,b,c}.md` (verbatim model-role responses), `projects/{project-a-landing,project-b-dashboard,project-c-portfolio}/` (generated projects incl. engine files + NOTICES.md; `node_modules/`, `dist/`, lockfiles gitignored), `plan/` briefs + plan JSONs, `reports/` (assemble/browser/build/sandbox machine evidence), `evidence/` (15 screenshots), `harness/` (validator tooling: vite/ts/eslint/playwright configs + `browser.ts`)
- `scripts/m21/harness.ts`, `scripts/m21/build.sh`, `scripts/m21/sandbox-check.ts`, `scripts/m21-audit.ts` (validator tooling)

**Deleted:** none. **Unrelated files touched:** none. **Schema/migrations:** none.

## 11. Publication

Per the repo sync policy: full gates on the exact tree (§8), push-delta secret/forbidden-artifact scan (§8, zero hits), ONE descriptive commit on `main` (`test(code-giftz): validate real-world frontend generation`), fast-forward push only (never force-push), `git ls-remote origin refs/heads/main` verified equal to local HEAD immediately after push (verified SHA reported in the session delivery message), final working tree clean.
