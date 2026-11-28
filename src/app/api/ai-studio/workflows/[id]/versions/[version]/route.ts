/**
 * BEAN Intelligence — M50.3 BEAN AI STUDIO single workflow version API.
 *
 * GET   /api/ai-studio/workflows/[id]/versions/[version] → one version WITH
 *       its stored graph JSON (the canvas load path; list responses stay
 *       bounded). Owner-scoped: a foreign workflow or a foreign version is
 *       an honest 404 with no existence leak.
 * PATCH /api/ai-studio/workflows/[id]/versions/[version] → update the graph
 *       JSON and/or change note of a DRAFT only. A published or superseded
 *       version is immutable forever — the edit is refused with an honest
 *       409 and the stored graph bytes are never touched. Graph payloads
 *       are bounded and strict-validated server-side before storage.
 */
import { z } from 'zod'
import { ok, handle } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { getWorkflowVersion, updateWorkflowVersion } from '@/lib/ai-studio/workflow-service'

const patchSchema = z.object({
  /** Replacement graph object — validated server-side against the M50.2
   *  schema; stored canonically only after the checks pass. */
  graph: z.unknown().optional(),
  changeNote: z.string().max(300).optional(),
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id, version } = await params
    const row = await getWorkflowVersion(user.id, id, version)
    return ok({ version: row })
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id, version } = await params
    const body = await parseBody(request, patchSchema)
    const result = await updateWorkflowVersion(user.id, id, version, {
      changeNote: body.changeNote,
      ...(body.graph !== undefined ? { graphJson: JSON.stringify(body.graph) } : {}),
    })
    return ok({ version: result })
  })
}
