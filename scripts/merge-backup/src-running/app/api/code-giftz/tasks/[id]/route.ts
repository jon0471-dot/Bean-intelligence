import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'

/** Fetch one CODE GIFTZ task (owner-only) — used when reopening history. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const job = await db.generationJob.findUnique({ where: { id } })
    if (!job || job.userId !== user.id || job.product !== 'code-giftz') {
      throw new BeanApiError('NOT_FOUND', 'Task not found.')
    }
    const paramsData = JSON.parse(job.paramsJson) as { mode?: string; prompt?: string }
    const result = job.resultJson ? JSON.parse(job.resultJson) : null
    return ok({
      task: {
        id: job.id,
        mode: paramsData.mode,
        prompt: paramsData.prompt,
        status: job.status,
        content: result?.content ?? null,
        files: result?.files ?? [],
        durationMs: result?.durationMs ?? null,
        createdAt: job.queuedAt,
      },
    })
  })
}
