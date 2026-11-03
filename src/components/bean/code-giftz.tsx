'use client'

/**
 * BEAN Intelligence — CODE GIFTZ workspace (chat-first coding assistant).
 *
 * ONE conversational input (no Generate/Explain/Review/Plan tabs, no target
 * language selector). Generated code opens a real workspace: file explorer,
 * tabbed editor with syntax highlighting, editable files with Save, line
 * diffs for model changes, sandbox terminal output, and an isolated Preview
 * panel for index.html projects. Panels are resizable; the chat stays
 * available before and after code exists.
 *
 * Honesty: the workspace shows exactly what the model produced (persisted
 * server-side), diffs render real changes only, the terminal shows real
 * sandbox output, and the preview renders the real files in a sandboxed
 * iframe. Nothing claims to have run or passed unless it actually did.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Markdown, Spinner, timeAgo, beanFetch } from './shared'
import { consumeRiisheStream, streamFailureMessage, type StreamFailureInfo } from '@/lib/riishe/sse-client'
import { cn } from '@/lib/utils'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  Code2,
  Send,
  Square,
  Trash2,
  Plus,
  FileCode2,
  FilePlus2,
  Pencil,
  Eye,
  GitCompareArrows,
  Terminal as TerminalIcon,
  MonitorPlay,
  CircleCheck,
  CircleX,
  Paperclip,
  X,
  MessageSquareCode,
  Save,
} from 'lucide-react'

interface ProjectSummary { id: string; title: string; messages: number; files: number; updatedAt: string }
interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  changes: Array<{ path: string; change: string }>
  /** Set when the turn did NOT complete: the text is the provider's partial
   *  output, honestly labeled instead of silently shown as a full answer. */
  incomplete?: boolean
  incompleteReason?: 'stopped' | 'interrupted'
}
interface ProjectFile { path: string; content: string; origin: 'generated' | 'modified' }
interface FileChange {
  path: string
  change: 'added' | 'modified'
  diff: Array<{ type: 'add' | 'del' | 'ctx'; text: string }>
}
interface RunResult {
  runId: string
  entry: string | null
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
}
interface FileMeta { id: string; name: string; kind: string; size: number; status: 'ready' | 'unsupported' | 'failed'; note?: string }

const WELCOME =
  "Hi! I'm CODE GIFTZ, your coding assistant. Describe what you want to build, debug, refactor or review — I'll write the files, and you can run them in the sandbox or open a live preview."

function langOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown', sql: 'sql',
  }
  return map[ext] ?? 'text'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Keep interrupted/streaming answers READABLE: an unterminated ``` fence
 *  (a stream cut mid-code-block) would otherwise render as broken text.
 *  Closing the odd fence renders everything received so far as the code
 *  block the model was writing. Complete answers always have balanced
 *  fences, so this is a no-op for them and is only applied to
 *  incomplete/in-flight messages. */
export function closeUnbalancedFences(text: string): string {
  const fenceLines = text.split('\n').filter((l) => l.trimStart().startsWith('```'))
  return fenceLines.length % 2 === 1 ? `${text.replace(/\n*$/, '')}\n\n\`\`\`` : text
}

