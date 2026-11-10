'use client'

/**
 * BEAN Intelligence — RESTRICTED administrative view (admin role only,
 * enforced server-side by /api/admin/overview). This is the only surface
 * where upstream provider metadata is displayed.
 */
import { useEffect, useState } from 'react'
import { beanFetch, GoldBadge, Spinner, StatusDot, timeAgo } from './shared'
import { ShieldCheck, Server, ScrollText } from 'lucide-react'

interface Backend {
  id: string
  productId: string
  task: string
  provider: string
  modelIdentity: string
  revision: string | null
  endpointType: string
  deploymentMode: string
  runtime: string
  limits: Record<string, unknown>
  license: { name: string; commercialUse: string; note: string; sourceUrl: string; verifiedAt: string }
  dataHandling: string
  metering: { unit: string; costUnit: string | null }
  fallbacks: string[]
  enabled: boolean
  unavailableReason: string | null
  concurrency: { maxInFlightPerUser: number; maxInFlightTotal: number }
  timeouts: { requestMs: number; queueMs: number }
  health: { healthy: boolean; detail: string; latencyMs: number | null }
}

interface Overview {
  backends: Backend[]
  stats: { users: number; jobs: number; usageRecords: number; totalDurationMs: number; jobStatus: Record<string, number> }
  audit: Array<{ id: string; actorId: string | null; action: string; target: string | null; createdAt: string }>
}

export function Admin() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setData(await beanFetch<Overview>('/api/admin/overview'))
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [])

  if (error) return <div className="p-6 text-sm text-red-300">{error}</div>
  if (!data) return <div className="flex h-64 items-center justify-center"><Spinner className="h-6 w-6" /></div>

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-[#d4af37]" />
        <h1 className="text-xl font-semibold tracking-tight">Admin <span className="text-white/40">— restricted diagnostics</span></h1>
      </div>

      {/* Stats */}
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Users', data.stats.users],
          ['Jobs', data.stats.jobs],
          ['Usage records', data.stats.usageRecords],
          ['Compute time', `${(data.stats.totalDurationMs / 1000).toFixed(0)}s`],
        ].map(([label, value]) => (
          <div key={label as string} className="bean-glass rounded-xl p-4">
            <div className="text-[11px] uppercase tracking-wider text-white/40">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-[#f0c75e]">{value}</div>
          </div>
        ))}
      </div>

      {/* Backends (private metadata) */}
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
        <Server className="h-4 w-4 text-[#d4af37]" /> Private backend registry
      </h2>
      <div className="mb-8 space-y-3">
        {data.backends.map((b) => (
          <div key={b.id} className="bean-glass rounded-xl p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[13px] text-[#f0c75e]">{b.id}</span>
              {b.enabled ? <GoldBadge tone="green"><StatusDot ok={b.health.healthy} /> {b.health.healthy ? 'enabled · healthy' : 'enabled · degraded'}</GoldBadge> : <GoldBadge tone="red">disabled</GoldBadge>}
              <GoldBadge tone="neutral">{b.deploymentMode}</GoldBadge>
              <GoldBadge tone="neutral">{b.endpointType}</GoldBadge>
              <GoldBadge tone={b.license.commercialUse === 'authorized' ? 'green' : 'gold'}>license: {b.license.commercialUse}</GoldBadge>
              {b.health.latencyMs != null ? <span className="text-[11px] text-white/35">probe {b.health.latencyMs}ms</span> : null}
            </div>
            <div className="grid gap-x-8 gap-y-1.5 text-[12px] leading-relaxed md:grid-cols-2">
              <div><span className="text-white/40">Product: </span><span className="text-white/75">{b.productId} · {b.task}</span></div>
              <div><span className="text-white/40">Provider: </span><span className="text-white/75">{b.provider}</span></div>
              <div className="md:col-span-2"><span className="text-white/40">Model identity: </span><span className="text-white/75">{b.modelIdentity}</span></div>
              <div className="md:col-span-2"><span className="text-white/40">Health detail: </span><span className="text-white/60">{b.health.detail}</span></div>
              <div><span className="text-white/40">Concurrency: </span><span className="text-white/75">{b.concurrency.maxInFlightPerUser}/user · {b.concurrency.maxInFlightTotal} total</span></div>
              <div><span className="text-white/40">Timeouts: </span><span className="text-white/75">request {b.timeouts.requestMs / 1000}s · queue {b.timeouts.queueMs / 1000}s</span></div>
              <div><span className="text-white/40">Metering: </span><span className="text-white/75">{b.metering.unit}{b.metering.costUnit ? ` · ${b.metering.costUnit}` : ' · cost not reported by provider'}</span></div>
              <div><span className="text-white/40">Fallbacks: </span><span className="text-white/75">{b.fallbacks.length ? b.fallbacks.join(', ') : 'none configured'}</span></div>
              <div className="md:col-span-2"><span className="text-white/40">License: </span><span className="text-white/75">{b.license.name} — verified {b.license.verifiedAt}</span></div>
              <div className="md:col-span-2"><span className="text-white/40">Data handling: </span><span className="text-white/60">{b.dataHandling}</span></div>
            </div>
          </div>
        ))}
      </div>

      {/* Audit */}
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
        <ScrollText className="h-4 w-4 text-[#d4af37]" /> Audit trail (latest 30)
      </h2>
      <div className="bean-glass divide-y divide-white/5 rounded-xl">
        {data.audit.length === 0 ? (
          <p className="px-4 py-5 text-sm text-white/35">No audit records yet.</p>
        ) : (
          data.audit.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-4 py-2.5 text-[12.5px]">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[#f0c75e]/80">{a.action}</span>
                {a.target ? <span className="font-mono text-white/35">{a.target.slice(0, 14)}…</span> : null}
              </div>
              <span className="text-[11px] text-white/30">{timeAgo(a.createdAt)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
