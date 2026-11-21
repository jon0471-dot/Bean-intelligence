<!-- M21 model-role response for project B (verbatim record of the response
     that the product pipeline parses with parseFiles). Consumed context:
     CODE GIFTZ SYSTEM_PROMPT + the engine brief at
     validation/m21/project-b-dashboard/plan/brief.md + the user request. -->

Here's your Pulse analytics dashboard — a complete React app using the attached kit components (SpotlightCard for the KPI cards, Dock for the sidebar navigation, LatticeLoader for loading states), with the dashboard-restricted motion set from the brief (entrance timeline + batched scroll reveal only — restrained by design for a data-first UI). Charts are dependency-free inline SVG, the table is sortable/searchable/filterable, and every figure is clearly labeled sample data. Loading, empty and error states are reachable via demo controls in the header.

```html path=index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Pulse — sample analytics dashboard UI generated as a code deliverable. All data is sample data." />
    <title>Pulse Analytics — sample data dashboard</title>
  </head>
  <body>
    <a class="pl-skip-link" href="#main">Skip to main content</a>
    <div id="root"></div>
    <noscript>Pulse analytics dashboard — this demo requires JavaScript.</noscript>
    <script type="module" src="./index.tsx"></script>
  </body>
</html>
```

```tsx path=index.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Pulse: #root container missing from index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

```ts path=data/sample.ts
// SAMPLE DATA — clearly identified synthetic figures for a fictional product.
// Nothing here comes from a live source; the dashboard renders these values
// verbatim and labels them as sample data in the UI.
export type RegionStatus = 'healthy' | 'degraded' | 'incident'

export interface RegionRow {
  region: string
  requests: number
  p95LatencyMs: number
  errorRatePct: number
  uptimePct: number
  status: RegionStatus
}

export type DateRangeId = '7d' | '30d' | '90d'

export const DATE_RANGES: Array<{ id: DateRangeId; label: string; factor: number }> = [
  { id: '7d', label: 'Last 7 days', factor: 1 },
  { id: '30d', label: 'Last 30 days', factor: 4.3 },
  { id: '90d', label: 'Last 90 days', factor: 12.9 },
]

export const SAMPLE_ROWS: RegionRow[] = [
  { region: 'us-east-1', requests: 18_400_000, p95LatencyMs: 36, errorRatePct: 0.31, uptimePct: 99.99, status: 'healthy' },
  { region: 'us-west-2', requests: 9_120_000, p95LatencyMs: 41, errorRatePct: 0.38, uptimePct: 99.97, status: 'healthy' },
  { region: 'eu-west-1', requests: 7_950_000, p95LatencyMs: 38, errorRatePct: 0.44, uptimePct: 99.96, status: 'healthy' },
  { region: 'eu-central-1', requests: 4_310_000, p95LatencyMs: 44, errorRatePct: 0.52, uptimePct: 99.95, status: 'degraded' },
  { region: 'ap-south-1', requests: 3_640_000, p95LatencyMs: 52, errorRatePct: 0.61, uptimePct: 99.94, status: 'healthy' },
  { region: 'ap-northeast-1', requests: 2_980_000, p95LatencyMs: 49, errorRatePct: 0.58, uptimePct: 99.95, status: 'degraded' },
  { region: 'sa-east-1', requests: 1_420_000, p95LatencyMs: 61, errorRatePct: 0.87, uptimePct: 99.9, status: 'incident' },
  { region: 'af-south-1', requests: 380_000, p95LatencyMs: 68, errorRatePct: 0.93, uptimePct: 99.88, status: 'incident' },
]

/** Rows scaled by the selected date range (sample math, deterministic). */
export function rowsForRange(range: DateRangeId): RegionRow[] {
  const factor = DATE_RANGES.find((r) => r.id === range)?.factor ?? 1
  return SAMPLE_ROWS.map((row) => ({
    ...row,
    requests: Math.round(row.requests * factor),
    // latency/error rates are period averages — unchanged by the window
    p95LatencyMs: row.p95LatencyMs,
    errorRatePct: row.errorRatePct,
    uptimePct: row.uptimePct,
  }))
}

