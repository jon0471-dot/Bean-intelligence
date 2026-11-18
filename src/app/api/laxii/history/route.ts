import { z } from 'zod'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { listEditHistory, undoEdit } from '@/lib/laxii/history'

/**
 * LAXII edit history (M26.2) — GET lists the append-only lineage for an
 * asset (owner-only); POST performs a real undo/restore: the undone edit is
 * marked and a fresh 'restore' entry copies the pre-edit pixels into a new
 * result asset. Nothing is ever rewritten or deleted.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const url = new URL(request.url)
    const assetId = url.searchParams.get('assetId') ?? ''
    const limit = Number(url.searchParams.get('limit') ?? 25)
    const entries = await listEditHistory(user.id, assetId, Number.isFinite(limit) ? limit : 25)
    return ok({ entries })
  })
}

const undoSchema = z.object({ historyId: z.string().min(1) })

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, undoSchema)
    const restore = await undoEdit(user.id, body.historyId)
    return ok({ restore })
  })
}

export const dynamic = 'force-dynamic'
