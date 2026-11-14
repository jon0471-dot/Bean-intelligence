# CODE GIFTZ — M21 Real-World Generation Validation: Phase 0 Baseline Audit

Repository: `https://github.com/jon0471-dot/Bean-intelligence.git` · Branch: `main`
Audited at commit: `80e7a67bf497038643962624ec43551ef9eeb271` (the expected baseline — verified: `git fetch origin` then `git rev-parse origin/main` = local `HEAD` = `80e7a67b…`; `git status --porcelain` empty → clean working tree; `core.filemode=false` set, zero content drift).
Commit date: 2026-11-14 15:47 UTC. **No code was modified by this audit.**

Scope of this audit: everything M21 must preserve and exercise — the internal frontend library, the generation pipeline, generated-file handling, the sandbox, and the existing tests. All numbers below were measured against the committed modules by `scripts/m21-audit.ts` (bun run from the repo root), not copied from documentation.

---

## 1. Frontend library registry (M20 deliverable, preserved)

| Area | Measured value | Evidence |
| --- | --- | --- |
| Catalogue entries | **168 installed / 0 advertised-but-missing** | `COMPONENT_CATALOG` (168 entries, all `installed: true`) |
| Upstream exclusions preserved | **50 records** with per-component reasons | `EXPANSION_EXCLUSIONS` in `catalog-expansion.ts` (218 total upstream = 168 + 50 accounted) |
| Installed by category | Background effect 56 · Text animation 31 · General animation 29 · UI component 29 · Micro-interaction 15 · Animated navigation 1 · Card 1 · Glass effect 1 · Hover interaction 1 · Interactive button 1 · Interactive effect 1 · Loading state 1 · Section animation 1 | audit run output |
| Kit sources on disk | **168 `.tsx` + 155 `.css` = 323 files** in `src/components/giftz-kit/` | `fs.readdirSync` count |
| Kit files referenced by the registry | **0 missing** (every `kitFiles[]` entry exists on disk) | per-entry existence check |
| Attribution headers | **0 files missing** the `React Bits` + `Commons Clause` header | 323-file header scan |
| React Bits upstream pins | original 17: `4e0d091d3b1ea8b7aadef33716a8d99d164ae4ce`; expansion 151: `cf2801031f07f53d4684e65b961bde7c2e2a6921` | `catalog.ts` |

## 2. GSAP animation patterns (15, preserved)

`GSAP_PATTERNS` = 15 patterns; default auto set = `entrance-timeline`, `scroll-reveal-batch` (motion is opt-in beyond that). Full set: entrance-timeline, scroll-reveal-batch, text-reveal, hover-lift, svg-draw, split-text, morph-svg, motion-path, flip, draggable, observer, custom-ease, scroll-scrub, draw-svg, scramble-text.
All **10 plugin UMD builds** referenced by the patterns exist in the installed `gsap@3.13.0` (`dist/*.min.js`): ScrollTrigger, SplitText, MorphSVGPlugin, MotionPathPlugin, Flip, Draggable, Observer, CustomEase, DrawSVGPlugin, ScrambleTextPlugin — **0 missing vendor builds**. Pinned: gsap 3.13.0, @gsap/react 2.1.2.

## 3. Vanta effects (13, preserved)

`VANTA_EFFECTS` = 13 (birds, waves, net, globe, fog, clouds, rings, cells, dots, halo, ripple, trunk, topology); p5-based family: trunk, topology (p5 0.6.1 vendored from inside `vanta@0.5.24`). All 13 effect bundles + the three.js 0.134.0 and p5.js runtimes exist under `node_modules/` — **0 missing vendor builds**. `clouds2` remains honestly excluded (external texture dependency).

## 4. Generation pipeline (existing, preserved)

- **Entry points:** the chat SSE route (`src/app/api/code-giftz/chat/route.ts`) and the background coding worker both execute the SAME turn core (`src/lib/giftz/turn.ts` — `runGiftzTurnCore`): model stream with controlled continuation → self-verification (operator-gated) → `parseFiles` → `applyFiles` (DB persistence, path-safe) → frontend engine attachment → `finalizeFrontendTurn` deterministic checks.
- **Brief injection:** `resolveFrontendPlan({ message, existingFilePaths })` runs BEFORE prompt assembly; the bounded brief rides in the turn context (capped `FRONTEND_BRIEF_MAX_CHARS = 14_000`). Fully automatic — there is no UI/API selection surface (chat route line comment: "the frontend intelligence library is INTERNAL").
- **Generated-file handling:** `path=`-fenced files are workspace files; unsafe paths are dropped with the fence left visible; `applyFiles` persists real diffs; the preview route inlines project CSS/JS into a CSP-restricted (`default-src 'none'`), sandboxed iframe for STATIC projects.
- **Site-profile intelligence (existing):** website-type detection (landing/portfolio/dashboard/store/blog/docs) with per-type motion guidance, style cues, animation-intensity scaling, performance-budget steering (heavy Vanta effects dropped on the auto path; dashboard type never gets an auto background), mobile-first guidance, existing-dependency awareness (React files → React target; Tailwind detection).
- **Deterministic validation (existing, `validate.ts`):** path isolation, remote-resource injection ban, vendor script-tag contract (GSAP core + per-plugin order; Vanta runtime family-aware three/p5), Vanta fallback + `destroy()` cleanup, reduced-motion guards, ScrollTrigger hygiene, viewport/media-query responsiveness, React kit-import resolution against emitted kit files, bare-import ↔ package.json declaration, version-pin match, React GSAP cleanup contract (`useGSAP`/`gsap.context`+`revert`), VantaBackground wiring, syntax screening.

