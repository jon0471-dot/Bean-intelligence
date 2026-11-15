import { memo } from 'react'
import SpotlightCard from '../components/kit/SpotlightCard'
import type { Kpi, RegionRow } from '../data/sample'
import { SAMPLE_TREND } from '../data/sample'

// React.memo: KPI cards re-render only when their data changes.
const KpiCard = memo(function KpiCard({ kpi }: { kpi: Kpi }) {
  const max = Math.max(...kpi.trend)
  const min = Math.min(...kpi.trend)
  const points = kpi.trend
    .map((v, i) => {
      const x = (i / (kpi.trend.length - 1)) * 100
      const y = 30 - ((v - min) / (max - min || 1)) * 26
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const up = kpi.deltaPct >= 0
  return (
    <SpotlightCard className="pl-card pl-kpi" data-testid="kpi-card" data-animate theme="dark">
      <p className="pl-kpi-label">{kpi.label}</p>
      <p className="pl-kpi-value">{kpi.value}</p>
      <p className={`pl-kpi-delta ${up ? 'is-up' : 'is-down'}`}>
        <span aria-hidden="true">{up ? '▲' : '▼'}</span> {Math.abs(kpi.deltaPct).toFixed(1)}% vs previous period
      </p>
      <svg className="pl-kpi-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    </SpotlightCard>
  )
})

export function KpiGrid({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="pl-kpi-grid">
      {kpis.map((k) => (
        <KpiCard key={k.id} kpi={k} />
      ))}
    </div>
  )
}

/** 12-week sample trend — dependency-free inline SVG line chart. */
export function TrendChart({ trend }: { trend: typeof SAMPLE_TREND }) {
  const w = 520
  const h = 220
  const pad = 36
  const max = Math.max(...trend.map((t) => t.requestsM))
  const min = Math.min(...trend.map((t) => t.requestsM))
  const px = (i: number) => pad + (i / (trend.length - 1)) * (w - pad * 2)
  const py = (v: number) => h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2)
  const line = trend.map((t, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(t.requestsM).toFixed(1)}`).join(' ')
  const area = `${line} L${px(trend.length - 1).toFixed(1)},${h - pad} L${px(0).toFixed(1)},${h - pad} Z`
  return (
    <figure className="pl-card pl-chart" data-animate>
      <figcaption className="pl-chart-title">Weekly requests (millions) — sample data</figcaption>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Line chart of weekly requests, sample data, rising from ${min} to ${max} million`}
        data-chart="trend"
      >
        <title>Weekly requests — sample data</title>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad} x2={w - pad} y1={pad + f * (h - pad * 2)} y2={pad + f * (h - pad * 2)} className="pl-gridline" />
            <text x={pad - 6} y={pad + f * (h - pad * 2) + 4} textAnchor="end" className="pl-axis">
              {(max - f * (max - min)).toFixed(1)}
            </text>
          </g>
        ))}
        <path d={area} className="pl-area" />
        <path d={line} className="pl-line" />
        {trend.map((t, i) =>
          i % 2 === 0 ? (
            <text key={t.week} x={px(i)} y={h - 12} textAnchor="middle" className="pl-axis">
              {t.week}
            </text>
          ) : null,
        )}
      </svg>
    </figure>
  )
}

/** Requests by region — dependency-free inline SVG bar chart. */
export function RegionBars({ rows }: { rows: RegionRow[] }) {
  const w = 520
  const h = 220
  const pad = 36
  const max = Math.max(...rows.map((r) => r.requests))
  const bw = (w - pad * 2) / rows.length
  return (
    <figure className="pl-card pl-chart" data-animate>
      <figcaption className="pl-chart-title">Requests by region — sample data</figcaption>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Bar chart of requests by region, sample data, largest ${rows[0]?.region ?? ''}`}
        data-chart="region-bars"
      >
        <title>Requests by region — sample data</title>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad} x2={w - pad} y1={pad + f * (h - pad * 2)} y2={pad + f * (h - pad * 2)} className="pl-gridline" />
            <text x={pad - 6} y={pad + f * (h - pad * 2) + 4} textAnchor="end" className="pl-axis">
              {Math.round(max - f * max / 1_000_000) / 1 >= 1 ? `${((max - f * max) / 1_000_000).toFixed(0)}M` : `${Math.round(max - f * max / 1000)}k`}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const bh = ((r.requests / (max || 1)) * (h - pad * 2)).toFixed(1)
          return (
            <g key={r.region}>
              <rect
                x={pad + i * bw + bw * 0.18}
                y={h - pad - Number(bh)}
                width={bw * 0.64}
                height={Number(bh)}
                rx="3"
                className={`pl-bar ${r.status}`}
              />
              <text
                x={pad + i * bw + bw * 0.5}
                y={h - 12}
                textAnchor="middle"
                className="pl-axis"
                transform={`rotate(-32 ${pad + i * bw + bw * 0.5} ${h - 12})`}
              >
                {r.region}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
