import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { enqueueJob } from '@/lib/jobs/queue'
import { dedupeKeyFor, hasActiveDuplicate } from '@/lib/ai-engine/queue'
import { recordAudit } from '@/lib/observability/metering'
import { ensureVideoPoller } from '@/lib/jobs/video-worker'
import { jazmiiTitleFromText, serializeJazmiiMessages } from '@/lib/jazmii/chat'
import { validateVideoReferenceImage } from '@/lib/jazmii/reference-image'

/**
 * JAZMII — one conversational turn (2026-11-12 unified studio).
 *
 * The composer IS the prompt form: natural-language video prompt, optional
 * reference image (image-to-video) and the generation settings chosen in the
 * compact settings panel. Job submission uses the EXACT same semantics as
 * POST /api/jazmii/generate — same zod bounds, same preflight, same dedupe
 * guard, same paramsJson shape — so provider routing, retry logic, poller
 * recovery and the background engine behave identically. The assistant
 * message links the job; its state is ALWAYS read back from GenerationJob.
 */
const settingsSchema = z.object({
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
  quality: z.enum(['speed', 'quality']).optional(),
  withAudio: z.boolean().optional(),
})

const schema = z.object({
  conversationId: z.string().min(1).optional(),
  text: z.string().max(2000),
  /** Image-to-video driver: https URL or base64 data URL (provider-validated). */
  imageUrl: z
    .string()
    .max(8_000_000)
    .refine(
      (v) => /^https:\/\//.test(v) || /^data:image\/(png|jpeg|jpg|webp);base64,/.test(v),
      'imageUrl must be an https URL or a base64 data URL (png/jpeg/webp).',
    )
    .optional(),
  settings: settingsSchema.optional(),
})

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)
    const text = body.text.trim()
    if (text.length < 3) {
      throw new BeanApiError('VALIDATION_ERROR', 'Describe the video you want (at least 3 characters).')
    }
    const settings = body.settings ?? {}

    // LAXII-JAZMII RESTORATION (2026-11-14, defect D3): same server-side
    // reference-image validation as POST /api/jazmii/generate — identical
    // semantics on both submit paths (decodable still image, format,
    // dimensions, byte cap, SSRF-guarded fetch), before any job row exists.
    const imageValidation = body.imageUrl ? await validateVideoReferenceImage(body.imageUrl) : null
    if (imageValidation && !imageValidation.ok) {
      throw new BeanApiError('VALIDATION_ERROR', imageValidation.reason ?? 'The reference image is not usable.')
    }

    // ---- conversation (create when absent) --------------------------------
    let conversationId = body.conversationId
    if (conversationId) {
      const conv = await db.jazmiiConversation.findUnique({ where: { id: conversationId } })
      if (!conv || conv.userId !== user.id) {
        throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
      }
    } else {
      const conv = await db.jazmiiConversation.create({
        data: { userId: user.id, title: jazmiiTitleFromText(text) },
      })
      conversationId = conv.id
    }

    // ---- job submission: EXACT generate-route semantics ---------------------
    const { backend, release } = await preflight(user.id, 'jazmii', 'video-generation')
    let job
    try {
      const dedupeKey = dedupeKeyFor(user.id, 'jazmii', 'video-generation', {
        prompt: text,
        imageUrl: body.imageUrl ? `${body.imageUrl.slice(0, 48)}#${body.imageUrl.length}` : null,
        quality: settings.quality ?? null,
        withAudio: settings.withAudio ?? null,
        size: settings.size ?? null,
        durationSec: settings.durationSec ?? null,
        fps: settings.fps ?? null,
      })
      if (await hasActiveDuplicate(dedupeKey)) {
        throw new BeanApiError(
          'CONCURRENCY_LIMIT',
          'An identical video job is already queued or running. Wait for it to finish.',
        )
      }
      job = await db.generationJob.create({
        data: {
          userId: user.id,
          product: 'jazmii',
          task: 'video-generation',
          status: 'queued',
          progress: 0,
          dedupeKey,
          paramsJson: JSON.stringify({
            prompt: text,
            ...(body.imageUrl ? { imageUrl: body.imageUrl } : {}),
            // Additive measured validation summary (identical to the generate
            // route; never substitutes the original reference).
            ...(imageValidation ? { imageValidation: { format: imageValidation.format, width: imageValidation.width, height: imageValidation.height, bytes: imageValidation.bytes } } : {}),
            ...(settings.quality ? { quality: settings.quality } : {}),
            ...(settings.withAudio !== undefined ? { withAudio: settings.withAudio } : {}),
            ...(settings.size ? { size: settings.size } : {}),
            ...(settings.durationSec ? { durationSec: settings.durationSec } : {}),
            ...(settings.fps ? { fps: settings.fps } : {}),
          }),
        },
      })
      await recordAudit({
        actorId: user.id,
        action: 'jazmii.submit',
        target: job.id,
        meta: {
          promptChars: text.length,
          hasReference: Boolean(body.imageUrl),
          ...(settings.size ? { size: settings.size } : {}),
          ...(settings.durationSec ? { durationSec: settings.durationSec } : {}),
          via: 'chat',
        },
      })
      enqueueJob(job.id)
    } finally {
      release()
    }

    // ---- persisted messages -------------------------------------------------
    const userMessage = await db.jazmiiMessage.create({
      data: {
        conversationId,
        role: 'user',
        kind: 'text',
        text,
        metaJson: JSON.stringify({
          hasReferenceImage: Boolean(body.imageUrl),
          ...(settings.size ? { size: settings.size } : {}),
          ...(settings.durationSec ? { durationSec: settings.durationSec } : {}),
          ...(settings.quality ? { quality: settings.quality } : {}),
          ...(settings.withAudio !== undefined ? { withAudio: settings.withAudio } : {}),
        }),
      },
    })
    const assistantMessage = await db.jazmiiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        kind: 'job',
        jobId: job.id,
        metaJson: JSON.stringify({}),
      },
    })
    await db.jazmiiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })

    // Recovery parity with the list route: the fresh job gets its poller now.
    ensureVideoPoller({
      id: job.id,
      userId: user.id,
      product: 'jazmii',
      task: 'video-generation',
      status: 'queued',
      paramsJson: job.paramsJson,
      resultJson: null,
    })

    const [userOut, assistantOut] = await serializeJazmiiMessages([userMessage, assistantMessage])
    return ok(
      {
        conversation: { id: conversationId },
        messages: [userOut, assistantOut],
      },
      { status: 201 },
    )
  })
}

export const dynamic = 'force-dynamic'
