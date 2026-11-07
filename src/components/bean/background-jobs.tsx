'use client'

/**
 * BEAN Intelligence — Background jobs drawer (universal execution surface).
 *
 * Additive UI (no dashboard redesign, no product-interface change): one
 * entry point where the user can
 *  - submit a BACKGROUND chat (RIISHE) or coding (CODE GIFTZ) job,
 *  - watch every background job across all four products (LAXII/JAZMII
 *    submissions appear here too),
 *  - open finished artifacts (image/video/conversation/project),
 *  - cancel queued or running jobs.
 *
 * Execution continues server-side regardless of this drawer: close the tab,
 * come back later — history and artifacts are persisted and retrievable.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  ListChecks,
  X,
  ChevronRight,
  Ban,
  Image as ImageIcon,
  Video,
  Code2,
} from 'lucide-react'
import { RiisheIcon } from '@/components/riishe/RiisheIcon'
import type { ViewId } from './shell'

interface JobRow {
  id: string
  product: string
  task: string
  status: string
  legacyStatus: string
  progress: number
  errorCode: string | null
  errorMessage: string | null
  result: Record<string, unknown> | null
  queuedAt: string
  finishedAt: string | null
}

const ACTIVE = new Set(['queued', 'retry_wait', 'starting', 'running', 'streaming', 'finalizing'])

const PRODUCT_META: Record<string, { label: string; icon: React.ElementType }> = {
  riishe: { label: 'RIISHE', icon: RiisheIcon },
  laxii: { label: 'LAXII', icon: ImageIcon },
  jazmii: { label: 'JAZMII', icon: Video },
  'code-giftz': { label: 'CODE GIFTZ', icon: Code2 },
}

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export function BackgroundJobs({ onNavigate }: { onNavigate: (v: ViewId) => void }) {
  const [open, setOpen] = useState(false)
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [product, setProduct] = useState<'riishe' | 'code-giftz'>('riishe')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const activeCount = jobs.filter((j) => ACTIVE.has(j.status)).length

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/jobs?take=30', { cache: 'no-store' })
      if (!res.ok) return
      const json = (await res.json()) as { jobs?: JobRow[] }
      setJobs(json.jobs ?? [])
    } catch {
      /* transient */
    }
  }, [])

  // Poll while the drawer is open; also keep a slow poll for the badge.
  useEffect(() => {
    void load()
    const ms = open ? 2_500 : 10_000
    pollRef.current = setInterval(() => void load(), ms)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [open, load])

  const submit = async () => {
    if (!message.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product, message: message.trim() }),
      })
      const json = (await res.json()) as { error?: string; job?: JobRow }
      if (!res.ok) {
        setError(json.error ?? 'Submission failed.')
        return
      }
      setMessage('')
      await load()
    } catch {
      setError('Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const cancel = async (id: string) => {
    try {
      await fetch(`/api/ai/jobs/${id}/cancel`, { method: 'POST' })
      await load()
    } catch {
      /* transient */
    }
  }

  const artifactOf = (j: JobRow): { label: string; action: () => void } | null => {
    if (j.status !== 'completed' || !j.result) return null
    if (j.product === 'laxii' && typeof j.result.imageUrl === 'string') {
      return { label: 'Open image', action: () => window.open(j.result!['imageUrl'] as string, '_blank') }
    }
    if (j.product === 'jazmii' && typeof j.result.videoUrl === 'string') {
      return { label: 'Open video', action: () => window.open(j.result!['videoUrl'] as string, '_blank') }
    }
    if (j.product === 'riishe' && typeof j.result.conversationId === 'string') {
      return { label: 'Open conversation', action: () => onNavigate('riishe') }
    }
    if (j.product === 'code-giftz' && typeof j.result.projectId === 'string') {
      return { label: 'Open project', action: () => onNavigate('code-giftz') }
    }
    return null
  }

  return (
    <>
      {/* Floating launcher — visible on every view */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Background jobs"
        className={cn(
          'fixed bottom-5 right-5 z-40 flex h-11 items-center gap-2 rounded-full border border-[rgba(212,175,55,0.25)] bg-[#101014]/95 px-4 text-xs text-[#f0c75e] shadow-[0_4px_24px_rgba(0,0,0,0.5)] backdrop-blur transition-transform hover:scale-[1.03]',
        )}
      >
        <ListChecks className="h-4 w-4" />
        <span className="hidden sm:inline">Background jobs</span>
        {activeCount > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[rgba(212,175,55,0.18)] px-1 text-[10px] font-semibold">
            {activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <aside
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-[rgba(212,175,55,0.18)] bg-[#0d0d10]"
            role="dialog"
            aria-label="Background jobs"
          >
            <div className="flex items-center justify-between border-b border-[rgba(212,175,55,0.12)] px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-white/90">Background jobs</div>
                <div className="text-[11px] text-white/40">
                  Execution continues even if you leave this page.
                </div>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-white/50 hover:text-white/80">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Submit a background chat/coding job */}
            <div className="border-b border-[rgba(212,175,55,0.12)] px-4 py-3">
              <div className="mb-2 flex gap-1.5">
                {(['riishe', 'code-giftz'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setProduct(p)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[11px] transition-colors',
                      product === p
                        ? 'bg-[rgba(212,175,55,0.14)] text-[#f0c75e]'
                        : 'text-white/45 hover:text-white/75',
                    )}
                  >
                    {PRODUCT_META[p].label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void submit()
                    }
                  }}
                  placeholder={product === 'riishe' ? 'Ask anything — runs in background…' : 'Describe a coding task…'}
                  className="h-9 border-white/10 bg-white/5 text-xs text-white/85 placeholder:text-white/25"
                />
                <Button
                  size="sm"
                  onClick={() => void submit()}
                  disabled={submitting || !message.trim()}
                  className="h-9 shrink-0 bg-[#d4af37] px-3 text-[11px] font-semibold text-black hover:bg-[#e7b94c]"
                >
                  {submitting ? '…' : 'Submit'}
                </Button>
              </div>
              {error ? <div className="mt-1.5 text-[11px] text-red-400">{error}</div> : null}
            </div>

            {/* Job history */}
            <div className="bean-scroll flex-1 overflow-y-auto px-4 py-3">
              {jobs.length === 0 ? (
                <div className="mt-8 text-center text-xs text-white/35">
                  No background jobs yet. Submit one above — or use any product; LAXII and JAZMII
                  submissions appear here too.
                </div>
              ) : (
                <ul className="space-y-2">
                  {jobs.map((j) => {
                    const meta = PRODUCT_META[j.product] ?? { label: j.product, icon: ListChecks }
                    const isActive = ACTIVE.has(j.status)
                    const artifact = artifactOf(j)
                    return (
                      <li
                        key={j.id}
                        className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <meta.icon className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                          <span className="text-xs font-medium text-white/80">{meta.label}</span>
                          <span className="text-[10px] text-white/35">{j.task}</span>
                          <span className="ml-auto flex items-center gap-2">
                            <span
                              className={cn(
                                'rounded px-1.5 py-0.5 text-[10px]',
                                j.status === 'completed'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : j.status === 'failed' || j.status === 'cancelled'
                                    ? 'bg-red-500/15 text-red-300'
                                    : isActive
                                      ? 'bg-[rgba(212,175,55,0.15)] text-[#f0c75e]'
                                      : 'bg-white/10 text-white/50',
                              )}
                            >
                              {j.legacyStatus === 'running' && isActive && j.status !== 'running'
                                ? j.status
                                : j.legacyStatus}
                            </span>
                            {isActive && j.progress > 0 ? (
                              <span className="text-[10px] text-white/45">{j.progress}%</span>
                            ) : null}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] text-white/35">
                          <span>{timeAgo(j.queuedAt)}</span>
                          {j.errorMessage ? <span className="truncate text-red-300/80">· {j.errorMessage}</span> : null}
                          <span className="ml-auto flex items-center gap-2">
                            {artifact ? (
                              <button
                                onClick={artifact.action}
                                className="flex items-center gap-0.5 text-[#f0c75e] hover:underline"
                              >
                                {artifact.label} <ChevronRight className="h-3 w-3" />
                              </button>
                            ) : null}
                            {isActive ? (
                              <button
                                onClick={() => void cancel(j.id)}
                                className="flex items-center gap-0.5 text-white/45 hover:text-red-300"
                              >
                                <Ban className="h-3 w-3" /> Cancel
                              </button>
                            ) : null}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  )
}
