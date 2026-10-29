'use client'

/**
 * BEAN Intelligence — GANGZII workspace (voice, speech & audio).
 *
 * TRUTH POLICY: every control here maps to a REAL backend. Capabilities with
 * no deployed worker (music generation / singing, voice cloning, source
 * separation, denoising) are rendered as clearly marked unavailable sections
 * — they are never simulated, and spoken TTS is never presented as singing.
 *
 * Registries: voice + song presets are fetched from the backend
 * (/api/gangzii/voices, /api/gangzii/song-presets) and fall back to the
 * client-safe shared registry for first render. The client never maintains
 * its own voice or song list — one registry, served and shared.
 *
 * Channels: the speech provider emits MONO (measured). The source asset is
 * always preserved; mono/stereo exports are separate ffprobe-verified
 * conversions, and stereo is always labeled DUAL-MONO (the mono signal
 * duplicated to L/R), never spatial stereo.
 *
 * Lyrics: drafted by RIISHE through the BEAN conversation adapter, then
 * analyzable and improvable by RIISHE on request. RIISHE never overwrites
 * the user's draft — revisions are shown side-by-side and applied only on
 * explicit user action.
 *
 * Live Voice is an honest TURN-BASED pipeline (record → ASR → conversation
 * model → TTS), not a duplex stream.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { Progress } from '@/components/ui/progress'
import {
  beanFetch,
  GoldBadge,
  Spinner,
  EmptyState,
  StatusDot,
  timeAgo,
} from './shared'
import { cn } from '@/lib/utils'
import { GANGZII_LIMITS } from '@/lib/registry/products'
import {
  GANGZII_VOICE_CATEGORIES,
  GANGZII_VOICE_PRESETS,
  GANGZII_SONG_PRESETS,
  GANGZII_LANGUAGE_COVERAGE,
  type GangziiVoicePreset,
  type GangziiSongPreset,
} from '@/lib/registry/gangzii-presets'
import {
  AudioLines,
  Mic,
  Square,
  Play,
  Download,
  Trash2,
  RotateCcw,
  Music,
  FileAudio,
  Wand2,
  PenLine,
  ShieldAlert,
  Info,
  CheckCircle2,
  XCircle,
  Clock,
  Copy,
  Loader2,
  Sparkles,
  ScanSearch,
  ArrowRightLeft,
  Volume2,
} from 'lucide-react'

const MAX_CHARS = GANGZII_LIMITS.maxCharsPerRequest
const PREFERENCES_STORAGE_KEY = 'bean.gangzii.studio.v1'

// ---- types -----------------------------------------------------------------

interface Capability {
  available: boolean
  detail: string
  latencyMs: number | null
  checkedAt: string
}
interface Availability {
  available: boolean
  partial: boolean
  capabilities: Record<string, Capability>
}
interface TtsJob {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  voice: string | null
  speed: number | null
  text: string | null
  source: string
  errorCode: string | null
  errorMessage: string | null
  audioUrl: string | null
  chunks?: number
  durationSec?: number
  bytes?: number
  format?: string
  sampleRateHz?: number
  channels?: number
  channelLayout?: string
  queuedAt: string
}
interface LabJob {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  displayName: string
  container: string | null
  target?: string | null
  channels?: string
  channelSemantics?: string | null
  codec?: string | null
  sampleRateHz?: number | null
  actualChannels?: number | null
  durationSec?: number | null
  errorCode: string | null
  errorMessage: string | null
  transcript?: string | null
  audioUrl: string | null
  bytes?: number
  queuedAt: string
}
interface Turn {
  id: string
  transcript: string
  reply: string
  audioUrl: string | null
  error: string | null
}
type AnalysisResult = {
  overall: string
  strengths: string[]
  weaknesses: Array<{ issue: string; quote: string; why: string }>
  sections: Array<{ section: string; suggestion: string }>
  improvements: string[]
}
type SongPresetView = GangziiSongPreset & { unavailableReason?: string }
interface VoiceCatalog {
  categories: typeof GANGZII_VOICE_CATEGORIES
  presets: GangziiVoicePreset[]
  languageCoverage: typeof GANGZII_LANGUAGE_COVERAGE
}
interface SongCatalog {
  generation: { available: boolean; reason: string; singingAvailable: boolean }
  presets: SongPresetView[]
}

type TabId = 'voice' | 'song' | 'lab' | 'live'
type LivePhase = 'idle' | 'recording' | 'transcribing' | 'thinking' | 'speaking'
type RiisheBusy = null | 'draft' | 'analyze' | 'improve'

const TABS: Array<{ id: TabId; label: string; icon: React.ElementType }> = [
  { id: 'voice', label: 'Voice Studio', icon: AudioLines },
  { id: 'song', label: 'Song Studio', icon: Music },
  { id: 'lab', label: 'Audio Lab', icon: FileAudio },
  { id: 'live', label: 'Live Voice', icon: Mic },
]

async function pollJob<T extends { status: string; id: string }>(
  id: string,
  urlFor: (jobId: string) => string,
  maxTries = 80,
): Promise<T | null> {
  for (let i = 0; i < maxTries; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    try {
      const d = await beanFetch<{ job: T }>(urlFor(id))
      if (d.job.status === 'completed' || d.job.status === 'failed') return d.job
    } catch {
      return null
    }
  }
  return null
}

function UnavailableBanner({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="bean-glass mb-5 rounded-xl border-amber-500/25 p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-semibold text-amber-300">{title}</span>
      </div>
      <p className="text-[13px] leading-relaxed text-white/60">{reason}</p>
    </div>
  )
}

// ---- client-safe fallback catalogs (first render; the API is authoritative) -

const FALLBACK_MUSIC_REASON =
  'Music generation requires a self-hosted GPU worker (ACE-Step 1.5 candidate) whose model-weight license is still under review. BEAN does not simulate music.'

const FALLBACK_VOICE_CATALOG: VoiceCatalog = {
  categories: GANGZII_VOICE_CATEGORIES,
  presets: GANGZII_VOICE_PRESETS,
  languageCoverage: GANGZII_LANGUAGE_COVERAGE,
}

const FALLBACK_SONG_CATALOG: SongCatalog = {
  generation: { available: false, reason: FALLBACK_MUSIC_REASON, singingAvailable: false },
  presets: GANGZII_SONG_PRESETS,
}

// ---- export controls (mono/stereo dual-mono, ffprobe-verified downstream) ---

function ExportRow({
  jobId,
  conversionReady,
  onQueued,
  onError,
}: {
  jobId: string
  conversionReady: boolean
  onQueued: (message: string) => void
  onError: (message: string) => void
}) {
  const [target, setTarget] = useState<'wav' | 'mp3'>('wav')
  const [channels, setChannels] = useState<'mono' | 'stereo'>('mono')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('sourceJobId', jobId)
      fd.append('target', target)
      fd.append('channels', channels)
      const res = await fetch('/api/gangzii/convert', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } }
      if (!res.ok || data.ok === false) {
        throw new Error(data.error?.message ?? `Export failed (${res.status})`)
      }
      onQueued(
        `Export queued: ${target.toUpperCase()} · ${channels === 'stereo' ? 'stereo (dual-mono — mono duplicated to L/R, not spatial stereo)' : 'mono'}. It appears under Converted files (Audio Lab) with ffprobe-verified metadata.`,
      )
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!conversionReady) {
    return <p className="text-[11px] text-amber-300/80">Export is unavailable — the local ffmpeg transcoder is not responding.</p>
  }

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-white/40">Export</span>
        <div className="flex overflow-hidden rounded-md border border-white/10">
          {(['wav', 'mp3'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setTarget(f)}
              className={cn(
                'px-2 py-1 text-[10px] uppercase transition-colors',
                target === f ? 'bg-[rgba(212,175,55,0.15)] text-[#f0c75e]' : 'text-white/45 hover:text-white/75',
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-md border border-white/10">
          {(['mono', 'stereo'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setChannels(c)}
              className={cn(
                'px-2 py-1 text-[10px] capitalize transition-colors',
                channels === c ? 'bg-[rgba(212,175,55,0.15)] text-[#f0c75e]' : 'text-white/45 hover:text-white/75',
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2.5 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)] disabled:opacity-50"
        >
          {busy ? <Spinner className="h-3 w-3 border-[rgba(212,175,55,0.3)] border-t-[#f0c75e]" /> : <Download className="h-3 w-3" />}
          Create export
        </button>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-white/35">
        {channels === 'stereo'
          ? 'Stereo export = dual-mono: the mono source duplicated into L/R. It is not spatial stereo and creates no stereo separation.'
          : 'Mono export matches the mono source exactly. The original generated audio is preserved untouched.'}
      </p>
    </div>
  )
}

// ---- RIISHE analysis panel ---------------------------------------------------

function AnalysisPanel({
  analysis,
  limitation,
}: {
  analysis: AnalysisResult
  limitation: string
}) {
  return (
    <div className="bean-glass mb-4 rounded-xl p-4">
      <div className="mb-2 flex items-center gap-2">
        <ScanSearch className="h-4 w-4 text-[#d4af37]" />
        <span className="text-sm font-semibold text-[#f0c75e]">RIISHE lyric analysis</span>
      </div>
      <p className="mb-3 text-[13px] leading-relaxed text-white/75">{analysis.overall}</p>

      {analysis.strengths.length > 0 ? (
        <div className="mb-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-300/80">Strengths</div>
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-white/65">
            {analysis.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.weaknesses.length > 0 ? (
        <div className="mb-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-300/80">Weaknesses (with quoted examples)</div>
          <ul className="space-y-2">
            {analysis.weaknesses.map((w, i) => (
              <li key={i} className="rounded-lg border border-white/10 bg-black/20 p-2.5">
                <div className="text-[12.5px] text-white/75">{w.issue}</div>
                {w.quote ? (
                  <div className="mt-1 text-[12px] italic text-amber-200/70">“{w.quote}”</div>
                ) : null}
                {w.why ? <div className="mt-0.5 text-[11.5px] text-white/45">{w.why}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.sections.length > 0 ? (
        <div className="mb-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#f0c75e]/80">Section-by-section suggestions</div>
          <ul className="space-y-1.5">
            {analysis.sections.map((s, i) => (
              <li key={i} className="text-[12.5px] leading-relaxed text-white/65">
                <span className="font-medium text-white/80">{s.section}:</span> {s.suggestion}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis.improvements.length > 0 ? (
        <div className="mb-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#f0c75e]/80">Suggested improvements</div>
          <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-white/65">
            {analysis.improvements.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-2 border-t border-white/10 pt-2 text-[11px] leading-relaxed text-white/40">{limitation}</p>
    </div>
  )
}

// ---- workspace -------------------------------------------------------------

interface StoredPrefs {
  voice?: string
  speed?: number
  songPresetId?: string | null
  lyrics?: string
  songIdea?: string
}

function loadStoredPrefs(): StoredPrefs {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? '{}') as StoredPrefs
  } catch {
    return {}
  }
}

export function Gangzii() {
  const [tab, setTab] = useState<TabId>('voice')
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [voiceCatalog, setVoiceCatalog] = useState<VoiceCatalog>(FALLBACK_VOICE_CATALOG)
  const [songCatalog, setSongCatalog] = useState<SongCatalog>(FALLBACK_SONG_CATALOG)

  // Voice Studio
  const [ttsText, setTtsText] = useState('')
  const [voice, setVoice] = useState<string>(GANGZII_VOICE_PRESETS[0]?.id ?? 'tongtong')
  const [speed, setSpeed] = useState(1.0)
  const [ttsJobs, setTtsJobs] = useState<TtsJob[]>([])
  const [ttsBusy, setTtsBusy] = useState(false)

  // Song Studio
  const [songIdea, setSongIdea] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [lyricsPreferences, setLyricsPreferences] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [riisheBusy, setRiisheBusy] = useState<RiisheBusy>(null)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [analysisLimitation, setAnalysisLimitation] = useState<string>(
    'RIISHE evaluates lyrics as TEXT (structure, phrasing, rhyme, imagery). It cannot verify vocal melody fit, instrumental timing or final musical quality — no singing or music-generation model is deployed on this platform.',
  )
  const [pendingRevision, setPendingRevision] = useState<string | null>(null)
  const [musicMessage, setMusicMessage] = useState<string | null>(null)

  // Audio Lab
  const [labFile, setLabFile] = useState<File | null>(null)
  const [convertTarget, setConvertTarget] = useState<'mp3' | 'ogg' | 'flac' | 'm4a' | 'wav'>('mp3')
  const [convertChannels, setConvertChannels] = useState<'mono' | 'stereo'>('mono')
  const [transcribeJobs, setTranscribeJobs] = useState<LabJob[]>([])
  const [convertJobs, setConvertJobs] = useState<LabJob[]>([])
  const [editedTranscripts, setEditedTranscripts] = useState<Record<string, string>>({})
  const [labBusy, setLabBusy] = useState(false)

  // Live Voice
  const [livePhase, setLivePhase] = useState<LivePhase>('idle')
  const [turns, setTurns] = useState<Turn[]>([])
  const [liveVoice, setLiveVoice] = useState<string>(GANGZII_VOICE_PRESETS[0]?.id ?? 'tongtong')
  const [recordSecs, setRecordSecs] = useState(0)

  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const liveAudioRef = useRef<HTMLAudioElement | null>(null)
  const historyRef = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const prefsLoadedRef = useRef(false)

  const cap = (k: string) => availability?.capabilities?.[k]

  const loadAvailability = useCallback(async () => {
    try {
      const d = await beanFetch<Availability>('/api/gangzii/availability')
      setAvailability(d)
    } catch {
      /* non-fatal; per-tab status lines show unknown */
    }
  }, [])

  // Preset catalogs: the backend response is authoritative (it merges live
  // capability truth); the shared registry is the render-first fallback.
  const loadCatalogs = useCallback(async () => {
    try {
      const v = await beanFetch<VoiceCatalog>('/api/gangzii/voices')
      setVoiceCatalog({ categories: v.categories, presets: v.presets, languageCoverage: v.languageCoverage })
    } catch {
      /* fallback catalog stays */
    }
    try {
      const s = await beanFetch<SongCatalog>('/api/gangzii/song-presets')
      setSongCatalog({ generation: s.generation, presets: s.presets })
    } catch {
      /* fallback catalog stays */
    }
  }, [])

  const loadLists = useCallback(async () => {
    try {
      const [t, tr, cv] = await Promise.all([
        beanFetch<{ jobs: TtsJob[] }>('/api/gangzii/tts'),
        beanFetch<{ jobs: LabJob[] }>('/api/gangzii/transcribe'),
        beanFetch<{ jobs: LabJob[] }>('/api/gangzii/convert'),
      ])
      setTtsJobs(t.jobs)
      setTranscribeJobs(tr.jobs)
      setConvertJobs(cv.jobs)
      return { tts: t.jobs, transcribe: tr.jobs, convert: cv.jobs }
    } catch {
      return { tts: [], transcribe: [], convert: [] }
    }
  }, [])

  useEffect(() => {
    void loadAvailability()
    void loadCatalogs()
    void loadLists()
  }, [loadAvailability, loadCatalogs, loadLists])

  // Restore persisted studio preferences once (selected voice/speed/preset
  // and the working lyrics draft — user-owned state, not backend data).
  useEffect(() => {
    if (prefsLoadedRef.current) return
    prefsLoadedRef.current = true
    const p = loadStoredPrefs()
    const validVoice = (id: string | undefined) =>
      id && GANGZII_VOICE_PRESETS.some((v) => v.id === id) ? id : undefined
    if (validVoice(p.voice)) setVoice(p.voice!)
    if (validVoice(p.voice)) setLiveVoice(p.voice!)
    if (typeof p.speed === 'number' && p.speed >= GANGZII_LIMITS.speedMin && p.speed <= GANGZII_LIMITS.speedMax) {
      setSpeed(p.speed)
    }
    if (p.songPresetId && GANGZII_SONG_PRESETS.some((s) => s.id === p.songPresetId)) {
      setSelectedPresetId(p.songPresetId)
    }
    if (typeof p.lyrics === 'string' && p.lyrics) setLyrics(p.lyrics)
    if (typeof p.songIdea === 'string' && p.songIdea) setSongIdea(p.songIdea)
  }, [])

  // Persist preferences on change (best-effort, client-side only).
  useEffect(() => {
    if (!prefsLoadedRef.current || typeof window === 'undefined') return
    try {
      const p: StoredPrefs = { voice, speed, songPresetId: selectedPresetId, lyrics, songIdea }
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(p))
    } catch {
      /* storage unavailable (private mode) — preferences simply not persisted */
    }
  }, [voice, speed, selectedPresetId, lyrics, songIdea])

  // Poll while any job is in flight.
  useEffect(() => {
    const inflight =
      ttsJobs.some((j) => j.status === 'queued' || j.status === 'running') ||
      transcribeJobs.some((j) => j.status === 'queued' || j.status === 'running') ||
      convertJobs.some((j) => j.status === 'queued' || j.status === 'running')
    if (!inflight) return
    const t = setInterval(() => void loadLists(), 3000)
    return () => clearInterval(t)
  }, [ttsJobs, transcribeJobs, convertJobs, loadLists])

  // Cleanup on unmount: recorder + timers + live audio.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      recorderRef.current?.stream.getTracks().forEach((tr) => tr.stop())
      liveAudioRef.current?.pause()
    }
  }, [])

  // ---- shared actions ------------------------------------------------------

  const selectedPreset = songCatalog.presets.find((p) => p.id === selectedPresetId) ?? null

  async function submitTts(
    text: string,
    chosenVoice: string,
    chosenSpeed: number,
    source?: 'studio' | 'voice-preview' | 'song-preview' | 'live',
  ) {
    if (ttsBusy) return
    setTtsBusy(true)
    setActionError(null)
    setNotice(
      source === 'song-preview'
        ? 'Spoken preview queued — spoken, not sung. It appears below and in Voice Studio history.'
        : source === 'voice-preview'
          ? `Preview of “${voiceCatalog.presets.find((v) => v.id === chosenVoice)?.displayName ?? chosenVoice}” queued — it appears in Voice Studio history.`
          : null,
    )
    try {
      await beanFetch('/api/gangzii/tts', {
        method: 'POST',
        json: { text, voice: chosenVoice, speed: chosenSpeed, source: source ?? 'studio' },
      })
      await loadLists()
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setTtsBusy(false)
    }
  }

  function previewVoice(v: GangziiVoicePreset) {
    void submitTts(v.previewText, v.id, 1.0, 'voice-preview')
  }

  function regenerateTts(job: TtsJob) {
    if (!job.text) return
    setTtsText(job.text)
    if (voiceCatalog.presets.some((v) => v.id === job.voice)) setVoice(job.voice!)
    setSpeed(job.speed ?? 1)
    setTab('voice')
    setNotice('Parameters loaded from history — press Generate to re-create this audio.')
  }

  async function deleteJob(id: string) {
    setActionError(null)
    try {
      await beanFetch(`/api/gangzii/jobs/${id}`, { method: 'DELETE' })
      setTurns((prev) => prev.map((t) => (t.audioUrl?.includes(id) ? { ...t, audioUrl: null } : t)))
      await loadLists()
    } catch (e) {
      setActionError((e as Error).message)
    }
  }

  // ---- Song Studio — RIISHE lyrics workflow --------------------------------

  async function writeLyrics() {
    const idea = songIdea.trim()
    if (!idea || riisheBusy) return // duplicate-submission guard
    setRiisheBusy('draft')
    setActionError(null)
    setNotice(null)
    try {
      const d = await beanFetch<{ lyrics: string; writtenBy: string; note: string }>('/api/gangzii/lyrics', {
        method: 'POST',
        json: {
          prompt: idea,
          presetId: selectedPresetId ?? undefined,
          preferences: lyricsPreferences.trim() || undefined,
        },
      })
      if (!d.lyrics || !d.lyrics.trim()) {
        // The API also rejects empty drafts — this is belt-and-braces.
        throw new Error('RIISHE returned an empty draft. Your existing lyrics are untouched.')
      }
      if (lyrics.trim().length === 0) {
        setLyrics(d.lyrics)
        setNotice('Original lyrics drafted by RIISHE (AI-generated text). Edit them freely — the spoken preview is TTS, not singing.')
      } else {
        // Protect the user's working draft: route the new draft through the
        // compare flow instead of overwriting it.
        setPendingRevision(d.lyrics)
        setNotice('RIISHE drafted new lyrics. Compare them with your current draft below — nothing is replaced until you apply.')
      }
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setRiisheBusy(null)
    }
  }

  async function analyzeLyrics(wantDraft: boolean) {
    if (lyrics.trim().length < 8 || riisheBusy) return // duplicate-submission guard
    setRiisheBusy(wantDraft ? 'improve' : 'analyze')
    setActionError(null)
    setNotice(null)
    try {
      const d = await beanFetch<{
        analysis: AnalysisResult
        improvedDraft: string | null
        analyzedBy: string
        limitation: string
      }>('/api/gangzii/lyrics/analyze', {
        method: 'POST',
        json: {
          lyrics,
          songIdea: songIdea.trim() || undefined,
          presetId: selectedPresetId ?? undefined,
          wantImprovedDraft: wantDraft,
        },
      })
      setAnalysis(d.analysis)
      if (d.limitation) setAnalysisLimitation(d.limitation)
      if (wantDraft) {
        if (!d.improvedDraft) {
          throw new Error('RIISHE did not return an improved draft. Your lyrics are untouched — try again.')
        }
        setPendingRevision(d.improvedDraft)
        setNotice('RIISHE prepared an improved draft. Compare it with your version below — apply only if you want it.')
      } else {
        setNotice('RIISHE analyzed the current lyrics. Review the structured assessment below.')
      }
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setRiisheBusy(null)
    }
  }

  function applyRevision() {
    if (!pendingRevision) return
    setLyrics(pendingRevision)
    setPendingRevision(null)
    setNotice('Revised lyrics applied to the editor. The previous version was replaced at your request.')
  }

  function discardRevision() {
    setPendingRevision(null)
    setNotice('Revision discarded — your original lyrics remain in the editor, unchanged.')
  }

  async function requestMusic() {
    if (musicMessage !== null || songCatalog.generation.available) {
      // No live worker: every press truthfully records + surfaces the state.
      if (!songCatalog.generation.available) {
        setMusicMessage(
          'Music generation is unavailable — it requires a self-hosted GPU worker (ACE-Step 1.5 candidate) whose model-weight license is still under review. BEAN does not simulate music and never returns spoken TTS as a song.',
        )
        return
      }
    }
    setMusicMessage(null)
    try {
      const d = await beanFetch<{ message: string }>('/api/gangzii/music', {
        method: 'POST',
        json: {
          prompt: (songIdea.trim() || lyrics.slice(0, 500) || 'song').slice(0, 2000),
          presetId: selectedPresetId ?? undefined,
          vocalMode: selectedPreset ? (selectedPreset.vocalModes.includes('sung') ? 'sung' : 'instrumental') : undefined,
          lyrics: lyrics.trim() || undefined,
        },
      })
      setMusicMessage(d.message)
    } catch (e) {
      setActionError((e as Error).message)
    }
  }

  // ---- Audio Lab -----------------------------------------------------------

  async function transcribeUpload() {
    if (!labFile || labBusy) return
    setLabBusy(true)
    setActionError(null)
    try {
      const fd = new FormData()
      fd.append('file', labFile)
      const res = await fetch('/api/gangzii/transcribe', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } }
      if (!res.ok || data.ok === false) throw new Error(data.error?.message ?? `Upload failed (${res.status})`)
      await loadLists()
      setNotice('Audio uploaded — transcription is running below.')
      setLabFile(null)
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setLabBusy(false)
    }
  }

  async function convertUpload() {
    if (!labFile || labBusy) return
    setLabBusy(true)
    setActionError(null)
    try {
      const fd = new FormData()
      fd.append('file', labFile)
      fd.append('target', convertTarget)
      fd.append('channels', convertChannels)
      const res = await fetch('/api/gangzii/convert', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } }
      if (!res.ok || data.ok === false) throw new Error(data.error?.message ?? `Upload failed (${res.status})`)
      await loadLists()
      setNotice(
        `Conversion to ${convertTarget.toUpperCase()} (${convertChannels}) is running below. The result carries ffprobe-verified codec, sample-rate and channel metadata.`,
      )
      setLabFile(null)
    } catch (e) {
      setActionError((e as Error).message)
    } finally {
      setLabBusy(false)
    }
  }

  function downloadTranscript(job: LabJob) {
    const text = editedTranscripts[job.id] ?? job.transcript ?? ''
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bean-gangzii-transcript-${job.id}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ---- Live Voice ----------------------------------------------------------

  async function startRecording() {
    setActionError(null)
    // Interrupt any playback the moment the user grabs the mic.
    liveAudioRef.current?.pause()
    if (!availability || !cap('liveVoice')?.available) {
      setActionError('Live voice is not available right now — see the service status above.')
      return
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setActionError('This browser does not support microphone recording (MediaRecorder). Try a current version of Chrome, Edge, Firefox or Safari.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop())
        void processTurn(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }))
      }
      recorderRef.current = recorder
      recorder.start()
      setLivePhase('recording')
      setRecordSecs(0)
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000)
    } catch (e) {
      const err = e as DOMException
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        setActionError('Microphone access was denied. Allow microphone permission for this site in your browser settings, then try again.')
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setActionError('No microphone was found on this device.')
      } else {
        setActionError(`Could not start recording: ${err.message || err.name}`)
      }
    }
  }

  function stopRecording() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
  }

  async function processTurn(blob: Blob) {
    if (blob.size === 0) {
      setLivePhase('idle')
      setActionError('The recording was empty — try speaking a little longer.')
      return
    }
    setLivePhase('transcribing')
    setActionError(null)
    try {
      // 1. Transcribe the recorded turn through the REAL ASR pipeline.
      const fd = new FormData()
      fd.append('file', new File([blob], 'turn.webm', { type: blob.type || 'audio/webm' }))
      const res = await fetch('/api/gangzii/transcribe', { method: 'POST', body: fd })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; job?: { id: string }; error?: { message?: string } }
      if (!res.ok || data.ok === false || !data.job) {
        throw new Error(data.error?.message ?? 'The recorded turn could not be transcribed.')
      }
      const tJob = await pollJob<LabJob>(data.job.id, (id) => `/api/gangzii/jobs/${id}`)
      if (!tJob || tJob.status !== 'completed' || !tJob.transcript) {
        throw new Error(tJob?.errorMessage ?? 'Transcription failed for this turn.')
      }
      const transcript = tJob.transcript

      // 2. Ask the BEAN conversation model for a spoken-style reply.
      setLivePhase('thinking')
      const live = await beanFetch<{ reply: string }>('/api/gangzii/live', {
        method: 'POST',
        json: { transcript, history: historyRef.current },
      })

      // 3. Speak the reply through the REAL TTS job pipeline.
      setLivePhase('speaking')
      await beanFetch('/api/gangzii/tts', {
        method: 'POST',
        json: { text: live.reply, voice: liveVoice, speed: 1.0, source: 'live' },
      })
      const lists = await loadLists()
      const spoken = lists.tts.find((j) => j.status !== 'failed' && j.voice === liveVoice && j.text === live.reply)
      let audioUrl: string | null = null
      if (spoken) {
        const done = spoken.status === 'completed' ? spoken : await pollJob<TtsJob>(spoken.id, (id) => `/api/gangzii/jobs/${id}`)
        if (done && done.status === 'completed' && done.audioUrl) audioUrl = done.audioUrl
      }

      const turn: Turn = { id: tJob.id, transcript, reply: live.reply, audioUrl, error: null }
      historyRef.current = [...historyRef.current, { role: 'user' as const, content: transcript }, { role: 'assistant' as const, content: live.reply }].slice(-12)
      setTurns((prev) => [...prev, turn])

      if (audioUrl) {
        // Autoplay the spoken reply; browsers may block — fall back to manual play.
        try {
          const el = liveAudioRef.current
          if (el) {
            el.src = audioUrl
            await el.play()
          }
        } catch {
          /* autoplay blocked — the turn card exposes a play button */
        }
      }
      setLivePhase('idle')
    } catch (e) {
      setTurns((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, transcript: '', reply: '', audioUrl: null, error: (e as Error).message },
      ])
      setLivePhase('idle')
    }
  }

  function replayTurn(url: string) {
    liveAudioRef.current?.pause()
    const el = liveAudioRef.current
    if (el) {
      el.src = url
      void el.play().catch(() => undefined)
    }
  }

  // ---- render helpers ------------------------------------------------------

  const statusLine = (key: string, label: string) => {
    const c = cap(key)
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-white/45" title={c?.detail ?? 'Checking…'}>
        <StatusDot ok={c ? c.available : false} pulse={!c} />
        {label}
        {c ? (c.available ? ' ready' : ' unavailable') : ' checking…'}
      </div>
    )
  }

  const voiceLabel = (id: string | null) =>
    voiceCatalog.presets.find((v) => v.id === id)?.displayName ?? id ?? '—'

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[rgba(212,175,55,0.25)] bg-[rgba(212,175,55,0.07)]">
          <AudioLines className="h-5 w-5 text-[#d4af37]" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            GANGZII <span className="text-white/40">— voice, speech &amp; audio workspace</span>
          </h1>
          <p className="text-[13px] text-white/45">
            Studio voices, RIISHE lyric intelligence, transcription, format conversion and turn-based live voice. Availability is measured, never assumed.
          </p>
        </div>
      </div>

      {/* Service status strip */}
      <div className="bean-glass mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl p-3.5">
        {statusLine('speechSynthesis', 'Speech')}
        {statusLine('transcription', 'Transcription')}
        {statusLine('conversion', 'Conversion')}
        {statusLine('stereoExport', 'Mono/stereo export')}
        {statusLine('musicGeneration', 'Music generation')}
        {statusLine('liveVoice', 'Live voice')}
        <span className="ml-auto text-[10px] text-white/30">
          {cap('speechSynthesis') ? `probes ${timeAgo(cap('speechSynthesis')!.checkedAt)}` : ''}
        </span>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setNotice(null); setActionError(null) }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] transition-colors',
              tab === t.id
                ? 'bg-[rgba(212,175,55,0.12)] text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)]'
                : 'text-white/55 hover:bg-white/5 hover:text-white/85',
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {actionError ? (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] leading-relaxed text-red-300">
          {actionError}
        </div>
      ) : null}
      {notice ? (
        <div className="mb-4 rounded-lg border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.07)] px-4 py-3 text-[13px] text-[#f0c75e]">
          {notice}
        </div>
      ) : null}

      {/* Hidden audio element for Live Voice playback */}
      <audio ref={liveAudioRef} className="hidden" />

      {/* ============ VOICE STUDIO ============ */}
      {tab === 'voice' && (
        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <div className="bean-glass rounded-xl p-5">
            <label htmlFor="gangzii-tts-text" className="mb-1.5 block text-xs text-white/55">
              Text to speak
            </label>
            <Textarea
              id="gangzii-tts-text"
              value={ttsText}
              onChange={(e) => setTtsText(e.target.value.slice(0, MAX_CHARS))}
              rows={5}
              placeholder="Type what GANGZII should say…"
              className="resize-none bg-black/30"
            />
            <div className="mt-1 text-right text-[10px] text-white/30">{ttsText.length}/{MAX_CHARS}</div>

            <div className="mt-4 max-h-[340px] space-y-3 overflow-y-auto pr-1">
              {voiceCatalog.categories.map((cat) => {
                const presets = voiceCatalog.presets.filter((v) => v.category === cat.id)
                if (presets.length === 0) return null
                return (
                  <div key={cat.id}>
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="text-xs font-medium text-white/70">{cat.label}</span>
                      <span className="text-[10px] text-white/30">{cat.description}</span>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      {presets.map((v) => (
                        <button
                          key={v.id}
                          onClick={() => setVoice(v.id)}
                          className={cn(
                            'group rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors',
                            voice === v.id
                              ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                              : 'border-white/10 text-white/55 hover:border-[rgba(212,175,55,0.3)]',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium">{v.displayName}</div>
                              <div className="truncate text-white/35">{v.description}</div>
                            </div>
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation()
                                previewVoice(v)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.stopPropagation()
                                  e.preventDefault()
                                  previewVoice(v)
                                }
                              }}
                              title={`Preview ${v.displayName} (a real short synthesis)`}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/15 px-1.5 py-1 text-[10px] text-white/55 hover:border-[rgba(212,175,55,0.4)] hover:text-[#f0c75e]"
                            >
                              <Volume2 className="h-3 w-3" />
                              Preview
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-white/35">
              {voiceCatalog.languageCoverage.note} The provider supports speaking speed only — language, pitch and emotion controls are not real capabilities here and are offered nowhere.
            </p>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-xs text-white/55">
                <span>Speed</span>
                <span className="text-[#f0c75e]">{speed.toFixed(2)}×</span>
              </div>
              <Slider
                value={[speed]}
                min={GANGZII_LIMITS.speedMin}
                max={GANGZII_LIMITS.speedMax}
                step={0.05}
                onValueChange={(vals) => setSpeed(vals[0] ?? 1)}
              />
              <div className="mt-1 flex justify-between text-[10px] text-white/30">
                <span>0.5×</span>
                <span>2.0×</span>
              </div>
            </div>

            <Button
              onClick={() => void submitTts(ttsText.trim(), voice, speed, 'studio')}
              disabled={ttsBusy || ttsText.trim().length === 0 || !cap('speechSynthesis')?.available}
              className="mt-5 w-full bg-[#d4af37] font-semibold text-black hover:bg-[#e6c25a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AudioLines className="mr-1.5 h-4 w-4" />
              Generate speech
            </Button>
            {!cap('speechSynthesis')?.available && cap('speechSynthesis') ? (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">{cap('speechSynthesis')!.detail}</p>
            ) : null}
            <p className="mt-3 text-[11px] leading-relaxed text-white/35">
              Output: WAV, 24 kHz mono source — the original generated audio is preserved as the source asset. Mono/stereo WAV or MP3 exports are separate ffprobe-verified conversions (stereo = dual-mono, not spatial). Long text is split into sentence chunks (limit 1024 characters each) and assembled into one file. All audio is AI-generated.
            </p>
          </div>

          <div className="min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white/80">Your speech history</h3>
              <span className="text-xs text-white/35">{ttsJobs.length} item{ttsJobs.length === 1 ? '' : 's'}</span>
            </div>
            {ttsJobs.length === 0 ? (
              <EmptyState
                icon={<AudioLines className="h-10 w-10" />}
                title="No speech yet"
                hint="Write text, pick a voice and press Generate — completed audio appears here with playback, download, exports, regenerate and delete."
              />
            ) : (
              <div className="space-y-3">
                {ttsJobs.map((j) => (
                  <div key={j.id} className="bean-glass rounded-xl p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      {j.status === 'completed' ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : j.status === 'failed' ? (
                        <XCircle className="h-3.5 w-3.5 text-red-400" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-[#d4af37]" />
                      )}
                      <span className="text-[12px] font-medium text-white/80">
                        {voiceLabel(j.voice)} · {j.speed?.toFixed(2)}×
                      </span>
                      {j.source && j.source !== 'studio' ? (
                        <GoldBadge tone="gold">
                          {j.source === 'voice-preview' ? 'voice preview' : j.source === 'song-preview' ? 'song preview' : 'live reply'}
                        </GoldBadge>
                      ) : null}
                      <span className="text-[11px] text-white/35">{timeAgo(j.queuedAt)}</span>
                      {j.status === 'completed' && j.durationSec != null ? (
                        <span className="text-[11px] text-white/35">
                          · {j.durationSec}s · {j.chunks} chunk{j.chunks === 1 ? '' : 's'} · {j.sampleRateHz ?? 24000} Hz · {j.channelLayout ?? 'mono (source)'}
                        </span>
                      ) : null}
                      <GoldBadge tone={j.status === 'completed' ? 'green' : j.status === 'failed' ? 'red' : 'gold'}>{j.status}</GoldBadge>
                      {j.status === 'completed' ? (
                        <span className="ml-auto inline-flex items-center gap-1.5">
                          <a
                            href={`${j.audioUrl}?download=1`}
                            download
                            className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)]"
                          >
                            <Download className="h-3 w-3" /> Source WAV
                          </a>
                          <button
                            onClick={() => regenerateTts(j)}
                            className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:bg-white/5"
                            title="Load these parameters into the composer"
                          >
                            <RotateCcw className="h-3 w-3" /> Regenerate
                          </button>
                          <button
                            onClick={() => void deleteJob(j.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/50 hover:border-red-500/40 hover:text-red-300"
                            title="Delete this audio permanently"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </span>
                      ) : null}
                    </div>
                    {j.status === 'completed' && j.audioUrl ? (
                      <>
                        <audio controls preload="none" src={j.audioUrl} className="h-9 w-full" />
                        <ExportRow
                          jobId={j.id}
                          conversionReady={cap('stereoExport')?.available ?? cap('conversion')?.available ?? false}
                          onQueued={(m) => {
                            setNotice(m)
                            void loadLists()
                          }}
                          onError={(m) => setActionError(m)}
                        />
                      </>
                    ) : j.status === 'failed' ? (
                      <p className="text-xs text-red-300">{j.errorMessage ?? 'Generation failed.'}{j.errorCode ? ` (${j.errorCode})` : ''}</p>
                    ) : (
                      <div className="py-1">
                        <div className="mb-1.5 text-xs text-white/50">Synthesizing… {j.progress}%</div>
                        <Progress value={j.progress} className="h-1.5 bg-white/5" />
                      </div>
                    )}
                    {j.text ? <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-white/40">“{j.text}”</p> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ SONG STUDIO ============ */}
      {tab === 'song' && (
        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <div className="bean-glass rounded-xl p-5">
            {/* Song style presets */}
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-white/70">Song style preset</span>
              {selectedPreset ? (
                <button
                  onClick={() => setSelectedPresetId(null)}
                  className="text-[10px] text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
                >
                  clear selection
                </button>
              ) : null}
            </div>
            <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
              {songCatalog.presets.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPresetId(p.id === selectedPresetId ? null : p.id)}
                  className={cn(
                    'w-full rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors',
                    selectedPresetId === p.id
                      ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                      : 'border-white/10 text-white/55 hover:border-[rgba(212,175,55,0.3)]',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{p.displayName}</span>
                    <span className="text-[10px] text-white/35" title={`Energy ${p.energy}/5`}>
                      {'●'.repeat(p.energy)}
                      <span className="text-white/15">{'●'.repeat(5 - p.energy)}</span>
                    </span>
                  </div>
                  <div className="truncate text-white/35">{p.genre} · {p.mood}</div>
                  {selectedPresetId === p.id ? (
                    <div className="mt-1 text-[10px] leading-relaxed text-white/45">
                      {p.description} Modes: {p.vocalModes.join(', ')}. Duration range {p.durationRangeSec.min}–{p.durationRangeSec.max}s.
                      {!p.generationAvailable ? ' Audio generation for this preset is unavailable (no music worker) — it still drives RIISHE lyrics.' : ''}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
            {!songCatalog.generation.available ? (
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-amber-300/70">
                Singing/music generation is unavailable for every preset (worker not deployed) — presets truthfully drive RIISHE lyrics styling today.
              </p>
            ) : null}

            {/* Vocal mode */}
            <div className="mt-3">
              <div className="mb-1.5 text-xs text-white/55">Vocal mode</div>
              <div className="grid grid-cols-2 gap-1.5">
                {(['sung', 'instrumental'] as const).map((m) => {
                  const supported = !selectedPreset || selectedPreset.vocalModes.includes(m)
                  return (
                    <button
                      key={m}
                      disabled={!supported}
                      onClick={() => undefined /* vocal mode is derived server-side from the preset */}
                      className={cn(
                        'rounded-lg border px-2.5 py-1.5 text-[11px] capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-35',
                        supported
                          ? 'border-[rgba(212,175,55,0.35)] text-white/65 hover:border-[rgba(212,175,55,0.5)]'
                          : 'border-white/10 text-white/30',
                      )}
                    >
                      {m === 'sung' ? 'Sung vocals' : 'Instrumental'}
                      {!supported ? ' — not in this preset' : ''}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Song idea */}
            <label htmlFor="gangzii-song-idea" className="mb-1.5 mt-4 block text-xs text-white/55">
              Song idea
            </label>
            <Textarea
              id="gangzii-song-idea"
              value={songIdea}
              onChange={(e) => setSongIdea(e.target.value.slice(0, 2000))}
              rows={3}
              placeholder={
                selectedPreset
                  ? `e.g. a ${selectedPreset.mood.split(',')[0]} ${selectedPreset.genre} song about…`
                  : 'e.g. An upbeat synth-pop chorus about a late-night train ride home'
              }
              className="resize-none bg-black/30"
            />

            {/* Lyrics preferences */}
            <label htmlFor="gangzii-lyrics-prefs" className="mb-1.5 mt-3 block text-xs text-white/55">
              Lyrics preferences <span className="text-white/30">(optional — structure, rhyme feel, language)</span>
            </label>
            <Textarea
              id="gangzii-lyrics-prefs"
              value={lyricsPreferences}
              onChange={(e) => setLyricsPreferences(e.target.value.slice(0, 400))}
              rows={2}
              placeholder="e.g. two verses, a memorable hook, simple words"
              className="resize-none bg-black/30"
            />

            <Button
              onClick={() => void writeLyrics()}
              disabled={riisheBusy !== null || songIdea.trim().length < 4 || !cap('conversation')?.available}
              className="mt-3 w-full bg-[#d4af37] font-semibold text-black hover:bg-[#e6c25a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {riisheBusy === 'draft' ? <Spinner className="border-black/30 border-t-black" /> : <PenLine className="mr-1.5 h-4 w-4" />}
              Write Lyrics with RIISHE
            </Button>
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              Lyrics are AI-generated text written by RIISHE (BEAN conversation model, original text only). If you already have lyrics, a new draft is compared side-by-side — never auto-applied.
            </p>

            <Button
              onClick={() => void submitTts(lyrics.trim(), voice, speed, 'song-preview')}
              disabled={!lyrics.trim() || ttsBusy || !cap('speechSynthesis')?.available}
              variant="outline"
              className="mt-2 w-full border-[rgba(212,175,55,0.35)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)] disabled:opacity-50"
            >
              <Play className="mr-1.5 h-4 w-4" />
              Spoken preview — not sung
            </Button>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-white/35">
              This preview is real TTS reading your lyrics aloud. It is NOT a song and never will be presented as one.
            </p>

            <Button
              onClick={() => void requestMusic()}
              disabled={songIdea.trim().length < 3 && lyrics.trim().length < 3}
              variant="outline"
              className="mt-3 w-full border-amber-500/30 text-amber-300 hover:bg-amber-500/5"
              title="Truthfully records an unavailable attempt — no fake audio is ever produced"
            >
              <Music className="mr-1.5 h-4 w-4" />
              Generate song — unavailable
            </Button>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-white/35">
              Requires a real singing/music model (ACE-Step 1.5 candidate, license under review). Attempts are recorded truthfully — never faked.
            </p>
            {musicMessage ? (
              <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-200/85">
                {musicMessage}
              </div>
            ) : null}
          </div>

          <div className="min-w-0">
            <UnavailableBanner
              title="Music generation — worker not configured"
              reason={
                songCatalog.generation.reason ||
                cap('musicGeneration')?.detail ||
                FALLBACK_MUSIC_REASON
              }
            />

            {/* Latest spoken preview with export controls */}
            {(() => {
              const preview = ttsJobs.find((j) => j.source === 'song-preview')
              if (!preview) return null
              return (
                <div className="bean-glass mb-4 rounded-xl p-4">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Play className="h-3.5 w-3.5 text-[#d4af37]" />
                    <span className="text-[12px] font-medium text-white/80">Latest spoken preview</span>
                    <GoldBadge tone="gold">spoken — not sung</GoldBadge>
                    <span className="text-[11px] text-white/35">{timeAgo(preview.queuedAt)}</span>
                    {preview.status === 'completed' && preview.durationSec != null ? (
                      <span className="text-[11px] text-white/35">· {preview.durationSec}s · {preview.sampleRateHz ?? 24000} Hz · {preview.channelLayout ?? 'mono (source)'}</span>
                    ) : null}
                    <GoldBadge tone={preview.status === 'completed' ? 'green' : preview.status === 'failed' ? 'red' : 'gold'}>{preview.status}</GoldBadge>
                    {preview.status === 'completed' ? (
                      <a
                        href={`${preview.audioUrl}?download=1`}
                        download
                        className="ml-auto inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)]"
                      >
                        <Download className="h-3 w-3" /> Source WAV
                      </a>
                    ) : null}
                  </div>
                  {preview.status === 'completed' && preview.audioUrl ? (
                    <>
                      <audio controls preload="none" src={preview.audioUrl} className="h-9 w-full" />
                      <ExportRow
                        jobId={preview.id}
                        conversionReady={cap('stereoExport')?.available ?? cap('conversion')?.available ?? false}
                        onQueued={(m) => {
                          setNotice(m)
                          void loadLists()
                        }}
                        onError={(m) => setActionError(m)}
                      />
                    </>
                  ) : preview.status === 'failed' ? (
                    <p className="text-xs text-red-300">{preview.errorMessage ?? 'Preview failed.'}</p>
                  ) : (
                    <div className="py-1">
                      <div className="mb-1.5 text-xs text-white/50">Synthesizing… {preview.progress}%</div>
                      <Progress value={preview.progress} className="h-1.5 bg-white/5" />
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Lyrics editor with RIISHE analyze/improve actions */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-white/80">
                Lyrics editor <span className="font-normal text-white/35">· editable · AI-generated text by RIISHE</span>
              </h3>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => void analyzeLyrics(false)}
                  disabled={riisheBusy !== null || lyrics.trim().length < 8 || !cap('conversation')?.available}
                  className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2.5 py-1.5 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="RIISHE evaluates structure, phrasing, rhyme, imagery and genre fit"
                >
                  {riisheBusy === 'analyze' ? <Spinner className="h-3 w-3 border-[rgba(212,175,55,0.3)] border-t-[#f0c75e]" /> : <ScanSearch className="h-3 w-3" />}
                  Analyze lyrics with RIISHE
                </button>
                <button
                  onClick={() => void analyzeLyrics(true)}
                  disabled={riisheBusy !== null || lyrics.trim().length < 8 || !cap('conversation')?.available}
                  className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2.5 py-1.5 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
                  title="RIISHE returns a full improved draft — compared first, applied only by you"
                >
                  {riisheBusy === 'improve' ? <Spinner className="h-3 w-3 border-[rgba(212,175,55,0.3)] border-t-[#f0c75e]" /> : <Sparkles className="h-3 w-3" />}
                  Improve lyrics with RIISHE
                </button>
              </div>
            </div>

            {analysis ? <AnalysisPanel analysis={analysis} limitation={analysisLimitation} /> : null}

            {/* Compare before applying — the user's draft is never auto-overwritten */}
            {pendingRevision ? (
              <div className="bean-glass mb-4 rounded-xl p-4">
                <div className="mb-2 flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4 text-[#d4af37]" />
                  <span className="text-sm font-semibold text-[#f0c75e]">Compare — apply only if you want the revision</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-white/40">Your current lyrics (editable below, untouched)</div>
                    <pre className="max-h-[280px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-[11.5px] leading-relaxed text-white/60">{lyrics}</pre>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[#f0c75e]/70">RIISHE&apos;s version (AI-generated)</div>
                    <pre className="max-h-[280px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.05)] p-3 font-mono text-[11.5px] leading-relaxed text-white/75">{pendingRevision}</pre>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    onClick={applyRevision}
                    className="bg-[#d4af37] font-semibold text-black hover:bg-[#e6c25a]"
                  >
                    Apply revised lyrics
                  </Button>
                  <Button
                    onClick={discardRevision}
                    variant="outline"
                    className="border-white/15 text-white/65 hover:bg-white/5"
                  >
                    Keep my version
                  </Button>
                </div>
              </div>
            ) : null}

            {lyrics ? (
              <Textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                rows={14}
                className="bean-glass resize-y bg-black/30 font-mono text-[12.5px] leading-relaxed"
              />
            ) : (
              <EmptyState
                icon={<PenLine className="h-10 w-10" />}
                title="No lyrics yet"
                hint="Describe a song idea (optionally pick a style preset) and press “Write Lyrics with RIISHE”. The draft lands here fully editable, with analyze and improve actions above."
              />
            )}
          </div>
        </div>
      )}

      {/* ============ AUDIO LAB + LIVE VOICE ============ */}
      {tab === 'lab' && (
        <AudioLabTab
          labFile={labFile}
          setLabFile={setLabFile}
          convertTarget={convertTarget}
          setConvertTarget={setConvertTarget}
          convertChannels={convertChannels}
          setConvertChannels={setConvertChannels}
          transcribeJobs={transcribeJobs}
          convertJobs={convertJobs}
          editedTranscripts={editedTranscripts}
          setEditedTranscripts={setEditedTranscripts}
          labBusy={labBusy}
          capTranscription={cap('transcription')?.available ?? false}
          capConversion={cap('conversion')?.available ?? false}
          capTools={cap('audioTools')}
          onTranscribe={() => void transcribeUpload()}
          onConvert={() => void convertUpload()}
          onDownloadTranscript={downloadTranscript}
          onDelete={(id) => void deleteJob(id)}
        />
      )}

      {tab === 'live' && (
        <div className="mx-auto max-w-3xl">
          <div className="bean-glass mb-5 rounded-xl border-[rgba(212,175,55,0.18)] p-4">
            <div className="mb-1.5 flex items-center gap-2">
              <Info className="h-4 w-4 text-[#d4af37]" />
              <span className="text-sm font-semibold text-[#f0c75e]">Turn-based voice conversation</span>
            </div>
            <p className="text-[13px] leading-relaxed text-white/60">
              Each turn: record → real speech recognition → the BEAN conversation model → real speech synthesis. This is an
              honest turn-based pipeline, not a low-latency duplex stream. Grab the mic any time to interrupt playback.
            </p>
          </div>

          <div className="bean-glass flex flex-col items-center rounded-xl p-8">
            <button
              onClick={() => (livePhase === 'recording' ? stopRecording() : void startRecording())}
              disabled={livePhase !== 'idle' && livePhase !== 'recording'}
              className={cn(
                'flex h-20 w-20 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed disabled:opacity-40',
                livePhase === 'recording'
                  ? 'bg-red-500/90 shadow-[0_0_0_8px_rgba(239,68,68,0.15)] hover:bg-red-500'
                  : 'bg-[#d4af37] shadow-[0_0_0_8px_rgba(212,175,55,0.12)] hover:bg-[#e6c25a]',
              )}
              aria-label={livePhase === 'recording' ? 'Stop recording' : 'Start recording'}
            >
              {livePhase === 'recording' ? (
                <Square className="h-7 w-7 text-black" />
              ) : (
                <Mic className="h-7 w-7 text-black" />
              )}
            </button>
            <div className="mt-4 h-6 text-sm text-white/70">
              {livePhase === 'idle' && 'Press the microphone and speak'}
              {livePhase === 'recording' && `Recording… ${recordSecs}s — press to stop`}
              {livePhase === 'transcribing' && 'Transcribing your turn…'}
              {livePhase === 'thinking' && 'BEAN is thinking…'}
              {livePhase === 'speaking' && 'BEAN is speaking…'}
            </div>
            {livePhase === 'transcribing' || livePhase === 'thinking' || livePhase === 'speaking' ? (
              <Loader2 className="mt-2 h-4 w-4 animate-spin text-[#d4af37]" />
            ) : null}

            <div className="mt-5 w-full max-w-xs">
              <div className="mb-1.5 text-center text-xs text-white/55">Reply voice</div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {voiceCatalog.presets.slice(0, 4).map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setLiveVoice(v.id)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                      liveVoice === v.id
                        ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                        : 'border-white/10 text-white/55 hover:border-[rgba(212,175,55,0.3)]',
                    )}
                  >
                    {v.displayName}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {turns.length === 0 ? (
              <EmptyState
                icon={<Mic className="h-10 w-10" />}
                title="No turns yet"
                hint="Your first recording appears here with its transcript, BEAN's spoken reply and replay controls."
              />
            ) : (
              [...turns].reverse().map((t) => (
                <div key={t.id} className="bean-glass rounded-xl p-4">
                  {t.error ? (
                    <p className="text-xs text-red-300">{t.error}</p>
                  ) : (
                    <>
                      <div className="mb-1 flex items-start gap-2">
                        <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" />
                        <p className="text-[13px] text-white/75">{t.transcript}</p>
                      </div>
                      <div className="mb-2 flex items-start gap-2">
                        <AudioLines className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
                        <p className="text-[13px] text-[#f0c75e]">{t.reply}</p>
                      </div>
                      {t.audioUrl ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => replayTurn(t.audioUrl!)}
                            className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)]"
                          >
                            <Play className="h-3 w-3" /> Replay
                          </button>
                          <button
                            onClick={() => liveAudioRef.current?.pause()}
                            className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/55 hover:bg-white/5"
                          >
                            Stop
                          </button>
                          <a
                            href={`${t.audioUrl}?download=1`}
                            download
                            className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/55 hover:bg-white/5"
                          >
                            <Download className="h-3 w-3" /> Audio
                          </a>
                        </div>
                      ) : (
                        <p className="text-[11px] text-white/35">Audio for this turn was not produced or was deleted.</p>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Audio Lab tab (kept as a sub-component for readability) ----------------

function AudioLabTab(props: {
  labFile: File | null
  setLabFile: (f: File | null) => void
  convertTarget: 'mp3' | 'ogg' | 'flac' | 'm4a' | 'wav'
  setConvertTarget: (t: 'mp3' | 'ogg' | 'flac' | 'm4a' | 'wav') => void
  convertChannels: 'mono' | 'stereo'
  setConvertChannels: (c: 'mono' | 'stereo') => void
  transcribeJobs: LabJob[]
  convertJobs: LabJob[]
  editedTranscripts: Record<string, string>
  setEditedTranscripts: (m: Record<string, string>) => void
  labBusy: boolean
  capTranscription: boolean
  capConversion: boolean
  capTools?: Capability
  onTranscribe: () => void
  onConvert: () => void
  onDownloadTranscript: (job: LabJob) => void
  onDelete: (id: string) => void
}) {
  const {
    labFile, setLabFile, convertTarget, setConvertTarget, convertChannels, setConvertChannels,
    transcribeJobs, convertJobs, editedTranscripts, setEditedTranscripts, labBusy,
    capTranscription, capConversion, capTools, onTranscribe, onConvert, onDownloadTranscript, onDelete,
  } = props

  return (
    <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
      <div className="bean-glass rounded-xl p-5">
        <label htmlFor="gangzii-lab-file" className="mb-1.5 block text-xs text-white/55">
          Upload audio (WAV or WebM · max 25 MB)
        </label>
        <input
          id="gangzii-lab-file"
          type="file"
          accept=".wav,.webm,audio/wav,audio/webm"
          onChange={(e) => setLabFile(e.target.files?.[0] ?? null)}
          className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-xs text-white/70 file:mr-3 file:rounded-md file:border-0 file:bg-[rgba(212,175,55,0.15)] file:px-3 file:py-1.5 file:text-[11px] file:text-[#f0c75e] hover:file:bg-[rgba(212,175,55,0.25)]"
        />
        {labFile ? (
          <p className="mt-2 truncate text-[11px] text-white/45">
            {labFile.name} · {(labFile.size / (1024 * 1024)).toFixed(2)} MB — the server verifies the real container by magic bytes.
          </p>
        ) : null}

        <Button
          onClick={onTranscribe}
          disabled={!labFile || labBusy || !capTranscription}
          className="mt-4 w-full bg-[#d4af37] font-semibold text-black hover:bg-[#e6c25a] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {labBusy ? <Spinner className="border-black/30 border-t-black" /> : <FileAudio className="mr-1.5 h-4 w-4" />}
          Transcribe speech
        </Button>

        <div className="mt-3">
          <div className="mb-1.5 text-xs text-white/55">Convert to</div>
          <div className="grid grid-cols-5 gap-1">
            {(['mp3', 'ogg', 'flac', 'm4a', 'wav'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setConvertTarget(f)}
                className={cn(
                  'rounded-md border px-1 py-1.5 text-[11px] uppercase transition-colors',
                  convertTarget === f
                    ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                    : 'border-white/10 text-white/55 hover:border-[rgba(212,175,55,0.3)]',
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2">
          <div className="mb-1.5 text-xs text-white/55">Channels</div>
          <div className="grid grid-cols-2 gap-1">
            {(['mono', 'stereo'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setConvertChannels(c)}
                className={cn(
                  'rounded-md border px-1 py-1.5 text-[11px] capitalize transition-colors',
                  convertChannels === c
                    ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                    : 'border-white/10 text-white/55 hover:border-[rgba(212,175,55,0.3)]',
                )}
              >
                {c}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-white/35">
            {convertChannels === 'stereo'
              ? 'Stereo = dual-mono export: the mono signal duplicated into L/R. Not spatial stereo — no stereo separation is created.'
              : 'Mono output matches the source exactly.'}
          </p>
        </div>
        <Button
          onClick={onConvert}
          disabled={!labFile || labBusy || !capConversion}
          variant="outline"
          className="mt-2 w-full border-[rgba(212,175,55,0.35)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)] disabled:opacity-50"
        >
          <Wand2 className="mr-1.5 h-4 w-4" />
          Convert format
        </Button>

        <div className="mt-5 rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-white/60">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" /> Not available yet
          </div>
          <p className="text-[11px] leading-relaxed text-white/40">
            {capTools?.detail ??
              'Vocal/instrumental separation, denoising and voice cloning require self-hosted model workers that are not deployed; their licenses are under review. BEAN does not fake these outputs.'}
          </p>
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-white/35">
          The transcription backend returns plain text without word timestamps, so timed subtitle (SRT) export is not offered — only honest plain-text export. Converted files carry ffprobe-verified codec, sample-rate, channel and duration metadata.
        </p>
      </div>

      <div className="min-w-0">
        <h3 className="mb-3 text-sm font-semibold text-white/80">Transcripts</h3>
        {transcribeJobs.length === 0 ? (
          <EmptyState
            icon={<FileAudio className="h-10 w-10" />}
            title="No transcriptions yet"
            hint="Upload a WAV or WebM file — completed transcripts appear here, editable and exportable as .txt."
          />
        ) : (
          <div className="space-y-3">
            {transcribeJobs.map((j) => (
              <div key={j.id} className="bean-glass rounded-xl p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {j.status === 'completed' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : j.status === 'failed' ? (
                    <XCircle className="h-3.5 w-3.5 text-red-400" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-[#d4af37]" />
                  )}
                  <span className="max-w-[220px] truncate text-[12px] font-medium text-white/80">{j.displayName}</span>
                  <span className="text-[11px] text-white/35">{timeAgo(j.queuedAt)}</span>
                  <GoldBadge tone={j.status === 'completed' ? 'green' : j.status === 'failed' ? 'red' : 'gold'}>{j.status}</GoldBadge>
                  {j.status === 'completed' ? (
                    <span className="ml-auto inline-flex items-center gap-1.5">
                      <button
                        onClick={() => onDownloadTranscript(j)}
                        className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)]"
                      >
                        <Download className="h-3 w-3" /> .txt
                      </button>
                      <button
                        onClick={() => {
                          void navigator.clipboard?.writeText(editedTranscripts[j.id] ?? j.transcript ?? '')
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/60 hover:bg-white/5"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                      <button
                        onClick={() => onDelete(j.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/50 hover:border-red-500/40 hover:text-red-300"
                        title="Delete transcript + uploaded audio permanently"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ) : null}
                </div>
                {j.status === 'completed' ? (
                  <Textarea
                    value={editedTranscripts[j.id] ?? j.transcript ?? ''}
                    onChange={(e) => setEditedTranscripts({ ...editedTranscripts, [j.id]: e.target.value })}
                    rows={4}
                    className="resize-y bg-black/30 text-[12.5px] leading-relaxed"
                  />
                ) : j.status === 'failed' ? (
                  <p className="text-xs text-red-300">{j.errorMessage ?? 'Transcription failed.'}{j.errorCode ? ` (${j.errorCode})` : ''}</p>
                ) : (
                  <div className="py-1">
                    <div className="mb-1.5 text-xs text-white/50">Transcribing… {j.progress}%</div>
                    <Progress value={j.progress} className="h-1.5 bg-white/5" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <h3 className="mb-3 mt-6 text-sm font-semibold text-white/80">Converted files</h3>
        {convertJobs.length === 0 ? (
          <EmptyState
            icon={<Wand2 className="h-10 w-10" />}
            title="No conversions yet"
            hint="Upload a WAV or WebM file, or use an Export row in Voice/Song Studio, then pick a target format and channels — converted files appear here with verified metadata."
          />
        ) : (
          <div className="space-y-3">
            {convertJobs.map((j) => (
              <div key={j.id} className="bean-glass rounded-xl p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {j.status === 'completed' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : j.status === 'failed' ? (
                    <XCircle className="h-3.5 w-3.5 text-red-400" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-[#d4af37]" />
                  )}
                  <span className="max-w-[220px] truncate text-[12px] font-medium text-white/80">{j.displayName}</span>
                  <span className="text-[11px] uppercase text-[#f0c75e]">→ {j.target}</span>
                  <span className="text-[11px] capitalize text-white/45">{j.channels ?? 'mono'}</span>
                  <span className="text-[11px] text-white/35">{timeAgo(j.queuedAt)}</span>
                  <GoldBadge tone={j.status === 'completed' ? 'green' : j.status === 'failed' ? 'red' : 'gold'}>{j.status}</GoldBadge>
                  {j.status === 'completed' ? (
                    <span className="ml-auto inline-flex items-center gap-1.5">
                      <a
                        href={`${j.audioUrl}?download=1`}
                        download
                        className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)]"
                      >
                        <Download className="h-3 w-3" /> Download
                      </a>
                      <button
                        onClick={() => onDelete(j.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/50 hover:border-red-500/40 hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ) : null}
                </div>
                {j.status === 'completed' && j.audioUrl ? (
                  <>
                    <audio controls preload="none" src={j.audioUrl} className="h-9 w-full" />
                    <p className="mt-1.5 text-[10.5px] leading-relaxed text-white/40">
                      Verified: {j.codec ?? 'audio'} · {j.sampleRateHz ?? '?'} Hz · {j.actualChannels ?? '?'} channel{(j.actualChannels ?? 1) === 1 ? '' : 's'}
                      {j.durationSec != null ? ` · ${j.durationSec}s` : ''}
                      {j.channelSemantics ? ` · ${j.channelSemantics}` : ''}
                    </p>
                  </>
                ) : j.status === 'failed' ? (
                  <p className="text-xs text-red-300">{j.errorMessage ?? 'Conversion failed.'}{j.errorCode ? ` (${j.errorCode})` : ''}</p>
                ) : (
                  <div className="py-1">
                    <div className="mb-1.5 text-xs text-white/50">Converting… {j.progress}%</div>
                    <Progress value={j.progress} className="h-1.5 bg-white/5" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}



