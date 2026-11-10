import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { runInSandbox, cleanupOldRuns, type SandboxFile } from '@/lib/sandbox/runner'
import { recordUsage, recordAudit } from '@/lib/observability/metering'
import { logger } from '@/lib/observability/logger'

const schema = z.object({
  taskId: z.string().min(1),
  /** Explicit approval — sandbox execution NEVER happens without this flag. */
  approval: z.literal(true),
  /** Files to execute; defaults to the files produced by the task. */
})

/**
 * CODE GIFTZ — sandbox execution. Requires the task to belong to the caller
 * AND an explicit `approval: true` from the client (the "Run in sandbox"
 * button). Output is exactly what the process produced — pass and fail are
 * both surfaced verbatim.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)

    const job = await db.generationJob.findUnique({ where: { id: body.taskId } })
    if (!job || job.userId !== user.id || job.product !== 'code-giftz') {
      throw new BeanApiError('NOT_FOUND', 'Task not found.')
    }
    if (job.status !== 'completed') {
      throw new BeanApiError('VALIDATION_ERROR', 'Only completed tasks can be executed.')
    }

    const result = JSON.parse(job.resultJson ?? '{}') as { files?: SandboxFile[] }
    const files = result.files ?? []
    if (files.length === 0) {
      throw new BeanApiError(
        'VALIDATION_ERROR',
        'This task produced no executable files. Use a generate-mode task for sandbox runs.',
      )
    }

    void cleanupOldRuns().catch(() => undefined)

    const run = await runInSandbox(files)

    await recordAudit({
      actorId: user.id,
      action: 'code-giftz.sandbox_run',
      target: body.taskId,
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
    logger.info('codegiftz.sandbox_run', {
      runId: run.runId,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
    })

    return ok({
      run: {
        runId: run.runId,
        stdout: run.stdout,
        stderr: run.stderr,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        durationMs: run.durationMs,
      },
    })
  })
}
