'use client'

/**
 * RIISHE conversation sidebar — ChatGPT-style history rail in BEAN's
 * black-and-gold identity.
 *
 * Layout inspiration (4chat / assistant-ui thread UX): brand header, New
 * Chat, search, date-grouped history with per-conversation actions, and a
 * user entry pinned to the bottom. Rendering is presentational only — every
 * action delegates to the chat runtime (use-riishe-chat.ts) or the shell
 * navigation. The same body is embedded twice: inline on desktop (lg+) and
 * inside a Sheet drawer on mobile — identical capabilities, honest a11y.
 */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RiisheIcon } from '@/components/riishe/RiisheIcon'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Spinner, type BeanUser } from '@/components/bean/shared'
import { cn } from '@/lib/utils'
import { conversationSidebarSections } from '@/lib/riishe/conversation-view'
import type { ConversationListItem } from '@/lib/riishe/conversation-view'
import { MoreHorizontal, Pencil, Search, Settings, SquarePen, Trash2, X } from 'lucide-react'
import type { RiisheChat } from './use-riishe-chat'

function PanelLeftCloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </svg>
  )
}

function ConversationRow({
  conv,
  active,
  chat,
  onRename,
  onDelete,
}: {
  conv: ConversationListItem
  active: boolean
  chat: RiisheChat
  onRename: (c: ConversationListItem) => void
  onDelete: (c: ConversationListItem) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      onClick={() => chat.openConversation(conv.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          chat.openConversation(conv.id)
        }
      }}
      className={cn(
        'group flex w-full cursor-pointer items-center rounded-lg px-2.5 py-2 text-[13px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[rgba(212,175,55,0.5)]',
        active ? 'bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'text-white/60 hover:bg-white/5 hover:text-white/90',
      )}
    >
      <span className="min-w-0 flex-1 truncate" title={conv.title}>
        {conv.title}
      </span>

      {/*
        Direct delete (desktop lg+): a trash icon that fades in on row hover
        or keyboard focus and opens the same confirmation dialog as the menu
        item. It stopPropagation()s every event so the row NEVER opens the
        conversation as a side effect. Hidden below lg — touch has no hover,
        so there the always-visible options menu below is the delete path.
      */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="ml-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/35 transition-opacity hover:bg-white/10 hover:text-red-300 focus-visible:text-red-300 lg:flex lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
            aria-label={`Delete conversation: ${conv.title}`}
            onClick={(e) => {
              e.stopPropagation()
              onDelete(conv)
            }}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="border border-[rgba(212,175,55,0.25)] bg-[#1c1c1f] text-white/85">
          Delete conversation
        </TooltipContent>
      </Tooltip>

      {/*
        Options menu (rename / delete). On <lg it stays visible without
        hover — the mobile-appropriate path to delete; on lg+ it fades in
        with the row hover alongside the trash shortcut. The stopPropagation
        on keydown fixes Enter/Space on the trigger bubbling to the row and
        opening the conversation.
      */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/35 opacity-100 transition-opacity hover:bg-white/10 hover:text-white/85 focus:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                aria-label={`Actions for ${conv.title}`}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" className="border border-[rgba(212,175,55,0.25)] bg-[#1c1c1f] text-white/85">
            Conversation options
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-40 border-[rgba(212,175,55,0.2)] bg-[#141416]">
          <DropdownMenuItem
            className="gap-2 text-white/70 focus:bg-white/10 focus:text-white"
            onClick={(e) => e.stopPropagation()}
            onSelect={() => onRename(conv)}
          >
            <Pencil className="h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 text-red-300/90 focus:bg-red-500/10 focus:text-red-300"
            onClick={(e) => e.stopPropagation()}
            onSelect={() => onDelete(conv)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function RiisheSidebarBody({
  chat,
  user,
  onOpenSettings,
  onCollapse,
  onClose,
}: {
  chat: RiisheChat
  user: BeanUser
  onOpenSettings: () => void
  /** Desktop only — collapse the inline rail. */
  onCollapse?: () => void
  /** Mobile only — close the Sheet drawer after an action. */
  onClose?: () => void
}) {
  const [renameTarget, setRenameTarget] = useState<ConversationListItem | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ConversationListItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // NOTE: askRename / askDelete intentionally do NOT close the mobile Sheet.
  // The confirm dialogs render inside this body, which is mounted under
  // SheetContent — closing the Sheet would unmount the dialog before it ever
  // shows (the original mobile delete bug). The drawer closes only AFTER a
  // successful action, below.
  function askRename(c: ConversationListItem) {
    setRenameError(null)
    setRenameTarget(c)
    setRenameValue(c.title)
  }

  function askDelete(c: ConversationListItem) {
    setDeleteError(null)
    setDeleteTarget(c)
  }

  async function submitRename() {
    if (!renameTarget || renameSaving) return
    const target = renameTarget
    const title = renameValue
    setRenameSaving(true)
    setRenameError(null)
    try {
      const result = await chat.renameConversation(target.id, title)
      if (result.ok) {
        setRenameTarget(null)
        onClose?.() // mobile: reveal the updated list only on real success
      } else {
        setRenameError(result.error ?? 'Rename failed. Please try again.')
      }
    } finally {
      setRenameSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return
    const target = deleteTarget
    setDeleting(true)
    setDeleteError(null)
    try {
      const result = await chat.deleteConversation(target.id)
      if (result.ok) {
        setDeleteTarget(null)
        onClose?.() // mobile: close the drawer only when deletion really happened
      } else {
        // Honest failure: the dialog STAYS OPEN and names what went wrong —
        // the conversation is still in the list, so closing here would lie.
        setDeleteError(result.error ?? 'Delete failed. Please try again.')
      }
    } finally {
      setDeleting(false)
    }
  }

  const searching = chat.searchQuery.trim().length > 0
  const sections = conversationSidebarSections(chat.conversations)

  return (
    <div className="flex h-full flex-col">
      {/* RIISHE branding */}
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
        <RiisheIcon className="h-7 w-7" />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-[0.18em] bean-gold-text">RIISHE</div>
          <div className="text-[9px] tracking-[0.22em] text-white/35">BEAN CONVERSATIONAL AI</div>
        </div>
        {/*
          EXACTLY ONE close control per open surface, by construction:
          - The Sheet's built-in close is removed from the tree at the source
            (RiisheSidebarMobile passes showClose={false} — conditional render
            in ui/sheet.tsx, never a CSS hide).
          - The desktop rail never passes onClose, so this X cannot co-exist
            with the collapse control (and the onClose/onCollapse ternary
            below makes the two mutually exclusive anyway).
          - No breakpoint class hides this button: an open drawer always has
            a visible close, even if the window is resized across lg while
            the drawer is open (the old lg:hidden left it with ZERO close
            controls in that case).
        */}
        {onClose ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="ml-auto text-white/45 hover:text-white/85"
                onClick={onClose}
                aria-label="Close conversations"
              >
                <X className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="border border-[rgba(212,175,55,0.25)] bg-[#1c1c1f] text-white/85">
              Close conversations
            </TooltipContent>
          </Tooltip>
        ) : onCollapse ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="ml-auto text-white/45 transition-colors hover:text-white/85"
                onClick={onCollapse}
                aria-label="Collapse sidebar"
              >
                <PanelLeftCloseIcon />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="border border-[rgba(212,175,55,0.25)] bg-[#1c1c1f] text-white/85">
              Collapse sidebar
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      {/* New chat + search */}
      <div className="space-y-2 px-3 pb-2 pt-2">
        <Button
          onClick={() => {
            chat.newConversation()
            onClose?.()
          }}
          className="h-9 w-full justify-start gap-2 border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.1)] text-[13px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.2)]"
          variant="outline"
        >
          <SquarePen className="h-4 w-4" /> New chat
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <Input
            value={chat.searchQuery}
            onChange={(e) => chat.setSearchQuery(e.target.value)}
            placeholder="Search conversations"
            className="h-9 border-white/10 bg-black/30 pl-8 pr-8 text-[13px] text-white/85 placeholder:text-white/30 focus-visible:ring-[rgba(212,175,55,0.4)]"
            aria-label="Search conversations"
          />
          {chat.searchQuery.length > 0 ? (
            <button
              onClick={() => chat.setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/80"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* History */}
      <ScrollArea className="min-h-0 flex-1 px-2 pb-2">
        {searching && chat.searching ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-white/40">
            <Spinner className="h-3.5 w-3.5" /> Searching…
          </div>
        ) : chat.conversations.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs leading-relaxed text-white/30">
            {searching ? (
              <>No conversations match “{chat.searchQuery.trim()}”.</>
            ) : (
              <>No conversations yet. Start one with New chat.</>
            )}
          </p>
        ) : searching ? (
          <div className="space-y-0.5 pt-1">
            {chat.conversations.map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                active={chat.activeId === c.id}
                chat={chat}
                onRename={askRename}
                onDelete={askDelete}
              />
            ))}
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.label} className="mb-3">
              <div className="px-2 pb-1 pt-2 text-[10px] font-medium tracking-[0.14em] text-white/30">
                {section.label.toUpperCase()}
              </div>
              <div className="space-y-0.5">
                {section.items.map((c) => (
                  <ConversationRow
                    key={c.id}
                    conv={c}
                    active={chat.activeId === c.id}
                    chat={chat}
                    onRename={askRename}
                    onDelete={askDelete}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </ScrollArea>

      {/* User entry → account settings */}
      <div className="border-t border-[rgba(212,175,55,0.12)] p-3">
        <button
          onClick={() => {
            onOpenSettings()
            onClose?.()
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/5"
          aria-label="Open account settings"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.12)] text-[13px] font-semibold text-[#f0c75e]">
            {(user.name ?? user.email).trim().charAt(0).toUpperCase() || '·'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-white/80">{user.name ?? user.email}</span>
            <span className="block text-[10px] text-white/35">
              {user.role === 'admin' ? 'Administrator' : 'Member'} · Settings
            </span>
          </span>
          <Settings className="h-3.5 w-3.5 shrink-0 text-white/35" />
        </button>
      </div>

      {/* Rename dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
      >
        <DialogContent className="max-w-sm border-[rgba(212,175,55,0.25)] bg-[#121214]">
          <DialogHeader>
            <DialogTitle className="text-white/90">Rename conversation</DialogTitle>
            <DialogDescription className="text-white/45">
              Choose a name you will recognize in search.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameValue.trim().length > 0 && !renameSaving) void submitRename()
            }}
            autoFocus
            maxLength={500}
            className="border-white/15 bg-black/30 text-white/90"
            aria-label="Conversation title"
          />
          {renameError ? <p className="text-xs text-red-300">{renameError}</p> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)} className="text-white/60 hover:text-white">
              Cancel
            </Button>
            <Button
              onClick={() => void submitRename()}
              disabled={renameValue.trim().length === 0 || renameSaving}
              className="bg-[#d4af37] text-black hover:bg-[#e6c25a]"
            >
              {renameSaving ? <Spinner className="h-3.5 w-3.5" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation — stays open on backend failure with the real
          error inline; a closed dialog always means the row is really gone. */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-sm border-[rgba(212,175,55,0.25)] bg-[#121214]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white/90">Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              “{deleteTarget?.title}” and all of its messages will be permanently removed. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? <p className="text-xs text-red-300">{deleteError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="border-white/15 bg-transparent text-white/70 hover:bg-white/5 hover:text-white"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-red-500/90 text-white hover:bg-red-500"
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
            >
              {deleting ? <Spinner className="h-3.5 w-3.5" /> : null} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Desktop sidebar — inline rail (lg+). Unmounted entirely when collapsed. */
export function RiisheSidebarDesktop({
  chat,
  user,
  onOpenSettings,
  onCollapse,
}: {
  chat: RiisheChat
  user: BeanUser
  onOpenSettings: () => void
  onCollapse: () => void
}) {
  return (
    <aside className="hidden w-[264px] shrink-0 border-r border-[rgba(212,175,55,0.12)] bg-[#0c0c0e]/60 lg:flex lg:flex-col">
      <RiisheSidebarBody chat={chat} user={user} onOpenSettings={onOpenSettings} onCollapse={onCollapse} />
    </aside>
  )
}

/** Mobile sidebar — the same body inside a Sheet drawer (<lg). */
export function RiisheSidebarMobile({
  chat,
  user,
  onOpenSettings,
  open,
  onOpenChange,
}: {
  chat: RiisheChat
  user: BeanUser
  onOpenSettings: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        showClose={false}
        className="w-[288px] border-[rgba(212,175,55,0.15)] bg-[#0c0c0e] p-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>RIISHE conversations</SheetTitle>
          <SheetDescription>Search, open, rename or delete your conversations</SheetDescription>
        </SheetHeader>
        <RiisheSidebarBody
          chat={chat}
          user={user}
          onOpenSettings={onOpenSettings}
          onClose={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
