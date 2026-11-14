import { useRef } from 'react'
import SiteNav from './components/site-nav'
import Hero from './components/hero'
import { StatsBand, FeatureGrid, Showcase } from './components/sections'
import { Testimonials, Pricing, Faq, ClosingCta, SiteFooter } from './components/closing'
import {
  useEntranceTimeline,
  useScrollRevealBatch,
  useHoverLift,
  useShowcaseScrub,
} from './lib/motion'

export default function App() {
  const root = useRef<HTMLDivElement>(null)

  // BEAN GSAP patterns (see the generation brief): each hook guards
  // prefers-reduced-motion and reverts its context on unmount.
  useEntranceTimeline(root)
  useScrollRevealBatch(root)
  useHoverLift(root)
  useShowcaseScrub(root)

  return (
    <div className="nb-page" ref={root}>
      <SiteNav />
      <main id="main">
        <Hero />
        <StatsBand />
        <FeatureGrid />
        <Showcase />
        <Testimonials />
        <Pricing />
        <Faq />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  )
}
