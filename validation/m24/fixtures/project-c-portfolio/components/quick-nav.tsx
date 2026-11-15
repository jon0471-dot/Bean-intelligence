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
