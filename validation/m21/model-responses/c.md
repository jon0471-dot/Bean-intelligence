<!-- M21 model-role response for project C (verbatim record of the response
     that the product pipeline parses with parseFiles). Consumed context:
     CODE GIFTZ SYSTEM_PROMPT + the engine brief at
     validation/m21/project-c-portfolio/plan/brief.md + the user request. -->

Here's your multi-page developer portfolio for the fictional developer "Nova Reyes" — five routes (Home, About, Projects, project detail, Contact) wired through a dependency-free hash router with real anchor links, the attached kit components (SplitText + BlurText for animated typography, SpotlightCard + GlareHover for the interactive project cards, Dock as the quick-nav), and the brief's GSAP patterns (entrance timeline, batched scroll reveal, text reveal, hover lift). Everything is offline-capable, responsive, and keyboard-accessible.

```html path=index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Nova Reyes — fictional developer portfolio generated as a code deliverable." />
    <title>Nova Reyes — developer portfolio (sample)</title>
  </head>
  <body>
    <a class="pf-skip-link" href="#main">Skip to main content</a>
    <div id="root"></div>
    <noscript>Nova Reyes portfolio — this demo requires JavaScript.</noscript>
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
if (!container) throw new Error('Portfolio: #root container missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

```ts path=data/projects.ts
// SAMPLE CONTENT — fictional projects for a fictional developer.
export interface Project {
  slug: string
  title: string
  year: string
  blurb: string
  role: string
  stack: string[]
  highlights: string[]
  accent: string
}

export const PROJECTS: Project[] = [
  {
    slug: 'atlas-maps',
    title: 'Atlas Maps',
    year: '2025',
    blurb: 'Offline-first trail mapping app with vector tiles and turn-by-turn voice cues.',
    role: 'Lead frontend engineer',
    stack: ['TypeScript', 'React', 'WebGL', 'IndexedDB'],
    highlights: [
      'Vector-tile renderer holding 60 fps on mid-range phones',
      'Full offline mode with background tile prefetch',
      'Voice guidance engine in 9 languages',
    ],
    accent: '#7dd3fc',
  },
  {
    slug: 'ledgerlight',
    title: 'LedgerLight',
    year: '2024',
    blurb: 'Personal finance dashboard that parses bank exports locally — nothing leaves the device.',
    role: 'Design engineer',
    stack: ['React', 'Web Workers', 'D3', 'CSS'],
    highlights: [
      'CSV/OFX parser running in a worker at 40k rows/s',
      'Zero-server architecture: data never uploaded',
      'Accessible charts with sonification fallback',
    ],
    accent: '#a78bfa',
  },
  {
    slug: 'fieldnotes',
    title: 'FieldNotes',
    year: '2024',
    blurb: 'Collaborative research notebook with conflict-free sync and handwriting capture.',
    role: 'Founding engineer',
    stack: ['TypeScript', 'CRDTs', 'Canvas', 'Node'],
    highlights: [
      'CRDT merge layer surviving 30-day offline periods',
      'Pressure-sensitive ink capture on stylus devices',
      'Full-text search across 10k handwritten notes',
    ],
    accent: '#34d399',
  },
  {
    slug: 'signalgrid',
    title: 'SignalGrid',
    year: '2023',
    blurb: 'Status-page and incident tooling for small teams, from paging to postmortem.',
    role: 'Frontend engineer',
    stack: ['React', 'WebSocket', 'Tailwind'],
    highlights: [
      'Sub-second incident propagation over WebSocket fanout',
      'Postmortem builder with timeline replay',
      '99.98% uptime across its own status page',
    ],
    accent: '#fbbf24',
  },
]

export function projectBySlug(slug: string): Project | undefined {
  return PROJECTS.find((p) => p.slug === slug)
}
```

```tsx path=App.tsx
import { useEffect, useRef, useState } from 'react'
import Home from './pages/home'
import About from './pages/about'
import Projects from './pages/projects'
import ProjectDetail from './pages/project-detail'
import Contact from './pages/contact'
import NotFound from './pages/not-found'
import QuickNav from './components/quick-nav'
import { useEntranceTimeline } from './lib/motion'

export type Route =
  | { page: 'home' }
  | { page: 'about' }
  | { page: 'projects' }
  | { page: 'project'; slug: string }
  | { page: 'contact' }
  | { page: 'not-found' }

