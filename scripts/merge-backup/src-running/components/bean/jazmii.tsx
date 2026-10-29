'use client'

/**
 * BEAN Intelligence — JAZMII workspace (video generation).
 * TRUTH POLICY: when no video backend is deployed, this UI says exactly
 * that. Requests are recorded as `unsupported` — never shown as queued,
 * running or completed.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { beanFetch, GoldBadge, StatusDot, timeAgo } from './shared'
import { Video, ShieldAlert, Info } from 'lucide-react'

interface Availability { available: boolean; reason: string; product: string }
interface VideoJob { id: string; status: string; errorCode: string | null; errorMessage: string | null; queuedAt: string }

export function Jazmii() {
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [jobs, setJobs] = useState<VideoJob[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await beanFetch<{ productAvailability: Availability; jobs: VideoJob[] }>('/api/jazmii/generate')
      setAvailability(d.productAvailability)
      setJobs(d.jobs)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { void load() }, [load])

  async function submit() {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const d = await beanFetch<{ rejected: boolean; code: string; message: string }>('/api/jazmii/generate', {
        method: 'POST',
        json: { prompt: p },
      })
      setMessage(d.message)
      await load()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center gap-2">
        <Video className="h-5 w-5 text-[#d4af37]" />
        <h1 className="text-xl font-semibold tracking-tight">JAZMII <span className="text-white/40">— video generation</span></h1>
      </div>

      <div className="bean-glass mb-6 rounded-xl border-amber-500/25 p-5">
        <div className="mb-2 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-amber-300">Availability: reported truthfully</span>
        </div>
        <p className="text-[13px] leading-relaxed text-white/60">
          {availability?.reason ??
            'Checking backend availability…'}
        </p>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-white/40">
          <StatusDot ok={false} /> No video-generation backend is currently deployed for this environment.
        </div>
      </div>

      <div className="bean-glass rounded-xl p-5">
        <label htmlFor="jazmii-prompt" className="mb-1.5 block text-xs text-white/55">Video prompt</label>
        <Textarea
          id="jazmii-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Describe the video you want…"
          className="resize-none bg-black/30"
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[11px] text-white/35">
            Duration, resolution and speed options are intentionally hidden — BEAN does not advertise parameters no deployed backend can honor.
          </p>
          <Button onClick={() => void submit()} disabled={busy || prompt.trim().length < 3} variant="outline" className="ml-4 shrink-0 border-[rgba(212,175,55,0.4)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]">
            {busy ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
        {message ? (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
            <Info className="mr-1.5 inline h-3.5 w-3.5" />
            {message}
          </div>
        ) : null}
      </div>

      {jobs.length > 0 ? (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-semibold text-white/80">Request history</h3>
          <div className="space-y-2">
            {jobs.map((j) => (
              <div key={j.id} className="bean-glass flex items-center justify-between rounded-lg px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[13px] text-white/70">Video request</div>
                  <div className="truncate text-[11px] text-white/35">{j.errorMessage}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <GoldBadge tone="neutral">{j.status}</GoldBadge>
                  <span className="text-[10px] text-white/30">{timeAgo(j.queuedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
