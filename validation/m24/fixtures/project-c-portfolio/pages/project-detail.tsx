import SplitText from '../components/kit/SplitText'
import { projectBySlug } from '../data/projects'
import NotFound from './not-found'

export default function ProjectDetail({ slug }: { slug: string }) {
  const project = projectBySlug(slug)
  if (!project) return <NotFound />
  return (
    <article className="pf-section">
      <div className="pf-container pf-narrow">
        <p className="pf-breadcrumb">
          <a href="#/projects">← All projects</a>
        </p>
        <SplitText
          tag="h1"
          text={project.title}
          className="pf-page-title"
          splitType="words"
          delay={80}
          duration={0.9}
          trigger="load"
          textAlign="left"
        />
        <p className="pf-lede" data-animate>
          {project.blurb} <span className="pf-project-year" style={{ color: project.accent }}>({project.year})</span>
        </p>
        <section aria-labelledby="pf-detail-role-h" className="pf-detail-block" data-animate>
          <h2 className="pf-h2" id="pf-detail-role-h">Role</h2>
          <p className="pf-body">{project.role}. Sample case study for a fictional project.</p>
        </section>
        <section aria-labelledby="pf-detail-stack-h" className="pf-detail-block" data-animate>
          <h2 className="pf-h2" id="pf-detail-stack-h">Stack</h2>
          <p className="pf-stack pf-stack-lg">{project.stack.join(' · ')}</p>
        </section>
        <section aria-labelledby="pf-detail-hl-h" className="pf-detail-block" data-animate>
          <h2 className="pf-h2" id="pf-detail-hl-h">Highlights</h2>
          <ul className="pf-list">
            {project.highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>
        <p className="pf-section-foot">
          <a className="pf-btn pf-btn-ghost" href="#/contact">Discuss a project like this</a>
        </p>
      </div>
    </article>
  )
}
