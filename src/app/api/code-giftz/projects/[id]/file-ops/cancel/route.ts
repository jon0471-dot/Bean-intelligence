/**
 * CODE GIFTZ — file-operation cancellation (M23).
 *
 * POST — discard a planned operation that is awaiting confirmation. A
 * cancelled operation can never execute afterwards (its record stays in the
 * ledger with the honest 'cancelled' state). Owner-checked.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { cancelOperation } from '@/lib/code/file-ops/execute'
import { FileOpError } from '@/lib/code/file-ops/types'

const schema = z.object({
  opId: z.string().min(1).max(100),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, schema)
    const project = await db.codeProject.findUnique({ where: { id } })
    if (!project || project.userId !== user.id) {
      throw new BeanApiError('NOT_FOUND', 'Project not found.')
    }
    try {
      const result = await cancelOperation(body.opId, id)
      await recordAudit({
        actorId: user.id,
        action: 'code-giftz.file_op_cancel',
        target: id,
        meta: { opId: body.opId },
      })
      return ok(result)
    } catch (e) {
      if (e instanceof FileOpError) {
        throw new BeanApiError(
          e.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_ERROR',
          e.message,
        )
      }
      throw e
    }
  })
}