/** Dependency-free hash router: '#/projects/atlas-maps' → route object. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\/+|\/+$/g, '')
  if (path === '') return { page: 'home' }
  if (path === 'about') return { page: 'about' }
  if (path === 'projects') return { page: 'projects' }
  if (path === 'contact') return { page: 'contact' }
  const detail = /^projects\/([\w-]+)$/.exec(path)
  if (detail) return { page: 'project', slug: detail[1] }
  return { page: 'not-found' }
}

export default function App() {
  const root = useRef<HTMLDivElement>(null)
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // New page: announce it, scroll to top, focus the main landmark.
  const pageKey =
    route.page === 'project' ? `project:${route.slug}` : route.page
  useEffect(() => {
    window.scrollTo(0, 0)
    const main = document.getElementById('main')
    main?.focus({ preventScroll: true })
  }, [pageKey])

  // BEAN GSAP pattern: entrance-timeline on each page's [data-animate] set.
  useEntranceTimeline(root)

  return (
    <div className="pf-page" ref={root}>
      <header className="pf-header">
        <div className="pf-container pf-header-inner">
          <a className="pf-brand" href="#/" aria-label="Nova Reyes — home">
            <span className="pf-brand-mark" aria-hidden="true">NR</span>
            Nova Reyes
          </a>
          <nav className="pf-nav" aria-label="Primary">
            <a href="#/" aria-current={route.page === 'home' ? 'page' : undefined}>Home</a>
            <a href="#/about" aria-current={route.page === 'about' ? 'page' : undefined}>About</a>
            <a href="#/projects" aria-current={route.page === 'projects' || route.page === 'project' ? 'page' : undefined}>Projects</a>
            <a href="#/contact" aria-current={route.page === 'contact' ? 'page' : undefined}>Contact</a>
          </nav>
        </div>
      </header>

      <main id="main" tabIndex={-1} key={pageKey} className="pf-main">
        {route.page === 'home' && <Home />}
        {route.page === 'about' && <About />}
        {route.page === 'projects' && <Projects />}
        {route.page === 'project' && <ProjectDetail slug={route.slug} />}
        {route.page === 'contact' && <Contact />}
        {route.page === 'not-found' && <NotFound />}
      </main>

      <footer className="pf-footer">
        <div className="pf-container pf-footer-inner">
          <p>© 2026 Nova Reyes (fictional). Sample portfolio generated for output validation.</p>
          <nav aria-label="Footer">
            <a href="#/">Home</a>
            <a href="#/projects">Projects</a>
            <a href="#/contact">Contact</a>
          </nav>
        </div>
      </footer>

      <QuickNav />
    </div>
  )
}
```

```tsx path=components/quick-nav.tsx
import Dock from '../components/kit/Dock'

// Quick-nav dock (the engine-selected kit component): mirrors the primary
// navigation as a bottom dock on small screens and a floating shortcut on
// desktop. Items navigate with the same hash routes — one source of truth.
export default function QuickNav() {
  const go = (hash: string) => () => {
    window.location.hash = hash
  }
  return (
    <div className="pf-quicknav">
      <nav aria-label="Quick navigation">
        <Dock
          items={[
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9z" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              ),
              label: 'Home',
              onClick: go('#/'),
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              ),
              label: 'About',
              onClick: go('#/about'),
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                  <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              ),
              label: 'Projects',
              onClick: go('#/projects'),
            },
            {
              icon: (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.6" />
                </svg>
              ),
              label: 'Contact',
              onClick: go('#/contact'),
            },
          ]}
          position="bottom"
          theme="dark"
          baseItemSize={46}
          magnification={60}
        />
      </nav>
    </div>
  )
}
```

```tsx path=pages/home.tsx
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
```

```tsx path=pages/about.tsx
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
```

```tsx path=pages/projects.tsx
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
```

```tsx path=pages/project-detail.tsx
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
```

```tsx path=pages/contact.tsx
import { useState, type FormEvent } from 'react'
import SplitText from '../components/kit/SplitText'

export default function Contact() {
  const [sent, setSent] = useState(false)
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // Sample portfolio: there is no backend to submit to — say so honestly.
    setSent(true)
  }
  return (
    <article className="pf-section">
      <div className="pf-container pf-narrow">
        <SplitText
          tag="h1"
          text="Contact"
          className="pf-page-title"
          splitType="chars"
          delay={70}
          duration={0.9}
          trigger="load"
          textAlign="left"
        />
        <p className="pf-lede" data-animate>
          Sample contact form — submitting shows the confirmation state; no
          message is sent anywhere.
        </p>
        {sent ? (
          <div className="pf-card pf-sent" role="status" data-animate>
            <h2 className="pf-h2">Message “sent”</h2>
            <p className="pf-body">
              This demo records nothing and sends nothing — in a real
              portfolio this form would reach Nova by email.
            </p>
            <button type="button" className="pf-btn pf-btn-ghost" onClick={() => setSent(false)}>
              Write another
            </button>
          </div>
        ) : (
          <form className="pf-form" onSubmit={onSubmit} data-animate>
            <label className="pf-field">
              <span>Name</span>
              <input name="name" type="text" required autoComplete="name" />
            </label>
            <label className="pf-field">
              <span>Email</span>
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <label className="pf-field">
              <span>Message</span>
              <textarea name="message" rows={5} required />
            </label>
            <button type="submit" className="pf-btn pf-btn-primary">Send message</button>
          </form>
        )}
      </div>
    </article>
  )
}
```

```tsx path=pages/not-found.tsx
import SplitText from '../components/kit/SplitText'

export default function NotFound() {
  return (
    <article className="pf-section">
      <div className="pf-container pf-narrow pf-notfound">
        <SplitText
          tag="h1"
          text="Page not found"
          className="pf-page-title"
          splitType="words"
          delay={60}
          trigger="load"
          textAlign="center"
        />
        <p className="pf-lede" style={{ textAlign: 'center' }}>
          That route does not exist in this sample portfolio.
        </p>
        <p style={{ textAlign: 'center' }}>
          <a className="pf-btn pf-btn-primary" href="#/">Back home</a>
        </p>
      </div>
    </article>
  )
}
```

```ts path=lib/motion.ts
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
```

```css path=styles.css
/* Nova Reyes — sample portfolio (pf- namespace, elegant dark) */
:root {
  --pf-bg: #0a0b10;
  --pf-bg-soft: #101219;
  --pf-card: #141722;
  --pf-line: rgba(167, 139, 250, 0.2);
  --pf-text: #ecedf8;
  --pf-muted: #a3a8c3;
  --pf-accent: #a78bfa;
  --pf-accent-2: #7dd3fc;
  --pf-radius: 16px;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: var(--pf-bg); color: var(--pf-text); line-height: 1.65; -webkit-font-smoothing: antialiased; }
