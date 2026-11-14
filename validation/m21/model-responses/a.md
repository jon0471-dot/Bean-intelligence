<!-- M21 model-role response for project A (verbatim record of the response
     that the product pipeline parses with parseFiles). Consumed context:
     CODE GIFTZ SYSTEM_PROMPT + the engine brief at
     validation/m21/project-a-landing/plan/brief.md + the user request. -->

Here's your Nebula landing page — a complete React app using the attached kit components (SplitText, BlurText, CountUp, ScrollReveal, AnimatedContent, VantaBackground), the GSAP patterns from the brief (entrance timeline with the branded CustomEase curve, batched scroll reveal, text reveal, hover lift, desktop-only scroll scrub), and the Birds Vanta background. Everything runs offline, degrades honestly (WebGL fallback, reduced motion), and is responsive down to phone widths.

```html path=index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Nebula — the AI infrastructure platform for teams that ship. Sample marketing site generated as a code deliverable." />
    <title>Nebula — AI infrastructure for teams that ship</title>
  </head>
  <body>
    <a class="nb-skip-link" href="#main">Skip to main content</a>
    <div id="root"></div>
    <noscript>Nebula sample landing page — this demo requires JavaScript.</noscript>
    <script type="module" src="./index.tsx"></script>
  </body>
</html>
```

```tsx path=index.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Nebula: #root container missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

```tsx path=App.tsx
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
```

```tsx path=components/site-nav.tsx
import { useEffect, useState } from 'react'

const LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#showcase', label: 'Showcase' },
  { href: '#testimonials', label: 'Customers' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
]

export default function SiteNav() {
  const [open, setOpen] = useState(false)

  // Close the mobile menu on Escape for keyboard users.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className="nb-nav">
      <div className="nb-container nb-nav-inner">
        <a className="nb-brand" href="#main" aria-label="Nebula — back to top">
          <span className="nb-brand-mark" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="12" cy="12" r="4.2" fill="currentColor" />
            </svg>
          </span>
          Nebula
        </a>

        <nav className="nb-nav-links" aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="nb-nav-link" onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
        </nav>

        <a className="nb-btn nb-btn-primary nb-nav-cta" href="#pricing" onClick={() => setOpen(false)}>
          Start building
        </a>

        <button
          type="button"
          className="nb-nav-toggle"
          aria-expanded={open}
          aria-controls="nb-mobile-menu"
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            {open ? (
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            )}
          </svg>
        </button>
      </div>

      <div id="nb-mobile-menu" className={`nb-mobile-menu${open ? ' is-open' : ''}`}>
        <nav className="nb-container nb-mobile-links" aria-label="Mobile">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="nb-mobile-link" onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <a className="nb-btn nb-btn-primary nb-mobile-cta" href="#pricing" onClick={() => setOpen(false)}>
            Start building
          </a>
        </nav>
      </div>
    </header>
  )
}
```

```tsx path=components/hero.tsx
import VantaBackground from '../components/kit/VantaBackground'
import SplitText from '../components/kit/SplitText'
import BlurText from '../components/kit/BlurText'

export default function Hero() {
  return (
    <section className="nb-hero" aria-label="Nebula introduction">
      {/* Vanta Birds — the engine-attached background component handles lazy
          init, destroy on unmount, WebGL and reduced-motion fallbacks. */}
      <VantaBackground
        effect="birds"
        colors={['#8b7cf7', '#3fd0ff']}
        background="#05060b"
        speed={0.9}
        className="nb-hero-bg"
      >
        <div className="nb-container nb-hero-inner">
          <p className="nb-eyebrow" data-animate>
            <BlurText text="Now in public preview" delay={40} animateBy="words" className="nb-eyebrow-text" trigger="load" />
          </p>
          <SplitText
            tag="h1"
            text="Infrastructure that thinks at the speed of your ideas"
            className="nb-hero-title"
            splitType="words"
            delay={120}
            duration={1}
            ease="power3.out"
            trigger="load"
          />
          <p className="nb-hero-sub" data-animate>
            Nebula is the AI infrastructure platform for teams that ship —
            managed inference, vector search and evaluation pipelines behind
            one API. (Sample marketing copy for a fictional product.)
          </p>
          <div className="nb-hero-actions" data-animate>
            <a className="nb-btn nb-btn-primary nb-btn-lg" href="#pricing">
              Start building
            </a>
            <a className="nb-btn nb-btn-ghost nb-btn-lg" href="#showcase">
              See it in action
            </a>
          </div>
          <p className="nb-hero-note" data-animate>
            Free tier included · No credit card required
          </p>
        </div>
      </VantaBackground>
    </section>
  )
}
```

```tsx path=components/sections.tsx
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
```

```tsx path=components/closing.tsx
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
```

```ts path=lib/motion.ts
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

