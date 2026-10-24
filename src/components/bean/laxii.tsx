'use client'

/**
 * BEAN Intelligence — LAXII workspace (image generation studio).
 * Shows real job progression: queued → running → completed/failed.
 * Completed jobs offer authenticated preview + download.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { beanFetch, GoldBadge, Spinner, EmptyState, timeAgo } from './shared'
import { cn } from '@/lib/utils'
import { Image as ImageIcon, Download, Wand2, XCircle, CheckCircle2, Clock } from 'lucide-react'

interface SizeOpt { value: string; label: string }
interface Job {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  size: string | null
  errorCode: string | null
  errorMessage: string | null
  imageUrl: string | null
  width?: number
  height?: number
  format?: string
  bytes?: number
  durationMs?: number
  queuedAt: string
}

export function Laxii({ sizes }: { sizes: SizeOpt[] }) {
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState(sizes[0]?.value ?? '1024x1024')
  const [jobs, setJobs] = useState<Job[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadJobs = useCallback(async () => {
    try {
      const d = await beanFetch<{ jobs: Job[] }>('/api/laxii/generate')
      setJobs(d.jobs)
      return d.jobs
    } catch {
      return []
    }
  }, [])

  useEffect(() => {
    void loadJobs()
  }, [loadJobs])

  // Poll while any job is in flight.
  useEffect(() => {
    const inflight = jobs.some((j) => j.status === 'queued' || j.status === 'running')
    if (inflight && !timerRef.current) {
      timerRef.current = setInterval(async () => {
        const fresh = await loadJobs()
        if (!fresh.some((j) => j.status === 'queued' || j.status === 'running')) {
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
          const done = fresh.find((j) => j.status === 'completed')
          if (done) setNotice('Image ready — previews and downloads are live below.')
        }
      }, 4000)
    }
    return () => {
      if (timerRef.current && !inflight) { clearInterval(timerRef.current); timerRef.current = null }
    }
  }, [jobs, loadJobs])

  async function submit() {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await beanFetch('/api/laxii/generate', { method: 'POST', json: { prompt: p, size } })
      setNotice('Job queued. Generation typically takes about a minute — status below updates live.')
      await loadJobs()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-3.5rem-2rem)] lg:grid-cols-[380px_1fr]">
      {/* Composer */}
      <div className="border-b border-[rgba(212,175,55,0.1)] p-5 lg:border-b-0 lg:border-r">
        <div className="mb-4 flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-[#d4af37]" />
          <h2 className="text-sm font-semibold tracking-wide">LAXII studio</h2>
        </div>

        <label htmlFor="laxii-prompt" className="mb-1.5 block text-xs text-white/55">Prompt</label>
        <Textarea
          id="laxii-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          maxLength={4000}
          placeholder="Describe the image: subject, style, lighting, mood…"
          className="resize-none bg-black/30"
        />
        <div className="mt-1 text-right text-[10px] text-white/30">{prompt.length}/4000</div>

        <div className="mt-4">
          <div className="mb-1.5 text-xs text-white/55">Dimensions</div>
          <div className="grid grid-cols-2 gap-1.5">
            {sizes.map((s) => (
              <button
                key={s.value}
                onClick={() => setSize(s.value)}
                className={cn(
                  'rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors',
                  size === s.value
                    ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                    : 'border-white/10 text-white/55 hover:border-[rgba(212,175,55,0.3)]',
                )}
              >
                <div className="font-medium">{s.label}</div>
                <div className="text-white/35">{s.value}</div>
              </button>
            ))}
          </div>
        </div>

        <Button
          onClick={() => void submit()}
          disabled={busy || prompt.trim().length < 3}
          className="mt-5 w-full bg-[#d4af37] font-semibold text-black hover:bg-[#e6c25a]"
        >
          {busy ? <Spinner className="border-black/30 border-t-black" /> : <ImageIcon className="mr-1.5 h-4 w-4" />}
          Generate image
        </Button>

        {error ? <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
        {notice ? <div className="mt-3 rounded-md border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.07)] px-3 py-2 text-xs text-[#f0c75e]">{notice}</div> : null}

        <p className="mt-4 text-[11px] leading-relaxed text-white/35">
          Images are delivered as JPEG. Every job passes validation, quota and concurrency checks server-side.
        </p>
      </div>

      {/* Gallery */}
      <div className="min-w-0 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/80">Your generations</h3>
          <span className="text-xs text-white/35">{jobs.length} job{jobs.length === 1 ? '' : 's'}</span>
        </div>
        {jobs.length === 0 ? (
          <EmptyState icon={<ImageIcon className="h-10 w-10" />} title="No generations yet" hint="Write a prompt and choose dimensions — completed images appear here with download options." />
        ) : (
          <ScrollArea className="h-[calc(100vh-14rem)] min-h-[420px]">
            <div className="grid gap-4 pr-3 sm:grid-cols-2 xl:grid-cols-3">
              {jobs.map((j) => (
                <div key={j.id} className="bean-glass overflow-hidden rounded-xl">
                  <div className="relative flex aspect-square items-center justify-center bg-black/40">
                    {j.status === 'completed' && j.imageUrl ? (
                      <img src={j.imageUrl} alt={`Generated image ${j.size ?? ''}`} className="h-full w-full object-cover" loading="lazy" />
                    ) : j.status === 'failed' ? (
                      <div className="p-4 text-center">
                        <XCircle className="mx-auto mb-2 h-8 w-8 text-red-400" />
                        <p className="text-xs text-red-300">{j.errorMessage ?? 'Generation failed.'}</p>
                        {j.errorCode ? <p className="mt-1 text-[10px] text-white/30">{j.errorCode}</p> : null}
                      </div>
                    ) : (
                      <div className="w-full p-5 text-center">
                        <Spinner className="mx-auto mb-3 h-6 w-6" />
                        <div className="mb-2 text-xs text-white/50">
                          {j.status === 'queued' ? 'Queued…' : 'Generating… this can take about a minute'}
                        </div>
                        <Progress value={j.progress} className="h-1.5 bg-white/5" />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {j.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : j.status === 'failed' ? <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" /> : <Clock className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />}
                        <span className="truncate text-[11px] text-white/45">{j.size} · {timeAgo(j.queuedAt)}</span>
                      </div>
                      {j.durationMs ? <div className="text-[10px] text-white/30">{(j.durationMs / 1000).toFixed(1)}s · {j.bytes ? Math.round(j.bytes / 1024) : '?'} KB</div> : null}
                    </div>
                    {j.status === 'completed' && j.imageUrl ? (
                      <a
                        href={j.imageUrl}
                        download={`bean-laxii-${j.id}.jpg`}
                        className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)]"
                      >
                        <Download className="h-3 w-3" /> Download
                      </a>
                    ) : j.status === 'failed' ? (
                      <GoldBadge tone="red">Failed</GoldBadge>
                    ) : (
                      <GoldBadge tone="gold">{j.status}</GoldBadge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
