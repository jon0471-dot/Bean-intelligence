/**
 * BEAN Intelligence — RIISHE user-approved memory REST API (Phase 6 + M33).
 *
 * Companion to the in-chat memory commands: a control surface that lists,
 * creates, EDITS, exports and deletes what RIISHE keeps, with the same
 * guarantees —
 *   - every row is scoped to the authenticated user (isolation by userId);
 *     every mutation constrains by BOTH memory id and owner id (IDOR-safe:
 *     another user's id simply resolves to "not found");
 *   - sensitive content is refused BEFORE storage (same guard as chat);
 *   - caps mirror MEMORY_LIMITS (50 items, 480 chars);
 *   - exact duplicates are refused (existing behavior, preserved);
 *   - M33 FEATURE B: near-duplicate "potential conflicts" are detected
 *     deterministically and returned to the caller as a DECISION POINT —
 *     nothing is ever replaced or deleted automatically; replacement happens
 *     only after an explicit user choice, re-verified against ownership and
 *     the row's current version immediately before the mutation;
 *   - M33 FEATURE A: edits use updatedAt as an optimistic-concurrency guard
 *     (409 EDIT_CONFLICT with the current row when it moved after the edit
 *     screen loaded — the user's draft is never silently applied or
 *     discarded); export streams an attachment containing ONLY this user's
 *     rows (id, content, createdAt, updatedAt, export timestamp).
 * Writing also happens here so the client UI manages memory directly;
 * deletion remains the primary control the work order requires.
 */
import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import {
  sensitiveMemoryReason,
  MEMORY_LIMITS,
  isDuplicateMemory,
  detectPotentialMemoryConflicts,
} from '@/lib/riishe/memory'
import { getMemoryDelegate } from '@/lib/riishe/memory-db'
import { logger } from '@/lib/observability/logger'
import { recordMemoryManagementReceipt } from '@/lib/trust/adapters/riishe-memory'

const createSchema = z.object({
  content: z.string().min(3, 'Memory needs at least 3 characters.').max(MEMORY_LIMITS.maxChars),
  /**
   * M33 decision flow. Absent + conflicts found → the response carries the
   * candidates and NO row is written. 'keep-both' → create despite the
   * candidates. 'replace' → delete the named row (only when its
   * updatedAt still matches what the user saw) and create the new one.
   */
  decision: z
    .union([
      z.object({ kind: z.literal('keep-both') }),
      z.object({
        kind: z.literal('replace'),
        memoryId: z.string().min(1).max(64),
        expectedUpdatedAt: z.string().min(1).max(64),
      }),
    ])
    .optional(),
})

const editSchema = z.object({
  id: z.string().min(1).max(64),
  content: z.string().min(3, 'Memory needs at least 3 characters.').max(MEMORY_LIMITS.maxChars),
  /** Optimistic-concurrency guard: updatedAt as shown when the screen loaded. */
  expectedUpdatedAt: z.string().min(1).max(64),
})

/** List this user's memories (newest first). Degrades honestly on processes
 *  whose Prisma client predates the RiisheMemory model. The row payload is
 *  the exact customer surface: id, content, createdAt, updatedAt — nothing
 *  else (no internal identifiers). */
export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const memory = getMemoryDelegate()
    if (!memory) {
      return ok({ memories: [], degraded: 'memory service is initializing; restart the runtime to activate it' })
    }
    // M33 FEATURE A: ?export=json streams the user's memory as a downloadable
    // attachment (only ever this user's rows; no tokens, keys, credentials,
    // provider identifiers or other users' data exist in the payload).
    if (new URL(request.url).searchParams.get('export') === 'json') {
      const rows = await memory.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      })
      const exportedAt = new Date().toISOString()
      const payload = {
        format: 'bean-riishe-memory-export-v1',
        exportedAt,
        count: rows.length,
        memories: rows.map((r) => ({
          id: r.id,
          content: r.content,
          createdAt: r.createdAt.toISOString(),
          updatedAt: (r.updatedAt ?? r.createdAt).toISOString(),
        })),
      }
      await recordMemoryManagementReceipt({
        userId: user.id,
        op: 'export',
        itemCount: rows.length,
        verification: `Owner-scoped memory export produced ${rows.length} row(s) as a JSON attachment; the payload contains only this account's rows.`,
      })
      const date = exportedAt.slice(0, 10)
      return new Response(JSON.stringify(payload, null, 2), {
        headers: {
          'content-type': 'application/json',
          'content-disposition': `attachment; filename="bean-riishe-memory-${date}.json"`,
          'cache-control': 'no-store',
        },
      })
    }
    const rows = await memory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
    return ok({
      memories: rows.map((r) => ({
        id: r.id,
        content: r.content,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt ?? r.createdAt,
      })),
    })
  })
}

