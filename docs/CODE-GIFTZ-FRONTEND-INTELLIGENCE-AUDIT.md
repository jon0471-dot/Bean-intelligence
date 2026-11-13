# CODE GIFTZ — Frontend Intelligence Toolkit Integration: Phase 0 Audit

Status: COMPLETE (audit only — no implementation was performed before this document).
Repository: `https://github.com/jon0471-dot/Bean-intelligence.git`, branch `main`, audited at commit `a82f3f6ac3650137b92570a3040c050163923431` (working tree clean, local HEAD == `origin/main` at audit time).
React Bits reference pinned at upstream commit `4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce` (shallow clone used read-only for component selection; the repository is NOT copied into BEAN).

---

## 1. Scope and method

This audit inspects the complete existing CODE GIFTZ implementation before any change is made, records compatibility and license findings for the three upstream projects (GSAP, Vanta.js, React Bits), and fixes the architecture decisions the implementation must respect. Everything below was verified by reading the actual files in this repository and the actual LICENSE files shipped inside the installed npm packages — nothing is quoted from memory.

## 2. Existing CODE GIFTZ implementation (must be preserved)

### 2.1 Execution paths

| Path | File | Behavior |
| --- | --- | --- |
| Conversational SSE chat | `src/app/api/code-giftz/chat/route.ts` | One conversational input; streams via `createGiftzChatStream`; persists user/assistant `codeMessage` rows; extracts files; returns honest change list. Wire contract: `data:` frames `stage` → `delta` → one terminal `done`/`error`. |
| Turn core (shared) | `src/lib/giftz/turn.ts` | `runGiftzTurnCore`: controlled continuation (`solveWithContinuation` / `generateTurnWithContinuation`), optional self-verification with corrective revision (`verifyAndCorrect`), then `parseFiles` → `applyFiles`. Shared verbatim by the live route and the background worker. |
| One-shot tasks | `src/app/api/code-giftz/tasks/route.ts` | `mode: generate/explain/review/plan` against `adapter.codeTask`, persisted as `generationJob` rows. |
| Background jobs | `src/app/api/ai/jobs/route.ts` + `scripts/ai-workers/worker.ts` | `submitGiftz` → queue → the same turn core. |
| Sandbox execution | `src/app/api/code-giftz/run/route.ts`, `projects/[id]/run/route.ts` + `src/lib/sandbox/runner.ts` | Explicit per-run user approval (`approval: true` in the request body — the UI "Run" button), ephemeral workspace, `unshare -Urn` network namespace + `prlimit` rlimits, SIGKILL wall clock, capped output. Never automatic on generation. |
| Project files | `src/app/api/code-giftz/projects/*` | Owner-scoped CRUD; `projects/[id]/files` = manual editor save (origin `modified`); `projects/[id]/preview` = isolated preview. |

### 2.2 Generated-project architecture (decisive constraints)

