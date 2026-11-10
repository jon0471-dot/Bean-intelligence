/**
 * BEAN Intelligence — credential hashing (packages/authentication).
 * scrypt with per-user random salt. No plaintext ever stored.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const KEYLEN = 64
const COST = 16384 // scrypt N parameter

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEYLEN, { N: COST }).toString('hex')
  return `scrypt$${COST}$${salt}$${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, nStr, salt, hash] = stored.split('$')
    if (scheme !== 'scrypt') return false
    const derived = scryptSync(password, salt, KEYLEN, { N: parseInt(nStr, 10) })
    const expected = Buffer.from(hash, 'hex')
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  if (password.length > 128) return 'Password must be at most 128 characters.'
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain both letters and numbers.'
  }
  return null
}
