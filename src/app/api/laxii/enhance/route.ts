import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { enqueueJob } from '@/lib/jobs/queue'
import { dedupeKeyFor, hasActiveDuplicate } from '@/lib/ai-engine/queue'
import { recordAudit } from '@/lib/observability/metering'
import { loadAsset } from '@/lib/laxii/assets'

const rectSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
})

const schema = z.object({
  assetId: z.string().min(1),
  /** Omit for a full-frame global enhancement (documented global change). */
  maskStrokes: z
    .array(z.object({ assetId: z.string().min(1), kind: z.enum(['edit', 'protect']) }))
    .max(8)
    .default([]),
  faceZones: z.array(z.object({ rect: rectSchema, source: z.enum(['user', 'face-auto', 'face-user']) })).max(16).default([]),
  shaping: z
    .object({ expandPx: z.number().int().min(0).max(64).default(0), featherPx: z.number().min(0).max(64).default(4) })
    .default({ expandPx: 0, featherPx: 4 }),
  options: z
    .object({
      denoise: z.boolean().optional(),
      exposureWhiteBalance: z.boolean().optional(),
      grade: z.boolean().optional(),
      localContrast: z.boolean().optional(),
      upscaleFactor: z.number().min(1).max(4).optional(),
      allowGlobalColor: z.boolean().optional(),
    })
    .default({}),
  /** true = user-approved GLOBAL color/exposure change (unmasked pixels are
   *  still protected from anything but color work). */
  globalColor: z.boolean().default(true),
})

/**
 * LAXII — submit a deterministic enhancement job (Strict Preserve engine).
 * Non-generative by construction: only measured, planned Sharp operations
 * run, and the job result carries the computed preservation report.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)

    // Ownership + decodability of the source asset (throws 404/400).
    const asset = await loadAsset(user.id, body.assetId)
    if (asset.kind !== 'original' && asset.kind !== 'result') {
      throw new BeanApiError('VALIDATION_ERROR', 'Enhancement needs an `original` image asset.')
    }
    for (const stroke of body.maskStrokes) {
      const m = await loadAsset(user.id, stroke.assetId)
      if (m.kind !== 'mask') {
        throw new BeanApiError('VALIDATION_ERROR', 'maskStrokes must reference mask assets.')
      }
    }

    const { backend, release } = await preflight(user.id, 'laxii', 'image-enhancement')
    release() // the queue holds the concurrency slot while processing

    // DUPLICATE-SUBMISSION GUARD (OPERATIONAL-TRANSFORMATION, 2026-11-11):
    // generate/edit already refuse an identical ACTIVE job with 409 — the
    // enhance route was the one submission path without the guard, so a
    // double-click could queue two identical enhancement jobs. Terminal
    // jobs never block a deliberate resubmission.
    const dedupeKey = dedupeKeyFor(user.id, 'laxii', 'image-enhancement', {
      assetId: body.assetId,
      maskStrokes: body.maskStrokes,
      faceZones: body.faceZones,
      shaping: body.shaping,
      options: body.options,
      globalColor: body.globalColor,
    })
    if (await hasActiveDuplicate(dedupeKey)) {
      throw new BeanApiError(
        'CONCURRENCY_LIMIT',
        'An identical enhancement is already queued or running. Wait for it to finish.',
      )
    }

    const job = await db.generationJob.create({
      data: {
        userId: user.id,
        product: 'laxii',
        task: 'image-enhancement',
        status: 'queued',
        backendId: backend.id,
        dedupeKey,
        paramsJson: JSON.stringify({
          assetId: body.assetId,
          maskStrokes: body.maskStrokes,
          faceZones: body.faceZones,
          shaping: body.shaping,
          options: body.options,
          globalColor: body.globalColor,
        }),
      },
    })
    await recordAudit({
      actorId: user.id,
      action: 'laxii.enhance_submit',
      target: job.id,
      meta: { assetId: body.assetId, masked: body.maskStrokes.length > 0 },
    })
    enqueueJob(job.id)
    return ok(
      {
        job: { id: job.id, status: normalizeJobStatus(job.status), progress: job.progress, engine: 'deterministic-sharp' },
      },
      { status: 202 },
    )
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
