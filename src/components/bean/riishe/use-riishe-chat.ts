'use client'

/**
 * RIISHE chat runtime — the state machine behind the conversational UI.
 *
 * Architecture note (2026-11-01 ChatGPT-style experience upgrade): this hook
 * is the RIISHE equivalent of assistant-ui's ExternalStoreRuntime pattern —
 * ALL transport and conversation state lives here; the components beside it
 * are presentational primitives (thread, message, composer) that never touch
 * the wire protocol. The SSE protocol itself is UNCHANGED from the
 * pre-upgrade implementation (delta / reset / stage / research / tool / done
 * events + typed error payloads) because it carries the orchestrator's
 * evidence metadata, which a generic text stream cannot express.
 *
 * Real backend only: this hook talks to /api/riishe/chat (BEAN gateway →
 * managed provider). It never fabricates responses, never runs without the
 * server, and surfaces provider errors verbatim for the UI to display.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { beanFetch } from '@/components/bean/shared'
import type { ConversationListItem } from '@/lib/riishe/conversation-view'

export interface SourceView {
  id: number
  title: string
  url: string
  hostName: string
  date: string | null
  official: boolean
  social?: boolean
  pageRead: boolean
}

export interface MsgMeta {
  states: string[]
  sources: SourceView[]
  degraded: string[]
  retrievedAt?: string
  verificationNote?: string
}

export interface FileMeta {
  id: string
  name: string
  kind: string
  mime: string
  size: number
  status: 'ready' | 'unsupported' | 'failed'
  characters?: number
  truncated?: boolean
  note?: string
}

export interface Msg {
  id: string
  /** Persisted DB id (from the done event or history) — enables Regenerate
   *  on ANY assistant message, not just the trailing one. */
  serverId?: string
  role: 'user' | 'assistant'
  content: string
  partial?: boolean
  pending?: boolean
  meta?: MsgMeta
}

export const MAX_FILES = 3

/** DOM refs the runtime needs to implement its scroll behaviors. They are
 *  OWNED by the components that render the DOM (container/thread) and handed
 *  to the hook here — the hook itself never returns refs, so no component
 *  ever reads a ref out of the runtime object during render. */
export interface RiisheChatRefs {
  scrollRef: RefObject<HTMLDivElement | null>
  endRef: RefObject<HTMLDivElement | null>
}

