/**
 * BEAN Intelligence — RIISHE user-approved memory commands, shared core.
 *
 * Extracted (2026-11-07) from the chat route so the BACKGROUND chat worker
 * executes the exact same real database actions as the live SSE path —
 * "remember/forget/list" submitted as a background job produces the same
 * SYSTEM-authored receipts, never a model-simulated result.
 *
 * SERVER-ONLY.
 */

import { db } from '@/lib/db'
import { logger } from '@/lib/observability/logger'
import {
  detectMemoryCommand,
  sensitiveMemoryReason,
  saveConfirmation,
  forgetConfirmation,
  listConfirmation,
  isDuplicateMemory,
  MEMORY_LIMITS,
} from './memory'
import { getMemoryDelegate, MEMORY_INITIALIZING_NOTE } from './memory-db'
import { metadataToJson, type MessageMetadata } from './states'

export interface MemoryCommandOutcome {
  content: string
  meta: MessageMetadata
}

/**
 * Execute a detected memory command against the real store and persist the
 * SYSTEM-authored assistant receipt. Returns null when `message` is not a
 * memory command (the caller proceeds with the normal model turn).
 */
export async function performMemoryCommandIfPresent(
  userId: string,
  conversationId: string,
  message: string,
): Promise<MemoryCommandOutcome | null> {
  const command = detectMemoryCommand(message)
  if (!command) return null

  const memory = getMemoryDelegate()
  let content: string
  const meta: MessageMetadata = {
    states: ['UNVERIFIED'],
    sources: [],
    verification: [],
    stages: [],
    degraded: [],
  }
  if (!memory) {
    logger.warn('riishe.memory_unavailable', { conversationId })
    content = MEMORY_INITIALIZING_NOTE
    meta.memoryAction = { action: command.action, refused: true }
  } else if (command.action === 'save') {
    const sensitive = sensitiveMemoryReason(command.content)
    if (sensitive) {
      content = saveConfirmation(command.content, sensitive)
      meta.memoryAction = { action: 'save', refused: true }
    } else {
      const existing = await memory.findMany({ where: { userId }, select: { content: true } })
      if (isDuplicateMemory(command.content, existing.map((r) => r.content))) {
        content = `That is already in memory: “${command.content}”. Nothing new was stored.`
        meta.memoryAction = { action: 'save', count: 0 }
      } else {
        const count = await memory.count({ where: { userId } })
        if (count >= MEMORY_LIMITS.maxPerUser) {
          content = `Your memory is full (${MEMORY_LIMITS.maxPerUser} items). Say “forget everything” or remove a few items before adding more.`
          meta.memoryAction = { action: 'save', count: 0, refused: true }
        } else {
          await memory.create({ data: { userId, content: command.content } })
          content = saveConfirmation(command.content, null)
          meta.memoryAction = { action: 'save', count: 1 }
        }
      }
    }
  } else if (command.action === 'forget') {
    if (command.all) {
      const removed = await memory.deleteMany({ where: { userId } })
      content = forgetConfirmation(removed.count, '', true)
      meta.memoryAction = { action: 'forget', count: removed.count }
    } else {
      const needle = command.target.toLowerCase()
      const rows = await memory.findMany({
        where: { userId },
        select: { id: true, content: true },
      })
      const matches = rows.filter((r) => r.content.toLowerCase().includes(needle))
      if (matches.length > 0) {
        await memory.deleteMany({
          where: { userId, id: { in: matches.map((m) => m.id) } },
        })
      }
      content = forgetConfirmation(matches.length, command.target, false)
      meta.memoryAction = { action: 'forget', count: matches.length }
    }
  } else {
    const rows = await memory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    })
    content = listConfirmation(rows.map((r) => r.content))
    meta.memoryAction = { action: 'list', count: rows.length }
  }

  await db.message.create({
    data: { conversationId, role: 'assistant', content, metadata: metadataToJson(meta) },
  })
  logger.info('riishe.memory_action', {
    conversationId,
    action: meta.memoryAction?.action,
    count: meta.memoryAction?.count,
  })
  return { content, meta }
}
