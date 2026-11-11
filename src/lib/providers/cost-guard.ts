/**
 * BEAN Intelligence — provider cost-limit guard (SERVER ONLY).
 *
 * PHASE 6 requirement ("Cost limits") implemented HONESTLY for the current
 * provider reality: the authorized gateway does NOT report per-request cost
 * (metering costUnit is null and costMicros is never invented), so a monetary
 * budget cannot be measured today. What CAN be enforced truthfully is a
 * per-product daily REQUEST budget — an operator-set ceiling on how many
 * billable upstream requests BEAN may issue per product per UTC day.
 *
 * Policy:
 *  - Budgets are OPT-IN per product via env: BEAN_DAILY_REQUEST_BUDGET_<PRODUCT>
 *    (e.g. BEAN_DAILY_REQUEST_BUDGET_RIISHE=500). Unset = no additional cap
 *    beyond the existing per-user daily quotas.
 *  - When set, the guard counts today's usageRecord rows for the product
 *    (all users, success or failure — failed upstream calls can still cost)
 *    and refuses new work with a typed COST_LIMIT error once the ceiling is
 *    reached. This is a provider-spend guard, NOT a user quota.
 *  - The guard never guesses money: messages say "requests", never "cost".
 *
 * When a future provider reports real cost data (costUnit set, costMicros
 * recorded), this module is the single place to extend with a micros budget.
 */

import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import type { BeanProductId } from '@/lib/registry/products'

const PRODUCT_ENV_KEYS: Record<BeanProductId, string> = {
  riishe: 'BEAN_DAILY_REQUEST_BUDGET_RIISHE',
  laxii: 'BEAN_DAILY_REQUEST_BUDGET_LAXII',
  jazmii: 'BEAN_DAILY_REQUEST_BUDGET_JAZMII',
  'code-giftz': 'BEAN_DAILY_REQUEST_BUDGET_GIFTZ',
  gangzii: 'BEAN_DAILY_REQUEST_BUDGET_GANGZII',
}

/**
 * ADMIN-CONFIGURABLE OVERRIDE (OPERATIONAL-TRANSFORMATION, Phase 9,
 * 2026-11-11): an administrator can set a runtime budget per product via
 * the SystemSetting table (key: `provider_budget_<product>`, value: a
 * positive integer). The DB override WINS over the env default so budgets
 * can be tightened or lifted without a redeploy. Cached for 30s so the
 * hot path stays cheap; a misconfigured value is ignored (env fallback).
 */
const OVERRIDE_CACHE_TTL_MS = 30_000
let overrideCache: { at: number; values: Partial<Record<BeanProductId, number | null>> } = { at: 0, values: {} }

async function adminBudgetOverride(productId: BeanProductId): Promise<number | null | undefined> {
  const now = Date.now()
  if (now - overrideCache.at > OVERRIDE_CACHE_TTL_MS) {
    const values: Partial<Record<BeanProductId, number | null>> = {}
    try {
      const rows = await db.systemSetting.findMany({
        where: { key: { startsWith: 'provider_budget_' } },
        select: { key: true, value: true },
      })
      for (const row of rows) {
        const product = row.key.slice('provider_budget_'.length) as BeanProductId
        if (!(product in PRODUCT_ENV_KEYS)) continue
        const n = Number(row.value.trim())
        values[product] = Number.isFinite(n) && n > 0 ? Math.floor(n) : null
      }
    } catch {
      // settings lookup must never break submissions — env fallback applies
    }
    overrideCache = { at: now, values }
  }
  return overrideCache.values[productId]
}

/** Parse the operator's budget for a product; null = no provider-level cap. */
export async function dailyRequestBudget(productId: BeanProductId): Promise<number | null> {
  const override = await adminBudgetOverride(productId)
  if (override !== undefined) return override
  const raw = process.env[PRODUCT_ENV_KEYS[productId]]
  if (raw === undefined || raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

/**
 * Enforce the provider request budget. Called from the router preflight
 * AFTER per-user quotas, BEFORE backend work. Throws a typed, honest error.
 */
export async function assertProviderBudget(
  userId: string,
  productId: BeanProductId,
  productName: string,
): Promise<void> {
  const budget = await dailyRequestBudget(productId)
  if (budget === null) return
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const used = await db.usageRecord.count({
    where: { product: productId, createdAt: { gte: startOfDay } },
  })
  if (used >= budget) {
    await db.auditLog
      .create({
        data: {
          actorId: userId,
          action: 'provider.budget_exceeded',
          target: productId,
          metaJson: JSON.stringify({ budget, used }),
        },
      })
      .catch(() => undefined)
    throw new BeanApiError(
      'COST_LIMIT',
      `${productName} reached the operator's provider request budget for today (${used}/${budget} upstream requests). ` +
        'The limit protects against runaway provider spend; it resets at midnight UTC. Contact the operator to raise it.',
    )
  }
}
