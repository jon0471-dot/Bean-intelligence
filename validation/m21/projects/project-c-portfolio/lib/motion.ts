// GSAP hooks implementing the BEAN animation patterns from the generation
// brief. Each hook guards prefers-reduced-motion (content stays visible when
// motion is declined) and cleans up through useGSAP's context revert.
import type { RefObject } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// BEAN pattern: entrance-timeline — staggered entrance for [data-animate].
export function useEntranceTimeline(scope: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      gsap.from('[data-animate]', {
        opacity: 0,
        y: 24,
        duration: 0.7,
        ease: 'power2.out',
        stagger: 0.08,
        clearProps: 'all',
      })
    },
    { scope, dependencies: [] },
  )
}

// BEAN pattern: scroll-reveal-batch — [data-reveal] fades in once (once:true).
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

// BEAN pattern: hover-lift — quickTo lift on [data-hover-lift] cards.
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
