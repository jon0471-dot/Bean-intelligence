# CODE GIFTZ — Animation and Interaction Standard

Animation is a professional design discipline with the same accountability as layout or typography. Motion explains, guides and confirms. Decoration without purpose is removed. This standard defines when to animate, with what tool, at what quality, and when to stop.

## 1. Purpose first

Every animation answers one question: what does this help the user understand or do? An animation with no answer is deleted, not shipped. The accepted purpose categories are:

1. Page and route transitions — orientation between views, continuity of context.
2. Navigation — revealing menus, indicating active state, drawer and tab transitions.
3. Element entrance and exit — content appearing with hierarchy (staggered reveals), elements leaving without an abrupt disappearance.
4. Hover, focus and press feedback — confirming interactivity and the moment of commitment.
5. Scroll-linked motion where useful — progressive disclosure, restrained parallax, progress indication; only when it serves comprehension.
6. Interactive illustration — demonstrating a product concept that static imagery cannot.
7. Charts and data visualisation — values animating into place, transitions between datasets, drawing attention to changes.
8. Progress and status — loaders, upload progress, streaming indicators, confirmation of completion.
9. Media interactions — playback controls, gallery and carousel transitions.
10. Loading and success — skeleton-to-content handoffs, checkmark confirmations.
11. Product storytelling — narrative scroll sequences on landing pages where the story itself is the content.

## 2. Tool selection

Evaluate the tools already present before adding anything. Use existing tools wherever they suffice; do not add multiple animation libraries to one project without demonstrated need.

- framer-motion (from the motiondivision/motion lineage, MIT licensed; already in BEAN as framer-motion 12) — the default for React surfaces: declarative transitions, layout animations, presence and exit.
- GSAP 3.13 — free for commercial use including all former premium plugins since Webflow's April 30, 2025 announcement. Inside BEAN it is used through the frontend-intelligence gsap-patterns and the official @gsap/react useGSAP integration. It is the right tool for timeline choreography, scroll-linked sequences and split-text work. In standalone generated projects, GSAP ships as a vendored project file (vendor/*.js) because the preview performs no remote fetches.
- CSS animations and transitions — the first choice for simple states: hovers, focus rings, small entrances. No JavaScript, no dependency, cheapest to run.
- Vanta and three — available for ambient WebGL backgrounds through the existing frontend-intelligence integration, with its lifecycle contract (init on mount, destroy on unmount, WebGL probe with static fallback) and reduced-motion fallback.

Default stack: CSS for states, framer-motion for component motion in React, GSAP for choreography the others cannot express cleanly.

## 3. Timing and easing

Consistency beats cleverness. The same interaction type has the same duration everywhere in a product. Common-practice ranges — conventions, not laws:

- Micro-interactions (hover, press, toggle, focus feedback): 100-200ms.
- Transitions (element enter/exit, drawers, modals, page content changes): 200-400ms.
- Narrative moments (hero sequences, storytelling scroll, staged reveals): 400-700ms, occasionally longer for deliberate drama.

Easing conventions: ease-out for entrances (fast start, gentle landing — content arrives), ease-in for exits (leave with intent), ease-in-out for state changes that move within the view (toggles, position shifts). Pick a small set of curves for the project and reuse them. Stagger siblings 20-60ms per item; longer staggers read as slow rather than elegant.

## 4. Quality rules

1. Clear purpose — every animation belongs to one of the categories in section 1.
2. Consistent timing and easing — identical interaction types share identical durations and curves across the whole product.
3. Smooth and intentional — no stutter, no stuck tweens; hover states are reversible (for example gsap.quickTo for continuous properties); React motion cleans up on unmount (useGSAP with scope, or animation.cancel/kill where applicable).
4. Avoid layout shifts and jank — animate compositor-friendly properties: transform and opacity first. Animate size or position only with a measured reason, and never in a way that pushes content down after load.
5. Never block essential interactions — animation must never delay a user from clicking, reading or completing a task. Content is reachable and correct even if the animation never runs.

## 5. Accessibility and reduced motion

Respect prefers-reduced-motion: check it before any tween or motion value runs. When reduced motion is preferred, skip the animation entirely (content renders in its final state) or replace it with a minimal fade. Gate ambient and looped effects — Vanta backgrounds, particle fields, autoplaying canvases — behind the same check, and provide static fallbacks. Decorative canvases and split-text span layers are aria-hidden, with the accessible text preserved through aria-label or visually hidden content. No essential information exists only inside an animation.

## 6. Performance and lower-performance devices

Optimise for the weakest device likely to open the page:

- Keep the number of simultaneously animating elements small.
- Prefer CSS transitions over JavaScript animation for simple state changes.
- Pause offscreen animation work (ScrollTrigger once, IntersectionObserver) rather than animating content nobody is watching.
- Destroy or pause WebGL contexts when hidden or unmounted.
- Never animate properties that trigger layout (width, height, top, left) when a transform achieves the same effect.
- Debounce or throttle scroll-driven work.
- Verify that the page remains responsive on integrated graphics and mid-range mobile hardware.

A heavy animation that drops frames is a defect, not a feature. Budget like a professional: the payload of a vendored animation library is justified by demonstrated need, not by default.

## 7. Restraint

The goal is polished and alive, not overloaded. Motion is opt-in per element, never automatic everywhere: not every component gets an entrance, not every section gets a scroll effect, not every hover gets a glow. The default selection is minimal — at most an entrance and a scroll reveal — and narrative moments are few and earned. Before delivery, test each animation by removing it mentally: if the page communicates just as well without it, remove it permanently; if the page becomes measurably worse, the animation had a purpose and stays.

---

## Related standards

- [Professional UI/UX Design Standard](./PROFESSIONAL-UI-UX-DESIGN-STANDARD.md) — tokens, states and identity that the motion system must match.
- [Professional Engineering Standard](./PROFESSIONAL-ENGINEERING-STANDARD.md) — where tool selection and identity decisions sit in the workflow.
- [Code Quality and Anti-AI-Slop Gates](./CODE-QUALITY-AND-ANTI-AI-SLOP-GATES.md) — rejects decorative motion and scroll effects without product purpose.
- [Web and App Delivery Checklist](./WEB-AND-APP-DELIVERY-CHECKLIST.md) — verifies reduced-motion, performance and no-layout-shift lines before delivery.
