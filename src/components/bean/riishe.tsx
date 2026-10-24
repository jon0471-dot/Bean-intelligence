'use client'

/**
 * BEAN Intelligence — RIISHE workspace (conversational AI).
 * Streaming is real SSE from the BEAN API; partial streams are labeled.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Markdown, Spinner, timeAgo, beanFetch, EmptyState } from './shared'
import { cn } from '@/lib/utils'
import { Plus, Send, Trash2, MessageSquareText, AlertTriangle } from 'lucide-react'

interface Conv { id: string; title: string; messages: number; updatedAt: string }
interface Msg { id: string; role: 'user' | 'assistant'; content: string; partial?: boolean; pending?: boolean }

export function Riishe() {
  const [conversations, setConversations] = useState<Conv[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const streamedRef = useRef('')

  const loadConversations = useCallback(async () => {
    try {
      const d = await beanFetch<{ conversations: Conv[] }>('/api/riishe/chat')
      setConversations(d.conversations)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { void loadConversations() }, [loadConversations])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, streaming])

  async function openConversation(id: string) {
    setActiveId(id)
    setError(null)
    try {
      const d = await beanFetch<{ conversation: { messages: Array<{ id: string; role: string; content: string }> } }>(
        `/api/riishe/conversations/${id}`,
      )
      setMessages(d.conversation.messages.map((m) => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content })))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function deleteConversation(id: string) {
    try {
      await beanFetch(`/api/riishe/conversations/${id}`, { method: 'DELETE' })
      if (activeId === id) { setActiveId(null); setMessages([]) }
      void loadConversations()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function newConversation() {
    setActiveId(null)
    setMessages([])
    setError(null)
  }

  async function send() {
    const message = input.trim()
    if (!message || streaming) return
    setInput('')
    setError(null)
    setStreaming(true)
    streamedRef.current = ''

    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: message }
    const asstId = `a-${Date.now()}`
    setMessages((prev) => [...prev, userMsg, { id: asstId, role: 'assistant', content: '', pending: true }])

    try {
      const res = await fetch(`/api/riishe/chat?stream=1${activeId ? `&conversationId=${activeId}` : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, conversationId: activeId ?? undefined }),
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
          let evt: { delta?: string; done?: boolean; error?: string; conversationId?: string; partial?: boolean }
          try { evt = JSON.parse(line.slice(6)) } catch { continue }
          if (evt.conversationId) convId = evt.conversationId
          if (evt.error) { failed = true; setError(evt.error) }
          if (evt.delta) {
            streamedRef.current += evt.delta
            setMessages((prev) =>
              prev.map((m) => (m.id === asstId ? { ...m, content: streamedRef.current, pending: false } : m)),
            )
          }
          if (evt.done && convId && !activeId) setActiveId(convId)
        }
      }
      if (failed) {
        setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, partial: true, pending: false } : m)))
      }
      void loadConversations()
    } catch (e) {
      setError((e as Error).message)
      setMessages((prev) => prev.filter((m) => m.id !== asstId || m.content.length > 0))
    } finally {
      setStreaming(false)
      setMessages((prev) => prev.map((m) => ({ ...m, pending: false })))
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem-2rem)] min-h-[540px] lg:h-[calc(100vh-3.5rem-1.5rem)]">
      {/* Conversation rail */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[rgba(212,175,55,0.1)] md:flex">
        <div className="p-3">
          <Button onClick={newConversation} className="w-full justify-start bg-[rgba(212,175,55,0.12)] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.2)]" variant="outline">
            <Plus className="mr-1.5 h-4 w-4" /> New conversation
          </Button>
        </div>
        <ScrollArea className="flex-1 px-2 pb-3">
          {conversations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-white/30">No conversations yet</p>
          ) : (
            conversations.map((c) => (
              <div
                key={c.id}
                className={cn(
                  'group mb-0.5 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors',
                  activeId === c.id ? 'bg-[rgba(212,175,55,0.1)] text-[#f0c75e]' : 'text-white/60 hover:bg-white/5',
                )}
                onClick={() => openConversation(c.id)}
              >
                <div className="min-w-0">
                  <div className="truncate">{c.title}</div>
                  <div className="text-[10px] text-white/30">{c.messages} msgs · {timeAgo(c.updatedAt)}</div>
                </div>
                <button
                  className="ml-2 hidden text-white/30 hover:text-red-400 group-hover:block"
                  onClick={(e) => { e.stopPropagation(); void deleteConversation(c.id) }}
                  aria-label={`Delete ${c.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </ScrollArea>
      </aside>

      {/* Chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-[rgba(212,175,55,0.1)] px-5 py-3">
          <MessageSquareText className="h-4 w-4 text-[#d4af37]" />
          <div className="text-sm font-semibold tracking-wide">RIISHE</div>
          <span className="text-xs text-white/35">Conversational AI · streaming</span>
        </div>

        <div className="bean-scroll flex-1 overflow-y-auto px-5 py-4">
          {messages.length === 0 ? (
            <EmptyState
              icon={<MessageSquareText className="h-10 w-10" />}
              title="Start a conversation"
              hint="Ask questions, request summaries, drafting, rewriting or multilingual help. RIISHE answers with its actual capabilities."
            />
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((m) => (
                <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-4 py-3',
                      m.role === 'user'
                        ? 'bg-[rgba(212,175,55,0.14)] text-white/90'
                        : 'bean-glass text-white/85',
                    )}
                  >
                    {m.role === 'user' ? (
                      <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{m.content}</p>
                    ) : m.content ? (
                      <>
                        <Markdown content={m.content} />
                        {m.pending ? <Spinner className="ml-1 mt-1" /> : null}
                        {m.partial ? (
                          <div className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
                            <AlertTriangle className="h-3 w-3" /> Incomplete — the stream ended early
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-xs text-white/40">
                        <Spinner /> RIISHE is thinking…
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {error ? (
          <div className="mx-5 mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
        ) : null}

        <div className="border-t border-[rgba(212,175,55,0.1)] p-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
              }}
              placeholder="Message RIISHE… (Enter to send, Shift+Enter for a new line)"
              rows={Math.min(4, Math.max(1, input.split('\n').length))}
              maxLength={12000}
              disabled={streaming}
              className="max-h-40 min-h-[46px] resize-none bg-black/30"
              aria-label="Message RIISHE"
            />
            <Button onClick={() => void send()} disabled={streaming || !input.trim()} className="h-[46px] bg-[#d4af37] px-4 text-black hover:bg-[#e6c25a]" aria-label="Send message">
              {streaming ? <Spinner className="border-black/30 border-t-black" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
