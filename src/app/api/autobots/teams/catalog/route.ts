/**
 * BEAN Intelligence — M49.2 BEAN AUTOBOT TEAMS catalogue API.
 *
 * GET /api/autobots/teams/catalog → the verified team-template collection +
 * the fixed task-kind → capability requirement map + team limits, composed
 * from the SAME pure modules the server validates against
 * (src/lib/autobots/teams/catalog.ts + the M41 task vocabulary). What the UI
 * advertises is exactly what the server can authorize — there is no second
 * catalogue, and no template claims an unsupported capability.
 */
import { ok, handle } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import {
  ASSIGNABLE_TEAM_CAPABILITIES,
  QUALITY_GATE_CAPABILITY,
  QUALITY_GATE_LABEL,
  TEAM_ASSIGNMENT_PREFERENCES,
  TEAM_LIMITS,
  TEAM_TEMPLATES,
  TEAM_WORKFLOW_PREFERENCES,
  TASK_KIND_TEAM_CAPABILITY,
  WORKFLOW_PREFERENCE_LABELS,
  templateRequiredCapabilities,
} from '@/lib/autobots/teams/catalog'
import { CAPABILITY_INFO, getTemplate as getAgentTemplate } from '@/lib/autobots/catalog'
import { MISSION_TASK_KINDS } from '@/lib/riishe/mission/types'

export async function GET() {
  return handle(async () => {
    await requireUser()
    return ok({
      limits: {
        nameChars: TEAM_LIMITS.nameChars,
        descriptionChars: TEAM_LIMITS.descriptionChars,
        responsibilityChars: TEAM_LIMITS.responsibilityChars,
        minMembers: TEAM_LIMITS.minMembers,
        maxMembers: TEAM_LIMITS.maxMembers,
        maxTeamsPerUser: TEAM_LIMITS.maxTeamsPerUser,
      },
      workflowPreferences: TEAM_WORKFLOW_PREFERENCES.map((id) => ({ id, label: WORKFLOW_PREFERENCE_LABELS[id] })),
      assignmentPreferences: TEAM_ASSIGNMENT_PREFERENCES,
      assignableCapabilities: ASSIGNABLE_TEAM_CAPABILITIES.map((id) => ({
        id,
        label: CAPABILITY_INFO[id].label,
        underlying: CAPABILITY_INFO[id].underlying,
        limits: CAPABILITY_INFO[id].limits,
      })),
      qualityGate: { id: QUALITY_GATE_CAPABILITY, label: QUALITY_GATE_LABEL },
      taskKindCapabilities: MISSION_TASK_KINDS.map((kind) => ({
        kind,
        requiredCapability: TASK_KIND_TEAM_CAPABILITY[kind],
      })),
      templates: TEAM_TEMPLATES.map((t) => ({
        key: t.key,
        name: t.name,
        description: t.description,
        category: t.category,
        workflowPreference: t.workflowPreference,
        limitations: t.limitations,
        members: t.memberSpecs.map((m) => {
          const agentTemplate = getAgentTemplate(m.agentTemplateKey)
          return {
            agentTemplateKey: m.agentTemplateKey,
            agentName: agentTemplate?.name ?? m.agentTemplateKey,
            agentRole: agentTemplate?.role ?? '',
            capabilityKey: agentTemplate?.capabilityKey ?? '',
            responsibility: m.responsibility,
          }
        }),
        requiredCapabilities: templateRequiredCapabilities(t),
      })),
    })
  })
}
