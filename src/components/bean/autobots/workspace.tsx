'use client'

/**
 * BEAN Intelligence — M49.1 BEAN AUTOBOTS agent workspace + details views.
 *
 * The workspace is a REAL execution surface: every turn rides the existing
 * RIISHE orchestration through POST /api/autobots/agents/[id]/run (the same
 * `riishe` chat product gates), consumed with the SAME battle-tested SSE
 * client the RIISHE view uses (consumeRiisheStream — watchdog, UTF-8-safe
 * decoding, honest failure classification, dead-wire reconciliation).
 *
 * Honesty rules rendered here:
 *  - execution status chips come ONLY from real wire events (stage/task/tool
 *    frames) — never a cosmetic progress spinner pretending work;
 *  - a failed turn shows the truthful failure text and keeps the question
 *    available for retry;
 *  - a partial turn is labeled partial;
 *  - the capability panel shows what the agent CAN do and CANNOT do from the
 *    server's capability registry — never a green "everything works" state
 *    just because the agent profile exists.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Pencil,
  Send,
  Square,
} from 'lucide-react'
import { Markdown, Spinner, beanFetch } from '@/components/bean/shared'
import { cn } from '@/lib/utils'
import {
  consumeRiisheStream,
  classifyHttpFailure,
  type RiisheStreamEvent,
} from '@/lib/riishe/sse-client'
import { persistedAnswerMatchesTurn, recoveryDelayForAttempt } from '@/lib/riishe/retry'
import { CAPABILITY_INFO, isAutobotCapability, type AutobotCapabilityInfo } from '@/lib/autobots/catalog'
import type { AutobotAgentView, AutobotConversationView } from './index'

// ---------------------------------------------------------------------------
// Workspace message shape
// ---------------------------------------------------------------------------

interface WorkspaceMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  partial?: boolean
  latencyMs?: number
}

/** Honest status chip text per wire event (server-derived only). */
function statusTextFor(evt: RiisheStreamEvent): string | null {
  if (evt.stage) {
    const map: Record<string, string> = {
      researching: 'Researching live sources…',
      tools: 'Using tools…',
      solving: 'Thinking…',
      verifying: 'Verifying the answer…',
      executing: 'Executing…',
      revising: 'Revising…',
    }
    return map[evt.stage] ?? null
  }
  if (evt.task) {
    const map: Record<string, string> = {
      planning: 'Planning…',
      researching: 'Researching…',
      'reading-documents': 'Reading documents…',
      delegating: 'Delegating to a specialist…',
      'approval-waiting': 'Waiting for your approval (Trust Engine)…',
      executing: 'Executing…',
      verifying: 'Verifying…',
      completed: 'Completed',
      'completed-with-limitations': 'Completed with limitations',
      failed: 'Failed',
      cancelled: 'Cancelled',
    }
    return map[evt.task.stage] ?? evt.task.stage
  }
  if (evt.tool) {
    if (evt.tool.status === 'started') return `Running ${evt.tool.name}…`
    if (evt.tool.status === 'failed') return `${evt.tool.name} failed`
    return null
  }
  return null
}

// ---------------------------------------------------------------------------
// Workspace chat hook — one agent, its current conversation
// ---------------------------------------------------------------------------

interface DeadWireRecovery {
  /** Adopt a server-persisted answer after a transport failure (bounded
   *  schedule, head-match guard — the RIISHE chat contract, reused). */
  conversationId: string
  question: string
  partial: string
  attempt: number
  asstId: string
  seq: number
}

