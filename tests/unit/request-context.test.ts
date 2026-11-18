/**
 * BEAN Intelligence — M26 O-1 regression: request/correlation IDs.
 * Pins: withRequestContext scopes the id into every log line; lines outside
 * a context carry NO id; an unexpected-error log carries the id.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { withRequestContext, currentRequestId, logger, setLogLevel } from '../../src/lib/observability/logger'

// Hermetic level: these tests assert on logger.info output, so the ambient
// deployment level (BEAN_LOG_LEVEL=warn in this deployment's .env) must not
// filter them — pin 'info' for the suite and restore afterwards.
let prevLevelRestore: (() => void) | null = null
beforeAll(() => {
  const env = process.env.BEAN_LOG_LEVEL
  setLogLevel('info')
  prevLevelRestore = () => {
    process.env.BEAN_LOG_LEVEL = env
    if (env === 'warn') setLogLevel('warn')
    else if (env === 'error') setLogLevel('error')
    else if (env === 'debug') setLogLevel('debug')
    else setLogLevel('info')
  }
})
afterAll(() => {
  prevLevelRestore?.()
})

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
      await new Promise<void>((resolve) => { globalThis.setTimeout(() => resolve(), 5) })
      seen = currentRequestId()
    })
    expect(seen === 'req-nested').toBe(true)
    expect(currentRequestId() === null).toBe(true)
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
