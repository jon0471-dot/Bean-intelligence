/**
 * BEAN Intelligence — M26 F-10 regression: the SQLite connection URL builder.
 * Pins: connection_limit=1 preserved, busy_timeout forced (bounded 5s default,
 * operator-overridable via BEAN_DB_BUSY_TIMEOUT_MS, capped 60s), existing
 * params preserved, non-file URLs untouched.
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import { sqliteUrl } from '../../src/lib/db'

const ORIGINAL = process.env.DATABASE_URL
const ORIGINAL_BUSY = process.env.BEAN_DB_BUSY_TIMEOUT_MS

beforeEach(() => {
  process.env.DATABASE_URL = ORIGINAL
  if (ORIGINAL_BUSY === undefined) delete process.env.BEAN_DB_BUSY_TIMEOUT_MS
  else process.env.BEAN_DB_BUSY_TIMEOUT_MS = ORIGINAL_BUSY
})

describe('M26 F-10 — sqlite URL hardening', () => {
  test('busy_timeout is forced alongside connection_limit=1', () => {
    process.env.DATABASE_URL = 'file:/tmp/x.db'
    const url = sqliteUrl()!
    expect(url).toContain('connection_limit=1')
    expect(url).toContain('busy_timeout=5000')
  })

  test('existing params are preserved (no duplicate connection_limit)', () => {
    process.env.DATABASE_URL = 'file:/tmp/x.db?connection_limit=2&pool_timeout=10'
    const url = sqliteUrl()!
    expect(url).toContain('connection_limit=2')
    expect(url).toContain('pool_timeout=10')
    expect(url.match(/connection_limit=/g)!.length).toBe(1)
    expect(url).toContain('busy_timeout=5000')
  })

  test('BEAN_DB_BUSY_TIMEOUT_MS overrides the default and is capped at 60s', () => {
    process.env.DATABASE_URL = 'file:/tmp/x.db'
    process.env.BEAN_DB_BUSY_TIMEOUT_MS = '15000'
    expect(sqliteUrl()).toContain('busy_timeout=15000')
    process.env.BEAN_DB_BUSY_TIMEOUT_MS = '999999'
    expect(sqliteUrl()).toContain('busy_timeout=60000')
    process.env.BEAN_DB_BUSY_TIMEOUT_MS = 'not-a-number'
    expect(sqliteUrl()).toContain('busy_timeout=5000')
  })

  test('non-file URLs pass through untouched', () => {
    process.env.DATABASE_URL = 'postgresql://user:pw@host/db'
    expect(sqliteUrl()).toBe('postgresql://user:pw@host/db')
    expect(sqliteUrl()).not.toContain('busy_timeout')
  })
})
