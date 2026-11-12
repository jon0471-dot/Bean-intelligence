'use client'

/**
 * BEAN Intelligence — LAXII unified conversational image studio (2026-11-12).
 *
 * ONE workspace, ONE conversation, all image capabilities. The old
 * Create/Enhance/Edit tab tool pages, the permanently visible enhancement
 * checkbox list and the standalone mask-editor layout are gone. Requests are
 * written in ordinary language ("Create a cinematic perfume advertisement.",
 * "Remove the background and make it transparent.", "Upscale this image to
 * 4K."), classified server-side by a deterministic detector, and executed by
 * the EXISTING backend jobs (text-to-image, hosted conversational editing,
 * two-stage background removal, deterministic enhancement + Lanczos upscale,
 * worker-gated masked editing).
 *
 * Honesty rules preserved: every job state is read back from the real
 * GenerationJob row (nothing is fabricated), genuine backend errors are
 * shown verbatim with a retry, and capability chips mirror the server's
 * truthful /api/laxii/edit capability state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { beanFetch, GoldBadge, Spinner, timeAgo } from './shared'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  Wand2,
  Paperclip,
  SendHorizonal,
  Download,
  Copy,
  Check,
  Scissors,
  Sparkles,
  Maximize2,
  PenLine,
  Menu,
  Plus,
  Trash2,
  RefreshCw,
  X,
  Eraser,
  Shield,
  Image as ImageIcon,
  XCircle,
  Clock,
  CheckCircle2,
} from 'lucide-react'

interface SizeOpt { value: string; label: string }
interface Asset {
  id: string
  width: number | null
  height: number | null
  bytes: number
  url: string
}

interface ThreadJob {
  id: string
  task: string
  mode: string | null
  status: string
  progress: number
  size: string | null
  errorCode: string | null
  errorMessage: string | null
  imageUrl: string | null
  originalUrl: string | null
  diffUrl: string | null
  report: {
    exactPreservedPct: number
    blendedPct: number
    changedPct: number
    generativeUsed: boolean
    summary: string
    protectedRegions?: Array<{ changed: boolean; source: string }>
    identitySimilarity?: { score: number; threshold: number; passed: boolean; metric: string }
  } | null
  width: number | null
  height: number | null
  format: string | null
  bytes: number | null
  durationMs: number | null
  transparent: boolean
  queuedAt: string
}

interface ThreadMessage {
  id: string
  role: 'user' | 'assistant'
  kind: string // text | job | clarify | mask-request | pending
  text: string | null
  assetId: string | null
  assetUrl: string | null
  jobId: string | null
  maskAssetIds: string[]
  meta: Record<string, unknown>
  createdAt: string
  job: ThreadJob | null
}

interface ConversationSummary {
  id: string
  title: string
  updatedAt: string
  messageCount: number
}

interface Caps {
  conversationalEdit: boolean
  bgRemoval: boolean
  smartEdit: boolean
  reason: string | null
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const CUSTOM_MIN_PX = 256
const CUSTOM_MAX_PX = 4096

const EXAMPLE_PROMPTS: Array<{ text: string; needsImage: boolean }> = [
  { text: 'Create a cinematic perfume advertisement.', needsImage: false },
  { text: 'Change the bottle cap to gold but preserve everything else.', needsImage: true },
  { text: 'Remove the background and make it transparent.', needsImage: true },
  { text: 'Improve image sharpness, lighting and colors.', needsImage: true },
  { text: 'Upscale this image to 4K.', needsImage: true },
  { text: 'Transform this photo into a cinematic portrait.', needsImage: true },
  { text: 'Remove only the object on the left.', needsImage: true },
]

async function uploadAsset(file: File, kind: 'original' | 'mask'): Promise<Asset> {
  const form = new FormData()
  form.append('file', file)
  form.append('kind', kind)
  const d = await beanFetch<{ asset: Asset }>('/api/laxii/assets', { method: 'POST', body: form })
  return d.asset
}

function extractAssetId(url: string): string | null {
  const m = /\/api\/laxii\/assets\/([\w-]+)$/.exec(url)
  return m ? m[1] : null
}

/** Genuine conversational status wording — derived ONLY from the real job. */
function jobStatusLine(job: ThreadJob, intent: string): { label: string; active: boolean } {
  if (job.status === 'queued') return { label: 'Queued…', active: true }
  if (job.status === 'completed') return { label: 'Completed', active: false }
  if (job.status === 'failed' || job.status === 'rejected' || job.status === 'cancelled') {
    return { label: 'Failed', active: false }
  }
  if (job.task === 'image-generation') return { label: 'Generating… this can take about a minute', active: true }
  if (job.mode === 'background-removal') return { label: 'Removing background…', active: true }
  if (job.mode === 'conversational-edit') return { label: 'Editing…', active: true }
  if (job.task === 'image-enhancement') {
    return { label: intent === 'upscale' ? 'Upscaling…' : 'Enhancing…', active: true }
  }
  return { label: 'Working…', active: true }
}

