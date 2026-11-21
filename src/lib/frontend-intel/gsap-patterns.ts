/**
 * BEAN Intelligence — GSAP animation engine for CODE GIFTZ frontend
 * generation (Phase 2 of the Frontend Intelligence Toolkit work order;
 * expanded in the internal-library expansion to the full free GSAP 3.13
 * plugin set).
 *
 * Reusable, bounded animation patterns — NOT uncontrolled custom timelines.
 * Every pattern:
 *   - respects `prefers-reduced-motion` (skips and leaves content visible),
 *   - ships correct lifecycle handling: static output uses one guarded init;
 *     React output uses the official `@gsap/react` `useGSAP` integration so
 *     gsap.context revert cleans tweens AND ScrollTriggers on unmount
 *     (patterns that create non-tween handles — Draggable, Observer,
 *     SplitText, gsap.matchMedia — return an explicit cleanup),
 *   - is injected into the generation brief verbatim so the model reuses the
 *     pattern instead of inventing a new timeline per component.
 *
 * GSAP 3.13.0 is free for commercial use under the Standard "No Charge" GSAP
 * License (AI-generated GSAP code is explicitly not a prohibited use). Every
 * plugin used here ships in the installed `gsap` npm package's dist/
 * (verified on disk by the vanta/gsap tests): SplitText, MorphSVGPlugin,
 * MotionPathPlugin, Flip, Draggable, Observer, CustomEase, DrawSVGPlugin,
 * ScrambleTextPlugin, ScrollTrigger.
 */
import type { FrontendAnimationMeta, FrontendTarget } from './types'

/** Reduced-motion guard used verbatim in every static snippet. */
export const STATIC_REDUCED_MOTION_GUARD =
  "var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches"

/** Canonical React lifecycle contract the validator looks for. */
export const REACT_CLEANUP_MARKERS = ['useGSAP(', '{ scope'] as const
export const REDUCED_MOTION_MARKER = 'prefers-reduced-motion'

/**
 * Plugin UMD builds (gsap/dist/<name>.min.js) each pattern needs beyond the
 * core. Keys are the global names the UMD attaches; vendor.ts materializes
 * the exact builds when any selected pattern requires them.
 */
export const PATTERN_PLUGIN_BUILDS: Record<string, string[]> = {
  'entrance-timeline': [],
  'scroll-reveal-batch': ['ScrollTrigger'],
  'text-reveal': [],
  'hover-lift': [],
  'svg-draw': ['ScrollTrigger'],
  'split-text': ['SplitText'],
  'morph-svg': ['MorphSVGPlugin'],
  'motion-path': ['MotionPathPlugin'],
  flip: ['Flip'],
  draggable: ['Draggable'],
  observer: ['Observer'],
  'custom-ease': ['CustomEase'],
  'scroll-scrub': ['ScrollTrigger'],
  'draw-svg': ['DrawSVGPlugin', 'ScrollTrigger'],
  'scramble-text': ['ScrambleTextPlugin'],
}

