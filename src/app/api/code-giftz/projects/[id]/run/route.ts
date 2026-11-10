/**
 * CODE GIFTZ — sandbox execution of a project (explicit approval required).
 * Reuses the SAME restricted sandbox runner as the task-mode product. Real
 * stdout/stderr/exit code only — BEAN never claims a run happened unless the
 * process actually executed.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { runInSandbox, cleanupOldRuns, type SandboxFile } from '@/lib/sandbox/runner'
import { recordUsage, recordAudit } from '@/lib/observability/metering'
import { logger } from '@/lib/observability/logger'

const schema = z.object({
  /** Explicit approval — sandbox execution NEVER happens without this flag. */
  approval: z.literal(true),
  /** Optional entry override; defaults to the conventional entry detection. */
  entry: z.string().max(200).optional(),
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

    const rows = await db.codeFile.findMany({ where: { projectId: id }, orderBy: { path: 'asc' } })
    const files: SandboxFile[] = rows
      .filter((r) => /\.(js|ts|py)$/.test(r.path))
      .map((r) => ({ path: r.path, content: r.content }))
    if (files.length === 0) {
      throw new BeanApiError(
        'VALIDATION_ERROR',
        'This project has no JavaScript/TypeScript/Python files to execute. HTML/CSS-only projects can be opened in the Preview panel instead.',
      )
    }
    if (body.entry && !files.some((f) => f.path === body.entry)) {
      throw new BeanApiError('VALIDATION_ERROR', 'The selected entry file is not part of this project.')
    }

    void cleanupOldRuns().catch(() => undefined)
    const run = await runInSandbox(files)

    await recordAudit({
      actorId: user.id,
      action: 'code-giftz.sandbox_run',
      target: id,
      meta: { runId: run.runId, exitCode: run.exitCode, timedOut: run.timedOut },
    })
    await recordUsage({
      userId: user.id,
      product: 'code-giftz',
      backendId: null, // local execution, no upstream backend involved
      kind: 'coding-task',
      durationMs: run.durationMs,
      success: !run.timedOut,
      errorCode: run.timedOut ? 'SANDBOX_TIMEOUT' : null,
    })
    logger.info('codegiftz.sandbox_run', { runId: run.runId, exitCode: run.exitCode, durationMs: run.durationMs })

    return ok({
      run: {
        runId: run.runId,
        entry: body.entry ?? null,
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        durationMs: run.durationMs,
      },
    })
  })
}
