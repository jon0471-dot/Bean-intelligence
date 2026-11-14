import SplitText from '../components/kit/SplitText'

const TIMELINE = [
  { year: '2023 — now', what: 'Independent design engineer — frontend architecture, motion systems, accessibility audits for product teams.' },
  { year: '2020 — 2023', what: 'Founding engineer at a research-tools startup — notebooks, sync, canvas capture.' },
  { year: '2017 — 2020', what: 'Frontend engineer in fintech — dashboards, data density, performance budgets.' },
]

export default function About() {
  return (
    <article className="pf-section">
      <div className="pf-container pf-narrow">
        <SplitText
          tag="h1"
          text="About Nova"
          className="pf-page-title"
          splitType="chars"
          delay={80}
          duration={0.9}
          trigger="load"
          textAlign="left"
        />
        <p className="pf-scrollreveal" data-reveal>
          I build interfaces where the engineering is the design: fast,
          legible, and honest about what the data says. Most of my work sits
          at the intersection of product surface and systems — mapping
          engines, finance dashboards, sync layers — with a strong bias for
          accessibility and measured motion.
        </p>
        <h2 className="pf-h2">Timeline</h2>
        <ol className="pf-timeline">
          {TIMELINE.map((t) => (
            <li key={t.year} data-reveal>
              <p className="pf-timeline-year">{t.year}</p>
              <p className="pf-body">{t.what}</p>
            </li>
          ))}
        </ol>
        <h2 className="pf-h2">How I work</h2>
        <ul className="pf-list" data-reveal>
          <li>Performance budgets agreed before design review, measured after.</li>
          <li>Keyboard and screen-reader paths are features, not audits.</li>
          <li>Motion respects prefers-reduced-motion everywhere, always.</li>
        </ul>
      </div>
    </article>
  )
}
