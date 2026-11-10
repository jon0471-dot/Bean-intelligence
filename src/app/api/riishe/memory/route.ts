/**
 * BEAN Intelligence — RIISHE user-approved memory REST API (Phase 6).
 *
 * Companion to the in-chat memory commands: a control surface that lists
 * and deletes what RIISHE keeps, with the same guarantees —
 *   - every row is scoped to the authenticated user (isolation by userId);
 *   - sensitive content is refused BEFORE storage (same guard as chat);
 *   - caps mirror MEMORY_LIMITS (50 items, 480 chars).
 * Writing also happens here so a client UI could manage memory directly;
 * deletion is the primary control the work order requires.
 */
import { z } from 'zod'
import { handle, ok, BeanApiError } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireUser } from '@/lib/auth/session'
import { sensitiveMemoryReason, MEMORY_LIMITS, isDuplicateMemory } from '@/lib/riishe/memory'
import { getMemoryDelegate } from '@/lib/riishe/memory-db'

const createSchema = z.object({
  content: z.string().min(3, 'Memory needs at least 3 characters.').max(MEMORY_LIMITS.maxChars),
})

/** List this user's memories (newest first). Degrades honestly on processes
 *  whose Prisma client predates the RiisheMemory model. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser()
    const memory = getMemoryDelegate()
    if (!memory) {
      return ok({ memories: [], degraded: 'memory service is initializing; restart the runtime to activate it' })
    }
    const rows = await memory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    })
    return ok({ memories: rows })
  })
}

/** Store one explicitly-approved memory. */
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
    if (existing.length >= MEMORY_LIMITS.maxPerUser) {
      throw new BeanApiError('QUOTA_EXCEEDED', `Memory is capped at ${MEMORY_LIMITS.maxPerUser} items.`)
    }
    if (isDuplicateMemory(content, existing.map((r) => r.content))) {
      throw new BeanApiError('VALIDATION_ERROR', 'This exact memory is already stored.')
    }
    const row = await memory.create({ data: { userId: user.id, content } })
    return ok({ memory: { id: row.id, content: row.content, createdAt: row.createdAt } })
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
      return ok({ deleted: removed.count })
    }
    if (!id) throw new BeanApiError('VALIDATION_ERROR', 'Pass ?id=<memory id> or ?all=1.')
    const rows = await memory.findMany({ where: { userId: user.id } })
    const row = rows.find((r) => r.id === id)
    if (!row) {
      throw new BeanApiError('NOT_FOUND', 'Memory item not found.')
    }
    await memory.deleteMany({ where: { userId: user.id, id: { in: [id] } } })
    return ok({ deleted: 1 })
  })
}
