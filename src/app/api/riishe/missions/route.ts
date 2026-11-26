/**
 * BEAN Intelligence — M41 mission surfaces (SERVER-ONLY).
 *
 * Owner-scoped REST access to the mission ledger, built for the existing
 * job-progress surfaces and the acceptance suite:
 *  - POST   /api/riishe/missions         { objective } → plan + queue
 *  - GET    /api/riishe/missions         → the owner's recent missions
 *
 * Security: session-authenticated (requireUser), owner-scoped rows only,
 * customer-safe views (no backend ids, no local paths, no payloads). The
 * planner is deterministic and refuses single-domain objectives — the API
 * surfaces that refusal honestly instead of forcing a mission.
 */
import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { recordAudit } from '@/lib/observability/metering'
import { createMissionFromPlan, listMissionsForOwner, MissionDuplicateError, toProgressView } from '@/lib/riishe/mission/store'
import { planMission } from '@/lib/riishe/mission/planner'

const createSchema = z.object({ objective: z.string().min(12).max(4000) })

export async function POST(req: Request) {
  return handle(async () => {
  const user = await requireUser()
  const { objective } = await parseBody(req, createSchema)
  const plan = planMission(objective)
  if (!plan.ok) {
    throw new BeanApiError('UNSUPPORTED_CONTENT', plan.reason)
  }
    try {
      const submission = await createMissionFromPlan(user.id, objective, plan)
    await recordAudit({
      actorId: user.id,
      action: 'riishe.mission_api_create',
      target: submission.missionId,
      meta: { missionType: plan.missionType, tasks: plan.tasks.length, via: 'api' },
    })
    return ok({
      missionId: submission.missionId,
      jobId: submission.jobId,
      status: submission.status,
      missionType: plan.missionType,
      detected: plan.detected,
      tasks: plan.tasks.map((t) => ({ taskId: t.id, title: t.title, agent: t.agent, dependsOn: t.dependsOn })),
    })
    } catch (e) {
      if (e instanceof MissionDuplicateError) {
        throw new BeanApiError('EDIT_CONFLICT', `An identical mission (${e.existingMissionId}) is already planned or running.`)
      }
      throw e
    }
  })
}

export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const missions = await listMissionsForOwner(user.id, 20)
    return ok({
      missions: missions.map((m) => toProgressView(m)),
    })
  })
}
