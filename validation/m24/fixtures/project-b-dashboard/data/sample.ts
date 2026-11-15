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
