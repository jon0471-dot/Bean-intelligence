'use client'

/**
 * BEAN Intelligence — GANGZII Narration Studio (M27).
 *
 * Real narration production on the existing GANGZII APIs:
 *  - script editor with deterministic segmentation (original text preserved
 *    per segment; the normalized synthesis text is inspectable via the API);
 *  - per-segment generation with REAL progress, preview and individual
 *    regeneration (a one-sentence edit never regenerates the whole track);
 *  - honest engine control: the LOCAL Kokoro engine install is an explicit
 *    user action with the download size shown BEFORE it (never automatic);
 *  - measured segment timings (approximate, stated as such) + SRT/VTT
 *    export that skips unmeasured segments instead of estimating them;
 *  - join: one audio-production job; refused unless EVERY segment is ready.
 *
 * Design system: the existing black/champagne-gold language (shared kit).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AudioLines,
  CheckCircle2,
  Download,
  FileAudio,
  Loader2,
  RotateCcw,
  Wand2,
  XCircle,
  HardDriveDownload,
  RefreshCw,
} from 'lucide-react'
import { beanFetch, EmptyState, GoldBadge, Spinner } from '@/components/bean/shared'
import { GANGZII_VOICE_PRESETS, KOKORO_VOICE_PRESETS } from '@/lib/registry/gangzii-presets'

// ---- types mirroring the API -------------------------------------------------

interface SegmentView {
  id: string
  idx: number
  text: string
  normalizedText?: string
  voice: string
  speed?: number
  status: string
  jobId: string | null
  audioUrl: string | null
  durationMs: number | null
  errorNote: string | null
}

interface ProjectView {
  id: string
  title: string
  language: string
  source: string
  jazmiiProductionId?: string | null
  status: string
  updatedAt?: string
  segments: SegmentView[]
}

interface EngineStatus {
  engine: { id: string; repo: string; dtype: string; approxDownloadMb: number }
  status: {
    installed: boolean
    healthy: boolean
    detail: string
    revision: string | null
    filesBytes: number | null
    loadedInProcess: boolean
    installing: boolean
    installProgress: { file: string; receivedBytes: number } | null
    health: { healthy: boolean; detail: string; latencyMs: number | null }
    /** M28: artifact provenance/integrity summary (null when not installed). */
    integrity: {
      state: string
      canonicalCommitSha: string | null
      checksumSource: string | null
      filesVerified: number
      filesTotal: number
      missing: string[]
      unexpected: string[]
      modifiedCount: number
      notes: string[]
    } | null
  }
  metadata: { licenses: Record<string, string> }
}