export interface Kpi {
  id: string
  label: string
  value: string
  deltaPct: number
  trend: number[] // sample sparkline, oldest → newest
}

export function kpisForRange(range: DateRangeId): Kpi[] {
  const rows = rowsForRange(range)
  const total = rows.reduce((sum, r) => sum + r.requests, 0)
  const weightedP95 = Math.round(
    rows.reduce((sum, r) => sum + r.p95LatencyMs * r.requests, 0) / total,
  )
  const errorRate = rows.reduce((sum, r) => sum + r.errorRatePct * r.requests, 0) / total
  const worstUptime = Math.min(...rows.map((r) => r.uptimePct))
  const label = DATE_RANGES.find((r) => r.id === range)?.label ?? ''
  return [
    {
      id: 'requests',
      label: `Total requests · ${label}`,
      value: `${(total / 1_000_000).toFixed(1)}M`,
      deltaPct: 12.4,
      trend: [42, 44, 47, 45, 49, 52, 55],
    },
    {
      id: 'p95',
      label: 'p95 latency',
      value: `${weightedP95} ms`,
      deltaPct: -6.1,
      trend: [46, 45, 44, 42, 41, 40, 38],
    },
    {
      id: 'errors',
      label: 'Error rate',
      value: `${errorRate.toFixed(2)}%`,
      deltaPct: -0.08,
      trend: [0.6, 0.58, 0.55, 0.5, 0.47, 0.45, 0.42],
    },
    {
      id: 'uptime',
      label: 'Lowest regional uptime',
      value: `${worstUptime.toFixed(2)}%`,
      deltaPct: 0.02,
      trend: [99.9, 99.9, 99.91, 99.92, 99.94, 99.96, 99.98],
    },
  ]
}

/** Sample 12-week request trend (millions of requests per week). */
export const SAMPLE_TREND: Array<{ week: string; requestsM: number }> = [
  { week: 'W35', requestsM: 7.1 },
  { week: 'W36', requestsM: 7.4 },
  { week: 'W37', requestsM: 7.2 },
  { week: 'W38', requestsM: 7.9 },
  { week: 'W39', requestsM: 8.3 },
  { week: 'W40', requestsM: 8.1 },
  { week: 'W41', requestsM: 8.8 },
  { week: 'W42', requestsM: 9.2 },
  { week: 'W43', requestsM: 9.0 },
  { week: 'W44', requestsM: 9.7 },
  { week: 'W45', requestsM: 10.1 },
  { week: 'W46', requestsM: 10.6 },
]
```

```tsx path=App.tsx
import { memo, useMemo, useRef, useState } from 'react'
import DemoHeader, { type DemoState } from './components/header'
import SideNav from './components/sidenav'
import { KpiGrid, TrendChart, RegionBars } from './components/charts'
import { RegionTable } from './components/table'
import { StatePanels } from './components/states'
import {
  kpisForRange,
  rowsForRange,
  SAMPLE_TREND,
  type DateRangeId,
  type RegionRow,
} from './data/sample'
import { useEntranceTimeline, useScrollRevealBatch } from './lib/motion'

