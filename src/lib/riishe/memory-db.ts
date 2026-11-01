/**
 * BEAN Intelligence — memory persistence boundary (Phase 6).
 *
 * The generated Prisma client gains the `riisheMemory` delegate only after
 * `prisma generate` AND a process (re)start: a server that was already
 * running when the schema shipped holds the previous client in its module
 * cache, where `db.riisheMemory` is undefined. Measured live (2026-11-01):
 * every turn crashed with "Cannot read properties of undefined (reading
 * 'findMany')" on such a process.
 *
 * This boundary makes that state HONEST and non-fatal:
 *  - `getMemoryDelegate()` returns the delegate when it exists, else null;
 *  - the chat route degrades memory commands to an explicit "memory is
 *    initializing" receipt (nothing stored, nothing deleted, no lie);
 *  - ordinary turns simply run without memory context (the pre-feature
 *    behavior) and log one warning.
 * The feature self-activates the moment the process loads the regenerated
 * client — no code change needed.
 */
import { db } from '@/lib/db'

export interface MemoryRow {
  id: string
  content: string
  createdAt: Date
}

export interface MemoryDelegate {
  findMany(args: {
    where: { userId: string }
    orderBy?: { createdAt: 'desc' }
    take?: number
    select?: { content?: true; id?: true; createdAt?: true }
  }): Promise<MemoryRow[]>
  count(args: { where: { userId: string } }): Promise<number>
  create(args: { data: { userId: string; content: string } }): Promise<MemoryRow>
  deleteMany(args: { where: { userId: string; id?: { in: string[] } } }): Promise<{ count: number }>
}

/** Null when the running Prisma client predates the RiisheMemory model. */
export function getMemoryDelegate(): MemoryDelegate | null {
  const candidate = (db as unknown as Record<string, unknown>).riisheMemory as
    | Partial<MemoryDelegate>
    | undefined
  if (
    candidate &&
    typeof candidate.findMany === 'function' &&
    typeof candidate.create === 'function' &&
    typeof candidate.deleteMany === 'function' &&
    typeof candidate.count === 'function'
  ) {
    return candidate as MemoryDelegate
  }
  return null
}

/** Honest customer-facing copy for the degraded state. */
export const MEMORY_INITIALIZING_NOTE =
  'My memory service is still initializing in this deployment, so nothing was stored or deleted just now. ' +
  'Ordinary chat is unaffected — please try again in a moment.'
