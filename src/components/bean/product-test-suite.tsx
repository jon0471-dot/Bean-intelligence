'use client'

/**
 * BEAN Intelligence — per-product functional test suite panel.
 *
 * Mounted inside the existing workspace shell for RIISHE, LAXII, JAZMII and
 * CODE GIFTZ. Keeps each product's own UI untouched; the panel is a small
 * collapsible card at the bottom of the workspace that:
 *   - runs a named suite of REAL checks through the caller's own session;
 *   - labels every test real / deterministic / simulated;
 *   - shows running state, result, error message, artifact link, timestamp;
 *   - never touches the provider while its endpoint class is rate-limited
 *     (blocked rows say so honestly instead).
 */
import { useCallback, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, CircleCheck, CircleX, LoaderCircle, MinusCircle, Play, FlaskConical } from 'lucide-react'

type Classification = 'real' | 'deterministic' | 'simulated'
type State = 'pending' | 'running' | 'passed' | 'failed' | 'blocked'

interface DiagTest {
  id: string
  name: string
  classification: Classification
  state: State
  result: string | null
  error: string | null
  artifactUrl: string | null
  startedAt: string | null
  finishedAt: string | null
}

interface DiagRun {
  id: string
  product: string
  createdAt: string
  tests: DiagTest[]
}

const PRODUCT_LABELS: Record<string, string> = {
  riishe: 'RIISHE',
  laxii: 'LAXII',
  jazmii: 'JAZMII',
  'code-giftz': 'CODE GIFTZ',
}

const CLASS_STYLE: Record<Classification, string> = {
  real: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  deterministic: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
  simulated: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
}

const CLASS_LABEL: Record<Classification, string> = {
  real: 'REAL',
  deterministic: 'DETERMINISTIC',
  simulated: 'SIMULATED',
}

function StateIcon({ state }: { state: State }) {
  if (state === 'running') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-white/60" />
  if (state === 'passed') return <CircleCheck className="h-3.5 w-3.5 text-emerald-400" />
  if (state === 'failed') return <CircleX className="h-3.5 w-3.5 text-red-400" />
  if (state === 'blocked') return <MinusCircle className="h-3.5 w-3.5 text-amber-300" />
  return <span className="inline-block h-3.5 w-3.5 rounded-full border border-white/20" />
}

export function ProductTestSuite({ product }: { product: string }) {
  const [open, setOpen] = useState(false)
  const [run, setRun] = useState<DiagRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(
    (runId: string) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch('/api/diagnostics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product, action: 'status', runId }),
          })
          if (!res.ok) {
            stopPolling()
            return
          }
          const data = await res.json()
          if (data?.run) {
            setRun(data.run)
            const active = data.run.tests.some((t: DiagTest) => t.state === 'pending' || t.state === 'running')
            if (!active) stopPolling()
          }
        } catch {
          stopPolling()
        }
      }, 4_000)
    },
    [product, stopPolling],
  )

  const start = useCallback(async () => {
    setBusy(true)
    setStartError(null)
    try {
      const res = await fetch('/api/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product, action: 'run' }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.run) {
        setStartError('The test suite could not start. Try again shortly.')
        return
      }
      setRun(data.run)
      startPolling(data.run.id)
    } catch {
      setStartError('The test suite could not start. Try again shortly.')
    } finally {
      setBusy(false)
    }
  }, [product, startPolling])

  const running = run?.tests.some((t) => t.state === 'pending' || t.state === 'running') ?? false

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-8 sm:px-6" data-testid={`product-test-suite-${product}`}>
      <div className="overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs text-white/70 hover:bg-white/5"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <FlaskConical className="h-3.5 w-3.5" />
          <span className="font-medium">{PRODUCT_LABELS[product] ?? product} test suite</span>
          {run ? (
            <span className="ml-auto text-[10px] text-white/40">
              {run.tests.filter((t) => t.state === 'passed').length}/{run.tests.length} passed
              {running ? ' · running…' : ''}
            </span>
          ) : null}
        </button>
        {open ? (
          <div className="border-t border-white/10 px-4 py-3">
            <div className="mb-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void start()}
                disabled={busy || running}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy || running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {run ? (running ? 'Running…' : 'Run again') : 'Run test suite'}
              </button>
              <span className="text-[10px] leading-tight text-white/40">
                Tests run against the live product with your session. Provider tests are skipped — marked blocked — while the AI provider is rate-limited.
              </span>
            </div>
            {startError ? <div className="mb-2 text-[11px] text-red-300">{startError}</div> : null}
            {run ? (
              <ul className="space-y-1.5">
                {run.tests.map((t) => (
                  <li key={t.id} className="rounded-md border border-white/10 bg-black/20 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StateIcon state={t.state} />
                      <span className="text-xs text-white/85">{t.name}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-[9px] font-medium tracking-wide ${CLASS_STYLE[t.classification]}`}>
                        {CLASS_LABEL[t.classification]}
                      </span>
                      <span className="ml-auto text-[10px] text-white/35">
                        {t.finishedAt ? new Date(t.finishedAt).toLocaleTimeString() : t.startedAt ? '…' : '—'}
                      </span>
                    </div>
                    {t.result ? <div className="mt-1 pl-6 text-[11px] text-white/60">{t.result}</div> : null}
                    {t.error ? <div className="mt-1 pl-6 text-[11px] text-amber-300/90">{t.error}</div> : null}
                    {t.artifactUrl ? (
                      <a
                        href={t.artifactUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block pl-6 text-[11px] text-sky-300 underline decoration-sky-300/40 hover:decoration-sky-300"
                      >
                        Open generated artifact
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-white/45">
                Runs a streaming chat check, persistence check and input-validation check for this product. Real provider calls are labeled REAL; local engine runs are
                labeled DETERMINISTIC; checks that touch no provider are labeled SIMULATED.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
