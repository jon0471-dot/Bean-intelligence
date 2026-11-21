import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import { getProductionForOwner, getAudioTracksForOwner, parseProposal, sceneView } from '@/lib/jazmii/director/service'
import { db } from '@/lib/db'

/**
 * JAZMII AUTO DIRECTOR — full production state (owner-scoped).
 *
 * Returns the production, the approved storyboard (or the proposal while
 * awaiting approval), per-scene states with REAL ffprobe facts, and the
 * deliverable manifest with honest status semantics:
 *   completed | completed_with_limitations | partially_completed | failed |
 *   cancelled | generating | composing | rendering | validating |
 *   awaiting_approval
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser()
    const { id } = await params
    const production = await getProductionForOwner(user.id, id)
    if (!production) throw new BeanApiError('NOT_FOUND', 'Production not found.')

    const proposal = production.status === 'awaiting_approval' ? parseProposal(production) : null
    const approved = production.storyboardJson && production.approvedAt ? parseProposal(production) : null

    // Audio track ROLES (awaiting-approval editing state) — metadata only.
    let audio: Array<{ role: string; attribution: string | null; volume: number }> = []
    if (production.status === 'awaiting_approval') {
      try {
        audio = (await getAudioTracksForOwner(user.id, id)).map((t) => ({
          role: t.role,
          attribution: t.attribution ?? null,
          volume: t.volume ?? 1,
        }))
      } catch {
        audio = []
      }
    }

    let deliverables: Record<string, string> | null = null
    try {
      deliverables = production.deliverableJson ? (JSON.parse(production.deliverableJson) as Record<string, string>) : null
    } catch {
      deliverables = null
    }

    // Orchestration liveness (honest resume affordance): ACTIVE if its job
    // row is still claimable/running.
    let orchestrationStatus: string | null = null
    if (production.jobId) {
      const job = await db.generationJob.findUnique({ where: { id: production.jobId }, select: { status: true } })
      orchestrationStatus = job?.status ?? null
    }

    return ok({
      production: {
        id: production.id,
        title: production.title,
        status: production.status,
        style: production.style,
        aspect: production.aspect,
        width: production.width,
        height: production.height,
        fps: production.fps,
        requestedDurationSec: production.requestedDurationSec,
        storyboardRev: production.storyboardRev,
        engine: production.engine,
        progress: production.progress,
        approvedAt: production.approvedAt,
        startedAt: production.startedAt,
        finishedAt: production.finishedAt,
        errorCode: production.errorCode,
        errorMessage: production.errorMessage,
        trustTaskId: production.trustTaskId,
        createdAt: production.createdAt,
        updatedAt: production.updatedAt,
      },
      // Proposal shown for review; the approved plan after approval.
      storyboard: (approved ?? proposal)?.storyboard ?? null,
      storyboardRev: (approved ?? proposal)?.rev ?? production.storyboardRev,
      scenes: production.scenes.map(sceneView),
      deliverables,
      audio,
      orchestrationStatus,
    })
  })
}
