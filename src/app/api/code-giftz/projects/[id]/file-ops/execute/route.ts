/**
 * CODE GIFTZ — file-operation execution (M23).
 *
 * POST — execute a planned operation by its operation id. This endpoint IS
 *   the user's confirmation action for destructive plans (deletion, reference
 *   repair): the confirmation is bound to the exact plan hash recorded when
 *   the plan was shown. Idempotent: an already-executed operation replays its
 *   recorded result instead of mutating twice. Stale plans (project changed
 *   underneath) are refused honestly. Owner-checked end to end.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { executeOperation } from '@/lib/code/file-ops/execute'
import { FileOpError } from '@/lib/code/file-ops/types'
import { executeRefactorOperation } from '@/lib/code/refactoring/execute'

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
      // M25 dispatch: a 'refactor' row executes through the atomic multi-file
      // refactoring executor (same ledger, same confirmation binding) — the
      // M23 executor keeps handling every other kind, unchanged.
      const opRow = await db.codeFileOperation.findUnique({ where: { id: body.opId } })
      if (opRow && opRow.kind === 'refactor') {
        if (opRow.projectId !== id) {
          throw new BeanApiError('NOT_FOUND', 'This refactoring operation was not found for this project.')
        }
        const result = await executeRefactorOperation(body.opId, id)
        await recordAudit({
          actorId: user.id,
          action: 'code-giftz.refactor_execute',
          target: id,
          meta: {
            opId: body.opId,
            kind: result.kind,
            applied: result.applied.length,
            versionSeq: result.versionSeq,
            replayed: result.replayed === true,
          },
        })
        return ok({ result })
      }
      const result = await executeOperation(body.opId, id)
      await recordAudit({
        actorId: user.id,
        action: 'code-giftz.file_op_execute',
        target: id,
        meta: { opId: body.opId, kind: result.kind, applied: result.applied.length, versionSeq: result.versionSeq, replayed: result.replayed === true },
      })
      return ok({ result })
    } catch (e) {
      if (e instanceof FileOpError) {
        // Honest typed failures: NOT_FOUND, CONFLICT, STALE, INVALID,
        // PROTECTED — each keeps its truthful message.
        throw new BeanApiError(
          e.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'VALIDATION_ERROR',
          e.message,
        )
      }
      throw e
    }
  })
}
