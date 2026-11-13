/**
 * BEAN Intelligence — GSAP animation engine for CODE GIFTZ frontend
 * generation (Phase 2 of the Frontend Intelligence Toolkit work order).
 *
 * Reusable, bounded animation patterns — NOT uncontrolled custom timelines.
 * Every pattern:
 *   - respects `prefers-reduced-motion` (skips and leaves content visible),
 *   - ships correct lifecycle handling: static output uses one guarded init;
 *     React output uses the official `@gsap/react` `useGSAP` integration so
 *     gsap.context revert cleans tweens AND ScrollTriggers on unmount,
 *   - is injected into the generation brief verbatim so the model reuses the
 *     pattern instead of inventing a new timeline per component.
 *
 * GSAP 3.13.0 is free for commercial use under the Standard "No Charge" GSAP
 * License (AI-generated GSAP code is explicitly not a prohibited use).
 */
import type { FrontendAnimationMeta, FrontendTarget } from './types'

/** Reduced-motion guard used verbatim in every static snippet. */
export const STATIC_REDUCED_MOTION_GUARD =
  "var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches"

/** Canonical React lifecycle contract the validator looks for. */
export const REACT_CLEANUP_MARKERS = ['useGSAP(', '{ scope'] as const
export const REDUCED_MOTION_MARKER = 'prefers-reduced-motion'

export const GSAP_PATTERNS: FrontendAnimationMeta[] = [
  {
    id: 'entrance-timeline',
    label: 'Entrance timeline',
    description: 'One staggered entrance for hero/section elements on load (fade+rise, power2.out).',
    targets: ['static', 'react'],
    requires: ['gsap'],
    tags: ['hero', 'entrance', 'intro', 'landing'],
  },
  {
    id: 'scroll-reveal-batch',
    label: 'Scroll reveal (batched)',
    description: 'Elements with [data-reveal] fade in once as they enter the viewport (ScrollTrigger.batch).',
    targets: ['static', 'react'],
    requires: ['gsap', 'ScrollTrigger'],
    tags: ['scroll', 'reveal', 'sections'],
  },
  {
    id: 'text-reveal',
    label: 'Text reveal',
    description: 'Heading split into word spans, staggered rise from below with a masked look.',
    targets: ['static', 'react'],
    requires: ['gsap'],
    tags: ['heading', 'title', 'text'],
  },
  {
    id: 'hover-lift',
    label: 'Hover lift',
    description: 'Pointer-following lift/scale on [data-hover-lift] cards via gsap.quickTo (fast, reversible).',
    targets: ['static', 'react'],
    requires: ['gsap'],
    tags: ['hover', 'card', 'micro-interaction'],
  },
  {
    id: 'svg-draw',
    label: 'SVG draw',
    description: 'Strokes of inline SVG icons/logos draw themselves when scrolled into view.',
    targets: ['static', 'react'],
    requires: ['gsap', 'ScrollTrigger'],
    tags: ['svg', 'logo', 'icon', 'draw'],
  },
]

export const DEFAULT_ANIMATION_IDS = ['entrance-timeline', 'scroll-reveal-batch']

const PATTERNS_BY_ID = new Map(GSAP_PATTERNS.map((p) => [p.id, p]))

export function getAnimation(id: string): FrontendAnimationMeta | undefined {
  return PATTERNS_BY_ID.get(id)
}

/** STATIC TARGET — plain-JS snippets (global `gsap` from vendor/gsap.min.js). */
export const STATIC_PATTERN_CODE: Record<string, string> = {
  'entrance-timeline': `// Entrance timeline (BEAN GSAP pattern: entrance-timeline)
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion) {
  gsap.from('[data-animate]', {
    opacity: 0, y: 24, duration: 0.7, ease: 'power2.out', stagger: 0.08, clearProps: 'all',
  })
}`,
  'scroll-reveal-batch': `// Scroll reveal (BEAN GSAP pattern: scroll-reveal-batch)
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger)
  var revealEls = gsap.utils.toArray('[data-reveal]')
  revealEls.forEach(function (el) { el.style.opacity = '0' })
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 85%',
    once: true,
    onEnter: function (batch) {
      gsap.to(batch, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.08 })
    },
  })
  gsap.set('[data-reveal]', { y: 24 })
}`,
  'text-reveal': `// Text reveal (BEAN GSAP pattern: text-reveal)
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion) {
  document.querySelectorAll('[data-text-reveal]').forEach(function (heading) {
    var words = heading.textContent.trim().split(/\\s+/)
    heading.setAttribute('aria-label', heading.textContent.trim())
    heading.textContent = ''
    words.forEach(function (word) {
      var span = document.createElement('span')
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
}`,
  'hover-lift': `// Hover lift (BEAN GSAP pattern: hover-lift) — reversible, no stuck tweens
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion) {
  document.querySelectorAll('[data-hover-lift]').forEach(function (el) {
    var xTo = gsap.quickTo(el, 'y', { duration: 0.25, ease: 'power2.out' })
    el.addEventListener('mouseenter', function () { xTo(-6) })
    el.addEventListener('mouseleave', function () { xTo(0) })
  })
}`,
  'svg-draw': `// SVG draw (BEAN GSAP pattern: svg-draw)
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger)
  document.querySelectorAll('[data-svg-draw] path').forEach(function (path) {
    var len = path.getTotalLength ? path.getTotalLength() : 0
    if (!len) return
    path.style.strokeDasharray = String(len)
    path.style.strokeDashoffset = String(len)
    gsap.to(path, {
      strokeDashoffset: 0, duration: 1.2, ease: 'power2.inOut',
      scrollTrigger: { trigger: path.closest('svg'), start: 'top 85%', once: true },
    })
  })
}`,
}

