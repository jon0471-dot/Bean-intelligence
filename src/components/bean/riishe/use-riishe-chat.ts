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
import { planRegenerate, persistedAnswerMatchesTurn } from '@/lib/riishe/retry'
import {
  classifyHttpFailure,
  consumeRiisheStream,
  type RiisheStreamEvent,
  type StreamFailureInfo,
} from '@/lib/riishe/sse-client'

export interface SourceView {
  id: number
  title: string
  url: string
  hostName: string
  date: string | null
  official: boolean
  social?: boolean
  pageRead: boolean
  /** ADDITIVE (shared research gateway): Agent Reach / Obscura provenance. */
  reach?: { channel: string; backend: string | null; engine: string }
  readEngine?: string
}

export interface MsgMeta {
  states: string[]
  sources: SourceView[]
  degraded: string[]
  retrievedAt?: string
  verificationNote?: string
  /** ADDITIVE (shared research gateway): Agent Reach lane provenance. */
  reach?: { channelsUsed: string[]; invocations: number; degraded: string[]; durationMs: number }
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
  // SYNCHRONOUS duplicate-send gate: React state (`streaming`) updates
  // asynchronously, so two send/regenerate calls in the same tick (double
  // Enter, double click on Regenerate, Enter + button) both saw `false` and
  // both POSTed — two identical turns. This ref flips synchronously inside
  // send() and is the authoritative in-flight marker.
  const sendingRef = useRef(false)
  // Guards the dead-wire recovery fetches below (one per failed turn; a
  // newer turn cancels an older turn's pending recovery).
  const recoverySeqRef = useRef(0)
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

