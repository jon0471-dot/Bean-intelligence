/**
 * BEAN Intelligence — M50.3 BEAN AI STUDIO workflow duplication API.
 *
 * POST /api/ai-studio/workflows/[id]/duplicate → deep-copy the definition
 *      and its LATEST graph into a NEW workflow with a fresh draft v1.
 *      Run and version history are NEVER copied; the per-owner definition
 *      cap applies (QUOTA_EXCEEDED when full). Owner-scoped: a foreign id
 *      is an honest 404.
 */
import { z } from 'zod'
import { ok, handle } from '@/lib/api/errors'
import { parseOptionalBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { duplicateWorkflowDefinition } from '@/lib/ai-studio/workflow-service'

// The endpoint takes no meaningful request fields — any keys a client sends
// are validated-but-ignored (never trusted).
const bodySchema = z.object({})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    await parseOptionalBody(request, bodySchema)
    const workflow = await duplicateWorkflowDefinition(user.id, id)
    return ok({ workflow }, { status: 201 })
  })
}
