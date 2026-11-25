/**
 * BEAN Intelligence — RIISHE SPECIALIST DELEGATION (M36-C, SERVER ONLY).
 *
 * RIISHE is the universal agent: when a conversation asks for image, video or
 * speech work, it delegates to the ESTABLISHING specialist products through
 * the EXISTING durable job queue — it never recreates them (brief §6: "Do not
 * recreate the same products inside RIISHE. Integrate their existing real
 * capability adapters.").
 *
 * Delegation properties (all preserved from the product submit routes):
 *  - the SAME router preflight gates run (product availability, rate limit,
 *    daily quota, budget guards) — delegation cannot bypass any limit;
 *  - the SAME duplicate-submission guard (an identical active job is refused);
 *  - the SAME durable GenerationJob row + worker pool executes the work, so
 *    cancellation, retries, timeout classification and Trust receipts behave
 *    exactly as for a job submitted from the product UI;
 *  - results are REAL job rows — the tool never claims a completed artifact,
 *    only an honestly queued submission the user can watch finish in the
 *    product's own history surface.
 *
 * Approval model: every delegation tool is 'explicit' — the server-side
 * permission key (route authority) AND the per-turn capability plan
 * (deterministic detection of an actual media request) must BOTH agree before
 * the model may submit anything. Without the plan's agreement the tool is not
 * even in the model's tool list; without the permission key the registry
 * refuses with an honest permission-denied result.
 */

import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { preflight } from '@/lib/router/router'
import { dedupeKeyFor, hasActiveDuplicate } from '@/lib/ai-engine/queue'
import { recordAudit } from '@/lib/observability/metering'
import { LAXII_SIZES } from '@/lib/registry/products'
import { chunkTextForTts } from '@/lib/adapters/hosted-audio'
import { GANGZII_VOICE_PRESETS, isHostedVoice, isKokoroVoice } from '@/lib/registry/gangzii-presets'
import type { ToolContext, ToolDescriptor, ToolResult } from './tools/types'
// ⚠️ IMPORT-CYCLE GUARD (M36): `@/lib/jobs/queue` must stay a DYNAMIC import.
// Its static chain is jobs/queue → ai-engine/handlers → riishe-chat-handler →
// orchestrator → tools/builtin-registry → THIS module — a static import here
// re-enters builtin-registry mid-body (TDZ on `registered`) at module load.
// The dynamic import resolves the module only when a delegation actually
// submits, which is after every module body has finished evaluating.
async function enqueueSpecialistJob(jobId: string): Promise<void> {
  const { enqueueJob } = await import('@/lib/jobs/queue')
  enqueueJob(jobId)
}

/** Customer-safe submit outcome (no backend ids, no provider identity). */
export interface SpecialistSubmission {
  ok: boolean
  jobId: string | null
  /** Capability-level product surface (never a backend identity). */
  surface: 'image-creation' | 'video-creation' | 'speech-synthesis'
  /** Honest status line for the model to relay verbatim. */
  status: string
  /** Customer-safe failure explanation when ok=false. */
  reason: string | null
}

/** One shared submission pipeline: gates → dedupe → durable row → worker.
 * M41: exported for the mission executor — the SAME gates, dedupe and
 * durable rows, so a mission's media tasks are indistinguishable from
 * product-submitted jobs in fairness and honesty. */
