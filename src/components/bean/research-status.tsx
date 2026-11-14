'use client'

/**
 * BEAN Intelligence — shared research gateway status strip (Phase 7).
 *
 * A compact, honest availability line shown inside the two research-consuming
 * products (RIISHE and CODE GIFTZ). Fetches the authenticated gateway status
 * once per mount with a module-level 60 s cache. It NEVER fabricates
 * activity: it only reports what the measured probes returned — sources that
 * need configuration or login say so, and unavailable runtimes say so.
 * The strip is intentionally silent (renders nothing) while loading or when
 * the gateway reports nothing usable, to keep product screens calm.
 */

import { useEffect, useState } from 'react'

export interface ResearchSourceStatusView {
  id: string
  label: string
  kind: 'agent-reach' | 'browser'
  level: 'default' | 'optional' | 'experimental'
  loginRequired: boolean
  state: 'available' | 'requires_configuration' | 'requires_login' | 'experimental' | 'unavailable' | 'disabled'
  note: string | null
  products: string[]
}

interface StatusResponse {
  ok: boolean
  runtime: { available: boolean; version: string | null; reason: string | null }
  obscura: { available: boolean; version: string | null; reason: string | null }
  sources: ResearchSourceStatusView[]
}

const CACHE_TTL_MS = 60_000
let cache: { value: StatusResponse; at: number } | null = null

async function fetchStatus(): Promise<StatusResponse | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value
  try {
    const res = await fetch('/api/research/status', { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const data = (await res.json()) as StatusResponse
    if (!data.ok) return null
    cache = { value: data, at: Date.now() }
    return data
  } catch {
    return null
  }
}

const STATE_LABEL: Record<ResearchSourceStatusView['state'], string> = {
  available: 'Ready',
  requires_configuration: 'Setup needed',
  requires_login: 'Login required',
  experimental: 'Experimental',
  unavailable: 'Unavailable',
  disabled: 'Disabled',
}

const STATE_CLASS: Record<ResearchSourceStatusView['state'], string> = {
  available: 'text-emerald-300/70',
  requires_configuration: 'text-amber-300/70',
  requires_login: 'text-amber-300/70',
  experimental: 'text-sky-300/60',
  unavailable: 'text-white/30',
  disabled: 'text-white/25',
}

export function clearResearchStatusCacheForTests(): void {
  cache = null
}

/**
 * @param product Filter to sources relevant to this product ('riishe' |
 *  'code-giftz'). Sources with an empty products list are hidden.
 */
export function ResearchStatusStrip({ product }: { product: 'riishe' | 'code-giftz' }) {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  useEffect(() => {
    let alive = true
    void fetchStatus().then((s) => {
      if (alive) setStatus(s)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!status) return null
  const sources = status.sources.filter((s) => s.products.includes(product))
  if (!status.runtime.available && sources.length === 0) return null

  const chips = sources.map((s) => (
    <span
      key={s.id}
      className={`inline-flex items-center gap-1 text-[10.5px] ${STATE_CLASS[s.state]}`}
      title={s.note ?? `${s.label} — ${STATE_LABEL[s.state]}`}
    >
      {s.label}: {STATE_LABEL[s.state]}
    </span>
  ))

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10.5px] text-white/30"
      data-testid="research-status"
    >
      <span className="text-white/35">Research sources</span>
      {chips}
      {status.obscura.available ? (
        <span className="text-sky-300/50" title="Optional browser-rendering backend is installed">
          rendered pages: Ready
        </span>
      ) : null}
    </div>
  )
}
