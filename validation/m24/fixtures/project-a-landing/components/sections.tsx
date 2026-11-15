import { Fragment } from 'react'
import CountUp from '../components/kit/CountUp'
import ScrollReveal from '../components/kit/ScrollReveal'
import AnimatedContent from '../components/kit/AnimatedContent'

const STATS = [
  { value: 99.98, suffix: '%', label: 'Platform uptime', decimals: 2 },
  { value: 38, suffix: 'ms', label: 'Median inference latency' },
  { value: 4.2, suffix: 'B', label: 'Tokens served monthly', decimals: 1 },
]

const FEATURES = [
  {
    title: 'Managed inference',
    body: 'Autoscaled model serving with rolling deploys, canary weights and instant rollback across 40+ regions.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M7 20h10M12 16v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Vector search',
    body: 'Hybrid lexical + semantic retrieval with filtering, up to a billion vectors, single-digit millisecond reads.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.6" />
        <path d="M15 15l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Evaluation pipelines',
    body: 'Golden datasets, regression gates and human review queues wired directly into your deploy pipeline.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 19c4 0 4-10 8-10s4 10 8 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Private networking',
    body: 'VPC peering, mTLS everywhere and customer-managed keys. Your traffic never shares a link with anyone else.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 3l7 4v5c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V7l7-4z" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    title: 'Observability',
    body: 'Trace every token, tool call and retrieval hit. Export to your own warehouse with one click.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 12a8 8 0 1 1 8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M12 12l4-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: 'Zero-downtime evals',
    body: 'Shadow deployments answer real traffic while candidate models are scored — before anyone switches over.',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M8 6h8M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="17" cy="17" r="3.4" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
]

export function StatsBand() {
  return (
    <section className="nb-stats" aria-label="Platform statistics (sample data)">
      <div className="nb-container nb-stats-grid">
        {STATS.map((s) => (
          <div className="nb-stat" key={s.label} data-animate>
            <p className="nb-stat-value">
              <CountUp
                to={s.value}
                duration={2}
                decimals={s.decimals}
                suffix={s.suffix}
                className="nb-count"
              />
            </p>
            <p className="nb-stat-label">{s.label}</p>
          </div>
        ))}
      </div>
      <p className="nb-container nb-sample-note">Sample figures for a fictional product.</p>
    </section>
  )
}

export function FeatureGrid() {
  return (
    <section className="nb-section" id="features" aria-labelledby="nb-features-title">
      <div className="nb-container">
        <p className="nb-kicker" data-animate>Platform</p>
        <h2 className="nb-h2" id="nb-features-title" data-animate>
          Everything an AI product needs to reach production
        </h2>
        <p className="nb-lede" data-animate>
          One control plane for inference, retrieval and evaluation — engineered for
          teams who ship weekly.
        </p>
        <div className="nb-features-grid">
          {FEATURES.map((f) => (
            <AnimatedContent key={f.title} distance={60} duration={0.7} className="nb-feature-cell">
              <article className="nb-card nb-feature-card" data-hover-lift data-reveal>
                <span className="nb-feature-icon" aria-hidden="true">{f.icon}</span>
                <h3 className="nb-h3">{f.title}</h3>
                <p className="nb-body">{f.body}</p>
              </article>
            </AnimatedContent>
          ))}
        </div>
      </div>
    </section>
  )
}

function TerminalMock() {
  return (
    <div className="nb-terminal" role="img" aria-label="Sample terminal session running the Nebula CLI">
      <div className="nb-terminal-bar" aria-hidden="true">
        <span></span><span></span><span></span>
        <em>nebula — sample session</em>
      </div>
      <pre className="nb-terminal-body"><code>{`$ nebula deploy ./service --strategy canary
✓ packaged 1 model artifact (2.4 GB)
✓ provisioned 12 replicas across 3 regions
✓ canary live at 10% traffic — p95 latency 38 ms
✓ eval gate passed (1,204 cases, 0 regressions)
→ promoted to 100% in 4m 12s`}</code></pre>
    </div>
  )
}

export function Showcase() {
  return (
    <section className="nb-section nb-showcase" id="showcase" aria-labelledby="nb-showcase-title" data-scrub-section>
      <div className="nb-container nb-showcase-grid">
        <div className="nb-showcase-copy" data-scrub>
          <p className="nb-kicker" data-animate>Product showcase</p>
          <h2 className="nb-h2" id="nb-showcase-title" data-animate>
            From notebook to production in one command
          </h2>
          <ScrollReveal
            containerClassName="nb-scrollreveal"
            textClassName="nb-scrollreveal-text"
            enableBlur
            baseOpacity={0.15}
            baseOffset={0.6}
            stagger={0.06}
          >
            The CLI mirrors what the control plane does: package, provision,
            evaluate, promote. Every step is observable and reversible, so the
            risky part of shipping AI stops being the shipping.
          </ScrollReveal>
          <ul className="nb-checklist" data-animate>
            <li>Declarative service manifests</li>
            <li>Eval gates wired into promotion</li>
            <li>One-command rollback</li>
          </ul>
        </div>
        <div className="nb-showcase-visual" data-scrub>
          <TerminalMock />
        </div>
      </div>
    </section>
  )
}

// Fragment import retained for consumers extending this module.
export const __sectionsMarker = Fragment
