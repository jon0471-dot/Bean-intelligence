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
import { resolveProvider } from '@/lib/laxii/provider'
import { generativeWorkerStatus } from '@/lib/laxii/models'
import { MIN_DIMENSION_PX, MAX_DIMENSION_PX } from '@/lib/laxii/dimensions'
import { detectIntent, titleFromText, normalizeJobStatus, requireImageAsset, resolveConversationImage, serializeLaxiiMessages } from '@/lib/laxii/chat'

/** Custom-dimension bounds mirror the authoritative generate-route checks. */
const sizeOverrideSchema = z
  .object({
    size: z.string().regex(/^\d{3,4}x\d{3,4}$/, 'Unsupported dimension — pick one from the size list.').optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
  })
  .refine(
    (v) => v.size !== undefined || (v.width !== undefined && v.height !== undefined),
    { message: 'Custom dimensions require numeric width and height.' },
  )
  .superRefine((v, ctx) => {
    const check = (key: 'width' | 'height', value?: number) => {
      if (value === undefined) return
      if (value < MIN_DIMENSION_PX) {
        ctx.addIssue({ code: 'custom', path: [key], message: `Custom ${key} must be at least ${MIN_DIMENSION_PX}px — smaller images fall apart.` })
      } else if (value > MAX_DIMENSION_PX) {
        ctx.addIssue({ code: 'custom', path: [key], message: `Custom ${key} exceeds the ${MAX_DIMENSION_PX}px maximum for image generation.` })
      }
    }
    check('width', v.width)
    check('height', v.height)
  })

const schema = z.object({
  conversationId: z.string().min(1).optional(),
  text: z.string().max(4000).default(''),
  assetId: z.string().min(1).optional(),
  /** Mask-asset ids from the inline painter — completes a masked-edit flow. */
  maskAssetIds: z.array(z.string().min(1)).max(8).optional(),
  /** Composer dimension choice for generation intents (NL hints still win
   *  when the user typed explicit dimensions). */
  sizeOverride: sizeOverrideSchema.optional(),
})

/**
 * LAXII — one conversational turn.
 *
 * Persists the user message, classifies the request against the EXISTING
 * capability set (deterministic classifier — no LLM, no guessing) and either
 * queues the corresponding job through the very same submission semantics
 * the product routes use (preflight → dedupe guard → job row → enqueue), or
 * answers with an honest clarification. Every submitted job is linked to an
 * assistant message; its state is ALWAYS read back from GenerationJob —
 * this route never fabricates a state or an output.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)
    const text = body.text.trim()
    if (!text && !body.assetId && !(body.maskAssetIds && body.maskAssetIds.length)) {
      throw new BeanApiError('VALIDATION_ERROR', 'Write a message or attach an image.')
    }

    // ---- conversation (create when absent) --------------------------------
    let conversationId = body.conversationId
    if (conversationId) {
      const conv = await db.laxiiConversation.findUnique({ where: { id: conversationId } })
      if (!conv || conv.userId !== user.id) {
        throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
      }
    } else {
      const conv = await db.laxiiConversation.create({
        data: { userId: user.id, title: titleFromText(text) },
      })
      conversationId = conv.id
    }

    // ---- attachment (fresh upload rides with this message) ----------------
    if (body.assetId) {
      await loadAsset(user.id, body.assetId) // ownership + existence
    }

    // ---- persisted user message -------------------------------------------
    const userMessage = await db.laxiiMessage.create({
      data: {
        conversationId,
        role: 'user',
        kind: 'text',
        text: text || null,
        assetId: body.assetId ?? null,
        maskAssetIds: body.maskAssetIds && body.maskAssetIds.length ? JSON.stringify(body.maskAssetIds) : null,
        metaJson: JSON.stringify({}),
      },
    })

    // ---- classify ----------------------------------------------------------
    const imageRef = body.assetId
      ? { assetId: body.assetId }
      : await resolveConversationImage(conversationId)
    const decision = detectIntent({
      text,
      hasAttachedImage: Boolean(body.assetId),
      conversationHasImage: Boolean(imageRef),
    })

    // ---- submit / answer ---------------------------------------------------
    const assistantMessage = await submitOrAnswer({
      userId: user.id,
      conversationId,
      text,
      decision,
      sourceAssetId: imageRef?.assetId ?? null,
      maskAssetIds: body.maskAssetIds ?? null,
      sizeOverride: body.sizeOverride ?? null,
    })

    await db.laxiiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })

    const [userOut, assistantOut] = await serializeLaxiiMessages([userMessage, assistantMessage])
    return ok(
      {
        conversation: { id: conversationId },
        messages: [userOut, assistantOut],
      },
      { status: 201 },
    )
  })
}

/**
 * Route the classified request onto the existing job pipeline, or produce
 * the honest conversational answer (clarification / mask request / real
 * backend error). Job submission mirrors the product routes EXACTLY:
 * preflight → duplicate guard → GenerationJob row → enqueue → audit.
 */
