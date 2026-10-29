'use client'

/**
 * BEAN Intelligence — dashboard: four flagship products + live availability.
 */
import { useEffect, useState } from 'react'
import { ArrowRight, MessageSquareText, Image as ImageIcon, Video, Code2, Sparkles } from 'lucide-react'
import { beanFetch, GoldBadge, StatusDot, type BeanProductPublic } from './shared'
import { Skeleton } from '@/components/ui/skeleton'
import type { ViewId } from './shell'

const ICONS: Record<string, React.ElementType> = {
  riishe: MessageSquareText,
  laxii: ImageIcon,
  jazmii: Video,
  'code-giftz': Code2,
}

interface HealthData {
  products: Record<string, { available: boolean; probe: { detail: string; latencyMs: number | null } }>
}

export function Dashboard({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const [products, setProducts] = useState<BeanProductPublic[] | null>(null)
  const [health, setHealth] = useState<HealthData | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [p, h] = await Promise.all([
          beanFetch<{ products: BeanProductPublic[] }>('/api/products'),
          beanFetch<HealthData>('/api/health'),
        ])
        setProducts(p.products)
        setHealth(h)
      } catch {
        setProducts([])
      }
    })()
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome to <span className="bean-gold-text">BEAN Intelligence</span>
        </h1>
        <p className="mt-1.5 text-sm text-white/50">
          Four flagship products, one private routing layer. Availability below reflects measured backend probes — never assumptions.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(products ?? Array.from({ length: 4 }, () => null)).map((p, i) => {
          if (!p) return <Skeleton key={i} className="h-44 rounded-xl bg-white/5" />
          const Icon = ICONS[p.id] ?? Sparkles
          const probe = health?.products?.[p.id]
          const ok = p.available && (probe ? probe.available : true)
          return (
            <button
              key={p.id}
              onClick={() => onNavigate(p.id as ViewId)}
              className="bean-glass bean-glass-hover group rounded-xl p-5 text-left"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[rgba(212,175,55,0.25)] bg-[rgba(212,175,55,0.07)]">
                    <Icon className="h-5 w-5 text-[#d4af37]" />
                  </div>
                  <div>
                    <div className="text-[15px] font-semibold tracking-wide">{p.name}</div>
                    <div className="text-xs text-white/45">{p.tagline}</div>
                  </div>
                </div>
                {ok ? (
                  <GoldBadge tone="green"><span className="mr-1 inline-flex items-center gap-1.5"><StatusDot ok pulse={false} />Operational</span></GoldBadge>
                ) : (
                  <GoldBadge tone="red"><span className="mr-1 inline-flex items-center gap-1.5"><StatusDot ok={false} />Unavailable</span></GoldBadge>
                )}
              </div>
              <p className="mt-3 min-h-[40px] text-[13px] leading-relaxed text-white/55">{p.description}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11px] text-white/35">
                  {probe ? (probe.probe.latencyMs != null ? `probe ${probe.probe.latencyMs}ms` : 'probe —') : ''}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[#f0c75e] opacity-70 transition-opacity group-hover:opacity-100">
                  Open workspace <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <div className="bean-glass rounded-xl p-4">
          <div className="mb-1 text-xs font-semibold tracking-wide text-[#f0c75e]">Brand-owned products</div>
          <p className="text-xs leading-relaxed text-white/45">
            You select BEAN products. Upstream model selection stays private and is enforced server-side.
          </p>
        </div>
        <div className="bean-glass rounded-xl p-4">
          <div className="mb-1 text-xs font-semibold tracking-wide text-[#f0c75e]">Real status only</div>
          <p className="text-xs leading-relaxed text-white/45">
            Jobs are marked complete only when real output exists. Unavailable products say so.
          </p>
        </div>
        <div className="bean-glass rounded-xl p-4">
          <div className="mb-1 text-xs font-semibold tracking-wide text-[#f0c75e]">Metered & guarded</div>
          <p className="text-xs leading-relaxed text-white/45">
            Per-product quotas, rate limits and concurrency are enforced in the API, not the UI.
          </p>
        </div>
      </div>
    </div>
  )
}
