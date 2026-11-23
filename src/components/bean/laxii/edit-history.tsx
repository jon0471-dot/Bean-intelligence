'use client'
/**
 * LAXII edit history + undo (M26.2) — honest lineage UI.
 *
 * Shows the append-only edit history for the currently attached image
 * (engine, mode, executed ops, time) and performs REAL undo/restore
 * through /api/laxii/history. No cached optimism: entries are the server's
 * records; an undone edit is labeled as such.
 */
import { useCallback, useEffect, useState } from 'react'
import { History, Undo2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { beanFetch, Spinner } from '@/components/bean/shared'

interface HistoryEntry {
  id: string
  baseAssetId: string
  resultAssetId: string
  engine: string
  mode: string
  ops: Array<Record<string, unknown>>
  approval: boolean
  undoneAt: string | null
  createdAt: string
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}

function opsSummary(entry: HistoryEntry): string {
  if (entry.engine === 'restore') return 'restored pre-edit state'
  const types = entry.ops.map((o) => String(o.type ?? 'op'))
  return types.length > 0 ? types.join(' + ') : entry.mode
}

export function EditHistoryPanel({ assetId, onRestored }: { assetId: string | null; onRestored?: () => void }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!assetId) return
    setEntries(null)
    setError(null)
    try {
      const d = await beanFetch<{ entries: HistoryEntry[] }>(`/api/laxii/history?assetId=${encodeURIComponent(assetId)}`)
      setEntries(d.entries)
    } catch (e) {
      setError((e as Error).message || 'History is unavailable.')
    }
  }, [assetId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const undo = async (entry: HistoryEntry) => {
    setBusyId(entry.id)
    setError(null)
    try {
      await beanFetch('/api/laxii/history', { method: 'POST', json: { historyId: entry.id } })
      await load()
      onRestored?.()
    } catch (e) {
      setError((e as Error).message || 'The undo could not complete.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="Edit history"
          title="Edit history & undo"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2 text-[11px] text-white/55 transition-colors hover:border-[rgba(212,175,55,0.35)] hover:text-[#f0c75e]"
        >
          <History className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">History</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 border-[rgba(212,175,55,0.25)] bg-[#0d0d0d] p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-white/45">Edit history</span>
          <span className="text-[10px] text-white/35">{assetId ? 'current image' : 'attach an image first'}</span>
        </div>
        {!assetId ? (
          <p className="py-3 text-[11px] leading-relaxed text-white/45">
            Attach or generate an image, then its completed edits appear here with undo/restore.
          </p>
        ) : entries === null && !error ? (
          <div className="flex justify-center py-4">
            <Spinner className="h-4 w-4" />
          </div>
        ) : error ? (
          <p className="py-2 text-[11px] text-red-300">{error}</p>
        ) : (entries?.length ?? 0) === 0 ? (
          <p className="py-3 text-[11px] leading-relaxed text-white/45">
            No completed edits on record for this image yet.
          </p>
        ) : (
          <div className="bean-scroll max-h-72 space-y-1.5 overflow-y-auto">
            {entries?.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-2.5 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-[11px] text-white/80">
                    {opsSummary(entry)}
                    <span className="ml-1.5 text-white/35">· {entry.engine === 'sharp' ? 'local deterministic engine' : entry.engine === 'lama' ? 'local repair engine' : entry.engine === 'hosted' ? 'hosted engine' : 'local engine'}</span>
                  </div>
                  <div className="text-[10px] text-white/35">
                    {timeAgo(entry.createdAt)}
                    {entry.undoneAt ? ' · undone' : ''}
                    {entry.approval ? ' · approved destructive' : ''}
                  </div>
                </div>
                {!entry.undoneAt && entry.engine !== 'restore' ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId !== null}
                    onClick={() => void undo(entry)}
                    className="h-7 shrink-0 gap-1 px-2 text-[11px] text-white/60 hover:text-[#f0c75e]"
                    aria-label="Undo this edit"
                  >
                    {busyId === entry.id ? <Spinner className="h-3 w-3" /> : <Undo2 className="h-3 w-3" />}
                    Undo
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
