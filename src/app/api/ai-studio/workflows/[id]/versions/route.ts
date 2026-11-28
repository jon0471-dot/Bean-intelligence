/**
 * BEAN Intelligence — M50.3 BEAN AI STUDIO workflow versions API.
 *
 * GET  /api/ai-studio/workflows/[id]/versions → the workflow's version
 *      history (owner-scoped, newest first, bounded pagination; graph
 *      payloads stay out of list responses — use the single-version read).
 * POST /api/ai-studio/workflows/[id]/versions → create a NEW draft version
 *      from the latest published version (or an explicit source version).
 *      The one-draft policy and monotonic numbering are enforced in the
 *      service (a concurrency race is an honest 409).
 */
import { z } from 'zod'
import { ok, handle } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { createWorkflowVersion, listWorkflowVersions } from '@/lib/ai-studio/workflow-service'

const createSchema = z.object({
  sourceVersion: z.number().int().min(1).max(999_999).optional(),
  /** Replacement graph for the NEW draft — validated server-side against
   *  the M50.2 schema before anything is stored. */
  graph: z.unknown().optional(),
  changeNote: z.string().max(300).optional(),
})

function positiveIntParam(v: string | null): number | undefined {
  if (v === null || !/^[1-9][0-9]{0,4}$/.test(v)) return undefined
  return Number.parseInt(v, 10)
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const url = new URL(request.url)
    const result = await listWorkflowVersions(user.id, id, {
      page: positiveIntParam(url.searchParams.get('page')),
      pageSize: positiveIntParam(url.searchParams.get('pageSize')),
    })
    return ok(result)
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, createSchema)
    const version = await createWorkflowVersion(user.id, id, {
      sourceVersion: body.sourceVersion,
      changeNote: body.changeNote,
      ...(body.graph !== undefined ? { graphJson: JSON.stringify(body.graph) } : {}),
    })
    return ok({ version }, { status: 201 })
  })
}
