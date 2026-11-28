/**
 * BEAN Intelligence — M49.1 BEAN AUTOBOTS agent service (SERVER ONLY).
 *
 * Owner-scoped CRUD for user-configured agent personas. Every field passes
 * through bounded normalization here — the API routes NEVER trust raw client
 * shapes, and the catalogue module (src/lib/autobots/catalog.ts) is the only
 * source of capability/category vocabulary.
 *
 * SECURITY POSTURE (M49.1 §5):
 *  - Persona fields (name/role/industry/description/personality/instructions/
 *    language) are USER-CONFIGURABLE DATA. They are stored verbatim (after
 *    bounding) and are framed as UNTRUSTED preferences at execution time.
 *    Nothing here can widen tool permissions — capabilityKey comes from the
 *    fixed vocabulary only.
 *  - Every read/write is owner-scoped: rows are matched by (id, userId) and
 *    a miss is an honest NOT_FOUND (no existence leak across users).
 *  - Destructive ops (delete) cascade conversations/messages only for the
 *    owning user's own agent.
 */

import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { recordAudit } from '@/lib/observability/metering'
import { checkRateLimit } from '@/lib/auth/ratelimit'
import {
  AUTOBOT_CAPABILITIES,
  AUTOBOT_LIMITS,
  AUTOBOT_MEMORY_MODES,
  CAPABILITY_INFO,
  getTemplate,
  isAutobotCapability,
} from './catalog'

// ---------------------------------------------------------------------------
// Public view shapes (customer-safe; no internals)
// ---------------------------------------------------------------------------

export interface AutobotAgentView {
  id: string
  name: string
  role: string
  industry: string | null
  description: string
  personality: string | null
  instructions: string | null
  language: string | null
  capabilityKey: string
  capabilityLabel: string
  memoryMode: string
  templateKey: string | null
  status: string
  executionCount: number
  lastExecutedAt: string | null
  createdAt: string
  updatedAt: string
}