export default function App() {
  const root = useRef<HTMLDivElement>(null)

  // Demo state machine: the sample app ships explicit loading / empty / error
  // states so they can be reviewed without a backend.
  const [demo, setDemo] = useState<DemoState>('ready')
  const [range, setRange] = useState<DateRangeId>('30d')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'degraded' | 'incident'>('all')
  const [sort, setSort] = useState<{ key: keyof RegionRow; dir: 'asc' | 'desc' }>({
    key: 'requests',
    dir: 'desc',
  })
  const [activeNav, setActiveNav] = useState('overview')

  // BEAN GSAP patterns (dashboard-restricted set): entrance on load, batched
  // scroll reveal for the lower sections. Both guard reduced motion.
  useEntranceTimeline(root)
  useScrollRevealBatch(root)

  // Derived data is memoized — recomputed only when an input changes.
  const rows = useMemo(() => rowsForRange(range), [range])
  const kpis = useMemo(() => kpisForRange(range), [range])
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = rows.filter(
      (r) =>
        (statusFilter === 'all' || r.status === statusFilter) &&
        (q === '' || r.region.toLowerCase().includes(q)),
    )
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [rows, query, statusFilter, sort])

  return (
    <div className="pl-shell" ref={root}>
      <SideNav active={activeNav} onNavigate={setActiveNav} />
      <div className="pl-main">
        <DemoHeader
          demo={demo}
          onDemo={setDemo}
          range={range}
          onRange={setRange}
        />
        <main className="pl-content" id="main">
          <p className="pl-sample-banner" role="note">
            SAMPLE DATA — this dashboard renders synthetic figures for a
            fictional product. No live analytics source is connected.
          </p>

          {demo !== 'ready' ? (
            <StatePanels state={demo} onReset={() => setDemo('ready')} rowsAvailable={rows.length} />
          ) : (
            <>
              <section className="pl-section" id="overview" aria-labelledby="pl-overview-h">
                <h1 className="pl-h1" id="pl-overview-h" data-animate>
                  Platform overview
                </h1>
                <KpiGrid kpis={kpis} />
              </section>

              <section className="pl-section" id="traffic" aria-labelledby="pl-traffic-h">
                <h2 className="pl-h2" id="pl-traffic-h" data-animate>Traffic</h2>
                <div className="pl-charts">
                  <TrendChart trend={SAMPLE_TREND} />
                  <RegionBars rows={rows} />
                </div>
              </section>

              <section className="pl-section" id="reports" aria-labelledby="pl-reports-h">
                <h2 className="pl-h2" id="pl-reports-h" data-animate>Regional report</h2>
                <RegionTable
                  rows={visibleRows}
                  totalRows={rows.length}
                  query={query}
                  onQuery={setQuery}
                  statusFilter={statusFilter}
                  onStatusFilter={setStatusFilter}
                  sort={sort}
                  onSort={setSort}
                />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

// Memoized so parent re-renders (e.g. header interactions) skip unchanged
// subtrees — cheap, honest React performance discipline for a data UI.
export const MemoRegionRowPlaceholder = memo(function Placeholder() {
  return null
})
```

Wait — I should not ship placeholder exports. Let me correct that in the table module instead; this file keeps only what it uses.

```tsx path=components/header.tsx
import { DATE_RANGES, type DateRangeId } from '../data/sample'

export type DemoState = 'ready' | 'loading' | 'empty' | 'error'

interface HeaderProps {
  demo: DemoState
  onDemo: (state: DemoState) => void
  range: DateRangeId
  onRange: (range: DateRangeId) => void
}

export default function DemoHeader({ demo, onDemo, range, onRange }: HeaderProps) {
  return (
    <header className="pl-header">
      <div className="pl-header-row">
        <div className="pl-header-id">
          <span className="pl-logo" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M3 12h4l2-5 4 10 2-5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <p className="pl-title">Pulse</p>
            <p className="pl-subtitle">Sample analytics · fictional product</p>
          </div>
        </div>

        <div className="pl-header-controls">
          <label className="pl-control">
            <span className="pl-control-label">Date range</span>
            <select
              className="pl-select"
              value={range}
              onChange={(e) => onRange(e.target.value as DateRangeId)}
              aria-label="Date range"
            >
              {DATE_RANGES.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>

          {/* Demo-only state controls (a real deployment would not expose
              these): they exist so loading/empty/error states can be
              reviewed without a backend. */}
          <div className="pl-demo-controls" role="group" aria-label="Demo state controls">
            <button type="button" className="pl-chip" onClick={() => onDemo('loading')}>
              Simulate loading
            </button>
            <button type="button" className="pl-chip" onClick={() => onDemo('empty')}>
              Simulate empty
            </button>
            <button type="button" className="pl-chip" onClick={() => onDemo('error')}>
              Simulate error
            </button>
            {demo !== 'ready' && (
              <button type="button" className="pl-chip pl-chip-active" onClick={() => onDemo('ready')}>
                Reset demo
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
```

```tsx path=components/sidenav.tsx
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
```

```tsx path=components/charts.tsx
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
```

```tsx path=components/table.tsx
import { memo } from 'react'
import type { RegionRow } from '../data/sample'
import type { TableSort } from '../App'

const COLUMNS: Array<{ key: keyof RegionRow | null; label: string; numeric?: boolean }> = [
  { key: 'region', label: 'Region' },
  { key: 'requests', label: 'Requests', numeric: true },
  { key: 'p95LatencyMs', label: 'p95 (ms)', numeric: true },
  { key: 'errorRatePct', label: 'Error rate', numeric: true },
  { key: 'uptimePct', label: 'Uptime', numeric: true },
  { key: 'status', label: 'Status' },
]

const Row = memo(function Row({ row }: { row: RegionRow }) {
  return (
    <tr>
      <th scope="row" className="pl-cell-region">{row.region}</th>
      <td className="pl-cell-num">{row.requests.toLocaleString('en-US')}</td>
      <td className="pl-cell-num">{row.p95LatencyMs}</td>
      <td className="pl-cell-num">{row.errorRatePct.toFixed(2)}%</td>
      <td className="pl-cell-num">{row.uptimePct.toFixed(2)}%</td>
      <td>
        <span className={`pl-badge pl-badge-${row.status}`}>{row.status}</span>
      </td>
    </tr>
  )
})

interface TableProps {
  rows: RegionRow[]
  totalRows: number
  query: string
  onQuery: (q: string) => void
  statusFilter: 'all' | 'healthy' | 'degraded' | 'incident'
  onStatusFilter: (s: 'all' | 'healthy' | 'degraded' | 'incident') => void
  sort: TableSort
  onSort: (s: TableSort) => void
}

export function RegionTable(props: TableProps) {
  const { rows, totalRows, query, onQuery, statusFilter, onStatusFilter, sort, onSort } = props
  const toggleSort = (key: keyof RegionRow) => () =>
    onSort({ key, dir: sort.key === key && sort.dir === 'desc' ? 'asc' : 'desc' })
  return (
    <div className="pl-card pl-table-card" data-animate>
      <div className="pl-table-controls">
        <input
          type="search"
          className="pl-search"
          placeholder="Search region…"
          aria-label="Search regions"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
        />
        <label className="pl-control">
          <span className="pl-control-label">Status</span>
          <select
            className="pl-select"
            value={statusFilter}
            onChange={(e) => onStatusFilter(e.target.value as typeof statusFilter)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="healthy">Healthy</option>
            <option value="degraded">Degraded</option>
            <option value="incident">Incident</option>
          </select>
        </label>
        <p className="pl-table-count" role="status">
          {rows.length} of {totalRows} regions (sample data)
        </p>
      </div>
      <div className="pl-table-scroll" tabIndex={0} role="region" aria-label="Regional metrics table">
        <table className="pl-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.label}
                  scope="col"
                  aria-sort={
                    col.key && sort.key === col.key
                      ? sort.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  className={col.numeric ? 'pl-th-num' : undefined}
                >
                  {col.key ? (
                    <button type="button" className="pl-th-btn" onClick={toggleSort(col.key)}>
                      {col.label}
                      <span aria-hidden="true" className="pl-sort-arrow">
                        {sort.key === col.key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Row key={r.region} row={r} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} className="pl-table-empty">
                  No regions match the current search and filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

```tsx path=components/states.tsx
import LatticeLoader from '../components/kit/LatticeLoader'

export function StatePanels({
  state,
  onReset,
  rowsAvailable,
}: {
  state: 'loading' | 'empty' | 'error'
  onReset: () => void
  rowsAvailable: number
}) {
  if (state === 'loading') {
    return (
      <div className="pl-card pl-state-panel" data-state="loading" role="status" aria-live="polite">
        <LatticeLoader status="working" label="Loading sample metrics" pattern="orbit" shape="round" />
        <p className="pl-state-note">Fetching the sample dataset… (demo state)</p>
      </div>
    )
  }
  if (state === 'empty') {
    return (
      <div className="pl-card pl-state-panel" data-state="empty" role="status">
        <svg width="42" height="42" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="pl-state-icon">
          <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 9h18M8 13h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <h2 className="pl-state-title">No data for this window</h2>
        <p className="pl-state-note">
          The sample dataset has {rowsAvailable} regions, but this state shows what
          users see when a filter matches nothing.
        </p>
        <button type="button" className="pl-btn" onClick={onReset}>Reset demo</button>
      </div>
    )
  }
  return (
    <div className="pl-card pl-state-panel pl-state-error" data-state="error" role="alert">
      <svg width="42" height="42" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="pl-state-icon">
        <path d="M12 3l10 18H2L12 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M12 10v5M12 18.2v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <h2 className="pl-state-title">Could not load metrics</h2>
      <p className="pl-state-note">
        The metrics service returned an error (demo state — no real request was made).
      </p>
      <div className="pl-state-actions">
        <button type="button" className="pl-btn" onClick={onReset}>Reset demo</button>
        <button type="button" className="pl-btn pl-btn-ghost" onClick={onReset}>Retry request</button>
      </div>
    </div>
  )
}
```

```ts path=lib/motion.ts
// Dashboard-restricted motion: ONLY the two patterns the brief plans for this
// site type (entrance on load + batched scroll reveal). No scroll hijacking,
// no decorative canvases; both hooks guard prefers-reduced-motion and clean
// up through useGSAP's context revert.
import type { RefObject } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, useGSAP)

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// BEAN pattern: entrance-timeline — one staggered entrance for [data-animate].
export function useEntranceTimeline(scope: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      gsap.from('[data-animate]', {
        opacity: 0,
        y: 24,
        duration: 0.7,
        ease: 'power2.out',
        stagger: 0.08,
        clearProps: 'all',
      })
    },
    { scope, dependencies: [] },
  )
}

// BEAN pattern: scroll-reveal-batch — [data-reveal] elements fade in once.
export function useScrollRevealBatch(scope: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el) => {
        el.style.opacity = '0'
      })
      ScrollTrigger.batch('[data-reveal]', {
        start: 'top 85%',
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, { opacity: 1, y: 0, duration: 0.6, ease: 'power2.out', stagger: 0.08 }),
      })
      gsap.set('[data-reveal]', { y: 24 })
    },
    { scope, dependencies: [ScrollTrigger] },
  )
}
```

```css path=styles.css
/* Pulse — sample analytics dashboard (pl- namespace, light-professional on
   dark-neutral base; data legibility first) */
:root {
  --pl-bg: #0d1017;
  --pl-panel: #151a24;
  --pl-panel-2: #1a2130;
  --pl-line: rgba(148, 163, 196, 0.18);
  --pl-text: #e8ecf6;
  --pl-muted: #9aa4bd;
  --pl-accent: #5b9dff;
  --pl-green: #34d399;
  --pl-amber: #fbbf24;
  --pl-red: #f87171;
  --pl-radius: 14px;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: var(--pl-bg); color: var(--pl-text); line-height: 1.55; -webkit-font-smoothing: antialiased; }
:focus-visible { outline: 2px solid var(--pl-accent); outline-offset: 2px; border-radius: 6px; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
.pl-skip-link { position: absolute; left: 12px; top: -48px; z-index: 200; background: var(--pl-accent); color: #0d1017; padding: 10px 16px; border-radius: 10px; font-weight: 700; text-decoration: none; transition: top 0.2s ease; }
.pl-skip-link:focus { top: 12px; }

/* Shell: dock rail + main column */
.pl-shell { min-height: 100vh; display: flex; }
.pl-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pl-content { width: min(1180px, 100% - 48px); margin-inline: auto; padding: 18px 0 96px; }
.pl-sidenav-desktop { position: fixed; inset-block: 0; left: 0; display: flex; align-items: center; padding-inline: 10px; }
.pl-sidenav-mobile { display: none; position: fixed; inset-inline: 0; bottom: 10px; justify-content: center; z-index: 60; }
@media (max-width: 900px) {
  .pl-sidenav-desktop { display: none; }
  .pl-sidenav-mobile { display: flex; }
}

/* Header */
.pl-header { position: sticky; top: 0; z-index: 40; background: rgba(13, 16, 23, 0.92); backdrop-filter: blur(10px); border-bottom: 1px solid var(--pl-line); }
.pl-header-row { width: min(1180px, 100% - 48px); margin-inline: auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; flex-wrap: wrap; }
.pl-header-id { display: flex; align-items: center; gap: 10px; }
.pl-logo { color: var(--pl-accent); display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; background: rgba(91, 157, 255, 0.12); border: 1px solid rgba(91, 157, 255, 0.3); }
.pl-title { margin: 0; font-weight: 700; letter-spacing: -0.01em; }
.pl-subtitle { margin: 0; color: var(--pl-muted); font-size: 0.8rem; }
.pl-header-controls { display: flex; align-items: end; gap: 14px; flex-wrap: wrap; }
.pl-control { display: grid; gap: 2px; font-size: 0.78rem; color: var(--pl-muted); }
.pl-select { background: var(--pl-panel); color: var(--pl-text); border: 1px solid var(--pl-line); border-radius: 9px; padding: 8px 10px; font-size: 0.9rem; }
.pl-demo-controls { display: flex; gap: 8px; flex-wrap: wrap; }
.pl-chip { background: var(--pl-panel); border: 1px solid var(--pl-line); color: var(--pl-muted); border-radius: 999px; padding: 7px 12px; font-size: 0.8rem; cursor: pointer; }
.pl-chip:hover { color: var(--pl-text); border-color: var(--pl-accent); }
.pl-chip-active { color: #0d1017; background: var(--pl-accent); border-color: var(--pl-accent); font-weight: 600; }
.pl-sample-banner { width: 100%; margin: 14px 0 0; padding: 10px 14px; border: 1px dashed rgba(91, 157, 255, 0.4); border-radius: 10px; background: rgba(91, 157, 255, 0.07); color: var(--pl-muted); font-size: 0.85rem; }

/* Sections + KPIs */
.pl-section { margin-top: 30px; }
.pl-h1 { font-size: clamp(1.4rem, 1.2rem + 1vw, 1.9rem); margin: 14px 0 14px; letter-spacing: -0.02em; }
.pl-h2 { font-size: clamp(1.15rem, 1.05rem + 0.6vw, 1.4rem); margin: 0 0 14px; letter-spacing: -0.01em; }
.pl-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
@media (max-width: 1100px) { .pl-kpi-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 620px) { .pl-kpi-grid { grid-template-columns: 1fr; } }
.pl-card { background: var(--pl-panel); border: 1px solid var(--pl-line); border-radius: var(--pl-radius); }
.pl-kpi { padding: 16px 18px; display: grid; gap: 4px; }
.pl-kpi-label { margin: 0; color: var(--pl-muted); font-size: 0.82rem; }
.pl-kpi-value { margin: 0; font-size: clamp(1.5rem, 1.3rem + 0.8vw, 2rem); font-weight: 700; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.pl-kpi-delta { margin: 0; font-size: 0.82rem; }
.pl-kpi-delta.is-up { color: var(--pl-green); }
.pl-kpi-delta.is-down { color: var(--pl-accent); }
.pl-kpi-spark { width: 100%; height: 30px; color: var(--pl-accent); opacity: 0.85; margin-top: 6px; }

/* Charts */
.pl-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 900px) { .pl-charts { grid-template-columns: 1fr; } }
.pl-chart { padding: 16px; margin: 0; min-width: 0; }
.pl-chart svg { width: 100%; height: auto; min-width: 0; }
.pl-chart-title { color: var(--pl-muted); font-size: 0.85rem; margin-bottom: 10px; display: block; }
.pl-gridline { stroke: rgba(148, 163, 196, 0.14); }
.pl-axis { fill: var(--pl-muted); font-size: 10px; }
.pl-line { stroke: var(--pl-accent); stroke-width: 2.4; fill: none; stroke-linecap: round; }
.pl-area { fill: rgba(91, 157, 255, 0.12); }
.pl-bar { fill: var(--pl-accent); opacity: 0.85; }
.pl-bar.degraded { fill: var(--pl-amber); }
.pl-bar.incident { fill: var(--pl-red); }

/* Table */
.pl-table-card { margin-top: 2px; padding: 14px; }
.pl-table-controls { display: flex; align-items: end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.pl-search { flex: 1 1 220px; background: var(--pl-panel-2); border: 1px solid var(--pl-line); color: var(--pl-text); border-radius: 9px; padding: 9px 12px; font-size: 0.92rem; min-width: 0; }
.pl-search::placeholder { color: var(--pl-muted); }
.pl-table-count { margin: 0 0 2px auto; color: var(--pl-muted); font-size: 0.8rem; }
.pl-table-scroll { overflow-x: auto; border: 1px solid var(--pl-line); border-radius: 10px; }
.pl-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; min-width: 640px; }
.pl-table th { text-align: left; background: var(--pl-panel-2); color: var(--pl-muted); font-size: 0.8rem; letter-spacing: 0.04em; text-transform: uppercase; }
.pl-th-num { text-align: right !important; }
.pl-th-btn { background: none; border: 0; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; padding: 10px 12px; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; width: 100%; justify-content: inherit; }
.pl-th-btn:hover { color: var(--pl-text); }
.pl-sort-arrow { opacity: 0.8; }
.pl-table td, .pl-table th { padding: 10px 12px; border-top: 1px solid var(--pl-line); }
.pl-table tbody tr:hover { background: rgba(91, 157, 255, 0.05); }
.pl-cell-region { font-weight: 600; }
.pl-cell-num { text-align: right; font-variant-numeric: tabular-nums; }
.pl-badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 0.76rem; font-weight: 600; text-transform: capitalize; }
.pl-badge-healthy { background: rgba(52, 211, 153, 0.14); color: var(--pl-green); }
.pl-badge-degraded { background: rgba(251, 191, 36, 0.14); color: var(--pl-amber); }
.pl-badge-incident { background: rgba(248, 113, 113, 0.16); color: var(--pl-red); }
.pl-table-empty { text-align: center; color: var(--pl-muted); padding: 26px 0; }

/* State panels */
.pl-state-panel { margin-top: 26px; padding: 44px 24px; display: grid; justify-items: center; gap: 10px; text-align: center; }
.pl-state-error { border-color: rgba(248, 113, 113, 0.4); }
.pl-state-icon { color: var(--pl-muted); }
.pl-state-error .pl-state-icon { color: var(--pl-red); }
.pl-state-title { margin: 0; font-size: 1.15rem; }
.pl-state-note { margin: 0; color: var(--pl-muted); max-width: 46ch; }
.pl-state-actions { display: flex; gap: 10px; margin-top: 8px; }
.pl-btn { background: var(--pl-accent); color: #0d1017; border: 1px solid var(--pl-accent); border-radius: 10px; padding: 9px 16px; font-weight: 600; cursor: pointer; }
.pl-btn-ghost { background: transparent; color: var(--pl-text); border-color: var(--pl-line); }
```

One note on the conversation above: the `MemoRegionRowPlaceholder` export in `App.tsx` was a drafting artifact — I've removed it from the delivered file below (the memoization discipline lives in `components/table.tsx` and `components/charts.tsx` where it belongs).

```tsx path=App.tsx
import { useMemo, useRef, useState } from 'react'
import DemoHeader, { type DemoState } from './components/header'
import SideNav from './components/sidenav'
import { KpiGrid, TrendChart, RegionBars } from './components/charts'
import { RegionTable } from './components/table'
import { StatePanels } from './components/states'
import {
  kpisForRange,
  rowsForRange,
  SAMPLE_TREND,
  type DateRangeId,
  type RegionRow,
} from './data/sample'
import { useEntranceTimeline, useScrollRevealBatch } from './lib/motion'

export interface TableSort {
  key: keyof RegionRow
  dir: 'asc' | 'desc'
}

export default function App() {
  const root = useRef<HTMLDivElement>(null)

  // Demo state machine: the sample app ships explicit loading / empty / error
  // states so they can be reviewed without a backend.
  const [demo, setDemo] = useState<DemoState>('ready')
  const [range, setRange] = useState<DateRangeId>('30d')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'degraded' | 'incident'>('all')
  const [sort, setSort] = useState<TableSort>({ key: 'requests', dir: 'desc' })
  const [activeNav, setActiveNav] = useState('overview')

  // BEAN GSAP patterns (dashboard-restricted set): entrance on load, batched
  // scroll reveal for the lower sections. Both guard reduced motion.
  useEntranceTimeline(root)
  useScrollRevealBatch(root)

  // Derived data is memoized — recomputed only when an input changes.
  const rows = useMemo(() => rowsForRange(range), [range])
  const kpis = useMemo(() => kpisForRange(range), [range])
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = rows.filter(
      (r) =>
        (statusFilter === 'all' || r.status === statusFilter) &&
        (q === '' || r.region.toLowerCase().includes(q)),
    )
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [rows, query, statusFilter, sort])

  return (
    <div className="pl-shell" ref={root}>
      <SideNav active={activeNav} onNavigate={setActiveNav} />
      <div className="pl-main">
        <DemoHeader demo={demo} onDemo={setDemo} range={range} onRange={setRange} />
        <main className="pl-content" id="main">
          <p className="pl-sample-banner" role="note">
            SAMPLE DATA — this dashboard renders synthetic figures for a
            fictional product. No live analytics source is connected.
          </p>

          {demo !== 'ready' ? (
            <StatePanels state={demo} onReset={() => setDemo('ready')} rowsAvailable={rows.length} />
          ) : (
            <>
              <section className="pl-section" id="overview" aria-labelledby="pl-overview-h">
                <h1 className="pl-h1" id="pl-overview-h" data-animate>
                  Platform overview
                </h1>
                <KpiGrid kpis={kpis} />
              </section>

              <section className="pl-section" id="traffic" aria-labelledby="pl-traffic-h">
                <h2 className="pl-h2" id="pl-traffic-h" data-animate>Traffic</h2>
                <div className="pl-charts">
                  <TrendChart trend={SAMPLE_TREND} />
                  <RegionBars rows={rows} />
                </div>
              </section>

              <section className="pl-section" id="reports" aria-labelledby="pl-reports-h">
                <h2 className="pl-h2" id="pl-reports-h" data-animate>Regional report</h2>
                <RegionTable
                  rows={visibleRows}
                  totalRows={rows.length}
                  query={query}
                  onQuery={setQuery}
                  statusFilter={statusFilter}
                  onStatusFilter={setStatusFilter}
                  sort={sort}
                  onSort={setSort}
                />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
```

The dashboard keeps motion restrained (entrance + batched reveal only), renders entirely offline, and works at phone widths via the bottom-docked navigation. Run it with your preferred bundler — the attached `package.json` carries the pinned dependencies.

<!-- end of M21 model-role response for project B -->