```

```css path=styles.css
/* Nebula — sample landing page styles (nb- namespace, dark theme) */
:root {
  --nb-bg: #05060b;
  --nb-bg-soft: #0b0d16;
  --nb-card: #10131f;
  --nb-line: rgba(139, 124, 247, 0.22);
  --nb-text: #eef0ff;
  --nb-muted: #a5abc9;
  --nb-brand: #8b7cf7;
  --nb-brand-2: #3fd0ff;
  --nb-radius: 16px;
  --nb-container: 1120px;
  color-scheme: dark;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: var(--nb-bg);
  color: var(--nb-text);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
img, svg { display: block; max-width: 100%; }

/* Accessibility: visible focus everywhere, skip link, reduced motion */
:focus-visible {
  outline: 2px solid var(--nb-brand-2);
  outline-offset: 3px;
  border-radius: 6px;
}
.nb-skip-link {
  position: absolute; left: 12px; top: -48px; z-index: 100;
  background: var(--nb-brand); color: #0b0d16; padding: 10px 16px;
  border-radius: 10px; font-weight: 600; text-decoration: none;
  transition: top 0.2s ease;
}
.nb-skip-link:focus { top: 12px; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}

.nb-container { width: min(var(--nb-container), 92vw); margin-inline: auto; }
.nb-page { min-height: 100vh; }

/* Type scale (fluid) */
.nb-h2 { font-size: clamp(1.7rem, 1.1rem + 2.2vw, 2.6rem); line-height: 1.15; margin: 8px 0 12px; letter-spacing: -0.02em; }
.nb-h3 { font-size: clamp(1.05rem, 0.95rem + 0.5vw, 1.25rem); margin: 0 0 8px; }
.nb-lede { color: var(--nb-muted); font-size: clamp(1rem, 0.95rem + 0.3vw, 1.15rem); max-width: 62ch; margin: 0 0 8px; }
.nb-body { color: var(--nb-muted); font-size: 0.98rem; margin: 0; }
.nb-kicker {
  text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.78rem;
  color: var(--nb-brand-2); margin: 0 0 6px; font-weight: 700;
}
.nb-sample-note { color: var(--nb-muted); font-size: 0.8rem; margin-top: 18px; }

/* Buttons */
.nb-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 8px; padding: 10px 18px; border-radius: 12px; font-weight: 600;
  font-size: 0.95rem; text-decoration: none; cursor: pointer;
  border: 1px solid transparent; transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.nb-btn-primary {
  background: linear-gradient(135deg, var(--nb-brand), var(--nb-brand-2));
  color: #070910;
}
.nb-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 10px 30px rgba(63, 208, 255, 0.25); }
.nb-btn-ghost { border-color: var(--nb-line); color: var(--nb-text); background: rgba(255, 255, 255, 0.02); }
.nb-btn-ghost:hover { background: rgba(139, 124, 247, 0.12); }
.nb-btn-lg { padding: 13px 24px; font-size: 1rem; }
.nb-btn-block { width: 100%; }

/* Navigation */
.nb-nav {
  position: sticky; top: 0; z-index: 50;
  background: rgba(5, 6, 11, 0.82);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid rgba(139, 124, 247, 0.14);
}
.nb-nav-inner { display: flex; align-items: center; gap: 20px; padding: 14px 0; }
.nb-brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; font-size: 1.1rem; color: var(--nb-text); text-decoration: none; letter-spacing: -0.01em; }
.nb-brand-mark { color: var(--nb-brand-2); display: inline-flex; }
.nb-nav-links { display: flex; gap: 22px; margin-inline: auto; }
.nb-nav-link { color: var(--nb-muted); text-decoration: none; font-size: 0.94rem; padding: 6px 2px; }
.nb-nav-link:hover { color: var(--nb-text); }
.nb-nav-toggle {
  display: none; background: transparent; color: var(--nb-text);
  border: 1px solid var(--nb-line); border-radius: 10px; padding: 8px; cursor: pointer;
}
.nb-mobile-menu { display: none; border-top: 1px solid rgba(139, 124, 247, 0.14); background: rgba(5, 6, 11, 0.97); }
.nb-mobile-menu.is-open { display: block; }
.nb-mobile-links { display: grid; gap: 4px; padding: 14px 0 18px; }
.nb-mobile-link { color: var(--nb-text); text-decoration: none; padding: 12px 6px; border-radius: 10px; font-weight: 500; }
.nb-mobile-link:hover { background: rgba(139, 124, 247, 0.12); }
.nb-mobile-cta { margin-top: 10px; }