/** Canonical vendor load order for the UMD plugin builds. */
export const GSAP_PLUGIN_ORDER = [
  'ScrollTrigger',
  'SplitText',
  'MorphSVGPlugin',
  'MotionPathPlugin',
  'Flip',
  'Draggable',
  'Observer',
  'CustomEase',
  'DrawSVGPlugin',
  'ScrambleTextPlugin',
] as const

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
  {
    id: 'split-text',
    label: 'SplitText reveal',
    description: 'Splits headings into chars/words with the official SplitText plugin (accessible aria output) and animates the pieces in.',
    targets: ['static', 'react'],
    requires: ['gsap', 'SplitText'],
    tags: ['split text', 'chars', 'letters', 'heading animation', 'text reveal'],
  },
  {
    id: 'morph-svg',
    label: 'SVG morph',
    description: 'Shapes morph between paths on hover with the official MorphSVGPlugin.',
    targets: ['static', 'react'],
    requires: ['gsap', 'MorphSVGPlugin'],
    tags: ['morph', 'shape', 'svg morph', 'morphing'],
  },
  {
    id: 'motion-path',
    label: 'Motion path',
    description: 'An element travels along an SVG route with the official MotionPathPlugin (auto-rotate).',
    targets: ['static', 'react'],
    requires: ['gsap', 'MotionPathPlugin'],
    tags: ['motion path', 'path animation', 'travel along', 'route'],
  },
  {
    id: 'flip',
    label: 'Layout flip',
    description: 'Smooth layout-state transitions (grid expand, reorder, shared elements) with the official Flip plugin.',
    targets: ['static', 'react'],
    requires: ['gsap', 'Flip'],
    tags: ['flip', 'layout transition', 'shared element', 'grid expand', 'reorder'],
  },
  {
    id: 'draggable',
    label: 'Draggable',
    description: 'Pointer-draggable elements with bounds via the official Draggable plugin.',
    targets: ['static', 'react'],
    requires: ['gsap', 'Draggable'],
    tags: ['drag', 'draggable', 'drag and drop', 'swipe card'],
  },
  {
    id: 'observer',
    label: 'Observer gestures',
    description: 'Unified wheel/touch/pointer gestures driving section navigation via the official Observer plugin (use sparingly).',
    targets: ['static', 'react'],
    requires: ['gsap', 'Observer'],
    tags: ['fullpage', 'section snap', 'gesture', 'scroll hijack', 'observer'],
  },
  {
    id: 'custom-ease',
    label: 'Custom easing',
    description: 'A bespoke branded easing curve via the official CustomEase plugin, applied to the entrance set.',
    targets: ['static', 'react'],
    requires: ['gsap', 'CustomEase'],
    tags: ['custom easing', 'bespoke easing', 'brand easing'],
  },
  {
    id: 'scroll-scrub',
    label: 'Scroll scrub (responsive)',
    description: 'Scroll-driven scrubbed motion with gsap.matchMedia: desktop-only by default and fully reverted below the breakpoint.',
    targets: ['static', 'react'],
    requires: ['gsap', 'ScrollTrigger'],
    tags: ['scrub', 'parallax', 'pinned', 'scroll driven', 'scroll animation'],
  },
  {
    id: 'draw-svg',
    label: 'DrawSVG strokes',
    description: 'Strokes draw themselves in with the official DrawSVGPlugin when scrolled into view.',
    targets: ['static', 'react'],
    requires: ['gsap', 'DrawSVGPlugin', 'ScrollTrigger'],
    tags: ['svg draw', 'stroke draw', 'line draw', 'logo draw', 'drawsvg'],
  },
  {
    id: 'scramble-text',
    label: 'Scramble text',
    description: 'Headlines decode/scramble into their final text with the official ScrambleTextPlugin.',
    targets: ['static', 'react'],
    requires: ['gsap', 'ScrambleTextPlugin'],
    tags: ['scramble', 'decode', 'hacker text', 'encrypt', 'matrix text'],
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
  'split-text': `// SplitText reveal (BEAN GSAP pattern: split-text) — official SplitText plugin
// (free since GSAP 3.13). aria:'auto' keeps an accessible copy of the text.
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.SplitText) {
  gsap.registerPlugin(SplitText)
  document.querySelectorAll('[data-split-reveal]').forEach(function (el) {
    var split = SplitText.create(el, { type: 'words,chars', aria: 'auto' })
    gsap.from(split.chars, {
      yPercent: 120, opacity: 0, duration: 0.6, ease: 'power3.out', stagger: 0.02,
      scrollTrigger: { trigger: el, start: 'top 85%', once: true },
    })
  })
}`,
  'morph-svg': `// SVG morph (BEAN GSAP pattern: morph-svg) — official MorphSVGPlugin
// Markup: <svg><path data-morph="#shape-b" d="..."/></svg> — hover morphs the
// path into the referenced shape; mouseleave reverses. Reversible, no stuck tweens.
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.MorphSVGPlugin) {
  gsap.registerPlugin(MorphSVGPlugin)
  document.querySelectorAll('[data-morph]').forEach(function (path) {
    var to = path.getAttribute('data-morph')
    if (!to) return
    var tween = gsap.to(path, { morphSVG: to, duration: 0.8, ease: 'power2.inOut', paused: true })
    var hit = path.closest('svg') || path
    hit.addEventListener('mouseenter', function () { tween.play() })
    hit.addEventListener('mouseleave', function () { tween.reverse() })
  })
}`,
  'motion-path': `// Motion path (BEAN GSAP pattern: motion-path) — official MotionPathPlugin
// Markup: an SVG <path id="motion-route"> plus the moving element
// <div data-motion-path></div>. autoRotate keeps the element oriented.
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.MotionPathPlugin) {
  gsap.registerPlugin(MotionPathPlugin)
  var route = document.getElementById('motion-route')
  if (route) {
    gsap.to('[data-motion-path]', {
      motionPath: { path: '#motion-route', align: '#motion-route', autoRotate: true, alignOrigin: [0.5, 0.5] },
      duration: 8, repeat: -1, ease: 'none',
    })
  }
}`,
  'flip': `// Layout flip (BEAN GSAP pattern: flip) — official Flip plugin for layout
// state transitions. Markup: container [data-flip-grid] with items
// [data-flip-item]; the .is-expanded class change animates positions.
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.Flip) {
  gsap.registerPlugin(Flip)
  document.querySelectorAll('[data-flip-grid]').forEach(function (grid) {
    grid.addEventListener('click', function (e) {
      var item = e.target.closest('[data-flip-item]')
      if (!item) return
      var state = Flip.getState(grid.querySelectorAll('[data-flip-item]'))
      item.classList.toggle('is-expanded')
      Flip.from(state, { duration: 0.5, ease: 'power2.inOut', absolute: true, stagger: 0.02, nested: true })
    })
  })
}`,
  'draggable': `// Draggable (BEAN GSAP pattern: draggable) — official Draggable plugin.
// Markup: bounds element [data-draggable-bounds] containing [data-draggable].
// Inertia stays OFF (InertiaPlugin is deliberately not vendored).
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.Draggable) {
  gsap.registerPlugin(Draggable)
  Draggable.create('[data-draggable]', { bounds: '[data-draggable-bounds]', edgeResistance: 0.75, type: 'x,y', inertia: false })
}`,
  'observer': `// Observer gestures (BEAN GSAP pattern: observer) — official Observer plugin.
// Use SPARINGLY (fullpage section navigation only; never on content-heavy
// pages). Markup: sections carry [data-observer-section].
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.Observer) {
  gsap.registerPlugin(Observer)
  var sections = gsap.utils.toArray('[data-observer-section]')
  if (sections.length > 1) {
    var index = 0
    var moving = false
    var goTo = function (i) {
      if (i < 0 || i >= sections.length || moving) return
      moving = true
      index = i
      sections[i].scrollIntoView({ behavior: 'smooth' })
      window.setTimeout(function () { moving = false }, 700)
    }
    Observer.create({
      target: window, type: 'wheel,touch,pointer', wheelSpeed: -1, tolerance: 14, preventDefault: true,
      onUp: function () { goTo(index + 1) },
      onDown: function () { goTo(index - 1) },
    })
  }
}`,
  'custom-ease': `// Custom easing (BEAN GSAP pattern: custom-ease) — official CustomEase
// plugin with one named, reusable branded curve.
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.CustomEase) {
  gsap.registerPlugin(CustomEase)
  var brandEase = CustomEase.create('bean-brand-ease', 'M0,0 C0.3,0 0.3,1 1,1')
  gsap.from('[data-animate]', {
    opacity: 0, y: 32, duration: 0.9, ease: brandEase, stagger: 0.06, clearProps: 'all',
  })
}`,
  'scroll-scrub': `// Scroll scrub, responsive (BEAN GSAP pattern: scroll-scrub) — scrubbed
// scroll-driven motion wrapped in gsap.matchMedia so it exists ONLY on
// desktop (min-width 768px) and is fully reverted (killed) below it.
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger)
  var mm = gsap.matchMedia()
  mm.add('(min-width: 768px)', function () {
    var tween = gsap.to('[data-scrub]', {
      y: -80, ease: 'none',
      scrollTrigger: { trigger: '[data-scrub-section]', start: 'top bottom', end: 'bottom top', scrub: 0.6 },
    })
    return function () { tween.kill() }
  })
}`,
  'draw-svg': `// DrawSVG strokes (BEAN GSAP pattern: draw-svg) — official DrawSVGPlugin.
// Markup: <svg data-svg-draw>…paths…</svg>; strokes draw in once on scroll.
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.DrawSVGPlugin && window.ScrollTrigger) {
  gsap.registerPlugin(DrawSVGPlugin, ScrollTrigger)
  document.querySelectorAll('[data-svg-draw]').forEach(function (svg) {
    gsap.from(svg.querySelectorAll('path, circle, line, polyline'), {
      drawSVG: '0%', duration: 1.4, ease: 'power2.inOut', stagger: 0.12,
      scrollTrigger: { trigger: svg, start: 'top 85%', once: true },
    })
  })
}`,
  'scramble-text': `// Scramble text (BEAN GSAP pattern: scramble-text) — official
// ScrambleTextPlugin. aria-label preserves the final text for screen readers.
${STATIC_REDUCED_MOTION_GUARD}
if (!reduceMotion && window.ScrambleTextPlugin) {
  gsap.registerPlugin(ScrambleTextPlugin)
  document.querySelectorAll('[data-scramble]').forEach(function (el) {
    var final = el.textContent.trim()
    el.setAttribute('aria-label', final)
    gsap.to(el, {
      duration: 1.2, delay: 0.2,
      scrambleText: { text: final, chars: 'upperCase', speed: 1 },
    })
  })
}`,
}