export function CodeGiftz() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [fileView, setFileView] = useState<'code' | 'diff'>('code')
  const [editing, setEditing] = useState(false)
  const [editBuffer, setEditBuffer] = useState('')
  const [saving, setSaving] = useState(false)
  const [run, setRun] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [lastChanges, setLastChanges] = useState<FileChange[]>([])
  const [attachments, setAttachments] = useState<FileMeta[]>([])
  const [uploading, setUploading] = useState(false)
  const [workspaceWidth, setWorkspaceWidth] = useState(46) // percent of the row
  const endRef = useRef<HTMLDivElement>(null)
  const streamedRef = useRef('')
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<HTMLElement | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  // Synchronous double-submit guard: two rapid Enters/clicks in the same tick
  // both saw `streaming === false` with state alone (measured defect class).
  const streamingRef = useRef(false)
  // Prompt of the latest turn — powers the Retry action (cleared on success).
  const lastPromptRef = useRef<string | null>(null)
  // The assistant bubble currently being streamed (for the fence fix).
  const streamingAsstIdRef = useRef<string | null>(null)

  const hasHtml = files.some((f) => f.path === 'index.html' || f.path === 'main.html')

  const loadProjects = useCallback(async () => {
    try {
      const d = await beanFetch<{ projects: ProjectSummary[] }>('/api/code-giftz/chat')
      setProjects(d.projects)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { void loadProjects() }, [loadProjects])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, streaming, thinking])
  // Unmount during generation stops the request instead of leaving an
  // orphaned stream running (and its server-side generation continuing).
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  async function openProject(id: string) {
    setError(null)
    setRun(null)
    setShowPreview(false)
    try {
      const d = await beanFetch<{
        project: {
          id: string
          title: string
          messages: Array<{ id: string; role: string; content: string; changes: Array<{ path: string; change: string }> }>
          files: ProjectFile[]
        }
      }>(`/api/code-giftz/chat/${id}`)
      setProjectId(d.project.id)
      setMessages(d.project.messages.map((m) => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content, changes: m.changes ?? [] })))
      setFiles(d.project.files)
      const first = d.project.files[0]
      setOpenTabs(first ? [first.path] : [])
      setActiveFile(first?.path ?? null)
      setFileView('code')
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function newProject() {
    setProjectId(null)
    setMessages([])
    setFiles([])
    setOpenTabs([])
    setActiveFile(null)
    setRun(null)
    setError(null)
    setAttachments([])
    setShowPreview(false)
  }

  async function deleteProject(id: string) {
    try {
      await beanFetch(`/api/code-giftz/chat/${id}`, { method: 'DELETE' })
      if (projectId === id) newProject()
      void loadProjects()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function uploadFile(file: File) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/riishe/documents', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) window.dispatchEvent(new Event('bean:unauthorized'))
    if (!res.ok) throw new Error(data?.error?.message ?? `Upload failed (${res.status})`)
    return data.document as FileMeta
  }

  async function uploadFiles(list: FileList | File[]) {
    if (uploading || attachments.length >= 3) return
    setUploading(true)
    setError(null)
    try {
      for (const f of Array.from(list).slice(0, 3 - attachments.length)) {
        const doc = await uploadFile(f)
        setAttachments((prev) => [...prev, doc])
        if (doc.status === 'unsupported') {
          setError(`${doc.name}: ${doc.note ?? 'cannot be analyzed'}`)
        }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function openFile(path: string) {
    setActiveFile(path)
    setFileView('code')
    setEditing(false)
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
  }

  async function saveEdit() {
    if (!activeFile || !projectId) return
    setSaving(true)
    setError(null)
    try {
      await beanFetch(`/api/code-giftz/projects/${projectId}/files`, {
        method: 'POST',
        json: { path: activeFile, content: editBuffer },
      })
      setFiles((prev) => prev.map((f) => (f.path === activeFile ? { ...f, content: editBuffer, origin: 'modified' } : f)))
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function runInSandbox() {
    if (!projectId || running) return
    setRunning(true)
    setRun(null)
    setError(null)
    try {
      const d = await beanFetch<{ run: RunResult }>(`/api/code-giftz/projects/${projectId}/run`, {
        method: 'POST',
        json: { approval: true },
      })
      setRun(d.run)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  function stopGeneration() {
    abortRef.current?.abort()
  }

  /**
   * Send one chat turn over SSE.
   *
   * ROOT-CAUSE FIX (2026-11-03 "network error"): the previous loop read the
   * body with a hand-rolled line splitter and surfaced raw browser errors —
   * a transport death mid-generation reached the user as Chromium's literal
   * `TypeError: network error`, with no completion/interrupted distinction,
   * no watchdog, no retry, and no protected partial text.
   *
   * The turn is now consumed by the SAME hardened client the RIISHE product
   * uses (consumeRiisheStream): spec-correct SSE frames (LF/CRLF, multiline,
   * keepalive comments, final-flush), streaming UTF-8 decode, a 60s idle
   * watchdog, and typed failure categories. Partial text is always preserved
   * and honestly labeled; failures get actionable wording plus a safe Retry
   * (the failed turn never persisted an assistant answer, and the server
   * collapses the duplicated trailing prompt so history stays clean).
   */
  async function send(overrideMessage?: string) {
    const message = (overrideMessage ?? input).trim()
    if (!message || streamingRef.current) return
    if (overrideMessage === undefined) setInput('')
    setError(null)
    setStreaming(true)
    streamingRef.current = true
    setThinking(true)
    streamedRef.current = ''
    lastPromptRef.current = message

    const tempId = `u-${Date.now()}`
    const asstId = `a-${Date.now()}`
    streamingAsstIdRef.current = asstId
    setMessages((prev) => [...prev, { id: tempId, role: 'user', content: message, changes: [] }, { id: asstId, role: 'assistant', content: '', changes: [] }])

    const controller = new AbortController()
    abortRef.current = controller
    const readyFiles = attachments.filter((f) => f.status === 'ready')

    /** Refresh the workspace from the server (source of truth). */
    const refreshFiles = (pid: string | null) => {
      if (!pid) return
      void (async () => {
        try {
          const d = await beanFetch<{ project: { files: ProjectFile[] } }>(`/api/code-giftz/chat/${pid}`)
          setFiles(d.project.files)
          setOpenTabs((prev) => {
            const merged = [...prev]
            for (const f of d.project.files) if (!merged.includes(f.path)) merged.push(f.path)
            return merged
          })
          if (!activeFile && d.project.files.length > 0) setActiveFile(d.project.files[0].path)
        } catch { /* non-fatal */ }
      })()
    }

    try {
      const res = await fetch(`/api/code-giftz/chat?stream=1${projectId ? `&projectId=${projectId}` : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          projectId: projectId ?? undefined,
          fileIds: readyFiles.length > 0 ? readyFiles.map((f) => f.id) : undefined,
        }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        if (res.status === 401) window.dispatchEvent(new Event('bean:unauthorized'))
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error?.message ?? `Request failed (${res.status})`)
      }

      let newProjectId: string | null = projectId
      // The server's typed error frame (rate-limited, timeout, truncation…)
      // is the honest reason — it outranks the generic 'protocol' failure
      // the consumer reports when the stream closes after that frame.
      let serverError: { message: string; code: string } | null = null

      await consumeRiisheStream(
        res,
        {
          onEvent: (evt) => {
            if (evt.projectId) newProjectId = evt.projectId
            if (evt.stage === 'thinking') setThinking(true)
            if (evt.error) serverError = { message: evt.error, code: evt.code ?? 'BACKEND_FAILURE' }
            if (evt.delta) {
              streamedRef.current += evt.delta
              setThinking(false)
              setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, content: streamedRef.current } : m)))
            }
          },
          onComplete: (evt) => {
            lastPromptRef.current = null // turn really completed — no Retry
            setThinking(false)
            const wireChanges = evt.changes ?? []
            setLastChanges(
              wireChanges.map((c) => ({ path: c.path, change: c.change === 'modified' ? 'modified' : 'added', diff: c.diff ?? [] })) as FileChange[],
            )
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstId
                  ? { ...m, content: streamedRef.current, changes: wireChanges.map((c) => ({ path: c.path, change: c.change })), incomplete: false }
                  : m,
              ),
            )
            // Refresh from the server on every completed turn in a project.
            refreshFiles(newProjectId)
            const changes = evt.changes ?? []
            if (changes.length > 0) {
              setShowPreview((v) => v)
              const firstChanged = changes[0].path
              setOpenTabs((prev) => (prev.includes(firstChanged) ? prev : [...prev, firstChanged]))
              setActiveFile(firstChanged)
              setFileView('diff')
              setEditing(false)
            }
          },
          onFailure: (failure: StreamFailureInfo) => {
            setThinking(false)
            const hasText = streamedRef.current !== ''
            if (hasText) {
              // Partial content is preserved and labeled honestly: never a
              // silent look-alike of a completed answer.
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstId
                    ? { ...m, incomplete: true, incompleteReason: failure.kind === 'aborted' ? 'stopped' : 'interrupted' }
                    : m,
                ),
              )
            } else {
              setMessages((prev) => prev.filter((m) => m.id !== asstId))
            }
            if (failure.kind === 'aborted') return // user Stop — not an error
            const server = serverError as { message: string; code: string } | null
            setError(server ? `${server.message}` : failure.message || streamFailureMessage(failure.kind, failure.status))
          },
        },
        { signal: controller.signal },
      )

      if (newProjectId && !projectId) setProjectId(newProjectId)
      void loadProjects()
    } catch (e) {
      // Failures BEFORE the stream was consumable (fetch rejection, non-OK
      // status) — typed the same way, never the browser's raw wording.
      setThinking(false)
      if ((e as Error).name === 'AbortError') {
        if (streamedRef.current !== '') {
          setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, incomplete: true, incompleteReason: 'stopped' } : m)))
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== asstId))
        }
      } else {
        if (streamedRef.current === '') setMessages((prev) => prev.filter((m) => m.id !== asstId))
        else setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, incomplete: true, incompleteReason: 'interrupted' } : m)))
        setError((e as Error).message || streamFailureMessage('http', null))
      }
    } finally {
      setStreaming(false)
      setThinking(false)
      streamingRef.current = false
      streamingAsstIdRef.current = null
      abortRef.current = null
    }
  }

  // Resizable workspace divider (mouse drag; keyboard arrows for a11y).
  function startResize(clientX: number) {
    const container = workspaceRef.current?.parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()
    const onMove = (e: MouseEvent) => {
      const pct = ((rect.right - e.clientX) / rect.width) * 100
      setWorkspaceWidth(Math.min(72, Math.max(24, pct)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragRef.current = null
    }
    dragRef.current = container
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    void clientX
  }

  const active = files.find((f) => f.path === activeFile) ?? null
  const lastChange: FileChange['diff'] | null =
    (activeFile ? lastChanges.find((c) => c.path === activeFile)?.diff : null) ?? null

  const chatColumn = (
    <div className="flex min-w-0 flex-1 flex-col border-r border-[rgba(212,175,55,0.1)]">
      <div className="flex items-center gap-2 border-b border-[rgba(212,175,55,0.1)] px-5 py-3">
        <MessageSquareCode className="h-4 w-4 text-[#d4af37]" />
        <div className="text-sm font-semibold tracking-wide">CODE GIFTZ</div>
        <span className="hidden text-xs text-white/35 sm:inline">Chat-first coding · sandbox · live preview</span>
      </div>

      <div className="bean-scroll flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            <div className="flex justify-start">
              <div className="bean-glass max-w-[90%] rounded-2xl px-4 py-3 text-white/85">
                <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{WELCOME}</p>
              </div>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {[
                'Build a small web app (HTML/CSS/JS) — try a gold-themed timer',
                'Write a JavaScript function and run it in the sandbox',
                'Explain what this regular expression does: ^\\d{4}-\\d{2}$',
                'Refactor a messy function into clean modules',
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s.replace(/ — try a gold-themed timer$/, '')) }}
                  className="rounded-lg border border-[rgba(212,175,55,0.14)] bg-black/20 px-3 py-2 text-left text-xs text-white/55 transition-colors hover:border-[rgba(212,175,55,0.35)] hover:text-white/80"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[90%] rounded-2xl px-4 py-3', m.role === 'user' ? 'bg-[rgba(212,175,55,0.14)] text-white/90' : 'bean-glass text-white/85')}>
                  {m.role === 'user' ? (
                    <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{m.content}</p>
                  ) : m.content || m.incomplete ? (
                    <>
                      <Markdown
                        content={
                          // Complete answers have balanced fences — only an
                          // in-flight or interrupted message ever needs the fix.
                          m.incomplete || (streaming && m.id === streamingAsstIdRef.current)
                            ? closeUnbalancedFences(m.content)
                            : m.content
                        }
                      />
                      {m.incomplete ? (
                        <p className="mt-2 border-t border-[rgba(212,175,55,0.12)] pt-2 text-[10.5px] text-amber-300">
                          {m.incompleteReason === 'stopped'
                            ? 'Generation stopped — the text above is incomplete.'
                            : 'Response interrupted — the text above is incomplete.'}
                        </p>
                      ) : null}
                      {m.changes.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[rgba(212,175,55,0.12)] pt-2">
                          {m.changes.map((c) => (
                            <button
                              key={c.path}
                              onClick={() => openFile(c.path)}
                              className={cn(
                                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
                                c.change === 'added'
                                  ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                  : 'border border-[rgba(212,175,55,0.35)] bg-[rgba(212,175,55,0.1)] text-[#f0c75e]',
                              )}
                            >
                              <FilePlus2 className="h-3 w-3" />
                              {c.change === 'added' ? 'created' : 'modified'} {c.path}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : thinking ? (
                    <span className="inline-flex items-center gap-2 text-xs text-white/40"><Spinner /> Thinking…</span>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {error ? (
        <div className="mx-5 mb-2 flex items-center justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <span className="min-w-0">{error}</span>
          {lastPromptRef.current && !streaming ? (
            <button
              onClick={() => { const p = lastPromptRef.current; if (p) void send(p) }}
              className="shrink-0 rounded border border-red-400/40 px-2 py-1 text-[11px] text-red-200 transition-colors hover:bg-red-500/20"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {attachments.length > 0 || uploading ? (
        <div className="mx-auto flex w-full max-w-2xl flex-wrap gap-2 px-5 pb-1">
          {attachments.map((a) => (
            <span
              key={a.id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
                a.status === 'ready' ? 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] text-[#f0c75e]' : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
              )}
            >
              <FileCode2 className="h-3 w-3" /> {a.name} <span className="text-white/35">{formatBytes(a.size)}</span>
              {a.status !== 'ready' ? <span>· can't analyze</span> : null}
              <button onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))} className="ml-0.5 text-white/40 hover:text-white/80" aria-label={`Remove ${a.name}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {uploading ? <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-[11px] text-white/50"><Spinner className="h-3 w-3" /> uploading…</span> : null}
        </div>
      ) : null}

      <div className="border-t border-[rgba(212,175,55,0.1)] p-4">
        <div className="mx-auto max-w-2xl">
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || attachments.length >= 3}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(212,175,55,0.25)] px-2.5 py-1.5 text-[11px] text-white/55 transition-colors hover:bg-white/5 hover:text-white/80 disabled:opacity-50"
              title="Attach files (code, documents, data — analyzed server-side)"
            >
              <Paperclip className="h-3.5 w-3.5" /> Attach
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files?.length) void uploadFiles(e.target.files) }}
            />
            <span className="text-[10px] text-white/30">context files for the next request</span>
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
              }}
              placeholder="Describe what to build or change… (Enter to send, Shift+Enter for a new line)"
              rows={Math.min(4, Math.max(1, input.split('\n').length))}
              maxLength={12000}
              disabled={streaming}
              className="max-h-40 min-h-[46px] resize-none bg-black/30"
              aria-label="Message CODE GIFTZ"
            />
            {streaming ? (
              <Button onClick={stopGeneration} className="h-[46px] bg-[rgba(212,175,55,0.15)] px-4 text-[#f0c75e] hover:bg-[rgba(212,175,55,0.25)]" variant="outline" aria-label="Stop generating">
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={() => void send()} disabled={!input.trim()} className="h-[46px] bg-[#d4af37] px-4 text-black hover:bg-[#e6c25a]" aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const workspace = (
    <div ref={workspaceRef} className="flex min-w-0 flex-col" style={{ width: `var(--ws, ${workspaceWidth}%)` }}>
      <div className="flex items-center justify-between border-b border-[rgba(212,175,55,0.1)] px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Code2 className="h-3.5 w-3.5 text-[#d4af37]" /> Workspace
          {files.length > 0 ? <span className="text-white/30">· {files.length} file{files.length > 1 ? 's' : ''}</span> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {hasHtml ? (
            <button
              onClick={() => setShowPreview((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                showPreview ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/10 text-white/50 hover:border-[rgba(212,175,55,0.3)]',
              )}
            >
              <MonitorPlay className="h-3 w-3" /> Preview
            </button>
          ) : null}
          <button
            onClick={() => void runInSandbox()}
            disabled={running || !files.some((f) => /\.(js|ts)$/.test(f.path))}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-300 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
            title="Run the project's JS/TS in the restricted sandbox (real execution, real output)"
          >
            {running ? <Spinner className="h-3 w-3" /> : <TerminalIcon className="h-3 w-3" />} Run
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <FileCode2 className="mb-3 h-9 w-9 text-[#d4af37]/40" />
          <p className="text-sm font-medium text-white/70">No files yet</p>
          <p className="mt-1 max-w-xs text-xs text-white/40">
            Ask CODE GIFTZ to build something — generated files appear here with an editor, diffs, a sandbox terminal and a live preview.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Tabs */}
          <div className="flex flex-wrap items-center gap-1 border-b border-[rgba(212,175,55,0.08)] px-3 py-1.5">
            {openTabs.map((p) => {
              const f = files.find((x) => x.path === p)
              // HYDRATION FIX (nested button): the tab pill was a button
              // element containing the close button element — invalid HTML
              // that broke hydration. The pill is now a NON-INTERACTIVE flex
              // container holding two SIBLING buttons: tab selection and
              // close. Every class (border, padding, radius, active/inactive
              // variants, hover targets) moved to the container unchanged, so
              // spacing, sizing, colors and hover behavior are pixel-
              // identical; both actions remain real buttons (keyboard +
              // screen-reader safe).
              return (
                <div
                  key={p}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                    activeFile === p ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.1)] text-[#f0c75e]' : 'border-white/10 text-white/50 hover:border-[rgba(212,175,55,0.3)]',
                  )}
                >
                  <button
                    onClick={() => { setActiveFile(p); setFileView('code'); setEditing(false) }}
                    className="inline-flex items-center gap-1"
                  >
                    <FileCode2 className="h-3 w-3" />
                    {p}
                    {f?.origin === 'modified' ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="edited" /> : null}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenTabs((prev) => prev.filter((x) => x !== p)); if (activeFile === p) setActiveFile(openTabs.find((x) => x !== p) ?? null) }}
                    className="ml-0.5 text-white/30 hover:text-white/70"
                    aria-label={`Close ${p}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              )
            })}
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Explorer */}
            <div className="w-44 shrink-0 overflow-y-auto border-r border-[rgba(212,175,55,0.08)] px-2 py-2">
              <div className="mb-1 px-1.5 text-[10px] uppercase tracking-wider text-white/30">Files</div>
              {files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => openFile(f.path)}
                  className={cn(
                    'group flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[11px] transition-colors',
                    activeFile === f.path ? 'bg-[rgba(212,175,55,0.1)] text-[#f0c75e]' : 'text-white/55 hover:bg-white/5',
                  )}
                  title={f.origin === 'modified' ? 'Modified after generation (by you or a follow-up)' : 'Generated by CODE GIFTZ'}
                >
                  <span className="truncate">{f.path}</span>
                  <span className={cn('ml-1 h-1.5 w-1.5 shrink-0 rounded-full', f.origin === 'modified' ? 'bg-amber-400' : 'bg-emerald-500/70')} />
                </button>
              ))}
            </div>

            {/* Editor / diff / preview */}
            <div className="flex min-w-0 flex-1 flex-col">
              {showPreview && hasHtml ? (
                <iframe
                  title="Project preview (isolated)"
                  sandbox="allow-scripts"
                  src={`/api/code-giftz/projects/${projectId}/preview`}
                  className="min-h-0 w-full flex-1 border-0 bg-white"
                />
              ) : active ? (
                <>
                  <div className="flex items-center justify-between border-b border-[rgba(212,175,55,0.08)] px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setFileView('code')}
                        className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]', fileView === 'code' ? 'bg-[rgba(212,175,55,0.14)] text-[#f0c75e]' : 'text-white/45 hover:text-white/75')}
                      >
                        <Eye className="h-3 w-3" /> Code
                      </button>
                      <button
                        onClick={() => setFileView('diff')}
                        disabled={!lastChange}
                        className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] disabled:opacity-40', fileView === 'diff' ? 'bg-[rgba(212,175,55,0.14)] text-[#f0c75e]' : 'text-white/45 hover:text-white/75')}
                        title={lastChange ? 'Show what the last request changed' : 'No recorded change for this file yet'}
                      >
                        <GitCompareArrows className="h-3 w-3" /> Diff
                      </button>
                      <span className="ml-1 rounded border border-white/12 px-1 text-[9px] text-white/40">
                        {active.origin === 'modified' ? 'modified' : 'generated'}
                      </span>
                    </div>
                    <div>
                      {editing ? (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => { setEditing(false); setEditBuffer('') }} className="rounded px-1.5 py-0.5 text-[10px] text-white/45 hover:text-white/80">Cancel</button>
                          <Button onClick={() => void saveEdit()} disabled={saving} size="sm" className="h-6 bg-[#d4af37] px-2 text-[10px] text-black hover:bg-[#e6c25a]">
                            {saving ? <Spinner className="h-3 w-3" /> : <Save className="h-3 w-3" />} Save
                          </Button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditBuffer(active.content); setEditing(true); setFileView('code') }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/45 hover:text-white/80"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="bean-scroll min-h-0 flex-1 overflow-auto">
                    {editing ? (
                      <textarea
                        value={editBuffer}
                        onChange={(e) => setEditBuffer(e.target.value)}
                        spellCheck={false}
                        className="h-full min-h-[280px] w-full resize-none bg-[#0c0c0f] p-3 font-mono text-[12.5px] leading-relaxed text-white/85 outline-none"
                        aria-label={`Edit ${active.path}`}
                      />
                    ) : fileView === 'diff' && lastChange ? (
                      <pre className="min-h-full p-0 font-mono text-[11.5px] leading-relaxed">
                        {lastChange.map((l, i) => (
                          <div
                            key={i}
                            className={cn(
                              'px-3',
                              l.type === 'add' && 'bg-emerald-500/10 text-emerald-300',
                              l.type === 'del' && 'bg-red-500/10 text-red-300',
                              l.type === 'ctx' && 'text-white/45',
                            )}
                          >
                            <span className="mr-2 inline-block w-3 select-none">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
                            {l.text || ' '}
                          </div>
                        ))}
                      </pre>
                    ) : (
                      <SyntaxHighlighter
                        language={langOf(active.path)}
                        style={vscDarkPlus}
                        customStyle={{ margin: 0, background: '#0c0c0f', fontSize: '12.5px', padding: '14px', minHeight: '100%' }}
                        wrapLongLines={false}
                      >
                        {active.content}
                      </SyntaxHighlighter>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-xs text-white/35">Select a file</div>
              )}

              {/* Terminal */}
              {run ? (
                <div className="max-h-56 shrink-0 overflow-auto border-t border-[rgba(212,175,55,0.12)] bg-black/60 px-4 py-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/70">
                      <TerminalIcon className="h-3.5 w-3.5 text-[#d4af37]" /> Sandbox
                    </span>
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px]',
                      run.timedOut ? 'border-amber-500/40 text-amber-300' : run.exitCode === 0 ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300',
                    )}>
                      {run.timedOut ? <CircleX className="h-3 w-3" /> : run.exitCode === 0 ? <CircleCheck className="h-3 w-3" /> : <CircleX className="h-3 w-3" />}
                      {run.timedOut ? 'timeout (SIGKILL)' : `exit ${run.exitCode ?? '—'}`} · {run.durationMs}ms
                    </span>
                  </div>
                  {run.stdout ? <pre className="whitespace-pre-wrap font-mono text-[11.5px] text-emerald-200/90"><code>{run.stdout}</code></pre> : null}
                  {run.stderr ? <pre className="mt-1 whitespace-pre-wrap font-mono text-[11.5px] text-red-300/90"><code>{run.stderr}</code></pre> : null}
                  {!run.stdout && !run.stderr ? <p className="text-[11px] text-white/40">The process produced no output.</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )


  return (
    <div
      className="grid min-h-[calc(100vh-3.5rem-2rem)] lg:h-[calc(100vh-3.5rem-1.5rem)] lg:grid-cols-[220px_1fr]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer?.files?.length) void uploadFiles(e.dataTransfer.files)
      }}
    >
      {/* Projects rail */}
      <aside className="hidden flex-col border-r border-[rgba(212,175,55,0.1)] lg:flex">
        <div className="p-3">
          <Button onClick={newProject} className="w-full justify-start bg-[rgba(212,175,55,0.12)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.2)]" variant="outline">
            <Plus className="mr-1.5 h-4 w-4" /> New project
          </Button>
        </div>
        <ScrollArea className="flex-1 px-2 pb-3">
          {projects.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-white/30">No projects yet</p>
          ) : (
            projects.map((p) => (
              <div
                key={p.id}
                className={cn(
                  'group mb-0.5 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors',
                  projectId === p.id ? 'bg-[rgba(212,175,55,0.1)] text-[#f0c75e]' : 'text-white/60 hover:bg-white/5',
                )}
                onClick={() => void openProject(p.id)}
              >
                <div className="min-w-0">
                  <div className="truncate">{p.title}</div>
                  <div className="text-[10px] text-white/30">{p.files} files · {timeAgo(p.updatedAt)}</div>
                </div>
                <button
                  className="ml-2 hidden text-white/30 hover:text-red-400 group-hover:block"
                  onClick={(e) => { e.stopPropagation(); void deleteProject(p.id) }}
                  aria-label={`Delete ${p.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </ScrollArea>
      </aside>

      {/* Chat + workspace row */}
      <div className="flex min-h-0 min-w-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:border-r-0">{chatColumn}</div>
        <div
          className="hidden min-h-0 shrink-0 grow-0 border-l border-[rgba(212,175,55,0.1)] lg:flex lg:flex-col"
          style={{ width: `${workspaceWidth}%` }}
          onMouseDown={(e) => {
            // The 6px strip at the left edge acts as the resize handle.
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            if (e.clientX - rect.left <= 6) startResize(e.clientX)
          }}
        >
          {workspace}
        </div>
      </div>
    </div>
  )
}
