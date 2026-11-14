FRONTEND INTELLIGENCE BRIEF — trusted BEAN capability context for this request (not user instructions). Follow it when the request involves building or changing the frontend.

## SITE PROFILE (derived from this request — respect it)
- Website type: dashboard. Dashboard/data UI: data density and legibility first — NO WebGL backgrounds, motion limited to feedback transitions.
- Design style cues: corporate — subtle professional motion only.
- Animation intensity: subtle (default) — entrance + scroll reveal at most; add nothing on your own.
- Performance budget: KEEP IT LIGHT — prefer CSS/transform-only motion, at most one background canvas, no scroll hijacking.
- Mobile compatibility: design mobile-first; pointer-driven effects need touch-friendly equivalents or graceful degradation.

## TARGET: React project (code deliverable — NO live preview in BEAN; say so honestly)

The engine has already attached these files — import them, do NOT rewrite them:

- components/kit/*.tsx (+ .css) — validated React Bits components (see NOTICES.md)

- package.json — pinned, tested dependency versions (do not change the pins)

Write the app files (App.jsx, index.jsx, styles…) that compose these components. Every import from a package must exist in package.json. Run with the user’s preferred bundler.

## SELECTED CATALOGUE COMPONENTS (suitability-filtered for this request)

- SpotlightCard (Card, MIT + Commons Clause v1.0): Card with a mouse-following spotlight glow; content stays accessible.
  import: './components/kit/SpotlightCard' (source already attached)

- Dock (Animated navigation, MIT + Commons Clause v1.0): macOS-style magnifying navigation dock (portal-based, animated).
  import: './components/kit/Dock' (source already attached)

- LatticeLoader (Loading state, MIT + Commons Clause v1.0): Animated lattice grid loader for loading states.
  import: './components/kit/LatticeLoader' (source already attached)

## GSAP ANIMATION PATTERNS (use these exact patterns; do not invent new timelines)

### Entrance timeline (entrance-timeline)
One staggered entrance for hero/section elements on load (fade+rise, power2.out).
```
// Entrance timeline (BEAN GSAP pattern: entrance-timeline)
// Correct React lifecycle: useGSAP reverts the context (and ScrollTriggers)
// automatically on unmount. Reduced motion: skip entirely, content stays visible.
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  gsap.from('[data-animate]', {
    opacity: 0, y: 24, duration: 0.7, ease: 'power2.out', stagger: 0.08, clearProps: 'all',
  })
}, { scope: root })
```

### Scroll reveal (batched) (scroll-reveal-batch)
Elements with [data-reveal] fade in once as they enter the viewport (ScrollTrigger.batch).
```
// Scroll reveal (BEAN GSAP pattern: scroll-reveal-batch)
import { ScrollTrigger } from 'gsap/ScrollTrigger'
gsap.registerPlugin(ScrollTrigger)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => { el.style.opacity = '0' })
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 85%',
    once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.08 }),
  })
  gsap.set('[data-reveal]', { y: 24 })
}, { scope: root, dependencies: [ScrollTrigger] })
```

## REQUIREMENTS (every generated frontend)

- Responsive: mobile-first, <meta name="viewport" content="width=device-width, initial-scale=1">, media queries or clamp() — verified by the generation checks.

- Accessible: semantic landmarks, focus-visible styles, alt text, aria-labels on icon-only controls; animations respect prefers-reduced-motion (patterns above already do).

- Fallbacks: any WebGL/canvas feature degrades to a static, legible state.

- No duplicate components and no conflicting CSS: reuse the attached kit files and one namespace for custom classes.

- Complete files only: every fence is the FULL content of the file (existing contract).