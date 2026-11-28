/**
 * BEAN Intelligence — M49.1 BEAN AUTOBOTS catalogue API.
 *
 * GET /api/autobots/catalog → the verified template collection + category +
 * capability vocabulary, composed from the SAME pure module the server
 * validates against (src/lib/autobots/catalog.ts). What the UI advertises is
 * exactly what the server can authorize — there is no second catalogue.
 */
import { ok, handle } from '@/lib/api/errors'
import { requireUser } from '@/lib/auth/session'
import {
  AGENT_TEMPLATES,
  AUTOBOT_CATEGORIES,
  AUTOBOT_CAPABILITIES,
  AUTOBOT_LIMITS,
  AUTOBOT_MEMORY_MODES,
  CAPABILITY_INFO,
  CATEGORY_LABELS,
  MEMORY_MODE_LABELS,
} from '@/lib/autobots/catalog'

export async function GET() {
  return handle(async () => {
    await requireUser()
    return ok({
      categories: AUTOBOT_CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
      capabilities: AUTOBOT_CAPABILITIES.map((id) => CAPABILITY_INFO[id]),
      memoryModes: AUTOBOT_MEMORY_MODES.map((id) => ({ id, label: MEMORY_MODE_LABELS[id] })),
      limits: {
        nameChars: AUTOBOT_LIMITS.nameChars,
        roleChars: AUTOBOT_LIMITS.roleChars,
        industryChars: AUTOBOT_LIMITS.industryChars,
        descriptionChars: AUTOBOT_LIMITS.descriptionChars,
        personalityChars: AUTOBOT_LIMITS.personalityChars,
        instructionsChars: AUTOBOT_LIMITS.instructionsChars,
        languageChars: AUTOBOT_LIMITS.languageChars,
        maxAgentsPerUser: AUTOBOT_LIMITS.maxAgentsPerUser,
      },
      templates: AGENT_TEMPLATES.map((t) => ({
        key: t.key,
        name: t.name,
        role: t.role,
        category: t.category,
        industry: t.industry,
        description: t.description,
        personality: t.personality,
        instructions: t.instructions,
        capabilityKey: t.capabilityKey,
        languages: t.languages,
        limitations: t.limitations,
      })),
    })
  })
}
