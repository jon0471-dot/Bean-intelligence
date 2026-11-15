// GSAP hooks implementing the BEAN animation patterns shipped in the
// generation brief. Each hook: guards prefers-reduced-motion (content stays
// visible when motion is declined) and relies on useGSAP's context revert for
// cleanup on unmount. No other timelines are invented.
import type { RefObject } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CustomEase } from 'gsap/CustomEase'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, CustomEase, useGSAP)

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// BEAN patterns: entrance-timeline + custom-ease — one staggered entrance for
// [data-animate] elements, eased with the branded CustomEase curve.
export function useEntranceTimeline(scope: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      // Custom easing (BEAN pattern: custom-ease) — official CustomEase
      // plugin, one named reusable branded curve.
      const brandEase = CustomEase.create('nebula-brand-ease', 'M0,0 C0.3,0 0.3,1 1,1')
      gsap.from('[data-animate]', {
        opacity: 0,
        y: 32,
        duration: 0.9,
        ease: brandEase,
        stagger: 0.06,
        clearProps: 'all',
      })
    },
    { scope, dependencies: [CustomEase] },
  )
}

// BEAN pattern: scroll-reveal-batch — [data-reveal] elements fade in once as
// they enter the viewport (ScrollTrigger.batch, once: true).
export function useScrollRevealBatch(scope: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
        el.style.opacity = '0'
      })
      ScrollTrigger.batch('[data-reveal]', {
        start: 'top 85%',
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.08 }),
      })
      gsap.set('[data-reveal]', { y: 24 })
    },
    { scope, dependencies: [ScrollTrigger] },
  )
}

// BEAN pattern: hover-lift — pointer-following lift on [data-hover-lift]
// cards via gsap.quickTo (fast, reversible).
export function useHoverLift(scope: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      document.querySelectorAll<HTMLElement>('[data-hover-lift]').forEach((el) => {
        const yTo = gsap.quickTo(el, 'y', { duration: 0.25, ease: 'power2.out' })
        el.addEventListener('mouseenter', () => yTo(-6))
        el.addEventListener('mouseleave', () => yTo(0))
      })
    },
    { scope, dependencies: [] },
  )
}

// BEAN pattern: scroll-scrub (responsive) — scrubbed parallax on [data-scrub]
// exists ONLY on desktop (min-width 768px) via gsap.matchMedia; mm.revert()
// kills its tweens and ScrollTriggers below the breakpoint / on unmount.
export function useShowcaseScrub(scope: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const mm = gsap.matchMedia()
      mm.add('(min-width: 768px)', () => {
        gsap.to('[data-scrub]', {
          y: -80,
          ease: 'none',
          scrollTrigger: {
            trigger: '[data-scrub-section]',
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.6,
          },
        })
      })
      return () => mm.revert()
    },
    { scope, dependencies: [ScrollTrigger] },
  )
}

