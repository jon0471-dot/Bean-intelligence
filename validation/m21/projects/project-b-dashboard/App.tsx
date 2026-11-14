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
