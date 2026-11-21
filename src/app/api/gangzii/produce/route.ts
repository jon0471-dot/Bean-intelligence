/**
 * GANGZII — audio production jobs (M27).
 * GET  → owner's production history (measured loudness + master label).
 * POST → submit a REAL audio-production job: bounded operations on
 *        owner-checked source assets, ffprobe validation + EBUR128
 *        measurement on the result before `completed` is ever set.
 */
import { z } from 'zod'
import { db } from '@/lib/db'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { preflight } from '@/lib/router/router'
import { enqueueJob } from '@/lib/jobs/queue'
import { recordAudit } from '@/lib/observability/metering'

const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('trim'), params: z.object({ startSec: z.number().min(0).max(3600), endSec: z.number().min(0).max(3600).optional() }).optional() }),
  z.object({ op: z.literal('fade-in'), params: z.object({ durationSec: z.number().min(0.05).max(15) }).optional() }),
  z.object({ op: z.literal('fade-out'), params: z.object({ durationSec: z.number().min(0.05).max(15) }).optional() }),
  z.object({ op: z.literal('volume'), params: z.object({ gain: z.number().min(0).max(2) }).optional() }),
  z.object({ op: z.literal('duck'), params: z.object({ duckTo: z.number().min(0.05).max(1) }).optional() }),
  z.object({
    // M28 Priority C: timeline-aware ducking from measured narration regions.
    op: z.literal('duck-dynamic'),
    params: z.object({
      regions: z.array(z.object({ startSec: z.number().min(0).max(7200), endSec: z.number().min(0).max(7200) })).min(1).max(50),
      duckTo: z.number().min(0.05).max(1).optional(),
      attackMs: z.number().int().min(0).max(2000).optional(),
      releaseMs: z.number().int().min(0).max(2000).optional(),
      curve: z.enum(['linear', 'cosine']).optional(),
      minMusicLevel: z.number().min(0).max(1).optional(),
    }),
  }),
  z.object({ op: z.literal('eq'), params: z.object({ lowGainDb: z.number().min(-12).max(12).optional(), lowFreqHz: z.number().min(40).max(500).optional(), highGainDb: z.number().min(-12).max(12).optional(), highFreqHz: z.number().min(2000).max(16000).optional() }).optional() }),
  z.object({ op: z.literal('compress'), params: z.object({ thresholdDb: z.number().min(-50).max(0).optional(), ratio: z.number().min(1).max(20).optional(), attackMs: z.number().min(1).max(200).optional(), releaseMs: z.number().min(10).max(2000).optional() }).optional() }),
  z.object({ op: z.literal('limit'), params: z.object({ limitDbtp: z.number().min(-6).max(0).optional() }).optional() }),
  z.object({ op: z.literal('normalize-loudness'), params: z.object({ targetLufs: z.number().min(-30).max(-6).optional(), truePeakDbtp: z.number().min(-6).max(0).optional() }).optional() }),
  z.object({ op: z.literal('concat') }),
])

const schema = z.object({
  sourceAssetId: z.string().regex(/^[\w-]+$/),
  operations: z.array(opSchema).min(1).max(12),
  output: z.object({
    format: z.enum(['wav', 'mp3', 'm4a']),
    channels: z.union([z.literal(1), z.literal(2)]).optional(),
    sampleRateHz: z.union([z.literal(24_000), z.literal(44_100), z.literal(48_000)]).optional(),
  }),
})

export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const jobs = await db.generationJob.findMany({
      where: { userId: user.id, product: 'gangzii', task: 'audio-production' },
      orderBy: { queuedAt: 'desc' },
      take: 25,
    })
    return ok({
      jobs: jobs.map((j) => {
        const result = j.resultJson ? (JSON.parse(j.resultJson) as Record<string, unknown>) : null
        return {
          id: j.id,
          status: j.status,
          progress: j.progress,
          errorCode: j.errorCode,
          errorMessage: j.errorMessage,
          result,
          queuedAt: j.queuedAt,
        }
      }),
    })
  })
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, schema)
    // Source asset must exist, belong to the owner and be a real file row.
    const asset = await db.gangziiAudioAsset.findUnique({ where: { id: body.sourceAssetId } })
    if (!asset || asset.userId !== user.id) {
      return ok({ rejected: true, code: 'NOT_FOUND', message: 'The source asset does not exist for this account.' }, { status: 200 })
    }
    const { backend, release } = await preflight(user.id, 'gangzii', 'audio-production')
    release() // queue slot is held by the worker
    const job = await db.generationJob.create({
      data: {
        userId: user.id,
        product: 'gangzii',
        task: 'audio-production',
        status: 'queued',
        backendId: backend.id,
        paramsJson: JSON.stringify({
          inputs: [{ jobId: undefined, relPath: asset.relPath }],
          operations: body.operations,
          output: body.output,
          sourceLabel: `asset:${asset.id}`,
        }),
      },
    })
    await recordAudit({
      actorId: user.id,
      action: 'gangzii.produce.submit',
      target: job.id,
      meta: { ops: body.operations.map((o) => o.op), format: body.output.format },
    })
    enqueueJob(job.id)
    return ok({ jobId: job.id, status: job.status }, { status: 202 })
  })
}
