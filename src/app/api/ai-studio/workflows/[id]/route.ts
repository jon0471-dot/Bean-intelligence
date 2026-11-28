/**
 * BEAN Intelligence — M50.3 BEAN AI STUDIO workflow item API.
 *
 * GET    /api/ai-studio/workflows/[id] → one workflow with its version
 *        summary (owner-scoped; a foreign id is an honest 404).
 * PATCH  /api/ai-studio/workflows/[id] → bounded edits: rename, describe,
 *        archive or restore. There is no arbitrary status write; archiving
 *        refuses while a run is active.
 * DELETE /api/ai-studio/workflows/[id] → safe guarded deletion (refused with
 *        run history — an honest 409 offers archiving; mission history is
 *        never touched).
 */
import { z } from 'zod'
import { ok, handle } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import {
  deleteWorkflowDefinition,
  getWorkflowDefinition,
  updateWorkflowDefinition,
} from '@/lib/ai-studio/workflow-service'

const patchSchema = z.object({
  name: z.string().max(80).optional(),
  description: z.string().max(600).optional(),
  status: z.enum(['active', 'archived']).optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

function boundedId(id: string): string {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id) ? id : ''
}

export async function GET(_request: Request, { params }: RouteContext) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const workflow = await getWorkflowDefinition(user.id, boundedId(id) || id)
    return ok({ workflow })
  })
}

export async function PATCH(request: Request, { params }: RouteContext) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, patchSchema)
    const workflow = await updateWorkflowDefinition(user.id, boundedId(id) || id, body)
    return ok({ workflow })
  })
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    await deleteWorkflowDefinition(user.id, boundedId(id) || id)
    return ok({ deleted: true })
  })
}
