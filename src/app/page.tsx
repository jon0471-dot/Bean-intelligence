'use client'

/**
 * BEAN Intelligence — application root (single-page application).
 * All customer-facing views render here; backend services live under /api.
 */
import { useEffect, useState } from 'react'
import { Landing } from '@/components/bean/landing'
import { Shell, type ViewId } from '@/components/bean/shell'
import { Dashboard } from '@/components/bean/dashboard'
import { Riishe } from '@/components/bean/riishe'
import { Laxii } from '@/components/bean/laxii'
import { Jazmii } from '@/components/bean/jazmii'
import { CodeGiftz } from '@/components/bean/code-giftz'
import { Usage } from '@/components/bean/usage'
import { Settings } from '@/components/bean/settings'
import { Admin } from '@/components/bean/admin'
import { useSession, beanFetch, type BeanUser } from '@/components/bean/shared'
import { Spinner } from '@/components/bean/shared'

interface SizeOpt { value: string; label: string }

export default function Home() {
  const { user, loading, setUser, refresh } = useSession()
  const [view, setView] = useState<ViewId>('dashboard')
  const [sizes, setSizes] = useState<SizeOpt[]>([])
  const [booted, setBooted] = useState(false)

  // When any API call returns 401, the server no longer recognizes this
  // session (signed out elsewhere, session revoked, expired). Drop the local
  // identity so the UI never shows a signed-in shell the server disagrees
  // with — the landing view takes over.
  useEffect(() => {
    const onUnauthorized = () => setUser(null)
    window.addEventListener('bean:unauthorized', onUnauthorized)
    return () => window.removeEventListener('bean:unauthorized', onUnauthorized)
  }, [setUser])

  useEffect(() => {
    void (async () => {
      try {
        const d = await beanFetch<{ laxiiSizes: SizeOpt[] }>('/api/products')
        setSizes(d.laxiiSizes)
      } catch {
        setSizes([{ value: '1024x1024', label: 'Square 1:1' }])
      } finally {
        setBooted(true)
      }
    })()
  }, [])

  // Keep the URL hash in sync so refresh/back behave sensibly.
  useEffect(() => {
    const fromHash = window.location.hash.replace('#', '') as ViewId
    if (fromHash) setView(fromHash)
  }, [])
  useEffect(() => {
    if (user) window.location.hash = view
  }, [view, user])

  if (loading || !booted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <div className="text-lg font-semibold tracking-[0.25em] bean-gold-text">BEAN</div>
        <Spinner className="h-5 w-5" />
      </div>
    )
  }

  if (!user) {
    return (
      <Landing
        onAuthed={(u: BeanUser) => {
          setUser(u)
          setView('dashboard')
        }}
      />
    )
  }

  return (
    <Shell
      user={user}
      view={view}
      onNavigate={setView}
      onSignOut={async () => {
        await beanFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
        setUser(null)
        setView('dashboard')
      }}
    >
      {view === 'dashboard' && <Dashboard onNavigate={setView} />}
      {view === 'riishe' && <Riishe user={user} onOpenSettings={() => setView('settings')} />}
      {view === 'laxii' && <Laxii sizes={sizes} />}
      {view === 'jazmii' && <Jazmii />}
      {view === 'code-giftz' && <CodeGiftz />}
      {view === 'usage' && <Usage />}
      {view === 'settings' && <Settings user={user} onUserChanged={() => void refresh()} />}
      {view === 'admin' && user.role === 'admin' && <Admin />}
      {view === 'admin' && user.role !== 'admin' && <Dashboard onNavigate={setView} />}
    </Shell>
  )
}
