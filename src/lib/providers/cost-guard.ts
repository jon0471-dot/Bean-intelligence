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

/** Parse the operator's budget for a product; null = no provider-level cap. */
export function dailyRequestBudget(productId: BeanProductId): number | null {
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
  const budget = dailyRequestBudget(productId)
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
