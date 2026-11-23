'use client'

/**
 * BEAN Intelligence — RIISHE memory manager (M33 Feature A + B).
 *
 * The user-control surface for what RIISHE keeps: view, create, edit,
 * delete (one / all), search, export, and the potential-conflict decision
 * point. Embedded as a section of the EXISTING Settings experience — no
 * competing navigation, BEAN's black-and-gold identity throughout.
 *
 * Honesty contracts carried from the server:
 *  - editing is guarded by optimistic concurrency: a stale screen gets the
 *    409 reconciliation view (current vs. your draft) — the user's draft is
 *    never silently applied and the stored text is never silently replaced;
 *  - potential conflicts are a DECISION the user makes (replace one named
 *    row / keep both / cancel) — nothing is ever replaced automatically;
 *  - memory contents are loaded through the owner-scoped memory API only
 *    and are never copied anywhere else.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
import { beanFetch, Spinner } from '@/components/bean/shared'
import { MEMORY_LIMITS } from '@/lib/riishe/memory'
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  Download,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'

interface MemoryItem {
  id: string
  content: string
  createdAt: string
  updatedAt: string
}

interface ConflictCandidate {
  id: string
  content: string
  confidence: 'likely' | 'ambiguous'
  updatedAt: string
}

type Feedback = { tone: 'ok' | 'err'; text: string }

const MAX_CHARS = MEMORY_LIMITS.maxChars

function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Parse the conflict-detail payload the API attaches to a 409. */
function parseConflictDetail(detail: unknown): { content: string; updatedAt: string } | null {
  if (typeof detail !== 'string' || detail.length === 0) return null
  try {
    const parsed = JSON.parse(detail) as { current?: { content?: string; updatedAt?: string } }
    if (parsed.current?.content && parsed.current?.updatedAt) {
      return { content: parsed.current.content, updatedAt: parsed.current.updatedAt }
    }
  } catch {
    /* detail is optional; absence is handled by the caller */
  }
  return null
}

