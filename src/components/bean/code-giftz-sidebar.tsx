'use client'

/**
 * CODE GIFTZ conversation sidebar — ChatGPT-style history rail for coding
 * projects, sharing RIISHE's established sidebar UX (search, date-grouped
 * history, rename, delete-with-confirmation, desktop collapse, mobile
 * Sheet drawer) and the SAME pure view helpers
 * (src/lib/riishe/conversation-view.ts) so both products behave identically.
 *
 * Persistence model: a coding conversation is a CodeProject (stable ID,
 * owner-scoped, messages + files cascade with it). This component is purely
 * presentational — every action delegates to the parent's callbacks.
 *
 * The same body is embedded twice: inline on desktop (lg+, collapsible) and
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Spinner, timeAgo } from './shared'
import { cn } from '@/lib/utils'
import { conversationSidebarSections } from '@/lib/riishe/conversation-view'
import { Code2, MessageSquareCode, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react'

export interface ProjectSummary {
  id: string
  title: string
  messages: number
  files: number
  updatedAt: string
}

export interface SidebarActionResult {
  ok: boolean
  error?: string
}

function PanelLeftCloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </svg>
  )
}

function PanelLeftOpenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
      <path d="m8 9 3 3-3 3" />
    </svg>
  )
}

function ProjectRow({
  project,
  active,
  onOpen,
  onRename,
  onDelete,
  closeAfterAction,
}: {
  project: ProjectSummary
  active: boolean
  onOpen: (id: string) => void
  onRename: (p: ProjectSummary) => void
  onDelete: (p: ProjectSummary) => void
  closeAfterAction?: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      onClick={() => {
        onOpen(project.id)
        // Mobile: selecting a conversation IS the way out of the drawer
        // (no-op on desktop, where closeAfterAction is undefined).
        closeAfterAction?.()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(project.id)
          closeAfterAction?.()
        }
      }}
      className={cn(
        'group flex w-full cursor-pointer items-center rounded-lg px-2.5 py-2 text-[13px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-[rgba(212,175,55,0.5)]',
        active ? 'bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'text-white/60 hover:bg-white/5 hover:text-white/90',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate" title={project.title}>
          {project.title}
        </span>
        <span className="block text-[10px] text-white/30">
          {project.messages} message{project.messages === 1 ? '' : 's'} · {project.files} file{project.files === 1 ? '' : 's'} · {timeAgo(project.updatedAt)}
        </span>
      </span>

      {/*
        Direct delete (desktop lg+): a trash icon that fades in on row hover
        or keyboard focus and opens the same confirmation dialog as the menu
        item. It stopPropagation()s every event so the row NEVER opens the
        conversation as a side effect. Hidden below lg — touch has no hover,
        so there the always-visible options menu is the delete path.
      */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="ml-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/35 transition-opacity hover:bg-white/10 hover:text-red-300 focus-visible:text-red-300 lg:flex lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
            aria-label={`Delete conversation: ${project.title}`}
            onClick={(e) => {
              e.stopPropagation()
              onDelete(project)
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
        Options menu (rename / delete): always visible below lg (touch has no
        hover), fading in with row hover on lg+. stopPropagation keeps the
        row's open action from firing.
      */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="ml-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white/35 opacity-100 transition-opacity hover:bg-white/10 hover:text-white/85 focus:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
            aria-label={`Actions for ${project.title}`}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40 border-[rgba(212,175,55,0.2)] bg-[#141416]">
          <DropdownMenuItem
            className="gap-2 text-white/70 focus:bg-white/10 focus:text-white"
            onClick={(e) => e.stopPropagation()}
            onSelect={() => onRename(project)}
          >
            <Pencil className="h-3.5 w-3.5" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 text-red-300/90 focus:bg-red-500/10 focus:text-red-300"
            onClick={(e) => e.stopPropagation()}
            onSelect={() => onDelete(project)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function GiftzSidebarBody({
  projects,
  activeId,
  searching,
  searchQuery,
  onSearchChange,
  onOpen,
  onNew,
  onRename,
  onDelete,
  onCollapse,
  closeAfterAction,
}: {
  projects: ProjectSummary[]
  activeId: string | null
  searching: boolean
  searchQuery: string
  onSearchChange: (q: string) => void
  onOpen: (id: string) => void
  onNew: () => void
  onRename: (id: string, title: string) => Promise<SidebarActionResult>
  onDelete: (id: string) => Promise<SidebarActionResult>
  /** Desktop only — collapse the inline rail. */
  onCollapse?: () => void
  /** Mobile only — close the Sheet drawer AFTER a successful action. */
  closeAfterAction?: () => void
}) {
  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Rename/delete dialogs render INSIDE this body (which is mounted under
  // SheetContent on mobile) — closing the Sheet early would unmount the
  // dialog before it shows. The drawer closes only AFTER a successful action.
  function askRename(p: ProjectSummary) {
    setRenameError(null)
    setRenameTarget(p)
    setRenameValue(p.title)
  }

  function askDelete(p: ProjectSummary) {
    setDeleteError(null)
    setDeleteTarget(p)
  }

  async function submitRename() {
    if (!renameTarget || renameSaving) return
    const target = renameTarget
    const title = renameValue
    setRenameSaving(true)
    setRenameError(null)
    try {
      const result = await onRename(target.id, title)
      if (result.ok) {
        setRenameTarget(null)
        closeAfterAction?.()
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
      const result = await onDelete(target.id)
      if (result.ok) {
        setDeleteTarget(null)
        closeAfterAction?.()
      } else {
        // Honest failure: the dialog STAYS OPEN and names what went wrong.
        setDeleteError(result.error ?? 'Delete failed. Please try again.')
      }
    } finally {
      setDeleting(false)
    }
  }

  const sections = conversationSidebarSections(projects)
  // Keyed on the QUERY (not the in-flight flag): after the fetch settles the
  // empty state must keep explaining WHY the list is empty while searching.
  const noResults = searchQuery.trim().length > 0 && projects.length === 0

  return (
    <div className="flex h-full flex-col">
      {/* CODE GIFTZ branding + desktop collapse toggle */}
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
        <Code2 className="h-5 w-5 text-[#d4af37]" />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-[0.14em] bean-gold-text">CODE GIFTZ</div>
          <div className="text-[9px] tracking-[0.22em] text-white/35">CONVERSATIONS</div>
        </div>
        {onCollapse ? (
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

      {/* New conversation + search */}
      <div className="space-y-2 px-3 pb-2 pt-2">
        <Button
          onClick={() => {
            onNew()
            closeAfterAction?.()
          }}
          className="h-9 w-full justify-start gap-2 border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.1)] text-[13px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.2)]"
          variant="outline"
        >
          <Plus className="h-4 w-4" /> New conversation
        </Button>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search conversations"
            className="h-9 border-white/10 bg-black/30 pl-8 text-[13px] text-white/80 placeholder:text-white/30"
            aria-label="Search conversations"
          />
          {searchQuery.length > 0 ? (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/80"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        {projects.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-white/30">
            {noResults ? <>No conversations match “{searchQuery.trim()}”.</> : 'No conversations yet'}
          </p>
        ) : (
          sections.map((section) => (
            <div key={section.label} className="mb-1">
              <div className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-white/30">{section.label}</div>
              {section.items.map((p) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  active={activeId === p.id}
                  onOpen={onOpen}
                  onRename={askRename}
                  onDelete={askDelete}
                  closeAfterAction={closeAfterAction}
                />
              ))}
            </div>
          ))
        )}
      </ScrollArea>

      {/* Rename dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
      >
        <DialogContent className="border-[rgba(212,175,55,0.25)] bg-[#141416] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white/90">Rename conversation</DialogTitle>
            <DialogDescription>Choose a name you will recognize in search.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && renameValue.trim().length > 0 && !renameSaving) void submitRename()
            }}
            className="border-white/15 bg-black/30 text-white/85"
            aria-label="Conversation title"
            autoFocus
          />
          {renameError ? <p className="text-xs text-red-300">{renameError}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} className="border-white/15 bg-transparent text-white/70 hover:bg-white/5 hover:text-white">
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

      {/* Delete confirmation — deletion is destructive and cascades to every
          message and workspace file in the conversation, so it never happens
          from a single click. */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent className="border-[rgba(212,175,55,0.25)] bg-[#141416]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white/90">Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.title}” and all of its messages and workspace files will be permanently removed. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? <p className="text-xs text-red-300">{deleteError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/15 bg-transparent text-white/70 hover:bg-white/5 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {deleting ? <Spinner className="h-3.5 w-3.5" /> : null} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Desktop collapsed rail — icon strip with expand + new-conversation. */
export function GiftzSidebarCollapsedRail({ onExpand, onNew }: { onExpand: () => void; onNew: () => void }) {
  return (
    <aside className="hidden flex-col items-center gap-2 border-r border-[rgba(212,175,55,0.1)] py-3 lg:flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onExpand}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="flex h-8 w-8 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/5 hover:text-white/85"
          >
            <PanelLeftOpenIcon />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="border border-[rgba(212,175,55,0.25)] bg-[#1c1c1f] text-white/85">
          Expand sidebar
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onNew}
            aria-label="New conversation"
            title="New conversation"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.1)] text-[#f0c75e] transition-colors hover:bg-[rgba(212,175,55,0.2)]"
          >
            <Plus className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="border border-[rgba(212,175,55,0.25)] bg-[#1c1c1f] text-white/85">
          New conversation
        </TooltipContent>
      </Tooltip>
    </aside>
  )
}

/** Mobile trigger — the header chip that opens the Sheet drawer (<lg). */
export function GiftzSidebarMobileTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-[rgba(212,175,55,0.25)] px-2 py-1 text-[11px] text-[#f0c75e] transition-colors hover:bg-[rgba(212,175,55,0.1)] lg:hidden"
      aria-label="Open conversations"
    >
      <MessageSquareCode className="h-3.5 w-3.5" /> Conversations
    </button>
  )
}

/** Mobile sidebar — the same body inside a Sheet drawer (<lg). */
export function GiftzSidebarMobile({
  open,
  onOpenChange,
  ...bodyProps
}: Omit<Parameters<typeof GiftzSidebarBody>[0], 'onCollapse' | 'closeAfterAction'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-80 border-r border-[rgba(212,175,55,0.15)] bg-[#0c0c0f] p-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>CODE GIFTZ conversations</SheetTitle>
          <SheetDescription>Search, open, rename or delete your coding conversations.</SheetDescription>
        </SheetHeader>
        <GiftzSidebarBody {...bodyProps} closeAfterAction={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  )
}