## 5. Sandbox (existing, preserved)

`src/lib/sandbox/runner.ts`: ephemeral workspace under `sandbox-runs/<id>/`, child process with minimal env (no secrets/DATABASE_URL), `unshare -Urn` network namespace + `prlimit` resource caps + SIGKILL wall clock (fallback layers reported honestly), 15 s timeout, output capped. Execution is gated by the explicit per-run "Run in sandbox" user approval in the product UI — generation never auto-executes. **Contract: single-file entry execution** — multi-file React projects are code deliverables WITHOUT live preview (recorded M20 limitation; unchanged).

## 6. Existing test inventory (relevant suites)

`tests/unit/` holds 125 files. M21-relevant suites: `frontend-intel-catalog`, `frontend-intel-engine`, `frontend-intel-gsap`, `frontend-intel-validate`, `frontend-intel-vanta`, `giftz-kit-render`, `giftz-ui-restriction`, `giftz-chat-stream`, `giftz-streaming`, `giftz-workspace`, `giftz-sidebar`, `code-workspace`. M20 baseline: **1,719 tests / 124 files / 0 failures**, production build green.

## 7. Engine smoke on the three M21 prompts (real `resolveFrontendPlan` runs)

| Prompt | Target | Auto-selected components | Auto-selected GSAP patterns | Background | Engine files | Brief size |
| --- | --- | --- | --- | --- | --- | --- |
| **A — immersive tech landing page** | react | split-text, blur-text, count-up, scroll-reveal, animated-content | entrance-timeline, scroll-reveal-batch, text-reveal, hover-lift, scroll-scrub, custom-ease (showpiece-bounded ≤6) | **birds** (Vanta) | 10 files (5 kit .tsx + 1 kit .css + VantaBackground.tsx + vanta.d.ts + package.json + NOTICES.md) | 8,205 chars |
| **B — analytics dashboard** | react | spotlight-card, dock, lattice-loader, **radar**, **balatro** | entrance-timeline, scroll-reveal-batch (dashboard-minimal) | **none** (dashboard suppression works) | 12 files | 4,392 chars |
| **C — developer portfolio** | react | split-text, blur-text, spotlight-card, glare-hover, dock | entrance-timeline, scroll-reveal-batch, text-reveal, hover-lift | none (not requested) | 10 files | 5,949 chars |

**Finding F-1 (carried to Phase 4/6):** the dashboard auto-selection includes `radar` (a radar-sweep *background*; tag list contains `"dashboard"` — a curation mismatch) and `balatro` (a playful card-suit *background*, matched via the generic tag `"cards"` in "KPI stat cards"). Both are `Background effect` category components handed to the model for a site type whose own brief says "data density and legibility first — NO WebGL backgrounds, motion limited to feedback transitions". This is an auto-selection suitability defect to be resolved in the Phase 6 repair loop with a narrowly scoped engine correction (no catalogue/library expansion). Projects A and C selections are appropriate.

## 8. M21 validation method (declared up front, honest scope)

- The **engine and deterministic validator run as real product code** (bun, importing the committed modules) — plan resolution, engine-file materialization, `parseFiles`, `finalizeFrontendTurn`.
- The **coding-model role** is performed in-session by the validating agent consuming the real system prompt + the real engine brief, emitting the response in the product's `path=`-fence contract; the raw model-role responses are preserved as artifacts. No provider credentials exist in this environment, so the external LLM hop of the live route cannot run here; the downstream pipeline after model output is exercised exactly as shipped.
- Generated projects are materialized under **`validation/m21/`** (isolated; NOT inside `src/`), each with its engine files, NOTICES.md and validation report. DB workspace persistence is covered by the existing `giftz-workspace` tests and is not re-exercised here (no deviation in product code).
- **Build harness (validator tooling, separate from generated deliverables):** vite + @vitejs/plugin-react + typescript + eslint installed per project; the generated `package.json` dependency pins are installed verbatim.
- **Browser rendering:** Playwright 1.57 (chromium 1200) — desktop + mobile viewports, console-error capture, `prefers-reduced-motion` emulation, WebGL-blocked fallback checks, screenshots as evidence.
- **Sandbox workflow:** exercised on a generated single-file artifact through `runInSandbox` (the approval gating lives in the product UI action and is untouched).
- No library expansion is planned; any correction is limited to a demonstrated blocker (Phase 6), narrowly scoped, regression-tested.

## 9. Preservation checklist (verified, unchanged by M21 so far)

168 React Bits components / 15 GSAP patterns / 13 Vanta effects intact on disk and in the registry · attribution + `NOTICES.md` contract intact · component registry + frontend-intel architecture intact · turn core, parse/apply/diff, preview route, sandbox approval intact · chat route, coding modes, model gateway and provider routing untouched · no toolkit UI (enforced by `giftz-ui-restriction.test.ts`, re-run in Phase 8) · RIISHE / LAXII / JAZMII code untouched.