/** Store one explicitly-approved memory, with the M33 potential-conflict
 *  decision point (replace / keep both / cancel — cancel = do not call). */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const memory = getMemoryDelegate()
    if (!memory) {
      throw new BeanApiError('PRODUCT_UNAVAILABLE', 'The memory service is initializing — try again after the runtime restarts.')
    }
    const body = await parseBody(request, createSchema)
    const content = body.content.replace(/\s+/g, ' ').trim()
    const sensitive = sensitiveMemoryReason(content)
    if (sensitive) {
      throw new BeanApiError('VALIDATION_ERROR', `Memory items must not contain ${sensitive}.`)
    }
    const existing = await memory.findMany({ where: { userId: user.id } })
    const duplicate = isDuplicateMemory(content, existing.map((r) => r.content))

    // ---- Explicit user-confirmed replacement (M33) --------------------------
    if (body.decision?.kind === 'replace') {
      if (duplicate) {
        throw new BeanApiError('VALIDATION_ERROR', 'This exact memory is already stored.')
      }
      // Replacement swaps one row for another (net zero); the cap is
      // re-checked below, against reality, after the conditional delete.
      // Safe conditional mutation: ownership AND version are constrained in
      // the WHERE itself — the row can only be removed if it still belongs
      // to this user AND still carries the updatedAt the user confirmed.
      const expected = parseExpectedUpdatedAt(body.decision.expectedUpdatedAt)
      const removed = await memory.deleteMany({
        where: { userId: user.id, id: body.decision.memoryId, updatedAt: expected },
      })
      if (removed.count === 0) {
        // Distinguish honestly: gone vs concurrently changed. Never overwrite
        // another user's memory (their rows never match userId here).
        const current = await memory.findFirst({ where: { userId: user.id, id: body.decision.memoryId } })
        if (!current) {
          throw new BeanApiError('NOT_FOUND', 'The memory selected for replacement no longer exists — nothing was changed.')
        }
        throw new BeanApiError(
          'EDIT_CONFLICT',
          'That memory changed since you reviewed it. Nothing was replaced — review the current item and try again.',
          JSON.stringify({
            current: {
              id: current.id,
              content: current.content,
              updatedAt: (current.updatedAt ?? current.createdAt).toISOString(),
            },
          }),
        )
      }
      const cap = await memory.count({ where: { userId: user.id } })
      if (cap >= MEMORY_LIMITS.maxPerUser) {
        // Physically unreachable while counts stay honest (delete → count →
        // create), but fail-closed rather than exceed the cap.
        throw new BeanApiError('QUOTA_EXCEEDED', `Memory is capped at ${MEMORY_LIMITS.maxPerUser} items.`)
      }
      const row = await memory.create({ data: { userId: user.id, content } })
      logger.info('riishe.memory_replaced', { memoryId: row.id, replacedCount: 1, chars: row.content.length })
      await recordMemoryManagementReceipt({
        userId: user.id,
        op: 'user-confirmed-replacement',
        memoryIds: [row.id, body.decision.memoryId],
        itemCount: 1,
        verification:
          'A user-confirmed replacement was applied: the previous row was removed under a version-checked, owner-scoped condition and the new fact was stored in the same operation. No memory content is stored in receipts.',
      })
      return ok({ memory: { id: row.id, content: row.content, createdAt: row.createdAt, updatedAt: row.updatedAt ?? row.createdAt } })
    }

    // ---- Duplicate refusal (existing behavior, preserved) ------------------
    if (duplicate) {
      throw new BeanApiError('VALIDATION_ERROR', 'This exact memory is already stored.')
    }

    // ---- Potential-conflict decision point (M33) ---------------------------
    const conflicts = detectPotentialMemoryConflicts(
      content,
      existing.map((r) => ({ id: r.id, content: r.content })),
    )
    if (conflicts.length > 0 && body.decision?.kind !== 'keep-both') {
      // DECISION POINT: return the candidates and write NOTHING. The user
      // explicitly chooses: replace one of them, keep both, or cancel.
      logger.info('riishe.memory_conflicts_presented', {
        candidateCount: conflicts.length,
        chars: content.length,
      })
      await recordMemoryManagementReceipt({
        userId: user.id,
        op: 'potential-conflicts-presented',
        memoryIds: conflicts.slice(0, MAX_CANDIDATE_RECEIPTS).map((c) => c.id),
        itemCount: conflicts.length,
        withLimitations: true,
        verification:
          'The deterministic conflict detector flagged same-topic candidates for the requested memory. No row was created, changed or deleted — the decision was left to the user.',
        limitations: [
          'No memory was stored yet: a potential conflict requires an explicit user decision (replace / keep both / cancel).',
        ],
      })
      return ok({
        requiresChoice: true,
        candidates: conflicts.map((c) => {
          const row = existing.find((r) => r.id === c.id)
          return {
            id: c.id,
            content: c.content,
            topicKey: c.topicKey,
            confidence: c.confidence,
            // Version the user is deciding against — the replace decision
            // re-verifies exactly this stamp before mutating anything.
            updatedAt: (row?.updatedAt ?? row?.createdAt ?? new Date()).toISOString(),
          }
        }),
      })
    }

    // ---- Plain create / keep-both create -----------------------------------
    if (existing.length >= MEMORY_LIMITS.maxPerUser) {
      throw new BeanApiError('QUOTA_EXCEEDED', `Memory is capped at ${MEMORY_LIMITS.maxPerUser} items.`)
    }
    const row = await memory.create({ data: { userId: user.id, content } })
    await recordMemoryManagementReceipt({
      userId: user.id,
      op: 'create',
      memoryIds: [row.id],
      itemCount: 1,
      ...(conflicts.length > 0
        ? {
            withLimitations: true,
            limitations: ['Stored while keeping the potentially conflicting item(s) — the user chose keep-both.'],
          }
        : {}),
      verification: `Owner-scoped memory create stored 1 row after the sensitive-data, duplicate and cap checks (${row.content.length} characters). No memory content is stored in receipts.`,
    })
    return ok({ memory: { id: row.id, content: row.content, createdAt: row.createdAt, updatedAt: row.updatedAt ?? row.createdAt } })
  })
}

