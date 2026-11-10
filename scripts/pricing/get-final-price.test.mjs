'use strict'

/**
 * Tests for getFinalPrice — node:test + node:assert/strict (stdlib only).
 * Run: node scripts/pricing/get-final-price.test.mjs
 *
 * Includes a contract-pin test on the EXACT error message returned for
 * getFinalPrice(NaN, 20). Any expectation that does not match the pinned
 * string character-for-character (e.g. a wrong message copied into a test,
 * or a message drift in the implementation) fails loudly — this is the test
 * class that catches "error-message expectation does not match the
 * implementation" defects.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { getFinalPrice, MAX_PRICE } from './get-final-price.mjs'

// ---------- Contract shape: numbers and error strings are never mixed ----------

test('success results carry value/cents/display and NEVER code/message', () => {
  const r = getFinalPrice(100, 20)
  assert.deepEqual(Object.keys(r).sort(), ['cents', 'display', 'ok', 'value'])
  assert.equal(r.ok, true)
  assert.equal(typeof r.value, 'number')
  assert.equal(typeof r.cents, 'number')
  assert.equal(Number.isInteger(r.cents), true)
})

test('failure results carry code/message and NEVER value/cents/display', () => {
  const r = getFinalPrice(NaN, 20)
  assert.deepEqual(Object.keys(r).sort(), ['code', 'message', 'ok'])
  assert.equal(r.ok, false)
  for (const k of ['value', 'cents', 'display']) assert.equal(k in r, false, `failure must not carry ${k}`)
})

// ---------- Contract pin: exact messages (catches mismatched expectations) ----------

test('PIN getFinalPrice(NaN, 20) -> exact INVALID_PRICE message, character-for-character', () => {
  const r = getFinalPrice(NaN, 20)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'INVALID_PRICE')
  // Pinned EXACT string: a test expecting any other message (e.g. 'Invalid
  // price', 'price must be a number', a template with interpolated input)
  // does NOT match this implementation — this pin is what catches that class
  // of expectation/implementation mismatch.
  assert.equal(r.message, 'price must be a finite number')
  // And it is a structured code+message object, not a bare error string.
  assert.equal(typeof r.message, 'string')
  assert.equal(r.code, 'INVALID_PRICE')
})

test('PIN exact messages for every failure code', () => {
  const cases = [
    [getFinalPrice(NaN, 0), 'INVALID_PRICE', 'price must be a finite number'],
    [getFinalPrice(Infinity, 0), 'INVALID_PRICE', 'price must be a finite number'],
    [getFinalPrice(-Infinity, 0), 'INVALID_PRICE', 'price must be a finite number'],
    [getFinalPrice(-1, 0), 'INVALID_PRICE', 'price must not be negative'],
    [getFinalPrice(MAX_PRICE * 2, 0), 'PRICE_TOO_LARGE', `price exceeds the maximum supported value ${MAX_PRICE}`],
    [getFinalPrice(100, NaN), 'INVALID_DISCOUNT', 'discountPercent must be a finite number'],
    [getFinalPrice(100, Infinity), 'INVALID_DISCOUNT', 'discountPercent must be a finite number'],
    [getFinalPrice(100, -1), 'INVALID_DISCOUNT', 'discountPercent must be between 0 and 100'],
    [getFinalPrice(100, 101), 'INVALID_DISCOUNT', 'discountPercent must be between 0 and 100'],
  ]
  for (const [r, code, message] of cases) {
    assert.equal(r.ok, false)
    assert.equal(r.code, code)
    assert.equal(r.message, message)
  }
})

// ---------- Type strictness ----------

test('string input is rejected as a type failure, never coerced', () => {
  assert.equal(getFinalPrice('100', 20).code, 'INVALID_PRICE')
  assert.equal(getFinalPrice(100, '20').code, 'INVALID_DISCOUNT')
  assert.equal(getFinalPrice('100', '20').code, 'INVALID_PRICE')
})

test('null, undefined, BigInt and objects are rejected', () => {
  assert.equal(getFinalPrice(null, 20).code, 'INVALID_PRICE')
  assert.equal(getFinalPrice(undefined, 20).code, 'INVALID_PRICE')
  assert.equal(getFinalPrice(100n, 0).code, 'INVALID_PRICE')
  assert.equal(getFinalPrice(100, null).code, 'INVALID_DISCOUNT')
  assert.equal(getFinalPrice(100, undefined).code, 'INVALID_DISCOUNT')
  assert.equal(getFinalPrice({}, {}).code, 'INVALID_PRICE')
})

test('NaN and both infinities are rejected for either argument', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(getFinalPrice(bad, 20).code, 'INVALID_PRICE')
    assert.equal(getFinalPrice(100, bad).code, 'INVALID_DISCOUNT')
  }
})

test('negative price is rejected; negative zero price is accepted', () => {
  assert.equal(getFinalPrice(-0.01, 0).code, 'INVALID_PRICE')
  assert.equal(getFinalPrice(-100, 0).code, 'INVALID_PRICE')
  const r = getFinalPrice(-0, 0) // -0 is not < 0; it is zero
  assert.equal(r.ok, true)
})

// ---------- Zero / -0 semantics ----------

test('zero price yields exact zero, never -0', () => {
  for (const d of [0, 10, 50, 100]) {
    const r = getFinalPrice(0, d)
    assert.equal(r.ok, true)
    assert.equal(r.value, 0)
    assert.equal(Object.is(r.value, -0), false, '-0 must never leak into the API')
    assert.equal(r.display, '0.00')
  }
})

test('-0 price input normalizes to +0 (raw idiom would emit -0)', () => {
  const r = getFinalPrice(-0, 0)
  assert.equal(r.ok, true)
  assert.equal(r.value, 0)
  assert.equal(Object.is(r.value, -0), false)
})

// ---------- Normal prices ----------

test('normal calculations', () => {
  assert.equal(getFinalPrice(100, 20).value, 80)
  assert.equal(getFinalPrice(100, 20).display, '80.00')
  assert.equal(getFinalPrice(100, 0).value, 100)
  assert.equal(getFinalPrice(100, 100).value, 0)
  assert.equal(getFinalPrice(19.99, 10).value, 17.99) // 17.991 -> 17.99
  assert.equal(getFinalPrice(9.99, 5).value, 9.49) // 9.4905 -> 9.49
  assert.equal(getFinalPrice(0.01, 0).value, 0.01)
  assert.equal(getFinalPrice(0.99, 0).value, 0.99)
})

// ---------- Rounding boundaries (the Math.round idiom gets these WRONG) ----------

test('raw Math.round(x*100)/100 demonstrably fails decimal boundaries (documented defect)', () => {
  // MEASURED on this runtime (node v24, V8): the raw idiom fails 1.005 (the
  // scaling product lands one ULP below the tie), rounds -2.5 toward
  // +Infinity, and leaks -0. 2.675 happens to SURVIVE the *100 idiom here
  // (its scaling product lands exactly on the tie 267.5) but fails the
  // display idiom — WHICH cases fail is an accident of double rounding,
  // which is precisely why hand-rolled scaling is not a money-grade method:
  assert.equal(Math.round(1.005 * 100) / 100, 1) // binary 1.005 < tie -> 1.00 (wrong)
  assert.equal((2.675).toFixed(2), '2.67') // display idiom: 2.67 (wrong)
  assert.equal(Math.round(2.675 * 100) / 100, 2.68) // *100 idiom: survives HERE, no guarantee elsewhere
  assert.equal(Math.round(-2.5), -2) // half rounds toward +Infinity, not away from zero
  assert.equal(Object.is(Math.round(-0.004 * 100) / 100, -0), true) // -0 leaks out
})

test('corrected implementation rounds decimal boundaries half-up', () => {
  assert.equal(getFinalPrice(1.005, 0).value, 1.01) // raw idiom: 1.00
  assert.equal(getFinalPrice(2.675, 0).value, 2.68) // toFixed idiom: 2.67
  assert.equal(getFinalPrice(0.125, 0).value, 0.13) // exact binary .5 tie
  assert.equal(getFinalPrice(0.135, 0).value, 0.14)
  assert.equal(getFinalPrice(33.35, 50).value, 16.68) // 16.675
  assert.equal(getFinalPrice(10, 55.5).value, 4.45) // 4.45 exactly (x.xx5 dollar boundary)
})

test('values just below a half-cent boundary are NOT overcorrected upward', () => {
  assert.equal(getFinalPrice(1.0049, 0).value, 1)
  assert.equal(getFinalPrice(1.0049999999, 0).value, 1)
  assert.equal(getFinalPrice(2.6749999, 0).value, 2.67)
})

// ---------- Large values and magnitude guard ----------

test('large prices stay exactly representable within the guard', () => {
  const r = getFinalPrice(90071992547409.91, 0) // == MAX_PRICE, cents == MAX_SAFE_INTEGER
  assert.equal(r.ok, true)
  assert.equal(r.cents, Number.MAX_SAFE_INTEGER)
  assert.equal(r.value, 90071992547409.91)

  const big = getFinalPrice(1e12, 0)
  assert.equal(big.ok, true)
  assert.equal(big.cents, 1e14)
})

test('prices beyond exact-cents range are rejected, not silently corrupted', () => {
  const r = getFinalPrice(MAX_PRICE + 0.01, 0)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'PRICE_TOO_LARGE')
  assert.equal(getFinalPrice(1e15, 0).code, 'PRICE_TOO_LARGE')
  assert.equal(getFinalPrice(Infinity, 0).code, 'INVALID_PRICE') // infinity is a type failure, not "too large"
})

test('known honest precision limit: near the cap, half-cent decisions carry float error', () => {
  // Documented, not hidden: at the extreme end of the supported range one
  // double ULP exceeds a cent, so x.xx5-style decisions there inherit
  // hardware error. The API keeps such values OUT of the corrupt zone
  // (cents remain integers) but cannot conjure decimal exactness — this test
  // pins the exact behavior at the boundary instead of pretending.
  const r = getFinalPrice(90071992547409.9, 0)
  assert.equal(r.ok, true)
  assert.equal(r.value, 90071992547409.9)
})