:focus-visible { outline: 2px solid var(--pf-accent-2); outline-offset: 3px; border-radius: 6px; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
.pf-skip-link { position: absolute; left: 12px; top: -48px; z-index: 100; background: var(--pf-accent); color: #0a0b10; padding: 10px 16px; border-radius: 10px; font-weight: 700; text-decoration: none; transition: top 0.2s ease; }
.pf-skip-link:focus { top: 12px; }
.pf-container { width: min(1080px, 92vw); margin-inline: auto; }
.pf-narrow { width: min(760px, 92vw); }
.pf-main { min-height: 70vh; outline: none; }

/* Header + nav (real anchor links, responsive wrap) */
.pf-header { position: sticky; top: 0; z-index: 50; background: rgba(10, 11, 16, 0.86); backdrop-filter: blur(14px); border-bottom: 1px solid rgba(167, 139, 250, 0.14); }
.pf-header-inner { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 0; flex-wrap: wrap; }
.pf-brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 700; color: var(--pf-text); text-decoration: none; letter-spacing: -0.01em; }
.pf-brand-mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, var(--pf-accent), var(--pf-accent-2)); color: #0a0b10; font-size: 0.82rem; font-weight: 800; }
.pf-nav { display: flex; gap: 6px; flex-wrap: wrap; }
.pf-nav a { color: var(--pf-muted); text-decoration: none; font-size: 0.94rem; padding: 7px 12px; border-radius: 9px; }
.pf-nav a:hover { color: var(--pf-text); background: rgba(167, 139, 250, 0.1); }
.pf-nav a[aria-current="page"] { color: var(--pf-text); background: rgba(167, 139, 250, 0.16); font-weight: 600; }

/* Hero */
.pf-hero { position: relative; }
.pf-hero-inner { display: grid; justify-items: center; text-align: center; gap: 16px; padding: clamp(64px, 9vw, 130px) 0 clamp(56px, 7vw, 110px); }
.pf-hero-title { font-size: clamp(2rem, 1.3rem + 3.4vw, 3.6rem); line-height: 1.08; letter-spacing: -0.03em; margin: 0; max-width: 24ch; }
.pf-hero-sub { color: var(--pf-muted); font-size: clamp(1rem, 0.95rem + 0.4vw, 1.18rem); max-width: 56ch; margin: 0; }
.pf-hero-actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.pf-hero-status { color: var(--pf-accent-2); font-size: 0.9rem; margin: 4px 0 0; }
.pf-eyebrow-text { color: var(--pf-accent-2); font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; font-size: 0.78rem; margin: 0; }

