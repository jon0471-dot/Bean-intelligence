'use client'

/**
 * BEAN Intelligence — usage & quotas view.
 * Shows ACTUAL recorded usage. Token counts are labeled estimates because
 * the gateway does not report exact usage; cost is always shown as
 * "not reported" — BEAN never invents cost data.
 */
import { useEffect, useState } from 'react'
import { beanFetch, GoldBadge, Spinner, timeAgo } from './shared'
import { Progress } from '@/components/ui/progress'
import { BarChart3 } from 'lucide-react'

interface Agg { requests: number; successes: number; failures: number; tokensIn: number; tokensOut: number; images: number; totalDurationMs: number }
interface Quota { used: number; limit: number }
interface Recent { id: string; product: string; kind: string; success: boolean; tokensIn: number | null; tokensOut: number | null; imageCount: number | null; durationMs: number | null; errorCode: string | null; createdAt: string }

const PRODUCT_LABELS: Record<string, string> = {
  riishe: 'RIISHE', laxii: 'LAXII', jazmii: 'JAZMII', 'code-giftz': 'CODE GIFTZ',
}

export function Usage() {
  const [data, setData] = useState<{ byProduct: Record<string, Agg>; quotas: Record<string, Quota>; recent: Recent[]; note: string } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        setData(await beanFetch('/api/usage'))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) {
    return <div className="flex h-64 items-center justify-center"><Spinner className="h-6 w-6" /></div>
  }
  if (!data) return <div className="p-6 text-sm text-white/50">Usage could not be loaded.</div>

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-[#d4af37]" />
        <h1 className="text-xl font-semibold tracking-tight">Usage & quotas</h1>
      </div>

      <div className="bean-glass mb-6 rounded-xl p-4 text-xs leading-relaxed text-white/45">{data.note}</div>

      {/* Quotas */}
      <h2 className="mb-3 text-sm font-semibold text-white/80">Daily quotas (resets at midnight)</h2>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(data.quotas).map(([product, q]) => (
          <div key={product} className="bean-glass rounded-xl p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold tracking-wide">{PRODUCT_LABELS[product] ?? product}</span>
              <span className="text-[11px] text-white/40">{q.used} / {q.limit}</span>
            </div>
            <Progress value={q.limit > 0 ? Math.min(100, (q.used / q.limit) * 100) : 100} className="h-1.5 bg-white/5" />
            {q.limit === 0 ? <p className="mt-2 text-[10px] text-amber-300/80">Product unavailable — quota closed</p> : null}
          </div>
        ))}
      </div>

      {/* By product */}
      <h2 className="mb-3 text-sm font-semibold text-white/80">Actual usage</h2>
      <div className="bean-glass mb-8 overflow-x-auto rounded-xl">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-[rgba(212,175,55,0.12)] text-[11px] uppercase tracking-wider text-white/40">
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Requests</th>
              <th className="px-4 py-3">Success</th>
              <th className="px-4 py-3">Failed</th>
              <th className="px-4 py-3">Tokens (est.)</th>
              <th className="px-4 py-3">Images</th>
              <th className="px-4 py-3">Compute time</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.byProduct).length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-white/35">No usage recorded yet.</td></tr>
            ) : (
              Object.entries(data.byProduct).map(([product, a]) => (
                <tr key={product} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 font-medium text-white/80">{PRODUCT_LABELS[product] ?? product}</td>
                  <td className="px-4 py-3">{a.requests}</td>
                  <td className="px-4 py-3 text-emerald-300/90">{a.successes}</td>
                  <td className="px-4 py-3 text-red-300/80">{a.failures}</td>
                  <td className="px-4 py-3">{a.tokensIn + a.tokensOut > 0 ? `≈ ${(a.tokensIn + a.tokensOut).toLocaleString()}` : '—'}</td>
                  <td className="px-4 py-3">{a.images || '—'}</td>
                  <td className="px-4 py-3">{a.totalDurationMs > 0 ? `${(a.totalDurationMs / 1000).toFixed(1)}s` : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Recent */}
      <h2 className="mb-3 text-sm font-semibold text-white/80">Recent activity</h2>
      <div className="bean-glass divide-y divide-white/5 rounded-xl">
        {data.recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-white/35">Nothing yet — try RIISHE or LAXII.</p>
        ) : (
          data.recent.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-3 text-[13px]">
              <div className="flex items-center gap-3">
                <GoldBadge tone={r.success ? 'green' : 'red'}>{r.success ? 'success' : (r.errorCode ?? 'failure')}</GoldBadge>
                <span className="text-white/70">{PRODUCT_LABELS[r.product] ?? r.product}</span>
                <span className="text-white/35">{r.kind}</span>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-white/35">
                {r.durationMs != null ? <span>{(r.durationMs / 1000).toFixed(1)}s</span> : null}
                <span>{timeAgo(r.createdAt)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