/** M28: honest, human-readable provenance state for the engine card. */
function provenanceLabel(state: string): string {
  switch (state) {
    case 'canonical-verified':
      return 'canonically verified (Hugging Face revision pinned by exact commit)'
    case 'mirror-hash-verified':
      return 'verified against the download mirror — canonical Hugging Face cross-verification still pending'
    case 'pending-verification':
      return 'installed, provenance pending verification'
    case 'not-installed':
      return 'not installed'
    default:
      return state
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fmtMs(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  return `${(ms / 1000).toFixed(2)} s`
}

export function GangziiNarration() {
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // create form
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [voice, setVoice] = useState<string>(KOKORO_VOICE_PRESETS[0]?.id ?? 'af_heart')
  const [speed, setSpeed] = useState(1.0)
  const [creating, setCreating] = useState(false)

  // engine install state
  const [engine, setEngine] = useState<EngineStatus | null>(null)
  const [installing, setInstalling] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadProjects = useCallback(async () => {
    try {
      const res = await beanFetch<{ projects: ProjectView[] }>('/api/gangzii/narration')
      setProjects(res.projects)
      if (!selectedId && res.projects.length > 0) setSelectedId(res.projects[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load narration projects.')
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  const loadEngine = useCallback(async () => {
    try {
      const res = await beanFetch<EngineStatus>('/api/gangzii/tts-engine')
      setEngine(res)
      setInstalling(res.status.installing)
    } catch {
      // Non-fatal: the workspace still works with hosted voices.
    }
  }, [])

  useEffect(() => {
    void loadProjects()
    void loadEngine()
  }, [loadProjects, loadEngine])

  // Poll while any segment is generating (3s, tab-wide — same cadence as
  // the Voice Studio so the two surfaces stay consistent).
  const anyGenerating = projects.some((p) => p.segments.some((s) => s.status === 'generating'))
  useEffect(() => {
    if (!anyGenerating) {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = null
      return
    }
    pollRef.current = setInterval(() => void loadProjects(), 3000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [anyGenerating, loadProjects])

  const selected = projects.find((p) => p.id === selectedId) ?? null

  const createProject = async () => {
    setError(null)
    setNotice(null)
    if (!text.trim()) {
      setError('Enter the narration script first.')
      return
    }
    setCreating(true)
    try {
      const res = await beanFetch<{ project: { id: string } }>('/api/gangzii/narration', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim() || undefined, text, voice, speed }),
      })
      setNotice('Narration script segmented. Generate the segments next — each one is a real synthesis job.')
      setText('')
      setTitle('')
      setSelectedId(res.project.id)
      await loadProjects()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the narration project.')
    } finally {
      setCreating(false)
    }
  }

  const generateAll = async (projectId: string) => {
    setError(null)
    try {
      const res = await beanFetch<{ enqueued: number; totalSegments: number }>(`/api/gangzii/narration/${projectId}/generate`, { method: 'POST' })
      setNotice(`${res.enqueued} segment(s) queued for synthesis (${res.totalSegments} total). Completed segments are never re-generated.`)
      await loadProjects()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start generation.')
    }
  }

  const regenerateSegment = async (projectId: string, segmentId: string) => {
    setError(null)
    try {
      await beanFetch(`/api/gangzii/narration/${projectId}/segments/${segmentId}`, { method: 'POST' })
      setNotice('Segment queued for regeneration — sibling segments are untouched.')
      await loadProjects()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not regenerate the segment.')
    }
  }

  const joinProject = async (projectId: string) => {
    setError(null)
    try {
      const res = await beanFetch<{ jobId: string; inputs: number }>(`/api/gangzii/narration/${projectId}/join`, { method: 'POST' })
      setNotice(`Join queued: ${res.inputs} segment(s) will be concatenated into one narration track (job ${res.jobId.slice(0, 8)}…).`)
      await loadProjects()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Join refused — every segment must be ready first.')
    }
  }

  const downloadSubtitles = async (projectId: string, format: 'srt' | 'vtt') => {
    setError(null)
    try {
      const res = await beanFetch<{ content: string; measuredCount: number; skippedCount: number; approximationNote: string }>(
        `/api/gangzii/narration/${projectId}/subtitles?format=${format}`,
      )
      const blob = new Blob([res.content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `narration-${projectId.slice(0, 8)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
      setNotice(
        `${format.toUpperCase()} exported: ${res.measuredCount} measured segment(s)${res.skippedCount > 0 ? `, ${res.skippedCount} SKIPPED (no measured audio — timestamps are never estimated)` : ''}. Timing is segment-level, not word alignment.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export subtitles.')
    }
  }

  const installEngine = async () => {
    setError(null)
    setInstalling(true)
    setNotice('Installing the local TTS engine… the download is checksum-verified before use.')
    try {
      const res = await beanFetch<{ ok: boolean; message: string }>('/api/gangzii/tts-engine', {
        method: 'POST',
        body: JSON.stringify({ action: 'install' }),
      })
      setNotice(res.message)
      await loadEngine()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The local engine install failed.')
    } finally {
      setInstalling(false)
    }
  }

  const deleteProject = async (projectId: string) => {
    setError(null)
    try {
      await beanFetch(`/api/gangzii/narration/${projectId}`, { method: 'DELETE' })
      setSelectedId(null)
      await loadProjects()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the project.')
    }
  }

  const inputCls =
    'w-full rounded-md border border-[rgba(212,175,55,0.25)] bg-black/40 px-3 py-2 text-sm text-[#f5e7c1] placeholder:text-[#8a7326] focus:border-[rgba(212,175,55,0.6)] focus:outline-none'
  const btnCls =
    'inline-flex items-center gap-1.5 rounded-md border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.12)] px-3 py-1.5 text-xs font-medium text-[#f0c75e] transition hover:bg-[rgba(212,175,55,0.2)] disabled:cursor-not-allowed disabled:opacity-40'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] px-3 py-2 text-xs text-[#f0c75e]">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Local engine card — install is EXPLICIT, size shown before */}
      <div className="rounded-xl border border-[rgba(212,175,55,0.2)] bg-black/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium text-[#f5e7c1]">
              <HardDriveDownload className="h-4 w-4 text-[#d4af37]" />
              Local TTS engine (Apache-2.0 license, runs on this host)
            </div>
            <p className="mt-1 text-xs text-[#bfa860]">
              {engine
                ? engine.status.installed
                  ? `Installed (${fmtBytes(engine.status.filesBytes ?? 0)}, revision ${engine.status.revision ?? 'pinned'}). ${engine.status.health.healthy ? 'Engine healthy.' : engine.status.health.detail}`
                  : `Not installed. Installing downloads ~${engine.engine.approxDownloadMb} MB (one explicit action — never automatic). It runs fully offline afterwards.`
                : 'Engine status unavailable.'}
            </p>
            {installing && engine?.status.installProgress && (
              <p className="mt-1 text-xs text-[#8a7326]">Downloading {engine.status.installProgress.file}… {fmtBytes(engine.status.installProgress.receivedBytes)}</p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {!engine?.status.installed ? (
              <button className={btnCls} onClick={installEngine} disabled={installing}>
                {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDriveDownload className="h-3.5 w-3.5" />}
                {installing ? 'Installing…' : `Install (~${engine?.engine.approxDownloadMb ?? 92} MB)`}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-[#7dd87d]">
                <CheckCircle2 className="h-3.5 w-3.5" /> installed
              </span>
            )}
            <button className={btnCls} onClick={() => void loadEngine()} aria-label="Refresh engine status">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {engine && (
          <p className="mt-2 text-[11px] leading-relaxed text-[#8a7326]">
            Licenses — weights: {engine.metadata.licenses.weights}; code: {engine.metadata.licenses.code}; phonemizer dependency: {engine.metadata.licenses.dependency}
          </p>
        )}
        {engine?.status.installed && engine.status.integrity && (
          <div className="mt-2 rounded-lg border border-[rgba(212,175,55,0.12)] bg-black/20 p-2.5">
            <p className="text-[11px] text-[#bfa860]">
              Artifact provenance:{' '}
              <span className={engine.status.integrity.state === 'canonical-verified' ? 'text-[#7dd87d]' : 'text-[#e0c184]'}>
                {provenanceLabel(engine.status.integrity.state)}
              </span>
              {engine.status.integrity.checksumSource ? ` — checksum source: ${engine.status.integrity.checksumSource}` : ''}
              {engine.status.integrity.canonicalCommitSha ? ` — canonical commit ${engine.status.integrity.canonicalCommitSha.slice(0, 12)}` : ''}
              {`. Files verified ${engine.status.integrity.filesVerified}/${engine.status.integrity.filesTotal}, ${engine.status.integrity.modifiedCount} modified, ${engine.status.integrity.missing.length} missing, ${engine.status.integrity.unexpected.length} unexpected.`}
            </p>
            {engine.status.integrity.state !== 'canonical-verified' && (
              <p className="mt-1 text-[10px] leading-relaxed text-[#8a7326]">
                Final canonical verification runs on a machine with Hugging Face access: <code>bun scripts/m28-verify-kokoro-provenance.ts</code> — it pins the exact commit, compares every artifact byte-for-byte and upgrades this state. Nothing here claims more than was actually checked.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Create form */}
      <div className="rounded-xl border border-[rgba(212,175,55,0.2)] bg-black/30 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#f5e7c1]">
          <Wand2 className="h-4 w-4 text-[#d4af37]" />
          New narration script
        </div>
        <div className="space-y-3">
          <input className={inputCls} placeholder="Project title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          <textarea
            className={`${inputCls} min-h-[110px] resize-y`}
            placeholder="Paste or write the narration text. It is split on sentence boundaries into segments you can regenerate individually — the original wording is preserved exactly."
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={20000}
          />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-[#bfa860]">
              Voice
              <select className={inputCls + ' w-56'} value={voice} onChange={(e) => setVoice(e.target.value)}>
                <optgroup label="Local engine voices">
                  {KOKORO_VOICE_PRESETS.filter((v) => v.grade !== null).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName} ({v.language}) — grade {v.grade}
                    </option>
                  ))}
                  <option disabled>— untested languages (no published grade) —</option>
                  {KOKORO_VOICE_PRESETS.filter((v) => v.grade === null).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName} ({v.language}) — unverified
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Hosted gateway">
                  {GANGZII_VOICE_PRESETS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName} ({v.category})
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#bfa860]">
              Speed {speed.toFixed(1)}×
              <input type="range" min={0.5} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-40 accent-[#d4af37]" />
            </label>
            <button className={btnCls} onClick={createProject} disabled={creating || !text.trim()}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AudioLines className="h-3.5 w-3.5" />}
              Create script
            </button>
          </div>
        </div>
      </div>

      {/* Projects list */}
      {projects.length === 0 ? (
        <EmptyState icon={<FileAudio className="h-6 w-6" />} title="No narration projects yet" hint="Create a narration script above — GANGZII segments it on sentence boundaries and synthesizes each segment as a real job." />
      ) : (
        <div className="space-y-4">
          {projects.map((p) => {
            const ready = p.segments.filter((s) => s.status === 'ready').length
            const totalMs = p.segments.reduce((a, s) => a + (s.durationMs ?? 0), 0)
            return (
              <div key={p.id} className="rounded-xl border border-[rgba(212,175,55,0.2)] bg-black/30">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(212,175,55,0.12)] px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-[#f5e7c1]">{p.title}</span>
                      <GoldBadge tone={p.source === 'jazmii-storyboard' ? 'gold' : 'neutral'}>
                        {p.source === 'jazmii-storyboard' ? 'JAZMII' : 'script'}
                      </GoldBadge>
                    </div>
                    <p className="mt-0.5 text-xs text-[#8a7326]">
                      {ready}/{p.segments.length} segments ready · measured total {fmtMs(totalMs || null)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button className={btnCls} onClick={() => void generateAll(p.id)} disabled={p.segments.every((s) => s.status !== 'pending' && s.status !== 'failed')}>
                      <AudioLines className="h-3.5 w-3.5" /> Generate pending
                    </button>
                    <button className={btnCls} onClick={() => void joinProject(p.id)} disabled={ready !== p.segments.length} title={ready !== p.segments.length ? 'Every segment must be ready before joining' : 'Concatenate all segments into one track'}>
                      <FileAudio className="h-3.5 w-3.5" /> Join track
                    </button>
                    <button className={btnCls} onClick={() => void downloadSubtitles(p.id, 'srt')}>
                      <Download className="h-3.5 w-3.5" /> SRT
                    </button>
                    <button className={btnCls} onClick={() => void downloadSubtitles(p.id, 'vtt')}>
                      <Download className="h-3.5 w-3.5" /> VTT
                    </button>
                    <button className={btnCls} onClick={() => void deleteProject(p.id)} aria-label="Delete project">
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="divide-y divide-[rgba(212,175,55,0.08)]">
                  {p.segments.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                      <span className="mt-1 w-6 shrink-0 text-right text-xs text-[#8a7326]">#{s.idx}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug text-[#f5e7c1]">{s.text}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#8a7326]">
                          <GoldBadge tone={s.status === 'ready' ? 'green' : s.status === 'failed' ? 'red' : s.status === 'generating' ? 'gold' : 'neutral'}>
                            {s.status}
                          </GoldBadge>
                          {s.durationMs !== null && <span>measured {fmtMs(s.durationMs)}</span>}
                          {s.voice && <span>voice {s.voice}</span>}
                          {s.errorNote && <span className="text-red-300/80">{s.errorNote}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {s.audioUrl && (
                          <audio controls preload="none" src={s.audioUrl} className="h-8 w-56 max-w-full" />
                        )}
                        <button
                          className={btnCls}
                          onClick={() => void regenerateSegment(p.id, s.id)}
                          disabled={s.status === 'generating'}
                          title="Regenerate only this segment"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-[#8a7326]">
        Timing honesty: segment timings are MEASURED from the produced audio (approximate, segment-level — not word alignment). Subtitle exports skip
        unmeasured segments instead of estimating them. Speech quality is not machine-verifiable: listen to each segment before approving the joined
        track.
      </p>
    </div>
  )
}