type AutobotAgentRow = {
  id: string
  name: string
  role: string
  industry: string | null
  description: string
  personality: string | null
  instructions: string | null
  language: string | null
  capabilityKey: string
  memoryMode: string
  templateKey: string | null
  status: string
  executionCount: number
  lastExecutedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function toAgentView(row: AutobotAgentRow): AutobotAgentView {
  const cap = isAutobotCapability(row.capabilityKey) ? CAPABILITY_INFO[row.capabilityKey] : null
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    industry: row.industry,
    description: row.description,
    personality: row.personality,
    instructions: row.instructions,
    language: row.language,
    capabilityKey: row.capabilityKey,
    capabilityLabel: cap?.label ?? row.capabilityKey,
    memoryMode: row.memoryMode,
    templateKey: row.templateKey,
    status: row.status,
    executionCount: row.executionCount,
    lastExecutedAt: row.lastExecutedAt ? row.lastExecutedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Bounded field normalization — the ONLY path from client JSON to storage.
// ---------------------------------------------------------------------------

export interface NormalizedAgentInput {
  name: string
  role: string
  industry: string | null
  description: string
  personality: string | null
  instructions: string | null
  language: string | null
  capabilityKey: string
  memoryMode: string
}

export class AgentValidationError extends Error {}

function boundedText(value: unknown, min: number, max: number, field: string): string {
  const s = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (s.length < min) throw new AgentValidationError(`${field} must be at least ${min} character${min === 1 ? '' : 's'}.`)
  if (s.length > max) throw new AgentValidationError(`${field} must be at most ${max} characters.`)
  return s
}

function boundedOptional(value: unknown, max: number, field: string): string | null {
  if (value === undefined || value === null || value === '') return null
  const s = typeof value === 'string' ? value.trim() : ''
  if (s.length === 0) return null
  if (s.length > max) throw new AgentValidationError(`${field} must be at most ${max} characters.`)
  return s
}

/** Normalize + validate an agent create/update payload. Throws honest,
 *  customer-safe validation errors. capabilityKey/memoryMode come ONLY from
 *  the fixed vocabularies — an unknown key is a 422, never a fallback. */
export function normalizeAgentInput(input: unknown): NormalizedAgentInput {
  const rec = (input ?? {}) as Record<string, unknown>
  const capabilityKey = typeof rec.capabilityKey === 'string' ? rec.capabilityKey.trim() : ''
  if (!isAutobotCapability(capabilityKey)) {
    throw new AgentValidationError(
      `Choose a supported capability (one of: ${AUTOBOT_CAPABILITIES.join(', ')}).`,
    )
  }
  const memoryMode = typeof rec.memoryMode === 'string' && rec.memoryMode !== '' ? rec.memoryMode : 'disabled'
  if (!(AUTOBOT_MEMORY_MODES as readonly string[]).includes(memoryMode)) {
    throw new AgentValidationError('Memory mode must be either "disabled" or "conversation".')
  }
  return {
    name: boundedText(rec.name, 1, AUTOBOT_LIMITS.nameChars, 'Name'),
    role: boundedText(rec.role, 1, AUTOBOT_LIMITS.roleChars, 'Profession or role'),
    industry: boundedOptional(rec.industry, AUTOBOT_LIMITS.industryChars, 'Industry'),
    description: boundedText(rec.description, 3, AUTOBOT_LIMITS.descriptionChars, 'Description'),
    personality: boundedOptional(rec.personality, AUTOBOT_LIMITS.personalityChars, 'Personality'),
    instructions: boundedOptional(rec.instructions, AUTOBOT_LIMITS.instructionsChars, 'Instructions'),
    language: boundedOptional(rec.language, AUTOBOT_LIMITS.languageChars, 'Language'),
    capabilityKey,
    memoryMode,
  }
}

/** Build a create payload from a catalogue template key (validated). */
export function templateToInput(templateKey: string): NormalizedAgentInput & { templateKey: string } {
  const t = getTemplate(templateKey)
  if (!t) throw new AgentValidationError('That template does not exist in the verified catalogue.')
  return {
    name: t.name,
    role: t.role,
    industry: t.industry,
    description: t.description,
    personality: t.personality,
    instructions: t.instructions,
    language: t.languages,
    capabilityKey: t.capabilityKey,
    memoryMode: 'disabled',
    templateKey: t.key,
  }
}

// ---------------------------------------------------------------------------
// CRUD (owner-scoped)
// ---------------------------------------------------------------------------

function crudRateLimit(userId: string): void {
  const rl = checkRateLimit(`autobots-crud:${userId}`, AUTOBOT_LIMITS.crudBurstLimit, 60_000)
  if (!rl.allowed) {
    throw new BeanApiError('RATE_LIMITED', `Too many agent changes — try again in ${rl.retryAfterSec}s.`)
  }
}

export async function listAgents(userId: string): Promise<AutobotAgentView[]> {
  const rows = await db.autobotAgent.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
  })
  return rows.map(toAgentView)
}

export async function getAgentRow(userId: string, agentId: string) {
  const row = await db.autobotAgent.findUnique({ where: { id: agentId } })
  if (!row || row.userId !== userId) {
    throw new BeanApiError('NOT_FOUND', 'Agent not found.')
  }
  return row
}

export async function createAgent(
  userId: string,
  input: NormalizedAgentInput & { templateKey?: string },
): Promise<AutobotAgentView> {
  crudRateLimit(userId)
  const count = await db.autobotAgent.count({ where: { userId } })
  if (count >= AUTOBOT_LIMITS.maxAgentsPerUser) {
    throw new BeanApiError(
      'QUOTA_EXCEEDED',
      `You already have ${AUTOBOT_LIMITS.maxAgentsPerUser} agents — archive or delete one to create another.`,
    )
  }
  const row = await db.autobotAgent.create({
    data: {
      userId,
      name: input.name,
      role: input.role,
      industry: input.industry,
      description: input.description,
      personality: input.personality,
      instructions: input.instructions,
      language: input.language,
      capabilityKey: input.capabilityKey,
      memoryMode: input.memoryMode,
      templateKey: input.templateKey ?? null,
    },
  })
  await recordAudit({
    actorId: userId,
    action: 'autobots.agent_create',
    target: row.id,
    meta: { capabilityKey: input.capabilityKey, templateKey: input.templateKey ?? null },
  })
  return toAgentView(row)
}