/**
 * M33 FEATURE A: edit one memory with optimistic concurrency. The mutation
 * constrains id + owner + observed updatedAt in a single conditional write;
 * a stale screen gets 409 EDIT_CONFLICT with the current row so the user can
 * reconcile — the old content is never silently discarded or overwritten.
 */
export async function PATCH(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const memory = getMemoryDelegate()
    if (!memory) {
      throw new BeanApiError('PRODUCT_UNAVAILABLE', 'The memory service is initializing — try again after the runtime restarts.')
    }
    const body = await parseBody(request, editSchema)
    const content = body.content.replace(/\s+/g, ' ').trim()
    const sensitive = sensitiveMemoryReason(content)
    if (sensitive) {
      throw new BeanApiError('VALIDATION_ERROR', `Memory items must not contain ${sensitive}.`)
    }
    // Ownership first (IDOR-safe: a foreign id reads as "not found").
    const row = await memory.findFirst({ where: { userId: user.id, id: body.id } })
    if (!row) {
      throw new BeanApiError('NOT_FOUND', 'Memory item not found.')
    }
    // Preserve duplicate detection: the edited text may not collide with a
    // DIFFERENT row (colliding with itself is a no-op-shaped edit).
    const existing = await memory.findMany({ where: { userId: user.id } })
    const others = existing.filter((r) => r.id !== body.id)
    if (isDuplicateMemory(content, others.map((r) => r.content))) {
      throw new BeanApiError('VALIDATION_ERROR', 'This exact memory is already stored.')
    }
    // Conditional mutation: id + userId + updatedAt must ALL match.
    const expected = parseExpectedUpdatedAt(body.expectedUpdatedAt)
    const updated = await memory.updateMany({
      where: { userId: user.id, id: body.id, updatedAt: expected },
      data: { content },
    })
    if (updated.count === 0) {
      const current = await memory.findFirst({ where: { userId: user.id, id: body.id } })
      if (!current) {
        throw new BeanApiError('NOT_FOUND', 'Memory item not found — it was deleted while you were editing.')
      }
      logger.info('riishe.memory_edit_conflict', { memoryId: body.id })
      throw new BeanApiError(
        'EDIT_CONFLICT',
        'This memory changed since you started editing. Nothing was overwritten — reconcile and try again.',
        JSON.stringify({
          current: {
            id: current.id,
            content: current.content,
            updatedAt: (current.updatedAt ?? current.createdAt).toISOString(),
          },
        }),
      )
    }
    const fresh = await memory.findFirst({ where: { userId: user.id, id: body.id } })
    const saved = fresh ?? { ...row, content }
    logger.info('riishe.memory_edited', { memoryId: body.id, chars: saved.content.length })
    await recordMemoryManagementReceipt({
      userId: user.id,
      op: 'edit',
      memoryIds: [body.id],
      itemCount: 1,
      verification:
        'Owner-scoped memory edit applied under the optimistic-concurrency guard (id + owner + observed version). The update landed in a single conditional write; no other row was touched. No memory content is stored in receipts.',
    })
    return ok({
      memory: {
        id: saved.id,
        content: saved.content,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt ?? saved.createdAt,
      },
    })
  })
}

