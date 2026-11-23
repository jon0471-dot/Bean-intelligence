'use client'

/**
 * BEAN Intelligence — JAZMII AUTO DIRECTOR (2026-11-20).
 *
 * Story-to-finished-video production workspace. The panel drives the full
 * pipeline through the real API: plan (schema-validated storyboard) →
 * review/approve → per-scene generation on the existing JAZMII video backend
 * → composition → validation → deliverables.
 *
 * Honesty rules (same contract as the chat studio):
 *  - every status, progress value and scene state comes from the production
 *    record — no fake progress, no hardcoded percentages;
 *  - failed scenes stay visible with their real error and a per-scene
 *    regenerate action; successful scenes are never hidden;
 *  - "Completed with limitations" and "Partially completed" are FIRST-CLASS
 *    displayed states — the pipeline reports what actually happened;
 *  - cancellation is cooperative and labeled as such;
 *  - a finished video is shown only after the server ffprobe-validated it.
 *
 * Desktop + mobile responsive (Tailwind design system of the existing shell).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { beanFetch, Spinner, timeAgo } from './shared'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  Clapperboard,
  Download,
  Film,
  Image as ImageIcon,
  Music,
  RefreshCw,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  AudioLines,
  AlertTriangle,
} from 'lucide-react'

// ---- types (mirror of the API payloads) -------------------------------------

interface StoryboardScene {
  id: string
  durationSeconds: number
  purpose: string
  visualDescription: string
  generationPrompt: string
  cameraDirection?: string
  caption?: string
  transitionOut: 'cut' | 'fade'
  audioDirection?: string
}

interface Storyboard {
  title: string
  objective: string
  audience?: string
  tone: string
  platform?: string
  format: '9:16' | '16:9' | '1:1'
  width: number
  height: number
  fps: number
  durationSeconds: number
  visualDirection: string
  musicDirection?: string
  voiceover: boolean
  scenes: StoryboardScene[]
}

interface SceneView {
  id: string
  idx: number
  status: 'pending' | 'generating' | 'ready' | 'failed'
  purpose: string | null
  caption: string | null
  durationSeconds: number | null
  visualDescription: string | null
  hasClip: boolean
  attempts: number
  errorClass: string | null
  errorMessage: string | null
}

interface ProductionState {
  production: {
    id: string
    title: string
    status: string
    style: string | null
    aspect: string
    width: number
    height: number
    fps: number
    requestedDurationSec: number | null
    storyboardRev: number
    engine: string | null
    progress: number
    approvedAt: string | null
    finishedAt: string | null
    errorCode: string | null
    errorMessage: string | null
    trustTaskId: string | null
    updatedAt: string
  }
  storyboard: Storyboard | null
  storyboardRev: number
  scenes: SceneView[]
  deliverables: Record<string, string> | null
  orchestrationStatus?: string | null
}

interface ProductionSummary {
  id: string
  title: string
  status: string
  aspect: string
  progress: number
  engine: string | null
  updatedAt: string
}

const ACTIVE_STATUSES = new Set(['generating', 'composing', 'rendering', 'validating'])

const STATUS_LABEL: Record<string, { label: string; tone: 'plan' | 'run' | 'ok' | 'partial' | 'bad' | 'stop' }> = {
  draft: { label: 'Draft', tone: 'plan' },
  awaiting_approval: { label: 'Awaiting your approval', tone: 'plan' },
  generating: { label: 'Generating scenes', tone: 'run' },
  composing: { label: 'Preparing media & composing', tone: 'run' },
  rendering: { label: 'Rendering final video', tone: 'run' },
  validating: { label: 'Validating output', tone: 'run' },
  completed: { label: 'Completed', tone: 'ok' },
  completed_with_limitations: { label: 'Completed with limitations', tone: 'ok' },
  partially_completed: { label: 'Partially completed', tone: 'partial' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'stop' },
}

const CREATIVE_MODES_UI: Array<{ value: string; label: string }> = [
  { value: 'custom', label: 'Custom (my prompt directs)' },
  { value: 'cinematic-film', label: 'Cinematic film' },
  { value: 'product-ad', label: 'Product advertisement' },
  { value: 'product-launch', label: 'Product launch / showcase' },
  { value: 'social-reel', label: 'Social media reel' },
  { value: 'explainer', label: 'Explainer video' },
  { value: 'story-short', label: 'Story-driven short film' },
  { value: 'trailer', label: 'Promotional trailer' },
]

const PURPOSE_LABEL: Record<string, string> = {
  'opening-hook': 'Hook',
  reveal: 'Reveal',
  highlight: 'Highlight',
  'product-moment': 'Product moment',
  punchline: 'Punchline',
  outro: 'Outro',
  custom: 'Scene',
}

function StatusChip({ status }: { status: string }) {
  const meta = STATUS_LABEL[status] ?? { label: status, tone: 'run' as const }
  const toneClass = {
    plan: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
    run: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
    ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
    partial: 'border-amber-400/40 bg-amber-400/10 text-amber-200',
    bad: 'border-red-400/30 bg-red-400/10 text-red-200',
    stop: 'border-white/20 bg-white/5 text-white/60',
  }[meta.tone]
  return <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', toneClass)}>{meta.label}</span>
}

function SceneStatusIcon({ status }: { status: SceneView['status'] }) {
  if (status === 'ready') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-400" />
  if (status === 'generating') return <Spinner className="h-3.5 w-3.5" />
  return <Clock className="h-3.5 w-3.5 text-white/30" />
}

// ------------------------------------------------------------------------------------
// Main component
// ------------------------------------------------------------------------------------

export function JazmiiDirector({ onOpenTrustTask }: { onOpenTrustTask?: (taskId: string) => void }) {
  const { toast } = useToast()

  const [productions, setProductions] = useState<ProductionSummary[]>([])
  const [active, setActive] = useState<ProductionState | null>(null)
  const [loading, setLoading] = useState(false)

  // ---- planner form ----------------------------------------------------------
  const [prompt, setPrompt] = useState('')
  const [format, setFormat] = useState<'9:16' | '16:9' | '1:1'>('9:16')
  const [style, setStyle] = useState('custom')
  const [duration, setDuration] = useState(20)
  const [enginePref, setEnginePref] = useState<'auto' | 'hyperframes' | 'ffmpeg'>('auto')
  const [referenceImage, setReferenceImage] = useState<{ dataUrl: string; name: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [planning, setPlanning] = useState(false)

  // ---- audio (awaiting approval) ----------------------------------------------
  const [audioInfo, setAudioInfo] = useState<{ music: boolean; voiceover: boolean }>({ music: false, voiceover: false })
  const musicInputRef = useRef<HTMLInputElement | null>(null)
  const voiceInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingAudio, setUploadingAudio] = useState<'music' | 'voiceover' | null>(null)

  const refreshProductions = useCallback(async () => {
    try {
      const d = await beanFetch<{ productions: ProductionSummary[] }>('/api/jazmii/director')
      setProductions(d.productions)
      return d.productions
    } catch {
      return []
    }
  }, [])

  const loadProduction = useCallback(async (id: string) => {
    try {
      const d = await beanFetch<ProductionState & { audio?: Array<{ role: string }> }>(`/api/jazmii/director/${id}`)
      setActive(d)
      if (d.production.status === 'awaiting_approval') {
        setAudioInfo({
          music: (d.audio ?? []).some((t) => t.role === 'music'),
          voiceover: (d.audio ?? []).some((t) => t.role === 'voiceover'),
        })
      } else {
        setAudioInfo({ music: false, voiceover: false })
      }
      return d
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const list = await refreshProductions()
      // Auto-open the most recent in-flight production so a reload (or
      // returning to the tab) restores the live view without hunting.
      const activeProduction = list.find((p) => ACTIVE_STATUSES.has(p.status))
      if (activeProduction) await loadProduction(activeProduction.id)
      // M27: the GANGZII narration picker needs the owner's narration list.
      void loadGangziiNarrations()
    })()
  }, [refreshProductions, loadProduction])

  // Poll ONLY while a production is genuinely active.
  const productionActive = ACTIVE_STATUSES.has(active?.production.status ?? '')
  useEffect(() => {
    if (!productionActive || !active) return
    const t = setInterval(() => void loadProduction(active.production.id), 4000)
    return () => clearInterval(t)
  }, [productionActive, active, loadProduction])

  // ---- pick reference image ----------------------------------------------------
  function pickReference(file: File | null) {
    if (!file) return
    if (file.size > 4 * 1024 * 1024) {
      toast({ title: 'Reference image is too large (max 4 MB).', variant: 'destructive' })
      return
    }
    if (!/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
      toast({ title: 'Reference image must be PNG, JPEG or WebP.', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setReferenceImage({ dataUrl: String(reader.result), name: file.name })
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
    reader.readAsDataURL(file)
  }

  // ---- plan ----------------------------------------------------------------------
  async function plan() {
    const text = prompt.trim()
    if (text.length < 10 || planning) return
    setPlanning(true)
    try {
      const d = await beanFetch<{ production: { id: string } }>('/api/jazmii/director', {
        method: 'POST',
        json: {
          prompt: text,
          format,
          style,
          durationSec: duration,
          engine: enginePref,
          ...(referenceImage ? { referenceImageUrl: referenceImage.dataUrl } : {}),
        },
      })
      toast({ title: 'Storyboard ready for your review', description: 'Review the plan, then approve to start generation.' })
      await refreshProductions()
      await loadProduction(d.production.id)
    } catch (e) {
      toast({ title: 'Planning failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setPlanning(false)
    }
  }

  // ---- approve / cancel / regenerate ------------------------------------------------
  async function approve(id: string) {
    try {
      await beanFetch(`/api/jazmii/director/${id}/approve`, { method: 'POST', json: { engine: enginePref } })
      toast({ title: 'Approved — scene generation started', description: 'Each scene renders as its own tracked job.' })
      await loadProduction(id)
    } catch (e) {
      toast({ title: 'Approval failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  async function replan(id: string) {
    // Regenerate the storyboard proposal (same form settings, fresh plan).
    const text = prompt.trim() || ''
    if (text.length < 10) {
      toast({ title: 'Edit the creative brief first', description: 'The planner needs the original request to re-plan.', variant: 'destructive' })
      return
    }
    setPlanning(true)
    try {
      const d = await beanFetch<{ production: { id: string } }>('/api/jazmii/director', {
        method: 'POST',
        json: {
          prompt: text,
          format,
          style,
          durationSec: duration,
          engine: enginePref,
          ...(referenceImage ? { referenceImageUrl: referenceImage.dataUrl } : {}),
        },
      })
      await refreshProductions()
      await loadProduction(d.production.id)
    } catch (e) {
      toast({ title: 'Re-planning failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setPlanning(false)
    }
  }

  async function cancel(id: string) {
    try {
      const d = await beanFetch<{ cancelled: boolean; note: string }>(`/api/jazmii/director/${id}/cancel`, { method: 'POST' })
      toast({ title: d.cancelled ? 'Cancellation requested' : 'Already settled', description: d.note })
      await loadProduction(id)
    } catch (e) {
      toast({ title: 'Cancel failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  async function resumeComposition(id: string) {
    try {
      const d = await beanFetch<{ resumed: boolean; note: string }>(`/api/jazmii/director/${id}/resume`, { method: 'POST' })
      toast({ title: d.resumed ? 'Production resumed' : 'Nothing to resume', description: d.note })
      await loadProduction(id)
    } catch (e) {
      toast({ title: 'Resume refused', description: (e as Error).message, variant: 'destructive' })
    }
  }

  async function regenerateScene(id: string, idx: number) {
    try {
      await beanFetch(`/api/jazmii/director/${id}/regenerate`, { method: 'POST', json: { idx } })
      toast({ title: `Scene ${idx} regeneration queued`, description: 'Delivered scenes are kept; only this scene re-generates.' })
      await loadProduction(id)
    } catch (e) {
      toast({ title: 'Regeneration refused', description: (e as Error).message, variant: 'destructive' })
    }
  }

  async function deleteProduction(id: string) {
    try {
      await beanFetch(`/api/jazmii/director/${id}`, { method: 'DELETE' })
      setActive(null)
      await refreshProductions()
    } catch (e) {
      toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  // ---- audio upload --------------------------------------------------------------------
  async function uploadAudio(role: 'music' | 'voiceover', file: File | null) {
    const pid = active?.production.id
    if (!pid || !file) return
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: 'Audio is too large (max 25 MB).', variant: 'destructive' })
      return
    }
    setUploadingAudio(role)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('could not read the file'))
        reader.readAsDataURL(file)
      })
      await beanFetch(`/api/jazmii/director/${pid}/audio`, {
        method: 'POST',
        json: { role, dataUrl, attribution: file.name },
      })
      setAudioInfo((prev) => ({ ...prev, [role]: true }))
      toast({ title: `${role === 'music' ? 'Music' : 'Voiceover'} attached`, description: 'It will be mixed into the final video.' })
    } catch (e) {
      toast({ title: 'Audio rejected', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setUploadingAudio(null)
      if (role === 'music' && musicInputRef.current) musicInputRef.current.value = ''
      if (role === 'voiceover' && voiceInputRef.current) voiceInputRef.current.value = ''
    }
  }

  async function clearAudio(role: 'music' | 'voiceover' | 'sfx') {
    const pid = active?.production.id
    if (!pid) return
    try {
      // M27 FIX: the clear endpoint requires a JSON body — the previous
      // body-less DELETE with a query param measured a VALIDATION_ERROR and
      // silently failed to remove the track.
      await beanFetch(`/api/jazmii/director/${pid}/audio`, { method: 'DELETE', json: { role } })
      setAudioInfo((prev) => ({ ...prev, [role]: false }))
    } catch (e) {
      toast({ title: 'Could not remove audio', description: (e as Error).message, variant: 'destructive' })
    }
  }

  // ---- GANGZII narration (M27): storyboard → narration hand-off -----------
  const [gangziiNarrations, setGangziiNarrations] = useState<Array<{ id: string; title: string; status: string; jazmiiProductionId: string | null; segments: Array<{ status: string }> }>>([])
  const [attachingNarration, setAttachingNarration] = useState<string | null>(null)
  const [creatingNarration, setCreatingNarration] = useState(false)

  const loadGangziiNarrations = useCallback(async () => {
    try {
      const res = await beanFetch<{ projects: Array<{ id: string; title: string; status: string; jazmiiProductionId: string | null; segments: Array<{ status: string }> }> }>('/api/gangzii/narration')
      setGangziiNarrations(res.projects)
    } catch {
      setGangziiNarrations([])
    }
  }, [])

  /** Create a GANGZII narration script FROM this storyboard (explicit user
   *  action — captions become the narration draft; nothing auto-runs). */
  async function createNarrationFromStoryboard(pid: string, storyboard: { title: string; scenes: Array<{ caption: string | null; audioDirection?: string | null }> }) {
    setCreatingNarration(true)
    try {
      const lines = storyboard.scenes
        .map((s, i) => (s.caption ? s.caption : null))
        .filter(Boolean) as string[]
      if (lines.length === 0) {
        toast({ title: 'No captions to narrate', description: 'Add captions to the storyboard scenes first — GANGZII narrates the captions, never invents a script.', variant: 'destructive' })
        return
      }
      const res = await beanFetch<{ project: { id: string; title: string } }>('/api/gangzii/narration', {
        method: 'POST',
        json: {
          title: `Narration — ${storyboard.title}`.slice(0, 120),
          text: lines.join(' '),
          language: 'en',
          voice: 'af_heart',
          jazmiiProductionId: pid,
          sceneAssociations: lines.map((_, i) => ({ sceneIdx: i + 1, segmentIdx: i + 1 })),
        },
      })
      toast({ title: 'Narration script created in GANGZII', description: `${res.project.title} — open GANGZII → Narration to generate the segments and join the track.` })
      await loadGangziiNarrations()
    } catch (e) {
      toast({ title: 'Narration hand-off failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setCreatingNarration(false)
    }
  }

  async function attachNarration(pid: string, narrationProjectId: string) {
    setAttachingNarration(narrationProjectId)
    try {
      const res = await beanFetch<{ segments: number; measuredTotalMs: number | null; timingNote: string }>(`/api/jazmii/director/${pid}/narration`, {
        method: 'POST',
        json: { narrationProjectId },
      })
      setAudioInfo((prev) => ({ ...prev, voiceover: true }))
      toast({
        title: 'GANGZII narration attached as voiceover',
        description: `${res.segments} segment(s)${res.measuredTotalMs ? `, measured ${(res.measuredTotalMs / 1000).toFixed(1)}s` : ''}. ${res.timingNote}`,
      })
    } catch (e) {
      toast({ title: 'Narration attach refused', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setAttachingNarration(null)
    }
  }

  // ---- render ------------------------------------------------------------------------------
  const status = active?.production.status
  const sb = active?.storyboard ?? null
  const scenes = active?.scenes ?? []
  const readyCount = scenes.filter((s) => s.status === 'ready').length
  const failedCount = scenes.filter((s) => s.status === 'failed').length
  const canApprove = status === 'awaiting_approval' && sb !== null

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* production switcher rail */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-[rgba(212,175,55,0.1)] px-3 py-2 sm:px-4">
        <Clapperboard className="h-4 w-4 shrink-0 text-[#d4af37]" />
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {productions.length === 0 ? (
            <span className="text-[10px] text-white/30">No productions yet — plan one below.</span>
          ) : (
            productions.map((p) => (
              <button
                key={p.id}
                onClick={() => void loadProduction(p.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  active?.production.id === p.id
                    ? 'border-[rgba(212,175,55,0.5)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                    : 'border-white/10 text-white/55 hover:bg-white/5',
                )}
              >
                <span className="max-w-[160px] truncate">{p.title}</span>
                <StatusChip status={p.status} />
              </button>
            ))
          )}
        </div>
      </div>

      <div className="bean-scroll min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* ---------- planner form (always available) ---------- */}
          <section className="rounded-xl border border-[rgba(212,175,55,0.2)] bg-black/30 p-3 sm:p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-white/90">
              <Film className="h-4 w-4 text-[#d4af37]" /> Plan a new video
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-white/40">
              Describe the video you want. The Creative Director returns a scene-by-scene storyboard for your approval —
              nothing is generated until you approve it.
            </p>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. A 20-second launch film for Aurora, our sunrise-simulation alarm clock — slow cinematic shots, warm light, one bold hook line…"
              aria-label="Creative brief"
              className="mt-2 resize-none border-[rgba(212,175,55,0.25)] bg-black/40 text-sm"
            />
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-[10px] text-white/45">
                Format
                <Select value={format} onValueChange={(v) => setFormat(v as '9:16' | '16:9' | '1:1')}>
                  <SelectTrigger className="mt-1 h-9 border-[rgba(212,175,55,0.25)] bg-black/40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-[rgba(212,175,55,0.3)] bg-[#0d0d0d] text-xs">
                    <SelectItem value="9:16">Vertical 9:16</SelectItem>
                    <SelectItem value="16:9">Landscape 16:9</SelectItem>
                    <SelectItem value="1:1">Square 1:1</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="text-[10px] text-white/45">
                Style
                <Select value={style} onValueChange={setStyle}>
                  <SelectTrigger className="mt-1 h-9 border-[rgba(212,175,55,0.25)] bg-black/40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-[rgba(212,175,55,0.3)] bg-[#0d0d0d] text-xs">
                    {CREATIVE_MODES_UI.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="text-[10px] text-white/45">
                Duration — {duration}s
                <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                  <SelectTrigger className="mt-1 h-9 border-[rgba(212,175,55,0.25)] bg-black/40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-[rgba(212,175,55,0.3)] bg-[#0d0d0d] text-xs">
                    {[9, 12, 15, 20, 25, 30, 40, 60].map((d) => (
                      <SelectItem key={d} value={String(d)}>{d} seconds</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="text-[10px] text-white/45">
                Composition engine
                <Select value={enginePref} onValueChange={(v) => setEnginePref(v as 'auto' | 'hyperframes' | 'ffmpeg')}>
                  <SelectTrigger className="mt-1 h-9 border-[rgba(212,175,55,0.25)] bg-black/40 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-[rgba(212,175,55,0.3)] bg-[#0d0d0d] text-xs">
                    <SelectItem value="auto">Auto (best available)</SelectItem>
                    <SelectItem value="hyperframes">HyperFrames (HTML render)</SelectItem>
                    <SelectItem value="ffmpeg">FFmpeg (deterministic)</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => pickReference(e.target.files?.[0] ?? null)}
              />
              <label
                htmlFor="director-reference"
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[rgba(212,175,55,0.25)] px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/5"
              >
                <ImageIcon className="h-3.5 w-3.5" /> {referenceImage ? 'Reference attached' : 'Attach reference image (optional)'}
              </label>
              {referenceImage ? (
                <>
                  <img src={referenceImage.dataUrl} alt="Reference" className="h-8 w-8 rounded border border-white/10 object-cover" />
                  <button onClick={() => setReferenceImage(null)} aria-label="Remove reference image" className="rounded p-1 text-white/40 hover:text-white/80">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : null}
              <Button
                onClick={() => void plan()}
                disabled={planning || prompt.trim().length < 10}
                className="ml-auto bg-[#d4af37] text-black hover:bg-[#e6c25a]"
              >
                {planning ? <Spinner className="border-black/30 border-t-black" /> : 'Plan my video'}
              </Button>
            </div>
            <p className="mt-1.5 text-[10px] text-white/30">
              Scenes render on the existing JAZMII video backend (3–10 s planned per shot; clips are generated at the provider's supported 5 s / 10 s lengths and trimmed to the timeline). Cross-scene continuity is not guaranteed and never claimed.
            </p>
          </section>

          {/* ---------- storyboard review ---------- */}
          {status === 'awaiting_approval' && sb ? (
            <section className="rounded-xl border border-sky-400/25 bg-sky-400/[0.04] p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={status} />
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-white/90">{sb.title}</h2>
                <Badge variant="outline" className="border-white/15 text-[10px] text-white/50">rev {active?.storyboardRev}</Badge>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-white/60">{sb.objective}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-white/40">
                <span>{sb.format} · {sb.width}x{sb.height} @ {sb.fps}fps</span>
                <span>{sb.durationSeconds}s across {sb.scenes.length} scenes</span>
                {sb.audience ? <span>Audience: {sb.audience}</span> : null}
                {sb.platform ? <span>Platform: {sb.platform}</span> : null}
              </div>

              <ol className="mt-3 space-y-2">
                {sb.scenes.map((s, i) => (
                  <li key={s.id} className="rounded-lg border border-white/10 bg-black/30 p-2.5">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-semibold text-[#f0c75e]">Scene {i + 1}</span>
                      <span className="text-white/40">{PURPOSE_LABEL[s.purpose] ?? s.purpose}</span>
                      <span className="text-white/30">{s.durationSeconds}s</span>
                      <span className="ml-auto text-white/30">{s.transitionOut === 'fade' ? 'dip out' : 'cut'}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-white/70">{s.visualDescription}</p>
                    {s.caption ? <p className="mt-1 text-[11px] italic text-white/50">Caption: “{s.caption}”</p> : null}
                  </li>
                ))}
              </ol>

              {/* audio selection */}
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-2">
                <Music className="h-3.5 w-3.5 text-white/40" />
                <input ref={musicInputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => void uploadAudio('music', e.target.files?.[0] ?? null)} />
                <input ref={voiceInputRef} type="file" accept="audio/*" className="hidden" onChange={(e) => void uploadAudio('voiceover', e.target.files?.[0] ?? null)} />
                <label htmlFor="director-music" className="cursor-pointer text-[11px] text-white/60 hover:text-[#f0c75e]">
                  {audioInfo.music ? 'Music attached ✓' : 'Attach music (mp3/wav/ogg/m4a/flac)'}
                </label>
                {audioInfo.music ? (
                  <button onClick={() => void clearAudio('music')} aria-label="Remove music" className="rounded p-1 text-white/40 hover:text-white/80"><X className="h-3 w-3" /></button>
                ) : null}
                <span className="text-white/20">|</span>
                <label htmlFor="director-voice" className="cursor-pointer text-[11px] text-white/60 hover:text-[#f0c75e]">
                  {audioInfo.voiceover ? 'Voiceover attached ✓' : 'Attach voiceover (optional)'}
                </label>
                {audioInfo.voiceover ? (
                  <button onClick={() => void clearAudio('voiceover')} aria-label="Remove voiceover" className="rounded p-1 text-white/40 hover:text-white/80"><X className="h-3 w-3" /></button>
                ) : null}
                {uploadingAudio ? <Spinner className="h-3.5 w-3.5" /> : null}
                <span className="ml-auto text-[10px] text-white/30">nothing is auto-narrated</span>
              </div>

              {/* M27: GANGZII narration — optional, explicit, never automatic */}
              <div className="mt-2 rounded-lg border border-[rgba(212,175,55,0.25)] bg-[rgba(212,175,55,0.05)] px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <AudioLines className="h-3.5 w-3.5 text-[#d4af37]" />
                  <span className="text-[11px] text-[#f0c75e]">AI narration via GANGZII (optional)</span>
                  <Button
                    onClick={() => sb && void createNarrationFromStoryboard(active!.production.id, sb as unknown as { title: string; scenes: Array<{ caption: string | null; audioDirection?: string | null }> })}
                    variant="outline"
                    className="h-6 border-[rgba(212,175,55,0.4)] px-2 text-[10px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)]"
                    disabled={creatingNarration}
                  >
                    {creatingNarration ? 'Creating…' : 'Draft narration from captions'}
                  </Button>
                  <span className="ml-auto text-[10px] text-white/30">generate + join in GANGZII → Narration, then attach here</span>
                </div>
                {gangziiNarrations.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {gangziiNarrations.slice(0, 4).map((n) => {
                      const ready = n.segments.length > 0 && n.segments.every((s) => s.status === 'ready')
                      return (
                        <div key={n.id} className="flex items-center gap-2 text-[10px] text-white/50">
                          <span className="min-w-0 flex-1 truncate">{n.title}</span>
                          <span className="shrink-0">{n.segments.filter((s) => s.status === 'ready').length}/{n.segments.length} ready</span>
                          <Button
                            onClick={() => void attachNarration(active!.production.id, n.id)}
                            variant="outline"
                            className="h-5 border-white/15 px-1.5 text-[10px] text-white/70 hover:bg-white/5"
                            disabled={!ready || attachingNarration === n.id}
                            title={ready ? 'Attach as the production voiceover' : 'Generate and join every segment in GANGZII first'}
                          >
                            {attachingNarration === n.id ? 'attaching…' : 'Attach'}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-1 text-[10px] text-white/30">No GANGZII narration scripts yet — drafting one from the captions is the fastest start.</p>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => void approve(active!.production.id)} className="bg-[#d4af37] text-black hover:bg-[#e6c25a]">
                  Approve & generate
                </Button>
                <Button onClick={() => void replan(active!.production.id)} variant="outline" className="border-white/15 text-white/70 hover:bg-white/5">
                  <RefreshCw className="mr-1 h-3.5 w-3.5" /> Re-plan storyboard
                </Button>
              </div>
            </section>
          ) : null}

          {/* ---------- active production progress ---------- */}
          {active && status && (ACTIVE_STATUSES.has(status) || ['completed', 'completed_with_limitations', 'partially_completed', 'failed', 'cancelled'].includes(status)) ? (
            <section className="rounded-xl border border-[rgba(212,175,55,0.2)] bg-black/30 p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={status} />
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-white/90">{active.production.title}</h2>
                {active.production.engine ? (
                  <Badge variant="outline" className="border-white/15 text-[10px] text-white/50">{active.production.engine === 'ffmpeg' ? 'local composition engine' : active.production.engine === 'hyperframes' ? 'local render engine' : 'composition engine'}</Badge>
                ) : null}
                {ACTIVE_STATUSES.has(status) ? (
                  <Button onClick={() => void cancel(active.production.id)} variant="outline" className="h-7 border-red-400/30 px-2 text-[11px] text-red-300 hover:bg-red-400/10">
                    Cancel
                  </Button>
                ) : null}
                {/* Checkpoint resume: the orchestration died (worker OOM /
                    WORKER_LOST) while the production is still open — offered
                    whenever there is no live orchestration to continue. */}
                {ACTIVE_STATUSES.has(status) &&
                active.orchestrationStatus &&
                ['failed', 'cancelled', 'completed'].includes(active.orchestrationStatus) ? (
                  <Button onClick={() => void resumeComposition(active.production.id)} variant="outline" className="h-7 border-amber-400/30 px-2 text-[11px] text-amber-200 hover:bg-amber-400/10">
                    <RefreshCw className="mr-1 h-3 w-3" /> Resume
                  </Button>
                ) : null}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Progress value={active.production.progress} className="h-1.5 flex-1 bg-white/5" />
                <span className="w-9 text-right text-[10px] text-white/40">{active.production.progress}%</span>
              </div>
              <p className="mt-1 text-[10px] text-white/35">
                Progress reflects the real production record — scenes generated, then composition, render and validation.
              </p>

              {active.production.errorMessage ? (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-red-400/25 bg-red-400/5 p-2 text-[11px] leading-relaxed text-red-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {active.production.errorMessage}
                </p>
              ) : null}

              {/* scene list */}
              <ul className="mt-3 space-y-1.5">
                {scenes.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
                    <div className="mt-0.5"><SceneStatusIcon status={s.status} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                        <span className="font-medium text-white/80">Scene {s.idx}</span>
                        <span className="text-white/40">{s.durationSeconds ? `${s.durationSeconds}s` : ''}</span>
                        <span className="text-white/35">{s.purpose ? (PURPOSE_LABEL[s.purpose] ?? s.purpose) : ''}</span>
                        {s.status === 'failed' && s.attempts > 0 ? <span className="text-white/30">attempt {s.attempts}</span> : null}
                      </div>
                      {s.errorMessage ? (
                        <p className="mt-0.5 text-[10px] leading-relaxed text-red-200/80">{s.errorMessage}</p>
                      ) : (
                        <p className="mt-0.5 truncate text-[10px] text-white/40">{s.visualDescription}</p>
                      )}
                    </div>
                    {s.status === 'failed' ? (
                      <Button
                        onClick={() => void regenerateScene(active.production.id, s.idx)}
                        variant="outline"
                        className="h-7 shrink-0 border-[rgba(212,175,55,0.3)] px-2 text-[10px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]"
                      >
                        <RefreshCw className="mr-1 h-3 w-3" /> Regenerate
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {scenes.length > 0 ? (
                <p className="mt-1.5 text-[10px] text-white/30">
                  {readyCount}/{scenes.length} scenes delivered{failedCount > 0 ? ` · ${failedCount} failed` : ''} — failed scenes never disappear from this history.
                </p>
              ) : null}

              {/* deliverables */}
              {active.deliverables?.video ? (
                <div className="mt-3 space-y-2">
                  <video
                    controls
                    preload="metadata"
                    poster={active.deliverables.poster ? `/api/jazmii/director/${active.production.id}/deliverables/poster` : undefined}
                    src={`/api/jazmii/director/${active.production.id}/deliverables/video`}
                    className="w-full rounded-lg border border-white/10 bg-black"
                  />
                  <div className="flex flex-wrap gap-2">
                    {[
                      { slug: 'video', label: 'Video MP4' },
                      { slug: 'poster', label: 'Poster' },
                      { slug: 'captions', label: 'Captions SRT' },
                      { slug: 'plan', label: 'Production plan' },
                      { slug: 'share-copy', label: 'Share copy' },
                      { slug: 'render-metadata', label: 'Render metadata' },
                      { slug: 'storyboard', label: 'Storyboard JSON' },
                    ].filter((d) => active.deliverables?.[d.slug]).map((d) => (
                      <a
                        key={d.slug}
                        href={`/api/jazmii/director/${active.production.id}/deliverables/${d.slug}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-[rgba(212,175,55,0.3)] px-2.5 py-1.5 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]"
                      >
                        <Download className="h-3 w-3" /> {d.label}
                      </a>
                    ))}
                    {active.production.trustTaskId && onOpenTrustTask ? (
                      <button
                        onClick={() => onOpenTrustTask(active.production.trustTaskId!)}
                        className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/5"
                      >
                        Trust receipt
                      </button>
                    ) : null}
                    <Button
                      onClick={() => void deleteProduction(active.production.id)}
                      variant="outline"
                      className="ml-auto h-8 border-white/10 px-2 text-[10px] text-white/40 hover:bg-white/5"
                    >
                      Delete production
                    </Button>
                  </div>
                  <p className="text-[10px] leading-relaxed text-white/30">
                    The video is shown because ffprobe validated the real file. That proves media structure — not creative quality.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          {/* ---------- trust receipt (terminal, no deliverables conflict) ---------- */}
          {active && ['failed', 'cancelled'].includes(active.production.status) && active.production.trustTaskId && onOpenTrustTask ? (
            <button
              onClick={() => onOpenTrustTask(active.production.trustTaskId!)}
              className="rounded-lg border border-white/15 px-3 py-2 text-[11px] text-white/60 hover:bg-white/5"
            >
              Open the Trust receipt for this production
            </button>
          ) : null}

          {/* ---------- empty state ---------- */}
          {!active && productions.length === 0 ? (
            <p className="py-6 text-center text-[11px] text-white/35">
              Plan a video above — the storyboard comes back for your approval before any scene is generated.
            </p>
          ) : null}
        </div>
      </div>

      {/* hidden inputs are referenced by their visible labels above */}
    </div>
  )
}