export function useAutobotChat(agent: AutobotAgentView) {
  const [messages, setMessages] = useState<WorkspaceMsg[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const sendingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const streamedRef = useRef('')
  const recoverySeqRef = useRef(0)
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadHistory = useCallback(async (convId?: string) => {
    try {
      const d = await beanFetch<{ conversationId: string; messages: Array<{ id: string; role: string; content: string; latencyMs?: number | null; metadata?: unknown }> }>(
        `/api/autobots/agents/${agent.id}/history${convId ? `?conversationId=${convId}` : ''}`,
        { timeoutMs: 20_000 },
      )
      setConversationId(d.conversationId)
      setMessages(
        d.messages.map((m) => ({
          id: m.id,
          role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.content,
          latencyMs: m.latencyMs ?? undefined,
        })),
      )
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the workspace history.')
    }
  }, [agent.id])

  useEffect(() => {
    setMessages([])
    setConversationId(null)
    setError(null)
    setStatus(null)
    void loadHistory()
    return () => {
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current)
    }
  }, [loadHistory])

  const finalizeAssistant = useCallback((asstId: string, patch: Partial<WorkspaceMsg>) => {
    setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, ...patch, pending: false } : m)))
  }, [])

  /** Bounded dead-wire reconciliation (same contract as RIISHE chat): after
   *  a non-abort transport failure, the server may still have completed and
   *  persisted the turn; fetch the history and adopt the answer when the
   *  newest pair clearly matches THIS turn. */
  const scheduleRecovery = useCallback((r: DeadWireRecovery) => {
    const delay = recoveryDelayForAttempt(r.attempt)
    if (delay === undefined || r.seq !== recoverySeqRef.current) return
    recoveryTimerRef.current = setTimeout(() => {
      if (r.seq !== recoverySeqRef.current) return
      void (async () => {
        try {
          const d = await beanFetch<{ messages: Array<{ id: string; role: string; content: string }> }>(
            `/api/autobots/agents/${agent.id}/history?conversationId=${r.conversationId}`,
            { timeoutMs: 20_000 },
          )
          if (r.seq !== recoverySeqRef.current) return
          const rows = d.messages
          const last = rows[rows.length - 1]
          const prevRow = rows[rows.length - 2]
          const normalized = (s: string): string => s.replace(/\s+/g, ' ').trim()
          const isThisTurn =
            last &&
            last.role === 'assistant' &&
            typeof last.content === 'string' &&
            last.content.trim().length > 0 &&
            !last.content.startsWith('This turn failed') &&
            prevRow?.role === 'user' &&
            normalized(prevRow.content) === normalized(r.question)
          if (isThisTurn && persistedAnswerMatchesTurn(last.content, r.partial)) {
            setConversationId(r.conversationId)
            finalizeAssistant(r.asstId, { content: last.content, partial: false })
          } else {
            scheduleRecovery({ ...r, attempt: r.attempt + 1 })
          }
        } catch {
          scheduleRecovery({ ...r, attempt: r.attempt + 1 })
        }
      })()
    }, delay)
  }, [agent.id, finalizeAssistant])

  const send = useCallback(async (override?: string) => {
    const message = (override ?? input).trim()
    if (!message || sendingRef.current) return
    if (agent.status === 'archived') {
      setError('This agent is archived — activate it before starting new work.')
      return
    }
    sendingRef.current = true
    if (override === undefined) setInput('')
    setError(null)
    setStreaming(true)
    setStatus(null)
    streamedRef.current = ''

    const asstId = `a-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: message },
      { id: asstId, role: 'assistant', content: '', pending: true },
    ])

    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++recoverySeqRef.current

    let convId: string | null = conversationId
    let serverDone = false
    try {
      const res = await fetch(`/api/autobots/agents/${agent.id}/run?stream=1${convId ? `&conversationId=${convId}` : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, conversationId: convId ?? undefined }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        if (res.status === 401) window.dispatchEvent(new Event('bean:unauthorized'))
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        const failure = classifyHttpFailure(res.status, data?.error?.message)
        throw Object.assign(new Error(failure.message), { beanFailure: failure })
      }

      await consumeRiisheStream(
        res,
        {
          onEvent: (evt) => {
            if (evt.conversationId && !convId) {
              convId = evt.conversationId
              setConversationId(evt.conversationId)
            }
            const statusText = statusTextFor(evt)
            if (statusText !== null) setStatus(statusText)
            if (evt.delta) {
              streamedRef.current += evt.delta
              setMessages((prev) =>
                prev.map((m) => (m.id === asstId ? { ...m, content: streamedRef.current } : m)),
              )
            } else if (evt.reset) {
              streamedRef.current = ''
              setMessages((prev) =>
                prev.map((m) => (m.id === asstId ? { ...m, content: '' } : m)),
              )
            }
          },
          onComplete: (evt) => {
            serverDone = true
            setStatus(null)
            const meta = evt.meta as { durationMs?: number } | undefined
            finalizeAssistant(asstId, {
              content: streamedRef.current,
              partial: evt.partial === true,
              latencyMs: evt.durationMs ?? meta?.durationMs,
            })
            if (evt.partial === true && !streamedRef.current.trim()) {
              setError('The agent stopped before producing an answer — nothing was fabricated. Try again.')
            }
          },
          onFailure: (f) => {
            // Dead-wire reconciliation: only for non-abort failures with a
            // known conversation (the read-only history fetch is safe).
            if (f.kind !== 'aborted' && convId) {
              scheduleRecovery({
                conversationId: convId,
                question: message,
                partial: streamedRef.current,
                attempt: 0,
                asstId,
                seq,
              })
            }
            if (!serverDone) {
              finalizeAssistant(asstId, { content: streamedRef.current, partial: streamedRef.current.trim().length > 0 })
              setError(f.message)
            }
          },
        },
        { signal: controller.signal },
      )
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        finalizeAssistant(asstId, { content: streamedRef.current, partial: streamedRef.current.trim().length > 0 })
        setError('Generation stopped.')
      } else {
        finalizeAssistant(asstId, { content: '', pending: false })
        setError(e instanceof Error ? e.message : 'The agent turn failed.')
      }
    } finally {
      sendingRef.current = false
      setStreaming(false)
      setStatus(null)
      abortRef.current = null
      // Refresh the true persisted state: the reload keeps the UI and the
      // database honest even when a stream died mid-flight.
      if (convId) void loadHistory(convId).catch(() => undefined)
    }
  }, [agent.id, agent.status, conversationId, finalizeAssistant, input, loadHistory, scheduleRecovery])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return {
    messages,
    conversationId,
    streaming,
    status,
    error,
    input,
    setInput: (v: string) => { setInput(v) },
    send,
    stop,
    setError,
  }
}

