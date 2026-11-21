import type { ReactElement } from 'react'
import Dock from '../components/kit/Dock'

const NAV = [
  { id: 'overview', label: 'Overview', href: '#overview' },
  { id: 'traffic', label: 'Traffic', href: '#traffic' },
  { id: 'reports', label: 'Reports', href: '#reports' },
]

const ICONS: Record<string, ReactElement> = {
  overview: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  traffic: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 12h4l2-5 4 10 2-5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  reports: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 4h14v16H5z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 9h8M8 13h8M8 17h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
}

export default function SideNav({
  active,
  onNavigate,
}: {
  active: string
  onNavigate: (id: string) => void
}) {
  const go = (id: string, href: string) => () => {
    onNavigate(id)
    document.querySelector(href)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const items = NAV.map((n) => ({
    icon: ICONS[n.id],
    label: n.label,
    active: active === n.id,
    onClick: go(n.id, n.href),
  }))
  return (
    <>
      {/* Desktop: vertical dock on the left edge (display-controlled in CSS) */}
      <div className="pl-sidenav-desktop">
        <nav aria-label="Primary">
          <Dock items={items} position="left" theme="dark" baseItemSize={44} magnification={62} />
        </nav>
      </div>
      {/* Mobile: the same navigation docked to the bottom edge */}
      <div className="pl-sidenav-mobile">
        <nav aria-label="Primary (mobile)">
          <Dock items={items} position="bottom" theme="dark" baseItemSize={44} magnification={58} />
        </nav>
      </div>
    </>
  )
}
