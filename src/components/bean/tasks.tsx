'use client'

/**
 * BEAN Intelligence — Task receipts (Trust Engine surface).
 *
 * The owner-facing view of the Trust Engine: every meaningful agent task with
 * its truthful lifecycle status, planned vs actually-attempted steps, evidence
 * with provenance, scoped approvals and the digest-stamped execution receipt.
 *
 * Honesty rules for this screen:
 *  - statuses are shown exactly as the ledger records them
 *    (completed_with_limitations is never rendered as plain completed);
 *  - technical detail (steps, evidence, digest) lives in expandable details;
 *  - no capability is implied that the ledger does not record.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { beanFetch } from './shared'
import { ChevronDown, ChevronRight, RefreshCw, XCircle, Check, Ban } from 'lucide-react'

interface TaskRow {
  id: string
  product: string
  kind: string
  title: string
  status: string
  jobId: string | null
  createdAt: string
  completedAt: string | null
}

interface TaskDetail {
  task: {
    id: string
    product: string
    kind: string
    title: string
    requestPreview: string | null
    requestChars: number | null
    status: string
    outcomeSummary: string | null
    verificationSummary: string | null
    limitations: string[]
    failureNote: string | null
    jobId: string | null
    startedAt: string | null
    completedAt: string | null
    cancelledAt: string | null
    createdAt: string
  }
  steps: Array<{ seq: number; kind: string; title: string; status: string; errorNote: string | null }>
  evidence: Array<{ kind: string; ref: string; title: string | null; origin: string; note: string | null }>
  approvals: Array<{ id: string; summary: string; status: string; requestedAt: string }>
  checkpoints: Array<{ seq: number; label: string; status: string; createdAt: string }>
}

interface Receipt {
  receiptDigest: string
  counts: { steps: number; evidence: number; approvals: number; checkpoints: number }
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  waiting_for_approval: 'Waiting for your approval',
  running: 'Running',
  completed: 'Completed',
  completed_with_limitations: 'Completed with limitations',
  partially_completed: 'Partially completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

function statusClasses(status: string): string {
  switch (status) {
    case 'completed':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    case 'completed_with_limitations':
    case 'partially_completed':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    case 'failed':
      return 'border-red-500/30 bg-red-500/10 text-red-300'
    case 'cancelled':
      return 'border-white/15 bg-white/5 text-white/50'
    case 'waiting_for_approval':
      return 'border-[#d4af37]/50 bg-[#d4af37]/15 text-[#f0c75e]'
    default:
      return 'border-white/15 bg-white/5 text-white/60'
  }
}

function StepStatusDot({ status }: { status: string }) {
  const color =
    status === 'done'
      ? 'bg-emerald-400'
      : status === 'failed'
        ? 'bg-red-400'
        : status === 'running'
          ? 'bg-[#d4af37] animate-pulse'
          : status === 'skipped'
            ? 'bg-white/30'
            : 'bg-white/20'
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} />
}

export function Tasks() {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [showSteps, setShowSteps] = useState(true)
  const [showEvidence, setShowEvidence] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await beanFetch<{ tasks: TaskRow[] }>('/api/trust/tasks?take=60')
      setTasks(d.tasks)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load task receipts.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    const d = await beanFetch<TaskDetail>(`/api/trust/tasks/${id}`)
    setDetail(d)
    try {
      const r = await beanFetch<{ receipt: Receipt }>(`/api/trust/tasks/${id}/receipt`)
      setReceipt(r.receipt)
    } catch {
      setReceipt(null)
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 15_000)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  useEffect(() => {
    if (!selected) {
      setDetail(null)
      setReceipt(null)
      return
    }
    void loadDetail(selected).catch(() => setDetail(null))
  }, [selected, loadDetail])

  const decide = async (approvalId: string, decision: 'grant' | 'deny') => {
    if (!selected) return
    setBusy(true)
    try {
      await beanFetch(`/api/trust/tasks/${selected}/approvals/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      await Promise.all([load(), loadDetail(selected)])
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await beanFetch(`/api/trust/tasks/${selected}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      await Promise.all([load(), loadDetail(selected)])
    } catch {
      // An already-settled task keeps its recorded outcome; refresh shows it.
      await Promise.all([load(), loadDetail(selected)])
    } finally {
      setBusy(false)
    }
  }

  const activeStatuses = ['planned', 'running', 'waiting_for_approval']

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 lg:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white/90">Task receipts</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/45">
            Every agent task records what was planned, what was actually attempted, the evidence
            behind it and how it was verified — including its limits. A task is only marked
            completed when a verification result supports that.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="shrink-0 border-white/10 bg-transparent text-white/60 hover:bg-white/5 hover:text-white/85"
        >
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        {/* Task list */}
        <div className="min-w-0 space-y-2">
          {loading && tasks.length === 0 && (
            <div className="rounded-lg border border-white/10 px-4 py-6 text-sm text-white/40">
              Loading task receipts…
            </div>
          )}
          {!loading && tasks.length === 0 && (
            <div className="rounded-lg border border-white/10 px-4 py-6 text-sm text-white/40">
              No task receipts yet. Background RIISHE turns (and future agent work) record their
              execution here — including what could not be verified.
            </div>
          )}
          {tasks.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
                selected === t.id
                  ? 'border-[#d4af37]/40 bg-[#d4af37]/10'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-white/85">{t.title || '(untitled task)'}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusClasses(t.status)}`}>
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-white/35">
                <span className="uppercase tracking-wide">{t.product}</span>
                <span>·</span>
                <span>{new Date(t.createdAt).toLocaleString()}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="min-w-0">
          {!detail && (
            <div className="rounded-lg border border-white/10 px-4 py-8 text-center text-sm text-white/35">
              Select a task to inspect its execution receipt.
            </div>
          )}
          {detail && (
            <div className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${statusClasses(detail.task.status)}`}>
                    {STATUS_LABEL[detail.task.status] ?? detail.task.status}
                  </span>
                  {activeStatuses.includes(detail.task.status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void cancel()}
                      className="border-red-500/30 bg-transparent text-red-300 hover:bg-red-500/10"
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" /> Cancel task
                    </Button>
                  )}
                </div>
                <h2 className="mt-3 text-base font-medium text-white/90">{detail.task.title}</h2>
                {detail.task.requestPreview && (
                  <p className="mt-1 line-clamp-3 text-sm text-white/50">
                    “{detail.task.requestPreview}
                    {detail.task.requestChars && detail.task.requestChars > detail.task.requestPreview.length
                      ? '…'
                      : ''}”
                  </p>
                )}

                {detail.task.outcomeSummary && (
                  <p className="mt-3 text-sm text-white/70">{detail.task.outcomeSummary}</p>
                )}
                {detail.task.verificationSummary && (
                  <div className="mt-3 rounded-md border border-white/10 bg-black/30 p-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">Verification result</div>
                    <div className="mt-1 text-sm text-white/70">{detail.task.verificationSummary}</div>
                  </div>
                )}
                {detail.task.failureNote && (
                  <div className="mt-3 rounded-md border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-200/80">
                    {detail.task.failureNote}
                  </div>
                )}
                {detail.task.limitations.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-amber-300/60">Limitations</div>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-white/55">
                      {detail.task.limitations.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {receipt && (
                  <details className="mt-4 text-xs text-white/40">
                    <summary className="cursor-pointer select-none hover:text-white/60">
                      Execution receipt · digest {receipt.receiptDigest.slice(0, 12)}… ({receipt.counts.steps} steps ·{' '}
                      {receipt.counts.evidence} evidence · {receipt.counts.approvals} approvals)
                    </summary>
                    <div className="mt-2 break-all rounded bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-white/45">
                      {receipt.receiptDigest}
                    </div>
                    <div className="mt-1 text-[10px] text-white/30">
                      The digest covers the full receipt content (canonical JSON, sha-256). Any change to the recorded
                      ledger changes the digest — the receipt always reflects the real ledger.
                    </div>
                  </details>
                )}
              </div>

              {/* Pending approvals */}
              {detail.approvals.some((a) => a.status === 'requested') && (
                <div className="rounded-lg border border-[#d4af37]/40 bg-[#d4af37]/[0.07] p-4">
                  <div className="text-sm font-medium text-[#f0c75e]">This task is waiting for your approval</div>
                  {detail.approvals
                    .filter((a) => a.status === 'requested')
                    .map((a) => (
                      <div key={a.id} className="mt-3 flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/30 p-3">
                        <span className="text-sm text-white/75">{a.summary}</span>
                        <div className="flex shrink-0 gap-2">
                          <Button size="sm" disabled={busy} onClick={() => void decide(a.id, 'grant')}>
                            <Check className="mr-1 h-3.5 w-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void decide(a.id, 'deny')}
                            className="border-white/15 bg-transparent text-white/60 hover:bg-white/5"
                          >
                            <Ban className="mr-1 h-3.5 w-3.5" /> Deny
                          </Button>
                        </div>
                      </div>
                    ))}
                  <p className="mt-2 text-[11px] text-white/35">
                    An approval covers exactly this one action — it is consumed when used and never carries over.
                  </p>
                </div>
              )}

              {/* Steps */}
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <button
                  className="flex w-full items-center gap-2 text-sm font-medium text-white/75"
                  onClick={() => setShowSteps((v) => !v)}
                >
                  {showSteps ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Steps ({detail.steps.length})
                </button>
                {showSteps && (
                  <ol className="mt-3 space-y-2">
                    {detail.steps.map((s) => (
                      <li key={s.seq} className="flex items-start gap-2.5">
                        <StepStatusDot status={s.status} />
                        <div className="min-w-0">
                          <div className="text-sm text-white/75">
                            {s.title}{' '}
                            <span className="text-[10px] uppercase tracking-wide text-white/30">
                              {s.status}
                            </span>
                          </div>
                          {s.errorNote && <div className="text-xs text-red-300/80">{s.errorNote}</div>}
                        </div>
                      </li>
                    ))}
                    {detail.steps.length === 0 && <li className="text-sm text-white/35">No steps recorded.</li>}
                  </ol>
                )}
              </div>

              {/* Evidence */}
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
                <button
                  className="flex w-full items-center gap-2 text-sm font-medium text-white/75"
                  onClick={() => setShowEvidence((v) => !v)}
                >
                  {showEvidence ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Evidence ({detail.evidence.length})
                </button>
                {showEvidence && (
                  <ul className="mt-3 space-y-2">
                    {detail.evidence.map((e, i) => (
                      <li key={i} className="text-sm">
                        <div className="flex items-center gap-2">
                          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40">
                            {e.kind}
                          </span>
                          {e.origin === 'model_interpretation' && (
                            <span className="rounded border border-amber-500/30 px-1.5 py-0.5 text-[10px] text-amber-300/80">
                              model interpretation
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-white/70">{e.title ?? e.ref}</div>
                        {e.note && <div className="text-[11px] text-white/35">{e.note}</div>}
                      </li>
                    ))}
                    {detail.evidence.length === 0 && (
                      <li className="text-sm text-white/35">No evidence recorded for this task.</li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
