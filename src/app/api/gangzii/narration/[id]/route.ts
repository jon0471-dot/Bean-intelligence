/**
 * GANGZII — narration project detail (owner-only).
 * GET    → full project (segments reconciled from their real job rows).
 * PATCH  → update script/voice/speed/overrides/scene associations. Ready
 *          segments whose text is unchanged KEEP their audio (never a
 *          forced full regeneration for one sentence change).
 * DELETE → project + its stored segment artifacts.
 */
import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import {
  getNarrationProjectForOwner,
  reconcileNarrationSegments,
  updateNarrationProject,
  deleteNarrationProject,
} from '@/lib/gangzii/narration-service'

const patchSchema = z.object({
  title: z.string().trim().max(120).optional(),
  text: z.string().trim().min(1).max(20_000).optional(),
  voice: z.string().trim().min(2).max(40).optional(),
  speed: z.number().min(0.5).max(2.0).optional(),
  overrides: z.array(z.object({ from: z.string().min(1).max(80), to: z.string().min(1).max(80) })).max(50).optional(),
  sceneAssociations: z
    .array(z.object({ sceneIdx: z.number().int().min(1).max(20), segmentIdx: z.number().int().min(1).max(50), caption: z.string().max(120).optional() }))
    .max(50)
    .optional(),
})

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    await reconcileNarrationSegments(user.id, id)
    const project = await getNarrationProjectForOwner(id, user.id)
    if (!project) throw new BeanApiError('NOT_FOUND', 'Narration project not found.')
    return ok({
      project: {
        id: project.id,
        title: project.title,
        language: project.language,
        source: project.source,
        status: project.status,
        jazmiiProductionId: project.jazmiiProductionId,
        sceneAssociations: project.sceneAssociationsJson ? JSON.parse(project.sceneAssociationsJson) : null,
        segments: project.segments.map((s) => ({
          id: s.id,
          idx: s.idx,
          text: s.text,
          normalizedText: s.normalizedText,
          voice: s.voice,
          speed: s.speed,
          status: s.status,
          jobId: s.generationJobId,
          audioUrl: s.status === 'ready' && s.artifactRelPath ? `/api/gangzii/narration/${id}/segments/${s.id}/audio` : null,
          durationMs: s.durationMs,
          errorNote: s.errorNote,
        })),
      },
    })
  })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const body = await parseBody(request, patchSchema)
    const project = await updateNarrationProject(id, user.id, body)
    if (!project) throw new BeanApiError('NOT_FOUND', 'Narration project not found.')
    await recordAudit({
      actorId: user.id,
      action: 'gangzii.narration.update',
      target: id,
      meta: { fields: Object.keys(body) },
    })
    return ok({
      project: {
        id: project.id,
        title: project.title,
        segments: project.segments.map((s) => ({
          id: s.id,
          idx: s.idx,
          text: s.text,
          status: s.status,
          audioUrl: s.status === 'ready' && s.artifactRelPath ? `/api/gangzii/narration/${id}/segments/${s.id}/audio` : null,
          durationMs: s.durationMs,
        })),
      },
    })
  })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const res = await deleteNarrationProject(id, user.id)
    await recordAudit({ actorId: user.id, action: 'gangzii.narration.delete', target: id, meta: {} })
    return ok(res)
  })
}
