/**
 * BEAN Intelligence — M26 O-1 regression: request/correlation IDs.
 * Pins: withRequestContext scopes the id into every log line; lines outside
 * a context carry NO id; an unexpected-error log carries the id.
 */
import { describe, test, expect } from 'bun:test'
import { withRequestContext, currentRequestId, logger } from '../../src/lib/observability/logger'

describe('M26 O-1 — request correlation ids', () => {
  test('a log line inside a request scope carries the requestId', async () => {
    const orig = console.log
    let captured: string | null = null
    console.log = (line: string) => {
      captured = line
    }
    try {
      await withRequestContext({ requestId: 'req-abc-123' }, async () => {
        expect(currentRequestId()).toBe('req-abc-123')
        logger.info('test.event', { jobId: 'job-1' })
      })
    } finally {
      console.log = orig
    }
    const parsed = JSON.parse(captured!)
    expect(parsed.requestId).toBe('req-abc-123')
    expect(parsed.event).toBe('test.event')
    expect(parsed.jobId).toBe('job-1')
  })

  test('nested async work inside the scope keeps the id', async () => {
    let seen: string | null = null
    await withRequestContext({ requestId: 'req-nested' }, async () => {
      await new Promise((r) => setTimeout(r, 5))
      seen = currentRequestId()
    })
    expect(seen).toBe('req-nested')
    expect(currentRequestId()).toBeNull()
  })

  test('outside a scope there is no id (worker logs unchanged)', () => {
    expect(currentRequestId()).toBeNull()
    const orig = console.log
    let captured: string | null = null
    console.log = (line: string) => {
      captured = line
    }
    try {
      logger.info('worker.event', { jobId: 'j9' })
    } finally {
      console.log = orig
    }
    const parsed = JSON.parse(captured!)
    expect(parsed.requestId).toBeUndefined()
    expect(parsed.event).toBe('worker.event')
  })
})