export function useRiisheChat(refs: RiisheChatRefs) {
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeTitle, setActiveTitle] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [researching, setResearching] = useState(false)
  const [runningTool, setRunningTool] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<FileMeta[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const [dragOver, setDragOver] = useState(false)

  const nearBottomRef = useRef(true)
  const streamedRef = useRef('')
  const abortRef = useRef<AbortController | null>(null)
  const { scrollRef, endRef } = refs

  // Auto-scroll ONLY while the reader is already at (or near) the bottom.
  // Without this guard every streamed delta / expanded Sources section yanks
  // the viewport back down while the user reads an earlier answer.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const loadConversations = useCallback(async () => {
    try {
      const d = await beanFetch<{ conversations: ConversationListItem[] }>('/api/riishe/chat')
      setConversations(d.conversations)
    } catch {
      /* non-fatal: the sidebar keeps its last honest state */
    }
  }, [])

  // Follow new content (streamed deltas, stage changes) — but only when the
  // reader is already near the bottom; reading an earlier answer must never
  // be interrupted by the viewport jumping down.
  useEffect(() => {
    if (!nearBottomRef.current) return
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streaming, researching, runningTool])

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  // Title search against the REAL endpoint (searches ALL of the user's
  // conversations, not just the 50 most recent). Debounced so typing does
  // not fire a request per keystroke; a cleared query restores the recents.
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length === 0) {
      setSearching(false)
      void loadConversations()
      return
    }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const d = await beanFetch<{ conversations: ConversationListItem[] }>(
          `/api/riishe/chat?q=${encodeURIComponent(q)}`,
        )
        setConversations(d.conversations)
      } catch {
        /* keep the previous list; the input stays interactive */
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [searchQuery, loadConversations])

  function openConversation(id: string) {
    setActiveId(id)
    setError(null)
    setFiles([])
    nearBottomRef.current = true
    void (async () => {
      try {
        const d = await beanFetch<{
          conversation: {
            title: string
            messages: Array<{ id: string; role: string; content: string; metadata?: MsgMeta | null }>
          }
        }>(`/api/riishe/conversations/${id}`)
        setActiveTitle(d.conversation.title)
        setMessages(
          d.conversation.messages.map((m) => ({
            id: m.id,
            serverId: m.id,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            meta: m.metadata ?? undefined,
          })),
        )
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }

  async function deleteConversation(id: string) {
    try {
      await beanFetch(`/api/riishe/conversations/${id}`, { method: 'DELETE' })
      if (activeId === id) {
        setActiveId(null)
        setActiveTitle(null)
        setMessages([])
      }
      void loadConversations()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function renameConversation(id: string, title: string) {
    try {
      const d = await beanFetch<{ conversation: { id: string; title: string } }>(
        `/api/riishe/conversations/${id}`,
        { method: 'PATCH', json: { title } },
      )
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: d.conversation.title } : c)))
      if (activeId === id) setActiveTitle(d.conversation.title)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function newConversation() {
    setActiveId(null)
    setActiveTitle(null)
    setMessages([])
    setError(null)
    setFiles([])
    setSearchQuery('')
  }

  async function uploadOne(file: File) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/riishe/documents', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) window.dispatchEvent(new Event('bean:unauthorized'))
    if (!res.ok && res.status !== 415) {
      throw new Error(data?.error?.message ?? `Upload failed (${res.status})`)
    }
    if (res.status === 415 && !data?.document) {
      // Unsafe or rejected outright — surface the server's actionable reason.
      throw new Error(data?.error?.message ?? 'This file cannot be processed.')
    }
    setFiles((prev) => [...prev, data.document as FileMeta].slice(0, MAX_FILES))
    if (data.document?.status === 'unsupported') {
      setError(data.document.note ?? 'This file type cannot be analyzed yet — it stays attached but adds nothing to the answer.')
    }
  }

  async function uploadFiles(list: FileList | File[]) {
    const incoming = Array.from(list)
    if (incoming.length === 0 || uploadingCount > 0) return
    const room = MAX_FILES - files.length
    if (room <= 0) {
      setError(`Up to ${MAX_FILES} attachments per message.`)
      return
    }
    setError(null)
    setUploadingCount(incoming.length)
    const batch = incoming.slice(0, room)
    let failures = 0
    for (const f of batch) {
      try {
        await uploadOne(f)
      } catch (e) {
        failures += 1
        setError((e as Error).message)
      } finally {
        setUploadingCount((c) => Math.max(0, c - 1))
      }
    }
    if (failures > 0 && batch.length > failures) {
      setError('Some files were rejected — the message explains each failure.')
    }
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function stopGeneration() {
    abortRef.current?.abort()
  }

  /** After a failed turn, put the question back into the composer so the
   *  user can retry with Enter — no retyping. Never clobbers text the user
   *  has already started typing. */
  function restoreQuestionForRetry(question: string) {
    setInput((current) => (current.trim().length === 0 ? question : current))
  }

  /** Regenerate the response to a SPECIFIC user turn (consistent actions on
   *  every assistant message). For the trailing exchange this is the classic
   *  retry; for earlier messages the server removes that exchange and
   *  everything after it, then answers the same user turn again. */
  function regenerateFrom(asstMsg: Msg) {
    if (streaming) return
    const idx = messages.findIndex((m) => m.id === asstMsg.id)
    if (idx < 0) return
    let userIdx = -1
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') {
        userIdx = i
        break
      }
    }
    if (userIdx < 0) return
    const userContent = messages[userIdx].content
    const isTrailing = idx === messages.length - 1
    // Without a persisted id a mid-conversation regenerate cannot truncate
    // server-side history — refuse rather than silently duplicating the turn.
    if (!isTrailing && !asstMsg.serverId) return
    // Drop everything from the user turn onward (locally; the server mirrors
    // this for earlier messages so history stays an honest sequence).
    setMessages(messages.slice(0, userIdx))
    setTimeout(
      () =>
        void send(userContent, {
          retry: isTrailing && !asstMsg.serverId,
          retryFromId: isTrailing ? undefined : asstMsg.serverId,
        }),
      0,
    )
  }

  async function send(overrideMessage?: string, opts?: { retry?: boolean; retryFromId?: string }) {
    const message = (overrideMessage ?? input).trim()
    if (!message || streaming) return
    if (overrideMessage === undefined) setInput('')
    setError(null)
    setStreaming(true)
    setResearching(false)
    setRunningTool(null)
    nearBottomRef.current = true // a sent message always scrolls into view
    streamedRef.current = ''

    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: message }
    const asstId = `a-${Date.now()}`
    setMessages((prev) => [...prev, userMsg, { id: asstId, role: 'assistant', content: '', pending: true }])

    const controller = new AbortController()
    abortRef.current = controller
    const attachable = files.filter((f) => f.status === 'ready')

    try {
      const res = await fetch(`/api/riishe/chat?stream=1${activeId ? `&conversationId=${activeId}` : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          conversationId: activeId ?? undefined,
          documentIds: attachable.length > 0 ? attachable.map((d) => d.id) : undefined,
          retry: opts?.retry ?? false,
          ...(opts?.retryFromId ? { retryFromMessageId: opts.retryFromId } : {}),
        }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        // Keep the global identity in sync: a 401 here means the session is
        // gone server-side; drop the signed-in shell immediately.
        if (res.status === 401) window.dispatchEvent(new Event('bean:unauthorized'))
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error?.message ?? `Request failed (${res.status})`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let convId: string | null = activeId
      let failed = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let evt: {
            delta?: string
            reset?: boolean
            done?: boolean
            error?: string
            code?: string
            conversationId?: string
            messageId?: string
            partial?: boolean
            stage?: 'researching' | 'tools' | 'solving' | 'verifying'
            tool?: { name: string; status: 'started' | 'done' | 'failed' }
            meta?: MsgMeta
          }
          try {
            evt = JSON.parse(line.slice(6))
          } catch {
            continue
          }
          if (evt.conversationId) convId = evt.conversationId
          if (evt.stage === 'researching') setResearching(true)
          if (evt.stage === 'tools') {
            setResearching(false)
            setRunningTool('working')
          }
          if (evt.stage === 'solving' || evt.stage === 'verifying') {
            setResearching(false)
            setRunningTool(null)
          }
          if (evt.tool) {
            if (evt.tool.status === 'started') setRunningTool(evt.tool.name)
            else setRunningTool(null)
          }
          if (evt.reset) {
            // Reset protocol: a verification rewrite replaced the streamed
            // draft — clear it so the final answer REPLACES, never appends.
            streamedRef.current = ''
            setMessages((prev) =>
              prev.map((m) => (m.id === asstId ? { ...m, content: '', pending: true } : m)),
            )
          }
          if (evt.error) {
            failed = true
            setError(evt.error)
          }
          if (evt.delta) {
            streamedRef.current += evt.delta
            setMessages((prev) =>
              prev.map((m) => (m.id === asstId ? { ...m, content: streamedRef.current, pending: false } : m)),
            )
          }
          if (evt.done) {
            setResearching(false)
            setRunningTool(null)
            if (convId && !activeId) setActiveId(convId)
            if (evt.messageId) {
              setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, serverId: evt.messageId } : m)))
            }
            if (evt.meta) {
              setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, meta: evt.meta } : m)))
            }
          }
        }
      }
      // If nothing streamed (failed, or the server reported an empty partial),
      // drop the empty assistant bubble — the error banner already explains
      // what happened, and a perpetual "thinking" indicator would be a lie.
      if (streamedRef.current === '') {
        setMessages((prev) => prev.filter((m) => m.id !== asstId))
        // Server-side failure (e.g. upstream rate limit) reported over SSE:
        // the question goes back into the composer so a retry needs no
        // retyping. (Nothing was answered — no partial content is lost.)
        if (failed) restoreQuestionForRetry(message)
      } else if (failed) {
        setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, partial: true, pending: false } : m)))
      }
      void loadConversations()
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // User pressed stop: keep what arrived and label it honestly.
        if (streamedRef.current !== '') {
          setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, partial: true, pending: false } : m)))
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== asstId))
        }
      } else {
        setError((e as Error).message)
        setMessages((prev) => prev.filter((m) => m.id !== asstId || m.content.length > 0))
        restoreQuestionForRetry(message)
      }
    } finally {
      setStreaming(false)
      setResearching(false)
      setRunningTool(null)
      abortRef.current = null
      setMessages((prev) => prev.map((m) => ({ ...m, pending: false })))
    }
  }

  return {
    // state
    conversations,
    searchQuery,
    searching,
    activeId,
    activeTitle,
    messages,
    input,
    streaming,
    researching,
    runningTool,
    error,
    files,
    uploadingCount,
    dragOver,
    // actions
    setInput,
    setSearchQuery,
    setDragOver,
    setError,
    send,
    stopGeneration,
    regenerateFrom,
    newConversation,
    openConversation,
    deleteConversation,
    renameConversation,
    uploadFiles,
    removeFile,
  }
}

export type RiisheChat = ReturnType<typeof useRiisheChat>