/** Delete one memory (?id=) or everything (?all=1). Owner-scoped always. */
export async function DELETE(request: Request) {
  return handle(async () => {
    const user = await requireUser()
    const memory = getMemoryDelegate()
    if (!memory) {
      throw new BeanApiError('PRODUCT_UNAVAILABLE', 'The memory service is initializing — try again after the runtime restarts.')
    }
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (url.searchParams.get('all') === '1') {
      const removed = await memory.deleteMany({ where: { userId: user.id } })
      await recordMemoryManagementReceipt({
        userId: user.id,
        op: 'delete-all',
        itemCount: removed.count,
        verification: `Owner-scoped delete-all removed ${removed.count} memory row(s) for this account. No memory content is stored in receipts.`,
      })
      return ok({ deleted: removed.count })
    }
    if (!id) throw new BeanApiError('VALIDATION_ERROR', 'Pass ?id=<memory id> or ?all=1.')
    // Ownership-check first so a foreign id stays an honest 404 receipt-wise.
    const row = await memory.findFirst({ where: { userId: user.id, id } })
    if (!row) {
      throw new BeanApiError('NOT_FOUND', 'Memory item not found.')
    }
    await memory.deleteMany({ where: { userId: user.id, id: { in: [id] } } })
    await recordMemoryManagementReceipt({
      userId: user.id,
      op: 'delete',
      memoryIds: [id],
      itemCount: 1,
      verification: 'Owner-scoped delete removed 1 memory row. No memory content is stored in receipts.',
    })
    return ok({ deleted: 1 })
  })
}

/** Parse the optimistic-concurrency timestamp; malformed input is a 400. */
function parseExpectedUpdatedAt(raw: string): Date {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    throw new BeanApiError('VALIDATION_ERROR', 'The version timestamp (expectedUpdatedAt) is malformed — reload your memories and try again.')
  }
  return date
}

/** Receipt-evidence cap for one conflict presentation. */
const MAX_CANDIDATE_RECEIPTS = 10
