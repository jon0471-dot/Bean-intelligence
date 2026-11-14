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