/** REACT TARGET — official @gsap/react useGSAP integration. useGSAP wraps
 *  gsap.context and reverts tweens + ScrollTriggers automatically on unmount;
 *  the `dependencies` entry makes ScrollTrigger registration revert-safe. */
export const REACT_PATTERN_CODE: Record<string, string> = {
  'entrance-timeline': `// Entrance timeline (BEAN GSAP pattern: entrance-timeline)
// Correct React lifecycle: useGSAP reverts the context (and ScrollTriggers)
// automatically on unmount. Reduced motion: skip entirely, content stays visible.
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  gsap.from('[data-animate]', {
    opacity: 0, y: 24, duration: 0.7, ease: 'power2.out', stagger: 0.08, clearProps: 'all',
  })
}, { scope: root })`,
  'scroll-reveal-batch': `// Scroll reveal (BEAN GSAP pattern: scroll-reveal-batch)
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
}, { scope: root, dependencies: [ScrollTrigger] })`,
  'text-reveal': `// Text reveal (BEAN GSAP pattern: text-reveal) — accessible: aria-label kept,
// visual spans aria-hidden.
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  document.querySelectorAll<HTMLElement>('[data-text-reveal]').forEach((heading) => {
    const words = (heading.textContent ?? '').trim().split(/\\s+/)
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
}, { scope: root })`,
  'hover-lift': `// Hover lift (BEAN GSAP pattern: hover-lift)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  document.querySelectorAll<HTMLElement>('[data-hover-lift]').forEach((el) => {
    const yTo = gsap.quickTo(el, 'y', { duration: 0.25, ease: 'power2.out' })
    el.addEventListener('mouseenter', () => yTo(-6))
    el.addEventListener('mouseleave', () => yTo(0))
  })
}, { scope: root })`,
  'svg-draw': `// SVG draw (BEAN GSAP pattern: svg-draw)
import { ScrollTrigger } from 'gsap/ScrollTrigger'
gsap.registerPlugin(ScrollTrigger)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  document.querySelectorAll<SVGPathElement>('[data-svg-draw] path').forEach((path) => {
    const len = path.getTotalLength ? path.getTotalLength() : 0
    if (!len) return
    path.style.strokeDasharray = String(len)
    path.style.strokeDashoffset = String(len)
    gsap.to(path, {
      strokeDashoffset: 0, duration: 1.2, ease: 'power2.inOut',
      scrollTrigger: { trigger: path.closest('svg'), start: 'top 85%', once: true },
    })
  })
}, { scope: root, dependencies: [ScrollTrigger] })`,
}

export function patternCode(id: string, target: FrontendTarget): string | undefined {
  return target === 'static' ? STATIC_PATTERN_CODE[id] : REACT_PATTERN_CODE[id]
}

/** Brief section for the selected patterns (bounded by the engine's cap). */
export function buildAnimationsBrief(target: FrontendTarget, ids: string[]): string {
  const blocks = ids
    .map((id) => {
      const meta = getAnimation(id)
      const code = patternCode(id, target)
      if (!meta || !code) return null
      return `### ${meta.label} (${id})\n${meta.description}\n\`\`\`\n${code}\n\`\`\``
    })
    .filter((b): b is string => b !== null)
  if (blocks.length === 0) return ''
  return ['## GSAP ANIMATION PATTERNS (use these exact patterns; do not invent new timelines)', ...blocks].join('\n\n')
}
