import AnimatedContent from '../components/kit/AnimatedContent'

const TESTIMONIALS = [
  {
    quote:
      'We replaced three internal services with Nebula in a quarter. Our eval regression rate dropped by two thirds.',
    name: 'Priya Natarajan',
    role: 'VP Engineering, Fieldline (sample)',
  },
  {
    quote:
      'The promotion gates are the first version of "safe to ship" that our auditors actually accepted.',
    name: 'Marcus Webb',
    role: 'Head of Platform, Corvid Labs (sample)',
  },
  {
    quote:
      'Latency stopped being the thing we text each other about at 2am. That is the whole review.',
    name: 'Sofia Reyes',
    role: 'Staff Engineer, Bluewick (sample)',
  },
]

const TIERS = [
  {
    name: 'Starter',
    price: '$0',
    cadence: '/month',
    blurb: 'For prototypes and side projects.',
    features: ['100k inference tokens / day', '1M vectors', 'Community support', 'Shared capacity'],
    cta: 'Start free',
    featured: false,
  },
  {
    name: 'Team',
    price: '$149',
    cadence: '/month',
    blurb: 'For products in production.',
    features: [
      '50M inference tokens / day',
      '100M vectors',
      'Eval gates + canary deploys',
      '99.9% uptime SLA',
      '8×5 support',
    ],
    cta: 'Start Team trial',
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    cadence: '',
    blurb: 'For regulated scale.',
    features: ['Unlimited tokens', 'Customer-managed keys', 'VPC peering + mTLS', '99.99% uptime SLA', '24×7 support'],
    cta: 'Talk to sales',
    featured: false,
  },
]

const FAQS = [
  {
    q: 'Is this a real product?',
    a: 'No — Nebula is a fictional product used to validate generated front-end output. All figures, quotes and companies on this page are sample content.',
  },
  {
    q: 'How does pricing scale with traffic?',
    a: 'Starter includes a daily token allowance; Team adds pooled capacity across your workspaces. Overage is metered per million tokens with no seat fees.',
  },
  {
    q: 'Can we deploy in our own cloud?',
    a: 'Enterprise plans support VPC peering and customer-managed keys. A fully self-hosted data plane is on the Enterprise roadmap.',
  },
  {
    q: 'What happens when an eval gate fails?',
    a: 'Promotion stops automatically, the candidate stays shadowed, and the failing cases are attached to the deploy record with traces.',
  },
  {
    q: 'Do you support open-weight models?',
    a: 'Yes — bring your own weights or choose from the hosted catalog. Weights are encrypted at rest and never leave the region you pin.',
  },
]

export function Testimonials() {
  return (
    <section className="nb-section nb-alt" id="testimonials" aria-labelledby="nb-testimonials-title">
      <div className="nb-container">
        <p className="nb-kicker" data-animate>Customers</p>
        <h2 className="nb-h2" id="nb-testimonials-title" data-animate>
          Teams that stopped babysitting their inference
        </h2>
        <div className="nb-cards-grid">
          {TESTIMONIALS.map((t) => (
            <AnimatedContent key={t.name} distance={50} duration={0.7} className="nb-card-cell">
              <figure className="nb-card nb-quote-card" data-reveal data-hover-lift>
                <blockquote className="nb-quote">“{t.quote}”</blockquote>
                <figcaption className="nb-quote-by">
                  <strong>{t.name}</strong>
                  <span>{t.role}</span>
                </figcaption>
              </figure>
            </AnimatedContent>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Pricing() {
  return (
    <section className="nb-section" id="pricing" aria-labelledby="nb-pricing-title">
      <div className="nb-container">
        <p className="nb-kicker" data-animate>Pricing</p>
        <h2 className="nb-h2" id="nb-pricing-title" data-animate>
          Start free, scale when it works
        </h2>
        <div className="nb-cards-grid nb-pricing-grid">
          {TIERS.map((tier) => (
            <AnimatedContent key={tier.name} distance={50} duration={0.7} className="nb-card-cell">
              <article
                className={`nb-card nb-price-card${tier.featured ? ' is-featured' : ''}`}
                data-reveal
                data-hover-lift
                aria-label={`${tier.name} plan`}
              >
                {tier.featured && <p className="nb-flag">Most popular</p>}
                <h3 className="nb-h3">{tier.name}</h3>
                <p className="nb-price">
                  <span className="nb-price-amount">{tier.price}</span>
                  <span className="nb-price-cadence">{tier.cadence}</span>
                </p>
                <p className="nb-body nb-price-blurb">{tier.blurb}</p>
                <ul className="nb-price-list">
                  {tier.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <a
                  className={`nb-btn ${tier.featured ? 'nb-btn-primary' : 'nb-btn-ghost'} nb-btn-block`}
                  href="#faq"
                  aria-label={`${tier.cta} — ${tier.name} plan`}
                >
                  {tier.cta}
                </a>
              </article>
            </AnimatedContent>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Faq() {
  return (
    <section className="nb-section nb-alt" id="faq" aria-labelledby="nb-faq-title">
      <div className="nb-container nb-faq-wrap">
        <p className="nb-kicker" data-animate>FAQ</p>
        <h2 className="nb-h2" id="nb-faq-title" data-animate>Questions, answered</h2>
        <div className="nb-faq-list" data-reveal>
          {FAQS.map((item, i) => (
            <details className="nb-faq-item" key={item.q} open={i === 0}>
              <summary className="nb-faq-q">
                {item.q}
                <span className="nb-faq-chevron" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </span>
              </summary>
              <p className="nb-faq-a">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

export function ClosingCta() {
  return (
    <section className="nb-section nb-cta" aria-labelledby="nb-cta-title">
      <div className="nb-container nb-cta-inner">
        {/* BEAN GSAP pattern: text-reveal (word spans, aria-label kept) */}
        <h2 className="nb-h2 nb-cta-title" data-text-reveal id="nb-cta-title">
          Ship your next model on Nebula
        </h2>
        <p className="nb-lede" data-animate>Free tier, no credit card, five-minute setup.</p>
        <div className="nb-hero-actions" data-animate>
          <a className="nb-btn nb-btn-primary nb-btn-lg" href="#pricing">Start building</a>
          <a className="nb-btn nb-btn-ghost nb-btn-lg" href="#faq">Read the FAQ</a>
        </div>
      </div>
    </section>
  )
}

export function SiteFooter() {
  return (
    <footer className="nb-footer">
      <div className="nb-container nb-footer-grid">
        <div className="nb-footer-brand">
          <p className="nb-brand">
            <span className="nb-brand-mark" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="12" cy="12" r="4.2" fill="currentColor" />
              </svg>
            </span>
            Nebula
          </p>
          <p className="nb-body nb-footer-note">
            Sample marketing site generated for output validation. Product, people
            and figures are fictional.
          </p>
        </div>
        <nav className="nb-footer-col" aria-label="Product">
          <h3 className="nb-footer-h">Product</h3>
          <a href="#features">Features</a>
          <a href="#showcase">Showcase</a>
          <a href="#pricing">Pricing</a>
        </nav>
        <nav className="nb-footer-col" aria-label="Resources">
          <h3 className="nb-footer-h">Resources</h3>
          <a href="#faq">FAQ</a>
          <a href="#testimonials">Customers</a>
          <a href="#main">Back to top</a>
        </nav>
      </div>
      <div className="nb-container nb-footer-base">
        <p>© 2026 Nebula (fictional). Generated as a validation artifact.</p>
      </div>
    </footer>
  )
}
