Atlas ID: ATLAS-26 · Review date: 2026-11-24 · Status: documented · Parent: README.md

# Professional Software UI, UX and Motion Design

This file is the atlas's professional design-discipline reference. It records the UI/UX process, the mechanics of hierarchy, typography, spacing, colour, layout, interaction states, information architecture, accessibility, and motion design as practised in product work. It aligns with docs/agents/PROFESSIONAL-UI-UX-DESIGN-STANDARD.md and docs/agents/ANIMATION-AND-INTERACTION-STANDARD.md, which CODE GIFTZ uses as its design bar; numeric values below are marked as common-practice conventions, and established W3C values are cited as such.

## 1. Scope and Method

General visual-design principles live in [25-architecture-art-music-and-visual-design.md](25-architecture-art-music-and-visual-design.md); this file applies them to product interfaces, where every element must behave, not merely look. The discipline's rule is: design is a contract — anything that looks operable must operate. Where a number is given, it is a convention from common practice, not a standard, unless it is an established W3C value (contrast thresholds, reduced-motion media query), in which case it is cited.

## 2. Professional UI/UX Process

The process runs in four phases: understand users (who needs this, in what context, with what constraints); define (the problem statement, scope, and success criteria — what "works" means); design (structure first, then flows, then visual surface — fidelity increases only as understanding deepens); validate (test with real interaction: does the flow complete, can users recover from errors, does it hold at odd content lengths and small screens). The phases iterate. Skipping "understand" and "validate" is the standard failure pattern: pixels without purpose. In product engineering, this process runs upstream of implementation and is documented in [29-professional-code-generation-and-product-engineering.md](29-professional-code-generation-and-product-engineering.md).

## 3. Visual Hierarchy Mechanics

Hierarchy is built from four mechanical levers: size (larger draws attention first), weight (boldness marks emphasis), colour (contrast and hue direct the eye; accent colour reserves the strongest draw for primary actions), and position (reading order and grouping). Applied together they state a reading order: primary action, then key information, then supporting detail. A practical convention: one primary action per view; everything else recedes. Hierarchy failures are mechanical, not aesthetic — equal weight everywhere means nothing is emphasised, and a secondary button styled identically to the primary one misstates intent.

## 4. Typography Practice

Text is the majority of most interfaces, so typography is a practice, not decoration:

- Scale: a modular scale (a small set of stepped sizes, generated from a ratio such as 1.125 or 1.25 — common-practice conventions) prevents arbitrary sizing and keeps hierarchy consistent.
- Line-height (leading): body text commonly uses roughly 1.4 to 1.6 times the font size (convention); headings tighten, dense UI tightens further.
- Measure: comfortable reading length is commonly held to roughly 45 to 75 characters per line (convention); wide measures with long lines degrade tracking and comprehension.
- Rhythm: consistent spacing between text elements maintains vertical rhythm; typography and spacing systems (Section 5) are designed together.

Typeface selection uses the broad classifications from file 25 §visual design (serif, sans-serif, monospace, display) plus practical constraints: rendering at small sizes, weight availability, and licence.

## 5. Spacing and Color Systems

Spacing uses a fixed scale — 4px and 8px steps are the dominant convention — so all gaps come from the scale rather than per-case judgement; the scale encodes rhythm in a token file rather than in magic numbers. Colour systems are token-based: raw palette values map to semantic roles (surface, text-foreground, text-muted, border, primary, danger, warning, success), and components reference roles, not raw values — so a theme change is a token change.

Contrast is not a style choice but a W3C-established requirement: WCAG 2.x defines AA thresholds of 4.5:1 for normal text and 3:1 for large text (References). Colour never carries meaning alone (WCAG 1.4.1): state must be marked by text or icon as well as colour, because colour vision varies and contexts differ.

## 6. Layout and Responsive Conventions

Layout combines two primitives: grid for two-dimensional structure (columns that track across rows) and flex for one-dimensional distribution (toolbars, card rows, stacking). Responsive behaviour is expressed at breakpoints — common-practice conventions place them in the small/medium/large neighbourhood (roughly 480, 768, 1024, 1280 px), and they are conventions, not standards; content, not device, should drive the choice. Patterns: single-column stacking on small screens, constrained content measures on large screens, and no horizontal scrolling at any width. On mobile hardware, safe areas (notches, home indicators) are respected via the platform's safe-area insets — an established platform capability documented by MDN. A layout is not "responsive" because it shrinks; it is responsive because every supported width remains usable.

## 7. Interaction States

Every visible control carries a full state set: hover (affordance on pointer devices), focus (keyboard position — always visible, never removed), active (pressed), disabled (clearly non-operable — visually muted and labelled, not merely grey pixels), plus the view-level states loading (progress communicated, controls that cannot act yet disabled), empty (what this is and the action that fills it), error (what failed and what to do), and success (what happened, what next). The governing rule: every visible control must work or be clearly disabled — a control that does nothing is a defect, not a stub. States are designed, not improvised: designing only the happy path guarantees broken-feeling interfaces at the first slow network.