/* Sections + cards */
.pf-section { padding: clamp(40px, 5vw, 80px) 0; }
.pf-page-title { font-size: clamp(1.9rem, 1.4rem + 2.4vw, 3rem); line-height: 1.1; letter-spacing: -0.03em; margin: 6px 0 14px; }
.pf-h2 { font-size: clamp(1.25rem, 1.1rem + 0.7vw, 1.6rem); margin: 30px 0 14px; letter-spacing: -0.01em; }
.pf-h3 { font-size: 1.08rem; margin: 0 0 8px; }
.pf-lede { color: var(--pf-muted); font-size: 1.03rem; max-width: 60ch; margin: 0 0 22px; }
.pf-body { color: var(--pf-muted); margin: 0; font-size: 0.97rem; }
.pf-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.pf-cards-2 { grid-template-columns: repeat(2, 1fr); }
@media (max-width: 940px) { .pf-cards, .pf-cards-2 { grid-template-columns: 1fr; } }
.pf-cards > * { min-width: 0; }
.pf-card-cell { height: 100%; }
.pf-project-link { display: flex; flex-direction: column; gap: 8px; height: 100%; padding: 22px; color: inherit; text-decoration: none; border-radius: var(--pf-radius); }
.pf-project-year { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
.pf-project-more { margin-top: auto; padding-top: 10px; color: var(--pf-accent-2); font-size: 0.9rem; font-weight: 600; }
.pf-project-tile { position: relative; overflow: hidden; }
.pf-project-swatch { position: absolute; inset: 0 0 auto 0; height: 4px; opacity: 0.85; }
.pf-stack { color: var(--pf-muted); font-size: 0.8rem; letter-spacing: 0.02em; margin: 0; }
.pf-stack-lg { font-size: 0.95rem; }
.pf-section-foot { margin: 22px 0 0; }
.pf-textlink { color: var(--pf-accent-2); font-weight: 600; text-decoration: none; }
.pf-textlink:hover { text-decoration: underline; }

/* About */
.pf-scrollreveal { font-size: 1.05rem; color: var(--pf-text); max-width: 62ch; margin: 8px 0 10px; }
.pf-timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; }
.pf-timeline li { border-left: 2px solid var(--pf-line); padding-left: 16px; }
.pf-timeline-year { color: var(--pf-accent); font-weight: 700; font-size: 0.86rem; letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 4px; }
.pf-list { color: var(--pf-muted); display: grid; gap: 8px; }

/* Detail */
.pf-breadcrumb { margin: 0 0 10px; }
.pf-breadcrumb a { color: var(--pf-muted); text-decoration: none; font-size: 0.9rem; }
.pf-breadcrumb a:hover { color: var(--pf-text); }
.pf-detail-block { margin: 26px 0; }

/* Contact */
.pf-form { display: grid; gap: 14px; max-width: 520px; }
.pf-field { display: grid; gap: 6px; font-size: 0.9rem; color: var(--pf-muted); }
.pf-field input, .pf-field textarea { background: var(--pf-card); border: 1px solid var(--pf-line); border-radius: 10px; color: var(--pf-text); padding: 11px 13px; font: inherit; }
.pf-field input:focus-visible, .pf-field textarea:focus-visible { outline: 2px solid var(--pf-accent-2); }
.pf-sent { padding: 26px; display: grid; gap: 10px; justify-items: start; }

/* Quick-nav dock placement */
.pf-quicknav { position: fixed; inset-inline: 0; bottom: 10px; display: flex; justify-content: center; z-index: 60; pointer-events: none; }
.pf-quicknav > * { pointer-events: auto; }

/* Footer */
.pf-footer { border-top: 1px solid rgba(167, 139, 250, 0.14); background: var(--pf-bg-soft); padding: 30px 0; margin-bottom: 74px; }
.pf-footer-inner { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.pf-footer p { margin: 0; color: var(--pf-muted); font-size: 0.85rem; }
.pf-footer nav { display: flex; gap: 14px; }
.pf-footer nav a { color: var(--pf-muted); text-decoration: none; font-size: 0.88rem; }
.pf-footer nav a:hover { color: var(--pf-text); }

/* Buttons */
.pf-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 20px; border-radius: 12px; font-weight: 600; font-size: 0.95rem; text-decoration: none; cursor: pointer; border: 1px solid transparent; transition: transform 0.15s ease, background 0.15s ease; }
.pf-btn-primary { background: linear-gradient(135deg, var(--pf-accent), var(--pf-accent-2)); color: #0a0b10; }
.pf-btn-primary:hover { transform: translateY(-1px); }
.pf-btn-ghost { border-color: var(--pf-line); color: var(--pf-text); background: rgba(255, 255, 255, 0.02); }
.pf-btn-ghost:hover { background: rgba(167, 139, 250, 0.12); }
```

Navigation is real anchor-link routing (hash-based, dependency-free), each route is a complete page, and the Dock quick-nav mirrors the same routes at the bottom edge. Run it with your preferred bundler — the attached `package.json` carries the pinned dependencies.

<!-- end of M21 model-role response for project C -->