/** REACT TARGET — official @gsap/react useGSAP integration. useGSAP wraps
 *  gsap.context and reverts tweens + ScrollTriggers automatically on unmount;
 *  the `dependencies` entry makes plugin registration revert-safe. Patterns
 *  creating NON-tween handles (SplitText instances, Draggable/Observer
 *  instances, gsap.matchMedia) return an explicit cleanup function. */
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
  'split-text': `// SplitText reveal (BEAN GSAP pattern: split-text) — official SplitText plugin
// (free since GSAP 3.13). aria:'auto' keeps an accessible copy; the split is
// reverted on unmount via the explicit cleanup (context revert does not revert
// SplitText instances).
import { SplitText } from 'gsap/SplitText'
gsap.registerPlugin(SplitText)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const splits = SplitText.create('[data-split-reveal]', { type: 'words,chars', aria: 'auto' })
  gsap.from(splits.chars, {
    yPercent: 120, opacity: 0, duration: 0.6, ease: 'power3.out', stagger: 0.02,
    scrollTrigger: { trigger: root, start: 'top 85%', once: true },
  })
  return () => splits.revert()
}, { scope: root, dependencies: [SplitText] })`,
  'morph-svg': `// SVG morph (BEAN GSAP pattern: morph-svg) — official MorphSVGPlugin.
// Reversible hover tween; context revert kills the tween on unmount.
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin'
gsap.registerPlugin(MorphSVGPlugin)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  root.querySelectorAll<SVGPathElement>('[data-morph]').forEach((path) => {
    const to = path.getAttribute('data-morph')
    if (!to) return
    const tween = gsap.to(path, { morphSVG: to, duration: 0.8, ease: 'power2.inOut', paused: true })
    const hit = (path.closest('svg') as Element) ?? path
    hit.addEventListener('mouseenter', () => tween.play())
    hit.addEventListener('mouseleave', () => tween.reverse())
  })
}, { scope: root, dependencies: [MorphSVGPlugin] })`,
  'motion-path': `// Motion path (BEAN GSAP pattern: motion-path) — official MotionPathPlugin.
import { MotionPathPlugin } from 'gsap/MotionPathPlugin'
gsap.registerPlugin(MotionPathPlugin)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  if (!root.querySelector('#motion-route')) return
  gsap.to('[data-motion-path]', {
    motionPath: { path: '#motion-route', align: '#motion-route', autoRotate: true, alignOrigin: [0.5, 0.5] },
    duration: 8, repeat: -1, ease: 'none',
  })
}, { scope: root, dependencies: [MotionPathPlugin] })`,
  'flip': `// Layout flip (BEAN GSAP pattern: flip) — official Flip plugin for layout
// state transitions; Flip.from is self-cleaning (no lingering handles).
import { Flip } from 'gsap/Flip'
gsap.registerPlugin(Flip)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  root.querySelectorAll<HTMLElement>('[data-flip-grid]').forEach((grid) => {
    grid.addEventListener('click', (e) => {
      const item = (e.target as Element | null)?.closest('[data-flip-item]')
      if (!item) return
      const state = Flip.getState(grid.querySelectorAll('[data-flip-item]'))
      item.classList.toggle('is-expanded')
      Flip.from(state, { duration: 0.5, ease: 'power2.inOut', absolute: true, stagger: 0.02, nested: true })
    })
  })
}, { scope: root, dependencies: [Flip] })`,
  'draggable': `// Draggable (BEAN GSAP pattern: draggable) — official Draggable plugin.
// Inertia stays OFF (InertiaPlugin deliberately not used). Draggable
// instances are NOT tweens: kill them via the explicit cleanup.
import { Draggable } from 'gsap/Draggable'
gsap.registerPlugin(Draggable)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const draggables = Draggable.create('[data-draggable]', { bounds: '[data-draggable-bounds]', edgeResistance: 0.75, type: 'x,y', inertia: false })
  return () => draggables.forEach((d) => d.kill())
}, { scope: root, dependencies: [Draggable] })`,
  'observer': `// Observer gestures (BEAN GSAP pattern: observer) — official Observer plugin.
// Use SPARINGLY (fullpage section navigation only). Observer instances are
// not tweens: kill them via the explicit cleanup.
import { Observer } from 'gsap/Observer'
gsap.registerPlugin(Observer)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const sections = gsap.utils.toArray<HTMLElement>('[data-observer-section]')
  if (sections.length <= 1) return
  let index = 0
  let moving = false
  const goTo = (i: number) => {
    if (i < 0 || i >= sections.length || moving) return
    moving = true
    index = i
    sections[i]!.scrollIntoView({ behavior: 'smooth' })
    window.setTimeout(() => { moving = false }, 700)
  }
  const observer = Observer.create({
    target: window, type: 'wheel,touch,pointer', wheelSpeed: -1, tolerance: 14, preventDefault: true,
    onUp: () => goTo(index + 1),
    onDown: () => goTo(index - 1),
  })
  return () => observer.kill()
}, { scope: root, dependencies: [Observer] })`,
  'custom-ease': `// Custom easing (BEAN GSAP pattern: custom-ease) — official CustomEase
// plugin with one named, reusable branded curve.
import { CustomEase } from 'gsap/CustomEase'
gsap.registerPlugin(CustomEase)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const brandEase = CustomEase.create('bean-brand-ease', 'M0,0 C0.3,0 0.3,1 1,1')
  gsap.from('[data-animate]', {
    opacity: 0, y: 32, duration: 0.9, ease: brandEase, stagger: 0.06, clearProps: 'all',
  })
}, { scope: root, dependencies: [CustomEase] })`,
  'scroll-scrub': `// Scroll scrub, responsive (BEAN GSAP pattern: scroll-scrub) — scrubbed
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
}, { scope: root, dependencies: [ScrollTrigger] })`,
  'draw-svg': `// DrawSVG strokes (BEAN GSAP pattern: draw-svg) — official DrawSVGPlugin.
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
gsap.registerPlugin(DrawSVGPlugin, ScrollTrigger)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  root.querySelectorAll<SVGSVGElement>('[data-svg-draw]').forEach((svg) => {
    gsap.from(svg.querySelectorAll('path, circle, line, polyline'), {
      drawSVG: '0%', duration: 1.4, ease: 'power2.inOut', stagger: 0.12,
      scrollTrigger: { trigger: svg, start: 'top 85%', once: true },
    })
  })
}, { scope: root, dependencies: [DrawSVGPlugin, ScrollTrigger] })`,
  'scramble-text': `// Scramble text (BEAN GSAP pattern: scramble-text) — official
// ScrambleTextPlugin. aria-label preserves the final text for screen readers.
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
gsap.registerPlugin(ScrambleTextPlugin)
useGSAP(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  root.querySelectorAll<HTMLElement>('[data-scramble]').forEach((el) => {
    const finalText = (el.textContent ?? '').trim()
    el.setAttribute('aria-label', finalText)
    gsap.to(el, {
      duration: 1.2, delay: 0.2,
      scrambleText: { text: finalText, chars: 'upperCase', speed: 1 },
    })
  })
}, { scope: root, dependencies: [ScrambleTextPlugin] })`,
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

/** Union of plugin UMD builds required by the selected patterns (core is
 *  always implied when the list is non-empty; ScrollTrigger included only
 *  when a pattern requires it). */
export function requiredPluginBuilds(ids: string[]): string[] {
  const plugins = new Set<string>()
  for (const id of ids) {
    for (const p of PATTERN_PLUGIN_BUILDS[id] ?? []) plugins.add(p)
  }
  return GSAP_PLUGIN_ORDER.filter((p) => plugins.has(p))
}