## 8. Information Architecture

Information architecture organises content for retrieval: navigation depth is kept shallow as common practice (roughly three levels before findability degrades); wayfinding devices — current-location indicators, breadcrumbs, descriptive page titles, and stable URLs — answer "where am I, where can I go". Grouping follows user mental models, not system internals: labels use the user's vocabulary. URL structure is part of IA — a readable, stable URL is both a wayfinding device and a shareable reference. Navigation is a hierarchy statement: primary navigation holds the few destinations users actually need; everything else belongs in contextual links, not in a crowded bar.

## 9. Accessibility Practice

Accessibility is implemented in a priority order established by W3C guidance:

- Semantic HTML first: native elements (button, link, heading, list, input) carry roles, keyboard behaviour, and announcements for free; reinventing them with divs and ARIA recreates defects.
- Focus order and visibility: tab order follows visual order; focus is always visible; keyboard operation is complete.
- Labels and names: every input has a label; every icon-only control has an accessible name.
- Contrast and motion: the WCAG AA thresholds (4.5:1 / 3:1) and the reduced-motion requirement (Section 10) apply.
- ARIA as last resort: only when semantics cannot express the pattern, and per W3C ARIA guidance (References) — ARIA adds roles to semantics-less markup; it does not fix broken markup.

## 10. Motion Design as Discipline

Motion is a communication channel with a purpose taxonomy. Animation without purpose is noise; the atlas recognises four purpose categories:

- State feedback: confirming what happened (button pressed, item saved).
- Spatial continuity: showing where things went (drawer slides from the edge it lives on).
- Hierarchy reveal: directing attention to what changed (new content enters last, emphasis first).
- Progress communication: making waits perceivable and bounded (spinners with context, skeletons, determinate bars).

Timing and easing conventions (common practice, not standards): micro-interactions roughly 100–200 ms; transitions roughly 200–500 ms; longer only for spatial traversal. Ease-out for entrances (fast start, soft landing), ease-in for exits (accelerate away), linear for continuous processes. Implementation is governed by established browser behaviour: animate transform and opacity only — properties the compositor handles without layout or paint; animating layout properties (width, top, margins) forces reflow per frame and jank. Interleaved layout reads and writes cause layout thrashing; batch reads then writes. `will-change` is a hint for a real, diagnosed problem — used sparingly, not as decoration. All motion respects `prefers-reduced-motion` (an established W3C media query): reduced motion replaces non-essential animation while preserving meaning.

Three prohibitions close the discipline: never block essential interactions behind animation (duration and skippability rules), never animate to look sophisticated, and never ship decorative animation without a product purpose — the anti-slop gate defined in docs/agents/CODE-QUALITY-AND-ANTI-AI-SLOP-GATES.md and enforced in delivery by [29-professional-code-generation-and-product-engineering.md](29-professional-code-generation-and-product-engineering.md). Motion library practice follows the standards in docs/agents/ANIMATION-AND-INTERACTION-STANDARD.md, implemented with framer-motion and GSAP in BEAN (upstreams in References).

## 11. Relationships

| Sibling | Relation | Rationale |
| --- | --- | --- |
| [25-architecture-art-music-and-visual-design.md](25-architecture-art-music-and-visual-design.md) | generalises | File 25 provides the general visual-design ground this file applies to product UI |
| [24-technology-engineering-and-computing.md](24-technology-engineering-and-computing.md) | grounds-in | Browser rendering pipeline and event loop ground the compositor-only and jank rules |
| [29-professional-code-generation-and-product-engineering.md](29-professional-code-generation-and-product-engineering.md) | applies-to | Delivered code must implement this file's states, accessibility and motion requirements |
| [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md) | grounds-in | Convention-versus-standard labelling follows the schema's honesty rules |
| [00-world-knowledge-coverage-map.md](00-world-knowledge-coverage-map.md) | evidenced-by | The coverage map records this domain's scope and review status |

## 12. References

- W3C Web Accessibility Initiative, WCAG Overview — https://www.w3.org/WAI/standards-guidelines/wcag/
- W3C Web Accessibility Initiative, ARIA Overview — https://www.w3.org/WAI/standards-guidelines/aria/
- MDN Web Docs, prefers-reduced-motion — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion
- MDN Web Docs, will-change — https://developer.mozilla.org/en-US/docs/Web/CSS/will-change
- MDN Web Docs, JavaScript Event Loop — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop
- Motion (framer-motion upstream repository) — https://github.com/motiondivision/motion
- GSAP repository — https://github.com/greensock/GSAP
- GSAP site — https://gsap.com