async function submitOrAnswer(ctx: {
  userId: string
  conversationId: string
  text: string
  decision: ReturnType<typeof detectIntent>
  sourceAssetId: string | null
  maskAssetIds: string[] | null
  sizeOverride: { size?: string; width?: number; height?: number } | null
}) {
  const { userId, conversationId, decision, sourceAssetId, maskAssetIds } = ctx
  const d = decision

  const answer = async (kind: string, message: string, meta: Record<string, unknown> = {}) =>
    db.laxiiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        kind,
        text: message,
        metaJson: JSON.stringify(meta),
      },
    })

  const failAnswer = async (e: unknown, what: string) => {
    const message = e instanceof BeanApiError ? e.message : e instanceof Error ? e.message.slice(0, 240) : `${what} failed.`
    const code = e instanceof BeanApiError ? e.code : 'BACKEND_FAILURE'
    // GENUINE backend error — surfaced verbatim in the conversation, never
    // dressed up as success and never invented.
    return answer('text', message, { errorCode: code, failed: what })
  }

  try {
    // ---- masked-edit completion (masks were just painted) ------------------
    if (maskAssetIds && maskAssetIds.length > 0) {
      const worker = generativeWorkerStatus()
      if (!worker.registryEnabled) {
        return answer(
          'text',
          'Masked generative editing needs the local Diffusers worker, which has not passed its hardware preflight in this deployment — so I refuse the job instead of silently regenerating your image. I can run a whole-image AI edit instead (fast, but not pixel-exact): say "edit the whole image" to do that.',
          { errorCode: 'PROVIDER_UNAVAILABLE', maskedEditUnavailable: true },
        )
      }
      const mode = d.maskMode ?? 'smart-edit'
      await requireImageAsset(userId, sourceAssetId ?? '')
      for (const id of maskAssetIds) {
        const m = await loadAsset(userId, id)
        if (m.kind !== 'mask') throw new BeanApiError('VALIDATION_ERROR', 'Masks must be mask assets.')
      }
      resolveProvider(mode === 'object-removal' ? 'object-removal' : 'masked-inpaint')
      const { backend, release } = await preflight(userId, 'laxii', 'image-editing')
      release()
      const maskStrokes = maskAssetIds.map((assetId) => ({ assetId, kind: 'edit' as const }))
      const params =
        mode === 'object-removal'
          ? { mode: 'object-removal', assetId: sourceAssetId, maskStrokes, shaping: { expandPx: 4, featherPx: 8 } }
          : {
              mode: 'smart-edit',
              assetId: sourceAssetId,
              maskStrokes,
              faceZones: [],
              shaping: { expandPx: 2, featherPx: 8 },
              prompt: d.prompt.length >= 3 ? d.prompt : 'match the surrounding content',
            }
      const dedupeKey = dedupeKeyFor(userId, 'laxii', 'image-editing', params)
      if (await hasActiveDuplicate(dedupeKey)) {
        throw new BeanApiError('CONCURRENCY_LIMIT', 'An identical edit job is already queued or running. Wait for it to finish.')
      }
      const job = await db.generationJob.create({
        data: {
          userId,
          product: 'laxii',
          task: 'image-editing',
          status: 'queued',
          backendId: 'bean-image-selfhosted-diffusers',
          dedupeKey,
          paramsJson: JSON.stringify(params),
        },
      })
      await recordAudit({ actorId: userId, action: 'laxii.edit_submit', target: job.id, meta: { mode, via: 'chat' } })
      enqueueJob(job.id)
      return db.laxiiMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          kind: 'job',
          jobId: job.id,
          metaJson: JSON.stringify({ intent: 'masked-edit', maskMode: mode }),
        },
      })
    }

    // ---- clarify ------------------------------------------------------------
    if (d.intent === 'clarify') {
      return answer('clarify', d.clarifyQuestion ?? 'Could you say a little more about what you want?', {
        clarifyReason: d.clarifyReason ?? null,
      })
    }

    // ---- generate (text-to-image) -------------------------------------------
    if (d.intent === 'generate') {
      const prompt = d.prompt.trim()
      if (prompt.length < 3) throw new BeanApiError('VALIDATION_ERROR', 'Describe the image you want (at least 3 characters).')
      if (prompt.length > 4000) throw new BeanApiError('VALIDATION_ERROR', 'Prompt is too long (max 4000 characters).')
      // Dimension precedence: explicit "WxH" typed in the message wins, then
      // the composer's dimension control, then the auto-detected preset.
      const typedSize = d.width !== undefined && d.height !== undefined
      const override = ctx.sizeOverride
      const isCustom = typedSize || (override?.width !== undefined && override?.height !== undefined)
      const width = typedSize ? d.width : override?.width
      const height = typedSize ? d.height : override?.height
      const size = typedSize ? undefined : (override?.size ?? d.size ?? '1024x1024')
      if (!isCustom && !size) throw new BeanApiError('VALIDATION_ERROR', 'Unsupported dimension — pick one from the size list.')
      const { backend, release } = await preflight(userId, 'laxii', 'image-generation')
      release()
      const params = isCustom ? { prompt, width, height } : { prompt, size }
      const dedupeKey = dedupeKeyFor(userId, 'laxii', 'image-generation', params)
      if (await hasActiveDuplicate(dedupeKey)) {
        throw new BeanApiError('CONCURRENCY_LIMIT', 'An identical image generation is already queued or running. Wait for it to finish.')
      }
      const job = await db.generationJob.create({
        data: {
          userId,
          product: 'laxii',
          task: 'image-generation',
          status: 'queued',
          backendId: backend.id,
          dedupeKey,
          paramsJson: JSON.stringify(params),
        },
      })
      await recordAudit({
        actorId: userId,
        action: 'laxii.submit',
        target: job.id,
        meta: isCustom ? { width, height, custom: true, promptChars: prompt.length, via: 'chat' } : { size, promptChars: prompt.length, via: 'chat' },
      })
      enqueueJob(job.id)
      return db.laxiiMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          kind: 'job',
          jobId: job.id,
          metaJson: JSON.stringify({ intent: 'generate' }),
        },
      })
    }

    // ---- everything image-backed needs a source image ------------------------
    if (!sourceAssetId) {
      return answer(
        'clarify',
        'Which image should I work on? Attach one with the paperclip button, or ask me to generate one first.',
        { clarifyReason: 'missing-image' },
      )
    }
    await requireImageAsset(userId, sourceAssetId)

    // ---- background removal ---------------------------------------------------
    if (d.intent === 'bg-removal') {
      resolveProvider('hosted-edit')
      const { backend, release } = await preflight(userId, 'laxii', 'image-editing')
      release()
      const params = { mode: 'background-removal', assetId: sourceAssetId }
      const dedupeKey = dedupeKeyFor(userId, 'laxii', 'image-editing', params)
      if (await hasActiveDuplicate(dedupeKey)) {
        throw new BeanApiError('CONCURRENCY_LIMIT', 'An identical edit job is already queued or running. Wait for it to finish.')
      }
      const job = await db.generationJob.create({
        data: {
          userId,
          product: 'laxii',
          task: 'image-editing',
          status: 'queued',
          backendId: 'bean-image-hosted-edit',
          dedupeKey,
          paramsJson: JSON.stringify(params),
        },
      })
      await recordAudit({ actorId: userId, action: 'laxii.edit_submit', target: job.id, meta: { mode: 'background-removal', via: 'chat' } })
      enqueueJob(job.id)
      return db.laxiiMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          kind: 'job',
          jobId: job.id,
          metaJson: JSON.stringify({ intent: 'bg-removal' }),
        },
      })
    }

    // ---- enhance / upscale (deterministic engine, optional Lanczos factor) ----
    if (d.intent === 'enhance' || d.intent === 'upscale') {
      const upscaleFactor = d.intent === 'upscale' ? d.upscaleFactor ?? 2 : 1
      await preflight(userId, 'laxii', 'image-enhancement').then((p) => p.release())
      const params = {
        assetId: sourceAssetId,
        maskStrokes: [],
        faceZones: [],
        shaping: { expandPx: 0, featherPx: 4 },
        options: {
          denoise: true,
          exposureWhiteBalance: true,
          grade: true,
          localContrast: true,
          ...(upscaleFactor > 1 ? { upscaleFactor } : {}),
          allowGlobalColor: true,
        },
        globalColor: true,
      }
      const dedupeKey = dedupeKeyFor(userId, 'laxii', 'image-enhancement', params)
      if (await hasActiveDuplicate(dedupeKey)) {
        throw new BeanApiError('CONCURRENCY_LIMIT', 'An identical enhancement is already queued or running. Wait for it to finish.')
      }
      const job = await db.generationJob.create({
        data: {
          userId,
          product: 'laxii',
          task: 'image-enhancement',
          status: 'queued',
          backendId: 'bean-image-local-sharp',
          dedupeKey,
          paramsJson: JSON.stringify(params),
        },
      })
      await recordAudit({ actorId: userId, action: 'laxii.enhance_submit', target: job.id, meta: { assetId: sourceAssetId, masked: false, upscaleFactor, via: 'chat' } })
      enqueueJob(job.id)
      return db.laxiiMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          kind: 'job',
          jobId: job.id,
          metaJson: JSON.stringify({ intent: d.intent, upscaleFactor }),
        },
      })
    }

    // ---- masked-edit request (no masks yet) ------------------------------------
    if (d.intent === 'masked-edit') {
      if (!sourceAssetId) {
        return answer('clarify', 'Which image should I work on? Attach one with the paperclip button, or ask me to generate one first.', { clarifyReason: 'missing-image' })
      }
      const worker = generativeWorkerStatus()
      if (!worker.registryEnabled) {
        // Truthful boundary: masked generative editing is worker-gated and the
        // worker is not verified in this deployment. Offer the hosted
        // whole-image edit as the honest alternative — never claim masked
        // precision the engine cannot deliver.
        return answer(
          'text',
          'A localized change needs the local Diffusers worker for masked, pixel-precise editing — it is not verified in this deployment, so I will not pretend the rest of your image would stay untouched. I can run a whole-image AI edit instead (fast, not pixel-exact) — say "edit the whole image" if that works for you.',
          { errorCode: 'PROVIDER_UNAVAILABLE', maskedEditUnavailable: true, offerWholeImageEdit: true, originalText: ctx.text },
        )
      }
      return db.laxiiMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          kind: 'mask-request',
          text:
            'Mark the region to change: paint over it in the image below (gold = will change). I will only change what you paint.',
          assetId: sourceAssetId,
          metaJson: JSON.stringify({ intent: 'masked-edit', maskMode: d.maskMode ?? 'smart-edit', prompt: ctx.text, workerAvailable: true }),
        },
      })
    }

    // ---- edit / image-to-image (hosted conversational edit) --------------------
    if (d.intent === 'edit' || d.intent === 'image-to-image') {
      const prompt = d.prompt.trim()
      if (prompt.length < 3) throw new BeanApiError('VALIDATION_ERROR', 'Describe the edit in a few more words.')
      resolveProvider('hosted-edit')
      const { backend, release } = await preflight(userId, 'laxii', 'image-editing')
      release()
      const params = { mode: 'conversational-edit', assetId: sourceAssetId, prompt: prompt.slice(0, 2000) }
      const dedupeKey = dedupeKeyFor(userId, 'laxii', 'image-editing', params)
      if (await hasActiveDuplicate(dedupeKey)) {
        throw new BeanApiError('CONCURRENCY_LIMIT', 'An identical edit job is already queued or running. Wait for it to finish.')
      }
      const job = await db.generationJob.create({
        data: {
          userId,
          product: 'laxii',
          task: 'image-editing',
          status: 'queued',
          backendId: 'bean-image-hosted-edit',
          dedupeKey,
          paramsJson: JSON.stringify(params),
        },
      })
      await recordAudit({ actorId: userId, action: 'laxii.edit_submit', target: job.id, meta: { mode: 'conversational-edit', via: 'chat', intent: d.intent } })
      enqueueJob(job.id)
      return db.laxiiMessage.create({
        data: {
          conversationId,
          role: 'assistant',
          kind: 'job',
          jobId: job.id,
          metaJson: JSON.stringify({ intent: d.intent }),
        },
      })
    }

    return answer('clarify', 'Could you say a little more about what you want?', { clarifyReason: 'unrouted' })
  } catch (e) {
    return failAnswer(e, 'submit')
  }
}

export const dynamic = 'force-dynamic'

/** Exported for tests: the status vocabulary shared with the product routes. */
export { normalizeJobStatus }
