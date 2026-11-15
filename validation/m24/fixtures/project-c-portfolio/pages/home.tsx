import SplitText from '../components/kit/SplitText'
import BlurText from '../components/kit/BlurText'
import SpotlightCard from '../components/kit/SpotlightCard'
import { PROJECTS } from '../data/projects'
import { useScrollRevealBatch } from '../lib/motion'
import { useEffect, useRef, useState } from 'react'

export default function Home() {
  const scope = useRef<HTMLElement>(null)
  // BEAN pattern: scroll-reveal-batch for the lower home sections.
  useScrollRevealBatch(scope)

  // Subtle terminal-style typing indicator for the availability line.
  const [openTo, setOpenTo] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setOpenTo(true), 900)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <article ref={scope}>
      <section className="pf-hero" aria-label="Introduction">
        <div className="pf-container pf-hero-inner">
          <p className="pf-eyebrow" data-animate>
            <BlurText text="Portfolio — 2026" delay={40} animateBy="words" trigger="load" className="pf-eyebrow-text" />
          </p>
          {/* Above the fold: trigger 'load' so the split intro never depends
              on a scroll-trigger race. */}
          <SplitText
            tag="h1"
            text="Nova Reyes builds interfaces that feel engineered"
            className="pf-hero-title"
            splitType="words"
            delay={140}
            duration={1}
            ease="power3.out"
            trigger="load"
            textAlign="center"
          />
          <p className="pf-hero-sub" data-animate>
            Frontend engineer & design engineer. Sample portfolio content —
            the person, projects and figures below are fictional.
          </p>
          <div className="pf-hero-actions" data-animate>
            <a className="pf-btn pf-btn-primary" href="#/projects">View projects</a>
            <a className="pf-btn pf-btn-ghost" href="#/contact">Get in touch</a>
          </div>
          <p className="pf-hero-status" data-animate aria-live="polite">
            {openTo ? '● Open to select engagements' : '…'}
          </p>
        </div>
      </section>

      <section className="pf-section" aria-labelledby="pf-featured-h">
        <div className="pf-container">
          <h2 className="pf-h2" id="pf-featured-h" data-animate>Featured work</h2>
          <div className="pf-cards">
            {PROJECTS.slice(0, 3).map((p) => (
              <SpotlightCard key={p.slug} className="pf-card-cell" data-reveal theme="dark" spotlightColor="rgba(125, 211, 252, 0.18)">
                <a className="pf-project-link" href={`#/projects/${p.slug}`}>
                  <span className="pf-project-year" style={{ color: p.accent }}>{p.year}</span>
                  <h3 className="pf-h3">{p.title}</h3>
                  <p className="pf-body">{p.blurb}</p>
                  <span className="pf-project-more" aria-hidden="true">Case study →</span>
                </a>
              </SpotlightCard>
            ))}
          </div>
          <p className="pf-section-foot" data-reveal>
            <a className="pf-textlink" href="#/projects">All {PROJECTS.length} projects →</a>
          </p>
        </div>
      </section>
    </article>
  )
}
