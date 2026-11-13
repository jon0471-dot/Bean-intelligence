# CODE GIFTZ — Frontend Intelligence Toolkit Integration: Final Report

Repository: `https://github.com/jon0471-dot/Bean-intelligence.git` (branch `main`, fast-forward push only, remote SHA verified).
Starting commit: `a82f3f6ac3650137b92570a3040c050163923431` (local HEAD == `origin/main` at session start, clean tree).
Companion documents: `docs/CODE-GIFTZ-FRONTEND-INTELLIGENCE-AUDIT.md` (Phase 0, written BEFORE implementation) and `docs/THIRD-PARTY-NOTICES.md`.

---

## 1. Audit findings (summary)

Full findings in the audit document. The decisive ones that shaped the design:

- Generated CODE GIFTZ projects are **standalone static web apps** (`index.html` + `styles.css`/`app.js`), previewed in a `sandbox="allow-scripts"` iframe under CSP `default-src 'none'; script-src 'unsafe-inline'; …` — **no remote fetch can ever run in the preview**. Therefore every library a generated project uses is materialized as a project file (`vendor/*.js`); the existing preview route already inlines project `.js` files, so animations and 3D backgrounds work fully offline.
- The preview route's inliner and `assertSafeProjectPath` (relative paths only, no `..`) were reused, not modified.
- The sandbox executes a single file (no bundler, no npm install) and **only after explicit per-run user approval** — unchanged. React-target output is therefore honestly labeled a **code deliverable without live preview**.
- The self-verification pipeline, continuation control, file-fence contract, honest diffs, metering, audit logging and rate limits were preserved untouched.
- **No database migration was needed**: frontend plan/check metadata rides the existing `metaJson`/`paramsJson` JSON columns (additive key). Zero schema changes, zero destructive operations.

## 2. Exact source components selected (React Bits free collection)

Upstream pinned at commit `4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce`; implementations vendored verbatim (attribution header added) into `src/components/giftz-kit/`; the React Bits repository itself was never copied wholesale.

| # | Component | Category | Dependencies | Adaptation |
| --- | --- | --- | --- | --- |
| 1 | SplitText | Animated heading / split text | gsap, @gsap/react | — |
| 2 | TextType | Typewriter | gsap | — |
| 3 | BlurText | Animated heading | framer-motion | `motion/react` → `framer-motion` |
| 4 | ShinyText | Text effect (CSS) | — | — |
| 5 | GradientText | Text effect (CSS) | — | — |
| 6 | CountUp | Number animation | framer-motion | `motion/react` → `framer-motion` |
| 7 | ScrollReveal | Scroll reveal (text) | gsap | — |
| 8 | AnimatedContent | Responsive page sections | gsap | — |
| 9 | StarBorder | Interactive button | — | — |
| 10 | ClickSpark | Click interaction (canvas) | — | — |
| 11 | SpotlightCard | Card / hover glow | — | — |
| 12 | GlareHover | Hover interaction (CSS) | — | — |
| 13 | GlassSurface | Glass effect | — | — |
| 14 | LetterGlitch | Background effect (canvas) | — | — |
| 15 | DotGrid | Background effect (canvas) | — | — |
| 16 | Dock | Animated navigation | react-dom (portal) | — |
| 17 | LatticeLoader | Loading state | — | — |

Registry (`src/lib/frontend-intel/catalog.ts`) records id, name, category, source repository + URL (pinned commit), required dependencies, framework compatibility, styling requirements, variants (ts/js × default/tailwind), **installation status** (`installed: true` only for the 17 validated above; Aurora/Particles/Lanyard recorded as `installed: false` with honest reasons — their extra WebGL dependencies were not approved), license and attribution. The "never advertise a component as installed unless its implementation exists and has passed validation" rule is enforced by tests that check every registry entry against the kit directory, its declared imports, and SSR render results.

## 3. GSAP features integrated (Phase 2)

`src/lib/frontend-intel/gsap-patterns.ts` — five reusable patterns injected into the generation brief (never uncontrolled custom timelines):

1. **Entrance timeline** (staggered fade+rise, `clearProps` so the final DOM is clean).
2. **ScrollTrigger reveal** (`ScrollTrigger.batch`, `once: true`, initial state set only when animation runs).
3. **Text reveal** (word-span split with `aria-label`/`aria-hidden` preserved for screen readers).
4. **Hover lift** (`gsap.quickTo` — reversible, no stuck tweens).
5. **SVG draw** (stroke-dashoffset draw on scroll).

Every pattern: consults `prefers-reduced-motion` **before** any tween and leaves content visible when motion is declined; React variants use the **official `@gsap/react` `useGSAP` integration** with `scope` and `dependencies: [ScrollTrigger]` so the context revert cleans both tweens and ScrollTriggers on unmount. Selection is deliberately minimal (default: entrance + scroll reveal); motion is opt-in per turn — animations are NOT added to every generated component by default.