export interface AgentUpdateInput extends Partial<NormalizedAgentInput> {
  status?: string
}

const AGENT_STATUSES = ['active', 'archived'] as const

export async function updateAgent(userId: string, agentId: string, patch: AgentUpdateInput): Promise<AutobotAgentView> {
  crudRateLimit(userId)
  await getAgentRow(userId, agentId)
  const data: Record<string, unknown> = {}
  // Only bounded persona fields may change — capabilityKey stays validated,
  // status stays in the two-state vocabulary. Nothing else is writable.
  if (patch.name !== undefined) data.name = boundedText(patch.name, 1, AUTOBOT_LIMITS.nameChars, 'Name')
  if (patch.role !== undefined) data.role = boundedText(patch.role, 1, AUTOBOT_LIMITS.roleChars, 'Profession or role')
  if (patch.industry !== undefined) data.industry = boundedOptional(patch.industry, AUTOBOT_LIMITS.industryChars, 'Industry')
  if (patch.description !== undefined) data.description = boundedText(patch.description, 3, AUTOBOT_LIMITS.descriptionChars, 'Description')
  if (patch.personality !== undefined) data.personality = boundedOptional(patch.personality, AUTOBOT_LIMITS.personalityChars, 'Personality')
  if (patch.instructions !== undefined) data.instructions = boundedOptional(patch.instructions, AUTOBOT_LIMITS.instructionsChars, 'Instructions')
  if (patch.language !== undefined) data.language = boundedOptional(patch.language, AUTOBOT_LIMITS.languageChars, 'Language')
  if (patch.capabilityKey !== undefined) {
    if (!isAutobotCapability(patch.capabilityKey)) {
      throw new AgentValidationError(
        `Choose a supported capability (one of: ${AUTOBOT_CAPABILITIES.join(', ')}).`,
      )
    }
    data.capabilityKey = patch.capabilityKey
  }
  if (patch.memoryMode !== undefined) {
    if (!(AUTOBOT_MEMORY_MODES as readonly string[]).includes(patch.memoryMode)) {
      throw new AgentValidationError('Memory mode must be either "disabled" or "conversation".')
    }
    data.memoryMode = patch.memoryMode
  }
  if (patch.status !== undefined) {
    if (!(AGENT_STATUSES as readonly string[]).includes(patch.status)) {
      throw new AgentValidationError('Status must be "active" or "archived".')
    }
    data.status = patch.status
  }
  const row = await db.autobotAgent.update({ where: { id: agentId }, data })
  await recordAudit({
    actorId: userId,
    action: 'autobots.agent_update',
    target: agentId,
    meta: { fields: Object.keys(data) },
  })
  return toAgentView(row)
}

export async function duplicateAgent(userId: string, agentId: string): Promise<AutobotAgentView> {
  crudRateLimit(userId)
  const src = await getAgentRow(userId, agentId)
  const count = await db.autobotAgent.count({ where: { userId } })
  if (count >= AUTOBOT_LIMITS.maxAgentsPerUser) {
    throw new BeanApiError(
      'QUOTA_EXCEEDED',
      `You already have ${AUTOBOT_LIMITS.maxAgentsPerUser} agents — archive or delete one to create another.`,
    )
  }
  const row = await db.autobotAgent.create({
    data: {
      userId,
      name: `${src.name} (copy)`.slice(0, AUTOBOT_LIMITS.nameChars),
      role: src.role,
      industry: src.industry,
      description: src.description,
      personality: src.personality,
      instructions: src.instructions,
      language: src.language,
      capabilityKey: src.capabilityKey,
      memoryMode: src.memoryMode,
      templateKey: src.templateKey,
      status: 'active',
    },
  })
  await recordAudit({ actorId: userId, action: 'autobots.agent_duplicate', target: row.id, meta: { from: agentId } })
  return toAgentView(row)
}

export async function deleteAgent(userId: string, agentId: string): Promise<{ deleted: true }> {
  crudRateLimit(userId)
  await getAgentRow(userId, agentId)
  await db.autobotAgent.delete({ where: { id: agentId } })
  await recordAudit({ actorId: userId, action: 'autobots.agent_delete', target: agentId, meta: {} })
  return { deleted: true }
}
