/**
 * BEAN Intelligence — LAXII edit history, undo & restore (M26.2).
 *
 * Append-only lineage of REAL completed edit jobs. Every completed edit
 * (local engine, hosted lane, LaMa object removal, local/hosted background
 * removal) records one row: base asset → result asset, engine, mode,
 * executed ops and the approval flag. Undo/restore are THEMSELVES recorded
 * edits — the undo copies the BASE pixels of the undone row into a fresh
 * result asset and appends a 'restore' row, so the chain always tells the
 * truth about what happened to the user's image.
 *
 * Ownership: every query/mutation is scoped to the requesting user.
 */
import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { loadAsset, storeResultAsset } from './assets'
import { logger } from '@/lib/observability/logger'

export interface EditHistoryEntry {
  id: string
  baseAssetId: string
  resultAssetId: string
  jobId: string | null
  engine: string
  mode: string
  ops: Array<Record<string, unknown>>
  approval: boolean
  undoneAt: string | null
  createdAt: string
}

export async function recordEditHistory(input: {
  userId: string
  baseAssetId: string
  resultAssetId: string
  jobId?: string | null
  engine: string
  mode: string
  ops?: Array<Record<string, unknown>>
  approval?: boolean
}): Promise<EditHistoryEntry> {
  const row = await db.laxiiEditHistory.create({
    data: {
      userId: input.userId,
      baseAssetId: input.baseAssetId,
      resultAssetId: input.resultAssetId,
      jobId: input.jobId ?? null,
      engine: input.engine,
      mode: input.mode,
      opsJson: JSON.stringify(input.ops ?? []),
      approval: input.approval ?? false,
    },
  })
  logger.info('laxii.edit_history_recorded', { historyId: row.id, engine: input.engine })
  return rowToEntry(row)
}

type Row = {
  id: string
  baseAssetId: string
  resultAssetId: string
  jobId: string | null
  engine: string
  mode: string
  opsJson: string
  approval: boolean
  undoneAt: Date | null
  createdAt: Date
}

function rowToEntry(row: Row): EditHistoryEntry {
  let ops: Array<Record<string, unknown>> = []
  try {
    const parsed = JSON.parse(row.opsJson)
    if (Array.isArray(parsed)) ops = parsed as Array<Record<string, unknown>>
  } catch {
    ops = []
  }
  return {
    id: row.id,
    baseAssetId: row.baseAssetId,
    resultAssetId: row.resultAssetId,
    jobId: row.jobId,
    engine: row.engine,
    mode: row.mode,
    ops,
    approval: row.approval,
    undoneAt: row.undoneAt ? row.undoneAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** History for one asset lineage (newest first, bounded). */
export async function listEditHistory(userId: string, assetId: string, limit = 25): Promise<EditHistoryEntry[]> {
  if (!/^[\w-]+$/.test(assetId)) throw new BeanApiError('VALIDATION_ERROR', 'Invalid asset identifier.')
  const rows = await db.laxiiEditHistory.findMany({
    where: { userId, OR: [{ baseAssetId: assetId }, { resultAssetId: assetId }] },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
  })
  return rows.map(rowToEntry)
}

/**
 * Undo one completed edit: the undone row is marked and a NEW 'restore' row
 * is appended whose result asset holds the undone row's base pixels — the
 * image returns to its pre-edit state through a real, auditable operation.
 */
export async function undoEdit(userId: string, historyId: string): Promise<EditHistoryEntry> {
  const row = await db.laxiiEditHistory.findUnique({ where: { id: historyId } })
  if (!row || row.userId !== userId) throw new BeanApiError('NOT_FOUND', 'Edit history entry not found.')
  if (row.undoneAt) throw new BeanApiError('VALIDATION_ERROR', 'This edit has already been undone.')
  if (row.engine === 'restore') throw new BeanApiError('VALIDATION_ERROR', 'A restore entry cannot be undone — undo a real edit instead.')

  const base = await loadAsset(userId, row.baseAssetId)
  const restored = await storeResultAsset(userId, 'result', base.data, base.width ?? 0, base.height ?? 0, {
    mime: base.mime,
    provenance: {
      engine: 'restore',
      pipeline: 'edit-history-undo',
      mode: row.mode,
      note: `Restored pre-edit pixels of asset ${row.baseAssetId} (undo of edit ${row.id}, engine ${row.engine}).`,
    },
  })
  const undone = await db.laxiiEditHistory.update({
    where: { id: row.id },
    data: { undoneAt: new Date() },
  })
  const restore = await recordEditHistory({
    userId,
    baseAssetId: row.resultAssetId,
    resultAssetId: restored.id,
    engine: 'restore',
    mode: 'restore',
    ops: [{ type: 'restore', undoneHistoryId: row.id, restoredFrom: row.baseAssetId }],
  })
  void undone
  logger.info('laxii.edit_undo', { userId, historyId: row.id, restoreId: restore.id })
  return restore
}

/** The current (latest, not-undone) result asset for a lineage, or null. */
export async function latestResultAssetId(userId: string, assetId: string): Promise<string | null> {
  const row = await db.laxiiEditHistory.findFirst({
    where: { userId, OR: [{ baseAssetId: assetId }, { resultAssetId: assetId }], undoneAt: null, engine: { not: 'restore' } },
    orderBy: { createdAt: 'desc' },
    select: { resultAssetId: true },
  })
  return row?.resultAssetId ?? null
}
