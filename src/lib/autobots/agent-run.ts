/**
 * BEAN Intelligence — M49.1 BEAN AUTOBOTS agent execution bridge (SERVER).
 *
 * An agent turn rides the EXISTING RIISHE orchestration (orchestrateTurn)
 * through the EXISTING `riishe` chat product path — same preflight gates
 * (availability, rate limit, daily quota, budget guard, concurrency slot),
 * same SSE wire protocol, same Trust Engine receipt contracts. This module
 * composes ONLY the agent-specific inputs:
 *
 *  - the server-authoritative tool permission set, derived from the agent's
 *    capabilityKey (fixed vocabulary) — NEVER from persona/instruction text;
 *  - the bounded, untrusted-framed persona block (buildAgentPersonaBlock);
 *  - the owner-scoped conversation history (AutobotMessage rows).
 *
 * PURE helpers here are exported for hermetic security tests: the permission
 * derivation and persona framing are the security boundary of the product.
 */

import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import {
  AGENT_BASE_PERMISSIONS,
  CAPABILITY_INFO,
  deriveAgentPermissions,
  isAutobotCapability,
  AUTOBOT_LIMITS,
  type AutobotCapability,
} from './catalog'
import { buildAgentPersonaBlock } from '@/lib/riishe/prompts'
import type { AutobotAgent } from '@prisma/client'

// ---------------------------------------------------------------------------
// Permission derivation — THE security boundary (pure, server-authoritative)
// ---------------------------------------------------------------------------

/**
 * The complete per-turn tool permission set for an agent. The agent's
 * capabilityKey is the ONLY input. Persona text, instructions and any other
 * agent field are NEVER consulted — a custom persona cannot grant itself
 * additional tools.
 *
 * Contract (pinned by tests):
 *  - always includes the conversational base grants;
 *  - adds the capability's specialist-delegation key(s) and nothing else;
 *  - unknown/legacy capability keys degrade to the base set (no crash, no
 *    widening).
 */
export function agentPermissionSet(capabilityKey: string): ReadonlySet<string> {
  return deriveAgentPermissions(capabilityKey)
}

/** Test/ops seam: the base keys every agent turn carries. */
export const AGENT_TURN_BASE_PERMISSION_SEAM: readonly string[] = AGENT_BASE_PERMISSIONS

// ---------------------------------------------------------------------------
// Persona composition (pure formatting over validated agent fields)
// ---------------------------------------------------------------------------

/**
 * The bounded persona block for one agent. Input is a validated
 * AutobotAgent row (all fields already length-capped by the service layer);
 * the capability summary/limits come from the REAL capability registry
 * entry, so the model's self-description can never drift from what the
 * server actually grants.
 */
export function buildAgentPersona(agent: AutobotAgent): string {
  const cap: AutobotCapability | null = isAutobotCapability(agent.capabilityKey)
    ? agent.capabilityKey
    : null
  const info = cap ? CAPABILITY_INFO[cap] : null
  return buildAgentPersonaBlock({
    name: agent.name,
    roleLabel: agent.role,
    capabilitySummary: info?.summary ?? 'Conversational intelligence through the BEAN platform.',
    capabilityLimits: info?.limits ?? 'No specialist delegation is authorized for this agent.',
    industry: agent.industry,
    personality: agent.personality,
    instructions: agent.instructions,
    language: agent.language,
  })
}

/** Hard bound for the composed persona block (defense in depth: the block is
 *  assembled from bounded fields, but the composed string is bounded too —
 *  truncation prefers dropping persona detail over exceeding the cap). */
export const PERSONA_BLOCK_MAX_CHARS = 8000

export function boundedPersonaBlock(agent: AutobotAgent): string {
  const block = buildAgentPersona(agent)
  return block.length > PERSONA_BLOCK_MAX_CHARS ? block.slice(0, PERSONA_BLOCK_MAX_CHARS) : block
}

// ---------------------------------------------------------------------------
// History loading (owner-scoped)
// ---------------------------------------------------------------------------

export interface AutobotHistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * The agent conversation history, tail-loaded (most recent N messages) and
 * restored to chronological order — the same window discipline as the
 * RIISHE chat route. Ownership is enforced by construction: the caller
 * passes a conversation id that was already owner-verified.
 */
export async function loadAgentHistory(conversationId: string, maxMessages: number): Promise<AutobotHistoryTurn[]> {
  const rows = await db.autobotMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: Math.max(1, Math.min(maxMessages, AUTOBOT_LIMITS.historyPageSize)),
    select: { role: true, content: true },
  })
  return rows
    .reverse()
    .map((r) => ({ role: r.role === 'user' ? ('user' as const) : ('assistant' as const), content: r.content }))
}

// ---------------------------------------------------------------------------
// Conversation resolution (owner-scoped; agent + conversation co-checked)
// ---------------------------------------------------------------------------

/**
 * Resolve (agent, conversation) for a turn. Both must belong to the SAME
 * user: an agent id or conversation id owned by someone else is an honest
 * NOT_FOUND. When no conversation id is given the agent's most recent
 * conversation is reused (workspace continuity), else a new one is created.
 */
export async function resolveAgentConversation(
  userId: string,
  agentId: string,
  conversationId?: string,
): Promise<{ agent: AutobotAgent; conversationId: string; isNewConversation: boolean }> {
  const agent = await db.autobotAgent.findUnique({ where: { id: agentId } })
  if (!agent || agent.userId !== userId) {
    // Owner-scoped miss: an agent id owned by someone else is an honest
    // NOT_FOUND (no existence leak across users).
    throw new BeanApiError('NOT_FOUND', 'Agent not found.')
  }
  if (agent.status === 'archived') {
    throw new BeanApiError('EDIT_CONFLICT', 'This agent is archived — activate it before starting new work.')
  }
  if (conversationId) {
    const conv = await db.autobotConversation.findUnique({ where: { id: conversationId } })
    if (!conv || conv.userId !== userId || conv.agentId !== agent.id) {
      // Conversation-ownership mismatch is also a plain NOT_FOUND.
      throw new BeanApiError('NOT_FOUND', 'Conversation not found.')
    }
    return { agent, conversationId: conv.id, isNewConversation: false }
  }
  const latest = await db.autobotConversation.findFirst({
    where: { agentId: agent.id, userId },
    orderBy: { updatedAt: 'desc' },
  })
  if (latest) return { agent, conversationId: latest.id, isNewConversation: false }
  const conv = await db.autobotConversation.create({
    data: { agentId: agent.id, userId },
  })
  return { agent, conversationId: conv.id, isNewConversation: true }
}
