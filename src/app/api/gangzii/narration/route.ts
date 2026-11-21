/**
 * GANGZII — Narration Studio API (M27).
 * GET  → owner's narration projects (with reconciled segment states).
 * POST → create a narration project (manual text or JAZMII storyboard
 *        hand-off). Segmentation is deterministic; the original text is
 *        preserved per segment; normalized synthesis text is separate.
 */
import { z } from 'zod'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import {
  createNarrationProject,
  listNarrationProjects,
  reconcileNarrationSegments,
} from '@/lib/gangzii/narration-service'
import { GANGZII_LIMITS } from '@/lib/registry/products'

const createSchema = z.object({
  title: z.string().trim().max(120).optional(),
  text: z.string().trim().min(1).max(20_000),
  language: z.string().trim().max(12).default('en'),
  voice: z.string().trim().min(2).max(40),
  speed: z.number().min(GANGZII_LIMITS.speedMin).max(GANGZII_LIMITS.speedMax).default(1.0),
  overrides: z
    .array(z.object({ from: z.string().min(1).max(80), to: z.string().min(1).max(80) }))
    .max(50)
    .optional(),
  jazmiiProductionId: z.string().regex(/^[\w-]+$/).max(40).optional(),
  sceneAssociations: z
    .array(z.object({ sceneIdx: z.number().int().min(1).max(20), segmentIdx: z.number().int().min(1).max(50), caption: z.string().max(120).optional() }))
    .max(50)
    .optional(),
  segments: z.array(z.object({ text: z.string().trim().min(1).max(2000) })).max(50).optional(),
})

export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    await reconcileNarrationSegments(user.id)
    const projects = await listNarrationProjects(user.id)
    return ok({
      projects: projects.map((p) => ({
        id: p.id,
        title: p.title,
        language: p.language,
        source: p.source,
        jazmiiProductionId: p.jazmiiProductionId,
        status: p.status,
        updatedAt: p.updatedAt,
        segments: p.segments.map((s) => ({
          id: s.id,
          idx: s.idx,
          text: s.text,
          voice: s.voice,
          speed: s.speed,
          status: s.status,
          jobId: s.generationJobId,
          audioUrl: s.status === 'ready' && s.artifactRelPath ? `/api/gangzii/narration/${p.id}/segments/${s.id}/audio` : null,
          durationMs: s.durationMs,
          errorNote: s.errorNote,
        })),
      })),
    })
  })
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const body = await parseBody(request, createSchema)
    const project = await createNarrationProject({
      userId: user.id,
      title: body.title,
      text: body.text,
      language: body.language,
      voice: body.voice,
      speed: body.speed,
      overrides: body.overrides,
      jazmiiProductionId: body.jazmiiProductionId,
      sceneAssociations: body.sceneAssociations,
      segments: body.segments,
    })
    await recordAudit({
      actorId: user.id,
      action: 'gangzii.narration.create',
      target: project.id,
      meta: { segments: project.segments.length, source: project.source },
    })
    return ok(
      {
        project: {
          id: project.id,
          title: project.title,
          language: project.language,
          source: project.source,
          segments: project.segments.map((s) => ({
            id: s.id,
            idx: s.idx,
            text: s.text,
            normalizedText: s.normalizedText,
            voice: s.voice,
            speed: s.speed,
            status: s.status,
          })),
        },
      },
      { status: 201 },
    )
  })
}