export async function submitSpecialistJob(
  userId: string,
  spec:
    | { product: 'laxii'; task: 'image-generation'; params: Record<string, unknown>; dedupe: Record<string, unknown> }
    | { product: 'jazmii'; task: 'video-generation'; params: Record<string, unknown>; dedupe: Record<string, unknown> }
    | { product: 'gangzii'; task: 'speech-synthesis'; params: Record<string, unknown>; dedupe: Record<string, unknown> },
): Promise<SpecialistSubmission> {
  // Same gates as the product route: availability, rate limit, quota, budget
  // guard. The concurrency slot is released immediately — the durable queue
  // slot is held by the background worker, exactly like every product submit.
  const { backend, release } = await preflight(userId, spec.product, spec.task)
  release()
  try {
    // Same duplicate guard as the product route: an identical ACTIVE job is
    // refused (double submissions would double-charge the shared account).
    const dedupeKey = dedupeKeyFor(userId, spec.product, spec.task, spec.dedupe)
    if (await hasActiveDuplicate(dedupeKey)) {
      return {
        ok: false,
        jobId: null,
        surface: spec.product === 'laxii' ? 'image-creation' : spec.product === 'jazmii' ? 'video-creation' : 'speech-synthesis',
        status: 'rejected',
        reason: 'An identical job is already queued or running — wait for it to finish before submitting the same request again.',
      }
    }
    const job = await db.generationJob.create({
      data: {
        userId,
        product: spec.product,
        task: spec.task,
        status: 'queued',
        backendId: backend.id,
        dedupeKey,
        paramsJson: JSON.stringify(spec.params),
      },
    })
    await recordAudit({
      actorId: userId,
      action: 'riishe.specialist_submit',
      target: job.id,
      meta: { product: spec.product, task: spec.task, via: 'riishe-delegation' },
    })
    await enqueueSpecialistJob(job.id)
    return {
      ok: true,
      jobId: job.id,
      surface: spec.product === 'laxii' ? 'image-creation' : spec.product === 'jazmii' ? 'video-creation' : 'speech-synthesis',
      status: 'queued',
      reason: null,
    }
  } catch (e) {
    // Typed product errors become honest refusals — the model must relay the
    // limitation, never claim the work happened.
    if (e instanceof BeanApiError) {
      return {
        ok: false,
        jobId: null,
        surface: spec.product === 'laxii' ? 'image-creation' : spec.product === 'jazmii' ? 'video-creation' : 'speech-synthesis',
        status: 'rejected',
        reason: e.message,
      }
    }
    throw e
  }
}

// ---------------------------------------------------------------------------
// Image creation → LAXII
// ---------------------------------------------------------------------------

const laxiiSizes: string[] = LAXII_SIZES.map((s) => s.value)

export interface GenerateImageInput {
  prompt: string
  size?: string
  width?: number
  height?: number
}

/** Validate with the SAME rules as the LAXII generate route (honest 422s). */
export function validateGenerateImageInput(input: unknown): GenerateImageInput {
  const rec = (input ?? {}) as Record<string, unknown>
  const prompt = typeof rec.prompt === 'string' ? rec.prompt.trim() : ''
  if (prompt.length < 3) throw new Error('Describe the image you want (at least 3 characters).')
  if (prompt.length > 4000) throw new Error('The image description must be at most 4000 characters.')
  const out: GenerateImageInput = { prompt }
  const hasSize = typeof rec.size === 'string' && laxiiSizes.includes(rec.size as string)
  if (hasSize) {
    out.size = rec.size as string
    return out
  }
  // Optional explicit dimensions — validated against the same pixel bounds
  // the product route enforces (no preset + custom mixing).
  const width = typeof rec.width === 'number' ? Math.round(rec.width) : undefined
  const height = typeof rec.height === 'number' ? Math.round(rec.height) : undefined
  if (width !== undefined || height !== undefined) {
    if (width === undefined || height === undefined) {
      throw new Error('Provide BOTH width and height for custom dimensions, or use a preset size.')
    }
    if (width < 256 || height < 256) throw new Error('Custom dimensions must be at least 256px on each side.')
    if (width > 2048 || height > 2048) throw new Error('Custom dimensions must be at most 2048px on each side.')
    out.width = width
    out.height = height
  }
  return out
}

