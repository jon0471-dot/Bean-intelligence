/**
 * BEAN Intelligence — SHARED provider-account quota accounting
 * (SERVER ONLY — zero-downtime recovery, 2026-11-11).
 *
 * Measured provider reality: every BEAN product rides ONE authorized
 * gateway account whose budget is enforced by the provider at the ACCOUNT
 * level (measured live: `x-ratelimit-remaining-daily` counts down across
 * RIISHE chat, LAXII images, JAZMII video and CODE GIFTZ coding alike —
 * docs/reports/BEAN-POST-QUOTA-ACCEPTANCE.md recorded consumption moving
 * 272 → 208 across four products in one acceptance run). The pre-existing
 * guard (cost-guard.ts) is PER-PRODUCT and opt-in, so four independent
 * product budgets could still sum past the account's real ceiling and
 * exhaust the quota real users need.
 *
 * What this module adds (brief §2, "Shared quota accounting across all
 * products using the same provider account" + "Reserve a configurable
 * portion of the daily quota for real user requests"):
 *
 *  1. ONE shared, account-level daily request budget counted across ALL
 *     products (env `BEAN_ACCOUNT_DAILY_BUDGET`, opt-in like the
 *     per-product guard — an operator who sets nothing gets exactly the
 *     previous behavior, never a surprise refusal).
 *  2. A configurable USER RESERVE (env `BEAN_ACCOUNT_DAILY_USER_RESERVE`,
 *     fraction of the budget, default 0.25): once account consumption
 *     crosses `budget - reserve`, AUTOMATED / enhancement consumption
 *     (vision verification, continuity checks, targeted quality
 *     corrections — anything that is not the user's primary request)
 *     stands down HONESTLY (recorded as a skip with its real reason),
 *     while the user's primary request still goes through up to the FULL
 *     budget. Health checks consume zero metered requests already
 *     (gateway-reachability.ts), so the reserve protects exactly the
 *     remaining automated layer.
 *  3. Honest accounting basis: the count is today's UsageRecord rows
 *     across all products, success or failure (a failed upstream call can
 *     still cost — same policy as cost-guard.ts). No invented numbers.
 *
 * This module NEVER bypasses the provider's own limits; it only refuses
 * BEAN-side work earlier, with typed honest errors, so the account keeps
 * serving real users through the end of its daily window.
 */

import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import type { BeanProductId } from '@/lib/registry/products'

const ACCOUNT_BUDGET_ENV = 'BEAN_ACCOUNT_DAILY_BUDGET'
const USER_RESERVE_ENV = 'BEAN_ACCOUNT_DAILY_USER_RESERVE'

export const DEFAULT_USER_RESERVE_FRACTION = 0.25

/** Operator's shared account budget (requests/UTC day); null = no BEAN-side cap. */
export function accountDailyBudget(): number | null {
  const raw = process.env[ACCOUNT_BUDGET_ENV]
  if (raw === undefined || raw.trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.floor(n)
}

/**
 * Fraction of the budget reserved for real user requests when the shared
 * budget is set. Clamped to [0, 0.9] — a misconfigured value can neither
 * disable the reserve entirely when the operator asked for one (0 is a
 * deliberate choice) nor starve users with a 100% reservation.
 */
export function userReserveFraction(): number {
  const raw = process.env[USER_RESERVE_ENV]
  if (raw === undefined || raw.trim() === '') return DEFAULT_USER_RESERVE_FRACTION
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_USER_RESERVE_FRACTION
  return Math.min(0.9, n)
}

/** Requests consumed today across ALL products (shared account basis). */
export async function accountUsageToday(now = new Date()): Promise<number> {
  const startOfDay = new Date(now)
  startOfDay.setUTCHours(0, 0, 0, 0)
  return db.usageRecord.count({ where: { createdAt: { gte: startOfDay } } })
}

export interface AccountQuotaState {
  used: number
  budget: number | null
  /** Requests withheld from automated consumption to serve users (0 when no budget). */
  reservedForUsers: number
  /** True when automated/enhancement consumption may proceed. */
  automatedAllowed: boolean
}

export function accountQuotaStateFrom(used: number, budget: number | null, fraction: number): AccountQuotaState {
  if (budget === null) {
    return { used, budget: null, reservedForUsers: 0, automatedAllowed: true }
  }
  const reservedForUsers = Math.floor(budget * fraction)
  return {
    used,
    budget,
    reservedForUsers,
    automatedAllowed: used < budget - reservedForUsers,
  }
}

/**
 * Live account state: usage counted from the DB, budget/reserve from env.
 * Pure wrapper kept separate so tests can pin the arithmetic without a DB.
 */
export async function accountQuotaState(now = new Date()): Promise<AccountQuotaState> {
  const [used, budget, fraction] = [await accountUsageToday(now), accountDailyBudget(), userReserveFraction()]
  return accountQuotaStateFrom(used, budget, fraction)
}

/**
 * USER-FACING gate. Real user requests may consume up to the FULL shared
 * budget — the reserve never blocks the request a user actually asked for.
 * Throws a typed COST_LIMIT error only when the whole account budget is gone.
 * Called from the router preflight after the per-product budget guard.
 */
export async function assertAccountQuotaForUserRequest(
  userId: string,
  productId: BeanProductId,
  productName: string,
): Promise<void> {
  const budget = accountDailyBudget()
  if (budget === null) return
  const used = await accountUsageToday()
  if (used >= budget) {
    await db.auditLog
      .create({
        data: {
          actorId: userId,
          action: 'provider.account_budget_exceeded',
          target: productId,
          metaJson: JSON.stringify({ budget, used, scope: 'shared-account' }),
        },
      })
      .catch(() => undefined)
    throw new BeanApiError(
      'COST_LIMIT',
      `The shared AI provider account reached its daily request budget (${used}/${budget} upstream requests across all BEAN products). ` +
        'This protects the account from runaway spend; it resets at midnight UTC.',
    )
  }
}

/**
 * AUTOMATED gate for enhancement-layer consumption (vision verification,
 * continuity checks, targeted corrections). Returns the state — callers
 * SKIP the automated step honestly (with this reason recorded) instead of
 * throwing: the user's primary artifact is already produced at this point.
 */
export async function automatedQuotaState(): Promise<AccountQuotaState> {
  return accountQuotaState()
}

/** Customer-safe skip reason when the reserve withholds an automated step. */
export function automatedSkipReason(state: AccountQuotaState): string | null {
  if (state.automatedAllowed) return null
  return (
    `skipped to preserve the shared account quota for real user requests ` +
    `(account usage ${state.used}/${state.budget}, reserve ${state.reservedForUsers})`
  )
}

/** Test hook: nothing to reset (env is read per call by design). */
export function _accountQuotaEnvKeys(): { budget: string; reserve: string } {
  return { budget: ACCOUNT_BUDGET_ENV, reserve: USER_RESERVE_ENV }
}
