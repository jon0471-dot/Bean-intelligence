import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * SQLite serialization (2026-11-07, measured): the background engine added
 * concurrent writers (embedded pools + standalone workers + request paths)
 * against one SQLite file. Prisma's default pool issues parallel writes that
 * collide on the file lock (SQLITE_BUSY) and can stall a worker's completion
 * write past its lease. `connection_limit=1` serializes all access through
 * ONE connection; cross-PROCESS contention (standalone workers) is bounded
 * by SQLite's own busy timeout.
 *
 * M26 (audit F-10):
 *  - `busy_timeout` is now part of the forced URL parameters so a
 *    cross-process writer WAITS on the file lock instead of failing
 *    SQLITE_BUSY immediately (measured engine default is a short wait);
 *  - verbose query logging (`log: ['query']`) is now gated by
 *    BEAN_LOG_DB_QUERIES=1 — it logged EVERY SQL statement in production
 *    (noise + potential PII in logs). The dev default keeps the previous
 *    behavior visible when explicitly requested.
 */
export function sqliteUrl(): string | undefined {
  const url = process.env.DATABASE_URL
  if (!url || !url.startsWith('file:')) return url
  const params = new URLSearchParams(url.split('?')[1] ?? '')
  if (!params.has('connection_limit')) params.set('connection_limit', '1')
  if (!params.has('busy_timeout')) {
    const ms = Number(process.env.BEAN_DB_BUSY_TIMEOUT_MS || 5_000)
    params.set('busy_timeout', String(Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60_000) : 5_000))
  }
  const base = url.split('?')[0]
  return `${base}?${params.toString()}`
}
const databaseUrl = sqliteUrl()
if (databaseUrl && databaseUrl !== process.env.DATABASE_URL) {
  process.env.DATABASE_URL = databaseUrl
}

const logQueries = process.env.BEAN_LOG_DB_QUERIES === '1'

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(logQueries ? { log: ['query'] as const } : {}),
    datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db