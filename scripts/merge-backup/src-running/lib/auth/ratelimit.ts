/**
 * BEAN Intelligence — rate limiting and quotas (server-side enforcement).
 *
 * Two layers:
 *  1. Sliding-window rate limiter (in-memory, per user+product) for burst
 *     abuse prevention.
 *  2. Durable daily quotas backed by UsageRecord counts in the database.
 *
 * Both are enforced BEFORE any backend routing. Client-side gating is
 * cosmetic only — these are the real controls.
 */
import { db } from '@/lib/db'

interface WindowState {
  hits: number[]
}
const windows = new Map<string, WindowState>()

export interface RateLimitResult {
  allowed: boolean
  retryAfterSec: number
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const state = windows.get(key) ?? { hits: [] }
  state.hits = state.hits.filter((t) => now - t < windowMs)
  if (state.hits.length >= limit) {
    windows.set(key, state)
    const oldest = state.hits[0]
    return { allowed: false, retryAfterSec: Math.ceil((windowMs - (now - oldest)) / 1000) }
  }
  state.hits.push(now)
  windows.set(key, state)
  return { allowed: true, retryAfterSec: 0 }
}

/** Product-specific rate limit policy (burst window 60s). */
export const PRODUCT_RATE_LIMITS: Record<string, number> = {
  riishe: 20,
  laxii: 6,
  jazmii: 6,
  'code-giftz': 15,
}

/** Durable daily quotas per product (successful billable units/day). */
export const PRODUCT_DAILY_QUOTAS: Record<string, number> = {
  riishe: 300,
  laxii: 40,
  jazmii: 0, // product unavailable — quota 0 keeps it closed even if enabled
  'code-giftz': 150,
}

export async function checkDailyQuota(
  userId: string,
  product: string,
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = PRODUCT_DAILY_QUOTAS[product] ?? 0
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const used = await db.usageRecord.count({
    where: { userId, product, success: true, createdAt: { gte: startOfDay } },
  })
  return { allowed: used < limit, used, limit }
}
