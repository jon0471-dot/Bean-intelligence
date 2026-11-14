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
