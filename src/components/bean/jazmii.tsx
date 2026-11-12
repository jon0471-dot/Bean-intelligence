'use client'

/**
 * BEAN Intelligence — JAZMII unified conversational video studio (2026-11-12).
 *
 * ONE workspace, ONE conversation, real video generation. The old standalone
 * prompt form, the separate reference-upload field, the permanently visible
 * dropdowns and the dashboard-style history cards are replaced by a
 * ChatGPT-style conversation: a collapsible conversation sidebar (mobile
 * Sheet), a message thread with embedded video players, and a compact
 * composer whose generation settings live in an expandable panel.
 *
 * Honesty rules preserved from the previous workspace:
 *  - availability is reported from the backend, never assumed;
 *  - job rows render EXACTLY as the server records them — a failed job never
 *    renders as anything else, progress is the real job progress;
 *  - regeneration re-submits the real prompt/settings through the same
 *    background pipeline (no mocked playback, no fake states);
 *  - cancellation means stop-tracking (the provider exposes no cancel API).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { beanFetch, GoldBadge, Spinner, StatusDot, timeAgo } from './shared'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  Video,
  Paperclip,
  SendHorizonal,
  Download,
  RefreshCw,
  PenLine,
  Menu,
  Plus,
  Trash2,
  Pencil,
  X,
  SlidersHorizontal,
  Film,
  CheckCircle2,
  XCircle,
  Clock,
  AudioLines,
} from 'lucide-react'

interface Availability {
  available: boolean
  accountThrottled?: boolean
  reason: string
  product: string
}

interface JazmiiJob {
  id: string
  status: string
  progress: number
  errorCode: string | null
  errorMessage: string | null
  videoUrl: string | null
  format: string | null
  bytes: number | null
  width: number | null
  height: number | null
  durationSec: number | null
  fps: number | null
  codec: string | null
  hasAudio: boolean
  continuity: {
    checked?: boolean
    defects?: string[]
    observation?: string
  } | null
  size: string | null
  durationSecRequested: number | null
  quality: string | null
  withAudio: boolean
  hasReferenceImage: boolean
  queuedAt: string
  finishedAt: string | null
}

interface JazmiiThreadMessage {
  id: string
  role: 'user' | 'assistant'
  kind: string
  text: string | null
  jobId: string | null
  meta: Record<string, unknown>
  createdAt: string
  job: JazmiiJob | null
}

interface ConversationSummary {
  id: string
  title: string
  updatedAt: string
  messageCount: number
}

interface ComposerSettings {
  size: string
  durationSec: number
  quality: 'speed' | 'quality'
  withAudio: boolean
}

const SIZE_PRESETS = [
  { label: '16:9 landscape', value: '1280x720' },
  { label: '9:16 portrait', value: '720x1280' },
]
const DURATIONS = [5, 10]
const CUSTOM_MIN_PX = 360
const CUSTOM_MAX_PX = 1920

const EXAMPLE_PROMPTS = [
  'A golden perfume bottle rotating slowly on black silk, cinematic studio lighting.',
  'Drone shot rising over a coastal highway at sunset, warm color grade.',
  'Neon-lit Tokyo alley in the rain, shallow depth of field, moody.',
]

function humanBytes(n: number | null): string {
  if (n === null || Number.isNaN(n)) return ''
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function aspectLabel(size: string | null): string {
  if (!size) return ''
  const [w, h] = size.split('x').map(Number)
  if (!w || !h) return size
  const ratio = w / h
  if (Math.abs(ratio - 16 / 9) < 0.02) return '16:9'
  if (Math.abs(ratio - 9 / 16) < 0.02) return '9:16'
  if (Math.abs(ratio - 1) < 0.02) return '1:1'
  return ratio >= 1 ? `${ratio.toFixed(2)}:1` : `1:${(1 / ratio).toFixed(2)}`
}

/** Genuine conversational status wording — derived ONLY from the real job. */
function jobStatusLine(job: JazmiiJob): { label: string; active: boolean } {
  if (job.status === 'queued') return { label: 'Queued…', active: true }
  if (job.status === 'completed') return { label: 'Completed', active: false }
  if (job.status === 'failed' || job.status === 'rejected' || job.status === 'cancelled') {
    return { label: 'Failed', active: false }
  }
  return { label: 'Generating video… this can take several minutes', active: true }
}

