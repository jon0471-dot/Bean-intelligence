/**
 * BEAN Intelligence — M50.3 BEAN AI STUDIO read-only graph validation API.
 *
 * POST /api/ai-studio/workflows/[id]/versions/[version]/validate → parse the
 *      SAVED graph with the M50.2 pure core and return the full bounded
 *      diagnostic set, separating structural validity from warnings and
 *      information. STRICTLY read-only: no workflow/version mutation, no
 *      publish, no WorkflowRun row, no mission/Trust/job writes, no
 *      enqueueing of any kind. The request body carries NO trusted
 *      availability claim — the browser cannot assert backend health;
 *      execution-time preflight (M50.5) stays authoritative.
 *
 * A validation run over an INVALID draft is still a successful READ: the
 * response is 200 with `valid: false` and the diagnostics.
 */
import { z } from 'zod'
import { ok, handle } from '@/lib/api/errors'
import { parseOptionalBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { validateWorkflowVersion } from '@/lib/ai-studio/workflow-service'

const bodySchema = z.object({})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id, version } = await params
    await parseOptionalBody(request, bodySchema)
    const result = await validateWorkflowVersion(user.id, id, version)
    return ok({
      definitionId: result.definitionId,
      version: result.version,
      status: result.status,
      valid: result.outcome.valid,
      diagnostics: result.outcome.diagnostics,
    })
  })
}
