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
