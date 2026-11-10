import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { enqueueJob } from '@/lib/jobs/queue'
import { dedupeKeyFor, hasActiveDuplicate } from '@/lib/ai-engine/queue'
import { LAXII_SIZES } from '@/lib/registry/products'
import { recordAudit } from '@/lib/observability/metering'

const schema = z.object({
  prompt: z.string().min(3, 'Describe the image you want (at least 3 characters).').max(4000),
  size: z.enum(
    LAXII_SIZES.map((s) => s.value) as [string, ...string[]],
    { message: 'Unsupported dimension — pick one from the size list.' },
  ),
})

/**
 * LAXII — submit an image-generation job.
 * Returns a job id immediately; the actual generation runs on the async
 * queue and ONLY reaches `completed` when a real image has been stored.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)
    const { backend, release } = await preflight(user.id, 'laxii', 'image-generation')
    release() // queue slot is held by the worker, not by this HTTP request

    // ZERO-DOWNTIME RECOVERY (2026-11-11) — duplicate-submission guard (brief
    // §3): an identical ACTIVE generation (double-click, retry storm, client
    // resubmit while throttled) is refused with 409 instead of queueing a
    // second identical job that would double-charge the shared account.
    // Terminal jobs never block a deliberate resubmission.
    const dedupeKey = dedupeKeyFor(user.id, 'laxii', 'image-generation', {
      prompt: body.prompt,
      size: body.size,
    })
    if (await hasActiveDuplicate(dedupeKey)) {
      throw new BeanApiError(
        'CONCURRENCY_LIMIT',
        'An identical image generation is already queued or running. Wait for it to finish.',
      )
    }

    const job = await db.generationJob.create({
      data: {
        userId: user.id,
        product: 'laxii',
        task: 'image-generation',
        status: 'queued',
        backendId: backend.id,
        dedupeKey,
        paramsJson: JSON.stringify({ prompt: body.prompt, size: body.size }),
      },
    })

    await recordAudit({
      actorId: user.id,
      action: 'laxii.submit',
      target: job.id,
      meta: { size: body.size, promptChars: body.prompt.length },
    })

    enqueueJob(job.id)

    return ok(
      {
        job: {
          id: job.id,
          status: normalizeJobStatus(job.status),
          progress: job.progress,
          size: body.size,
        },
      },
      { status: 202 },
    )
  })
}

/** Job history for the caller (newest first). Includes preservation-engine
 *  jobs (enhance/edit) with their before/after/difference artifacts and the
 *  computed preservation report — additive fields; legacy fields unchanged. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const jobs = await db.generationJob.findMany({
      where: { userId: user.id, product: 'laxii' },
      orderBy: { queuedAt: 'desc' },
      take: 40,
    })
    return ok({
      jobs: jobs.map((j) => {
        const result = j.resultJson ? (JSON.parse(j.resultJson) as Record<string, unknown>) : null
        const params = j.paramsJson ? (JSON.parse(j.paramsJson) as Record<string, unknown>) : {}
        return {
          id: j.id,
          task: j.task,
          status: normalizeJobStatus(j.status),
          progress: j.progress,
          size: (params.size as string | undefined) ?? null,
          errorCode: j.errorCode,
          errorMessage: j.errorMessage,
          imageUrl: result && j.status === 'completed' ? result.imageUrl : null,
          originalUrl: result?.originalUrl ?? null,
          diffUrl: result?.diffUrl ?? null,
          report: result?.report ?? null,
          provenance: result?.provenance ?? null,
          width: result?.width,
          height: result?.height,
          format: result?.format,
          bytes: result?.bytes,
          durationMs: result?.durationMs,
          queuedAt: j.queuedAt,
          finishedAt: j.finishedAt,
        }
      }),
    })
  })
}

/** Engine states → legacy vocabulary (product interfaces preserved). */
function normalizeJobStatus(status: string): string {
  switch (status) {
    case 'starting':
    case 'running':
    case 'streaming':
    case 'finalizing':
      return 'running'
    case 'retry_wait':
      return 'queued'
    default:
      return status
  }
}
