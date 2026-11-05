import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { enqueueJob } from '@/lib/jobs/queue'
import { recordAudit } from '@/lib/observability/metering'
import { loadAsset } from '@/lib/laxii/assets'
import { resolveProvider } from '@/lib/laxii/provider'
import { generativeWorkerStatus } from '@/lib/laxii/models'
import { lastRealAttempt } from '@/lib/adapters/last-attempts'
import { LAXII_EDIT_CONTRACT_BLOCKER } from '@/lib/registry/capabilities'

const rectSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
})

const schema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('strict-preserve'),
    assetId: z.string().min(1),
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
    globalColor: z.boolean().default(false),
  }),
  z.object({
    mode: z.literal('smart-edit'),
    assetId: z.string().min(1),
    maskStrokes: z.array(z.object({ assetId: z.string().min(1), kind: z.enum(['edit', 'protect']) })).min(1).max(8),
    faceZones: z.array(z.object({ rect: rectSchema, source: z.enum(['user', 'face-auto', 'face-user']) })).max(16).default([]),
    shaping: z
      .object({ expandPx: z.number().int().min(0).max(64).default(2), featherPx: z.number().min(0).max(64).default(8) })
      .default({ expandPx: 2, featherPx: 8 }),
    prompt: z.string().min(3).max(2000),
    negativePrompt: z.string().max(2000).optional(),
    steps: z.number().int().min(10).max(60).optional(),
    guidance: z.number().min(1).max(20).optional(),
    seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
    strength: z.number().min(0.4).max(1).optional(),
    identityThreshold: z.number().min(0).max(1).optional(),
  }),
  z.object({
    mode: z.literal('object-removal'),
    assetId: z.string().min(1),
    maskStrokes: z.array(z.object({ assetId: z.string().min(1), kind: z.literal('edit') })).min(1).max(8),
    shaping: z
      .object({ expandPx: z.number().int().min(0).max(64).default(4), featherPx: z.number().min(0).max(64).default(8) })
      .default({ expandPx: 4, featherPx: 8 }),
  }),
  z.object({
    mode: z.literal('reference-guided'),
    assetId: z.string().min(1),
    referenceAssetId: z.string().min(1),
    maskStrokes: z.array(z.object({ assetId: z.string().min(1), kind: z.enum(['edit', 'protect']) })).max(8).default([]),
    faceZones: z.array(z.object({ rect: rectSchema, source: z.enum(['user', 'face-auto', 'face-user']) })).max(16).default([]),
    prompt: z.string().min(3).max(2000),
    negativePrompt: z.string().max(2000).optional(),
    steps: z.number().int().min(10).max(60).optional(),
    guidance: z.number().min(1).max(20).optional(),
    seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
    ipAdapterScale: z.number().min(0).max(1).optional(),
  }),
  z.object({
    mode: z.literal('conversational-edit'),
    assetId: z.string().min(1),
    prompt: z.string().min(3).max(2000),
    // Edited-output dimensions; omitted = provider default (honest pass-through).
    size: z
      .enum(['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'])
      .optional(),
  }),
])

/**
 * LAXII — submit a preservation-aware edit job.
 *
 * Provider resolution happens BEFORE any job row is created:
 *  - strict-preserve → deterministic local engine (runs today);
 *  - conversational-edit → authorized hosted image editing (whole-image
 *    regenerative edit: background changes, object insertion/removal via
 *    prompt, lighting, restyle, variations). NOT pixel-preserving — stated.
 *  - smart-edit / object-removal / reference-guided (brush-mask work) → the
 *    local Diffusers worker, which is registry-gated. While it is disabled
 *    this route returns the truthful 503 PROVIDER_UNAVAILABLE and nothing is
 *    queued — the user's original image is untouched, and no fake hope is
 *    recorded.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)

    await loadAsset(user.id, body.assetId) // ownership + existence

    let opTask: 'image-enhancement' | 'image-editing'
    let backendId: string
    if (body.mode === 'strict-preserve') {
      opTask = 'image-enhancement'
      backendId = 'bean-image-local-sharp'
    } else if (body.mode === 'conversational-edit') {
      resolveProvider('hosted-edit')
      opTask = 'image-editing'
      backendId = 'bean-image-hosted-edit'
    } else {
      // Throws PROVIDER_UNAVAILABLE while the worker is disabled — before
      // any job is created.
      resolveProvider(body.mode === 'smart-edit' ? 'masked-inpaint' : body.mode === 'object-removal' ? 'object-removal' : 'reference-guided')
      opTask = 'image-editing'
      backendId = 'bean-image-selfhosted-diffusers'
    }

    if (body.mode === 'reference-guided') {
      const ref = await loadAsset(user.id, body.referenceAssetId)
      if (ref.kind !== 'reference') {
        throw new BeanApiError('VALIDATION_ERROR', 'referenceAssetId must be a `reference` asset.')
      }
    }

    const { backend, release } = await preflight(user.id, 'laxii', opTask)
    release()

    const job = await db.generationJob.create({
      data: {
        userId: user.id,
        product: 'laxii',
        task: opTask,
        status: 'queued',
        backendId: backend.id,
        paramsJson: JSON.stringify(body),
      },
    })
    await recordAudit({
      actorId: user.id,
      action: 'laxii.edit_submit',
      target: job.id,
      meta: { mode: body.mode, assetId: body.assetId },
    })
    enqueueJob(job.id)
    return ok(
      {
        job: {
          id: job.id,
          status: job.status,
          progress: job.progress,
          mode: body.mode,
          engine: backendId,
        },
      },
      { status: 202 },
    )
  })
}

/** Truthful capability state for the edit UI (which modes can run now).
 *  GO-LIVE (2026-11-05): conversational-edit `available` is EVIDENCE-DRIVEN
 *  — it is true only when the most recent real edit attempt SUCCEEDED (which
 *  also flips the health payload's capability row to operational). While the
 *  measured contract blocker stands, the disclosure reports available:false
 *  with the blocker evidence, so the existing "— unavailable" UI label tells
 *  the truth instead of advertising a capability that fails at the provider. */
export async function GET() {
  return handle(async () => {
    await requireUser()
    const worker = generativeWorkerStatus()
    const editAttempt = lastRealAttempt('image-editing')
    const editAvailable = Boolean(editAttempt?.ok)
    return ok({
      capabilities: {
        'strict-preserve': { available: true, engine: 'deterministic-sharp' },
        'conversational-edit': {
          available: editAvailable,
          engine: 'hosted-edit',
          ...(editAvailable
            ? {}
            : {
                note:
                  'BLOCKED — ' + LAXII_EDIT_CONTRACT_BLOCKER.note,
                blockerSince: editAttempt?.at ?? LAXII_EDIT_CONTRACT_BLOCKER.measuredAt,
              }),
        },
        'smart-edit': { available: worker.registryEnabled, engine: 'diffusers-worker' },
        'object-removal': { available: worker.registryEnabled, engine: 'diffusers-worker' },
        'reference-guided': { available: worker.registryEnabled, engine: 'diffusers-worker' },
      },
      unavailableReason: worker.unavailableReason,
    })
  })
}

export const dynamic = 'force-dynamic'

// Exported for tests: the mode → op mapping used before queueing.
export function opForMode(mode: string): 'masked-inpaint' | 'object-removal' | 'reference-guided' {
  return mode === 'object-removal' ? 'object-removal' : mode === 'reference-guided' ? 'reference-guided' : 'masked-inpaint'
}