@media (max-width: 860px) {
  .nb-nav-links, .nb-nav-cta { display: none; }
  .nb-nav-toggle { display: inline-flex; margin-left: auto; }
  .nb-mobile-menu.is-open + * { clear: both; }
}

/* Hero */
.nb-hero { position: relative; isolation: isolate; }
.nb-hero-bg { position: relative; }
.nb-hero-inner {
  display: grid; justify-items: start; gap: 18px;
  padding: clamp(72px, 10vw, 150px) 0 clamp(64px, 8vw, 120px);
}
.nb-hero-title {
  font-size: clamp(2.2rem, 1.4rem + 4vw, 4.1rem);
  line-height: 1.06; letter-spacing: -0.03em; margin: 0; max-width: 20ch;
  /* solid color: a background-clip:text gradient would break under SplitText
     word spans (words inherit color:transparent; the gradient clips to the
     parent's empty text nodes) */
  color: #eef0ff;
}
.nb-hero-sub { color: var(--nb-muted); font-size: clamp(1rem, 0.95rem + 0.4vw, 1.2rem); max-width: 58ch; margin: 0; }
.nb-hero-actions { display: flex; flex-wrap: wrap; gap: 12px; }
.nb-hero-note { color: var(--nb-muted); font-size: 0.85rem; margin: 0; }
.nb-eyebrow-text { color: var(--nb-brand-2); font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; font-size: 0.8rem; margin: 0; }

