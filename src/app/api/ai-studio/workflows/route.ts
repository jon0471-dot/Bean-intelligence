/**
 * BEAN Intelligence — M50.3 BEAN AI STUDIO workflows collection API.
 *
 * GET  /api/ai-studio/workflows → the signed-in user's workflows
 *      (owner-scoped, newest-edited first, bounded pagination, optional
 *      active/archived filter).
 * POST /api/ai-studio/workflows → create a definition plus draft v1 (an
 *      optional initial graph passes the strict M50.2 schema + size checks;
 *      a blank draft uses the documented empty-editor placeholder and is
 *      never required to be publishable).
 *
 * PERSISTENCE ONLY — nothing here executes a workflow, creates a mission,
 * enqueues a job or writes a Trust task (execution stays M50.5).
 */
import { z } from 'zod'
import { ok, handle } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { createWorkflowDefinition, listWorkflowDefinitions } from '@/lib/ai-studio/workflow-service'

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(600).optional(),
  /** Optional initial graph object — validated server-side against the
   *  M50.2 schema (the raw value is never stored or trusted as-is). */
  graph: z.unknown().optional(),
})

function isDefinitionStatusFilter(v: string | null): 'active' | 'archived' | undefined {
  return v === 'active' || v === 'archived' ? v : undefined
}

function positiveIntParam(v: string | null): number | undefined {
  if (v === null || !/^[1-9][0-9]{0,4}$/.test(v)) return undefined
  return Number.parseInt(v, 10)
}

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const url = new URL(request.url)
    const result = await listWorkflowDefinitions(user.id, {
      status: isDefinitionStatusFilter(url.searchParams.get('status')),
      page: positiveIntParam(url.searchParams.get('page')),
      pageSize: positiveIntParam(url.searchParams.get('pageSize')),
    })
    return ok(result)
  })
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, createSchema)
    const created = await createWorkflowDefinition(user.id, {
      name: body.name,
      description: body.description,
      ...(body.graph !== undefined ? { graphJson: JSON.stringify(body.graph) } : {}),
    })
    return ok({ workflow: created }, { status: 201 })
  })
}