export function RiisheMemoryManager() {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [degraded, setDegraded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<MemoryItem | null>(null)
  const [deletingAll, setDeletingAll] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Potential-conflict decision state: the pending content the user tried to
  // store plus the server's candidates. Cancel = clear without writing.
  const [conflict, setConflict] = useState<{ content: string; candidates: ConflictCandidate[] } | null>(null)
  const [conflictBusy, setConflictBusy] = useState(false)
  // Stale-edit reconciliation: current server state vs. the kept draft.
  const [staleEdit, setStaleEdit] = useState<{ current: string; updatedAt: string; keptDraft: string; id: string } | null>(null)
  const [staleCreate, setStaleCreate] = useState<{ current: string; keptDraft: string } | null>(null)
  const listRefreshRef = useRef<(() => void) | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await beanFetch<{ memories: MemoryItem[]; degraded?: string }>('/api/riishe/memory')
      setItems(d.memories ?? [])
      setDegraded(d.degraded ?? null)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])
  listRefreshRef.current = load
  useEffect(() => {
    void load()
  }, [load])

  const filtered = query.trim()
    ? items.filter((m) => m.content.toLowerCase().includes(query.trim().toLowerCase()))
    : items
  const atCap = items.length >= MEMORY_LIMITS.maxPerUser
  const nearCap = items.length >= MEMORY_LIMITS.maxPerUser - 5

  async function createMemory(content: string, decision?: { kind: 'keep-both' } | { kind: 'replace'; memoryId: string; expectedUpdatedAt: string }) {
    setCreating(true)
    setError(null)
    try {
      const d = await beanFetch<{ memory?: MemoryItem; requiresChoice?: boolean; candidates?: ConflictCandidate[] }>(
        '/api/riishe/memory',
        { method: 'POST', json: { content, ...(decision ? { decision } : {}) } },
      )
      if (d.requiresChoice && d.candidates) {
        // Decision point: nothing was stored — the user chooses next.
        setConflict({ content, candidates: d.candidates })
        setDraft(content)
        setFeedback(null)
        return
      }
      setConflict(null)
      setStaleCreate(null)
      setDraft('')
      setFeedback({ tone: 'ok', text: decision?.kind === 'replace' ? 'Memory replaced.' : 'Saved to memory.' })
      await load()
    } catch (e) {
      const err = e as Error & { detail?: unknown }
      const stale = parseConflictDetail(err.detail)
      if (stale) {
        // The row chosen for replacement changed under the user — keep the
        // draft, show the current text, let them re-decide. Nothing written.
        setStaleCreate({ current: stale.content, keptDraft: content })
        setConflict(null)
        setFeedback(null)
      } else {
        setFeedback({ tone: 'err', text: err.message })
      }
    } finally {
      setCreating(false)
    }
  }

  async function saveEdit() {
    if (!editingId) return
    setSavingEdit(true)
    setError(null)
    const target = items.find((m) => m.id === editingId)
    try {
      await beanFetch('/api/riishe/memory', {
        method: 'PATCH',
        json: {
          id: editingId,
          content: editDraft,
          expectedUpdatedAt: target?.updatedAt ?? new Date().toISOString(),
        },
      })
      setEditingId(null)
      setEditDraft('')
      setStaleEdit(null)
      setFeedback({ tone: 'ok', text: 'Memory updated.' })
      await load()
    } catch (e) {
      const err = e as Error & { detail?: unknown }
      const stale = parseConflictDetail(err.detail)
      if (stale && target) {
        // Stale screen: keep the user's draft visible, show the current
        // stored text for comparison — never silently overwrite either side.
        setStaleEdit({ current: stale.content, updatedAt: stale.updatedAt, keptDraft: editDraft, id: editingId })
        setEditingId(null)
        setFeedback(null)
      } else {
        setFeedback({ tone: 'err', text: err.message })
      }
    } finally {
      setSavingEdit(false)
    }
  }

  async function deleteOne(id: string) {
    setError(null)
    try {
      await beanFetch(`/api/riishe/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      setDeleteTarget(null)
      setFeedback({ tone: 'ok', text: 'Memory deleted.' })
      await load()
    } catch (e) {
      setDeleteTarget(null)
      setFeedback({ tone: 'err', text: (e as Error).message })
    }
  }

  async function deleteAll() {
    setError(null)
    try {
      const d = await beanFetch<{ deleted: number }>('/api/riishe/memory?all=1', { method: 'DELETE' })
      setDeletingAll(false)
      setFeedback({ tone: 'ok', text: `Deleted all ${d.deleted} memor${d.deleted === 1 ? 'y' : 'ies'}.` })
      await load()
    } catch (e) {
      setDeletingAll(false)
      setFeedback({ tone: 'err', text: (e as Error).message })
    }
  }

  async function exportMemories() {
    setExporting(true)
    setError(null)
    try {
      const res = await fetch('/api/riishe/memory?export=json')
      if (res.status === 401) window.dispatchEvent(new Event('bean:unauthorized'))
      if (!res.ok) throw new Error('Export failed.')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `bean-riishe-memory-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setFeedback({ tone: 'ok', text: 'Export downloaded.' })
    } catch (e) {
      setFeedback({ tone: 'err', text: (e as Error).message })
    } finally {
      setExporting(false)
    }
  }

  function startEdit(m: MemoryItem) {
    setEditingId(m.id)
    setEditDraft(m.content)
    setStaleEdit(null)
    setFeedback(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft('')
    setFeedback(null)
  }

  return (
    <section className="bean-glass mb-5 rounded-xl p-5" aria-label="RIISHE memory">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <BrainCircuit className="h-4 w-4 text-[#d4af37]" />
        <h2 className="text-sm font-semibold text-white/85">RIISHE memory</h2>
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] ${
            atCap
              ? 'border-red-500/40 bg-red-500/10 text-red-300'
              : nearCap
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                : 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] text-[#f0c75e]'
          }`}
          title={`RIISHE stores at most ${MEMORY_LIMITS.maxPerUser} memories per account`}
        >
          {items.length} / {MEMORY_LIMITS.maxPerUser}
        </span>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-white/45">
        Facts you explicitly asked RIISHE to remember. They are only yours, they are never collected silently, and nothing
        here is changed without your say-so.
      </p>

      {degraded ? (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {degraded}
        </div>
      ) : null}
      {error ? (
        <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>
      ) : null}
      {feedback ? (
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-xs ${
            feedback.tone === 'ok'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {/* Stale-replacement reconciliation (replace target moved) */}
      {staleCreate ? (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" /> That memory changed before it could be replaced — nothing was written.
          </div>
          <div className="mb-1 text-white/70">Current stored text: “{staleCreate.current}”</div>
          <div className="text-white/50">Your new text is kept below — review and save again.</div>
        </div>
      ) : null}

      {/* Stale-edit reconciliation */}
      {staleEdit ? (
        <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-200">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" /> This memory changed after you started editing — your edit was not applied.
          </div>
          <div className="mb-1 text-white/70">
            Current stored text ({formatStamp(staleEdit.updatedAt)}): “{staleEdit.current}”
          </div>
          <div className="mb-2 text-white/50">Your draft was kept: “{staleEdit.keptDraft}”</div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-[rgba(212,175,55,0.4)] px-2 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]"
              onClick={() => {
                setEditingId(staleEdit.id)
                setEditDraft(staleEdit.keptDraft)
                setStaleEdit(null)
              }}
            >
              Continue editing my draft
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-white/15 px-2 text-[11px] text-white/60 hover:bg-white/5"
              onClick={() => {
                void (async () => {
                  await load()
                  setStaleEdit(null)
                  setFeedback({ tone: 'ok', text: 'Reloaded the current memories.' })
                })()
              }}
            >
              Discard draft and reload
            </Button>
          </div>
        </div>
      ) : null}

      {/* Create */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
              placeholder="Add a memory explicitly, e.g. “My deployment window is Sunday 02:00 UTC”"
              rows={2}
              className="resize-none border-white/10 bg-black/30 pr-14 text-[13px] text-white/90 placeholder:text-white/30 focus-visible:ring-[rgba(212,175,55,0.4)]"
              aria-label="New memory"
            />
            <span className="absolute bottom-2 right-2.5 text-[10px] text-white/30">
              {draft.length}/{MAX_CHARS}
            </span>
          </div>
          <Button
            onClick={() => void createMemory(draft.trim())}
            disabled={creating || draft.trim().length < 3 || atCap}
            className="h-9 shrink-0 bg-[#d4af37] text-black hover:bg-[#e6c25a] disabled:opacity-40"
            aria-label="Save memory"
          >
            {creating ? <Spinner className="h-3.5 w-3.5" /> : <Plus className="h-4 w-4" />} Remember
          </Button>
        </div>
        {atCap ? (
          <p className="text-[11px] text-amber-300">
            Memory is full ({MEMORY_LIMITS.maxPerUser} items). Delete a few items to make room.
          </p>
        ) : null}
      </div>

      {/* Search + export + delete-all toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search memories"
            className="h-8 border-white/10 bg-black/30 pl-8 pr-8 text-[12.5px] text-white/85 placeholder:text-white/30 focus-visible:ring-[rgba(212,175,55,0.4)]"
            aria-label="Search memories"
          />
          {query ? (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/80"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <Button
          onClick={() => void exportMemories()}
          disabled={exporting}
          variant="outline"
          size="sm"
          className="h-8 border-[rgba(212,175,55,0.4)] text-[12px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.08)]"
        >
          {exporting ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />} Export JSON
        </Button>
        <Button
          onClick={() => setDeletingAll(true)}
          disabled={items.length === 0}
          variant="outline"
          size="sm"
          className="h-8 border-red-500/30 text-[12px] text-red-300 hover:bg-red-500/10 disabled:opacity-30"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete all
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-white/40">
          <Spinner className="h-4 w-4" /> Loading your memories…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center">
          {items.length === 0 ? (
            <p className="text-xs leading-relaxed text-white/40">
              Nothing in memory yet. In a RIISHE chat, say “remember that …” — or add one above. Everything you store shows
              up here where you can edit or remove it.
            </p>
          ) : (
            <p className="text-xs text-white/40">No memories match “{query.trim()}”.</p>
          )}
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((m) => {
            const edited = m.updatedAt !== m.createdAt
            return (
              <li key={m.id} className="rounded-lg border border-[rgba(212,175,55,0.14)] bg-black/20 px-3 py-2.5">
                {editingId === m.id ? (
                  <div className="space-y-2">
                    <Textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value.slice(0, MAX_CHARS))}
                      rows={3}
                      className="resize-none border-[rgba(212,175,55,0.3)] bg-black/40 text-[13px] text-white/90 focus-visible:ring-[rgba(212,175,55,0.4)]"
                      aria-label="Edit memory"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] text-white/30">
                        {editDraft.length}/{MAX_CHARS}
                      </span>
                      <Button
                        size="sm"
                        onClick={() => void saveEdit()}
                        disabled={savingEdit || editDraft.trim().length < 3}
                        className="h-7 bg-[#d4af37] px-2.5 text-[12px] text-black hover:bg-[#e6c25a] disabled:opacity-40"
                      >
                        {savingEdit ? <Spinner className="h-3 w-3" /> : <Check className="h-3.5 w-3.5" />} Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={cancelEdit}
                        className="h-7 border-white/15 px-2.5 text-[12px] text-white/60 hover:bg-white/5"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-white/85">{m.content}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[10px] text-white/30">Created {formatStamp(m.createdAt)}</span>
                      {edited ? <span className="text-[10px] text-amber-300/70">Updated {formatStamp(m.updatedAt)}</span> : null}
                      <span className="ml-auto flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(m)}
                          className="h-7 gap-1 px-2 text-[11px] text-white/45 hover:bg-white/5 hover:text-white/85"
                          aria-label="Edit memory"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleteTarget(m)}
                          className="h-7 gap-1 px-2 text-[11px] text-white/45 hover:bg-red-500/10 hover:text-red-300"
                          aria-label="Delete memory"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </Button>
                      </span>
                    </div>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Potential-conflict decision dialog (Feature B) */}
      <AlertDialog
        open={conflict !== null}
        onOpenChange={(open) => {
          if (!open && !conflictBusy) setConflict(null)
        }}
      >
        <AlertDialogContent className="max-w-md border-[rgba(212,175,55,0.25)] bg-[#121214]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-white/90">
              <AlertTriangle className="h-4 w-4 text-amber-300" /> Possible conflicting memory
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/55">
              “{conflict?.content}” overlaps with what RIISHE already keeps. Nothing was stored yet — choose how to proceed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-52 space-y-2 overflow-y-auto pr-1">
            {(conflict?.candidates ?? []).map((c) => (
              <li key={c.id} className="rounded-lg border border-[rgba(212,175,55,0.18)] bg-black/30 px-3 py-2">
                <p className="break-words text-[12.5px] leading-relaxed text-white/80">{c.content}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
                      c.confidence === 'likely'
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        : 'border-white/15 bg-white/5 text-white/45'
                    }`}
                  >
                    {c.confidence === 'likely' ? 'likely conflict' : 'possible overlap'}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={conflictBusy}
                    className="ml-auto h-7 border-red-500/40 px-2 text-[11px] text-red-300 hover:bg-red-500/10"
                    onClick={() => {
                      if (!conflict) return
                      setConflictBusy(true)
                      void createMemory(conflict.content, {
                        kind: 'replace',
                        memoryId: c.id,
                        expectedUpdatedAt: c.updatedAt,
                      }).finally(() => setConflictBusy(false))
                    }}
                  >
                    Replace this
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={conflictBusy} className="border-white/15 bg-transparent text-white/70 hover:bg-white/5 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={conflictBusy}
              className="bg-[#d4af37] text-black hover:bg-[#e6c25a]"
              onClick={(e) => {
                e.preventDefault()
                if (!conflict) return
                setConflictBusy(true)
                void createMemory(conflict.content, { kind: 'keep-both' }).finally(() => setConflictBusy(false))
              }}
            >
              {conflictBusy ? <Spinner className="h-3.5 w-3.5" /> : null} Keep both
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete one */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent className="max-w-sm border-[rgba(212,175,55,0.25)] bg-[#121214]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white/90">Delete this memory?</AlertDialogTitle>
            <AlertDialogDescription className="break-words text-white/50">
              “{deleteTarget?.content}” will be removed from RIISHE&apos;s memory permanently.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/15 bg-transparent text-white/70 hover:bg-white/5 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/90 text-white hover:bg-red-500"
              onClick={(e) => {
                e.preventDefault()
                if (deleteTarget) void deleteOne(deleteTarget.id)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete all */}
      <AlertDialog
        open={deletingAll}
        onOpenChange={(open) => {
          if (!open) setDeletingAll(false)
        }}
      >
        <AlertDialogContent className="max-w-sm border-red-500/30 bg-[#121214]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white/90">Delete ALL memories?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/50">
              All {items.length} stored memor{items.length === 1 ? 'y' : 'ies'} will be permanently removed from your account.
              RIISHE will no longer recall any of them. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/15 bg-transparent text-white/70 hover:bg-white/5 hover:text-white">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500/90 text-white hover:bg-red-500"
              onClick={(e) => {
                e.preventDefault()
                void deleteAll()
              }}
            >
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