  /** Delete one conversation (owner-checked server-side). Returns an honest
   *  result so the confirming dialog can stay open and show the real error
   *  on failure — a closed dialog must always mean the row is really gone.
   *  The global error banner is ALSO set so the failure stays visible after
   *  the dialog closes. */
  async function deleteConversation(id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await beanFetch(`/api/riishe/conversations/${id}`, { method: 'DELETE' })
      if (activeId === id) {
        setActiveId(null)
        setActiveTitle(null)
        setMessages([])
      }
      void loadConversations()
      return { ok: true }
    } catch (e) {
      const message = (e as Error).message
      setError(message)
      return { ok: false, error: message }
    }
  }

  /** Rename a conversation. Same honest-result contract as delete: the
   *  dialog uses the returned error to keep itself open on failure instead
   *  of silently closing as if the rename had succeeded. */
  async function renameConversation(
    id: string,
    title: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const d = await beanFetch<{ conversation: { id: string; title: string } }>(
        `/api/riishe/conversations/${id}`,
        { method: 'PATCH', json: { title } },
      )
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: d.conversation.title } : c)))
      if (activeId === id) setActiveTitle(d.conversation.title)
      return { ok: true }
    } catch (e) {
      const message = (e as Error).message
      setError(message)
      return { ok: false, error: message }
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
   *  everything after it, then answers the same user turn again.
   *  The trailing/retry decision is the unit-tested planRegenerate contract —
   *  a trailing regenerate is ALWAYS wire-`retry` (the previous inline logic
   *  skipped retry when the answer had a server id and duplicated the turn
   *  server-side). */
  function regenerateFrom(asstMsg: Msg) {
    if (sendingRef.current) return
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
    const plan = planRegenerate({ isTrailing, serverId: asstMsg.serverId })
    if (!plan) return
    // Drop everything from the user turn onward (locally; the server mirrors
    // this so history stays an honest sequence).
    setMessages(messages.slice(0, userIdx))
    setTimeout(
      () =>
        void send(userContent, {
          retry: plan.retry,
          retryFromId: plan.retryFromMessageId,
        }),
      0,
    )
  }

  async function send(overrideMessage?: string, opts?: { retry?: boolean; retryFromId?: string }) {
    const message = (overrideMessage ?? input).trim()
    // SYNCHRONOUS gate (see sendingRef): React's `streaming` state is not
    // updated until re-render, so this alone cannot stop same-tick doubles.
    if (!message || sendingRef.current) return
    sendingRef.current = true
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

    // Every new send invalidates any pending dead-wire recovery from an
    // earlier turn (seq guard below).
    const recoverySeq = ++recoverySeqRef.current

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
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        const failure = classifyHttpFailure(res.status, data?.error?.message)
        throw Object.assign(new Error(failure.message), { beanFailure: failure })
      }

      let convId: string | null = activeId
      let serverError: string | null = null
      let serverDone = false

      /**
       * DEAD-WIRE RECONCILIATION (root-cause completion of the 2026-11-01
       * streaming fix). Measured incident: the platform path can silently
       * drop the client connection mid-generation; the SERVER still finishes
       * the turn and persists the complete answer (disconnects are contained
       * in the SSE writer), but the client only saw its own watchdog message
       * and the partial text — the finished answer sat in the database
       * unseen. After any non-abort transport failure with a known
       * conversation, the client now fetches the persisted conversation and
       * adopts the completed answer when (a) the newest row is the assistant
       * reply to THIS turn's question and (b) the partial's head matches it —
       * never a guess, never another turn's answer. One bounded delayed
       * retry covers the case where the watchdog fired while the server was
       * still finishing a long buffered phase.
       */
      const runRecovery = async (attempt: number) => {
        if (!convId || recoverySeq !== recoverySeqRef.current) return
        try {
          const d = await beanFetch<{
            conversation: {
              messages: Array<{ id: string; role: string; content: string; metadata?: MsgMeta | null }>
            }
          }>(`/api/riishe/conversations/${convId}`)
          if (recoverySeq !== recoverySeqRef.current) return
          const rows = d.conversation.messages
          const last = rows[rows.length - 1]
          const prevRow = rows[rows.length - 2]
          const normalized = (s: string): string => s.replace(/\s+/g, ' ').trim()
          const isThisTurn =
            last &&
            last.role === 'assistant' &&
            typeof last.content === 'string' &&
            last.content.trim().length > 0 &&
            prevRow?.role === 'user' &&
            normalized(prevRow.content) === normalized(message)
          if (isThisTurn && persistedAnswerMatchesTurn(last.content, streamedRef.current)) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstId
                  ? {
                      ...m,
                      content: last.content,
                      partial: false,
                      pending: false,
                      serverId: last.id,
                      meta: last.metadata ?? undefined,
                    }
                  : m,
              ),
            )
            setError(null)
            return
          }
          // Not persisted yet (or honestly not this turn's answer): one
          // bounded delayed retry in case the server was still finishing.
          if (attempt === 0) {
            setTimeout(() => void runRecovery(1), 20_000)
          }
        } catch {
          /* recovery is best-effort; the preserved partial stays visible */
        }
      }

      const applyServerFailureOutcome = () => {
        // Shared finalization for any failure that already produced text vs
        // one that produced nothing:
        //  - text streamed -> keep it and label it HONESTLY as incomplete
        //    (an incomplete response is never presented as a success);
        //  - nothing streamed -> drop the empty bubble and put the question
        //    back into the composer so a retry needs no retyping.
        if (streamedRef.current !== '') {
          setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, partial: true, pending: false } : m)))
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== asstId))
          restoreQuestionForRetry(message)
        }
      }

      await consumeRiisheStream(res, {
        onEvent: (evt: RiisheStreamEvent) => {
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
            // Server-classified failure (rate limit / auth / provider...).
            // Its wording is the honest one — a later transport-level
            // 'protocol' failure for the same stream must NOT overwrite it.
            serverError = evt.error
            setError(evt.error)
          }
          if (evt.delta) {
            streamedRef.current += evt.delta
            setMessages((prev) =>
              prev.map((m) => (m.id === asstId ? { ...m, content: streamedRef.current, pending: false } : m)),
            )
          }
        },
        onComplete: (evt: RiisheStreamEvent) => {
          serverDone = true
          setResearching(false)
          setRunningTool(null)
          if (convId && !activeId) setActiveId(convId)
          if (evt.messageId) {
            setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, serverId: evt.messageId } : m)))
          }
          if (evt.meta) {
            setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, meta: evt.meta } : m)))
          }
          if (evt.partial === true && streamedRef.current === '') {
            // The server closed "normally" but produced no answer (e.g. the
            // whole draft was removed by verification). That is not a
            // success: say so and hand the question back for a retry.
            if (!serverError) setError('The answer could not be produced this time. Please try again.')
            setMessages((prev) => prev.filter((m) => m.id !== asstId))
            restoreQuestionForRetry(message)
          }
        },
        onFailure: (failure: StreamFailureInfo) => {
          if (failure.kind === 'aborted') {
            // User pressed Stop: keep what arrived and label it honestly.
            // NO recovery fetch — stopping is an explicit user decision.
            if (streamedRef.current !== '') {
              setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, partial: true, pending: false } : m)))
            } else {
              setMessages((prev) => prev.filter((m) => m.id !== asstId))
            }
            return
          }
          if (serverError !== null) {
            // The server already classified this failure over SSE (its event
            // is always the last one before close); keep that wording.
            applyServerFailureOutcome()
            void runRecovery(0)
            return
          }
          setError(failure.message)
          applyServerFailureOutcome()
          // network / timeout / protocol: the server may still have finished
          // and persisted the complete answer — reconcile before giving up.
          void runRecovery(0)
        },
      })

      // A stream that ended without the server's done event and without a
      // transport failure is impossible by contract, but stay honest: if no
      // completion was seen and no error was surfaced, label the turn failed.
      if (!serverDone && serverError === null && streamedRef.current === '') {
        setMessages((prev) => prev.filter((m) => m.id !== asstId))
      }
      void loadConversations()
    } catch (e) {
      const err = e as Error & { beanFailure?: StreamFailureInfo }
      if (err.name === 'AbortError') {
        // User pressed Stop before the stream even started: keep nothing.
        setMessages((prev) => prev.filter((m) => m.id !== asstId || m.content.length > 0))
      } else {
        // Classified HTTP / connection failure (never the raw browser text).
        setError(err.message)
        setMessages((prev) => prev.filter((m) => m.id !== asstId || m.content.length > 0))
        restoreQuestionForRetry(message)
      }
    } finally {
      // Release the SYNCHRONOUS send gate (see sendingRef) — React's
      // `streaming` state alone cannot prevent same-tick double submits.
      sendingRef.current = false
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