// ---------------------------------------------------------------------------
// Capability panel — what this agent can / cannot actually do
// ---------------------------------------------------------------------------

function CapabilityPanel({ capabilityKey }: { capabilityKey: string }) {
  const info: AutobotCapabilityInfo | null = isAutobotCapability(capabilityKey) ? CAPABILITY_INFO[capabilityKey] : null
  if (!info) {
    return (
      <div className="rounded-lg border border-[rgba(212,175,55,0.12)] bg-white/[0.03] p-3 text-[12px] text-white/55">
        Capability status unknown — the server will refuse unsupported operations honestly.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-[rgba(212,175,55,0.12)] bg-white/[0.03] p-3">
        <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-white/40">Can do</div>
        <div className="text-[12.5px] leading-relaxed text-white/75">{info.summary}</div>
        <div className="mt-2 text-[11.5px] text-white/45">Runs on: {info.underlying}</div>
        {info.delegation && <div className="mt-1 text-[11.5px] text-white/45">Delegates: {info.delegation}</div>}
      </div>
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-white/40">
          <CircleAlert className="h-3 w-3" /> Limits
        </div>
        <div className="text-[12.5px] leading-relaxed text-white/60">{info.limits}</div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Agent details view
// ---------------------------------------------------------------------------

export function AgentDetails({
  agent,
  conversations,
  onBack,
  onOpenWorkspace,
  onEdit,
}: {
  agent: AutobotAgentView
  conversations: AutobotConversationView[]
  onBack: () => void
  onOpenWorkspace: () => void
  onEdit: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] text-white/45 transition-colors hover:text-white/80">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to my agents
      </button>
      <div className="rounded-xl border border-[rgba(212,175,55,0.14)] bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[rgba(212,175,55,0.12)] text-[#f0c75e]">
              <Bot className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white/92">{agent.name}</h1>
              <div className="text-[12.5px] text-white/45">{agent.role}{agent.industry ? ` · ${agent.industry}` : ''}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px] text-white/65 transition-colors hover:bg-white/5 hover:text-white/90"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
            <button
              onClick={onOpenWorkspace}
              disabled={agent.status === 'archived'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[rgba(212,175,55,0.16)] px-3 py-1.5 text-[12.5px] font-medium text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.24)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open workspace
            </button>
          </div>
        </div>
        <p className="mt-4 text-[13.5px] leading-relaxed text-white/75">{agent.description}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-[12px] text-white/50 sm:grid-cols-4">
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-white/35">Capability</div>
            <div className="mt-0.5 text-white/75">{agent.capabilityLabel}</div>
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-white/35">Status</div>
            <div className="mt-0.5 text-white/75">{agent.status === 'active' ? 'Active' : 'Archived'}</div>
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-white/35">Completed turns</div>
            <div className="mt-0.5 text-white/75">{agent.executionCount}</div>
          </div>
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-white/35">Memory</div>
            <div className="mt-0.5 text-white/75">{agent.memoryMode === 'conversation' ? 'Workspace history' : 'None'}</div>
          </div>
        </div>
        {agent.personality && (
          <div className="mt-4">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-white/40">Communication style</div>
            <div className="text-[12.5px] leading-relaxed text-white/70">{agent.personality}</div>
          </div>
        )}
        {agent.instructions && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-white/40">Working preferences (user-configured)</div>
            <div className="text-[12.5px] leading-relaxed text-white/70">{agent.instructions}</div>
          </div>
        )}
        {agent.language && (
          <div className="mt-3 text-[12px] text-white/50">Language preference: {agent.language}</div>
        )}
        <div className="mt-4">
          <CapabilityPanel capabilityKey={agent.capabilityKey} />
        </div>
        {/* Honest execution history: the real workspace transcripts. */}
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-white/40">Execution history</div>
          {conversations.length === 0 ? (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-[12px] text-white/45">
              No conversations yet — the workspace records every real turn here.
            </div>
          ) : (
            <div className="space-y-1.5">
              {conversations.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[12px]">
                  <span className="text-white/60">Workspace conversation</span>
                  <span className="text-white/35">
                    {c.messageCount} message{c.messageCount === 1 ? '' : 's'} · updated {new Date(c.updatedAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Agent workspace (conversation)
// ---------------------------------------------------------------------------

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[rgba(212,175,55,0.14)] px-4 py-2.5 text-[14px] leading-relaxed text-white/90 sm:max-w-[75%]">
        <div className="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  )
}

function AssistantBubble({ content, pending, partial, latencyMs }: { content: string; pending?: boolean; partial?: boolean; latencyMs?: number }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(content).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1600)
      }).catch(() => undefined)
    }
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] sm:max-w-[85%]">
        <div className="rounded-2xl rounded-bl-md border border-[rgba(212,175,55,0.12)] bg-white/[0.04] px-4 py-3">
          {pending && !content ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <>
              <Markdown content={content} />
              {partial && (
                <div className="mt-2 inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[10.5px] text-white/45">
                  <CircleAlert className="h-3 w-3" /> Partial answer — the turn did not complete
                </div>
              )}
              {latencyMs !== undefined && !partial && (
                <div className="mt-1.5 text-[10.5px] text-white/30">{(latencyMs / 1000).toFixed(1)}s</div>
              )}
            </>
          )}
        </div>
        {content && !pending && (
          <button
            onClick={copy}
            className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-white/35 transition-colors hover:bg-white/5 hover:text-white/70"
            aria-label="Copy answer"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  )
}

export function AgentWorkspace({
  agent,
  onBack,
  onOpenDetails,
  onAgentUpdated,
}: {
  agent: AutobotAgentView
  onBack: () => void
  onOpenDetails: () => void
  onAgentUpdated: () => void
}) {
  const chat = useAutobotChat(agent)
  const [showCaps, setShowCaps] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [chat.messages.length, chat.status])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!chat.streaming) void chat.send()
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] w-full max-w-4xl flex-col px-4 sm:px-6 lg:h-screen">
      {/* Header: identity + honest capability toggle */}
      <div className="flex items-center justify-between gap-2 border-b border-[rgba(212,175,55,0.12)] py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button onClick={onBack} className="text-white/45 transition-colors hover:text-white/85" aria-label="Back to my agents">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[rgba(212,175,55,0.12)] text-[#f0c75e]">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium text-white/88">{agent.name}</div>
            <div className="truncate text-[11px] text-white/40">{agent.role} · {agent.capabilityLabel}</div>
          </div>
        </div>
        <button
          onClick={() => setShowCaps((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] text-white/60 transition-colors hover:bg-white/5 hover:text-white/90"
          aria-expanded={showCaps}
        >
          Capabilities <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showCaps && 'rotate-180')} />
        </button>
      </div>

      {/* Honest capability panel (collapsible) */}
      {showCaps && (
        <div className="border-b border-[rgba(212,175,55,0.12)] py-3">
          <CapabilityPanel capabilityKey={agent.capabilityKey} />
          <button onClick={onOpenDetails} className="mt-2 text-[12px] text-[#f0c75e]/80 transition-colors hover:text-[#f0c75e]">
            View full agent details →
          </button>
        </div>
      )}

      {/* Thread */}
      <div className="bean-scroll min-h-0 flex-1 overflow-y-auto">
        {chat.messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(212,175,55,0.12)] text-[#f0c75e]">
              <Bot className="h-8 w-8" />
            </div>
            <div className="text-[15px] font-medium text-white/85">
              Start working with <span className="bean-gold-text">{agent.name}</span>
            </div>
            <div className="mt-1.5 max-w-md text-[12.5px] leading-relaxed text-white/45">
              {agent.description}
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-4 px-0 py-5 sm:px-2">
            {chat.messages.map((m) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} content={m.content} />
              ) : (
                <AssistantBubble key={m.id} content={m.content} pending={m.pending} partial={m.partial} latencyMs={m.latencyMs} />
              ),
            )}
            {chat.status && (
              <div className="flex items-center gap-2 pl-1 text-[12px] text-white/45">
                <Spinner className="h-3.5 w-3.5" />
                {chat.status}
              </div>
            )}
            {chat.error && (
              <div className="mx-auto flex max-w-3xl items-start gap-2 rounded-lg border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[12.5px] text-red-200/90">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{chat.error}</span>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-[rgba(212,175,55,0.12)] py-3">
        <div className="rounded-xl border border-[rgba(212,175,55,0.16)] bg-white/[0.04] p-2 focus-within:border-[rgba(212,175,55,0.32)]">
          <div className="flex items-end gap-2">
            <textarea
              ref={taRef}
              value={chat.input}
              onChange={(e) => chat.setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={Math.min(5, Math.max(1, chat.input.split('\n').length))}
              placeholder={`Message ${agent.name}…`}
              disabled={chat.streaming}
              className="max-h-32 min-h-[38px] w-full resize-none bg-transparent px-2 py-1.5 text-[14px] text-white/88 outline-none placeholder:text-white/30 disabled:opacity-60"
            />
            {chat.streaming ? (
              <button
                onClick={chat.stop}
                className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/12 text-white/70 transition-colors hover:bg-white/5"
                aria-label="Stop generating"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={() => void chat.send()}
                disabled={!chat.input.trim()}
                className="mb-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(212,175,55,0.16)] text-[#f0c75e] shadow-[inset_0_0_0_1px_rgba(212,175,55,0.28)] transition-colors hover:bg-[rgba(212,175,55,0.26)] disabled:opacity-40"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-1.5 px-1 text-[10.5px] text-white/30">
          Agent instructions shape tone only — tool access stays server-authorized. Approval-required actions go through the Trust Engine.
        </div>
      </div>
    </div>
  )
}
