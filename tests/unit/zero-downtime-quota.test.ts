/**
 * ZERO-DOWNTIME RECOVERY — shared account quota accounting + user reserve.
 *
 * Pinned behavior (brief §2: "Shared quota accounting across all products
 * using the same provider account" + "Reserve a configurable portion of the
 * daily quota for real user requests"):
 *  - no budget configured -> NO new gate (previous behavior preserved);
 *  - the reserve withholds AUTOMATED consumption (vision checks, targeted
 *    corrections) once usage crosses budget - reserve;
 *  - USER-facing requests are never withheld by the reserve — only by the
 *    FULL budget;
 *  - the counting basis is ALL products (shared account), success or failure.
 * The DB-bound functions are exercised with the in-memory fake; the pure
 * arithmetic is pinned directly.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'

const usageRows: Array<Record<string, unknown>> = []
const auditRows: Array<Record<string, unknown>> = []

const fakeDb = {
  usageRecord: {
    count: async () => usageRows.length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      usageRows.push(data)
      return data
    },
  },
  auditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      auditRows.push(data)
      return data
    },
  },
}
mock.module('@/lib/db', () => ({ db: fakeDb }))

const {
  accountDailyBudget,
  userReserveFraction,
  accountQuotaStateFrom,
  accountQuotaState,
  automatedSkipReason,
  _accountQuotaEnvKeys,
} = await import('../../src/lib/providers/account-quota')
const { assertAccountQuotaForUserRequest } = await import('../../src/lib/providers/account-quota')

const ENV_KEYS = [_accountQuotaEnvKeys().budget, _accountQuotaEnvKeys().reserve]

beforeEach(() => {
  usageRows.length = 0
  auditRows.length = 0
  for (const k of ENV_KEYS) delete process.env[k]
})

describe('account quota — env parsing', () => {
  test('no budget configured -> null (opt-in guard, zero behavior change)', () => {
    expect(accountDailyBudget()).toBeNull()
  })

  test('invalid budget values are ignored, not guessed', () => {
    for (const v of ['abc', '0', '-5', 'Infinity']) {
      process.env[ENV_KEYS[0]] = v
      expect(accountDailyBudget()).toBeNull()
    }
    process.env[ENV_KEYS[0]] = '300'
    expect(accountDailyBudget()).toBe(300)
  })

  test('reserve fraction defaults to 0.25 and clamps into [0, 0.9]', () => {
    expect(userReserveFraction()).toBe(0.25)
    process.env[ENV_KEYS[1]] = '0.5'
    expect(userReserveFraction()).toBe(0.5)
    process.env[ENV_KEYS[1]] = '2'
    expect(userReserveFraction()).toBe(0.9) // can never starve users 100%
    process.env[ENV_KEYS[1]] = '-1'
    expect(userReserveFraction()).toBe(0.25)
    process.env[ENV_KEYS[1]] = 'garbage'
    expect(userReserveFraction()).toBe(0.25)
  })
})

describe('account quota — reserve arithmetic (pure)', () => {
  test('no budget -> automated consumption always allowed, reserve 0', () => {
    const s = accountQuotaStateFrom(999_999, null, 0.25)
    expect(s.automatedAllowed).toBe(true)
    expect(s.reservedForUsers).toBe(0)
    expect(s.budget).toBeNull()
  })

  test('reserve = floor(budget × fraction); automated consumption stops at budget - reserve', () => {
    const s = accountQuotaStateFrom(0, 300, 0.25)
    expect(s.reservedForUsers).toBe(75)
    expect(s.automatedAllowed).toBe(true)
    // 225 = budget - reserve: automated layer just ran out (strict <).
    const edge = accountQuotaStateFrom(225, 300, 0.25)
    expect(edge.automatedAllowed).toBe(false)
    const before = accountQuotaStateFrom(224, 300, 0.25)
    expect(before.automatedAllowed).toBe(true)
  })

  test('skip reason states the real numbers and never blocks silently', () => {
    const blocked = accountQuotaStateFrom(226, 300, 0.25)
    const reason = automatedSkipReason(blocked)
    expect(reason).toContain('226/300')
    expect(reason).toContain('reserve 75')
    expect(automatedSkipReason(accountQuotaStateFrom(10, 300, 0.25))).toBeNull()
  })
})

describe('account quota — shared counting basis + user gate (DB-bound)', () => {
  test('usage counts across ALL products (shared provider account)', async () => {
    usageRows.push({ product: 'riishe' }, { product: 'laxii' }, { product: 'jazmii' }, { product: 'code-giftz' })
    const s = await accountQuotaState()
    expect(s.used).toBe(4)
  })

  test('user requests hit the FULL budget (the reserve never blocks a user)', async () => {
    process.env[ENV_KEYS[0]] = '10'
    process.env[ENV_KEYS[1]] = '0.5'
    for (let i = 0; i < 6; i += 1) usageRows.push({ product: 'riishe' })
    // 6 used >= budget - reserve (5) -> automated layer is cut off...
    const s = await accountQuotaState()
    expect(s.automatedAllowed).toBe(false)
    // ...but a user request is still accepted below the full budget.
    await assertAccountQuotaForUserRequest('user-1', 'riishe', 'RIISHE')
    expect(auditRows).toHaveLength(0)
  })

  test('user request refused ONLY at the full budget, with an audit trail', async () => {
    process.env[ENV_KEYS[0]] = '4'
    usageRows.push({ product: 'riishe' }, { product: 'laxii' }, { product: 'jazmii' }, { product: 'code-giftz' })
    try {
      await assertAccountQuotaForUserRequest('user-1', 'riishe', 'RIISHE')
      throw new Error('expected COST_LIMIT')
    } catch (e) {
      const err = e as Error & { code?: string }
      expect(err.code).toBe('COST_LIMIT')
      expect(err.message).toContain('4/4')
      expect(err.message).toContain('all BEAN products')
      expect(err.message).toContain('midnight UTC')
    }
    expect(auditRows).toHaveLength(1)
    expect((auditRows[0] as { action: string }).action).toBe('provider.account_budget_exceeded')
  })

  test('no budget configured -> user gate is a no-op', async () => {
    await assertAccountQuotaForUserRequest('user-1', 'riishe', 'RIISHE')
    expect(auditRows).toHaveLength(0)
  })
})
