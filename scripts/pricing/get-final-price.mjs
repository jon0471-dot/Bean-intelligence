'use strict'

/**
 * getFinalPrice — reference pricing API with a CONSISTENT STRUCTURED RESULT.
 *
 * API CONTRACT (single shape family, never mixed):
 *   Success: { ok: true,  value: number  (2dp, never -0), cents: integer, display: "NN.NN" }
 *   Failure: { ok: false, code: string,   message: string }
 * A success result NEVER carries code/message; a failure result NEVER carries
 * value/cents/display. Callers branch on `ok` — they never sniff types.
 *
 * Rounding: half-up (0.005 -> 0.01) at 2 decimal places, computed in integer
 * cents. `Math.round(x*100)/100` alone is NOT used because binary doubles
 * misrepresent decimal half-cent boundaries (1.005 -> 1.00); a one-ULP
 * correction term (capped at just under half a cent) repairs representation
 * error without ever flipping a genuine boundary decision, and a magnitude
 * guard keeps cents exactly representable (<= Number.MAX_SAFE_INTEGER).
 */

/** Largest price whose cent amount is exactly representable as a double. */
export const MAX_PRICE = Number.MAX_SAFE_INTEGER / 100 // 90071992547409.91

const INVALID_PRICE = 'INVALID_PRICE'
const INVALID_DISCOUNT = 'INVALID_DISCOUNT'
const PRICE_TOO_LARGE = 'PRICE_TOO_LARGE'

/**
 * Round a dollar amount to integer cents, half-up, correcting the binary
 * representation error that shifts decimal .xx5 boundaries below the tie.
 * The correction is capped at 0.0049 cents: below the cap magnitude it is
 * the natural one-ULP scale; at extreme magnitudes (where one ULP exceeds a
 * cent) the cap prevents the correction itself from corrupting the value.
 */
function toCents(dollars) {
  const scaled = dollars * 100
  const ulp = Number.EPSILON * Math.max(1, Math.abs(scaled))
  const nudge = Math.min(ulp, 0.0049)
  return Math.round(scaled + nudge)
}

export function getFinalPrice(price, discountPercent) {
  // Strict numeric gate: type checked FIRST, then finiteness (Number.isFinite
  // rejects NaN and both infinities in one predicate). No coercion is
  // performed: strings, BigInt, null and undefined are type failures, not
  // values to convert — silent coercion is how money bugs are born.
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    return { ok: false, code: INVALID_PRICE, message: 'price must be a finite number' }
  }
  if (typeof discountPercent !== 'number' || !Number.isFinite(discountPercent)) {
    return { ok: false, code: INVALID_DISCOUNT, message: 'discountPercent must be a finite number' }
  }
  if (price < 0) {
    return { ok: false, code: INVALID_PRICE, message: 'price must not be negative' }
  }
  if (discountPercent < 0 || discountPercent > 100) {
    return { ok: false, code: INVALID_DISCOUNT, message: 'discountPercent must be between 0 and 100' }
  }
  if (price > MAX_PRICE) {
    return { ok: false, code: PRICE_TOO_LARGE, message: `price exceeds the maximum supported value ${MAX_PRICE}` }
  }

  const final = price * (1 - discountPercent / 100)
  const cents = toCents(final)
  const value = cents / 100
  return {
    ok: true,
    value: Object.is(value, -0) ? 0 : value, // normalize -0 out of the API
    cents,
    display: (cents / 100).toFixed(2),
  }
}
