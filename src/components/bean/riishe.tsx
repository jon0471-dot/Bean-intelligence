'use client'

/**
 * BEAN Intelligence — RIISHE workspace (conversational AI).
 *
 * ChatGPT-style experience upgrade (2026-11-01): a collapsible conversation
 * sidebar (RIISHE branding, new chat, search, date-grouped history, rename,
 * delete-with-confirmation, user settings entry), a ChatGPT-like thread
 * (user bubbles vs. full-width RIISHE responses with markdown, highlighted
 * code, copy/regenerate/sources actions) and a polished composer — all in
 * BEAN's existing black-and-gold identity. Mobile gets the same capabilities
 * through a Sheet drawer; the layout never overflows horizontally.
 *
 * Capability is automatic — there are NO Auto/Web/Off or sandbox toggles in
 * the composer. The server's freshness policy retrieves when a question
 * needs current information, and the server-side tool policy executes code
 * only when a task genuinely needs it. Real orchestration events drive the
 * status line: "Searching the web…" appears only when search actually runs.
 *
 * A NEW conversation displays the exact required greeting:
 * "Hello! I'm RIISHE, How can I help you today?" — display-only (never
 * persisted, never injected into the model's context; the model still
 * answers real greetings as normal conversation turns).
 *
 * Streaming, stop, regenerate (trailing + earlier turns), attachments and
 * honest error handling are carried over from the pre-upgrade runtime with
 * their wire protocol unchanged (see use-riishe-chat.ts).
 */
import { useRef, useState } from 'react'
import type { BeanUser } from '@/components/bean/shared'
import { RiisheSidebarDesktop, RiisheSidebarMobile } from './riishe/riishe-sidebar'
import { RiisheThread } from './riishe/riishe-messages'
import { RiisheComposer } from './riishe/riishe-composer'
import { useRiisheChat } from './riishe/use-riishe-chat'
import { MessageSquareText, PanelLeft } from 'lucide-react'

function PanelLeftOpenIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m14 15 3-3-3-3" />
    </svg>
  )
}

export function Riishe({ user, onOpenSettings }: { user: BeanUser; onOpenSettings: () => void }) {
  // DOM refs are owned here (the component that renders those nodes) and
  // handed to the runtime for its scroll behaviors — the runtime object
  // itself never carries refs (react-hooks/refs renders them unreadable).
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const chat = useRiisheChat({ scrollRef, endRef })
  // Desktop (lg+): the inline sidebar can be collapsed to give the thread
  // the full width; the header then offers the reopen control. Mobile (<lg):
  // the same sidebar body opens inside a Sheet drawer.
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div
      className="flex h-[calc(100vh-3.5rem-2rem)] min-h-[540px] lg:h-[calc(100vh-3.5rem-1.5rem)]"
      onDragOver={(e) => {
        e.preventDefault()
        chat.setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) chat.setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        chat.setDragOver(false)
        if (e.dataTransfer?.files?.length) void chat.uploadFiles(e.dataTransfer.files)
      }}
    >
      {/* Desktop conversation sidebar (lg+), collapsible */}
      {!collapsed ? <RiisheSidebarDesktop chat={chat} user={user} onOpenSettings={onOpenSettings} onCollapse={() => setCollapsed(true)} /> : null}

      {/* Mobile conversation drawer (<lg) */}
      <RiisheSidebarMobile
        chat={chat}
        user={user}
        onOpenSettings={onOpenSettings}
        open={mobileOpen}
        onOpenChange={setMobileOpen}
      />

      {/* Chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-[rgba(212,175,55,0.1)] px-3 py-2.5 sm:px-5">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/5 hover:text-white/85 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open conversations"
          >
            <PanelLeft className="h-4.5 w-4.5" />
          </button>
          {collapsed ? (
            <button
              className="hidden h-8 w-8 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/5 hover:text-white/85 lg:flex"
              onClick={() => setCollapsed(false)}
              aria-label="Open sidebar"
              title="Open sidebar"
            >
              <PanelLeftOpenIcon />
            </button>
          ) : null}
          <MessageSquareText className="h-4 w-4 shrink-0 text-[#d4af37]" />
          <div className="min-w-0 truncate text-sm font-semibold tracking-wide">
            {chat.activeTitle ?? 'RIISHE'}
          </div>
          <span className="ml-auto hidden shrink-0 text-xs text-white/35 sm:block">
            Conversational AI · live sources when needed
          </span>
        </div>

        <div ref={scrollRef} className="bean-scroll relative min-h-0 flex-1 overflow-y-auto">
          <RiisheThread chat={chat} endRef={endRef} />
        </div>

        {chat.error ? (
          <div className="mx-4 mb-2 sm:mx-6">
            <div className="mx-auto max-w-3xl rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {chat.error}
            </div>
          </div>
        ) : null}

        <RiisheComposer chat={chat} />
      </div>
    </div>
  )
}
