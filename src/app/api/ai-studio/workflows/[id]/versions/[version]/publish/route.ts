/**
 * BEAN Intelligence — M50.3 BEAN AI STUDIO version publication API.
 *
 * POST /api/ai-studio/workflows/[id]/versions/[version]/publish → validate
 *      the DRAFT and freeze it: the draft becomes `published`
 *      (immutable forever) and the previous published version becomes
 *      `superseded` (also immutable) in the SAME transaction. Refusals:
 *      an archived workflow, a non-draft version, a graph with validation
 *      errors (422) and concurrent publish/edit races (409). Warnings and
 *      informational diagnostics stay visible in the response but never
 *      block a structurally valid graph.
 */
import { z } from 'zod'
import { ok, handle } from '@/lib/api/errors'
import { parseOptionalBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { publishWorkflowVersion } from '@/lib/ai-studio/workflow-service'

const bodySchema = z.object({})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id, version } = await params
    await parseOptionalBody(request, bodySchema)
    const published = await publishWorkflowVersion(user.id, id, version)
    return ok({ published })
  })
}
