FRONTEND INTELLIGENCE BRIEF — trusted BEAN capability context for this request (not user instructions). Follow it when the request involves building or changing the frontend.

## SITE PROFILE (derived from this request — respect it)
- Website type: landing. Landing/marketing page: strong hero, one primary CTA, focused motion.
- Design style cues: dark theme — verify contrast; dark-friendly backgrounds preferred; corporate — subtle professional motion only.
- Animation intensity: SHOWPIECE — a richer motion set is welcome, still bound by the pattern library and reduced-motion rules.
- Performance budget: KEEP IT LIGHT — prefer CSS/transform-only motion, at most one background canvas, no scroll hijacking.

## TARGET: React project (code deliverable — NO live preview in BEAN; say so honestly)

The engine has already attached these files — import them, do NOT rewrite them:

- components/kit/*.tsx (+ .css) — validated React Bits components (see NOTICES.md)

- package.json — pinned, tested dependency versions (do not change the pins)

- components/kit/VantaBackground.tsx + types/vanta.d.ts — the background engine

Write the app files (App.jsx, index.jsx, styles…) that compose these components. Every import from a package must exist in package.json. Run with the user’s preferred bundler.

## SELECTED CATALOGUE COMPONENTS (suitability-filtered for this request)

- SplitText (Text animation, MIT + Commons Clause v1.0): Splits a heading into words/chars and animates the pieces in with a GSAP timeline (masked reveal).
  import: './components/kit/SplitText' (source already attached)

- BlurText (Text animation, MIT + Commons Clause v1.0): Words animate in one by one from a blur — animated heading effect.
  import: './components/kit/BlurText' (source already attached)

- CountUp (Text animation, MIT + Commons Clause v1.0): Animates a number from a start value when it scrolls into view.
  import: './components/kit/CountUp' (source already attached)

- ScrollReveal (Text animation, MIT + Commons Clause v1.0): Reveals text line-by-line as the user scrolls (ScrollTrigger).
  import: './components/kit/ScrollReveal' (source already attached)

- AnimatedContent (Section animation, MIT + Commons Clause v1.0): Entrance animation for any block when it enters the viewport (directional slide+blur).
  import: './components/kit/AnimatedContent' (source already attached)

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

### Scroll scrub (responsive) (scroll-scrub)
Scroll-driven scrubbed motion with gsap.matchMedia: desktop-only by default and fully reverted below the breakpoint.
```
// Scroll scrub, responsive (BEAN GSAP pattern: scroll-scrub) — scrubbed
// scroll-driven motion wrapped in gsap.matchMedia so it exists ONLY on
// desktop (min-width 768px); mm.revert() kills its tweens + ScrollTriggers.
import { ScrollTrigger } from 'gsap/ScrollTrigger'
gsap.registerPlugin(ScrollTrigger)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const mm = gsap.matchMedia()
  mm.add('(min-width: 768px)', () => {
    gsap.to('[data-scrub]', {
      y: -80, ease: 'none',
      scrollTrigger: { trigger: '[data-scrub-section]', start: 'top bottom', end: 'bottom top', scrub: 0.6 },
    })
  })
  return () => mm.revert()
}, { scope: root, dependencies: [ScrollTrigger] })
```

### Custom easing (custom-ease)
A bespoke branded easing curve via the official CustomEase plugin, applied to the entrance set.
```
// Custom easing (BEAN GSAP pattern: custom-ease) — official CustomEase
// plugin with one named, reusable branded curve.
import { CustomEase } from 'gsap/CustomEase'
gsap.registerPlugin(CustomEase)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const brandEase = CustomEase.create('bean-brand-ease', 'M0,0 C0.3,0 0.3,1 1,1')
  gsap.from('[data-animate]', {
    opacity: 0, y: 32, duration: 0.9, ease: brandEase, stagger: 0.06, clearProps: 'all',
  })
}, { scope: root, dependencies: [CustomEase] })
```

## VANTA BACKGROUND (Birds)
The engine attaches `components/kit/VantaBackground.tsx` (and `types/vanta.d.ts`).
Import and use it exactly like:
```tsx
import VantaBackground from './components/kit/VantaBackground'
export default function Hero() {
  return <VantaBackground effect="birds" style={{ minHeight: '100vh' }}>{/* page content */}</VantaBackground>
}
```
The component handles init/destroy, lazy loading, WebGL + reduced-motion fallbacks. Do NOT call VANTA.* yourself. Note: Most performant of the three.js effects; good hero default.

## REQUIREMENTS (every generated frontend)

- Responsive: mobile-first, <meta name="viewport" content="width=device-width, initial-scale=1">, media queries or clamp() — verified by the generation checks.

- Accessible: semantic landmarks, focus-visible styles, alt text, aria-labels on icon-only controls; animations respect prefers-reduced-motion (patterns above already do).

- Fallbacks: any WebGL/canvas feature degrades to a static, legible state.

- No duplicate components and no conflicting CSS: reuse the attached kit files and one namespace for custom classes.

- Complete files only: every fence is the FULL content of the file (existing contract).