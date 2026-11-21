/**
 * BEAN Intelligence — Trust Engine canonical hashing.
 *
 * Canonical JSON (recursively key-sorted, undefined-dropped) so that two
 * structurally equal actions always produce the same sha-256 digest. This is
 * what binds an approval decision to the EXACT proposed action — the same
 * pattern as the CodeFileOperation planHash.
 *
 * PURE module. SERVER-ONLY.
 */

import { createHash } from 'crypto'

export function canonicalJson(value: unknown): string {
  if (value === undefined) return JSON.stringify(null)
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item)).join(',') + ']'
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return (
    '{' +
    entries.map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v)).join(',') +
    '}'
  )
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** Digest over the canonical form of a proposed action. */
export function actionDigestFor(action: unknown): string {
  return sha256Hex(canonicalJson(action))
}
