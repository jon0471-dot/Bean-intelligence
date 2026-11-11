'use client'

/**
 * BEAN Intelligence — LAXII workspace (preservation-first image studio).
 *
 * Extended in place (2026-10-31): the original text-to-image composer and
 * job gallery behavior/design are preserved; Enhance and Edit modes, a
 * visible brush mask editor (edit/protect strokes + erase), before/after +
 * difference-map views and the computed preservation report are added within
 * the same gold design system. Availability shown here mirrors the server's
 * truthful capability state.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { beanFetch, GoldBadge, Spinner, EmptyState, timeAgo } from './shared'
import { cn } from '@/lib/utils'
import {
  Image as ImageIcon,
  Download,
  Wand2,
  XCircle,
  CheckCircle2,
  Clock,
  Upload,
  Brush,
  Eraser,
  Shield,
  Contrast,
  Sparkles,
  Scissors,
  Trash2,
} from 'lucide-react'

interface SizeOpt { value: string; label: string }
interface PreservationReport {
  exactPreservedPct: number
  blendedPct: number
  changedPct: number
  dimensionsChanged: boolean
  generativeUsed: boolean
  editablePct: number
  summary: string
  protectedRegions?: Array<{ changed: boolean; source: string }>
  identitySimilarity?: { score: number; threshold: number; passed: boolean; metric: string }
}
interface Job {
  id: string
  task?: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  size: string | null
  errorCode: string | null
  errorMessage: string | null
  imageUrl: string | null
  originalUrl?: string | null
  diffUrl?: string | null
  report?: PreservationReport | null
  width?: number
  height?: number
  format?: string
  bytes?: number
  durationMs?: number
  queuedAt: string
}
interface Asset {
  id: string
  width: number | null
  height: number | null
  bytes: number
  url: string
}
type Mode = 'create' | 'enhance' | 'edit'
type BrushKind = 'edit' | 'protect'

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

async function uploadAsset(file: File, kind: 'original' | 'mask'): Promise<Asset> {
  const form = new FormData()
  form.append('file', file)
  form.append('kind', kind)
  const d = await beanFetch<{ asset: Asset }>('/api/laxii/assets', { method: 'POST', body: form })
  return d.asset
}

function canvasHasInk(c: HTMLCanvasElement | null): boolean {
  if (!c) return false
  const ctx = c.getContext('2d')
  if (!ctx) return false
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true
  return false
}

function canvasToPngFile(canvas: HTMLCanvasElement): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Mask export failed.')); return }
      resolve(new File([blob], 'mask.png', { type: 'image/png' }))
    }, 'image/png')
  })
}

export function Laxii({ sizes }: { sizes: SizeOpt[] }) {
  const [mode, setMode] = useState<Mode>('create')

  // ---- Create ----
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState(sizes[0]?.value ?? '1024x1024')
  // ---- CUSTOM IMAGE DIMENSIONS (2026-11-11): additive state only — the
  // preset flow and its behavior are untouched. Bounds mirror the server's
  // authoritative validation so malformed requests are caught client-side
  // first, then enforced again server-side.
  const CUSTOM_MIN_PX = 256
  const CUSTOM_MAX_PX = 4096
  const [customMode, setCustomMode] = useState(false)
  const [customW, setCustomW] = useState('1920')
  const [customH, setCustomH] = useState('1080')
  const [lockAspect, setLockAspect] = useState(false)
  const [lockRatio, setLockRatio] = useState<number | null>(null)

  // ---- Enhance / Edit shared ----
  const [asset, setAsset] = useState<Asset | null>(null)
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [opts, setOpts] = useState({ denoise: true, exposureWhiteBalance: true, grade: true, localContrast: true, upscaleFactor: 1 })
  const [editCaps, setEditCaps] = useState<{ smartEditAvailable: boolean; hostedEditAvailable: boolean; bgRemovalAvailable: boolean; reason: string | null }>({ smartEditAvailable: false, hostedEditAvailable: false, bgRemovalAvailable: false, reason: null })

  // ---- Mask editor state (see MaskEditor) ----
  const [editorReset, setEditorReset] = useState(0)
  const getMasksRef = useRef<() => { edit: HTMLCanvasElement | null; protect: HTMLCanvasElement | null }>(() => ({ edit: null, protect: null }))

  // ---- Jobs ----
  const [jobs, setJobs] = useState<Job[]>([])
  const [compare, setCompare] = useState<'after' | 'before' | 'diff'>('after')
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

  const loadCaps = useCallback(async () => {
    try {
      const d = await beanFetch<{ capabilities: Record<string, { available: boolean }>; unavailableReason: string | null }>('/api/laxii/edit')
      setEditCaps({
        smartEditAvailable: d.capabilities['smart-edit']?.available === true,
        hostedEditAvailable: d.capabilities['conversational-edit']?.available === true,
        bgRemovalAvailable: d.capabilities['background-removal']?.available === true,
        reason: d.unavailableReason ?? null,
      })
    } catch {
      setEditCaps({ smartEditAvailable: false, hostedEditAvailable: false, bgRemovalAvailable: false, reason: null })
    }
  }, [])

  useEffect(() => {
    void loadJobs()
    void loadCaps()
  }, [loadJobs, loadCaps])

  // Poll while any job is in flight.
  useEffect(() => {
    const inflight = jobs.some((j) => j.status === 'queued' || j.status === 'running')
    if (inflight && !timerRef.current) {
      timerRef.current = setInterval(async () => {
        const fresh = await loadJobs()
        if (!fresh.some((j) => j.status === 'queued' || j.status === 'running')) {
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
          const done = fresh.find((j) => j.status === 'completed')
          if (done) setNotice(done.report ? 'Result ready — preservation report and comparison below.' : 'Image ready — previews and downloads are live below.')
        }
      }, 4000)
    }
    return () => {
      if (timerRef.current && !inflight) { clearInterval(timerRef.current); timerRef.current = null }
    }
  }, [jobs, loadJobs])

  // ---- upload ----
  async function onFilePicked(file: File | undefined) {
    if (!file || uploading || busy) return
    setError(null)
    setNotice(null)
    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Image exceeds the 25 MB upload limit.')
      return
    }
    setUploading(true)
    try {
      const a = await uploadAsset(file, 'original')
      setAsset(a)
      setEditorReset((n) => n + 1)
      setNotice(`Image ready (${a.width}×${a.height}).${mode === 'edit' ? ' Paint what may change — everything else stays bit-exact.' : ''}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  // ---- custom-dimension helpers ----
  function parseCustomDim(raw: string, axis: 'width' | 'height'): number {
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) throw new Error(`Custom ${axis} must be a whole number of pixels (no decimals).`)
    const v = Number(trimmed)
    if (v <= 0) throw new Error(`Custom ${axis} must be a positive pixel value.`)
    if (v < CUSTOM_MIN_PX) throw new Error(`Custom ${axis} must be at least ${CUSTOM_MIN_PX}px — smaller images fall apart.`)
    if (v > CUSTOM_MAX_PX) throw new Error(`Custom ${axis} exceeds the ${CUSTOM_MAX_PX}px maximum for image generation.`)
    return v
  }

  function onCustomWChange(raw: string) {
    setCustomW(raw)
    if (lockAspect && lockRatio) {
      const w = Number(raw)
      if (Number.isFinite(w) && w > 0) setCustomH(String(Math.max(1, Math.round(w / lockRatio))))
    }
  }

  function onCustomHChange(raw: string) {
    setCustomH(raw)
    if (lockAspect && lockRatio) {
      const h = Number(raw)
      if (Number.isFinite(h) && h > 0) setCustomW(String(Math.max(1, Math.round(h * lockRatio))))
    }
  }

  function toggleLock() {
    if (!lockAspect) {
      const w = Number(customW)
      const h = Number(customH)
      setLockRatio(Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : 16 / 9)
    }
    setLockAspect(!lockAspect)
  }

  // ---- submit paths ----
  async function submitCreate() {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (customMode) {
        const width = parseCustomDim(customW, 'width')
        const height = parseCustomDim(customH, 'height')
        await beanFetch('/api/laxii/generate', { method: 'POST', json: { prompt: p, width, height } })
      } else {
        await beanFetch('/api/laxii/generate', { method: 'POST', json: { prompt: p, size } })
      }
      setNotice('Job queued. Generation typically takes about a minute — status below updates live.')
      await loadJobs()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submitEnhance() {
    if (!asset || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await beanFetch('/api/laxii/enhance', {
        method: 'POST',
        json: {
          assetId: asset.id,
          options: { ...opts, autoOrient: true, allowGlobalColor: true },
          globalColor: true,
        },
      })
      setNotice('Enhancement queued — the deterministic engine runs it locally in seconds.')
      await loadJobs()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submitEdit(editMode: 'strict-preserve' | 'smart-edit') {
    if (!asset || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const masks = getMasksRef.current()
      const strokes: Array<{ assetId: string; kind: BrushKind }> = []
      if (editMode === 'strict-preserve' && canvasHasInk(masks.edit)) {
        strokes.push({ assetId: (await uploadAsset(await canvasToPngFile(masks.edit!), 'mask')).id, kind: 'edit' })
      }
      if (canvasHasInk(masks.protect)) {
        strokes.push({ assetId: (await uploadAsset(await canvasToPngFile(masks.protect!), 'mask')).id, kind: 'protect' })
      }
      if (editMode === 'strict-preserve' && strokes.length === 0) {
        setError('Paint an edit area first (blue protect strokes are optional).')
        setBusy(false)
        return
      }
      const base = {
        mode: editMode,
        assetId: asset.id,
        maskStrokes: strokes,
        faceZones: [], // automatic face detection arrives with the GPU worker; protect strokes work today
        shaping: editMode === 'smart-edit' ? { expandPx: 2, featherPx: 8 } : { expandPx: 0, featherPx: 4 },
      }
      if (editMode === 'strict-preserve') {
        await beanFetch('/api/laxii/edit', {
          method: 'POST',
          json: { ...base, options: { ...opts, allowGlobalColor: false }, globalColor: false },
        })
        setNotice('Strict-preserve edit queued — unmasked pixels are guaranteed bit-exact originals.')
      } else {
        await beanFetch('/api/laxii/edit', {
          method: 'POST',
          json: { ...base, prompt: prompt.trim() || 'match the surrounding content' },
        })
        setNotice('Smart edit queued on the local generative engine.')
      }
      await loadJobs()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** PHASE 4: whole-image conversational edit on the authorized hosted
   *  editing endpoint. Follow-up edits chain naturally: use any completed
   *  result as the next source via the gallery's "Use as source" action. */
  async function submitConversationalEdit() {
    if (!asset || busy) return
    const p = prompt.trim()
    if (p.length < 3) {
      setError('Describe the edit in the prompt box first (what should change, style, lighting…).')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await beanFetch('/api/laxii/edit', {
        method: 'POST',
        json: { mode: 'conversational-edit', assetId: asset.id, prompt: p },
      })
      setNotice('AI edit queued — this is a whole-image generative edit (not pixel-preserving).')
      await loadJobs()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** PHASE 4 (OPERATIONAL-TRANSFORMATION): real background removal — the
   *  provider separates the subject (chroma background), the deterministic
   *  stage cuts it to a true transparent PNG. No prompt needed. */
  async function submitBackgroundRemoval() {
    if (!asset || busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await beanFetch('/api/laxii/edit', {
        method: 'POST',
        json: { mode: 'background-removal', assetId: asset.id },
      })
      setNotice('Background removal queued — the result is a transparent PNG (subject cut out).')
      await loadJobs()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Load a completed result back into the studio as the editing source. */
  function useJobAsSource(imageUrl: string) {
    const m = /\/api\/laxii\/assets\/([\w-]+)$/.exec(imageUrl)
    if (!m) return
    // Geometry is re-measured server-side on the next edit's preparation
    // step; the preview here uses the result URL directly.
    setAsset({ id: m[1], width: null, height: null, bytes: 0, url: imageUrl })
    setMode('edit')
    setEditorReset((n) => n + 1)
    setNotice('Result loaded as the editing source — describe the next edit and run AI Edit.')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="grid min-h-[calc(100vh-3.5rem-2rem)] lg:grid-cols-[380px_1fr]">
      {/* Composer */}
      <div className="border-b border-[rgba(212,175,55,0.1)] p-5 lg:border-b-0 lg:border-r">
        <div className="mb-3 flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-[#d4af37]" />
          <h2 className="text-sm font-semibold tracking-wide">LAXII studio</h2>
        </div>

        {/* Mode switch */}
        <div className="mb-4 grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-black/30 p-1">
          {(['create', 'enhance', 'edit'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); setNotice(null) }}
              className={cn(
                'rounded-md px-2 py-1.5 text-[11px] font-medium capitalize transition-colors',
                mode === m ? 'bg-[rgba(212,175,55,0.16)] text-[#f0c75e]' : 'text-white/50 hover:text-white/80',
              )}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === 'create' && (
          <>
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
                    onClick={() => { setSize(s.value); setCustomMode(false) }}
                    className={cn(
                      'rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors',
                      !customMode && size === s.value
                        ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                        : 'border-white/10 text-white/55 hover:border-[rgba(212,175,55,0.3)]',
                    )}
                  >
                    <div className="font-medium">{s.label}</div>
                    <div className="text-white/35">{s.value}</div>
                  </button>
                ))}
                <button
                  onClick={() => setCustomMode(true)}
                  className={cn(
                    'rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors',
                    customMode
                      ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                      : 'border-white/10 text-white/55 hover:border-[rgba(212,175,55,0.3)]',
                  )}
                >
                  <div className="font-medium">Custom size</div>
                  <div className="text-white/35">{customW || '?'} × {customH || '?'} px</div>
                </button>
              </div>
              {customMode && (
                <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/45">Width (px)</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={customW}
                        onChange={(e) => onCustomWChange(e.target.value)}
                        className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-[rgba(212,175,55,0.5)]"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/45">Height (px)</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={customH}
                        onChange={(e) => onCustomHChange(e.target.value)}
                        className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-[rgba(212,175,55,0.5)]"
                      />
                    </label>
                  </div>
                  <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[11px] text-white/55">
                    <input
                      type="checkbox"
                      checked={lockAspect}
                      onChange={toggleLock}
                      className="h-3.5 w-3.5 accent-[#d4af37]"
                    />
                    Lock aspect ratio {lockAspect && lockRatio ? `(${lockRatio >= 1 ? `${lockRatio.toFixed(3).replace(/\.?0+$/, '')} : 1` : `1 : ${(1 / lockRatio).toFixed(3).replace(/\.?0+$/, '')}`})` : ''}
                  </label>
                </div>
              )}
            </div>

            <Button
              onClick={() => void submitCreate()}
              disabled={busy || prompt.trim().length < 3}
              className="mt-5 w-full bg-[#d4af37] font-semibold text-black hover:bg-[#e6c25a]"
            >
              {busy ? <Spinner className="border-black/30 border-t-black" /> : <ImageIcon className="mr-1.5 h-4 w-4" />}
              Generate image
            </Button>
            <p className="mt-4 text-[11px] leading-relaxed text-white/35">
              Images are delivered as JPEG. Every job passes validation, quota and concurrency checks server-side.
            </p>
          </>
        )}

        {(mode === 'enhance' || mode === 'edit') && (
          <>
            <label
              htmlFor="laxii-upload"
              className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed border-[rgba(212,175,55,0.35)] bg-black/20 px-4 py-5 text-center transition-colors hover:bg-black/40"
            >
              {uploading ? <Spinner className="h-5 w-5" /> : <Upload className="h-5 w-5 text-[#d4af37]" />}
              <span className="text-[11px] text-white/60">{uploading ? 'Uploading…' : asset ? 'Replace image' : 'Upload PNG / JPEG / WebP (≤ 25 MB)'}</span>
              {asset ? <span className="text-[10px] text-white/35">{asset.width}×{asset.height} · {Math.round(asset.bytes / 1024)} KB</span> : null}
            </label>
            <input id="laxii-upload" type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onFilePicked(e.target.files?.[0])} />

            <div className="mt-4 space-y-2">
              <div className="mb-1 flex items-center gap-1.5 text-xs text-white/55"><Contrast className="h-3.5 w-3.5 text-[#d4af37]" /> Enhancement steps (only helpful ones run)</div>
              {([
                ['denoise', 'Noise reduction'],
                ['exposureWhiteBalance', 'Exposure & white balance'],
                ['grade', 'Color grade'],
                ['localContrast', 'Local contrast'],
              ] as Array<['denoise' | 'exposureWhiteBalance' | 'grade' | 'localContrast', string]>).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/65">
                  {label}
                  <input
                    type="checkbox"
                    checked={opts[key]}
                    onChange={(e) => setOpts((o) => ({ ...o, [key]: e.target.checked }))}
                    className="h-3.5 w-3.5 accent-[#d4af37]"
                  />
                </label>
              ))}
              <div className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/65">
                <div className="flex items-center justify-between">
                  <span>Upscale (Lanczos)</span>
                  <select
                    value={opts.upscaleFactor}
                    onChange={(e) => setOpts((o) => ({ ...o, upscaleFactor: Number(e.target.value) }))}
                    className="rounded border border-white/15 bg-black/40 px-1.5 py-0.5 text-[11px]"
                  >
                    <option value={1}>Off</option>
                    <option value={2}>2×</option>
                    <option value={4}>4×</option>
                  </select>
                </div>
              </div>
            </div>

            {mode === 'edit' && asset ? (
              <MaskEditor
                asset={asset}
                resetKey={editorReset}
                registerGetMasks={(fn) => { getMasksRef.current = fn }}
              />
            ) : mode === 'edit' ? (
              <div className="mt-4 rounded-lg border border-white/10 bg-black/20 p-3 text-[11px] text-white/40">
                Upload an image to enable the mask editor.
              </div>
            ) : null}

            {mode === 'enhance' && (
              <Button onClick={() => void submitEnhance()} disabled={busy || !asset} className="mt-5 w-full bg-[#d4af37] font-semibold text-black hover:bg-[#e6c25a]">
                {busy ? <Spinner className="border-black/30 border-t-black" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                Enhance image
              </Button>
            )}
            {mode === 'edit' && asset ? (
              <div className="mt-4 space-y-2">
                <Button onClick={() => void submitEdit('strict-preserve')} disabled={busy} className="w-full bg-[#d4af37] font-semibold text-black hover:bg-[#e6c25a]">
                  {busy ? <Spinner className="border-black/30 border-t-black" /> : <Shield className="mr-1.5 h-4 w-4" />}
                  Apply Strict-Preserve edit
                </Button>
                <Button
                  onClick={() => void submitConversationalEdit()}
                  disabled={busy || !editCaps.hostedEditAvailable || prompt.trim().length < 3}
                  variant="outline"
                  className="w-full border-[rgba(212,175,55,0.4)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]"
                >
                  <Wand2 className="mr-1.5 h-4 w-4" />
                  AI Edit (whole image){editCaps.hostedEditAvailable ? '' : ' — unavailable'}
                </Button>
                <Button
                  onClick={() => void submitBackgroundRemoval()}
                  disabled={busy || !editCaps.bgRemovalAvailable}
                  variant="outline"
                  className="w-full border-[rgba(212,175,55,0.4)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]"
                >
                  <Scissors className="mr-1.5 h-4 w-4" />
                  Remove background{editCaps.bgRemovalAvailable ? '' : ' — unavailable'}
                </Button>
                <Button
                  onClick={() => {
                    setError(editCaps.reason ?? 'Smart Edit requires the local generative engine, which is not verified yet.')
                  }}
                  disabled={busy || !editCaps.smartEditAvailable || prompt.trim().length < 3}
                  variant="outline"
                  className="w-full border-white/15 text-white/60 hover:bg-white/5"
                >
                  <Brush className="mr-1.5 h-4 w-4" />
                  Smart Edit (masked, local){editCaps.smartEditAvailable ? '' : ' — unavailable'}
                </Button>
                <p className="text-[10px] leading-relaxed text-white/30">
                  AI Edit regenerates the whole image from your description — fast, but not pixel-preserving. Strict-Preserve keeps unmasked pixels bit-exact locally. Masked Smart Edit still needs the local Diffusers worker (hardware-gated) — BEAN refuses it instead of silently regenerating your image.
                </p>
              </div>
            ) : null}
          </>
        )}

        {error ? <div className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
        {notice ? <div className="mt-3 rounded-md border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.07)] px-3 py-2 text-xs text-[#f0c75e]">{notice}</div> : null}
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
                <JobCard key={j.id} job={j} compare={compare} setCompare={setCompare} onUseAsSource={useJobAsSource} />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}

