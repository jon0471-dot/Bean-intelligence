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
 */
function sqliteUrl(): string | undefined {
  const url = process.env.DATABASE_URL
  if (!url || !url.startsWith('file:')) return url
  if (url.includes('connection_limit=')) return url
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`
}
const databaseUrl = sqliteUrl()
if (databaseUrl && databaseUrl !== process.env.DATABASE_URL) {
  process.env.DATABASE_URL = databaseUrl
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
    datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db