export const generateImageTool: ToolDescriptor<GenerateImageInput> = {
  name: 'generate_image',
  description:
    'Delegate image creation to the BEAN image-creation specialist: submits a real background image-generation job from a text description. Use when the user asks you to create or draw a picture. Returns a queued job id — the finished image appears in the Image Studio history when done; never claim the image itself is ready.',
  permission: 'explicit',
  permissionKey: 'allowImageGeneration',
  validate: validateGenerateImageInput,
  timeoutMs: 20_000,
  async execute(input: GenerateImageInput, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.permissions.has('allowImageGeneration')) {
      return { ok: false, output: 'Permission denied: image creation was not approved for this request.' }
    }
    const userId = ctx.userId
    if (!userId) return { ok: false, output: 'Image creation requires an authenticated session.' }
    const params = input.width !== undefined && input.height !== undefined
      ? { prompt: input.prompt, width: input.width, height: input.height }
      : { prompt: input.prompt, size: (input.size ?? laxiiSizes[0]) as string }
    const dedupe = params as Record<string, unknown>
    const submission = await submitSpecialistJob(userId, {
      product: 'laxii',
      task: 'image-generation',
      params,
      dedupe,
    })
    if (!submission.ok) {
      return { ok: false, output: `Image creation was not submitted: ${submission.reason}` }
    }
    return {
      ok: true,
      output:
        `Image creation job submitted successfully (job id ${submission.jobId}, status: queued). ` +
        'The image is being generated in the background by the image specialist; when it completes it appears in the user\u2019s image history. ' +
        'Tell the user the request is queued and do NOT claim the image is ready.',
    }
  },
}

// ---------------------------------------------------------------------------
// Video creation → JAZMII (text-to-video only; the reference-image flow
// stays a JAZMII product-surface capability, where the upload UI lives)
// ---------------------------------------------------------------------------

export interface CreateVideoInput {
  prompt: string
  size?: string
}

const VIDEO_SIZES = ['1280x720', '720x1280', '1024x1024'] as const

export function validateCreateVideoInput(input: unknown): CreateVideoInput {
  const rec = (input ?? {}) as Record<string, unknown>
  const prompt = typeof rec.prompt === 'string' ? rec.prompt.trim() : ''
  if (prompt.length < 3) throw new Error('Describe the video you want (at least 3 characters).')
  if (prompt.length > 2000) throw new Error('The video description must be at most 2000 characters.')
  const out: CreateVideoInput = { prompt }
  if (typeof rec.size === 'string') {
    if (!(VIDEO_SIZES as readonly string[]).includes(rec.size)) {
      throw new Error(`Unsupported video size. Supported: ${VIDEO_SIZES.join(', ')}.`)
    }
    out.size = rec.size
  }
  return out
}

export const createVideoTool: ToolDescriptor<CreateVideoInput> = {
  name: 'create_video',
  description:
    'Delegate video creation to the BEAN video specialist: submits a real background text-to-video job. Use when the user asks you to make a short video clip from a description. Returns a queued job id — the finished video appears in the video studio history when done; never claim the video is ready.',
  permission: 'explicit',
  permissionKey: 'allowVideoCreation',
  validate: validateCreateVideoInput,
  timeoutMs: 20_000,
  async execute(input: CreateVideoInput, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.permissions.has('allowVideoCreation')) {
      return { ok: false, output: 'Permission denied: video creation was not approved for this request.' }
    }
    const userId = ctx.userId
    if (!userId) return { ok: false, output: 'Video creation requires an authenticated session.' }
    const params: Record<string, unknown> = { prompt: input.prompt }
    if (input.size) params.size = input.size
    const submission = await submitSpecialistJob(userId, {
      product: 'jazmii',
      task: 'video-generation',
      params,
      dedupe: { prompt: input.prompt, imageUrl: null, quality: null, withAudio: null, size: input.size ?? null, durationSec: null, fps: null },
    })
    if (!submission.ok) {
      return { ok: false, output: `Video creation was not submitted: ${submission.reason}` }
    }
    return {
      ok: true,
      output:
        `Video creation job submitted successfully (job id ${submission.jobId}, status: queued). ` +
        'The clip is being generated in the background by the video specialist; when it completes it appears in the user\u2019s video history. ' +
        'Tell the user the request is queued and do NOT claim the video is ready.',
    }
  },
}

