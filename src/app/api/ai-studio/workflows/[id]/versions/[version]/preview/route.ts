/**
 * BEAN Intelligence — M50.3 BEAN AI STUDIO read-only compiled-plan preview API.
 *
 * POST /api/ai-studio/workflows/[id]/versions/[version]/preview → call the
 *      REAL M50.2 deterministic compiler over the SAVED graph and return the
 *      compiled tasks, node→task mapping, deliverable designation, the
 *      platform QUALITY gate and the bounded diagnostics (availability
 *      warnings/info preserved by the M50.3 corrective fix).
 *
 * STRICTLY read-only — the preview NEVER:
 *  - calls `createMissionFromPlan` or creates an AgentMission /
 *    AgentMissionTask / TrustTask / GenerationJob row;
 *  - calls a specialist adapter or performs model inference;
 *  - enqueues anything or writes a WorkflowRun row;
 *  - fabricates execution progress or success states.
 *
 * The request body carries NO trusted availability claim. A preview over a
 * graph that cannot compile is still a successful read: 200 with
 * `compiled.ok: false` and the diagnostics.
 */
import { z } from 'zod'
import { ok, handle } from '@/lib/api/errors'
import { parseOptionalBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { previewWorkflowVersion } from '@/lib/ai-studio/workflow-service'

const bodySchema = z.object({})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id, version } = await params
    await parseOptionalBody(request, bodySchema)
    const result = await previewWorkflowVersion(user.id, id, version)
    return ok({
      definitionId: result.definitionId,
      version: result.version,
      status: result.status,
      compiled: result.compiled,
    })
  })
}
