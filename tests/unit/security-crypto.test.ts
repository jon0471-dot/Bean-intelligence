/**
 * AES-256-GCM credential-encryption security tests (work order Part 3 §10).
 *
 * Contract pinned here:
 *  - round-trip fidelity (any plaintext, including multibyte content);
 *  - authenticated encryption FAILS CLOSED: tampered ciphertext/IV/tag or a
 *    wrong master key yields DecryptionFailedError — never corrupted output;
 *  - a missing/invalid master key disables the feature explicitly (typed
 *    error) instead of degrading to plaintext or a weak derived key;
 *  - the masked hint exposes at most 2 leading + 4 trailing characters;
 *  - master-key rotation re-encrypts and remains decryptable;
 *  - the envelope is versioned (v1) and carries a fresh IV per encryption.
 *
 * Run: bun test tests/unit/security-crypto.test.ts
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  encryptSecret,
  decryptSecret,
  rotateSecretEnvelope,
  hashApiKey,
  safeEqual,
  maskedHint,
  isCredentialEncryptionConfigured,
  CredentialsNotConfiguredError,
  DecryptionFailedError,
} from '../../src/lib/security/crypto'

const VALID_KEY = 'a'.repeat(32) + 'b'.repeat(32) // 64 hex chars = 32 bytes
const OTHER_KEY = 'c'.repeat(64)

let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.BEAN_CREDENTIALS_MASTER_KEY
  process.env.BEAN_CREDENTIALS_MASTER_KEY = VALID_KEY
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.BEAN_CREDENTIALS_MASTER_KEY
  else process.env.BEAN_CREDENTIALS_MASTER_KEY = savedKey
})

describe('credential encryption (AES-256-GCM)', () => {
  test('round-trips arbitrary plaintext (JSON payloads, unicode, newlines)', () => {
    const payloads = [
      JSON.stringify({ apiKey: 'sk-test-1234567890abcdef' }),
      'привет 州 🔑 multi-byte',
      'line1\nline2\n\ttabbed',
      '',
    ]
    for (const p of payloads) {
      expect(decryptSecret(encryptSecret(p))).toBe(p)
    }
  })

  test('uses a fresh IV per encryption (same plaintext → different envelopes)', () => {
    const a = encryptSecret('same secret')
    const b = encryptSecret('same secret')
    expect(a).not.toBe(b)
    expect(a.startsWith('v1:')).toBe(true)
    expect(b.startsWith('v1:')).toBe(true)
  })

  test('tampering with the ciphertext fails closed (GCM auth)', () => {
    const envelope = encryptSecret('do not modify me')
    const [version, rest] = envelope.split(':')
    const [iv, tag, ct] = rest.split('.')
    const flipped = ct.slice(0, -4) + (ct.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    expect(() => decryptSecret(`${version}:${iv}.${tag}.${flipped}`)).toThrow(DecryptionFailedError)
  })

  test('tampering with the auth tag fails closed', () => {
    const envelope = encryptSecret('secret')
    const [version, rest] = envelope.split(':')
    const [iv, tag, ct] = rest.split('.')
    const badTag = tag.slice(0, -2) + (tag.endsWith('AA') ? 'BB' : 'AA')
    expect(() => decryptSecret(`${version}:${iv}.${badTag}.${ct}`)).toThrow(DecryptionFailedError)
  })

  test('truncated envelope fails closed', () => {
    expect(() => decryptSecret('v1:not-an-envelope')).toThrow(DecryptionFailedError)
    expect(() => decryptSecret('v2:aaa.bbb.ccc')).toThrow(DecryptionFailedError)
    expect(() => decryptSecret('garbage')).toThrow(DecryptionFailedError)
  })

  test('a wrong master key fails closed (decrypting under a different key)', () => {
    const envelope = encryptSecret('key-bound secret')
    process.env.BEAN_CREDENTIALS_MASTER_KEY = OTHER_KEY
    expect(() => decryptSecret(envelope)).toThrow(DecryptionFailedError)
  })

  test('missing master key → CredentialsNotConfiguredError (no plaintext fallback)', () => {
    delete process.env.BEAN_CREDENTIALS_MASTER_KEY
    expect(isCredentialEncryptionConfigured()).toBe(false)
    expect(() => encryptSecret('x')).toThrow(CredentialsNotConfiguredError)
  })

  test('invalid master key shape → hard configuration error (no weak derivation)', () => {
    process.env.BEAN_CREDENTIALS_MASTER_KEY = 'short-and-weak'
    expect(() => encryptSecret('x')).toThrow(/Invalid BEAN_CREDENTIALS_MASTER_KEY/)
    process.env.BEAN_CREDENTIALS_MASTER_KEY = Buffer.alloc(16).toString('hex') // 16 bytes, not 32
    expect(() => encryptSecret('x')).toThrow(/Invalid BEAN_CREDENTIALS_MASTER_KEY/)
  })

  test('base64 master keys of exactly 32 bytes are accepted', () => {
    process.env.BEAN_CREDENTIALS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64')
    expect(isCredentialEncryptionConfigured()).toBe(true)
    expect(decryptSecret(encryptSecret('b64 key works'))).toBe('b64 key works')
  })

  test('rotation re-encrypts and the new envelope decrypts under the same env key', () => {
    const envelope = encryptSecret('rotate me')
    const rotated = rotateSecretEnvelope(envelope)
    expect(rotated.keyVersion).toBe(1)
    expect(rotated.encrypted).not.toBe(envelope)
    expect(decryptSecret(rotated.encrypted)).toBe('rotate me')
  })

  test('rotation fails closed when the envelope does not match the env key', () => {
    const envelope = encryptSecret('under old key')
    process.env.BEAN_CREDENTIALS_MASTER_KEY = OTHER_KEY
    expect(() => rotateSecretEnvelope(envelope)).toThrow(DecryptionFailedError)
  })
})

describe('application key hashing + comparison', () => {
  test('SHA-256 hash is deterministic and not the raw key', () => {
    const raw = 'bgk_abcdef123456'
    const h = hashApiKey(raw)
    expect(h).toHaveLength(64)
    expect(h).toBe(hashApiKey(raw))
    expect(h).not.toContain(raw)
  })

  test('safeEqual is true only for identical values (constant-time contract)', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })
})

describe('masked hints', () => {
  test('exposes only the first 2 and last 4 characters', () => {
    const m = maskedHint('sk-prod-abcdefghij1234')
    expect(m).toBe('sk…1234')
    expect(m).not.toContain('abcdefghij')
  })

  test('short secrets are fully masked', () => {
    expect(maskedHint('short')).toBe('••••')
    expect(maskedHint('1234567')).toBe('••••')
    expect(maskedHint('12345678')).toBe('••••')
  })
})
