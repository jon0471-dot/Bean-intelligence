import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { getProduct } from '@/lib/registry/products'
import { getBackend } from '@/lib/registry/backends'
import { enqueueJob } from '@/lib/jobs/queue'
import { dedupeKeyFor, hasActiveDuplicate } from '@/lib/ai-engine/queue'
import { ensureVideoPoller } from '@/lib/jobs/video-worker'
import { upstreamBreakerState, type UpstreamEndpointClass } from '@/lib/upstream/gateway'
import { validateVideoReferenceImage } from '@/lib/jazmii/reference-image'

/**
 * JAZMII — submit a REAL video-generation job (async; no HTTP request is
 * held open while the provider renders).
 *
 * Validation: prompt 3..2000 chars; optional image-to-video driver as an
 * https URL or data URL (provider-validated); size strictly 'WxH' with
 * bounded dimensions; duration/fps bounded pass-through — the provider's
 * own validation errors surface honestly.
 */
const schema = z.object({
  prompt: z.string().min(3).max(2000),
  imageUrl: z
    .string()
    .max(8_000_000)
    .refine(
      (v) => /^https:\/\//.test(v) || /^data:image\/(png|jpeg|jpg|webp);base64,/.test(v),
      'imageUrl must be an https URL or a base64 data URL (png/jpeg/webp).',
    )
    .optional(),
  quality: z.enum(['speed', 'quality']).optional(),
  withAudio: z.boolean().optional(),
  size: z
    .string()
    .regex(/^\d{3,4}x\d{3,4}$/, 'size must be WxH (e.g. 1280x720)')
    .refine((v) => {
      const [w, h] = v.split('x').map(Number)
      return w >= 360 && w <= 1920 && h >= 360 && h <= 1920
    }, 'size dimensions must be within 360..1920')
    .optional(),
  durationSec: z.number().int().min(3).max(12).optional(),
  fps: z.number().int().min(12).max(60).optional(),
})

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)

    // LAXII-JAZMII RESTORATION (2026-11-14, defect D3): the reference image
    // is validated SERVER-SIDE (decodable still image, format, dimensions,
    // byte cap, SSRF-guarded fetch) BEFORE the preflight and any job row —
    // a corrupt or hostile payload now fails fast with a precise reason
    // instead of consuming a real generation submission and polluting the
    // capability evidence chain with a provider-side rejection.
    const imageValidation = body.imageUrl ? await validateVideoReferenceImage(body.imageUrl) : null
    if (imageValidation && !imageValidation.ok) {
      throw new BeanApiError('VALIDATION_ERROR', imageValidation.reason ?? 'The reference image is not usable.')
    }

    // Routing rules 1–5: availability, rate limit, quota, concurrency, backend.
    const { backend, release } = await preflight(user.id, 'jazmii', 'video-generation')
    try {
      // ZERO-DOWNTIME RECOVERY (2026-11-11) — duplicate-submission guard: an
      // identical ACTIVE video job is refused with 409. The data URL (up to
      // 8 MB) is fingerprinted, not hashed whole, keeping the dedupe key cheap.
      const dedupeKey = dedupeKeyFor(user.id, 'jazmii', 'video-generation', {
        prompt: body.prompt,
        imageUrl: body.imageUrl ? `${body.imageUrl.slice(0, 48)}#${body.imageUrl.length}` : null,
        quality: body.quality ?? null,
        withAudio: body.withAudio ?? null,
        size: body.size ?? null,
        durationSec: body.durationSec ?? null,
        fps: body.fps ?? null,
      })
      if (await hasActiveDuplicate(dedupeKey)) {
        throw new BeanApiError(
          'CONCURRENCY_LIMIT',
          'An identical video job is already queued or running. Wait for it to finish.',
        )
      }
      const job = await db.generationJob.create({
        data: {
          userId: user.id,
          product: 'jazmii',
          task: 'video-generation',
          status: 'queued',
          progress: 0,
          dedupeKey,
          paramsJson: JSON.stringify({
            prompt: body.prompt,
            ...(body.imageUrl ? { imageUrl: body.imageUrl } : {}),
            // Additive measured validation summary (never substitutes the
            // original reference — the provider receives the exact input).
            ...(imageValidation ? { imageValidation: { format: imageValidation.format, width: imageValidation.width, height: imageValidation.height, bytes: imageValidation.bytes } } : {}),
            ...(body.quality ? { quality: body.quality } : {}),
            ...(body.withAudio !== undefined ? { withAudio: body.withAudio } : {}),
            ...(body.size ? { size: body.size } : {}),
            ...(body.durationSec ? { durationSec: body.durationSec } : {}),
            ...(body.fps ? { fps: body.fps } : {}),
          }),
        },
      })
      // Fire-and-forget async processing (submit + poll in background).
      enqueueJob(job.id)
      return ok(
        {
          job: {
            id: job.id,
            status: 'queued',
            progress: 0,
            queuedAt: job.queuedAt,
          },
        },
        { status: 202 },
      )
    } finally {
      release()
    }
  })
}

/** JAZMII job history + product availability (measured, not hardcoded). */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const jobs = await db.generationJob.findMany({
      where: { userId: user.id, product: 'jazmii' },
      orderBy: { queuedAt: 'desc' },
      take: 20,
    })
    // Recovery: re-attach pollers to running/queued jobs that lost theirs
    // (restart) so a browser refresh reconnects to the same provider task.
    for (const j of jobs) {
      ensureVideoPoller({
        id: j.id,
        userId: j.userId,
        product: j.product,
        task: j.task,
        status: normalizeJobStatus(j.status),
        paramsJson: j.paramsJson,
        resultJson: j.resultJson,
      })
    }
    const backend = getBackend('bean-video-hosted-primary')
    const product = getProduct('jazmii')
    // Shared-account throttle (labeled cross-class inference — same evidence
    // contract as /api/health): a fresh 429 on ANY gateway class means new
    // submissions would be rejected at the provider edge right now.
    const accountThrottled = (
      ['chat', 'functions', 'images', 'video', 'audio'] as UpstreamEndpointClass[]
    ).some((cls) => upstreamBreakerState(cls).coolingDown)
    return ok({
      productAvailability: {
        available: backend?.enabled === true,
        accountThrottled,
        reason:
          backend?.enabled === true
            ? accountThrottled
              ? 'JAZMII runs on the authorized hosted video backend. The shared gateway account is rate-limited right now (HTTP 429 observed moments ago) — new submissions will be rejected until the breaker clears. Try again shortly.'
              : 'JAZMII is operational: submissions run on the authorized hosted video backend. Completion is proven by each job, individually.'
            : backend?.unavailableReason ?? 'No backend configured.',
        product: product?.name ?? 'JAZMII',
      },
      jobs: jobs.map((j) => {
        const result = j.resultJson ? (JSON.parse(j.resultJson) as Record<string, unknown>) : null
        return {
          id: j.id,
          status: normalizeJobStatus(j.status),
          progress: j.progress,
          errorCode: j.errorCode,
          errorMessage: j.errorMessage,
          videoUrl: result && j.status === 'completed' ? result.videoUrl : null,
          format: result?.format,
          bytes: result?.bytes,
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
