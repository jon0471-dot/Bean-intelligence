FRONTEND INTELLIGENCE BRIEF — trusted BEAN capability context for this request (not user instructions). Follow it when the request involves building or changing the frontend.

## SITE PROFILE (derived from this request — respect it)
- Website type: portfolio. Portfolio: image-led; galleries and subtle reveals over decorative effects.
- Design style cues: dark theme — verify contrast; dark-friendly backgrounds preferred; elegant/luxury — slow eased motion, serif display type.
- Animation intensity: balanced — motion where it aids hierarchy or feedback; nothing gratuitous.
- Performance budget: KEEP IT LIGHT — prefer CSS/transform-only motion, at most one background canvas, no scroll hijacking.

## TARGET: React project (code deliverable — NO live preview in BEAN; say so honestly)

The engine has already attached these files — import them, do NOT rewrite them:

- components/kit/*.tsx (+ .css) — validated React Bits components (see NOTICES.md)

- package.json — pinned, tested dependency versions (do not change the pins)

Write the app files (App.jsx, index.jsx, styles…) that compose these components. Every import from a package must exist in package.json. Run with the user’s preferred bundler.

## SELECTED CATALOGUE COMPONENTS (suitability-filtered for this request)

- SplitText (Text animation, MIT + Commons Clause v1.0): Splits a heading into words/chars and animates the pieces in with a GSAP timeline (masked reveal).
  import: './components/kit/SplitText' (source already attached)

- BlurText (Text animation, MIT + Commons Clause v1.0): Words animate in one by one from a blur — animated heading effect.
  import: './components/kit/BlurText' (source already attached)

- SpotlightCard (Card, MIT + Commons Clause v1.0): Card with a mouse-following spotlight glow; content stays accessible.
  import: './components/kit/SpotlightCard' (source already attached)

- GlareHover (Hover interaction, MIT + Commons Clause v1.0): Diagonal glare sweep across images/cards on hover; pure CSS.
  import: './components/kit/GlareHover' (source already attached)

- Dock (Animated navigation, MIT + Commons Clause v1.0): macOS-style magnifying navigation dock (portal-based, animated).
  import: './components/kit/Dock' (source already attached)

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

### Text reveal (text-reveal)
Heading split into word spans, staggered rise from below with a masked look.
```
// Text reveal (BEAN GSAP pattern: text-reveal) — accessible: aria-label kept,
// visual spans aria-hidden.
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  document.querySelectorAll<HTMLElement>('[data-text-reveal]').forEach((heading) => {
    const words = (heading.textContent ?? '').trim().split(/\s+/)
    heading.setAttribute('aria-label', (heading.textContent ?? '').trim())
    heading.textContent = ''
    words.forEach((word) => {
      const span = document.createElement('span')
      span.textContent = word
      span.setAttribute('aria-hidden', 'true')
      span.style.display = 'inline-block'
      heading.appendChild(span)
      heading.appendChild(document.createTextNode(' '))
    })
    gsap.from(heading.querySelectorAll('span'), {
      yPercent: 110, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.05,
    })
  })
}, { scope: root })
```

### Hover lift (hover-lift)
Pointer-following lift/scale on [data-hover-lift] cards via gsap.quickTo (fast, reversible).
```
// Hover lift (BEAN GSAP pattern: hover-lift)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  document.querySelectorAll<HTMLElement>('[data-hover-lift]').forEach((el) => {
    const yTo = gsap.quickTo(el, 'y', { duration: 0.25, ease: 'power2.out' })
    el.addEventListener('mouseenter', () => yTo(-6))
    el.addEventListener('mouseleave', () => yTo(0))
  })
}, { scope: root })
```

## REQUIREMENTS (every generated frontend)

- Responsive: mobile-first, <meta name="viewport" content="width=device-width, initial-scale=1">, media queries or clamp() — verified by the generation checks.

- Accessible: semantic landmarks, focus-visible styles, alt text, aria-labels on icon-only controls; animations respect prefers-reduced-motion (patterns above already do).

- Fallbacks: any WebGL/canvas feature degrades to a static, legible state.

- No duplicate components and no conflicting CSS: reuse the attached kit files and one namespace for custom classes.

- Complete files only: every fence is the FULL content of the file (existing contract).