interface MaskEditorProps {
  asset: Asset
  resetKey: number
  registerGetMasks: (fn: () => { edit: HTMLCanvasElement | null; protect: HTMLCanvasElement | null }) => void
}

/**
 * Visible mask editor: the uploaded image with a colored overlay canvas on
 * top. Full-resolution alpha masks are kept on hidden canvases so exported
 * masks always match the original geometry exactly (the preservation
 * engine rejects any geometry mismatch — by design).
 */
function MaskEditor({ asset, resetKey, registerGetMasks }: MaskEditorProps) {
  const [brush, setBrush] = useState<BrushKind>('edit')
  const [brushSize, setBrushSize] = useState(24)
  const [erase, setErase] = useState(false)
  const [hasInk, setHasInk] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const editMaskRef = useRef<HTMLCanvasElement | null>(null)
  const protectMaskRef = useRef<HTMLCanvasElement | null>(null)
  const lastFullRef = useRef<{ x: number; y: number } | null>(null)
  const lastPreviewRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    registerGetMasks(() => ({ edit: editMaskRef.current, protect: protectMaskRef.current }))
  }, [registerGetMasks])

  // (Re)size all canvases when a new asset arrives.
  useEffect(() => {
    const img = new Image()
    img.src = asset.url
    img.onload = () => {
      const wrapper = wrapperRef.current
      const preview = previewRef.current
      if (!wrapper || !preview) return
      const maxW = wrapper.clientWidth || 340
      const scale = Math.min(1, maxW / img.naturalWidth)
      const w = Math.max(1, Math.round(img.naturalWidth * scale))
      const h = Math.max(1, Math.round(img.naturalHeight * scale))
      preview.width = w
      preview.height = h
      const ctx = preview.getContext('2d')
      ctx?.clearRect(0, 0, w, h)
      for (const ref of [editMaskRef, protectMaskRef]) {
        const c = ref.current
        if (!c) continue
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
      }
      setHasInk(false)
    }
  }, [asset, resetKey])

  function strokeAt(ev: React.PointerEvent<HTMLCanvasElement>, isStart: boolean) {
    const preview = previewRef.current
    const target = brush === 'edit' ? editMaskRef.current : protectMaskRef.current
    if (!preview || !target) return
    const rect = ev.currentTarget.getBoundingClientRect()
    // Full-resolution coordinates (mask space).
    const px = ((ev.clientX - rect.left) / rect.width) * target.width
    const py = ((ev.clientY - rect.top) / rect.height) * target.height
    // Display coordinates (preview space).
    const vx = ((ev.clientX - rect.left) / rect.width) * preview.width
    const vy = ((ev.clientY - rect.top) / rect.height) * preview.height
    const fullR = Math.max(2, (brushSize / 2) * (target.width / rect.width))

    const drawOn = (
      canvas: HTMLCanvasElement,
      color: string,
      radius: number,
      x: number,
      y: number,
      last: { x: number; y: number } | null,
    ) => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
      if (!isStart && last) {
        ctx.strokeStyle = color
        ctx.lineWidth = radius * 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(last.x, last.y)
        ctx.lineTo(x, y)
        ctx.stroke()
      } else {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }

    // Preview: colored translucent stroke at display scale.
    drawOn(
      preview,
      brush === 'edit' ? 'rgba(212,175,55,0.55)' : 'rgba(96,165,250,0.55)',
      brushSize / 2,
      vx,
      vy,
      lastPreviewRef.current,
    )
    // Full-res mask: pure alpha for exact export.
    drawOn(target, 'rgba(255,255,255,1)', fullR, px, py, lastFullRef.current)
    lastFullRef.current = { x: px, y: py }
    lastPreviewRef.current = { x: vx, y: vy }
    setHasInk(true)
  }

  function clearAll() {
    for (const ref of [previewRef, editMaskRef, protectMaskRef]) {
      const c = ref.current
      c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    }
    setHasInk(false)
  }

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-white/55"><Brush className="h-3.5 w-3.5 text-[#d4af37]" /> Mask editor</div>
      <div ref={wrapperRef} className="relative overflow-hidden rounded-lg border border-white/10 bg-black/40">
        <img src={asset.url} alt="Uploaded original" className="block w-full select-none" draggable={false} />
        <canvas
          ref={previewRef}
          className={cn('absolute inset-0 h-full w-full', erase ? 'cursor-cell' : 'cursor-crosshair')}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); lastFullRef.current = null; lastPreviewRef.current = null; strokeAt(e, true) }}
          onPointerMove={(e) => { if (e.buttons > 0) strokeAt(e, false) }}
          onPointerUp={() => { lastFullRef.current = null; lastPreviewRef.current = null }}
          onPointerLeave={() => { lastFullRef.current = null; lastPreviewRef.current = null }}
        />
      </div>

      <div className="mt-2 grid grid-cols-4 gap-1.5">
        <button onClick={() => { setBrush('edit'); setErase(false) }} className={cn('rounded-lg border px-1.5 py-1.5 text-[10px]', brush === 'edit' && !erase ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/10 text-white/55')}>
          Edit
        </button>
        <button onClick={() => { setBrush('protect'); setErase(false) }} className={cn('rounded-lg border px-1.5 py-1.5 text-[10px]', brush === 'protect' && !erase ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/10 text-white/55')}>
          <Shield className="mr-0.5 inline h-3 w-3" />Protect
        </button>
        <button onClick={() => setErase(!erase)} className={cn('rounded-lg border px-1.5 py-1.5 text-[10px]', erase ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/10 text-white/55')}>
          <Eraser className="mr-0.5 inline h-3 w-3" />Erase
        </button>
        <button onClick={clearAll} className="rounded-lg border border-white/10 px-1.5 py-1.5 text-[10px] text-white/55">
          <Trash2 className="mr-0.5 inline h-3 w-3" />Clear
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-white/45">
        Brush
        <input type="range" min={4} max={80} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-full accent-[#d4af37]" />
        {brushSize}px {hasInk ? '· mask ready' : ''}
      </div>
      <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2.5 text-[10px] leading-relaxed text-white/45">
        <span className="text-[#f0c75e]">Gold</span> = will change · <span className="text-[#60a5fa]">Blue</span> = protected (never changes, works today) · Erase refines either. Everything outside gold stays a bit-exact original.
      </div>
    </div>
  )
}

function JobCard({ job, compare, setCompare, onUseAsSource }: { job: Job; compare: 'after' | 'before' | 'diff'; setCompare: (v: 'after' | 'before' | 'diff') => void; onUseAsSource?: (imageUrl: string) => void }) {
  const isPreservation = job.task === 'image-enhancement' || job.task === 'image-editing'
  const view = isPreservation && job.report ? compare : 'after'
  const src = view === 'before' ? job.originalUrl : view === 'diff' ? job.diffUrl : job.imageUrl
  return (
    <div className="bean-glass overflow-hidden rounded-xl">
      <div className="relative flex aspect-square items-center justify-center bg-black/40">
        {job.status === 'completed' && src ? (
          <img src={src} alt={`LAXII result ${job.task ?? 'generation'}`} className="h-full w-full object-contain" loading="lazy" />
        ) : job.status === 'failed' ? (
          <div className="p-4 text-center">
            <XCircle className="mx-auto mb-2 h-8 w-8 text-red-400" />
            <p className="text-xs text-red-300">{job.errorMessage ?? 'Generation failed.'}</p>
            {job.errorCode ? <p className="mt-1 text-[10px] text-white/30">{job.errorCode}</p> : null}
          </div>
        ) : (
          <div className="w-full p-5 text-center">
            <Spinner className="mx-auto mb-3 h-6 w-6" />
            <div className="mb-2 text-xs text-white/50">
              {job.status === 'queued' ? 'Queued…' : job.task === 'image-enhancement' ? 'Enhancing locally…' : 'Generating… this can take about a minute'}
            </div>
            <Progress value={job.progress} className="h-1.5 bg-white/5" />
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {job.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" /> : job.status === 'failed' ? <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" /> : <Clock className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />}
              <span className="truncate text-[11px] text-white/45">{job.task === 'image-enhancement' ? 'enhance' : job.task === 'image-editing' ? 'edit' : job.size ?? 'image'} · {timeAgo(job.queuedAt)}</span>
            </div>
            {job.durationMs ? <div className="text-[10px] text-white/30">{(job.durationMs / 1000).toFixed(1)}s · {job.bytes ? Math.round(job.bytes / 1024) : '?'} KB</div> : null}
          </div>
          {job.status === 'completed' && job.imageUrl ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {onUseAsSource ? (
                <button
                  type="button"
                  onClick={() => onUseAsSource(job.imageUrl!)}
                  title="Load this result as the source for the next edit"
                  className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:bg-white/5"
                >
                  <Brush className="h-3 w-3" /> Use as source
                </button>
              ) : null}
              <a
                href={job.imageUrl}
                download={`bean-laxii-${job.id}.${job.format === 'png' ? 'png' : 'jpg'}`}
                className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)]"
              >
                <Download className="h-3 w-3" /> Download
              </a>
            </div>
          ) : job.status === 'failed' ? (
            <GoldBadge tone="red">Failed</GoldBadge>
          ) : (
            <GoldBadge tone="gold">{job.status}</GoldBadge>
          )}
        </div>
        {isPreservation && job.report ? (
          <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/20 p-2">
            <div className="flex items-center justify-between text-[10px] text-white/40">
              <span>Before / After / Diff</span>
              <div className="flex gap-1">
                {(['before', 'after', 'diff'] as const).map((v) => (
                  <button key={v} onClick={() => setCompare(v)} className={cn('rounded px-1.5 py-0.5 capitalize', view === v ? 'bg-[rgba(212,175,55,0.16)] text-[#f0c75e]' : 'text-white/45 hover:text-white/70')}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[10px] leading-relaxed text-white/55">
              <span className={cn('font-medium', job.report.exactPreservedPct > 0 ? 'text-emerald-400' : 'text-[#f0c75e]')}>
                {job.report.exactPreservedPct.toFixed(1)}% exact original pixels
              </span>
              {' · '}{job.report.changedPct.toFixed(1)}% changed
              {' · '}{job.report.generativeUsed ? 'generative' : 'deterministic'}
            </div>
            {job.report.protectedRegions?.some((r) => r.changed) ? (
              <div className="text-[10px] text-red-300">Protected region changed — review before use.</div>
            ) : null}
            {job.report.identitySimilarity ? (
              <div className={cn('text-[10px]', job.report.identitySimilarity.passed ? 'text-emerald-400' : 'text-amber-300')}>
                Face similarity {job.report.identitySimilarity.score.toFixed(3)} ({job.report.identitySimilarity.passed ? 'within range' : 'flagged'}) — an estimate, not proof of identity.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