## 4. Vanta effects integrated (Phase 3)

`src/lib/frontend-intel/vanta.ts` — all seven required effects registered (`birds`, `waves`, `net`, `globe`, `fog`, `clouds`, `rings`), each verified to exist as a real bundle in the pinned package. Configurable: colors (per-effect documented option names), background, speed, zoom (only where the effect supports them), mouse controls, touch controls, responsive sizing (`minHeight/minWidth` + full-bleed host element). Lifecycle contract enforced in both the static template and the emitted React component: init only after mount/DOM-ready, destroy on unmount/page-hide, single-renderer guard (destroy before any re-init), lazy per-effect loading, `WebGLRenderingContext` probe with static-gradient fallback, reduced-motion → static fallback checked before any renderer exists, foreground children above the canvas with `aria-hidden` decoration.

## 5. License review (Phase 7; primary sources)

| Library | Version | License (source verified) | Distribution in generated projects |
| --- | --- | --- | --- |
| GSAP | 3.13.0 | Standard "No Charge" GSAP License (gsap.com/standard-license; free incl. commercial since 2025-04-30; AI-generated GSAP code explicitly not a prohibited use) | Vendored minified builds + notices; proprietary notices preserved |
| @gsap/react | 2.1.2 | Standard "No Charge" GSAP License | Declared dependency in React-target package.json |
| Vanta | 0.5.24 | MIT (`LICENSE.md` read verbatim) | Vendored per-effect bundles + MIT notices |
| three.js | 0.134.0 | MIT (`LICENSE` read verbatim; © 2010-2021 three.js authors) | Vendored UMD build + MIT notices |
| React Bits | commit `4e0d091` | **MIT + Commons Clause v1.0** (upstream `LICENSE.md` read verbatim) | 17 components inside generated applications (the license's permitted "as part of an application, website, or product" case); attribution headers preserved in every file; per-project `NOTICES.md`; **no Pro content**; catalogue never exposed as a sellable/redistributable component pack |

Commons Clause compliance posture: BEAN's catalogue is an internal capability of a coding assistant whose output is an application — use and distribution "as part of an application, website, or product" is exactly what the license grants. The restriction (no selling/sublicensing/redistributing the components themselves, alone/bundled/ported) is respected by design; a re-review trigger is recorded in the notices document should BEAN's distribution model change.

## 6. Dependency versions (pinned, compatibility-checked before installation)

- Installed with `bun add --exact` (bun.lock authoritative): `gsap@3.13.0`, `@gsap/react@2.1.2`, `vanta@0.5.24`, `three@0.134.0`.
- **three@0.134.0 is a deliberate downpin**: Vanta's official site ships `three.r134.min.js`; newer three removed the UMD `build/three.min.js` and breaks Vanta's global-THREE contract. Verified post-install: all seven effect bundles + GSAP core + ScrollTrigger + three UMD builds present.
- Pre-existing stack checked first: Next.js 16.1.1, React 19, TypeScript 5, Tailwind 4, framer-motion 12.26.2 (already installed — reused for the two adapted components). No conflicting peers; `vanta`/`three` are not imported by BEAN app code (zero bundle weight to the live app).
- Generated React projects receive a `package.json` pinning the SAME tested exact versions (validated by the dependency-drift check).

## 7. Files changed (complete list)

**Added (14 paths):**
- `docs/CODE-GIFTZ-FRONTEND-INTELLIGENCE-AUDIT.md`, `docs/THIRD-PARTY-NOTICES.md`
- `src/lib/frontend-intel/` — `types.ts`, `catalog.ts`, `gsap-patterns.ts`, `vanta.ts`, `vendor.ts`, `validate.ts`, `engine.ts`
- `src/components/giftz-kit/` — 17 `.tsx` + 12 `.css` kit files (29 files)
- `src/app/api/code-giftz/frontend/catalog/route.ts`
- `src/components/bean/giftz-frontend-panel.tsx`
- `tests/unit/frontend-intel-catalog.test.ts`, `frontend-intel-gsap.test.ts`, `frontend-intel-vanta.test.ts`, `frontend-intel-engine.test.ts`, `frontend-intel-validate.test.ts`, `giftz-kit-render.test.tsx`
- `scripts/kit-curation.ts` (provenance script for the curation)

**Modified (10 files):**
- `package.json` + `bun.lock` (4 exact-pinned dependencies)
- `next.config.ts` (`outputFileTracingIncludes` for kit + vendor builds — verified present in `.next/standalone`)
- `eslint.config.mjs` (scoped override for the vendored kit)
- `src/lib/giftz/turn.ts` (optional additive `frontend` hook)
- `src/lib/giftz/chat-stream.ts` (additive `frontend` field in the turn result type + SSE `done` frame)
- `src/lib/riishe/sse-client.ts` (additive typed `frontend` field)
- `src/app/api/code-giftz/chat/route.ts` (additive optional `frontend` request field, brief injection, metadata)
- `src/app/api/code-giftz/chat/[id]/route.ts` (additive persisted summary on history load)
- `src/components/bean/code-giftz.tsx` (toolkit panel + summary strip; layout untouched)

**Deleted:** none. **Unrelated files touched:** none.

## 8. Tests executed and results (Phase 8)

- **New: 57 tests in 6 files** covering: catalogue integrity (attribution headers, pinned commit, import discipline, honest not-installed entries, exact pin matrix), GSAP patterns (reduced-motion + official cleanup in every pattern), Vanta contract (real dist files on disk, option mapping, lifecycle ordering, `VANTA.BIRDS` uppercase key, script-tag order), orchestration (non-frontend requests byte-untouched, auto-detection, React target with pinned package.json and no-live-preview labeling, `'none'` suppression, real vendored bytes from node_modules, brief cap), all Phase 5 defect classes (remote injection, missing vendor tags, missing destroy/fallback, missing viewport, ghost kit imports, undeclared bare imports, version drift, missing React cleanup, unwired background, path escape, syntax screening excluding engine bytes), and kit validation (Bun-transpiler parse of all 17 components + 15 SSR renders; Dock excluded as portal-based).
- **Full suite: 1,579 pass / 0 fail / 110 files / 33,439 expects** (previous recorded baseline 1,522/104 after API Phase 1 → +57 new tests, no existing test weakened or deleted; one existing source-contract assertion was kept green by matching its expected call shape).
- **TypeScript:** `tsc --noEmit` → **0 errors in src/ and tests/**; 135 pre-existing errors in `scripts/` — exactly unchanged from the prior recorded baseline (reported separately per policy).
- **ESLint:** 0 errors (2 warnings = unused `eslint-disable` directives inside upstream-verbatim kit files; recorded, not suppressed by editing upstream code).
- Existing CODE GIFTZ generation/explain/review/plan, streaming, workspace, sandbox and API-Phase-1 tests all green.

## 9. Build verification

- `npm run build` (Next.js 16 standalone) — **PASS**, zero errors/warnings.
- Standalone output verified to contain the traced extras: `.next/standalone/src/components/giftz-kit/**` and `node_modules/{gsap/dist/gsap.min.js, gsap/dist/ScrollTrigger.min.js, three/build/three.min.js, vanta/dist/*.min.js}` — so the engine's runtime file reads work identically in dev, test and production.

## 10. Performance observations

- The BEAN app bundle is unaffected by Vanta/three (never imported by app code); GSAP enters only via kit components (validated/tested, emitted on demand).
- Static-target vendor materialization attaches `gsap.min.js` (72 KB) + `ScrollTrigger.min.js` (44 KB) only when animations are planned, and `three.min.js` (604 KB) + one effect bundle (~28 KB) only when a Vanta effect is requested — a project without a background carries none of it.
- The brief is hard-capped at 14,000 chars so prompt budgets (shared with project context, tech-docs, attachments) stay bounded.
- The turn-core hook adds one bounded validation pass over extracted files (pure string checks, no model calls).

## 11. Remaining limitations (honest)

1. **Deterministic checks report — they do not auto-correct.** Blocking findings are surfaced in the UI (severity + file + reason); fixing happens through the next user turn or the existing model-driven verification pipeline. This is disclosed in the UI wording.
2. **Syntax screening is heuristic** (delimiter balance), not a full parser — labeled as screening; the repo's own tsc gate covers kit files exactly.
3. **Vanta option names follow Vanta's documented per-effect API**; unknown keys are ignored gracefully by Vanta at runtime (no hard failure).
4. **three.js @0.134 is pinned for Vanta compatibility** and will not receive newer three features (intentional; recorded in the audit).
5. **React-target projects have no live preview in BEAN** (the sandbox executes single files, not builds) — labeled honestly in the UI and brief.
6. **WebGL-dependent upstream components (Aurora, Particles, Lanyard, …) are NOT installed** (extra dependencies not approved) and are shown as "not installed" rather than advertised.
7. Generated projects store their vendored bytes per project (self-contained offline preview trade-off).

## 12. Publication

Per `scripts/sync-policy.md`: full gates on the exact tree (§8–9), push-delta secret/forbidden-artifact scan (zero hits), ONE descriptive commit on `main`, fast-forward push only (never force-push), `git ls-remote origin refs/heads/main` verified equal to local HEAD immediately after push (verified SHA reported in the session delivery message), final working tree clean.
