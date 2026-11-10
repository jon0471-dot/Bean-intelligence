/**
 * BEAN Intelligence — authenticated encryption for provider credentials.
 *
 * Threat model: the database (SQLite file) may be read by anyone with host
 * access; provider API keys inside it must stay unreadable without the
 * master key, which lives ONLY in the process environment
 * (BEAN_CREDENTIALS_MASTER_KEY — documented deployment requirement, never
 * hardcoded, never written to any file by application code).
 *
 * Design:
 *  - AES-256-GCM (node:crypto — a maintained, audited standard library):
 *    authenticated encryption; any tampering with the ciphertext, the IV or
 *    the tag makes decryption FAIL CLOSED (auth failure), never return
 *    corrupted plaintext.
 *  - A fresh 96-bit random IV per encryption (GCM requirement — IV reuse with
 *    the same key would be catastrophic; random per call is the safe default).
 *  - Versioned envelope `v1:<iv>.<tag>.<ciphertext>` (base64url parts) so a
 *    future algorithm/key rotation can be introduced without breaking old
 *    rows, and re-encryption under a new master key is a supported operation.
 *  - The master key is parsed from hex (64 hex chars = 32 bytes) or base64
 *    (32 bytes after decoding); any other shape is a hard configuration error
 *    — the module fails closed rather than deriving a weak key silently.
 *  - Everything in this module is SERVER-ONLY. It uses node:crypto and is
 *    never imported outside /api routes and server lib modules.
 *
 * Honesty contract: no operation in this module invents success. A missing
 * master key disables credential features with an explicit typed error; a
 * decryption failure is surfaced, never swallowed into empty output.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from 'node:crypto'

const MASTER_KEY_ENV = 'BEAN_CREDENTIALS_MASTER_KEY'
const ENVELOPE_VERSION = 'v1'

export class CredentialsNotConfiguredError extends Error {
  constructor(message = 'Credential encryption is not configured: BEAN_CREDENTIALS_MASTER_KEY is missing from the environment. Provider credential features are disabled until an operator sets it.') {
    super(message)
    this.name = 'CredentialsNotConfiguredError'
  }
}

export class DecryptionFailedError extends Error {
  constructor(message = 'Credential decryption failed (wrong master key or tampered ciphertext).') {
    super(message)
    this.name = 'DecryptionFailedError'
  }
}

function loadMasterKey(): Buffer {
  const raw = process.env[MASTER_KEY_ENV]
  if (!raw || raw.trim().length === 0) throw new CredentialsNotConfiguredError()
  const trimmed = raw.trim()
  // Hex encoding: 64 hex chars → 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex')
  // Base64: must decode to exactly 32 bytes.
  try {
    const buf = Buffer.from(trimmed, 'base64')
    if (buf.length === 32) return buf
  } catch {
    /* fall through to the configuration error */
  }
  throw new Error(
    `Invalid ${MASTER_KEY_ENV}: expected 32 bytes as 64 hex characters or base64. Generate one with: openssl rand -hex 32`,
  )
}

/** True when credential encryption is usable in this process (env key set). */
export function isCredentialEncryptionConfigured(): boolean {
  try {
    loadMasterKey()
    return true
  } catch {
    return false
  }
}

/** base64url without padding — URL/ID-safe, stable across JSON round-trips. */
function b64u(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64u(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

/**
 * Encrypt plaintext under the environment master key (AES-256-GCM).
 * Envelope: `v1:<iv>.<tag>.<ciphertext>` with base64url parts.
 */
export function encryptSecret(plaintext: string): string {
  const key = loadMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENVELOPE_VERSION}:${b64u(iv)}.${b64u(tag)}.${b64u(ciphertext)}`
}

/**
 * Decrypt an envelope produced by encryptSecret. Auth-fails closed on ANY
 * tampering (wrong key, modified ciphertext, corrupted tag) — the caller
 * receives DecryptionFailedError, never corrupted plaintext.
 */
export function decryptSecret(envelope: string): string {
  const key = loadMasterKey()
  const parts = envelope.split(':')
  if (parts.length !== 2 || parts[0] !== ENVELOPE_VERSION) {
    throw new DecryptionFailedError('Unknown credential envelope version.')
  }
  const [ivPart, tagPart, ctPart] = parts[1].split('.')
  // An EMPTY ciphertext part is legal — it is the encryption of the empty
  // string (AES-GCM of "" produces zero bytes). Only a missing part (no '.'
  // separator) is malformed.
  if (!ivPart || !tagPart || ctPart === undefined) throw new DecryptionFailedError('Malformed credential envelope.')
  let iv: Buffer, tag: Buffer, ciphertext: Buffer
  try {
    iv = fromB64u(ivPart)
    tag = fromB64u(tagPart)
    ciphertext = fromB64u(ctPart)
  } catch {
    throw new DecryptionFailedError('Malformed credential envelope encoding.')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    // GCM auth failure — wrong master key or tampered data. Never partial output.
    throw new DecryptionFailedError()
  }
}

/**
 * Re-encrypt an existing envelope under the CURRENT environment master key.
 * Used for master-key rotation: the caller decrypts/validates first (a
 * DecryptionFailedError means the envelope does not match the current
 * environment key and must not be touched), then stores the fresh envelope.
 */
export function rotateSecretEnvelope(envelope: string): { encrypted: string; keyVersion: number } {
  const plaintext = decryptSecret(envelope) // fails closed on mismatch
  return { encrypted: encryptSecret(plaintext), keyVersion: 1 }
}

// ---- application API key hashing (secret type B) ----------------------------

/**
 * SHA-256 of the full application key — the ONLY representation stored.
 * A 256-bit random key has no feasible dictionary; a fast hash is standard
 * for high-entropy tokens (same reasoning as GitHub PATs / Stripe keys).
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex')
}

/**
 * Constant-time comparison of two hashes/keys. Both sides are hashed values;
 * timingSafeEqual requires equal lengths (a length short-circuit leaks
 * nothing about the stored hash).
 */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Masked display hint for a secret (e.g. "sk-…ab12"). Keeps only the first
 * 2 and last 4 characters — never enough to reconstruct or query with.
 */
export function maskedHint(secret: string): string {
  const clean = secret.trim()
  if (clean.length <= 8) return '••••'
  return `${clean.slice(0, 2)}…${clean.slice(-4)}`
}