export function Laxii({ sizes }: { sizes: SizeOpt[] }) {
  const { toast } = useToast()

  // ---- conversations -------------------------------------------------------
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [loadingThread, setLoadingThread] = useState(false)

  // ---- capabilities (truthful, from the server) ------------------------------
  const [caps, setCaps] = useState<Caps>({ conversationalEdit: false, bgRemoval: false, smartEdit: false, reason: null })

  // ---- composer --------------------------------------------------------------
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [sourceRef, setSourceRef] = useState<{ assetId: string; url: string; label: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // ---- size control (generation only; NL hints win when typed) ---------------
  const [sizeMode, setSizeMode] = useState<'auto' | 'preset' | 'custom'>('auto')
  const [presetSize, setPresetSize] = useState(sizes[0]?.value ?? '1024x1024')
  const [customW, setCustomW] = useState('1920')
  const [customH, setCustomH] = useState('1080')
  const [lockAspect, setLockAspect] = useState(false)
  const [lockRatio, setLockRatio] = useState<number | null>(null)

  const [maskBusyId, setMaskBusyId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const sizeOverride = useMemo(() => {
    if (sizeMode === 'preset') return { size: presetSize }
    if (sizeMode === 'custom') {
      const w = Number(customW)
      const h = Number(customH)
      if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) return { width: w, height: h }
    }
    return undefined
  }, [sizeMode, presetSize, customW, customH])

  // ---- data loading ----------------------------------------------------------
  const refreshConversations = useCallback(async () => {
    try {
      const d = await beanFetch<{ conversations: ConversationSummary[] }>('/api/laxii/conversations')
      setConversations(d.conversations)
      return d.conversations
    } catch {
      return []
    }
  }, [])

  const loadCaps = useCallback(async () => {
    try {
      const d = await beanFetch<{ capabilities: Record<string, { available: boolean }>; unavailableReason: string | null }>('/api/laxii/edit')
      setCaps({
        conversationalEdit: d.capabilities['conversational-edit']?.available === true,
        bgRemoval: d.capabilities['background-removal']?.available === true,
        smartEdit: d.capabilities['smart-edit']?.available === true,
        reason: d.unavailableReason ?? null,
      })
    } catch {
      setCaps({ conversationalEdit: false, bgRemoval: false, smartEdit: false, reason: null })
    }
  }, [])

  const openConversation = useCallback(async (id: string) => {
    setLoadingThread(true)
    try {
      const d = await beanFetch<{ conversation: { id: string; title: string }; messages: ThreadMessage[] }>(`/api/laxii/conversations/${id}`)
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
    void loadCaps()
  }, [refreshConversations, openConversation, loadCaps])

  const refreshThread = useCallback(async () => {
    if (!activeId) return
    try {
      const d = await beanFetch<{ messages: ThreadMessage[] }>(`/api/laxii/conversations/${activeId}`)
      setThread(d.messages)
    } catch {
      /* transient poll failure — the next tick retries */
    }
  }, [activeId])

  // Poll ONLY while a real job is genuinely in flight.
  const inflight = thread.some((m) => m.job && (m.job.status === 'queued' || m.job.status === 'running'))
  useEffect(() => {
    if (!inflight || !activeId) return
    const t = setInterval(() => void refreshThread(), 4000)
    return () => clearInterval(t)
  }, [inflight, activeId, refreshThread])

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread.length, inflight])

  // ---- composer helpers --------------------------------------------------------
  function parseCustomDim(raw: string, axis: 'width' | 'height'): number {
    const trimmed = raw.trim()
    if (!/^\d+$/.test(trimmed)) throw new Error(`Custom ${axis} must be a whole number of pixels.`)
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

  // ---- upload --------------------------------------------------------------------
  async function onFilePicked(file: File | undefined) {
    if (!file || uploading || sending) return
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ title: 'Image exceeds the 25 MB upload limit.', variant: 'destructive' })
      return
    }
    setUploading(true)
    try {
      const a = await uploadAsset(file, 'original')
      setSourceRef({ assetId: a.id, url: a.url, label: `Uploaded · ${a.width ?? '?'}×${a.height ?? '?'}` })
    } catch (e) {
      toast({ title: 'Upload failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ---- send one conversational turn ----------------------------------------------
  const send = useCallback(
    async (rawText: string, opts?: { assetId?: string | null; maskAssetIds?: string[]; clearSource?: boolean }) => {
      const text = rawText.trim()
      const assetId = opts?.assetId !== undefined ? opts.assetId : sourceRef?.assetId
      const maskAssetIds = opts?.maskAssetIds
      if (!text && !assetId && !(maskAssetIds && maskAssetIds.length)) return
      if (sending) return
      setSending(true)
      const localUserId = `local-u-${Date.now()}`
      const localPendingId = `local-a-${Date.now()}`
      setThread((prev) => [
        ...prev,
        {
          id: localUserId,
          role: 'user',
          kind: 'text',
          text: text || null,
          assetId: assetId ?? null,
          assetUrl: assetId ? `/api/laxii/assets/${assetId}` : null,
          jobId: null,
          maskAssetIds: maskAssetIds ?? [],
          meta: {},
          createdAt: new Date().toISOString(),
          job: null,
        },
        {
          id: localPendingId,
          role: 'assistant',
          kind: 'pending',
          text: null,
          assetId: null,
          assetUrl: null,
          jobId: null,
          maskAssetIds: [],
          meta: {},
          createdAt: new Date().toISOString(),
          job: null,
        },
      ])
      try {
        const d = await beanFetch<{ conversation: { id: string }; messages: ThreadMessage[] }>('/api/laxii/chat', {
          method: 'POST',
          json: {
            conversationId: activeId ?? undefined,
            text,
            ...(assetId ? { assetId } : {}),
            ...(maskAssetIds && maskAssetIds.length ? { maskAssetIds } : {}),
            ...(sizeOverride ? { sizeOverride } : {}),
          },
        })
        setActiveId(d.conversation.id)
        setThread((prev) => [...prev.filter((m) => m.id !== localUserId && m.id !== localPendingId), ...d.messages])
        setComposer('')
        if (opts?.clearSource !== false) setSourceRef(null)
        void refreshConversations()
      } catch (e) {
        const err = e as Error & { code?: string }
        setThread((prev) =>
          prev.map((m) =>
            m.id === localPendingId
              ? {
                  ...m,
                  kind: 'text',
                  text: err.message || 'The request failed.',
                  meta: { errorCode: err.code ?? 'REQUEST_FAILED', failed: 'send' },
                }
              : m,
          ),
        )
      } finally {
        setSending(false)
      }
    },
    [activeId, sending, sizeOverride, sourceRef, refreshConversations],
  )

  /** Re-send the original request that produced this message (retry). */
  function retryMessage(message: ThreadMessage) {
    const idx = thread.findIndex((m) => m.id === message.id)
    for (let i = idx - 1; i >= 0; i--) {
      const m = thread[i]
      if (m.role === 'user') {
        void send(m.text ?? '', { assetId: m.assetId, maskAssetIds: m.maskAssetIds.length ? m.maskAssetIds : undefined, clearSource: false })
        return
      }
    }
    toast({ title: 'Original request not found in this conversation.', variant: 'destructive' })
  }

  function startNewConversation() {
    setActiveId(null)
    setThread([])
    setComposer('')
    setSourceRef(null)
  }

  async function deleteConversation(id: string) {
    try {
      await beanFetch(`/api/laxii/conversations/${id}`, { method: 'DELETE' })
      const rest = conversations.filter((c) => c.id !== id)
      setConversations(rest)
      if (activeId === id) {
        startNewConversation()
        if (rest.length > 0) await openConversation(rest[0].id)
      }
    } catch (e) {
      toast({ title: 'Delete failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  // ---- compact result actions (each one sends a NEW conversational request) -------
  function followUp(text: string, imageUrl: string) {
    const assetId = extractAssetId(imageUrl)
    if (!assetId) {
      toast({ title: 'This result cannot be used as a source (untracked artifact).', variant: 'destructive' })
      return
    }
    void send(text, { assetId, clearSource: true })
  }

  async function copyImage(url: string) {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      toast({ title: 'Image copied to clipboard.' })
    } catch {
      try {
        await navigator.clipboard.writeText(new URL(url, window.location.origin).toString())
        toast({ title: 'Image URL copied (direct clipboard needs a secure context).' })
      } catch (e) {
        toast({ title: 'Copy failed', description: (e as Error).message, variant: 'destructive' })
      }
    }
  }

  async function confirmMask(message: ThreadMessage, file: File) {
    setMaskBusyId(message.id)
    try {
      const mask = await uploadAsset(file, 'mask')
      const prompt = typeof message.meta.prompt === 'string' ? message.meta.prompt : 'Apply the painted edit.'
      await send(prompt, { assetId: message.assetId ?? undefined, maskAssetIds: [mask.id] })
    } catch (e) {
      toast({ title: 'Mask upload failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setMaskBusyId(null)
    }
  }

  // ---- render -----------------------------------------------------------------------
  const rail = (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button
          onClick={startNewConversation}
          variant="outline"
          className="w-full justify-start gap-2 border-[rgba(212,175,55,0.4)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]"
        >
          <Plus className="h-4 w-4" /> New conversation
        </Button>
      </div>
      <div className="bean-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="px-2 py-4 text-[11px] leading-relaxed text-white/35">
            Your conversations will appear here. History is preserved — you can return to any image work later.
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
              <button
                onClick={() => void openConversation(c.id)}
                className="min-w-0 flex-1 text-left"
                aria-current={activeId === c.id ? 'page' : undefined}
              >
                <div className={cn('truncate text-xs', activeId === c.id ? 'text-[#f0c75e]' : 'text-white/70')}>{c.title}</div>
                <div className="text-[10px] text-white/30">{timeAgo(c.updatedAt)}</div>
              </button>
              <button
                onClick={() => void deleteConversation(c.id)}
                aria-label={`Delete conversation ${c.title}`}
                className="rounded p-1 text-white/25 opacity-0 transition group-hover:opacity-100 hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
      <div className="border-t border-white/10 p-3 text-[10px] leading-relaxed text-white/35">
        One assistant for create, edit, enhance, background removal and upscale — just ask in plain language.
      </div>
    </div>
  )

  const capChips = (
    <div className="flex items-center gap-1.5">
      <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', caps.conversationalEdit ? 'border-emerald-400/30 text-emerald-300' : 'border-red-400/30 text-red-300')}>
        AI edit {caps.conversationalEdit ? 'ready' : 'unavailable'}
      </span>
      <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', caps.bgRemoval ? 'border-emerald-400/30 text-emerald-300' : 'border-red-400/30 text-red-300')}>
        BG removal {caps.bgRemoval ? 'ready' : 'unavailable'}
      </span>
      <span className={cn('hidden rounded-full border px-2 py-0.5 text-[10px] sm:inline', caps.smartEdit ? 'border-emerald-400/30 text-emerald-300' : 'border-white/15 text-white/40')}>
        Masked edit {caps.smartEdit ? 'ready' : 'needs worker'}
      </span>
    </div>
  )

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-[540px]">
      {/* Conversation rail — desktop */}
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
                <SheetTitle className="text-xs tracking-[0.2em] text-[#f0c75e]">LAXII CONVERSATIONS</SheetTitle>
              </SheetHeader>
              {rail}
            </SheetContent>
          </Sheet>
          <Wand2 className="h-4 w-4 shrink-0 text-[#d4af37]" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-wide">LAXII — image assistant</h1>
            <p className="hidden truncate text-[10px] text-white/35 sm:block">
              One conversation for generation, editing, enhancement, background removal and upscaling
            </p>
          </div>
          <div className="hidden md:block">{capChips}</div>
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
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    onRetry={retryMessage}
                    onFollowUp={followUp}
                    onCopy={copyImage}
                    onConfirmMask={confirmMask}
                    maskBusy={maskBusyId === m.id}
                  />
                ),
              )
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-[rgba(212,175,55,0.1)] bg-black/20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4">
          <div className="mx-auto max-w-3xl">
            {sourceRef ? (
              <div className="mb-2 flex items-center gap-2 rounded-lg border border-[rgba(212,175,55,0.25)] bg-black/30 px-2 py-1.5">
                <img src={sourceRef.url} alt="Attached source" className="h-9 w-9 rounded border border-white/10 object-cover" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-white/55">{sourceRef.label} — attached to your next message</span>
                <button onClick={() => setSourceRef(null)} aria-label="Remove attachment" className="rounded p-1 text-white/40 hover:text-white/80">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}

            <div className="flex items-end gap-1.5 rounded-xl border border-[rgba(212,175,55,0.25)] bg-black/40 p-2">
              <input
                ref={fileInputRef}
                id="laxii-chat-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => void onFilePicked(e.target.files?.[0])}
              />
              <label
                htmlFor="laxii-chat-upload"
                aria-label="Attach an image"
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/5 hover:text-[#f0c75e]"
              >
                {uploading ? <Spinner className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
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
                maxLength={4000}
                placeholder="Describe an image, or attach one and say what to change…"
                aria-label="Message LAXII"
                className="max-h-40 min-h-[40px] flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <SizePicker
                sizes={sizes}
                sizeMode={sizeMode}
                setSizeMode={setSizeMode}
                presetSize={presetSize}
                setPresetSize={setPresetSize}
                customW={customW}
                customH={customH}
                onCustomW={onCustomWChange}
                onCustomH={onCustomHChange}
                lockAspect={lockAspect}
                toggleLock={toggleLock}
                parseCustomDim={parseCustomDim}
              />
              <Button
                onClick={() => void send(composer)}
                disabled={sending || (!composer.trim() && !sourceRef)}
                aria-label="Send message"
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
        <Wand2 className="h-5 w-5 text-[#d4af37]" />
      </div>
      <h2 className="text-lg font-semibold tracking-wide text-white/90">What should we create?</h2>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-white/45">
        Describe an image, attach one and say what to change, or ask for enhancement, background removal or
        upscaling — LAXII picks the right engine and reports real progress.
      </p>
      <div className="mx-auto mt-6 grid max-w-xl gap-1.5 sm:grid-cols-2">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p.text}
            onClick={() => onPick(p.text)}
            className="bean-glass-hover rounded-lg border border-white/10 px-3 py-2.5 text-left text-[11px] leading-snug text-white/60 transition-colors hover:border-[rgba(212,175,55,0.35)] hover:text-white/85"
          >
            {p.text}
            {p.needsImage ? <span className="ml-1 text-white/30">· needs an image</span> : null}
          </button>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------
// Message bubbles
// ------------------------------------------------------------------------------------

function UserBubble({ message }: { message: ThreadMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-2">
        {message.assetUrl ? (
          <img
            src={message.assetUrl}
            alt="Uploaded image"
            className="ml-auto max-h-48 rounded-xl border border-[rgba(212,175,55,0.25)] object-contain"
            loading="lazy"
          />
        ) : null}
        {message.text ? (
          <div className="rounded-2xl rounded-br-md border border-[rgba(212,175,55,0.28)] bg-[rgba(212,175,55,0.1)] px-4 py-2.5 text-sm leading-relaxed text-white/90">
            {message.text}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AssistantMessage({
  message,
  onRetry,
  onFollowUp,
  onCopy,
  onConfirmMask,
  maskBusy,
}: {
  message: ThreadMessage
  onRetry: (m: ThreadMessage) => void
  onFollowUp: (text: string, imageUrl: string) => void
  onCopy: (url: string) => void
  onConfirmMask: (m: ThreadMessage, file: File) => Promise<void>
  maskBusy: boolean
}) {
  if (message.kind === 'pending') {
    return (
      <div className="flex items-center gap-2 text-xs text-white/45">
        <Spinner className="h-3.5 w-3.5" /> Understanding request…
      </div>
    )
  }

  if (message.kind === 'clarify') {
    return (
      <div className="rounded-xl border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.06)] px-4 py-3 text-sm leading-relaxed text-[#f0c75e]">
        {message.text}
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
        <p className="whitespace-pre-wrap">{message.text}</p>
        {failed ? (
          <Button
            onClick={() => onRetry(message)}
            variant="outline"
            size="sm"
            className="mt-3 gap-1.5 border-red-400/30 text-red-200 hover:bg-red-500/10"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry request
          </Button>
        ) : null}
      </div>
    )
  }

  if (message.kind === 'mask-request') {
    return (
      <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <p className="text-sm leading-relaxed text-white/75">{message.text}</p>
        {message.assetUrl ? <MaskPainter assetUrl={message.assetUrl} busy={maskBusy} onConfirm={(file) => void onConfirmMask(message, file)} /> : null}
      </div>
    )
  }

  if (message.kind === 'job' && message.job) {
    return <JobInThread message={message} onRetry={onRetry} onFollowUp={onFollowUp} onCopy={onCopy} />
  }

  return null
}

// ------------------------------------------------------------------------------------
// Job inside the thread
// ------------------------------------------------------------------------------------

function JobInThread({
  message,
  onRetry,
  onFollowUp,
  onCopy,
}: {
  message: ThreadMessage
  onRetry: (m: ThreadMessage) => void
  onFollowUp: (text: string, imageUrl: string) => void
  onCopy: (url: string) => void
}) {
  const job = message.job!
  const [compare, setCompare] = useState<'after' | 'before' | 'diff'>('after')
  const [copied, setCopied] = useState(false)
  const line = jobStatusLine(job, typeof message.meta.intent === 'string' ? message.meta.intent : '')
  const src = compare === 'before' ? job.originalUrl : compare === 'diff' ? job.diffUrl : job.imageUrl

  return (
    <div className="bean-glass overflow-hidden rounded-xl">
      {/* Status / artifact area */}
      <div className="relative flex min-h-[180px] items-center justify-center bg-black/40 p-2">
        {job.status === 'completed' && src ? (
          <img
            src={src}
            alt={`LAXII ${job.task === 'image-generation' ? 'generated' : 'edited'} result${job.transparent ? ' (transparent PNG)' : ''}`}
            className="max-h-[420px] w-auto max-w-full cursor-zoom-in rounded-lg object-contain"
            loading="lazy"
            onClick={() => window.open(src, '_blank', 'noopener')}
          />
        ) : job.status === 'failed' || job.status === 'rejected' || job.status === 'cancelled' ? (
          <div className="max-w-md p-4 text-center">
            <XCircle className="mx-auto mb-2 h-7 w-7 text-red-400" />
            <p className="text-xs leading-relaxed text-red-300">{job.errorMessage ?? 'The job failed.'}</p>
            {job.errorCode ? <p className="mt-1 text-[10px] text-white/30">{job.errorCode}</p> : null}
            <Button
              onClick={() => onRetry(message)}
              variant="outline"
              size="sm"
              className="mt-3 gap-1.5 border-red-400/30 text-red-200 hover:bg-red-500/10"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Retry request
            </Button>
          </div>
        ) : (
          <div className="w-full max-w-sm p-6 text-center">
            <Spinner className="mx-auto mb-3 h-5 w-5" />
            <div className="mb-2 text-xs text-white/55">{line.label}</div>
            <Progress value={job.progress} className="h-1.5 bg-white/5" />
          </div>
        )}
        {job.transparent && job.status === 'completed' ? (
          <span className="absolute right-2 top-2 rounded-full border border-emerald-400/30 bg-black/60 px-2 py-0.5 text-[10px] text-emerald-300">
            transparent PNG
          </span>
        ) : null}
      </div>

      {/* Meta + actions */}
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {job.status === 'completed' ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
            ) : job.status === 'failed' || job.status === 'rejected' || job.status === 'cancelled' ? (
              <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
            ) : (
              <Clock className="h-3.5 w-3.5 shrink-0 text-[#d4af37]" />
            )}
            <span className="truncate text-[11px] text-white/45">
              {job.size && (job.width === null || job.height === null || job.size !== `${job.width}x${job.height}`) ? `${job.size} · ` : ''}
              {job.width && job.height ? `${job.width}×${job.height}` : job.size ?? 'image'}
              {job.durationMs ? ` · ${(job.durationMs / 1000).toFixed(1)}s` : ''}
              {job.bytes ? ` · ${Math.round(job.bytes / 1024)} KB` : ''} · {timeAgo(job.queuedAt)}
            </span>
          </div>
          {job.status === 'completed' ? (
            <GoldBadge tone="gold">done</GoldBadge>
          ) : job.status === 'failed' || job.status === 'rejected' || job.status === 'cancelled' ? (
            <GoldBadge tone="red">failed</GoldBadge>
          ) : (
            <GoldBadge tone="gold">{job.status}</GoldBadge>
          )}
        </div>

        {job.status === 'completed' && job.imageUrl ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <a
              href={job.imageUrl}
              download={`bean-laxii-${job.id}.${job.format === 'png' ? 'png' : 'jpg'}`}
              className="inline-flex items-center gap-1 rounded-md border border-[rgba(212,175,55,0.35)] px-2.5 py-1.5 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)]"
            >
              <Download className="h-3 w-3" /> Download
            </a>
            <button
              onClick={() => {
                setCopied(true)
                onCopy(job.imageUrl!)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/5"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? 'Copied' : 'Copy image'}
            </button>
            <button
              onClick={() => onFollowUp('Edit this image further: ', job.imageUrl!)}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/5"
            >
              <PenLine className="h-3 w-3" /> Edit further
            </button>
            <button
              onClick={() => onFollowUp('Remove the background and make it transparent.', job.imageUrl!)}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/5"
            >
              <Scissors className="h-3 w-3" /> Remove background
            </button>
            <button
              onClick={() => onFollowUp('Enhance this image: improve sharpness, lighting and colors.', job.imageUrl!)}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/5"
            >
              <Sparkles className="h-3 w-3" /> Enhance
            </button>
            <button
              onClick={() => onFollowUp('Upscale this image to 4K.', job.imageUrl!)}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/5"
            >
              <Maximize2 className="h-3 w-3" /> Upscale
            </button>
          </div>
        ) : null}

        {/* Preservation report (deterministic engine jobs) */}
        {job.report ? (
          <div className="space-y-1.5 rounded-lg border border-white/10 bg-black/20 p-2">
            <div className="flex items-center justify-between text-[10px] text-white/40">
              <span>Before / After / Diff</span>
              <div className="flex gap-1">
                {(['before', 'after', 'diff'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setCompare(v)}
                    className={cn(
                      'rounded px-1.5 py-0.5 capitalize',
                      compare === v ? 'bg-[rgba(212,175,55,0.16)] text-[#f0c75e]' : 'text-white/45 hover:text-white/70',
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[10px] leading-relaxed text-white/55">
              <span className={cn('font-medium', job.report.exactPreservedPct > 0 ? 'text-emerald-400' : 'text-[#f0c75e]')}>
                {job.report.exactPreservedPct.toFixed(1)}% exact original pixels
              </span>
              {' · '}
              {job.report.changedPct.toFixed(1)}% changed
              {' · '}
              {job.report.generativeUsed ? 'generative' : 'deterministic'}
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

// ------------------------------------------------------------------------------------
// Inline mask painter (appears ONLY when a masked edit is genuinely available)
// ------------------------------------------------------------------------------------

function canvasToPngFile(canvas: HTMLCanvasElement): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Mask export failed.'))
        return
      }
      resolve(new File([blob], 'mask.png', { type: 'image/png' }))
    }, 'image/png')
  })
}

function MaskPainter({ assetUrl, busy, onConfirm }: { assetUrl: string; busy: boolean; onConfirm: (file: File) => void }) {
  const [hasInk, setHasInk] = useState(false)
  const [erase, setErase] = useState(false)
  const [brushSize, setBrushSize] = useState(24)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  const lastFullRef = useRef<{ x: number; y: number } | null>(null)
  const lastPreviewRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const img = new Image()
    img.src = assetUrl
    img.onload = () => {
      const wrapper = wrapperRef.current
      const preview = previewRef.current
      if (!wrapper || !preview) return
      const maxW = wrapper.clientWidth || 320
      const scale = Math.min(1, maxW / img.naturalWidth)
      preview.width = Math.max(1, Math.round(img.naturalWidth * scale))
      preview.height = Math.max(1, Math.round(img.naturalHeight * scale))
      preview.getContext('2d')?.clearRect(0, 0, preview.width, preview.height)
      const mask = maskRef.current
      if (mask) {
        mask.width = img.naturalWidth
        mask.height = img.naturalHeight
        mask.getContext('2d')?.clearRect(0, 0, mask.width, mask.height)
      }
      setHasInk(false)
    }
  }, [assetUrl])

  function strokeAt(ev: React.PointerEvent<HTMLCanvasElement>, isStart: boolean) {
    const preview = previewRef.current
    const mask = maskRef.current
    if (!preview || !mask) return
    const rect = ev.currentTarget.getBoundingClientRect()
    const px = ((ev.clientX - rect.left) / rect.width) * mask.width
    const py = ((ev.clientY - rect.top) / rect.height) * mask.height
    const vx = ((ev.clientX - rect.left) / rect.width) * preview.width
    const vy = ((ev.clientY - rect.top) / rect.height) * preview.height
    const fullR = Math.max(2, (brushSize / 2) * (mask.width / rect.width))

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

    drawOn(preview, 'rgba(212,175,55,0.55)', brushSize / 2, vx, vy, lastPreviewRef.current)
    drawOn(mask, 'rgba(255,255,255,1)', fullR, px, py, lastFullRef.current)
    lastFullRef.current = { x: px, y: py }
    lastPreviewRef.current = { x: vx, y: vy }
    setHasInk(true)
  }

  return (
    <div>
      <div ref={wrapperRef} className="relative overflow-hidden rounded-lg border border-white/10 bg-black/40">
        <img src={assetUrl} alt="Image to mark a region on" className="block w-full select-none" draggable={false} />
        <canvas
          ref={previewRef}
          className={cn('absolute inset-0 h-full w-full', erase ? 'cursor-cell' : 'cursor-crosshair')}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            lastFullRef.current = null
            lastPreviewRef.current = null
            strokeAt(e, true)
          }}
          onPointerMove={(e) => {
            if (e.buttons > 0) strokeAt(e, false)
          }}
          onPointerUp={() => {
            lastFullRef.current = null
            lastPreviewRef.current = null
          }}
          onPointerLeave={() => {
            lastFullRef.current = null
            lastPreviewRef.current = null
          }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setErase(false)}
          className={cn(
            'rounded-lg border px-2.5 py-1.5 text-[10px]',
            !erase ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/10 text-white/55',
          )}
        >
          <PenLine className="mr-0.5 inline h-3 w-3" /> Mark
        </button>
        <button
          onClick={() => setErase(true)}
          className={cn(
            'rounded-lg border px-2.5 py-1.5 text-[10px]',
            erase ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/10 text-white/55',
          )}
        >
          <Eraser className="mr-0.5 inline h-3 w-3" /> Erase
        </button>
        <button
          onClick={() => {
            for (const c of [previewRef, maskRef]) c.current?.getContext('2d')?.clearRect(0, 0, c.current.width, c.current.height)
            setHasInk(false)
          }}
          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] text-white/55"
        >
          <Trash2 className="mr-0.5 inline h-3 w-3" /> Clear
        </button>
        <div className="flex min-w-[140px] flex-1 items-center gap-2 text-[10px] text-white/45">
          Brush
          <input
            type="range"
            min={4}
            max={80}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-full accent-[#d4af37]"
            aria-label="Brush size"
          />
        </div>
        <Button
          onClick={() => {
            const mask = maskRef.current
            if (!mask) return
            void canvasToPngFile(mask).then(onConfirm)
          }}
          disabled={!hasInk || busy}
          className="h-8 bg-[#d4af37] px-3 text-xs font-semibold text-black hover:bg-[#e6c25a]"
        >
          {busy ? <Spinner className="border-black/30 border-t-black" /> : <Shield className="mr-1 h-3.5 w-3.5" />}
          Apply masked edit
        </Button>
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-white/40">
        Gold strokes mark what may change; everything outside them stays a bit-exact original (measured, not promised).
      </p>
    </div>
  )
}

// ------------------------------------------------------------------------------------
// Composer size control (generation dimensions — capability preserved from the
// old create tab, now as a quiet popover; natural-language hints still win).
// ------------------------------------------------------------------------------------

function SizePicker({
  sizes,
  sizeMode,
  setSizeMode,
  presetSize,
  setPresetSize,
  customW,
  customH,
  onCustomW,
  onCustomH,
  lockAspect,
  toggleLock,
  parseCustomDim,
}: {
  sizes: SizeOpt[]
  sizeMode: 'auto' | 'preset' | 'custom'
  setSizeMode: (m: 'auto' | 'preset' | 'custom') => void
  presetSize: string
  setPresetSize: (v: string) => void
  customW: string
  customH: string
  onCustomW: (v: string) => void
  onCustomH: (v: string) => void
  lockAspect: boolean
  toggleLock: () => void
  parseCustomDim: (raw: string, axis: 'width' | 'height') => number
}) {
  // Derived validation — no render-time state writes.
  let customValidity: string | null = null
  try {
    parseCustomDim(customW, 'width')
    parseCustomDim(customH, 'height')
  } catch (e) {
    customValidity = (e as Error).message
  }
  const label =
    sizeMode === 'auto' ? 'Auto size' : sizeMode === 'preset' ? presetSize : `${customW || '?'}×${customH || '?'}`
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label="Output dimensions for generation"
          className="flex h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] text-white/55 transition-colors hover:bg-white/5 hover:text-[#f0c75e]"
        >
          <ImageIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 border-[rgba(212,175,55,0.25)] bg-[#0d0d0d] p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-white/45">Generation size</div>
        <button
          onClick={() => {
            setSizeMode('auto')
          }}
          className={cn(
            'mb-1.5 w-full rounded-lg border px-2.5 py-2 text-left text-[11px]',
            sizeMode === 'auto' ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/10 text-white/55',
          )}
        >
          <div className="font-medium">Auto</div>
          <div className="text-white/35">LAXII picks from your words ("portrait", "16:9", "1920x1080")</div>
        </button>
        <div className="grid grid-cols-2 gap-1.5">
          {sizes.map((s) => (
            <button
              key={s.value}
              onClick={() => {
                setSizeMode('preset')
                setPresetSize(s.value)
              }}
              className={cn(
                'rounded-lg border px-2 py-1.5 text-left text-[11px]',
                sizeMode === 'preset' && presetSize === s.value
                  ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]'
                  : 'border-white/10 text-white/55',
              )}
            >
              <div className="font-medium">{s.label}</div>
              <div className="text-white/35">{s.value}</div>
            </button>
          ))}
        </div>
        <button
          onClick={() => setSizeMode('custom')}
          className={cn(
            'mt-1.5 w-full rounded-lg border px-2.5 py-2 text-left text-[11px]',
            sizeMode === 'custom' ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/10 text-white/55',
          )}
        >
          <div className="font-medium">Custom size</div>
          <div className="text-white/35">{customW || '?'} × {customH || '?'} px</div>
        </button>
        {sizeMode === 'custom' ? (
          <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/45">Width (px)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customW}
                  onChange={(e) => onCustomW(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-[rgba(212,175,55,0.5)]"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-wide text-white/45">Height (px)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={customH}
                  onChange={(e) => onCustomH(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white/90 outline-none focus:border-[rgba(212,175,55,0.5)]"
                />
              </label>
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-white/55">
              <input type="checkbox" checked={lockAspect} onChange={toggleLock} className="h-3.5 w-3.5 accent-[#d4af37]" />
              Lock aspect ratio
            </label>
            {customValidity ? <p className="mt-1.5 text-[10px] text-red-300">{customValidity}</p> : (
              <p className="mt-1.5 text-[10px] text-emerald-300/70">Valid — applied to your next generation.</p>
            )}
            <p className="mt-1 text-[10px] text-white/30">
              Allowed range {CUSTOM_MIN_PX}–{CUSTOM_MAX_PX} px per side.
            </p>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