/* Stats band */
.nb-stats { border-block: 1px solid rgba(139, 124, 247, 0.14); background: var(--nb-bg-soft); padding: 26px 0 14px; }
.nb-stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.nb-stat-value { margin: 0; font-size: clamp(1.6rem, 1.2rem + 1.8vw, 2.4rem); font-weight: 700; letter-spacing: -0.02em; }
.nb-count { background: linear-gradient(120deg, var(--nb-brand), var(--nb-brand-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.nb-stat-label { color: var(--nb-muted); margin: 2px 0 0; font-size: 0.9rem; }
@media (max-width: 700px) { .nb-stats-grid { grid-template-columns: 1fr; text-align: center; } }

/* Sections */
.nb-section { padding: clamp(56px, 7vw, 104px) 0; }
.nb-alt { background: var(--nb-bg-soft); }

/* Cards */
.nb-features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 28px; }
.nb-cards-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 28px; }
.nb-card {
  background: var(--nb-card); border: 1px solid var(--nb-line);
  border-radius: var(--nb-radius); padding: 22px; height: 100%;
  display: flex; flex-direction: column; gap: 10px;
}
.nb-feature-icon {
  color: var(--nb-brand-2); width: 46px; height: 46px; border-radius: 12px;
  display: grid; place-items: center; background: rgba(63, 208, 255, 0.08);
  border: 1px solid rgba(63, 208, 255, 0.2);
}
@media (max-width: 960px) {
  .nb-features-grid, .nb-cards-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 620px) {
  .nb-features-grid, .nb-cards-grid { grid-template-columns: 1fr; }
}

/* Showcase */
.nb-showcase-grid { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: clamp(24px, 4vw, 56px); align-items: center; }
/* Grid children may shrink below their content's min size (the terminal pre
   would otherwise force the track wider than the viewport on phones). */
.nb-showcase-grid > *, .nb-features-grid > *, .nb-cards-grid > *, .nb-footer-grid > *, .nb-stats-grid > * { min-width: 0; }
.nb-terminal { max-width: 100%; }
@media (max-width: 900px) { .nb-showcase-grid { grid-template-columns: 1fr; } }
.nb-scrollreveal { font-size: 1.05rem; color: var(--nb-text); max-width: 56ch; margin: 6px 0 18px; }
.nb-scrollreveal-text { will-change: opacity, filter; }
.nb-checklist { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; color: var(--nb-muted); }
.nb-checklist li { padding-left: 26px; position: relative; }
.nb-checklist li::before {
  content: ''; position: absolute; left: 0; top: 7px; width: 14px; height: 14px;
  border-radius: 4px; background: linear-gradient(135deg, var(--nb-brand), var(--nb-brand-2));
  opacity: 0.85;
}
.nb-terminal {
  background: #070910; border: 1px solid var(--nb-line); border-radius: 14px;
  overflow: hidden; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
}
.nb-terminal-bar {
  display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  background: rgba(139, 124, 247, 0.08); border-bottom: 1px solid var(--nb-line);
}
.nb-terminal-bar span { width: 10px; height: 10px; border-radius: 50%; background: rgba(255, 255, 255, 0.16); }
.nb-terminal-bar em { margin-left: auto; font-style: normal; color: var(--nb-muted); font-size: 0.78rem; }
.nb-terminal-body { margin: 0; padding: 18px; color: #9ff0c8; font-size: 0.86rem; line-height: 1.7; overflow-x: auto; }

/* Quotes */
.nb-quote { margin: 0; font-size: 1.02rem; line-height: 1.65; color: var(--nb-text); flex: 1; }
.nb-quote-by { display: grid; gap: 2px; margin-top: 12px; font-size: 0.88rem; color: var(--nb-muted); }
.nb-quote-by strong { color: var(--nb-text); }

/* Pricing */
.nb-pricing-grid { align-items: stretch; }
.nb-price-card { position: relative; }
.nb-price-card.is-featured { border-color: var(--nb-brand); box-shadow: 0 18px 60px rgba(139, 124, 247, 0.22); }
.nb-flag {
  position: absolute; top: -12px; left: 20px; margin: 0;
  background: linear-gradient(135deg, var(--nb-brand), var(--nb-brand-2));
  color: #070910; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em;
  text-transform: uppercase; padding: 4px 10px; border-radius: 999px;
}
.nb-price { display: flex; align-items: baseline; gap: 6px; margin: 4px 0 2px; }
.nb-price-amount { font-size: 2.1rem; font-weight: 700; letter-spacing: -0.02em; }
.nb-price-cadence { color: var(--nb-muted); font-size: 0.9rem; }
.nb-price-blurb { margin-bottom: 8px; }
.nb-price-list { list-style: none; margin: 0 0 18px; padding: 0; display: grid; gap: 8px; color: var(--nb-muted); font-size: 0.92rem; flex: 1; }
.nb-price-list li { padding-left: 22px; position: relative; }
.nb-price-list li::before {
  content: '✓'; position: absolute; left: 0; color: var(--nb-brand-2); font-weight: 700;
}

/* FAQ (native details/summary — accessible by default) */
.nb-faq-wrap { max-width: 780px; }
.nb-faq-list { display: grid; gap: 12px; margin-top: 24px; }
.nb-faq-item { background: var(--nb-card); border: 1px solid var(--nb-line); border-radius: 14px; }
.nb-faq-item[open] { border-color: var(--nb-brand); }
.nb-faq-q {
  list-style: none; cursor: pointer; display: flex; align-items: center;
  justify-content: space-between; gap: 16px; padding: 16px 18px; font-weight: 600;
}
.nb-faq-q::-webkit-details-marker { display: none; }
.nb-faq-chevron { color: var(--nb-brand-2); transition: transform 0.2s ease; }
.nb-faq-item[open] .nb-faq-chevron { transform: rotate(180deg); }
.nb-faq-a { color: var(--nb-muted); padding: 0 18px 16px; margin: 0; }

/* CTA + footer */
.nb-cta { background: radial-gradient(60% 120% at 50% 0%, rgba(139, 124, 247, 0.16), transparent 70%); }
.nb-cta-inner { text-align: center; display: grid; justify-items: center; gap: 6px; }
.nb-cta-title { max-width: 22ch; margin-inline: auto; }
.nb-footer { border-top: 1px solid rgba(139, 124, 247, 0.14); background: var(--nb-bg-soft); padding: 40px 0 24px; }
.nb-footer-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 28px; }
.nb-footer-h { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--nb-muted); margin: 0 0 12px; }
.nb-footer-col { display: grid; gap: 8px; align-content: start; }
.nb-footer-col a { color: var(--nb-muted); text-decoration: none; font-size: 0.94rem; }
.nb-footer-col a:hover { color: var(--nb-text); }
.nb-footer-note { max-width: 40ch; margin-top: 10px; font-size: 0.88rem; }
.nb-footer-base { margin-top: 28px; padding-top: 16px; border-top: 1px solid rgba(139, 124, 247, 0.1); color: var(--nb-muted); font-size: 0.85rem; }
@media (max-width: 720px) {
  .nb-footer-grid { grid-template-columns: 1fr 1fr; }
  .nb-footer-brand { grid-column: 1 / -1; }
}
```

The hero runs the Birds background through the attached `VantaBackground` (it self-manages lazy init, cleanup, WebGL fallback and reduced motion); entrance/scroll/text/hover/scrub motion comes from the pattern hooks in `lib/motion.ts`. Typography, cards, pricing and FAQ are custom semantic HTML styled in `styles.css` with a fluid type scale. Run it with your preferred bundler (the attached `package.json` carries the pinned dependencies).

<!-- end of M21 model-role response for project A -->
