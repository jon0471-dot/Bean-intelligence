'use client'

/**
 * BEAN Intelligence — application shell: sidebar navigation + topbar.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BeanMark } from './landing'
import { BeanUser } from './shared'
import { RiisheIcon } from '@/components/riishe/RiisheIcon'
import {
  LayoutDashboard,
  Image as ImageIcon,
  Video,
  Code2,
  BarChart3,
  Settings,
  ShieldCheck,
  FolderKey,
  LogOut,
  Menu,
  X,
} from 'lucide-react'

export type ViewId =
  | 'dashboard'
  | 'riishe'
  | 'laxii'
  | 'jazmii'
  | 'code-giftz'
  | 'portal'
  | 'usage'
  | 'settings'
  | 'admin'

const NAV: Array<{ id: ViewId; label: string; icon: React.ElementType; group: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Platform' },
  { id: 'riishe', label: 'RIISHE', icon: RiisheIcon, group: 'Products' },
  { id: 'laxii', label: 'LAXII', icon: ImageIcon, group: 'Products' },
  { id: 'jazmii', label: 'JAZMII', icon: Video, group: 'Products' },
  { id: 'code-giftz', label: 'CODE GIFTZ', icon: Code2, group: 'Products' },
  { id: 'portal', label: 'Developer portal', icon: FolderKey, group: 'Account' },
  { id: 'usage', label: 'Usage & quotas', icon: BarChart3, group: 'Account' },
  { id: 'settings', label: 'Settings', icon: Settings, group: 'Account' },
]

export function Shell({
  user,
  view,
  onNavigate,
  onSignOut,
  children,
}: {
  user: BeanUser
  view: ViewId
  onNavigate: (v: ViewId) => void
  onSignOut: () => void
  children: React.ReactNode
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const nav = user.role === 'admin' ? [...NAV, { id: 'admin' as ViewId, label: 'Admin', icon: ShieldCheck, group: 'Account' }] : NAV
  const groups = ['Platform', 'Products', 'Account']

  const sidebar = (
    <div className="flex h-full flex-col">
      <button className="flex items-center gap-3 px-5 py-5 text-left" onClick={() => onNavigate('dashboard')}>
        <BeanMark className="h-8 w-8" />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-[0.22em] bean-gold-text">BEAN</div>
          <div className="text-[10px] tracking-[0.3em] text-white/45">INTELLIGENCE</div>
        </div>
      </button>

      <nav className="bean-scroll flex-1 overflow-y-auto px-3 pb-4" aria-label="Primary">
        {groups.map((g) => (
          <div key={g} className="mb-4">
            <div className="mb-1.5 px-2 text-[10px] font-medium tracking-[0.18em] text-white/30">{g.toUpperCase()}</div>
            <div className="space-y-0.5">
              {nav.filter((n) => n.group === g).map((n) => (
                <button
                  key={n.id}
                  onClick={() => { onNavigate(n.id); setMobileOpen(false) }}
                  aria-current={view === n.id ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors',
                    view === n.id
                      ? 'bg-[rgba(212,175,55,0.12)] text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.22)]'
                      : 'text-white/55 hover:bg-white/5 hover:text-white/85',
                  )}
                >
                  <n.icon className="h-4 w-4" />
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-[rgba(212,175,55,0.12)] p-4">
        <div className="mb-2 truncate text-xs font-medium text-white/75">{user.name ?? user.email}</div>
        <div className="mb-3 text-[11px] text-white/35">
          {user.role === 'admin' ? 'Administrator' : 'Member'}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onSignOut}
          className="w-full justify-start border-white/10 bg-transparent text-white/60 hover:bg-white/5 hover:text-white/85"
        >
          <LogOut className="mr-2 h-3.5 w-3.5" /> Sign out
        </Button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-[rgba(212,175,55,0.12)] bg-[#0d0d10] lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-[rgba(212,175,55,0.15)] bg-[#0d0d10]">
            <button className="absolute right-3 top-4 text-white/50" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
              <X className="h-5 w-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-[rgba(212,175,55,0.12)] bg-[#0a0a0c]/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setMobileOpen(true)} aria-label="Open navigation" className="text-white/70">
            <Menu className="h-5 w-5" />
          </button>
          <BeanMark className="h-6 w-6" />
          <span className="text-xs font-semibold tracking-[0.2em] bean-gold-text">BEAN</span>
        </header>
        <main className="min-w-0 flex-1">
          {children}
        </main>
        <footer className="mt-auto border-t border-[rgba(212,175,55,0.08)] px-6 py-3 text-center text-[10px] text-white/25">
          BEAN Intelligence · products owned by BEAN · inference by authorized backends
        </footer>
      </div>
    </div>
  )
}
