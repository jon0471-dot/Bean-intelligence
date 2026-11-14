import SplitText from '../components/kit/SplitText'
import GlareHover from '../components/kit/GlareHover'
import { PROJECTS } from '../data/projects'
import { useHoverLift, useScrollRevealBatch } from '../lib/motion'
import { useRef } from 'react'

export default function Projects() {
  const scope = useRef<HTMLElement>(null)
  // BEAN patterns: hover-lift on the cards, batched reveal on scroll.
  useHoverLift(scope)
  useScrollRevealBatch(scope)
  return (
    <article className="pf-section" ref={scope}>
      <div className="pf-container">
        <SplitText
          tag="h1"
          text="Projects"
          className="pf-page-title"
          splitType="chars"
          delay={70}
          duration={0.9}
          trigger="load"
          textAlign="left"
        />
        <p className="pf-lede" data-animate>
          Four selected case studies (sample content). Every card links to a
          full project page.
        </p>
        <div className="pf-cards pf-cards-2">
          {PROJECTS.map((p) => (
            <GlareHover
              key={p.slug}
              className="pf-card-cell"
              glareColor={p.accent}
              glareOpacity={0.28}
              variant="streak"
              mode="hover"
              borderRadius="16px"
            >
              <a className="pf-project-link pf-project-tile" href={`#/projects/${p.slug}`} data-hover-lift data-reveal>
                <span className="pf-project-swatch" style={{ background: p.accent }} aria-hidden="true" />
                <span className="pf-project-year" style={{ color: p.accent }}>{p.year}</span>
                <h2 className="pf-h3">{p.title}</h2>
                <p className="pf-body">{p.blurb}</p>
                <p className="pf-stack">{p.stack.join(' · ')}</p>
                <span className="pf-project-more" aria-hidden="true">Read case study →</span>
              </a>
            </GlareHover>
          ))}
        </div>
      </div>
    </article>
  )
}
