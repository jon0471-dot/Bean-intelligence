'use client'

/**
 * BEAN Intelligence — JAZMII workspace (video generation).
 *
 * REAL async experience: submit → persistent job → progress polling →
 * preview → download → history → cancellation. Honest by construction:
 *  - availability is reported from the backend, never assumed;
 *  - job rows are shown EXACTLY as the server records them (queued / running /
 *    completed / failed) — a failed job never renders as anything else;
 *  - no provider/model identity appears anywhere in this file or its payloads;
 *  - cancellation means stop-tracking (the provider exposes no cancel API) —
 *    the copy says exactly that.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { beanFetch, GoldBadge, StatusDot, timeAgo } from './shared'
import { Video, ShieldAlert, Info, Download, X, Film } from 'lucide-react'

interface Availability { available: boolean; reason: string; product: string }
interface VideoJob {
  id: string
  status: string
  progress: number
  errorCode: string | null
  errorMessage: string | null
  videoUrl: string | null
  format: string | null
  bytes: number | null
  queuedAt: string
  finishedAt: string | null
}

const SIZE_PRESETS = [
  { label: '16:9 landscape', value: '1280x720' },
  { label: '9:16 portrait', value: '720x1280' },
]
const DURATIONS = [5, 10]

function humanBytes(n: number | null): string {
  if (n === null || Number.isNaN(n)) return ''
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function Jazmii() {
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [jobs, setJobs] = useState<VideoJob[]>([])
  const [prompt, setPrompt] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageName, setImageName] = useState<string | null>(null)
  const [size, setSize] = useState<string>('1280x720')
  const [duration, setDuration] = useState<number>(5)
  const [quality, setQuality] = useState<'speed' | 'quality'>('quality')
  const [withAudio, setWithAudio] = useState<boolean>(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await beanFetch<{ productAvailability: Availability; jobs: VideoJob[] }>('/api/jazmii/generate')
      setAvailability(d.productAvailability)
      setJobs(d.jobs)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { void load() }, [load])

  // Progress polling — active only while at least one job is queued/running.
  useEffect(() => {
    const pending = jobs.some((j) => j.status === 'queued' || j.status === 'running')
    if (pending && pollRef.current === null) {
      pollRef.current = setInterval(() => { void load() }, 4000)
    }
    if (!pending && pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    return () => {
      if (pollRef.current !== null && !jobs.some((j) => j.status === 'queued' || j.status === 'running')) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [jobs, load])

  function pickImage(file: File | null) {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      setMessage('Reference image is too large (max 4 MB).')
      return
    }
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      setMessage('Reference image must be PNG, JPEG or WebP.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setImageUrl(String(reader.result))
      setImageName(file.name)
      setMessage(null)
    }
    reader.readAsDataURL(file)
  }

  async function submit() {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    setMessage(null)
    try {
      await beanFetch<{ job: { id: string } }>('/api/jazmii/generate', {
        method: 'POST',
        json: {
          prompt: p,
          ...(imageUrl ? { imageUrl } : {}),
          quality,
          withAudio,
          size,
          durationSec: duration,
        },
      })
      await load()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function cancel(id: string) {
    try {
      await beanFetch(`/api/jazmii/jobs/${id}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  const operational = availability?.available === true

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center gap-2">
        <Video className="h-5 w-5 text-[#d4af37]" />
        <h1 className="text-xl font-semibold tracking-tight">JAZMII <span className="text-white/40">— video generation</span></h1>
      </div>

      <div className="bean-glass mb-6 rounded-xl border-amber-500/25 p-5">
        <div className="mb-2 flex items-center gap-2">
          {operational ? <Film className="h-4 w-4 text-emerald-400" /> : <ShieldAlert className="h-4 w-4 text-amber-400" />}
          <span className="text-sm font-semibold text-amber-300">Availability: reported truthfully</span>
        </div>
        <p className="text-[13px] leading-relaxed text-white/60">
          {availability?.reason ?? 'Checking backend availability…'}
        </p>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-white/40">
          <StatusDot ok={operational} pulse={!operational} />
          {operational
            ? 'Generation runs as a tracked job — this page never holds the request open. Each completed job is the evidence.'
            : 'Video generation is not currently accepting jobs for this environment.'}
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

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs text-white/55">Reference image (optional — image-to-video)</p>
            <input
              id="jazmii-image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
              className="w-full cursor-pointer rounded-md border border-white/10 bg-black/30 p-2 text-[11px] text-white/60 file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-[11px] file:text-white/80"
            />
            {imageName ? (
              <button
                type="button"
                onClick={() => { setImageUrl(null); setImageName(null) }}
                className="mt-1 text-[11px] text-amber-300/80 hover:text-amber-200"
              >
                Remove {imageName}
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs text-white/55">
            <label className="block">
              Aspect
              <select
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 p-2 text-xs text-white/80"
              >
                {SIZE_PRESETS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              Duration
              <select
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 p-2 text-xs text-white/80"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>{d}s</option>
                ))}
              </select>
            </label>
            <label className="block">
              Quality
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as 'speed' | 'quality')}
                className="mt-1 w-full rounded-md border border-white/10 bg-black/30 p-2 text-xs text-white/80"
              >
                <option value="quality">Quality</option>
                <option value="speed">Speed</option>
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs text-white/55">
              <input
                type="checkbox"
                checked={withAudio}
                onChange={(e) => setWithAudio(e.target.checked)}
                className="h-4 w-4 accent-[#d4af37]"
              />
              Generate audio
            </label>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <p className="text-[11px] text-white/35">
            Rendering runs entirely on the backend. Invalid options are rejected by the provider and shown verbatim — nothing is silently changed.
          </p>
          <Button onClick={() => void submit()} disabled={busy || prompt.trim().length < 3 || !operational} variant="outline" className="ml-4 shrink-0 border-[rgba(212,175,55,0.4)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]">
            {busy ? 'Submitting…' : 'Generate video'}
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
          <h3 className="mb-2 text-sm font-semibold text-white/80">Generation history</h3>
          <div className="space-y-2">
            {jobs.map((j) => {
              const active = j.status === 'queued' || j.status === 'running'
              return (
                <div key={j.id} className="bean-glass rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] text-white/70">
                        {j.status === 'completed' ? 'Video' : 'Video job'} · {timeAgo(j.queuedAt)}
                        {j.bytes !== null && j.status === 'completed' ? ` · ${humanBytes(j.bytes)}` : ''}
                      </div>
                      {active ? (
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-[#d4af37] transition-all" style={{ width: `${Math.max(4, j.progress)}%` }} />
                        </div>
                      ) : null}
                      {j.status === 'failed' && j.errorMessage ? (
                        <div className="mt-1 truncate text-[11px] text-red-300/80" title={j.errorMessage}>{j.errorMessage}</div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {j.status === 'completed' && j.videoUrl ? (
                        <>
                          <a href={j.videoUrl} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.4)] px-2 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]">
                            <Download className="h-3 w-3" /> Download
                          </a>
                          <video src={j.videoUrl} controls preload="metadata" className="h-14 w-24 rounded-md border border-white/10 bg-black" />
                        </>
                      ) : null}
                      {active ? (
                        <button
                          type="button"
                          onClick={() => void cancel(j.id)}
                          className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:bg-white/5"
                          title="Stop tracking this job"
                        >
                          <X className="h-3 w-3" /> Cancel
                        </button>
                      ) : null}
                      <GoldBadge tone={j.status === 'completed' ? 'green' : j.status === 'failed' ? 'red' : 'neutral'}>{j.status}</GoldBadge>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
