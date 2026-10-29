import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { getProduct } from '@/lib/registry/products'
import { getBackend } from '@/lib/registry/backends'

const schema = z.object({
  prompt: z.string().min(3).max(2000),
  // NOTE: duration/resolution options are intentionally NOT offered —
  // no video backend is deployed, so BEAN must not advertise parameters
  // no worker can honor (spec §2C: never promise unsupported capability).
})

/**
 * JAZMII — submit a video-generation job.
 *
 * TRUTH POLICY: with no video backend deployed, the router rejects here
 * with a clear, stable error. A rejected request is recorded in the job
 * table as `unsupported` for transparency — it is NEVER presented as
 * queued/running/completed, and no synthetic job is fabricated.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)

    try {
      await preflight(user.id, 'jazmii', 'video-generation')
      // Unreachable today: the registry entry is disabled, preflight throws.
    } catch {
      // Expected path: PRODUCT_UNAVAILABLE / NO_BACKEND from the router.
      // Record the truthful rejection (auditable, visible in history).
      await db.generationJob.create({
        data: {
          userId: user.id,
          product: 'jazmii',
          task: 'video-generation',
          status: 'unsupported',
          progress: 0,
          paramsJson: JSON.stringify({ prompt: body.prompt }),
          errorCode: 'NO_BACKEND',
          errorMessage:
            'JAZMII is not operational: no licensed video-generation backend is deployed in this environment.',
          finishedAt: new Date(),
        },
      })
      return ok(
        {
          rejected: true,
          code: 'NO_BACKEND',
          message:
            'JAZMII cannot accept video jobs yet. No video-generation backend is deployed — BEAN does not simulate video generation. Deploy a licensed GPU worker (see docs/models/MODEL-EVALUATION-REPORT.md) to enable this product.',
        },
        { status: 200 },
      )
    }

    // Defensive: if a backend is ever enabled without an implementation.
    return ok(
      { rejected: true, code: 'NO_BACKEND', message: 'Video backend has no adapter implementation.' },
      { status: 200 },
    )
  })
}

/** JAZMII job history (shows the truthful `unsupported` records). */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const jobs = await db.generationJob.findMany({
      where: { userId: user.id, product: 'jazmii' },
      orderBy: { queuedAt: 'desc' },
      take: 20,
    })
    const backend = getBackend('bean-video-selfhosted-candidate')
    const product = getProduct('jazmii')
    return ok({
      productAvailability: {
        available: false,
        reason: backend?.unavailableReason ?? 'No backend configured.',
        product: product?.name ?? 'JAZMII',
      },
      jobs: jobs.map((j) => ({
        id: j.id,
        status: j.status,
        errorCode: j.errorCode,
        errorMessage: j.errorMessage,
        queuedAt: j.queuedAt,
      })),
    })
  })
}
