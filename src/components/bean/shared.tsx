'use client'

/**
 * BEAN Intelligence — shared frontend utilities and atoms.
 * The client NEVER sees upstream model metadata: /api/products exposes
 * BEAN product identity only.
 */
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface BeanUser {
  id: string
  email: string
  name: string | null
  role: 'member' | 'admin'
}

export interface BeanProductPublic {
  id: string
  name: string
  tagline: string
  description: string
  task: string
  accent: string
  icon: string
  available: boolean
}

export interface ApiErrorShape {
  code: string
  message: string
  detail?: string
}

/** Typed fetch for the BEAN API envelope. */
export async function beanFetch<T>(
  url: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, ...rest } = init ?? {}
  const res = await fetch(url, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) {
    // A 401 means the server no longer recognizes this session. Announce it
    // so the app shell drops the (now stale) local identity and returns to
    // the sign-in view — sidebar identity and server identity stay in sync.
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('bean:unauthorized'))
    }
    const err: ApiErrorShape = data?.error ?? {
      code: 'INTERNAL_ERROR',
      message: `Request failed (${res.status})`,
    }
    const e = new Error(err.message) as Error & { code?: string }
    e.code = err.code
    throw e
  }
  return data as T
}

export function useSession() {
  const [user, setUser] = useState<BeanUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const d = await beanFetch<{ user: BeanUser | null }>('/api/auth/session')
      setUser(d.user)
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { user, loading, refresh, setUser }
}

export function GoldBadge({
  children,
  tone = 'gold',
}: {
  children: React.ReactNode
  tone?: 'gold' | 'green' | 'red' | 'neutral'
}) {
  const styles: Record<string, string> = {
    gold: 'border-[rgba(212,175,55,0.4)] text-[#f0c75e] bg-[rgba(212,175,55,0.08)]',
    green: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10',
    red: 'border-red-500/40 text-red-300 bg-red-500/10',
    neutral: 'border-white/15 text-white/70 bg-white/5',
  }
  return (
    <Badge variant="outline" className={`${styles[tone]} font-medium tracking-wide`}>
      {children}
    </Badge>
  )
}

export function StatusDot({ ok, pulse = false }: { ok: boolean; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span
        className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-400'} ${
          pulse ? 'bean-pulse' : ''
        }`}
      />
    </span>
  )
}

export function Markdown({
  content,
  components,
}: {
  content: string
  components?: React.ComponentProps<typeof ReactMarkdown>['components']
}) {
  return (
    <div className="bean-prose text-[14.5px] text-white/88">
      {/* remark-gfm: real markdown tables, task lists and strikethrough */}
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-[rgba(212,175,55,0.25)] border-t-[#d4af37] ${className}`}
      aria-label="Loading"
    />
  )
}

export function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="text-[#d4af37]/60">{icon}</div>
      <div className="text-sm font-medium text-white/80">{title}</div>
      {hint ? <div className="max-w-sm text-xs text-white/45">{hint}</div> : null}
    </div>
  )
}

export function timeAgo(iso: string | Date): string {
  const t = typeof iso === 'string' ? new Date(iso) : iso
  const s = Math.floor((Date.now() - t.getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
