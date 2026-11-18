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
import { resolveProvider, resolveEditLane } from '@/lib/laxii/provider'
import { generativeWorkerStatus } from '@/lib/laxii/models'
import { parseLocalEditPlan, planRequiresApproval } from '@/lib/laxii/local-edit'
import { getBackend } from '@/lib/registry/backends'
import { lastRealAttempt } from '@/lib/adapters/last-attempts'
import { persistedAttempt } from '@/lib/adapters/persisted-attempts'
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
    // M26.2 engine/lane selection: 'auto' (hosted if it has success evidence,
    // else the local engine) | 'hosted' | 'local'. The local engine executes
    // a CONSERVATIVE parsed plan (tone/look/background ops via matting,
    // masked removal via LaMa, approved geometry) and refuses generative
    // synthesis honestly.
    engine: z.enum(['auto', 'hosted', 'local']).optional(),
    // Optional brush-mask strokes riding along (enables masked removal via
    // the local engine's LaMa lane without leaving the chat flow).
    maskStrokes: z
      .array(z.object({ assetId: z.string().min(1), kind: z.literal('edit') }))
      .max(8)
      .default([]),
    // Destructive geometry ops (rotate/flip) require explicit approval.
    approved: z.boolean().optional(),
  }),
  // OPERATIONAL-TRANSFORMATION (2026-11-11), Phase 4: REAL background
  // removal — two-stage pipeline (hosted chroma separation + deterministic
  // cutout to true alpha). No user prompt: the fixed chroma instruction
  // lives beside the cutout math (bg-removal.ts) so the stages stay
  // consistent.
  z.object({
    mode: z.literal('background-removal'),
    assetId: z.string().min(1),
    // M26.2 local lane options (REAL matting): transparent PNG by default;
    // JPEG requires an explicit background; blur gives a portrait-mode cutout.
    engine: z.enum(['auto', 'hosted', 'local']).optional(),
    output: z.enum(['png', 'jpeg']).optional(),
    backgroundColor: z.string().max(20).optional(),
    backgroundBlur: z.boolean().optional(),
    blurSigma: z.number().min(1).max(24).optional(),
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
    } else if (body.mode === 'conversational-edit' || body.mode === 'background-removal') {
      // M26.2 lane resolution via the shared resolver (same semantics for the
      // direct route and the chat studio): explicit engines honored; 'auto'
      // keeps the hosted status quo for edits / local-first for bg removal.
      const lane = await resolveEditLane(body.mode, body.engine ?? 'auto')
      backendId = lane.backendId
      // The local engine parses the instruction BEFORE queueing: a request
      // with no executable op, an impossible (generative) op, or destructive
      // geometry without explicit approval is refused HERE — no job row, no
      // fake hope, the original image untouched.
      if (body.mode === 'conversational-edit' && backendId === 'bean-image-local-edit') {
        const plan = parseLocalEditPlan(body.prompt)
        if (plan.unsupported.length > 0) {
          throw new BeanApiError(
            'CAPABILITY_UNSUPPORTED',
            `The local edit engine cannot honestly perform this request: ${plan.unsupported[0]}. Available locally: brightness/contrast/saturation/warmth/grayscale/sepia/sharpen/vignette, background blur or recolor, masked removal (brush a mask), and approved rotate/flip. Whole-image generative edits need the hosted engine.`,
          )
        }
        if (plan.ops.length === 0) {
          throw new BeanApiError(
            'VALIDATION_ERROR',
            'The instruction does not match any locally executable edit. Try "brighten", "blur the background", "make it black and white", "rotate right" (approved) or brush a mask and ask to remove it.',
          )
        }
        if (planRequiresApproval(plan) && body.approved !== true) {
          throw new BeanApiError(
            'VALIDATION_ERROR',
            'This edit contains destructive geometry changes (rotate/flip). Resubmit with approval to apply them — the original image was not modified.',
          )
        }
      }
      opTask = 'image-editing'
    } else {
      // M26.2: masked OBJECT REMOVAL can ride the REAL local LaMa lane when
      // the GPU Diffusers worker is not deployed (same brush-mask flow,
      // honest engine disclosure). The other masked modes still require the
      // worker and throw the truthful 503 while it is disabled.
      const localEditEnabled = getBackend('bean-image-local-edit')?.enabled === true
      if (body.mode === 'object-removal' && localEditEnabled) {
        backendId = 'bean-image-local-edit'
      } else {
        // Throws PROVIDER_UNAVAILABLE while the worker is disabled — before
        // any job is created.
        resolveProvider(body.mode === 'smart-edit' ? 'masked-inpaint' : body.mode === 'object-removal' ? 'object-removal' : 'reference-guided')
        backendId = 'bean-image-selfhosted-diffusers'
      }
      opTask = 'image-editing'
    }

    if (body.mode === 'reference-guided') {
      const ref = await loadAsset(user.id, body.referenceAssetId)
      if (ref.kind !== 'reference') {
        throw new BeanApiError('VALIDATION_ERROR', 'referenceAssetId must be a `reference` asset.')
      }
    }

    const { release } = await preflight(user.id, 'laxii', opTask, { backendId })
    release()

    // ZERO-DOWNTIME RECOVERY (2026-11-11) — duplicate-submission guard: an
    // identical ACTIVE edit (same asset, mode and instruction) is refused
    // with 409 instead of queueing a second identical provider job.
    const dedupeKey = dedupeKeyFor(user.id, 'laxii', opTask, body)
    if (await hasActiveDuplicate(dedupeKey)) {
      throw new BeanApiError(
        'CONCURRENCY_LIMIT',
        'An identical edit job is already queued or running. Wait for it to finish.',
      )
    }

    const job = await db.generationJob.create({
      data: {
        userId: user.id,
        product: 'laxii',
        task: opTask,
        status: 'queued',
        backendId, // the RESOLVED lane backend — the worker dispatches by it
        dedupeKey,
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
          status: normalizeJobStatus(job.status),
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
    // FINAL CAPABILITY FIX (2026-11-07): the persisted completed edit job is
    // evidence too — a restart must not forget a real conversational edit.
    const editAttempt = lastRealAttempt('image-editing') ?? (await persistedAttempt('image-editing'))
    const hostedEditAvailable = Boolean(editAttempt?.ok)
    // BACKGROUND REMOVAL (2026-11-11): its own evidence chain (per-capability
    // attempt keys) — never advertised from conversational-editing's record.
    const bgAttempt = lastRealAttempt('image-bg-removal') ?? (await persistedAttempt('image-bg-removal'))
    // M26.2 local lanes: honest registry + model states (real files on disk).
    const localEditEnabled = getBackend('bean-image-local-edit')?.enabled === true
    const localSegEnabled = getBackend('bean-image-local-segmentation')?.enabled === true
    return ok({
      capabilities: {
        'strict-preserve': { available: true, engine: 'deterministic-sharp' },
        'conversational-edit': {
          // Available when ANY lane can genuinely execute: hosted evidence OR
          // the enabled local engine.
          available: hostedEditAvailable || localEditEnabled,
          engine: hostedEditAvailable ? 'hosted-edit' : localEditEnabled ? 'local-edit' : 'hosted-edit',
          engines: {
            hosted: {
              available: hostedEditAvailable,
              ...(hostedEditAvailable
                ? {}
                : { note: 'BLOCKED — ' + LAXII_EDIT_CONTRACT_BLOCKER.note, blockerSince: editAttempt?.at ?? LAXII_EDIT_CONTRACT_BLOCKER.measuredAt }),
            },
            local: {
              available: localEditEnabled,
              ...(localEditEnabled ? {} : { note: getBackend('bean-image-local-edit')?.unavailableReason ?? 'The local edit engine is not enabled on this deployment.' }),
            },
          },
        },
        'background-removal': {
          available: Boolean(bgAttempt?.ok) || localSegEnabled,
          engine: localSegEnabled ? 'local-segmentation' : 'hosted-edit+chroma-cutout',
          engines: {
            hosted: {
              available: Boolean(bgAttempt?.ok),
              ...(bgAttempt?.ok
                ? {}
                : {
                    note:
                      'Available only after a real two-stage run completes (hosted chroma separation + deterministic cutout). Measured constraint: the hosted endpoint has no direct alpha output, so the transparent PNG comes from the deterministic stage.',
                    ...(bgAttempt ? { blockerSince: bgAttempt.at } : {}),
                  }),
            },
            local: {
              available: localSegEnabled,
              ...(localSegEnabled
                ? { note: 'REAL neural matting (MODNet/u2netp) — true alpha at full source resolution, transparent PNG or explicit background export.' }
                : { note: getBackend('bean-image-local-segmentation')?.unavailableReason ?? 'The local matting lane is not enabled on this deployment.' }),
            },
          },
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