- Generated files are extracted from path-tagged fences (` ```lang path=… `) by `parseFiles` (`src/lib/giftz/workspace.ts`), validated by `assertSafeProjectPath` (relative, no `..`, no absolute, no exotic characters), and stored in the `CodeFile` table (`@@unique([projectId, path])`, `origin: generated | modified`).
- Web apps are **standalone static documents**: `index.html` + `styles.css` / `app.js`. The prompt (`src/lib/giftz/prompts.ts`) currently says *"Standard library only — no external package installs."*
- The preview route serves `index.html` as a standalone document and **inlines every project `.css`/`.js` file** referenced with a relative `src`/`href`, under CSP `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:` inside a `sandbox="allow-scripts"` iframe. **Consequence: no CDN or any remote fetch can ever run inside the preview.** Any animation/3D library used by a generated project must ship as project files (`vendor/*.js`) to work in the preview.
- Sandbox run entry points: `main.js`, `index.js`, `app.js`, `main.ts`, `index.ts`, `main.py`, `index.html` (`pickEntryFile`). Sandbox runs execute a single file in isolation (no bundler, no npm install) — generated React projects cannot be *executed* by the sandbox; they are code deliverables.
- Data model (verified in `prisma/schema.prisma`): `CodeProject` (userId, title), `CodeMessage` (role, content, `metaJson`), `CodeFile` (path, content, origin). All ownership checks are `userId`-scoped. **No schema change is required or planned for this integration** — frontend plan/checks metadata rides in the existing `metaJson` JSON column (additive key), so there are zero migrations, destructive or otherwise.

### 2.3 UI surface

`src/components/bean/code-giftz.tsx` (1027 lines): chat column (header, message bubbles with change chips + verification summary, attachments, input with Attach), workspace (tabs, file explorer, code viewer with syntax highlighting, editor with Save, real diffs, sandbox terminal, isolated preview iframe), sidebar components in `code-giftz-sidebar.tsx`. Visual system: dark glass + gold (#d4af37) accents, `bean-glass` / `bean-scroll` utility classes, `shared.tsx` primitives (`Markdown`, `Spinner`, `beanFetch`). The integration must extend — not redesign — this surface.

### 2.4 Tests / evals / tooling baseline (verified)

- Test runner: `bun test --isolate tests/` (bun.lock is the authoritative lockfile; npm must not be used for installs — a stray `package-lock.json` created during dependency verification was removed and `bun add --exact` was used instead).
- Existing CODE GIFTZ-adjacent tests include `giftz-workspace`, `giftz-sidebar`, `giftz-workspace`, `giftz-streaming`, `giftz-chat-stream`, `code-workspace`, `files-pipeline`, `url-guard`, `verification-w6`, `self-verification`.
- Evals: `evals/code-giftz/` (question set + runner).
- Gates per `scripts/sync-policy.md` (git-excluded policy file): `bun test --isolate tests/`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, secret scan of the full push delta, one descriptive commit, fast-forward push only, remote SHA verification.
- `next.config.ts`: `output: "standalone"`, `typescript.ignoreBuildErrors: true` (build-time leniency does NOT waive the sync-policy `tsc --noEmit` gate), `serverExternalPackages: ["pdf-parse", "pdfjs-dist"]`, app-level security headers; framing headers deliberately excluded (workspace preview product).

## 3. Upstream dependency findings

### 3.1 Current BEAN dependency state (verified from package.json + bun.lock)

- Next.js `^16.1.1`, React `^19.0.0`, TypeScript `^5`, Tailwind `^4` (CSS-first), ESLint `^9`, framer-motion `^12.23.2` (already installed — reusable for React Bits variants that need motion), react-syntax-highlighter, zod 4, bun.lock-only.

### 3.2 New dependencies — installed with exact pins (compatibility checked first)

| Package | Version (exact) | Why this version |
| --- | --- | --- |
| `gsap` | 3.13.0 | First fully-free release under the Standard "No Charge" GSAP License (effective 2025-04-30); ships `dist/gsap.min.js` (72 KB) + `dist/ScrollTrigger.min.js` (44 KB) UMD builds usable offline. |
| `@gsap/react` | 2.1.2 | Official GSAP React integration (`useGSAP`) — required for correct React lifecycle cleanup in React-target output. |
| `vanta` | 0.5.24 | Latest published Vanta release (2022, stable); ships per-effect UMD bundles `dist/vanta.<effect>.min.js`. |
| `three` | 0.134.0 | **Deliberate downpin.** Vanta's official site ships `three.r134.min.js`; newer three (≥r160) removed the UMD `build/three.min.js` and breaks Vanta's global-THREE contract. r134 ships `build/three.min.js` (604 KB UMD) that Vanta 0.5.24 requires. |

Verification performed after install: all seven requested Vanta effects exist in `node_modules/vanta/dist/` (`birds`, `waves`, `net`, `globe`, `fog`, `clouds`, `rings` — plus others we do not use); GSAP core + ScrollTrigger minified UMD builds exist; `three.min.js` exists. None of the four packages has native build steps or peer conflicts; nothing else in `package.json` changed; `bun.lock` updated cleanly. `vanta` and `three` are NOT imported by BEAN application code — they are vendored into generated projects as files — so they add zero bundle weight to the live app.

### 3.3 License findings (primary sources)

**GSAP 3.13.0** — `node_modules/gsap/package.json` license field: *"Standard 'no charge' license: https://gsap.com/standard-license."* (no LICENSE file ships in the npm package; the license is by URL). Terms verified via gsap.com: effective April 30, 2025, Webflow grants the standard "No Charge" GSAP license covering **commercial use at no charge** for all GSAP code including former paid plugins. Principal restrictions: may not build a no-code visual animation tool that competes with Webflow, may not reverse-engineer GSAP to build one, must retain proprietary notices. GSAP's license FAQ explicitly states GSAP code generated with an AI assistant is **not** a prohibited use — directly relevant to this integration. `@gsap/react` carries the same license reference. Compliance: keep notices in vendored files, record version + license in third-party notices, never remove GSAP branding from vendored minified files.

**Vanta 0.5.24** — `node_modules/vanta/LICENSE.md` (read verbatim): *"Copyright 2020 Teng Bao … MIT License"* — standard MIT text. `package.json` license field: MIT. Compliance: MIT requires preserving the copyright + permission notice in copies; the vendored per-effect files and the third-party notices document carry it.

**three 0.134.0** — `node_modules/three/LICENSE` (read verbatim): MIT, "Copyright © 2010-2021 three.js authors". Same compliance as above.

**React Bits** — `LICENSE.md` at upstream commit `4e0d091` (read verbatim): **MIT + Commons Clause License Condition v1.0, Copyright (c) 2026 David Haz.** The license grants use, copying, modification and distribution of the software **"as part of an application, website, or product"**, for any commercial purpose, with two conditions: (1) the copyright + permission notice must accompany copies; (2) the **Commons Clause**: *"you do not sell, sublicense, or redistribute the components themselves — whether alone, in a bundle, or as a ported version"* (the same restriction covers React Bits tools and sound library). What you make with the components is yours to use in any personal or commercial application.

**BEAN compliance posture for React Bits (binding for the implementation):**
1. Only components from the free collection are used; **no React Bits Pro content or assets**.
2. Each catalogued component file carries an attribution header naming React Bits, the author, the license (MIT + Commons Clause) and the exact upstream source URL.
3. A third-party notices document records all three upstream projects with versions, licenses and links.
4. The catalogue is an internal capability of the CODE GIFTZ assistant whose output is a generated application — the license's own permitted case — and is never exposed as a standalone "component pack" product (nothing is sold or redistributed as a bundle of the components themselves).
5. `docs/` records this review; if BEAN's distribution model ever changes to selling generated component packs, this license must be re-reviewed before shipping.

### 3.4 React Bits variant landscape (verified in the cloned repo)

Variants: `ts-default` (TypeScript + plain CSS files), `ts-tailwind`, `js-default`, `js-tailwind`. The current `ts-default` implementations import from `gsap`, `gsap/ScrollTrigger`, `gsap/SplitText`, `@gsap/react`, `motion/react` or React only — no ogl/@react-three/webgl dependencies in the selected set. Components whose source imports `motion/react` (the renamed framer-motion package) are **adapted to import from `framer-motion` instead** — framer-motion 12 exposes the identical API surface used here (`motion`, `MotionConfig`, `useInView`, `animate`, `cubicBezier`, easing types) and is already a BEAN dependency. Every such adaptation is recorded in the component registry (`adaptedFrom`). Tailwind variants are recorded in the registry metadata (`variants`) but the installed implementation uses `ts-default` (+ its CSS companion file) because generated projects must not be assumed to have Tailwind.

## 4. Curated component selection (free collection, verified self-contained)

Selection criteria: covers every capability the work order prioritizes (animated headings, split text, typewriter, interactive buttons, animated navigation, cards/galleries, glass effects, background effects, hover interactions, loading states, responsive page sections); minimal dependency footprint (gsap/@gsap/react/framer-motion already installed, or React-only); no paid/Pro content; per-component validation possible.

| # | Component | Upstream path (`src/ts-default/…`) | Dependencies |
| --- | --- | --- | --- |
| 1 | SplitText | `TextAnimations/SplitText` | gsap, gsap/ScrollTrigger, gsap/SplitText, @gsap/react |
| 2 | TextType (typewriter) | `TextAnimations/TextType` | gsap |
| 3 | BlurText | `TextAnimations/BlurText` | framer-motion (adapted from `motion/react`) |
| 4 | ShinyText | `TextAnimations/ShinyText` | React (+ CSS) |
| 5 | GradientText | `TextAnimations/GradientText` | React (+ CSS) |
| 6 | CountUp | `TextAnimations/CountUp` | framer-motion (adapted from `motion/react`) |
| 7 | ScrollReveal | `TextAnimations/ScrollReveal` | gsap, gsap/ScrollTrigger |
| 8 | AnimatedContent | `Animations/AnimatedContent` | gsap, gsap/ScrollTrigger |
| 9 | StarBorder | `Animations/StarBorder` | React |
| 10 | ClickSpark | `Animations/ClickSpark` | React (canvas) |
| 11 | SpotlightCard | `Components/SpotlightCard` | React (+ CSS) |
| 12 | GlareHover | `Animations/GlareHover` | React (+ CSS) |
| 13 | GlassSurface | `Components/GlassSurface` | React (+ CSS) |
| 14 | LetterGlitch | `Backgrounds/LetterGlitch` | React (canvas) |
| 15 | DotGrid | `Backgrounds/DotGrid` | React (canvas) |
| 16 | Dock | `Components/Dock` | React + react-dom (portal) |
| 17 | LatticeLoader | `Micro/LatticeLoader` | React (+ CSS) |

Categories NOT covered by an installed component today (e.g. WebGL-heavy backgrounds like Aurora/Particles/Hyperspeed that need `ogl`, or 3D model components like Lanyard that need @react-three/fiber) are deliberately **not installed** and will be advertised as *available in upstream React Bits but not installed here* — the registry records them with `installed: false` rather than pretending.

## 5. Architecture decisions fixed by this audit

1. **Two target frameworks.** `static` (default; standalone HTML/CSS/JS, previewable in the isolated iframe) and `react` (React component/code deliverable with an emitted `package.json` pinning the same tested dependency versions; honest "no live preview" labeling since the sandbox executes a single file, not a build). The engine detects/derives the target; explicit user selection in the UI overrides.
2. **Offline vendoring, no CDN ever.** When a generation plan uses GSAP or Vanta in `static` mode, the engine materializes the pinned, minified UMD builds from the installed packages as project files (`vendor/gsap.min.js`, `vendor/ScrollTrigger.min.js`, `vendor/three.min.js`, `vendor/vanta.<effect>.min.js`). The preview route already inlines project `.js` files, so animations and 3D backgrounds work inside the CSP-restricted preview with zero remote fetches. This also satisfies the "no remote script injection" safety rule.
3. **Prompt augmentation, not pipeline replacement.** The Frontend Intelligence engine injects a bounded, clearly-labeled brief (selected components with exact imports, GSAP pattern templates, Vanta init/destroy template, responsive + reduced-motion + a11y requirements, vendor-file contract) into the turn context, exactly like the existing `buildTechDocsContext` block. The model still writes the files through the existing fence contract; `parseFiles`/`applyFiles`/diffs/verification are untouched.
4. **Centralized post-generation checks (Phase 5).** Deterministic validators run on the extracted files: import/component-name existence against the catalogue, GSAP init/cleanup markers, Vanta init/destroy + WebGL fallback markers, responsive markers, dependency/version consistency, syntax screening. Results attach to the assistant message metadata (additive `frontend` key in `metaJson`) and the SSE `done` frame (additive field) — never blocking or rewriting the existing verification pipeline.
5. **Vanta as an explicit, opt-in background engine** (its own component contract): mount→init, unmount→destroy, single-renderer guard, lazy per-effect loading, WebGL detection with CSS-gradient fallback, reduced-motion → static fallback, mouse/touch control toggles, responsive sizing. Only attached when the user requests a background effect.
6. **No DB migrations, no schema changes, no new tables.** Plan/check metadata rides in existing JSON columns. Existing task modes (`generate/explain/review/plan`), history, API response structures, sandbox approval, provider routing and metering are untouched.
7. **UI is additive**: a collapsible "Frontend toolkit" strip beside the Attach control (target, components, animations, background effect, responsive toggle), a frontend summary with dependency + license attribution rendered under completed assistant messages, and no changes to workspace layout logic beyond reading the additive metadata.

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Preview CSP blocks remote libraries | Vendored project files (decision 2); validator rejects CDN URLs (`http(s)://` script/link srcs) in static output. |
| three.js + Vanta bloat (604 KB + 28 KB per project file) | Only materialized when a Vanta effect is actually selected; recorded as a known limitation. |
| React Bits license drift | Upstream commit pinned in this audit + registry source URLs; notices document; re-review trigger recorded (§3.3). |
| GSAP SplitText plugin import (`gsap/SplitText`) — a former paid plugin, now free | 3.13.0 ships it free; SplitText component kept but marked as requiring gsap ≥3.13. |
| `motion/react` vs `framer-motion` divergence | Adapted imports recorded per component; framer-motion 12 API parity verified by tsc + render smoke tests. |
| Prompt budget pressure from the brief | The brief is bounded (hard char cap) and compact (specs, not full sources, for React-target guidance; the catalogue files themselves are emitted as project files by the engine, not by the model, when used). |
| Background worker / one-shot task paths | The frontend brief and checks are wired through the shared turn core and are strictly opt-in (only when the plan exists); without a frontend selection the behavior is byte-identical to today. |

## 7. Exclusions recorded up front

No Phase 2/3/4 product endpoints of the separate API track, no Organizations/Teams, no sandbox design changes beyond nothing, no provider/AI-engine changes, no unrelated UI redesign, no force-push or history rewrite, no destructive DB operations (none needed at all). CODE GIFTZ keeps: model gateway, provider selection, task modes, file format, history, API response structures, sandbox execution + explicit approval, and all existing tests.

— End of audit. Implementation proceeds only after this document.
