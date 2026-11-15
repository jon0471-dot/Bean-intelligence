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
