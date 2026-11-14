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