// ---------------------------------------------------------------------------
// Speech synthesis → GANGZII
// ---------------------------------------------------------------------------

export interface SynthesizeSpeechInput {
  text: string
  voice?: string
}

const SPEECH_MAX_CHARS = 1000
const DEFAULT_VOICE = GANGZII_VOICE_PRESETS[0]?.id

export function validateSynthesizeSpeechInput(input: unknown): SynthesizeSpeechInput {
  const rec = (input ?? {}) as Record<string, unknown>
  const text = typeof rec.text === 'string' ? rec.text.trim() : ''
  if (text.length === 0) throw new Error('Provide the text to speak.')
  if (text.length > SPEECH_MAX_CHARS) {
    throw new Error(`The text to speak must be at most ${SPEECH_MAX_CHARS} characters (got ${text.length}).`)
  }
  const out: SynthesizeSpeechInput = { text }
  if (typeof rec.voice === 'string' && rec.voice.length > 0) {
    out.voice = rec.voice
  }
  return out
}

export const synthesizeSpeechTool: ToolDescriptor<SynthesizeSpeechInput> = {
  name: 'synthesize_speech',
  description:
    'Delegate speech synthesis to the BEAN audio specialist: submits a real background text-to-speech job (spoken audio for up to 1000 characters of text). Use when the user asks you to read text aloud or produce a voice clip. Returns a queued job id — the finished audio appears in the audio studio history when done; never claim the audio is ready.',
  permission: 'explicit',
  permissionKey: 'allowSpeechSynthesis',
  validate: validateSynthesizeSpeechInput,
  timeoutMs: 20_000,
  async execute(input: SynthesizeSpeechInput, ctx: ToolContext): Promise<ToolResult> {
    if (!ctx.permissions.has('allowSpeechSynthesis')) {
      return { ok: false, output: 'Permission denied: speech synthesis was not approved for this request.' }
    }
    const userId = ctx.userId
    if (!userId) return { ok: false, output: 'Speech synthesis requires an authenticated session.' }
    const voice = input.voice ?? DEFAULT_VOICE
    if (!voice || typeof voice !== 'string') {
      return { ok: false, output: 'No voice is configured for speech synthesis on this deployment.' }
    }
    // Honest voice validation BEFORE any job row: an unknown voice id must
    // never silently map to a different voice (no voice substitution).
    if (!isHostedVoice(voice) && !isKokoroVoice(voice)) {
      return { ok: false, output: `Speech synthesis was not submitted: the requested voice is not available. Use one of the available preset voices.` }
    }
    // Same fail-fast as the product route: the hosted engine's chunk math is
    // validated BEFORE any job row exists (honest refusal, no doomed job).
    if (isHostedVoice(voice)) {
      try {
        chunkTextForTts(input.text)
      } catch (e) {
        return { ok: false, output: `Speech synthesis was not submitted: ${e instanceof Error ? e.message : 'text exceeds the per-request limit'}` }
      }
    }
    const params: Record<string, unknown> = { text: input.text, voice, speed: 1.0, source: 'studio' }
    const submission = await submitSpecialistJob(userId, {
      product: 'gangzii',
      task: 'speech-synthesis',
      params,
      dedupe: params,
    })
    if (!submission.ok) {
      return { ok: false, output: `Speech synthesis was not submitted: ${submission.reason}` }
    }
    return {
      ok: true,
      output:
        `Speech synthesis job submitted successfully (job id ${submission.jobId}, status: queued). ` +
        'The audio is being produced in the background by the audio specialist; when it completes it appears in the user\u2019s audio history. ' +
        'Tell the user the request is queued and do NOT claim the audio is ready.',
    }
  },
}

/** Test/ops seam: names of the delegation tools in registration order. */
export const SPECIALIST_TOOL_NAMES = ['generate_image', 'create_video', 'synthesize_speech'] as const