export function Jazmii() {
  const { toast } = useToast()

  // ---- conversations -------------------------------------------------------
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [thread, setThread] = useState<JazmiiThreadMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ConversationSummary | null>(null)

  // ---- availability (truthful, from the backend) -----------------------------
  const [availability, setAvailability] = useState<Availability | null>(null)

  // ---- composer --------------------------------------------------------------
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [referenceImage, setReferenceImage] = useState<{ dataUrl: string; name: string } | null>(null)
  const [settings, setSettings] = useState<ComposerSettings>({ size: '1280x720', durationSec: 5, quality: 'quality', withAudio: false })
  const [customMode, setCustomMode] = useState(false)
  const [customW, setCustomW] = useState('1280')
  const [customH, setCustomH] = useState('720')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const effectiveSize = customMode && /^\d+$/.test(customW) && /^\d+$/.test(customH)
    ? `${customW}x${customH}`
    : settings.size
  const customValidity = (() => {
    if (!customMode) return null
    const w = Number(customW)
    const h = Number(customH)
    if (!/^\d+$/.test(customW) || !/^\d+$/.test(customH) || !Number.isInteger(w) || !Number.isInteger(h)) {
      return 'Custom dimensions must be whole numbers of pixels.'
    }
    if (w < CUSTOM_MIN_PX || h < CUSTOM_MIN_PX) return `Dimensions must be at least ${CUSTOM_MIN_PX}px.`
    if (w > CUSTOM_MAX_PX || h > CUSTOM_MAX_PX) return `Dimensions must be within ${CUSTOM_MAX_PX}px.`
    return null
  })()

  // ---- data loading ----------------------------------------------------------
  const refreshConversations = useCallback(async () => {
    try {
      const d = await beanFetch<{ conversations: ConversationSummary[] }>('/api/jazmii/conversations')
      setConversations(d.conversations)
      return d.conversations
    } catch {
      return []
    }
  }, [])

  const loadAvailability = useCallback(async () => {
    try {
      const d = await beanFetch<{ productAvailability: Availability }>('/api/jazmii/generate')
      setAvailability(d.productAvailability)
    } catch {
      setAvailability(null)
    }
  }, [])

  const openConversation = useCallback(async (id: string) => {
    setLoadingThread(true)
    try {
      const d = await beanFetch<{ conversation: { id: string; title: string }; messages: JazmiiThreadMessage[] }>(`/api/jazmii/conversations/${id}`)
      setActiveId(d.conversation.id)
      setThread(d.messages)
    } catch (e) {
      toast({ title: 'Could not open conversation', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setLoadingThread(false)
    }
  }, [toast])

  useEffect(() => {
    void (async () => {
      const list = await refreshConversations()
      if (list.length > 0) await openConversation(list[0].id)
    })()
    void loadAvailability()
  }, [refreshConversations, openConversation, loadAvailability])

  const refreshThread = useCallback(async () => {
    if (!activeId) return
    try {
      const d = await beanFetch<{ messages: JazmiiThreadMessage[] }>(`/api/jazmii/conversations/${activeId}`)
      setThread(d.messages)
    } catch {
      /* transient poll failure — the next tick retries */
    }
  }, [activeId])

  // Poll ONLY while a real job is genuinely in flight (navigating away never
  // stops the backend: pollers re-attach server-side on every list/detail read).
  const inflight = thread.some((m) => m.job && (m.job.status === 'queued' || m.job.status === 'running'))
  useEffect(() => {
    if (!inflight || !activeId) return
    const t = setInterval(() => void refreshThread(), 4000)
    return () => clearInterval(t)
  }, [inflight, activeId, refreshThread])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread.length, inflight])

  // ---- composer helpers ---------------------------------------------------------
  function pickImage(file: File | null) {
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

  // ---- send one conversational turn ----------------------------------------------
  const send = useCallback(
    async (rawText: string, opts?: { imageUrl?: string | null }) => {
      const text = rawText.trim()
      if (text.length < 3 || sending) return
      setSending(true)
      const localUserId = `local-u-${Date.now()}`
      const localPendingId = `local-a-${Date.now()}`
      const imageUrl = opts?.imageUrl !== undefined ? opts.imageUrl : referenceImage?.dataUrl
      setThread((prev) => [
        ...prev,
        {
          id: localUserId,
          role: 'user',
          kind: 'text',
          text,
          jobId: null,
          meta: { hasReferenceImage: Boolean(imageUrl), size: effectiveSize, durationSec: settings.durationSec, quality: settings.quality, withAudio: settings.withAudio },
          createdAt: new Date().toISOString(),
          job: null,
        },
        {
          id: localPendingId,
          role: 'assistant',
          kind: 'pending',
          text: null,
          jobId: null,
          meta: {},
          createdAt: new Date().toISOString(),
          job: null,
        },
      ])
      try {
        const d = await beanFetch<{ conversation: { id: string }; messages: JazmiiThreadMessage[] }>('/api/jazmii/chat', {
          method: 'POST',
          json: {
            conversationId: activeId ?? undefined,
            text,
            ...(imageUrl ? { imageUrl } : {}),
            settings: {
              size: effectiveSize,
              durationSec: settings.durationSec,
              quality: settings.quality,
              withAudio: settings.withAudio,
            },
          },
        })
        setActiveId(d.conversation.id)
        setThread((prev) => [...prev.filter((m) => m.id !== localUserId && m.id !== localPendingId), ...d.messages])
        setComposer('')
        if (opts?.imageUrl === undefined) setReferenceImage(null)
        void refreshConversations()
        void loadAvailability()
      } catch (e) {
        const err = e as Error & { code?: string }
        setThread((prev) =>
          prev.map((m) =>
            m.id === localPendingId
              ? { ...m, kind: 'text', text: err.message || 'The request failed.', meta: { errorCode: err.code ?? 'REQUEST_FAILED' } }
              : m,
          ),
        )
      } finally {
        setSending(false)
      }
    },
    [activeId, sending, effectiveSize, settings, referenceImage, refreshConversations, loadAvailability],
  )

  /** Regenerate: re-submit the same prompt + settings through the real pipeline. */
  async function regenerate(message: JazmiiThreadMessage) {
    const job = message.job
    const text = message.role === 'user' ? (message.text ?? '') : findPrecedingUserText(message)
    if (!text || !job) return
    // Re-attach the original reference image for image-to-video runs (owner
    // endpoint — the driver image the provider actually used).
    let imageUrl: string | null | undefined = undefined
    if (job.hasReferenceImage) {
      try {
        const d = await beanFetch<{ referenceImageUrl: string | null }>(`/api/jazmii/jobs/${job.id}/reference`)
        imageUrl = d.referenceImageUrl ?? undefined
      } catch {
        imageUrl = undefined
      }
    }
    if (job.hasReferenceImage && !imageUrl) {
      toast({ title: 'The original reference image is no longer retrievable — resubmitting without it (text-to-video).', variant: 'destructive' })
    }
    setSettings((s) => ({
      ...s,
      ...(job.size ? { size: job.size } : {}),
      ...(job.durationSecRequested ? { durationSec: job.durationSecRequested } : {}),
      ...(job.quality === 'speed' || job.quality === 'quality' ? { quality: job.quality } : {}),
      withAudio: job.withAudio,
    }))
    await send(text, { imageUrl })
  }

  function findPrecedingUserText(message: JazmiiThreadMessage): string {
    const idx = thread.findIndex((m) => m.id === message.id)
    for (let i = idx - 1; i >= 0; i--) {
      if (thread[i].role === 'user') return thread[i].text ?? ''
    }
    return ''
  }

  function startNewConversation() {
    setActiveId(null)
    setThread([])
    setComposer('')
    setReferenceImage(null)
  }

  async function deleteConversation(id: string) {
    try {
      await beanFetch(`/api/jazmii/conversations/${id}`, { method: 'DELETE' })
      const rest = conversations.filter((c) => c.id !== id)
      setConversations(rest)
      if (activeId === id) {
        startNewConversation()
        if (rest.length > 0) await openConversation(rest[0].id)
      }
    } catch (e) {
      toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setDeleteTarget(null)
    }
  }

  async function renameConversation(id: string) {
    const title = renameValue.trim()
    setRenamingId(null)
    if (!title) return
    try {
      await beanFetch(`/api/jazmii/conversations/${id}`, { method: 'PATCH', json: { title } })
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)))
    } catch (e) {
      toast({ title: 'Rename failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  // ---- render -----------------------------------------------------------------
  const operational = availability?.available === true
  const throttled = operational && availability?.accountThrottled === true

  const rail = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button
          onClick={startNewConversation}
          variant="outline"
          className="w-full justify-start gap-2 border-[rgba(212,175,55,0.4)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]"
        >
          <Plus className="h-4 w-4" /> New chat
        </Button>
      </div>
      <div className="bean-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-[11px] leading-relaxed text-white/35">
            Your video conversations will appear here. History is preserved — you can return to any generation later.
          </p>
        ) : (
          conversations.map((c) => (
            <div
              key={c.id}
              className={cn(
                'group mb-1 flex items-center gap-1 rounded-lg px-2 py-2 transition-colors',
                activeId === c.id ? 'bg-[rgba(212,175,55,0.12)]' : 'hover:bg-white/5',
              )}
            >
              {renamingId === c.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void renameConversation(c.id)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={() => void renameConversation(c.id)}
                  className="min-w-0 flex-1 rounded border border-[rgba(212,175,55,0.4)] bg-black/40 px-1.5 py-1 text-xs text-white/90 outline-none"
                  aria-label="Conversation title"
                />
              ) : (
                <button
                  onClick={() => void openConversation(c.id)}
                  className="min-w-0 flex-1 text-left"
                  aria-current={activeId === c.id ? 'page' : undefined}
                >
                  <div className={cn('truncate text-xs', activeId === c.id ? 'text-[#f0c75e]' : 'text-white/70')}>{c.title}</div>
                  <div className="text-[10px] text-white/30">{timeAgo(c.updatedAt)}</div>
                </button>
              )}
              <button
                onClick={() => {
                  setRenamingId(c.id)
                  setRenameValue(c.title)
                }}
                aria-label={`Rename conversation ${c.title}`}
                className="rounded p-1 text-white/25 opacity-0 transition group-hover:opacity-100 hover:text-[#f0c75e]"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={() => setDeleteTarget(c)}
                aria-label={`Delete conversation ${c.title}`}
                className="rounded p-1 text-white/25 opacity-0 transition group-hover:opacity-100 hover:text-red-300"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-white/10 p-3 text-[10px] leading-relaxed text-white/35">
        <div className="mb-1 flex items-center gap-1.5">
          <StatusDot ok={operational && !throttled} pulse={!operational || throttled} />
          {!operational ? 'Video backend unavailable' : throttled ? 'Gateway throttled' : 'Video backend operational'}
        </div>
        Real generation runs as tracked background jobs — status you see comes from the job record.
      </div>
    </div>
  )

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-[540px]">
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent className="border-[rgba(212,175,55,0.3)] bg-[#0d0d0d]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white/90">Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/55">
              “{deleteTarget?.title}” and its message history will be removed. Generated videos and their download
              artifacts are NOT deleted — they stay in your generation history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/15 bg-transparent text-white/70 hover:bg-white/5">Keep</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && void deleteConversation(deleteTarget.id)} className="bg-red-500/80 text-white hover:bg-red-500">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Conversation sidebar — desktop */}
      <aside className="hidden w-64 shrink-0 border-r border-[rgba(212,175,55,0.1)] lg:block">{rail}</aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex items-center gap-2 border-b border-[rgba(212,175,55,0.1)] px-3 py-2 sm:px-4">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Conversations">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 border-[rgba(212,175,55,0.15)] bg-[#0a0a0a] p-0">
              <SheetHeader className="border-b border-white/10 px-3 py-2">
                <SheetTitle className="text-xs tracking-[0.2em] text-[#f0c75e]">JAZMII CONVERSATIONS</SheetTitle>
              </SheetHeader>
              {rail}
            </SheetContent>
          </Sheet>
          <Video className="h-4 w-4 shrink-0 text-[#d4af37]" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-wide">JAZMII — video studio</h1>
            <p className="hidden truncate text-[10px] text-white/35 sm:block">
              Describe a video, attach a reference image for image-to-video, and keep creating through follow-ups
            </p>
          </div>
          <span
            className={cn(
              'hidden rounded-full border px-2 py-0.5 text-[10px] sm:inline',
              operational && !throttled ? 'border-emerald-400/30 text-emerald-300' : 'border-amber-400/30 text-amber-300',
            )}
            title={availability?.reason ?? 'Checking backend availability…'}
          >
            {!operational ? 'backend unavailable' : throttled ? 'gateway throttled' : 'ready'}
          </span>
        </header>

        {/* Thread */}
        <div ref={scrollRef} className="bean-scroll min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-4">
          <div className="mx-auto max-w-3xl space-y-5">
            {loadingThread ? (
              <div className="flex justify-center py-10">
                <Spinner className="h-5 w-5" />
              </div>
            ) : thread.length === 0 ? (
              <Welcome onPick={(t) => setComposer(t)} />
            ) : (
              thread.map((m) =>
                m.role === 'user' ? (
                  <UserBubble key={m.id} message={m} />
                ) : (
                  <AssistantMessage key={m.id} message={m} onRegenerate={regenerate} onContinue={(t) => setComposer(t)} />
                ),
              )
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-[rgba(212,175,55,0.1)] bg-black/20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4">
          <div className="mx-auto max-w-3xl">
            {referenceImage ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-[rgba(212,175,55,0.25)] bg-black/30 px-2 py-1.5">
                <img src={referenceImage.dataUrl} alt="Reference image" className="h-9 w-9 rounded border border-white/10 object-cover" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-white/55">{referenceImage.name} — image-to-video reference</span>
                <button onClick={() => setReferenceImage(null)} aria-label="Remove reference image" className="rounded p-1 text-white/40 hover:text-white/80">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}

            <div className="flex items-end gap-1.5 rounded-xl border border-[rgba(212,175,55,0.25)] bg-black/40 p-2">
              <input
                ref={fileInputRef}
                id="jazmii-chat-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
              />
              <label
                htmlFor="jazmii-chat-upload"
                aria-label="Attach a reference image for image-to-video"
                title="Attach a reference image (image-to-video)"
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/5 hover:text-[#f0c75e]"
              >
                <Paperclip className="h-4 w-4" />
              </label>
              <Textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void send(composer)
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder="Describe the video you want…"
                aria-label="Message JAZMII"
                className="max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <SettingsPopover
                settings={settings}
                setSettings={setSettings}
                customMode={customMode}
                setCustomMode={setCustomMode}
                customW={customW}
                customH={customH}
                setCustomW={setCustomW}
                setCustomH={setCustomH}
                customValidity={customValidity}
                effectiveSize={effectiveSize}
              />
              <Button
                onClick={() => void send(composer)}
                disabled={sending || composer.trim().length < 3 || !operational}
                aria-label="Send message"
                title={!operational ? 'Video backend unavailable' : undefined}
                className="h-10 w-10 shrink-0 rounded-lg bg-[#d4af37] p-0 text-black hover:bg-[#e6c25a]"
              >
                {sending ? <Spinner className="border-black/30 border-t-black" /> : <SendHorizonal className="h-4 w-4" />}
              </Button>
            </div>
            <p className="mt-1.5 text-center text-[10px] text-white/30">
              Enter sends · Shift+Enter for a new line · every status you see comes from the real backend job
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}

// ------------------------------------------------------------------------------------
// Welcome / empty state
// ------------------------------------------------------------------------------------

function Welcome({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="py-8 text-center sm:py-14">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[rgba(212,175,55,0.35)] bg-[rgba(212,175,55,0.08)]">
        <Film className="h-5 w-5 text-[#d4af37]" />
      </div>
      <h2 className="text-lg font-semibold tracking-wide text-white/90">What should we render?</h2>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-white/45">
        Describe a scene, motion and mood. Attach a reference image to drive image-to-video. Generation runs as a
        tracked background job — you can keep chatting while it renders.
      </p>
      <div className="mx-auto mt-6 grid max-w-xl gap-1.5 sm:grid-cols-1">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="bean-glass-hover rounded-lg border border-white/10 px-3 py-2.5 text-left text-[11px] leading-snug text-white/60 transition-colors hover:border-[rgba(212,175,55,0.35)] hover:text-white/85"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------
// Message bubbles
// ------------------------------------------------------------------------------------

function UserBubble({ message }: { message: JazmiiThreadMessage }) {
  const chips: string[] = []
  if (typeof message.meta.size === 'string') chips.push(aspectLabel(message.meta.size))
  if (typeof message.meta.durationSec === 'number') chips.push(`${message.meta.durationSec}s`)
  if (message.meta.quality === 'speed') chips.push('speed')
  if (message.meta.withAudio === true) chips.push('audio')
  if (message.meta.hasReferenceImage === true) chips.push('image-to-video')
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-1.5">
        {chips.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-1">
            {chips.map((c) => (
              <span key={c} className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/45">
                {c}
              </span>
            ))}
          </div>
        ) : null}
        <div className="rounded-2xl rounded-br-md border border-[rgba(212,175,55,0.28)] bg-[rgba(212,175,55,0.1)] px-4 py-2.5 text-sm leading-relaxed text-white/90">
          {message.text}
        </div>
      </div>
    </div>
  )
}

function AssistantMessage({
  message,
  onRegenerate,
  onContinue,
}: {
  message: JazmiiThreadMessage
  onRegenerate: (m: JazmiiThreadMessage) => Promise<void>
  onContinue: (t: string) => void
}) {
  if (message.kind === 'pending') {
    return (
      <div className="flex items-center gap-2 text-xs text-white/45">
        <Spinner className="h-3.5 w-3.5" /> Submitting to the video backend…
      </div>
    )
  }
  if (message.kind === 'text') {
    const failed = message.meta.errorCode != null
    return (
      <div
        className={cn(
          'rounded-xl border px-4 py-3 text-sm leading-relaxed',
          failed ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-white/10 bg-white/[0.03] text-white/75',
        )}
      >
        {message.text}
      </div>
    )
  }
  if (message.kind === 'job' && message.job) {
    return <VideoInThread message={message} onRegenerate={onRegenerate} onContinue={onContinue} />
  }
  return null
}

// ------------------------------------------------------------------------------------
// Video result inside the thread
// ------------------------------------------------------------------------------------

function VideoInThread({
  message,
  onRegenerate,
  onContinue,
}: {
  message: JazmiiThreadMessage
  onRegenerate: (m: JazmiiThreadMessage) => Promise<void>
  onContinue: (t: string) => void
}) {
  const job = message.job!
  const [regenerating, setRegenerating] = useState(false)
  const line = jobStatusLine(job)
  const terminalBad = job.status === 'failed' || job.status === 'rejected' || job.status === 'cancelled'

  return (
    <div className="bean-glass overflow-hidden rounded-xl">
      {/* Status / player area */}
      <div className="relative flex min-h-[180px] items-center justify-center bg-black/40 p-2">
        {job.status === 'completed' && job.videoUrl ? (
          <video
            src={job.videoUrl}
            controls
            preload="metadata"
            className="max-h-[420px] w-full rounded-lg bg-black"
            aria-label={`Generated video${job.width && job.height ? ` (${job.width}×${job.height})` : ''}`}
          />
        ) : terminalBad ? (
          <div className="max-w-md p-4 text-center">
            <XCircle className="mx-auto mb-2 h-7 w-7 text-red-400" />
            <p className="text-xs leading-relaxed text-red-300">{job.errorMessage ?? 'The video job failed.'}</p>
            {job.errorCode ? <p className="mt-1 text-[10px] text-white/30">{job.errorCode}</p> : null}
          </div>
        ) : (
          <div className="w-full max-w-sm p-6 text-center">
            <Spinner className="mx-auto mb-3 h-5 w-5" />
            <div className="mb-2 text-xs text-white/55">{line.label}</div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-[#d4af37] transition-all" style={{ width: `${Math.max(3, job.progress)}%` }} />
            </div>
            <div className="mt-1 text-[10px] text-white/30">real job progress: {job.progress}%</div>
          </div>
        )}
        {job.hasAudio && job.status === 'completed' ? (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-black/60 px-2 py-0.5 text-[10px] text-emerald-300">
            <AudioLines className="h-3 w-3" /> audio
          </span>
        ) : null}
      </div>

      {/* Meta + actions */}
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {job.status === 'completed' ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            ) : terminalBad ? (
              <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
            ) : (
              <Clock className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
            )}
            <span className="truncate text-[11px] text-white/45">
              {[
                job.width && job.height ? `${job.width}×${job.height}` : job.size ? `${job.size} requested` : null,
                aspectLabel(job.size),
                job.durationSec ? `${job.durationSec}s` : null,
                job.codec,
                job.bytes ? humanBytes(job.bytes) : null,
                timeAgo(job.queuedAt),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
          {job.status === 'completed' ? (
            <GoldBadge tone="green">done</GoldBadge>
          ) : terminalBad ? (
            <GoldBadge tone="red">{job.status}</GoldBadge>
          ) : (
            <GoldBadge tone="neutral">{job.status}</GoldBadge>
          )}
        </div>

        {job.status === 'completed' && job.videoUrl ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <a
              href={job.videoUrl}
              download
              className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2.5 py-1.5 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)]"
            >
              <Download className="h-3 w-3" /> Download
            </a>
            <button
              onClick={() => {
                setRegenerating(true)
                void onRegenerate(message).finally(() => setRegenerating(false))
              }}
              disabled={regenerating}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/5 disabled:opacity-50"
            >
              {regenerating ? <Spinner className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />} Regenerate
            </button>
            <button
              onClick={() => onContinue(`Continue this video: make it `)}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/5"
            >
              <PenLine className="h-3 w-3" /> Continue with another prompt
            </button>
          </div>
        ) : null}

        {/* Honest continuity-verification note (worker-measured, when present) */}
        {job.continuity?.checked && Array.isArray(job.continuity.defects) && job.continuity.defects.length > 0 ? (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-200">
            Continuity check flagged: {job.continuity.defects.slice(0, 3).join('; ')}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------
// Composer settings panel (compact, expandable — replaces the old dropdown form)
// ------------------------------------------------------------------------------------

function SettingsPopover({
  settings,
  setSettings,
  customMode,
  setCustomMode,
  customW,
  customH,
  setCustomW,
  setCustomH,
  customValidity,
  effectiveSize,
}: {
  settings: ComposerSettings
  setSettings: (s: ComposerSettings) => void
  customMode: boolean
  setCustomMode: (v: boolean) => void
  customW: string
  customH: string
  setCustomW: (v: string) => void
  setCustomH: (v: string) => void
  customValidity: string | null
  effectiveSize: string
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Generation settings"
          title="Generation settings"
          className="flex h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] text-white/55 transition-colors hover:bg-white/5 hover:text-[#f0c75e]"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {aspectLabel(effectiveSize) || effectiveSize} · {settings.durationSec}s · {settings.quality}
            {settings.withAudio ? ' · audio' : ''}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 border-[rgba(212,175,55,0.25)] bg-[#0d0d0d] p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-white/45">Generation settings</div>

        <div className="mb-1 text-[11px] text-white/55">Aspect ratio</div>
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {SIZE_PRESETS.map((s) => (
            <button
              key={s.value}
              onClick={() => {
                setCustomMode(false)
                setSettings({ ...settings, size: s.value })
              }}
              className={cn(
                'rounded-lg border px-2 py-1.5 text-left text-[11px]',
                !customMode && settings.size === s.value
                  ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                  : 'border-white/10 text-white/55',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setCustomMode(true)}
          className={cn(
            'mb-2 w-full rounded-lg border px-2 py-1.5 text-left text-[11px]',
            customMode ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/10 text-white/55',
          )}
        >
          Custom size {customMode ? `— ${customW || '?'}×${customH || '?'}` : ''}
        </button>
        {customMode ? (
          <div className="mb-2 rounded-lg border border-white/10 bg-black/30 p-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/45">Width (px)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customW}
                  onChange={(e) => setCustomW(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-[rgba(212,175,55,0.5)]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/45">Height (px)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customH}
                  onChange={(e) => setCustomH(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-[rgba(212,175,55,0.5)]"
                />
              </label>
            </div>
            {customValidity ? <p className="mt-1.5 text-[10px] text-red-300">{customValidity}</p> : (
              <p className="mt-1.5 text-[10px] text-emerald-300/70">Valid — applied to your next generation.</p>
            )}
          </div>
        ) : null}

        <div className="mb-1 text-[11px] text-white/55">Duration</div>
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {DURATIONS.map((d) => (
            <button
              key={d}
              onClick={() => setSettings({ ...settings, durationSec: d })}
              className={cn(
                'rounded-lg border px-2 py-1.5 text-[11px]',
                settings.durationSec === d
                  ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                  : 'border-white/10 text-white/55',
              )}
            >
              {d} seconds
            </button>
          ))}
        </div>

        <div className="mb-1 text-[11px] text-white/55">Quality</div>
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          {(['quality', 'speed'] as const).map((q) => (
            <button
              key={q}
              onClick={() => setSettings({ ...settings, quality: q })}
              className={cn(
                'rounded-lg border px-2 py-1.5 text-[11px] capitalize',
                settings.quality === q
                  ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                  : 'border-white/10 text-white/55',
              )}
            >
              {q}
            </button>
          ))}
        </div>

        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/10 px-2.5 py-2 text-[11px] text-white/65">
          <span className="inline-flex items-center gap-1.5">
            <AudioLines className="h-3.5 w-3.5 text-[#d4af37]" /> Generate audio
          </span>
          <input
            type="checkbox"
            checked={settings.withAudio}
            onChange={(e) => setSettings({ ...settings, withAudio: e.target.checked })}
            className="h-3.5 w-3.5 accent-[#d4af37]"
          />
        </label>
        <p className="mt-2 text-[10px] leading-relaxed text-white/30">
          Bounded pass-through: the provider validates the final combination and its errors surface verbatim.
        </p>
      </PopoverContent>
    </Popover>
  )
}
